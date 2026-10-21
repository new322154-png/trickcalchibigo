/**
 * 컷씬: 능력을 쓴 사람만 보는 것(p_*)과 모두가 보는 것.
 * 캐릭터 애니메이션(assets/cut/<kind>.webp) 위에 직업 색 띠 · 제목 · 효과를 CSS로 얹는다
 * (transform/opacity 위주라 모바일도 가볍게). 여러 개가 겹치면 차례대로. 누르면 넘어간다.
 */
import type { CutKind } from '../../shared/protocol';
import { asset, bgUrl, h } from './dom';
import { sfx } from './sfx';

type Layout = 'char' | 'contact' | 'paper' | 'impact' | 'farm' | 'bat' | 'vanish' | 'drone' | 'droneTry';
interface CutDef { file?: string; title: string; en: string; color: string; layout?: Layout; ms?: number }

export const CUTS: Record<CutKind, CutDef> = {
  p_kill: { file: 'p_kill.webp', title: '습격', en: 'ASSAULT', color: '#ff3355' },
  p_seal: { file: 'p_seal.webp', title: '해킹', en: 'HACKING', color: '#2fe6c8' },
  p_identify: { file: 'p_identify.webp', title: '직업 탐지', en: 'IDENTIFY', color: '#8a6bff' },
  p_agitate: { file: 'p_agitate.webp', title: '선동', en: 'AGITATE', color: '#ff8a3d' },
  p_protect: { file: 'p_protect.webp', title: '치유', en: 'HEAL', color: '#5fd38a' },
  p_investigate: { file: 'p_investigate.webp', title: '조사', en: 'INVESTIGATE', color: '#4da3ff' },
  p_track: { file: 'p_track.webp', title: '추적', en: 'TRACKING', color: '#ffb648' },
  p_disguise: { file: 'p_disguise.webp', title: '변장', en: 'DISGUISE', color: '#ff7ad9' },
  p_farm: { file: 'p_farm.webp', title: '주말농장', en: 'WEEKEND FARM', color: '#9be37a', layout: 'farm', ms: 4800 },
  p_bat: { file: 'p_bat.webp', title: '편 고르기', en: 'CHOOSE A SIDE', color: '#b57bff', layout: 'bat', ms: 5600 },
  p_contact: { title: '접선 성공', en: 'CONTACT', color: '#ff5a5a', layout: 'contact', ms: 3200 },
  p_drone_ok: { file: 'drone_fail.webp', title: '드론 완성!', en: 'SUCCESS', color: '#4da3ff', layout: 'droneTry', ms: 2200 },
  p_drone_fail: { file: 'drone_ok.webp', title: '조립 실패', en: 'FAILED', color: '#8890b0', layout: 'droneTry', ms: 2000 },
  execute: { file: 'execute.webp', title: '처형', en: 'EXECUTION', color: '#ff3355', layout: 'paper' },
  overturn: { file: 'overturn.webp', title: '판결 뒤집기', en: 'OVERTURN', color: '#7ac8ff' },
  vanish: { title: '실종', en: 'MISSING', color: '#8890b0', layout: 'vanish', ms: 5200 },
  saved: { file: 'p_protect.webp', title: '치유', en: 'HEALED', color: '#5fd38a', layout: 'impact', ms: 2600 },
  counter: { file: 'counter.webp', title: '반격', en: 'COUNTER', color: '#ffb648', layout: 'impact', ms: 2600 },
  blast: { file: 'blast.webp', title: '폭사', en: 'EXPLOSION', color: '#ff5a2a' },
  wish: { file: 'wish.webp', title: '소원', en: 'WISH', color: '#9be37a' },
  uros: { file: 'uros.webp', title: '부활', en: 'REVIVAL', color: '#c0405a' },
  drone: { title: '드론 소리', en: 'BZZZZ…', color: '#4da3ff', layout: 'drone', ms: 3400 },
  reveal: { file: 'reveal.webp', title: '정체 공개', en: 'REVEAL', color: '#ffd38a' },
};

/** 내 직업의 개인 컷씬 */
/** 컷씬이 뜰 때 나는 소리 [소리, 지연 ms] */
const SE: Partial<Record<CutKind, [string, number][]>> = {
  p_kill: [['slash', 0]], p_contact: [['contact', 0]], p_drone_ok: [['droneOk', 0]], p_drone_fail: [['fizzle', 0]],
  p_farm: [['skill', 0], ['bang', 3450]], p_bat: [['skill', 0], ['pop', 4700]],
  execute: [['execute', 0]], vanish: [['vanish', 0], ['panic', 0]], saved: [['heal', 0]], counter: [['clang', 0]],
  blast: [['boom', 0]], wish: [['revive', 0]], uros: [['revive', 0], ['slash', 500]], drone: [['buzz', 0]],
  reveal: [['reveal', 0]], overturn: [['reveal', 0], ['gavel', 200]],
};

export const MY_CUT: Record<string, CutKind[]> = {
  nifel: ['p_kill'], mute: ['p_seal'], bella: ['p_identify'], joan: ['p_agitate'], doctor: ['p_protect'],
  police: ['p_investigate'], tracker: ['p_track'], spiky: ['p_disguise'], medium: ['p_farm'], bat: ['p_bat'],
  elena: ['p_drone_ok', 'p_drone_fail'],
};
const PUBLIC: CutKind[] = ['execute', 'overturn', 'counter', 'saved', 'blast', 'wish', 'uros', 'reveal'];

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
  for (const k of MY_CUT[role] ?? []) { const f = CUTS[k].file; if (f) preload(asset('cut/' + f)); }
  if (role === 'mute' || role === 'bella' || role === 'joan' || role === 'uros') { preload(asset('cut/contact_a.webp')); preload(asset('cut/contact_b.webp')); preload(asset('bg/farm.webp')); }
  if (role === 'elena') preload(asset('cut/drone.webp'));
  const later = () => {
    for (const k of PUBLIC) { const pf = CUTS[k].file; if (pf) preload(asset('cut/' + pf)); }
    preload(asset('cut/drone.webp'));
  };
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

const cutImg = (f: string) => asset('cut/' + f);
const PANIC = ['💦', '😨', '😱', '❗', '‼️', '💦', '😨', '❗'];

/** 캐릭터 컷인 한 장면 (기본 모양) */
function charStage(def: CutDef, img: string, still: boolean, text: string) {
  const im = h(`img.cut2-char${still ? '.still' : ''}`, { src: img, alt: '' });
  return [h('div.cut2-bg'), h('div.cut2-band'), h('div.cut2-lines'), im, title(def, text)];
}
function title(def: CutDef, text: string) {
  return h('div.cut2-title', h('small', def.en), h('b', def.title), text && text !== def.title ? h('span', text) : '');
}

export interface CutExtra { n?: number; myImg?: string }

export function playCut(host: HTMLElement, kind: CutKind, text: string, fallbackImg: string, extra: CutExtra = {}) {
  const def = CUTS[kind];
  if (!def) return;
  queue.push(() => {
    const layout = def.layout ?? 'char';
    const el = h(`div.cut2.lay-${layout}.k-${kind}${kind.startsWith('p_') ? '.mine' : ''}`, { style: `--c: ${def.color}` });
    const file = def.file ? cutImg(def.file) : fallbackImg;
    switch (layout) {
      case 'contact':
        el.append(
          h('div.cut2-scene', { style: `--bg: ${bgUrl('farm.webp')}` }),
          h('img.cut2-left', { src: cutImg('contact_a.webp'), alt: '' }),
          h('img.cut2-right', { src: cutImg('contact_b.webp'), alt: '' }),
          h('div.cut2-flash'), title(def, text));
        break;
      case 'paper':
        el.append(h('div.cut2-bg'), h('img.cut2-paper', { src: file, alt: '' }), h('div.cut2-flash.red'), title(def, text));
        break;
      case 'impact':
        // 해당 직업 모션이 화면 가득 강하게 터졌다가 서서히 사라짐
        el.append(h('div.cut2-bg'), h('div.im-burst'), h('div.im-ring'), h('img.im-char', { src: file, alt: '' }), h('div.cut2-flash'), title(def, text));
        break;
      case 'farm': {
        // ① 이드 컷인 → ② 들판에서 이드가 걸어가다 케이크와 마주쳐 ❗
        const ide = h('div.fa-walker', h('img', { src: asset('chars/ide.webp'), alt: '' }), h('i.fa-bang', '❗'));
        const cake = h('div.fa-cake', h('img', { src: asset('ui/anon.webp'), alt: '' }), h('i.fa-bang.late', '❗'));
        el.append(
          h('div.st-a', ...charStage(def, file, false, '')),
          h('div.st-b', h('div.cut2-scene', { style: `--bg: ${bgUrl('farm.webp')}` }), cake, ide,
            h('div.fa-caption', text || '주말농장에 들어섰다')));
        break;
      }
      case 'bat': {
        // ① 네르 컷인 → ② 니펠 —— 네르 —— 케이크, 갈팡질팡하다 고른 쪽으로
        const side = /마피아/.test(text) ? 'm' : 'c';
        el.classList.add('side-' + side);
        el.append(
          h('div.st-a', ...charStage(def, file, false, '')),
          h('div.st-b',
            h('div.cut2-bg'),
            h('div.bt-team.m', h('img', { src: asset('chars/nifel.webp'), alt: '' }), h('b', '마피아 팀')),
            h('div.bt-team.c', h('img', { src: asset('ui/anon.webp'), alt: '' }), h('b', '시민 팀')),
            h('div.bt-ner', h('div.bt-ner-in', h('img', { src: asset('chars/ner.webp'), alt: '' }), h('i.bt-sweat', '💦'))),
            h('div.bt-result', side === 'm' ? '마피아 팀으로!' : '시민 팀으로!')));
        break;
      }
      case 'vanish': {
        // 케이크들이 인원수대로 하나씩 걸어 나오다… 한 자리가 비어 있다! 다 같이 당황
        const n = Math.max(3, Math.min(12, extra.n ?? 6));
        const row = h('div.va-row', { style: `--n: ${n}` });
        for (let i = 0; i < n; i++) {
          const missing = i === Math.floor(n / 2);
          row.appendChild(missing
            ? h('div.va-slot.missing', { style: `--i: ${i}` }, h('div.va-q', '?'))
            : h('div.va-slot', { style: `--i: ${i}` },
              h('img', { src: asset(`ui/mask${(i % 4) + 1}.webp`), alt: '' }),
              h('i.va-bub', { style: `--d: ${(2.1 + Math.random() * 0.6).toFixed(2)}s` }, PANIC[(i * 3 + Math.floor(Math.random() * 3)) % PANIC.length])));
        }
        el.append(h('div.cut2-scene', { style: `--bg: ${bgUrl('hall_day.webp')}` }), row, h('div.va-msg', h('small', def.en), h('b', text || '누군가 사라졌다!')));
        break;
      }
      case 'drone':
        // 화면을 가리지 않고, 드론이 살짝 지나가며 알림
        el.append(h('div.dr-shade'), h('img.dr-drone', { src: cutImg('drone.webp'), alt: '' }), h('div.dr-msg', '🛸 밤새 어디선가 드론 소리가 들렸다…'));
        break;
      case 'droneTry': {
        const ok = kind === 'p_drone_ok';
        el.append(...charStage(def, file, false, text));
        if (ok) el.append(h('img.dt-drone', { src: cutImg('drone.webp'), alt: '' }));
        else el.append(h('div.dt-smoke', h('i'), h('i'), h('i')));
        break;
      }
      default: {
        const still = !def.file;
        el.append(...charStage(def, file, still, text));
        const img = el.querySelector('img.cut2-char') as HTMLImageElement;
        img.onerror = () => { img.onerror = null; img.src = fallbackImg; img.classList.add('still'); };
      }
    }
    el.append(h('div.cut2-skip', '눌러서 넘기기'));
    let done = false;
    const close = () => { if (done) return; done = true; el.classList.add('out'); setTimeout(() => { el.remove(); next(); }, 300); };
    el.onclick = close;
    host.appendChild(el);
    for (const [s, d] of SE[kind] ?? [['skill', 0]]) d ? setTimeout(() => !done && sfx(s), d) : sfx(s);
    setTimeout(close, def.ms ?? 2800);
  });
  if (!playing) next();
}
