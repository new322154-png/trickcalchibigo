/**
 * 싱글 미니게임: 짝 맞추기
 * 뒤집힌 캐릭터 카드 16장(8쌍)의 짝을 찾는다. 시간과 시도 횟수를 잰다.
 */
import { CHARACTERS } from '../../shared/protocol';
import { h, sleep } from '../ui/dom';
import { sfx } from '../ui/sfx';
import { charImg } from '../profile';
import { safeGet, safeSet } from './catch';

export function playMatch(host: HTMLElement, onClose: () => void) {
  const info = h('div.mg-score');
  const grid = h('div.mm-grid');
  const overlay = h('div.mg-overlay',
    h('div.mg-box',
      h('div.mg-head', h('b', '🃏 짝 맞추기'), info, h('button.btn.small', { onclick: () => close() }, '닫기')),
      grid,
      h('div.mg-help', '카드 두 장을 뒤집어 같은 캐릭터를 찾으세요.'),
    ));
  (document.activeElement as HTMLElement | null)?.blur();
  host.appendChild(overlay);
  let timer = 0;
  const close = () => { clearInterval(timer); overlay.remove(); onClose(); };

  function start() {
    clearInterval(timer);
    const chars = [...CHARACTERS].sort(() => Math.random() - 0.5).slice(0, 8);
    const deck = [...chars, ...chars].sort(() => Math.random() - 0.5);
    let open: HTMLElement[] = [];
    let busy = false, found = 0, tries = 0;
    const t0 = Date.now();
    const best = () => Number(safeGet('tm.best.match') ?? 0);
    const render = () => {
      const s = Math.floor((Date.now() - t0) / 1000);
      info.textContent = `시도 ${tries} · ${s}초${best() ? ` · 최고 ${best()}초` : ''}`;
    };
    timer = window.setInterval(render, 500);
    render();
    grid.replaceChildren(...deck.map((c) => {
      const card: HTMLElement = h('button.mm-card', {
        onclick: async () => {
          if (busy || card.classList.contains('open') || card.classList.contains('done')) return;
          card.classList.add('open');
          sfx('click');
          open.push(card);
          if (open.length < 2) return;
          tries++;
          const [a, b] = open;
          open = [];
          if (a.dataset.c === b.dataset.c) {
            a.classList.add('done'); b.classList.add('done');
            sfx('pop');
            if (++found === 8) {
              clearInterval(timer);
              const s = Math.floor((Date.now() - t0) / 1000);
              if (!best() || s < best()) safeSet('tm.best.match', String(s));
              sfx('win');
              await sleep(500);
              grid.append(h('div.mm-done', h('b', `${s}초 · ${tries}번 만에 완성!`), h('button.btn.gold', { onclick: start }, '한 번 더')));
            }
          } else {
            busy = true;
            await sleep(750);
            a.classList.remove('open'); b.classList.remove('open');
            busy = false;
          }
          render();
        },
      }, h('span.mm-back', '?'), h('img.mm-face', { src: charImg(c.id), alt: c.name }));
      card.dataset.c = c.id;
      return card;
    }));
  }
  start();
}
