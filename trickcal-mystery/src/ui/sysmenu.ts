/**
 * 시스템 메뉴 — 화면 전체를 쓰는 메뉴.
 *   왼쪽: 게임 제목 + 탭 목록 (게임 / 설정 / 엑스트라)
 *   위쪽: 큰 제목 + 한 줄 설명 + 닫기
 *   오른쪽 아래: SAVE · LOAD · CONFIG · TITLE 빠른 이동 (게임 중에만)
 *
 * 탭: 저장, 불러오기, 환경 설정, 조작법, CG, 음악, 영상, 엔딩, 사건 흐름도
 * 문구는 content/text/ui.yaml 의 system: / settings: / controls: 에 있다.
 */
import { C, cfg, names, setPlayerName, t } from '../engine/content';
import type { ExtraItem } from '../engine/content';
import { game } from '../engine/game';
import { P, flowchartUnlocked, savePersist } from '../engine/state';
import { Snapshot, exportSave, importSave, readSlot, slotLabel, writeSlot } from '../engine/save';
import { applyVolume, bgmSrc, pauseBgm } from '../engine/audio';
import { isTodo, sleep } from '../engine/util';
import { asset, clear, h, layer } from './dom';
import { confirm, toast } from './modal';
import { sfx } from './sfx';
import { refreshSprites } from './scene';
import { enterFullscreen, exitFullscreen, isFullscreen } from './fullscreen';

export type SysTab = 'save' | 'load' | 'config' | 'controls' | 'cg' | 'music' | 'video' | 'endings' | 'flowchart';

const txt = (v: any, fallback = '') => (isTodo(v) || v === undefined || v === null || v === '' ? fallback : names(String(v)));
/** ui.yaml 에 없거나 TODO 면 기본 문구 */
const tt = (key: string, fallback: string) => {
  const v = t(key);
  return /^\[.*\]$/.test(v) || isTodo(v) ? fallback : v;
};

let current: { el: HTMLElement; close: () => void } | null = null;
let cleanups: (() => void)[] = [];

function inGame() {
  return !document.querySelector('.title-screen');
}

interface TabDef {
  id: SysTab;
  label: string;
  desc: string;
  show?: () => boolean;
  render: (body: HTMLElement) => void;
}

function tabs(): { group: string; items: TabDef[] }[] {
  return [
    {
      group: tt('system.group_game', 'GAME'),
      items: [
        { id: 'save', label: tt('system.save', '저장하기'), desc: tt('system.save_desc', '지금까지의 진행을 저장합니다.'), show: () => inGame(), render: (b) => renderSlots(b, 'save') },
        { id: 'load', label: tt('system.load', '불러오기'), desc: tt('system.load_desc', '저장한 지점에서 다시 시작합니다.'), render: (b) => renderSlots(b, 'load') },
      ],
    },
    {
      group: tt('system.group_config', 'CONFIG'),
      items: [
        { id: 'config', label: tt('system.config', '환경 설정'), desc: tt('system.config_desc', '글자 속도, 소리, 화면을 조정합니다.'), render: renderConfig },
        { id: 'controls', label: tt('system.controls', '조작법'), desc: tt('system.controls_desc', '키보드와 마우스로 할 수 있는 것들입니다.'), render: renderControls },
      ],
    },
    {
      group: tt('system.group_extra', 'EXTRA'),
      items: [
        { id: 'cg', label: 'CG', desc: tt('system.cg_desc', '게임에서 만난 특별한 장면을 다시 봅니다.'), render: renderCg },
        { id: 'music', label: tt('system.music', '음악'), desc: tt('system.music_desc', '게임에 흐른 음악을 다시 듣습니다.'), render: renderMusic },
        { id: 'video', label: tt('system.video', '영상'), desc: tt('system.video_desc', '게임 속 영상을 다시 봅니다.'), render: renderVideo },
        { id: 'endings', label: tt('system.endings', '엔딩'), desc: tt('system.endings_desc', '지금까지 도달한 결말입니다.'), render: renderEndings },
        { id: 'flowchart', label: names('%flowchart%'), desc: tt('system.flowchart_desc', '이야기의 갈림길을 되짚고, 그 지점으로 돌아갑니다.'), show: flowchartUnlocked, render: renderFlowchart },
      ],
    },
  ];
}

export function openSystem(tab: SysTab = 'config') {
  if (current) current.close();
  let active = tab;
  const side = h('div.sys-side');
  const title = h('h2.sys-title');
  const desc = h('div.sys-desc');
  const body = h('div.sys-body');
  const close = () => {
    runCleanups();
    sfx('close');
    el.remove();
    window.removeEventListener('keydown', onKey, true);
    current = null;
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape' && el === layer('modal').lastElementChild) {
      e.stopPropagation();
      close();
    }
  };
  const quick = inGame()
    ? h(
        'div.sys-quick',
        h('button', { onclick: () => go('save') }, 'SAVE'),
        h('button', { onclick: () => go('load') }, 'LOAD'),
        h('button', { onclick: () => go('config') }, 'CONFIG'),
        h('button', {
          onclick: async () => {
            if (await confirm(t('confirm.to_title'), '타이틀로 돌아갈까요? 저장하지 않은 진행은 사라집니다.')) {
              close();
              game.toTitle();
            }
          },
        }, 'BACK TO TITLE'),
      )
    : null;
  const el = h(
    'div.modal.sys',
    side,
    h('div.sys-main',
      h('div.sys-head', h('div.sys-head-text', title, desc), h('button.sys-close', { onclick: close, title: tt('settings.close', '닫기') }, '✕')),
      body),
    quick,
  );

  const go = (id: SysTab) => {
    active = id;
    render();
  };
  const render = () => {
    runCleanups();
    clear(side);
    side.appendChild(
      h('div.sys-logo', h('small', t('title.kicker').replace(/^\[.*\]$/, 'TRICKCAL THE HALLOWEEN')), h('b', txt(C.game.title, '제목 미정'))),
    );
    let found: TabDef | undefined;
    for (const g of tabs()) {
      const items = g.items.filter((i) => !i.show || i.show());
      if (!items.length) continue;
      side.appendChild(h('div.sys-group', g.group));
      for (const it of items) {
        if (it.id === active) found = it;
        side.appendChild(h(`button.sys-tab${it.id === active ? '.on' : ''}`, { onclick: () => go(it.id) }, it.label));
      }
    }
    if (!found) {
      // 볼 수 없는 탭(타이틀에서 저장 등)이면 첫 탭으로
      const first = tabs().flatMap((g) => g.items).find((i) => !i.show || i.show())!;
      active = first.id;
      return render();
    }
    title.textContent = found.label;
    desc.textContent = found.desc;
    clear(body);
    body.className = `sys-body sys-${found.id}`;
    found.render(body);
    el.querySelectorAll('.sys-quick button').forEach((b, i) => b.classList.toggle('on', ['save', 'load', 'config'][i] === active));
  };

  layer('modal').appendChild(el);
  sfx('open');
  window.addEventListener('keydown', onKey, true);
  current = { el, close };
  render();
}

export function closeSystem() {
  current?.close();
}

function runCleanups() {
  const list = cleanups;
  cleanups = [];
  for (const fn of list) fn();
}

// ═══ 저장 · 불러오기 ═══════════════════════════════════════════

function renderSlots(body: HTMLElement, mode: 'save' | 'load') {
  if (mode === 'save' && game.saveLocked) {
    body.appendChild(h('p.empty', '지금은 저장할 수 없습니다.'));
    return;
  }
  const draw = () => {
    clear(body);
    const grid = h('div.slot-grid');
    const slots: (number | string)[] = mode === 'load' ? ['auto'] : [];
    for (let i = 1; i <= cfg('save.slots', 12); i++) slots.push(i);
    for (const slot of slots) {
      const snap = readSlot(slot);
      const label = slot === 'auto' ? t('save.autosave') : `No.${String(slot).padStart(2, '0')}`;
      const card = h(
        `button.slot${snap ? '' : '.empty-slot'}`,
        {
          disabled: mode === 'load' && !snap,
          onclick: async () => {
            if (mode === 'save') {
              if (snap && !(await confirm(t('confirm.overwrite'), '이 칸에 덮어쓸까요?'))) return;
              const s = game.snapshot();
              if (!s) return;
              try {
                writeSlot(slot, s);
                toast(t('save.saved'));
              } catch {
                toast(t('error.save_failed'), 'error');
              }
              draw();
            } else if (snap) {
              closeSystem();
              clear(layer('modal'));
              void game.loadSnapshot(snap);
            }
          },
        },
        h('div.slot-no', label),
        h('div.slot-label', snap ? slotLabel(snap) : t('save.empty_slot')),
        snap ? h('div.slot-date', new Date(snap.time).toLocaleString()) : null,
      );
      // 저장 당시 배경을 칸의 배경으로
      const bg = snap?.state?.stage?.bg;
      if (bg && bg !== 'none' && bg !== 'black') card.style.setProperty('--thumb', `url(${asset(`bg/${bg}.jpg`)})`);
      grid.appendChild(card);
    }
    body.appendChild(grid);
    const tools = h('div.slot-tools');
    if (mode === 'save') {
      tools.appendChild(h('button.btn', { onclick: () => { const s = game.snapshot(); if (s) exportSave(s); } }, t('save.export')));
    } else {
      tools.appendChild(
        h('button.btn', {
          onclick: async () => {
            const snap = await importSave();
            if (!snap) {
              toast(t('error.bad_file'), 'error');
              return;
            }
            closeSystem();
            clear(layer('modal'));
            void game.loadSnapshot(snap as Snapshot);
          },
        }, t('save.import')),
      );
    }
    body.appendChild(tools);
  };
  draw();
}

// ═══ 환경 설정 ════════════════════════════════════════════════

function renderConfig(body: HTMLElement) {
  const s = P.settings;
  const save = () => savePersist();

  const slider = (label: string, key: 'textSpeed' | 'autoDelay' | 'master' | 'bgm' | 'se' | 'windowOpacity', min: number, max: number, step: number, show: (v: number) => string, onChange?: () => void) => {
    const input = h('input.sys-range', { type: 'range', min, max, step, value: s[key] }) as HTMLInputElement;
    const value = h('span.sys-value', show(s[key]));
    const paint = () => input.style.setProperty('--fill', `${((Number(input.value) - min) / (max - min)) * 100}%`);
    paint();
    input.oninput = () => {
      s[key] = Number(input.value);
      value.textContent = show(s[key]);
      paint();
      onChange?.();
      save();
    };
    return h('div.sys-row', h('div.sys-row-head', h('span', label), value), input);
  };
  const toggle = (label: string, options: [string, boolean][], get: () => boolean, set: (v: boolean) => void) => {
    const wrap = h('div.sys-seg');
    const draw = () => {
      clear(wrap);
      for (const [text, v] of options) {
        wrap.appendChild(h(`button${get() === v ? '.on' : ''}`, { onclick: () => { set(v); draw(); } }, text));
      }
    };
    draw();
    return h('div.sys-row', h('div.sys-row-head', h('span', label)), wrap);
  };
  const pct = (v: number) => `${Math.round(v * 100)}`;

  // 글자 속도 미리보기
  const preview = h('div.sys-preview');
  const sample = tt('settings.preview', '글자가 이런 속도로 나옵니다.\n마음에 드는 속도로 맞춰 보세요.');
  let run = 0;
  const playPreview = async () => {
    const id = ++run;
    while (id === run) {
      preview.textContent = '';
      for (const ch of sample) {
        if (id !== run) return;
        preview.textContent += ch;
        await sleep(1000 / Math.max(1, s.textSpeed));
      }
      await sleep(Math.max(600, s.autoDelay * 1000));
    }
  };
  void playPreview();
  cleanups.push(() => (run = -1));

  // 교주 이름
  const nameInput = h('input.sys-input', { type: 'text', maxlength: 12, placeholder: tt('settings.player_name_hint', '비워 두면 기본 이름'), value: s.playerName }) as HTMLInputElement;
  const applyName = () => {
    s.playerName = nameInput.value.trim();
    setPlayerName(s.playerName);
    save();
    toast(tt('settings.player_name_done', '이름을 바꿨습니다.'));
  };
  nameInput.onkeydown = (e) => {
    e.stopPropagation();
    if (e.key === 'Enter') applyName();
  };

  const isFull = () => isFullscreen();
  const setFull = (v: boolean) => {
    if (v && !isFull()) void enterFullscreen();
    if (!v && isFull()) void exitFullscreen();
  };

  body.append(
    h('div.sys-col',
      h('h3.sys-h', tt('settings.group_text', '텍스트')),
      slider(t('settings.text_speed'), 'textSpeed', 10, 120, 1, (v) => String(Math.round(v)), () => void playPreview()),
      preview,
      slider(t('settings.auto_speed'), 'autoDelay', 0.3, 4, 0.1, (v) => `${v.toFixed(1)}초`),
      toggle(t('settings.skip_unread'), [[tt('settings.off', '끄기'), false], [tt('settings.on', '켜기'), true]], () => s.skipUnread, (v) => { s.skipUnread = v; save(); }),
      slider(tt('settings.window_opacity', '대화창 진하기'), 'windowOpacity', 0.2, 1, 0.05, pct, () => document.documentElement.style.setProperty('--dlg-opacity', String(s.windowOpacity))),
    ),
    h('div.sys-col',
      h('h3.sys-h', tt('settings.group_sound', '사운드')),
      slider(tt('settings.master', '전체 볼륨'), 'master', 0, 1, 0.05, pct, applyVolume),
      slider(t('settings.bgm'), 'bgm', 0, 1, 0.05, pct, applyVolume),
      slider(t('settings.se'), 'se', 0, 1, 0.05, pct),
      h('h3.sys-h', tt('settings.group_screen', '화면')),
      toggle(tt('settings.screen_mode', '화면 모드'), [[tt('settings.windowed', '창 모드'), false], [t('settings.fullscreen'), true]], isFull, setFull),
      toggle(tt('settings.char_motion', '캐릭터 움직임'), [[tt('settings.on', '켜기'), true], [tt('settings.off', '끄기'), false]], () => P.settings.charMotion !== false, (v) => { P.settings.charMotion = v; savePersist(); refreshSprites(); }),
      h('div.sys-row',
        h('div.sys-row-head', h('span', tt('settings.player_name', '교주 이름'))),
        h('div.sys-inline', nameInput, h('button.btn.small', { onclick: applyName }, tt('settings.apply', '변경')))),
      h('div.sys-reset', h('button.btn.small', {
        onclick: async () => {
          if (!(await confirm('', '설정을 기본값으로 되돌릴까요?'))) return;
          Object.assign(s, { textSpeed: cfg('text.speed', 35), autoDelay: cfg('text.auto_delay', 1.2), master: 1, bgm: 0.7, se: 0.8, skipUnread: cfg('text.skip_unread', false), windowOpacity: 0.72 });
          document.documentElement.style.setProperty('--dlg-opacity', String(s.windowOpacity));
          applyVolume();
          save();
          clear(body);
          runCleanups();
          renderConfig(body);
        },
      }, t('settings.reset'))),
    ),
  );
}

// ═══ 조작법 ═══════════════════════════════════════════════════

/** 키보드 그림: [글자, 너비(칸), 색 이름] */
const KEY_ROWS: [string, number, string?][][] = [
  [['Esc', 1, 'menu'], ['', 0.6], ['F1', 1], ['F2', 1], ['F3', 1], ['F4', 1], ['', 0.4], ['F5', 1], ['F6', 1], ['F7', 1], ['F8', 1], ['', 0.4], ['F9', 1, 'debug'], ['F10', 1], ['F11', 1], ['F12', 1]],
  [['`', 1], ['1', 1], ['2', 1], ['3', 1], ['4', 1], ['5', 1], ['6', 1], ['7', 1], ['8', 1], ['9', 1], ['0', 1], ['-', 1], ['=', 1], ['←', 2]],
  [['Tab', 1.5], ['Q', 1], ['W', 1], ['E', 1], ['R', 1], ['T', 1], ['Y', 1], ['U', 1], ['I', 1], ['O', 1], ['P', 1], ['[', 1], [']', 1], ['\\', 1.5]],
  [['Caps', 1.8], ['A', 1], ['S', 1], ['D', 1], ['F', 1], ['G', 1], ['H', 1], ['J', 1], ['K', 1], ['L', 1], [';', 1], ["'", 1], ['Enter', 2.2, 'next']],
  [['Shift', 2.3], ['Z', 1], ['X', 1], ['C', 1], ['V', 1], ['B', 1], ['N', 1], ['M', 1], [',', 1], ['.', 1], ['/', 1], ['Shift', 2.7]],
  [['Ctrl', 1.5, 'skip'], ['', 1], ['Alt', 1.3], ['Space', 6.4, 'next'], ['Alt', 1.3], ['', 1], ['Ctrl', 1.5, 'skip']],
];

function renderControls(body: HTMLElement) {
  const kb = h('div.kb');
  for (const row of KEY_ROWS) {
    const r = h('div.kb-row');
    for (const [label, w, kind] of row) {
      r.appendChild(label ? h(`div.kb-key${kind ? '.k-' + kind : ''}`, { style: { flex: String(w) } }, label) : h('div.kb-gap', { style: { flex: String(w) } }));
    }
    kb.appendChild(r);
  }
  const mouse = h('div.mouse', { html: `
    <svg viewBox="0 0 120 180" width="150" height="225">
      <rect x="6" y="6" width="108" height="168" rx="54" fill="none" stroke="currentColor" stroke-width="3" opacity=".6"/>
      <path d="M60 6 V70" stroke="currentColor" stroke-width="3" opacity=".6"/>
      <path d="M6 70 H114" stroke="currentColor" stroke-width="3" opacity=".6"/>
      <path class="m-next" d="M58 8 A52 52 0 0 0 8 60 V68 H58 Z"/>
      <path class="m-hide" d="M62 8 A52 52 0 0 1 112 60 V68 H62 Z"/>
      <rect class="m-wheel" x="52" y="24" width="16" height="30" rx="8"/>
    </svg>` });
  const legend = (kind: string, label: string, how: string) => h(`div.lg.k-${kind}`, h('i'), h('b', label), h('span', how));
  body.append(
    h('div.ctl-board', kb, mouse),
    h('div.ctl-legend',
      legend('next', tt('controls.next', '대사 넘기기'), tt('controls.next_how', '왼쪽 클릭 · Space · Enter')),
      legend('wheel', tt('controls.backlog', '지난 대화'), tt('controls.backlog_how', '휠을 위로')),
      legend('hide', tt('controls.hide', '대화창 숨기기'), tt('controls.hide_how', '오른쪽 클릭')),
      legend('skip', tt('controls.skip', '스킵'), tt('controls.skip_how', 'Ctrl 누르고 있기')),
      legend('menu', tt('controls.menu', '메뉴'), tt('controls.menu_how', 'Esc')),
      legend('debug', tt('controls.debug', '디버그 메뉴 (제작용)'), tt('controls.debug_how', 'F9')),
    ),
  );
}

// ═══ 엑스트라: 공통 ═══════════════════════════════════════════

function unlocked(item: ExtraItem, kind: 'cg' | 'music' | 'video') {
  const u = item.unlock ?? (kind === 'video' ? 'always' : 'seen');
  if (u === 'always') return true;
  if (u === 'seen') return kind === 'cg' ? P.cgSeen.includes(item.id) : kind === 'music' ? P.bgmHeard.includes(item.id) : false;
  return P.endingsSeen.includes(u);
}

function lockedText() {
  return tt('system.locked', '아직 열리지 않았습니다');
}

function progress(list: ExtraItem[], kind: 'cg' | 'music' | 'video') {
  const got = list.filter((i) => unlocked(i, kind)).length;
  return h('div.sys-progress', h('b', String(got)), ` / ${list.length}`);
}

// ═══ CG ══════════════════════════════════════════════════════

function renderCg(body: HTMLElement) {
  const list = C.extras.cg;
  if (!list.length) {
    body.appendChild(h('p.empty', tt('system.cg_empty', '아직 등록된 CG 가 없습니다.')));
    return;
  }
  body.appendChild(progress(list, 'cg'));
  const grid = h('div.cg-grid');
  list.forEach((item, i) => {
    const open = unlocked(item, 'cg');
    const thumb = h(`button.cg-thumb${open ? '' : '.locked'}`, { onclick: () => open && viewCg(list, i) },
      open ? cgImg(item.id) : h('span', '✦'),
      h('div.cg-cap', open ? txt(item.title, item.id) : '???'));
    grid.appendChild(thumb);
  });
  body.appendChild(grid);
}

/** CG 그림: jpg 먼저, 없으면 png */
function cgImg(id: string) {
  const img = h('img', { src: asset(`cg/${id}.jpg`) }) as HTMLImageElement;
  img.onerror = () => {
    img.onerror = null;
    img.src = asset(`cg/${id}.png`);
  };
  return img;
}

function viewCg(list: ExtraItem[], start: number) {
  const open = list.map((it, i) => [it, i] as const).filter(([it]) => unlocked(it, 'cg'));
  let pos = open.findIndex(([, i]) => i === start);
  const img = h('img') as HTMLImageElement;
  const cap = h('div.cg-view-cap');
  const show = () => {
    const [it] = open[pos];
    img.onerror = () => {
      img.onerror = null;
      img.src = asset(`cg/${it.id}.png`);
    };
    img.src = asset(`cg/${it.id}.jpg`);
    cap.textContent = `${txt(it.title, it.id)}${it.desc && !isTodo(it.desc) ? '  ·  ' + names(it.desc) : ''}`;
  };
  const close = () => {
    el.remove();
    window.removeEventListener('keydown', onKey, true);
  };
  const step = (d: number) => {
    pos = (pos + d + open.length) % open.length;
    show();
  };
  const onKey = (e: KeyboardEvent) => {
    e.stopPropagation();
    if (e.key === 'Escape') close();
    if (e.key === 'ArrowRight') step(1);
    if (e.key === 'ArrowLeft') step(-1);
  };
  const el = h('div.cg-view', { onclick: close }, img, cap,
    open.length > 1 ? h('button.cg-nav.prev', { onclick: (e: Event) => { e.stopPropagation(); step(-1); } }, '‹') : null,
    open.length > 1 ? h('button.cg-nav.next', { onclick: (e: Event) => { e.stopPropagation(); step(1); } }, '›') : null);
  layer('modal').appendChild(el);
  window.addEventListener('keydown', onKey, true);
  show();
}

// ═══ 음악 감상실 ══════════════════════════════════════════════

function fmt(sec: number) {
  if (!isFinite(sec)) return '0:00';
  const m = Math.floor(sec / 60);
  return `${m}:${String(Math.floor(sec % 60)).padStart(2, '0')}`;
}

function renderMusic(body: HTMLElement) {
  const list = C.extras.music;
  if (!list.length) {
    body.appendChild(h('p.empty', tt('system.music_empty', '아직 등록된 음악이 없습니다.')));
    return;
  }
  const audio = new Audio();
  audio.volume = P.settings.bgm * P.settings.master;
  pauseBgm(true);
  cleanups.push(() => {
    audio.pause();
    audio.src = '';
    pauseBgm(false);
  });

  let index = list.findIndex((i) => unlocked(i, 'music'));
  const art = h('img.disc-art') as HTMLImageElement;
  const disc = h('div.disc', art, h('div.disc-hole'));
  const name = h('div.mp-title');
  const artist = h('div.mp-artist');
  const about = h('div.mp-desc');
  const bar = h('div.mp-bar', h('div.mp-fill'));
  const cur = h('span', '0:00');
  const dur = h('span', '0:00');
  const playBtn = h('button.mp-btn.play', { onclick: () => (audio.paused ? audio.play().catch(() => {}) : audio.pause()) });
  const rows = h('div.tracks');

  const pick = (i: number, autoplay = true) => {
    if (i < 0 || !unlocked(list[i], 'music')) return;
    index = i;
    const it = list[i];
    audio.src = bgmSrc(it.id);
    audio.onerror = () => {
      if (!/\.ogg(\?|$)/.test(audio.src)) audio.src = audio.src.replace(/\.mp3(\?|$)/, '.ogg$1');
    };
    art.src = asset(it.art && !isTodo(it.art) ? it.art : 'ui/title_bg.jpg');
    name.textContent = txt(it.title, it.id);
    artist.textContent = txt(it.artist);
    about.textContent = txt(it.desc);
    rows.querySelectorAll('.track').forEach((r, k) => r.classList.toggle('on', k === i));
    if (autoplay) audio.play().catch(() => {});
  };
  const step = (d: number) => {
    for (let k = 1; k <= list.length; k++) {
      const j = (index + d * k + list.length * 4) % list.length;
      if (unlocked(list[j], 'music')) return pick(j);
    }
  };

  list.forEach((it, i) => {
    const open = unlocked(it, 'music');
    rows.appendChild(
      h(`button.track${open ? '' : '.locked'}`, { onclick: () => open && pick(i) },
        h('span.tr-no', String(i + 1).padStart(2, '0')),
        h('span.tr-name', open ? txt(it.title, it.id) : '???'),
        h('span.tr-artist', open ? txt(it.artist) : '')),
    );
  });

  audio.ontimeupdate = () => {
    cur.textContent = fmt(audio.currentTime);
    (bar.firstChild as HTMLElement).style.width = `${(audio.currentTime / (audio.duration || 1)) * 100}%`;
  };
  audio.onloadedmetadata = () => (dur.textContent = fmt(audio.duration));
  audio.onplay = () => { disc.classList.add('spin'); playBtn.classList.add('on'); };
  audio.onpause = () => { disc.classList.remove('spin'); playBtn.classList.remove('on'); };
  audio.onended = () => step(1);
  bar.onclick = (e: MouseEvent) => {
    const r = bar.getBoundingClientRect();
    if (audio.duration) audio.currentTime = ((e.clientX - r.left) / r.width) * audio.duration;
  };

  body.append(
    h('div.player',
      disc,
      h('div.mp-panel',
        name, artist, about,
        h('div.mp-time', cur, dur), bar,
        h('div.mp-ctrl',
          h('button.mp-btn.prev', { onclick: () => step(-1) }),
          playBtn,
          h('button.mp-btn.next', { onclick: () => step(1) })))),
    h('div.track-wrap', progress(list, 'music'), rows),
  );
  if (index >= 0) pick(index, false);
  else name.textContent = lockedText();
}

// ═══ 영상 ═════════════════════════════════════════════════════

function renderVideo(body: HTMLElement) {
  const list = C.extras.videos;
  if (!list.length) {
    body.appendChild(h('p.empty', tt('system.video_empty', '아직 등록된 영상이 없습니다.')));
    return;
  }
  const video = h('video.vp', { controls: true, playsinline: true, preload: 'metadata' }) as HTMLVideoElement;
  const cap = h('div.vp-cap');
  const rows = h('div.tracks');
  cleanups.push(() => video.pause());
  const pick = (i: number) => {
    const it = list[i];
    clear(video);
    const base = it.file && !isTodo(it.file) ? it.file : `ui/${it.id}`;
    video.append(h('source', { src: asset(`${base}.webm`), type: 'video/webm' }), h('source', { src: asset(`${base}.mp4`), type: 'video/mp4' }));
    if (it.poster) video.poster = asset(it.poster);
    video.load();
    cap.textContent = `${txt(it.title, it.id)}${it.desc && !isTodo(it.desc) ? '  ·  ' + names(it.desc) : ''}`;
    rows.querySelectorAll('.track').forEach((r, k) => r.classList.toggle('on', k === i));
  };
  list.forEach((it, i) => {
    const open = unlocked(it, 'video');
    rows.appendChild(h(`button.track${open ? '' : '.locked'}`, { onclick: () => open && pick(i) },
      h('span.tr-no', String(i + 1).padStart(2, '0')), h('span.tr-name', open ? txt(it.title, it.id) : '???')));
  });
  body.append(h('div.vp-wrap', video, cap), h('div.track-wrap', rows));
  const first = list.findIndex((i) => unlocked(i, 'video'));
  if (first >= 0) pick(first);
}

// ═══ 엔딩 ═════════════════════════════════════════════════════

function renderEndings(body: HTMLElement) {
  const list = Object.entries(C.endings).sort((a, b) => (a[1].no ?? 0) - (b[1].no ?? 0));
  const seen = list.filter(([id]) => P.endingsSeen.includes(id)).length;
  body.appendChild(h('div.sys-progress', h('b', String(seen)), ` / ${list.length}`));
  const grid = h('div.end-grid');
  for (const [id, e] of list) {
    const got = P.endingsSeen.includes(id);
    const type = t(`ending.type_${e.type ?? 'branch'}`);
    grid.appendChild(
      h(`button.end-card${got ? '' : '.locked'}.t-${e.type ?? 'branch'}`, {
        onclick: () => {
          if (got) toast(txt(e.desc, txt(e.title, id)));
          else if (e.hint && !isTodo(e.hint)) toast(`${txt(C.ui.gallery?.hint_prefix, '힌트:')} ${names(e.hint)}`);
        },
      },
      h('small', `ENDING ${String(e.no ?? 0).padStart(2, '0')}`),
      h('b', got ? txt(e.title, id) : '???'),
      h('span', got ? txt(type, '') : lockedText())),
    );
  }
  body.appendChild(grid);
}

// ═══ 사건 흐름도 ══════════════════════════════════════════════

function renderFlowchart(body: HTMLElement) {
  const nodes = C.flowchart;
  const children = new Map<string, string[]>();
  const roots: string[] = [];
  for (const [id, n] of Object.entries(nodes)) {
    if (n.parent && nodes[n.parent]) {
      if (!children.has(n.parent)) children.set(n.parent, []);
      children.get(n.parent)!.push(id);
    } else roots.push(id);
  }
  const renderNode = (id: string): HTMLElement => {
    const n = nodes[id];
    const seen = P.nodesSeen.includes(id) || P.endingsSeen.includes(id);
    const label = n.type === 'ending' ? txt(C.endings[id]?.title, id) : txt(n.label, id);
    const canJump = n.type === 'checkpoint' && !!P.checkpoints[id];
    const el = h(
      `div.flow-node.${n.type}${seen ? '.seen' : ''}`,
      h('span', seen ? label : t('flowchart.locked_node')),
      canJump
        ? h('button.btn.small', {
            onclick: async () => {
              if (!(await confirm(t('confirm.to_checkpoint'), '이 지점으로 돌아갈까요?'))) return;
              closeSystem();
              clear(layer('modal'));
              void game.loadSnapshot(P.checkpoints[id]);
            },
          }, t('flowchart.jump'))
        : null,
    );
    const kids = children.get(id) ?? [];
    return h('div.flow-branch', el, kids.length ? h('div.flow-children', ...kids.map(renderNode)) : null);
  };
  body.appendChild(h('div.flow-tree', ...roots.map(renderNode)));
}
