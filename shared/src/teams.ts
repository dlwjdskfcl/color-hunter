export interface Team {
  id: number;
  name: string;
  color: string;
}

export const MIN_TEAMS = 2;
export const MAX_TEAMS = 8;

export const TEAM_PRESETS: readonly Omit<Team, 'id'>[] = [
  { name: '토마토', color: '#FF4D3D' },
  { name: '블루베리', color: '#3B66F5' },
  { name: '라임', color: '#3DBE4A' },
  { name: '레몬', color: '#F5B800' },
  { name: '포도', color: '#8E44D9' },
  { name: '복숭아', color: '#FF7FA8' },
  { name: '민트', color: '#13B5A4' },
  { name: '오렌지', color: '#FF8A1F' },
];

export function makeTeams(count: number, existing: Team[] = []): Team[] {
  const n = Math.max(MIN_TEAMS, Math.min(MAX_TEAMS, Math.round(count)));
  return Array.from({ length: n }, (_, id) => existing[id] ?? { id, ...TEAM_PRESETS[id] });
}

interface HasTeam {
  id: string;
  teamId: number;
}

/** 새 참가자를 가장 인원이 적은 팀에 (동률이면 번호가 빠른 팀) */
export function smallestTeam(players: HasTeam[], teamCount: number): number {
  const counts = Array.from({ length: teamCount }, () => 0);
  for (const p of players) if (p.teamId < teamCount) counts[p.teamId]++;
  let best = 0;
  for (let i = 1; i < teamCount; i++) if (counts[i] < counts[best]) best = i;
  return best;
}

/** 전원을 무작위로 섞어 균등 배정. 반환: playerId → teamId */
export function balanceTeams(playerIds: string[], teamCount: number, rand: () => number = Math.random): Map<string, number> {
  const ids = [...playerIds];
  for (let i = ids.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [ids[i], ids[j]] = [ids[j], ids[i]];
  }
  const out = new Map<string, number>();
  ids.forEach((id, i) => out.set(id, i % teamCount));
  return out;
}
