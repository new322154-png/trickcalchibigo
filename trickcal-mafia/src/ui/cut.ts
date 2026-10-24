/**
 * 컷씬: 능력을 쓴 사람만 보는 것(p_*)과 모두가 보는 것.
 * 캐릭터 애니메이션(assets/cut/<kind>.webp) 위에 직업 색 띠 · 제목 · 효과를 CSS로 얹는다
 * (transform/opacity 위주라 모바일도 가볍게). 여러 개가 겹치면 차례대로. 누르면 넘어간다.
 */
import type { CutKind } from '../../shared/protocol';
import { asset, bgUrl, h } from './dom';
import { sfx } from './sfx';
import { cutSpeed, shatter, type ShatterPlan } from './shatter';

type Layout = 'char' | 'contact' | 'paper' | 'impact' | 'farm' | 'bat' | 'news' | 'drone' | 'droneTry' | 'shatter' | 'kill' | 'hack' | 'wish' | 'inv' | 'heal' | 'saved' | 'track' | 'disg' | 'tarot' | 'agit' | 'verdict' | 'void' | 'parry' | 'boom' | 'flash';
interface CutDef { file?: string; title: string; en: string; color: string; layout?: Layout; ms?: number }

export const CUTS: Record<CutKind, CutDef> = {
  p_kill: { file: 'p_kill.webp', title: '습격', en: 'ASSAULT', color: '#ff3355', layout: 'kill', ms: 3900 },
  p_seal: { file: 'p_seal.webp', title: '해킹', en: 'HACKING', color: '#2fe6c8', layout: 'hack', ms: 3900 },
  p_identify: { file: 'p_identify.webp', title: '직업 탐지', en: 'IDENTIFY', color: '#8a6bff', layout: 'tarot', ms: 3800 },
  p_agitate: { file: 'p_agitate.webp', title: '선동', en: 'AGITATE', color: '#ff8a3d', layout: 'agit', ms: 3800 },
  p_protect: { file: 'p_protect.webp', title: '치유', en: 'HEAL', color: '#5fd38a', layout: 'heal', ms: 3400 },
  p_investigate: { file: 'p_investigate.webp', title: '조사', en: 'INVESTIGATE', color: '#4da3ff', layout: 'inv', ms: 3800 },
  p_track: { file: 'p_track.webp', title: '추적', en: 'TRACKING', color: '#ffb648', layout: 'track', ms: 3600 },
  p_disguise: { file: 'p_disguise.webp', title: '변장', en: 'DISGUISE', color: '#ff7ad9', layout: 'disg', ms: 3800 },
  p_farm: { file: 'p_farm.webp', title: '주말농장', en: 'WEEKEND FARM', color: '#9be37a', layout: 'farm', ms: 4800 },
  p_bat: { file: 'p_bat.webp', title: '편 고르기', en: 'CHOOSE A SIDE', color: '#b57bff', layout: 'bat', ms: 5600 },
  p_contact: { title: '접선 성공', en: 'CONTACT', color: '#ff5a5a', layout: 'contact', ms: 3200 },
  p_drone_ok: { file: 'drone_fail.webp', title: '드론 완성!', en: 'SUCCESS', color: '#4da3ff', layout: 'droneTry', ms: 2200 },
  p_drone_fail: { file: 'drone_ok.webp', title: '조립 실패', en: 'FAILED', color: '#8890b0', layout: 'droneTry', ms: 2000 },
  execute: { file: 'execute.webp', title: '처형', en: 'EXECUTION', color: '#ff3355', layout: 'verdict', ms: 3600 },
  overturn: { file: 'overturn.webp', title: '판결 뒤집기', en: 'OVERTURN', color: '#7ac8ff', layout: 'void', ms: 3800 },
  vanish: { title: '실종', en: 'MISSING', color: '#b0342b', layout: 'news', ms: 4800 },
  saved: { file: 'p_protect.webp', title: '치유', en: 'HEALED', color: '#5fd38a', layout: 'saved', ms: 3600 },
  counter: { file: 'counter.webp', title: '반격', en: 'COUNTER', color: '#ffb648', layout: 'parry', ms: 4000 },
  blast: { file: 'blast.webp', title: '폭사', en: 'EXPLOSION', color: '#ff5a2a', layout: 'boom', ms: 3800 },
  wish: { file: 'wish.webp', title: '소원', en: 'WISH', color: '#9be37a', layout: 'wish', ms: 4800 },
  uros: { file: 'uros.webp', title: '부활', en: 'REVIVAL', color: '#c0405a', layout: 'shatter', ms: 9000 },
  drone: { title: '드론 소리', en: 'BZZZZ…', color: '#4da3ff', layout: 'drone', ms: 3400 },
  reveal: { file: 'reveal.webp', title: '정체 공개', en: 'REVEAL', color: '#ffd38a', layout: 'flash', ms: 4000 },
};

/** 내 직업의 개인 컷씬 */
/** 컷씬이 뜰 때 나는 소리 [소리, 지연 ms] */
const SE: Partial<Record<CutKind, [string, number][]>> = {
  p_investigate: [['skill', 0], ['swoosh', 600], ['swoosh', 1100], ['gavel', 1900]],
  p_protect: [['skill', 0], ['pop', 900], ['heal', 1050], ['gavel', 1600]],
  p_track: [['skill', 0], ['tick', 500], ['tick', 750], ['tick', 1000], ['tick', 1250], ['tick', 1500], ['tick', 1750], ['gavel', 2100]],
  p_disguise: [['skill', 0], ['pop', 1000], ['reveal', 1350]],
  p_identify: [['skill', 0], ['note', 700], ['reveal', 1250]],
  p_agitate: [['skill', 0], ['thump', 1000], ['thump', 1150], ['contact', 1500]],
  p_seal: [['skill', 0], ['tick', 600], ['tick', 900], ['tick', 1200], ['tick', 1500], ['clang', 2050]],
  p_kill: [['door', 0], ['night', 1000], ['slash', 1900], ['slash', 2020], ['slash', 2140]], p_contact: [['contact', 0]], p_drone_ok: [['droneOk', 0]], p_drone_fail: [['fizzle', 0]],
  p_farm: [['skill', 0], ['bang', 3450]], p_bat: [['skill', 0], ['pop', 4700]],
  execute: [['paper', 0], ['gavel', 800], ['execute', 1200], ['swoosh', 1800]], vanish: [['paper', 0], ['vanish', 700], ['gavel', 1250]], saved: [['skill', 0], ['slash', 700], ['clang', 950], ['heal', 1100], ['gavel', 1500]], counter: [['slash', 500], ['punch', 800], ['clang', 820], ['swoosh', 1300], ['gavel', 1900]],
  blast: [['skill', 0], ['tick', 400], ['tick', 700], ['tick', 1000], ['tick', 1250], ['boom', 1500], ['shatter', 1520]], wish: [['skill', 0], ['note', 900], ['revive', 2000]], uros: [], drone: [['buzz', 0]],
  reveal: [['skill', 0], ['pop', 900], ['bang', 1000], ['reveal', 1900]], overturn: [['paper', 300], ['swoosh', 900], ['paper', 1000], ['gavel', 1400]],
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
    preload(asset('bg/farm.webp'));
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
/** 쾅! 맞은 자리: 가는 빛줄기가 사방으로 뻗고 가운데는 하얗게 타오름 (만화 별 대신) */
function POW() {
  const rays: string[] = [];
  const n = 16;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + (Math.random() - 0.5) * 0.25;
    const r0 = 6, r1 = (i % 2 ? 50 : 72) + Math.random() * 28, w = (i % 2 ? 0.06 : 0.09) + Math.random() * 0.04;
    const p = (ang: number, r: number) => `${(Math.cos(ang) * r).toFixed(1)},${(Math.sin(ang) * r).toFixed(1)}`;
    rays.push(`<polygon points="${p(a - w, r0)} ${p(a, r1)} ${p(a + w, r0)}" fill="url(#ray)"/>`);
  }
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '-100 -100 200 200'); svg.setAttribute('class', 'su-pow');
  svg.innerHTML = `<defs><radialGradient id="ray" gradientUnits="userSpaceOnUse" cx="0" cy="0" r="100"><stop offset="0" stop-color="#fff"/><stop offset=".4" stop-color="#fff4d6"/><stop offset=".75" stop-color="#ff6a4a" stop-opacity=".85"/><stop offset="1" stop-color="#ff2a50" stop-opacity="0"/></radialGradient>
    <radialGradient id="core"><stop offset="0" stop-color="#fff"/><stop offset=".45" stop-color="#fff" stop-opacity=".9"/><stop offset="1" stop-color="#ff7a90" stop-opacity="0"/></radialGradient></defs>
    ${rays.join('')}<circle r="30" fill="url(#core)"/><circle r="11" fill="#fff"/>`;
  return svg;
}

/**
 * 우로스 부활 (초, 주말농장 그림이 준비된 때부터): 주말농장의 우로스가 '…' → 몸을 젖혔다가 화면을 쾅 →
 * 맞은 곳부터 금이 번지며 군데군데 떨어져 나감 → 와장창 → 뒤에서 우로스 능력 그림.
 * CSS(.lay-shatter)의 애니메이션 지연 시간과 맞춘다.
 */
const UROS_HIT = 2.05;
const UROS_PLAN: ShatterPlan = {
  at: { x: 0.63, y: 0.55 },
  cracks: [[UROS_HIT, 0.14], [2.55, 0.32], [3.0, 0.56], [3.45, 1.4]],
  drip: [2.3, 3.7, 0.32],
  burst: 3.9,
  hitStop: 0.11,
};

/**
 * 네르 편 고르기: 양쪽 팀이 번갈아 감정표현으로 네르를 부르고(손짓 · 유혹), 고른 쪽은 환호 🎉, 못 고른 쪽은 시무룩 😢.
 * --d: 자동 장면에서 뜨는 때, --pd: 직접 고르는 장면에서 반복 주기 안의 시작점
 */
function teamEmo(side: 'm' | 'c') {
  const calls = side === 'm' ? ['👋', '😈', '💰'] : ['👋', '🙏', '🍰'];
  const base = side === 'm' ? 1.8 : 2.35;
  return h('div.bt-emo',
    ...calls.map((e, i) => h('i.call', { style: `--d: ${(base + i * 0.75).toFixed(2)}s; --pd: ${((side === 'm' ? 0 : 0.6) + i * 1.2).toFixed(2)}s` }, e)),
    h('i.win', '🎉'), h('i.sad', '😢'));
}

/** 장면에 나오는 서 있는 캐릭터 (chars/*.webp) */
const CUT_CHAR: Partial<Record<CutKind, string>> = {
  p_kill: 'nifel', p_seal: 'mute', p_identify: 'bella', p_agitate: 'joan', p_protect: 'hilde', p_investigate: 'polan',
  p_track: 'butter', p_disguise: 'spiky', saved: 'hilde', counter: 'diana', blast: 'mari', wish: 'ui', reveal: 'heidi', overturn: 'rion',
};
/** 이드처럼 두 장면: ① 능력 그림 컷인 → ② 그 능력으로 벌어지는 장면. 처형은 캐릭터 능력이 아니라 바로 장면 */
const INTRO = 1.5;
const TWO_STAGE = new Set<Layout>(['kill', 'hack', 'wish', 'inv', 'heal', 'saved', 'track', 'disg', 'tarot', 'agit', 'void', 'parry', 'boom', 'flash']);

/** 소품 장면들 (크기를 em 으로 맞추고 제목을 아래 가운데에) */
const SCENES = new Set<Layout>(['kill', 'hack', 'wish', 'inv', 'heal', 'saved', 'track', 'disg', 'tarot', 'agit', 'verdict', 'void', 'parry', 'boom', 'flash']);

/** SVG 요소 (h() 는 HTML 이라 SVG 는 따로) */
function svgEl(cls: string, viewBox: string, inner: string) {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  s.setAttribute('class', cls); s.setAttribute('viewBox', viewBox); s.setAttribute('preserveAspectRatio', 'none');
  s.innerHTML = inner;
  return s;
}

/** 대상 폴라로이드 (얼굴 + 손글씨 이름) */
function polaroid(img: string, name: string, cls = '') {
  return h(`div.cx-pol${cls}`, h('div.cx-pic', h('img', { src: img, alt: '' })), h('b', name));
}

/** 캐릭터 컷인 한 장면 (기본 모양) */
function charStage(def: CutDef, img: string, still: boolean, text: string) {
  const im = h(`img.cut2-char${still ? '.still' : ''}`, { src: img, alt: '' });
  return [h('div.cut2-bg'), h('div.cut2-band'), h('div.cut2-lines'), im, title(def, text)];
}
function title(def: CutDef, text: string) {
  return h('div.cut2-title', h('small', def.en), h('b', def.title), text && text !== def.title ? h('span', text) : '');
}

/** 아침 신문 한 장 (실종 / 조용한 밤) */
function newsPaper(kind: 'missing' | 'quiet', headline: string, day: number, photo: string) {
  const dd = String(Math.max(1, day)).padStart(2, '0');
  const missing = kind === 'missing';
  const lines = h('div.nw-lines', ...Array.from({ length: 7 }, (_, i) => h('i', { style: `--w: ${[96, 88, 100, 72, 94, 84, 58][i]}%` })));
  const pic = missing
    ? h('div.nw-photo', h('img', { src: photo, alt: '' }), h('div.nw-q', '?'))
    : h('div.nw-photo.scene', { style: `--bg: ${bgUrl('hall_day.webp')}` });
  return [
    h('div.nw-shade'),
    h('div.nw-paper',
      h('div.nw-mast',
        h('div.nw-ears', h('span', `DAY ${dd}`), h('span', 'MORNING EDITION')),
        h('b.nw-name', '저택 일보'),
        h('small.en.nw-name-en', 'THE MANSION DAILY')),
      h('div.nw-body',
        h('div.nw-pic', pic, h('div.nw-stamp', missing ? 'MISSING' : 'ALL CLEAR'), h('div.nw-cap', missing ? '어젯밤 마지막 모습' : '오늘 아침 광장')),
        h('div.nw-story',
          h('small.en.nw-kick', missing ? 'BREAKING NEWS' : 'MORNING REPORT'),
          h('b.nw-head', headline),
          h('p.nw-sub', missing ? `${Math.max(1, day)}일째 아침, 광장에 빈자리가 생겼다. 범인은 아직 우리 안에 있다.` : '어젯밤 저택에서는 아무도 사라지지 않았다. 하지만 안심하긴 이르다.'),
          lines)),
    ),
  ];
}

/** 조용한 아침: 신문만 (서버 컷 없이 화면에서 띄움) */
export function playNews(host: HTMLElement, day: number) {
  queue.push(() => {
    const el = h('div.cut2.lay-news.k-quiet', { style: '--c: #2f6b4a' }, ...newsPaper('quiet', '조용한 밤이었다', day, ''), h('div.cut2-skip', '눌러서 넘기기'));
    let done = false;
    const close = () => { if (done) return; done = true; el.classList.add('out'); setTimeout(() => { el.remove(); next(); }, 300); };
    el.onclick = close;
    host.appendChild(el);
    sfx('paper'); setTimeout(() => !done && sfx('gavel'), 1250);
    setTimeout(close, 3400);
  });
  if (!playing) next();
}

export interface CutExtra { n?: number; myImg?: string; /** 아침 신문의 날짜 */ day?: number; /** 장면 속 대상 얼굴 · 이름 */ target?: string; name?: string; target2?: string; name2?: string; role?: string; roleImg?: string; roleName?: string }

export function playCut(host: HTMLElement, kind: CutKind, text: string, fallbackImg: string, extra: CutExtra = {}) {
  const def = CUTS[kind];
  if (!def) return;
  queue.push(() => {
    const layout = def.layout ?? 'char';
    const el = h(`div.cut2.lay-${layout}.k-${kind}${kind.startsWith('p_') ? '.mine' : ''}${SCENES.has(layout) ? '.scn' : ''}`, { style: `--c: ${def.color}` });
    const file = def.file ? cutImg(def.file) : fallbackImg;
    // 장면 속 배우는 서 있는 캐릭터 그림 (능력 그림은 앞의 컷인에서)
    const actor = CUT_CHAR[kind] ? asset(`chars/${CUT_CHAR[kind]}.webp`) : file;
    const two = TWO_STAGE.has(layout);
    let after: (() => void) | null = null;
    let stop: (() => void) | null = null;
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
        const side = /니펠/.test(text) ? 'm' : 'c';
        el.classList.add('side-' + side);
        el.append(
          h('div.st-a', ...charStage(def, file, false, '')),
          h('div.st-b',
            h('div.cut2-bg'),
            h('div.bt-team.m', h('img', { src: asset('chars/nifel.webp'), alt: '' }), h('b', '니펠 팀'), teamEmo('m')),
            h('div.bt-team.c', h('img', { src: asset('ui/anon.webp'), alt: '' }), h('b', '시민 팀'), teamEmo('c')),
            h('div.bt-ner', h('div.bt-ner-in', h('img', { src: asset('chars/ner.webp'), alt: '' }), h('i.bt-sweat', '💦'))),
            h('div.bt-result', side === 'm' ? '니펠 팀으로!' : '시민 팀으로!')));
        break;
      }
      case 'news':
        // 아침 신문: 빙글빙글 돌며 날아와 탁 놓이고, 사진 위에 MISSING 도장
        el.append(...newsPaper('missing', text || '누군가 사라졌다!', extra.day ?? 0, fallbackImg));
        break;
      case 'inv': {
        // 폴랑 조사: 코르크 판의 대상 사진 위로 돋보기가 훑다가 멈추면 NIFEL / CLEAR 도장
        const nm = extra.name || text.replace(/ 조사!$/, '');
        const res = extra.n === 1 ? 'nifel' : extra.n === 0 ? 'clear' : '';
        el.classList.add('res-' + (res || 'none'));
        el.append(
          h('div.cut2-scene.sc-dim', { style: `--bg: ${bgUrl('night_room.webp')}` }),
          h('div.iv-board', h('i.iv-note.a'), h('i.iv-note.b'), polaroid(extra.target ?? fallbackImg, nm), h('i.iv-string.a'), h('i.iv-string.b')),
          h('img.sc-char.iv-polan', { src: actor, alt: '' }),
          h('div.iv-lens', h('i')),
          h('div.cx-stamp.iv-stamp', res === 'nifel' ? 'NIFEL' : res === 'clear' ? 'CLEAR' : '???'),
          title(def, res === 'nifel' ? `${nm}는 니펠이다!` : res === 'clear' ? `${nm}는 니펠이 아니다` : text));
        break;
      }
      case 'heal': {
        // 힐데 치유 (본인): 대상 방문에 십자 반창고가 착, 초록 빛이 감싸고 PROTECTED
        const nm = extra.name || text.replace(/ 치유!$/, '');
        el.append(
          h('div.cut2-scene.sc-dim', { style: `--bg: ${bgUrl('corridor.webp')}` }),
          h('div.cx-door.hl-door', polaroid(extra.target ?? fallbackImg, nm), h('div.hl-band', h('i.a'), h('i.b'))),
          h('div.hl-aura'),
          h('img.sc-char.hl-hilde', { src: actor, alt: '' }),
          h('div.cx-stamp.hl-stamp', 'PROTECTED'),
          title(def, text));
        break;
      }
      case 'saved': {
        // 살려냄 (모두): 할퀴기 자국이 날아오다 초록 방패에 튕겨 부서짐 → SAVED
        const nm = extra.name || '';
        el.append(
          h('div.cut2-scene.sc-dim', { style: `--bg: ${bgUrl('hall_night.webp')}` }),
          h('img.sc-char.sv-hilde', { src: actor, alt: '' }),
          h('div.sv-photo', polaroid(extra.target ?? fallbackImg, nm)),
          h('div.sv-shield'),
          svgEl('sv-claw', '0 0 100 100', [0, 1, 2].map((i) => `<path d="M${96 - i * 4} ${20 + i * 12} L ${70 - i * 2} ${34 + i * 12}" style="--i:${i}"/>`).join('')),
          h('div.sv-flash'),
          h('div.cx-stamp.sv-stamp', 'SAVED'),
          title(def, text));
        break;
      }
      case 'track': {
        // 버터 추적: 복도 바닥에 발자국이 하나씩 찍히고 버터가 킁킁 따라감 → TRACKING
        const nm = extra.name || text.replace(/ 추적!$/, '');
        const paws = h('div.tr-paws');
        for (let i = 0; i < 8; i++) {
          const paw = svgEl('', '-10 -10 20 20', '<ellipse cx="0" cy="3" rx="5" ry="4.2"/><ellipse cx="-5.5" cy="-3.5" rx="2" ry="2.6"/><ellipse cx="-1.8" cy="-6.5" rx="2" ry="2.6"/><ellipse cx="1.8" cy="-6.5" rx="2" ry="2.6"/><ellipse cx="5.5" cy="-3.5" rx="2" ry="2.6"/>');
          paws.appendChild(h('i', { style: `--i: ${i}; --y: ${i % 2 ? 17 : 12}%` }, paw));
        }
        el.append(
          h('div.cut2-scene.sc-dim', { style: `--bg: ${bgUrl('corridor.webp')}` }),
          paws,
          h('div.tr-photo', polaroid(extra.target ?? fallbackImg, nm)),
          h('img.sc-char.tr-butter', { src: actor, alt: '' }),
          h('div.cx-stamp.tr-stamp', 'TRACKING'),
          title(def, text));
        break;
      }
      case 'disg': {
        // 스피키 변장: 대상 사진 앞에서 연기 펑 → 거울 속에 대상 직업 캐릭터 (니펠 팀이면 거울이 깨지고 실패)
        const nm = extra.name || text.replace(/ 변장!$/, '');
        const fail = extra.role === 'x';
        el.classList.toggle('fail', fail);
        el.append(
          h('div.cut2-scene.sc-dim', { style: `--bg: ${bgUrl('night_room.webp')}` }),
          h('div.dg-photo', polaroid(extra.target ?? fallbackImg, nm)),
          h('img.sc-char.dg-spiky', { src: actor, alt: '' }),
          h('div.dg-smoke', h('i'), h('i'), h('i'), h('i')),
          h('div.dg-mirror', h('div.dg-glass', !fail && extra.roleImg ? h('img', { src: extra.roleImg, alt: '' }) : h('b', '?')), h('small', fail ? '변장 실패' : extra.roleName ?? '')),
          h('div.cx-stamp.dg-stamp', fail ? 'FAILED' : 'COPIED'),
          title(def, text));
        break;
      }
      case 'tarot': {
        // 벨라 직업 탐지: 타로 카드가 놓이고 빙글 뒤집히면 대상 직업 캐릭터
        const nm = extra.name || text.replace(/ 직업 탐지$/, '');
        const killer = extra.role === 'nifel';
        el.classList.toggle('killer', killer);
        el.append(
          h('div.ta-bg'),
          h('img.sc-char.ta-bella', { src: actor, alt: '' }),
          h('div.ta-card', h('div.ta-back', h('img', { src: extra.target ?? fallbackImg, alt: '' })),
            h('div.ta-front', extra.roleImg ? h('img', { src: extra.roleImg, alt: '' }) : h('b', '?'), h('b.ta-name', extra.roleName ?? ''), h('small', nm))),
          title(def, extra.roleName ? `${nm}의 직업은 ${extra.roleName}` : text));
        break;
      }
      case 'agit': {
        // 죠안 선동: 법정, 대상 사진의 입에 테이프 X → 죠안의 목소리 물결이 대신 퍼짐
        const nm = extra.name || text.replace(/ 선동!$/, '');
        el.append(
          h('div.cut2-scene.sc-dim', { style: `--bg: ${bgUrl('trial.webp')}` }),
          h('img.sc-char.ag-joan', { src: actor, alt: '' }),
          h('div.ag-waves', h('i'), h('i'), h('i')),
          h('div.ag-photo', polaroid(extra.target ?? fallbackImg, nm), h('i.ag-tape.a'), h('i.ag-tape.b')),
          h('div.cx-stamp.ag-stamp', 'VOICE STOLEN'),
          title(def, text));
        break;
      }
      case 'verdict': {
        // 처형: 판결문에 대상 사진이 클립으로 물리고 판사봉 쾅 EXECUTION, 사진에 붉은 X → 흑백으로 바람에 날아감
        const nm = extra.name || text.replace(/ 처형$/, '');
        el.append(
          h('div.cut2-scene.sc-dim', { style: `--bg: ${bgUrl('trial.webp')}` }),
          h('div.vd-doc', h('small.en', 'VERDICT'), h('b', '판결문'), h('p', `피고 ${nm}`), h('i.vd-lines'),
            h('div.vd-photo', polaroid(extra.target ?? fallbackImg, nm), svgEl('vd-x', '0 0 100 100', '<path d="M12 12 L88 88"/><path d="M88 12 L12 88"/>'))),
          h('div.cx-stamp.vd-stamp', 'EXECUTION'),
          title(def, text));
        break;
      }
      case 'void': {
        // 판결 뒤집기: EXECUTION 이 찍힌 판결문을 리온이 반으로 찢고 VOID
        const nm = extra.name || '';
        const doc = () => h('div.vd-doc', h('small.en', 'VERDICT'), h('b', '판결문'), h('p', `피고 ${nm}`), h('i.vd-lines'),
          h('div.vd-photo', polaroid(extra.target ?? fallbackImg, nm)), h('span.vd-old', 'EXECUTION'));
        el.append(
          h('div.cut2-scene.sc-dim', { style: `--bg: ${bgUrl('trial.webp')}` }),
          h('div.vo-half.l', doc()), h('div.vo-half.r', doc()),
          h('img.sc-char.vo-rion', { src: actor, alt: '' }),
          h('div.cx-stamp.vo-stamp', 'VOID'),
          title(def, text));
        break;
      }
      case 'parry': {
        // 디아나 반격: 할퀴기가 날아오다 디아나가 막아치기 → 번쩍 · 멈칫 → 습격자 가면이 벗겨져 정체 공개
        const nm2 = extra.name2 ?? '';
        el.append(
          h('div.cut2-scene.sc-dim', { style: `--bg: ${bgUrl('hall_night.webp')}` }),
          h('img.sc-char.pr-diana', { src: actor, alt: '' }),
          svgEl('pr-claw', '0 0 100 100', [0, 1, 2].map((i) => `<path d="M${98 - i * 3} ${18 + i * 10} L ${52 - i * 2} ${40 + i * 10}" style="--i:${i}"/>`).join('')),
          h('div.pr-hit', POW()),
          h('div.pr-flash'),
          h('div.pr-attacker', polaroid(extra.target2 ?? fallbackImg, nm2), h('img.pr-mask', { src: asset(`ui/mask${((extra.n ?? 0) % 4) + 1}.webp`), alt: '' })),
          h('div.cx-stamp.pr-stamp', 'UNMASKED'),
          title(def, nm2 ? `습격한 자는 ${nm2}!` : text));
        break;
      }
      case 'boom': {
        // 마리 길동무: 도화선 불꽃이 끌려갈 사람 사진까지 타들어 가서 쾅
        const nm2 = extra.name2 ?? '';
        el.append(
          h('div.cut2-scene.sc-dim', { style: `--bg: ${bgUrl('hall_night.webp')}` }),
          h('img.sc-char.bm-mari', { src: actor, alt: '' }),
          h('div.bm-fuse', h('i.bm-spark')),
          h('div.bm-photo', polaroid(extra.target2 ?? fallbackImg, nm2)),
          h('div.bm-fire'), h('div.bm-flash'), h('div.bm-soot'),
          title(def, text));
        break;
      }
      case 'flash': {
        // 하이디 공개: 카메라 찰칵 → 플래시 → 사진이 인화되며 정체가 드러남
        const nm = extra.name || text.replace(/의 정체$/, '');
        el.append(
          h('div.cut2-scene.sc-dim', { style: `--bg: ${bgUrl('hall_day.webp')}` }),
          h('img.sc-char.fl-heidi', { src: actor, alt: '' }),
          h('div.fl-flash'),
          h('div.fl-photo', polaroid(extra.roleImg ?? extra.target ?? fallbackImg, nm), h('small.fl-role', extra.roleName ?? '')),
          h('div.cx-stamp.fl-stamp', 'REVEALED'),
          title(def, extra.roleName ? `${nm}의 정체는 ${extra.roleName}` : text));
        break;
      }
      case 'kill': {
        // 니펠 습격: 촛불 켜진 복도의 대상 방문 → 그림자가 스며들고 촛불이 꺼짐 → 붉은 니펠 → 할퀴기 세 줄
        const nm = extra.name || text.replace(/ 습격!$/, '');
        el.append(
          h('div.cut2-scene.kl-bg', { style: `--bg: ${bgUrl('corridor.webp')}` }),
          h('div.kl-door', polaroid(extra.target ?? fallbackImg, nm), h('i.kl-knob')),
          h('img.kl-shadow', { src: asset('chars/nifel.webp'), alt: '' }),
          h('div.kl-dark'), h('div.kl-candle'),
          h('img.kl-nifel', { src: actor, alt: '' }),
          svgEl('kl-claw', '0 0 100 100', [0, 1, 2].map((i) => `<path d="M${18 + i * 14} 18 Q ${40 + i * 14} 48 ${62 + i * 12} 86" style="--i:${i}"/>`).join('')),
          h('div.kl-flash'),
          h('div.cx-stamp.kl-stamp', 'TARGET'),
          title(def, text));
        break;
      }
      case 'hack': {
        // 뮤트 해킹: 초록 글자 비가 쏟아지고 접속률이 오르다가 100% → 대상 방문에 자물쇠 철컥, LOCKED
        const nm = extra.name || text.replace(/ 해킹!$/, '');
        const rain = h('div.hk-rain');
        for (let i = 0; i < 18; i++) {
          let t = '';
          for (let j = 0; j < 26; j++) t += '01ABCDEF<>/#*'[Math.floor(Math.random() * 13)] + '\n';
          rain.appendChild(h('i', { style: `left: ${i * 5.6 + Math.random() * 2}%; --d: ${(1.2 + Math.random() * 1.6).toFixed(2)}s; --o: ${(Math.random() * -2).toFixed(2)}s` }, t));
        }
        const pct = h('b', '0%');
        el.append(
          h('div.hk-bg'), rain,
          h('img.hk-mute', { src: actor, alt: '' }),
          h('div.hk-door', polaroid(extra.target ?? fallbackImg, nm), h('div.hk-lock', h('i.hk-shackle'), h('i.hk-body'))),
          h('div.hk-bar', h('small.en', 'ACCESS'), h('div.hk-fill'), pct),
          h('div.hk-glitch'),
          h('div.cx-stamp.hk-stamp', 'LOCKED'),
          title(def, text));
        let t0 = 0;
        const tick = () => {
          const p = Math.min(100, Math.max(0, Math.round(((performance.now() - t0) / 1000 / cutSpeed() - 0.5) / 1.4 * 100)));
          pct.textContent = `${p}%`;
          if (p < 100 && el.isConnected) requestAnimationFrame(tick);
        };
        after = () => { t0 = performance.now(); requestAnimationFrame(tick); };
        break;
      }
      case 'wish': {
        // 우이 소원: 주말농장 저녁, 개구리 탄 우이 주위로 네잎클로버가 날아올라 흑백 사진에 모이면 컬러로 되살아남
        const nm = extra.name || '';
        const leaves = h('div.ws-leaves');
        for (let i = 0; i < 10; i++) {
          const leaf = h('i', { style: `--i: ${i}; --x: ${(Math.random() * 30 - 15).toFixed(0)}%; --y: ${(Math.random() * 40 - 20).toFixed(0)}%; --r: ${(Math.random() * 720 - 360).toFixed(0)}deg` });
          leaf.innerHTML = '<svg viewBox="-12 -12 24 24"><g fill="#6fd05a" stroke="#2f7a2a" stroke-width="1"><path d="M0 0C-2-7-9-6-7-1S0 0 0 0Z"/><path d="M0 0C7-2 6-9 1-7S0 0 0 0Z"/><path d="M0 0C2 7 9 6 7 1S0 0 0 0Z"/><path d="M0 0C-7 2-6 9-1 7S0 0 0 0Z"/></g><path d="M0 0q3 6 6 9" stroke="#2f7a2a" stroke-width="1.4" fill="none"/></svg>';
          leaves.appendChild(leaf);
        }
        el.append(
          h('div.cut2-scene.ws-bg', { style: `--bg: ${bgUrl('farm.webp')}` }),
          h('div.ws-glow'),
          h('img.ws-ui', { src: actor, alt: '' }),
          h('div.ws-photo', polaroid(extra.target ?? fallbackImg, nm)),
          leaves,
          h('div.ws-burst'),
          h('div.cx-stamp.ws-stamp', 'ALIVE'),
          title(def, nm ? `${nm} 되살아났다` : text));
        break;
      }
      case 'shatter': {
        // 주말농장의 우로스가 '…' 하더니 화면(유리)을 쾅! 맞은 곳부터 금 → 군데군데 떨어짐 → 와장창 → 능력 그림
        const me = h('img.su-img', { src: asset('chars/uros.webp'), alt: '' }) as HTMLImageElement;
        el.append(
          h('div.sh-back', h('div.sh-uw', h('img.sh-uros', { src: file, alt: '' })), h('div.sh-glow')),
          h('canvas.sh-cv'),
          h('div.su-char', me, h('div.su-bub', h('i'), h('i'), h('i'))),
          h('div.su-speed', { style: `--x: ${UROS_PLAN.at.x * 100}%; --y: ${UROS_PLAN.at.y * 100}%` }),
          h('div.su-hit', { style: `left: ${UROS_PLAN.at.x * 100}%; top: ${UROS_PLAN.at.y * 100}%` }, h('i.su-ring2'), POW()),
          h('div.su-impact'),
          h('div.sh-flash'), title(def, text));
        after = () => {
          const ctl = shatter(el.querySelector('canvas.sh-cv') as HTMLCanvasElement, asset('bg/farm.webp'), UROS_PLAN, {
            ready: () => {
              el.classList.add('ready');
              setTimeout(() => !done && sfx('pop'), 350 / cutSpeed());
              setTimeout(() => !done && sfx('swoosh'), 1800 / cutSpeed());
            },
            event: (e, i) => {
              if (done) return;
              if (e === 'crack') {
                if (i === 0) { ctl.bake(me); el.classList.add('ph-hit'); sfx('punch'); } else { el.classList.remove('ph-crack'); void el.offsetWidth; el.classList.add('ph-crack'); }
                sfx('crack');
              } else if (e === 'drop') { if (i % 2 === 0) sfx('tink'); }
              else if (e === 'burst') {
                el.classList.add('ph-burst'); sfx('shatter');
                setTimeout(() => !done && sfx('revive'), 300 / cutSpeed());
                setTimeout(() => close(), 3200 / cutSpeed());
              }
            },
          });
          stop = ctl.stop;
        };
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
    // 두 장면: 지금까지 만든 장면은 잠시 빼 두고, 먼저 능력 그림 컷인 → INTRO 뒤 번쩍하며 장면을 붙임 (그때부터 장면 연출이 시작)
    let mount: (() => void) | null = null;
    if (two) {
      const scene = h('div.st-b', ...Array.from(el.childNodes));
      const intro = h('div.st-a', ...charStage(def, file, false, text));
      el.append(intro);
      const run = after;
      after = null;
      mount = () => {
        if (done) return;
        el.insertBefore(scene, intro);
        el.append(h('div.st-flash'));
        intro.classList.add('gone');
        setTimeout(() => intro.remove(), 400 / cutSpeed());
        run?.();
      };
    }
    el.append(h('div.cut2-skip', '눌러서 넘기기'));
    let done = false;
    const close = () => { if (done) return; done = true; el.classList.add('out'); setTimeout(() => { stop?.(); el.remove(); next(); }, 300); };
    el.onclick = close;
    host.appendChild(el);
    after?.();
    const off = two ? INTRO * 1000 : 0;
    if (two) { sfx('skill'); setTimeout(() => mount?.(), off / cutSpeed()); }
    for (const [s, d] of SE[kind] ?? [['skill', 0]]) {
      if (two && s === 'skill' && d === 0) continue;
      d + off ? setTimeout(() => !done && sfx(s), d + off) : sfx(s);
    }
    setTimeout(close, ((def.ms ?? 2800) + off) / cutSpeed());
  });
  if (!playing) next();
}

/**
 * 네르 편 고르기 — 직접 조작. 컷인 뒤 니펠 —— 네르 —— 케이크 장면에서
 * 키보드(←→ / A·D), 드래그, 또는 팀을 눌러 네르를 데려가면 그 편으로 정해진다.
 * 서버의 결과(p_bat 컷)가 오면 resolve() 로 마무리. 시간이 다 돼 무작위로 정해져도 같은 길.
 */
export interface BatPick { resolve(side: 'mafia' | 'citizen'): void; close(): void; started(): boolean }
export function pickBat(host: HTMLElement, choose: (side: 'mafia' | 'citizen') => void, secLeft: () => number): BatPick {
  const def = CUTS.p_bat;
  let el: HTMLElement | null = null;
  let done = false, sent = false, live = false;
  let x = 0.5, vx = 0, drag = false, goal: number | null = null, raf = 0;
  const keys = new Set<string>();
  let ner: HTMLElement, img: HTMLImageElement, timeEl: HTMLElement, hint: HTMLElement;
  const MAFIA_AT = 0.3, CIT_AT = 0.7;

  const cleanup = () => {
    cancelAnimationFrame(raf);
    removeEventListener('keydown', kd, true);
    removeEventListener('keyup', ku, true);
  };
  const finish = () => {
    if (!el) return;
    const e = el; el = null;
    cleanup();
    e.classList.add('out');
    setTimeout(() => { e.remove(); next(); }, 300);
  };
  const place = () => { ner.style.left = `${x * 100}%`; };
  const pick = (side: 'mafia' | 'citizen') => {
    if (sent) return;
    sent = true;
    el?.classList.add('picked');
    hint.textContent = side === 'mafia' ? '니펠 팀으로 가는 중…' : '시민 팀으로 가는 중…';
    sfx('click');
    choose(side);
  };
  const loop = (t0: number) => {
    let last = t0;
    const f = (t: number) => {
      const dt = Math.min(0.05, (t - last) / 1000); last = t;
      if (!sent) {
        const dir = (keys.has('l') ? -1 : 0) + (keys.has('r') ? 1 : 0);
        if (dir) { goal = null; vx = dir * 0.55; }
        else if (goal !== null && !drag) { const d = goal - x; vx = Math.abs(d) < 0.01 ? 0 : Math.sign(d) * 0.6; if (!vx) goal = null; }
        else if (!drag) vx = 0;
        if (!drag) x = Math.max(0.2, Math.min(0.8, x + vx * dt));
        if (vx) img.style.transform = vx < 0 ? 'scaleX(-1)' : '';
        ner.classList.toggle('walk', !!vx || drag);
        place();
        if (x <= MAFIA_AT) pick('mafia');
        else if (x >= CIT_AT) pick('citizen');
        const s = secLeft();
        timeEl.textContent = `${s}`;
        timeEl.classList.toggle('hurry', s <= 3);
      }
      raf = requestAnimationFrame(f);
    };
    raf = requestAnimationFrame(f);
  };
  const KEYS: Record<string, 'l' | 'r'> = { ArrowLeft: 'l', a: 'l', A: 'l', ArrowRight: 'r', d: 'r', D: 'r' };
  const kd = (e: KeyboardEvent) => { const k = KEYS[e.key]; if (!k || !live) return; e.preventDefault(); e.stopPropagation(); keys.add(k); };
  const ku = (e: KeyboardEvent) => { const k = KEYS[e.key]; if (k) keys.delete(k); };

  queue.push(() => {
    if (done) { next(); return; }
    el = h(`div.cut2.lay-bat.k-p_bat.mine.pick`, { style: `--c: ${def.color}` });
    img = h('img', { src: asset('chars/ner.webp'), alt: '' }) as HTMLImageElement;
    ner = h('div.bt-ner', h('div.bt-ner-in', img, h('i.bt-sweat', '💦')));
    timeEl = h('div.bp-time', '');
    hint = h('div.bp-hint', '네르를 데려갈 쪽으로 움직이세요!', h('small', '← → 키, 드래그, 팀 누르기 모두 돼요'));
    const stage = h('div.st-b',
      h('div.cut2-bg'),
      h('div.bt-team.m', { onclick: () => { if (live && !sent) goal = 0.25; } }, h('img', { src: asset('chars/nifel.webp'), alt: '' }), h('b', '니펠 팀'), teamEmo('m')),
      h('div.bt-team.c', { onclick: () => { if (live && !sent) goal = 0.75; } }, h('img', { src: asset('ui/anon.webp'), alt: '' }), h('b', '시민 팀'), teamEmo('c')),
      ner, hint, timeEl);
    stage.addEventListener('dragstart', (e) => e.preventDefault());
    const toX = (e: PointerEvent) => { const r = stage.getBoundingClientRect(); return Math.max(0.2, Math.min(0.8, (e.clientX - r.left) / r.width)); };
    stage.addEventListener('pointerdown', (e) => {
      if (!live || sent || (e.target as HTMLElement).closest('.bt-team')) return;
      drag = true; stage.setPointerCapture(e.pointerId); x = toX(e); goal = null;
    });
    stage.addEventListener('pointermove', (e) => { if (drag && !sent) { const nx = toX(e); if (nx !== x) img.style.transform = nx < x ? 'scaleX(-1)' : ''; x = nx; } });
    const up = () => { drag = false; };
    stage.addEventListener('pointerup', up);
    stage.addEventListener('pointercancel', up);
    el.append(h('div.st-a', ...charStage(def, cutImg(def.file!), false, '')), stage);
    host.appendChild(el);
    sfx('skill');
    addEventListener('keydown', kd, true);
    addEventListener('keyup', ku, true);
    setTimeout(() => { if (el && !done) { live = true; el.classList.add('live'); loop(performance.now()); } }, 1500);
  });
  if (!playing) next();

  return {
    started: () => !!el,
    resolve(side) {
      if (done) return;
      done = true;
      if (!el) { playCut(host, 'p_bat', side === 'mafia' ? '니펠 편으로!' : '시민 편으로!', ''); return; }
      cleanup();
      live = false;
      const e = el;
      e.classList.add('picked', side === 'mafia' ? 'side-m' : 'side-c', 'decided');
      x = side === 'mafia' ? 0.3 : 0.7;
      img.style.transform = side === 'mafia' ? 'scaleX(-1)' : '';
      ner.classList.remove('walk');
      place();
      hint.remove(); timeEl.remove();
      e.querySelector('.st-b')!.append(h('div.bt-result', side === 'mafia' ? '니펠 팀으로!' : '시민 팀으로!'));
      sfx('pop');
      setTimeout(finish, 1800);
    },
    close() { if (done) return; done = true; if (el) finish(); },
  };
}

/**
 * 엘레나 승리: 가짜 승리 화면(fake) 위로
 *   ① 작은 드론 떼가 오른쪽에서 우르르 몰려와 캐릭터 · 제목 · 표 · 버튼을 지나가는 순서대로 왼쪽으로 쓸어 가고
 *   ② 큰 드론을 탄 엘레나가 날아와 배경 오른쪽 끝을 물고 왼쪽으로 끌고 가면, 그 뒤에서 엘레나 승리 화면(showReal)이 드러난다.
 */
export function droneRaid(host: HTMLElement, fake: HTMLElement, showReal: () => void, done: () => void) {
  const W = host.offsetWidth || 1280;
  const SPEED = 1.15; // 드론 떼 앞줄이 화면을 가로지르는 속도 (화면 너비/초)
  const START = 2400; // 가짜 승리 화면을 보여 주는 시간 (ms)
  const raid = h('div.raid', { style: `--w: ${W}px` });
  const N = 24;
  for (let i = 0; i < N; i++) {
    const row = (i * 0.618) % 1; // 위아래로 고르게 흩뿌림
    const size = 8 + Math.random() * 9;
    raid.appendChild(h('img.rd-drone', {
      src: asset('cut/drone.webp'), alt: '',
      style: `--y: ${2 + row * 86}%; --s: ${size}%; --d: ${(Math.random() * 0.4).toFixed(2)}s; --b: ${(0.25 + Math.random() * 0.25).toFixed(2)}s`,
    }));
  }
  // 엘레나: 큰 드론을 타고 와서 배경 끝을 문다
  const boss = h('div.rd-boss', h('img.rd-ride', { src: asset('cut/drone.webp'), alt: '' }), h('img.rd-el', { src: asset('chars/elena.webp'), alt: '' }), h('i.rd-claw'));
  setTimeout(() => {
    if (!fake.isConnected) return done();
    sfx('buzz'); sfx('swoosh');
    setTimeout(() => sfx('buzz'), 450);
    fake.classList.add('raided');
    host.appendChild(raid);
    // ① 작은 드론 떼: 오른쪽 끝이 앞줄에 닿는 때부터 휙 (배경은 그대로)
    const hr = host.getBoundingClientRect();
    const k = W / hr.width;
    const parts = [...fake.querySelectorAll<HTMLElement>('.end-title, .end-champ, .end-loser, .end-list, .end-foot, .end-mvp')];
    for (const el of parts) {
      const r = el.getBoundingClientRect();
      const right = (r.right - hr.left) / hr.width; // 0~1
      const delay = Math.max(0, (1.05 - right) / SPEED) * 1000 + 120;
      const dist = (r.right - hr.left) * k + 160;
      el.animate([
        { transform: 'none' },
        { transform: 'translateX(14px) rotate(4deg)', offset: 0.12 },
        { transform: `translateX(${-dist}px) translateY(${(Math.random() * 60 - 30).toFixed(0)}px) rotate(${(-10 - Math.random() * 20).toFixed(0)}deg)` },
      ], { duration: 650, delay, easing: 'cubic-bezier(.45,0,.85,.5)', fill: 'forwards' });
      setTimeout(() => sfx('pop'), delay);
    }
    // ② 엘레나 등장 → 배경 끝을 물고 끌고 감
    const B = 1450, ARRIVE = 450, DRAG = 1000;
    setTimeout(() => {
      if (!fake.isConnected) return;
      showReal(); // 뒤에 미리 깔아 둠 (배경이 끌려가면서 드러남)
      fake.classList.add('dragging');
      raid.appendChild(boss);
      sfx('buzz');
      const bw = boss.offsetWidth;
      const bite = -bw * 0.5; // 드론 몸통 가운데가 배경 오른쪽 끝에 오게
      boss.animate([{ transform: 'translateX(40px)' }, { transform: `translateX(${bite - 24}px)`, offset: 0.8 }, { transform: `translateX(${bite}px)` }],
        { duration: ARRIVE, easing: 'cubic-bezier(.2,.7,.3,1)', fill: 'forwards' });
      setTimeout(() => {
        sfx('clang');
        boss.classList.add('bit');
        const drag = { duration: DRAG, easing: 'cubic-bezier(.55,0,.8,.45)', fill: 'forwards' as FillMode };
        boss.animate([{ transform: `translateX(${bite}px)` }, { transform: `translateX(${bite + 10}px)`, offset: 0.08 }, { transform: `translateX(${bite - W * 1.15}px)` }], drag);
        const bg = fake.querySelector<HTMLElement>('.end-bg');
        bg?.animate([{ transform: 'none' }, { transform: 'translateX(10px)', offset: 0.08 }, { transform: `translateX(${-W * 1.15}px)` }], drag);
        setTimeout(() => sfx('swoosh'), DRAG * 0.4);
        setTimeout(() => { done(); setTimeout(() => raid.remove(), 100); }, DRAG + 50);
      }, ARRIVE);
    }, B);
  }, START);
}

/**
 * 코미 승리: 가짜 승리 화면(fake)의 이긴 캐릭터들 머리 위로 캐릭터만 한 사료캔이 바깥쪽부터 (왼쪽, 오른쪽, …) 하나씩 쿵,
 * 마지막으로 코미가 올라탄 큰 캔이 가운데로 떨어지며 가짜 화면(배경 · UI · 캔 통째로)을 아래로 밀어 떨어뜨린다.
 * 위에서부터 드러나는 건 미리 깔아 둔 코미 승리 화면(makeReal) — 큰 캔과 코미는 그 화면에 그대로 남는다.
 */
export function canDrop(host: HTMLElement, fake: HTMLElement, makeReal: () => HTMLElement, done: () => void) {
  const START = 2200;  // 가짜 승리 화면을 보여 주는 시간
  const GAP = 420;     // 캔 사이 간격
  const FALL = 420;    // 작은 캔이 떨어지는 시간
  const CAN = 322 / 420;
  setTimeout(() => {
    if (!fake.isConnected) return done();
    const hr = host.getBoundingClientRect();
    const k = (host.offsetWidth || 1280) / hr.width; // 화면 px → 무대 px
    const at = (r: DOMRect) => ({ x: (r.left - hr.left) * k, y: (r.top - hr.top) * k, w: r.width * k, h: r.height * k });
    const W = host.offsetWidth || 1280, H = host.offsetHeight || 720;
    const canEl = (cx: number, bottom: number, hgt: number, extra?: HTMLElement) => {
      const w = hgt * CAN;
      return h('div.can', { style: `left: ${cx - w / 2}px; top: ${bottom - hgt}px; width: ${w}px; height: ${hgt}px` },
        extra ?? '', h('img', { src: asset('ui/can.webp'), alt: '' }), h('i.can-dust'));
    };
    // ① 작은 캔: 가운데 한 명은 남기고 바깥쪽부터 왼쪽 · 오른쪽 번갈아. 캔은 가짜 화면 안에 넣어 같이 떨어지게
    const champs = [...fake.querySelectorAll<HTMLElement>('.end-champ')].sort((a, b) => a.getBoundingClientRect().left - b.getBoundingClientRect().left);
    const mid = Math.floor((champs.length - 1) / 2);
    const order: number[] = [];
    for (let l = 0, r = champs.length - 1; l <= r; l++, r--) { if (l !== mid) order.push(l); if (r !== l && r !== mid) order.push(r); }
    const smalls = h('div.cans');
    fake.appendChild(smalls);
    order.forEach((ci, i) => {
      const img = champs[ci].querySelector('img') ?? champs[ci];
      const r = at(img.getBoundingClientRect());
      const can = canEl(r.x + r.w / 2, r.y + r.h + 4, r.h * 1.08);
      smalls.appendChild(can);
      const bottom = r.y + r.h + 4, delay = i * GAP;
      can.animate([
        { transform: `translateY(${-(bottom + 60)}px)`, offset: 0 },
        { transform: 'translateY(0) scale(1.06, .82)', offset: 0.72, easing: 'ease-out' },
        { transform: 'translateY(-4%) scale(.96, 1.06)', offset: 0.86 },
        { transform: 'none' },
      ], { duration: FALL / 0.72, delay, easing: 'cubic-bezier(.5,0,1,.6)', fill: 'backwards' });
      setTimeout(() => {
        if (!fake.isConnected) return;
        can.classList.add('landed'); sfx('thump');
        img.animate([{ transform: 'none' }, { transform: 'scaleY(.2)', opacity: 0 }], { duration: 120, fill: 'forwards' });
        fake.animate([{ transform: 'translateY(0)' }, { transform: 'translateY(6px)' }, { transform: 'translateY(-2px)' }, { transform: 'none' }], { duration: 260 });
      }, delay + FALL);
    });
    // ② 코미를 태운 큰 캔: 코미 승리 화면을 뒤에 미리 깔고(애니메이션 멈춤) 그 화면의 코미 자리를 목표로
    const t2 = order.length * GAP + (order.length ? 300 : 0);
    setTimeout(() => {
      if (!fake.isConnected) return done();
      const real = makeReal();
      // 가운데 캐릭터 자리 (작은 캔들과 같은 바닥 높이)에 조금 더 큰 캔으로
      const midImg = champs[mid]?.querySelector<HTMLElement>('img');
      const spot = midImg ?? real.querySelector<HTMLElement>('.end-champ img');
      const sr = spot ? at(spot.getBoundingClientRect()) : { x: W * 0.4, y: H * 0.3, w: H * 0.3, h: H * 0.5 };
      const canH = sr.h * 1.08 * 1.25, bottom = sr.y + sr.h + 4, cx = sr.x + sr.w / 2;
      const ch = sr.h * 0.95, cw = ch * (136 / 175);
      if (midImg) setTimeout(() => midImg.animate([{ transform: 'none' }, { transform: 'scaleY(.2)', opacity: 0 }], { duration: 120, fill: 'forwards' }), 480);
      const comi = h('img.can-comi.ride', { src: asset('chars/comi.webp'), alt: '', style: `left: ${(canH * CAN - cw) / 2}px; top: ${-ch + canH * 0.06}px; width: ${cw}px; height: ${ch}px` });
      const big = canEl(cx, bottom, canH, comi);
      big.classList.add('big');
      const top = h('div.cans');
      host.appendChild(top);
      top.appendChild(big);
      // 작은 캔처럼 가운데 자리로 떨어지고, 닿는 순간 가짜 화면(배경 · UI · 작은 캔)이 아래로 팍 내리꽂히며 코미 화면
      const BIG_FALL = 480;
      sfx('swoosh');
      big.animate([
        { transform: `translateY(${-(bottom + ch + 60)}px)`, offset: 0 },
        { transform: 'translateY(0) scale(1.08, .8)', offset: 0.7, easing: 'ease-out' },
        { transform: 'translateY(-5%) scale(.95, 1.07)', offset: 0.85 },
        { transform: 'none' },
      ], { duration: BIG_FALL / 0.7, easing: 'cubic-bezier(.5,0,1,.6)', fill: 'backwards' });
      setTimeout(() => {
        if (!fake.isConnected) return done();
        big.classList.add('landed');
        sfx('thump'); sfx('clang');
        real.classList.remove('prep');
        fake.animate([{ transform: 'none' }, { transform: `translateY(${H * 1.15}px)` }], { duration: 300, easing: 'cubic-bezier(.55,0,1,.45)', fill: 'forwards' });
        real.animate([{ transform: 'translateY(-10px)' }, { transform: 'translateY(4px)', offset: 0.5 }, { transform: 'none' }], { duration: 320, delay: 200 });
        setTimeout(() => sfx('pop'), 120); setTimeout(() => sfx('reveal'), 280);
        top.appendChild(h('div.can-spark', { style: `left: ${cx}px; top: ${bottom - canH - ch * 0.5}px` }));
        // 큰 캔과 코미는 코미 승리 화면 속으로 옮겨 남김
        setTimeout(() => {
          const keep = h('div.cans.keep');
          real.insertBefore(keep, real.querySelector('.end-list'));
          keep.appendChild(big);
          top.remove();
          done();
        }, 650);
      }, BIG_FALL);
    }, t2);
  }, START);
}

/**
 * 네르 승리: 네르가 고른 편이 이겼을 때. 반대편 승리 화면(fake)이 잠깐 → 아래(진 사람 줄)에 있던 네르가 튀어나와
 * 화면 한쪽 가운데로 폴짝 → 몸을 젖혔다가 몸통 박치기! → 화면 · UI 통째로 반대쪽으로 날아가고 진짜 승리 화면(makeReal).
 * dir: 1 = 왼쪽에서 오른쪽으로 들이받음 (니펠 편 승리), -1 = 오른쪽에서 왼쪽으로 (시민 편 승리)
 */
export function nerSlam(host: HTMLElement, fake: HTMLElement, makeReal: () => HTMLElement, done: () => void, dir: 1 | -1) {
  const START = 2300;
  setTimeout(() => {
    if (!fake.isConnected) return done();
    const W = host.offsetWidth || 1280, H = host.offsetHeight || 720;
    const hr = host.getBoundingClientRect();
    const k = W / hr.width;
    // 진 사람 줄에서 네르 찾기 (없으면 화면 아래 가운데에서)
    const mine = [...fake.querySelectorAll<HTMLElement>('.end-loser')].find((e) => e.querySelector('img')?.getAttribute('src')?.includes('ner.webp'));
    const from = mine?.getBoundingClientRect();
    const nh = H * 0.34, nw = nh * 0.8;
    const sx = from ? ((from.left + from.width / 2) - hr.left) * k : W / 2, sy = from ? (from.bottom - hr.top) * k : H;
    const tx = dir === 1 ? W * 0.16 : W * 0.84, ty = H * 0.68; // 한쪽 가운데 (발 위치)
    const layer = h('div.slam');
    const ner = h('div.sl-ner', { style: `left: ${-nw / 2}px; top: ${-nh}px; width: ${nw}px; height: ${nh}px` },
      h('img', { src: asset('chars/ner.webp'), alt: '', style: dir === -1 ? 'transform: scaleX(-1)' : '' }));
    layer.appendChild(ner);
    host.appendChild(layer);
    if (mine) mine.style.visibility = 'hidden';
    const at = (x: number, y: number, extra = '') => `translate(${x}px, ${y}px) ${extra}`;
    // ① 튀어나와 폴짝 (포물선)
    sfx('pop');
    const JUMP = 620;
    ner.animate([
      { transform: at(sx, sy, 'scale(.35)'), offset: 0 },
      { transform: at((sx + tx) / 2, Math.min(sy, ty) - H * 0.32, 'scale(.9) rotate(' + (dir * 12) + 'deg)'), offset: 0.5, easing: 'ease-in' },
      { transform: at(tx, ty, 'scale(1.1, .85)'), offset: 0.88 },
      { transform: at(tx, ty), offset: 1 },
    ], { duration: JUMP, easing: 'cubic-bezier(.3,.6,.4,1)', fill: 'forwards' });
    setTimeout(() => sfx('thump'), JUMP * 0.88);
    // ② 몸 젖히기 → ③ 박치기
    const WIND = 380, DASH = 170;
    const hitX = W * 0.5 + dir * (-W * 0.02);
    setTimeout(() => {
      if (!fake.isConnected) return;
      ner.animate([{ transform: at(tx, ty) }, { transform: at(tx - dir * 40, ty + 6, `rotate(${-dir * 14}deg) scale(.92, 1.04)`) }],
        { duration: WIND, easing: 'ease-out', fill: 'forwards' });
      sfx('swoosh');
    }, JUMP + 80);
    setTimeout(() => {
      if (!fake.isConnected) return;
      layer.appendChild(h('div.sl-speed', { style: `--dir: ${dir}` }));
      ner.animate([{ transform: at(tx - dir * 40, ty + 6, `rotate(${-dir * 14}deg) scale(.92, 1.04)`) }, { transform: at(hitX, ty - H * 0.04, `rotate(${dir * 18}deg) scale(1.15, .9)`) }],
        { duration: DASH, easing: 'cubic-bezier(.6,0,1,.5)', fill: 'forwards' });
    }, JUMP + 80 + WIND);
    // 쾅! 화면 통째로 날아감
    setTimeout(() => {
      if (!fake.isConnected) return done();
      const real = makeReal();
      sfx('punch');
      const fx = h('div.sl-hit', { style: `left: ${hitX + dir * nw * 0.45}px; top: ${ty - nh * 0.55}px` }, POW());
      layer.appendChild(fx);
      layer.appendChild(h('div.sl-flash'));
      real.classList.remove('prep');
      fake.style.transformOrigin = dir === 1 ? '0% 50%' : '100% 50%';
      fake.animate([
        { transform: 'none' },
        { transform: `translateX(${dir * 30}px) rotate(${dir * 2}deg)`, offset: 0.12 },
        { transform: `translateX(${dir * W * 1.25}px) translateY(${-H * 0.12}px) rotate(${dir * 16}deg)` },
      ], { duration: 520, delay: 90, easing: 'cubic-bezier(.4,0,.9,.5)', fill: 'forwards' });
      // 네르는 튕겨 나와 승리 화면 쪽으로 착지하며 사라짐
      ner.animate([
        { transform: at(hitX, ty - H * 0.04, `rotate(${dir * 18}deg) scale(1.15, .9)`) },
        { transform: at(hitX - dir * 60, ty - H * 0.2, `rotate(${-dir * 10}deg)`), offset: 0.4 },
        { transform: at(hitX - dir * 90, ty, 'none'), opacity: 1, offset: 0.75 },
        { transform: at(hitX - dir * 90, ty, 'none'), opacity: 0 },
      ], { duration: 900, delay: 110, easing: 'ease-out', fill: 'forwards' });
      setTimeout(() => sfx('reveal'), 350);
      setTimeout(() => { done(); layer.remove(); }, 1050);
    }, JUMP + 80 + WIND + DASH);
  }, START);
}
