// 실제 브라우저(Edge/Chromium) E2E: 호스트 1 + 플레이어 4 (모바일 화면)
// - 가짜 카메라: 기본색 16칸 격자 영상(y4m). 플레이어는 촬영 후 분석 영역을 목표색 칸으로 옮겨 제출
// - 카메라 권한 거부 기기 1대: 거부 안내 확인 후 "사진 찍기(파일)" 대체 경로로 제출
// 준비: (1) npm run dev:server  (2) npm run build   실행: npm run test:e2e
import { chromium } from 'playwright-core';
import { mkdirSync, writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { startStaticServer } from './static-server.mjs';

const ART = fileURLToPath(new URL('./artifacts/', import.meta.url));
mkdirSync(ART, { recursive: true });
const WEB = `http://127.0.0.1:3100${process.env.BASE_PATH ?? ''}`;
const CHANNEL = process.env.BROWSER_CHANNEL ?? 'msedge';

// 쉬움 난이도 13색 + 3색
const GRID = ['#D7262E', '#F2791C', '#F7D117', '#8CC63F', '#1E9A4B', '#0E9C9A', '#1F5FC8', '#7440B0', '#F27BAA', '#7B4B2A', '#8E8E8E', '#1C1C1E', '#F2F2EE', '#62B5EA', '#22306B', '#86D9BE'];
const COLS = 4;
const ROWS = 4;
const W = 640;
const H = 480;

const rgbOf = (hex) => {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};

function makeGridY4m(path) {
  const Y = Buffer.alloc(W * H);
  const U = Buffer.alloc((W / 2) * (H / 2));
  const V = Buffer.alloc((W / 2) * (H / 2));
  const yuv = ([r, g, b]) => {
    const R = r / 255, G = g / 255, B = b / 255;
    return [16 + 65.481 * R + 128.553 * G + 24.966 * B, 128 - 37.797 * R - 74.203 * G + 112 * B, 128 + 112 * R - 93.786 * G - 18.214 * B].map((v) => Math.round(Math.max(0, Math.min(255, v))));
  };
  const at = (x, y) => GRID[Math.floor(y / (H / ROWS)) * COLS + Math.floor(x / (W / COLS))];
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) Y[y * W + x] = yuv(rgbOf(at(x, y)))[0];
  for (let y = 0; y < H / 2; y++)
    for (let x = 0; x < W / 2; x++) {
      const [, u, v] = yuv(rgbOf(at(x * 2, y * 2)));
      U[y * (W / 2) + x] = u;
      V[y * (W / 2) + x] = v;
    }
  const frame = Buffer.concat([Buffer.from('FRAME\n'), Y, U, V]);
  writeFileSync(path, Buffer.concat([Buffer.from(`YUV4MPEG2 W${W} H${H} F15:1 Ip A1:1 C420jpeg\n`), frame, frame]));
}

function solidPng(hex, size = 64) {
  const [r, g, b] = rgbOf(hex);
  const raw = Buffer.alloc((size * 3 + 1) * size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) raw.set([r, g, b], y * (size * 3 + 1) + 1 + x * 3);
  const table = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (buf) => {
    let c = 0xffffffff;
    for (const x of buf) c = table[(c ^ x) & 255] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const c = Buffer.alloc(4);
    c.writeUInt32BE(crc(td));
    return Buffer.concat([len, td, c]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok, detail });
  console.log(`${ok ? '✔' : '✖'} ${name}${detail ? ` — ${detail}` : ''}`);
}

async function shot(page, name) {
  await page.screenshot({ path: `${ART}${name}.png`, fullPage: false });
}

async function targetHex(page) {
  // 사냥 화면 상단의 목표 색 견본
  const bg = await page.locator('main div[aria-hidden].size-16').first().evaluate((el) => getComputedStyle(el).backgroundColor);
  const [r, g, b] = bg.match(/\d+/g).map(Number);
  return [r, g, b];
}

function nearestTile(rgb) {
  let best = 0;
  let bestD = Infinity;
  GRID.forEach((hex, i) => {
    const c = rgbOf(hex);
    const d = (c[0] - rgb[0]) ** 2 + (c[1] - rgb[1]) ** 2 + (c[2] - rgb[2]) ** 2;
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  });
  return best;
}

async function setRange(locator, value) {
  await locator.evaluate((el, v) => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    setter.call(el, v);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }, String(value));
}

/** 카메라로 찍고 목표색 칸을 골라 제출 → 받은 점수 */
async function huntWithCamera(page, label) {
  await page.getByText('이 색을 찾아라!').waitFor({ timeout: 15000 });
  const target = await targetHex(page);
  const shutter = page.getByRole('button', { name: '촬영' });
  await shutter.waitFor();
  await page.waitForFunction(() => !document.querySelector('button[aria-label="촬영"]')?.disabled, null, { timeout: 15000 });
  await page.waitForTimeout(400);
  await shutter.click();
  const img = page.locator('img[alt="촬영한 사진"]');
  await img.waitFor();
  await setRange(page.getByLabel('분석 영역 크기'), 0.16);
  const tile = nearestTile(target);
  const box = await img.boundingBox();
  const cx = box.x + box.width * (((tile % COLS) + 0.5) / COLS);
  const cy = box.y + box.height * ((Math.floor(tile / COLS) + 0.5) / ROWS);
  await page.mouse.click(cx, cy);
  await page.waitForTimeout(250);
  const expected = await page.getByText(/^예상 \d+점/).textContent();
  await shot(page, `${label}-review`);
  await page.getByRole('button', { name: '이 색으로 제출' }).click();
  await page.getByText('제출 완료!').waitFor({ timeout: 8000 });
  const total = Number((await page.locator('text=/^\\+\\d+$/').first().textContent()).slice(1));
  return { target, tile: GRID[tile], expected, total };
}

async function main() {
  const y4m = `${ART}grid.y4m`;
  makeGridY4m(y4m);
  const health = await fetch('http://127.0.0.1:8787/api/health').then((r) => r.ok).catch(() => false);
  if (!health) throw new Error('게임 서버가 꺼져 있어요: npm run dev:server');
  const server = await startStaticServer(3100);

  const browser = await chromium.launch({
    channel: CHANNEL,
    headless: process.env.HEADED ? false : true,
    args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', `--use-file-for-fake-video-capture=${y4m}`, '--autoplay-policy=no-user-gesture-required'],
  });
  // 카메라 권한을 거부하는 기기
  const denyBrowser = await chromium.launch({ channel: CHANNEL, headless: true, args: ['--use-fake-device-for-media-stream', '--deny-permission-prompts'] });

  const mobile = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'ko-KR' };
  const hostCtx = await browser.newContext({ viewport: { width: 1280, height: 860 }, locale: 'ko-KR' });
  const host = await hostCtx.newPage();
  const errors = [];
  host.on('pageerror', (e) => errors.push(`host: ${e.message}`));

  try {
    // 1. 방 만들기 + QR
    await host.goto(`${WEB}/`);
    await shot(host, '01-home');
    await host.getByRole('button', { name: /방 만들기/ }).click();
    await host.waitForURL(/\/host\/\?code=/);
    const code = new URL(host.url()).searchParams.get('code');
    await host.getByText('방 코드').first().waitFor();
    const qr = host.locator('img[alt^="참가 QR 코드"]');
    await qr.waitFor();
    const qrAlt = await qr.getAttribute('alt');
    check('방 생성 + QR 코드 표시', /^[A-Z2-9]{6}$/.test(code) && qrAlt.includes(`/play/?code=${code}`), qrAlt);
    await host.getByRole('radio', { name: '쉬움' }).click();
    await host.waitForTimeout(400);

    // 2. 플레이어 입장 (QR 링크와 같은 주소)
    const names = ['토끼', '여우', '곰돌이'];
    const players = [];
    for (const n of names) {
      const ctx = await browser.newContext(mobile);
      const page = await ctx.newPage();
      page.on('pageerror', (e) => errors.push(`${n}: ${e.message}`));
      await page.goto(`${WEB}/play/?code=${code}`);
      await page.getByLabel('닉네임을 정해 주세요').fill(n);
      await page.getByRole('button', { name: '입장하기' }).click();
      await page.getByText(/팀$/).first().waitFor();
      players.push({ name: n, ctx, page });
    }
    await shot(players[0].page, '02-player-lobby');

    // 중복 닉네임
    const dupCtx = await browser.newContext(mobile);
    const dup = await dupCtx.newPage();
    await dup.goto(`${WEB}/play/?code=${code}`);
    await dup.getByLabel('닉네임을 정해 주세요').fill('여우');
    await dup.getByRole('button', { name: '입장하기' }).click();
    const dupErr = await dup.getByText('이미 사용 중인 닉네임이에요.').waitFor({ timeout: 5000 }).then(() => true).catch(() => false);
    check('중복 닉네임 거절', dupErr);
    await dupCtx.close();

    // 카메라 거부 기기
    const denyCtx = await denyBrowser.newContext(mobile);
    const deny = await denyCtx.newPage();
    deny.on('pageerror', (e) => errors.push(`deny: ${e.message}`));
    await deny.goto(`${WEB}/play/?code=${code}`);
    await deny.getByLabel('닉네임을 정해 주세요').fill('카메라없음');
    await deny.getByRole('button', { name: '입장하기' }).click();
    await deny.getByText(/팀$/).first().waitFor();

    // 3. 호스트: 참가자 4명, 팀 자동 배정
    await host.getByText('참가자 4/30').waitFor();
    await host.getByRole('button', { name: /자동 균등 배정/ }).click();
    await host.waitForTimeout(500);
    await shot(host, '03-host-lobby');
    check('호스트 대기실에 4명 표시', true);

    // 수동 팀 이동: 첫 플레이어 칩 → 다른 팀으로
    await host.getByRole('button', { name: /토끼/ }).click();
    const moveBtn = host.locator('text=이동:').locator('..').getByRole('button').first();
    const moveTo = await moveBtn.textContent();
    await moveBtn.click();
    const moved = await players[0].page.getByText(`${moveTo}팀`).waitFor({ timeout: 5000 }).then(() => true).catch(() => false);
    check('수동 팀 변경이 플레이어 화면에 반영', moved, moveTo);

    // 4. 게임 시작 → 라운드 동기화
    await host.getByRole('button', { name: /게임 시작/ }).click();
    await players[0].page.getByText('곧 목표 색이 공개돼요!').waitFor({ timeout: 5000 });
    await shot(players[0].page, '04-countdown');
    await host.getByText('이 색을 찾아 찍어라!').waitFor({ timeout: 8000 });
    const hostTarget = await host.locator('.font-display.text-6xl').first().textContent();
    const playerTargets = await Promise.all(players.map((p) => p.page.locator('.font-display.text-3xl').first().textContent()));
    check('모든 기기에 같은 목표 색', playerTargets.every((t) => t === hostTarget), `${hostTarget} / ${playerTargets.join(',')}`);
    await shot(players[0].page, '05-hunting-camera');

    // 카메라 거부 안내 → 파일(기본 카메라 앱) 대체 경로
    const denied = await deny.getByText('카메라 권한이 거부됐어요').waitFor({ timeout: 8000 }).then(() => true).catch(() => false);
    await shot(deny, '06-camera-denied');
    check('카메라 권한 거부 안내', denied);

    // 5. 촬영 → 분석 영역 이동 → 제출
    const r0 = await huntWithCamera(players[0].page, '07-p1');
    check('카메라 촬영·분석·제출 (토끼)', r0.total >= 60, `목표 rgb(${r0.target}) 칸 ${r0.tile}, ${r0.expected} → 서버 ${r0.total}점`);
    await shot(players[0].page, '08-submitted');
    // 호스트 점수판 실시간 반영
    const hostSaw = await host.getByText('토끼 ✓').waitFor({ timeout: 5000 }).then(() => true).catch(() => false);
    check('호스트 화면에 제출 상태 실시간 반영', hostSaw);

    // 플레이어 새로고침 → 제출 상태 복구
    await players[0].page.reload();
    const restored = await players[0].page.getByText('제출 완료!').waitFor({ timeout: 8000 }).then(() => true).catch(() => false);
    check('플레이어 새로고침 후 상태 복구', restored);

    const r1 = await huntWithCamera(players[1].page, '09-p2');
    check('카메라 촬영·분석·제출 (여우)', r1.total >= 60, `${r1.expected} → ${r1.total}점`);
    const r2 = await huntWithCamera(players[2].page, '10-p3');
    check('카메라 촬영·분석·제출 (곰돌이)', r2.total >= 60, `${r2.expected} → ${r2.total}점`);

    // 거부 기기: 파일로 목표색 사진 제출
    const hex = '#' + (await targetHex(deny)).map((v) => v.toString(16).padStart(2, '0')).join('');
    const pngPath = `${ART}target.png`;
    writeFileSync(pngPath, solidPng(hex));
    await deny.locator('input[type=file]').setInputFiles(pngPath);
    await deny.locator('img[alt="촬영한 사진"]').waitFor();
    await deny.getByRole('button', { name: '이 색으로 제출' }).click();
    const fileOk = await deny.getByText(/제출 완료!|내 점수/).first().waitFor({ timeout: 8000 }).then(() => true).catch(() => false);
    check('카메라 없이 사진 파일로 제출(대체 경로)', fileOk);

    // 6. 전원 제출 → 라운드 결과
    const reveal = await host.getByText('라운드 1 결과').waitFor({ timeout: 8000 }).then(() => true).catch(() => false);
    check('전원 제출 시 라운드 조기 종료 → 결과', reveal);
    await shot(host, '11-host-reveal');
    await shot(players[1].page, '12-player-reveal');

    // 호스트 새로고침 → 권한·상태 유지
    await host.reload();
    const hostBack = await host.getByText(/라운드 1 결과|곧 목표 색이 공개돼요|이 색을 찾아 찍어라/).first().waitFor({ timeout: 10000 }).then(() => true).catch(() => false);
    check('호스트 새로고침 후 권한·진행 상태 유지', hostBack);

    // 7. 다음 라운드로 넘기고 일시정지/재개, 게임 종료
    if (await host.getByRole('button', { name: '다음 ⏭' }).isVisible().catch(() => false)) await host.getByRole('button', { name: '다음 ⏭' }).click();
    await host.getByText('이 색을 찾아 찍어라!').waitFor({ timeout: 10000 });
    await host.getByRole('button', { name: /일시정지/ }).click();
    const pausedP = await players[1].page.getByText('호스트가 게임을 잠시 멈췄어요').waitFor({ timeout: 5000 }).then(() => true).catch(() => false);
    check('일시정지가 플레이어에게 반영', pausedP);
    await host.getByRole('button', { name: /재개/ }).click();
    const r3 = await huntWithCamera(players[1].page, '13-p2-r2');
    check('2라운드 제출', r3.total > 0, `${r3.total}점`);
    host.once('dialog', (d) => d.accept());
    await host.getByRole('button', { name: '게임 종료' }).click();
    await host.getByText(/우승!/).waitFor({ timeout: 8000 });
    await shot(host, '14-host-results');
    const pWin = await players[2].page.getByText(/우승!/).waitFor({ timeout: 8000 }).then(() => true).catch(() => false);
    await players[2].page.screenshot({ path: `${ART}15-player-results.png`, fullPage: true });
    check('최종 결과(우승팀·순위) 호스트·플레이어 모두 표시', pWin);

    // 8. 다시 플레이
    await host.getByRole('button', { name: '다시 플레이' }).click();
    const back = await players[0].page.getByText('게임 시작을 기다리는 중…').waitFor({ timeout: 8000 }).then(() => true).catch(() => false);
    check('다시 플레이 → 같은 참가자로 대기실', back);

    check('브라우저 스크립트 오류 없음', errors.length === 0, errors.join(' | '));
  } finally {
    await browser.close();
    await denyBrowser.close();
    server.close();
  }
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} 통과`);
  process.exit(failed.length ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
