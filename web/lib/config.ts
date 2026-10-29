export const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH || '';

/** 게임 서버 주소. 설정이 없으면 지금 연 주소의 호스트:8787 (로컬 개발) */
export function serverUrl(): string {
  const env = process.env.NEXT_PUBLIC_SERVER_URL;
  if (env) return env.replace(/\/$/, '');
  if (typeof window === 'undefined') return '';
  return `${location.protocol}//${location.hostname}:8787`;
}

/** QR·참가 링크에 넣을 공개 주소. 설정이 없으면 현재 주소(배포 주소에서 열면 그대로 맞음) */
export function siteUrl(): string {
  const env = process.env.NEXT_PUBLIC_SITE_URL;
  if (env) return env.replace(/\/$/, '');
  if (typeof window === 'undefined') return '';
  return `${location.origin}${BASE_PATH}`;
}

export function joinUrl(code: string): string {
  return `${siteUrl()}/play/?code=${code}`;
}

/** 휴대폰에서 열 수 없는 주소인지 (localhost 등) */
export function isLoopbackUrl(url: string): boolean {
  try {
    const h = new URL(url).hostname;
    return h === 'localhost' || h === '127.0.0.1' || h === '[::1]' || h.endsWith('.localhost');
  } catch {
    return true;
  }
}

export function path(p: string): string {
  return `${BASE_PATH}${p}`;
}
