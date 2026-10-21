/**
 * 버그 제보: 화면 오른쪽 아래 🐞 버튼 → 한 줄 적어서 보내기.
 * 지금 상황(방·단계·내 직업·연결 상태·최근 기록·최근 오류)을 같이 보내서 무슨 일이었는지 알 수 있게 한다.
 * 웹소켓이 아니라 HTTP 로 보내므로 연결이 끊겨 있어도 보낼 수 있다.
 */
import { currentLink } from '../net';
import { h } from './dom';

type Ctx = () => Record<string, unknown> | null;
const providers = new Map<string, Ctx>();
/** 화면마다 제보에 붙일 상황을 등록 (대기실·게임) — 빠질 때 지운다 */
export function setReportCtx(key: string, fn: Ctx | null) { if (fn) providers.set(key, fn); else providers.delete(key); }

const errors: string[] = [];
const keepErr = (s: string) => { errors.push(`${new Date().toLocaleTimeString('ko-KR')} ${s}`.slice(0, 400)); if (errors.length > 8) errors.shift(); };
addEventListener('error', (e) => keepErr(`${e.message} @${(e.filename || '').split('/').pop()}:${e.lineno}`));
addEventListener('unhandledrejection', (e) => keepErr(`promise: ${String((e.reason as Error)?.message ?? e.reason)}`));

function context() {
  const ctx: Record<string, unknown> = {
    build: typeof __BUILD__ !== 'undefined' ? __BUILD__ : '?',
    page: location.pathname + location.search,
    screen: `${innerWidth}x${innerHeight} @${devicePixelRatio}`,
    touch: matchMedia('(pointer: coarse)').matches,
    time: new Date().toISOString(),
    net: currentLink?.stats(),
    errors: [...errors],
  };
  for (const [k, f] of providers) { try { ctx[k] = f(); } catch (e) { ctx[k] = `ctx error: ${String(e)}`; } }
  return ctx;
}

export function openReport() {
  if (document.querySelector('.rp-modal')) return;
  const kinds = [['bug', '🐞 버그'], ['ui', '📱 화면·조작 불편'], ['balance', '⚖ 밸런스'], ['etc', '💬 기타']] as const;
  let kind: string = 'bug';
  const ta = h('textarea.rp-text', { maxLength: 1000, placeholder: '무슨 일이 있었나요? (예: 복도에서 문이 안 눌려요 / 투표했는데 안 들어갔어요)' }) as HTMLTextAreaElement;
  const msg = h('div.rp-msg');
  const kindRow = h('div.rp-kinds', kinds.map(([k, label]) => {
    const b = h(`button.btn.small${k === kind ? '.on' : ''}`, { onclick: () => { kind = k; kindRow.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b)); } }, label);
    return b;
  }));
  const send = h('button.btn.gold', { onclick: async () => {
    const text = ta.value.trim();
    if (!text) { msg.textContent = '내용을 적어 주세요.'; ta.focus(); return; }
    (send as HTMLButtonElement).disabled = true;
    msg.textContent = '보내는 중…';
    try {
      const r = await fetch('/api/report', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ kind, text, ctx: context() }) });
      if (r.status === 429) throw new Error('제보를 너무 많이 보냈어요. 10분 뒤에 다시 보내 주세요.');
      if (!r.ok) throw new Error('보내지 못했어요. 잠시 후 다시 시도해 주세요.');
      modal.querySelector('.rp-card')!.replaceChildren(h('h2', '고마워요! 🙏'), h('p.hint', '제보가 전달됐어요. 지금 화면 상황도 같이 보냈어요.'), h('button.btn.wide', { onclick: () => modal.remove() }, '닫기'));
    } catch (e) { msg.textContent = (e as Error).message; (send as HTMLButtonElement).disabled = false; }
  } }, '보내기');
  const modal = h('div.overlay.rp-modal', { onclick: (e: Event) => { if (e.target === modal) modal.remove(); } },
    h('div.card.rp-card',
      h('h2', '🐞 버그 제보'),
      h('p.hint', '지금 방, 게임 단계, 내 직업, 연결 상태, 최근 기록이 같이 전송돼요. 다른 사람에게는 보이지 않아요.'),
      kindRow, ta, msg,
      h('div.rp-btns', h('button.btn', { onclick: () => modal.remove() }, '취소'), send)));
  ta.addEventListener('keydown', (e) => e.stopPropagation());
  (document.getElementById('stage') ?? document.body).appendChild(modal);
  setTimeout(() => ta.focus(), 50);
}

/** 오른쪽 아래 🐞 버튼 (소리 버튼 옆) */
export function reportButton() {
  const b = h('button.report-btn', { title: '버그 제보', 'aria-label': '버그 제보', onclick: () => openReport() }, '🐞');
  document.getElementById('app')!.appendChild(b);
}
