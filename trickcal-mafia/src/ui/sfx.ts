/** 간단한 효과음 (코드로 만든 소리 + 파일이 있으면 파일) */
import { soundMode } from './bgm';
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

/** 짧은 잡음 (타격·폭발·바람 소리) */
function noise(dur: number, vol = 0.15, freq = 1200, q = 0.8, delay = 0, type: BiquadFilterType = 'bandpass', slide = 0) {
  const c = ac();
  const t0 = c.currentTime + delay;
  const len = Math.max(1, Math.floor(c.sampleRate * dur));
  const buf = c.createBuffer(1, len, c.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  const s = c.createBufferSource();
  s.buffer = buf;
  const f = c.createBiquadFilter();
  f.type = type; f.frequency.setValueAtTime(freq, t0); f.Q.value = q;
  if (slide) f.frequency.exponentialRampToValueAtTime(Math.max(40, freq + slide), t0 + dur);
  const g = c.createGain();
  g.gain.setValueAtTime(vol, t0);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  s.connect(f).connect(g).connect(c.destination);
  s.start(t0);
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
  if (muted || soundMode() === 'off') return;
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
      // ── 컷씬 ──
      case 'slash': noise(0.25, 0.25, 3000, 1.2, 0, 'bandpass', -2400); tone(180, 0.3, 'sawtooth', 0.08, -100, 0.05); break;
      case 'skill': tone(660, 0.1, 'triangle', 0.08, 300); tone(990, 0.25, 'sine', 0.07, 0, 0.08); noise(0.3, 0.05, 6000, 1, 0, 'highpass'); break;
      case 'execute': tone(110, 0.35, 'square', 0.13, -50); noise(0.4, 0.2, 400, 0.7, 0.02, 'lowpass'); tone(70, 1.2, 'sine', 0.12, -30, 0.25); break;
      case 'vanish': [523, 466, 392, 311].forEach((f, i) => tone(f, 0.5, 'sine', 0.08, -20, i * 0.18)); noise(1.2, 0.05, 800, 0.5, 0.2, 'bandpass', -600); break;
      case 'panic': [900, 1100, 950, 1200].forEach((f, i) => tone(f, 0.08, 'square', 0.04, 0, 2.2 + i * 0.09)); break;
      case 'heal': [523, 659, 784, 1046, 1318].forEach((f, i) => tone(f, 0.6, 'sine', 0.07, 0, i * 0.07)); noise(0.8, 0.04, 8000, 1, 0, 'highpass'); break;
      case 'clang': tone(1400, 0.6, 'square', 0.07, -200); tone(2100, 0.5, 'triangle', 0.06, -300); noise(0.15, 0.3, 3500, 2); tone(90, 0.3, 'sine', 0.14, -40, 0.02); break;
      case 'boom': noise(1.2, 0.45, 700, 0.6, 0, 'lowpass', -620); tone(60, 0.9, 'sine', 0.2, -30); break;
      case 'revive': [392, 523, 659, 784, 1046].forEach((f, i) => tone(f, 0.5, 'triangle', 0.07, 0, i * 0.1)); tone(1568, 0.9, 'sine', 0.05, 0, 0.5); break;
      case 'buzz': tone(180, 1.6, 'sawtooth', 0.035, 40); tone(186, 1.6, 'sawtooth', 0.035, -20); break;
      case 'droneOk': tone(200, 0.6, 'sawtooth', 0.04, 600); [784, 988, 1175].forEach((f, i) => tone(f, 0.25, 'triangle', 0.07, 0, 0.5 + i * 0.09)); break;
      case 'fizzle': noise(0.7, 0.12, 2000, 0.6, 0, 'bandpass', -1600); tone(300, 0.4, 'square', 0.04, -200, 0.1); tone(140, 0.25, 'square', 0.05, 0, 0.45); break;
      case 'contact': tone(330, 0.3, 'triangle', 0.09); tone(330, 0.3, 'triangle', 0.09, 0, 0.9); tone(494, 0.6, 'triangle', 0.09, 0, 1.05); break;
      case 'reveal': noise(0.5, 0.08, 1500, 0.5, 0, 'bandpass', 3000); tone(880, 0.5, 'sine', 0.08, 0, 0.3); tone(1320, 0.6, 'sine', 0.06, 0, 0.38); break;
      case 'bang': tone(1200, 0.1, 'square', 0.05, 600); tone(1500, 0.14, 'square', 0.05, 0, 0.08); break;
      case 'door': noise(0.12, 0.2, 300, 1, 0, 'lowpass'); noise(0.12, 0.18, 300, 1, 0.16, 'lowpass'); break;
      case 'tick': tone(1000, 0.04, 'square', 0.04); break;
    }
  } catch {
    /* 소리 실패는 무시 */
  }
}
