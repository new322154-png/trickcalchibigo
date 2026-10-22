/** 이동 입력: PC는 WASD·방향키, 모바일은 화면의 방향패드(조이스틱) */
import { h } from './dom';

export class MoveInput {
  private keys = new Set<string>();
  private stick = { x: 0, y: 0 };
  enabled = true;
  el: HTMLElement;
  private onKey = (e: KeyboardEvent) => {
    const tag = (e.target as HTMLElement)?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA') return;
    const k = e.key.toLowerCase();
    if (['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(k)) {
      e.preventDefault();
      if (e.type === 'keydown') this.keys.add(k); else this.keys.delete(k);
    }
  };
  private onBlur = () => this.keys.clear();

  constructor() {
    window.addEventListener('keydown', this.onKey);
    window.addEventListener('keyup', this.onKey);
    window.addEventListener('blur', this.onBlur);
    const knob = h('div.joy-knob');
    this.el = h('div.joy', knob);
    let pid: number | null = null;
    const R = 70;
    const move = (e: PointerEvent) => {
      const r = this.el.getBoundingClientRect();
      const scale = r.width / 200;
      let dx = (e.clientX - (r.left + r.width / 2)) / scale;
      let dy = (e.clientY - (r.top + r.height / 2)) / scale;
      const d = Math.hypot(dx, dy);
      if (d > R) { dx = (dx / d) * R; dy = (dy / d) * R; }
      const k = this.el.offsetWidth / 200; // 화면마다 조이스틱 크기가 달라도 손잡이가 테두리 안에서 움직이게
      knob.style.transform = `translate(${dx * k}px, ${dy * k}px)`;
      this.stick = { x: dx / R, y: dy / R };
    };
    const end = () => { pid = null; this.stick = { x: 0, y: 0 }; knob.style.transform = ''; };
    this.el.addEventListener('pointerdown', (e) => { pid = e.pointerId; this.el.setPointerCapture(e.pointerId); move(e); });
    this.el.addEventListener('pointermove', (e) => { if (e.pointerId === pid) move(e); });
    this.el.addEventListener('pointerup', end);
    this.el.addEventListener('pointercancel', end);
  }

  /** -1~1 방향 */
  dir(): { x: number; y: number } {
    if (!this.enabled) return { x: 0, y: 0 };
    let x = this.stick.x, y = this.stick.y;
    const k = this.keys;
    if (k.has('a') || k.has('arrowleft')) x -= 1;
    if (k.has('d') || k.has('arrowright')) x += 1;
    if (k.has('w') || k.has('arrowup')) y -= 1;
    if (k.has('s') || k.has('arrowdown')) y += 1;
    const d = Math.hypot(x, y);
    if (d > 1) { x /= d; y /= d; }
    return { x, y };
  }

  destroy() {
    window.removeEventListener('keydown', this.onKey);
    window.removeEventListener('keyup', this.onKey);
    window.removeEventListener('blur', this.onBlur);
  }
}

export const isTouch = () => matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
