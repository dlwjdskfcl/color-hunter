import {
  ERROR_TEXT,
  type ClientMessage,
  type ErrorCode,
  type Role,
  type RoomSnapshot,
  type ServerMessage,
  type SubmissionView,
} from '@color-hunter/shared';
import { serverUrl } from './config';

export type ConnStatus = 'connecting' | 'open' | 'reconnecting' | 'offline' | 'closed';

export interface RoomView {
  status: ConnStatus;
  role: Role | null;
  playerId: string | null;
  snapshot: RoomSnapshot | null;
  mine: SubmissionView | null;
  /** 다시 연결해도 해결되지 않는 상태 (강퇴, 토큰 만료, 방 없음) */
  fatal: ErrorCode | 'kicked' | 'not_found' | null;
  /** 최근 일시적 오류 (화면에 잠깐 표시) */
  notice: { code: ErrorCode; message: string; at: number } | null;
}

interface Pending {
  resolve: (v: SubmissionView) => void;
  reject: (e: Error & { code?: ErrorCode }) => void;
  msg: ClientMessage;
}

const HEARTBEAT_MS = 20000;

function rid(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

/**
 * 방 하나에 대한 웹소켓 연결.
 * - 끊기면 자동 재접속(지수 백오프), 온라인 복귀·화면 복귀 시 즉시 재접속
 * - 재접속하면 토큰으로 같은 플레이어/호스트로 복구
 * - 서버 시각 보정(ping/pong)으로 타이머를 서버 기준으로 표시
 * - 제출은 요청 id 로 재전송해도 한 번만 반영(서버가 중복 거절 + 기존 결과 반환)
 */
export class RoomClient {
  private ws: WebSocket | null = null;
  private listeners = new Set<() => void>();
  private retry = 0;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private hbTimer: ReturnType<typeof setInterval> | null = null;
  private stopped = false;
  private offset = 0;
  private bestRtt = Infinity;
  private pendingSubmit: (Pending & { id: string }) | null = null;
  private pendingJoin: { resolve: () => void; reject: (e: Error & { code?: ErrorCode }) => void } | null = null;
  view: RoomView = { status: 'connecting', role: null, playerId: null, snapshot: null, mine: null, fatal: null, notice: null };

  constructor(
    private code: string,
    private token: string | null,
    private onToken: (token: string | null) => void,
  ) {}

  // ----- 구독 (useSyncExternalStore) -----
  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };
  getView = () => this.view;
  private update(patch: Partial<RoomView>) {
    this.view = { ...this.view, ...patch };
    for (const fn of this.listeners) fn();
  }

  /** 서버 기준 현재 시각(ms) */
  now = () => Date.now() + this.offset;

  // ----- 연결 -----
  start() {
    this.stopped = false;
    window.addEventListener('online', this.onOnline);
    window.addEventListener('offline', this.onOffline);
    document.addEventListener('visibilitychange', this.onVisible);
    if (!navigator.onLine) this.update({ status: 'offline' });
    this.connect();
  }

  stop() {
    this.stopped = true;
    window.removeEventListener('online', this.onOnline);
    window.removeEventListener('offline', this.onOffline);
    document.removeEventListener('visibilitychange', this.onVisible);
    if (this.retryTimer) clearTimeout(this.retryTimer);
    if (this.hbTimer) clearInterval(this.hbTimer);
    const ws = this.ws;
    this.ws = null;
    ws?.close(1000, 'leave');
  }

  private onOnline = () => {
    if (this.view.status !== 'open') this.reconnectNow();
  };
  private onOffline = () => this.update({ status: 'offline' });
  private onVisible = () => {
    if (document.visibilityState === 'visible' && (!this.ws || this.ws.readyState > WebSocket.OPEN)) this.reconnectNow();
  };

  private reconnectNow() {
    if (this.stopped || this.view.fatal) return;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retry = 0;
    this.connect();
  }

  private connect() {
    if (this.stopped || this.view.fatal) return;
    if (this.ws && this.ws.readyState <= WebSocket.OPEN) return;
    const url = `${serverUrl().replace(/^http/, 'ws')}/api/rooms/${this.code}/ws`;
    let ws: WebSocket;
    try {
      ws = new WebSocket(url);
    } catch {
      this.scheduleReconnect();
      return;
    }
    this.ws = ws;
    if (this.view.status !== 'offline') this.update({ status: this.view.snapshot ? 'reconnecting' : 'connecting' });

    ws.onopen = () => {
      if (ws !== this.ws) return;
      this.retry = 0;
      if (this.token) this.send({ t: 'hello', token: this.token });
      else this.update({ status: 'open' });
      this.syncClock();
      if (this.hbTimer) clearInterval(this.hbTimer);
      this.hbTimer = setInterval(() => {
        if (this.ws?.readyState === WebSocket.OPEN) this.ws.send('{"t":"hb"}');
      }, HEARTBEAT_MS);
    };
    ws.onmessage = (e) => {
      if (ws !== this.ws) return;
      this.onMessage(JSON.parse(String(e.data)) as ServerMessage | { t: 'hb' });
    };
    ws.onclose = (e) => {
      if (ws !== this.ws) return;
      this.ws = null;
      if (this.hbTimer) clearInterval(this.hbTimer);
      if (e.code === 4001) return this.setFatal('kicked');
      if (e.code === 4004) return this.setFatal('room_closed');
      if (e.code === 4000) return this.update({ status: 'closed', notice: { code: 'bad_message', message: '다른 창에서 이 방에 접속했어요.', at: Date.now() } });
      this.scheduleReconnect();
    };
    ws.onerror = () => {
      /* onclose 에서 처리 */
    };
  }

  private scheduleReconnect() {
    if (this.stopped || this.view.fatal) return;
    if (this.view.status !== 'offline') this.update({ status: 'reconnecting' });
    const delay = Math.min(8000, 500 * 2 ** this.retry) + Math.random() * 300;
    this.retry++;
    // 방이 아예 없는 경우(서버 404)를 구분하기 위해 몇 번 실패하면 확인
    if (this.retry === 3) this.checkExists();
    this.retryTimer = setTimeout(() => this.connect(), delay);
  }

  private async checkExists() {
    try {
      const res = await fetch(`${serverUrl()}/api/rooms/${this.code}`, { cache: 'no-store' });
      if (res.status === 404) this.setFatal('not_found');
    } catch {
      /* 네트워크 문제 — 계속 재시도 */
    }
  }

  private setFatal(fatal: RoomView['fatal']) {
    if (fatal === 'kicked' || fatal === 'invalid_token' || fatal === 'not_found' || fatal === 'room_closed') {
      this.token = null;
      this.onToken(null);
    }
    this.update({ fatal, status: 'closed' });
    this.stop();
  }

  private syncClock() {
    for (let i = 0; i < 2; i++) setTimeout(() => this.send({ t: 'ping', c: Date.now() }), i * 400);
  }

  private send(msg: ClientMessage) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
      return true;
    }
    return false;
  }

  private onMessage(m: ServerMessage | { t: 'hb' }) {
    switch (m.t) {
      case 'hb':
        return;
      case 'pong': {
        const now = Date.now();
        const rtt = now - m.c;
        if (rtt >= 0 && rtt <= this.bestRtt) {
          this.bestRtt = rtt;
          this.offset = m.s + rtt / 2 - now;
        }
        return;
      }
      case 'welcome': {
        this.token = m.token;
        this.onToken(m.token);
        if (this.bestRtt === Infinity) this.offset = m.serverNow - Date.now();
        this.update({ status: 'open', role: m.role, playerId: m.playerId });
        this.pendingJoin?.resolve();
        this.pendingJoin = null;
        // 끊긴 사이 보내지 못한 제출이 있으면 같은 id 로 다시 보냄 (서버가 중복은 한 번만 반영)
        if (this.pendingSubmit) this.send(this.pendingSubmit.msg);
        return;
      }
      case 'state':
        this.update({ snapshot: m.s, mine: m.mine });
        return;
      case 'submitted':
        if (this.pendingSubmit && (m.id === this.pendingSubmit.id || m.result.round === (this.pendingSubmit.msg as { round: number }).round)) {
          this.pendingSubmit.resolve(m.result);
          this.pendingSubmit = null;
        }
        this.update({ mine: m.result });
        return;
      case 'kicked':
        this.setFatal('kicked');
        return;
      case 'error': {
        if (m.code === 'invalid_token') return this.setFatal('invalid_token');
        if (m.code === 'room_closed') return this.setFatal('room_closed');
        if (this.pendingJoin && ['already_started', 'room_full', 'nickname_invalid', 'nickname_taken', 'rate_limited', 'bad_message'].includes(m.code)) {
          const err = Object.assign(new Error(m.message), { code: m.code });
          this.pendingJoin.reject(err);
          this.pendingJoin = null;
          return;
        }
        if (this.pendingSubmit && m.ref === this.pendingSubmit.id) {
          if (m.code === 'duplicate') return; // 'submitted' 로 기존 결과가 따로 옴
          const err = Object.assign(new Error(m.message), { code: m.code });
          this.pendingSubmit.reject(err);
          this.pendingSubmit = null;
          return;
        }
        this.update({ notice: { code: m.code, message: m.message, at: Date.now() } });
        return;
      }
    }
  }

  // ----- 동작 -----

  join(nickname: string): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.send({ t: 'join', nickname })) {
        reject(Object.assign(new Error('서버에 연결 중이에요. 잠시 후 다시 시도해 주세요.'), { code: 'bad_message' as ErrorCode }));
        return;
      }
      this.pendingJoin = { resolve, reject };
    });
  }

  submit(round: number, pixels: string): Promise<SubmissionView> {
    return new Promise((resolve, reject) => {
      const id = rid();
      const msg: ClientMessage = { t: 'submit', round, pixels, id };
      this.pendingSubmit = { id, msg, resolve, reject };
      this.send(msg); // 연결이 없으면 재접속 직후 다시 보냄
    });
  }

  /** 호스트/플레이어 일반 명령 */
  command(msg: ClientMessage): boolean {
    const ok = this.send(msg);
    if (!ok) this.update({ notice: { code: 'bad_message', message: '연결이 끊겨 있어요. 다시 연결되면 시도해 주세요.', at: Date.now() } });
    return ok;
  }

  leave() {
    this.send({ t: 'leave' });
    this.token = null;
    this.onToken(null);
    this.stop();
  }
}

export function errorText(code: string): string {
  if (code === 'kicked') return '호스트가 방에서 내보냈어요.';
  if (code === 'not_found') return '방을 찾을 수 없어요. 코드를 다시 확인해 주세요.';
  return ERROR_TEXT[code as ErrorCode] ?? '알 수 없는 오류가 발생했어요.';
}
