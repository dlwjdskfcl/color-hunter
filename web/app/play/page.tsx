'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { NICKNAME_MAX, type RoomSnapshot } from '@color-hunter/shared';
import { CameraHunt } from '@/components/CameraHunt';
import { ConnectionBanner, NoticeToast, PrefsButtons, TeamBadge, TimeBar } from '@/components/common';
import { CountdownOverlay, Results, RoundReveal, Scoreboard } from '@/components/game';
import { LogoMark } from '@/components/Logo';
import { Button, Card, Notice, Spinner } from '@/components/ui';
import { ApiError, roomInfo } from '@/lib/api';
import { stopCamera } from '@/lib/camera';
import { readableOn } from '@/lib/color-ui';
import { fx, unlockAudio } from '@/lib/fx';
import { errorText, type RoomClient, type RoomView } from '@/lib/room-client';
import { lastNickname, tokens } from '@/lib/storage';
import { useCodeParam, useRemaining, useRoom } from '@/lib/useRoom';

export default function PlayPage() {
  const code = useCodeParam();
  if (code === undefined) return <Centered><Spinner /></Centered>;
  if (code === null)
    return (
      <Centered>
        <Card className="p-6 text-center">
          <p className="font-bold">참가 링크가 올바르지 않아요.</p>
          <Link href="/" className="mt-4 inline-block font-bold underline">
            홈에서 방 코드로 참가하기
          </Link>
        </Card>
      </Centered>
    );
  return <Player code={code} />;
}

function Centered({ children }: { children: React.ReactNode }) {
  return <main className="safe-x grid min-h-dvh place-items-center">{children}</main>;
}

function Player({ code }: { code: string }) {
  const [initialToken] = useState(() => tokens.player(code));
  const { client, view } = useRoom(code, initialToken, (t) => tokens.setPlayer(code, t));
  const s = view.snapshot;

  // 카메라는 게임이 끝나거나 화면을 떠날 때 끔
  useEffect(() => () => stopCamera(), []);
  useEffect(() => {
    if (s?.phase === 'finished' || s?.phase === 'lobby') stopCamera();
  }, [s?.phase]);

  if (view.fatal) return <Fatal code={code} fatal={view.fatal} />;
  if (!client) return <Centered><Spinner /></Centered>;
  if (!view.role)
    return (
      <>
        <ConnectionBanner status={view.status} />
        {initialToken && view.status !== 'open' ? (
          <Centered>
            <div className="flex flex-col items-center gap-3 font-bold">
              <Spinner /> 방에 다시 들어가는 중…
            </div>
          </Centered>
        ) : (
          <JoinForm code={code} client={client} ready={view.status === 'open'} />
        )}
      </>
    );
  if (!s)
    return (
      <Centered>
        <Spinner />
      </Centered>
    );
  return (
    <>
      <ConnectionBanner status={view.status} />
      <NoticeToast notice={view.notice} />
      <Game client={client} view={view} s={s} code={code} />
    </>
  );
}

function Fatal({ code, fatal }: { code: string; fatal: NonNullable<RoomView['fatal']> }) {
  return (
    <Centered>
      <Card className="flex max-w-sm flex-col items-center gap-4 p-6 text-center">
        <div className="text-4xl" aria-hidden>
          {fatal === 'kicked' ? '👋' : '🔍'}
        </div>
        <p className="font-bold">{errorText(fatal)}</p>
        {(fatal === 'invalid_token' || fatal === 'kicked') && (
          <Button onClick={() => location.replace(`?code=${code}`)}>다시 참가하기</Button>
        )}
        <Link href="/" className="font-bold underline">
          홈으로
        </Link>
      </Card>
    </Centered>
  );
}

function JoinForm({ code, client, ready }: { code: string; client: RoomClient; ready: boolean }) {
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<{ phase: string; players: number; maxPlayers: number } | null>(null);
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    setName(lastNickname.get());
    roomInfo(code)
      .then(setInfo)
      .catch((e) => {
        if (e instanceof ApiError && e.code === 'not_found') setMissing(true);
      });
  }, [code]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    unlockAudio();
    const nick = name.trim();
    if (!nick) {
      setError('닉네임을 입력해 주세요.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await client.join(nick);
      lastNickname.set(nick);
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  const closed = info && info.phase !== 'lobby';
  const full = info && info.players >= info.maxPlayers;
  return (
    <main className="safe-x safe-top safe-bottom mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-5 py-6">
      <div className="flex items-center gap-3">
        <LogoMark className="size-12" />
        <div>
          <div className="text-sm font-bold text-muted">방 코드</div>
          <div className="font-display text-3xl tracking-widest">{code}</div>
        </div>
      </div>
      {missing ? (
        <Card className="p-6 text-center">
          <p className="font-bold">방을 찾을 수 없어요. 코드를 다시 확인해 주세요.</p>
          <Link href="/" className="mt-4 inline-block font-bold underline">
            홈으로
          </Link>
        </Card>
      ) : (
        <Card className="p-5">
          <form onSubmit={onSubmit} className="flex flex-col gap-4">
            <label htmlFor="nick" className="font-display text-2xl">
              닉네임을 정해 주세요
            </label>
            <input
              id="nick"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={NICKNAME_MAX * 2}
              autoComplete="nickname"
              enterKeyHint="go"
              placeholder="예: 색깔사냥꾼"
              className="min-h-14 rounded-2xl border-[3px] border-ink bg-paper px-4 text-xl font-bold focus:bg-white focus:outline-none"
            />
            <div className="text-xs text-muted">1~{NICKNAME_MAX}자 · 같은 방에서 겹치지 않게</div>
            {info && (
              <div className="text-sm font-bold">
                현재 {info.players}/{info.maxPlayers}명 참가 중
              </div>
            )}
            {closed && <Notice tone="warn">이미 게임이 시작됐어요. 이번 판이 끝나고 호스트가 &lsquo;다시 플레이&rsquo;를 누르면 참가할 수 있어요.</Notice>}
            {!closed && full && <Notice tone="warn">방 인원이 가득 찼어요.</Notice>}
            {error && <Notice tone="error">{error}</Notice>}
            <Button type="submit" size="lg" disabled={busy || !ready || !!closed}>
              {busy || !ready ? <Spinner /> : '입장하기'}
            </Button>
          </form>
        </Card>
      )}
    </main>
  );
}

function Game({ client, view, s, code }: { client: RoomClient; view: RoomView; s: RoomSnapshot; code: string }) {
  const me = s.players.find((p) => p.id === view.playerId);
  const team = me ? s.teams.find((t) => t.id === me.teamId) : undefined;
  const round = s.round;
  const deadline =
    s.phase === 'countdown' ? round?.startsAt ?? null : s.phase === 'hunting' ? round?.endsAt ?? null : s.phase === 'reveal' ? round?.revealUntil ?? null : null;
  const remaining = useRemaining(client, deadline, s.pausedRemainingMs);
  const prevPhase = useRef(s.phase);

  useEffect(() => {
    if (prevPhase.current !== s.phase) {
      if (s.phase === 'hunting') fx.go();
      prevPhase.current = s.phase;
    }
  }, [s.phase]);
  const timeUpFired = useRef<number | null>(null);
  useEffect(() => {
    if (s.phase === 'hunting' && remaining <= 0 && !view.mine && round && timeUpFired.current !== round.index) {
      timeUpFired.current = round.index;
      fx.timeUp();
    }
  }, [s.phase, remaining, view.mine, round]);

  const header = (
    <header className="flex items-center gap-2 py-2">
      <LogoMark className="size-9" />
      {team && <TeamBadge team={team} />}
      {team && <span className="font-display text-xl tabular-nums">{s.teams.find((t) => t.id === team.id)?.total ?? 0}점</span>}
      <div className="ml-auto">
        <PrefsButtons />
      </div>
    </header>
  );

  if (s.phase === 'lobby') {
    const roster = s.teams.filter((t) => s.players.some((p) => p.teamId === t.id));
    return (
      <main className="safe-x safe-top safe-bottom mx-auto flex min-h-dvh max-w-md flex-col gap-4">
        {header}
        {team && me && (
          <div className="anim-pop rounded-[2rem] border-[3px] border-ink p-6 text-center shadow-pop-lg" style={{ background: team.color, color: readableOn(team.color) }}>
            <div className="font-bold opacity-90">{me.nickname} 님은</div>
            <div className="mt-1 font-display text-5xl">{team.name}팀</div>
            <div className="mt-2 text-sm font-bold opacity-90">게임 시작을 기다리는 중…</div>
          </div>
        )}
        <Card className="p-4">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-display text-xl">참가자 {s.players.length}명</h2>
            <span className="text-sm font-bold text-muted">방 {code}</span>
          </div>
          <div className="flex flex-col gap-3">
            {roster.map((t) => (
              <div key={t.id}>
                <TeamBadge team={t} />
                <ul className="mt-2 flex flex-wrap gap-1.5">
                  {s.players
                    .filter((p) => p.teamId === t.id)
                    .map((p) => (
                      <li key={p.id} className={`rounded-full border-2 border-ink px-2.5 py-0.5 text-sm font-bold ${p.id === me?.id ? 'bg-sun' : 'bg-paper'} ${p.connected ? '' : 'opacity-50'}`}>
                        {p.nickname}
                      </li>
                    ))}
                </ul>
              </div>
            ))}
          </div>
        </Card>
        <Notice>
          게임 설정: {s.settings.rounds}라운드 · 라운드당 {s.settings.roundSeconds}초 · 난이도 {{ easy: '쉬움', normal: '보통', hard: '어려움' }[s.settings.difficulty]}
        </Notice>
        <Notice tone="warn">게임이 시작되면 카메라 권한을 물어봐요. &lsquo;허용&rsquo;을 눌러 주세요. 밝은 곳에서 할수록 정확해요.</Notice>
        <div className="mt-auto pb-2 text-center">
          <button
            type="button"
            className="text-sm font-bold text-muted underline"
            onClick={() => {
              if (confirm('방에서 나갈까요?')) {
                client.leave();
                location.href = '../';
              }
            }}
          >
            방 나가기
          </button>
        </div>
      </main>
    );
  }

  if (s.phase === 'finished' && s.results) {
    return (
      <main className="safe-x safe-top safe-bottom mx-auto flex max-w-xl flex-col gap-4">
        {header}
        <Results results={s.results} meId={view.playerId} myTeamId={me?.teamId} />
        <Notice>호스트가 &lsquo;다시 플레이&rsquo;를 누르면 같은 방에서 새 게임이 시작돼요.</Notice>
        <Link href="/" className="pb-4 text-center font-bold underline">
          홈으로
        </Link>
      </main>
    );
  }

  return (
    <main className="safe-x safe-top safe-bottom mx-auto flex h-dvh max-w-xl flex-col gap-3 overflow-hidden">
      {header}
      {s.paused && (
        <div className="rounded-2xl border-[3px] border-ink bg-sun px-4 py-2 text-center font-bold" role="status">
          ⏸ 호스트가 게임을 잠시 멈췄어요
        </div>
      )}
      {s.phase === 'countdown' && round && <CountdownOverlay remaining={remaining} round={round.index} total={s.totalRounds} />}

      {s.phase === 'hunting' && round?.target && (
        <>
          <div className="flex items-center gap-3 rounded-3xl border-[3px] border-ink bg-white p-3 shadow-pop">
            <div className="size-16 shrink-0 rounded-2xl border-[3px] border-ink shadow-pop-sm" style={{ background: round.target.hex }} aria-hidden />
            <div className="min-w-0 flex-1">
              <div className="text-xs font-bold text-muted">
                라운드 {round.index + 1}/{s.totalRounds} · 이 색을 찾아라!
              </div>
              <div className="truncate font-display text-3xl leading-tight">{round.target.name}</div>
            </div>
            <div
              className={`grid size-16 shrink-0 place-items-center rounded-full border-[3px] border-ink font-display text-3xl tabular-nums ${remaining <= 5000 ? 'anim-urgent bg-tomato text-white' : 'bg-paper'}`}
              aria-label={`남은 시간 ${Math.ceil(remaining / 1000)}초`}
            >
              {Math.ceil(remaining / 1000)}
            </div>
          </div>
          <TimeBar remaining={remaining} total={s.settings.roundSeconds * 1000} paused={s.paused} />
          <CameraHunt
            key={round.index}
            client={client}
            roundIndex={round.index}
            target={round.target}
            settings={s.settings}
            remaining={remaining}
            paused={s.paused}
            mine={view.mine}
          />
        </>
      )}

      {s.phase === 'reveal' && s.lastRound && (
        <div className="-mx-1 flex-1 overflow-y-auto px-1 pb-4">
          <RoundReveal
            summary={s.lastRound}
            teams={s.teams}
            players={s.players}
            meId={view.playerId}
            remaining={remaining}
            isLast={s.lastRound.index + 1 >= s.totalRounds}
          />
          <h3 className="mt-5 mb-2 font-bold">누적 팀 점수</h3>
          <Scoreboard teams={s.teams} players={s.players} compact highlightTeam={me?.teamId} />
        </div>
      )}
    </main>
  );
}
