import type { FinalResults, PlayerResult, SubmissionView, TeamResult, TeamScoring } from './protocol';
import type { Team } from './teams';

interface PlayerLite {
  id: string;
  nickname: string;
  teamId: number;
}

/**
 * 동점 규칙 (팀·개인 공통)
 * 1) 점수 높은 순
 * 2) 완벽 매칭(색상 100점) 횟수가 많은 쪽
 * 3) 평균 Delta E 가 낮은(더 정확한) 쪽 — 제출이 없으면 가장 뒤
 * 4) 그래도 같으면 공동 순위 (팀은 공동 우승)
 */
function compare(
  a: { score: number; perfects: number; avgDeltaE: number | null },
  b: { score: number; perfects: number; avgDeltaE: number | null },
): number {
  if (b.score !== a.score) return b.score - a.score;
  if (b.perfects !== a.perfects) return b.perfects - a.perfects;
  const ad = a.avgDeltaE ?? Infinity;
  const bd = b.avgDeltaE ?? Infinity;
  if (ad !== bd) return ad < bd ? -1 : 1;
  return 0;
}

function assignRanks<T extends { score: number; perfects: number; avgDeltaE: number | null; rank: number }>(list: T[]): T[] {
  list.sort(compare);
  list.forEach((item, i) => {
    item.rank = i > 0 && compare(list[i - 1], item) === 0 ? list[i - 1].rank : i + 1;
  });
  return list;
}

const round1 = (n: number) => Math.round(n * 10) / 10;

export function teamRoundScore(subs: SubmissionView[], teamId: number, memberCount: number, scoring: TeamScoring): number {
  const sum = subs.filter((s) => s.teamId === teamId).reduce((acc, s) => acc + s.total, 0);
  if (scoring === 'average') return memberCount > 0 ? round1(sum / memberCount) : 0;
  return sum;
}

export function computeResults(input: {
  teams: Team[];
  players: PlayerLite[];
  submissions: SubmissionView[]; // 유효한 제출만
  roundsPlayed: number;
  roundTargets: { name: string; hex: string }[];
  teamScoring: TeamScoring;
  thumbs?: Record<string, string>; // `${round}:${playerId}`
}): FinalResults {
  const { teams, players, roundsPlayed, teamScoring } = input;
  const present = new Set(players.map((p) => p.id));
  const subs = input.submissions.filter((s) => present.has(s.playerId));

  const playerResults: PlayerResult[] = players.map((p) => {
    const mine = subs.filter((s) => s.playerId === p.id);
    const total = mine.reduce((acc, s) => acc + s.total, 0);
    return {
      id: p.id,
      nickname: p.nickname,
      teamId: p.teamId,
      rank: 0,
      total,
      perfects: mine.filter((s) => s.colorScore === 100).length,
      avgDeltaE: mine.length ? round1(mine.reduce((acc, s) => acc + s.deltaE, 0) / mine.length) : null,
      submissions: mine.length,
    };
  });
  const rankedPlayers = assignRanks(playerResults.map((p) => ({ ...p, score: p.total }))).map(
    ({ score: _s, ...rest }) => rest,
  );

  const teamResults: TeamResult[] = teams.map((t) => {
    const members = players.filter((p) => p.teamId === t.id);
    const teamSubs = subs.filter((s) => s.teamId === t.id);
    const sum = teamSubs.reduce((acc, s) => acc + s.total, 0);
    const roundScores = Array.from({ length: roundsPlayed }, (_, r) =>
      teamRoundScore(
        teamSubs.filter((s) => s.round === r),
        t.id,
        members.length,
        teamScoring,
      ),
    );
    return {
      ...t,
      rank: 0,
      score: teamScoring === 'average' ? (members.length ? round1(sum / members.length) : 0) : sum,
      sum,
      memberCount: members.length,
      perfects: teamSubs.filter((s) => s.colorScore === 100).length,
      avgDeltaE: teamSubs.length ? round1(teamSubs.reduce((acc, s) => acc + s.deltaE, 0) / teamSubs.length) : null,
      roundScores,
    };
  });
  // 팀원이 없는 팀은 순위에서 제외
  const rankedTeams = assignRanks(teamResults.filter((t) => t.memberCount > 0));
  const winners = rankedTeams.length && (rankedTeams[0].score > 0 || subs.length > 0)
    ? rankedTeams.filter((t) => t.rank === 1).map((t) => t.id)
    : [];

  const mvpCandidate = rankedPlayers.find((p) => p.rank === 1 && p.total > 0) ?? null;

  let best: SubmissionView | null = null;
  for (const s of subs) {
    if (!best || s.deltaE < best.deltaE || (s.deltaE === best.deltaE && s.total > best.total)) best = s;
  }
  const bestMatch = best
    ? {
        ...best,
        thumb: input.thumbs?.[`${best.round}:${best.playerId}`] ?? null,
        targetName: input.roundTargets[best.round]?.name ?? '',
        targetHex: input.roundTargets[best.round]?.hex ?? '#000000',
        nickname: players.find((p) => p.id === best!.playerId)?.nickname ?? '',
      }
    : null;

  return {
    roundsPlayed,
    teams: rankedTeams,
    winners,
    players: rankedPlayers,
    mvp: mvpCandidate,
    bestMatch,
    roundTargets: input.roundTargets.slice(0, roundsPlayed),
  };
}
