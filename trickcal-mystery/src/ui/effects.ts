/**
 * 화면 효과 — 이 게임만의 연출.
 *   분위기 입자: 촛불 먼지 / 비 / 불티 (#fx:dust, #fx:rain, #fx:embers, #fx:none)
 *   번개 (#lightning), 어긋남·가짜 발견 때의 글리치, 날짜 카드 (#next_day)
 */
import { cfg, t } from '../engine/content';
import { S } from '../engine/state';
import { isTodo, sleep, waitFor } from '../engine/util';
import { clear, h, layer } from './dom';
import { sfx } from './sfx';

const tt = (key: string, fb: string) => {
  const v = t(key);
  return /^\[.*\]$/.test(v) || isTodo(v) ? fb : v;
};

// ═══ 분위기 입자 ═════════════════════════════════════════════

type Kind = 'dust' | 'rain' | 'embers' | 'none';
let kind: Kind = 'none';
let raf = 0;
let canvas: HTMLCanvasElement | null = null;
interface P { x: number; y: number; vx: number; vy: number; r: number; a: number; life: number }
let parts: P[] = [];

export function currentAmbient() {
  return kind;
}

export function setAmbient(next: string) {
  const k = (['dust', 'rain', 'embers'].includes(next) ? next : 'none') as Kind;
  if (S?.stage) S.stage.fx = k;
  if (k === kind && canvas) return;
  kind = k;
  cancelAnimationFrame(raf);
  const root = clear(layer('ambient'));
  parts = [];
  if (k === 'none' || !cfg('effects.ambient', true)) {
    canvas = null;
    return;
  }
  canvas = h('canvas.ambient', { width: 1920, height: 1080 }) as HTMLCanvasElement;
  root.appendChild(canvas);
  const ctx = canvas.getContext('2d')!;
  const count = k === 'rain' ? 220 : k === 'embers' ? 40 : 70;
  const spawn = (init = false): P => {
    if (k === 'rain') return { x: Math.random() * 2200 - 150, y: init ? Math.random() * 1080 : -40, vx: -4, vy: 26 + Math.random() * 12, r: 1, a: 0.15 + Math.random() * 0.25, life: 1 };
    if (k === 'embers') return { x: Math.random() * 1920, y: init ? Math.random() * 1080 : 1100, vx: (Math.random() - 0.5) * 0.6, vy: -0.6 - Math.random() * 1.2, r: 1 + Math.random() * 2.2, a: 0, life: Math.random() };
    return { x: Math.random() * 1920, y: Math.random() * 1080, vx: (Math.random() - 0.5) * 0.25, vy: -0.05 - Math.random() * 0.2, r: 0.6 + Math.random() * 1.8, a: 0, life: Math.random() };
  };
  for (let i = 0; i < count; i++) parts.push(spawn(true));
  const tick = () => {
    ctx.clearRect(0, 0, 1920, 1080);
    for (let i = 0; i < parts.length; i++) {
      const p = parts[i];
      p.x += p.vx;
      p.y += p.vy;
      if (k === 'rain') {
        ctx.strokeStyle = `rgba(200, 210, 255, ${p.a})`;
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.moveTo(p.x, p.y);
        ctx.lineTo(p.x + p.vx * 1.6, p.y + p.vy * 1.6);
        ctx.stroke();
        if (p.y > 1100) parts[i] = spawn();
        continue;
      }
      p.life += 0.004;
      p.a = Math.sin(Math.min(1, p.life) * Math.PI) * (k === 'embers' ? 0.9 : 0.55);
      if (p.life >= 1 || p.y < -20) parts[i] = { ...spawn(), life: 0 };
      const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.r * 4);
      const col = k === 'embers' ? '255, 170, 90' : '255, 225, 170';
      g.addColorStop(0, `rgba(${col}, ${p.a})`);
      g.addColorStop(1, `rgba(${col}, 0)`);
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r * 4, 0, Math.PI * 2);
      ctx.fill();
    }
    raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);
}

// ═══ 번개 ═══════════════════════════════════════════════════

export async function lightning() {
  const fx = layer('fx');
  const f = h('div.lightning');
  fx.appendChild(f);
  sfx('thunder');
  const bg = layer('bg');
  bg.animate([{ filter: 'brightness(1)' }, { filter: 'brightness(2.2) saturate(0.6)' }, { filter: 'brightness(1)' }, { filter: 'brightness(1.8)' }, { filter: 'brightness(1)' }], { duration: 700 });
  await sleep(700);
  f.remove();
}

// ═══ 글리치 (가면이 벗겨지는 순간) ══════════════════════════

export async function glitch(ms = 700) {
  const stage = document.getElementById('stage')!;
  sfx('glitch');
  stage.classList.add('glitching');
  const crack = h('div.glitch-lines');
  layer('fx').appendChild(crack);
  await sleep(ms);
  stage.classList.remove('glitching');
  crack.remove();
}

// ═══ 날짜 카드 ══════════════════════════════════════════════

/** "DAY 2" 카드. vanished 가 있으면 "…그리고 누가 사라졌다" */
export function dayCard(day: number, vanishedName: string | null, found: boolean | null) {
  sfx('bell');
  return waitFor<void>((resolve) => {
    const sub = vanishedName
      ? tt('day.vanished', '밤사이, {name}이(가) 사라졌다.').replace('{name}', vanishedName)
      : found
        ? tt('day.safe', '어젯밤은 아무도 사라지지 않았다.')
        : '';
    const el = h(
      'div.day-card',
      { onclick: () => resolve() },
      h('div.day-ring', h('div.day-moon')),
      h('div.day-kicker', tt('day.kicker', 'THE MANSION WAKES')),
      h('div.day-num', `DAY ${day}`),
      h('div.day-sub', sub),
      h('div.day-rule', tt('day.rule', '오늘도, 이 중 한 명은 가짜다.')),
    );
    layer('fx').appendChild(el);
    const timer = setTimeout(() => resolve(), 4200);
    return () => {
      clearTimeout(timer);
      el.classList.add('out');
      setTimeout(() => el.remove(), 600);
    };
  });
}
