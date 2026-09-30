/**
 * UI 효과음 — 파일 없이 코드로 만든 소리 (Web Audio).
 * 버튼에 마우스를 올리면 작은 종소리, 누르면 딸깍, 창이 열리면 바람 소리 …
 * 소리 크기는 설정의 효과음·전체 볼륨을 따른다. config.yaml 의 effects.ui_sound: false 로 끌 수 있다.
 * 같은 이름의 파일(public/assets/se/ui_hover.mp3 등)을 넣으면 그 파일을 대신 쓴다.
 */
import { cfg } from '../engine/content';
import { P } from '../engine/state';
import { asset } from './dom';

let ctx: AudioContext | null = null;
const fileOk = new Map<string, HTMLAudioElement | null>();

function ac() {
  if (!ctx) ctx = new AudioContext();
  if (ctx.state === 'suspended') void ctx.resume();
  return ctx;
}

function vol() {
  return (P?.settings?.se ?? 0.8) * (P?.settings?.master ?? 1);
}

function tone(freq: number, dur: number, type: OscillatorType, gain: number, when = 0, glideTo?: number) {
  const c = ac();
  const t0 = c.currentTime + when;
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t0);
  if (glideTo) o.frequency.exponentialRampToValueAtTime(glideTo, t0 + dur);
  g.gain.setValueAtTime(0, t0);
  g.gain.linearRampToValueAtTime(gain * vol(), t0 + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  o.connect(g).connect(c.destination);
  o.start(t0);
  o.stop(t0 + dur + 0.05);
}

function noise(dur: number, gain: number, filterFreq: number, q = 1, sweepTo?: number) {
  const c = ac();
  const len = Math.floor(c.sampleRate * dur);
  const buf = c.createBuffer(1, len, c.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
  const src = c.createBufferSource();
  src.buffer = buf;
  const f = c.createBiquadFilter();
  f.type = 'bandpass';
  f.Q.value = q;
  f.frequency.setValueAtTime(filterFreq, c.currentTime);
  if (sweepTo) f.frequency.exponentialRampToValueAtTime(sweepTo, c.currentTime + dur);
  const g = c.createGain();
  g.gain.value = gain * vol();
  src.connect(f).connect(g).connect(c.destination);
  src.start();
}

const SYNTH: Record<string, () => void> = {
  hover: () => tone(2400, 0.06, 'sine', 0.035),
  click: () => { tone(900, 0.05, 'triangle', 0.08); tone(1350, 0.08, 'sine', 0.05, 0.03); },
  open: () => noise(0.35, 0.12, 700, 0.8, 2400),
  close: () => noise(0.3, 0.1, 2200, 0.8, 600),
  page: () => noise(0.12, 0.08, 3000, 1.5),
  choice: () => { tone(660, 0.18, 'sine', 0.06); tone(990, 0.22, 'sine', 0.04, 0.06); },
  item: () => { [880, 1320, 1760].forEach((f, i) => tone(f, 0.35, 'sine', 0.05, i * 0.07)); },
  clue: () => { [660, 880, 1320].forEach((f, i) => tone(f, 0.4, 'triangle', 0.05, i * 0.08)); },
  bell: () => { tone(392, 2.4, 'sine', 0.12); tone(784, 1.6, 'sine', 0.05); tone(1176, 1.0, 'sine', 0.03); },
  glitch: () => { noise(0.25, 0.18, 1800, 4, 300); tone(140, 0.3, 'sawtooth', 0.05, 0, 60); },
  thunder: () => noise(1.6, 0.5, 180, 0.6, 60),
  door: () => { noise(0.5, 0.15, 400, 1.2, 150); tone(110, 0.4, 'triangle', 0.06); },
  step: () => noise(0.09, 0.12, 250, 2),
  cutin: () => { noise(0.4, 0.25, 900, 0.7, 3000); tone(98, 0.5, 'sawtooth', 0.06); },
  gavel: () => { noise(0.12, 0.5, 300, 1.5); tone(80, 0.3, 'sine', 0.2); },
  vanish: () => { tone(880, 1.4, 'sine', 0.05, 0, 110); noise(1.2, 0.08, 4000, 0.5, 200); },
  phone: () => { tone(1568, 0.12, 'sine', 0.07); tone(2093, 0.18, 'sine', 0.06, 0.12); },
  camera: () => { noise(0.05, 0.3, 5000, 1); noise(0.1, 0.2, 1500, 1); },
  unlock: () => { noise(0.06, 0.3, 2500, 3); tone(660, 0.15, 'triangle', 0.06, 0.08); tone(990, 0.3, 'sine', 0.05, 0.16); },
  pop: () => { tone(520, 0.12, 'sine', 0.12, 0, 1400); tone(1760, 0.25, 'sine', 0.05, 0.08); tone(2637, 0.3, 'sine', 0.03, 0.14); },
  wrong: () => { tone(220, 0.25, 'square', 0.04); tone(180, 0.3, 'square', 0.04, 0.12); },
};

export function sfx(name: string) {
  if (!cfg('effects.ui_sound', true)) return;
  // 파일이 있으면 파일 우선 (public/assets/se/ui_이름.mp3)
  const f = fileOk.get(name);
  if (f) {
    const a = f.cloneNode() as HTMLAudioElement;
    a.volume = Math.min(1, vol());
    void a.play().catch(() => {});
    return;
  }
  if (f === undefined) {
    const probe = new Audio(asset(`se/ui_${name}.mp3`));
    fileOk.set(name, null);
    probe.oncanplaythrough = () => fileOk.set(name, probe);
  }
  try {
    SYNTH[name]?.();
  } catch {
    /* 오디오를 못 쓰는 환경 */
  }
}

/** 버튼마다 마우스 올림·누름 소리를 자동으로 붙인다 */
export function installUiSounds() {
  let last: Element | null = null;
  document.addEventListener('pointerover', (e) => {
    const b = (e.target as HTMLElement).closest('button:not(:disabled), .hotspot');
    if (b && b !== last) {
      last = b;
      sfx('hover');
    } else if (!b) last = null;
  });
  document.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest('button:not(:disabled)');
    if (!b) return;
    if (b.classList.contains('choice')) sfx('choice');
    else sfx('click');
  }, true);
}
