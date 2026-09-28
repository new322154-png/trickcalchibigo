/**
 * 휴대폰(무전기) 메신저.
 * - 대화 재생: 입력 중 표시 → 메시지 도착 → 답장 선택지(제한 시간) → label 이동
 * - 삭제되는 메시지와 복구
 * - 엿보기 (들킬 확률, 호감도·의심도 벌점)
 * 데이터: content/phone/*.yaml
 */
import { C, cfg, charColor, charName, names, t } from '../engine/content';
import type { PhoneMsg } from '../engine/content';
import { events } from '../engine/events';
import { game } from '../engine/game';
import {
  S, addAffinity, addSuspicion, applyEffect, giveClue, logAction, setFlag,
} from '../engine/state';
import type { PhoneLogEntry, PhoneThreadState } from '../engine/state';
import { asArray, isTodo, pick, sleep, waitFor } from '../engine/util';
import { clear, h, layer } from '../ui/dom';
import * as dlg from '../ui/dialogue';
import { confirm, openModal, toast } from '../ui/modal';

const PLAYER = () => Object.entries(C.characters).find(([, d]) => d.player)?.[0] ?? 'kyoju';

function threadState(id: string): PhoneThreadState {
  return (S.phone[id] ??= { log: [], pos: 0, done: false, unread: false });
}

function threadTitle(id: string) {
  const th = C.threads[id];
  if (!th) return id;
  const g = C.groups[th.with];
  if (g) return isTodo(g.name) ? names('%group_chat%') : g.name;
  return charName(th.with);
}

// ── 화면 ────────────────────────────────────────────

interface PhoneView {
  root: HTMLElement;
  list: HTMLElement;
  input: HTMLElement;
  typing: HTMLElement;
  close: () => void;
}

function openView(title: string, hideDialogue = false): PhoneView {
  // 폰은 대화창보다 위(modal 레이어)에 뜬다. 조사 화면 등 아래 화면은 그대로 둔다.
  const list = h('div.phone-log');
  const typing = h('div.phone-typing.hidden', t('phone.typing'));
  const input = h('div.phone-input');
  const frame = h('div.phone', h('div.phone-header', title), list, typing, input);
  const wrap = h('div.modal.phone-backdrop', frame);
  layer('modal').appendChild(wrap);
  if (hideDialogue) dlg.showBox(false);
  return { root: wrap, list, input, typing, close: () => wrap.remove() };
}

function renderEntry(view: PhoneView, e: PhoneLogEntry, rerender: () => void) {
  const mine = e.from === PLAYER();
  const bubble = h(`div.phone-msg${mine ? '.mine' : ''}${e.deleted ? '.deleted' : ''}`);
  if (!mine) bubble.appendChild(h('div.phone-from', { style: { color: charColor(e.from) } }, e.from === 'unknown' ? charName('unknown') : charName(e.from)));
  if (e.deleted) {
    bubble.appendChild(h('div.phone-text', t('phone.deleted')));
    if (e.recoverable) {
      bubble.appendChild(
        h('button.btn.small', {
          onclick: () => {
            e.deleted = false;
            toast(t('phone.recovered'));
            rerender();
          },
        }, t('phone.recover')),
      );
    }
  } else {
    if (e.image) bubble.appendChild(h('img.phone-img', { src: `./assets/evidence/${e.image}` }));
    bubble.appendChild(h('div.phone-text', names(e.text)));
  }
  view.list.appendChild(bubble);
}

function renderLog(view: PhoneView, log: PhoneLogEntry[]) {
  clear(view.list);
  const rerender = () => renderLog(view, log);
  for (const e of log) renderEntry(view, e, rerender);
  view.list.scrollTop = view.list.scrollHeight;
}

// ── 대화 재생 ──────────────────────────────────────

/** fromStory=true: 대본의 #phone 태그로 열림 → 끝나면 on_end knot 반환 */
export async function runPhoneThread(id: string, fromStory: boolean): Promise<string | null> {
  const th = C.threads[id];
  if (!th) {
    console.warn('[폰] phone 폴더에 없는 대화:', id);
    return null;
  }
  const st = threadState(id);
  st.unread = false;
  events.emit('phone', { thread: id, notify: false });
  const view = openView(threadTitle(id), fromStory);
  renderLog(view, st.log);
  try {
    await playMessages(view, th.messages, st);
    await waitFor<void>((resolve) => {
      view.input.appendChild(h('button.btn', { onclick: () => resolve() }, t('phone.back')));
      return () => clear(view.input);
    });
  } finally {
    view.close();
  }
  return fromStory && th.on_end && !isTodo(th.on_end) ? th.on_end : null;
}

async function playMessages(view: PhoneView, messages: PhoneMsg[], st: PhoneThreadState) {
  const rerender = () => renderLog(view, st.log);
  while (!st.done && st.pos < messages.length) {
    const msg = messages[st.pos];
    if (msg.label) {
      st.pos++;
      continue;
    }
    if (msg.end) {
      st.done = true;
      break;
    }
    if (msg.choice) {
      const next = await replyChoice(view, msg.choice, st);
      st.pos = next === undefined ? st.pos + 1 : labelIndex(messages, next, st.pos + 1);
      rerender();
      continue;
    }
    // 상대 메시지
    const from = msg.from ?? 'unknown';
    if (from !== PLAYER()) {
      view.typing.classList.remove('hidden');
      await sleep((msg.typing ?? cfg('phone.default_typing', 1.2)) * 1000);
      view.typing.classList.add('hidden');
    }
    const entry: PhoneLogEntry = { from, text: msg.text ?? '', image: msg.image, recoverable: msg.recoverable };
    st.log.push(entry);
    if (msg.clue && !isTodo(msg.clue)) giveClue(msg.clue);
    if (msg.recoverable) await game.tutorial('recover');
    if (msg.delete_after) {
      setTimeout(() => {
        entry.deleted = true;
        rerender();
      }, msg.delete_after * 1000);
    }
    rerender();
    st.pos++;
    await sleep(250);
  }
  st.done = st.done || st.pos >= messages.length;
}

function labelIndex(messages: PhoneMsg[], label: string, fallback: number) {
  const i = messages.findIndex((m) => m.label === label);
  if (i < 0) console.warn('[폰] 없는 label:', label);
  return i < 0 ? fallback : i;
}

/** 답장 고르기. 돌아가는 값 = 이동할 label (없으면 undefined) */
async function replyChoice(view: PhoneView, choice: NonNullable<PhoneMsg['choice']>, st: PhoneThreadState): Promise<string | undefined> {
  const timeout = choice.timeout ?? cfg('phone.default_reply_timeout', 0);
  if (timeout > 0) await game.tutorial('reply_timer');
  const picked = await waitFor<number>((resolve) => {
    clear(view.input);
    if (timeout > 0) {
      const bar = h('div.reply-timer', h('div.reply-timer-fill'));
      const label = h('div.reply-timer-label', t('phone.reply_timer', { sec: timeout }));
      view.input.append(label, bar);
      const fill = bar.firstChild as HTMLElement;
      fill.style.transition = `width ${timeout}s linear`;
      requestAnimationFrame(() => requestAnimationFrame(() => (fill.style.width = '0%')));
    }
    choice.options.forEach((o, i) => view.input.appendChild(h('button.phone-option', { onclick: () => resolve(i) }, names(o.text))));
    const timer = timeout > 0 ? window.setTimeout(() => resolve(-1), timeout * 1000) : undefined;
    return () => {
      clearTimeout(timer);
      clear(view.input);
    };
  });
  if (picked === -1) {
    toast(t('phone.reply_timeout'), 'warn');
    logAction('reply_timeout');
    asArray(choice.on_timeout?.effects).forEach(applyEffect);
    return choice.on_timeout?.goto;
  }
  const opt = choice.options[picked];
  st.log.push({ from: PLAYER(), text: opt.send && !isTodo(opt.send) ? opt.send : opt.text });
  asArray(opt.effects).forEach(applyEffect);
  return opt.goto;
}

// ── 앱 (메뉴에서 열기) ─────────────────────────────

export async function openPhoneApp() {
  const m = openModal(names('%phone%'), 'phone-app');
  const render = () => {
    clear(m.body);
    const ids = Object.keys(S.phone);
    if (ids.length === 0) m.body.appendChild(h('p.empty', t('phone.empty')));
    for (const id of ids) {
      const st = S.phone[id];
      const last = st.log[st.log.length - 1];
      m.body.appendChild(
        h(`button.thread-row${st.unread ? '.unread' : ''}`, {
          onclick: async () => {
            m.close();
            await runPhoneThread(id, false);
          },
        }, h('b', threadTitle(id)), h('span', last ? (last.deleted ? t('phone.deleted') : names(last.text)) : '')),
      );
    }
    // 엿보기
    const snoops = Object.entries(C.snoops).filter(([sid, s]) => !S.snooped.includes(sid) && (!s.needs || S.flags[s.needs]) && !S.vanished.includes(s.owner));
    if (snoops.length) {
      m.body.appendChild(h('div.section-title', names('%snoop%')));
      for (const [sid, s] of snoops) {
        m.body.appendChild(h('button.thread-row.snoop', { onclick: () => { m.close(); snoop(sid); } }, h('b', charName(s.owner)), h('span', names('%snoop%'))));
      }
    }
  };
  render();
}

async function snoop(id: string) {
  const s = C.snoops[id];
  if (!(await confirm(t('confirm.snoop'), '들킬 수도 있습니다. 엿볼까요?'))) return;
  await game.tutorial('snoop');
  S.snooped.push(id);
  const view = openView(`${charName(s.owner)} · ${names('%snoop%')}`);
  const log: PhoneLogEntry[] = [];
  for (const msg of s.messages ?? []) {
    if (!msg.text) continue;
    log.push({ from: msg.from ?? s.owner, text: msg.text, image: msg.image });
    if (msg.clue && !isTodo(msg.clue)) giveClue(msg.clue);
  }
  renderLog(view, log);
  const chance = s.caught === 'always' ? 100 : s.caught === 'never' || s.caught === undefined ? 0 : Number(s.caught);
  const caught = Math.random() * 100 < chance;
  await waitFor<void>((resolve) => {
    view.input.appendChild(h('button.btn', { onclick: () => resolve() }, t('phone.back')));
    return () => clear(view.input);
  });
  view.close();
  if (caught) {
    toast(t('phone.snoop_caught'), 'warn');
    setFlag(`caught_${id}`);
    logAction('snoop_caught');
    addAffinity(s.owner, cfg('phone.snoop_caught_affinity', -2));
    addSuspicion(cfg('phone.snoop_caught_suspicion', 2));
    const reaction = pick(asArray(C.characters[s.owner]?.reactions?.snoop_caught as any)) as string | undefined;
    if (reaction && !isTodo(reaction)) {
      const name = C.characters[s.owner].name;
      await game.sayOrQueue([/^[(（]/.test(reaction) ? `${name}${reaction}` : `${name}: ${reaction}`]);
    }
  }
}
