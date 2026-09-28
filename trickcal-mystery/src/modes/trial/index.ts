/**
 * 재판 전체 흐름: 단톡방 심리 → (조건부) 역습 방어전 → 최종 여론전·투표
 * 데이터: content/trials/*.yaml
 */
import { C, cfg, names } from '../../engine/content';
import { game } from '../../engine/game';
import { S } from '../../engine/state';
import { isTodo } from '../../engine/util';
import { clear, layer } from '../../ui/dom';
import { cutin } from '../../ui/modal';
import { setHudVisible } from '../../ui/hud';
import { runChat } from './chat';
import { runCounter } from './counter';
import { runOpinion } from './opinion';
import { newCtx } from './common';

export async function runTrial(id: string): Promise<string | null> {
  const trial = C.trials[id];
  if (!trial) {
    console.warn('[재판] trials 폴더에 없는 id:', id);
    return null;
  }
  const r = trial.results;
  const ctx = newCtx(id);
  setHudVisible(false);
  try {
    await cutin(names(C.game.cutins?.trial_start ?? ''), 'trial-start');
    if (trial.title && !isTodo(trial.title)) await cutin(names(trial.title), 'trial-title');

    if (trial.chat?.rounds?.length) {
      await game.tutorial('trial_chat');
      const res = await runChat(trial, ctx);
      if (res === 'voice_empty') return r.voice_empty ?? r.wrong;
    }

    if (trial.counter?.rounds?.length && S.suspicion >= cfg('trial.counter_threshold', 6)) {
      await game.tutorial('trial_counter');
      const ok = await runCounter(trial, ctx);
      if (!ok) return r.counter_fail ?? r.wrong;
    }

    if (trial.opinion) {
      await game.tutorial('trial_opinion');
      await game.tutorial('vote');
      return await runOpinion(trial, ctx);
    }
    return r.correct;
  } finally {
    clear(layer('mode'));
    setHudVisible(true);
  }
}
