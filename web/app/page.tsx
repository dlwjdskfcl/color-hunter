'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { CODE_PATTERN, DEFAULT_SCORE_BANDS, MAX_TIME_BONUS, BONUS_MIN_COLOR_SCORE, normalizeCode } from '@color-hunter/shared';
import { Logo } from '@/components/Logo';
import { Button, Card, Notice, Spinner } from '@/components/ui';
import { ApiError, createRoom, roomInfo } from '@/lib/api';
import { tokens } from '@/lib/storage';

const STEPS = [
  { n: 1, color: 'bg-tomato', title: '방 만들기', body: '호스트가 방을 만들고 화면의 QR 코드를 보여줘요.' },
  { n: 2, color: 'bg-sun', title: 'QR로 참가', body: '참가자는 휴대폰 카메라로 QR을 찍고 닉네임만 입력하면 끝.' },
  { n: 3, color: 'bg-leaf', title: '색 찾기', body: '목표 색이 뜨면 주변에서 같은 색을 찾아 찍어요.' },
  { n: 4, color: 'bg-sky', title: '팀 점수', body: '색이 가까울수록, 빨리 찍을수록 팀 점수가 올라가요.' },
];

export default function Home() {
  const router = useRouter();
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState<'create' | 'join' | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function onCreate() {
    setBusy('create');
    setError(null);
    try {
      const room = await createRoom();
      tokens.setHost(room.code, room.hostToken);
      router.push(`/host/?code=${room.code}`);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : '방을 만들지 못했어요.');
      setBusy(null);
    }
  }

  async function onJoin(e: React.FormEvent) {
    e.preventDefault();
    const c = normalizeCode(code);
    if (!CODE_PATTERN.test(c)) {
      setError('방 코드 6자리를 정확히 입력해 주세요. (숫자 0·1, 영문 O·I·L은 쓰지 않아요)');
      return;
    }
    setBusy('join');
    setError(null);
    try {
      const info = await roomInfo(c);
      if (info.phase !== 'lobby' && !tokens.player(c)) {
        setError('이미 게임이 진행 중인 방이에요. 다음 판에 참가해 주세요.');
        setBusy(null);
        return;
      }
      router.push(`/play/?code=${c}`);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : '방을 확인하지 못했어요.');
      setBusy(null);
    }
  }

  return (
    <main className="safe-x safe-top safe-bottom mx-auto flex max-w-xl flex-col gap-5 py-6">
      <header className="anim-rise">
        <Logo size="lg" />
        <p className="mt-4 text-lg font-bold leading-snug">
          목표 색을 주변에서 찾아 찍어라!
          <br />
          스마트폰 하나로 하는 <span className="rounded-md bg-sun px-1">팀 대항 색깔 사냥</span>
        </p>
      </header>

      <Card className="flex flex-col gap-4 p-5">
        <Button size="lg" onClick={onCreate} disabled={busy !== null}>
          {busy === 'create' ? <Spinner /> : '＋'} 방 만들기
        </Button>
        <div className="flex items-center gap-3 text-sm font-bold text-muted">
          <span className="h-[3px] flex-1 rounded bg-line" /> 또는 코드로 참가 <span className="h-[3px] flex-1 rounded bg-line" />
        </div>
        <form onSubmit={onJoin} className="flex gap-2">
          <label htmlFor="code" className="sr-only">
            방 코드
          </label>
          <input
            id="code"
            value={code}
            onChange={(e) => setCode(normalizeCode(e.target.value))}
            inputMode="text"
            autoCapitalize="characters"
            autoComplete="off"
            spellCheck={false}
            placeholder="ABC234"
            maxLength={6}
            className="min-h-14 w-full min-w-0 flex-1 rounded-2xl border-[3px] border-ink bg-paper px-4 text-center font-display text-2xl tracking-[0.3em] uppercase placeholder:text-muted/40 focus:bg-white focus:outline-none"
          />
          <Button type="submit" variant="dark" size="lg" disabled={busy !== null} className="shrink-0">
            {busy === 'join' ? <Spinner className="border-white border-t-transparent" /> : '참가'}
          </Button>
        </form>
        {error && <Notice tone="error">{error}</Notice>}
      </Card>

      <section aria-labelledby="how" className="flex flex-col gap-3">
        <h2 id="how" className="font-display text-2xl">
          이렇게 놀아요
        </h2>
        <ol className="grid grid-cols-2 gap-3">
          {STEPS.map((s) => (
            <li key={s.n} className="rounded-2xl border-[3px] border-ink bg-white p-3 shadow-pop-sm">
              <span className={`grid size-8 place-items-center rounded-full border-[3px] border-ink font-display ${s.color}`}>{s.n}</span>
              <div className="mt-2 font-bold">{s.title}</div>
              <p className="mt-1 text-sm leading-snug text-muted">{s.body}</p>
            </li>
          ))}
        </ol>
      </section>

      <details className="group rounded-2xl border-[3px] border-ink bg-white p-4 shadow-pop-sm">
        <summary className="cursor-pointer list-none font-display text-xl">
          점수 규칙 <span className="float-right transition-transform group-open:rotate-180">▾</span>
        </summary>
        <div className="mt-3 flex flex-col gap-3 text-sm leading-relaxed">
          <p>
            찍은 사진의 분석 영역에서 대표색을 뽑아 목표 색과의 차이(<b>CIE Lab · ΔE2000</b>)를 계산해요. 숫자가 작을수록 비슷한 색이에요.
          </p>
          <table className="w-full overflow-hidden rounded-xl border-2 border-ink text-center">
            <thead className="bg-paper">
              <tr>
                <th className="py-1">색 차이(ΔE)</th>
                <th className="py-1">색상 점수</th>
              </tr>
            </thead>
            <tbody>
              {DEFAULT_SCORE_BANDS.map((b, i) => (
                <tr key={b.maxDeltaE} className="border-t border-line">
                  <td className="py-1">
                    {i === 0 ? '' : `${DEFAULT_SCORE_BANDS[i - 1].maxDeltaE} 초과 `}
                    {b.maxDeltaE} 이하
                  </td>
                  <td className="py-1 font-bold">{b.points}점</td>
                </tr>
              ))}
              <tr className="border-t border-line">
                <td className="py-1">{DEFAULT_SCORE_BANDS.at(-1)!.maxDeltaE} 초과</td>
                <td className="py-1 font-bold">0점</td>
              </tr>
            </tbody>
          </table>
          <p>
            <b>시간 보너스</b> 최대 {MAX_TIME_BONUS}점: 남은 시간에 비례해요. 색상 점수 {BONUS_MIN_COLOR_SCORE}점 이상일 때만 받을 수 있어요. 제한시간이 지나면 제출이 무효예요.
          </p>
          <p>
            <b>팀 점수</b>는 팀원 점수의 합이에요(호스트가 &lsquo;평균&rsquo;으로 바꿀 수 있어요). 동점이면 ① 완벽 매칭(100점) 횟수 ② 평균 색 차이가 작은 팀 순, 그래도 같으면 공동 우승이에요.
          </p>
          <Notice tone="warn">
            카메라 색은 조명·그림자·반사·화이트밸런스에 따라 달라져요. 판정은 <b>근사치</b>이고, 모두에게 같은 방식으로 적용돼요. 밝고 고른 빛에서, 물체가 분석 영역을 꽉 채우게 찍으면 정확해져요.
          </Notice>
          <p className="text-muted">
            🔒 사진은 휴대폰 안에서 분석해요. 서버에는 분석 영역을 32×32로 줄인 색 정보만 보내고, 라운드 최고 기록만 게임이 끝날 때까지 보관해요.
          </p>
        </div>
      </details>

      <footer className="pb-2 text-center text-xs text-muted">Color Hunter · 독립 제작 파티 게임</footer>
    </main>
  );
}
