/**
 * Cloudflare Worker: 정적 화면 + 방 서버.
 *   POST /api/match         빠른 매칭 → { code }
 *   POST /api/room          방 만들기 → { code }
 *   GET  /api/room/:code    방이 있는지 → { ok, count }
 *   GET  /ws/:code          방 웹소켓
 * 방마다 Durable Object(Room) 하나, 방 목록은 Lobby 하나가 관리한다.
 */
import { RoomCore } from '../shared/room';
import { MAX_PLAYERS, type C2S, type S2C } from '../shared/protocol';

interface Env {
  ASSETS: { fetch(req: Request): Promise<Response> };
  ROOM: DurableObjectNamespace;
  LOBBY: DurableObjectNamespace;
}

const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status, headers: { 'content-type': 'application/json' } });
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const newCode = () => Array.from({ length: 5 }, () => CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]).join('');

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    const lobby = () => env.LOBBY.get(env.LOBBY.idFromName('main'));
    if (url.pathname === '/api/match' && req.method === 'POST') return lobby().fetch('https://lobby/match', { method: 'POST' });
    if (url.pathname === '/api/room' && req.method === 'POST') return lobby().fetch('https://lobby/create', { method: 'POST' });
    const info = url.pathname.match(/^\/api\/room\/([A-Z0-9]{5})$/);
    if (info) return lobby().fetch(`https://lobby/info/${info[1]}`);
    const ws = url.pathname.match(/^\/ws\/([A-Z0-9]{5})$/);
    if (ws) {
      if (req.headers.get('Upgrade') !== 'websocket') return new Response('websocket only', { status: 426 });
      return env.ROOM.get(env.ROOM.idFromName(ws[1])).fetch(req);
    }
    return env.ASSETS.fetch(req);
  },
};

/** 방 목록: 공개 방(빠른 매칭)과 비공개 방(방 만들기) */
export class Lobby {
  rooms = new Map<string, { pub: boolean; count: number; at: number; inGame?: boolean }>();
  constructor(private ctx: DurableObjectState, private env: Env) {}

  private async create(pub: boolean) {
    let code = newCode();
    while (this.rooms.has(code)) code = newCode();
    const stub = this.env.ROOM.get(this.env.ROOM.idFromName(code));
    await stub.fetch('https://room/init', { method: 'POST', body: JSON.stringify({ code, pub }) });
    this.rooms.set(code, { pub, count: 0, at: Date.now() });
    return code;
  }

  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);
    // 오래 비어 있는 방 정리
    for (const [c, r] of this.rooms) if (r.count === 0 && Date.now() - r.at > 10 * 60_000) this.rooms.delete(c);
    if (url.pathname === '/match') {
      const open = [...this.rooms].filter(([, r]) => r.pub && !r.inGame && r.count > 0 && r.count < MAX_PLAYERS).sort((a, b) => b[1].count - a[1].count);
      return json({ code: open.length ? open[0][0] : await this.create(true) });
    }
    if (url.pathname === '/create') return json({ code: await this.create(false) });
    const info = url.pathname.match(/^\/info\/(\w+)$/);
    if (info) {
      const r = this.rooms.get(info[1]);
      return json({ ok: !!r, count: r?.count ?? 0, full: (r?.count ?? 0) >= MAX_PLAYERS });
    }
    if (url.pathname === '/update' && req.method === 'POST') {
      const { code, count, inGame } = (await req.json()) as { code: string; count: number; inGame: boolean };
      const r = this.rooms.get(code);
      if (r) { r.count = count; r.at = Date.now(); r.inGame = inGame; }
      return json({ ok: true });
    }
    return json({ error: 'not found' }, 404);
  }
}

/** 방 하나 */
export class Room {
  core: RoomCore | null = null;
  constructor(private ctx: DurableObjectState, private env: Env) {}

  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);
    if (url.pathname === '/init') {
      const { code, pub } = (await req.json()) as { code: string; pub: boolean };
      this.core = new RoomCore(code, pub);
      this.core.onCount = (n, inGame) => {
        const lobby = this.env.LOBBY.get(this.env.LOBBY.idFromName('main'));
        void lobby.fetch('https://lobby/update', { method: 'POST', body: JSON.stringify({ code, count: n, inGame }) }).catch(() => {});
      };
      return json({ ok: true });
    }
    const pair = new WebSocketPair();
    const [client, server] = [pair[0], pair[1]];
    server.accept();
    const core = this.core;
    if (!core) {
      server.send(JSON.stringify({ t: 'error', text: '없는 방이거나 이미 사라진 방이에요.' } satisfies S2C));
      server.close(4004, 'no room');
      return new Response(null, { status: 101, webSocket: client });
    }
    let id: number | null = null;
    // 이 소켓 하나를 뜻하는 연결 객체. 재접속으로 교체되면 core 가 더는 이 객체를 현재 연결로 보지 않는다
    const conn = {
      send: (m: S2C) => { try { server.send(JSON.stringify(m)); } catch { /* 이미 닫힌 소켓 */ } },
      close: (code: number, reason: string) => { try { server.close(code, reason); } catch { /* 이미 닫힘 */ } },
    };
    server.addEventListener('message', (ev: MessageEvent) => {
      let msg: C2S;
      try { msg = JSON.parse(String(ev.data)); } catch { return; }
      if (id === null) {
        id = core.join(conn, msg);
        if (id === null) server.close(4001, 'rejected');
      } else if (core.isCurrent(id, conn)) core.handle(id, msg);
      // 교체된 옛 소켓의 메시지는 무시
    });
    const bye = () => { if (id !== null) core.disconnect(id, conn); id = null; };
    server.addEventListener('close', bye);
    server.addEventListener('error', bye);
    return new Response(null, { status: 101, webSocket: client });
  }
}
