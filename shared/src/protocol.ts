import type { Difficulty } from './palette';
import type { Tolerance } from './scoring';
import { MAX_TEAMS, MIN_TEAMS, type Team } from './teams';

// ---------- 설정 ----------

export type TeamScoring = 'sum' | 'average';

export interface GameSettings {
  rounds: number; // 5~20
  roundSeconds: number; // 10~60
  difficulty: Difficulty;
  teamCount: number; // 2~8
  maxPlayers: number; // 3~30
  tolerance: Tolerance;
  timeBonus: boolean;
  /** 팀 점수: 팀원 점수 합계(sum) 또는 팀원 평균(average, 인원 차이 보정) */
  teamScoring: TeamScoring;
}

export const LIMITS = {
  rounds: [5, 20],
  roundSeconds: [10, 60],
  teamCount: [MIN_TEAMS, MAX_TEAMS],
  maxPlayers: [3, 30],
} as const;

export const DEFAULT_SETTINGS: GameSettings = {
  rounds: 5,
  roundSeconds: 30,
  difficulty: 'normal',
  teamCount: 2,
  maxPlayers: 30,
  tolerance: 'standard',
  timeBonus: true,
  teamScoring: 'sum',
};

/** 게임 시작에 필요한 최소 인원 (사람이 있는 팀이 2개 이상이어야 함) */
export const MIN_PLAYERS_TO_START = 2;

export const COUNTDOWN_MS = 3000;
export const REVEAL_MS = 8000;

const clampInt = (v: unknown, [lo, hi]: readonly [number, number], fallback: number) => {
  const n = typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : fallback;
  return Math.max(lo, Math.min(hi, n));
};
const oneOf = <T extends string>(v: unknown, options: readonly T[], fallback: T): T =>
  options.includes(v as T) ? (v as T) : fallback;

export function sanitizeSettings(input: unknown, base: GameSettings = DEFAULT_SETTINGS): GameSettings {
  const p = (input && typeof input === 'object' ? input : {}) as Partial<Record<keyof GameSettings, unknown>>;
  return {
    rounds: clampInt(p.rounds ?? base.rounds, LIMITS.rounds, base.rounds),
    roundSeconds: clampInt(p.roundSeconds ?? base.roundSeconds, LIMITS.roundSeconds, base.roundSeconds),
    difficulty: oneOf(p.difficulty ?? base.difficulty, ['easy', 'normal', 'hard'], base.difficulty),
    teamCount: clampInt(p.teamCount ?? base.teamCount, LIMITS.teamCount, base.teamCount),
    maxPlayers: clampInt(p.maxPlayers ?? base.maxPlayers, LIMITS.maxPlayers, base.maxPlayers),
    tolerance: oneOf(p.tolerance ?? base.tolerance, ['lenient', 'standard', 'strict'], base.tolerance),
    timeBonus: typeof p.timeBonus === 'boolean' ? p.timeBonus : base.timeBonus,
    teamScoring: oneOf(p.teamScoring ?? base.teamScoring, ['sum', 'average'], base.teamScoring),
  };
}

// ---------- 이름 ----------

export const NICKNAME_MAX = 12;
export const TEAM_NAME_MAX = 10;

/** 제어문자, 폭 없는 문자, 방향 제어 문자 */
function isInvisible(cp: number): boolean {
  return (
    cp <= 0x1f ||
    (cp >= 0x7f && cp <= 0x9f) ||
    (cp >= 0x200b && cp <= 0x200f) ||
    (cp >= 0x2028 && cp <= 0x202e) ||
    (cp >= 0x2060 && cp <= 0x206f) ||
    cp === 0xfeff
  );
}

/** 제어문자·앞뒤 공백 제거, 연속 공백 하나로, 길이 제한. 비면 null */
export function cleanName(raw: unknown, max: number): string | null {
  if (typeof raw !== 'string') return null;
  const s = Array.from(raw.normalize('NFC'))
    .filter((ch) => !isInvisible(ch.codePointAt(0)!))
    .join('')
    .replace(/\s+/g, ' ')
    .trim();
  const chars = Array.from(s).slice(0, max).join('').trim();
  return chars.length ? chars : null;
}

export function nicknameKey(name: string): string {
  return name.toLowerCase().replace(/\s/g, '');
}

// ---------- 방 코드 ----------

/** 헷갈리는 글자(0/O, 1/I/L) 제외 31자 */
export const CODE_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
export const CODE_LENGTH = 6;
export const CODE_PATTERN = /^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{6}$/;

export function normalizeCode(raw: string): string {
  return raw.toUpperCase().replace(/[^0-9A-Z]/g, '').slice(0, CODE_LENGTH);
}

// ---------- 화면에 보내는 상태 ----------

export type Phase = 'lobby' | 'countdown' | 'hunting' | 'reveal' | 'finished';
export type Role = 'host' | 'player';

export interface PublicPlayer {
  id: string;
  nickname: string;
  teamId: number;
  connected: boolean;
  total: number;
  /** 현재 라운드 제출 여부 */
  submitted: boolean;
}

export interface PublicTeam extends Team {
  total: number;
  memberCount: number;
}

export interface PublicRound {
  index: number; // 0부터
  /** 카운트다운 중에는 null (공정하게 동시에 공개) */
  target: { id: string; name: string; hex: string } | null;
  startsAt: number; // 서버 시각(ms)
  endsAt: number;
  revealUntil: number | null;
}

export interface SubmissionView {
  playerId: string;
  teamId: number;
  round: number;
  hex: string;
  deltaE: number;
  colorScore: number;
  timeBonus: number;
  total: number;
}

export interface RoundSummary {
  index: number;
  target: { id: string; name: string; hex: string };
  results: SubmissionView[]; // 점수 높은 순
  teamScores: Record<number, number>;
  best: (SubmissionView & { thumb: string | null }) | null;
}

export interface TeamResult extends Team {
  rank: number;
  score: number; // 순위에 쓰는 점수 (sum 또는 average)
  sum: number;
  memberCount: number;
  perfects: number;
  avgDeltaE: number | null;
  roundScores: number[];
}

export interface PlayerResult {
  id: string;
  nickname: string;
  teamId: number;
  rank: number;
  total: number;
  perfects: number;
  avgDeltaE: number | null;
  submissions: number;
}

export interface FinalResults {
  roundsPlayed: number;
  teams: TeamResult[];
  winners: number[]; // 공동 우승이면 여러 팀
  players: PlayerResult[];
  mvp: PlayerResult | null;
  bestMatch: (SubmissionView & { thumb: string | null; targetName: string; targetHex: string; nickname: string }) | null;
  roundTargets: { name: string; hex: string }[];
}

export interface RoomSnapshot {
  code: string;
  phase: Phase;
  paused: boolean;
  /** 일시정지 중 남은 시간(ms) — 화면 표시용 */
  pausedRemainingMs: number | null;
  settings: GameSettings;
  teams: PublicTeam[];
  players: PublicPlayer[];
  hostConnected: boolean;
  round: PublicRound | null;
  totalRounds: number;
  lastRound: RoundSummary | null;
  results: FinalResults | null;
  serverNow: number;
}

// ---------- 메시지 ----------

export type ClientMessage =
  | { t: 'hello'; token: string }
  | { t: 'join'; nickname: string }
  | { t: 'ping'; c: number }
  | { t: 'submit'; round: number; pixels: string; id: string }
  | { t: 'settings'; settings: Partial<GameSettings> }
  | { t: 'team:rename'; teamId: number; name: string }
  | { t: 'team:move'; playerId: string; teamId: number }
  | { t: 'team:shuffle' }
  | { t: 'kick'; playerId: string }
  | { t: 'start' }
  | { t: 'pause' }
  | { t: 'resume' }
  | { t: 'skip' }
  | { t: 'end' }
  | { t: 'restart' }
  | { t: 'leave' };

export type ErrorCode =
  | 'bad_message'
  | 'invalid_token'
  | 'not_host'
  | 'not_joined'
  | 'already_started'
  | 'room_full'
  | 'nickname_invalid'
  | 'nickname_taken'
  | 'not_accepting'
  | 'wrong_round'
  | 'too_late'
  | 'duplicate'
  | 'bad_pixels'
  | 'not_enough_players'
  | 'rate_limited'
  | 'room_closed';

export type ServerMessage =
  | { t: 'welcome'; role: Role; playerId: string | null; token: string; serverNow: number }
  | { t: 'state'; s: RoomSnapshot; mine: SubmissionView | null }
  | { t: 'pong'; c: number; s: number }
  | { t: 'submitted'; id: string; result: SubmissionView }
  | { t: 'error'; code: ErrorCode; message: string; ref?: string }
  | { t: 'kicked' };

export const ERROR_TEXT: Record<ErrorCode, string> = {
  bad_message: '잘못된 요청이에요.',
  invalid_token: '접속 정보가 만료됐어요. 다시 참가해 주세요.',
  not_host: '호스트만 할 수 있어요.',
  not_joined: '먼저 방에 참가해 주세요.',
  already_started: '이미 게임이 시작된 방이에요.',
  room_full: '방 인원이 가득 찼어요.',
  nickname_invalid: '닉네임을 1~12자로 입력해 주세요.',
  nickname_taken: '이미 사용 중인 닉네임이에요.',
  not_accepting: '지금은 제출할 수 없어요.',
  wrong_round: '지난 라운드 사진이에요.',
  too_late: '제한시간이 지나 제출이 무효가 됐어요.',
  duplicate: '이번 라운드는 이미 제출했어요.',
  bad_pixels: '사진 분석 데이터가 올바르지 않아요.',
  not_enough_players: '2개 이상의 팀에 참가자가 있어야 시작할 수 있어요.',
  rate_limited: '요청이 너무 많아요. 잠시 후 다시 시도해 주세요.',
  room_closed: '방이 닫혔어요.',
};
