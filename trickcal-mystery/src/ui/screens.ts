/**
 * 메뉴 화면들: 타이틀, 게임 메뉴, 저장/불러오기, 설정, 지난 대화, 수첩, 엔딩 갤러리, 사건 흐름도, 크레딧.
 */
import { C, cfg, charColor, charName, names, t } from '../engine/content';
import { game } from '../engine/game';
import { P, S, flowchartUnlocked, savePersist } from '../engine/state';
import {
  Snapshot, exportSave, importSave, latestSlot, readSlot, slotLabel, writeSlot,
} from '../engine/save';
import { applyVolume } from '../engine/audio';
import { isTodo } from '../engine/util';
import { asset, clear, h, layer } from './dom';
import { backlog } from './dialogue';
import { confirm, openModal, toast } from './modal';
import { setHudVisible } from './hud';
import { openPhoneApp } from '../modes/phone';

const txt = (v: any, fallback = '') => (isTodo(v) || v === undefined ? fallback : names(String(v)));

// ── 타이틀 ────────────────────────────────────────

export function showTitle() {
  setHudVisible(false);
  const root = layer('modal');
  clear(root);
  clear(layer('dialogue').querySelector('.choices') as HTMLElement ?? h('div'));
  (layer('dialogue').querySelector('.dlg-box') as HTMLElement)?.classList.add('hidden');
  document.title = txt(C.game.title, '트릭컬 추리 팬게임');

  const latest = latestSlot(cfg('save.slots', 12));
  const menu = h(
    'div.title-menu',
    h('button.title-btn', {
      onclick: async () => {
        if (latest && !(await confirm(t('confirm.new_game'), '처음부터 시작할까요?'))) return;
        clear(root);
        void game.newGame();
      },
    }, t('title.new_game')),
    latest ? h('button.title-btn', { onclick: () => { clear(root); void game.loadSnapshot(latest.snap); } }, t('title.continue')) : null,
    h('button.title-btn', { onclick: () => openSaveLoad('load') }, t('title.load')),
    h('button.title-btn', { onclick: () => openGallery() }, t('title.gallery')),
    flowchartUnlocked()
      ? h('button.title-btn', { onclick: () => openFlowchart() }, t('title.flowchart'))
      : null,
    h('button.title-btn', { onclick: () => openSettings() }, t('title.settings')),
    h('button.title-btn', { onclick: () => openText(t('title.synopsis'), txt(C.game.synopsis)) }, t('title.synopsis')),
    h('button.title-btn', { onclick: () => openCredits() }, t('title.credits')),
  );
  const logo = h('img.title-logo', { src: asset('ui/title_logo.png') }) as HTMLImageElement;
  logo.onerror = () => logo.replaceWith(h('h1.title-text', txt(C.game.title, '제목 미정')));
  const screen = h(
    'div.title-screen',
    logo,
    h('div.title-sub', txt(C.game.subtitle)),
    menu,
    h('div.title-author', txt(C.game.author)),
  );
  // 타이틀 배경: public/assets/ui/title_bg.png (없으면 그라데이션)
  screen.style.backgroundImage = `url(${asset('ui/title_bg.png')}), radial-gradient(circle at 50% 30%, #3a2850, #120c18)`;
  root.appendChild(screen);
}

// ── 게임 중 메뉴 ──────────────────────────────────

export function openGameMenu() {
  const m = openModal(t('menu.settings'), 'game-menu');
  const btn = (label: string, fn: () => void) => h('button.menu-btn', { onclick: () => { m.close(); fn(); } }, label);
  const items = [
    btn(t('menu.save'), () => openSaveLoad('save')),
    btn(t('menu.load'), () => openSaveLoad('load')),
    btn(t('menu.backlog'), () => openBacklog()),
    btn(t('menu.notebook'), () => openNotebook()),
    btn(t('menu.phone'), () => openPhoneApp()),
    flowchartUnlocked() ? btn(t('title.flowchart'), () => openFlowchart()) : null,
    btn(t('title.gallery'), () => openGallery()),
    btn(t('menu.settings'), () => openSettings()),
    btn(t('menu.to_title'), async () => {
      if (await confirm(t('confirm.to_title'), '타이틀로 돌아갈까요? 저장하지 않은 진행은 사라집니다.')) {
        game.toTitle();
      }
    }),
  ];
  m.body.append(...items.filter((x): x is HTMLElement => !!x));
}

// ── 저장/불러오기 ─────────────────────────────────

export function openSaveLoad(mode: 'save' | 'load') {
  if (mode === 'save' && game.saveLocked) {
    toast('지금은 저장할 수 없습니다.', 'warn');
    return;
  }
  const m = openModal(mode === 'save' ? t('save.title_save') : t('save.title_load'), 'saveload');
  const render = () => {
    clear(m.body);
    const grid = h('div.slot-grid');
    const slots: (number | string)[] = mode === 'load' ? ['auto'] : [];
    for (let i = 1; i <= cfg('save.slots', 12); i++) slots.push(i);
    for (const slot of slots) {
      const snap = readSlot(slot);
      const label = slot === 'auto' ? t('save.autosave') : `No.${slot}`;
      grid.appendChild(
        h('button.slot', {
          disabled: mode === 'load' && !snap,
          onclick: async () => {
            if (mode === 'save') {
              if (snap && !(await confirm(t('confirm.overwrite'), '덮어쓸까요?'))) return;
              const s = game.snapshot();
              if (!s) return;
              try {
                writeSlot(slot, s);
                toast(t('save.saved'));
              } catch {
                toast(t('error.save_failed'), 'error');
              }
              render();
            } else if (snap) {
              m.close();
              clear(layer('modal'));
              void game.loadSnapshot(snap);
            }
          },
        },
        h('b', label),
        h('span', snap ? slotLabel(snap) : t('save.empty_slot')),
        snap ? h('small', new Date(snap.time).toLocaleString()) : null),
      );
    }
    m.body.appendChild(grid);
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
            m.close();
            clear(layer('modal'));
            void game.loadSnapshot(snap as Snapshot);
          },
        }, t('save.import')),
      );
    }
    m.body.appendChild(tools);
  };
  render();
}

// ── 설정 ──────────────────────────────────────────

export function openSettings() {
  const m = openModal(t('settings.title'), 'settings');
  const s = P.settings;
  const slider = (label: string, key: keyof typeof s, min: number, max: number, step: number) => {
    const input = h('input', { type: 'range', min, max, step, value: s[key] as number }) as HTMLInputElement;
    input.oninput = () => {
      (s as any)[key] = Number(input.value);
      applyVolume();
      savePersist();
    };
    return h('label.setting', h('span', label), input);
  };
  const check = h('input', { type: 'checkbox' }) as HTMLInputElement;
  check.checked = s.skipUnread;
  check.onchange = () => {
    s.skipUnread = check.checked;
    savePersist();
  };
  m.body.append(
    slider(t('settings.text_speed'), 'textSpeed', 10, 120, 1),
    slider(t('settings.auto_speed'), 'autoDelay', 0.3, 4, 0.1),
    slider(t('settings.bgm'), 'bgm', 0, 1, 0.05),
    slider(t('settings.se'), 'se', 0, 1, 0.05),
    h('label.setting', h('span', t('settings.skip_unread')), check),
    h('button.btn', { onclick: () => (document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen().catch(() => {})) }, t('settings.fullscreen')),
  );
}

// ── 지난 대화 ─────────────────────────────────────

export function openBacklog() {
  const m = openModal(t('menu.backlog'), 'backlog');
  if (backlog.length === 0) m.body.appendChild(h('p.empty', t('dialogue.backlog_empty')));
  for (const b of backlog) {
    m.body.appendChild(h('div.backlog-row', b.name ? h('b', { style: { color: b.color } }, b.name) : null, h('span', b.text)));
  }
  requestAnimationFrame(() => (m.body.scrollTop = m.body.scrollHeight));
}

// ── 수첩 ──────────────────────────────────────────

export function openNotebook(tab: 'evidence' | 'people' | 'suspects' | 'conclusions' | 'help' = 'evidence') {
  const m = openModal(t('notebook.title'), 'notebook');
  const tabs: [typeof tab, string][] = [
    ['evidence', t('notebook.tab_evidence')],
    ['people', t('notebook.tab_people')],
    ['suspects', t('notebook.tab_suspects')],
    ['conclusions', t('notebook.tab_conclusions')],
    ['help', '?'],
  ];
  const content = h('div.nb-content');
  const bar = h('div.nb-tabs', ...tabs.map(([k, label]) => h(`button.nb-tab${k === tab ? '.on' : ''}`, { onclick: () => { tab = k; render(); } }, label)));
  m.body.append(bar, content);

  const render = () => {
    bar.querySelectorAll('.nb-tab').forEach((b, i) => b.classList.toggle('on', tabs[i][0] === tab));
    clear(content);
    if (tab === 'evidence') {
      if (!S.evidence.length) content.appendChild(h('p.empty', t('notebook.empty_evidence')));
      for (const id of S.evidence) {
        const e = C.evidence[id] ?? { name: id, desc: '' };
        const upd = (e.updates ?? []).filter((u: any) => S.flags[u.flag]).pop();
        const img = e.image && !isTodo(e.image) ? h('img.nb-img', { src: asset(`evidence/${e.image}`) }) : null;
        content.appendChild(h('div.nb-item', img, h('b', txt(e.name, id)), h('p', txt(upd?.desc ?? e.desc))));
      }
    } else if (tab === 'people') {
      for (const [id, def] of Object.entries(C.characters)) {
        if (def.player) continue;
        const gone = S.vanished.includes(id);
        content.appendChild(
          h(`div.nb-item${gone ? '.gone' : ''}`,
            h('b', { style: { color: charColor(id) } }, def.name, gone ? ` ${txt(C.ui.notebook?.vanished_mark, '(행방불명)')}` : ''),
            h('p', gone ? txt(def.reactions?.vanished_note as any, txt(def.profile)) : txt(def.profile)),
            cfg('affinity.show_numbers', false) ? h('small', `${names('%affinity%')} ${S.affinity[id] ?? 0}`) : null),
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

// ── 엔딩 갤러리 ───────────────────────────────────

export function openGallery() {
  const m = openModal(t('gallery.title'), 'gallery');
  const list = Object.entries(C.endings).sort((a, b) => (a[1].no ?? 0) - (b[1].no ?? 0));
  const seen = list.filter(([id]) => P.endingsSeen.includes(id)).length;
  m.body.appendChild(h('div.gallery-progress', t('gallery.progress', { seen, total: list.length })));
  const grid = h('div.gallery-grid');
  for (const [id, e] of list) {
    const got = P.endingsSeen.includes(id);
    grid.appendChild(
      h(`button.gallery-item${got ? '' : '.locked'}`, {
        onclick: () => {
          if (got) openText(txt(e.title, id), txt(e.desc));
          else if (e.hint && !isTodo(e.hint)) toast(`${txt(C.ui.gallery?.hint_prefix)} ${names(e.hint)}`);
        },
      },
      h('small', `ENDING ${String(e.no).padStart(2, '0')}`),
      h('b', got ? txt(e.title, id) : t('gallery.locked'))),
    );
  }
  m.body.appendChild(grid);
}

// ── 사건 흐름도 ───────────────────────────────────

export function openFlowchart() {
  const m = openModal(t('flowchart.title'), 'flowchart');
  m.body.appendChild(h('p.flow-guide', t('flowchart.guide').replace(/^TODO$/, '')));
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
              clear(layer('modal'));
              void game.loadSnapshot(P.checkpoints[id]);
            },
          }, t('flowchart.jump'))
        : null,
    );
    const kids = children.get(id) ?? [];
    return h('div.flow-branch', el, kids.length ? h('div.flow-children', ...kids.map(renderNode)) : null);
  };
  m.body.appendChild(h('div.flow-tree', ...roots.map(renderNode)));
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
