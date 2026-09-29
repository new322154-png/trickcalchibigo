/** DOM 도우미.  h('div.box#id', { onclick }, [자식…]) */
type Attrs = Record<string, any>;
type Child = Node | string | number | null | undefined | false | Child[];

export function h<K extends keyof HTMLElementTagNameMap>(
  sel: K | string,
  attrs: Attrs | Child = {},
  ...children: Child[]
): HTMLElement {
  if (attrs instanceof Node || typeof attrs !== 'object' || Array.isArray(attrs) || attrs === null) {
    children.unshift(attrs as Child);
    attrs = {};
  }
  const [tagPart, ...rest] = sel.split(/(?=[.#])/);
  const el = document.createElement(tagPart || 'div');
  for (const r of rest) {
    if (r.startsWith('.')) el.classList.add(r.slice(1));
    else if (r.startsWith('#')) el.id = r.slice(1);
  }
  for (const [k, v] of Object.entries(attrs as Attrs)) {
    if (v === undefined || v === null || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k === 'class') el.className += ' ' + v;
    else if (k === 'html') el.innerHTML = v;
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  append(el, children);
  return el;
}

function append(el: HTMLElement, children: Child[]) {
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    if (Array.isArray(c)) append(el, c);
    else if (c instanceof Node) el.appendChild(c);
    else el.appendChild(document.createTextNode(String(c)));
  }
}

export function $(sel: string, root: ParentNode = document): HTMLElement {
  return root.querySelector(sel) as HTMLElement;
}

export function clear(el: HTMLElement) {
  while (el.firstChild) el.removeChild(el.firstChild);
  return el;
}

/** 무대(16:9) 위의 레이어 가져오기 */
export function layer(name: string): HTMLElement {
  return document.getElementById('layer-' + name)!;
}

/** 이미지 경로. public/assets 기준 */
export function asset(path: string) {
  // ?v=배포번호: 새로 배포하면 브라우저가 예전 캐시 대신 새 파일을 받는다
  return `./assets/${path}?v=${__BUILD_ID__}`;
}

/** 확장자 없이 적은 이미지 이름이면 jpg → png → webp 순서로 시도 */
export function imageWithFallback(img: HTMLImageElement, base: string, exts = ['jpg', 'png', 'webp'], onFail?: () => void) {
  if (/\.\w{3,4}$/.test(base)) {
    img.src = asset(base);
    img.onerror = () => onFail?.();
    return;
  }
  let i = 0;
  const tryNext = () => {
    if (i >= exts.length) {
      img.onerror = null;
      onFail?.();
      return;
    }
    img.src = asset(`${base}.${exts[i++]}`);
  };
  img.onerror = tryNext;
  tryNext();
}
