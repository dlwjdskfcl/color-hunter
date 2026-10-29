// 서버 재시작(DO 메모리 초기화) 후 저장소에서 방 상태가 복구되는지 확인
// 사용: node tests/restart-check.mjs setup  → 서버 재시작 →  node tests/restart-check.mjs verify
import { readFileSync, writeFileSync } from 'node:fs';
const BASE = 'http://127.0.0.1:8787', WS = BASE.replace('http', 'ws');
const FILE = new URL('./artifacts/restart.json', import.meta.url);
const open = (code) => new Promise((res, rej) => { const ws = new WebSocket(`${WS}/api/rooms/${code}/ws`); ws.onopen = () => res(ws); ws.onerror = rej; });
const until = (ws, pred) => new Promise((res, rej) => { const t = setTimeout(() => rej(new Error('timeout')), 8000); ws.addEventListener('message', (e) => { const m = JSON.parse(e.data); if (pred(m)) { clearTimeout(t); res(m); } }); });
const px = (hex) => { const n = parseInt(hex.slice(1), 16); const b = Buffer.alloc(3072); for (let i = 0; i < 1024; i++) b.set([(n >> 16) & 255, (n >> 8) & 255, n & 255], i * 3); return b.toString('base64'); };

if (process.argv[2] === 'setup') {
  const { code, hostToken } = await (await fetch(`${BASE}/api/rooms`, { method: 'POST' })).json();
  const h = await open(code); h.send(JSON.stringify({ t: 'hello', token: hostToken })); await until(h, (m) => m.t === 'welcome');
  h.send(JSON.stringify({ t: 'settings', settings: { roundSeconds: 60 } }));
  const ps = [];
  for (const n of ['P1', 'P2']) { const w = await open(code); w.send(JSON.stringify({ t: 'join', nickname: n })); const m = await until(w, (m) => m.t === 'welcome'); ps.push({ w, token: m.token }); }
  h.send(JSON.stringify({ t: 'start' }));
  const s = (await until(ps[0].w, (m) => m.t === 'state' && m.s.phase === 'hunting')).s;
  ps[0].w.send(JSON.stringify({ t: 'submit', round: 0, pixels: px(s.round.target.hex), id: 'x' }));
  const r = await until(ps[0].w, (m) => m.t === 'submitted');
  writeFileSync(FILE, JSON.stringify({ code, hostToken, tokens: ps.map((p) => p.token), score: r.result.total, endsAt: s.round.endsAt, target: s.round.target.id }));
  console.log('setup ok', code, 'score', r.result.total); process.exit(0);
} else {
  const d = JSON.parse(readFileSync(FILE, 'utf8'));
  const h = await open(d.code); h.send(JSON.stringify({ t: 'hello', token: d.hostToken }));
  const w = await until(h, (m) => m.t === 'welcome' || m.t === 'error');
  const s = (await until(h, (m) => m.t === 'state')).s;
  const p = await open(d.code); p.send(JSON.stringify({ t: 'hello', token: d.tokens[0] }));
  const st = await until(p, (m) => m.t === 'state');
  const ok = w.t === 'welcome' && w.role === 'host' && s.phase === 'hunting' && s.round.target.id === d.target && s.round.endsAt === d.endsAt && st.mine?.total === d.score && s.players.length === 2;
  console.log(ok ? '✔ 재시작 후 호스트·플레이어·라운드·제출 점수 복구' : '✖ 복구 실패', JSON.stringify({ phase: s.phase, players: s.players.length, mine: st.mine?.total }));
  process.exit(ok ? 0 : 1);
}
