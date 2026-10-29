// web/out (정적 빌드)을 그대로 서빙하는 작은 서버 — E2E 테스트용
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../web/out/', import.meta.url));
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain',
};

export function startStaticServer(port = 3100) {
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x');
    // GitHub Pages 처럼 하위 경로(BASE_PATH)에 올린 상황 재현
    const base = process.env.BASE_PATH ?? '';
    if (base && !url.pathname.startsWith(base)) {
      res.writeHead(404).end();
      return;
    }
    let p = normalize(join(ROOT, decodeURIComponent(url.pathname.slice(base.length) || '/')));
    if (!p.startsWith(normalize(ROOT))) {
      res.writeHead(403).end();
      return;
    }
    try {
      if ((await stat(p)).isDirectory()) p = join(p, 'index.html');
    } catch {
      /* 없음 */
    }
    try {
      const body = await readFile(p);
      res.writeHead(200, { 'Content-Type': TYPES[extname(p)] ?? 'application/octet-stream' });
      res.end(body);
    } catch {
      const nf = await readFile(join(ROOT, '404.html')).catch(() => 'not found');
      res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' }).end(nf);
    }
  });
  return new Promise((resolve) => server.listen(port, '127.0.0.1', () => resolve(server)));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === normalize(process.argv[1])) {
  const port = Number(process.argv[2] ?? 3100);
  await startStaticServer(port);
  console.log(`serving web/out on http://127.0.0.1:${port}`);
}
