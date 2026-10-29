// 기기 저장 (localStorage). 사생활 보호 모드 등에서 실패해도 게임은 동작하도록 전부 try/catch.

function get(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function set(key: string, value: string | null) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    /* 저장 불가 — 새로고침 시 재참가 필요 */
  }
}

export const tokens = {
  host: (code: string) => get(`ch:host:${code}`),
  setHost: (code: string, token: string | null) => set(`ch:host:${code}`, token),
  player: (code: string) => get(`ch:player:${code}`),
  setPlayer: (code: string, token: string | null) => set(`ch:player:${code}`, token),
};

export const lastNickname = {
  get: () => get('ch:nick') ?? '',
  set: (v: string) => set('ch:nick', v),
};

export interface Prefs {
  sound: boolean;
  vibrate: boolean;
}

export function loadPrefs(): Prefs {
  try {
    const p = JSON.parse(get('ch:prefs') ?? '{}');
    return { sound: p.sound === true, vibrate: p.vibrate !== false };
  } catch {
    return { sound: false, vibrate: true };
  }
}

export function savePrefs(p: Prefs) {
  set('ch:prefs', JSON.stringify(p));
}
