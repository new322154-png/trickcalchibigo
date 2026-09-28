/**
 * 화면 위에 늘 떠 있는 것들: 인원 체크(일행 초상화), 교주 의심도 게이지, 새 메시지 표시.
 * 게임 상태 이벤트를 듣고 알림(토스트)도 여기서 띄운다.
 */
import { C, cfg, charName, t } from '../engine/content';
import { events } from '../engine/events';
import { S } from '../engine/state';
import { asset, clear, h, layer } from './dom';
import { toast } from './modal';

let partyEl: HTMLElement;
let suspEl: HTMLElement;
let phoneBadge: HTMLElement;

export function buildHud(handlers: { onMenu: () => void; onNotebook: () => void; onPhone: () => void }) {
  const root = clear(layer('hud'));
  const onPhone = handlers.onPhone;
  // 오른쪽 위 버튼 (조사 화면처럼 대화창이 없을 때도 메뉴를 열 수 있게)
  const corner = h(
    'div.hud-corner',
    h('button.hud-btn', { onclick: handlers.onNotebook, title: C.game.names.notebook }, '📓'),
    h('button.hud-btn', { onclick: handlers.onMenu, title: t('menu.settings') }, '⚙'),
  );
  root.appendChild(corner);
  partyEl = h('div.party-bar', { title: C.game.names.party_bar });
  suspEl = h('div.susp-meter', h('span.susp-label', C.game.names.suspicion), h('div.susp-track', h('div.susp-fill')));
  phoneBadge = h('button.phone-badge.hidden', { onclick: onPhone }, '✉');
  root.append(partyEl, suspEl, phoneBadge);
  suspEl.style.display = cfg('suspicion.show_meter', true) ? '' : 'none';
  refreshHud();
}

export function setHudVisible(v: boolean) {
  layer('hud').classList.toggle('hidden', !v);
}

export function refreshHud() {
  if (!partyEl) return;
  clear(partyEl);
  for (const [id, def] of Object.entries(C.characters)) {
    if (def.player) continue;
    const gone = S.vanished.includes(id);
    const img = h('img', { src: asset(`characters/${id}/icon.png`), alt: def.name }) as HTMLImageElement;
    img.onerror = () => img.replaceWith(h('span.party-initial', def.name.slice(0, 1)));
    partyEl.appendChild(h(`div.party-member${gone ? '.gone' : ''}`, { title: def.name }, img));
  }
  const max = cfg('suspicion.max', 10);
  (suspEl.querySelector('.susp-fill') as HTMLElement).style.width = `${(S.suspicion / max) * 100}%`;
  const unread = Object.values(S.phone).some((p) => p.unread);
  phoneBadge.classList.toggle('hidden', !unread);
}

// ── 이벤트 → 알림 ──
events.on('clue', ({ id, update }) => {
  const name = C.evidence[id]?.name ?? id;
  toast(t(update ? 'toast.clue_update' : 'toast.clue_get', { name }), 'clue');
});
events.on('conclusion', ({ id }) => toast(t('toast.conclusion_get', { name: C.conclusions[id]?.name ?? id }), 'clue'));
events.on('affinity', ({ who, delta }) => {
  if (!cfg('affinity.show_change_toast', true) || delta === 0) return;
  toast(t(delta > 0 ? 'toast.affinity_up' : 'toast.affinity_down', { name: charName(who) }), delta > 0 ? 'up' : 'down');
});
events.on('suspicion', ({ delta }) => {
  refreshHud();
  if (delta === 0) return;
  toast(t(delta > 0 ? 'toast.suspicion_up' : 'toast.suspicion_down'), 'warn');
});
events.on('vanish', ({ who }) => {
  refreshHud();
  toast(t('toast.member_vanished', { name: charName(who) }), 'warn');
});
events.on('return', ({ who }) => {
  refreshHud();
  toast(t('toast.member_returned', { name: charName(who) }));
});
events.on('phone', ({ thread, notify }) => {
  refreshHud();
  if (notify) {
    const th = C.threads[thread];
    const who = th ? (C.groups[th.with]?.name ?? charName(th.with)) : thread;
    toast(t('toast.new_message', { name: who }), 'phone');
  }
});
events.on('stateLoaded', () => refreshHud());
