/**
 * 봇전 한 판의 진행.
 *  밤(능력) → 아침 발표 → 저택 쪽지 → 증언판 → 심문·쪽지·모순 지목 → 1차 투표 → 결선 대결 → 처형
 * 사람 플레이어의 선택은 HumanIO(화면)에 묻고, 봇은 Brain 이 정한다.
 */
import {
  BAT_CHOOSE_DAY, CITIZEN_POOL, COMPOSITION, MEMBER_POOL, NEUTRAL_POOL, NO_FIRST_KILL, ROLES, roleName,
  type NightKind, type RoleId,
} from '../data/roles';
import { line } from '../data/lines';
import { Brain } from './bot';
import { clueText, isContradiction } from './logic';
import { makeRng, pick, shuffle, type Rng } from './rng';
import type { Clue, Difficulty, LogEntry, PersonaId, Player, Side, Stmt, StmtInput, VoteRecord } from './types';

export interface NightChoice {
  kind: NightKind;
  title: string;
  targets: number[];
}

export interface HumanIO {
  log(e: LogEntry): void;
  update(): void;
  pause(ms: number): Promise<void>;
  /** 봇이 말하기 전 '입력 중…' 표시 */
  typing(speaker: number, ms: number): Promise<void>;
  /** 밤 능력 대상 (null = 사용 안 함) */
  night(c: NightChoice): Promise<number | null>;
  /** 박쥐: 진영 고르기 */
  batChoose(): Promise<Side>;
  /** 낮 자유 행동. 플레이어가 "투표하러 가기"를 누르면 끝 */
  day(): Promise<void>;
  vote1(targets: number[]): Promise<number | null>;
  defense(): Promise<string>;
  vote2(a: number, b: number | null): Promise<number | null>;
  overturn(target: number): Promise<boolean>;
  agitate(votes: VoteRecord[], a: number, b: number | null): Promise<{ voter: number; to: number | null } | null>;
  avenge(targets: number[]): Promise<number | null>;
  /** 저택 쪽지를 받았을 때 (공개 여부는 낮 행동에서) */
  gotMansionNote(clue: Clue): Promise<void>;
  gameOver(): Promise<void>;
}

export interface GameOptions {
  count: number;
  difficulty: Difficulty;
  /** 사람 플레이어 수 (봇전 0 또는 1) */
  humans: number;
  seed?: number;
  /** 사람 플레이어 직업 고정 (테스트용) */
  forceRole?: RoleId;
}

const LETTERS = 'ABCDEFGHIJKL';
const PERSONA_IDS: PersonaId[] = ['hot', 'calm', 'timid', 'doubt', 'naive'];

export type Winner = 'mafia' | 'citizen' | 'jester' | 'draw';

export class Game {
  rng: Rng;
  players: Player[] = [];
  brains = new Map<number, Brain>();
  board: Stmt[] = [];
  day = 0;
  night = 0;
  over = false;
  winner: Winner | null = null;
  winners: number[] = [];
  difficulty: Difficulty;
  /** 밤마다 누가 누구에게 갔는지 (진실) */
  visits = new Map<number, Map<number, number>>();
  /** 오늘의 저택 쪽지 */
  mansionNote: { night: number; to: number; clue: Clue } | null = null;
  /** 사람 플레이어의 하루 행동 남은 횟수 */
  quota = { ask: 3, note: 1, contra: 2, claim: 2 };
  lastVotes: VoteRecord[] = [];
  /** 사람 플레이어가 능력으로 알아낸 것 (플레이어 목록 표시용) */
  marks = new Map<number, string>();
  /** 사람 플레이어가 저택 쪽지를 이미 공개했나 */
  notePublished = false;
  /** 최근에 쓰인 대사 틀 (여러 봇이 같은 말을 하지 않게) */
  recentTemplates: string[] = [];
  /** 오늘 이미 나온 질문 (대상:질문) */
  asked = new Set<string>();
  /** 가짜 경찰 역을 맡은 마피아 봇 */
  fakeCop?: number;
  private stmtSeq = 0;
  private quietDays = 0;

  constructor(public opts: GameOptions, public io: HumanIO) {
    this.rng = makeRng(opts.seed);
    this.difficulty = opts.difficulty;
    this.setup();
  }

  // ── 준비 ─────────────────────────────────────────

  private setup() {
    const n = this.opts.count;
    const [nifel, members, randomCitizens, neutrals] = COMPOSITION[n];
    const roles: RoleId[] = [
      ...Array(nifel).fill('nifel'),
      ...shuffle(this.rng, MEMBER_POOL).slice(0, members),
      'doctor', 'police',
      ...shuffle(this.rng, CITIZEN_POOL).slice(0, randomCitizens),
      ...shuffle(this.rng, NEUTRAL_POOL).slice(0, neutrals),
    ];
    const assigned = shuffle(this.rng, roles);
    const letters = LETTERS.slice(0, n).split('');
    const personas = shuffle(this.rng, [...PERSONA_IDS, ...PERSONA_IDS, ...PERSONA_IDS]);
    // 사람 플레이어 자리는 무작위
    const humanSeat = Math.floor(this.rng() * n);
    if (this.opts.forceRole && this.opts.humans > 0) {
      let k = assigned.indexOf(this.opts.forceRole);
      if (k < 0) { assigned[humanSeat] = this.opts.forceRole; k = humanSeat; }
      [assigned[k], assigned[humanSeat]] = [assigned[humanSeat], assigned[k]];
    }
    for (let i = 0; i < n; i++) {
      this.players.push({
        id: i, name: '교주' + letters[i], role: assigned[i], human: this.opts.humans > 0 && i === humanSeat, persona: personas[i],
        alive: true, contacted: false, heirAwake: false, usedOnce: false, shieldUsed: false, revealed: false,
      });
    }
    for (const p of this.players) if (!p.human) this.brains.set(p.id, new Brain(this, p));
    for (const b of this.brains.values()) b.init();
  }

  // ── 조회 ─────────────────────────────────────────

  get human(): Player | undefined { return this.players.find((p) => p.human); }
  name = (id: number) => (id < 0 ? '저택' : this.players[id]?.name ?? '?');
  alive = () => this.players.filter((p) => p.alive);
  aliveIds = () => this.alive().map((p) => p.id);

  /** 습격할 수 있는 사람 (니펠, 깨어난 후계, 마피아를 고른 박쥐) */
  isKiller(p: Player) {
    return p.role === 'nifel' || (p.role === 'heir' && p.heirAwake) || (p.role === 'bat' && p.batSide === 'mafia');
  }
  /** 마피아 팀 (승리 계산용) */
  isMafiaTeam(p: Player) {
    return p.role === 'nifel' || !!ROLES[p.role].member || (p.role === 'bat' && p.batSide === 'mafia');
  }
  /** 이 사람이 같은 편으로 알고 있는 마피아 동료들 */
  mafiaMatesOf(p: Player): number[] {
    if (!this.isKiller(p) && !(ROLES[p.role].member && p.contacted)) return [];
    return this.players.filter((q) => q.id !== p.id && (this.isKiller(q) || (ROLES[q.role].member && q.contacted))).map((q) => q.id);
  }
  /** 니펠 채팅에 낄 수 있는가 */
  inMafiaChat(p: Player) {
    return this.isKiller(p) || (!!ROLES[p.role].member && p.contacted);
  }

  /** 이 사람이 오늘 밤 쓸 능력 */
  nightKindOf(p: Player): NightKind | null {
    if (!p.alive) return null;
    if (this.isKiller(p)) return 'kill';
    const def = ROLES[p.role];
    if (def.member) {
      if (!p.contacted) return 'contact';
      return def.night ?? null;
    }
    if (!def.night) return null;
    if (def.once && p.usedOnce) return null;
    if (def.night === 'medium' && !this.players.some((q) => !q.alive)) return null;
    return def.night;
  }

  nightTargets(p: Player, kind: NightKind): number[] {
    if (kind === 'medium') return this.players.filter((q) => !q.alive).map((q) => q.id);
    const mates = this.mafiaMatesOf(p);
    return this.alive()
      .filter((q) => (q.id !== p.id || ROLES[p.role].selfTarget))
      .filter((q) => (kind === 'kill' ? !mates.includes(q.id) && q.id !== p.id : true))
      .map((q) => q.id);
  }

  // ── 기록 ─────────────────────────────────────────

  post(input: StmtInput): Stmt {
    const s = { ...input, id: ++this.stmtSeq, day: this.day } as Stmt;
    this.board.push(s);
    this.io.log({ kind: s.speaker < 0 ? 'system' : s.anon ? 'note' : 'say', text: s.text, speaker: s.speaker, stmtId: s.id });
    for (const b of this.brains.values()) b.observe(s);
    return s;
  }

  private sys(text: string, kind: LogEntry['kind'] = 'system') {
    this.io.log({ kind, text });
  }

  secret(to: number, text: string) {
    this.io.log({ kind: 'secret', text, privateTo: to });
  }

  // ── 진행 ─────────────────────────────────────────

  async run() {
    const h = this.human;
    if (h) {
      const mates = this.mafiaMatesOf(h);
      if (mates.length) this.secret(h.id, `함께하는 니펠: ${mates.map(this.name).join(', ')}`);
      if (ROLES[h.role].member) this.secret(h.id, '아직 니펠과 접선하지 못했습니다. 밤마다 한 명을 골라 니펠이면 접선에 성공합니다. 접선해야 능력을 쓸 수 있어요.');
    }
    while (!this.over) {
      await this.runNight();
      if (this.over) break;
      await this.runDay();
      if (this.day >= 30 && !this.over) this.finish('draw');
    }
    await this.io.gameOver();
  }

  // ── 밤 ───────────────────────────────────────────

  private async runNight() {
    this.night++;
    this.io.log({ kind: 'phase', text: `${this.night}번째 밤` });
    this.io.update();
    const choices = new Map<number, { kind: NightKind; target: number | null }>();
    const killVotes = new Map<number, number>();
    const h = this.human;

    for (const p of this.alive()) {
      const kind = this.nightKindOf(p);
      if (!kind) continue;
      const targets = this.nightTargets(p, kind);
      if (!targets.length) continue;
      let target: number | null;
      if (p.human) {
        target = await this.io.night({ kind, title: nightTitle(kind), targets });
      } else {
        target = this.brains.get(p.id)!.chooseNight(kind, targets);
      }
      if (kind === 'kill' && target !== null) killVotes.set(p.id, target);
      choices.set(p.id, { kind, target });
    }

    // 니펠 투표: 가장 많은 표, 동률이면 사람 플레이어의 선택 → 무작위
    const noKill = this.night === 1 && NO_FIRST_KILL(this.opts.count);
    let killTarget: number | null = null;
    let executor: number | null = null;
    if (!noKill && killVotes.size) {
      const tally = new Map<number, number>();
      for (const t of killVotes.values()) tally.set(t, (tally.get(t) ?? 0) + 1);
      const max = Math.max(...tally.values());
      const top = [...tally].filter(([, c]) => c === max).map(([t]) => t);
      const humanPick = h && killVotes.get(h.id);
      killTarget = humanPick !== undefined && humanPick !== null && top.includes(humanPick) ? humanPick : pick(this.rng, top);
      const voters = [...killVotes].filter(([, t]) => t === killTarget).map(([v]) => v);
      executor = pick(this.rng, voters);
      // 니펠끼리 결과 공유
      for (const v of killVotes.keys()) {
        const mateNames = [...killVotes].map(([a, t]) => `${this.name(a)}→${this.name(t)}`).join(', ');
        this.secret(v, `니펠 투표: ${mateNames} ⇒ 오늘 밤 대상은 ${this.name(killTarget)}`);
      }
    } else if (noKill && killVotes.size) {
      for (const v of killVotes.keys()) this.secret(v, '첫날 밤이라 습격은 하지 않습니다. (서로 얼굴만 확인했다)');
    }

    // 봉인 → 위장 → 보호 → 습격 → 정보
    const sealed = new Set<number>();
    for (const [pid, c] of choices) if (c.kind === 'seal' && c.target !== null && !sealed.has(pid)) sealed.add(c.target);
    const disguised = new Set<number>();
    for (const [pid, c] of choices) if (c.kind === 'disguise' && c.target !== null && !sealed.has(pid)) disguised.add(c.target);
    if (executor !== null && sealed.has(executor)) {
      // 실행 니펠이 봉인되면 다른 니펠이 대신
      const others = [...killVotes].filter(([v, t]) => t === killTarget && !sealed.has(v)).map(([v]) => v);
      executor = others.length ? pick(this.rng, others) : null;
      if (executor === null) killTarget = null;
    }

    const visits = new Map<number, number>();
    for (const [pid, c] of choices) {
      if (c.target === null || sealed.has(pid) || c.kind === 'kill' || c.kind === 'medium') continue;
      visits.set(pid, c.target);
    }
    if (executor !== null && killTarget !== null) visits.set(executor, killTarget);
    this.visits.set(this.night, visits);

    const protectedSet = new Set<number>();
    for (const [pid, c] of choices) if (c.kind === 'protect' && c.target !== null && !sealed.has(pid)) protectedSet.add(c.target);

    const deaths: number[] = [];
    const saved: number[] = [];
    const reveals: { who: number; role: RoleId }[] = [];
    if (killTarget !== null) {
      const t = this.players[killTarget];
      if (protectedSet.has(t.id)) saved.push(t.id);
      else if ((t.role === 'sturdy' || t.role === 'trap') && !t.shieldUsed) {
        t.shieldUsed = true;
        saved.push(t.id);
        if (t.role === 'trap' && executor !== null) reveals.push({ who: executor, role: this.players[executor].role });
        this.secret(t.id, t.role === 'trap' ? '습격을 받았지만 함정이 발동했다! 습격한 자의 정체가 아침에 드러난다.' : '습격을 받았지만 버텨냈다! (튼튼: 다음엔 못 버틴다)');
      } else deaths.push(t.id);
    }

    for (const [pid, c] of choices) {
      if (c.target === null) continue;
      const me = this.players[pid];
      const brain = this.brains.get(pid);
      if (sealed.has(pid) && c.kind !== 'kill') {
        this.secret(pid, '어젯밤 무언가에 봉인되어 능력이 발동하지 않았다.');
        brain?.privateInfo({ kind: 'sealed', night: this.night });
        continue;
      }
      const t = this.players[c.target];
      switch (c.kind) {
        case 'investigate': {
          const side: Side = this.isKiller(t) && !disguised.has(t.id) ? 'mafia' : 'citizen';
          this.secret(pid, `조사 결과: ${t.name}는 ${side === 'mafia' ? '마피아' : '마피아가 아니다'}.`);
          brain?.privateInfo({ kind: 'investigate', night: this.night, target: t.id, side });
          if (me.human) this.marks.set(t.id, side === 'mafia' ? '조사: 마피아' : '조사: 시민');
          break;
        }
        case 'medium':
          this.secret(pid, `영매: 사라진 ${t.name}의 정체는 ${roleName(t.role)}(${ROLES[t.role].job}).`);
          brain?.privateInfo({ kind: 'medium', night: this.night, target: t.id, role: t.role });
          if (me.human) this.marks.set(t.id, `영매: ${roleName(t.role)}`);
          break;
        case 'track': {
          const went = visits.get(t.id);
          this.secret(pid, went === undefined ? `추적: ${t.name}는 어젯밤 방을 나서지 않았다.` : `추적: ${t.name}는 어젯밤 ${this.name(went)}의 방에 갔다.`);
          brain?.privateInfo({ kind: 'track', night: this.night, target: t.id, went: went ?? -1 });
          break;
        }
        case 'reveal':
          me.usedOnce = true;
          reveals.push({ who: t.id, role: t.role });
          this.secret(pid, `공개: 아침에 ${t.name}의 정체가 모두에게 공개된다.`);
          break;
        case 'contact':
          if (t.role === 'nifel') {
            me.contacted = true;
            this.secret(pid, `접선 성공! ${t.name}는 니펠이었다. 이제부터 능력을 쓸 수 있다. (동료: ${this.mafiaMatesOf(me).map(this.name).join(', ')})`);
            for (const k of this.players.filter((q) => this.isKiller(q))) this.secret(k.id, `${me.name}가 접선해 왔다. 마피아 팀원(${roleName(me.role)})이다.`);
            for (const q of this.players) this.brains.get(q.id)?.privateInfo({ kind: 'contact', night: this.night, member: me.id });
            if (me.human) this.marks.set(t.id, '니펠');
          } else {
            this.secret(pid, `접선 실패. ${t.name}는 니펠이 아니었다.`);
            brain?.privateInfo({ kind: 'contactFail', night: this.night, target: t.id });
            if (me.human) this.marks.set(t.id, '접선 실패');
          }
          break;
      }
    }

    // 사망 처리
    for (const d of deaths) this.kill(d, 'night');
    this.pendingMorning = { deaths, saved, reveals };

    // 저택 쪽지
    this.mansionNote = this.makeMansionNote();
  }

  private pendingMorning: { deaths: number[]; saved: number[]; reveals: { who: number; role: RoleId }[] } | null = null;

  private makeMansionNote(): { night: number; to: number; clue: Clue } | null {
    const alive = this.alive();
    if (alive.length < 3) return null;
    const to = pick(this.rng, alive).id;
    const visits = this.visits.get(this.night)!;
    const others = alive.filter((p) => p.id !== to);
    const mafiaAlive = others.filter((p) => this.isMafiaTeam(p));
    const town = others.filter((p) => !this.isMafiaTeam(p));
    const options: Clue[] = [];
    for (const p of others) if (!visits.has(p.id)) options.push({ kind: 'stayed', who: p.id });
    for (const p of others) if (visits.has(p.id) && this.rng() < (this.difficulty === 'hard' ? 0.25 : 0.5)) options.push({ kind: 'visited', who: p.id, target: visits.get(p.id)! });
    for (const p of alive) {
      const count = [...visits.values()].filter((t) => t === p.id).length;
      options.push({ kind: 'visitedBy', target: p.id, count });
    }
    if (mafiaAlive.length && town.length) {
      const m = pick(this.rng, mafiaAlive).id;
      const c = pick(this.rng, town).id;
      const [a, b] = this.rng() < 0.5 ? [m, c] : [c, m];
      options.push({ kind: 'oneOf', a, b }, { kind: 'oneOf', a, b });
    }
    if (town.length) options.push({ kind: 'notMafia', who: pick(this.rng, town).id });
    if (!options.length) return null;
    return { night: this.night, to, clue: pick(this.rng, options) };
  }

  kill(id: number, how: Player['diedHow']) {
    const p = this.players[id];
    if (!p.alive) return;
    p.alive = false;
    p.diedDay = this.day;
    p.diedHow = how;
    for (const b of this.brains.values()) b.onDeath(id, how!);
  }

  // ── 낮 ───────────────────────────────────────────

  private async runDay() {
    this.day++;
    this.quota = { ask: 3, note: 1, contra: 2, claim: 2 };
    this.notePublished = false;
    this.asked.clear();
    this.io.log({ kind: 'phase', text: `${this.day}일째 아침` });
    const m = this.pendingMorning!;
    this.pendingMorning = null;
    if (!m.deaths.length && !m.saved.length) this.sys('조용한 밤이었다. 아무도 사라지지 않았다.');
    for (const d of m.deaths) {
      this.post({ kind: 'death', speaker: -1, night: this.night, who: d, text: `어젯밤 ${this.name(d)}가 사라졌다.` });
      this.io.log({ kind: 'death', text: `${this.name(d)}가 저택에서 사라졌습니다.` });
    }
    for (const _ of m.saved) this.sys(`누군가 습격당했지만 무사히 아침을 맞았다.`);
    for (const r of m.reveals) {
      this.players[r.who].revealed = true;
      this.post({ kind: 'reveal', speaker: -1, who: r.who, role: r.role, text: `저택의 계시: ${this.name(r.who)}의 정체는 ${roleName(r.role)}(${ROLES[r.role].job})이다.` });
    }
    this.quietDays = m.deaths.length ? 0 : this.quietDays + 1;
    this.io.update();
    if (this.checkWin()) return;
    await this.io.pause(600);

    // 박쥐
    const bat = this.players.find((p) => p.role === 'bat' && p.alive && !p.batSide);
    if (bat && this.day >= BAT_CHOOSE_DAY) {
      const side = bat.human ? await this.io.batChoose() : this.brains.get(bat.id)!.batSide();
      bat.batSide = side;
      this.secret(bat.id, `네르는 ${side === 'mafia' ? '마피아' : '시민'} 팀을 골랐다!`);
      this.sys('어딘가에서 분노에 찬 외침이 들렸다… 누군가 편을 정한 모양이다.');
      if (side === 'mafia') {
        for (const k of this.players.filter((q) => this.inMafiaChat(q) && q.id !== bat.id)) this.secret(k.id, `${bat.name}(네르)가 마피아 팀에 합류했다! 이제 습격에 함께한다.`);
        this.secret(bat.id, `동료: ${this.mafiaMatesOf(bat).map(this.name).join(', ') || '없음'}`);
      }
      for (const b of this.brains.values()) b.onBat(bat.id, side);
      if (this.checkWin()) return;
    }

    // 저택 쪽지 전달
    const note = this.mansionNote;
    if (note && this.players[note.to].alive) {
      this.sys('누군가의 방문 틈으로 봉인된 쪽지가 밀려 들어왔다…');
      this.secret(note.to, `🔏 저택의 봉인 쪽지 (진짜 정보): ${clueText(note.clue, this.name)}`);
      if (this.players[note.to].human) await this.io.gotMansionNote(note.clue);
      else this.brains.get(note.to)!.gotMansionNote(note.clue, note.night);
    }

    // 사라진 사람에 대한 반응
    const reactors = shuffle(this.rng, [...this.brains.values()].filter((b) => b.me.alive)).slice(0, m.deaths.length ? 2 : m.saved.length ? 1 : 0);
    for (const b of reactors) {
      const t = b.deathTalk(m.deaths, m.saved.length > 0);
      if (t) await this.say(t);
    }
    // 증언판: 정보 공개 (조사 결과, 쪽지 등)
    await this.botWave('morning');
    // 토론
    await this.discuss(Math.round(3 + this.alive().length * 0.6));
    // 봇이 사람에게 보내는 익명 쪽지
    const h = this.human;
    if (h?.alive) {
      for (const b of this.brains.values()) {
        if (!b.me.alive) continue;
        const n = b.noteForHuman(h.id);
        if (n) this.io.log({ kind: 'note', text: `✉ 익명 쪽지: ${n}`, privateTo: h.id });
      }
    }

    // 사람 플레이어의 낮 행동
    if (h?.alive) await this.io.day();
    // 오후: 마지막 토론, 모순 지목, 투표 의사
    this.sys('토론이 막바지에 이르렀다…');
    await this.discuss(2);
    await this.botWave('afternoon');
    if (this.over) return;

    await this.voting();
  }

  private async botWave(phase: 'morning' | 'afternoon') {
    const order = shuffle(this.rng, [...this.brains.values()].filter((b) => b.me.alive));
    for (const b of order) {
      const posts = phase === 'morning' ? b.morningPosts() : b.afternoonPosts();
      for (const p of posts) await this.say(p);
    }
  }

  /** 봇이 말할 때: 입력 중 표시 → 발언 */
  async say(input: StmtInput): Promise<Stmt> {
    if (input.speaker >= 0 && !this.players[input.speaker].human) {
      const ms = Math.max(900, Math.min(3200, 500 + input.text.length * 42));
      await this.io.typing(input.speaker, ms);
    }
    return this.post(input);
  }

  /** 오늘 누가 몇 번 말했나 */
  private spokenToday(): Map<number, number> {
    const m = new Map<number, number>();
    for (const x of this.board) if (x.day === this.day && x.speaker >= 0 && !x.anon) m.set(x.speaker, (m.get(x.speaker) ?? 0) + 1);
    return m;
  }

  /** 봇끼리 토론: 말할 사람을 골라 한 마디씩 */
  async discuss(turns: number) {
    let last = -1;
    for (let i = 0; i < turns && !this.over; i++) {
      const spoken = this.spokenToday();
      const cands = [...this.brains.values()].filter((b) => b.me.alive && b.me.id !== last);
      if (!cands.length) return;
      const weights = cands.map((b) => {
        const lastStmt = this.board[this.board.length - 1];
        const accused = lastStmt && ((lastStmt.kind === 'suspect' && lastStmt.target === b.me.id) || (lastStmt.kind === 'contra' && lastStmt.blame === b.me.id));
        return Math.max(0.1, 0.5 + b.persona.aggro * 0.8 + (accused ? 3 : 0) - (spoken.get(b.me.id) ?? 0) * 0.35);
      });
      let r = this.rng() * weights.reduce((a, x) => a + x, 0);
      let who = cands[0];
      for (let k = 0; k < cands.length; k++) { r -= weights[k]; if (r <= 0) { who = cands[k]; break; } }
      const res = who.discussTurn(spoken);
      if (!res) continue;
      last = who.me.id;
      await this.say(res.stmt);
      if (res.ask) {
        this.asked.add(`${res.ask.target}:${res.ask.q}`);
        const tb = this.brains.get(res.ask.target);
        if (tb && tb.me.alive) {
          await this.say(tb.answer(res.ask.q, who.me.id));
          last = tb.me.id;
        }
      }
    }
  }

  // ── 사람 플레이어의 낮 행동 (화면에서 호출) ─────────

  async humanClaim(input: StmtInput) {
    const h = this.human!;
    if (this.quota.claim <= 0 || !h.alive) return null;
    this.quota.claim--;
    const s = this.post({ ...input, speaker: h.id } as StmtInput);
    // 직업 주장이 겹치면 진짜 주인 봇이 반박
    await this.reactTo(s);
    return s;
  }

  /** 사람 플레이어가 받은 저택 쪽지를 공개 (clue 를 바꾸면 위조) */
  async humanPublishNote(clue: Clue): Promise<Stmt | null> {
    const h = this.human!;
    const note = this.mansionNote;
    if (!note || note.to !== h.id || this.notePublished || !h.alive) return null;
    this.notePublished = true;
    const s = this.post({ kind: 'mnote', speaker: h.id, night: note.night, clue, text: `오늘 아침 봉인된 쪽지를 받았어. 내용은 ${clueText(clue, this.name)}` });
    await this.reactTo(s);
    return s;
  }

  async humanAsk(target: number, q: 'role' | 'night' | 'suspect'): Promise<Stmt | null> {
    const h = this.human!;
    if (this.quota.ask <= 0 || !h.alive) return null;
    const b = this.brains.get(target);
    if (!b || !b.me.alive) return null;
    this.quota.ask--;
    this.asked.add(`${target}:${q}`);
    const label = q === 'role' ? '직업이 뭐야?' : q === 'night' ? '어젯밤 뭐 했어?' : '누가 제일 수상해?';
    this.io.log({ kind: 'say', text: `${this.name(target)}, ${label}`, speaker: h.id });
    const s = await this.say(b.answer(q, h.id));
    await this.reactTo(s, 1);
    return s;
  }

  humanNote(target: number, input: StmtInput) {
    const h = this.human!;
    if (this.quota.note <= 0 || !h.alive) return false;
    const b = this.brains.get(target);
    if (!b || !b.me.alive) return false;
    this.quota.note--;
    b.receiveNote({ ...input, id: -1, day: this.day, speaker: h.id, anon: true } as Stmt);
    this.secret(h.id, `${this.name(target)}에게 익명 쪽지를 보냈다: ${input.text}`);
    return true;
  }

  async humanContra(a: number, b: number, blame: number): Promise<Stmt | null> {
    const h = this.human!;
    if (this.quota.contra <= 0 || !h.alive) return null;
    const s1 = this.board.find((s) => s.id === a);
    const s2 = this.board.find((s) => s.id === b);
    if (!s1 || !s2) return null;
    this.quota.contra--;
    const valid = isContradiction(s1, s2);
    const s = this.post({
      kind: 'contra', speaker: h.id, a, b, blame, valid,
      text: `「${short(s1.text)}」와 「${short(s2.text)}」는 동시에 참일 수 없어! ${this.name(blame)}가 거짓말하고 있어!`,
    });
    if (!valid) this.sys('…다들 고개를 갸웃했다. 두 말이 꼭 부딪히는 건 아닌 것 같다.');
    else this.sys('모두의 시선이 ' + this.name(blame) + '에게 쏠렸다.');
    await this.reactTo(s);
    return s;
  }

  /** 방금 발언에 대한 봇들의 즉각 반응 */
  private async reactTo(s: Stmt, extra = 2) {
    for (const b of shuffle(this.rng, [...this.brains.values()])) {
      if (!b.me.alive) continue;
      const r = b.react(s);
      if (r) await this.say(r);
    }
    // 이어지는 토론 한두 마디
    await this.discuss(extra > 0 ? 1 + Math.floor(this.rng() * extra) : 0);
  }

  // ── 투표 ─────────────────────────────────────────

  private async voting() {
    const alive = this.alive();
    this.io.log({ kind: 'phase', text: '1차 투표' });
    const votes: VoteRecord[] = [];
    for (const p of alive) {
      const targets = alive.filter((q) => q.id !== p.id).map((q) => q.id);
      const t = p.human ? await this.io.vote1(targets) : this.brains.get(p.id)!.vote1(targets);
      votes.push({ voter: p.id, target: t });
    }
    this.announceVotes(votes, '1차 투표');
    const tally = countVotes(votes);
    if (!tally.length) {
      this.sys('아무도 표를 받지 않았다. 처형 없이 밤이 된다.');
      return;
    }
    const top = tally[0][1];
    const firsts = tally.filter(([, c]) => c === top).map(([t]) => t);
    let a: number, b: number | null;
    if (firsts.length >= 2) [a, b] = shuffle(this.rng, firsts).slice(0, 2) as [number, number];
    else {
      a = firsts[0];
      const rest = tally.filter(([t]) => t !== a);
      if (rest.length) {
        const second = rest[0][1];
        b = pick(this.rng, rest.filter(([, c]) => c === second).map(([t]) => t));
      } else b = null;
    }

    // 결선 대결
    this.io.log({ kind: 'phase', text: b === null ? `결선: ${this.name(a)} — 처형 찬반` : `결선 대결: ${this.name(a)} vs ${this.name(b)}` });
    for (const c of [a, b]) {
      if (c === null) continue;
      const p = this.players[c];
      let text: string;
      if (p.human) text = await this.io.defense();
      else {
        text = this.brains.get(c)!.defense();
        await this.io.typing(c, Math.max(1100, Math.min(3200, 500 + text.length * 42)));
      }
      this.io.log({ kind: 'say', text, speaker: c });
      for (const br of this.brains.values()) br.heardDefense(c);
      await this.io.pause(700);
    }
    const voters = this.alive().filter((p) => p.id !== a && p.id !== b);
    const v2: VoteRecord[] = [];
    for (const p of voters) {
      const t = p.human ? await this.io.vote2(a, b) : this.brains.get(p.id)!.vote2(a, b);
      v2.push({ voter: p.id, target: t });
    }
    // 선동: 표 하나 옮기기
    const agit = this.alive().find((p) => p.role === 'agitator' && p.contacted && !p.usedOnce);
    if (agit) {
      const move = agit.human ? await this.io.agitate(v2, a, b) : this.brains.get(agit.id)!.agitate(v2, a, b);
      if (move) {
        const rec = v2.find((r) => r.voter === move.voter);
        if (rec) {
          rec.target = move.to;
          agit.usedOnce = true;
          this.secret(agit.id, `선동: ${this.name(move.voter)}의 표를 ${move.to === null ? '처형 반대' : this.name(move.to)}로 옮겼다.`);
          this.sys('개표 직전, 어딘가에서 속삭임이 들렸다… 누군가의 마음이 바뀐 것 같다.');
        }
      }
    }
    this.lastVotes = v2;
    this.announceVotes(v2, '결선 투표', b === null ? a : undefined);
    const t2 = countVotes(v2);
    const ca = t2.find(([t]) => t === a)?.[1] ?? 0;
    const cb = b === null ? v2.filter((r) => r.target === null).length : t2.find(([t]) => t === b)?.[1] ?? 0;
    let executed: number | null = null;
    if (ca > cb) executed = a;
    else if (cb > ca && b !== null) executed = b;
    if (executed === null) {
      this.sys(ca === cb ? '동표! 처형 없이 밤이 된다.' : '처형이 부결되었다.');
      return;
    }
    // 뒤집기
    const ov = this.alive().find((p) => p.role === 'overturn' && !p.usedOnce && p.id !== executed);
    if (ov) {
      const use = ov.human ? await this.io.overturn(executed) : this.brains.get(ov.id)!.wantOverturn(executed);
      if (use) {
        ov.usedOnce = true;
        this.sys(`판결이 뒤집혔다! 누군가의 힘으로 ${this.name(executed)}의 처형이 무효가 되었다.`);
        for (const br of this.brains.values()) br.onOverturn(executed);
        return;
      }
    }
    await this.execute(executed);
  }

  private announceVotes(votes: VoteRecord[], label: string, single?: number) {
    const tally = countVotes(votes);
    const parts = tally.map(([t, c]) => `${this.name(t)} ${c}표`);
    if (single !== undefined) parts.push(`반대 ${votes.filter((v) => v.target === null).length}표`);
    this.io.log({ kind: 'vote', text: `${label} 결과 — ${parts.join(' · ') || '기권만 있었다'}` });
    for (const p of this.players) {
      if (p.alive && p.role === 'peeker') {
        this.secret(p.id, `엿보기: ${votes.map((v) => `${this.name(v.voter)}→${v.target === null ? (single !== undefined ? '반대' : '기권') : this.name(v.target)}`).join(', ')}`);
      }
    }
    for (const b of this.brains.values()) b.onVotes(votes, label);
  }

  private async execute(id: number) {
    const p = this.players[id];
    this.io.log({ kind: 'death', text: `${p.name}가 처형되었습니다.` });
    this.kill(id, 'vote');
    if (p.role === 'jester') {
      this.sys(`${p.name}가 웃음을 터뜨렸다. "속았지~!" — 광대였다!`);
      this.finish('jester');
      return;
    }
    if (p.role === 'avenger') {
      const targets = this.aliveIds();
      const t = p.human ? await this.io.avenge(targets) : this.brains.get(id)!.avenge(targets);
      if (t !== null) {
        this.sys(`${p.name}가 마지막 힘으로 ${this.name(t)}를 끌고 갔다!`);
        this.kill(t, 'avenge');
      }
    }
    this.checkWin();
  }

  // ── 승리 판정 ─────────────────────────────────────

  checkWin(): boolean {
    if (this.over) return true;
    const alive = this.alive();
    let killers = alive.filter((p) => this.isKiller(p));
    if (!killers.length) {
      const heir = alive.find((p) => p.role === 'heir' && p.contacted && !p.heirAwake);
      if (heir) {
        heir.heirAwake = true;
        this.secret(heir.id, '니펠이 모두 사라졌다… 후계로서 니펠의 힘을 이어받았다! 이제 밤마다 습격한다.');
        for (const b of this.brains.values()) b.onHeir(heir.id);
        killers = [heir];
      }
    }
    if (!killers.length) return this.finish('citizen');
    const mafia = alive.filter((p) => this.isMafiaTeam(p)).length;
    if (mafia >= alive.length - mafia) return this.finish('mafia');
    if (this.quietDays >= 6) return this.finish('draw');
    return false;
  }

  finish(w: Winner): true {
    if (this.over) return true;
    this.over = true;
    this.winner = w;
    const win = new Set<number>();
    for (const p of this.players) {
      const team = this.isMafiaTeam(p) ? 'mafia' : p.role === 'bat' ? (p.batSide ?? 'none') : ROLES[p.role].team;
      if (w === 'jester' ? p.role === 'jester' : team === w) win.add(p.id);
      if (p.role === 'survivor' && p.alive && w !== 'draw') win.add(p.id);
    }
    this.winners = [...win];
    const label = w === 'mafia' ? '마피아 팀 승리!' : w === 'citizen' ? '시민 팀 승리!' : w === 'jester' ? '광대 승리!' : '무승부';
    this.io.log({ kind: 'win', text: label });
    this.io.update();
    return true;
  }
}

function countVotes(votes: VoteRecord[]): [number, number][] {
  const m = new Map<number, number>();
  for (const v of votes) if (v.target !== null) m.set(v.target, (m.get(v.target) ?? 0) + 1);
  return [...m].sort((x, y) => y[1] - x[1]);
}

function short(s: string) {
  return s.length > 28 ? s.slice(0, 27) + '…' : s;
}

export function nightTitle(k: NightKind): string {
  return {
    kill: '오늘 밤 습격할 사람', contact: '접선을 시도할 사람', seal: '능력을 봉인할 사람', disguise: '시민으로 위장시킬 사람',
    protect: '지켜줄 사람', investigate: '조사할 사람', medium: '영혼을 불러낼 사람', track: '지켜볼 사람', reveal: '정체를 공개할 사람',
  }[k];
}

export { line };
