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
/** 폰처럼 작은 화면에서 게임 화면은 1280×720 무대를 써서 글자를 키운다 */
export function setCompact(on: boolean) {
  compact = on && Math.min(document.documentElement.clientWidth, (document.documentElement.clientHeight * 16) / 9) < 1400;
  stage.classList.toggle('compact', compact);
  fitStage();
}

function fitStage() {
  const [w, hh] = compact ? [1280, 720] : [1920, 1080];
  const vw = document.documentElement.clientWidth || window.innerWidth;
  const vh = document.documentElement.clientHeight || window.innerHeight;
  const k = Math.min(vw / w, vh / hh);
  stage.style.width = w + 'px';
  stage.style.height = hh + 'px';
  stage.style.transform = `translate(-50%, -50%) scale(${k})`;
}

export const getStage = () => stage;
