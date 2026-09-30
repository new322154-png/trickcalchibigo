/**
 * 지목 — "오늘 저택이 변장한 사람은 누구인가?"
 * 대본에서  #accuse  태그를 만나면 열린다 (대사가 끝난 뒤).
 * 맞히면 오늘은 아무도 사라지지 않고, days.yaml 의 on_found 로 이어진다.
 * 틀리면 on_missed 로 이어지고, #next_day 때 vanish_if_missed 가 사라진다.
 */
import { C, cfg, charColor, charName, names, t } from '../engine/content';
import { game } from '../engine/game';
import { S, impostorToday, markFound, todayDef } from '../engine/state';
import { isTodo, waitFor } from '../engine/util';
import { asset, clear, h, layer } from '../ui/dom';
import * as dlg from '../ui/dialogue';
import { confirm } from '../ui/modal';
import { glitch } from '../ui/effects';

const tt = (key: string, fb: string) => {
  const v = t(key);
  return /^\[.*\]$/.test(v) || isTodo(v) ? fb : v;
};

export async function runAccuse(): Promise<string | null> {
  const def = todayDef();
  await game.tutorial('accuse');
  if (S.found.includes(S.day)) return null;
  const members = Object.entries(C.characters).filter(([id, d]) => !d.player && !S.vanished.includes(id) && !S.confined.includes(id));
  const root = layer('mode');
  dlg.showBox(false);
  let picked: string | null = null;
  while (!picked) {
    const who = await waitFor<string | null>((resolve) => {
      clear(root);
      const grid = h('div.acc-grid');
      for (const [id, d] of members) {
        const img = h('img', { src: asset(`characters/${id}/icon.png`) }) as HTMLImageElement;
        img.onerror = () => img.replaceWith(h('span', d.name.slice(0, 1)));
        const card = h('button.acc-card', { onclick: () => resolve(id) }, h('div.acc-face', img), h('b', d.name));
        card.style.setProperty('--c', charColor(id));
        grid.appendChild(card);
      }
      root.appendChild(h('div.accuse',
        h('div.acc-day', `DAY ${S.day}`),
        h('h2.acc-title', tt('accuse.title', '오늘, 이 저택이 흉내 내고 있는 사람은?')),
        h('p.acc-guide', tt('accuse.guide', '습관과 어긋난 말, 사진 속 달라진 것들을 떠올려 보세요. 기회는 한 번뿐입니다.')),
        grid));
      return () => {};
    });
    if (!who) { clear(root); return null; }
    if (await confirm('', tt('accuse.confirm', `${charName(who)}을(를) 지목할까요?`).replace('{name}', charName(who)))) picked = who;
  }
  clear(root);
  S.accusedToday++;
  const ok = picked === impostorToday();
  if (ok) {
    markFound();
    await glitch(900);
  }
  const next = ok ? def?.on_found : def?.on_missed;
  return next && !isTodo(next) ? next : null;
}

/** 지목 결과 확인용 (대본에서 쓰지 않아도 됨) */
export function accuseResultText(ok: boolean) {
  return ok ? names(tt('accuse.found', '찾았다.')) : names(tt('accuse.missed', '…아니었다.'));
}

export const ACCUSE_CHANCES = () => cfg('accuse.chances', 1);
