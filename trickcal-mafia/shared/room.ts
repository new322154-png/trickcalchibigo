/**
 * 방 하나의 로직 (대기실 · 채팅 · 멀티 미니게임).
 * Cloudflare Durable Object(worker/index.ts)와 로컬 테스트 서버가 같이 쓴다.
 * 판정은 모두 서버가 한다.
 */
import { QUIZ } from './quiz';
import { MafiaGame, type GameTest } from './mafia';
import { BotBrain } from './bot';
import { ROLES, type RoleId } from './roles';
import { censor, cleanText, isSpam } from './filter';
import {
  AUTO_START, EMOTES, EMOTE_GAP, GAME_MIN, CHARACTERS, MAX_PLAYERS, SPEED, WALK_TOP, WORLD_H, WORLD_W, clamp, isChar,
  type C2S, type Chair, type MiniId, type MiniState, type PlayerInfo, type S2C, MINI_NAMES,
} from './protocol';

export interface Conn {
  send(msg: S2C): void;
  /** 서버 쪽에서 소켓을 닫는다 (교체됨·무응답). 봇 등은 없음 */
  close?(code: number, reason: string): void;
  /** 접속한 곳 (강퇴 투표로 쫓겨난 사람이 바로 다시 못 들어오게) */
  ip?: string;
}

/** 대기실에서 잠깐 끊긴 사람을 기다리는 시간 (휴대폰 앱 전환 등) */
const LOBBY_GRACE = 15_000;
/** 게임 중 끊긴 사람을 기다리는 시간 */
const GAME_GRACE = 30_000;
/** 이 시간 동안 아무 메시지(핑 포함)가 없으면 끊긴 것으로 본다 */
const SILENT_LIMIT = 35_000;
/** 방이 꽉 찼을 때 대기실 잠수: 이만큼 아무것도 안 하면 경고, 경고 뒤 이만큼 더 지나면 내보냄 */
const AFK_WARN = 20_000;
const AFK_KICK = 10_000;
/** 강퇴 투표: 시간 · 같은 사람이 다시 열 수 있을 때까지 · 쫓겨난 사람이 다시 못 들어오는 시간 */
const KICK_VOTE_MS = 30_000;
const KICK_COOLDOWN = 60_000;
const KICK_BAN_MS = 10 * 60_000;

interface P extends PlayerInfo {
  conn: Conn;
  token: string;
  online: boolean;
  dropTimer?: ReturnType<typeof setTimeout>;
  lastMoveAt: number;
  moved: boolean;
  chatTimes: number[];
  joinedAt: number;
  brain?: BotBrain;
  /** 마지막으로 이 사람에게서 메시지를 받은 시각 */
  lastSeen: number;
  /** 메시지 종류별 허용량 (token bucket) */
  buckets?: Record<string, [number, number]>;
  /** 마지막으로 직접 뭔가 한 시각 (핑 빼고) — 대기실 잠수 판정 */
  lastAct: number;
  /** 잠수 경고를 보낸 시각 */
  afkWarnAt?: number;
  /** 도배 판정용 최근 채팅 */
  said: [number, string][];
  /** 마지막으로 강퇴 투표를 연 시각 */
  kickAt?: number;
  /** 마지막 감정표현 시각 */
  emoteAt?: number;
}

const now = () => Date.now();

/** 방장이 보내는 테스트·촬영 설정 */
export interface TestReq { roles?: Record<string, string>; speed?: number; godKill?: boolean; botVote?: boolean; botAct?: boolean; botChat?: boolean }

/** 메시지 종류별 [초당 회복, 최대 몰림]. 정상 플레이보다 넉넉하게, 넘치면 조용히 버린다 */
const LIMITS: Record<string, [number, number]> = {
  move: [20, 40],   // 이동 (클라 약 11Hz)
  cmd: [6, 12],     // 투표·능력·선택·시간·쪽지·방장 명령
  chat: [1, 5],     // 채팅 (5초에 5개 정도)
  misc: [5, 10],    // 핑 등
};
const KIND: Partial<Record<C2S['t'], string>> = {
  move: 'move', pmove: 'move', fmove: 'move', cmove: 'move',
  chat: 'chat', gchat: 'chat',
  act: 'cmd', vote: 'cmd', choice: 'cmd', time: 'cmd', drone: 'cmd', note: 'cmd', start_game: 'cmd',
  add_bot: 'cmd', remove_bot: 'cmd', start_mini: 'cmd', stop_mini: 'cmd', press: 'cmd', kick: 'cmd', kickvote: 'cmd', mvp: 'cmd', emote: 'cmd',
};
const rnd = (a: number, b: number) => a + Math.random() * (b - a);
const pickOne = <T>(a: T[]) => a[Math.floor(Math.random() * a.length)];
const dist = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y);

export class RoomCore {
  players = new Map<number, P>();
  private seq = 0;
  mini: MiniState | null = null;
  private timers: ReturnType<typeof setTimeout>[] = [];
  private flushTimer: ReturnType<typeof setInterval> | null = null;
  /** 인원이 바뀔 때 (로비에 알리기) */
  onCount: (n: number, inGame: boolean) => void = () => {};
  game: MafiaGame | null = null;
  private autoTimer: ReturnType<typeof setTimeout> | null = null;
  private autoAt: number | null = null;

  /** 1분 집계 (운영 로그용): 받은 메시지 수, 보낸 메시지 수·바이트 (보내기 쪽은 서버 연결부가 센다) */
  stats = { in: 0, out: 0, bytes: 0, since: Date.now() };
  onStats: (s: Record<string, unknown>) => void = () => {};
  /** 들어오는 사람에게 한 번 보여 줄 안내 (서버 재시작 등) */
  notice: string | null = null;
  /** 진행 중인 강퇴 투표 */
  private kv: { target: number; by: number; yes: Set<number>; no: Set<number>; endsAt: number; timer: ReturnType<typeof setTimeout> } | null = null;
  /** 강퇴 투표로 쫓겨난 곳 [ip, 풀리는 시각] */
  private banned = new Map<string, number>();
  constructor(public code: string, public pub: boolean) {}

  get count() { return this.players.size; }

  // ── 입장 · 퇴장 ──────────────────────────────────

  join(conn: Conn, hello: C2S, bot = false): number | null {
    if (hello.t !== 'hello') return null;
    // 재접속 (게임 중 끊겼다가 30초 안에 돌아옴)
    // (아직 살아 있는 연결이어도 같은 토큰이면 새 소켓으로 교체: 휴대폰이 돌아와 새로 붙은 경우)
    const back = hello.token ? [...this.players.values()].find((p) => !p.bot && p.token === hello.token) : undefined;
    if (back) {
      clearTimeout(back.dropTimer);
      back.dropTimer = undefined;
      // 이전 소켓은 무효: 늦게 오는 close/message 가 새 연결을 건드리지 못하게 (isCurrent 로 걸러짐)
      const old = back.conn;
      back.conn = conn;
      back.online = true;
      back.lastSeen = now();
      try { old.close?.(4009, 'replaced'); } catch { /* 이미 닫힘 */ }
      conn.send({ t: 'welcome', you: back.id, code: this.code, pub: this.pub, players: this.list(), resumed: true });
      conn.send({ t: 'token', token: back.token });
      if (this.autoAt) conn.send({ t: 'starting', at: this.autoAt });
      if (this.mini) conn.send({ t: 'mini', s: this.mini, title: MINI_NAMES[this.mini.game] });
      if (this.kv) conn.send(this.kvMsg());
      back.lastAct = now();
      this.broadcast({ t: 'sys', text: `${back.nick}님이 다시 연결됐어요.` }, back.id);
      // 게임 중이면 지금 화면 + 놓친 기록을 바로 보낸다
      if (this.game?.ps.has(back.id)) this.game.resync(back.id);
      return back.id;
    }
    if (this.game) {
      conn.send({ t: 'error', text: '게임이 진행 중인 방이에요. 끝나면 다시 들어와 주세요.' });
      return null;
    }
    if (this.players.size >= MAX_PLAYERS) {
      conn.send({ t: 'error', text: '방이 가득 찼어요.' });
      return null;
    }
    const ban = conn.ip && conn.ip !== 'local' ? this.banned.get(conn.ip) : undefined;
    if (ban && ban > now()) {
      conn.send({ t: 'error', text: `강퇴 투표로 나간 방이라 ${Math.ceil((ban - now()) / 60_000)}분 동안 들어올 수 없어요.` });
      return null;
    }
    let nick = censor(String(hello.nick ?? '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 10)) || '교주';
    const taken = new Set([...this.players.values()].map((p) => p.nick));
    if (taken.has(nick)) { let i = 2; while (taken.has(`${nick}${i}`)) i++; nick = `${nick}${i}`; }
    const id = ++this.seq;
    const p: P = {
      id, nick, char: isChar(hello.char) ? hello.char : pickOne([...CHARACTERS]).id,
      x: rnd(300, 1300), y: rnd(WALK_TOP + 60, WORLD_H - 80), host: this.players.size === 0,
      conn, lastMoveAt: now(), moved: false, chatTimes: [], joinedAt: now(), lastSeen: now(), lastAct: now(), said: [],
      token: Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2), online: true,
      ...(bot ? { bot: true } : {}),
    };
    this.players.set(id, p);
    conn.send({ t: 'welcome', you: id, code: this.code, pub: this.pub, players: this.list() });
    conn.send({ t: 'token', token: p.token });
    if (this.autoAt) conn.send({ t: 'starting', at: this.autoAt });
    if (this.mini) conn.send({ t: 'mini', s: this.mini, title: MINI_NAMES[this.mini.game] });
    if (this.notice) conn.send({ t: 'sys', text: this.notice });
    if (this.kv) conn.send(this.kvMsg());
    this.broadcast({ t: 'join', p: this.info(p) }, id);
    this.broadcast({ t: 'sys', text: `${nick}님이 들어왔어요.` });
    if (!this.flushTimer) this.flushTimer = setInterval(() => this.flush(), 80);
    this.status();
    this.checkAuto();
    return id;
  }

  private status() { this.onCount(this.players.size, !!this.game); }

  /** token bucket: 이 종류의 메시지를 지금 받아도 되는지 */
  private allow(p: P, kind: string) {
    const [rate, burst] = LIMITS[kind] ?? LIMITS.misc;
    const t = now();
    const b = ((p.buckets ??= {})[kind] ??= [burst, t]);
    b[0] = Math.min(burst, b[0] + ((t - b[1]) / 1000) * rate);
    b[1] = t;
    if (b[0] < 1) return false;
    b[0] -= 1;
    return true;
  }

  /** 이 소켓이 지금 이 사람의 연결인지 (재접속으로 교체된 옛 소켓은 아님) */
  isCurrent(id: number, conn: Conn) { return this.players.get(id)?.conn === conn; }

  /**
   * 연결이 끊김 (현재 연결일 때만). 게임 중이면 30초, 대기실이면 15초 기다렸다가 내보낸다.
   * close 와 error 가 둘 다 와도 한 번만 처리된다.
   */
  disconnect(id: number, conn?: Conn) {
    const p = this.players.get(id);
    if (!p || (conn && p.conn !== conn) || !p.online) return;
    p.online = false;
    const inGame = !!this.game && this.game.ps.has(id) && !this.game.over;
    const grace = inGame ? GAME_GRACE : LOBBY_GRACE;
    const mine = p.conn;
    if (inGame) {
      this.broadcast({ t: 'sys', text: `${p.nick}님의 연결이 끊겼어요. 30초 기다릴게요…` });
      this.game!.setOnline(id, false);
    }
    clearTimeout(p.dropTimer);
    p.dropTimer = setTimeout(() => {
      // 그 사이 다시 연결됐거나 다른 소켓으로 바뀌었으면 무시
      if (p.online || p.conn !== mine || !this.players.has(id)) return;
      if (inGame) this.game?.drop(id);
      this.leave(id);
    }, grace);
  }

  /** 오래 아무 말도 없는 연결 정리 (반쯤 끊긴 소켓) */
  private sweep() {
    const t = now();
    for (const p of this.players.values()) {
      if (p.bot || !p.online || t - p.lastSeen < SILENT_LIMIT) continue;
      const c = p.conn;
      this.disconnect(p.id, c);
      try { c.close?.(4008, 'silent'); } catch { /* 이미 닫힘 */ }
    }
  }

  leave(id: number) {
    const p = this.players.get(id);
    if (!p) return;
    clearTimeout(p.dropTimer);
    this.players.delete(id);
    this.broadcast({ t: 'leave', id });
    this.broadcast({ t: 'sys', text: `${p.nick}님이 나갔어요.` });
    p.brain?.destroy();
    if (this.kv) {
      if (this.kv.target === id) this.endKick(false, true);
      else { this.kv.yes.delete(id); this.kv.no.delete(id); this.checkKick(); }
    }
    // 사람이 아무도 없으면 봇도 모두 나간다
    if (!p.bot && [...this.players.values()].every((q) => q.bot)) {
      for (const b of [...this.players.values()]) { b.brain?.destroy(); this.players.delete(b.id); }
      if (this.game) { this.game.dispose(); this.game = null; this.clearTimers(); }
    }
    if (p.host && this.players.size) {
      const next = [...this.players.values()].filter((q) => !q.bot).sort((a, b) => a.joinedAt - b.joinedAt)[0] ?? [...this.players.values()][0];
      next.host = true;
      this.broadcast({ t: 'host', id: next.id });
      this.broadcast({ t: 'sys', text: `${next.nick}님이 방장이 되었어요.` });
    }
    this.miniOnLeave(id);
    if (!this.players.size) {
      if (this.flushTimer) clearInterval(this.flushTimer);
      this.flushTimer = null;
      this.endMini(true);
    }
    this.status();
    this.checkAuto();
  }

  // ── 테스트용 봇 ────────────────────────────────

  /** 방장이 빈자리를 봇으로 채운다 (비공개 방만) */
  private addBot() {
    if (this.game || this.players.size >= MAX_PLAYERS) return;
    const used = new Set([...this.players.values()].map((p) => p.nick));
    let n = 1;
    while (used.has(`봇${n}`)) n++;
    let id = -1;
    const brain = new BotBrain((m) => { if (this.players.has(id)) this.handle(id, m); });
    const conn: Conn = { send: (m) => brain.onMsg(m) };
    const got = this.join(conn, { t: 'hello', nick: `봇${n}`, char: pickOne([...CHARACTERS]).id }, true);
    if (got === null) { brain.destroy(); return; }
    id = got;
    this.players.get(id)!.brain = brain;
  }

  private removeBot() {
    const bots = [...this.players.values()].filter((p) => p.bot).sort((a, b) => b.joinedAt - a.joinedAt);
    if (bots[0]) this.dropBot(bots[0]);
  }

  private dropBot(p: P) {
    p.brain?.destroy();
    this.leave(p.id);
  }

  private info(p: P): PlayerInfo {
    return { id: p.id, nick: p.nick, char: p.char, x: Math.round(p.x), y: Math.round(p.y), host: p.host, ...(p.bot ? { bot: true } : {}) };
  }
  private list() { return [...this.players.values()].map((p) => this.info(p)); }

  broadcast(msg: S2C, except?: number) {
    for (const p of this.players.values()) if (p.id !== except && p.online) {
      try { p.conn.send(msg); } catch { /* 끊긴 연결 */ }
    }
  }

  private lastSweep = 0;
  private lastAfk = 0;
  private flush() {
    const t0 = now();
    if (t0 - this.lastSweep > 5000) { this.lastSweep = t0; this.sweep(); }
    if (t0 - this.lastAfk > 1000) { this.lastAfk = t0; this.afkCheck(); }
    if (t0 - this.stats.since > 60_000) {
      const s = this.stats;
      const humans = [...this.players.values()].filter((p) => !p.bot);
      this.onStats({ players: this.players.size, humans: humans.length, offline: humans.filter((p) => !p.online).length,
        phase: this.game?.phase ?? (this.mini ? 'mini' : 'lobby'), inPerSec: +(s.in / 60).toFixed(1), outPerSec: +(s.out / 60).toFixed(1), kbPerSec: +(s.bytes / 60 / 1024).toFixed(1) });
      this.stats = { in: 0, out: 0, bytes: 0, since: t0 };
    }
    const m: [number, number, number][] = [];
    for (const p of this.players.values()) if (p.moved) { m.push([p.id, Math.round(p.x), Math.round(p.y)]); p.moved = false; }
    if (!m.length) return;
    // 본인 위치는 본인에게 다시 보내지 않는다 (내 화면이 먼저 움직이므로)
    for (const p of this.players.values()) {
      if (!p.online) continue;
      const mine = m.filter(([id]) => id !== p.id);
      if (mine.length) { try { p.conn.send({ t: 'moves', m: mine }); } catch { /* 끊김 */ } }
    }
  }

  // ── 메시지 ──────────────────────────────────────

  handle(id: number, msg: C2S) {
    const p = this.players.get(id);
    if (!p || !msg || typeof msg !== 'object' || typeof msg.t !== 'string') return;
    p.lastSeen = now();
    this.stats.in++;
    if (!p.bot && !this.allow(p, KIND[msg.t] ?? 'misc')) return;
    if (msg.t !== 'ping') { p.lastAct = now(); if (p.afkWarnAt) { p.afkWarnAt = undefined; p.conn.send({ t: 'afk', at: null }); } }
    // 채팅·쪽지: 심한 말 가리기 + 도배 막기 (게임 안팎 모두)
    if (msg.t === 'chat' || msg.t === 'gchat' || msg.t === 'note') {
      const text = cleanText(msg.text, msg.t === 'gchat' ? 120 : 80);
      if (!text) return;
      if (!p.bot && isSpam(p.said, text, now())) {
        p.conn.send(this.game ? { t: 'glog', ch: 'sys', from: -1, text: '같은 말을 너무 자주 보내고 있어요.' } : { t: 'sys', text: '같은 말을 너무 자주 보내고 있어요.' });
        return;
      }
      msg = { ...msg, text };
    }
    if (msg.t === 'emote') { this.emote(p, msg.e); return; }
    if (this.game) {
      if (msg.t === 'ping') p.conn.send({ t: 'pong' });
      else this.game.handle(id, msg);
      return;
    }
    switch (msg.t) {
      case 'start_game':
        if (!p.host) return p.conn.send({ t: 'error', text: '방장만 게임을 시작할 수 있어요.' });
        if (this.players.size < GAME_MIN) return p.conn.send({ t: 'error', text: `${GAME_MIN}명 이상 모여야 시작할 수 있어요.` });
        this.startGame(p.id, msg.test);
        break;
      case 'move': {
        const x = Number(msg.x), y = Number(msg.y);
        if (!Number.isFinite(x) || !Number.isFinite(y)) return;
        if (this.frozen(id)) { p.conn.send({ t: 'pos', x: Math.round(p.x), y: Math.round(p.y) }); return; }
        const t = now();
        // 네트워크가 몰려 와도 끊기지 않게 넉넉히 (마지막 이동 뒤 최대 1초 분량까지)
        const gap = Math.min(1000, t - p.lastMoveAt);
        const maxStep = SPEED * (gap / 1000) * 1.5 + 40;
        const d = Math.hypot(x - p.x, y - p.y);
        const k = d > maxStep ? maxStep / d : 1;
        p.x = clamp(p.x + (x - p.x) * k, 30, WORLD_W - 30);
        p.y = clamp(p.y + (y - p.y) * k, WALK_TOP, WORLD_H - 20);
        p.lastMoveAt = t;
        p.moved = true;
        // 너무 많이 어긋났을 때만 본인에게 위치를 고쳐 준다
        if (Math.hypot(x - p.x, y - p.y) > 150) p.conn.send({ t: 'pos', x: Math.round(p.x), y: Math.round(p.y) });
        this.miniOnMove(p);
        break;
      }
      case 'chat': {
        const text = msg.text;
        if (!text) return;
        const t = now();
        p.chatTimes = p.chatTimes.filter((x) => t - x < 5000);
        if (p.chatTimes.length >= 5) { p.conn.send({ t: 'sys', text: '채팅이 너무 빨라요. 잠시 후에 다시 보내 주세요.' }); return; }
        p.chatTimes.push(t);
        this.broadcast({ t: 'chat', id, text });
        break;
      }
      case 'add_bot':
        if (!p.host) return p.conn.send({ t: 'error', text: '방장만 봇을 넣을 수 있어요.' });
        if (this.pub) return p.conn.send({ t: 'error', text: '봇은 비공개 방에서만 쓸 수 있어요.' });
        if (this.players.size >= MAX_PLAYERS) return p.conn.send({ t: 'error', text: '방이 가득 찼어요.' });
        this.addBot();
        break;
      case 'remove_bot':
        if (p.host) this.removeBot();
        break;
      case 'start_mini':
        if (!p.host) return p.conn.send({ t: 'error', text: '방장만 미니게임을 시작할 수 있어요.' });
        if (this.mini) return;
        if (this.players.size < 2) return p.conn.send({ t: 'error', text: '미니게임은 2명 이상일 때 할 수 있어요.' });
        if (!['reaction', 'ox', 'tag', 'chairs'].includes(msg.game)) return;
        this.startMini(msg.game);
        break;
      case 'stop_mini':
        if (p.host && this.mini) { this.broadcast({ t: 'sys', text: '방장이 미니게임을 끝냈어요.' }); this.endMini(true); }
        break;
      case 'press':
        this.miniOnPress(p);
        break;
      case 'ping':
        p.conn.send({ t: 'pong' });
        break;
      case 'kick':
        this.startKick(p, Number(msg.target));
        break;
      case 'kickvote':
        if (this.kv && this.kv.target !== id && !p.bot) {
          (msg.yes ? this.kv.yes : this.kv.no).add(id);
          (msg.yes ? this.kv.no : this.kv.yes).delete(id);
          this.broadcast(this.kvMsg());
          this.checkKick();
        }
        break;
    }
  }

  // ── 감정표현 (대기실·게임 공통, 10초에 한 번) ─────
  private emote(p: P, e: unknown) {
    if (typeof e !== 'string' || !(EMOTES as readonly string[]).includes(e)) return;
    const t = now();
    if (p.emoteAt && t - p.emoteAt < EMOTE_GAP - 300) return;
    if (this.game) { if (!this.game.emote(p.id, e)) return; }
    else this.broadcast({ t: 'emote', id: p.id, e });
    p.emoteAt = t;
  }

  // ── 대기실 잠수 · 강퇴 투표 ──────────────────────

  /** 방이 꽉 찼는데 대기실에서 오래 아무것도 안 하는 사람: 경고 → 10초 뒤 내보냄 */
  private afkCheck() {
    const t = now();
    // 가장 오래 가만히 있던 사람부터
    for (const p of [...this.players.values()].sort((a, b) => a.lastAct - b.lastAct)) {
      if (p.bot || !p.online) continue;
      // 한 명이 나가 자리가 생기면 나머지는 경고가 풀린다 (자리 하나 만들 만큼만 내보냄)
      const full = this.players.size >= MAX_PLAYERS && !this.game && !this.mini;
      if (!full) {
        // 게임·미니게임 중이거나 자리가 남으면 잠수 아님 (끝나고 돌아왔을 때 바로 경고받지 않게 시간도 당겨 둔다)
        if (this.game || this.mini) p.lastAct = Math.max(p.lastAct, t - 5000);
        if (p.afkWarnAt) { p.afkWarnAt = undefined; p.conn.send({ t: 'afk', at: null }); }
        continue;
      }
      if (!p.afkWarnAt && t - p.lastAct >= AFK_WARN) {
        p.afkWarnAt = t;
        p.conn.send({ t: 'afk', at: t + AFK_KICK });
      } else if (p.afkWarnAt && t - p.afkWarnAt >= AFK_KICK) {
        this.broadcast({ t: 'sys', text: `${p.nick}님이 잠수로 나갔어요. (방이 꽉 차서 자리를 비웠어요)` }, p.id);
        this.kickOut(p, 4012, 'afk');
      }
    }
  }

  private kickOut(p: P, code: number, reason: string) {
    const c = p.conn;
    this.leave(p.id);
    try { c.close?.(code, reason); } catch { /* 이미 닫힘 */ }
  }

  private kvMsg(): S2C {
    const k = this.kv;
    if (!k) return { t: 'kickvote', v: null };
    return { t: 'kickvote', v: { target: k.target, by: k.by, yes: k.yes.size, no: k.no.size, need: this.kickNeed(), endsAt: k.endsAt, voted: [...k.yes, ...k.no] } };
  }
  /** 투표할 수 있는 사람 (대상 빼고, 접속 중인 사람) */
  private kickVoters() { return [...this.players.values()].filter((q) => !q.bot && q.online && q.id !== this.kv?.target); }
  /** 통과에 필요한 찬성: 투표할 수 있는 사람의 과반 */
  private kickNeed() { return Math.floor(this.kickVoters().length / 2) + 1; }

  private startKick(p: P, target: number) {
    const err = (text: string) => p.conn.send({ t: 'error', text });
    if (this.game) return err('강퇴 투표는 게임 시작 전이나 끝난 뒤 대기실에서만 할 수 있어요.');
    const q = this.players.get(target);
    if (!q || q.id === p.id || p.bot) return;
    if (q.bot) return err("봇은 방장이 '봇 빼기'로 뺄 수 있어요.");
    if (this.kv) {
      // 같은 사람 투표가 이미 열려 있으면 찬성으로 센다
      if (this.kv.target === target) { this.kv.yes.add(p.id); this.kv.no.delete(p.id); this.broadcast(this.kvMsg()); this.checkKick(); return; }
      return err('이미 진행 중인 강퇴 투표가 있어요.');
    }
    const humans = [...this.players.values()].filter((x) => !x.bot && x.online);
    if (humans.length < 3) return err('강퇴 투표는 사람이 3명 이상일 때 할 수 있어요.');
    if (p.kickAt && now() - p.kickAt < KICK_COOLDOWN) return err('강퇴 투표는 1분에 한 번만 열 수 있어요.');
    p.kickAt = now();
    const endsAt = now() + KICK_VOTE_MS;
    this.kv = { target, by: p.id, yes: new Set([p.id]), no: new Set(), endsAt, timer: setTimeout(() => this.endKick(!!this.kv && this.kv.yes.size >= this.kickNeed()), KICK_VOTE_MS) };
    this.broadcast({ t: 'sys', text: `🗳 ${p.nick}님이 ${q.nick}님 강퇴 투표를 열었어요. (30초 · 과반 찬성이면 강퇴)` });
    this.broadcast(this.kvMsg());
    this.checkKick();
  }

  private checkKick() {
    const k = this.kv;
    if (!k) return;
    const need = this.kickNeed();
    if (k.yes.size >= need) this.endKick(true);
    else if (this.kickVoters().length - k.no.size < need) this.endKick(false);
  }

  private endKick(pass: boolean, gone = false) {
    const k = this.kv;
    if (!k) return;
    clearTimeout(k.timer);
    this.kv = null;
    this.broadcast({ t: 'kickvote', v: null });
    const q = this.players.get(k.target);
    if (gone || !q) return;
    if (!pass) { this.broadcast({ t: 'sys', text: `강퇴 투표가 부결됐어요. (찬성 ${k.yes.size} · 반대 ${k.no.size})` }); return; }
    this.broadcast({ t: 'sys', text: `${q.nick}님이 강퇴 투표로 나갔어요. (찬성 ${k.yes.size})` }, q.id);
    if (q.conn.ip && q.conn.ip !== 'local') this.banned.set(q.conn.ip, now() + KICK_BAN_MS);
    this.kickOut(q, 4014, 'kicked');
  }

  // ── 마피아 본게임 ────────────────────────────────

  private checkAuto() {
    if (!this.pub || this.game) return;
    if (this.players.size >= AUTO_START && !this.autoTimer) {
      this.autoAt = now() + 10_000;
      this.broadcast({ t: 'starting', at: this.autoAt });
      this.broadcast({ t: 'sys', text: `${AUTO_START}명이 모였어요! 10초 뒤 게임이 시작됩니다.` });
      this.autoTimer = setTimeout(() => { this.autoTimer = null; this.autoAt = null; if (this.players.size >= GAME_MIN) this.startGame(); }, 10_000);
    } else if (this.players.size < AUTO_START && this.autoTimer) {
      clearTimeout(this.autoTimer);
      this.autoTimer = null;
      this.autoAt = null;
      this.broadcast({ t: 'starting', at: null });
    }
  }

  /** 테스트 설정을 쓸 수 있는 방: 비공개, 봇이 있고, 사람은 방장 포함 2명까지 (영상 촬영용 부계정) */
  testAllowed(hostId: number) {
    const ps = [...this.players.values()];
    const humans = ps.filter((p) => !p.bot);
    return !this.pub && ps.some((p) => p.bot) && humans.length <= 2 && humans.some((p) => p.id === hostId && p.host);
  }

  private startGame(by?: number, test?: TestReq) {
    if (this.game) return;
    // 테스트 설정은 방장 + (부계정 1명) + 봇일 때만 (사람끼리 하는 판에서 직업 고르기 방지)
    let t: GameTest | undefined;
    if (by !== undefined && test && this.testAllowed(by)) {
      const roles: [number, RoleId][] = [];
      for (const [k, r] of Object.entries(test.roles ?? {})) {
        const p = this.players.get(Number(k));
        if (p && !p.bot && typeof r === 'string' && r in ROLES) roles.push([p.id, r as RoleId]);
      }
      const bots = [...this.players.values()].filter((p) => p.bot);
      for (const b of bots) if (b.brain) b.brain.opts = { vote: test.botVote !== false, act: test.botAct !== false, chat: test.botChat !== false };
      t = { roles, speed: Math.max(1, Math.min(8, Number(test.speed) || 1)), godKill: !!test.godKill, quiet: test.botAct === false ? bots.map((b) => b.id) : [] };
    } else for (const p of this.players.values()) if (p.brain) p.brain.opts = { vote: true, act: true, chat: true };
    if (this.autoTimer) { clearTimeout(this.autoTimer); this.autoTimer = null; this.autoAt = null; }
    if (this.kv) { clearTimeout(this.kv.timer); this.kv = null; this.broadcast({ t: 'kickvote', v: null }); }
    this.endMini(true);
    this.notice = null;
    // 대기실에서 끊겨 기다리던 사람은 이번 판에서 빠진다
    for (const p of [...this.players.values()]) if (!p.online) this.leave(p.id);
    if (this.players.size < GAME_MIN) return;
    const seats = [...this.players.values()].filter((p) => p.online).sort((a, b) => a.joinedAt - b.joinedAt).slice(0, 12);
    const letters = 'ABCDEFGHIJKL';
    const order = this.pub ? [...seats].sort(() => Math.random() - 0.5) : seats;
    const named = order.map((p, i) => ({ pid: p.id, name: this.pub ? `교주${letters[i]}` : p.nick }));
    this.game = new MafiaGame({
      send: (pid, msg) => { const q = this.players.get(pid); if (q?.online) { try { q.conn.send(msg); } catch { /* 끊김 */ } } },
      later: (ms, fn) => this.later(ms, fn),
      clearTimers: () => this.clearTimers(),
      onEnd: () => this.endGame(),
    }, named, t);
    this.broadcast({ t: 'starting', at: null });
    this.status();
    this.game.start();
  }

  private endGame() {
    this.game?.dispose();
    this.game = null;
    this.clearTimers();
    // 돌아오지 않은 사람 정리
    for (const p of [...this.players.values()]) if (!p.online) this.leave(p.id);
    for (const p of this.players.values()) { try { p.conn.send({ t: 'welcome', you: p.id, code: this.code, pub: this.pub, players: this.list() }); } catch { /* 끊김 */ } }
    this.broadcast({ t: 'sys', text: '대기실로 돌아왔어요. 한 판 더?' });
    this.status();
    this.checkAuto();
  }

  // ── 미니게임 공통 ────────────────────────────────

  private later(ms: number, fn: () => void) {
    const h = setTimeout(() => { this.timers = this.timers.filter((x) => x !== h); fn(); }, ms);
    this.timers.push(h);
  }
  private clearTimers() { for (const h of this.timers) clearTimeout(h); this.timers = []; }
  private push() { this.broadcast({ t: 'mini', s: this.mini, title: this.mini ? MINI_NAMES[this.mini.game] : undefined }); }

  private endMini(silent = false) {
    this.clearTimers();
    if (!this.mini) return;
    this.mini = null;
    if (!silent || this.players.size) this.push();
  }

  /** 미니게임 중 움직일 수 없는 사람 (탈락자 등) */
  private frozen(id: number) {
    const m = this.mini;
    if (!m) return false;
    if (m.game === 'reaction') return true;
    if ((m.game === 'ox' || m.game === 'chairs') && m.out.includes(id)) return false;
    if (m.game === 'chairs' && m.chairs.some((c) => c.by === id)) return true;
    return false;
  }

  private ids() { return [...this.players.keys()]; }

  private startMini(game: MiniId) {
    this.clearTimers();
    this.broadcast({ t: 'sys', text: `미니게임 「${MINI_NAMES[game]}」 시작!` });
    if (game === 'reaction') {
      this.mini = { game, phase: 'ready', round: 1, scores: Object.fromEntries(this.ids().map((i) => [i, 0])) };
      this.reactionRound();
    } else if (game === 'ox') {
      this.mini = { game, phase: 'question', q: '', left: this.ids(), out: [], endsAt: 0, num: 0 };
      this.oxNext();
    } else if (game === 'tag') {
      const it = pickOne(this.ids());
      this.mini = { game, phase: 'play', it, endsAt: now() + 60_000, immune: now() + 2500 };
      this.push();
      this.later(60_000, () => {
        const m = this.mini;
        if (m?.game !== 'tag') return;
        m.phase = 'done';
        m.loser = m.it;
        this.push();
        this.broadcast({ t: 'sys', text: `시간 종료! 마지막 술래는 ${this.players.get(m.it)?.nick ?? '?'}님.` });
        this.later(4000, () => this.endMini());
      });
    } else if (game === 'chairs') {
      this.mini = { game, phase: 'music', chairs: [], left: this.ids(), out: [], endsAt: 0 };
      this.chairsRound();
    }
  }

  private miniOnLeave(id: number) {
    const m = this.mini;
    if (!m) return;
    if (m.game === 'ox' || m.game === 'chairs') {
      m.left = m.left.filter((x) => x !== id);
      if (m.game === 'chairs') for (const c of m.chairs) if (c.by === id) c.by = null;
    }
    if (m.game === 'tag' && m.it === id && this.players.size) { m.it = pickOne(this.ids()); m.immune = now() + 2500; }
    if (m.game === 'reaction') delete m.scores[id];
    if (this.players.size < 2) { this.broadcast({ t: 'sys', text: '사람이 부족해서 미니게임이 끝났어요.' }); this.endMini(); return; }
    this.push();
  }

  private miniOnMove(p: P) {
    const m = this.mini;
    if (!m) return;
    if (m.game === 'tag' && m.phase === 'play' && now() > m.immune) {
      const it = this.players.get(m.it);
      if (!it) return;
      const victim = p.id === m.it ? [...this.players.values()].find((q) => q.id !== it.id && dist(q, it) < 70) : dist(p, it) < 70 ? p : null;
      if (victim) {
        m.it = victim.id;
        m.immune = now() + 2000;
        this.push();
      }
    }
    if (m.game === 'chairs' && m.phase === 'sit' && m.left.includes(p.id) && !m.chairs.some((c) => c.by === p.id)) {
      const c = m.chairs.find((c) => c.by === null && dist(c, p) < 48);
      if (c) {
        c.by = p.id;
        p.x = c.x; p.y = c.y; p.moved = true;
        p.conn.send({ t: 'pos', x: c.x, y: c.y });
        this.push();
        if (m.chairs.every((c) => c.by !== null)) this.chairsJudge();
      }
    }
  }

  private miniOnPress(p: P) {
    const m = this.mini;
    if (m?.game !== 'reaction') return;
    if (m.phase === 'wait') {
      m.fouls = [...(m.fouls ?? []), p.id].filter((v, i, a) => a.indexOf(v) === i);
      this.push();
      if (m.fouls.length >= this.players.size) { this.clearTimers(); m.phase = 'result'; m.winner = null; this.push(); this.later(2000, () => this.reactionRound()); }
    } else if (m.phase === 'go' && !(m.fouls ?? []).includes(p.id)) {
      this.clearTimers();
      m.phase = 'result';
      m.winner = p.id;
      m.time = now() - (m.time ?? now());
      m.scores[p.id] = (m.scores[p.id] ?? 0) + 1;
      this.push();
      const best = Math.max(...Object.values(m.scores));
      if (best >= 2 || m.round >= 3) {
        this.later(2500, () => {
          const top = Object.entries(m.scores).filter(([, s]) => s === best).map(([i]) => this.players.get(Number(i))?.nick).filter(Boolean);
          this.broadcast({ t: 'sys', text: `반응속도 대결 우승: ${top.join(', ')}!` });
          this.endMini();
        });
      } else this.later(2500, () => { m.round++; this.reactionRound(); });
    }
  }

  // ── 반응속도 ────────────────────────────────────

  private reactionRound() {
    const m = this.mini;
    if (m?.game !== 'reaction') return;
    m.phase = 'ready'; m.winner = undefined; m.fouls = []; m.time = undefined;
    this.push();
    this.later(1500, () => {
      m.phase = 'wait';
      this.push();
      this.later(rnd(1500, 4500), () => {
        m.phase = 'go';
        m.time = now();
        this.push();
        this.later(3000, () => { m.phase = 'result'; m.winner = null; this.push(); this.later(1500, () => this.reactionRound()); });
      });
    });
  }

  // ── OX 퀴즈 ─────────────────────────────────────

  private oxUsed = new Set<number>();
  private oxNext() {
    const m = this.mini;
    if (m?.game !== 'ox') return;
    if (m.left.length <= 1 || m.num >= 8) return this.oxDone();
    let i = Math.floor(Math.random() * QUIZ.length);
    for (let k = 0; k < QUIZ.length && this.oxUsed.has(i); k++) i = (i + 1) % QUIZ.length;
    this.oxUsed.add(i);
    m.num++;
    m.phase = 'question';
    m.q = QUIZ[i][0];
    m.answer = undefined;
    m.endsAt = now() + 9000;
    this.push();
    this.later(9000, () => {
      const ans = QUIZ[i][1];
      const wrong = m.left.filter((id) => { const p = this.players.get(id); return !p || (p.x < WORLD_W / 2) !== ans; });
      m.phase = 'judge';
      m.answer = ans;
      if (wrong.length < m.left.length) { m.out.push(...wrong); m.left = m.left.filter((x) => !wrong.includes(x)); }
      else this.broadcast({ t: 'sys', text: '모두 틀려서 아무도 탈락하지 않았어요!' });
      this.push();
      this.later(3500, () => this.oxNext());
    });
  }

  private oxDone() {
    const m = this.mini;
    if (m?.game !== 'ox') return;
    m.phase = 'done';
    this.push();
    this.broadcast({ t: 'sys', text: `OX 퀴즈 우승: ${m.left.map((i) => this.players.get(i)?.nick).filter(Boolean).join(', ') || '없음'}!` });
    this.oxUsed.clear();
    this.later(4000, () => this.endMini());
  }

  // ── 의자 뺏기 ───────────────────────────────────

  private chairsRound() {
    const m = this.mini;
    if (m?.game !== 'chairs') return;
    if (m.left.length <= 1) {
      m.phase = 'done';
      this.push();
      this.broadcast({ t: 'sys', text: `의자 뺏기 우승: ${this.players.get(m.left[0])?.nick ?? '없음'}!` });
      this.later(4000, () => this.endMini());
      return;
    }
    const n = m.left.length - 1;
    const chairs: Chair[] = [];
    for (let i = 0; i < n; i++) {
      let x = 0, y = 0;
      for (let tries = 0; tries < 30; tries++) {
        x = rnd(160, WORLD_W - 160); y = rnd(WALK_TOP + 70, WORLD_H - 70);
        if (chairs.every((c) => dist(c, { x, y }) > 150)) break;
      }
      chairs.push({ id: i, x: Math.round(x), y: Math.round(y), by: null });
    }
    m.chairs = chairs;
    m.phase = 'music';
    m.endsAt = 0;
    this.push();
    this.later(rnd(4000, 8000), () => {
      m.phase = 'sit';
      m.endsAt = now() + 7000;
      this.push();
      this.later(7000, () => this.chairsJudge());
    });
  }

  private chairsJudge() {
    const m = this.mini;
    if (m?.game !== 'chairs' || m.phase !== 'sit') return;
    this.clearTimers();
    const seated = new Set(m.chairs.map((c) => c.by).filter((x): x is number => x !== null));
    if (!seated.size) {
      this.broadcast({ t: 'sys', text: '아무도 앉지 못했어요! 이번 판은 다시 합니다.' });
      m.phase = 'music'; m.chairs = []; this.push();
      this.later(2000, () => this.chairsRound());
      return;
    }
    const out = m.left.filter((id) => !seated.has(id));
    m.out.push(...out);
    m.left = m.left.filter((id) => seated.has(id));
    this.broadcast({ t: 'sys', text: `탈락: ${out.map((i) => this.players.get(i)?.nick).filter(Boolean).join(', ')}` });
    m.phase = 'music';
    m.chairs = [];
    this.push();
    this.later(2500, () => this.chairsRound());
  }
}
