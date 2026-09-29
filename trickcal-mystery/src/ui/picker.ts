/**
 * 가진 것 고르기 창 — 증거·아이템·사진 중 하나를 고른다.
 * 아이템 사용, 캐릭터에게 보여 주기에서 쓴다.
 */
import { C, names, t } from '../engine/content';
import { S } from '../engine/state';
import { isTodo, waitFor } from '../engine/util';
import { asset, clear, h } from './dom';
import { openModal } from './modal';

export interface Picked {
  kind: 'item' | 'evidence' | 'photo';
  id: string;
}

const txt = (v: any, fb: string) => (isTodo(v) || !v ? fb : names(String(v)));

export function pickThing(title: string, kinds: Picked['kind'][] = ['item', 'evidence']): Promise<Picked | null> {
  return waitFor<Picked | null>((resolve) => {
    const m = openModal(title, 'picker');
    const tabs = kinds.filter((k) => (k === 'item' ? S.items.length : k === 'evidence' ? S.evidence.length : S.photos.length) > 0);
    let tab: Picked['kind'] = tabs[0] ?? kinds[0];
    const bar = h('div.nb-tabs');
    const grid = h('div.pick-grid');
    const label = (k: Picked['kind']) => (k === 'item' ? t('notebook.tab_items').replace(/^\[.*\]$/, '아이템') : k === 'evidence' ? t('notebook.tab_evidence') : '사진');
    const draw = () => {
      clear(bar);
      for (const k of kinds) bar.appendChild(h(`button.nb-tab${k === tab ? '.on' : ''}`, { onclick: () => { tab = k; draw(); } }, label(k)));
      clear(grid);
      const ids = tab === 'item' ? S.items : tab === 'evidence' ? S.evidence : S.photos.map((p) => p.id);
      if (!ids.length) grid.appendChild(h('p.empty', '아직 없습니다.'));
      for (const id of ids) {
        let name = id;
        let img: string | null = null;
        if (tab === 'item') {
          const it = C.items[id];
          name = txt(it?.name, id);
          img = it?.image && !isTodo(it.image) ? asset(`items/${it.image}`) : null;
        } else if (tab === 'evidence') {
          const e = C.evidence[id];
          name = txt(e?.name, id);
          img = e?.image && !isTodo(e.image) ? asset(`evidence/${e.image}`) : null;
        } else {
          const p = S.photos.find((x) => x.id === id)!;
          name = `${txt(C.rooms[p.room]?.name, p.room)} · ${p.day}일째`;
          img = asset(`bg/${p.bg}.jpg`);
        }
        grid.appendChild(
          h('button.pick-card', { onclick: () => resolve({ kind: tab, id }) },
            img ? h('img', { src: img }) : h('span.pick-mark', '✦'),
            h('b', name)),
        );
      }
    };
    draw();
    m.body.append(bar, grid, h('div.pick-tools', h('button.btn', { onclick: () => resolve(null) }, '그만두기')));
    m.closed.then(() => resolve(null));
    return () => m.close();
  });
}
