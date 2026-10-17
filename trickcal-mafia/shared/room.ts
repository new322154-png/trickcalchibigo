/**
 * 방 하나의 로직 (대기실 · 채팅 · 멀티 미니게임).
 * Cloudflare Durable Object(worker/index.ts)와 로컬 테스트 서버가 같이 쓴다.
 * 판정은 모두 서버가 한다.
 */
import { QUIZ } from './quiz';
import { MafiaGame } from './mafia';
import {
  AUTO_START, GAME_MIN, CHARACTERS, MAX_PLAYERS, SPEED, WORLD_H, WORLD_W, clamp, isChar,
  type C2S, type Chair, type MiniId, type MiniState, type PlayerInfo, type S2C, MINI_NAMES,
} from './protocol';

export interface Conn {
  send(msg: S2C): void;
}

interface P extends PlayerInfo {
  conn: Conn;
  token: string;
  online: boolean;
  dropTimer?: ReturnType<typeof setTimeout>;
  lastMoveAt: number;
  moved: boolean;
  chatTimes: number[];
  joinedAt: number;
}

const now = () => Date.now();
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

  constructor(public code: string, public pub: boolean) {}

  get count() { return this.players.size; }

  // ── 입장 · 퇴장 ──────────────────────────────────

  join(conn: Conn, hello: C2S): number | null {
    if (hello.t !== 'hello') return null;
    // 재접속 (게임 중 끊겼다가 30초 안에 돌아옴)
    const back = hello.token ? [...this.players.values()].find((p) => p.token === hello.token && !p.online) : undefined;
    if (back) {
      clearTimeout(back.dropTimer);
      back.conn = conn;
      back.online = true;
      conn.send({ t: 'welcome', you: back.id, code: this.code, pub: this.pub, players: this.list() });
      conn.send({ t: 'token', token: back.token });
      this.broadcast({ t: 'sys', text: `${back.nick}님이 다시 연결됐어요.` });
      this.game?.setOnline(back.id, true);
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
    let nick = String(hello.nick ?? '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 10) || '교주';
    const taken = new Set([...this.players.values()].map((p) => p.nick));
    if (taken.has(nick)) { let i = 2; while (taken.has(`${nick}${i}`)) i++; nick = `${nick}${i}`; }
    const id = ++this.seq;
    const p: P = {
      id, nick, char: isChar(hello.char) ? hello.char : pickOne([...CHARACTERS]).id,
      x: rnd(300, 1300), y: rnd(320, 760), host: this.players.size === 0,
      conn, lastMoveAt: now(), moved: false, chatTimes: [], joinedAt: now(),
      token: Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2), online: true,
    };
    this.players.set(id, p);
    conn.send({ t: 'welcome', you: id, code: this.code, pub: this.pub, players: this.list() });
    conn.send({ t: 'token', token: p.token });
    if (this.autoAt) conn.send({ t: 'starting', at: this.autoAt });
    if (this.mini) conn.send({ t: 'mini', s: this.mini, title: MINI_NAMES[this.mini.game] });
    this.broadcast({ t: 'join', p: this.info(p) }, id);
    this.broadcast({ t: 'sys', text: `${nick}님이 들어왔어요.` });
    if (!this.flushTimer) this.flushTimer = setInterval(() => this.flush(), 80);
    this.status();
    this.checkAuto();
    return id;
  }

  private status() { this.onCount(this.players.size, !!this.game); }

  /** 연결이 끊김: 게임 중이면 30초 기다리고, 아니면 바로 나감 */
  disconnect(id: number) {
    const p = this.players.get(id);
    if (!p) return;
    if (this.game && this.game.ps.has(id) && !this.game.over) {
      p.online = false;
      this.broadcast({ t: 'sys', text: `${p.nick}님의 연결이 끊겼어요. 30초 기다릴게요…` });
      this.game.setOnline(id, false);
      p.dropTimer = setTimeout(() => {
        if (p.online) return;
        this.game?.drop(id);
        this.leave(id);
      }, 30_000);
      return;
    }
    this.leave(id);
  }

  leave(id: number) {
    const p = this.players.get(id);
    if (!p) return;
    clearTimeout(p.dropTimer);
    this.players.delete(id);
    this.broadcast({ t: 'leave', id });
    this.broadcast({ t: 'sys', text: `${p.nick}님이 나갔어요.` });
    if (p.host && this.players.size) {
      const next = [...this.players.values()].sort((a, b) => a.joinedAt - b.joinedAt)[0];
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

  private info(p: P): PlayerInfo {
    return { id: p.id, nick: p.nick, char: p.char, x: Math.round(p.x), y: Math.round(p.y), host: p.host };
  }
  private list() { return [...this.players.values()].map((p) => this.info(p)); }

  broadcast(msg: S2C, except?: number) {
    for (const p of this.players.values()) if (p.id !== except && p.online) {
      try { p.conn.send(msg); } catch { /* 끊긴 연결 */ }
    }
  }

  private flush() {
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
    if (!p || !msg || typeof msg !== 'object') return;
    if (this.game) {
      if (msg.t === 'ping') p.conn.send({ t: 'pong' });
      else this.game.handle(id, msg);
      return;
    }
    switch (msg.t) {
      case 'start_game':
        if (!p.host) return p.conn.send({ t: 'error', text: '방장만 게임을 시작할 수 있어요.' });
        if (this.players.size < GAME_MIN) return p.conn.send({ t: 'error', text: `${GAME_MIN}명 이상 모여야 시작할 수 있어요.` });
        this.startGame();
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
        p.y = clamp(p.y + (y - p.y) * k, 60, WORLD_H - 20);
        p.lastMoveAt = t;
        p.moved = true;
        // 너무 많이 어긋났을 때만 본인에게 위치를 고쳐 준다
        if (Math.hypot(x - p.x, y - p.y) > 150) p.conn.send({ t: 'pos', x: Math.round(p.x), y: Math.round(p.y) });
        this.miniOnMove(p);
        break;
      }
      case 'chat': {
        const text = String(msg.text ?? '').replace(/[\u0000-\u001f]/g, '').trim().slice(0, 80);
        if (!text) return;
        const t = now();
        p.chatTimes = p.chatTimes.filter((x) => t - x < 5000);
        if (p.chatTimes.length >= 5) { p.conn.send({ t: 'sys', text: '채팅이 너무 빨라요. 잠시 후에 다시 보내 주세요.' }); return; }
        p.chatTimes.push(t);
        this.broadcast({ t: 'chat', id, text });
        break;
      }
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
    }
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

  private startGame() {
    if (this.game) return;
    if (this.autoTimer) { clearTimeout(this.autoTimer); this.autoTimer = null; this.autoAt = null; }
    this.endMini(true);
    const seats = [...this.players.values()].filter((p) => p.online).sort((a, b) => a.joinedAt - b.joinedAt).slice(0, 12);
    const letters = 'ABCDEFGHIJKL';
    const order = this.pub ? [...seats].sort(() => Math.random() - 0.5) : seats;
    const named = order.map((p, i) => ({ pid: p.id, name: this.pub ? `교주${letters[i]}` : p.nick, char: p.char }));
    this.game = new MafiaGame({
      send: (pid, msg) => { const q = this.players.get(pid); if (q?.online) { try { q.conn.send(msg); } catch { /* 끊김 */ } } },
      later: (ms, fn) => this.later(ms, fn),
      clearTimers: () => this.clearTimers(),
      onEnd: () => this.endGame(),
    }, named);
    this.broadcast({ t: 'starting', at: null });
    this.status();
    this.game.start();
  }

  private endGame() {
    this.game = null;
    this.clearTimers();
    // 돌아오지 않은 사람 정리
    for (const p of [...this.players.values()]) if (!p.online) this.leave(p.id);
    for (const p of this.players.values()) p.conn.send({ t: 'welcome', you: p.id, code: this.code, pub: this.pub, players: this.list() });
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
        x = rnd(160, WORLD_W - 160); y = rnd(200, WORLD_H - 120);
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
