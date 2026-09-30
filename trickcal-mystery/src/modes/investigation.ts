/**
 * 조사 모드 (방탈출) — 방 배경 위의 지점을 누르고, 문·지도로 이동한다.
 *   지점: 대사 / 단서 / 아이템 줍기 / 클로즈업(몇 단계든) / 아이템 사용 / 번호 자물쇠·순서 맞추기
 *   사람: 대화 주제 메뉴 / 증거·아이템 보여 주기 / 호감도 조건 / 습관 알아내기
 *   휴대폰 카메라: 방을 찍어 두고, 나중에 같은 방과 비교해 달라진 곳 찾기
 * 데이터: content/investigations/*.yaml, content/locations.yaml, content/items.yaml
 */
import { C, cfg, charName, names, t } from '../engine/content';
import type { CloseupDef, Hotspot, InvestigationDef, LockDef, SpotPerson, TopicDef, UseDef } from '../engine/content';
import { playBgm } from '../engine/audio';
import { events } from '../engine/events';
import { game } from '../engine/game';
import {
  S, applyEffect, giveClue, giveItem, learnHabit, loseItem, setFlag,
} from '../engine/state';
import { asArray, isTodo, pick, waitFor } from '../engine/util';
import { asset, clear, h, layer } from '../ui/dom';
import { setAmbient } from '../ui/effects';
import * as dlg from '../ui/dialogue';
import { openModal, toast } from '../ui/modal';
import { pickThing } from '../ui/picker';
import * as scene from '../ui/scene';

type Action =
  | { type: 'spot'; spot: Hotspot }
  | { type: 'person'; person: SpotPerson }
  | { type: 'door'; to: string; kind?: string; rect?: [number, number, number, number] }
  | { type: 'photo' }
  | { type: 'compare' }
  | { type: 'finish' };

const txt = (v: any, fb = '') => (isTodo(v) || v === undefined || v === null || v === '' ? fb : names(String(v)));
const tt = (key: string, fb: string) => {
  const v = t(key);
  return /^\[.*\]$/.test(v) || isTodo(v) ? fb : v;
};

export async function runInvestigation(id: string): Promise<string | null> {
  const inv = C.investigations[id];
  if (!inv) {
    console.warn('[조사] investigations 폴더에 없는 id:', id);
    return null;
  }
  playBgm(inv.bgm && !isTodo(inv.bgm) ? inv.bgm : cfg('investigation.bgm', 'mansion'));
  const roomKey = `inv_room_${id}`;
  if (!S.vars[`inv_intro_${id}`]) {
    S.vars[`inv_intro_${id}`] = true;
    await game.sayLines(inv.intro);
    await game.tutorial('investigation');
  }
  let room: string = S.vars[roomKey] ?? inv.start_room;
  await enterRoom(inv, room);

  const root = layer('mode');
  try {
    while (true) {
      S.vars[roomKey] = room;
      dlg.showBox(false);
      const action = await waitFor<Action>((resolve) => {
        render(root, id, inv, room, resolve);
        return () => clear(root);
      });

      if (action.type === 'spot') {
        await useSpot(inv, `${id}/${room}`, action.spot);
      } else if (action.type === 'person') {
        await talkTo(action.person);
      } else if (action.type === 'door') {
        const target = C.rooms[action.to];
        if (target?.locked_until && !S.flags[target.locked_until]) {
          await game.sayLines(target.locked_text?.length ? target.locked_text : [t('investigation.locked_door')]);
          continue;
        }
        const kind = action.kind ?? exitKind(room, action.to);
        await scene.travel(kind, action.rect);
        room = action.to;
        await enterRoom(inv, room, kind);
      } else if (action.type === 'photo') {
        takePhoto(inv, room);
        await game.tutorial('camera');
      } else if (action.type === 'compare') {
        await game.tutorial('compare');
        await compareView(inv, room);
        scene.setBg(roomBg(inv, room), bgChain(room));
      } else if (action.type === 'finish') {
        const missing = (inv.required ?? []).filter((c) => !S.evidence.includes(c));
        if (missing.length > 0) {
          await game.sayLines([t('investigation.not_done')]);
          continue;
        }
        await game.sayLines(inv.outro);
        break;
      }
    }
  } finally {
    clear(root);
    scene.hideAll();
  }
  setFlag(`investigated_${id}`);
  delete S.vars[roomKey];
  return inv.on_complete && !isTodo(inv.on_complete) ? inv.on_complete : null;
}

function roomBg(inv: InvestigationDef, roomId: string) {
  return inv.bgs?.[roomId] ?? C.rooms[roomId]?.bg ?? roomId;
}

/** 지금 이 방에 있는 사람 (시간대·조건·사라짐·갇힘 반영) */
function peopleIn(inv: InvestigationDef, roomId: string): SpotPerson[] {
  return (inv.spots?.[roomId]?.people ?? []).filter((p) => {
    if (S.vanished.includes(p.who) || S.confined.includes(p.who)) return false;
    if (p.needs && !S.flags[p.needs]) return false;
    if (p.time && !asArray(p.time).includes(S.time)) return false;
    return true;
  });
}

/** 두 방 사이 이동 연출: 배경 속 출구에 적힌 kind, 없으면 페이드 */
function exitKind(from: string, to: string) {
  return C.rooms[from]?.exits?.find((e) => e.to === to)?.kind ?? 'fade';
}

async function enterRoom(inv: InvestigationDef, roomId: string, kind?: string) {
  const room = C.rooms[roomId];
  if (!room) {
    console.warn('[조사] locations.yaml 에 없는 방:', roomId);
    if (kind) await scene.arrive(kind);
    return;
  }
  scene.hideAll();
  scene.setBg(roomBg(inv, roomId), bgChain(roomId));
  setAmbient(room.ambient ?? cfg('investigation.ambient', 'dust'));
  for (const p of peopleIn(inv, roomId)) scene.showChar(p.who, p.emotion, p.pos);
  if (kind) await scene.arrive(kind);
  if (!S.visitedRooms.includes(roomId)) {
    S.visitedRooms.push(roomId);
    await game.sayLines(room.first_enter);
  }
}

function roomName(id: string) {
  const n = C.rooms[id]?.name;
  return !n || isTodo(n) ? id : names(n);
}

function visibleSpots(list: Hotspot[] | undefined) {
  return (list ?? []).filter((sp) => (!sp.needs || S.flags[sp.needs] || S.evidence.includes(sp.needs) || S.items.includes(sp.needs)) && !(sp.hide_if && S.flags[sp.hide_if]));
}

function spotButton(sp: Hotspot, checked: boolean, onclick: () => void) {
  const [x, y, w, hh] = sp.rect ?? [0, 0, 10, 10];
  const label = isTodo(sp.label) ? sp.id : names(sp.label);
  const mark = sp.use && !S.flags[sp.use.flag] ? '🔒' : sp.lock && !S.flags[sp.lock.flag] ? '🔒' : sp.closeup ? '🔍' : '';
  return h(`button.hotspot${checked ? '.checked' : ''}`, {
    style: { left: x + '%', top: y + '%', width: w + '%', height: hh + '%' },
    title: label,
    onclick,
  }, h('span.hotspot-label', mark ? `${mark} ${label}` : label), checked ? h('span.hotspot-check', t('investigation.checked')) : null);
}

function render(root: HTMLElement, invId: string, inv: InvestigationDef, roomId: string, resolve: (a: Action) => void) {
  clear(root);
  const room = C.rooms[roomId];
  const wrap = h('div.inv');

  for (const sp of visibleSpots(inv.spots?.[roomId]?.hotspots)) {
    const checked = S.checkedSpots.includes(`${invId}/${roomId}/${sp.id}`);
    wrap.appendChild(spotButton(sp, checked, () => resolve({ type: 'spot', spot: sp })));
  }

  // 배경 속 출구 (문·계단) — 누르면 연출과 함께 이동
  for (const ex of room?.exits ?? []) {
    if (!inv.rooms.includes(ex.to) || (ex.needs && !S.flags[ex.needs])) continue;
    const [x, y, w, hh] = ex.rect ?? [0, 0, 10, 10];
    const label = ex.label ?? (S.visitedRooms.includes(ex.to) ? roomName(ex.to) : t('investigation.unknown_room'));
    const icon = ex.kind === 'stairs_up' ? '▲' : ex.kind === 'stairs_down' ? '▼' : '➜';
    wrap.appendChild(h('button.hotspot.exit', {
      style: { left: x + '%', top: y + '%', width: w + '%', height: hh + '%' },
      title: label,
      onclick: () => resolve({ type: 'door', to: ex.to, kind: ex.kind ?? 'zoom', rect: ex.rect }),
    }, h('span.hotspot-label', `${icon} ${label}`)));
  }

  // 방에 있는 사람 — 캐릭터 그림을 눌러 대화
  for (const p of peopleIn(inv, roomId)) {
    const el = layer('chars').querySelector(`[data-id="${p.who}"]`) as HTMLElement | null;
    if (el) {
      el.classList.add('clickable');
      el.onclick = () => resolve({ type: 'person', person: p });
    }
  }

  const doors = [...new Set([...(room?.doors ?? []), ...(room?.exits ?? []).map((e) => e.to)])].filter((d) => inv.rooms.includes(d));
  const doorBtn = (d: string) =>
    h('button.btn.inv-door', { onclick: () => resolve({ type: 'door', to: d }) }, '→ ' + (S.visitedRooms.includes(d) ? roomName(d) : t('investigation.unknown_room')));
  // 문이 많으면 "이동 ▾" 버튼 하나로 묶어 목록을 펼친다
  const doorButtons = () => {
    if (doors.length <= 3) return doors.map(doorBtn);
    const pop = h('div.inv-door-pop', ...doors.map(doorBtn));
    const btn = h('button.btn.inv-move', { onclick: (e: Event) => { e.stopPropagation(); pop.classList.toggle('open'); } }, `${tt('investigation.move', '이동')} ▾`);
    return [h('div.inv-move-wrap', btn, pop)];
  };
  const oldPhoto = S.photos.some((p) => p.room === roomId && (p.day !== S.day || p.time !== S.time || p.bg !== roomBg(inv, roomId)));
  const nav = h(
    'div.inv-nav',
    h('div.inv-room', roomName(roomId)),
    ...doorButtons(),
    h('button.btn', { onclick: () => openMap(inv, roomId, (to) => resolve({ type: 'door', to })) }, t('investigation.open_map')),
    cfg('camera.enabled', true) ? h('button.btn', { onclick: () => resolve({ type: 'photo' }) }, tt('investigation.photo', '사진 찍기')) : null,
    oldPhoto && inv.diffs?.[roomId]?.length ? h('button.btn.inv-compare', { onclick: () => resolve({ type: 'compare' }) }, tt('investigation.compare', '사진과 비교')) : null,
    h('button.btn.inv-finish', { onclick: () => resolve({ type: 'finish' }) }, t('investigation.finish')),
  );

  const required = inv.required ?? [];
  const found = required.filter((c) => S.evidence.includes(c)).length;
  const header = h('div.inv-header', h('span', isTodo(inv.title) ? names('%investigation%') : names(inv.title)), required.length ? h('span.inv-count', `${found} / ${required.length}`) : null);

  wrap.append(header, nav);
  root.appendChild(wrap);
}

/** 대체 배경 목록: 이 방의 bg_fallback → 그 배경을 쓰는 방의 bg_fallback → … (마지막엔 복도) */
function bgChain(roomId: string): string[] {
  const out: string[] = [];
  let fb = C.rooms[roomId]?.bg_fallback;
  while (fb && !out.includes(fb)) {
    out.push(fb);
    const owner = Object.values(C.rooms).find((r) => r.bg === fb);
    fb = owner?.bg_fallback;
  }
  if (!out.includes('corridor')) out.push('corridor');
  return out;
}

// ═══ 조사 지점 ═══════════════════════════════════════════════

async function useSpot(inv: InvestigationDef, path: string, sp: Hotspot) {
  const key = `${path}/${sp.id}`;
  const first = !S.checkedSpots.includes(key);
  if (first) S.checkedSpots.push(key);
  if (sp.use) return doUse(inv, path, sp.use);
  if (sp.lock) return doLock(inv, path, sp.lock);
  if (sp.knot) await game.runKnot(sp.knot);
  else await game.sayLines(first || !sp.again ? sp.lines : sp.again);
  if (sp.clue && !isTodo(sp.clue)) giveClue(sp.clue);
  if (sp.item && !isTodo(sp.item) && !S.items.includes(sp.item) && !S.vars[`took_${key}`]) {
    S.vars[`took_${key}`] = true;
    getItem(sp.item);
    await game.tutorial('items');
  }
  if (sp.flag) setFlag(sp.flag);
  if (sp.closeup) await openCloseup(inv, path, sp.closeup);
}

function getItem(id: string) {
  giveItem(id); // 알림은 hud.ts 에서
}

async function afterSolve(inv: InvestigationDef, path: string, d: { clue?: string; give_item?: string; closeup?: string }) {
  if (d.clue && !isTodo(d.clue)) giveClue(d.clue);
  if (d.give_item && !isTodo(d.give_item)) getItem(d.give_item);
  if (d.closeup) await openCloseup(inv, path, d.closeup);
}

/** 아이템을 써야 하는 곳 */
async function doUse(inv: InvestigationDef, path: string, u: UseDef) {
  if (S.flags[u.flag]) {
    await game.sayLines(u.done ?? u.success);
    if (u.closeup) await openCloseup(inv, path, u.closeup);
    return;
  }
  await game.sayLines(u.before);
  await game.tutorial('use_item');
  if (!S.items.length) {
    await game.sayLines([tt('investigation.no_items', '쓸 수 있는 물건이 없다.')]);
    return;
  }
  const picked = await pickThing(tt('investigation.use_title', '무엇을 쓸까?'), ['item']);
  if (!picked) return;
  if (picked.id !== u.item) {
    await game.sayLines(u.wrong?.length ? u.wrong : [tt('investigation.use_wrong', '…이건 아닌 것 같다.')]);
    return;
  }
  setFlag(u.flag);
  if (u.consume !== false) loseItem(u.item);
  await game.sayLines(u.success);
  await afterSolve(inv, path, u);
}

/** 번호 자물쇠 · 순서 맞추기 */
async function doLock(inv: InvestigationDef, path: string, l: LockDef) {
  if (S.flags[l.flag]) {
    await game.sayLines(l.done ?? l.success);
    if (l.closeup) await openCloseup(inv, path, l.closeup);
    return;
  }
  await game.sayLines(l.before);
  await game.tutorial('lock');
  const answer = asArray(l.answer as any).map(String);
  const input = await lockUi(l);
  if (input === null) return;
  const ok = l.type === 'number' ? input.join('') === answer.join('') : input.join('|') === answer.join('|');
  if (!ok) {
    await game.sayLines(l.wrong?.length ? l.wrong : [tt('investigation.lock_wrong', '철컥. 열리지 않는다.')]);
    return;
  }
  setFlag(l.flag);
  await game.sayLines(l.success);
  await afterSolve(inv, path, l);
}

function lockUi(l: LockDef): Promise<string[] | null> {
  return waitFor<string[] | null>((resolve) => {
    const m = openModal(txt(l.title, l.type === 'number' ? tt('investigation.lock_number', '번호 자물쇠') : tt('investigation.lock_sequence', '순서 맞추기')), 'lock');
    const body = m.body;
    if (l.hint && !isTodo(l.hint)) body.appendChild(h('p.lock-hint', names(l.hint)));
    if (l.type === 'number') {
      const len = String(asArray(l.answer as any).join('')).length;
      const digits = Array.from({ length: len }, () => 0);
      const row = h('div.lock-dials');
      digits.forEach((_, i) => {
        const val = h('div.dial-val', '0');
        const set = (d: number) => { digits[i] = (digits[i] + d + 10) % 10; val.textContent = String(digits[i]); };
        row.appendChild(h('div.dial', h('button', { onclick: () => set(1) }, '▲'), val, h('button', { onclick: () => set(-1) }, '▼')));
      });
      body.append(row, h('div.lock-tools', h('button.btn', { onclick: () => resolve(null) }, '그만두기'), h('button.btn.lock-ok', { onclick: () => resolve(digits.map(String)) }, tt('investigation.lock_try', '열어 본다'))));
    } else {
      const picked: string[] = [];
      const shown = h('div.seq-shown');
      const draw = () => {
        clear(shown);
        const n = asArray(l.answer as any).length;
        for (let i = 0; i < n; i++) shown.appendChild(h(`div.seq-slot${picked[i] ? '.filled' : ''}`, picked[i] ?? ''));
      };
      draw();
      const btns = h('div.seq-btns', ...(l.choices ?? []).map((c) => h('button.btn', { onclick: () => { if (picked.length < asArray(l.answer as any).length) { picked.push(names(c)); draw(); } } }, names(c))));
      body.append(shown, btns, h('div.lock-tools',
        h('button.btn', { onclick: () => resolve(null) }, '그만두기'),
        h('button.btn', { onclick: () => { picked.length = 0; draw(); } }, '처음부터'),
        h('button.btn.lock-ok', { onclick: () => resolve([...picked]) }, tt('investigation.lock_try', '열어 본다'))));
    }
    m.closed.then(() => resolve(null));
    return () => m.close();
  });
}

// ═══ 클로즈업 ═══════════════════════════════════════════════

async function openCloseup(inv: InvestigationDef, path: string, id: string) {
  const cu: CloseupDef | undefined = inv.closeups?.[id];
  if (!cu) {
    console.warn('[조사] closeups 에 없는 id:', id);
    return;
  }
  await game.tutorial('closeup');
  const root = layer('mode');
  const enterKey = `cu_${path}/${id}`;
  const subPath = `${path}/${id}`;
  const draw = (resolve: (a: { spot?: Hotspot; back?: true }) => void) => {
      clear(root);
      const box = h('div.closeup-box');
      if (cu.image && !isTodo(cu.image)) {
        const img = h('img.closeup-img', { src: asset(`closeup/${cu.image}${/\.\w{3,4}$/.test(cu.image) ? '' : '.jpg'}`) }) as HTMLImageElement;
        img.onerror = () => img.replaceWith(h('div.closeup-noimg', txt(cu.text, txt(cu.title, id))));
        box.appendChild(img);
      } else {
        box.appendChild(h('div.closeup-noimg', txt(cu.text, txt(cu.title, id))));
      }
      for (const sp of visibleSpots(cu.hotspots)) {
        box.appendChild(spotButton(sp, S.checkedSpots.includes(`${subPath}/${sp.id}`), () => resolve({ spot: sp })));
      }
      root.appendChild(
        h('div.closeup',
          h('div.closeup-title', txt(cu.title, '')),
          box,
          cu.image && cu.text && !isTodo(cu.text) ? h('div.closeup-text', names(cu.text)) : null,
          h('button.btn.closeup-back', { onclick: () => resolve({ back: true }) }, tt('investigation.back', '← 돌아가기'))),
      );
  };
  // 처음 들어갈 때: 그림을 보여 준 채로 대사
  if (!S.vars[enterKey]) {
    S.vars[enterKey] = true;
    if (cu.enter?.length) {
      draw(() => {});
      await game.sayLines(cu.enter);
    }
  }
  while (true) {
    dlg.showBox(false);
    const act = await waitFor<{ spot?: Hotspot; back?: true }>((resolve) => {
      draw(resolve);
      return () => clear(root);
    });
    if (act.back) break;
    if (act.spot) await useSpot(inv, subPath, act.spot);
  }
  clear(root);
}

// ═══ 사람과 대화 ═════════════════════════════════════════════

function topicOpen(p: SpotPerson, tp: TopicDef) {
  if (tp.needs && !(S.flags[tp.needs] || S.evidence.includes(tp.needs) || S.items.includes(tp.needs))) return false;
  if (tp.affinity !== undefined && (S.affinity[p.who] ?? 0) < tp.affinity) return false;
  return true;
}

async function talkTo(p: SpotPerson) {
  const topics = p.topics ?? [];
  if (!topics.length && !p.present) {
    if (p.knot) await game.runKnot(p.knot);
    else await game.sayLines(p.lines?.map((l) => (/^[^:]{1,20}:/.test(l) ? l : `${charName(p.who)}: ${l}`)));
    return;
  }
  await game.tutorial('talk');
  if (p.lines?.length && !S.vars[`greet_${p.who}_${S.day}_${S.time}`]) {
    S.vars[`greet_${p.who}_${S.day}_${S.time}`] = true;
    await game.sayLines(p.lines.map((l) => (/^[^:]{1,20}:/.test(l) ? l : `${charName(p.who)}: ${l}`)));
  }
  while (true) {
    const open = topics.filter((tp) => topicOpen(p, tp));
    const items = open.map((tp) => ({ text: `${S.topicsSeen.includes(`${p.who}/${tp.id}`) ? '✓ ' : ''}${txt(tp.label, tp.id)}` }));
    items.push({ text: tt('investigation.show', '무언가 보여 준다') });
    items.push({ text: tt('investigation.leave', '대화를 마친다') });
    const idx = await dlg.choose(items);
    if (idx === items.length - 1) return;
    if (idx === items.length - 2) {
      await game.tutorial('present');
      await presentTo(p);
      continue;
    }
    const tp = open[idx];
    S.topicsSeen.includes(`${p.who}/${tp.id}`) || S.topicsSeen.push(`${p.who}/${tp.id}`);
    if (tp.knot) await game.runKnot(tp.knot);
    else await game.sayLines(asArray(tp.lines).map((l) => (/^[^:]{1,20}:/.test(l) || /^[(（]/.test(l) ? l : `${charName(p.who)}: ${l}`)));
    if (tp.clue && !isTodo(tp.clue)) giveClue(tp.clue);
    if (tp.habit) {
      learnHabit(`${p.who}.${tp.habit}`); // 알림은 hud.ts 에서
      await game.tutorial('habits');
    }
    asArray(tp.effects).forEach(applyEffect);
  }
}

async function presentTo(p: SpotPerson) {
  const picked = await pickThing(tt('investigation.show_title', '무엇을 보여 줄까?'), ['evidence', 'item', 'photo']);
  if (!picked) return;
  // 사진은 "photo:방id" 로 반응을 적는다 (예: photo:dining)
  const key = picked.kind === 'photo' ? `photo:${S.photos.find((x) => x.id === picked.id)?.room}` : picked.id;
  const res = p.present?.[key];
  if (typeof res === 'string' && res.startsWith('knot:')) {
    await game.runKnot(res.slice(5).trim());
    return;
  }
  if (res) {
    await game.sayLines(asArray(res as any).map((l: string) => (/^[^:]{1,20}:/.test(l) ? l : `${charName(p.who)}: ${l}`)));
    return;
  }
  const fallback = pick(asArray(C.characters[p.who]?.reactions?.present_unknown as any)) as string | undefined;
  const line = fallback && !isTodo(fallback) ? fallback : tt('investigation.show_unknown', '…그게 뭔데?');
  await game.sayLines([/^[(（]/.test(line) ? `${charName(p.who)}${line}` : `${charName(p.who)}: ${line}`]);
}

// ═══ 휴대폰 카메라 ═══════════════════════════════════════════

function takePhoto(inv: InvestigationDef, roomId: string) {
  const bg = roomBg(inv, roomId);
  const same = S.photos.find((p) => p.room === roomId && p.day === S.day && p.time === S.time && p.bg === bg);
  if (same) {
    toast(tt('toast.photo_same', '이미 지금 모습을 찍어 두었다.'));
    return;
  }
  const photo = { id: `ph${Date.now().toString(36)}`, room: roomId, bg, chapter: S.chapter, day: S.day, time: S.time, taken: Date.now() };
  S.photos.push(photo);
  events.emit('photo', { id: photo.id });
  toast(tt('toast.photo_taken', '찰칵. {room}을(를) 찍었다.').replace('{room}', roomName(roomId)), 'clue');
}

const TIME_NAME: Record<string, string> = { morning: '아침', day: '낮', night: '밤' };

/** 예전 사진(왼쪽)과 지금 방(오른쪽)을 나란히 놓고 달라진 곳 찾기 */
async function compareView(inv: InvestigationDef, roomId: string) {
  const olds = S.photos.filter((p) => p.room === roomId && (p.day !== S.day || p.time !== S.time || p.bg !== roomBg(inv, roomId)));
  const old = olds[olds.length - 1];
  if (!old) return;
  const diffs = inv.diffs?.[roomId] ?? [];
  const root = layer('mode');
  while (true) {
    const act = await waitFor<{ diff?: (typeof diffs)[number]; back?: true }>((resolve) => {
      clear(root);
      const left = h('div.cmp-pane', h('img', { src: asset(`bg/${old.bg}.jpg`) }), h('div.cmp-cap', `${old.day}일째 ${TIME_NAME[old.time] ?? old.time}`));
      const right = h('div.cmp-pane', h('img', { src: asset(`bg/${roomBg(inv, roomId)}.jpg`) }), h('div.cmp-cap', tt('investigation.now', '지금')));
      for (const d of diffs) {
        const [x, y, w, hh] = d.rect;
        const got = S.diffsFound.includes(`${roomId}/${d.id}`);
        right.appendChild(h(`button.cmp-spot${got ? '.found' : ''}`, { style: { left: x + '%', top: y + '%', width: w + '%', height: hh + '%' }, onclick: () => !got && resolve({ diff: d }) }));
      }
      const found = diffs.filter((d) => S.diffsFound.includes(`${roomId}/${d.id}`)).length;
      root.appendChild(h('div.compare',
        h('div.cmp-head', h('b', tt('investigation.compare_title', '달라진 곳 찾기')), h('span', `${found} / ${diffs.length}`)),
        h('div.cmp-row', left, right),
        h('button.btn.closeup-back', { onclick: () => resolve({ back: true }) }, tt('investigation.back', '← 돌아가기'))));
      return () => clear(root);
    });
    if (act.back) break;
    if (act.diff) {
      S.diffsFound.push(`${roomId}/${act.diff.id}`);
      await game.sayLines(act.diff.lines?.length ? act.diff.lines : [tt('investigation.diff_found', '…여기, 전과 다르다.')]);
      if (act.diff.clue && !isTodo(act.diff.clue)) giveClue(act.diff.clue);
    }
  }
}

// ═══ 저택 지도 (층별) ═══════════════════════════════════════

async function openMap(inv: InvestigationDef, current: string, go: (to: string) => void) {
  await game.tutorial('map');
  const m = openModal(t('investigation.open_map'), 'map');
  const floors = [...new Set(inv.rooms.map((r) => String(C.rooms[r]?.floor ?? '1')))];
  let floor = String(C.rooms[current]?.floor ?? floors[0]);
  const bar = h('div.nb-tabs.map-floors');
  const map = h('div.map');
  const FLOOR_NAME = (f: string) => txt(C.ui.investigation?.floors?.[f], /^-?\d+$/.test(f) ? (Number(f) < 0 ? `지하 ${-Number(f)}층` : `${f}층`) : f);
  const draw = () => {
    clear(bar);
    if (floors.length > 1) for (const f of floors) bar.appendChild(h(`button.nb-tab${f === floor ? '.on' : ''}`, { onclick: () => { floor = f; draw(); } }, FLOOR_NAME(f)));
    clear(map);
    const img = h('img.map-img', { src: asset(`ui/map_${floor}.png`) }) as HTMLImageElement;
    img.onerror = () => {
      img.onerror = () => img.remove();
      img.src = asset('ui/map.png');
    };
    map.appendChild(img);
    for (const rid of inv.rooms) {
      const r = C.rooms[rid];
      if (!r || String(r.floor ?? '1') !== floor) continue;
      const visited = S.visitedRooms.includes(rid);
      const [x, y] = r.map_pos ?? [50, 50];
      map.appendChild(
        h(`button.map-room${rid === current ? '.current' : ''}${visited ? '' : '.unknown'}`, {
          style: { left: x + '%', top: y + '%' },
          disabled: !visited || rid === current,
          onclick: () => {
            m.close();
            go(rid);
          },
        }, visited ? roomName(rid) : t('investigation.unknown_room')),
      );
    }
  };
  draw();
  m.body.append(bar, map);
}
