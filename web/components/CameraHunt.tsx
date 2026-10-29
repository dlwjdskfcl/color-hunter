'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  BONUS_MIN_COLOR_SCORE,
  colorDifference,
  colorScore,
  hexToRgb,
  matchLabel,
  rgbToLab,
  type ExtractedColor,
  type GameSettings,
  type SubmissionView,
} from '@color-hunter/shared';
import { captureFrame, fileToCanvas, sampleRegion, DEFAULT_REGION, regionRect, type Region } from '@/lib/analyze';
import { CAMERA_ERROR_TEXT, CameraError, getCamera, type CameraErrorKind } from '@/lib/camera';
import { fx } from '@/lib/fx';
import type { RoomClient } from '@/lib/room-client';
import { Button, Notice, Spinner } from './ui';

interface Target {
  name: string;
  hex: string;
}

interface Analysis {
  pixels: string;
  color: ExtractedColor;
}

function judge(target: Target, color: ExtractedColor, settings: GameSettings) {
  const dE = colorDifference(rgbToLab(hexToRgb(target.hex)), color.lab, settings.tolerance);
  return { deltaE: Math.round(dE * 10) / 10, score: colorScore(dE, settings.tolerance) };
}

/** 라이브 미리보기에서 화면에 보이는 조준 사각형 → 원본 비디오 기준 영역 */
function liveRegion(video: HTMLVideoElement, reticleFraction: number): Region {
  const vw = video.videoWidth;
  const vh = video.videoHeight;
  const dw = video.clientWidth;
  const dh = video.clientHeight;
  if (!vw || !vh || !dw || !dh) return DEFAULT_REGION;
  const scale = Math.max(dw / vw, dh / vh); // object-cover
  const sideVideo = (reticleFraction * Math.min(dw, dh)) / scale;
  return { cx: 0.5, cy: 0.5, size: Math.min(1, sideVideo / Math.min(vw, vh)) };
}

const RETICLE = 0.34;

export function CameraHunt({
  client,
  roundIndex,
  target,
  settings,
  remaining,
  paused,
  mine,
}: {
  client: RoomClient;
  roundIndex: number;
  target: Target;
  settings: GameSettings;
  remaining: number;
  paused: boolean;
  mine: SubmissionView | null;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [cam, setCam] = useState<'starting' | 'live' | CameraErrorKind>('starting');
  const [live, setLive] = useState<ExtractedColor | null>(null);
  const [shot, setShot] = useState<{ canvas: HTMLCanvasElement; url: string } | null>(null);
  const [region, setRegion] = useState<Region>(DEFAULT_REGION);
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const timeUp = remaining <= 0;

  // 카메라 시작 (촬영 결과 확인 중에는 미리보기만 숨김, 스트림은 유지)
  useEffect(() => {
    if (mine) return;
    let cancelled = false;
    setCam('starting');
    getCamera()
      .then(async (stream) => {
        if (cancelled || !videoRef.current) return;
        const v = videoRef.current;
        if (v.srcObject !== stream) v.srcObject = stream;
        try {
          await v.play();
        } catch {
          /* 자동재생 제한 — muted+playsInline 이라 대부분 통과 */
        }
        if (!cancelled) setCam('live');
      })
      .catch((e) => {
        if (!cancelled) setCam(e instanceof CameraError ? e.kind : 'unknown');
      });
    return () => {
      cancelled = true;
    };
  }, [mine, attempt]);

  // 라이브 색 읽기 (조준 사각형 안) — 가볍게 0.35초마다
  useEffect(() => {
    if (cam !== 'live' || shot || mine) return;
    const id = setInterval(() => {
      const v = videoRef.current;
      if (!v || v.readyState < 2 || !v.videoWidth) return;
      try {
        setLive(sampleRegion(v, v.videoWidth, v.videoHeight, liveRegion(v, RETICLE)).color);
      } catch {
        /* 프레임 준비 전 */
      }
    }, 350);
    return () => clearInterval(id);
  }, [cam, shot, mine]);

  // 분석 영역이 바뀌면 다시 분석
  useEffect(() => {
    if (!shot) return;
    const raf = requestAnimationFrame(() => setAnalysis(sampleRegion(shot.canvas, shot.canvas.width, shot.canvas.height, region)));
    return () => cancelAnimationFrame(raf);
  }, [shot, region]);

  const openShot = useCallback((canvas: HTMLCanvasElement, r: Region) => {
    setShot({ canvas, url: canvas.toDataURL('image/jpeg', 0.85) });
    setRegion(r);
    setSubmitError(null);
  }, []);

  function capture() {
    const v = videoRef.current;
    if (!v) return;
    const canvas = captureFrame(v);
    if (!canvas) {
      setSubmitError('촬영하지 못했어요. 카메라 화면이 나온 뒤 다시 눌러 주세요.');
      return;
    }
    fx.shutter();
    openShot(canvas, liveRegion(v, RETICLE));
  }

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      openShot(await fileToCanvas(file), DEFAULT_REGION);
    } catch {
      setSubmitError('사진을 읽지 못했어요. 다시 찍어 주세요.');
    }
  }

  function retake() {
    setShot(null);
    setAnalysis(null);
    setSubmitError(null);
  }

  async function submit() {
    if (!analysis || submitting) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      await client.submit(roundIndex, analysis.pixels);
      fx.submit();
    } catch (e) {
      setSubmitError((e as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  // ---------- 제출 완료 ----------
  if (mine) {
    return (
      <div className="anim-pop flex flex-1 flex-col items-center justify-center gap-4 rounded-3xl border-[3px] border-ink bg-white p-6 text-center shadow-pop">
        <div className="text-sm font-bold text-muted">제출 완료!</div>
        <div className="flex -space-x-4">
          <div className="size-24 rounded-3xl border-[3px] border-ink" style={{ background: target.hex }} title={`목표 ${target.name}`} />
          <div className="size-24 rounded-3xl border-[3px] border-ink" style={{ background: mine.hex }} title={`내 사진 ${mine.hex}`} />
        </div>
        <div className="font-display text-2xl">{matchLabel(mine.deltaE)}</div>
        <div className="font-display text-6xl tabular-nums">+{mine.total}</div>
        <div className="text-sm text-muted">
          색상 {mine.colorScore}점 + 시간 보너스 {mine.timeBonus}점 · ΔE {mine.deltaE}
        </div>
        <div className="mt-2 flex items-center gap-2 text-sm font-bold text-muted">
          <Spinner className="size-4" /> 다른 사람들을 기다리는 중…
        </div>
      </div>
    );
  }

  const fileInput = (
    <input ref={fileRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={onFile} aria-hidden tabIndex={-1} />
  );

  // ---------- 촬영 결과 확인 ----------
  if (shot) {
    const j = analysis ? judge(target, analysis.color, settings) : null;
    const rect = regionRect(region, shot.canvas.width, shot.canvas.height);
    const w = shot.canvas.width;
    const h = shot.canvas.height;
    const moveTo = (e: React.PointerEvent<HTMLDivElement>) => {
      const box = e.currentTarget.getBoundingClientRect();
      setRegion((r) => ({
        ...r,
        cx: Math.min(1, Math.max(0, (e.clientX - box.left) / box.width)),
        cy: Math.min(1, Math.max(0, (e.clientY - box.top) / box.height)),
      }));
    };
    return (
      <div className="flex min-h-0 flex-1 flex-col gap-3">
        {fileInput}
        <div className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden rounded-3xl border-[3px] border-ink bg-ink">
          <div
            className="relative touch-none select-none"
            style={{ aspectRatio: `${w} / ${h}`, maxHeight: '100%', maxWidth: '100%', height: w >= h ? 'auto' : '100%', width: w >= h ? '100%' : 'auto' }}
            onPointerDown={(e) => {
              e.currentTarget.setPointerCapture(e.pointerId);
              moveTo(e);
            }}
            onPointerMove={(e) => {
              if (e.buttons) moveTo(e);
            }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={shot.url} alt="촬영한 사진" className="block size-full" draggable={false} />
            <div
              className="pointer-events-none absolute rounded-xl border-[3px] border-white outline-[3px] outline-ink"
              style={{ left: `${(rect.x / w) * 100}%`, top: `${(rect.y / h) * 100}%`, width: `${(rect.side / w) * 100}%`, height: `${(rect.side / h) * 100}%` }}
              aria-hidden
            />
          </div>
          <div className="pointer-events-none absolute top-2 left-2 rounded-full bg-ink/80 px-3 py-1 text-xs font-bold text-white">
            사각형을 끌어 분석할 곳을 고르세요
          </div>
        </div>

        <label className="flex items-center gap-3 text-sm font-bold">
          <span className="shrink-0">영역 크기</span>
          <input
            type="range"
            min={0.1}
            max={0.8}
            step={0.02}
            value={region.size}
            onChange={(e) => setRegion((r) => ({ ...r, size: Number(e.target.value) }))}
            className="w-full accent-ink"
            aria-label="분석 영역 크기"
          />
        </label>

        {analysis && j && (
          <div className="rounded-3xl border-[3px] border-ink bg-white p-3 shadow-pop-sm">
            <div className="flex items-center gap-3">
              <div className="text-center">
                <div className="size-14 rounded-2xl border-[3px] border-ink" style={{ background: target.hex }} />
                <div className="mt-1 text-[11px] font-bold">목표 {target.name}</div>
              </div>
              <div className="text-xl" aria-hidden>
                ↔
              </div>
              <div className="text-center">
                <div className="size-14 rounded-2xl border-[3px] border-ink" style={{ background: analysis.color.hex }} />
                <div className="mt-1 text-[11px] font-bold">내 색 {analysis.color.hex}</div>
              </div>
              <div className="ml-auto text-right">
                <div className="font-display text-xl">{matchLabel(j.deltaE)}</div>
                <div className="text-sm font-bold">
                  예상 {j.score}점{settings.timeBonus && j.score >= BONUS_MIN_COLOR_SCORE ? ' + 보너스' : ''}
                </div>
                <div className="text-xs text-muted">ΔE {j.deltaE}</div>
              </div>
            </div>
            {analysis.color.uniformity < 0.5 && (
              <p className="mt-2 text-xs font-bold text-tomato">여러 색이 섞여 있어요. 사각형을 물체 안쪽으로 옮기거나 작게 줄여 보세요.</p>
            )}
            {analysis.color.lab[0] < 12 && rgbToLab(hexToRgb(target.hex))[0] > 30 && (
              <p className="mt-2 text-xs font-bold text-tomato">너무 어두워요. 밝은 곳에서 다시 찍으면 더 정확해요.</p>
            )}
          </div>
        )}

        {submitError && <Notice tone="error">{submitError}</Notice>}
        <div className="grid grid-cols-[2fr_3fr] gap-3">
          <Button variant="secondary" size="lg" onClick={retake} disabled={submitting}>
            다시 찍기
          </Button>
          <Button size="lg" onClick={submit} disabled={!analysis || submitting || timeUp || paused}>
            {submitting ? <Spinner /> : timeUp ? '시간 종료' : paused ? '일시정지 중' : '이 색으로 제출'}
          </Button>
        </div>
      </div>
    );
  }

  // ---------- 카메라 ----------
  const error = cam !== 'starting' && cam !== 'live' ? CAMERA_ERROR_TEXT[cam] : null;
  const liveJudge = live ? judge(target, live, settings) : null;
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      {fileInput}
      <div className="relative min-h-0 flex-1 overflow-hidden rounded-3xl border-[3px] border-ink bg-ink [container-type:size]">
        <video ref={videoRef} className="absolute inset-0 size-full object-cover" playsInline muted autoPlay aria-label="카메라 미리보기" />
        {cam === 'live' && (
          <>
            <div
              className="pointer-events-none absolute top-1/2 left-1/2 aspect-square -translate-x-1/2 -translate-y-1/2 rounded-2xl border-[3px] border-white outline-[3px] outline-ink"
              style={{ width: `min(${RETICLE * 100}cqw, ${RETICLE * 100}cqh)` }}
              aria-hidden
            />
            {live && liveJudge && (
              <div className="pointer-events-none absolute inset-x-2 bottom-2 flex items-center gap-2 rounded-2xl border-[3px] border-ink bg-white/95 px-3 py-2">
                <span className="size-8 shrink-0 rounded-lg border-2 border-ink" style={{ background: live.hex }} aria-hidden />
                <span className="text-sm font-bold">지금 색: {matchLabel(liveJudge.deltaE)}</span>
                <span className="ml-auto text-xs text-muted">ΔE {liveJudge.deltaE}</span>
              </div>
            )}
          </>
        )}
        {cam === 'starting' && (
          <div className="absolute inset-0 grid place-items-center text-white">
            <div className="flex flex-col items-center gap-3 font-bold">
              <Spinner className="border-white border-t-transparent" />
              카메라를 켜는 중… 권한을 허용해 주세요
            </div>
          </div>
        )}
        {error && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-paper p-5 text-center">
            <div className="text-4xl" aria-hidden>
              📷
            </div>
            <div className="font-display text-xl">{error.title}</div>
            <p className="text-sm leading-relaxed text-muted">{error.help}</p>
            <div className="flex flex-wrap justify-center gap-2">
              {cam !== 'insecure' && (
                <Button variant="secondary" size="sm" onClick={() => setAttempt((a) => a + 1)}>
                  다시 시도
                </Button>
              )}
              <Button size="sm" onClick={() => fileRef.current?.click()}>
                사진 찍기 (기본 카메라)
              </Button>
            </div>
          </div>
        )}
      </div>
      {submitError && <Notice tone="error">{submitError}</Notice>}
      <div className="flex items-center justify-center gap-4">
        <button
          type="button"
          onClick={capture}
          disabled={cam !== 'live' || timeUp || paused}
          aria-label="촬영"
          className="pop grid size-20 place-items-center rounded-full border-[4px] border-ink bg-white disabled:opacity-40"
        >
          <span className="size-14 rounded-full border-[3px] border-ink" style={{ background: target.hex }} />
        </button>
      </div>
    </div>
  );
}
