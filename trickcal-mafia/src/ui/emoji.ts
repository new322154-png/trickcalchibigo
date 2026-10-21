/**
 * 이모지를 기기 글꼴 대신 선명한 그림(Twemoji SVG)으로 보여 준다.
 * 기기마다 이모지 모양·선명도가 달라서(특히 😱 같은 얼굴이 뭉개짐) 화면에 들어오는 글자를 지켜보다가
 * 그림이 있는 이모지만 <img class="emo"> 로 바꾼다. 입력창 안의 글자는 건드리지 않는다.
 * 그림: Twemoji (CC-BY 4.0, https://github.com/jdecked/twemoji) — public/assets/emoji
 */
import { EMOJI_FILES } from './emoji-list';
import { asset } from './dom';

const ZWJ = String.fromCodePoint(0x200d), VS = String.fromCodePoint(0xfe0f);
const RE = new RegExp(`\\p{Extended_Pictographic}(?:${VS}|[${String.fromCodePoint(0x1f3fb)}-${String.fromCodePoint(0x1f3ff)}])?(?:${ZWJ}\\p{Extended_Pictographic}${VS}?)*`, 'gu');

export function emojiFile(e: string): string | null {
  let cps = [...e].map((c) => c.codePointAt(0)!.toString(16));
  if (!e.includes(ZWJ)) cps = cps.filter((c) => c !== 'fe0f');
  const n = cps.join('-');
  return EMOJI_FILES.has(n) ? asset(`emoji/${n}.svg`) : null;
}

/** 이모지 하나를 그림으로 (없으면 글자 그대로) */
export function emo(e: string, cls = ''): HTMLElement | Text {
  const src = emojiFile(e);
  if (!src) return document.createTextNode(e);
  const im = document.createElement('img');
  im.className = 'emo' + (cls ? ' ' + cls : '');
  im.alt = e; im.draggable = false;
  // 그림을 못 받으면 원래 글자로
  im.onerror = () => { im.replaceWith(document.createTextNode(e)); };
  im.src = src;
  return im;
}

const SKIP = new Set(['INPUT', 'TEXTAREA', 'SCRIPT', 'STYLE', 'OPTION', 'SELECT', 'TITLE']);

function swapText(t: Text) {
  const s = t.data;
  RE.lastIndex = 0;
  if (!RE.test(s)) return;
  RE.lastIndex = 0;
  const frag = document.createDocumentFragment();
  let last = 0, changed = false;
  for (const m of s.matchAll(RE)) {
    const src = emojiFile(m[0]);
    if (!src) continue;
    if (m.index! > last) frag.appendChild(document.createTextNode(s.slice(last, m.index)));
    frag.appendChild(emo(m[0]));
    last = m.index! + m[0].length;
    changed = true;
  }
  if (!changed) return;
  if (last < s.length) frag.appendChild(document.createTextNode(s.slice(last)));
  t.replaceWith(frag);
}

function scan(n: Node) {
  if (n.nodeType === 3) { const p = n.parentElement; if (p && !SKIP.has(p.tagName) && !p.isContentEditable) swapText(n as Text); return; }
  if (n.nodeType !== 1 || SKIP.has((n as Element).tagName)) return;
  const w = document.createTreeWalker(n, NodeFilter.SHOW_TEXT);
  const list: Text[] = [];
  for (let t = w.nextNode(); t; t = w.nextNode()) { const p = t.parentElement; if (p && !SKIP.has(p.tagName)) list.push(t as Text); }
  for (const t of list) swapText(t);
}

/** 화면 전체를 지켜보며 바꾼다 (한 번만 부르면 됨) */
export function watchEmoji(root: Node = document.body) {
  scan(root);
  new MutationObserver((ms) => {
    for (const m of ms) {
      if (m.type === 'characterData') scan(m.target);
      else for (const n of m.addedNodes) scan(n);
    }
  }).observe(root, { childList: true, subtree: true, characterData: true });
}
