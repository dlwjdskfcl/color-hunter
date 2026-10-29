import { DurableObject } from 'cloudflare:workers';
import {
  COUNTDOWN_MS,
  ERROR_TEXT,
  MIN_PLAYERS_TO_START,
  NICKNAME_MAX,
  REVEAL_MS,
  SAMPLE_BYTES,
  TEAM_NAME_MAX,
  balanceTeams,
  base64ToBytes,
  cleanName,
  computeResults,
  extractRepresentativeColor,
  getTargetColor,
  makeTeams,
  nicknameKey,
  pickRoundColors,
  sanitizeSettings,
  scoreSubmission,
  smallestTeam,
  targetLab,
  teamRoundScore,
  DEFAULT_SETTINGS,
  type ClientMessage,
  type ErrorCode,
  type FinalResults,
  type GameSettings,
  type Phase,
  type Role,
  type RoomSnapshot,
  type RoundSummary,
  type ServerMessage,
  type SubmissionView,
  type Team,
} from '@color-hunter/shared';
import type { Env } from './index';

/** 마지막 활동 후 이 시간이 지나면 방과 저장 데이터를 지움 */
const ROOM_TTL_MS = 6 * 60 * 60 * 1000;
const MAX_SOCKETS = 80;
const MAX_MESSAGE_CHARS = 8000;
const RATE_WINDOW_MS = 1000;
const RATE_MAX = 15;
/** 변경을 모아서 저장하는 간격. 진행은 메모리에서 하고 저장은 재시작 복구용 (무료 한도의 '쓰기 행' 절약) */
const FLUSH_MS = 1500;

interface PlayerRec {
  id: string;
  token: string;
  nickname: string;
  teamId: number;
  joinedAt: number;
}

interface RoundRec {
  index: number;
  colorId: string;
  startsAt: number;
  endsAt: number;
  revealUntil: number | null;
}

interface RoomState {
  v: 1;
  code: string;
  createdAt: number;
  hostToken: string;
  phase: Phase;
  settings: GameSettings;
  teams: Team[];
  players: PlayerRec[];
  order: string[];
  round: RoundRec | null;
  pausedAt: number | null;
  lastActivity: number;
  lastRound: RoundSummary | null;
  results: FinalResults | null;
  /** 라운드별 최고 매칭 사진(32×32 분석영역)만 보관: `${round}:${playerId}` → base64 */
  bestThumbs: Record<string, string>;
  /** 게임 번호 ('다시 플레이' 마다 +1). 제출 기록 키에 넣어 지난 게임 기록을 지우지 않아도 됨 */
  game?: number;
  /** 이 방이 지금까지 쓴 저장소 행 수(무료 한도 확인용) */
  writes?: number;
}

interface Attachment {
  pid: string | null;
  role: Role | null;
}

function randomHex(bytes: number): string {
  const b = crypto.getRandomValues(new Uint8Array(bytes));
  return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
}

function cryptoRandom(): number {
  return crypto.getRandomValues(new Uint32Array(1))[0] / 2 ** 32;
}

class GameError extends Error {
  constructor(public code: ErrorCode) {
    super(ERROR_TEXT[code]);
  }
}

export class Room extends DurableObject<Env> {
  private state: RoomState | null = null;
  /** 제출 기록 (라운드별로 `subs:<게임>:<라운드>` 키에 저장) */
  private subs: SubmissionView[] = [];
  /** 이번 라운드 분석영역 데이터 — 저장하지 않고 메모리에만, 라운드가 끝나면 최고 기록만 남김 */
  private thumbs = new Map<string, string>();
  private dirtyRounds = new Set<number>();
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  /** 걸어 둔 알람 시각 (undefined = 아직 모름) */
  private alarmAt: number | null | undefined = undefined;
  private rate = new WeakMap<WebSocket, { start: number; count: number }>();

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    // 하트비트는 DO 를 깨우지 않고 자동 응답 (비용 절감)
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('{"t":"hb"}', '{"t":"hb"}'));
    ctx.blockConcurrencyWhile(() => this.load());
  }

  // ---------- 저장 ----------

  private async load() {
    this.state = (await this.ctx.storage.get<RoomState>('state')) ?? null;
    this.subs = [];
    if (this.state?.round) {
      const keys = Array.from({ length: this.state.round.index + 1 }, (_, i) => this.subsKey(i));
      const got = await this.ctx.storage.get<SubmissionView[]>(keys);
      for (const k of keys) this.subs.push(...(got.get(k) ?? []));
    }
  }

  private subsKey(round: number) {
    return `subs:${this.state?.game ?? 0}:${round}`;
  }

  /**
   * 변경 저장. 기본은 FLUSH_MS 동안 모았다가 한 번에(제출 30개 → 몇 번의 쓰기),
   * now=true 는 바로 저장(방 생성·게임 시작·종료처럼 잃으면 안 되는 순간).
   * 대기 중인 타이머가 있으면 DO 가 잠들지 않으므로 저장이 누락되지 않음.
   */
  private async persist(opts: { round?: number; now?: boolean } = {}) {
    if (!this.state) return;
    this.state.lastActivity = Date.now();
    if (opts.round !== undefined) this.dirtyRounds.add(opts.round);
    await this.scheduleAlarm();
    if (opts.now) return this.flush();
    this.flushTimer ??= setTimeout(() => {
      this.flushTimer = null;
      void this.flush();
    }, FLUSH_MS);
  }

  private async flush() {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    if (!this.state) return;
    const entries: Record<string, unknown> = {};
    for (const r of this.dirtyRounds) entries[this.subsKey(r)] = this.subs.filter((x) => x.round === r);
    this.dirtyRounds.clear();
    this.countWrites(Object.keys(entries).length + 1);
    entries.state = this.state;
    await this.ctx.storage.put(entries);
  }

  private countWrites(n: number) {
    if (this.state) this.state.writes = (this.state.writes ?? 0) + n;
  }

  /**
   * 알람은 하나만: 다음 단계 전환 시각, 없으면 방 정리 시각.
   * 정리 알람은 활동이 있을 때마다 다시 걸지 않고, 울렸을 때 마지막 활동을 보고 다시 판단함.
   */
  private async scheduleAlarm() {
    const s = this.state;
    if (!s) return;
    let deadline: number | null = null;
    if (s.round && s.pausedAt === null) {
      if (s.phase === 'countdown') deadline = s.round.startsAt;
      else if (s.phase === 'hunting') deadline = s.round.endsAt;
      else if (s.phase === 'reveal' && s.round.revealUntil) deadline = s.round.revealUntil;
    }
    if (this.alarmAt === undefined) this.alarmAt = await this.ctx.storage.getAlarm();
    const now = Date.now();
    const pending = this.alarmAt !== null && this.alarmAt > now ? this.alarmAt : null;
    const next = deadline ?? pending ?? s.lastActivity + ROOM_TTL_MS;
    if (next === pending) return;
    this.countWrites(1);
    this.alarmAt = next;
    await this.ctx.storage.setAlarm(next);
  }

  // ---------- RPC (Worker → DO) ----------

  async init(code: string): Promise<{ ok: boolean; hostToken?: string }> {
    if (this.state) return { ok: false };
    const now = Date.now();
    const settings = { ...DEFAULT_SETTINGS };
    this.state = {
      v: 1,
      code,
      createdAt: now,
      hostToken: randomHex(16),
      phase: 'lobby',
      settings,
      teams: makeTeams(settings.teamCount),
      players: [],
      order: [],
      round: null,
      pausedAt: null,
      lastActivity: now,
      lastRound: null,
      results: null,
      bestThumbs: {},
      game: 0,
    };
    await this.persist({ now: true });
    return { ok: true, hostToken: this.state.hostToken };
  }

  async info(): Promise<{ exists: boolean; phase?: Phase; players?: number; maxPlayers?: number; writes?: number }> {
    if (!this.state) return { exists: false };
    return {
      exists: true,
      phase: this.state.phase,
      players: this.state.players.length,
      maxPlayers: this.state.settings.maxPlayers,
      // 로컬 측정용 (EXPOSE_METRICS=1 일 때만)
      ...(this.env.EXPOSE_METRICS === '1' ? { writes: this.state.writes ?? 0 } : {}),
    };
  }

  // ---------- 웹소켓 ----------

  async fetch(request: Request): Promise<Response> {
    if (request.headers.get('Upgrade') !== 'websocket') return new Response('expected websocket', { status: 426 });
    if (!this.state) return new Response('room not found', { status: 404 });
    if (this.ctx.getWebSockets().length >= MAX_SOCKETS) return new Response('room busy', { status: 503 });
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ pid: null, role: null } satisfies Attachment);
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer) {
    if (typeof raw !== 'string' || raw.length > MAX_MESSAGE_CHARS) return this.sendError(ws, 'bad_message');
    if (!this.allow(ws)) return this.sendError(ws, 'rate_limited');
    let msg: ClientMessage;
    try {
      msg = JSON.parse(raw);
    } catch {
      return this.sendError(ws, 'bad_message');
    }
    if (!msg || typeof msg !== 'object' || typeof msg.t !== 'string') return this.sendError(ws, 'bad_message');
    if (!this.state) {
      this.send(ws, { t: 'error', code: 'room_closed', message: ERROR_TEXT.room_closed });
      ws.close(4004, 'room closed');
      return;
    }
    try {
      await this.tick(Date.now());
      await this.handle(ws, msg);
    } catch (e) {
      if (e instanceof GameError) this.sendError(ws, e.code, 'id' in msg ? String(msg.id) : undefined);
      else {
        console.error('handler error', e);
        this.sendError(ws, 'bad_message');
      }
    }
  }

  async webSocketClose(ws: WebSocket, code: number) {
    try {
      ws.close(code === 1005 ? 1000 : code, 'bye');
    } catch {
      /* 이미 닫힘 */
    }
    this.onPresenceChange(ws);
  }

  async webSocketError(ws: WebSocket) {
    this.onPresenceChange(ws);
  }

  private onPresenceChange(closing: WebSocket) {
    const att = closing.deserializeAttachment() as Attachment | null;
    if (att?.role) this.broadcast(closing);
  }

  private allow(ws: WebSocket): boolean {
    const now = Date.now();
    const r = this.rate.get(ws);
    if (!r || now - r.start > RATE_WINDOW_MS) {
      this.rate.set(ws, { start: now, count: 1 });
      return true;
    }
    r.count++;
    return r.count <= RATE_MAX;
  }

  private send(ws: WebSocket, msg: ServerMessage) {
    try {
      ws.send(JSON.stringify(msg));
    } catch {
      /* 끊긴 소켓 */
    }
  }

  private sendError(ws: WebSocket, code: ErrorCode, ref?: string) {
    this.send(ws, { t: 'error', code, message: ERROR_TEXT[code], ref });
  }

  // ---------- 메시지 처리 ----------

  private async handle(ws: WebSocket, msg: ClientMessage) {
    const s = this.state!;
    const att = (ws.deserializeAttachment() as Attachment | null) ?? { pid: null, role: null };

    if (msg.t === 'ping') {
      this.send(ws, { t: 'pong', c: Number(msg.c) || 0, s: Date.now() });
      return;
    }
    if (msg.t === 'hello') return this.hello(ws, String(msg.token ?? ''));
    if (msg.t === 'join') return this.join(ws, att, msg.nickname);

    if (!att.role) throw new GameError('not_joined');

    if (att.role === 'player') {
      if (msg.t === 'submit') return this.submit(ws, att.pid!, msg);
      if (msg.t === 'leave') return this.leave(ws, att.pid!);
      throw new GameError('not_host');
    }

    // ----- 호스트 전용 -----
    const now = Date.now();
    switch (msg.t) {
      case 'settings': {
        if (s.phase !== 'lobby') throw new GameError('already_started');
        const next = sanitizeSettings(msg.settings, s.settings);
        if (next.teamCount !== s.settings.teamCount) {
          s.teams = makeTeams(next.teamCount, s.teams);
          for (const p of s.players) {
            if (p.teamId >= next.teamCount) p.teamId = smallestTeam(s.players.filter((x) => x !== p && x.teamId < next.teamCount), next.teamCount);
          }
        }
        s.settings = next;
        break;
      }
      case 'team:rename': {
        const team = s.teams.find((t) => t.id === msg.teamId);
        const name = cleanName(msg.name, TEAM_NAME_MAX);
        if (!team || !name) throw new GameError('bad_message');
        team.name = name;
        break;
      }
      case 'team:move': {
        if (s.phase !== 'lobby') throw new GameError('already_started');
        const p = s.players.find((x) => x.id === msg.playerId);
        if (!p || !s.teams.some((t) => t.id === msg.teamId)) throw new GameError('bad_message');
        p.teamId = msg.teamId;
        break;
      }
      case 'team:shuffle': {
        if (s.phase !== 'lobby') throw new GameError('already_started');
        const m = balanceTeams(s.players.map((p) => p.id), s.settings.teamCount, cryptoRandom);
        for (const p of s.players) p.teamId = m.get(p.id) ?? 0;
        break;
      }
      case 'kick': {
        const p = s.players.find((x) => x.id === msg.playerId);
        if (!p) throw new GameError('bad_message');
        s.players = s.players.filter((x) => x !== p);
        for (const other of this.socketsOf(p.id)) {
          this.send(other, { t: 'kicked' });
          other.serializeAttachment({ pid: null, role: null } satisfies Attachment);
          other.close(4001, 'kicked');
        }
        break;
      }
      case 'start': {
        if (s.phase !== 'lobby') throw new GameError('already_started');
        const teamsWithPlayers = new Set(s.players.map((p) => p.teamId));
        if (s.players.length < MIN_PLAYERS_TO_START || teamsWithPlayers.size < 2) throw new GameError('not_enough_players');
        s.order = pickRoundColors(s.settings.rounds, s.settings.difficulty, cryptoRandom).map((c) => c.id);
        this.subs = [];
        s.game = (s.game ?? 0) + 1;
        s.results = null;
        s.lastRound = null;
        s.bestThumbs = {};
        this.beginRound(0, now);
        break;
      }
      case 'pause':
        if (s.pausedAt === null && (s.phase === 'countdown' || s.phase === 'hunting' || s.phase === 'reveal')) s.pausedAt = now;
        break;
      case 'resume':
        this.resume(now);
        break;
      case 'skip':
        this.resume(now);
        if (s.phase === 'countdown' || s.phase === 'hunting') await this.endRound(now);
        else if (s.phase === 'reveal') await this.advanceAfterReveal(now);
        break;
      case 'end':
        this.resume(now);
        if (s.phase === 'countdown' || s.phase === 'hunting' || s.phase === 'reveal') {
          if (s.phase !== 'reveal' && s.round && now >= s.round.startsAt) await this.endRound(now);
          await this.finish(now);
        }
        break;
      case 'restart': {
        if (s.phase !== 'finished') throw new GameError('bad_message');
        // 지난 게임 기록은 지우지 않음(키에 게임 번호가 있어 섞이지 않고, 방 정리 때 한꺼번에 삭제)
        this.subs = [];
        s.phase = 'lobby';
        s.round = null;
        s.order = [];
        s.results = null;
        s.lastRound = null;
        s.bestThumbs = {};
        s.pausedAt = null;
        break;
      }
      default:
        throw new GameError('bad_message');
    }
    await this.persist({ now: msg.t === 'start' || msg.t === 'end' || msg.t === 'restart' });
    this.broadcast();
  }

  private async hello(ws: WebSocket, token: string) {
    const s = this.state!;
    let att: Attachment;
    if (token && token === s.hostToken) att = { pid: null, role: 'host' };
    else {
      const p = token ? s.players.find((x) => x.token === token) : undefined;
      if (!p) throw new GameError('invalid_token');
      att = { pid: p.id, role: 'player' };
      // 같은 플레이어의 예전 창은 닫음
      for (const other of this.socketsOf(p.id)) {
        if (other !== ws) {
          other.serializeAttachment({ pid: null, role: null } satisfies Attachment);
          other.close(4000, 'replaced');
        }
      }
    }
    ws.serializeAttachment(att);
    this.send(ws, { t: 'welcome', role: att.role!, playerId: att.pid, token, serverNow: Date.now() });
    this.broadcast();
  }

  private async join(ws: WebSocket, att: Attachment, rawName: unknown) {
    const s = this.state!;
    if (att.role) throw new GameError('bad_message');
    if (s.phase !== 'lobby') throw new GameError('already_started');
    if (s.players.length >= s.settings.maxPlayers) throw new GameError('room_full');
    const nickname = cleanName(rawName, NICKNAME_MAX);
    if (!nickname) throw new GameError('nickname_invalid');
    const key = nicknameKey(nickname);
    if (s.players.some((p) => nicknameKey(p.nickname) === key)) throw new GameError('nickname_taken');
    const player: PlayerRec = {
      id: randomHex(6),
      token: randomHex(16),
      nickname,
      teamId: smallestTeam(s.players, s.settings.teamCount),
      joinedAt: Date.now(),
    };
    s.players.push(player);
    ws.serializeAttachment({ pid: player.id, role: 'player' } satisfies Attachment);
    await this.persist();
    this.send(ws, { t: 'welcome', role: 'player', playerId: player.id, token: player.token, serverNow: Date.now() });
    this.broadcast();
  }

  private async leave(ws: WebSocket, pid: string) {
    const s = this.state!;
    if (s.phase === 'lobby') {
      s.players = s.players.filter((p) => p.id !== pid);
      await this.persist();
    }
    ws.serializeAttachment({ pid: null, role: null } satisfies Attachment);
    ws.close(1000, 'left');
    this.broadcast(ws);
  }

  /**
   * 제출 처리. DO 는 한 번에 한 요청만 실행(입력 게이트)하므로
   * 마감 확인 → 중복 확인 → 점수 계산 → 저장이 다른 제출과 섞이지 않는다(원자적).
   */
  private async submit(ws: WebSocket, pid: string, msg: Extract<ClientMessage, { t: 'submit' }>) {
    const s = this.state!;
    const now = Date.now();
    const ref = typeof msg.id === 'string' ? msg.id.slice(0, 40) : '';
    const round = s.round;
    if (!round || s.pausedAt !== null) throw new GameError('not_accepting');
    if (msg.round !== round.index) throw new GameError('wrong_round');
    const existing = this.subs.find((x) => x.round === round.index && x.playerId === pid);
    if (existing) {
      // 재전송(같은 요청 id) 이면 기존 결과를 다시 알려 줌. 점수는 한 번만 반영.
      this.send(ws, { t: 'submitted', id: ref, result: existing });
      throw new GameError('duplicate');
    }
    if (s.phase === 'reveal' || now > round.endsAt) throw new GameError('too_late');
    if (s.phase !== 'hunting' || now < round.startsAt) throw new GameError('not_accepting');
    if (typeof msg.pixels !== 'string' || msg.pixels.length > 6000) throw new GameError('bad_pixels');
    let bytes: Uint8Array;
    try {
      bytes = base64ToBytes(msg.pixels);
    } catch {
      throw new GameError('bad_pixels');
    }
    if (bytes.length !== SAMPLE_BYTES) throw new GameError('bad_pixels');

    const player = s.players.find((p) => p.id === pid);
    const target = getTargetColor(round.colorId);
    if (!player || !target) throw new GameError('not_joined');
    const measured = extractRepresentativeColor(bytes, 3);
    const totalMs = s.settings.roundSeconds * 1000;
    const score = scoreSubmission({
      target: targetLab(target),
      measured: measured.lab,
      remainingMs: round.endsAt - now,
      totalMs,
      tolerance: s.settings.tolerance,
      timeBonusEnabled: s.settings.timeBonus,
    });
    if (!score.valid) throw new GameError('too_late');

    const view: SubmissionView = {
      playerId: pid,
      teamId: player.teamId,
      round: round.index,
      hex: measured.hex,
      deltaE: Math.round(score.deltaE * 10) / 10,
      colorScore: score.colorScore,
      timeBonus: score.timeBonus,
      total: score.total,
    };
    this.subs.push(view);
    this.thumbs.set(pid, msg.pixels);
    this.send(ws, { t: 'submitted', id: ref, result: view });

    // 접속 중인 모든 플레이어가 냈으면 라운드 조기 종료
    const connected = this.connectedPlayerIds();
    const submitted = new Set(this.subs.filter((x) => x.round === round.index).map((x) => x.playerId));
    const allIn = s.players.filter((p) => connected.has(p.id)).every((p) => submitted.has(p.id));
    if (allIn) await this.endRound(now);
    await this.persist({ round: round.index });
    this.broadcast();
  }

  // ---------- 라운드 진행 ----------

  private beginRound(index: number, now: number) {
    const s = this.state!;
    const startsAt = now + COUNTDOWN_MS;
    s.round = {
      index,
      colorId: s.order[index],
      startsAt,
      endsAt: startsAt + s.settings.roundSeconds * 1000,
      revealUntil: null,
    };
    s.phase = 'countdown';
    s.lastRound = null;
    this.thumbs.clear();
  }

  private resume(now: number) {
    const s = this.state!;
    if (s.pausedAt === null) return;
    const shift = now - s.pausedAt;
    if (s.round) {
      s.round.startsAt += shift;
      s.round.endsAt += shift;
      if (s.round.revealUntil !== null) s.round.revealUntil += shift;
    }
    s.pausedAt = null;
  }

  private async endRound(now: number) {
    const s = this.state!;
    const round = s.round!;
    const target = getTargetColor(round.colorId)!;
    const present = new Set(s.players.map((p) => p.id));
    const results = this.subs
      .filter((x) => x.round === round.index && present.has(x.playerId))
      .sort((a, b) => b.total - a.total || a.deltaE - b.deltaE);
    const teamScores: Record<number, number> = {};
    for (const t of s.teams) {
      const members = s.players.filter((p) => p.teamId === t.id).length;
      teamScores[t.id] = teamRoundScore(results, t.id, members, s.settings.teamScoring);
    }
    let best: RoundSummary['best'] = null;
    const top = [...results].sort((a, b) => a.deltaE - b.deltaE || b.total - a.total)[0];
    if (top) {
      const key = `${round.index}:${top.playerId}`;
      const thumb = this.thumbs.get(top.playerId) ?? null;
      if (thumb) s.bestThumbs[key] = thumb;
      best = { ...top, thumb };
    }
    // 최고 매칭 외의 분석영역 데이터는 라운드가 끝나면 버림
    this.thumbs.clear();
    s.lastRound = {
      index: round.index,
      target: { id: target.id, name: target.name, hex: target.hex },
      results,
      teamScores,
      best,
    };
    s.phase = 'reveal';
    round.revealUntil = now + REVEAL_MS;
  }

  private async advanceAfterReveal(now: number) {
    const s = this.state!;
    const next = (s.round?.index ?? -1) + 1;
    if (next < s.settings.rounds && next < s.order.length) this.beginRound(next, now);
    else await this.finish(now);
  }

  private async finish(_now: number) {
    const s = this.state!;
    const round = s.round;
    // 카운트다운 도중 종료한 라운드는 진행하지 않은 것으로 봄
    const roundsPlayed = round ? (s.lastRound?.index === round.index ? round.index + 1 : round.index) : 0;
    s.results = computeResults({
      teams: s.teams,
      players: s.players,
      submissions: this.subs.filter((x) => x.round < roundsPlayed),
      roundsPlayed,
      roundTargets: s.order.map((id) => {
        const c = getTargetColor(id)!;
        return { name: c.name, hex: c.hex };
      }),
      teamScoring: s.settings.teamScoring,
      thumbs: s.bestThumbs,
    });
    s.phase = 'finished';
    s.pausedAt = null;
    // 대시보드(Workers → Logs)에서 판당 사용량 확인용
    console.log(JSON.stringify({ event: 'game_finished', room: s.code, players: s.players.length, rounds: roundsPlayed, storageWrites: s.writes ?? 0 }));
  }

  /** 시간이 지난 단계를 순서대로 진행 (알람·메시지 처리 시작 때 호출) */
  private async tick(now: number) {
    const s = this.state;
    if (!s || s.pausedAt !== null || !s.round) return false;
    let changed = false;
    for (let guard = 0; guard < 5; guard++) {
      const r = s.round!;
      if (s.phase === 'countdown' && now >= r.startsAt) s.phase = 'hunting';
      else if (s.phase === 'hunting' && now > r.endsAt) await this.endRound(now);
      else if (s.phase === 'reveal' && r.revealUntil !== null && now >= r.revealUntil) await this.advanceAfterReveal(now);
      else break;
      changed = true;
    }
    if (changed) {
      await this.persist();
      this.broadcast();
    }
    return changed;
  }

  async alarm() {
    this.alarmAt = null; // 지금 울린 알람은 끝남
    const s = this.state;
    if (!s) return;
    const now = Date.now();
    if (now >= s.lastActivity + ROOM_TTL_MS) {
      for (const ws of this.ctx.getWebSockets()) {
        this.send(ws, { t: 'error', code: 'room_closed', message: ERROR_TEXT.room_closed });
        ws.close(4004, 'room expired');
      }
      this.state = null;
      this.subs = [];
      if (this.flushTimer) clearTimeout(this.flushTimer);
      this.flushTimer = null;
      await this.ctx.storage.deleteAlarm();
      await this.ctx.storage.deleteAll();
      return;
    }
    // 단계가 바뀌지 않았으면 lastActivity 를 갱신하지 않고 다음 알람만 잡음
    if (!(await this.tick(now))) await this.scheduleAlarm();
  }

  // ---------- 상태 전송 ----------

  private socketsOf(pid: string): WebSocket[] {
    return this.ctx.getWebSockets().filter((ws) => (ws.deserializeAttachment() as Attachment | null)?.pid === pid);
  }

  private connectedPlayerIds(except?: WebSocket): Set<string> {
    const ids = new Set<string>();
    for (const ws of this.ctx.getWebSockets()) {
      if (ws === except) continue;
      const att = ws.deserializeAttachment() as Attachment | null;
      if (att?.role === 'player' && att.pid) ids.add(att.pid);
    }
    return ids;
  }

  private snapshot(except?: WebSocket): RoomSnapshot {
    const s = this.state!;
    const now = Date.now();
    const connected = this.connectedPlayerIds(except);
    const hostConnected = this.ctx
      .getWebSockets()
      .some((ws) => ws !== except && (ws.deserializeAttachment() as Attachment | null)?.role === 'host');
    const round = s.round;
    const present = new Set(s.players.map((p) => p.id));
    const validSubs = this.subs.filter((x) => present.has(x.playerId));
    const roundSubs = new Set(round ? validSubs.filter((x) => x.round === round.index).map((x) => x.playerId) : []);
    const totals = new Map<string, number>();
    for (const x of validSubs) totals.set(x.playerId, (totals.get(x.playerId) ?? 0) + x.total);

    const players = s.players.map((p) => ({
      id: p.id,
      nickname: p.nickname,
      teamId: p.teamId,
      connected: connected.has(p.id),
      total: totals.get(p.id) ?? 0,
      submitted: roundSubs.has(p.id),
    }));
    const teams = s.teams.map((t) => {
      const members = players.filter((p) => p.teamId === t.id);
      const sum = validSubs.filter((x) => x.teamId === t.id).reduce((a, x) => a + x.total, 0);
      const total =
        s.settings.teamScoring === 'average' ? (members.length ? Math.round((sum / members.length) * 10) / 10 : 0) : sum;
      return { ...t, total, memberCount: members.length };
    });

    let pausedRemainingMs: number | null = null;
    if (s.pausedAt !== null && round) {
      const ref = s.phase === 'countdown' ? round.startsAt : s.phase === 'hunting' ? round.endsAt : round.revealUntil ?? s.pausedAt;
      pausedRemainingMs = Math.max(0, ref - s.pausedAt);
    }
    const target = round ? getTargetColor(round.colorId) : undefined;
    const showTarget = round && target && s.phase !== 'countdown' && s.phase !== 'lobby';

    return {
      code: s.code,
      phase: s.phase,
      paused: s.pausedAt !== null,
      pausedRemainingMs,
      settings: s.settings,
      teams,
      players,
      hostConnected,
      round: round
        ? {
            index: round.index,
            target: showTarget ? { id: target!.id, name: target!.name, hex: target!.hex } : null,
            startsAt: round.startsAt,
            endsAt: round.endsAt,
            revealUntil: round.revealUntil,
          }
        : null,
      totalRounds: s.settings.rounds,
      lastRound: s.phase === 'reveal' ? s.lastRound : null,
      results: s.phase === 'finished' ? s.results : null,
      serverNow: now,
    };
  }

  private broadcast(except?: WebSocket) {
    if (!this.state) return;
    const snap = this.snapshot(except);
    const roundIndex = this.state.round?.index ?? -1;
    const base = JSON.stringify(snap);
    for (const ws of this.ctx.getWebSockets()) {
      if (ws === except) continue;
      const att = ws.deserializeAttachment() as Attachment | null;
      if (!att?.role) continue;
      const mine = att.pid ? this.subs.find((x) => x.round === roundIndex && x.playerId === att.pid) ?? null : null;
      try {
        ws.send(`{"t":"state","s":${base},"mine":${JSON.stringify(mine)}}`);
      } catch {
        /* 끊긴 소켓 */
      }
    }
  }
}
