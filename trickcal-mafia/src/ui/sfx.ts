/** 간단한 효과음 (코드로 만든 소리 + 파일이 있으면 파일) */
import { asset } from './dom';

let ctx: AudioContext | null = null;
const files = new Map<string, HTMLAudioElement>();
export let muted = false;
export const setMuted = (m: boolean) => (muted = m);

function ac() {
  if (!ctx) ctx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
  if (ctx.state === 'suspended') void ctx.resume();
  return ctx;
}

function tone(freq: number, dur: number, type: OscillatorType = 'sine', vol = 0.12, slide = 0, delay = 0) {
  const c = ac();
  const t0 = c.currentTime + delay;
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t0);
  if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), t0 + dur);
  g.gain.setValueAtTime(0, t0);
  g.gain.linearRampToValueAtTime(vol, t0 + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  o.connect(g).connect(c.destination);
  o.start(t0);
  o.stop(t0 + dur + 0.02);
}

const FILES: Record<string, string> = { pop: 'se/ui_pop.mp3' };

export function preloadSfx(list: string[]) {
  for (const n of list) {
    if (!FILES[n] || files.has(n)) continue;
    const a = new Audio(asset(FILES[n]));
    a.preload = 'auto';
    files.set(n, a);
  }
}

export function sfx(name: string) {
  if (muted) return;
  try {
    const f = files.get(name);
    if (f) {
      const a = f.cloneNode() as HTMLAudioElement;
      a.volume = 0.8;
      void a.play().catch(() => {});
      return;
    }
    switch (name) {
      case 'click': tone(660, 0.06, 'triangle', 0.08); break;
      case 'open': tone(420, 0.12, 'sine', 0.1, 300); break;
      case 'close': tone(600, 0.12, 'sine', 0.08, -300); break;
      case 'wrong': tone(180, 0.18, 'square', 0.06); tone(150, 0.2, 'square', 0.05, 0, 0.1); break;
      case 'pop': tone(500, 0.1, 'sine', 0.15, 500); break;
      case 'night': tone(220, 0.8, 'sine', 0.1, -80); tone(330, 0.8, 'sine', 0.06, -120, 0.15); break;
      case 'morning': tone(520, 0.25, 'triangle', 0.08); tone(660, 0.25, 'triangle', 0.08, 0, 0.12); tone(780, 0.35, 'triangle', 0.08, 0, 0.24); break;
      case 'death': tone(140, 0.9, 'sawtooth', 0.07, -60); break;
      case 'vote': tone(300, 0.08, 'square', 0.06); break;
      case 'gavel': tone(120, 0.25, 'square', 0.12, -40); tone(90, 0.3, 'square', 0.1, -30, 0.18); break;
      case 'note': tone(880, 0.08, 'sine', 0.07); tone(1175, 0.12, 'sine', 0.06, 0, 0.07); break;
      case 'secret': tone(990, 0.15, 'sine', 0.05); break;
      case 'contra': tone(300, 0.1, 'sawtooth', 0.1, 400); tone(700, 0.25, 'square', 0.08, 0, 0.1); break;
      case 'win': [523, 659, 784, 1046].forEach((f, i) => tone(f, 0.35, 'triangle', 0.09, 0, i * 0.12)); break;
      case 'lose': [392, 330, 262].forEach((f, i) => tone(f, 0.4, 'triangle', 0.09, 0, i * 0.16)); break;
    }
  } catch {
    /* 소리 실패는 무시 */
  }
}
