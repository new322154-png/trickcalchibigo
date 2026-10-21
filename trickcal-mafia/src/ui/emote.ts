/**
 * 감정표현: 버튼 줄 + 캐릭터 머리 위에 뿅 뜨는 그림.
 * 대기실(아무 때나) · 게임(광장 · 결선 변론 · 결선 투표 · 판결 때 살아 있는 사람만).
 * 도배 방지로 10초에 한 번 (서버도 같은 규칙으로 막는다).
 */
import { EMOTES, EMOTE_GAP } from '../../shared/protocol';
import { emo } from './emoji';
import { h } from './dom';
import { sfx } from './sfx';

export interface EmoteBar { el: HTMLElement; enable(on: boolean): void; destroy(): void }

export function emoteBar(send: (e: string) => void): EmoteBar {
  let readyAt = 0, timer = 0;
  const cd = h('div.eb-cd');
  const btns = EMOTES.map((e) => {
    const b = h('button.eb-btn', { title: '감정표현', onclick: () => {
      if (Date.now() < readyAt || b.disabled) return;
      send(e); sfx('click');
      readyAt = Date.now() + EMOTE_GAP;
      tick();
    } }) as HTMLButtonElement;
    b.appendChild(emo(e));
    return b;
  });
  const el = h('div.emote-bar', ...btns, cd);
  let enabled = true;
  const tick = () => {
    clearInterval(timer);
    const upd = () => {
      const left = Math.max(0, readyAt - Date.now());
      el.classList.toggle('cool', left > 0);
      cd.textContent = left > 0 ? `${Math.ceil(left / 1000)}` : '';
      el.style.setProperty('--cd', String(left / EMOTE_GAP));
      for (const b of btns) b.disabled = !enabled || left > 0;
      if (!left) clearInterval(timer);
    };
    upd();
    timer = window.setInterval(upd, 200);
  };
  return {
    el,
    enable(on) { enabled = on; el.classList.toggle('hidden', !on); for (const b of btns) b.disabled = !on || Date.now() < readyAt; },
    destroy() { clearInterval(timer); el.remove(); },
  };
}

/** 캐릭터 위에 감정표현 하나 띄우기 (2.6초) */
export function popEmote(host: HTMLElement, e: string) {
  host.querySelector(':scope > .emo-pop')?.remove();
  const p = h('div.emo-pop');
  p.appendChild(emo(e));
  host.appendChild(p);
  setTimeout(() => p.remove(), 2600);
}

/** 재판장 관객 반응: 화면 아래에서 위로 떠오르는 그림 (누가 보냈는지는 안 보임) */
export function floatEmote(host: HTMLElement, e: string) {
  const f = h('div.emo-float', { style: `--x:${(10 + Math.random() * 80).toFixed(1)}%; --dx:${(Math.random() * 60 - 30).toFixed(0)}px` });
  f.appendChild(emo(e));
  host.appendChild(f);
  setTimeout(() => f.remove(), 2800);
}
