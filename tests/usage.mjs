// 한 판의 Cloudflare 사용량 측정: N명 · R라운드를 실제 서버에서 끝까지 진행
// 서버: server/.dev.vars 에 EXPOSE_METRICS=1   실행: node tests/usage.mjs [인원=30] [라운드=10]
const BASE = process.env.SERVER_URL ?? 'http://127.0.0.1:8787';
const WS = BASE.replace(/^http/, 'ws');
const N = Number(process.argv[2] ?? 30);
const R = Number(process.argv[3] ?? 10);
let sent = 0;

function client(code) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`${WS}/api/rooms/${code}/ws`);
    const c = { ws, state: null, waiters: [], send: (m) => { sent++; ws.send(JSON.stringify(m)); } };
    c.until = (pred, ms = 20000) =>
      new Promise((res, rej) => {
        if (c.state && pred({ t: 'state', s: c.state })) return res(c.state);
        const t = setTimeout(() => rej(new Error('timeout')), ms);
        c.waiters.push((m) => { if (pred(m)) { clearTimeout(t); res(m.s ?? m); return true; } });
      });
    ws.onmessage = (e) => {
      const m = JSON.parse(e.data);
      if (m.t === 'state') c.state = m.s;
      c.waiters = c.waiters.filter((w) => !w(m));
    };
    ws.onopen = () => resolve(c);
    ws.onerror = reject;
  });
}
const px = (hex) => {
  const n = parseInt(hex.slice(1), 16);
  const b = Buffer.alloc(3072);
  for (let i = 0; i < 1024; i++) b.set([(n >> 16) & 255, (n >> 8) & 255, n & 255], i * 3);
  return b.toString('base64');
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const { code, hostToken } = await (await fetch(`${BASE}/api/rooms`, { method: 'POST' })).json();
const host = await client(code);
host.send({ t: 'hello', token: hostToken });
await host.until((m) => m.t === 'welcome');
host.send({ t: 'settings', settings: { rounds: R, roundSeconds: 30, teamCount: 4 } });
const players = [];
for (let i = 0; i < N; i++) {
  const p = await client(code);
  p.send({ t: 'join', nickname: `P${i}` });
  await p.until((m) => m.t === 'welcome');
  p.send({ t: 'ping', c: Date.now() }); // 실제 앱처럼 시간 보정
  p.send({ t: 'ping', c: Date.now() });
  players.push(p);
  await sleep(150); // 사람이 한 명씩 들어오는 간격
}
host.send({ t: 'start' });
for (let r = 0; r < R; r++) {
  const s = await host.until((m) => m.t === 'state' && m.s.phase === 'hunting' && m.s.round.index === r);
  for (const [i, p] of players.entries()) {
    await sleep(60 + (i % 5) * 40); // 제출 시각을 흩어 놓음
    p.send({ t: 'submit', round: r, pixels: px(i % 3 ? s.round.target.hex : '#808080'), id: `r${r}p${i}` });
  }
  await host.until((m) => m.t === 'state' && m.s.phase === 'reveal' && m.s.round.index === r);
  host.send({ t: 'skip' }); // 결과 화면 8초 대기 생략 (쓰기 횟수엔 영향 없음)
}
await host.until((m) => m.t === 'state' && m.s.phase === 'finished');
await sleep(2500); // 지연 저장까지 반영
const info = await (await fetch(`${BASE}/api/rooms/${code}`)).json();
console.log(JSON.stringify({ players: N, rounds: R, clientMessages: sent, doRequestsApprox: Math.ceil(sent / 20) + N + 1, storageRowsWritten: info.writes }));
process.exit(0);
