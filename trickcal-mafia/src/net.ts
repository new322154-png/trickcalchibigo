/** 방 서버 연결 */
import type { C2S, S2C } from '../shared/protocol';

export interface RoomLink {
  send(m: C2S): void;
  close(): void;
  onMessage: (m: S2C) => void;
  onClose: (reason: string) => void;
}

export async function api(path: string): Promise<{ code: string }> {
  const r = await fetch(path, { method: 'POST' });
  if (!r.ok) throw new Error('서버에 연결할 수 없어요.');
  return r.json();
}

export function connect(code: string, hello: C2S): RoomLink {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const ws = new WebSocket(`${proto}//${location.host}/ws/${code}`);
  let closedByMe = false;
  const link: RoomLink = {
    send: (m) => { if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(m)); },
    close: () => { closedByMe = true; ws.close(); },
    onMessage: () => {},
    onClose: () => {},
  };
  ws.onopen = () => ws.send(JSON.stringify(hello));
  ws.onmessage = (e) => { try { link.onMessage(JSON.parse(String(e.data))); } catch { /* 무시 */ } };
  ws.onclose = (e) => { if (!closedByMe) link.onClose(e.code === 4004 ? '없는 방이에요.' : e.code === 4001 ? '들어갈 수 없는 방이에요.' : '연결이 끊어졌어요.'); };
  const ping = setInterval(() => link.send({ t: 'ping' }), 20000);
  ws.addEventListener('close', () => clearInterval(ping));
  return link;
}
