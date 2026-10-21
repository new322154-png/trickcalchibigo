/** 작은 DOM 도우미 + 1920×1080 무대 맞추기 */

type Attrs = Record<string, unknown> & { style?: Partial<CSSStyleDeclaration> | string };
type Child = Node | string | number | null | undefined | false | Child[];

export function h<K extends keyof HTMLElementTagNameMap>(sel: string, attrs?: Attrs | Child, ...kids: Child[]): HTMLElement {
  const m = sel.match(/^([a-z0-9]+)?((?:[.#][\w-]+)*)$/i);
  const tag = (m?.[1] || 'div') as K;
  const el = document.createElement(tag) as HTMLElement;
  for (const part of (m?.[2] ?? '').match(/[.#][\w-]+/g) ?? []) {
    if (part[0] === '.') el.classList.add(part.slice(1));
    else el.id = part.slice(1);
  }
  if (attrs && (typeof attrs !== 'object' || attrs instanceof Node || Array.isArray(attrs))) {
    kids.unshift(attrs as Child);
  } else if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v === undefined || v === null || v === false) continue;
      if (k === 'style') {
        if (typeof v === 'string') el.setAttribute('style', v);
        else Object.assign(el.style, v);
      } else if (k.startsWith('on') && typeof v === 'function') {
        el.addEventListener(k.slice(2), v as EventListener);
      } else if (k === 'class') el.className += ' ' + v;
      else if (k in el && k !== 'list') (el as unknown as Record<string, unknown>)[k] = v;
      else el.setAttribute(k, String(v));
    }
  }
  append(el, kids);
  return el;
}

function append(el: HTMLElement, kids: Child[]) {
  for (const k of kids) {
    if (k === null || k === undefined || k === false) continue;
    if (Array.isArray(k)) append(el, k);
    else el.append(k instanceof Node ? k : String(k));
  }
}

export const clear = <T extends HTMLElement>(el: T): T => {
  el.replaceChildren();
  return el;
};

export const asset = (p: string) => `./assets/${p}`;
/** CSS 변수에 넣을 배경 그림 (public/assets/bg/<name>) */
export const bgUrl = (name: string) => `url("${new URL(asset('bg/' + name), location.href).href}")`;

export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

let stage: HTMLElement;

export function mountStage(): HTMLElement {
  const app = document.getElementById('app')!;
  stage = h('div#stage');
  app.appendChild(stage);
  window.addEventListener('resize', fitStage);
  window.addEventListener('orientationchange', () => setTimeout(fitStage, 300));
  fitStage();
  return stage;
}

let compact = false;
let compactWanted = false;
/** 휴대폰: 터치 화면이면서 짧은 변이 작음 → 모바일 전용 배치 (무대를 화면 비율에 맞춰 꽉 채우고 글자는 크게) */
export const isPhone = () => {
  const vw = document.documentElement.clientWidth || window.innerWidth;
  const vh = document.documentElement.clientHeight || window.innerHeight;
  return (matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window) && Math.min(vw, vh) < 600;
};
/** 폰처럼 작은 화면에서 게임 화면은 1280×720 무대를 써서 글자를 키운다 */
export function setCompact(on: boolean) {
  compactWanted = on;
  compact = on && Math.min(document.documentElement.clientWidth, (document.documentElement.clientHeight * 16) / 9) < 1400;
  stage.classList.toggle('compact', compact);
  fitStage();
}

function fitStage() {
  const vw = document.documentElement.clientWidth || window.innerWidth;
  const vh = document.documentElement.clientHeight || window.innerHeight;
  // 휴대폰 가로: 타이틀부터 게임까지 모두 휴대폰 배치.
  // 무대 높이 430 ≈ 실제 화면 높이(보통 360~430px)라 거의 1배로 보인다 → 글자·버튼이 실제 크기 그대로 (PC 화면을 줄여 보이는 게 아님)
  const phone = isPhone() && vw > vh;
  stage.classList.toggle('mobile', phone);
  const MH = 430;
  const [w, hh] = phone ? [Math.round(Math.max(720, Math.min(1040, (MH * vw) / vh))), MH] : compact ? [1280, 720] : [1920, 1080];
  const k = Math.min(vw / w, vh / hh);
  stage.style.width = w + 'px';
  stage.style.height = hh + 'px';
  stage.style.transform = `translate(-50%, -50%) scale(${k})`;
}

export const getStage = () => stage;
