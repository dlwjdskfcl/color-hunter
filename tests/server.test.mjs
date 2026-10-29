// 실제 게임 서버(wrangler dev)에 여러 웹소켓 클라이언트로 접속해 전체 흐름을 검증.
// 실행: (터미널 1) npm run dev:server   (터미널 2) npm run test:server
import { test } from 'node:test';
import assert from 'node:assert/strict';

const BASE = process.env.SERVER_URL ?? 'http://127.0.0.1:8787';
const WS_BASE = BASE.replace(/^http/, 'ws');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function pixels(hex) {
  const rgb = hexToRgb(hex);
  const buf = Buffer.alloc(32 * 32 * 3);
  for (let i = 0; i < 32 * 32; i++) buf.set(rgb, i * 3);
  return buf.toString('base64');
}

class Client {
  constructor(name) {
    this.name = name;
    this.msgs = [];
    this.waiters = [];
    this.state = null;
    this.mine = null;
  }
  open(code) {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(`${WS_BASE}/api/rooms/${code}/ws`);
      this.ws.onopen = () => resolve(this);
      this.ws.onerror = (e) => reject(new Error(`${this.name} ws error ${e.message ?? ''}`));
      this.ws.onclose = (e) => {
        this.closed = e.code;
        this.msgs.push({ t: '_close', code: e.code });
        this.flush();
      };
      this.ws.onmessage = (e) => {
        const m = JSON.parse(e.data);
        if (m.t === 'state') {
          this.state = m.s;
          this.mine = m.mine;
        }
        this.msgs.push(m);
        this.flush();
      };
    });
  }
  flush() {
    for (const w of [...this.waiters]) {
      const idx = this.msgs.findIndex((m, i) => i >= w.from && w.pred(m));
      if (idx >= 0) {
        this.waiters.splice(this.waiters.indexOf(w), 1);
        clearTimeout(w.timer);
        w.resolve(this.msgs[idx]);
      }
    }
  }
  /** 지금 이후 들어오는 메시지 중 조건에 맞는 것 */
  next(pred, timeout = 5000, from = this.msgs.length) {
    return new Promise((resolve, reject) => {
      const w = { pred, from, resolve };
      w.timer = setTimeout(() => {
        this.waiters.splice(this.waiters.indexOf(w), 1);
        reject(new Error(`${this.name}: timeout waiting (${pred})`));
      }, timeout);
      this.waiters.push(w);
      this.flush();
    });
  }
  send(m) {
    this.ws.send(JSON.stringify(m));
  }
  async request(m, pred, timeout) {
    const from = this.msgs.length;
    this.send(m);
    return this.next(pred, timeout, from);
  }
  error(m) {
    return this.request(m, (x) => x.t === 'error');
  }
  waitState(pred, timeout = 8000) {
    if (this.state && pred(this.state)) return Promise.resolve(this.state);
    return this.next((m) => m.t === 'state' && pred(m.s), timeout).then((m) => m.s);
  }
  close() {
    try {
      this.ws.close();
    } catch {}
  }
}

async function createRoom() {
  const res = await fetch(`${BASE}/api/rooms`, { method: 'POST' });
  assert.equal(res.status, 201);
  return res.json();
}
async function host(code, token) {
  const c = await new Client('host').open(code);
  const w = await c.request({ t: 'hello', token }, (m) => m.t === 'welcome' || m.t === 'error');
  assert.equal(w.t, 'welcome');
  assert.equal(w.role, 'host');
  return c;
}
async function player(code, nickname) {
  const c = await new Client(nickname).open(code);
  const w = await c.request({ t: 'join', nickname }, (m) => m.t === 'welcome' || m.t === 'error');
  if (w.t === 'error') {
    c.close();
    const err = new Error(w.code);
    err.code = w.code;
    throw err;
  }
  c.id = w.playerId;
  c.token = w.token;
  return c;
}

test('방 생성 · 코드 검증 · 호스트 권한', async () => {
  const { code, hostToken } = await createRoom();
  assert.match(code, /^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{6}$/);
  assert.equal(hostToken.length, 32);

  const { writes: _w, ...info } = await (await fetch(`${BASE}/api/rooms/${code}`)).json();
  assert.deepEqual(info, { exists: true, phase: 'lobby', players: 0, maxPlayers: 30 });

  // 마지막 검증 문자를 바꾼 코드 → DO 까지 가지 않고 404
  const last = code.at(-1) === 'A' ? 'B' : 'A';
  assert.equal((await fetch(`${BASE}/api/rooms/${code.slice(0, -1)}${last}`)).status, 404);
  assert.equal((await fetch(`${BASE}/api/rooms/12345`)).status, 404);

  const bad = await new Client('fake-host').open(code);
  assert.equal((await bad.error({ t: 'hello', token: 'deadbeef'.repeat(4) })).code, 'invalid_token');
  assert.equal((await bad.error({ t: 'start' })).code, 'not_joined');
  bad.close();

  const p = await player(code, '플레이어');
  for (const t of ['start', 'kick', 'settings', 'end', 'team:shuffle']) {
    assert.equal((await p.error({ t, playerId: p.id, settings: {} })).code, 'not_host', t);
  }
  p.close();
});

test('입장 규칙: 중복 닉네임, 인원 제한, 팀 자동 배정, 수동 변경, 퇴장', async () => {
  const { code, hostToken } = await createRoom();
  const h = await host(code, hostToken);
  await h.request({ t: 'settings', settings: { maxPlayers: 5, teamCount: 2 } }, (m) => m.t === 'state');

  const names = ['민수', '지영', 'Alex', '하늘', '도윤'];
  const ps = [];
  for (const n of names.slice(0, 4)) ps.push(await player(code, n));
  await assert.rejects(player(code, 'alex'), { code: 'nickname_taken' });
  await assert.rejects(player(code, ' A l e x '), { code: 'nickname_taken' });
  await assert.rejects(player(code, '   '), { code: 'nickname_invalid' });
  ps.push(await player(code, names[4]));
  await assert.rejects(player(code, '여섯번째'), { code: 'room_full' });

  let s = await h.waitState((s) => s.players.length === 5 && s.players.every((p) => p.connected));
  const counts = [0, 0];
  for (const p of s.players) counts[p.teamId]++;
  assert.ok(Math.abs(counts[0] - counts[1]) <= 1, `균등 배정 ${counts}`);

  // 팀 수 3 → 기존 팀원 유지, 팀 3개
  await h.request({ t: 'settings', settings: { teamCount: 3 } }, (m) => m.t === 'state');
  s = h.state;
  assert.equal(s.teams.length, 3);
  // 수동 이동
  await h.request({ t: 'team:move', playerId: ps[0].id, teamId: 2 }, (m) => m.t === 'state');
  assert.equal(h.state.players.find((p) => p.id === ps[0].id).teamId, 2);
  // 팀 이름 바꾸기 (제어문자 제거)
  await h.request({ t: 'team:rename', teamId: 1, name: '  번개\u0007팀  ' }, (m) => m.t === 'state');
  assert.equal(h.state.teams[1].name, '번개팀');
  // 자동 균등 재배정
  await h.request({ t: 'team:shuffle' }, (m) => m.t === 'state');
  const c3 = [0, 0, 0];
  for (const p of h.state.players) c3[p.teamId]++;
  assert.ok(Math.max(...c3) - Math.min(...c3) <= 1, `셔플 균등 ${c3}`);
  // 팀 수 2로 줄이면 3번째 팀 인원이 남은 팀으로 이동
  await h.request({ t: 'settings', settings: { teamCount: 2 } }, (m) => m.t === 'state');
  assert.ok(h.state.players.every((p) => p.teamId < 2));

  // 퇴장(강퇴)
  const kickedMsg = ps[4].next((m) => m.t === 'kicked');
  await h.request({ t: 'kick', playerId: ps[4].id }, (m) => m.t === 'state');
  await kickedMsg;
  assert.equal(h.state.players.length, 4);
  // 강퇴된 토큰으로 재접속 불가
  const again = await new Client('kicked-again').open(code);
  assert.equal((await again.error({ t: 'hello', token: ps[4].token })).code, 'invalid_token');
  again.close();

  // 연결 끊김 표시
  ps[3].close();
  await h.waitState((s) => s.players.find((p) => p.id === ps[3].id)?.connected === false);

  for (const p of ps) p.close();
  h.close();
});

test('게임 전체 흐름: 라운드 동기화, 제출, 중복·지각·일시정지, 재접속, 결과', { timeout: 120000 }, async () => {
  const { code, hostToken } = await createRoom();
  const h = await host(code, hostToken);
  await h.request({ t: 'settings', settings: { rounds: 5, roundSeconds: 10, teamCount: 2, difficulty: 'easy' } }, (m) => m.t === 'state');
  assert.equal((await h.error({ t: 'start' })).code, 'not_enough_players');

  const ps = [];
  for (const n of ['A', 'B', 'C', 'D']) ps.push(await player(code, n));
  await h.waitState((s) => s.players.length === 4);
  const teamOf = (c) => h.state.players.find((p) => p.id === c.id).teamId;

  // 시작 → 카운트다운 중엔 목표색 비공개, 제출 불가
  await h.request({ t: 'start' }, (m) => m.t === 'state' && m.s.phase === 'countdown');
  const cd = await ps[0].waitState((s) => s.phase === 'countdown');
  assert.equal(cd.round.target, null);
  assert.equal((await ps[0].error({ t: 'submit', round: 0, pixels: pixels('#000000'), id: 'early' })).code, 'not_accepting');
  // 늦게 들어오려는 사람은 거절
  await assert.rejects(player(code, '지각생'), { code: 'already_started' });

  // 사냥 시작: 모든 클라이언트가 같은 목표·같은 서버 시각을 받음
  const hunting = await Promise.all([h, ...ps].map((c) => c.waitState((s) => s.phase === 'hunting', 6000)));
  const target = hunting[0].round.target;
  assert.ok(target?.hex);
  for (const s of hunting) {
    assert.deepEqual(s.round.target, target);
    assert.equal(s.round.endsAt, hunting[0].round.endsAt);
    assert.equal(s.round.endsAt - s.round.startsAt, 10000);
  }

  // A: 정확한 색 → 100점 + 시간 보너스
  const r1 = await ps[0].request({ t: 'submit', round: 0, pixels: pixels(target.hex), id: 'a1' }, (m) => m.t === 'submitted' || m.t === 'error');
  assert.equal(r1.t, 'submitted');
  assert.equal(r1.result.colorScore, 100);
  assert.ok(r1.result.timeBonus > 10 && r1.result.timeBonus <= 20, `bonus ${r1.result.timeBonus}`);
  assert.equal(r1.result.total, r1.result.colorScore + r1.result.timeBonus);
  // 중복 제출 → 거절, 기존 결과 그대로
  const dup = await ps[0].error({ t: 'submit', round: 0, pixels: pixels('#FFFFFF'), id: 'a1' });
  assert.equal(dup.code, 'duplicate');
  // 지난 라운드·잘못된 픽셀
  assert.equal((await ps[1].error({ t: 'submit', round: 3, pixels: pixels(target.hex), id: 'x' })).code, 'wrong_round');
  assert.equal((await ps[1].error({ t: 'submit', round: 0, pixels: 'AAAA', id: 'x' })).code, 'bad_pixels');
  assert.equal((await ps[1].error({ t: 'submit', round: 0, pixels: '!!!', id: 'x' })).code, 'bad_pixels');

  // 실시간 팀 점수 반영
  const teamA = teamOf(ps[0]);
  await h.waitState((s) => s.teams[teamA].total === r1.result.total && s.players.find((p) => p.id === ps[0].id).submitted);

  // B: 회색 사진 (목표가 회색이 아니면 낮은 점수)
  const r2 = await ps[1].request({ t: 'submit', round: 0, pixels: pixels('#808080'), id: 'b1' }, (m) => m.t === 'submitted');
  assert.ok(r2.result.total <= r1.result.total);

  // C 재접속: 끊고 토큰으로 다시 → 같은 플레이어, 진행 중 상태 복구
  ps[2].close();
  await h.waitState((s) => s.players.find((p) => p.id === ps[2].id).connected === false);
  const c2 = await new Client('C-re').open(code);
  const w = await c2.request({ t: 'hello', token: ps[2].token }, (m) => m.t === 'welcome');
  assert.equal(w.playerId, ps[2].id);
  const restored = await c2.waitState((s) => s.phase === 'hunting');
  assert.deepEqual(restored.round.target, target);
  c2.id = ps[2].id;
  c2.token = ps[2].token;
  ps[2] = c2;

  // 일시정지 → 제출 불가 → 재개 시 마감 시각이 멈춘 만큼 늦춰짐
  const endsBefore = h.state.round.endsAt;
  await h.request({ t: 'pause' }, (m) => m.t === 'state' && m.s.paused);
  assert.ok(h.state.pausedRemainingMs > 0);
  assert.equal((await ps[2].error({ t: 'submit', round: 0, pixels: pixels(target.hex), id: 'c1' })).code, 'not_accepting');
  await sleep(1200);
  await h.request({ t: 'resume' }, (m) => m.t === 'state' && !m.s.paused);
  assert.ok(h.state.round.endsAt - endsBefore >= 1100, `shift ${h.state.round.endsAt - endsBefore}`);

  // C, D 제출 → 접속 중 전원 제출이라 라운드 조기 종료 → 결과 공개
  await ps[2].request({ t: 'submit', round: 0, pixels: pixels(target.hex), id: 'c1' }, (m) => m.t === 'submitted');
  await ps[3].request({ t: 'submit', round: 0, pixels: pixels('#F0F0F0'), id: 'd1' }, (m) => m.t === 'submitted');
  const reveal = await h.waitState((s) => s.phase === 'reveal');
  assert.equal(reveal.lastRound.results.length, 4);
  assert.equal(reveal.lastRound.target.hex, target.hex);
  assert.ok(reveal.lastRound.best.thumb, '최고 매칭 썸네일');
  assert.ok(reveal.lastRound.best.deltaE <= reveal.lastRound.results[3].deltaE);

  // 호스트 새로고침(재접속) → 호스트 권한 유지
  h.close();
  const h2 = await host(code, hostToken);
  const hs = await h2.waitState((s) => s.phase === 'reveal' || s.phase === 'countdown');
  assert.ok(hs.hostConnected);

  // 결과 공개 중 건너뛰기 → 다음 라운드
  await h2.request({ t: 'skip' }, (m) => m.t === 'state' && m.s.phase === 'countdown' && m.s.round.index === 1);
  const r2s = await h2.waitState((s) => s.phase === 'hunting' && s.round.index === 1, 6000);
  assert.notEqual(r2s.round.target.id, target.id, '같은 색 반복 안 함');

  // 라운드 2: A만 제출, 나머지는 시간 초과 → 마감 후 제출은 무효
  const t2 = r2s.round.target;
  const a2 = await ps[0].request({ t: 'submit', round: 1, pixels: pixels(t2.hex), id: 'a2' }, (m) => m.t === 'submitted');
  const waitMs = r2s.round.endsAt - r2s.serverNow + 300;
  await sleep(waitMs);
  assert.equal((await ps[1].error({ t: 'submit', round: 1, pixels: pixels(t2.hex), id: 'late' })).code, 'too_late');
  const rv2 = await h2.waitState((s) => s.phase === 'reveal' && s.round.index === 1);
  assert.equal(rv2.lastRound.results.length, 1);

  // 게임 종료 → 최종 결과
  await h2.request({ t: 'end' }, (m) => m.t === 'state' && m.s.phase === 'finished');
  const res = h2.state.results;
  assert.equal(res.roundsPlayed, 2);
  const totalA = r1.result.total + a2.result.total;
  assert.equal(res.players.find((p) => p.id === ps[0].id).total, totalA);
  const sumTeams = res.teams.reduce((a, t) => a + t.sum, 0);
  const sumPlayers = res.players.reduce((a, p) => a + p.total, 0);
  assert.equal(sumTeams, sumPlayers, '팀 합계 = 개인 합계');
  assert.equal(res.teams[0].rank, 1);
  assert.ok(res.winners.includes(res.teams[0].id));
  assert.equal(res.teams[0].roundScores.length, 2);
  assert.ok(res.mvp);
  assert.ok(res.bestMatch?.thumb);
  // 플레이어 화면에도 같은 결과
  const pf = await ps[3].waitState((s) => s.phase === 'finished');
  assert.deepEqual(pf.results.winners, res.winners);

  // 다시 플레이 → 같은 사람들로 대기실, 점수 초기화
  await h2.request({ t: 'restart' }, (m) => m.t === 'state' && m.s.phase === 'lobby');
  assert.ok(h2.state.players.every((p) => p.total === 0));
  assert.equal(h2.state.players.length, 4);

  for (const c of [h2, ...ps]) c.close();
});

test('메시지 폭주 제한', async () => {
  const { code } = await createRoom();
  const c = await new Client('spam').open(code);
  const from = c.msgs.length;
  for (let i = 0; i < 40; i++) c.send({ t: 'ping', c: i });
  await sleep(800);
  const limited = c.msgs.slice(from).filter((m) => m.t === 'error' && m.code === 'rate_limited');
  assert.ok(limited.length > 0, 'rate_limited 발생');
  c.close();
});
