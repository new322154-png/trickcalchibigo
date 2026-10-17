/**
 * 낮 화면 배경 장면.
 *  아침·토론·1차 투표: 나무 아래 광장을 자유롭게 걸어 다니며 말풍선 채팅 (WASD / 방향패드)
 *  결선·판결: 재판장 — 무대 위에 후보(나중엔 처형될 한 명), 나머지는 무대 앞에 관객처럼 옹기종기 (못 움직임)
 * 정체 보호: 나는 내 직업 캐릭터, 다른 사람은 모두 공용 모습.
 */
import { PLAZA, plazaPhase, type CutKind, type GameView } from '../../shared/protocol';
import { bgUrl, h } from './dom';
import { MoveInput, isTouch } from './input';

interface Av { el: HTMLElement; bubble: HTMLElement; timer: number; x: number; y: number; tx: number; ty: number }

/** 광장 걷는 속도 (배경 폭 % / 초) */
const WALK = 16;

export class Scene {
  el: HTMLElement;
  private box = h('div.sc-box');
  private avs = new Map<number, Av>();
  private mode: 'day' | 'trial' | '' = '';
  private walking = false;
  private input = new MoveInput();
  private raf = 0;
  private last = performance.now();
  private lastSent = 0;

  constructor(private myPid: number, private myImg: () => string, private anon: (pid: number) => string, private name: (p: number) => string,
    private onMove: (x: number, y: number) => void) {
    this.el = h('div.g-scene', this.box);
    if (isTouch()) { this.input.el.classList.add('sc-joy'); this.el.appendChild(this.input.el); }
    this.loop();
  }

  destroy() { cancelAnimationFrame(this.raf); this.input.destroy(); }

  update(v: GameView) {
    const trial = v.phase === 'defense' || v.phase === 'vote2' || v.phase === 'verdict';
    const mode = trial ? 'trial' : 'day';
    if (mode !== this.mode) {
      this.mode = mode;
      this.box.style.setProperty('--sc-bg', bgUrl(trial ? 'trial.webp' : 'day.webp'));
      this.box.classList.toggle('trial', trial);
    }
    const me = v.players.find((p) => p.pid === this.myPid);
    this.walking = plazaPhase(v.phase) && !!v.plaza;
    this.el.classList.toggle('walking', this.walking && !!me?.alive);
    const alive = v.players.filter((p) => p.alive);
    const stage = trial ? (v.stage ?? []) : [];
    // 자리 (x%, 발 y%)
    const spots = new Map<number, [number, number]>();
    if (trial) {
      const on = stage.filter((id) => v.players.some((p) => p.pid === id));
      on.forEach((id, i) => spots.set(id, [on.length === 1 ? 50 : 45 + i * 10, 54.5]));
      // 관객: 무대 앞에 다닥다닥 (앞줄이 더 많고, 살짝 겹쳐도 됨)
      const crowd = alive.filter((p) => !on.includes(p.pid));
      const perRow = Math.max(4, Math.ceil(crowd.length / 2));
      crowd.forEach((p, i) => {
        const row = Math.floor(i / perRow), col = i % perRow;
        const inRow = Math.min(perRow, crowd.length - row * perRow);
        const gap = 4.6;
        spots.set(p.pid, [50 + (col - (inRow - 1) / 2) * gap + (row % 2 ? gap / 2 : 0), 64.5 - row * 3.5]);
      });
    } else if (v.plaza) {
      for (const [pid, x, y] of v.plaza) spots.set(pid, [x, y]);
    } else {
      alive.forEach((p, i) => spots.set(p.pid, [30 + (i * 40) / Math.max(1, alive.length - 1), 62]));
    }
    for (const [pid, av] of this.avs) if (!spots.has(pid)) { av.el.remove(); this.avs.delete(pid); }
    for (const [pid, [x, y]] of spots) {
      let av = this.avs.get(pid);
      if (!av) {
        const bubble = h('div.sc-bubble');
        const el = h(`div.sc-av${pid === this.myPid ? '.me' : ''}`,
          h('img', { src: pid === this.myPid ? this.myImg() : this.anon(pid), alt: '' }),
          h('div.sc-name', pid === this.myPid ? '나' : this.name(pid)), bubble);
        this.box.appendChild(el);
        av = { el, bubble, timer: 0, x, y, tx: x, ty: y };
        this.avs.set(pid, av);
      }
      // 광장에서 내 위치는 내가 정한다 (처음 한 번만 서버 값을 받음)
      if (!(this.walking && pid === this.myPid && av.el.dataset.placed)) { av.tx = x; av.ty = y; }
      if (!this.walking) { av.x = x; av.y = y; }
      av.el.dataset.placed = '1';
      av.el.classList.toggle('onstage', stage.includes(pid));
    }
    this.box.classList.toggle('static', !this.walking);
  }

  move(pid: number, x: number, y: number) {
    const av = this.avs.get(pid);
    if (av && pid !== this.myPid) { av.tx = x; av.ty = y; }
  }

  say(pid: number, text: string) {
    const av = this.avs.get(pid);
    if (!av) return;
    av.bubble.textContent = text;
    av.bubble.classList.add('show');
    clearTimeout(av.timer);
    av.timer = window.setTimeout(() => av.bubble.classList.remove('show'), 4500);
  }

  private loop = () => {
    this.raf = requestAnimationFrame(this.loop);
    const t = performance.now();
    const dt = Math.min(0.05, (t - this.last) / 1000);
    this.last = t;
    const me = this.avs.get(this.myPid);
    if (this.walking && me) {
      const typing = (document.activeElement as HTMLElement | null)?.tagName === 'INPUT';
      const d = typing ? { x: 0, y: 0 } : this.input.dir();
      if (d.x || d.y) {
        // 배경은 가로:세로 = 1280:820 이므로 세로 %는 그만큼 빠르게
        me.tx = Math.max(PLAZA.x0, Math.min(PLAZA.x1, me.tx + d.x * WALK * dt));
        me.ty = Math.max(PLAZA.y0, Math.min(PLAZA.y1, me.ty + d.y * WALK * 1.56 * dt * 0.8));
        me.x = me.tx; me.y = me.ty;
        if (d.x) me.el.classList.toggle('flip', d.x > 0);
        if (t - this.lastSent > 90) { this.onMove(Math.round(me.x * 10) / 10, Math.round(me.y * 10) / 10); this.lastSent = t; }
      }
      me.el.classList.toggle('moving', !!(d.x || d.y));
    }
    for (const [pid, a] of this.avs) {
      if (pid !== this.myPid || !this.walking) {
        const dx = a.tx - a.x, dy = a.ty - a.y;
        if (this.walking) {
          const k = Math.min(1, dt * 10);
          a.x += dx * k; a.y += dy * k;
          if (Math.abs(dx) > 0.05) a.el.classList.toggle('flip', dx > 0);
          a.el.classList.toggle('moving', Math.hypot(dx, dy) > 0.15);
        } else { a.x = a.tx; a.y = a.ty; a.el.classList.remove('moving'); }
      }
      // 원근: 아래(앞)로 올수록 조금 크게
      const size = 12 + (a.y - 50) * 0.18 + (a.el.classList.contains('onstage') ? 3 : 0);
      a.el.style.left = a.x + '%';
      a.el.style.top = a.y + '%';
      a.el.style.height = size + '%';
      a.el.style.zIndex = String(Math.round(a.y * 10));
    }
  };
}

/** 모두가 보는 컷씬 (전용 그림은 assets/cut/<kind>.png 가 생기면 그걸 쓴다). 여러 개면 차례대로 */
const cutQueue: (() => void)[] = [];
let cutPlaying = false;
function nextCut() {
  const f = cutQueue.shift();
  cutPlaying = !!f;
  f?.();
}
export function playCut(host: HTMLElement, kind: CutKind, text: string, fallbackImg: string) {
  cutQueue.push(() => {
    const img = h('img.cut-img', { src: `./assets/cut/${kind}.png`, alt: '' }) as HTMLImageElement;
    img.onerror = () => { img.onerror = null; img.src = fallbackImg; img.classList.add('fallback'); };
    const el = h(`div.cut.cut-${kind}`, h('div.cut-light'), img, h('div.cut-text', text), h('div.cut-skip', '눌러서 넘기기'));
    let done = false;
    const close = () => { if (done) return; done = true; el.classList.add('out'); setTimeout(() => { el.remove(); nextCut(); }, 400); };
    el.onclick = close;
    host.appendChild(el);
    setTimeout(close, 2600);
  });
  if (!cutPlaying) nextCut();
}
