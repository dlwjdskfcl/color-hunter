import { deltaE76, labToRgb, rgbToHex, rgbToLab, type Lab, type RGB } from './color';

/** 분석 영역을 줄여서 보내는 샘플 크기 (32×32 RGB = 3072바이트). 브라우저와 서버가 같은 값을 씀. */
export const SAMPLE_SIZE = 32;
export const SAMPLE_BYTES = SAMPLE_SIZE * SAMPLE_SIZE * 3;

export interface ExtractedColor {
  lab: Lab;
  rgb: RGB;
  hex: string;
  /** 0~1. 영역 안에서 대표색 근처에 모인 픽셀 비율 (낮으면 여러 색이 섞인 것) */
  uniformity: number;
}

function median(values: number[]): number {
  const s = [...values].sort((x, y) => x - y);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/**
 * 분석 영역 픽셀에서 대표색을 뽑는다.
 * 1) 하이라이트(반사로 하얗게 날아간 픽셀)와 거의 검은 노이즈를 제외 — 남는 게 너무 적으면 전부 사용
 * 2) Lab 각 채널의 중앙값을 기준점으로 잡고, 기준점에서 가까운 픽셀만 평균 (그림자·가장자리 다른 물체 영향 감소)
 * channels: 3(RGB) 또는 4(RGBA, canvas ImageData)
 */
export function extractRepresentativeColor(pixels: ArrayLike<number>, channels: 3 | 4 = 3): ExtractedColor {
  const count = Math.floor(pixels.length / channels);
  if (count === 0) throw new Error('empty pixels');
  const labs: Lab[] = new Array(count);
  for (let i = 0; i < count; i++) {
    const o = i * channels;
    labs[i] = rgbToLab([pixels[o], pixels[o + 1], pixels[o + 2]]);
  }

  let pool = labs.filter(([L, a, b]) => {
    const c = Math.hypot(a, b);
    const specular = L > 97 && c < 6;
    const crushed = L < 2;
    return !specular && !crushed;
  });
  if (pool.length < count * 0.2) pool = labs;

  const center: Lab = [median(pool.map((l) => l[0])), median(pool.map((l) => l[1])), median(pool.map((l) => l[2]))];
  const dist = pool.map((l) => deltaE76(l, center));
  let threshold = 14;
  let kept = pool.filter((_, i) => dist[i] <= threshold);
  if (kept.length < pool.length * 0.3) {
    // 색이 넓게 퍼져 있으면 중앙값에 가까운 절반을 사용
    threshold = median(dist);
    kept = pool.filter((_, i) => dist[i] <= threshold);
  }

  const sum = kept.reduce<Lab>((acc, l) => [acc[0] + l[0], acc[1] + l[1], acc[2] + l[2]], [0, 0, 0]);
  const lab: Lab = [sum[0] / kept.length, sum[1] / kept.length, sum[2] / kept.length];
  const rgb = labToRgb(lab).map((v) => Math.round(v)) as RGB;
  const close = labs.filter((l) => deltaE76(l, lab) <= 14).length;
  return { lab, rgb, hex: rgbToHex(rgb), uniformity: close / count };
}

/** base64 ↔ 바이트 (브라우저·Workers·Node 공통: atob/btoa 사용) */
export function bytesToBase64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(s);
}

export function base64ToBytes(b64: string): Uint8Array {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

/** RGBA(ImageData) → RGB 바이트 */
export function rgbaToRgb(rgba: ArrayLike<number>): Uint8Array {
  const n = Math.floor(rgba.length / 4);
  const out = new Uint8Array(n * 3);
  for (let i = 0; i < n; i++) {
    out[i * 3] = rgba[i * 4];
    out[i * 3 + 1] = rgba[i * 4 + 1];
    out[i * 3 + 2] = rgba[i * 4 + 2];
  }
  return out;
}
