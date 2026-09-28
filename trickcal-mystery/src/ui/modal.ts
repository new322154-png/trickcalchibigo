/** 창(모달), 확인 창, 알림 */
import { t } from '../engine/content';
import { events } from '../engine/events';
import { isTodo, sleep, waitFor } from '../engine/util';
import { h, layer } from './dom';

export interface ModalHandle {
  el: HTMLElement;
  body: HTMLElement;
  close: () => void;
  closed: Promise<void>;
}

/** 창 열기. 닫기 버튼과 바깥 클릭으로 닫힘 */
export function openModal(title: string, cls = '', opts: { closable?: boolean } = {}): ModalHandle {
  const body = h('div.modal-body');
  let resolveClosed!: () => void;
  const closed = new Promise<void>((r) => (resolveClosed = r));
  const closeBtn = opts.closable === false ? null : h('button.modal-close', { onclick: () => close() }, '✕');
  const panel = h(`div.modal-panel${cls ? '.' + cls : ''}`, h('div.modal-title', title, closeBtn), body);
  const el = h('div.modal', { onclick: (e: Event) => e.target === el && opts.closable !== false && close() }, panel);
  layer('modal').appendChild(el);
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape' && opts.closable !== false && el === layer('modal').lastElementChild) close();
  };
  window.addEventListener('keydown', onKey);
  function close() {
    el.remove();
    window.removeEventListener('keydown', onKey);
    resolveClosed();
  }
  return { el, body, close, closed };
}

export function closeAllModals() {
  const m = layer('modal');
  while (m.firstChild) m.removeChild(m.firstChild);
}

/** 예/아니오. 문구가 TODO 면 fallback 사용 */
export function confirm(text: string, fallback = '계속할까요?'): Promise<boolean> {
  const msg = isTodo(text) || !text ? fallback : text;
  return waitFor<boolean>((resolve) => {
    const m = openModal('', 'confirm', { closable: false });
    m.body.append(
      h('p.confirm-text', msg),
      h(
        'div.confirm-buttons',
        h('button.btn', { onclick: () => resolve(true) }, t('confirm.yes')),
        h('button.btn', { onclick: () => resolve(false) }, t('confirm.no')),
      ),
    );
    return () => m.close();
  });
}

/** 알림 한 줄 (메시지는 잠시 후 사라짐) */
export function toast(text: string, kind = '') {
  if (!text || isTodo(text)) return;
  const el = h(`div.toast${kind ? '.toast-' + kind : ''}`, text);
  layer('toast').appendChild(el);
  requestAnimationFrame(() => el.classList.add('show'));
  sleep(2600).then(() => {
    el.classList.remove('show');
    sleep(400).then(() => el.remove());
  });
}

events.on('toast', ({ text, kind }) => toast(text, kind));

/** 화면 가운데 큰 글자 (컷인) */
export async function cutin(text: string, cls = '') {
  if (!text || isTodo(text)) return;
  const el = h(`div.cutin${cls ? '.' + cls : ''}`, h('span', text));
  layer('fx').appendChild(el);
  await sleep(1100);
  el.remove();
}
