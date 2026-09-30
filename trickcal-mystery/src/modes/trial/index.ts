/**
 * 재판 전체 흐름: 단톡방 심리 → (조건부) 역습 방어전 → 최종 여론전·투표
 * 데이터: content/trials/*.yaml
 */
import { C, cfg, charName, names } from '../../engine/content';
import { game } from '../../engine/game';
import { S, impostorToday, markFound } from '../../engine/state';
import { isTodo } from '../../engine/util';
import { clear, layer } from '../../ui/dom';
import { cutin } from '../../ui/modal';
import { setHudVisible } from '../../ui/hud';
import { runChat } from './chat';
import { runCounter } from './counter';
import { runOpinion } from './opinion';
import { newCtx } from './common';

export async function runTrial(id: string): Promise<string | null> {
  // 교주 의심도가 가득 찼으면 교주가 피고가 되는 재판으로 바뀐다
  const base = C.trials[id];
  if (base?.if_suspected && C.trials[base.if_suspected] && S.suspicion >= cfg('suspicion.max', 10)) {
    await game.tutorial('defendant');
    id = base.if_suspected;
  }
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
    if (trial.defendant) await cutin(`${names('%defendant%')} ${charName(trial.defendant)}`, 'trial-title');

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
      const res = await runOpinion(trial, ctx);
      // 투표로 오늘의 가짜를 지목했다면 "찾아냄"
      if (S.lastVote && S.lastVote === impostorToday()) markFound();
      return res;
    }
    return r.correct;
  } finally {
    clear(layer('mode'));
    setHudVisible(true);
  }
}
