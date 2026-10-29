import { hexToRgb } from '@color-hunter/shared';

/** 배경색 위에 읽기 좋은 글자색 (WCAG 상대 휘도 기준) */
export function readableOn(hex: string): string {
  const [r, g, b] = hexToRgb(hex).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  const L = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return L > 0.36 ? '#1B1433' : '#FFFFFF';
}

export function formatSeconds(ms: number): string {
  return String(Math.ceil(ms / 1000));
}
