import { CODE_ALPHABET, CODE_LENGTH, CODE_PATTERN } from '@color-hunter/shared';
import type { Room } from './room';

export { Room } from './room';

export interface Env {
  ROOM: DurableObjectNamespace<Room>;
  /** 방 코드 검증 문자 서명용 비밀 값 (wrangler secret) */
  ROOM_CODE_SECRET?: string;
  /** 허용할 웹 주소 목록 (쉼표 구분). "*" 은 모두 허용(개발용) */
  ALLOWED_ORIGINS?: string;
  /** IP 하나가 10분 동안 만들 수 있는 방 수 (기본 10) */
  ROOM_CREATE_LIMIT?: string;
  /** "1" 이면 방 조회에 저장소 쓰기 횟수 포함 (로컬 측정용) */
  EXPOSE_METRICS?: string;
}

// ---------- 방 코드 ----------
// 앞 5자리는 무작위, 마지막 1자리는 서버 비밀 값으로 만든 검증 문자.
// 아무 코드나 넣어 보는 추측 요청은 DO 를 깨우기 전에 Worker 에서 걸러짐 (31배 어려워짐 + 비용 절감).

async function checkChar(body: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body)));
  return CODE_ALPHABET[sig[0] % CODE_ALPHABET.length];
}

async function newRoomCode(secret: string): Promise<string> {
  const rnd = crypto.getRandomValues(new Uint8Array(CODE_LENGTH - 1));
  // 31 로 나눈 나머지의 치우침은 256/31 수준이라 게임 코드엔 충분
  const body = Array.from(rnd, (b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join('');
  return body + (await checkChar(body, secret));
}

async function isValidCode(code: string, secret: string): Promise<boolean> {
  if (!CODE_PATTERN.test(code)) return false;
  return (await checkChar(code.slice(0, -1), secret)) === code.slice(-1);
}

// ---------- 요청 제한 (isolate 단위, 최선의 노력) ----------

const createLog = new Map<string, number[]>();
const CREATE_WINDOW_MS = 10 * 60 * 1000;
const DEFAULT_CREATE_MAX = 10;

function allowCreate(ip: string, max: number): boolean {
  const now = Date.now();
  const list = (createLog.get(ip) ?? []).filter((t) => now - t < CREATE_WINDOW_MS);
  if (list.length >= max) return false;
  list.push(now);
  createLog.set(ip, list);
  if (createLog.size > 5000) createLog.clear();
  return true;
}

// ---------- HTTP ----------

function originAllowed(origin: string | null, env: Env): boolean {
  const list = (env.ALLOWED_ORIGINS ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  if (list.includes('*')) return true;
  return !!origin && list.includes(origin);
}

function cors(origin: string | null, env: Env): Record<string, string> {
  if (!origin || !originAllowed(origin, env)) return {};
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}

function json(data: unknown, status: number, headers: Record<string, string>): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers },
  });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const origin = request.headers.get('Origin');
    const h = cors(origin, env);

    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: h });
    if (url.pathname === '/api/health') return json({ ok: true, now: Date.now() }, 200, h);

    const secret = env.ROOM_CODE_SECRET;
    if (!secret) return json({ error: 'server_not_configured' }, 500, h);

    // 방 만들기
    if (url.pathname === '/api/rooms' && request.method === 'POST') {
      if (!originAllowed(origin, env)) return json({ error: 'forbidden_origin' }, 403, h);
      const ip = request.headers.get('CF-Connecting-IP') ?? 'local';
      if (!allowCreate(ip, Number(env.ROOM_CREATE_LIMIT) || DEFAULT_CREATE_MAX)) return json({ error: 'rate_limited' }, 429, h);
      for (let attempt = 0; attempt < 5; attempt++) {
        const code = await newRoomCode(secret);
        const stub = env.ROOM.get(env.ROOM.idFromName(code));
        const res = await stub.init(code);
        if (res.ok) return json({ code, hostToken: res.hostToken }, 201, h);
      }
      return json({ error: 'try_again' }, 503, h);
    }

    const m = url.pathname.match(/^\/api\/rooms\/([A-Za-z0-9]{1,12})(\/ws)?$/);
    if (m) {
      const code = m[1].toUpperCase();
      if (!(await isValidCode(code, secret))) return json({ error: 'not_found' }, 404, h);
      const stub = env.ROOM.get(env.ROOM.idFromName(code));
      if (m[2]) {
        if (request.headers.get('Upgrade') !== 'websocket') return json({ error: 'expected_websocket' }, 426, h);
        if (!originAllowed(origin, env)) return json({ error: 'forbidden_origin' }, 403, h);
        return stub.fetch(request);
      }
      if (request.method === 'GET') {
        const info = await stub.info();
        return json(info, info.exists ? 200 : 404, h);
      }
    }
    return json({ error: 'not_found' }, 404, h);
  },
} satisfies ExportedHandler<Env>;
