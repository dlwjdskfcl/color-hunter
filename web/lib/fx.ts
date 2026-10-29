// 효과음(WebAudio 짧은 비프, 파일 없음)과 진동 — 둘 다 설정에서 끌 수 있는 선택 기능
import { loadPrefs, savePrefs, type Prefs } from './storage';

let prefs: Prefs | null = null;
let ctx: AudioContext | null = null;
const listeners = new Set<() => void>();

export function getPrefs(): Prefs {
  if (!prefs) prefs = typeof window === 'undefined' ? { sound: false, vibrate: true } : loadPrefs();
  return prefs;
}

export function setPrefs(p: Partial<Prefs>) {
  prefs = { ...getPrefs(), ...p };
  savePrefs(prefs);
  if (prefs.sound) unlockAudio();
  listeners.forEach((fn) => fn());
}

export function subscribePrefs(fn: () => void) {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/** iOS 는 사용자 터치 안에서 오디오를 한 번 깨워야 소리가 남 */
export function unlockAudio() {
  try {
    ctx ??= new AudioContext();
    if (ctx.state === 'suspended') void ctx.resume();
  } catch {
    /* 미지원 */
  }
}

function tone(freq: number, ms: number, delay = 0, type: OscillatorType = 'sine', gain = 0.08) {
  if (!getPrefs().sound || !ctx) return;
  const t = ctx.currentTime + delay / 1000;
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(gain, t + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t + ms / 1000);
  osc.connect(g).connect(ctx.destination);
  osc.start(t);
  osc.stop(t + ms / 1000 + 0.02);
}

function buzz(pattern: number | number[]) {
  if (!getPrefs().vibrate) return;
  try {
    navigator.vibrate?.(pattern);
  } catch {
    /* 미지원(iOS) */
  }
}

export const fx = {
  tick: () => {
    tone(660, 120, 0, 'square', 0.05);
    buzz(30);
  },
  go: () => {
    tone(880, 120);
    tone(1320, 220, 110);
    buzz([60, 40, 60]);
  },
  shutter: () => {
    tone(1200, 50, 0, 'triangle');
    buzz(20);
  },
  submit: () => {
    tone(740, 90);
    tone(988, 160, 90);
    buzz(40);
  },
  timeUp: () => {
    tone(330, 300, 0, 'sawtooth', 0.05);
    buzz([100, 60, 100]);
  },
  win: () => {
    [523, 659, 784, 1047].forEach((f, i) => tone(f, 200, i * 120));
    buzz([80, 50, 80, 50, 160]);
  },
};
