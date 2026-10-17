/**
 * 배경음악: 장면마다 한 곡. <audio> 스트리밍이라 통째로 받지 않아도 바로 재생되고 메모리도 적다.
 * 곡을 바꿀 땐 짧게 교차 페이드. 브라우저가 첫 터치 전엔 소리를 막으므로 첫 입력 때 다시 튼다.
 * 다음에 올 법한 곡은 미리 조금 받아 둔다 (preload).
 */
import { asset } from './dom';

export type BgmName = 'title' | 'daily' | 'mansion' | 'before_trial' | 'after_trial' | 'night' | 'rain' | 'airship';

/** 곡마다 듣기 좋은 크기 */
const VOL: Partial<Record<BgmName, number>> = { night: 0.5, rain: 0.5 };
/** 다음에 나올 법한 곡 */
const NEXT: Record<BgmName, BgmName[]> = {
  title: ['daily'], daily: ['mansion', 'night'], mansion: ['before_trial', 'night'], before_trial: ['after_trial', 'night'],
  after_trial: ['night'], night: ['mansion', 'rain'], rain: ['mansion'], airship: [],
};

const KEY = 'tm.sound';
type Mode = 'all' | 'sfx' | 'off';
let mode: Mode = 'all';
try { const s = localStorage.getItem(KEY); if (s === 'all' || s === 'sfx' || s === 'off') mode = s; } catch { /* 저장소 없음 */ }

const master = 0.55;
let cur: { name: BgmName; a: HTMLAudioElement } | null = null;
let want: BgmName | null = null;
const pool = new Map<BgmName, HTMLAudioElement>();

function el(name: BgmName) {
  let a = pool.get(name);
  if (!a) {
    a = new Audio(asset(`bgm/${name}.mp3`));
    a.loop = true;
    a.preload = 'none';
    pool.set(name, a);
  }
  return a;
}

function fade(a: HTMLAudioElement, to: number, ms: number, done?: () => void) {
  const from = a.volume;
  const t0 = performance.now();
  const step = () => {
    const k = Math.min(1, (performance.now() - t0) / ms);
    a.volume = Math.max(0, Math.min(1, from + (to - from) * k));
    if (k < 1) requestAnimationFrame(step);
    else done?.();
  };
  requestAnimationFrame(step);
}

/** 이 곡으로 바꾼다 (같은 곡이면 그대로) */
export function bgm(name: BgmName | null) {
  want = name;
  if (cur?.name === name && !cur.a.paused) return;
  const old = cur;
  cur = null;
  if (old && old.name !== name) fade(old.a, 0, 600, () => { if (cur?.a !== old.a) old.a.pause(); });
  if (!name || mode !== 'all') return;
  const a = el(name);
  a.preload = 'auto';
  if (old?.name !== name) a.currentTime = 0;
  a.volume = 0;
  cur = { name, a };
  a.play().then(() => fade(a, master * (VOL[name] ?? 0.7), 900)).catch(() => { /* 첫 터치 뒤에 다시 */ });
  // 다음 곡 조금 미리 (휴대폰 데이터 아끼려고 바로 다음 것만)
  setTimeout(() => { for (const n of NEXT[name]) { const b = el(n); if (b.preload === 'none') b.preload = 'metadata'; } }, 4000);
}

/** 잠깐 다른 곡을 틀었다가 원래 곡으로 */
export function bgmPush(name: BgmName) {
  const back = want;
  bgm(name);
  return () => bgm(back);
}

export const soundMode = () => mode;
export function setSoundMode(m: Mode) {
  mode = m;
  try { localStorage.setItem(KEY, m); } catch { /* 저장 못 해도 이번 판엔 적용 */ }
  if (m !== 'all') { const o = cur; cur = null; o?.a.pause(); }
  else if (want) bgm(want);
}

// 첫 입력 때 막혔던 음악 재생
const unlock = () => {
  if (want && mode === 'all' && (!cur || cur.a.paused)) { cur = null; bgm(want); }
};
window.addEventListener('pointerdown', unlock, { passive: true });
window.addEventListener('keydown', unlock);
// 탭을 숨기면 음악도 멈춤 (배터리)
document.addEventListener('visibilitychange', () => {
  if (!cur) return;
  if (document.hidden) cur.a.pause();
  else if (mode === 'all') void cur.a.play().catch(() => {});
});
