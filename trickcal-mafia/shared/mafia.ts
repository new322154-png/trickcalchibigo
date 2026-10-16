/**
 * 마피아 본게임 (서버에서만 돈다. 화면에는 각자 알아도 되는 정보만 보낸다)
 *
 * 밤: ① 봉인·위장 → ② 니펠·접선 → ③ 의사·경찰·추적·공개 (차례마다 15초, 없는 직업 차례도 항상 기다림)
 *     경찰·접선은 쓰자마자 결과, 추적은 ③차례 끝, 습격·보호·공개는 아침에 한꺼번에.
 * 낮: 토론(살아 있는 사람 × 20초, 최소 90초) → 1차 투표 20초 → 결선 변론 45초 → 결선 투표 15초 → 판결
 */
import {
  BAT_CHOOSE_DAY, CITIZEN_POOL, COMPOSITION, MEMBER_POOL, NEUTRAL_POOL, NIGHT_STEP, NO_FIRST_KILL, OPTIONAL_NIGHT, ROLES,
  roleName, type NightKind, type RoleId,
} from './roles';
import {
  STEP_SECONDS, type C2S, type ChatCh, type ChoiceKey, type GameView, type LogCh, type Phase, type S2C, type Winner,
} from './protocol';

export interface GameHost {
  send(pid: number, msg: S2C): void;
  later(ms: number, fn: () => void): unknown;
  clearTimers(): void;
  onEnd(): void;
}

interface GP {
  pid: number;
  name: string;
  role: RoleId;
  alive: boolean;
  online: boolean;
  diedHow?: 'night' | 'vote' | 'avenge' | 'leave';
  contacted: boolean;
  heirAwake: boolean;
  usedOnce: boolean;
  shieldUsed: boolean;
  batSide?: 'mafia' | 'citizen';
  revealed: boolean;
  notesLeft: number;
}

interface Act { kind: NightKind; targets: number[]; optional: boolean; choice: number | null; locked: boolean; done: boolean }
interface Prompt { key: ChoiceKey; options: (number | string)[]; text: string; resolve: (v: number | string | null) => void }

const rand = <T>(a: T[]) => a[Math.floor(Math.random() * a.length)];
function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

export class MafiaGame {
  ps = new Map<number, GP>();
  phase: Phase = 'intro';
  day = 0;
  night = 0;
  step: 0 | 1 | 2 | 3 = 0;
  endsAt = 0;
  over = false;
  private acts = new Map<number, Act>();
  private sealed = new Set<number>();
  private disguised = new Set<number>();
  private killVotes = new Map<number, number | null>();
  private visits = new Map<number, number>();
  private morning: { deaths: number[]; saved: number; reveals: { who: number; role: RoleId; why: 'reveal' | 'trap' }[] } = { deaths: [], saved: 0, reveals: [] };
  private votes = new Map<number, number | null>();
  private cands: number[] = [];
  private counts: [number, number][] | undefined;
  private agitated: { voter: number } | null = null;
  private prompts = new Map<number, Prompt>();
  private quietDays = 0;
  private trackerJobs: { pid: number; target: number }[] = [];

  constructor(private host: GameHost, seats: { pid: number; name: string }[]) {
    const n = seats.length;
    const [nifel, members, rnd, neutrals] = COMPOSITION[n];
    const roles = shuffle<RoleId>([
      ...Array<RoleId>(nifel).fill('nifel'),
      ...shuffle(MEMBER_POOL).slice(0, members),
      'doctor', 'police',
      ...shuffle(CITIZEN_POOL).slice(0, rnd),
      ...shuffle(NEUTRAL_POOL).slice(0, neutrals),
    ]);
    seats.forEach((s, i) => this.ps.set(s.pid, {
      pid: s.pid, name: s.name, role: roles[i], alive: true, online: true,
      contacted: false, heirAwake: false, usedOnce: false, shieldUsed: false, revealed: false, notesLeft: 1,
    }));
  }

  // ── 조회 ─────────────────────────────────────────

  private all() { return [...this.ps.values()]; }
  private alive() { return this.all().filter((p) => p.alive); }
  private name = (pid: number) => this.ps.get(pid)?.name ?? '?';
  isKiller(p: GP) { return p.role === 'nifel' || (p.role === 'heir' && p.heirAwake) || (p.role === 'bat' && p.batSide === 'mafia'); }
  isMafiaTeam(p: GP) { return p.role === 'nifel' || !!ROLES[p.role].member || (p.role === 'bat' && p.batSide === 'mafia'); }
  private inNifelChat(p: GP) { return this.isKiller(p) || (!!ROLES[p.role].member && p.contacted); }
  private matesOf(p: GP) { return this.inNifelChat(p) ? this.all().filter((q) => q.pid !== p.pid && this.inNifelChat(q)).map((q) => q.pid) : []; }

  private nightKind(p: GP): NightKind | null {
    if (!p.alive) return null;
    if (this.isKiller(p)) return 'kill';
    const def = ROLES[p.role];
    if (def.member) return p.contacted ? def.night ?? null : 'contact';
    if (!def.night) return null;
    if (def.once && p.usedOnce) return null;
    return def.night;
  }

  private targetsFor(p: GP, kind: NightKind) {
    const mates = this.matesOf(p);
    return this.alive()
      .filter((q) => q.pid !== p.pid || ROLES[p.role].selfTarget)
      .filter((q) => (kind === 'kill' ? !mates.includes(q.pid) : true))
      .map((q) => q.pid);
  }

  // ── 전송 ─────────────────────────────────────────

  private log(to: number, ch: LogCh, text: string, from = -1) { this.host.send(to, { t: 'glog', ch, from, text }); }
  private logAll(ch: LogCh, text: string, from = -1) { for (const p of this.all()) this.log(p.pid, ch, text, from); }
  private secret(pid: number, text: string) { this.log(pid, 'secret', text); }

  view(pid: number): GameView {
    const p = this.ps.get(pid)!;
    const act = this.acts.get(pid);
    const prompt = this.prompts.get(pid);
    const killer = this.isKiller(p);
    return {
      phase: this.phase, day: this.day, night: this.night, step: this.step, endsAt: this.endsAt, now: Date.now(),
      players: this.all().map((q) => ({ pid: q.pid, name: q.name, alive: q.alive, online: q.online })),
      me: {
        pid, role: p.role, alive: p.alive, mates: this.matesOf(p),
        act: act ? { kind: act.kind, targets: act.targets, optional: act.optional, done: act.done, locked: act.locked, choice: act.choice } : null,
        teamVotes: killer && this.step === 2 ? [...this.killVotes] : undefined,
        chats: this.chatsOf(p),
        notesLeft: this.phase === 'day' && p.alive ? p.notesLeft : 0,
        vote: this.votes.has(pid) ? this.votes.get(pid) : undefined,
        canVote: p.alive && ((this.phase === 'vote1') || (this.phase === 'vote2' && !this.cands.includes(pid))),
        prompt: prompt ? { key: prompt.key, options: prompt.options, text: prompt.text } : null,
      },
      cands: this.cands,
      counts: this.counts,
    };
  }

  private push(pid?: number) {
    if (pid !== undefined) { this.host.send(pid, { t: 'g', v: this.view(pid) }); return; }
    for (const p of this.all()) this.host.send(p.pid, { t: 'g', v: this.view(p.pid) });
  }

  private chatsOf(p: GP): ChatCh[] {
    if (this.over) return ['day'];
    if (!p.alive) return ['dead'];
    if (this.phase === 'day') return ['day'];
    if (this.phase === 'defense') return this.cands.includes(p.pid) ? ['defense'] : [];
    if (this.phase === 'night') {
      const out: ChatCh[] = [];
      if (this.inNifelChat(p)) out.push('nifel');
      if (p.role === 'medium') out.push('dead');
      return out;
    }
    return [];
  }

  /** 이 채널 메시지를 볼 수 있는 사람 */
  private readers(ch: ChatCh): GP[] {
    switch (ch) {
      case 'day': case 'defense': return this.all();
      case 'nifel': return this.all().filter((q) => this.inNifelChat(q) || !q.alive);
      case 'dead': return this.all().filter((q) => !q.alive || (q.role === 'medium' && q.alive && this.phase === 'night'));
    }
  }

  // ── 진행 ─────────────────────────────────────────

  private timer(sec: number, fn: () => void) {
    const k = (globalThis as { __MAFIA_SPEED?: number }).__MAFIA_SPEED ?? 1; // 테스트용 시간 배속
    this.endsAt = Date.now() + sec * 1000 * k;
    this.host.later(sec * 1000 * k, fn);
  }

  start() {
    this.phase = 'intro';
    for (const p of this.all()) {
      const mates = this.matesOf(p);
      this.secret(p.pid, `당신은 ${roleName(p.role)}(${ROLES[p.role].job})입니다. ${ROLES[p.role].desc}`);
      if (mates.length) this.secret(p.pid, `함께하는 니펠: ${mates.map(this.name).join(', ')}`);
      if (ROLES[p.role].member) this.secret(p.pid, '아직 니펠과 접선하지 못했어요. 밤 ②차례에 한 명의 방에 들어가 니펠이면 접선 성공! 접선해야 능력을 쓸 수 있어요.');
    }
    this.timer(8, () => this.startNight());
    this.push();
  }

  private startNight() {
    if (this.over) return;
    this.night++;
    this.phase = 'night';
    this.sealed.clear(); this.disguised.clear(); this.killVotes.clear(); this.visits.clear(); this.trackerJobs = [];
    this.morning = { deaths: [], saved: 0, reveals: [] };
    this.logAll('event', `🌙 ${this.night}번째 밤이 찾아왔다. 모두 자기 방으로…`);
    this.runStep(1);
  }

  private runStep(step: 1 | 2 | 3) {
    this.step = step;
    this.acts.clear();
    for (const p of this.alive()) {
      const kind = this.nightKind(p);
      if (!kind || NIGHT_STEP[kind] !== step) continue;
      const targets = this.targetsFor(p, kind);
      if (!targets.length) continue;
      const locked = this.sealed.has(p.pid);
      this.acts.set(p.pid, { kind, targets, optional: OPTIONAL_NIGHT.includes(kind), choice: null, locked, done: false });
      if (locked) this.secret(p.pid, '방 문이 잠겨 있다… 누군가에게 봉인당했다. 오늘 밤은 능력을 쓸 수 없다.');
    }
    if (step === 2) for (const [pid, a] of this.acts) if (a.kind === 'kill' && !a.locked) this.killVotes.set(pid, null);
    this.timer(STEP_SECONDS, () => this.endStep(step));
    this.push();
  }

  private act(p: GP, target: number | null) {
    const a = this.acts.get(p.pid);
    if (!a || a.locked || this.phase !== 'night') return;
    if (target !== null && !a.targets.includes(target)) return;
    if (a.kind === 'kill') {
      this.killVotes.set(p.pid, target);
      a.choice = target;
      for (const [k] of this.killVotes) this.push(k);
      return;
    }
    if (a.done) return; // 한 번 고르면 끝
    a.choice = target;
    a.done = true;
    if (target === null) { this.push(p.pid); return; }
    const t = this.ps.get(target)!;
    // 즉발형
    if (a.kind === 'investigate') {
      const mafia = this.isKiller(t) && !this.disguised.has(t.pid);
      this.secret(p.pid, `🔍 조사 결과: ${t.name}는 ${mafia ? '마피아다!' : '마피아가 아니다.'}`);
    }
    if (a.kind === 'contact') {
      if (t.role === 'nifel') {
        p.contacted = true;
        this.secret(p.pid, `🤝 접선 성공! ${t.name}는 니펠이었다. 이제 능력을 쓸 수 있고 니펠 채팅에 들어간다. 동료: ${this.matesOf(p).map(this.name).join(', ')}`);
        for (const q of this.all()) if (q.pid !== p.pid && this.isKiller(q)) this.secret(q.pid, `🤝 ${p.name}가 접선해 왔다. 마피아 팀원(${roleName(p.role)})이다.`);
      } else this.secret(p.pid, `접선 실패. ${t.name}는 니펠이 아니었다.`);
    }
    this.push(p.pid);
  }

  private endStep(step: 1 | 2 | 3) {
    if (this.over) return;
    // 시간 안에 못 고른 사람: 필수 능력은 무작위
    for (const [pid, a] of this.acts) {
      if (a.locked) continue;
      if (a.kind === 'kill') continue;
      if (!a.done && !a.optional) {
        const p = this.ps.get(pid)!;
        this.secret(pid, '시간이 다 되어 대상이 무작위로 정해졌다.');
        this.act(p, rand(a.targets));
      }
    }
    // 방문 기록
    for (const [pid, a] of this.acts) if (!a.locked && a.kind !== 'kill' && a.choice !== null) this.visits.set(pid, a.choice);
    if (step === 1) {
      for (const [, a] of this.acts) {
        if (a.locked || a.choice === null) continue;
        if (a.kind === 'seal') this.sealed.add(a.choice);
        if (a.kind === 'disguise') this.disguised.add(a.choice);
      }
      return this.runStep(2);
    }
    if (step === 2) {
      const noKill = this.night === 1 && NO_FIRST_KILL(this.ps.size);
      const tally = new Map<number, number>();
      for (const t of this.killVotes.values()) if (t !== null) tally.set(t, (tally.get(t) ?? 0) + 1);
      if (tally.size && !noKill) {
        const max = Math.max(...tally.values());
        const target = rand([...tally].filter(([, c]) => c === max).map(([t]) => t));
        const voters = [...this.killVotes].filter(([, t]) => t === target).map(([v]) => v);
        const executor = rand(voters);
        this.visits.set(executor, target);
        this.pendingKill = { target, executor };
        for (const v of this.killVotes.keys()) this.secret(v, `오늘 밤 습격 대상: ${this.name(target)}`);
      } else {
        this.pendingKill = null;
        for (const v of this.killVotes.keys()) this.secret(v, noKill ? '첫날 밤이라 습격은 하지 않는다.' : '오늘 밤은 아무도 습격하지 않았다.');
      }
      return this.runStep(3);
    }
    // ③ 끝: 추적 결과 → 밤 정산
    for (const [pid, a] of this.acts) {
      if (a.locked || a.choice === null) continue;
      if (a.kind === 'track') {
        const went = this.visits.get(a.choice);
        this.secret(pid, went === undefined ? `👣 추적: ${this.name(a.choice)}는 어젯밤 방을 나서지 않았다.` : `👣 추적: ${this.name(a.choice)}는 ${this.name(went)}의 방에 갔다.`);
      }
      if (a.kind === 'reveal') {
        const p = this.ps.get(pid)!;
        p.usedOnce = true;
        const t = this.ps.get(a.choice)!;
        this.morning.reveals.push({ who: t.pid, role: t.role, why: 'reveal' });
        this.secret(pid, `📜 아침에 ${t.name}의 정체가 공개된다.`);
      }
    }
    const protectedSet = new Set<number>();
    for (const [, a] of this.acts) if (a.kind === 'protect' && !a.locked && a.choice !== null) protectedSet.add(a.choice);
    const k = this.pendingKill;
    if (k) {
      const t = this.ps.get(k.target)!;
      if (protectedSet.has(t.pid)) this.morning.saved++;
      else if ((t.role === 'sturdy' || t.role === 'trap') && !t.shieldUsed) {
        t.shieldUsed = true;
        this.morning.saved++;
        if (t.role === 'trap') this.morning.reveals.push({ who: k.executor, role: this.ps.get(k.executor)!.role, why: 'trap' });
        this.secret(t.pid, t.role === 'trap' ? '습격당했지만 함정이 발동했다! 습격한 자의 정체가 아침에 드러난다.' : '습격당했지만 버텨냈다! (다음엔 못 버틴다)');
      } else this.morning.deaths.push(t.pid);
    }
    this.step = 0;
    this.acts.clear();
    this.startMorning();
  }
  private pendingKill: { target: number; executor: number } | null = null;

  private kill(pid: number, how: GP['diedHow']) {
    const p = this.ps.get(pid);
    if (!p || !p.alive) return;
    p.alive = false;
    p.diedHow = how;
    this.secret(pid, '당신은 저택에서 사라졌습니다… 이제 죽은 사람끼리 채팅하고, 니펠의 밤 대화를 엿볼 수 있어요.');
  }

  private startMorning() {
    if (this.over) return;
    this.day++;
    this.phase = 'morning';
    const m = this.morning;
    this.logAll('event', `☀ ${this.day}일째 아침`);
    for (const d of m.deaths) { this.kill(d, 'night'); this.logAll('event', `💀 어젯밤 ${this.name(d)}가 사라졌다.`); }
    for (let i = 0; i < m.saved; i++) this.logAll('event', '누군가 습격당했지만 무사히 아침을 맞았다.');
    if (!m.deaths.length && !m.saved) this.logAll('event', '조용한 밤이었다.');
    for (const r of m.reveals) {
      const p = this.ps.get(r.who)!;
      p.revealed = true;
      this.logAll('event', r.why === 'trap'
        ? `⚠ 함정 발동! 습격한 자는 ${p.name}, 정체는 ${roleName(r.role)}(${ROLES[r.role].job})!`
        : `📜 저택의 계시: ${p.name}의 정체는 ${roleName(r.role)}(${ROLES[r.role].job})이다.`);
    }
    this.quietDays = m.deaths.length ? 0 : this.quietDays + 1;
    for (const p of this.all()) p.notesLeft = 1;
    if (this.checkWin()) return;
    // 박쥐
    const bat = this.alive().find((p) => p.role === 'bat' && !p.batSide);
    if (bat && this.day >= BAT_CHOOSE_DAY) {
      this.ask(bat.pid, 'bat', ['mafia', 'citizen'], '네르가 분노하며 변신한다! 어느 편에 설까? (안 고르면 무작위)', (v) => {
        const side = v === 'mafia' || v === 'citizen' ? v : rand(['mafia', 'citizen'] as const);
        bat.batSide = side;
        this.secret(bat.pid, `네르는 ${side === 'mafia' ? '마피아' : '시민'} 팀을 골랐다!`);
        if (side === 'mafia') {
          for (const q of this.all()) if (q.pid !== bat.pid && this.inNifelChat(q)) this.secret(q.pid, `🦇 ${bat.name}(네르)가 마피아 팀에 합류했다! 이제 습격에 함께한다.`);
          this.secret(bat.pid, `동료: ${this.matesOf(bat).map(this.name).join(', ') || '없음'}`);
        }
        this.logAll('event', '어딘가에서 분노에 찬 외침이 들렸다… 누군가 편을 정한 모양이다.');
      });
    }
    this.timer(10, () => { this.resolvePrompts(); if (!this.checkWin()) this.startDay(); });
    this.push();
  }

  private startDay() {
    if (this.over) return;
    this.phase = 'day';
    const sec = Math.max(90, this.alive().length * 20);
    this.logAll('sys', `토론 시간 ${sec}초. 익명 쪽지는 하루 한 번 보낼 수 있어요.`);
    this.timer(sec, () => this.startVote1());
    this.push();
  }

  private startVote1() {
    if (this.over) return;
    this.phase = 'vote1';
    this.votes.clear();
    this.cands = [];
    this.counts = undefined;
    this.logAll('event', '🗳 1차 투표! 처형할 사람을 고르세요.');
    this.timer(20, () => this.endVote1());
    this.push();
  }

  private endVote1() {
    if (this.over || this.phase !== 'vote1') return;
    this.host.clearTimers();
    const tally = new Map<number, number>();
    for (const t of this.votes.values()) if (t !== null) tally.set(t, (tally.get(t) ?? 0) + 1);
    const sorted = [...tally].sort((a, b) => b[1] - a[1]);
    this.counts = sorted;
    this.logAll('event', `1차 투표 결과 — ${sorted.map(([t, c]) => `${this.name(t)} ${c}표`).join(' · ') || '모두 기권'}`);
    this.peek('1차 투표');
    if (!sorted.length) { this.logAll('event', '처형 없이 밤이 된다.'); this.host.later(3000, () => this.startNight()); this.push(); return; }
    const top = sorted[0][1];
    const firsts = sorted.filter(([, c]) => c === top).map(([t]) => t);
    if (firsts.length >= 2) this.cands = shuffle(firsts).slice(0, 2);
    else {
      const rest = sorted.filter(([t]) => t !== firsts[0]);
      this.cands = rest.length ? [firsts[0], rand(rest.filter(([, c]) => c === rest[0][1]).map(([t]) => t))] : [firsts[0]];
    }
    this.phase = 'defense';
    this.logAll('event', this.cands.length === 2 ? `⚖ 결선 대결: ${this.name(this.cands[0])} vs ${this.name(this.cands[1])} — 45초 동안 변론하세요!` : `⚖ ${this.name(this.cands[0])}의 최후 변론 (45초)`);
    this.timer(45, () => this.startVote2());
    this.push();
  }

  private startVote2() {
    if (this.over) return;
    this.phase = 'vote2';
    this.votes.clear();
    this.counts = undefined;
    this.agitated = null;
    this.logAll('event', this.cands.length === 2 ? '🗳 결선 투표! 둘 중 한 명을 고르세요. 동표면 처형 없이 밤.' : '🗳 처형 찬반 투표!');
    const agit = this.alive().find((p) => p.role === 'agitator' && p.contacted && !p.usedOnce && !this.cands.includes(p.pid));
    if (agit) {
      const opts = this.alive().filter((q) => q.pid !== agit.pid && !this.cands.includes(q.pid)).map((q) => q.pid);
      this.ask(agit.pid, 'agitate', opts, '선동 (한 번): 고른 사람의 표를 반대쪽으로 뒤집는다. 쓰지 않으려면 그냥 두세요.', (v) => {
        if (typeof v === 'number' && opts.includes(v)) { this.agitated = { voter: v }; agit.usedOnce = true; this.secret(agit.pid, `🗣 ${this.name(v)}의 표를 뒤집기로 했다.`); }
      });
    }
    this.timer(15, () => this.endVote2());
    this.push();
  }

  private endVote2() {
    if (this.over || this.phase !== 'vote2') return;
    this.host.clearTimers();
    this.resolvePrompts();
    const [a, b] = this.cands;
    if (this.agitated && this.votes.has(this.agitated.voter)) {
      const cur = this.votes.get(this.agitated.voter);
      this.votes.set(this.agitated.voter, b === undefined ? (cur === null ? a : null) : cur === a ? b : a);
      this.logAll('event', '개표 직전, 어딘가에서 속삭임이 들렸다… 누군가의 마음이 바뀐 것 같다.');
    }
    const ca = [...this.votes.values()].filter((v) => v === a).length;
    const cb = b === undefined ? [...this.votes.values()].filter((v) => v === null).length : [...this.votes.values()].filter((v) => v === b).length;
    this.counts = b === undefined ? [[a, ca]] : [[a, ca], [b, cb]];
    this.logAll('event', b === undefined ? `결과 — 찬성 ${ca} · 반대 ${cb}` : `결선 결과 — ${this.name(a)} ${ca}표 · ${this.name(b)} ${cb}표`);
    this.peek('결선 투표');
    let executed: number | null = null;
    if (ca > cb) executed = a;
    else if (b !== undefined && cb > ca) executed = b;
    this.phase = 'verdict';
    if (executed === null) {
      this.logAll('event', ca === cb ? '동표! 처형 없이 밤이 된다.' : '처형이 부결되었다.');
      this.timer(4, () => this.startNight());
      this.push();
      return;
    }
    const ex = executed;
    const ov = this.alive().find((p) => p.role === 'overturn' && !p.usedOnce && p.pid !== ex);
    this.logAll('event', `판결 확정 중… (${this.name(ex)})`);
    if (ov) {
      this.ask(ov.pid, 'overturn', ['yes', 'no'], `${this.name(ex)}의 처형이 결정됐다. 단 한 번, 판결을 무효로 만들 수 있다.`, (v) => {
        if (v === 'yes') { ov.usedOnce = true; this.overturned = true; }
      });
    }
    this.overturned = false;
    this.timer(7, () => {
      this.resolvePrompts();
      if (this.overturned) {
        this.logAll('event', `↺ 판결이 뒤집혔다! 누군가의 힘으로 ${this.name(ex)}의 처형이 무효가 되었다.`);
        this.timer(4, () => this.startNight());
        this.push();
        return;
      }
      this.execute(ex);
    });
    this.push();
  }
  private overturned = false;

  private execute(pid: number) {
    const p = this.ps.get(pid)!;
    this.logAll('event', `⚖ ${p.name}가 처형되었다.`);
    this.kill(pid, 'vote');
    if (p.role === 'jester') {
      this.logAll('event', `${p.name}가 웃음을 터뜨렸다. "속았지~!" — 광대였다!`);
      return void this.finish('jester');
    }
    if (p.role === 'avenger') {
      const opts = this.alive().map((q) => q.pid);
      this.ask(pid, 'avenge', opts, '길동무: 한 명을 골라 함께 데려갈 수 있다. (10초)', (v) => {
        if (typeof v === 'number' && opts.includes(v)) { this.logAll('event', `☠ ${p.name}가 마지막 힘으로 ${this.name(v)}를 끌고 갔다!`); this.kill(v, 'avenge'); }
      });
      this.timer(10, () => { this.resolvePrompts(); if (!this.checkWin()) this.startNight(); });
      this.push();
      return;
    }
    if (this.checkWin()) return;
    this.timer(4, () => this.startNight());
    this.push();
  }

  private peek(label: string) {
    for (const p of this.alive()) {
      if (p.role !== 'peeker') continue;
      this.secret(p.pid, `👀 엿보기 (${label}): ${[...this.votes].map(([v, t]) => `${this.name(v)}→${t === null ? '기권/반대' : this.name(t)}`).join(', ') || '없음'}`);
    }
  }

  // ── 선택창 ───────────────────────────────────────

  private ask(pid: number, key: ChoiceKey, options: (number | string)[], text: string, resolve: (v: number | string | null) => void) {
    this.prompts.set(pid, { key, options, text, resolve });
  }
  private answer(pid: number, key: ChoiceKey, v: number | string | null) {
    const pr = this.prompts.get(pid);
    if (!pr || pr.key !== key) return;
    if (v !== null && !pr.options.includes(v)) return;
    this.prompts.delete(pid);
    pr.resolve(v);
    this.push(pid);
  }
  /** 시간이 다 된 선택창은 기본값(null)으로 */
  private resolvePrompts() {
    for (const [pid, pr] of [...this.prompts]) { this.prompts.delete(pid); pr.resolve(null); }
  }

  // ── 승리 ─────────────────────────────────────────

  private checkWin(): boolean {
    if (this.over) return true;
    const alive = this.alive();
    let killers = alive.filter((p) => this.isKiller(p));
    if (!killers.length) {
      const heir = alive.find((p) => p.role === 'heir' && p.contacted && !p.heirAwake);
      if (heir) {
        heir.heirAwake = true;
        this.secret(heir.pid, '니펠이 모두 사라졌다… 후계로서 니펠의 힘을 이어받았다! 이제 밤마다 습격한다.');
        killers = [heir];
      }
    }
    if (!killers.length) return this.finish('citizen');
    const mafia = alive.filter((p) => this.isMafiaTeam(p)).length;
    if (mafia >= alive.length - mafia) return this.finish('mafia');
    if (this.quietDays >= 6) return this.finish('draw');
    return false;
  }

  private finish(w: Winner): true {
    if (this.over) return true;
    this.over = true;
    this.host.clearTimers();
    this.phase = 'end';
    const winners: number[] = [];
    for (const p of this.all()) {
      const team = this.isMafiaTeam(p) ? 'mafia' : p.role === 'bat' ? p.batSide ?? 'none' : ROLES[p.role].team;
      if (w === 'jester' ? p.role === 'jester' : team === w) winners.push(p.pid);
      else if (p.role === 'survivor' && p.alive && w !== 'draw') winners.push(p.pid);
    }
    const label = w === 'mafia' ? '마피아 팀 승리!' : w === 'citizen' ? '시민 팀 승리!' : w === 'jester' ? '광대 승리!' : '무승부';
    this.logAll('event', `🏆 ${label}`);
    const roles = this.all().map((p) => ({ pid: p.pid, role: p.role, alive: p.alive }));
    for (const p of this.all()) this.host.send(p.pid, { t: 'gend', winner: w, roles, winners });
    this.push();
    this.host.later(15_000, () => this.host.onEnd());
    return true;
  }

  // ── 메시지 ───────────────────────────────────────

  handle(pid: number, msg: C2S) {
    const p = this.ps.get(pid);
    if (!p || this.over) return;
    switch (msg.t) {
      case 'act':
        if (p.alive) this.act(p, msg.target === null ? null : Number(msg.target));
        break;
      case 'vote': {
        if (!p.alive) return;
        const t = msg.target === null ? null : Number(msg.target);
        if (this.phase === 'vote1') {
          if (t !== null && (t === pid || !this.ps.get(t)?.alive)) return;
          this.votes.set(pid, t);
          this.push(pid);
          if (this.alive().every((q) => this.votes.has(q.pid))) this.endVote1();
        } else if (this.phase === 'vote2') {
          if (this.cands.includes(pid)) return;
          if (t !== null && !this.cands.includes(t)) return;
          this.votes.set(pid, t);
          this.push(pid);
        }
        break;
      }
      case 'gchat': {
        const text = String(msg.text ?? '').replace(/[\u0000-\u001f]/g, '').trim().slice(0, 120);
        if (!text || !this.chatsOf(p).includes(msg.ch)) return;
        for (const q of this.readers(msg.ch)) this.log(q.pid, msg.ch, text, pid);
        break;
      }
      case 'note': {
        const to = this.ps.get(Number(msg.to));
        const text = String(msg.text ?? '').replace(/[\u0000-\u001f]/g, '').trim().slice(0, 80);
        if (this.phase !== 'day' || !p.alive || p.notesLeft <= 0 || !to || !to.alive || to.pid === pid || !text) return;
        p.notesLeft--;
        this.log(to.pid, 'note', text);
        this.secret(pid, `✉ ${to.name}에게 익명 쪽지를 보냈다: ${text}`);
        this.push(pid);
        break;
      }
      case 'choice':
        this.answer(pid, msg.key, msg.value);
        break;
      case 'cmove': {
        // 니펠 차례: 같이 나온 동료에게 내 위치를 알려 준다
        if (this.phase !== 'night' || this.step !== 2 || !this.isKiller(p)) return;
        const x = Number(msg.x), y = Number(msg.y);
        if (!Number.isFinite(x) || !Number.isFinite(y)) return;
        for (const q of this.alive()) if (q.pid !== pid && this.isKiller(q)) this.host.send(q.pid, { t: 'gcmove', pid, x, y });
        break;
      }
    }
  }

  setOnline(pid: number, online: boolean) {
    const p = this.ps.get(pid);
    if (!p) return;
    p.online = online;
    if (online) this.push(pid);
    this.pushPlayersOnly();
  }

  /** 30초 넘게 끊긴 사람 */
  drop(pid: number) {
    const p = this.ps.get(pid);
    if (!p || !p.alive || this.over) return;
    this.logAll('event', `🔌 ${p.name}의 연결이 끊겨 저택에서 사라졌다.`);
    this.kill(pid, 'leave');
    this.checkWin();
    this.push();
  }

  private pushPlayersOnly() { this.push(); }
}
