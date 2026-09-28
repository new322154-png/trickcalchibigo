/**
 * 대화창: 이름표, 타자기 효과, 의심 표시 버튼, 오토/스킵, 선택지, 지난 대화(백로그).
 */
import { C, charColor, charName, names, t } from '../engine/content';
import { P, isRead, markRead } from '../engine/state';
import { Line } from '../engine/story';
import { sleep, waitFor } from '../engine/util';
import { clear, h, layer } from './dom';
import { setTalking } from './scene';

export interface BacklogEntry {
  name: string;
  color: string;
  text: string;
}

export const backlog: BacklogEntry[] = [];
const BACKLOG_MAX = 300;

let box: HTMLElement;
let nameEl: HTMLElement;
let textEl: HTMLElement;
let nextEl: HTMLElement;
let suspectBtn: HTMLElement;
let choicesEl: HTMLElement;

let auto = false;
let skip = false;
let currentLine: Line | null = null;
let suspectHandler: ((line: Line) => void) | null = null;
let markedThisLine = false;
let saying = false;

/** 지금 대사가 떠 있는 중인가 (다른 창에서 대사를 끼워 넣을 때 확인) */
export function isSaying() {
  return saying;
}

export function buildDialogue(handlers: { onMenu: () => void; onBacklog: () => void; onNotebook: () => void; onPhone: () => void }) {
  const root = layer('dialogue');
  clear(root);
  nameEl = h('div.dlg-name');
  textEl = h('div.dlg-text');
  nextEl = h('div.dlg-next', '▼');
  suspectBtn = h('button.dlg-suspect', { onclick: (e: Event) => { e.stopPropagation(); onSuspect(); } }, names('%suspect_button%'));
  const controls = h(
    'div.dlg-controls',
    h('button', { onclick: stop(() => toggleAuto()) , 'data-k': 'auto' }, t('menu.auto')),
    h('button', { onclick: stop(() => toggleSkip()), 'data-k': 'skip' }, t('menu.skip')),
    h('button', { onclick: stop(handlers.onBacklog) }, t('menu.backlog')),
    h('button', { onclick: stop(handlers.onNotebook) }, t('menu.notebook')),
    h('button', { onclick: stop(handlers.onPhone) }, t('menu.phone')),
    h('button', { onclick: stop(hideUiOnce) }, t('menu.hide_ui')),
    h('button', { onclick: stop(handlers.onMenu) }, t('menu.settings')),
  );
  box = h('div.dlg-box.hidden', nameEl, textEl, nextEl, suspectBtn, controls);
  choicesEl = h('div.choices');
  root.append(box, choicesEl);
}

function stop(fn: () => void) {
  return (e: Event) => {
    e.stopPropagation();
    fn();
  };
}

export function setSuspectHandler(fn: (line: Line) => void) {
  suspectHandler = fn;
}

function onSuspect() {
  if (!currentLine || markedThisLine || !suspectHandler) return;
  markedThisLine = true;
  suspectBtn.classList.add('used');
  suspectHandler(currentLine);
}

export function toggleAuto(v = !auto) {
  auto = v;
  if (auto) skip = false;
  refreshControls();
}
export function toggleSkip(v = !skip) {
  skip = v;
  if (skip) auto = false;
  refreshControls();
}
export function stopAutoSkip() {
  auto = false;
  skip = false;
  refreshControls();
}
function refreshControls() {
  box?.querySelector('[data-k="auto"]')?.classList.toggle('on', auto);
  box?.querySelector('[data-k="skip"]')?.classList.toggle('on', skip);
}

function hideUiOnce() {
  box.classList.add('ui-hidden');
  const back = () => {
    box.classList.remove('ui-hidden');
    window.removeEventListener('pointerdown', back, true);
  };
  setTimeout(() => window.addEventListener('pointerdown', back, true), 50);
}

export function showBox(v: boolean) {
  box.classList.toggle('hidden', !v);
}

/**
 * 한 줄 출력. 클릭하면 다음으로.
 * opts.suspectable=false 면 의심 버튼 숨김 (조사·튜토리얼 등)
 */
export async function say(line: Line, opts: { suspectable?: boolean } = {}): Promise<void> {
  saying = true;
  try {
    await sayInner(line, opts);
  } finally {
    saying = false;
  }
}

async function sayInner(line: Line, opts: { suspectable?: boolean }): Promise<void> {
  currentLine = line;
  markedThisLine = false;
  showBox(true);
  suspectBtn.classList.remove('used');
  suspectBtn.style.display = opts.suspectable === false ? 'none' : '';

  const name = line.speakerId ? charName(line.speakerId) : line.speakerName ?? '';
  nameEl.textContent = name === '???' ? t('dialogue.unknown_speaker') : name;
  nameEl.style.display = name ? '' : 'none';
  nameEl.style.setProperty('--name-color', charColor(line.speakerId ?? line.speakerName));
  box.classList.toggle('narration', !name);

  const text = names(line.body);
  backlog.push({ name: nameEl.textContent ?? '', color: charColor(line.speakerId), text });
  if (backlog.length > BACKLOG_MAX) backlog.shift();

  const alreadyRead = isRead(line.id);
  markRead(line.id);

  if (skip && (alreadyRead || P.settings.skipUnread)) {
    textEl.textContent = text;
    await sleep(40);
    return;
  }
  if (skip) toggleSkip(false); // 안 읽은 대사에서 스킵 멈춤

  // 타자기 효과
  setTalking(line.speakerId, true);
  nextEl.classList.remove('show');
  let done = false;
  textEl.textContent = '';
  const chars = [...text];
  const typing = (async () => {
    const perChar = 1000 / Math.max(1, P.settings.textSpeed);
    for (let i = 0; i < chars.length && !done; i++) {
      textEl.textContent += chars[i];
      await sleep(perChar);
    }
    done = true;
    textEl.textContent = text;
    setTalking(line.speakerId, false);
    nextEl.classList.add('show');
  })();

  await waitFor<void>((resolve) => {
    let autoTimer: number | undefined;
    const advance = () => {
      if (!done) {
        done = true;
        return;
      }
      resolve();
    };
    const onClick = (e: Event) => {
      if ((e.target as HTMLElement).closest('button, .modal, .choices')) return;
      advance();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === ' ' || e.key === 'Enter') advance();
      if (e.key === 'Control') toggleSkip(true);
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === 'Control') toggleSkip(false);
    };
    const tick = window.setInterval(() => {
      if (skip && (isRead(line.id) || P.settings.skipUnread)) {
        done = true;
        resolve();
      }
      if (auto && done && autoTimer === undefined) {
        autoTimer = window.setTimeout(() => resolve(), P.settings.autoDelay * 1000 + text.length * 15);
      }
      if (!auto && autoTimer !== undefined) {
        clearTimeout(autoTimer);
        autoTimer = undefined;
      }
    }, 50);
    const stageEl = document.getElementById('stage')!;
    stageEl.addEventListener('click', onClick);
    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      stageEl.removeEventListener('click', onClick);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('keyup', onKeyUp);
      clearInterval(tick);
      clearTimeout(autoTimer);
    };
  });
  done = true;
  await typing;
  currentLine = null;
}

/**
 * 선택지. timer(초)를 주면 시간 안에 안 고를 때 마지막 선택지가 골라진다.
 */
export function choose(items: { text: string; disabled?: boolean }[], timer = 0): Promise<number> {
  stopAutoSkip();
  clear(choicesEl);
  return waitFor<number>((resolve) => {
    let timerId: number | undefined;
    items.forEach((it, i) => {
      const b = h('button.choice', { onclick: (e: Event) => { e.stopPropagation(); resolve(i); } }, names(it.text));
      if (it.disabled) b.setAttribute('disabled', '');
      choicesEl.appendChild(b);
    });
    if (timer > 0) {
      const bar = h('div.choice-timer', h('div.choice-timer-fill'));
      const label = h('div.choice-timer-label', t('dialogue.choice_timer').replace(/^TODO$/, ''));
      choicesEl.prepend(label, bar);
      const fill = bar.firstChild as HTMLElement;
      fill.style.transition = `width ${timer}s linear`;
      requestAnimationFrame(() => requestAnimationFrame(() => (fill.style.width = '0%')));
      timerId = window.setTimeout(() => resolve(items.length - 1), timer * 1000);
    }
    return () => {
      clearTimeout(timerId);
      clear(choicesEl);
    };
  });
}

export function speakerLabel(id: string | undefined) {
  return id ? charName(id) : '';
}

export function isAuto() {
  return auto;
}

export function hasCharacters() {
  return Object.keys(C.characters).length > 0;
}
