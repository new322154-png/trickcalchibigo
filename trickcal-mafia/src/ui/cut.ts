/**
 * 컷씬: 능력을 쓴 사람만 보는 것(p_*)과 모두가 보는 것.
 * 캐릭터 애니메이션(assets/cut/<kind>.webp) 위에 직업 색 띠 · 제목 · 효과를 CSS로 얹는다
 * (transform/opacity 위주라 모바일도 가볍게). 여러 개가 겹치면 차례대로. 누르면 넘어간다.
 */
import type { CutKind } from '../../shared/protocol';
import { asset, bgUrl, h } from './dom';
import { sfx } from './sfx';

type Layout = 'char' | 'contact' | 'paper' | 'impact' | 'farm' | 'bat' | 'news' | 'drone' | 'droneTry';
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
  vanish: { title: '실종', en: 'MISSING', color: '#b0342b', layout: 'news', ms: 4800 },
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
  execute: [['execute', 0]], vanish: [['paper', 0], ['vanish', 700], ['gavel', 1250]], saved: [['heal', 0]], counter: [['clang', 0]],
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

export interface CutExtra { n?: number; myImg?: string; /** 아침 신문의 날짜 */ day?: number }

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
      case 'news':
        // 아침 신문: 빙글빙글 돌며 날아와 탁 놓이고, 사진 위에 MISSING 도장
        el.append(...newsPaper('missing', text || '누군가 사라졌다!', extra.day ?? 0, fallbackImg));
        break;
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
    hint.textContent = side === 'mafia' ? '마피아 팀으로 가는 중…' : '시민 팀으로 가는 중…';
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
      h('div.bt-team.m', { onclick: () => { if (live && !sent) goal = 0.25; } }, h('img', { src: asset('chars/nifel.webp'), alt: '' }), h('b', '마피아 팀')),
      h('div.bt-team.c', { onclick: () => { if (live && !sent) goal = 0.75; } }, h('img', { src: asset('ui/anon.webp'), alt: '' }), h('b', '시민 팀')),
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
      if (!el) { playCut(host, 'p_bat', side === 'mafia' ? '마피아 편으로!' : '시민 편으로!', ''); return; }
      cleanup();
      live = false;
      const e = el;
      e.classList.add('picked', side === 'mafia' ? 'side-m' : 'side-c', 'decided');
      x = side === 'mafia' ? 0.3 : 0.7;
      img.style.transform = side === 'mafia' ? 'scaleX(-1)' : '';
      ner.classList.remove('walk');
      place();
      hint.remove(); timeEl.remove();
      e.querySelector('.st-b')!.append(h('div.bt-result', side === 'mafia' ? '마피아 팀으로!' : '시민 팀으로!'));
      sfx('pop');
      setTimeout(finish, 1800);
    },
    close() { if (done) return; done = true; if (el) finish(); },
  };
}
