/**
 * 메뉴 화면들: 타이틀, 게임 메뉴, 저장/불러오기, 설정, 지난 대화, 수첩, 엔딩 갤러리, 사건 흐름도, 크레딧.
 */
import { C, cfg, charColor, charName, names, t } from '../engine/content';
import { game } from '../engine/game';
import { P, S } from '../engine/state';
import { latestSlot } from '../engine/save';
import { playBgm } from '../engine/audio';
import { isTodo } from '../engine/util';
import { asset, clear, h, layer } from './dom';
import { backlog } from './dialogue';
import { confirm, openModal, toast } from './modal';
import { setHudVisible } from './hud';
import { openSystem } from './sysmenu';
import { setAmbient } from './effects';

const txt = (v: any, fallback = '') => (isTodo(v) || v === undefined ? fallback : names(String(v)));
const tt = (key: string, fallback: string) => {
  const v = t(key);
  return /^\[.*\]$/.test(v) || isTodo(v) ? fallback : v;
};

/** 타이틀 메뉴 아이콘 (선 그림) */
const svg = (d: string) => `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
const ICONS: Record<string, string> = {
  play: svg('<path d="M8 5v14l11-7z"/>'),
  resume: svg('<path d="M4 12a8 8 0 1 0 2.3-5.6"/><path d="M4 4v4h4"/>'),
  folder: svg('<path d="M3 7h6l2 2h10v10H3z"/>'),
  star: svg('<path d="M12 3l2.2 6.8H21l-5.4 4 2 6.7L12 16.4 6.4 20.5l2-6.7L3 9.8h6.8z"/>'),
  gear: svg('<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1"/>'),
  book: svg('<path d="M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2z"/><path d="M4 19V5"/>'),
  info: svg('<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5v.5"/>'),
};

// ── 타이틀 ────────────────────────────────────────

/** 글자 로고: "트릭컬" 을 작은 머리글로, 나머지를 큰 금빛 명조로. 한 글자 위에 작은 초승달 */
function typeLogo(title: string) {
  const parts = title.split(' ');
  const head = parts.length > 1 ? parts[0] : '';
  const main = parts.length > 1 ? parts.slice(1).join(' ') : title;
  const moon = `<svg viewBox="0 0 40 40" class="tl-moon"><path d="M27 4a17 17 0 1 0 9 26A14 14 0 0 1 27 4z"/></svg>`;
  let idx = 0;
  const letters = [...main].map((ch) => {
    const i = idx++;
    const span = h('span.tl', { style: { animationDelay: `${0.7 + i * 0.12}s` } }, ch === ' ' ? '\u00a0' : ch);
    return span;
  });
  // 초승달은 마지막에서 두 번째 글자(할로"윈"의 앞, "로") 위에
  const target = letters[Math.max(0, letters.length - 2)];
  target.classList.add('has-moon');
  target.insertAdjacentHTML('beforeend', moon);
  return h('div.type-logo',
    head ? h('div.tl-head', h('i'), h('span', head), h('i')) : null,
    h('h1.title-text.tl-main', ...letters),
    h('div.tl-en', t('title.kicker').replace(/^\[.*\]$/, 'TRICKCAL THE HALLOWEEN')),
  );
}

export function showTitle() {
  setHudVisible(false);
  const root = layer('modal');
  clear(root);
  clear(layer('dialogue').querySelector('.choices') as HTMLElement ?? h('div'));
  (layer('dialogue').querySelector('.dlg-box') as HTMLElement)?.classList.add('hidden');
  document.title = txt(C.game.title, '트릭컬 추리 팬게임');

  const latest = latestSlot(cfg('save.slots', 12));
  // 메뉴: 한글 + 작은 영문 + 오른쪽 동그란 아이콘
  const item = (label: string, en: string, icon: string, onclick: () => void) =>
    h('button.title-btn', { onclick }, h('span.tb-text', h('b', label), h('small', en)), h('span.tb-icon', { html: ICONS[icon] }));
  const menu = h(
    'div.title-menu',
    item(t('title.new_game'), 'NEW GAME', 'play', async () => {
      if (latest && !(await confirm(t('confirm.new_game'), '처음부터 시작할까요?'))) return;
      clear(root);
      void game.newGame();
    }),
    latest ? item(t('title.continue'), 'CONTINUE', 'resume', () => { clear(root); void game.loadSnapshot(latest.snap); }) : null,
    item(t('title.load'), 'LOAD', 'folder', () => openSystem('load')),
    item(tt('title.extra', '엑스트라'), 'EXTRA', 'star', () => openSystem('cg')),
    item(t('title.settings'), 'CONFIG', 'gear', () => openSystem('config')),
    item(t('title.synopsis'), 'STORY', 'book', () => openText(t('title.synopsis'), txt(C.game.synopsis))),
    item(t('title.credits'), 'CREDITS', 'info', () => openCredits()),
  );
  playBgm(cfg('title_bgm', 'title'));
  // 제목: 작은 머리글(✦ 선) + 명조 제목 + 부제. 글자는 game.yaml 의 title / subtitle
  const logo = h(
    'div.title-logo',
    // 로고: config.yaml 의 title_logo 에 그림 파일을 적으면 그림, 비워 두면 코드로 그린 글자 로고
    (() => {
      const file = String(cfg('title_logo', '') ?? '');
      if (file) {
        // 그림 로고 + 효과: 촛불 일렁임, 글자 위로 빛이 스치는 반짝임, 초승달 빛 (config.yaml title_logo_fx)
        const url = asset(`ui/${file}`);
        const fx = cfg('title_logo_fx', true);
        const mask = { WebkitMaskImage: `url("${url}")`, maskImage: `url("${url}")` } as Record<string, string>;
        const img = h('img.title-logo-img', { src: url, alt: txt(C.game.title, '') }) as HTMLImageElement;
        const art = h(`div.logo-art${fx ? '.fx' : ''}`,
          img,
          fx ? h('div.logo-flash') : null,
          fx ? h('div.logo-shine', { style: mask }) : null,
          fx ? h('div.logo-moon') : null,
        );
        // 그림을 다 불러오고 풀어 둔 뒤에 연출 시작 (중간에 뚝 끊기지 않게)
        const start = () => requestAnimationFrame(() => requestAnimationFrame(() => art.classList.add('ready')));
        if (img.complete) start();
        else img.decode().then(start, start);
        return art;
      }
      return typeLogo(txt(C.game.title, '제목 미정'));
    })(),
    h('div.title-sub', txt(C.game.subtitle)),
  );
  // 움직이는 배경: public/assets/ui/title_bg.webm / .mp4 (소리 없이 반복). 없거나 재생이 막히면 그림 배경만 보인다
  const video = h(
    'video.title-video',
    { autoplay: true, muted: true, loop: true, playsinline: true, preload: 'auto' },
    h('source', { src: asset('ui/title_bg.webm'), type: 'video/webm' }),
    h('source', { src: asset('ui/title_bg.mp4'), type: 'video/mp4' }),
  ) as HTMLVideoElement;
  video.muted = true;
  video.addEventListener('playing', () => video.classList.add('ready'));
  void video.play().catch(() => {});
  const screen = h(
    'div.title-screen',
    video,
    logo,
    menu,
    h('div.title-author', txt(C.game.author)),
  );
  // 타이틀 배경: public/assets/ui/title_bg.jpg 또는 .png (없으면 그라데이션)
  screen.style.backgroundImage = `url(${asset('ui/title_bg.jpg')}), url(${asset('ui/title_bg.png')}), radial-gradient(circle at 50% 30%, #3a2850, #120c18)`;
  root.appendChild(screen);
  // 타이틀 위로 내리는 비 (코드로 그림). config.yaml 의 title_fx: rain / dust / embers / none
  setAmbient(String(cfg('title_fx', 'rain')), screen);
}

// ── 게임 중 메뉴 · 저장 · 설정 ─────────────────────
// 모두 시스템 메뉴(sysmenu.ts)의 탭으로 열린다.

export function openGameMenu() {
  openSystem('config');
}

export function openSaveLoad(mode: 'save' | 'load') {
  openSystem(mode);
}

export function openSettings() {
  openSystem('config');
}

// ── 지난 대화 ─────────────────────────────────────

function nameTag(name: string, color: string) {
  const el = h('div.bl-name', name);
  el.style.setProperty('--c', color);
  return el;
}

/**
 * 대사 카드가 세로로 쌓이는 화면. 카드 위에 이름표, 왼쪽에 동그란 초상화(icon.png),
 * 오른쪽에 "여기로 돌아가기" 버튼 (일반 대본 진행 중의 최근 대사만).
 */
export function openBacklog() {
  if (document.querySelector('.backlog-screen')) return;
  const list = h('div.bl-list');
  const close = () => {
    wrap.remove();
    window.removeEventListener('keydown', onKey, true);
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      close();
    }
  };
  const wrap = h(
    'div.modal.backlog-screen',
    { onclick: (e: Event) => e.target === wrap && close() },
    h('div.bl-title', t('dialogue.backlog_title')),
    h('button.bl-close', { onclick: close, title: t('settings.close') }, '✕'),
    list,
  );
  if (backlog.length === 0) list.appendChild(h('p.empty', t('dialogue.backlog_empty')));
  backlog.forEach((b, i) => {
    if (b.kind === 'choice') {
      list.appendChild(h('div.bl-choice', h('span', '▶ ' + b.text)));
      return;
    }
    const def = b.speakerId ? C.characters[b.speakerId] : undefined;
    let icon: HTMLElement | null = null;
    if (def && !def.player) {
      const img = h('img', { src: asset(`characters/${b.speakerId}/icon.png`), alt: def.name }) as HTMLImageElement;
      img.onerror = () => img.replaceWith(h('span', def.name.slice(0, 1)));
      icon = h('div.bl-icon', img);
    }
    const rewind = b.snap
      ? h('button.bl-rewind', {
          title: t('dialogue.rewind'),
          onclick: async () => {
            if (!(await confirm(t('confirm.rewind'), '이 대사로 돌아갈까요? 그 뒤의 진행은 사라집니다.'))) return;
            close();
            game.rewindTo(i);
          },
        }, '↺')
      : null;
    const color = b.color && !isTodo(b.color) ? b.color : 'var(--name-default)';
    list.appendChild(
      h(`div.bl-entry${b.name ? '' : '.narration'}${def?.player ? '.me' : ''}`,
        h('div.bl-side', icon),
        h('div.bl-card',
          b.name ? nameTag(b.name, color) : null,
          h('div.bl-text', b.text)),
        h('div.bl-side', rewind)),
    );
  });
  layer('modal').appendChild(wrap);
  window.addEventListener('keydown', onKey, true);
  requestAnimationFrame(() => (list.scrollTop = list.scrollHeight));
}

// ── 수첩 ──────────────────────────────────────────

type NbTab = 'evidence' | 'items' | 'people' | 'suspects' | 'conclusions' | 'truths' | 'help';

/** 호감도 단계 이름 (config.yaml 의 affinity.levels 로 바꿀 수 있음) */
function affinityLevel(v: number) {
  const levels: [number, string][] = cfg('affinity.levels', [[-10, '적대'], [-4, '경계'], [0, '보통'], [3, '친근'], [6, '신뢰'], [9, '각별']]);
  let name = levels[0]?.[1] ?? '';
  for (const [min, label] of levels) if (v >= min) name = label;
  return name;
}

export function openNotebook(tab: NbTab = 'evidence') {
  const m = openModal(t('notebook.title'), 'notebook');
  const lbl = (k: string, fb: string) => tt(`notebook.${k}`, fb);
  const tabs: [NbTab, string][] = [
    ['evidence', t('notebook.tab_evidence')],
    ['items', lbl('tab_items', '아이템')],
    ['people', t('notebook.tab_people')],
    ['suspects', t('notebook.tab_suspects')],
    ['conclusions', t('notebook.tab_conclusions')],
    ['truths', lbl('tab_truths', '진실 조각')],
    ['help', '?'],
  ];
  const content = h('div.nb-content');
  const bar = h('div.nb-tabs', ...tabs.map(([k, label]) => h(`button.nb-tab${k === tab ? '.on' : ''}`, { onclick: () => { tab = k; render(); } }, label)));
  m.body.append(bar, content);

  const render = () => {
    bar.querySelectorAll('.nb-tab').forEach((b, i) => b.classList.toggle('on', tabs[i][0] === tab));
    clear(content);
    content.className = `nb-content nb-${tab}`;
    if (tab === 'evidence') {
      if (!S.evidence.length) content.appendChild(h('p.empty', t('notebook.empty_evidence')));
      for (const id of S.evidence) {
        const e = C.evidence[id] ?? { name: id, desc: '' };
        const upd = (e.updates ?? []).filter((u: any) => S.flags[u.flag]).pop();
        const img = e.image && !isTodo(e.image) ? h('img.nb-img', { src: asset(`evidence/${e.image}`) }) : null;
        content.appendChild(h('div.nb-item', img, h('b', txt(e.name, id)), h('p', txt(upd?.desc ?? e.desc))));
      }
    } else if (tab === 'items') {
      if (!S.items.length) content.appendChild(h('p.empty', lbl('empty_items', '가진 물건이 없다.')));
      for (const id of S.items) {
        const it = C.items[id] ?? { name: id };
        const img = it.image && !isTodo(it.image) ? h('img.nb-img', { src: asset(`items/${it.image}`) }) : null;
        content.appendChild(h('div.nb-item', img, h('b', txt(it.name, id)), h('p', txt(it.desc))));
      }
    } else if (tab === 'people') {
      const amin = cfg('affinity.min', -10);
      const amax = cfg('affinity.max', 10);
      for (const [id, def] of Object.entries(C.characters)) {
        if (def.player) continue;
        const gone = S.vanished.includes(id);
        const locked = S.confined.includes(id);
        const aff = S.affinity[id] ?? 0;
        const icon = h('img', { src: asset(`characters/${id}/icon.png`), alt: def.name }) as HTMLImageElement;
        icon.onerror = () => icon.replaceWith(h('span', def.name.slice(0, 1)));
        // 습관 도감: 아는 것만 글자로, 모르는 건 ???
        const habits = Object.entries(def.habits ?? {}).filter(([, v]) => !isTodo(v));
        const known = habits.filter(([hid]) => S.habits.includes(`${id}.${hid}`));
        const anomalies = S.anomalies.filter((a) => a.who === id);
        const status = gone ? txt(C.ui.notebook?.vanished_mark, '행방불명') : locked ? lbl('confined_mark', '갇힘') : '';
        const meter = h('div.aff-bar', h('div.aff-fill', { style: { width: `${((aff - amin) / (amax - amin)) * 100}%` } }));
        content.appendChild(
          h(`div.nb-item.person${gone ? '.gone' : ''}${locked ? '.locked' : ''}`,
            h('div.person-head',
              h('div.person-icon', icon),
              h('div.person-name',
                h('b', { style: { color: charColor(id) } }, def.name),
                status ? h('span.person-status', status) : null),
              h('div.person-aff',
                h('small', `${names('%affinity%')} · ${affinityLevel(aff)}${cfg('affinity.show_numbers', false) ? ` (${aff})` : ''}`),
                meter)),
            h('p', gone ? txt(def.reactions?.vanished_note as any, txt(def.profile)) : txt(def.profile)),
            habits.length
              ? h('div.habits',
                  h('small', lbl('habits_title', '평소 습관')),
                  ...habits.map(([hid, text]) => {
                    const knows = S.habits.includes(`${id}.${hid}`);
                    const odd = anomalies.some((a) => a.habit === hid);
                    return h(`div.habit${knows ? '' : '.unknown'}${odd ? '.odd' : ''}`, knows ? names(text) : '???', odd ? h('span.odd-mark', lbl('anomaly_mark', '어긋남')) : null);
                  }),
                  h('small.habit-count', `${known.length} / ${habits.length}`))
              : null,
            ...anomalies.map((a) => h('p.anomaly', `「${names(a.text)}」`))),
        );
      }
    } else if (tab === 'suspects') {
      const marks = S.marks.filter((mk) => mk.correct);
      if (!marks.length) content.appendChild(h('p.empty', t('notebook.empty_suspects')));
      for (const mk of marks) content.appendChild(h('div.nb-item', h('b', charName(mk.speaker)), h('p', `「${names(mk.text)}」`)));
    } else if (tab === 'conclusions') {
      if (!S.conclusions.length) content.appendChild(h('p.empty', t('notebook.empty_conclusions')));
      for (const id of S.conclusions) {
        const c = C.conclusions[id];
        content.appendChild(h('div.nb-item', h('b', txt(c?.name, id)), h('p', txt(c?.text))));
      }
    } else if (tab === 'truths') {
      const all = Object.entries(C.truths);
      content.appendChild(h('div.sys-progress', h('b', String(S.truths.length)), ` / ${all.length}`));
      for (const [id, tr] of all) {
        const got = S.truths.includes(id);
        content.appendChild(h(`div.nb-item.truth${got ? '' : '.locked'}`, h('b', got ? txt(tr.title, id) : '???'), h('p', got ? txt(tr.text) : lbl('truth_locked', '아직 드러나지 않은 진실'))));
      }
    } else {
      // 도움말: 본 튜토리얼 다시 보기
      for (const id of P.tutorialsSeen) {
        const tut = C.tutorials[id];
        if (!tut) continue;
        content.appendChild(h('button.card', { onclick: () => { m.close(); void game.tutorial(id, true); } }, txt(tut.title, id)));
      }
    }
  };
  render();
}

// ── 갤러리 · 흐름도 ─────────────────────────────────

export function openGallery() {
  openSystem('endings');
}

export function openFlowchart() {
  openSystem('flowchart');
}

// ── 글 보기 (시놉시스, 엔딩 설명 등) ──────────────────

export function openText(title: string, body: string) {
  const m = openModal(title, 'text');
  for (const para of String(body).split(/\n{2,}/)) m.body.appendChild(h('p', ...para.split('\n').flatMap((l, i) => (i ? [h('br'), l] : [l]))));
}

export function openCredits() {
  const m = openModal(t('title.credits'), 'text');
  for (const c of C.game.credits ?? []) if (!isTodo(c)) m.body.appendChild(h('p', names(c)));
  if (!isTodo(C.game.disclaimer)) m.body.appendChild(h('p.disclaimer', names(C.game.disclaimer)));
}
