/**
 * 낮 화면 위쪽 장면.
 *  토론·투표: 나무 아래 잔디에 살아 있는 사람들이 옹기종기 (움직이지 않음)
 *  결선·판결: 재판장 — 무대 위에 후보(나중엔 처형될 한 명), 나머지는 아래에서 구경
 * 정체 보호: 나는 내 직업 캐릭터, 다른 사람은 모두 공용 모습.
 */
import type { CutKind, GameView } from '../../shared/protocol';
import { bgUrl, h } from './dom';

interface Av { el: HTMLElement; bubble: HTMLElement; timer: number }

export class Scene {
  el: HTMLElement;
  private box = h('div.sc-box');
  private avs = new Map<number, Av>();
  private mode: 'day' | 'trial' | '' = '';

  constructor(private myPid: number, private myImg: () => string, private anon: string, private name: (p: number) => string) {
    this.el = h('div.g-scene', this.box);
  }

  update(v: GameView) {
    const trial = v.phase === 'defense' || v.phase === 'vote2' || v.phase === 'verdict';
    const mode = trial ? 'trial' : 'day';
    if (mode !== this.mode) {
      this.mode = mode;
      this.box.style.setProperty('--sc-bg', bgUrl(trial ? 'trial.webp' : 'day.webp'));
      this.box.classList.toggle('trial', trial);
    }
    const alive = v.players.filter((p) => p.alive);
    const stage = trial ? (v.stage ?? []) : [];
    // 자리 정하기 (x, 발 위치 y, 크기는 상자 높이에 대한 %)
    const spots = new Map<number, [number, number, number]>();
    if (trial) {
      const on = stage.filter((id) => v.players.some((p) => p.pid === id));
      on.forEach((id, i) => spots.set(id, [on.length === 1 ? 50 : 44 + i * 12, 55, 25]));
      const crowd = alive.filter((p) => !on.includes(p.pid));
      crowd.forEach((p, i) => {
        const n = crowd.length;
        spots.set(p.pid, [n === 1 ? 50 : 10 + (80 * i) / (n - 1), 97 - (i % 2) * 5, 22]);
      });
    } else {
      // 잔디 앞쪽 반원 (가운데가 가장 앞)
      const n = alive.length;
      alive.forEach((p, i) => {
        const t = n === 1 ? 0.5 : i / (n - 1);
        const a = Math.PI * (0.06 + 0.88 * t);
        spots.set(p.pid, [50 - 42 * Math.cos(a), 63 + 14 * Math.sin(a), 22 + 4 * Math.sin(a)]);
      });
    }
    for (const [pid, av] of this.avs) if (!spots.has(pid)) { av.el.remove(); this.avs.delete(pid); }
    for (const [pid, [x, y, size]] of spots) {
      let av = this.avs.get(pid);
      if (!av) {
        const bubble = h('div.sc-bubble');
        const el = h(`div.sc-av${pid === this.myPid ? '.me' : ''}`,
          h('img', { src: pid === this.myPid ? this.myImg() : this.anon, alt: '' }),
          h('div.sc-name', pid === this.myPid ? '나' : this.name(pid)), bubble);
        this.box.appendChild(el);
        av = { el, bubble, timer: 0 };
        this.avs.set(pid, av);
      }
      av.el.style.left = x + '%';
      av.el.style.top = y + '%';
      av.el.style.height = size + '%';
      av.el.style.zIndex = String(Math.round(y * 10));
      av.el.classList.toggle('onstage', stage.includes(pid));
      av.el.classList.toggle('dead', !v.players.find((p) => p.pid === pid)?.alive);
    }
  }

  say(pid: number, text: string) {
    const av = this.avs.get(pid);
    if (!av) return;
    av.bubble.textContent = text;
    av.bubble.classList.add('show');
    clearTimeout(av.timer);
    av.timer = window.setTimeout(() => av.bubble.classList.remove('show'), 4500);
  }
}

/** 모두가 보는 컷씬 (전용 그림은 assets/cut/<kind>.png 가 생기면 그걸 쓴다) */
export function playCut(host: HTMLElement, kind: CutKind, text: string, fallbackImg: string) {
  const img = h('img.cut-img', { src: `./assets/cut/${kind}.png`, alt: '' }) as HTMLImageElement;
  img.onerror = () => { img.onerror = null; img.src = fallbackImg; img.classList.add('fallback'); };
  const el = h(`div.cut.cut-${kind}`, h('div.cut-light'), img, h('div.cut-text', text), h('div.cut-skip', '눌러서 넘기기'));
  const close = () => { el.classList.add('out'); setTimeout(() => el.remove(), 400); };
  el.onclick = close;
  host.appendChild(el);
  setTimeout(close, 2800);
}
