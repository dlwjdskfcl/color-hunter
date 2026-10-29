'use client';

import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import QRCode from 'qrcode';
import type { PublicTeam } from '@color-hunter/shared';
import { drawThumb } from '@/lib/analyze';
import { getPrefs, setPrefs, subscribePrefs, unlockAudio } from '@/lib/fx';
import type { ConnStatus, RoomView } from '@/lib/room-client';
import { readableOn } from '@/lib/color-ui';

/** 연결 상태 띠 — 끊김/재접속/오프라인을 숨기지 않고 표시 */
export function ConnectionBanner({ status }: { status: ConnStatus }) {
  const [online, setOnline] = useState(true);
  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    update();
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => {
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
    };
  }, []);
  let text: string | null = null;
  if (!online || status === 'offline') text = '인터넷 연결이 끊겼어요. 실시간 게임은 온라인에서만 진행돼요.';
  else if (status === 'reconnecting') text = '서버와 다시 연결하는 중… 점수와 진행 상황은 유지돼요.';
  if (!text) return null;
  return (
    <div role="status" className="fixed inset-x-0 top-0 z-50 border-b-[3px] border-ink bg-sun px-4 py-2 text-center text-sm font-bold safe-top">
      {text}
    </div>
  );
}

/** 잠깐 나타나는 알림 */
export function NoticeToast({ notice }: { notice: RoomView['notice'] }) {
  const [shown, setShown] = useState<RoomView['notice']>(null);
  useEffect(() => {
    if (!notice) return;
    setShown(notice);
    const id = setTimeout(() => setShown(null), 3500);
    return () => clearTimeout(id);
  }, [notice]);
  if (!shown) return null;
  return (
    <div role="alert" className="anim-rise fixed inset-x-4 bottom-6 z-50 mx-auto max-w-md rounded-2xl border-[3px] border-ink bg-ink px-4 py-3 text-center font-bold text-white shadow-pop">
      {shown.message}
    </div>
  );
}

export function usePrefs() {
  return useSyncExternalStore(subscribePrefs, getPrefs, () => ({ sound: false, vibrate: true }));
}

export function PrefsButtons() {
  const prefs = usePrefs();
  const base = 'pop grid size-10 place-items-center rounded-xl border-[3px] border-ink text-lg';
  return (
    <div className="flex gap-2">
      <button
        type="button"
        aria-label={prefs.sound ? '효과음 끄기' : '효과음 켜기'}
        aria-pressed={prefs.sound}
        className={`${base} ${prefs.sound ? 'bg-sun' : 'bg-white opacity-70'}`}
        onClick={() => {
          unlockAudio();
          setPrefs({ sound: !prefs.sound });
        }}
      >
        {prefs.sound ? '🔊' : '🔈'}
      </button>
      <button
        type="button"
        aria-label={prefs.vibrate ? '진동 끄기' : '진동 켜기'}
        aria-pressed={prefs.vibrate}
        className={`${base} ${prefs.vibrate ? 'bg-sun' : 'bg-white opacity-70'}`}
        onClick={() => setPrefs({ vibrate: !prefs.vibrate })}
      >
        📳
      </button>
    </div>
  );
}

export function QrBox({ url, size = 220 }: { url: string; size?: number }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    QRCode.toDataURL(url, { margin: 1, width: size * 2, errorCorrectionLevel: 'M', color: { dark: '#1B1433', light: '#FFFFFF' } })
      .then(setSrc)
      .catch(() => setSrc(null));
  }, [url, size]);
  return (
    <div className="grid place-items-center rounded-2xl border-[3px] border-ink bg-white p-2" style={{ width: size + 22, height: size + 22 }}>
      {src ? <img src={src} width={size} height={size} alt={`참가 QR 코드: ${url}`} /> : <div className="size-full animate-pulse bg-line" />}
    </div>
  );
}

/** 서버가 보관한 32×32 분석 영역 그림 */
export function Thumb({ b64, className = 'size-16' }: { b64: string | null; className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (ref.current && b64) drawThumb(ref.current, b64);
  }, [b64]);
  if (!b64) return null;
  return <canvas ref={ref} className={`${className} rounded-2xl border-[3px] border-ink [image-rendering:pixelated]`} aria-label="촬영한 분석 영역" />;
}

/** 남은 시간 막대 */
export function TimeBar({ remaining, total, paused }: { remaining: number; total: number; paused?: boolean }) {
  const pct = Math.max(0, Math.min(100, (remaining / total) * 100));
  const urgent = remaining <= 5000;
  return (
    <div className="h-4 w-full overflow-hidden rounded-full border-[3px] border-ink bg-white" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(pct)} aria-label="남은 시간">
      <div
        className={`h-full transition-[width] duration-100 ease-linear ${paused ? 'bg-muted' : urgent ? 'bg-tomato' : 'bg-leaf'}`}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

export function TeamBadge({ team, big }: { team: Pick<PublicTeam, 'name' | 'color'>; big?: boolean }) {
  return (
    <span
      className={`inline-flex items-center rounded-full border-[3px] border-ink font-display ${big ? 'px-5 py-1.5 text-2xl' : 'px-3 py-0.5 text-base'}`}
      style={{ background: team.color, color: readableOn(team.color) }}
    >
      {team.name}
    </span>
  );
}
