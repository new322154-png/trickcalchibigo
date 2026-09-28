/**
 * 재판 2페이즈: 역습 방어전 (조건부).
 * 교주 의심도가 기준 이상이면 열린다. 고발 라운드는 플레이어가 실제로 한 행동(S.actions)에 맞춰 골라진다.
 */
import { C, charName, names, t } from '../../engine/content';
import type { TrialDef } from '../../engine/content';
import { game } from '../../engine/game';
import { S, isPresent } from '../../engine/state';
import { clear, h, layer } from '../../ui/dom';
import * as dlg from '../../ui/dialogue';
import { cutin } from '../../ui/modal';
import { TrialCtx, chooseCharacter, chooseEvidence, pickLine } from './common';

export async function runCounter(trial: TrialDef, ctx: TrialCtx): Promise<boolean> {
  const counter = trial.counter!;
  const rounds = (counter.rounds ?? []).filter((r) => {
    if (r.when?.startsWith('flag:')) return !!S.flags[r.when.slice(5)];
    return S.actions.includes(r.when);
  });
  if (rounds.length === 0) return true; // 고발할 거리가 없으면 통과

  const root = layer('mode');
  clear(root);
  root.appendChild(h('div.trial-banner.counter', names('%trial_counter%')));
  await game.sayLines(counter.intro);

  let fails = 0;
  const maxFails = counter.max_fails ?? 2;
  for (const r of rounds) {
    let solved = false;
    while (!solved) {
      await game.sayLines(r.accuse);
      dlg.showBox(false);
      if (r.defense.type === 'witness') {
        const min = r.defense.min_affinity ?? 5;
        const witnesses = Object.keys(C.characters).filter((c) => !C.characters[c].player && isPresent(c));
        const who = await chooseCharacter(t('trial.choose_witness'), witnesses, (id) => charName(id));
        solved = !!who && (S.affinity[who] ?? 0) >= min;
      } else {
        const ev = await chooseEvidence(ctx);
        solved = !!ev && ev === r.defense.evidence;
      }
      if (solved) {
        await cutin(names(C.game.cutins?.rebut ?? ''), 'rebut');
        await game.sayLines(r.solved);
      } else {
        fails++;
        await game.sayLines(pickLine(r.wrong, t('trial.wrong')));
        if (fails >= maxFails) {
          clear(root);
          return false;
        }
      }
    }
  }
  await game.sayLines(counter.outro);
  clear(root);
  return true;
}
