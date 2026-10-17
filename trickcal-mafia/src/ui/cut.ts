/**
 * 컷씬: 능력을 쓴 사람만 보는 것(p_*)과 모두가 보는 것.
 * 캐릭터 애니메이션(assets/cut/<kind>.webp) 위에 직업 색 띠 · 제목 · 효과를 CSS로 얹는다 (transform/opacity만 써서 모바일도 가볍게).
 * 여러 개가 겹치면 차례대로. 누르면 넘어간다.
 */
import type { CutKind } from '../../shared/protocol';
import { asset, bgUrl, h } from './dom';

interface CutDef { file?: string; title: string; en: string; color: string; layout?: 'contact' | 'paper' }

export const CUTS: Record<CutKind, CutDef> = {
  p_kill: { file: 'p_kill.webp', title: '습격', en: 'ASSAULT', color: '#ff3355' },
  p_seal: { file: 'p_seal.webp', title: '해킹', en: 'HACKING', color: '#2fe6c8' },
  p_identify: { file: 'p_identify.webp', title: '직업 탐지', en: 'IDENTIFY', color: '#8a6bff' },
  p_agitate: { file: 'p_agitate.webp', title: '선동', en: 'AGITATE', color: '#ff8a3d' },
  p_protect: { file: 'p_protect.webp', title: '보호', en: 'PROTECT', color: '#5fd38a' },
  p_investigate: { file: 'p_investigate.webp', title: '조사', en: 'INVESTIGATE', color: '#4da3ff' },
  p_track: { file: 'p_track.webp', title: '추적', en: 'TRACKING', color: '#ffb648' },
  p_disguise: { file: 'p_disguise.webp', title: '변장', en: 'DISGUISE', color: '#ff7ad9' },
  p_farm: { title: '주말농장', en: 'WEEKEND FARM', color: '#9be37a' },
  p_bat: { title: '편 고르기', en: 'CHOOSE A SIDE', color: '#b57bff' },
  p_contact: { title: '접선 성공', en: 'CONTACT', color: '#ff5a5a', layout: 'contact' },
  execute: { file: 'execute.webp', title: '처형', en: 'EXECUTION', color: '#ff3355', layout: 'paper' },
  overturn: { file: 'overturn.webp', title: '판결 뒤집기', en: 'OVERTURN', color: '#7ac8ff' },
  vanish: { title: '실종', en: 'MISSING', color: '#8890b0' },
  saved: { title: '습격 실패', en: 'SAVED', color: '#5fd38a' },
  counter: { file: 'counter.webp', title: '반격', en: 'COUNTER', color: '#ffb648' },
  blast: { file: 'blast.webp', title: '폭사', en: 'EXPLOSION', color: '#ff5a2a' },
  wish: { file: 'wish.webp', title: '소원', en: 'WISH', color: '#9be37a' },
  uros: { file: 'uros.webp', title: '부활', en: 'REVIVAL', color: '#c0405a' },
  drone: { title: '드론', en: 'DRONE', color: '#4da3ff' },
  reveal: { file: 'reveal.webp', title: '정체 공개', en: 'REVEAL', color: '#ffd38a' },
};

/** 내 직업의 개인 컷씬 */
export const MY_CUT: Record<string, CutKind> = {
  nifel: 'p_kill', mute: 'p_seal', bella: 'p_identify', joan: 'p_agitate', doctor: 'p_protect',
  police: 'p_investigate', tracker: 'p_track', spiky: 'p_disguise', medium: 'p_farm', bat: 'p_bat',
};
const PUBLIC: CutKind[] = ['execute', 'overturn', 'counter', 'blast', 'wish', 'uros', 'reveal'];

const cache: HTMLImageElement[] = [];
function preload(src: string) {
  const im = new Image();
  im.decoding = 'async';
  (im as HTMLImageElement & { fetchPriority?: string }).fetchPriority = 'low';
  im.src = src;
  cache.push(im);
}
/** 게임 시작 때: 내 개인 컷씬은 바로, 공용 컷씬은 조금 뒤 여유 있을 때 */
export function preloadCuts(role: string) {
  const mine = MY_CUT[role];
  const f = mine && CUTS[mine].file;
  if (f) preload(asset('cut/' + f));
  if (role === 'mute' || role === 'bella' || role === 'joan' || role === 'uros') { preload(asset('cut/contact_a.webp')); preload(asset('cut/contact_b.webp')); preload(asset('bg/farm.webp')); }
  const later = () => { for (const k of PUBLIC) { const pf = CUTS[k].file; if (pf) preload(asset('cut/' + pf)); } };
  const w = window as Window & { requestIdleCallback?: (f: () => void, o?: { timeout: number }) => void };
  setTimeout(() => (w.requestIdleCallback ? w.requestIdleCallback(later, { timeout: 4000 }) : later()), 3000);
}

const queue: (() => void)[] = [];
let playing = false;
function next() {
  const f = queue.shift();
  playing = !!f;
  f?.();
}

export function playCut(host: HTMLElement, kind: CutKind, text: string, fallbackImg: string) {
  const def = CUTS[kind];
  if (!def) return;
  queue.push(() => {
    const el = h(`div.cut2.lay-${def.layout ?? 'char'}${kind.startsWith('p_') ? '.mine' : ''}`, { style: `--c: ${def.color}` });
    if (def.layout === 'contact') {
      el.append(
        h('div.cut2-scene', { style: `--bg: ${bgUrl('farm.webp')}` }),
        h('img.cut2-left', { src: asset('cut/contact_a.webp'), alt: '' }),
        h('img.cut2-right', { src: asset('cut/contact_b.webp'), alt: '' }),
        h('div.cut2-flash'));
    } else if (def.layout === 'paper') {
      el.append(h('div.cut2-bg'), h('img.cut2-paper', { src: asset('cut/' + def.file), alt: '' }), h('div.cut2-flash.red'));
    } else {
      const img = h('img.cut2-char', { src: def.file ? asset('cut/' + def.file) : fallbackImg, alt: '' }) as HTMLImageElement;
      if (!def.file) img.classList.add('still');
      img.onerror = () => { img.onerror = null; img.src = fallbackImg; img.classList.add('still'); };
      el.append(h('div.cut2-bg'), h('div.cut2-band'), h('div.cut2-lines'), img);
    }
    el.append(
      h('div.cut2-title', h('small', def.en), h('b', def.title), text && text !== def.title ? h('span', text) : ''),
      h('div.cut2-skip', '눌러서 넘기기'));
    let done = false;
    const close = () => { if (done) return; done = true; el.classList.add('out'); setTimeout(() => { el.remove(); next(); }, 300); };
    el.onclick = close;
    host.appendChild(el);
    setTimeout(close, def.layout === 'contact' ? 3200 : 2800);
  });
  if (!playing) next();
}
