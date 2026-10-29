import type { NextConfig } from 'next';

// 정적 사이트로 빌드(out/) → Vercel, GitHub Pages, Cloudflare 어디든 올릴 수 있음.
// 기존 웹앱 하위 경로(예: /jammanbo/color-hunter)에 넣을 땐 NEXT_PUBLIC_BASE_PATH 로 지정.
const basePath = process.env.NEXT_PUBLIC_BASE_PATH || '';

const config: NextConfig = {
  output: 'export',
  trailingSlash: true,
  basePath: basePath || undefined,
  images: { unoptimized: true },
  transpilePackages: ['@color-hunter/shared'],
  reactStrictMode: true,
};

export default config;
