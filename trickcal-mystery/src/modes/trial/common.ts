/** 재판 페이즈들이 함께 쓰는 것: 발언권, 캡처 목록, 증거 고르기 창 */
import { C, cfg, charName, names, t } from '../../engine/content';
import type { TrialMsg } from '../../engine/content';
import { S } from '../../engine/state';
import { isTodo, pick, waitFor } from '../../engine/util';
import { h } from '../../ui/dom';
import { openModal } from '../../ui/modal';

export interface TrialCtx {
  id: string;
  voice: number;
  voiceMax: number;
  captured: Map<string, TrialMsg>; // "cap:m3" → 메시지
  shownCards: Set<string>; // 여론전에서 보여준 결론 카드
}

export function newCtx(id: string): TrialCtx {
  const max = cfg('trial.voice_max', 5);
  return { id, voice: max, voiceMax: max, captured: new Map(), shownCards: new Set() };
}

export function voiceMeter(ctx: TrialCtx): HTMLElement {
  const pips = Array.from({ length: ctx.voiceMax }, (_, i) => h(`span.voice-pip${i < ctx.voice ? '.on' : ''}`));
  return h('div.voice-meter', h('span.voice-label', t('trial.voice')), ...pips);
}

/** 증거(단서 + 이 재판에서 캡처한 메시지) 고르기. 취소하면 null */
export function chooseEvidence(ctx: TrialCtx, title = t('trial.choose_evidence')): Promise<string | null> {
  return waitFor<string | null>((resolve) => {
    const m = openModal(isTodo(title) ? names('%notebook%') : title, 'cards');
    const list = h('div.card-list');
    for (const id of S.evidence) {
      list.appendChild(h('button.card', { onclick: () => resolve(id) }, h('b', names(C.evidence[id]?.name ?? id)), h('small', names(C.evidence[id]?.desc ?? ''))));
    }
    for (const [cid, msg] of ctx.captured) {
      list.appendChild(h('button.card.captured', { onclick: () => resolve(cid) }, h('b', `${names('%action_capture%')} · ${charName(msg.from)}`), h('small', names(msg.text))));
    }
    m.body.appendChild(list);
    m.closed.then(() => resolve(null));
    return () => m.close();
  });
}

/** 캐릭터 고르기 (증인, 설득 대상, 투표) */
export function chooseCharacter(title: string, ids: string[], label?: (id: string) => string): Promise<string | null> {
  return waitFor<string | null>((resolve) => {
    const m = openModal(title, 'cards');
    const list = h('div.card-list.people');
    for (const id of ids) list.appendChild(h('button.card', { onclick: () => resolve(id) }, label ? label(id) : charName(id)));
    m.body.appendChild(list);
    m.closed.then(() => resolve(null));
    return () => m.close();
  });
}

/** 여러 줄 중 하나를 무작위로 (전부 TODO 면 fallback) */
export function pickLine(lines: string[] | undefined, fallback: string): string[] {
  const usable = (lines ?? []).filter((l) => !isTodo(l));
  const one = pick(usable);
  return [one ?? fallback];
}

/** 캐릭터 기본 반응 대사 → "이름: 대사" */
export function reaction(who: string, kind: string, vars: Record<string, string> = {}): string[] {
  const def = C.characters[who];
  const list = def?.reactions?.[kind];
  const lines = (Array.isArray(list) ? list : [list]).filter((l): l is string => !!l && !isTodo(l));
  const line = pick(lines);
  if (!line) return [];
  const filled = line.replace(/\{(\w+)\}/g, (m, k) => vars[k] ?? m);
  return [/^[(（]/.test(filled) ? `${def.name}${filled}` : `${def.name}: ${filled}`];
}
