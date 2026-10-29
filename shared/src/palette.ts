import { hexToRgb, rgbToLab, type Lab } from './color';

export type Difficulty = 'easy' | 'normal' | 'hard';

export type ColorFamily =
  | 'red'
  | 'orange'
  | 'yellow'
  | 'lime'
  | 'green'
  | 'teal'
  | 'blue'
  | 'purple'
  | 'pink'
  | 'brown'
  | 'gray'
  | 'black'
  | 'white';

export interface TargetColor {
  id: string;
  name: string;
  hex: string;
  family: ColorFamily;
  /** 1: 기본색, 2: 중간색, 3: 비슷한 색이 많은 어려운 색 */
  tier: 1 | 2 | 3;
}

export const TARGET_COLORS: readonly TargetColor[] = [
  // tier 1 — 누구나 찾기 쉬운 기본색
  { id: 'red', name: '빨강', hex: '#D7262E', family: 'red', tier: 1 },
  { id: 'orange', name: '주황', hex: '#F2791C', family: 'orange', tier: 1 },
  { id: 'yellow', name: '노랑', hex: '#F7D117', family: 'yellow', tier: 1 },
  { id: 'lime', name: '연두', hex: '#8CC63F', family: 'lime', tier: 1 },
  { id: 'green', name: '초록', hex: '#1E9A4B', family: 'green', tier: 1 },
  { id: 'teal', name: '청록', hex: '#0E9C9A', family: 'teal', tier: 1 },
  { id: 'blue', name: '파랑', hex: '#1F5FC8', family: 'blue', tier: 1 },
  { id: 'purple', name: '보라', hex: '#7440B0', family: 'purple', tier: 1 },
  { id: 'pink', name: '분홍', hex: '#F27BAA', family: 'pink', tier: 1 },
  { id: 'brown', name: '갈색', hex: '#7B4B2A', family: 'brown', tier: 1 },
  { id: 'gray', name: '회색', hex: '#8E8E8E', family: 'gray', tier: 1 },
  { id: 'black', name: '검정', hex: '#1C1C1E', family: 'black', tier: 1 },
  { id: 'white', name: '흰색', hex: '#F2F2EE', family: 'white', tier: 1 },
  // tier 2 — 중간색
  { id: 'sky', name: '하늘색', hex: '#62B5EA', family: 'blue', tier: 2 },
  { id: 'navy', name: '남색', hex: '#22306B', family: 'blue', tier: 2 },
  { id: 'mint', name: '민트', hex: '#86D9BE', family: 'teal', tier: 2 },
  { id: 'olive', name: '올리브', hex: '#7A7A2E', family: 'lime', tier: 2 },
  { id: 'beige', name: '베이지', hex: '#DCC8A4', family: 'brown', tier: 2 },
  { id: 'burgundy', name: '버건디', hex: '#7A1F35', family: 'red', tier: 2 },
  { id: 'lavender', name: '라벤더', hex: '#B6A2DD', family: 'purple', tier: 2 },
  { id: 'apricot', name: '살구색', hex: '#F8B98E', family: 'orange', tier: 2 },
  { id: 'magenta', name: '자홍', hex: '#C2268A', family: 'pink', tier: 2 },
  { id: 'charcoal', name: '진회색', hex: '#4A4A4D', family: 'gray', tier: 2 },
  { id: 'cream', name: '크림색', hex: '#F3E6C2', family: 'white', tier: 2 },
  { id: 'forest', name: '진초록', hex: '#21522F', family: 'green', tier: 2 },
  // tier 3 — 비슷한 색과 헷갈리기 쉬운 색
  { id: 'coral', name: '코랄', hex: '#F2725E', family: 'pink', tier: 3 },
  { id: 'mustard', name: '머스터드', hex: '#C99A1E', family: 'yellow', tier: 3 },
  { id: 'khaki', name: '카키', hex: '#8F8452', family: 'brown', tier: 3 },
  { id: 'denim', name: '데님', hex: '#45628C', family: 'blue', tier: 3 },
  { id: 'terracotta', name: '테라코타', hex: '#B65A3C', family: 'orange', tier: 3 },
  { id: 'plum', name: '자두색', hex: '#5E2B4F', family: 'purple', tier: 3 },
  { id: 'sage', name: '세이지', hex: '#9CAF88', family: 'green', tier: 3 },
  { id: 'turquoise', name: '터키석', hex: '#2CC3C4', family: 'teal', tier: 3 },
  { id: 'rose', name: '장미색', hex: '#C2496B', family: 'pink', tier: 3 },
  { id: 'lemon', name: '레몬색', hex: '#F2EC6B', family: 'yellow', tier: 3 },
  { id: 'chestnut', name: '밤색', hex: '#5A3220', family: 'brown', tier: 3 },
  { id: 'silver', name: '은회색', hex: '#BDBFC2', family: 'gray', tier: 3 },
  { id: 'scarlet', name: '진홍', hex: '#B5161E', family: 'red', tier: 3 },
  { id: 'chartreuse', name: '형광 연두', hex: '#BEDC2E', family: 'lime', tier: 3 },
];

const BY_ID = new Map(TARGET_COLORS.map((c) => [c.id, c]));
const LAB_CACHE = new Map<string, Lab>();

export function getTargetColor(id: string): TargetColor | undefined {
  return BY_ID.get(id);
}

export function targetLab(color: TargetColor): Lab {
  let lab = LAB_CACHE.get(color.id);
  if (!lab) {
    lab = rgbToLab(hexToRgb(color.hex));
    LAB_CACHE.set(color.id, lab);
  }
  return lab;
}

/** 난이도별 색 등급 가중치 */
const TIER_WEIGHTS: Record<Difficulty, Record<1 | 2 | 3, number>> = {
  easy: { 1: 1, 2: 0, 3: 0 },
  normal: { 1: 0.55, 2: 0.45, 3: 0 },
  hard: { 1: 0.2, 2: 0.4, 3: 0.4 },
};

/**
 * 라운드 수만큼 목표 색을 고른다.
 * - 같은 색은 후보가 남아 있는 한 다시 나오지 않음
 * - 같은 계열이 연달아 나오지 않음, 계열은 최대한 고르게 분포
 * rand: [0,1) 난수 함수 (서버는 crypto 기반을 넘김)
 */
export function pickRoundColors(count: number, difficulty: Difficulty, rand: () => number = Math.random): TargetColor[] {
  const weights = TIER_WEIGHTS[difficulty];
  const pool = TARGET_COLORS.filter((c) => weights[c.tier] > 0);
  const used = new Set<string>();
  const familyCount = new Map<ColorFamily, number>();
  const result: TargetColor[] = [];

  for (let i = 0; i < count; i++) {
    if (used.size >= pool.length) used.clear();
    const prevFamily = result[result.length - 1]?.family;
    let candidates = pool.filter((c) => !used.has(c.id) && c.family !== prevFamily);
    if (candidates.length === 0) candidates = pool.filter((c) => c.family !== prevFamily);
    // 가장 적게 나온 계열 우선
    const minUse = Math.min(...candidates.map((c) => familyCount.get(c.family) ?? 0));
    const fresh = candidates.filter((c) => (familyCount.get(c.family) ?? 0) === minUse);
    const weighted = fresh.map((c) => ({ c, w: weights[c.tier] }));
    const total = weighted.reduce((s, x) => s + x.w, 0);
    let r = rand() * total;
    let chosen = weighted[weighted.length - 1].c;
    for (const x of weighted) {
      r -= x.w;
      if (r < 0) {
        chosen = x.c;
        break;
      }
    }
    result.push(chosen);
    used.add(chosen.id);
    familyCount.set(chosen.family, (familyCount.get(chosen.family) ?? 0) + 1);
  }
  return result;
}
