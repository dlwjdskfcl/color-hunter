'use client';

import { useEffect, useState, useSyncExternalStore } from 'react';
import { RoomClient, type RoomView } from './room-client';

const EMPTY: RoomView = { status: 'connecting', role: null, playerId: null, snapshot: null, mine: null, fatal: null, notice: null };
const noop = () => () => {};

/** 방 연결을 화면에 붙였다 뗌. 화면을 벗어나면 연결(리스너)도 해제. */
export function useRoom(code: string | null, token: string | null, onToken: (t: string | null) => void) {
  const [client, setClient] = useState<RoomClient | null>(null);

  useEffect(() => {
    if (!code) return;
    const c = new RoomClient(code, token, onToken);
    c.start();
    setClient(c);
    return () => {
      c.stop();
      setClient(null);
    };
    // token 은 처음 값만 사용 (이후 갱신은 클라이언트 내부에서)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code]);

  const view = useSyncExternalStore(client?.subscribe ?? noop, client?.getView ?? (() => EMPTY), () => EMPTY);
  return { client, view };
}

/** 서버 시각 기준 남은 시간(ms). 일시정지면 고정값. */
export function useRemaining(client: RoomClient | null, deadline: number | null, pausedRemainingMs: number | null, intervalMs = 100) {
  const [now, setNow] = useState(() => (client ? client.now() : Date.now()));
  useEffect(() => {
    if (!client || deadline === null || pausedRemainingMs !== null) return;
    setNow(client.now());
    const id = setInterval(() => setNow(client.now()), intervalMs);
    return () => clearInterval(id);
  }, [client, deadline, pausedRemainingMs, intervalMs]);
  if (pausedRemainingMs !== null) return pausedRemainingMs;
  if (deadline === null) return 0;
  return Math.max(0, deadline - now);
}

/** 쿼리스트링의 방 코드 (정적 export 라 클라이언트에서 읽음) */
export function useCodeParam(): string | null | undefined {
  const [code, setCode] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    const raw = new URLSearchParams(location.search).get('code') ?? '';
    const c = raw.toUpperCase().replace(/[^0-9A-Z]/g, '').slice(0, 6);
    setCode(c.length === 6 ? c : null);
  }, []);
  return code;
}
