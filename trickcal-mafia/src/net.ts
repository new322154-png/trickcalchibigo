/**
 * 방 서버 연결. 끊겨도 스스로 다시 붙는다.
 *  - 한 번에 하나의 연결 시도만 (single-flight). 이전 시도의 늦은 이벤트는 attempt 번호로 무시
 *  - 다시 붙기: 바로 → 1·2·4·8·10초 (각각 무작위로 흩뜨림), 최대 약 2분
 *  - 화면으로 돌아오거나 인터넷이 다시 잡히면 기다리지 않고 바로 확인
 *  - 10초마다 핑. 서버에서 25초 넘게 아무것도 안 오면 반쯤 끊긴 소켓으로 보고 새로 연결
 *  - 서버가 '없는 방'·'입장 거절'·'다른 탭에서 접속'으로 닫으면 다시 붙지 않는다
 */
import type { C2S, S2C } from '../shared/protocol';

export type LinkState = 'connecting' | 'open' | 'reconnecting' | 'closed';

export interface RoomLink {
  send(m: C2S): void;
  close(): void;
  onMessage: (m: S2C) => void;
  /** 더는 다시 붙지 않는 끊김 */
  onClose: (reason: string) => void;
  /** 연결 상태가 바뀜 (화면에 '다시 연결 중' 표시용) */
  onState: (s: LinkState, info?: { attempt: number; rtt?: number }) => void;
  /** 최근 왕복 시간(ms), 마지막 수신 후 경과(ms) — 디버그 표시용 */
  stats(): { rtt: number; lastRx: number; state: LinkState };
}

export async function api(path: string): Promise<{ code: string }> {
  const r = await fetch(path, { method: 'POST' });
  if (r.status === 429) throw new Error('방을 너무 자주 만들었어요. 1분 뒤에 다시 시도해 주세요.');
  if (!r.ok) throw new Error('서버에 연결할 수 없어요. 잠시 후 다시 시도해 주세요.');
  return r.json();
}

const PING_MS = 10_000;
const SILENT_MS = 25_000;
const GIVE_UP_MS = 120_000;
const BACKOFF = [0, 1000, 2000, 4000, 8000, 10_000];
/** 다시 붙지 않는 종료 코드 */
const FATAL: Record<number, string> = {
  4001: '들어갈 수 없는 방이에요.',
  4004: '없는 방이에요. (서버가 다시 시작돼 판이 끝났을 수 있어요)',
  4009: '다른 탭(또는 기기)에서 이 자리로 다시 접속했어요.',
  4011: '새 버전이 나왔어요! 새로고침(F5)해 주세요.',
  4013: '비정상적인 메시지가 많아 연결을 끊었어요.',
  4012: '방이 꽉 찬 상태에서 오래 잠수해서 방에서 나갔어요.',
  4014: '강퇴 투표로 방에서 나갔어요.',
};

/** hello 는 연결할 때마다 새로 만든다 (최신 재접속 토큰을 넣기 위해) */
/** 지금 쓰는 연결 (디버그 표시용) */
export let currentLink: RoomLink | null = null;

export function connect(code: string, hello: () => C2S): RoomLink {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const url = `${proto}//${location.host}/ws/${code}`;
  let ws: WebSocket | null = null;
  let attempt = 0;
  let tries = 0;
  let state: LinkState = 'connecting';
  let stopped = false;
  let lastRx = performance.now();
  let downSince = 0;
  let retryTimer = 0;
  let pingSent = 0;
  let rtt = 0;

  const setState = (s: LinkState) => { if (state === s && s !== 'reconnecting') return; state = s; link.onState(s, { attempt: tries, rtt }); };

  const link: RoomLink = {
    send: (m) => { if (ws && ws.readyState === WebSocket.OPEN) { try { ws.send(JSON.stringify(m)); } catch { /* 닫히는 중 */ } } },
    close: () => { stop(); },
    onMessage: () => {},
    onClose: () => {},
    onState: () => {},
    stats: () => ({ rtt, lastRx: performance.now() - lastRx, state }),
  };

  function stop() {
    stopped = true;
    clearTimeout(retryTimer);
    clearInterval(pinger);
    removeEventListener('online', wake);
    document.removeEventListener('visibilitychange', onVis);
    removeEventListener('pageshow', wake);
    const w = ws;
    ws = null;
    try { w?.close(1000, 'bye'); } catch { /* 무시 */ }
    state = 'closed';
  }

  function open() {
    if (stopped) return;
    clearTimeout(retryTimer);
    const my = ++attempt;
    const old = ws;
    ws = null;
    try { old?.close(1000, 'replaced'); } catch { /* 무시 */ }
    let w: WebSocket;
    try { w = new WebSocket(url); } catch { scheduleRetry(); return; }
    ws = w;
    w.onopen = () => {
      if (my !== attempt) return;
      lastRx = performance.now();
      try { w.send(JSON.stringify(hello())); } catch { /* 무시 */ }
    };
    w.onmessage = (e) => {
      if (my !== attempt) return;
      lastRx = performance.now();
      let m: S2C;
      try { m = JSON.parse(String(e.data)); } catch { return; }
      if (m.t === 'pong') { if (pingSent) { rtt = Math.round(performance.now() - pingSent); pingSent = 0; } return; }
      if (m.t === 'welcome' || state !== 'open') { tries = 0; downSince = 0; setState('open'); }
      link.onMessage(m);
    };
    w.onclose = (e) => {
      if (my !== attempt || stopped) return;
      ws = null;
      const fatal = FATAL[e.code];
      if (fatal) { stop(); link.onClose(fatal); return; }
      scheduleRetry();
    };
    w.onerror = () => { /* onclose 가 이어서 온다 */ };
  }

  function scheduleRetry() {
    if (stopped) return;
    if (!downSince) downSince = performance.now();
    if (performance.now() - downSince > GIVE_UP_MS) { stop(); link.onClose('연결이 끊어졌어요.'); return; }
    const cap = BACKOFF[Math.min(tries, BACKOFF.length - 1)];
    tries++;
    setState('reconnecting');
    // full jitter: 0 ~ cap
    retryTimer = window.setTimeout(open, cap ? Math.random() * cap : 0);
  }

  /** 지금 연결이 믿을 만한지 보고, 아니면 바로 새로 연결 */
  function check(force = false) {
    if (stopped) return;
    const stale = performance.now() - lastRx > SILENT_MS;
    if (!ws || ws.readyState === WebSocket.CLOSED || ws.readyState === WebSocket.CLOSING || stale || force) {
      if (ws && ws.readyState === WebSocket.CONNECTING && !stale) return; // 이미 붙는 중
      tries = 0;
      setState('reconnecting');
      open();
    }
  }

  const pinger = window.setInterval(() => {
    if (document.hidden) return; // 숨겨진 탭에선 타이머가 늦게 돈다
    if (ws?.readyState === WebSocket.OPEN) { pingSent = performance.now(); link.send({ t: 'ping' }); }
    check();
  }, PING_MS);
  // 화면으로 돌아오면: 마지막 수신이 오래됐으면 새로 연결, 아니면 핑으로 확인
  const wake = () => { if (performance.now() - lastRx > 8000) check(true); else if (ws?.readyState === WebSocket.OPEN) { pingSent = performance.now(); link.send({ t: 'ping' }); } else check(); };
  const onVis = () => { if (!document.hidden) wake(); };
  addEventListener('online', wake);
  addEventListener('pageshow', wake);
  document.addEventListener('visibilitychange', onVis);

  open();
  currentLink = link;
  return link;
}
