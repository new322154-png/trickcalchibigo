/**
 * 재판 3페이즈: 최종 여론전과 투표.
 *
 * 각 캐릭터는 "지금 의심하는 사람(target)"과 "확신(conf, 0~5)"을 가진다.
 * 플레이어는 턴마다 한 명에게 결론 카드 한 장을 보여준다.
 *   설득력 = config 의 성향별 배율[카드 종류]  (+ 교주 신뢰파는 호감도 보정, 의심도 감점)
 *   설득력 ≥ 2  → 설득됨: target 이 카드가 가리키는 사람으로 바뀜
 *   설득력 = 1  → 흔들림: 확신 -1 (0이 되면 바뀜)
 *   설득력 ≤ 역효과 기준 → 역효과: 확신 +1, 호감도 -1
 *   그 외      → 요지부동
 * 턴이 끝나면 진범의 반론(rebuttals)이 일부 사람을 되돌린다.
 * 마지막에 모두 투표(교주 포함). 동률이면 연장 토론 1턴 후 재투표, 그래도 동률이면 저택이 고른다.
 */
import { C, cfg, charColor, charName, names, t } from '../../engine/content';
import type { TrialDef } from '../../engine/content';
import { game } from '../../engine/game';
import { S, addAffinity, isPresent } from '../../engine/state';
import { isTodo, waitFor } from '../../engine/util';
import { clear, h, layer } from '../../ui/dom';
import * as dlg from '../../ui/dialogue';
import { cutin, openModal, toast } from '../../ui/modal';
import { TrialCtx, chooseCharacter, reaction } from './common';

interface Voter {
  id: string;
  target: string;
  conf: number;
}

export async function runOpinion(trial: TrialDef, ctx: TrialCtx): Promise<string> {
  const op = trial.opinion!;
  const results = trial.results;
  const culprit = op.culprit;
  const voters: Voter[] = Object.entries(op.initial ?? {})
    .filter(([id]) => isPresent(id) && C.characters[id])
    .map(([id, v]) => ({ id, target: isTodo(v?.target) ? '' : v.target, conf: Number(v?.conf ?? 2) }));
  const candidates = Object.keys(C.characters).filter((c) => !C.characters[c].player && isPresent(c));

  await game.sayLines(op.intro);
  const turns = op.turns ?? cfg('trial.opinion_turns', 3);
  for (let turn = 1; turn <= turns; turn++) {
    await playTurn(ctx, voters, op, turns - turn + 1);
    const reb = (op.rebuttals ?? []).find((r) => r.turn === turn);
    if (reb) {
      await game.sayLines(reb.lines);
      for (const [who, target] of Object.entries(reb.sway ?? {})) {
        const v = voters.find((x) => x.id === who);
        if (v) {
          v.target = target;
          v.conf = Math.max(v.conf, 2);
        }
      }
    }
  }

  await game.sayLines(op.before_vote);
  let top = await vote(voters, candidates);
  if (top.length > 1) {
    toast(t('trial.tie'), 'warn');
    await game.sayLines(op.extension);
    toast(t('trial.extension_start'));
    await playTurn(ctx, voters, op, 1, top);
    top = await vote(voters, top);
  }
  clear(layer('mode'));

  if (top.length > 1) {
    await game.sayLines(op.verdict_mansion);
    S.lastVote = '';
    return results.mansion ?? results.wrong;
  }
  const chosen = top[0];
  S.lastVote = chosen;
  await cutin(names(C.game.cutins?.verdict ?? ''), 'verdict');
  if (chosen === culprit) {
    await game.sayLines(op.verdict_correct);
    const keys = Object.entries(op.cards ?? {}).filter(([, c]) => c.key).map(([id]) => id);
    const allKeys = keys.every((k) => ctx.shownCards.has(k));
    return allKeys ? results.correct : results.correct_weak ?? results.correct;
  }
  await game.sayLines((op.verdict_wrong ?? []).map((l) => l.replace(/\{target\}/g, charName(chosen))));
  return results.wrong_by_target?.[chosen] ?? results.wrong;
}

/** 한 턴: 누구에게 → 어떤 카드 */
async function playTurn(ctx: TrialCtx, voters: Voter[], op: NonNullable<TrialDef['opinion']>, turnsLeft: number, only?: string[]) {
  const cards = S.conclusions.filter((c) => op.cards?.[c] && (!only || only.includes(op.cards[c].accuses)));
  dlg.showBox(false);
  const target = await waitFor<string | null>((resolve) => {
    renderBoard(voters, turnsLeft, resolve);
    return () => {};
  });
  if (!target) return;
  if (cards.length === 0) {
    toast(t('notebook.empty_conclusions'));
    return;
  }
  const cardId = await waitFor<string | null>((resolve) => {
    const m = openModal(t('trial.choose_card'), 'cards');
    const list = h('div.card-list');
    for (const c of cards) {
      const def = C.conclusions[c];
      list.appendChild(h('button.card', { onclick: () => resolve(c) }, h('b', names(def?.name ?? c)), h('small', names(def?.text ?? ''))));
    }
    m.body.appendChild(list);
    m.closed.then(() => resolve(null));
    return () => m.close();
  });
  if (!cardId) return;
  ctx.shownCards.add(cardId);
  const v = voters.find((x) => x.id === target)!;
  const card = op.cards[cardId];
  const kind = C.conclusions[cardId]?.kind ?? 'evidence';
  const type = C.characters[target]?.persuasion ?? 'evidence';
  let power = Number(cfg(`trial.persuasion.${type}.${kind}`, 1));
  if (type === 'trust') {
    power += (S.affinity[target] ?? 0) * cfg('trial.trust_affinity_bonus', 0.2);
    power -= S.suspicion * cfg('trial.trust_suspicion_penalty', 0.3);
  }
  // 이미 그 사람을 의심하고 있으면 확신만 오름
  if (v.target === card.accuses) {
    v.conf = Math.min(5, v.conf + 1);
    await game.sayLines(reaction(target, 'persuaded'));
    return;
  }
  if (power >= 2) {
    v.target = card.accuses;
    v.conf = Math.min(5, Math.round(power));
    toast(`${charName(target)} · ${t('trial.persuaded')}`, 'up');
    await game.sayLines(reaction(target, 'persuaded'));
  } else if (power >= 1) {
    v.conf -= 1;
    if (v.conf <= 0) {
      v.target = card.accuses;
      v.conf = 1;
    }
    toast(`${charName(target)} · ${t('trial.wavering')}`);
    await game.sayLines(reaction(target, 'wavering'));
  } else if (power <= cfg('trial.backfire_threshold', -1)) {
    v.conf = Math.min(5, v.conf + 1);
    addAffinity(target, -1);
    toast(`${charName(target)} · ${t('trial.backfire')}`, 'warn');
    await game.sayLines(reaction(target, 'backfire'));
  } else {
    toast(`${charName(target)} · ${t('trial.unmoved')}`);
    await game.sayLines(reaction(target, 'unmoved'));
  }
}

function renderBoard(voters: Voter[], turnsLeft: number, pickTarget: (id: string | null) => void) {
  const root = clear(layer('mode'));
  const grid = h('div.opinion-grid');
  for (const v of voters) {
    grid.appendChild(
      h('button.opinion-card', { onclick: () => pickTarget(v.id) },
        h('div.op-name', { style: { color: charColor(v.id) } }, charName(v.id)),
        h('div.op-arrow', '→ ' + (v.target ? charName(v.target) : '—')),
        h('div.op-conf', ...Array.from({ length: 5 }, (_, i) => h(`span.pip${i < v.conf ? '.on' : ''}`))),
        h('div.op-type', names(typeLabel(C.characters[v.id]?.persuasion))),
      ),
    );
  }
  root.appendChild(
    h('div.opinion',
      h('div.opinion-top', h('span', names('%trial_opinion%')), h('span', t('trial.turn_left', { n: turnsLeft }))),
      h('div.opinion-guide', t('trial.opinion_guide')),
      grid,
    ),
  );
}

function typeLabel(p?: string) {
  // ui.yaml 의 trial.type_* 를 "" 로 두면 성향이 화면에 안 보임
  return t(`trial.type_${p ?? 'evidence'}`);
}

/** 투표. 돌아가는 값 = 최다 득표자 목록 (2명 이상이면 동률) */
async function vote(voters: Voter[], candidates: string[]): Promise<string[]> {
  const mine = await chooseCharacter(t('trial.vote_title'), candidates);
  const tally = new Map<string, number>();
  const lines: string[] = [];
  for (const v of voters) {
    if (!v.target || !candidates.includes(v.target)) continue;
    tally.set(v.target, (tally.get(v.target) ?? 0) + 1);
    lines.push(...reaction(v.id, 'vote', { target: charName(v.target) }));
  }
  if (mine) tally.set(mine, (tally.get(mine) ?? 0) + 1);
  await game.sayLines(lines);
  const max = Math.max(0, ...tally.values());
  return [...tally.entries()].filter(([, n]) => n === max).map(([id]) => id);
}
