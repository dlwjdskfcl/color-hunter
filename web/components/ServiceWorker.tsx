'use client';

import { useEffect } from 'react';
import { BASE_PATH } from '@/lib/config';

/** 홈 화면 추가(PWA)와 오프라인 안내 페이지용. 게임 데이터는 캐시하지 않음. */
export function ServiceWorker() {
  useEffect(() => {
    if (process.env.NODE_ENV !== 'production' || !('serviceWorker' in navigator)) return;
    navigator.serviceWorker.register(`${BASE_PATH}/sw.js`, { scope: `${BASE_PATH}/` }).catch(() => {});
  }, []);
  return null;
}
