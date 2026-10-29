'use client';

import { useEffect, useRef } from 'react';
import { matchLabel, type FinalResults, type PublicPlayer, type PublicTeam, type RoundSummary } from '@color-hunter/shared';
import { fx } from '@/lib/fx';
import { readableOn } from '@/lib/color-ui';
import { TeamBadge, Thumb } from './common';
import { Card, Swatch } from './ui';

/** 3, 2, 1 카운트다운 (서버 시각 기준) */
export function CountdownOverlay({ remaining, round, total }: { remaining: number; round: number; total: number }) {
  const n = Math.max(1, Math.ceil(remaining / 1000));
  const last = useRef<number | null>(null);
  useEffect(() => {
    if (last.current !== n) {
      last.current = n;
      fx.tick();
    }
  }, [n]);
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-6 py-10 text-center">
      <div className="rounded-full border-[3px] border-ink bg-white px-4 py-1 font-bold shadow-pop-sm">
        라운드 {round + 1} / {total}
      </div>
      <div className="text-lg font-bold text-muted">곧 목표 색이 공개돼요!</div>
      <div key={n} className="anim-count font-display text-[9rem] leading-none [-webkit-text-stroke:4px_#1B1433] text-sun" aria-live="assertive">
        {n}
      </div>
    </div>
  );
}

export function Scoreboard({
  teams,
  players,
  showSubmitted,
  compact,
  highlightTeam,
}: {
  teams: PublicTeam[];
  players: PublicPlayer[];
  showSubmitted?: boolean;
  compact?: boolean;
  highlightTeam?: number;
}) {
  const active = teams.filter((t) => t.memberCount > 0);
  const sorted = [...active].sort((a, b) => b.total - a.total);
  const max = Math.max(1, ...sorted.map((t) => t.total));
  return (
    <ol className="flex flex-col gap-2" aria-label="팀 점수">
      {sorted.map((t, i) => {
        const members = players.filter((p) => p.teamId === t.id);
        const done = members.filter((p) => p.submitted).length;
        const allDone = members.length > 0 && done === members.length;
        return (
          <li
            key={t.id}
            className={`rounded-2xl border-[3px] border-ink bg-white p-2.5 ${t.id === highlightTeam ? 'shadow-pop ring-4 ring-sun' : 'shadow-pop-sm'}`}
          >
            <div className="flex items-center gap-2">
              <span className="w-6 text-center font-display text-lg">{i + 1}</span>
              <TeamBadge team={t} />
              {showSubmitted && (
                <span className={`ml-auto rounded-full border-2 border-ink px-2 text-xs font-bold ${allDone ? 'bg-leaf text-white' : 'bg-paper'}`}>
                  {allDone ? '제출 완료' : `제출 ${done}/${members.length}`}
                </span>
              )}
              <span className={`${showSubmitted ? '' : 'ml-auto'} font-display text-2xl tabular-nums`}>{t.total}</span>
            </div>
            {!compact && (
              <div className="mt-2 h-3 overflow-hidden rounded-full border-2 border-ink bg-paper">
                <div className="h-full transition-[width] duration-700 ease-out" style={{ width: `${(t.total / max) * 100}%`, background: t.color }} />
              </div>
            )}
          </li>
        );
      })}
    </ol>
  );
}

export function RoundReveal({
  summary,
  teams,
  players,
  meId,
  remaining,
  isLast,
}: {
  summary: RoundSummary;
  teams: PublicTeam[];
  players: PublicPlayer[];
  meId?: string | null;
  remaining: number;
  isLast: boolean;
}) {
  const nameOf = (id: string) => players.find((p) => p.id === id)?.nickname ?? '(나감)';
  const teamOf = (id: number) => teams.find((t) => t.id === id);
  const mine = meId ? summary.results.find((r) => r.playerId === meId) : undefined;
  const best = summary.best;
  const ranked = teams
    .filter((t) => t.memberCount > 0)
    .map((t) => ({ t, score: summary.teamScores[t.id] ?? 0 }))
    .sort((a, b) => b.score - a.score);

  return (
    <div className="anim-rise flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h2 className="font-display text-3xl">라운드 {summary.index + 1} 결과</h2>
        <span className="rounded-full border-2 border-ink bg-white px-3 py-0.5 text-sm font-bold tabular-nums">
          {isLast ? '최종 결과' : '다음 라운드'} {Math.ceil(remaining / 1000)}초
        </span>
      </div>

      {meId && (
        <Card className="p-4">
          {mine ? (
            <div className="flex items-center gap-4">
              <div className="flex -space-x-3">
                <div className="size-16 rounded-2xl border-[3px] border-ink" style={{ background: summary.target.hex }} title="목표" />
                <div className="size-16 rounded-2xl border-[3px] border-ink" style={{ background: mine.hex }} title="내 사진" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-sm font-bold text-muted">내 점수 · {matchLabel(mine.deltaE)}</div>
                <div className="font-display text-4xl anim-pop">+{mine.total}</div>
                <div className="text-xs text-muted">
                  색상 {mine.colorScore} + 보너스 {mine.timeBonus} · ΔE {mine.deltaE}
                </div>
              </div>
            </div>
          ) : (
            <div className="text-center font-bold text-muted">이번 라운드는 제출하지 못했어요 (0점)</div>
          )}
        </Card>
      )}

      <Card className="p-4">
        <div className="flex flex-wrap items-center gap-4">
          <Swatch hex={summary.target.hex} name={summary.target.name} sub={`목표 ${summary.target.hex}`} />
          {best && (
            <div className="flex items-center gap-3">
              <span className="text-2xl" aria-hidden>
                ➜
              </span>
              {best.thumb ? <Thumb b64={best.thumb} className="size-16" /> : <div className="size-16 rounded-2xl border-[3px] border-ink" style={{ background: best.hex }} />}
              <div>
                <div className="text-xs font-bold text-muted">🎯 가장 비슷한 색</div>
                <div className="font-bold">{nameOf(best.playerId)}</div>
                <div className="text-xs text-muted">ΔE {best.deltaE}</div>
              </div>
            </div>
          )}
        </div>
      </Card>

      <section>
        <h3 className="mb-2 font-bold">이번 라운드 팀 점수</h3>
        <ol className="flex flex-col gap-2">
          {ranked.map(({ t, score }) => (
            <li key={t.id} className="flex items-center gap-2 rounded-2xl border-[3px] border-ink bg-white px-3 py-2 shadow-pop-sm">
              <TeamBadge team={t} />
              <span className="ml-auto font-display text-2xl tabular-nums">+{score}</span>
            </li>
          ))}
        </ol>
      </section>

      {summary.results.length > 0 && (
        <section>
          <h3 className="mb-2 font-bold">개인 기록</h3>
          <ol className="flex flex-col divide-y-2 divide-line overflow-hidden rounded-2xl border-[3px] border-ink bg-white">
            {summary.results.map((r, i) => {
              const team = teamOf(r.teamId);
              return (
                <li key={r.playerId} className={`flex items-center gap-3 px-3 py-2 ${r.playerId === meId ? 'bg-sun/30' : ''}`}>
                  <span className="w-5 text-center font-bold text-muted">{i + 1}</span>
                  <span className="size-7 shrink-0 rounded-lg border-2 border-ink" style={{ background: r.hex }} aria-hidden />
                  <span className="min-w-0 flex-1 truncate font-bold">
                    {nameOf(r.playerId)}
                    {team && <span className="ml-1.5 inline-block size-2.5 rounded-full border border-ink align-middle" style={{ background: team.color }} />}
                  </span>
                  <span className="text-xs text-muted">ΔE {r.deltaE}</span>
                  <span className="w-12 text-right font-display text-lg tabular-nums">{r.total}</span>
                </li>
              );
            })}
          </ol>
        </section>
      )}
    </div>
  );
}

export function Results({ results, meId, myTeamId }: { results: FinalResults; meId?: string | null; myTeamId?: number }) {
  const winners = results.teams.filter((t) => results.winners.includes(t.id));
  const tie = winners.length > 1;
  const playedFx = useRef(false);
  useEffect(() => {
    if (!playedFx.current) {
      playedFx.current = true;
      fx.win();
    }
  }, []);
  const teamOf = (id: number) => results.teams.find((t) => t.id === id);
  const max = Math.max(1, ...results.teams.map((t) => t.score));

  return (
    <div className="flex flex-col gap-5">
      {winners.length > 0 ? (
        <div
          className="anim-pop rounded-[2rem] border-[3px] border-ink p-6 text-center shadow-pop-lg"
          style={{
            background: tie ? `linear-gradient(135deg, ${winners.map((w) => w.color).join(', ')})` : winners[0].color,
            color: tie ? '#1B1433' : readableOn(winners[0].color),
          }}
        >
          <div className="text-5xl" aria-hidden>
            🏆
          </div>
          <div className="mt-2 font-display text-4xl">{winners.map((w) => w.name).join(' · ')}</div>
          <div className="mt-1 font-display text-2xl">{tie ? '공동 우승!' : '우승!'}</div>
          {myTeamId !== undefined && (
            <div className="mt-3 inline-block rounded-full border-2 border-ink bg-white px-3 py-1 text-sm font-bold text-ink">
              {results.winners.includes(myTeamId) ? '우리 팀이 이겼어요 🎉' : '아쉬워요! 다음 판에 다시 도전해요'}
            </div>
          )}
        </div>
      ) : (
        <Card className="p-6 text-center font-bold">진행한 라운드가 없어 우승팀이 없어요.</Card>
      )}

      <section>
        <h2 className="mb-2 font-display text-2xl">팀 순위</h2>
        <ol className="flex flex-col gap-2">
          {results.teams.map((t) => (
            <li key={t.id} className={`rounded-2xl border-[3px] border-ink bg-white p-3 ${t.id === myTeamId ? 'ring-4 ring-sun' : ''} shadow-pop-sm`}>
              <div className="flex items-center gap-2">
                <span className="w-7 font-display text-2xl">{t.rank}</span>
                <TeamBadge team={t} />
                <span className="text-xs text-muted">
                  {t.memberCount}명 · 완벽 {t.perfects}회{t.avgDeltaE !== null ? ` · 평균 ΔE ${t.avgDeltaE}` : ''}
                </span>
                <span className="ml-auto font-display text-3xl tabular-nums">{t.score}</span>
              </div>
              <div className="mt-2 h-3 overflow-hidden rounded-full border-2 border-ink bg-paper">
                <div className="h-full" style={{ width: `${(t.score / max) * 100}%`, background: t.color }} />
              </div>
            </li>
          ))}
        </ol>
      </section>

      {results.roundsPlayed > 0 && (
        <section>
          <h2 className="mb-2 font-display text-2xl">라운드별 점수</h2>
          <div className="overflow-x-auto rounded-2xl border-[3px] border-ink bg-white">
            <table className="w-full text-center text-sm">
              <thead>
                <tr className="bg-paper">
                  <th className="sticky left-0 bg-paper px-3 py-2 text-left">팀</th>
                  {results.roundTargets.map((r, i) => (
                    <th key={i} className="px-2 py-2">
                      <span className="mx-auto block size-5 rounded-md border-2 border-ink" style={{ background: r.hex }} title={r.name} />
                      <span className="block text-[10px] font-normal text-muted">
                        {i + 1}·{r.name}
                      </span>
                    </th>
                  ))}
                  <th className="px-3 py-2">합계</th>
                </tr>
              </thead>
              <tbody>
                {results.teams.map((t) => (
                  <tr key={t.id} className="border-t-2 border-line">
                    <td className="sticky left-0 bg-white px-3 py-2 text-left font-bold whitespace-nowrap">
                      <span className="mr-1.5 inline-block size-3 rounded-full border border-ink align-middle" style={{ background: t.color }} />
                      {t.name}
                    </td>
                    {t.roundScores.map((s, i) => (
                      <td key={i} className="px-2 py-2 tabular-nums">
                        {s}
                      </td>
                    ))}
                    <td className="px-3 py-2 font-bold tabular-nums">{t.score}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        {results.mvp && (
          <Card className="p-4">
            <div className="text-sm font-bold text-muted">⭐ MVP</div>
            <div className="mt-1 font-display text-3xl">{results.mvp.nickname}</div>
            <div className="mt-1 text-sm">
              {results.mvp.total}점 · 완벽 {results.mvp.perfects}회
              {teamOf(results.mvp.teamId) && <span className="ml-2"><TeamBadge team={teamOf(results.mvp.teamId)!} /></span>}
            </div>
          </Card>
        )}
        {results.bestMatch && (
          <Card className="p-4">
            <div className="text-sm font-bold text-muted">🎯 가장 정확한 매칭</div>
            <div className="mt-2 flex items-center gap-3">
              <div className="size-14 rounded-2xl border-[3px] border-ink" style={{ background: results.bestMatch.targetHex }} title="목표" />
              {results.bestMatch.thumb ? (
                <Thumb b64={results.bestMatch.thumb} className="size-14" />
              ) : (
                <div className="size-14 rounded-2xl border-[3px] border-ink" style={{ background: results.bestMatch.hex }} />
              )}
              <div className="min-w-0">
                <div className="truncate font-bold">{results.bestMatch.nickname}</div>
                <div className="text-sm text-muted">
                  {results.bestMatch.targetName} · ΔE {results.bestMatch.deltaE}
                </div>
              </div>
            </div>
          </Card>
        )}
      </div>

      <section>
        <h2 className="mb-2 font-display text-2xl">개인 순위</h2>
        <ol className="flex flex-col divide-y-2 divide-line overflow-hidden rounded-2xl border-[3px] border-ink bg-white">
          {results.players.map((p) => {
            const t = teamOf(p.teamId);
            return (
              <li key={p.id} className={`flex items-center gap-3 px-3 py-2.5 ${p.id === meId ? 'bg-sun/30' : ''}`}>
                <span className="w-6 text-center font-display text-lg">{p.rank}</span>
                <span className="min-w-0 flex-1 truncate font-bold">{p.nickname}</span>
                {t && <span className="size-3 shrink-0 rounded-full border border-ink" style={{ background: t.color }} title={t.name} />}
                <span className="text-xs text-muted">
                  {p.submissions}/{results.roundsPlayed}회
                </span>
                <span className="w-14 text-right font-display text-xl tabular-nums">{p.total}</span>
              </li>
            );
          })}
        </ol>
      </section>
    </div>
  );
}
