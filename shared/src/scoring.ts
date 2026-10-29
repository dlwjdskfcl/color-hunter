import { chroma, deltaE2000, type Lab } from './color';

export interface ScoreBand {
  /** 이 값 이하의 Delta E 면 points 점 */
  maxDeltaE: number;
  points: number;
}

/** 기본 색상 점수 구간 (Delta E 이하 → 점수). 순서대로 검사. */
export const DEFAULT_SCORE_BANDS: readonly ScoreBand[] = [
  { maxDeltaE: 5, points: 100 },
  { maxDeltaE: 10, points: 80 },
  { maxDeltaE: 20, points: 60 },
  { maxDeltaE: 35, points: 40 },
  { maxDeltaE: 50, points: 20 },
];

export const STRICT_SCORE_BANDS: readonly ScoreBand[] = [
  { maxDeltaE: 5, points: 100 },
  { maxDeltaE: 10, points: 80 },
  { maxDeltaE: 20, points: 60 },
  { maxDeltaE: 30, points: 40 },
  { maxDeltaE: 40, points: 20 },
];

export const MAX_TIME_BONUS = 20;

export type Tolerance = 'lenient' | 'standard' | 'strict';

/**
 * 판정 관대함.
 * - kL: CIEDE2000 밝기 가중치. 카메라 노출·그림자 때문에 밝기는 크게 흔들리므로 유채색 목표는 밝기 차이를 덜 엄격하게 봄.
 * - bandScale: 점수 구간 경계에 곱하는 값.
 * 무채색(검정·회색·흰색) 목표는 밝기 자체가 색이므로 항상 kL=1.
 */
export const TOLERANCE_PRESETS: Record<Tolerance, { kL: number; bandScale: number; bands: readonly ScoreBand[]; label: string }> = {
  lenient: { kL: 2, bandScale: 1.25, bands: DEFAULT_SCORE_BANDS, label: '관대' },
  standard: { kL: 1.5, bandScale: 1, bands: DEFAULT_SCORE_BANDS, label: '표준' },
  // CIEDE2000 은 큰 차이를 압축함(빨강↔파랑 ≈ 44). 엄격 모드는 하위 구간을 좁혀 반대색은 0점.
  strict: { kL: 1, bandScale: 1, bands: STRICT_SCORE_BANDS, label: '엄격' },
};

/** 시간 보너스를 받으려면 필요한 최소 색상 점수 (아무거나 빨리 찍는 전략 방지) */
export const BONUS_MIN_COLOR_SCORE = 60;

const ACHROMATIC_CHROMA = 12;

export function colorDifference(target: Lab, measured: Lab, tolerance: Tolerance = 'standard'): number {
  const preset = TOLERANCE_PRESETS[tolerance];
  const kL = chroma(target) < ACHROMATIC_CHROMA ? 1 : preset.kL;
  return deltaE2000(target, measured, kL, 1, 1);
}

export function colorScore(
  deltaE: number,
  tolerance: Tolerance = 'standard',
  bands: readonly ScoreBand[] = TOLERANCE_PRESETS[tolerance].bands,
): number {
  const scale = TOLERANCE_PRESETS[tolerance].bandScale;
  for (const band of bands) {
    if (deltaE <= band.maxDeltaE * scale) return band.points;
  }
  return 0;
}

/**
 * 시간 보너스: 남은 시간에 비례 (0~max, 반올림).
 * 마감 이후(remainingMs < 0)는 null → 제출 무효.
 */
export function timeBonus(remainingMs: number, totalMs: number, max = MAX_TIME_BONUS): number | null {
  if (!(totalMs > 0) || remainingMs < 0) return null;
  const ratio = Math.min(1, remainingMs / totalMs);
  return Math.round(max * ratio);
}

export interface ScoreInput {
  target: Lab;
  measured: Lab;
  remainingMs: number;
  totalMs: number;
  tolerance: Tolerance;
  timeBonusEnabled: boolean;
}

export interface ScoreResult {
  valid: boolean;
  deltaE: number;
  colorScore: number;
  timeBonus: number;
  total: number;
}

/** 최종 점수 = 색상 점수 + 시간 보너스. 보너스는 색상 60점 이상일 때만 — 아무거나 빨리 찍는 전략 방지. */
export function scoreSubmission(input: ScoreInput): ScoreResult {
  const deltaE = colorDifference(input.target, input.measured, input.tolerance);
  const bonus = timeBonus(input.remainingMs, input.totalMs);
  if (bonus === null) return { valid: false, deltaE, colorScore: 0, timeBonus: 0, total: 0 };
  const cs = colorScore(deltaE, input.tolerance);
  const tb = input.timeBonusEnabled && cs >= BONUS_MIN_COLOR_SCORE ? bonus : 0;
  return { valid: true, deltaE, colorScore: cs, timeBonus: tb, total: cs + tb };
}

/** 색 차이를 사람이 읽을 수 있는 말로 */
export function matchLabel(deltaE: number): string {
  if (deltaE <= 5) return '완벽해요!';
  if (deltaE <= 10) return '아주 비슷해요';
  if (deltaE <= 20) return '비슷해요';
  if (deltaE <= 35) return '조금 달라요';
  if (deltaE <= 50) return '많이 달라요';
  return '다른 색이에요';
}
