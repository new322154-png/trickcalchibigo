/**
 * Cloudflare Worker: 정적 화면 + 방 서버.
 *   POST /api/match         빠른 매칭 → { code }
 *   POST /api/room          방 만들기 → { code }
 *   GET  /api/room/:code    방이 있는지 → { ok, count }
 *   GET  /ws/:code          방 웹소켓
 *   POST /api/report        버그 제보 (Lobby 의 SQLite 에 최근 1000개 + 실시간 로그)
 *   GET  /api/reports?key=  제보 목록 (환경 변수 REPORT_KEY 를 설정했을 때만)
 * 방마다 Durable Object(Room) 하나, 방 목록은 Lobby 하나가 관리한다.
 */
import { RoomCore } from '../shared/room';
import { MAX_PLAYERS, PROTOCOL, type C2S, type S2C } from '../shared/protocol';

interface Env {
  ASSETS: { fetch(req: Request): Promise<Response> };
  ROOM: DurableObjectNamespace;
  LOBBY: DurableObjectNamespace;
  /** 제보 목록을 볼 때 쓰는 비밀 열쇠 (Cloudflare 대시보드 → 설정 → 변수 및 비밀) */
  REPORT_KEY?: string;
}

const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status, headers: { 'content-type': 'application/json' } });
/** 메시지 한 개 최대 길이 (글자 수). 가장 긴 정상 메시지(쪽지·채팅)도 1KB 안팎 */
const MAX_MSG = 4096;
/** 방 만들기 제한: IP 하나당 1분에 6개, 전체 방 500개 */
const CREATE_PER_MIN = 6;
const MAX_ROOMS = 500;
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const newCode = () => Array.from({ length: 5 }, () => CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]).join('');

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    const lobby = () => env.LOBBY.get(env.LOBBY.idFromName('main'));
    const ip = req.headers.get('CF-Connecting-IP') ?? 'local';
    if (url.pathname === '/api/match' && req.method === 'POST') return lobby().fetch('https://lobby/match', { method: 'POST', headers: { 'x-ip': ip } });
    if (url.pathname === '/api/room' && req.method === 'POST') return lobby().fetch('https://lobby/create', { method: 'POST', headers: { 'x-ip': ip } });
    if (url.pathname === '/api/report' && req.method === 'POST') {
      const body = await req.text();
      if (body.length > 20_000) return json({ error: 'too big' }, 413);
      return lobby().fetch('https://lobby/report', { method: 'POST', headers: { 'x-ip': ip, 'x-ua': req.headers.get('user-agent') ?? '' }, body });
    }
    if (url.pathname === '/api/reports' && req.method === 'GET') {
      if (!env.REPORT_KEY || url.searchParams.get('key') !== env.REPORT_KEY) return json({ error: 'forbidden' }, 403);
      return lobby().fetch(`https://lobby/reports?${url.searchParams}`);
    }
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
  constructor(private ctx: DurableObjectState, private env: Env) {
    // 방 목록은 SQLite 에도 적어 둔다 (Lobby 가 쉬다가 다시 깨어나도 목록이 남게)
    ctx.blockConcurrencyWhile(async () => {
      this.sql('CREATE TABLE IF NOT EXISTS rooms (code TEXT PRIMARY KEY, pub INTEGER, count INTEGER, in_game INTEGER, at INTEGER)');
      this.sql('CREATE TABLE IF NOT EXISTS reports (id INTEGER PRIMARY KEY AUTOINCREMENT, at INTEGER, kind TEXT, text TEXT, ctx TEXT, ua TEXT)');
      for (const r of this.sql('SELECT code, pub, count, in_game, at FROM rooms')) {
        this.rooms.set(String(r.code), { pub: !!r.pub, count: Number(r.count), at: Number(r.at), inGame: !!r.in_game });
      }
    });
  }
  private sql(q: string, ...b: unknown[]) { try { return this.ctx.storage.sql.exec(q, ...b).toArray(); } catch { return []; } }
  private save(code: string) {
    const r = this.rooms.get(code);
    if (r) this.sql('INSERT OR REPLACE INTO rooms (code, pub, count, in_game, at) VALUES (?, ?, ?, ?, ?)', code, r.pub ? 1 : 0, r.count, r.inGame ? 1 : 0, r.at);
    else this.sql('DELETE FROM rooms WHERE code = ?', code);
  }

  private made = new Map<string, number[]>();
  private reported = new Map<string, number[]>();
  /** 같은 IP가 짧은 시간에 방을 너무 많이 만들면 거절 */
  private canCreate(ip: string) {
    if (this.rooms.size >= MAX_ROOMS) return false;
    const t = Date.now();
    const list = (this.made.get(ip) ?? []).filter((x) => t - x < 60_000);
    if (list.length >= CREATE_PER_MIN) { this.made.set(ip, list); return false; }
    list.push(t);
    this.made.set(ip, list);
    if (this.made.size > 5000) this.made.clear();
    return true;
  }

  private async create(pub: boolean) {
    let code = newCode();
    while (this.rooms.has(code)) code = newCode();
    // 한국 사용자가 대부분이라 새 방은 아시아 쪽에 만들어 달라고 요청 (보장은 아님, 처음 만들 때만 효과)
    const stub = this.env.ROOM.get(this.env.ROOM.idFromName(code), { locationHint: 'apac' });
    await stub.fetch('https://room/init', { method: 'POST', body: JSON.stringify({ code, pub }) });
    this.rooms.set(code, { pub, count: 0, at: Date.now() });
    this.save(code);
    return code;
  }

  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);
    // 오래 비어 있는 방 정리
    // 비었거나, 30분 넘게 소식 없는 방은 목록에서 정리
    for (const [c, r] of this.rooms) if ((r.count === 0 && Date.now() - r.at > 10 * 60_000) || Date.now() - r.at > 30 * 60_000) { this.rooms.delete(c); this.save(c); }
    if (url.pathname === '/match') {
      const open = [...this.rooms].filter(([, r]) => r.pub && !r.inGame && r.count > 0 && r.count < MAX_PLAYERS).sort((a, b) => b[1].count - a[1].count);
      if (open.length) return json({ code: open[0][0] });
      if (!this.canCreate(req.headers.get('x-ip') ?? '')) return json({ error: 'busy' }, 429);
      return json({ code: await this.create(true) });
    }
    if (url.pathname === '/create') {
      if (!this.canCreate(req.headers.get('x-ip') ?? '')) return json({ error: 'busy' }, 429);
      return json({ code: await this.create(false) });
    }
    const info = url.pathname.match(/^\/info\/(\w+)$/);
    if (info) {
      const r = this.rooms.get(info[1]);
      return json({ ok: !!r, count: r?.count ?? 0, full: (r?.count ?? 0) >= MAX_PLAYERS });
    }
    if (url.pathname === '/report' && req.method === 'POST') {
      // 같은 곳에서 10분에 5개까지
      const ip = req.headers.get('x-ip') ?? '';
      const t = Date.now();
      const list = (this.reported.get(ip) ?? []).filter((x) => t - x < 10 * 60_000);
      if (list.length >= 5) return json({ error: 'busy' }, 429);
      list.push(t); this.reported.set(ip, list);
      if (this.reported.size > 5000) this.reported.clear();
      let r: { kind?: string; text?: string; ctx?: unknown };
      try { r = await req.json(); } catch { return json({ error: 'bad' }, 400); }
      const kind = String(r.kind ?? 'bug').slice(0, 20), text = String(r.text ?? '').slice(0, 1000), ctx = JSON.stringify(r.ctx ?? {}).slice(0, 16_000);
      if (!text.trim()) return json({ error: 'empty' }, 400);
      this.sql('INSERT INTO reports (at, kind, text, ctx, ua) VALUES (?, ?, ?, ?, ?)', t, kind, text, ctx, (req.headers.get('x-ua') ?? '').slice(0, 300));
      this.sql('DELETE FROM reports WHERE id <= (SELECT MAX(id) - 1000 FROM reports)');
      console.log(JSON.stringify({ report: kind, text, ctx: r.ctx }));
      return json({ ok: true });
    }
    if (url.pathname === '/reports') {
      const rows = this.sql('SELECT id, at, kind, text, ctx, ua FROM reports ORDER BY id DESC LIMIT ?', Math.min(500, Number(url.searchParams.get('n')) || 100));
      if (url.searchParams.get('format') === 'json') return json(rows);
      const esc = (v: unknown) => String(v ?? '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]!);
      const html = `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>버그 제보</title>
<style>body{font-family:sans-serif;max-width:900px;margin:20px auto;padding:0 12px;background:#14161f;color:#e8e8f0}article{border:1px solid #333a50;border-radius:8px;padding:10px 14px;margin:10px 0;background:#1c1f2c}b{color:#ffd38a}pre{white-space:pre-wrap;font-size:12px;color:#a9b0c8;max-height:300px;overflow:auto}small{color:#8890b0}</style>
<h1>버그 제보 (${rows.length})</h1>${rows.map((x) => `<article><small>#${x.id} · ${new Date(Number(x.at)).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })} · ${esc(x.kind)}</small><p><b>${esc(x.text)}</b></p><details><summary>상황 보기</summary><pre>${esc(JSON.stringify(JSON.parse(String(x.ctx || '{}')), null, 2))}</pre><small>${esc(x.ua)}</small></details></article>`).join('')}`;
      return new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8' } });
    }
    if (url.pathname === '/update' && req.method === 'POST') {
      const { code, count, inGame } = (await req.json()) as { code: string; count: number; inGame: boolean };
      const r = this.rooms.get(code);
      if (r) { r.count = count; r.at = Date.now(); r.inGame = inGame; this.save(code); }
      return json({ ok: true });
    }
    return json({ error: 'not found' }, 404);
  }
}

/** 방 하나 */
export class Room {
  core: RoomCore | null = null;
  private meta: { code: string; pub: boolean; inGame: boolean } | null = null;
  constructor(private ctx: DurableObjectState, private env: Env) {
    // 서버가 다시 시작돼 메모리가 비었으면: 저장해 둔 방 정보로 빈 대기실을 다시 연다.
    // 진행 중이던 판은 복구하지 못하므로, 들어오는 사람에게 그렇게 알려 준다.
    ctx.blockConcurrencyWhile(async () => {
      const m = await ctx.storage.get<{ code: string; pub: boolean; inGame: boolean }>('meta');
      if (m && !this.core) {
        this.meta = m;
        this.makeCore(m.code, m.pub);
        if (m.inGame) this.core!.notice = '⚠ 서버가 다시 시작돼 진행 중이던 판이 끝났어요. 대기실에서 다시 시작해 주세요.';
      }
    });
  }

  private makeCore(code: string, pub: boolean) {
    this.core = new RoomCore(code, pub);
    // 1분마다 한 줄 요약 (대시보드 실시간 로그 / wrangler tail 에서 보임)
    this.core.onStats = (s) => console.log(JSON.stringify({ room: code, ...s }));
    this.core.onCount = (n, inGame) => {
      const lobby = this.env.LOBBY.get(this.env.LOBBY.idFromName('main'));
      void lobby.fetch('https://lobby/update', { method: 'POST', body: JSON.stringify({ code, count: n, inGame }) }).catch(() => {});
      if (this.meta && this.meta.inGame !== inGame) { this.meta.inGame = inGame; void this.ctx.storage.put('meta', this.meta).catch(() => {}); }
    };
  }

  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);
    if (url.pathname === '/init') {
      const { code, pub } = (await req.json()) as { code: string; pub: boolean };
      this.meta = { code, pub, inGame: false };
      await this.ctx.storage.put('meta', this.meta);
      this.makeCore(code, pub);
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
      send: (m: S2C) => {
        const s = JSON.stringify(m);
        core.stats.out++; core.stats.bytes += s.length;
        try { server.send(s); } catch { /* 이미 닫힌 소켓 */ }
      },
      close: (code: number, reason: string) => { try { server.close(code, reason); } catch { /* 이미 닫힘 */ } },
      ip: req.headers.get('CF-Connecting-IP') ?? undefined,
    };
    // 10초 안에 hello 가 없으면 닫음
    const helloTimer = setTimeout(() => { if (id === null) { try { server.close(4002, 'no hello'); } catch { /* 무시 */ } } }, 10_000);
    let bad = 0;
    server.addEventListener('message', (ev: MessageEvent) => {
      // 문자열·크기 검사를 파싱보다 먼저 (정상 메시지는 수백 바이트)
      if (typeof ev.data !== 'string' || ev.data.length > MAX_MSG) {
        if (++bad > 20) { try { server.close(4013, 'bad messages'); } catch { /* 무시 */ } }
        return;
      }
      let msg: C2S;
      try { msg = JSON.parse(ev.data); } catch { return; }
      if (!msg || typeof msg !== 'object') return;
      if (id === null) {
        if ((msg as { t?: string }).t !== 'hello') return;
        clearTimeout(helloTimer);
        if ((msg as { v?: number }).v !== PROTOCOL) { try { server.close(4011, 'update'); } catch { /* 무시 */ } return; }
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
