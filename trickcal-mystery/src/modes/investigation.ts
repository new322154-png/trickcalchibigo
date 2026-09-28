/**
 * 조사 모드 — 방 배경 위의 조사 지점을 누르고, 문으로 이동하고, 지도로 바로 이동한다.
 * 데이터: content/investigations/*.yaml, content/locations.yaml
 */
import { C, names, t } from '../engine/content';
import { game } from '../engine/game';
import { S, giveClue, setFlag } from '../engine/state';
import { isTodo, waitFor } from '../engine/util';
import { clear, h, layer } from '../ui/dom';
import * as dlg from '../ui/dialogue';
import { openModal } from '../ui/modal';
import * as scene from '../ui/scene';
import type { Hotspot, InvestigationDef, SpotPerson } from '../engine/content';

type Action =
  | { type: 'spot'; spot: Hotspot }
  | { type: 'person'; person: SpotPerson }
  | { type: 'door'; to: string }
  | { type: 'finish' };

export async function runInvestigation(id: string): Promise<string | null> {
  const inv = C.investigations[id];
  if (!inv) {
    console.warn('[조사] investigations 폴더에 없는 id:', id);
    return null;
  }
  const roomKey = `inv_room_${id}`;
  if (!S.vars[`inv_intro_${id}`]) {
    S.vars[`inv_intro_${id}`] = true;
    await game.sayLines(inv.intro);
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
        const sp = action.spot;
        const key = `${id}/${room}/${sp.id}`;
        const first = !S.checkedSpots.includes(key);
        if (first) S.checkedSpots.push(key);
        if (sp.knot) await game.runKnot(sp.knot);
        else await game.sayLines(first || !sp.again ? sp.lines : sp.again);
        if (sp.clue && !isTodo(sp.clue)) giveClue(sp.clue);
      } else if (action.type === 'person') {
        const p = action.person;
        if (p.knot) await game.runKnot(p.knot);
        else await game.sayLines(p.lines?.map((l) => (/^[^:]{1,20}:/.test(l) ? l : `${C.characters[p.who]?.name ?? p.who}: ${l}`)));
      } else if (action.type === 'door') {
        const target = C.rooms[action.to];
        if (target?.locked_until && !S.flags[target.locked_until]) {
          await game.sayLines(target.locked_text?.length ? target.locked_text : [t('investigation.locked_door')]);
          continue;
        }
        room = action.to;
        await enterRoom(inv, room);
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

async function enterRoom(inv: InvestigationDef, roomId: string) {
  const room = C.rooms[roomId];
  if (!room) {
    console.warn('[조사] locations.yaml 에 없는 방:', roomId);
    return;
  }
  scene.hideAll();
  scene.setBg(room.bg);
  for (const p of inv.spots?.[roomId]?.people ?? []) {
    if (!S.vanished.includes(p.who)) scene.showChar(p.who, p.emotion, p.pos);
  }
  if (!S.visitedRooms.includes(roomId)) {
    S.visitedRooms.push(roomId);
    await game.sayLines(room.first_enter);
  }
}

function roomName(id: string) {
  const n = C.rooms[id]?.name;
  return !n || isTodo(n) ? id : names(n);
}

function render(root: HTMLElement, invId: string, inv: InvestigationDef, roomId: string, resolve: (a: Action) => void) {
  clear(root);
  const room = C.rooms[roomId];
  const spots = inv.spots?.[roomId];
  const wrap = h('div.inv');

  // 조사 지점
  for (const sp of spots?.hotspots ?? []) {
    if (sp.needs && !S.flags[sp.needs]) continue;
    const [x, y, w, hh] = sp.rect ?? [0, 0, 10, 10];
    const checked = S.checkedSpots.includes(`${invId}/${roomId}/${sp.id}`);
    wrap.appendChild(
      h(`button.hotspot${checked ? '.checked' : ''}`, {
        style: { left: x + '%', top: y + '%', width: w + '%', height: hh + '%' },
        title: isTodo(sp.label) ? sp.id : names(sp.label),
        onclick: () => resolve({ type: 'spot', spot: sp }),
      }, h('span.hotspot-label', isTodo(sp.label) ? sp.id : names(sp.label)), checked ? h('span.hotspot-check', t('investigation.checked')) : null),
    );
  }

  // 방에 있는 사람 — 캐릭터 그림을 눌러 대화
  for (const p of spots?.people ?? []) {
    if (S.vanished.includes(p.who)) continue;
    const el = layer('chars').querySelector(`[data-id="${p.who}"]`) as HTMLElement | null;
    if (el) {
      el.classList.add('clickable');
      el.onclick = () => resolve({ type: 'person', person: p });
    }
  }

  // 아래쪽 이동 막대
  const doors = (room?.doors ?? []).filter((d) => inv.rooms.includes(d));
  const nav = h(
    'div.inv-nav',
    h('div.inv-room', roomName(roomId)),
    ...doors.map((d) => h('button.btn.inv-door', { onclick: () => resolve({ type: 'door', to: d }) }, '→ ' + (S.visitedRooms.includes(d) ? roomName(d) : t('investigation.unknown_room')))),
    h('button.btn', { onclick: () => openMap(inv, roomId, (to) => resolve({ type: 'door', to })) }, t('investigation.open_map')),
    h('button.btn.inv-finish', { onclick: () => resolve({ type: 'finish' }) }, t('investigation.finish')),
  );

  const required = inv.required ?? [];
  const found = required.filter((c) => S.evidence.includes(c)).length;
  const header = h('div.inv-header', h('span', isTodo(inv.title) ? names('%investigation%') : names(inv.title)), required.length ? h('span.inv-count', `${found} / ${required.length}`) : null);

  wrap.append(header, nav);
  root.appendChild(wrap);
}

/** 저택 지도: 한 번 가 본 방은 바로 이동 */
async function openMap(inv: InvestigationDef, current: string, go: (to: string) => void) {
  await game.tutorial('map');
  const m = openModal(t('investigation.open_map'), 'map');
  const map = h('div.map');
  const img = h('img.map-img', { src: './assets/ui/map.png' }) as HTMLImageElement;
  img.onerror = () => img.remove();
  map.appendChild(img);
  for (const rid of inv.rooms) {
    const r = C.rooms[rid];
    if (!r) continue;
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
  m.body.appendChild(map);
}
