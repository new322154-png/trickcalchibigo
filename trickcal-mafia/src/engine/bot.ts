/**
 * 봇의 머리.
 *  - 다른 사람마다 "의심 점수"(높을수록 마피아 같음)를 들고 있다.
 *  - 게시판 발언·쪽지·죽음·투표를 보고 점수를 고친다. 믿는 정도는 말한 사람의 신뢰도와 성격에 따라 다르다.
 *  - 마피아 봇은 진짜 정체를 알고, 시민처럼 보이게 거짓 직업·거짓 조사 결과·위조 쪽지를 쓴다.
 */
import { LINES, PERSONAS, line, type Persona } from '../data/lines';
import { REGISTER, TALK, fill, flavor } from '../data/talk';
import { ROLES, roleName, type NightKind, type RoleId } from '../data/roles';
import { factsOf, findContradictions, clueText } from './logic';
import { pick } from './rng';
import type { Game } from './game';
import type { Clue, Player, Side, Stmt, StmtInput, VoteRecord } from './types';

type Diff = { noise: number; detect: number; fake: number; forge: number; coord: boolean };
const DIFF: Record<string, Diff> = {
  easy: { noise: 1.3, detect: 0.12, fake: 0.1, forge: 0.2, coord: false },
  normal: { noise: 0.6, detect: 0.35, fake: 0.35, forge: 0.5, coord: false },
  hard: { noise: 0.25, detect: 0.65, fake: 0.6, forge: 0.85, coord: true },
};

/** 마피아가 거짓으로 주장하기 좋은 조용한 직업 */
const FAKE_PASSIVE: RoleId[] = ['sturdy', 'peeker', 'avenger', 'overturn', 'trap', 'survivor'];
const UNIQUE_CLAIMABLE = (r: RoleId) => r !== 'nifel';

type Priv =
  | { kind: 'investigate'; night: number; target: number; side: Side }
  | { kind: 'medium'; night: number; target: number; role: RoleId }
  | { kind: 'track'; night: number; target: number; went: number }
  | { kind: 'contact'; night: number; member: number }
  | { kind: 'contactFail'; night: number; target: number }
  | { kind: 'sealed'; night: number };

export class Brain {
  sus: number[];
  known = new Map<number, 'bad' | 'good'>();
  persona: Persona;
  d: Diff;
  claimed: RoleId | null = null;
  priv: Priv[] = [];
  private postedPriv = new Set<Priv>();
  private noteToPost: { night: number; clue: Clue } | null = null;
  private contactTried = new Set<number>();
  private calledContra = new Set<string>();
  private counterQueue: StmtInput[] = [];
  private lastProtect: number | null = null;
  private lastAct: { night: number; act: 'investigate' | 'protect' | 'track' | 'medium' | 'stay'; target?: number } | null = null;

  constructor(public game: Game, public me: Player) {
    this.sus = game.players.map(() => 0);
    this.persona = PERSONAS[me.persona];
    this.d = DIFF[game.difficulty];
  }

  // ── 기본 ─────────────────────────────────────────

  private get r() { return this.game.rng; }
  private n = (id: number) => this.game.name(id);
  private say(key: keyof (typeof LINES)['hot'], vars: Record<string, string> = {}) {
    return line(this.me.persona, key, vars, this.r);
  }
  private gauss() {
    return (this.r() + this.r() + this.r() - 1.5) * 1.15;
  }

  get isMafia() { return this.game.isMafiaTeam(this.me); }
  get isJester() { return this.me.role === 'jester'; }
  /** 내가 아는 마피아 동료 */
  mates(): number[] { return this.game.mafiaMatesOf(this.me); }

  init() {
    this.known.set(this.me.id, this.isMafia ? 'bad' : 'good');
    for (const m of this.mates()) this.known.set(m, 'bad');
  }

  /** 다른 사람 말의 신뢰도 (0~1) */
  cred(id: number): number {
    if (id < 0) return 1;
    if (id === this.me.id) return 1;
    if (this.isMafia && this.mates().includes(id)) return 1;
    const k = this.known.get(id);
    if (k === 'bad') return 0.05;
    if (k === 'good') return 0.95;
    return 1 / (1 + Math.exp(this.sus[id] * 1.1));
  }

  /** 의심 점수 (확실히 아는 건 크게) */
  score(id: number): number {
    const k = this.known.get(id);
    if (k === 'bad') return 9 + this.sus[id] * 0.01;
    if (k === 'good') return -9;
    return this.sus[id];
  }

  /** 의심 이유: 사람마다 "왜 의심하는지" 문장을 모아 두고, 말할 때 인용한다 */
  reasons = new Map<number, { why: string; v: number; day: number; used: number }[]>();

  private bump(id: number, v: number, why?: string) {
    if (id < 0 || id === this.me.id) return;
    this.sus[id] += v;
    if (why && v > 0.25) this.addReason(id, why, v);
  }

  private addReason(id: number, why: string, v: number) {
    const list = this.reasons.get(id) ?? [];
    const old = list.find((x) => x.why === why);
    if (old) { old.v += v; old.day = this.game.day; }
    else list.push({ why, v, day: this.game.day, used: 0 });
    this.reasons.set(id, list);
  }

  /** 이 사람을 의심하는 가장 좋은 이유 (덜 쓴 것, 최근 것 우선) */
  reasonFor(id: number): string | null {
    const list = this.reasons.get(id);
    if (!list?.length) return null;
    const best = [...list].sort((a, b) => (b.v - b.used * 1.5 + (b.day - this.game.day) * 0.3) - (a.v - a.used * 1.5 + (a.day - this.game.day) * 0.3))[0];
    best.used++;
    return best.why;
  }

  private markBad(id: number, why?: string) {
    if (id < 0 || id === this.me.id) return;
    if (why) this.addReason(id, why, 5);
    if (this.isMafia) return; // 마피아는 진실을 이미 앎
    this.known.set(id, 'bad');
  }

  /** 쓴 문장을 기억해서 같은 말을 되풀이하지 않는다 */
  private said = new Map<string, number>();
  talk(key: keyof typeof TALK, vars: Record<string, string> = {}): string {
    const list = TALK[key][REGISTER[this.me.persona]];
    let best = list[0], bu = Infinity;
    const recent = this.game.recentTemplates;
    for (const tpl of list) {
      const u = (this.said.get(tpl) ?? 0) + (recent.includes(tpl) ? 3 : 0) + this.r() * 0.9;
      if (u < bu) { bu = u; best = tpl; }
    }
    this.said.set(best, (this.said.get(best) ?? 0) + 1);
    recent.push(best);
    if (recent.length > 14) recent.shift();
    return flavor(this.me.persona, fill(best, vars), this.r);
  }
  private R = (tpl: string, vars: Record<string, string>) => fill(tpl, vars);

  private alive(id: number) { return this.game.players[id]?.alive; }

  /** 게시판에서 누가 어떤 직업을 주장했나 (주장한 순서대로) */
  claimsOf(role: RoleId): number[] {
    const out: number[] = [];
    for (const s of this.game.board) {
      if (s.speaker < 0 || s.anon) continue;
      for (const f of factsOf(s)) if (f.f === 'role' && f.who === s.speaker && f.role === role && !out.includes(s.speaker)) out.push(s.speaker);
    }
    return out;
  }

  claimOf(id: number): RoleId | null {
    let r: RoleId | null = null;
    for (const s of this.game.board) {
      if (s.speaker !== id || s.anon) continue;
      for (const f of factsOf(s)) if (f.f === 'role' && f.who === id) r = f.role;
    }
    return r;
  }

  private victimsOf(night: number): number[] {
    return this.game.board.filter((s) => s.kind === 'death' && s.night === night).map((s) => (s as Extract<Stmt, { kind: 'death' }>).who);
  }

  // ── 관찰 ─────────────────────────────────────────

  observe(s: Stmt, mul = 1) {
    const me = this.me.id;
    const S = s.speaker;
    if (S === me && !s.anon) return;
    const w = (S < 0 ? 1 : this.cred(S) * (0.4 + this.persona.trust * 0.8)) * mul;
    const mates = this.isMafia ? this.mates() : [];
    switch (s.kind) {
      case 'reveal': {
        const t = s.who;
        const bad = ROLES[s.role].team === 'mafia';
        if (s.role !== 'bat' && !this.isMafia) this.known.set(t, bad ? 'bad' : 'good');
        // 그 직업을 주장했던 다른 사람은 거짓말쟁이
        for (const c of this.claimsOf(s.role)) if (c !== t && UNIQUE_CLAIMABLE(s.role)) this.markBad(c);
        const tc = this.claimOf(t);
        if (tc && tc !== s.role) this.markBad(t);
        // 경찰 주장 검증
        for (const st of this.game.board) {
          if (st.kind === 'act' && st.act === 'investigate' && st.target === t && st.speaker >= 0) {
            const killer = s.role === 'nifel' || s.role === 'heir';
            if ((st.result === 'mafia' && !killer && !bad) || (st.result === 'citizen' && s.role === 'nifel')) this.bump(st.speaker, 4, this.R('{a}의 조사 결과가 계시와 달랐던 점', { a: this.n(st.speaker) }));
          }
        }
        break;
      }
      case 'role':
        this.onRoleClaim(S, s.role, w);
        break;
      case 'act': {
        const roleByAct: Partial<Record<string, RoleId>> = { investigate: 'police', protect: 'doctor', track: 'tracker', medium: 'medium' };
        const r = roleByAct[s.act];
        if (r && this.claimOf(S) !== r) this.onRoleClaim(S, r, w, true);
        else if (r) this.onRoleClaim(S, r, w, true);
        if (s.act === 'investigate' && s.target !== undefined) {
          const T = s.target;
          if (T === me) {
            if (s.result === 'mafia' && !this.game.isKiller(this.me)) this.bump(S, 6, this.R('{a:가} 나를 마피아라고 거짓말한 점', { a: this.n(S) }));
            if (s.result === 'citizen') this.bump(S, -0.3);
          } else if (!mates.includes(T)) {
            this.bump(T, s.result === 'mafia' ? 2.4 * w : -1.3 * w, this.R('{a}의 조사에서 {b:가} 마피아로 나왔다는 점', { a: this.n(S), b: this.n(T) }));
          }
          // 내가 경찰이고 다른 결과를 알면 거짓
          for (const p of this.priv) if (p.kind === 'investigate' && p.target === T && p.side !== s.result) this.bump(S, 5, this.R('{a}의 조사 결과가 사실과 다른 점', { a: this.n(S) }));
        }
        if (s.act === 'protect' && s.target !== undefined && this.victimsOf(s.night).includes(s.target)) this.bump(S, 1.5, this.R('{a:가} 지켰다던 {b:가} 습격당한 점', { a: this.n(S), b: this.n(s.target) }));
        if (s.act === 'track' && s.target !== undefined && typeof s.result === 'number') {
          const T = s.target;
          if (T === me) {
            const real = this.game.visits.get(s.night)?.get(me) ?? -1;
            if (real !== s.result) this.bump(S, 6, this.R('{a:가} 내 밤 행동을 거짓으로 말한 점', { a: this.n(S) }));
          } else if (s.result >= 0 && this.victimsOf(s.night).includes(s.result)) this.bump(T, 3 * w, this.R('{a:가} 밤에 {b}의 방에 갔다는 점', { a: this.n(T), b: this.n(s.result) }));
        }
        if (s.act === 'medium' && s.target !== undefined && typeof s.result === 'string') {
          const claimed = this.claimOf(s.target);
          if (claimed && claimed !== s.result) {
            // 죽은 사람이 직업을 속였다면, 그 사람이 감싼 사람을 다시 의심
            for (const st of this.game.board)
              if (st.speaker === s.target && st.kind === 'act' && st.act === 'investigate' && st.result === 'citizen' && st.target !== undefined) this.bump(st.target, 1 * w);
          }
          if (s.result === 'nifel') {
            for (const st of this.game.board)
              if (st.kind === 'trust' && st.target === s.target) this.bump(st.speaker, 1.2 * w);
          }
        }
        if (s.act === 'stay') {
          const real = this.knownVisit(S, s.night);
          if (real !== undefined && real !== -1) this.bump(S, 4, this.R('{a:가} 방에 있었다고 했는데 아니었던 점', { a: this.n(S) }));
        }
        break;
      }
      case 'suspect':
        if (s.target === me) {
          if (!this.isMafia) this.bump(S, 0.45, this.R('{a:가} 나를 몰아간 점', { a: this.n(S) }));
        } else if (!mates.includes(s.target)) {
          if (this.known.get(s.target) === 'good') this.bump(S, 0.4, this.R('{a:가} 믿을 만한 {b:를} 의심한 점', { a: this.n(S), b: this.n(s.target) }));
          else this.bump(s.target, 0.3 * w * (0.4 + this.persona.follow), this.R('{a}도 {b:를} 의심했던 점', { a: this.n(S), b: this.n(s.target) }));
        }
        break;
      case 'trust':
        if (this.known.get(s.target) === 'bad' && !this.isMafia) this.bump(S, 1.5, this.R('{a:가} 수상한 {b:를} 감싼 점', { a: this.n(S), b: this.n(s.target) }));
        else if (!mates.includes(s.target)) this.bump(s.target, -0.2 * w);
        break;
      case 'mnote':
        this.onMansionClaim(s, w);
        break;
      case 'contra':
        if (s.blame === me) {
          if (!this.isMafia) this.bump(S, s.valid ? 0.6 : 1.0, this.R('{a:가} 나를 거짓말쟁이로 몬 점', { a: this.n(S) }));
        } else if (s.valid) {
          if (!mates.includes(s.blame)) this.bump(s.blame, 1.7 * this.cred(S) * (0.5 + this.persona.trust * 0.5), this.R('{a}의 말에 모순이 있었던 점', { a: this.n(s.blame) }));
        } else this.bump(S, 0.6, this.R('{a:가} 억지로 모순을 만든 점', { a: this.n(S) }));
        break;
    }
  }

  private onRoleClaim(S: number, R: RoleId, w: number, viaAct = false) {
    const me = this.me.id;
    if (S === me) return;
    if (R === this.me.role && UNIQUE_CLAIMABLE(R) && !this.isMafia) {
      // 내 직업을 사칭 → 확실한 거짓말
      this.markBad(S, this.R('{a:가} 내 직업을 사칭한 점', { a: this.n(S) }));
      if (!this.claimed) this.counterQueue.push(this.counterClaim(S));
      return;
    }
    const others = this.claimsOf(R).filter((c) => c !== S);
    if (others.length && UNIQUE_CLAIMABLE(R)) {
      for (const o of others) this.bump(o, 0.8, this.R('{a:와} {b:가} 둘 다 {r:이라고} 한 점', { a: this.n(o), b: this.n(S), r: roleName(R) }));
      this.bump(S, 1.2, this.R('{a:가} 뒤늦게 {r:이라고} 나선 점', { a: this.n(S), r: roleName(R) }));
      return;
    }
    if (!viaAct && ROLES[R].key) this.bump(S, -0.35 * w);
  }

  private onMansionClaim(s: Extract<Stmt, { kind: 'mnote' }>, w: number) {
    const S = s.speaker;
    const me = this.me.id;
    const real = this.game.mansionNote;
    // 내가 진짜 받은 사람인데 다른 사람이 받았다고 하면 거짓
    if (real && real.night === s.night && real.to === me && S !== me) {
      this.bump(S, 5);
      this.markBad(S, this.R('{a:가} 쪽지를 받았다고 거짓말한 점', { a: this.n(S) }));
      return;
    }
    const dup = this.game.board.filter((x) => x.kind === 'mnote' && x.night === s.night && x.speaker !== S && x.id !== s.id);
    if (dup.length) {
      for (const x of dup) this.bump(x.speaker, 1.3, '쪽지를 받았다는 사람이 둘이나 나온 점');
      this.bump(S, 1.5, this.R('{a:가} 쪽지를 받았다고 끼어든 점', { a: this.n(S) }));
      return;
    }
    const c = s.clue;
    const victims = this.victimsOf(s.night);
    // 내 행동과 다르면 위조
    if (c.kind === 'stayed' && c.who === me && this.myVisit(s.night) !== -1) return this.bump(S, 5, this.R('{a}의 쪽지 내용이 사실과 다른 점', { a: this.n(S) }));
    if (c.kind === 'visited' && c.who === me && this.myVisit(s.night) !== c.target) return this.bump(S, 5, this.R('{a}의 쪽지 내용이 사실과 다른 점', { a: this.n(S) }));
    if (c.kind === 'notMafia' && c.who === me && this.isMafia) return; // 마피아는 이득이라 조용히
    const mates = this.isMafia ? this.mates() : [];
    switch (c.kind) {
      case 'stayed':
        if (!mates.includes(c.who)) this.bump(c.who, -0.5 * w);
        break;
      case 'visited':
        if (!mates.includes(c.who)) this.bump(c.who, victims.includes(c.target) ? 3.2 * w : 0.2 * w, this.R('쪽지에 {a:가} {b}의 방에 갔다고 나온 점', { a: this.n(c.who), b: this.n(c.target) }));
        break;
      case 'oneOf': {
        const [a, b] = [c.a, c.b];
        const why = (x: number) => this.R('쪽지에 {a}의 이름이 나온 점', { a: this.n(x) });
        if (a === me && !this.isMafia) { this.bump(b, 3 * w, why(b)); break; }
        if (b === me && !this.isMafia) { this.bump(a, 3 * w, why(a)); break; }
        if (this.known.get(a) === 'good') this.bump(b, 2.8 * w, why(b));
        else if (this.known.get(b) === 'good') this.bump(a, 2.8 * w, why(a));
        else { this.bump(a, 0.8 * w, why(a)); this.bump(b, 0.8 * w, why(b)); }
        break;
      }
      case 'notMafia':
        if (!mates.includes(c.who)) this.bump(c.who, -2.5 * w);
        break;
    }
  }

  private myVisit(night: number): number {
    return this.game.visits.get(night)?.get(this.me.id) ?? -1;
  }

  /** 내가 (추적 등으로) 확실히 아는 남의 방문 */
  private knownVisit(id: number, night: number): number | undefined {
    for (const p of this.priv) if (p.kind === 'track' && p.night === night && p.target === id) return p.went;
    return undefined;
  }

  receiveNote(s: Stmt) {
    this.observe(s, 0.5);
  }

  privateInfo(p: Priv) {
    if (p.kind === 'contact') {
      if (p.member === this.me.id || this.game.inMafiaChat(this.me)) this.known.set(p.member, 'bad');
      return;
    }
    this.priv.push(p);
    if (p.kind === 'investigate') {
      if (p.side === 'mafia') this.known.set(p.target, 'bad');
      else this.bump(p.target, -2.2);
    }
    if (p.kind === 'medium') {
      const claimed = this.claimOf(p.target);
      if (claimed && claimed !== p.role) {
        // 죽은 사람이 직업을 속였다 → 그 사람이 감싸던 사람이 수상
        for (const st of this.game.board)
          if (st.speaker === p.target && st.kind === 'act' && st.act === 'investigate' && st.result === 'citizen' && st.target !== undefined) this.bump(st.target, 1.5);
      }
      // 같은 직업을 주장한 다른 사람은 거짓말쟁이
      for (const c of this.claimsOf(p.role)) if (c !== p.target && UNIQUE_CLAIMABLE(p.role)) this.markBad(c);
    }
    if (p.kind === 'contactFail') this.contactTried.add(p.target);
  }

  onDeath(id: number, how: string) {
    if (how === 'night') {
      // 밤에 죽은 사람은 시민일 가능성이 높다 → 그 사람의 말을 다시 믿는다
      if (!this.known.has(id)) this.known.set(id, 'good');
      for (const s of this.game.board) {
        if (s.speaker !== id) continue;
        const dw = (t: number) => this.R('죽은 {a:가} {b:를} 지목했던 점', { a: this.n(id), b: this.n(t) });
        if (s.kind === 'act' && s.act === 'investigate' && s.target !== undefined && s.target !== this.me.id) this.bump(s.target, s.result === 'mafia' ? 1.8 : -0.6, dw(s.target));
        if (s.kind === 'suspect' && s.target !== this.me.id) this.bump(s.target, 0.3, dw(s.target));
        if (s.kind === 'contra' && s.valid && s.blame !== this.me.id) this.bump(s.blame, 0.8, dw(s.blame));
      }
      // 밤에 죽은 사람(시민일 확률 높음)에게 표를 던졌던 사람
      for (const log of this.voteLog.slice(-2))
        for (const v of log.votes)
          if (v.target === id && v.voter !== this.me.id) this.bump(v.voter, 0.35, this.R('{a:가} 시민이었을 {b}에게 표를 던졌던 점', { a: this.n(v.voter), b: this.n(id) }));
      // 내 추적 결과로 범인 확정
      for (const p of this.priv) if (p.kind === 'track' && p.went === id && p.night === this.game.night) this.markBad(p.target);
    }
  }

  private voteLog: { day: number; votes: VoteRecord[] }[] = [];
  onVotes(votes: VoteRecord[], _label: string) {
    this.voteLog.push({ day: this.game.day, votes });
    if (this.isMafia) return;
    for (const v of votes) {
      if (v.target === null || v.voter === this.me.id) continue;
      if (this.known.get(v.target) === 'good') this.bump(v.voter, 0.35, this.R('{a:가} 믿을 만한 {b}에게 표를 던진 점', { a: this.n(v.voter), b: this.n(v.target) }));
      if (this.known.get(v.target) === 'bad') this.bump(v.voter, -0.3);
      if (v.target === this.me.id) this.bump(v.voter, 0.3, this.R('{a:가} 나에게 표를 던진 점', { a: this.n(v.voter) }));
    }
  }

  onBat(id: number, side: Side) {
    if (side === 'mafia' && this.game.inMafiaChat(this.me)) this.known.set(id, 'bad');
  }
  onHeir(_id: number) {}
  onOverturn(_id: number) {}
  heardDefense(c: number) {
    if (!this.known.has(c)) this.bump(c, -0.12 * this.persona.trust);
  }

  // ── 밤 ───────────────────────────────────────────

  chooseNight(kind: NightKind, targets: number[]): number | null {
    const noisy = (v: number) => v + this.gauss() * this.d.noise;
    const best = (f: (id: number) => number, list = targets) => {
      let b: number | null = null, bv = -Infinity;
      for (const t of list) {
        const v = f(t);
        if (v > bv) { bv = v; b = t; }
      }
      return b;
    };
    let choice: number | null = null;
    switch (kind) {
      case 'kill': {
        const mates = this.mates();
        const noise = this.d.coord ? 0.05 : this.d.noise;
        choice = best((t) => {
          if (mates.includes(t)) return -99;
          let v = 0;
          const c = this.claimOf(t);
          if (c === 'police') v += 3.2;
          if (c === 'doctor') v += 1.6;
          if (c === 'tracker' || c === 'medium' || c === 'revealer') v += 1.4;
          // 동료를 의심하는 사람
          for (const s of this.game.board) {
            if (s.speaker !== t) continue;
            if ((s.kind === 'suspect' && mates.includes(s.target)) || (s.kind === 'contra' && mates.includes(s.blame))) v += 0.7;
            if (s.kind === 'act' && s.act === 'investigate' && s.target !== undefined && mates.includes(s.target)) v += 3;
          }
          // 이미 마을이 의심하는 사람은 투표로 처리되게 남긴다
          v -= Math.max(0, this.publicHeat(t)) * 0.5;
          return v + this.gauss() * noise + (this.d.coord ? -t * 0.001 : 0);
        });
        break;
      }
      case 'contact': {
        const fresh = targets.filter((t) => !this.contactTried.has(t));
        choice = best((t) => noisy(this.sus[t]), fresh.length ? fresh : targets);
        if (choice !== null) this.contactTried.add(choice);
        break;
      }
      case 'seal':
        choice = best((t) => {
          if (this.mates().includes(t)) return -99;
          const c = this.claimOf(t);
          return (c === 'police' ? 3 : c === 'doctor' ? 2.5 : 0) + this.gauss() * 0.8;
        });
        break;
      case 'disguise': {
        const mates = this.mates().filter((m) => targets.includes(m));
        choice = mates.length ? best((t) => this.publicHeat(t) + this.gauss() * 0.3, mates) : null;
        break;
      }
      case 'protect': {
        const cops = this.claimsOf('police').filter((c) => this.alive(c) && this.cred(c) > 0.45);
        if (cops.length && this.r() < 0.75) choice = best((t) => this.cred(t), cops.filter((c) => targets.includes(c)));
        if (choice === null) choice = this.r() < 0.35 && targets.includes(this.me.id) ? this.me.id : best((t) => noisy(-this.score(t)) + (t === this.lastProtect ? -0.3 : 0));
        this.lastProtect = choice;
        break;
      }
      case 'investigate': {
        const done = new Set(this.priv.filter((p) => p.kind === 'investigate').map((p) => (p as { target: number }).target));
        const fresh = targets.filter((t) => !done.has(t) && !this.known.has(t));
        choice = best((t) => noisy(this.sus[t]), fresh.length ? fresh : targets);
        break;
      }
      case 'track':
        choice = best((t) => noisy(this.score(t) > 8 ? -5 : this.sus[t]));
        break;
      case 'medium': {
        const done = new Set(this.priv.filter((p) => p.kind === 'medium').map((p) => (p as { target: number }).target));
        const fresh = targets.filter((t) => !done.has(t));
        choice = fresh.length ? best((t) => (this.claimOf(t) ? 1 : 0) + this.r(), fresh) : null;
        break;
      }
      case 'reveal':
        if (this.game.day >= 1) {
          const c = best((t) => this.score(t) + this.gauss() * 0.3);
          if (c !== null && this.score(c) > 1.2) choice = c;
        }
        break;
    }
    if (this.isJester && kind !== 'kill') choice = pick(this.r, targets);
    if (kind === 'investigate' || kind === 'protect' || kind === 'track' || kind === 'medium')
      this.lastAct = { night: this.game.night, act: kind, target: choice ?? undefined };
    else this.lastAct = { night: this.game.night, act: 'stay' };
    return choice;
  }

  /** 모두가 이 사람을 얼마나 의심하는지 (게시판 기준) */
  publicHeat(t: number): number {
    let v = 0;
    for (const s of this.game.board) {
      if (s.day < this.game.day - 1) continue;
      if (s.kind === 'suspect' && s.target === t) v += 0.6;
      if (s.kind === 'contra' && s.valid && s.blame === t) v += 1.4;
      if (s.kind === 'act' && s.act === 'investigate' && s.target === t && s.result === 'mafia') v += 2;
    }
    return v;
  }

  // ── 낮: 발언 ─────────────────────────────────────

  gotMansionNote(clue: Clue, night: number) {
    if (!this.isMafia && !this.isJester) {
      this.noteToPost = { clue, night };
      return;
    }
    // 마피아: 불리한 쪽지는 숨기거나 위조
    const mates = this.mates().concat(this.me.id);
    const harmful =
      (clue.kind === 'visited' && mates.includes(clue.who)) ||
      (clue.kind === 'oneOf' && (mates.includes(clue.a) || mates.includes(clue.b))) ||
      (clue.kind === 'visitedBy' && clue.count > 0);
    if (!harmful) {
      this.noteToPost = { clue, night };
      return;
    }
    if (this.r() < this.d.forge) {
      const town = this.game.alive().filter((p) => !mates.includes(p.id)).map((p) => p.id);
      if (town.length >= 2) {
        const a = pick(this.r, town);
        const b = pick(this.r, town.filter((x) => x !== a));
        const victims = this.victimsOf(night);
        const forged: Clue = victims.length && this.r() < 0.5 ? { kind: 'visited', who: a, target: victims[0] } : { kind: 'oneOf', a, b };
        this.noteToPost = { clue: forged, night };
      }
    }
    // 아니면 숨긴다 (아무 말 안 함)
  }

  private choosePersonaTarget(): number | null {
    const mates = this.isMafia ? this.mates() : [];
    let best: number | null = null, bv = -Infinity;
    for (const p of this.game.alive()) {
      if (p.id === this.me.id || mates.includes(p.id)) continue;
      const v = (this.isMafia ? this.publicHeat(p.id) * 0.8 + this.sus[p.id] * 0.4 : this.score(p.id)) + this.gauss() * this.d.noise * 0.6;
      if (v > bv) { bv = v; best = p.id; }
    }
    return best;
  }

  morningPosts(): StmtInput[] {
    const out: StmtInput[] = [];
    const me = this.me.id;
    const day = this.game.day;
    const night = this.game.night;

    // 반박 대기열
    out.push(...this.counterQueue.splice(0));

    // 저택 쪽지 공개
    if (this.noteToPost) {
      const { clue, night: nn } = this.noteToPost;
      this.noteToPost = null;
      out.push({ kind: 'mnote', speaker: me, night: nn, clue, text: this.say('mnote', { res: clueText(clue, this.n) }) });
    }

    if (!this.isMafia && !this.isJester) {
      // 시민: 정보 공개
      for (const p of this.priv) {
        if (this.postedPriv.has(p)) continue;
        if (p.kind === 'investigate') {
          const go = p.side === 'mafia' || this.claimed === 'police' || (day >= 2 && this.r() < 0.4 + this.persona.open * 0.5);
          if (!go) continue;
          this.postedPriv.add(p);
          this.claimed = 'police';
          out.push({ kind: 'act', speaker: me, night: p.night, act: 'investigate', target: p.target, result: p.side, text: this.say(p.side === 'mafia' ? 'investigate_m' : 'investigate_c', { t: this.n(p.target) }) });
        }
        if (p.kind === 'track') {
          const hit = p.went >= 0 && this.victimsOf(p.night).includes(p.went);
          if (!hit && this.claimed !== 'tracker') continue;
          this.postedPriv.add(p);
          this.claimed = 'tracker';
          out.push({
            kind: 'act', speaker: me, night: p.night, act: 'track', target: p.target, result: p.went,
            text: p.went >= 0 ? this.say('track_hit', { t: this.n(p.target), res: this.n(p.went) }) : this.say('track_none', { t: this.n(p.target) }),
          });
        }
        if (p.kind === 'medium') {
          const claimed = this.claimOf(p.target);
          if (!(p.role === 'nifel' || (claimed && claimed !== p.role) || this.claimed === 'medium')) continue;
          this.postedPriv.add(p);
          this.claimed = 'medium';
          out.push({ kind: 'act', speaker: me, night: p.night, act: 'medium', target: p.target, result: p.role, text: this.say('medium', { t: this.n(p.target), res: roleName(p.role) }) });
        }
      }
      // 의사: 지킨 사람이 습격에서 살아남았다면 밝힌다
      if (this.me.role === 'doctor' && this.lastAct?.act === 'protect' && this.lastAct.night === night && this.lastProtect !== null) {
        const savedToday = this.game.board.length && !this.victimsOf(night).length && this.r() < this.persona.open * 0.5;
        if (savedToday && this.lastProtect !== me) {
          this.claimed = 'doctor';
          out.push({ kind: 'act', speaker: me, night, act: 'protect', target: this.lastProtect, text: this.say('protect', { t: this.n(this.lastProtect) }) });
        }
      }
    } else if (this.isMafia) {
      // 마피아: 가짜 경찰
      const fakeCop = this.game.fakeCop;
      const realCops = this.claimsOf('police').filter((c) => c !== me);
      const accusedMate = this.game.board.some((s) => s.kind === 'act' && s.act === 'investigate' && s.result === 'mafia' && s.target !== undefined && this.mates().includes(s.target) && s.day === day);
      const wantFake = fakeCop === me || (fakeCop === undefined && ((accusedMate && this.r() < this.d.fake + 0.2) || (day >= 1 && this.r() < this.d.fake * 0.35)));
      if (wantFake && this.claimed !== 'police' && (this.claimed === null)) {
        this.game.fakeCop = me;
        this.claimed = 'police';
        // 진짜 경찰을 마피아로 몰거나, 의심받는 동료를 시민으로
        const target = realCops.length ? realCops[realCops.length - 1] : this.choosePersonaTarget();
        if (target !== null) {
          out.push({ kind: 'act', speaker: me, night, act: 'investigate', target, result: 'mafia', text: this.say('investigate_m', { t: this.n(target) }) });
        }
      } else if (fakeCop === me && this.claimed === 'police') {
        const target = this.choosePersonaTarget();
        if (target !== null && this.r() < 0.6) out.push({ kind: 'act', speaker: me, night, act: 'investigate', target, result: 'mafia', text: this.say('investigate_m', { t: this.n(target) }) });
      }
    }

    return out.slice(0, 3);
  }

  afternoonPosts(): StmtInput[] {
    const out: StmtInput[] = [];
    out.push(...this.counterQueue.splice(0));
    // 모순 짚기
    if (this.r() < this.d.detect) {
      const pairs = findContradictions(this.game.board.filter((s) => s.day >= this.game.day - 1 || s.speaker < 0));
      for (const [a, b] of pairs) {
        const key = `${a.id}-${b.id}`;
        if (this.calledContra.has(key)) continue;
        if (a.speaker === this.me.id || b.speaker === this.me.id) continue;
        const cands = [a.speaker, b.speaker].filter((x) => x >= 0 && this.alive(x));
        if (!cands.length) continue;
        const mates = this.isMafia ? this.mates() : [];
        const pool = cands.filter((c) => !mates.includes(c));
        if (!pool.length) continue;
        const blame = pool.sort((x, y) => this.score(y) - this.score(x))[0];
        this.calledContra.add(key);
        // 다른 사람이 이미 같은 두 사람의 모순을 짚었으면 생략
        const pair = [a.speaker, b.speaker].sort().join('-');
        if (this.game.board.some((s) => s.kind === 'contra' && s.day === this.game.day && [this.game.board.find((x) => x.id === s.a)?.speaker, this.game.board.find((x) => x.id === s.b)?.speaker].sort().join('-') === pair)) continue;
        out.push({ kind: 'contra', speaker: this.me.id, a: a.id, b: b.id, blame, valid: true, text: this.say('contra', { a: this.n(a.speaker), b: this.n(b.speaker), t: this.n(blame) }) });
        break;
      }
    }
    // 투표 직전 마음 정하기
    if (!out.length && this.r() < 0.3 + this.persona.aggro * 0.35) {
      const t = this.choosePersonaTarget();
      if (t !== null && (this.isMafia || this.score(t) > 0)) out.push({ kind: 'suspect', speaker: this.me.id, target: t, text: this.talk('voteIntent', { t: this.n(t), why: this.reasonFor(t) ?? '여러 가지' }) });
    }
    return out;
  }

  /** 사람 플레이어가 한 말에 즉시 반응 */
  react(s: Stmt): StmtInput | null {
    const me = this.me.id;
    const q = this.counterQueue.shift();
    if (q) return q;
    const accusesMe =
      (s.kind === 'suspect' && s.target === me) ||
      (s.kind === 'contra' && s.blame === me) ||
      (s.kind === 'act' && s.act === 'investigate' && s.target === me && s.result === 'mafia');
    if (accusesMe && s.speaker >= 0) {
      // 경찰이 결과를 쥐고 있으면 이때 밝힌다
      if (!this.isMafia && this.me.role === 'police' && this.claimed !== 'police') {
        const res = this.priv.find((p) => p.kind === 'investigate') as Extract<Priv, { kind: 'investigate' }> | undefined;
        if (res) {
          this.claimed = 'police';
          this.postedPriv.add(res);
          return { kind: 'act', speaker: me, night: res.night, act: 'investigate', target: res.target, result: res.side, text: this.say(res.side === 'mafia' ? 'investigate_m' : 'investigate_c', { t: this.n(res.target) }) };
        }
      }
      return { kind: 'suspect', speaker: me, target: s.speaker, text: this.talk('defendSelf', { s: this.n(s.speaker) }) };
    }
    return null;
  }

  private counterClaim(S: number): StmtInput {
    this.claimed = this.me.role;
    return { kind: 'role', speaker: this.me.id, role: this.me.role, text: this.say('counter', { t: this.n(S), r: roleName(this.me.role) }) };
  }

  /** 심문에 대한 대답 */
  private answered = new Map<string, number>();
  answer(q: 'role' | 'night' | 'suspect', asker: number): StmtInput {
    const key = `${this.game.day}:${q}`;
    const n = this.answered.get(key) ?? 0;
    this.answered.set(key, n + 1);
    if (n > 0) return { kind: 'chat', speaker: this.me.id, text: this.talk('already') };
    return this.answerFresh(q, asker);
  }

  private answerFresh(q: 'role' | 'night' | 'suspect', _asker: number): StmtInput {
    const me = this.me.id;
    const night = this.game.night;
    if (q === 'role') {
      const r = this.roleToClaim();
      if (r === null) return { kind: 'refuse', speaker: me, text: this.say('refuse') };
      this.claimed = r;
      return { kind: 'role', speaker: me, role: r, text: this.say('claim', { r: roleName(r) }) };
    }
    if (q === 'night') {
      const claimed = this.claimed ?? (this.isMafia ? null : this.me.role);
      if (this.isMafia || this.isJester) {
        if (this.claimed === 'police') {
          const t = this.choosePersonaTarget();
          if (t !== null) return { kind: 'act', speaker: me, night, act: 'investigate', target: t, result: 'mafia', text: this.say('investigate_m', { t: this.n(t) }) };
        }
        return { kind: 'act', speaker: me, night, act: 'stay', text: this.say('stay') };
      }
      const la = this.lastAct;
      if (!la || la.night !== night || la.act === 'stay' || la.target === undefined)
        return { kind: 'act', speaker: me, night, act: 'stay', text: this.say('stay') };
      // 핵심 직업을 숨기는 중이면 말을 아낀다
      if (ROLES[this.me.role].key && claimed !== this.claimed && this.r() > this.persona.open) return { kind: 'refuse', speaker: me, text: this.say('refuse') };
      this.claimed = this.me.role;
      const t = la.target;
      if (la.act === 'investigate') {
        const p = this.priv.find((x) => x.kind === 'investigate' && x.night === night) as Extract<Priv, { kind: 'investigate' }> | undefined;
        if (p) {
          this.postedPriv.add(p);
          return { kind: 'act', speaker: me, night, act: 'investigate', target: t, result: p.side, text: this.say(p.side === 'mafia' ? 'investigate_m' : 'investigate_c', { t: this.n(t) }) };
        }
      }
      if (la.act === 'track') {
        const p = this.priv.find((x) => x.kind === 'track' && x.night === night) as Extract<Priv, { kind: 'track' }> | undefined;
        if (p) {
          this.postedPriv.add(p);
          return { kind: 'act', speaker: me, night, act: 'track', target: t, result: p.went, text: p.went >= 0 ? this.say('track_hit', { t: this.n(t), res: this.n(p.went) }) : this.say('track_none', { t: this.n(t) }) };
        }
      }
      if (la.act === 'medium') {
        const p = this.priv.find((x) => x.kind === 'medium' && x.night === night) as Extract<Priv, { kind: 'medium' }> | undefined;
        if (p) return { kind: 'act', speaker: me, night, act: 'medium', target: t, result: p.role, text: this.say('medium', { t: this.n(t), res: roleName(p.role) }) };
      }
      return { kind: 'act', speaker: me, night, act: 'protect', target: t, text: this.say('protect', { t: this.n(t) }) };
    }
    const t = this.choosePersonaTarget();
    if (t === null || (!this.isMafia && this.score(t) < 0.2)) return { kind: 'chat', speaker: me, text: this.say('nosuspect') };
    const why = this.reasonFor(t);
    return { kind: 'suspect', speaker: me, target: t, text: why ? this.talk('accuse', { t: this.n(t), why }) : this.talk('accuseVague', { t: this.n(t) }) };
  }

  private roleToClaim(): RoleId | null {
    if (this.claimed) return this.claimed;
    const role = this.me.role;
    if (this.isJester) return this.r() < 0.5 ? null : 'police';
    if (this.isMafia) {
      const fakeCop = this.game.fakeCop;
      if (fakeCop === this.me.id) return 'police';
      const free = FAKE_PASSIVE.filter((r) => !this.claimsOf(r).length);
      return free.length ? pick(this.r, free) : null;
    }
    if (ROLES[role].key) {
      const hasNews = this.priv.some((p) => p.kind === 'investigate' && p.side === 'mafia');
      if (hasNews || this.game.day >= 3 || this.r() < this.persona.open * 0.45) return role;
      return null;
    }
    return role;
  }

  noteForHuman(h: number): string | null {
    if (!this.alive(h)) return null;
    if (!this.isMafia && this.me.role === 'police' && this.claimed !== 'police') {
      const p = this.priv.find((x) => x.kind === 'investigate' && x.side === 'mafia' && !this.postedPriv.has(x) && x.night === this.game.night) as Extract<Priv, { kind: 'investigate' }> | undefined;
      if (p && p.target !== h && this.r() < 0.6) return `${this.n(p.target)}를 조심해. 확실한 정보야.`;
    }
    if (this.isMafia && this.game.difficulty !== 'easy' && this.r() < 0.18) {
      const t = this.choosePersonaTarget();
      if (t !== null && t !== h) return `${this.n(t)}… 밤에 복도를 돌아다니는 걸 봤어. 믿을지는 네 마음.`;
    }
    if (!this.isMafia && this.r() < 0.08) {
      const t = this.choosePersonaTarget();
      if (t !== null && t !== h && this.score(t) > 1) return `난 ${this.n(t)}가 의심돼. 같이 봐 줘.`;
    }
    return null;
  }

  // ── 토론 ─────────────────────────────────────────

  /** 아침: 사라진 사람에 대한 반응 */
  deathTalk(victims: number[], saved: boolean): StmtInput | null {
    const me = this.me.id;
    if (!victims.length) return saved ? { kind: 'chat', speaker: me, text: this.talk('saved') } : null;
    const v = pick(this.r, victims);
    const claimed = this.claimOf(v);
    if (claimed && ROLES[claimed].key) return { kind: 'chat', speaker: me, text: this.talk('deathClaimed', { v: this.n(v), r: roleName(claimed) }) };
    const acc = [...this.game.board].reverse().find((x) => x.speaker === v && (x.kind === 'suspect' || (x.kind === 'contra' && x.valid)));
    if (acc) {
      const t = acc.kind === 'suspect' ? acc.target : (acc as Extract<Stmt, { kind: 'contra' }>).blame;
      if (this.alive(t) && t !== me) return { kind: 'suspect', speaker: me, target: t, text: this.talk('deathAccused', { v: this.n(v), t: this.n(t) }) };
    }
    return { kind: 'chat', speaker: me, text: this.talk('deathPlain', { v: this.n(v) }) };
  }

  /** 토론 한 마디. ask 가 있으면 그 사람에게 질문한 것 (게임이 대답을 받아 온다) */
  discussTurn(spoken: Map<number, number>): { stmt: StmtInput; ask?: { target: number; q: 'role' | 'night' | 'suspect' } } | null {
    const me = this.me.id;
    const g = this.game;
    const today = g.board.filter((x) => x.day === g.day);
    const recent = today.slice(-6);
    const mates = this.isMafia ? this.mates() : [];
    const options: { w: number; run: () => { stmt: StmtInput; ask?: { target: number; q: 'role' | 'night' | 'suspect' } } | null }[] = [];

    // 1) 나를 지목한 사람에게 반박
    const atMe = [...recent].reverse().find((x) => x.speaker !== me && x.speaker >= 0 && ((x.kind === 'suspect' && x.target === me) || (x.kind === 'contra' && x.blame === me)));
    if (atMe && !today.some((x) => x.speaker === me && x.id > atMe.id)) {
      options.push({ w: 3, run: () => ({ stmt: { kind: 'suspect', speaker: me, target: atMe.speaker, text: this.talk('defendSelf', { s: this.n(atMe.speaker) }) } }) });
    }

    // 2) 방금 나온 의심에 동조하거나 반대
    const lastAcc = [...recent].reverse().find((x) => x.speaker !== me && x.speaker >= 0 && (x.kind === 'suspect' || (x.kind === 'contra' && x.valid)));
    if (lastAcc) {
      const t = lastAcc.kind === 'suspect' ? lastAcc.target : (lastAcc as Extract<Stmt, { kind: 'contra' }>).blame;
      if (t !== me && this.alive(t)) {
        const agreeScore = this.isMafia ? (mates.includes(t) ? -5 : 1) : this.score(t);
        const vars = { s: this.n(lastAcc.speaker), t: this.n(t) };
        if (agreeScore > 0.4) options.push({ w: 1.2 + this.persona.follow, run: () => ({ stmt: { kind: 'suspect', speaker: me, target: t, text: this.talk('agree', vars) } }) });
        else if (agreeScore < -0.6) options.push({ w: 1.4, run: () => ({ stmt: { kind: 'trust', speaker: me, target: t, text: this.talk('disagree', vars) } }) });
      }
    }

    // 3) 이유를 들어 의심
    const t = this.choosePersonaTarget();
    if (t !== null) {
      const why = this.isMafia ? this.reasonFor(t) : this.score(t) > 0.3 ? this.reasonFor(t) : null;
      if (why) options.push({ w: 0.8 + this.persona.aggro, run: () => ({ stmt: { kind: 'suspect', speaker: me, target: t, text: this.talk('accuse', { t: this.n(t), why }) } }) });
      else if (this.persona.aggro > 0.5 || g.day >= 2) options.push({ w: 0.35 + this.persona.aggro * 0.4, run: () => ({ stmt: { kind: 'suspect', speaker: me, target: t, text: this.talk('accuseVague', { t: this.n(t) }) } }) });
    }

    // 4) 저택 쪽지 해석
    const note = [...today].reverse().find((x) => x.kind === 'mnote' && x.speaker !== me) as Extract<Stmt, { kind: 'mnote' }> | undefined;
    if (note && !today.some((x) => x.speaker === me && x.id > note.id && x.kind === 'chat')) {
      const c = note.clue;
      if (this.persona.trust < 0.45 || this.cred(note.speaker) < 0.35) options.push({ w: 0.9, run: () => ({ stmt: { kind: 'chat', speaker: me, text: this.talk('noteDoubt', { s: this.n(note.speaker) }) } }) });
      else {
        const vars: Record<string, string> = { t: '', a: '', b: '' };
        let key: 'noteNotMafia' | 'noteStayed' | 'noteOneOf' | 'noteVisited' | null = null;
        if (c.kind === 'notMafia') { key = 'noteNotMafia'; vars.t = this.n(c.who); }
        if (c.kind === 'stayed') { key = 'noteStayed'; vars.t = this.n(c.who); }
        if (c.kind === 'visited') { key = 'noteVisited'; vars.t = this.n(c.who); }
        if (c.kind === 'oneOf') { key = 'noteOneOf'; vars.a = this.n(c.a); vars.b = this.n(c.b); }
        // 이미 여러 명이 쪽지 얘기를 했으면 덜 꺼낸다
        const talked = today.filter((x) => x.id > note.id && x.kind === 'chat').length;
        if (key) { const k = key; options.push({ w: 1.1 / (1 + talked), run: () => ({ stmt: { kind: 'chat', speaker: me, text: this.talk(k, vars) } }) }); }
      }
    }

    // 5) 조용한 사람 찌르기
    const quiet = g.alive().filter((p) => p.id !== me && !p.human && (spoken.get(p.id) ?? 0) === 0);
    const quietHuman = g.alive().find((p) => p.human && (spoken.get(p.id) ?? 0) === 0);
    const qt = quietHuman && this.r() < 0.5 ? quietHuman.id : quiet.length ? pick(this.r, quiet).id : null;
    if (qt !== null && today.length > 4) options.push({ w: 0.45, run: () => ({ stmt: { kind: 'chat', speaker: me, text: this.talk('quiet', { t: this.n(qt) }) } }) });

    // 6) 다른 봇에게 질문
    const askable = g.alive().filter((p) => p.id !== me && !p.human && !mates.includes(p.id));
    if (askable.length) {
      const target = [...askable].sort((a, b) => this.score(b.id) - this.score(a.id) + this.gauss() * 0.8)[0].id;
      const qs = (['role', 'night', 'suspect'] as const).filter((q) => !g.asked.has(`${target}:${q}`) && !(q === 'role' && this.claimOf(target)) && !(q === 'night' && g.day === 1 && g.night === 1 && this.r() < 0.5));
      const q = qs.length ? pick(this.r, qs) : null;
      const key = q === 'role' ? 'askRole' : q === 'night' ? 'askNight' : 'askSuspect';
      if (q) options.push({ w: 0.7 + this.persona.aggro * 0.3, run: () => ({ stmt: { kind: 'chat', speaker: me, text: this.talk(key, { t: this.n(target) }) }, ask: { target, q } }) });
    }

    // 7) 경찰 호출
    if (g.day >= 2 && !this.claimsOf('police').length) options.push({ w: 0.35, run: () => ({ stmt: { kind: 'chat', speaker: me, text: this.talk('callPolice') } }) });

    // 8) 첫날 분위기
    if (g.day === 1 && today.filter((x) => x.speaker >= 0).length < 6) options.push({ w: 1.1, run: () => ({ stmt: { kind: 'chat', speaker: me, text: this.talk('day1') } }) });

    if (!options.length) return null;
    const total = options.reduce((a, o) => a + o.w, 0);
    let r = this.r() * total;
    for (const o of options) {
      r -= o.w;
      if (r <= 0) return o.run();
    }
    return options[options.length - 1].run();
  }

  // ── 투표 ─────────────────────────────────────────

  vote1(targets: number[]): number | null {
    if (this.isJester) return pick(this.r, targets);
    if (this.isMafia) {
      const mates = this.mates();
      let best: number | null = null, bv = -Infinity;
      for (const t of targets) {
        if (mates.includes(t)) continue;
        const v = this.publicHeat(t) + this.sus[t] * 0.5 + (this.d.coord ? -t * 0.001 : this.gauss() * this.d.noise);
        if (v > bv) { bv = v; best = t; }
      }
      return best;
    }
    let best: number | null = null, bv = -Infinity;
    for (const t of targets) {
      const v = this.score(t) + this.publicHeat(t) * this.persona.follow * 0.5 + this.gauss() * this.d.noise;
      if (v > bv) { bv = v; best = t; }
    }
    if (best !== null && bv < -0.6 + this.persona.aggro * 0.3 && this.r() > this.persona.aggro) return null;
    return best;
  }

  defense(): string {
    const accuser = [...this.game.board].reverse().find((x) => (x.kind === 'suspect' && x.target === this.me.id) || (x.kind === 'contra' && x.blame === this.me.id));
    const sname = accuser ? this.n(accuser.speaker) : '다른 사람';
    if (this.claimed && this.r() < 0.7) return this.talk('defenseRole', { r: roleName(this.claimed) });
    return this.talk('defensePlain', { s: sname });
  }

  vote2(a: number, b: number | null): number | null {
    if (this.isJester) return this.r() < 0.5 ? a : b;
    if (this.isMafia) {
      const mates = this.mates();
      if (b === null) return mates.includes(a) ? null : a;
      if (mates.includes(a) && !mates.includes(b)) return b;
      if (mates.includes(b) && !mates.includes(a)) return a;
      return this.publicHeat(a) >= this.publicHeat(b) ? a : b;
    }
    const sa = this.score(a) + this.gauss() * this.d.noise * 0.5;
    if (b === null) return sa > -0.2 ? a : null;
    const sb = this.score(b) + this.gauss() * this.d.noise * 0.5;
    return sa >= sb ? a : b;
  }

  agitate(votes: VoteRecord[], a: number, b: number | null): { voter: number; to: number | null } | null {
    const mates = this.mates().concat(this.me.id);
    const danger = [a, b].find((c) => c !== null && mates.includes(c));
    if (danger === undefined) return null;
    const other = danger === a ? b : a;
    const v = votes.find((x) => x.target === danger && x.voter !== this.me.id);
    return v ? { voter: v.voter, to: other } : null;
  }

  wantOverturn(target: number): boolean {
    return this.score(target) < -0.4 || this.known.get(target) === 'good';
  }

  avenge(targets: number[]): number | null {
    let best: number | null = null, bv = -Infinity;
    for (const t of targets) {
      if (t === this.me.id) continue;
      const v = this.score(t);
      if (v > bv) { bv = v; best = t; }
    }
    return best;
  }

  batSide(): Side {
    const alive = this.game.alive().length;
    return this.r() < (alive <= 5 ? 0.6 : 0.4) ? 'mafia' : 'citizen';
  }
}
