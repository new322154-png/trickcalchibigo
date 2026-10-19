/**
 * 낮 화면 배경 장면.
 *  아침·토론·1차 투표: 나무 아래 광장을 자유롭게 걸어 다니며 말풍선 채팅 (WASD / 방향패드)
 *  결선·판결: 재판장 — 무대 위에 후보(나중엔 처형될 한 명), 나머지는 무대 앞에 관객처럼 옹기종기 (못 움직임)
 * 정체 보호: 나는 내 직업 캐릭터, 다른 사람은 모두 공용 모습.
 */
import { PLAZA, plazaPhase, type GameView } from '../../shared/protocol';
import { bgUrl, h } from './dom';
import { follow } from './follow';
import { MoveInput } from './input';

interface Av { mv?: number; mvOn?: boolean; el: HTMLElement; img: HTMLImageElement; src: string; bubble: HTMLElement; timer: number; x: number; y: number; tx: number; ty: number; /** 마지막으로 그린 값 (같으면 DOM을 안 건드림) */ dk: string }

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
  /** 배경 상자 크기 (px) — 크기가 바뀔 때만 다시 잼 */
  private bw = 0;
  private bh = 0;
  private paused = false;
  /** 모바일 방향패드 (화면 맨 위층에 GameUI 가 붙인다) */
  joy: HTMLElement;
  walkingNow = false;
  private ro?: ResizeObserver;

  constructor(private myPid: number, private myImg: () => string, private anon: (pid: number) => string, private name: (p: number) => string,
    private onMove: (x: number, y: number) => void) {
    this.el = h('div.g-scene', this.box);
    this.joy = this.input.el;
    this.joy.classList.add('sc-joy');
    const measure = () => { this.bw = this.box.clientWidth; this.bh = this.box.clientHeight; for (const a of this.avs.values()) a.dk = ''; };
    if ('ResizeObserver' in window) { this.ro = new ResizeObserver(measure); this.ro.observe(this.box); }
    else (window as Window).addEventListener('resize', measure);
    requestAnimationFrame(measure);
    this.loop();
  }

  destroy() { cancelAnimationFrame(this.raf); this.input.destroy(); this.ro?.disconnect(); }

  update(v: GameView) {
    const trial = v.phase === 'defense' || v.phase === 'vote2' || v.phase === 'verdict';
    const mode = trial ? 'trial' : 'day';
    if (mode !== this.mode) {
      this.mode = mode;
      this.box.style.setProperty('--sc-bg', bgUrl(trial ? 'trial.webp' : 'day.webp'));
      this.box.classList.toggle('trial', trial);
    }
    // 밤에는 밤 화면이 다 덮으므로 장면 계산을 쉰다
    this.paused = v.phase === 'night';
    const me = v.players.find((p) => p.pid === this.myPid);
    this.walking = plazaPhase(v.phase) && !!v.plaza;
    this.walkingNow = this.walking && !!me?.alive;
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
        const src = pid === this.myPid ? this.myImg() : this.anon(pid);
        const img = h('img', { src, alt: '' }) as HTMLImageElement;
        const el = h(`div.sc-av${pid === this.myPid ? '.me' : ''}`, img,
          h('div.sc-name', pid === this.myPid ? '나' : this.name(pid)), bubble);
        this.box.appendChild(el);
        av = { el, img, src, bubble, timer: 0, x, y, tx: x, ty: y, dk: '' };
        this.avs.set(pid, av);
      }
      // 광장에서 내 위치는 내가 정한다 (처음 한 번만 서버 값을 받음)
      if (!(this.walking && pid === this.myPid && av.el.dataset.placed)) { av.tx = x; av.ty = y; }
      if (!this.walking) { av.x = x; av.y = y; }
      av.el.dataset.placed = '1';
      // 정체가 드러나면 가면 대신 그 캐릭터로
      const src = pid === this.myPid ? this.myImg() : this.anon(pid);
      if (src !== av.src) { av.src = src; av.img.src = src; }
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
    if (this.paused || !this.bw) return;
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
          // 광장 % 단위: 0.22초에 걸쳐 따라감, 최소 3%/s ~ 최대 80%/s
          const on = follow(a, dt, t, 0.22, 3, 80, 0.05);
          if (Math.abs(dx) > 0.3) a.el.classList.toggle('flip', dx > 0);
          if (on !== a.mvOn) { a.mvOn = on; a.el.classList.toggle('moving', on); }
        } else { a.x = a.tx; a.y = a.ty; if (a.mvOn) { a.mvOn = false; a.el.classList.remove('moving'); } }
      }
      // 원근: 아래(앞)로 올수록 조금 크게. 위치는 transform 으로만 (레이아웃 재계산 없음)
      const size = 12 + (a.y - 50) * 0.18 + (a.el.classList.contains('onstage') ? 3 : 0);
      const px = (a.x / 100) * this.bw, py = (a.y / 100) * this.bh, ph = (size / 100) * this.bh;
      const dk = `${px.toFixed(1)},${py.toFixed(1)},${ph.toFixed(1)}`;
      if (dk === a.dk) continue;
      a.dk = dk;
      a.el.style.transform = `translate3d(${px}px, ${py}px, 0) translate(-50%, -100%)`;
      a.el.style.height = ph.toFixed(1) + 'px';
      a.el.style.zIndex = String(Math.round(a.y * 10));
    }
  };
}

