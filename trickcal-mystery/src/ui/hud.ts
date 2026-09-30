/**
 * 화면 위에 늘 떠 있는 것들: 인원 체크(일행 초상화), 교주 의심도 게이지,
 * 오른쪽 위 버튼 줄(오토·스킵·지난 대화·수첩·휴대폰·설정, 새 메시지 표시).
 * 게임 상태 이벤트를 듣고 알림(토스트)도 여기서 띄운다.
 */
import { C, cfg, charName, t } from '../engine/content';
import { events } from '../engine/events';
import { S } from '../engine/state';
import { asset, clear, h, layer } from './dom';
import { toast } from './modal';
import { toggleAuto, toggleSkip } from './dialogue';
import { sfx } from './sfx';

let partyEl: HTMLElement;
let suspEl: HTMLElement;
let phoneBadge: HTMLElement;
let clockEl: HTMLElement;

export function buildHud(handlers: { onMenu: () => void; onNotebook: () => void; onPhone: () => void; onBacklog: () => void }) {
  const root = clear(layer('hud'));
  const btn = (label: string, onclick: () => void, extra = '') =>
    h(`button.hud-pill${extra}`, { onclick: (e: Event) => { e.stopPropagation(); onclick(); } }, label);
  // 오른쪽 위 버튼 줄. 오토·스킵은 대화창이 떠 있을 때만 보인다 (dialogue.showBox)
  const auto = btn(t('menu.auto'), () => toggleAuto(), '.hud-dlg-only.hidden');
  auto.dataset.k = 'auto';
  const skip = btn(t('menu.skip'), () => toggleSkip(), '.hud-dlg-only.hidden');
  skip.dataset.k = 'skip';
  const phone = btn(t('menu.phone'), handlers.onPhone);
  phoneBadge = h('span.hud-dot.hidden');
  phone.appendChild(phoneBadge);
  const corner = h(
    'div.hud-corner',
    auto,
    skip,
    btn(t('menu.backlog'), handlers.onBacklog),
    btn(t('menu.notebook'), handlers.onNotebook),
    phone,
    btn(t('menu.settings'), handlers.onMenu),
  );
  root.appendChild(corner);
  partyEl = h('div.party-bar', { title: C.game.names.party_bar });
  suspEl = h('div.susp-meter', h('span.susp-label', C.game.names.suspicion), h('div.susp-track', h('div.susp-fill')));
  clockEl = h('div.hud-clock');
  root.append(partyEl, suspEl, clockEl);
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
    const locked = S.confined.includes(id);
    const img = h('img', { src: asset(`characters/${id}/icon.png`), alt: def.name }) as HTMLImageElement;
    img.onerror = () => img.replaceWith(h('span.party-initial', def.name.slice(0, 1)));
    partyEl.appendChild(h(`div.party-member${gone ? '.gone' : ''}${locked ? '.locked' : ''}`, { title: def.name }, img, locked ? h('span.party-lock', '🔒') : null));
  }
  const max = cfg('suspicion.max', 10);
  (suspEl.querySelector('.susp-fill') as HTMLElement).style.width = `${(S.suspicion / max) * 100}%`;
  // 며칠째 · 시간대
  const TIME: Record<string, string> = { morning: t('time.morning').replace(/^\[.*\]$/, '아침'), day: t('time.day').replace(/^\[.*\]$/, '낮'), night: t('time.night').replace(/^\[.*\]$/, '밤') };
  clockEl.textContent = `${S.day}일째 · ${TIME[S.time] ?? S.time}`;
  const unread = Object.values(S.phone).some((p) => p.unread);
  phoneBadge.classList.toggle('hidden', !unread);
}

// ── 이벤트 → 알림 ──
events.on('clue', ({ id, update }) => {
  sfx('clue');
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
events.on('time', () => refreshHud());

const tx = (key: string, fb: string, vars: Record<string, string> = {}) => {
  let v = t(key);
  if (/^\[.*\]$/.test(v) || v === 'TODO') v = fb;
  for (const [k, val] of Object.entries(vars)) v = v.replace(`{${k}}`, val);
  return v;
};
events.on('item', ({ id, gained }) => {
  if (gained) sfx('item');
  const name = C.items[id]?.name && C.items[id].name !== 'TODO' ? C.items[id].name : id;
  toast(gained ? tx('toast.item_get', '{name}을(를) 얻었다.', { name }) : tx('toast.item_used', '{name}을(를) 썼다.', { name }), gained ? 'clue' : '');
});
events.on('confine', ({ who, confined }) => {
  refreshHud();
  toast(confined ? tx('toast.confined', '{name}이(가) 갇혔다.', { name: charName(who) }) : tx('toast.released', '{name}이(가) 풀려났다.', { name: charName(who) }), confined ? 'warn' : 'up');
});
events.on('truth', ({ id }) => {
  sfx('clue');
  const title = C.truths[id]?.title && C.truths[id].title !== 'TODO' ? C.truths[id].title : '';
  toast(tx('toast.truth', '진실 조각을 얻었다{title}', { title: title ? `: ${title}` : '.' }), 'clue');
});
events.on('habit', ({ key }) => {
  const who = key.split('.')[0];
  toast(tx('toast.habit_learned', '{name}의 평소 습관을 하나 알게 됐다.', { name: charName(who) }), 'clue');
});
