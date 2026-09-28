/**
 * 재판 1페이즈: 단톡방 심리.
 * 메시지가 차례로 올라오고, 끝까지 가면 처음부터 반복된다.
 * 메시지를 고른 뒤 되묻기 / 반박(증거) / 캡처 / 대조(두 메시지) 중 하나를 한다.
 */
import { C, cfg, charColor, charName, names, t } from '../../engine/content';
import type { TrialDef, TrialMsg, TrialRound } from '../../engine/content';
import { game } from '../../engine/game';
import { addSuspicion, logAction } from '../../engine/state';
import { isTodo, sleep, waitFor } from '../../engine/util';
import { clear, h, layer } from '../../ui/dom';
import * as dlg from '../../ui/dialogue';
import { cutin, toast } from '../../ui/modal';
import { TrialCtx, chooseEvidence, pickLine, voiceMeter } from './common';

type Attempt =
  | { type: 'rebut'; msg: TrialMsg; evidence: string }
  | { type: 'compare'; a: TrialMsg; b: TrialMsg }
  | { type: 'ask'; msg: TrialMsg };

export async function runChat(trial: TrialDef, ctx: TrialCtx): Promise<'ok' | 'voice_empty'> {
  const chat = trial.chat!;
  await game.sayLines(chat.intro);
  for (const round of chat.rounds ?? []) {
    const seq: TrialMsg[] = [...(round.messages ?? [])];
    const asked = new Set<string>();
    const whispered = new Set<string>();
    while (true) {
      dlg.showBox(false);
      const attempt = await playPass(round, seq, ctx, whispered);
      if (attempt.type === 'ask') {
        const msg = attempt.msg;
        if (msg.ask?.length && !asked.has(msg.id)) {
          asked.add(msg.id);
          await cutin(names(C.game.cutins?.ask ?? ''), 'ask');
          const idx = seq.findIndex((m) => m.id === msg.id);
          seq.splice(idx + 1, 0, ...msg.ask);
        } else {
          toast(t('trial.ask_nothing'));
        }
        continue;
      }
      if (isCorrect(round, attempt)) {
        await cutin(names(C.game.cutins?.[attempt.type] ?? ''), attempt.type);
        await cutin(names(C.game.cutins?.success ?? ''), 'success');
        await game.sayLines(round.solved);
        break;
      }
      // 틀림
      ctx.voice -= cfg('trial.voice_penalty', 1);
      addSuspicion(cfg('trial.wrong_suspicion', 1));
      logAction('wrong_rebut');
      toast(t('trial.wrong'), 'warn');
      await game.sayLines(pickLine(round.wrong, t('trial.wrong')));
      if (ctx.voice <= 0) {
        toast(t('trial.voice_empty'), 'warn');
        return 'voice_empty';
      }
    }
  }
  clear(layer('mode'));
  await game.sayLines(chat.outro);
  return 'ok';
}

function isCorrect(round: TrialRound, a: Attempt): boolean {
  const ans = round.answer;
  if (!ans) return false;
  if (a.type === 'rebut' && ans.type === 'rebut') return a.msg.id === ans.message && a.evidence === ans.evidence;
  if (a.type === 'compare' && ans.type === 'compare') {
    const want = new Set(ans.messages ?? []);
    return want.has(a.a.id) && want.has(a.b.id) && a.a.id !== a.b.id;
  }
  return false;
}

/** 메시지를 한 바퀴 재생. 플레이어가 행동하면 그 시도를 돌려준다. */
function playPass(round: TrialRound, seq: TrialMsg[], ctx: TrialCtx, whispered: Set<string>): Promise<Attempt> {
  const root = layer('mode');
  return waitFor<Attempt>((resolve) => {
    clear(root);
    let selected: TrialMsg | null = null;
    let compareFirst: TrialMsg | null = null;
    let paused = false;
    let index = 0;
    let alive = true;
    const timers: number[] = [];

    const log = h('div.chat-log');
    const whisperBox = h('div.whisper-box');
    const hint = h('div.chat-hint');
    const pauseBtn = h('button.btn', { onclick: () => { paused = !paused; pauseBtn.textContent = paused ? t('trial.resume') : t('trial.pause'); } }, t('trial.pause'));
    if (!cfg('trial.allow_pause', true)) pauseBtn.style.display = 'none';

    const bubbles = new Map<string, HTMLElement>();
    const select = (m: TrialMsg) => {
      if (compareFirst && compareFirst.id !== m.id) {
        resolve({ type: 'compare', a: compareFirst, b: m });
        return;
      }
      selected = m;
      bubbles.forEach((b, id) => b.classList.toggle('selected', id === m.id));
    };

    const need = (): TrialMsg | null => {
      if (!selected) toast(t('trial.select_first'));
      return selected;
    };

    const actions = h(
      'div.chat-actions',
      h('button.btn.act-ask', { onclick: () => { const m = need(); if (m) resolve({ type: 'ask', msg: m }); } }, t('trial.ask')),
      h('button.btn.act-rebut', {
        onclick: async () => {
          const m = need();
          if (!m) return;
          paused = true;
          const ev = await chooseEvidence(ctx).catch(() => null);
          paused = false;
          if (ev && alive) resolve({ type: 'rebut', msg: m, evidence: ev });
        },
      }, t('trial.rebut')),
      h('button.btn.act-capture', {
        onclick: () => {
          const m = need();
          if (!m) return;
          const b = bubbles.get(m.id);
          if (!m.capture || !b || b.classList.contains('deleted')) {
            toast(t('trial.capture_nothing'));
            return;
          }
          ctx.captured.set('cap:' + m.id, m);
          b.classList.add('captured');
          void cutin(names(C.game.cutins?.capture ?? ''), 'capture');
        },
      }, t('trial.capture')),
      h('button.btn.act-compare', {
        onclick: () => {
          const m = need();
          if (!m) return;
          compareFirst = m;
          hint.textContent = t('trial.compare_pick_second');
        },
      }, t('trial.compare')),
      pauseBtn,
    );

    const topic = isTodo(round.topic) ? '' : names(round.topic);
    root.appendChild(h('div.trial-chat', h('div.chat-top', h('div.chat-topic', topic), voiceMeter(ctx)), log, hint, actions, whisperBox));

    const addBubble = (m: TrialMsg) => {
      const b = h('div.chat-msg', { onclick: () => select(m) }, h('div.chat-from', { style: { color: charColor(m.from) } }, charName(m.from)), h('div.chat-text', names(m.text)));
      bubbles.set(m.id, b);
      log.appendChild(b);
      log.scrollTop = log.scrollHeight;
      if (m.capture) {
        b.classList.add('volatile');
        timers.push(window.setTimeout(() => {
          if (!b.classList.contains('captured')) {
            b.classList.add('deleted');
            (b.querySelector('.chat-text') as HTMLElement).textContent = t('phone.deleted');
          }
        }, (m.capture ?? cfg('trial.capture_window', 3)) * 1000));
      }
      for (const w of round.whispers ?? []) {
        if (w.after === m.id && !whispered.has(w.after + w.from)) {
          whispered.add(w.after + w.from);
          toast(t('trial.whisper_new'));
          paused = true;
          void game.tutorial('whisper').finally(() => (paused = false));
          whisperBox.appendChild(h('div.whisper', h('b', charName(w.from)), h('span', names(w.text))));
        }
      }
    };

    // 메시지를 일정 간격으로 올림. 끝나면 잠시 뒤 처음부터
    (async () => {
      const gap = cfg('trial.chat_speed', 2.5) * 1000;
      while (alive) {
        if (!paused) {
          if (index >= seq.length) {
            await sleep(gap);
            if (!alive) break;
            clear(log);
            bubbles.clear();
            selected = null;
            index = 0;
            continue;
          }
          addBubble(seq[index++]);
        }
        await sleep(paused ? 200 : gap);
      }
    })();

    return () => {
      alive = false;
      timers.forEach(clearTimeout);
    };
  });
}
