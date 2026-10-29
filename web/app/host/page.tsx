'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import {
  LIMITS,
  MIN_PLAYERS_TO_START,
  TEAM_NAME_MAX,
  TOLERANCE_PRESETS,
  type GameSettings,
  type PublicPlayer,
  type RoomSnapshot,
} from '@color-hunter/shared';
import { ConnectionBanner, NoticeToast, PrefsButtons, QrBox, TeamBadge, TimeBar } from '@/components/common';
import { CountdownOverlay, Results, RoundReveal, Scoreboard } from '@/components/game';
import { Logo, LogoMark } from '@/components/Logo';
import { Button, Card, Notice, Segmented, Spinner, Toggle } from '@/components/ui';
import { ApiError, createRoom } from '@/lib/api';
import { readableOn } from '@/lib/color-ui';
import { isLoopbackUrl, joinUrl, path } from '@/lib/config';
import { fx } from '@/lib/fx';
import { errorText, type RoomClient, type RoomView } from '@/lib/room-client';
import { tokens } from '@/lib/storage';
import { useCodeParam, useRemaining, useRoom } from '@/lib/useRoom';

export default function HostPage() {
  const code = useCodeParam();
  if (code === undefined) return <Centered><Spinner /></Centered>;
  if (code === null)
    return (
      <Centered>
        <Card className="p-6 text-center">
          <p className="font-bold">방 주소가 올바르지 않아요.</p>
          <Link href="/" className="mt-4 inline-block font-bold underline">
            홈으로
          </Link>
        </Card>
      </Centered>
    );
  return <HostGate code={code} />;
}

function Centered({ children }: { children: React.ReactNode }) {
  return <main className="safe-x grid min-h-dvh place-items-center">{children}</main>;
}

function HostGate({ code }: { code: string }) {
  const [token] = useState(() => tokens.host(code));
  if (!token)
    return (
      <Centered>
        <Card className="flex max-w-sm flex-col items-center gap-4 p-6 text-center">
          <p className="font-bold">이 기기에는 방 {code}의 호스트 권한이 없어요.</p>
          <p className="text-sm text-muted">호스트 권한은 방을 만든 기기(브라우저)에만 있어요.</p>
          <Link href={`/play/?code=${code}`} className="font-bold underline">
            플레이어로 참가하기
          </Link>
        </Card>
      </Centered>
    );
  return <Host code={code} token={token} />;
}

function Host({ code, token }: { code: string; token: string }) {
  const { client, view } = useRoom(code, token, (t) => {
    if (!t) tokens.setHost(code, null);
  });
  const s = view.snapshot;
  if (view.fatal)
    return (
      <Centered>
        <Card className="flex max-w-sm flex-col items-center gap-4 p-6 text-center">
          <p className="font-bold">{view.fatal === 'invalid_token' ? '호스트 권한을 확인하지 못했어요.' : errorText(view.fatal)}</p>
          <Link href="/" className="font-bold underline">
            홈에서 새 방 만들기
          </Link>
        </Card>
      </Centered>
    );
  if (!client || !s || view.role !== 'host')
    return (
      <>
        <ConnectionBanner status={view.status} />
        <Centered>
          <div className="flex flex-col items-center gap-3 font-bold">
            <Spinner /> 방에 연결하는 중…
          </div>
        </Centered>
      </>
    );
  return (
    <>
      <ConnectionBanner status={view.status} />
      <NoticeToast notice={view.notice} />
      {s.phase === 'lobby' ? <Lobby client={client} s={s} code={code} /> : <HostGame client={client} s={s} view={view} />}
    </>
  );
}

// ---------------- 대기실 ----------------

function Lobby({ client, s, code }: { client: RoomClient; s: RoomSnapshot; code: string }) {
  const url = joinUrl(code);
  const local = isLoopbackUrl(url);
  const [copied, setCopied] = useState(false);
  const teamsWithPlayers = new Set(s.players.map((p) => p.teamId)).size;
  const canStart = s.players.length >= MIN_PLAYERS_TO_START && teamsWithPlayers >= 2;

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = url;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  }

  return (
    <main className="safe-x safe-top mx-auto max-w-6xl pb-32">
      <header className="flex items-center justify-between py-3">
        <Logo />
        <PrefsButtons />
      </header>
      <div className="grid gap-5 lg:grid-cols-[minmax(0,380px)_1fr]">
        <div className="flex flex-col gap-5">
          <Card className="flex flex-col items-center gap-4 p-5">
            <div className="text-center">
              <div className="text-sm font-bold text-muted">방 코드</div>
              <div className="font-display text-5xl tracking-[0.2em]">{code}</div>
            </div>
            <QrBox url={url} size={220} />
            <div className="w-full truncate rounded-xl bg-paper px-3 py-2 text-center text-xs font-bold text-muted">{url}</div>
            <div className="grid w-full grid-cols-2 gap-2">
              <Button variant="secondary" size="sm" onClick={copy}>
                {copied ? '복사됨 ✓' : '링크 복사'}
              </Button>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => {
                  if (navigator.share) navigator.share({ title: 'Color Hunter', text: `방 코드 ${code}`, url }).catch(() => {});
                  else copy();
                }}
              >
                공유하기
              </Button>
            </div>
            {local && (
              <Notice tone="warn">
                지금 주소({new URL(url).host})는 이 컴퓨터에서만 열려요. 휴대폰으로 참가하려면 배포된 주소에서 방을 만들거나 NEXT_PUBLIC_SITE_URL을 설정해 주세요.
              </Notice>
            )}
            <a href={`../play/?code=${code}`} target="_blank" rel="noreferrer" className="text-sm font-bold underline">
              이 기기로 나도 참가하기 ↗
            </a>
          </Card>
          <Settings client={client} s={s} />
        </div>
        <Teams client={client} s={s} />
      </div>

      <div className="fixed inset-x-0 bottom-0 z-40 border-t-[3px] border-ink bg-paper/95 backdrop-blur safe-x safe-bottom pt-3">
        <div className="mx-auto flex max-w-6xl items-center gap-3">
          <div className="min-w-0 flex-1 text-sm font-bold">
            {canStart ? (
              <>
                {s.players.length}명 · {teamsWithPlayers}팀 준비 완료!
              </>
            ) : (
              <span className="text-muted">2개 이상의 팀에 참가자가 있어야 시작할 수 있어요</span>
            )}
          </div>
          <Button size="lg" disabled={!canStart} onClick={() => client.command({ t: 'start' })} className="shrink-0">
            게임 시작 ▶
          </Button>
        </div>
      </div>
    </main>
  );
}

function useDebouncedSettings(client: RoomClient, current: GameSettings) {
  const [draft, setDraft] = useState(current);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pending = useRef(false);
  useEffect(() => {
    if (!pending.current) setDraft(current);
  }, [current]);
  function change(patch: Partial<GameSettings>, immediate = false) {
    setDraft((d) => ({ ...d, ...patch }));
    pending.current = true;
    if (timer.current) clearTimeout(timer.current);
    const send = () => {
      pending.current = false;
      client.command({ t: 'settings', settings: patch });
    };
    if (immediate) send();
    else timer.current = setTimeout(send, 300);
  }
  return [draft, change] as const;
}

function Settings({ client, s }: { client: RoomClient; s: RoomSnapshot }) {
  const [d, change] = useDebouncedSettings(client, s.settings);
  return (
    <Card className="flex flex-col gap-4 p-5">
      <h2 className="font-display text-2xl">게임 설정</h2>
      <Range label="라운드 수" value={d.rounds} min={LIMITS.rounds[0]} max={LIMITS.rounds[1]} unit="라운드" onChange={(v) => change({ rounds: v })} />
      <Range label="제한시간" value={d.roundSeconds} min={LIMITS.roundSeconds[0]} max={LIMITS.roundSeconds[1]} step={5} unit="초" onChange={(v) => change({ roundSeconds: v })} />
      <Range label="팀 수" value={d.teamCount} min={LIMITS.teamCount[0]} max={LIMITS.teamCount[1]} unit="팀" onChange={(v) => change({ teamCount: v })} />
      <Range label="최대 인원" value={d.maxPlayers} min={Math.max(LIMITS.maxPlayers[0], s.players.length)} max={LIMITS.maxPlayers[1]} unit="명" onChange={(v) => change({ maxPlayers: v })} />
      <Field label="난이도" hint="어려움은 비슷한 색(코랄·머스터드·데님 등)이 섞여 나와요">
        <Segmented
          label="난이도"
          value={d.difficulty}
          options={[
            { value: 'easy', label: '쉬움' },
            { value: 'normal', label: '보통' },
            { value: 'hard', label: '어려움' },
          ]}
          onChange={(v) => change({ difficulty: v }, true)}
        />
      </Field>
      <Field label="색 판정" hint="관대: 밝기·그림자 차이에 너그러움 / 엄격: 반대색은 0점">
        <Segmented
          label="색 판정"
          value={d.tolerance}
          options={(['lenient', 'standard', 'strict'] as const).map((v) => ({ value: v, label: TOLERANCE_PRESETS[v].label }))}
          onChange={(v) => change({ tolerance: v }, true)}
        />
      </Field>
      <Field label="팀 점수 계산" hint="평균: 팀 인원이 다를 때 공평하게">
        <Segmented
          label="팀 점수 계산"
          value={d.teamScoring}
          options={[
            { value: 'sum', label: '합계' },
            { value: 'average', label: '평균' },
          ]}
          onChange={(v) => change({ teamScoring: v }, true)}
        />
      </Field>
      <Toggle label="시간 보너스 (최대 20점)" checked={d.timeBonus} onChange={(v) => change({ timeBonus: v }, true)} />
    </Card>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="font-bold">{label}</div>
      {children}
      {hint && <div className="text-xs text-muted">{hint}</div>}
    </div>
  );
}

function Range({
  label,
  value,
  min,
  max,
  step = 1,
  unit,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  unit: string;
  onChange: (v: number) => void;
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="flex items-baseline justify-between font-bold">
        {label}
        <span className="font-display text-xl tabular-nums">
          {value}
          <span className="ml-0.5 text-sm">{unit}</span>
        </span>
      </span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} className="h-8 w-full accent-ink" />
    </label>
  );
}

function Teams({ client, s }: { client: RoomClient; s: RoomSnapshot }) {
  const [selected, setSelected] = useState<string | null>(null);
  return (
    <Card className="flex flex-col gap-4 p-5">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="font-display text-2xl">
          참가자 {s.players.length}/{s.settings.maxPlayers}
        </h2>
        <Button variant="secondary" size="sm" className="ml-auto" disabled={s.players.length < 2} onClick={() => client.command({ t: 'team:shuffle' })}>
          🔀 자동 균등 배정
        </Button>
      </div>
      {s.players.length === 0 && (
        <div className="rounded-2xl border-2 border-dashed border-ink/40 p-6 text-center font-bold text-muted">QR 코드를 찍어 참가를 기다리는 중…</div>
      )}
      <p className="text-xs text-muted">참가자 이름을 누르면 팀을 옮기거나 내보낼 수 있어요. 팀 이름을 눌러 바꿀 수 있어요.</p>
      <div className="grid gap-3 sm:grid-cols-2">
        {s.teams.map((t) => {
          const members = s.players.filter((p) => p.teamId === t.id);
          return (
            <div key={t.id} className="overflow-hidden rounded-2xl border-[3px] border-ink bg-white shadow-pop-sm">
              <div className="flex items-center gap-2 px-3 py-2" style={{ background: t.color, color: readableOn(t.color) }}>
                <TeamName client={client} teamId={t.id} name={t.name} />
                <span className="ml-auto rounded-full bg-white/90 px-2 text-sm font-bold text-ink">{members.length}명</span>
              </div>
              <ul className="flex min-h-14 flex-wrap gap-1.5 p-3">
                {members.map((p) => (
                  <PlayerChip key={p.id} p={p} selected={selected === p.id} onClick={() => setSelected(selected === p.id ? null : p.id)} />
                ))}
              </ul>
              {members.some((m) => m.id === selected) && (
                <MoveMenu
                  s={s}
                  playerId={selected!}
                  onMove={(teamId) => {
                    client.command({ t: 'team:move', playerId: selected!, teamId });
                    setSelected(null);
                  }}
                  onKick={() => {
                    const p = s.players.find((x) => x.id === selected);
                    if (p && confirm(`${p.nickname} 님을 내보낼까요?`)) {
                      client.command({ t: 'kick', playerId: p.id });
                      setSelected(null);
                    }
                  }}
                />
              )}
            </div>
          );
        })}
      </div>
    </Card>
  );
}

function PlayerChip({ p, selected, onClick }: { p: PublicPlayer; selected?: boolean; onClick?: () => void }) {
  return (
    <li>
      <button
        type="button"
        onClick={onClick}
        aria-pressed={selected}
        className={`flex min-h-9 items-center gap-1.5 rounded-full border-2 border-ink px-3 text-sm font-bold ${selected ? 'bg-ink text-white' : 'bg-paper'}`}
      >
        <span className={`size-2.5 rounded-full border border-ink ${p.connected ? 'bg-leaf' : 'bg-line'}`} aria-label={p.connected ? '접속 중' : '연결 끊김'} />
        {p.nickname}
      </button>
    </li>
  );
}

function MoveMenu({ s, playerId, onMove, onKick }: { s: RoomSnapshot; playerId: string; onMove: (teamId: number) => void; onKick: () => void }) {
  const p = s.players.find((x) => x.id === playerId)!;
  return (
    <div className="anim-rise flex flex-wrap items-center gap-1.5 border-t-[3px] border-ink bg-paper p-3">
      <span className="mr-1 text-xs font-bold">이동:</span>
      {s.teams
        .filter((t) => t.id !== p.teamId)
        .map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => onMove(t.id)}
            className="min-h-9 rounded-full border-2 border-ink px-3 text-sm font-bold"
            style={{ background: t.color, color: readableOn(t.color) }}
          >
            {t.name}
          </button>
        ))}
      <button type="button" onClick={onKick} className="ml-auto min-h-9 rounded-full border-2 border-ink bg-tomato px-3 text-sm font-bold text-white">
        내보내기
      </button>
    </div>
  );
}

function TeamName({ client, teamId, name }: { client: RoomClient; teamId: number; name: string }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(name);
  useEffect(() => setValue(name), [name]);
  if (!editing)
    return (
      <button type="button" className="font-display text-xl" onClick={() => setEditing(true)} aria-label={`${name} 팀 이름 바꾸기`}>
        {name} ✎
      </button>
    );
  const commit = () => {
    setEditing(false);
    const v = value.trim();
    if (v && v !== name) client.command({ t: 'team:rename', teamId, name: v });
    else setValue(name);
  };
  return (
    <input
      autoFocus
      value={value}
      maxLength={TEAM_NAME_MAX}
      onChange={(e) => setValue(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') commit();
        if (e.key === 'Escape') {
          setValue(name);
          setEditing(false);
        }
      }}
      className="w-32 rounded-lg border-2 border-ink bg-white px-2 py-0.5 font-display text-lg text-ink"
      aria-label="팀 이름"
    />
  );
}

// ---------------- 게임 진행 ----------------

function HostGame({ client, s, view }: { client: RoomClient; s: RoomSnapshot; view: RoomView }) {
  const round = s.round;
  const deadline =
    s.phase === 'countdown' ? round?.startsAt ?? null : s.phase === 'hunting' ? round?.endsAt ?? null : s.phase === 'reveal' ? round?.revealUntil ?? null : null;
  const remaining = useRemaining(client, deadline, s.pausedRemainingMs);
  const [creating, setCreating] = useState(false);
  const prev = useRef(s.phase);
  useEffect(() => {
    if (prev.current !== s.phase && s.phase === 'hunting') fx.go();
    prev.current = s.phase;
  }, [s.phase]);

  async function newRoom() {
    setCreating(true);
    try {
      const room = await createRoom();
      tokens.setHost(room.code, room.hostToken);
      // 같은 페이지에서 쿼리만 바뀌므로 새로 불러와 새 방으로 연결
      location.href = path(`/host/?code=${room.code}`);
    } catch (e) {
      alert(e instanceof ApiError ? e.message : '방을 만들지 못했어요.');
      setCreating(false);
    }
  }

  const playing = s.phase === 'countdown' || s.phase === 'hunting' || s.phase === 'reveal';
  const submitted = s.players.filter((p) => p.submitted).length;

  return (
    <main className="safe-x safe-top safe-bottom mx-auto max-w-6xl pb-6">
      <header className="flex flex-wrap items-center gap-3 py-3">
        <LogoMark className="size-10" />
        <div className="leading-tight">
          <div className="text-xs font-bold text-muted">방 {s.code}</div>
          <div className="font-display text-xl">
            {s.phase === 'finished' ? '최종 결과' : `라운드 ${(round?.index ?? 0) + 1} / ${s.totalRounds}`}
          </div>
        </div>
        {playing && (
          <div className="ml-auto flex flex-wrap gap-2">
            {s.paused ? (
              <Button size="sm" onClick={() => client.command({ t: 'resume' })}>
                ▶ 재개
              </Button>
            ) : (
              <Button variant="secondary" size="sm" onClick={() => client.command({ t: 'pause' })}>
                ⏸ 일시정지
              </Button>
            )}
            <Button variant="secondary" size="sm" onClick={() => client.command({ t: 'skip' })}>
              {s.phase === 'reveal' ? '다음 ⏭' : '라운드 건너뛰기 ⏭'}
            </Button>
            <Button
              variant="danger"
              size="sm"
              onClick={() => {
                if (confirm('게임을 지금 끝내고 결과를 발표할까요?')) client.command({ t: 'end' });
              }}
            >
              게임 종료
            </Button>
            <PrefsButtons />
          </div>
        )}
      </header>

      {s.paused && (
        <div className="mb-4 rounded-2xl border-[3px] border-ink bg-sun px-4 py-3 text-center font-display text-2xl" role="status">
          ⏸ 일시정지 · 남은 시간 {Math.ceil((s.pausedRemainingMs ?? 0) / 1000)}초
        </div>
      )}

      {s.phase === 'countdown' && round && (
        <Card className="flex min-h-[50vh] flex-col">
          <CountdownOverlay remaining={remaining} round={round.index} total={s.totalRounds} />
        </Card>
      )}

      {s.phase === 'hunting' && round?.target && (
        <div className="grid gap-5 lg:grid-cols-[1fr_380px]">
          <Card className="flex flex-col gap-5 p-6">
            <div className="text-lg font-bold text-muted">이 색을 찾아 찍어라!</div>
            <div className="flex flex-wrap items-center gap-6">
              <div className="anim-pop size-40 rounded-[2rem] border-[4px] border-ink shadow-pop-lg sm:size-56" style={{ background: round.target.hex }} aria-hidden />
              <div>
                <div className="font-display text-6xl sm:text-7xl">{round.target.name}</div>
                <div className="mt-1 font-bold text-muted">{round.target.hex}</div>
              </div>
              <div className={`ml-auto font-display text-8xl tabular-nums ${remaining <= 5000 ? 'anim-urgent text-tomato' : ''}`} aria-label="남은 시간">
                {Math.ceil(remaining / 1000)}
              </div>
            </div>
            <TimeBar remaining={remaining} total={s.settings.roundSeconds * 1000} paused={s.paused} />
            <div>
              <div className="mb-2 font-bold">
                제출 {submitted} / {s.players.length}
              </div>
              <ul className="flex flex-wrap gap-1.5">
                {s.players.map((p) => {
                  const t = s.teams.find((x) => x.id === p.teamId)!;
                  return (
                    <li
                      key={p.id}
                      className={`flex items-center gap-1.5 rounded-full border-2 border-ink px-3 py-1 text-sm font-bold ${p.submitted ? 'bg-leaf text-white' : 'bg-paper'} ${p.connected ? '' : 'opacity-45'}`}
                    >
                      <span className="size-2.5 rounded-full border border-ink" style={{ background: t.color }} aria-hidden />
                      {p.nickname}
                      {p.submitted ? ' ✓' : p.connected ? '' : ' (끊김)'}
                    </li>
                  );
                })}
              </ul>
            </div>
          </Card>
          <div>
            <h2 className="mb-2 font-display text-2xl">팀 점수</h2>
            <Scoreboard teams={s.teams} players={s.players} showSubmitted />
          </div>
        </div>
      )}

      {s.phase === 'reveal' && s.lastRound && (
        <div className="grid gap-5 lg:grid-cols-[1fr_380px]">
          <RoundReveal summary={s.lastRound} teams={s.teams} players={s.players} remaining={remaining} isLast={s.lastRound.index + 1 >= s.totalRounds} />
          <div>
            <h2 className="mb-2 font-display text-2xl">누적 팀 점수</h2>
            <Scoreboard teams={s.teams} players={s.players} />
          </div>
        </div>
      )}

      {s.phase === 'finished' && s.results && (
        <div className="mx-auto flex max-w-2xl flex-col gap-5">
          <Results results={s.results} />
          <div className="grid grid-cols-2 gap-3">
            <Button size="lg" onClick={() => client.command({ t: 'restart' })}>
              다시 플레이
            </Button>
            <Button variant="secondary" size="lg" onClick={newRoom} disabled={creating}>
              {creating ? <Spinner /> : '새 방 만들기'}
            </Button>
          </div>
          <p className="text-center text-sm text-muted">다시 플레이: 같은 방·같은 참가자로 대기실로 돌아가요.</p>
        </div>
      )}
      {view.status !== 'open' && <p className="mt-4 text-center text-sm text-muted">연결이 돌아오면 자동으로 최신 상태를 불러와요.</p>}
    </main>
  );
}
