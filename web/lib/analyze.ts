import {
  SAMPLE_SIZE,
  bytesToBase64,
  extractRepresentativeColor,
  rgbaToRgb,
  type ExtractedColor,
} from '@color-hunter/shared';

/** 분석 영역: 이미지 기준 정규화 좌표. 중심(cx, cy ∈ 0~1), 한 변 = size × min(가로, 세로) */
export interface Region {
  cx: number;
  cy: number;
  size: number;
}

export const DEFAULT_REGION: Region = { cx: 0.5, cy: 0.5, size: 0.3 };

let work: HTMLCanvasElement | null = null;
let small: HTMLCanvasElement | null = null;

function canvas(w: number, h: number, which: 'work' | 'small'): CanvasRenderingContext2D {
  let c = which === 'work' ? work : small;
  if (!c) {
    c = document.createElement('canvas');
    if (which === 'work') work = c;
    else small = c;
  }
  c.width = w;
  c.height = h;
  return c.getContext('2d', { willReadFrequently: true })!;
}

export function regionRect(region: Region, w: number, h: number) {
  const side = Math.max(4, Math.round(region.size * Math.min(w, h)));
  const x = Math.round(Math.min(Math.max(region.cx * w - side / 2, 0), w - side));
  const y = Math.round(Math.min(Math.max(region.cy * h - side / 2, 0), h - side));
  return { x, y, side };
}

/**
 * 원본(캔버스·비디오)의 분석 영역을 32×32로 줄여 픽셀을 얻음.
 * 한 번에 줄이면 일부 픽셀만 샘플링되므로 128×128 을 거쳐 두 단계로 평균.
 * 이 32×32 데이터가 그대로 서버로 가고, 서버도 같은 함수로 대표색을 다시 계산함.
 */
export function sampleRegion(
  source: CanvasImageSource,
  w: number,
  h: number,
  region: Region,
): { pixels: string; color: ExtractedColor } {
  const { x, y, side } = regionRect(region, w, h);
  const mid = Math.min(128, side);
  const a = canvas(mid, mid, 'work');
  a.imageSmoothingEnabled = true;
  a.imageSmoothingQuality = 'high';
  a.drawImage(source, x, y, side, side, 0, 0, mid, mid);
  const b = canvas(SAMPLE_SIZE, SAMPLE_SIZE, 'small');
  b.imageSmoothingEnabled = true;
  b.imageSmoothingQuality = 'high';
  b.drawImage(a.canvas, 0, 0, mid, mid, 0, 0, SAMPLE_SIZE, SAMPLE_SIZE);
  const rgb = rgbaToRgb(b.getImageData(0, 0, SAMPLE_SIZE, SAMPLE_SIZE).data);
  return { pixels: bytesToBase64(rgb), color: extractRepresentativeColor(rgb, 3) };
}

/** 비디오 프레임을 캔버스로 촬영 (긴 변 최대 1024px) */
export function captureFrame(video: HTMLVideoElement): HTMLCanvasElement | null {
  const vw = video.videoWidth;
  const vh = video.videoHeight;
  if (!vw || !vh) return null;
  const scale = Math.min(1, 1024 / Math.max(vw, vh));
  const c = document.createElement('canvas');
  c.width = Math.round(vw * scale);
  c.height = Math.round(vh * scale);
  c.getContext('2d')!.drawImage(video, 0, 0, c.width, c.height);
  return c;
}

/** 파일(기본 카메라 앱 사진)을 캔버스로 */
export async function fileToCanvas(file: File): Promise<HTMLCanvasElement> {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.decoding = 'async';
    img.src = url;
    await img.decode();
    const scale = Math.min(1, 1024 / Math.max(img.naturalWidth, img.naturalHeight));
    const c = document.createElement('canvas');
    c.width = Math.round(img.naturalWidth * scale);
    c.height = Math.round(img.naturalHeight * scale);
    c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height);
    return c;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** 서버가 보낸 32×32 RGB(base64)를 그림으로 */
export function drawThumb(canvasEl: HTMLCanvasElement, b64: string) {
  const bin = atob(b64);
  const n = SAMPLE_SIZE * SAMPLE_SIZE;
  if (bin.length !== n * 3) return;
  canvasEl.width = SAMPLE_SIZE;
  canvasEl.height = SAMPLE_SIZE;
  const ctx = canvasEl.getContext('2d')!;
  const img = ctx.createImageData(SAMPLE_SIZE, SAMPLE_SIZE);
  for (let i = 0; i < n; i++) {
    img.data[i * 4] = bin.charCodeAt(i * 3);
    img.data[i * 4 + 1] = bin.charCodeAt(i * 3 + 1);
    img.data[i * 4 + 2] = bin.charCodeAt(i * 3 + 2);
    img.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
}
