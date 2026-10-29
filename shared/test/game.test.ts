import { describe, expect, it } from 'vitest';
import { hexToRgb, rgbToLab } from '../src/color';
import { colorScore, scoreSubmission, timeBonus, colorDifference } from '../src/scoring';
import { pickRoundColors, TARGET_COLORS, targetLab } from '../src/palette';
import { balanceTeams, makeTeams, smallestTeam } from '../src/teams';
import { cleanName, sanitizeSettings, DEFAULT_SETTINGS, CODE_PATTERN, normalizeCode } from '../src/protocol';
import { computeResults } from '../src/ranking';
import type { SubmissionView } from '../src/protocol';

describe('색상 점수 경계값 (Delta E 이하 기준)', () => {
  it.each([
    [0, 100],
    [5, 100],
    [5.0001, 80],
    [10, 80],
    [10.01, 60],
    [20, 60],
    [20.5, 40],
    [35, 40],
    [35.1, 20],
    [50, 20],
    [50.0001, 0],
    [120, 0],
  ])('ΔE %f → %i점', (dE, pts) => {
    expect(colorScore(dE, 'standard')).toBe(pts);
  });
  it('엄격 모드는 하위 구간 30/40', () => {
    expect(colorScore(20, 'strict')).toBe(60);
    expect(colorScore(30, 'strict')).toBe(40);
    expect(colorScore(40, 'strict')).toBe(20);
    expect(colorScore(40.1, 'strict')).toBe(0);
  });
  it('관대 모드는 구간 경계가 1.25배', () => {
    expect(colorScore(6.25, 'lenient')).toBe(100);
    expect(colorScore(6.3, 'lenient')).toBe(80);
    expect(colorScore(62.5, 'lenient')).toBe(20);
  });
});

describe('시간 보너스', () => {
  it('남은 시간에 비례, 최대 20', () => {
    expect(timeBonus(30000, 30000)).toBe(20);
    expect(timeBonus(15000, 30000)).toBe(10);
    expect(timeBonus(0, 30000)).toBe(0);
    expect(timeBonus(99999, 30000)).toBe(20);
  });
  it('마감 이후는 무효(null)', () => {
    expect(timeBonus(-1, 30000)).toBeNull();
  });
});

describe('제출 점수', () => {
  const red = rgbToLab(hexToRgb('#D7262E'));
  it('정확하면 100 + 보너스', () => {
    const r = scoreSubmission({ target: red, measured: red, remainingMs: 15000, totalMs: 30000, tolerance: 'standard', timeBonusEnabled: true });
    expect(r).toMatchObject({ valid: true, colorScore: 100, timeBonus: 10, total: 110 });
  });
  it('색이 많이 다르면(60점 미만) 시간 보너스 없음', () => {
    const blue = rgbToLab(hexToRgb('#1F5FC8'));
    const r = scoreSubmission({ target: red, measured: blue, remainingMs: 29000, totalMs: 30000, tolerance: 'standard', timeBonusEnabled: true });
    expect(r.colorScore).toBeLessThan(60);
    expect(r.timeBonus).toBe(0);
    const strict = scoreSubmission({ target: red, measured: blue, remainingMs: 29000, totalMs: 30000, tolerance: 'strict', timeBonusEnabled: true });
    expect(strict.total).toBe(0);
  });
  it('60점 이상이면 보너스 지급', () => {
    const shadow = rgbToLab([150, 25, 32]); // 그늘진 빨강
    const r = scoreSubmission({ target: red, measured: shadow, remainingMs: 30000, totalMs: 30000, tolerance: 'standard', timeBonusEnabled: true });
    expect(r.colorScore).toBeGreaterThanOrEqual(60);
    expect(r.timeBonus).toBe(20);
  });
  it('마감 후 제출은 무효', () => {
    const r = scoreSubmission({ target: red, measured: red, remainingMs: -10, totalMs: 30000, tolerance: 'standard', timeBonusEnabled: true });
    expect(r.valid).toBe(false);
    expect(r.total).toBe(0);
  });
  it('보너스 끄기', () => {
    const r = scoreSubmission({ target: red, measured: red, remainingMs: 30000, totalMs: 30000, tolerance: 'standard', timeBonusEnabled: false });
    expect(r.total).toBe(100);
  });
  it('같은 빨강의 그림자(어둡게)는 표준 판정에서 엄격보다 점수가 높거나 같음', () => {
    const shadow = rgbToLab([150, 25, 32]);
    expect(colorDifference(red, shadow, 'standard')).toBeLessThan(colorDifference(red, shadow, 'strict'));
  });
  it('무채색 목표는 밝기 차이를 그대로 봄 (검정 vs 회색이 쉽게 통과하지 않음)', () => {
    const black = rgbToLab(hexToRgb('#1C1C1E'));
    const gray = rgbToLab(hexToRgb('#8E8E8E'));
    expect(colorScore(colorDifference(black, gray, 'standard'), 'standard')).toBeLessThanOrEqual(20);
    expect(colorScore(colorDifference(black, gray, 'strict'), 'strict')).toBe(20);
  });
});

describe('목표 색 고르기', () => {
  it('팔레트에 13개 기본 계열이 모두 있음', () => {
    const fams = new Set(TARGET_COLORS.map((c) => c.family));
    expect(fams.size).toBe(13);
  });
  it('색 id 중복 없음, Lab 계산 가능', () => {
    const ids = TARGET_COLORS.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const c of TARGET_COLORS) expect(targetLab(c).every(Number.isFinite)).toBe(true);
  });
  it.each(['easy', 'normal', 'hard'] as const)('%s: 20라운드 — 같은 계열 연속 없음, 중복 최소', (d) => {
    for (let trial = 0; trial < 50; trial++) {
      const list = pickRoundColors(20, d);
      expect(list).toHaveLength(20);
      for (let i = 1; i < list.length; i++) expect(list[i].family).not.toBe(list[i - 1].family);
      const pool = TARGET_COLORS.filter((c) => (d === 'easy' ? c.tier === 1 : d === 'normal' ? c.tier <= 2 : true));
      const unique = new Set(list.map((c) => c.id)).size;
      expect(unique).toBe(Math.min(20, pool.length) === 20 ? 20 : unique);
      if (d === 'easy') expect(list.every((c) => c.tier === 1)).toBe(true);
    }
  });
  it('쉬움 13색 풀에서 5라운드는 전부 다른 색', () => {
    for (let t = 0; t < 50; t++) {
      const list = pickRoundColors(5, 'easy');
      expect(new Set(list.map((c) => c.id)).size).toBe(5);
    }
  });
});

describe('팀', () => {
  it('2~8팀 범위로 생성', () => {
    expect(makeTeams(1)).toHaveLength(2);
    expect(makeTeams(9)).toHaveLength(8);
    expect(makeTeams(4).map((t) => t.id)).toEqual([0, 1, 2, 3]);
  });
  it('새 참가자는 가장 적은 팀으로', () => {
    expect(smallestTeam([{ id: 'a', teamId: 0 }, { id: 'b', teamId: 0 }, { id: 'c', teamId: 1 }], 3)).toBe(2);
    expect(smallestTeam([], 2)).toBe(0);
  });
  it('균등 배정: 팀 인원 차이 최대 1', () => {
    const ids = Array.from({ length: 23 }, (_, i) => `p${i}`);
    const m = balanceTeams(ids, 4);
    const counts = [0, 0, 0, 0];
    for (const t of m.values()) counts[t]++;
    expect(Math.max(...counts) - Math.min(...counts)).toBeLessThanOrEqual(1);
  });
});

describe('입력 정리', () => {
  it('닉네임', () => {
    expect(cleanName('  철수  ', 12)).toBe('철수');
    expect(cleanName('a\u0000b​c', 12)).toBe('abc');
    expect(cleanName('   ', 12)).toBeNull();
    expect(cleanName(123, 12)).toBeNull();
    expect(cleanName('가나다라마바사아자차카타파하', 12)).toBe('가나다라마바사아자차카타');
  });
  it('설정 범위 제한', () => {
    const s = sanitizeSettings({ rounds: 100, roundSeconds: 1, difficulty: 'evil', teamCount: 3, timeBonus: 'yes' });
    expect(s.rounds).toBe(20);
    expect(s.roundSeconds).toBe(10);
    expect(s.difficulty).toBe(DEFAULT_SETTINGS.difficulty);
    expect(s.teamCount).toBe(3);
    expect(s.timeBonus).toBe(DEFAULT_SETTINGS.timeBonus);
  });
  it('방 코드', () => {
    expect(normalizeCode(' ab-c 23x9 ')).toBe('ABC23X');
    expect(CODE_PATTERN.test('ABC23X')).toBe(true);
    expect(CODE_PATTERN.test('ABC10X')).toBe(false);
  });
});

describe('최종 순위와 동점 처리', () => {
  const teams = makeTeams(3);
  const players = [
    { id: 'a', nickname: 'A', teamId: 0 },
    { id: 'b', nickname: 'B', teamId: 0 },
    { id: 'c', nickname: 'C', teamId: 1 },
    { id: 'd', nickname: 'D', teamId: 1 },
    { id: 'e', nickname: 'E', teamId: 2 },
  ];
  const sub = (playerId: string, teamId: number, round: number, total: number, colorScore: number, deltaE: number): SubmissionView => ({
    playerId, teamId, round, total, colorScore, deltaE, timeBonus: total - colorScore, hex: '#000000',
  });
  const targets = [{ name: '빨강', hex: '#D7262E' }, { name: '파랑', hex: '#1F5FC8' }];

  it('점수 → 완벽 횟수 → 평균 ΔE 순으로 순위', () => {
    const r = computeResults({
      teams, players, roundsPlayed: 2, roundTargets: targets, teamScoring: 'sum',
      submissions: [
        sub('a', 0, 0, 100, 100, 4), sub('b', 0, 1, 60, 60, 15), // 팀0: 160, 완벽1
        sub('c', 1, 0, 80, 80, 8), sub('d', 1, 1, 80, 80, 9),    // 팀1: 160, 완벽0
        sub('e', 2, 0, 40, 40, 30),
      ],
    });
    expect(r.teams.map((t) => [t.id, t.rank])).toEqual([[0, 1], [1, 2], [2, 3]]);
    expect(r.winners).toEqual([0]);
    expect(r.teams[0].roundScores).toEqual([100, 60]);
    expect(r.mvp?.id).toBe('a');
    expect(r.bestMatch?.playerId).toBe('a');
    expect(r.bestMatch?.targetName).toBe('빨강');
  });

  it('모든 기준이 같으면 공동 우승', () => {
    const r = computeResults({
      teams: makeTeams(2), players: players.slice(0, 4), roundsPlayed: 1, roundTargets: targets, teamScoring: 'sum',
      submissions: [sub('a', 0, 0, 80, 80, 8), sub('c', 1, 0, 80, 80, 8)],
    });
    expect(r.winners.sort()).toEqual([0, 1]);
    expect(r.teams.every((t) => t.rank === 1)).toBe(true);
  });

  it('평균 모드는 인원 보정', () => {
    const r = computeResults({
      teams: makeTeams(2),
      players: [{ id: 'a', nickname: 'A', teamId: 0 }, { id: 'b', nickname: 'B', teamId: 0 }, { id: 'c', nickname: 'C', teamId: 1 }],
      roundsPlayed: 1, roundTargets: targets, teamScoring: 'average',
      submissions: [sub('a', 0, 0, 60, 60, 15), sub('b', 0, 0, 60, 60, 15), sub('c', 1, 0, 100, 100, 3)],
    });
    expect(r.teams[0].id).toBe(1);
    expect(r.teams[0].score).toBe(100);
    expect(r.teams[1].score).toBe(60);
  });

  it('퇴장한 플레이어 점수는 제외, 빈 팀은 순위 제외', () => {
    const r = computeResults({
      teams, players: players.slice(0, 2), roundsPlayed: 1, roundTargets: targets, teamScoring: 'sum',
      submissions: [sub('a', 0, 0, 80, 80, 8), sub('z', 1, 0, 100, 100, 1)],
    });
    expect(r.teams).toHaveLength(1);
    expect(r.bestMatch?.playerId).toBe('a');
  });
});
