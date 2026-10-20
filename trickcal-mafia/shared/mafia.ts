/**
 * 마피아 본게임 (서버에서만 돈다. 화면에는 각자 알아도 되는 정보만 보낸다)
 *
 * 밤: ① 뮤트·스피키 → ② 니펠 → ③ 나머지 능력 (차례마다 15초, 없는 직업 차례도 항상 기다림)
 *     조사·직업 탐지·변장은 쓰자마자 결과, 추적은 ③차례 끝, 습격·치유·공개·소원은 아침에 한꺼번에.
 * 낮: 토론(살아 있는 사람 × 20초, 최소 90초) → 1차 투표 20초 → 결선 변론 45초 → 결선 투표 15초 → 판결
 *
 * 접선 (마피아 팀원이 니펠과 서로 알아보고 니펠 채팅에 들어가는 것)
 *  뮤트: 니펠을 해킹 · 벨라: 니펠의 직업을 알아냄 · 죠안: 니펠이 습격하려 함 · 우로스: 습격당해 죽은 뒤 되살아남
 */
import {
  BAT_CHOOSE_DAY, CITIZEN_POOL, COMPOSITION, DRONE_MAX, DRONE_MAX_CHANCE, DRONE_PITY, DRONE_TRIES, JESTER_NIGHT,
  MEMBER_POOL, NEUTRAL_POOL, NIGHT_STEP, NO_FIRST_KILL, OPTIONAL_NIGHT, ROLES, UROS_REVIVE_NIGHTS,
  roleName, type NightKind, type RoleId,
} from './roles';
import {
  FARM_H, FARM_W, PLAZA, STEP_SECONDS, plazaPhase, type C2S, type CutKind, type ChatCh, type ChoiceKey, type GameView, type LogCh, type Phase, type S2C, type Winner,
} from './protocol';

/** 토론 시간 늘리기/줄이기 한 번에 몇 초 */
const TIME_STEP = 15;

/** 테스트 모드: 고른 직업을 그 자리에 넣는다. 이미 있으면 맞바꾸고, 없으면 같은 갈래의 직업과 바꿔 인원 구성을 지킨다 */
function placeRole(roles: RoleId[], at: number, want: RoleId, locked: Set<number> = new Set()) {
  if (at < 0) return;
  locked.add(at);
  const free = (i: number) => i === at || !locked.has(i);
  const has = roles.findIndex((r, i) => r === want && free(i));
  if (has >= 0) { [roles[at], roles[has]] = [roles[has], roles[at]]; return; }
  const group = (r: RoleId) => (MEMBER_POOL.includes(r) ? 'm' : CITIZEN_POOL.includes(r) ? 'c' : NEUTRAL_POOL.includes(r) ? 'n' : r);
  // 같은 갈래 → 시민 무작위 → 아무거나(니펠 제외) 순서로 바꿀 자리를 찾는다 (이미 정해 준 사람 자리는 건드리지 않음)
  let swap = roles.findIndex((r, i) => free(i) && group(r) === group(want));
  if (swap < 0) swap = roles.findIndex((r, i) => free(i) && group(r) === 'c');
  if (swap < 0) swap = roles.findIndex((r, i) => free(i) && r !== 'nifel');
  if (swap < 0) return;
  roles[swap] = want;
  [roles[at], roles[swap]] = [roles[swap], roles[at]];
}

/** 테스트·촬영 설정 (방장 + 사람 최대 2명 + 봇일 때만) */
export interface GameTest {
  /** 사람마다 고른 직업 */
  roles?: [number, RoleId][];
  speed?: number;
  /** 사람 니펠의 습격만 유효 + 무엇으로도 못 막음 */
  godKill?: boolean;
  /** 시간이 지나도 능력을 무작위로 쓰지 않을 사람 (능력 끈 봇) */
  quiet?: number[];
}

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
  diedHow?: 'night' | 'vote' | 'avenge' | 'leave' | 'blast';
  contacted: boolean;
  usedOnce: boolean;
  shieldUsed: boolean;
  batSide?: 'mafia' | 'citizen';
  revealed: boolean;
  /** 모두에게 공개된 직업 */
  revealedAs?: RoleId;
  notesLeft: number;
  timeUsed?: boolean;
  /** 우로스: 되살아난 뒤 니펠 */
  urosAwake: boolean;
  /** 우로스: 되살아날 밤 */
  urosReviveNight?: number;
  /** 스피키: 오늘 밤 빌린 직업 */
  copyRole?: RoleId;
  /** 스피키: 공개될 때 보이는 직업 */
  shownRole?: RoleId;
  /** 엘레나 */
  drones: number;
  droneTries: number;
  droneTotal: number;
}

interface Act { kind: NightKind; targets: number[]; optional: boolean; choice: number | null; locked: boolean; done: boolean }
interface Prompt { key: ChoiceKey; options: (number | string)[]; text: string; resolve: (v: number | string | null) => void }

const rand = <T>(a: T[]) => a[Math.floor(Math.random() * a.length)];
function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}
const label = (r: RoleId) => `${roleName(r)}(${ROLES[r].job})`;

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
  private killVotes = new Map<number, number | null>();
  private visits = new Map<number, number>();
  private morning = this.emptyMorning();
  private votes = new Map<number, number | null>();
  private cands: number[] = [];
  private counts: [number, number][] | undefined;
  private proxy: { joan: number; target: number } | null = null;
  private prompts = new Map<number, Prompt>();
  private quietDays = 0;
  private pendingKill: { target: number; executor: number; voters: number[]; god?: boolean } | null = null;
  private overturned = false;
  private stage: number[] = [];
  /** 낮 광장 위치 (%) */
  private plazaPos = new Map<number, [number, number]>();
  /** 주말농장 위치 */
  private farmPos = new Map<number, [number, number]>();

  private emptyMorning() {
    return {
      deaths: [] as number[], blasts: [] as [number, number][], saved: [] as number[], revives: [] as number[], drone: false,
      reveals: [] as { who: number; role: RoleId; why: 'reveal' }[],
      counters: [] as [number, number][],
    };
  }

  /** 테스트 모드 배속 (2 = 두 배 빠르게) */
  private pace = 1;
  private testNote = '';

  /** 촬영·테스트: 이 사람(니펠)의 습격만 유효하고, 어떤 능력으로도 막을 수 없다 */
  private godKillers = new Set<number>();
  /** 촬영·테스트: 시간이 지나도 능력을 무작위로 쓰지 않는 사람 (능력 끈 봇) */
  private noAuto = new Set<number>();

  constructor(private host: GameHost, seats: { pid: number; name: string }[], test?: GameTest) {
    const n = seats.length;
    const [nifel, members, rnd, neutrals] = COMPOSITION[n];
    const forced = (globalThis as { __MAFIA_ROLES?: RoleId[] }).__MAFIA_ROLES; // 테스트용 직업 고정
    const roles = forced?.length === n ? forced : shuffle<RoleId>([
      ...Array<RoleId>(nifel).fill('nifel'),
      ...shuffle(MEMBER_POOL).slice(0, members),
      'doctor', 'police',
      ...shuffle(CITIZEN_POOL).slice(0, rnd),
      ...shuffle(NEUTRAL_POOL).slice(0, neutrals),
    ]);
    if (test) {
      if (test.speed && test.speed >= 1 && test.speed <= 8) this.pace = test.speed;
      const locked = new Set<number>();
      for (const [pid, role] of test.roles ?? []) if (role in ROLES) placeRole(roles, seats.findIndex((s) => s.pid === pid), role, locked);
      for (const pid of test.quiet ?? []) this.noAuto.add(pid);
      const notes = (test.roles ?? []).map(([pid, r]) => `${seats.find((s) => s.pid === pid)?.name ?? '?'}=${roleName(r)}`);
      this.testNote = `🧪 테스트 모드${notes.length ? ` · ${notes.join(', ')}` : ''}${this.pace > 1 ? ` · ${this.pace}배속` : ''}${test.godKill ? ' · 니펠 독점 습격' : ''}`;
    }
    seats.forEach((s, i) => this.ps.set(s.pid, {
      pid: s.pid, name: s.name, role: roles[i], alive: true, online: true,
      contacted: false, usedOnce: false, shieldUsed: false, revealed: false, notesLeft: 1,
      urosAwake: false, drones: 0, droneTries: 0, droneTotal: 0,
    }));
    if (test?.godKill) for (const [pid] of test.roles ?? []) if (this.ps.get(pid)?.role === 'nifel') this.godKillers.add(pid);
  }

  // ── 조회 ─────────────────────────────────────────

  private all() { return [...this.ps.values()]; }
  private alive() { return this.all().filter((p) => p.alive); }
  private name = (pid: number) => this.ps.get(pid)?.name ?? '?';
  isKiller(p: GP) { return p.role === 'nifel' || (p.role === 'uros' && p.urosAwake) || (p.role === 'bat' && p.batSide === 'mafia'); }
  isMafiaTeam(p: GP) { return p.role === 'nifel' || !!ROLES[p.role].member || (p.role === 'bat' && p.batSide === 'mafia'); }
  private isCitizenTeam(p: GP) { return ROLES[p.role].team === 'citizen' || (p.role === 'bat' && p.batSide === 'citizen'); }
  private inNifelChat(p: GP) { return this.isKiller(p) || (!!ROLES[p.role].member && p.contacted); }
  private matesOf(p: GP) { return this.inNifelChat(p) ? this.all().filter((q) => q.pid !== p.pid && this.inNifelChat(q)).map((q) => q.pid) : []; }
  /** 밤의 주말농장: 죽은 사람 + 해킹당하지 않은 이드 (이드로 변장한 스피키 포함) */
  private inFarm(p: GP) {
    if (this.phase !== 'night' || this.over) return false;
    if (!p.alive) return p.diedHow !== 'leave';
    return this.isIde(p) && !this.sealed.has(p.pid);
  }
  /** 이드 (또는 오늘 밤 이드로 변장한 스피키) — 농장에서 이드 모습으로 보인다 */
  private isIde(p: GP) { return p.alive && (p.role === 'medium' || (p.role === 'spiky' && p.copyRole === 'medium')); }
  private farmView(): [number, number, number, number][] {
    const out: [number, number, number, number][] = [];
    for (const q of this.all()) {
      if (!this.inFarm(q)) continue;
      let pos = this.farmPos.get(q.pid);
      if (!pos) { pos = [300 + Math.random() * (FARM_W - 600), 480 + Math.random() * (FARM_H - 600)]; this.farmPos.set(q.pid, pos); }
      out.push([q.pid, Math.round(pos[0]), Math.round(pos[1]), this.isIde(q) ? 1 : 0]);
    }
    return out;
  }
  private plazaView(): [number, number, number][] {
    return this.alive().map((q) => {
      let pos = this.plazaPos.get(q.pid);
      if (!pos) { pos = [PLAZA.x0 + 4 + Math.random() * (PLAZA.x1 - PLAZA.x0 - 8), PLAZA.y0 + 3 + Math.random() * (PLAZA.y1 - PLAZA.y0 - 6)]; this.plazaPos.set(q.pid, pos); }
      return [q.pid, Math.round(pos[0] * 10) / 10, Math.round(pos[1] * 10) / 10];
    });
  }
  private weight(pid: number) { const p = this.ps.get(pid); return p && p.role === 'elena' ? 1 + p.drones : 1; }

  /** 이 차례에 쓸 능력 */
  private kindAt(p: GP, step: 1 | 2 | 3): NightKind | null {
    if (!p.alive) return null;
    if (this.isKiller(p)) return step === 2 ? 'kill' : null;
    if (p.role === 'spiky' && step === 3 && p.copyRole) {
      const k = ROLES[p.copyRole].night;
      return k && k !== 'kill' && k !== 'disguise' ? k : null;
    }
    const def = ROLES[p.role];
    if (!def.night || (def.once && p.usedOnce)) return null;
    return NIGHT_STEP[def.night] === step ? def.night : null;
  }

  private targetsFor(p: GP, kind: NightKind) {
    if (kind === 'revive') return this.all().filter((q) => !q.alive && q.diedHow !== 'leave' && q.pid !== p.pid).map((q) => q.pid);
    const mates = this.matesOf(p);
    const self = kind === 'protect';
    return this.alive()
      .filter((q) => q.pid !== p.pid || self)
      .filter((q) => (kind === 'kill' ? !mates.includes(q.pid) : true))
      .map((q) => q.pid);
  }

  // ── 전송 ─────────────────────────────────────────

  /** 사람마다 받은 기록 (재접속 때 다시 보내 줌). 그때 볼 수 있었던 것만 들어 있다 */
  private history = new Map<number, [LogCh, number, string][]>();
  private log(to: number, ch: LogCh, text: string, from = -1) {
    let hs = this.history.get(to);
    if (!hs) this.history.set(to, (hs = []));
    hs.push([ch, from, text]);
    if (hs.length > 160) hs.splice(0, hs.length - 120);
    this.host.send(to, { t: 'glog', ch, from, text });
  }
  /** 재접속: 놓친 기록과 지금 화면을 바로 보냄 */
  resync(pid: number) {
    const p = this.ps.get(pid);
    if (!p) return;
    p.online = true;
    this.push(pid); // 이름 등 화면 정보가 먼저
    this.host.send(pid, { t: 'gsync', logs: this.history.get(pid) ?? [] });
    this.push();
  }
  private logAll(ch: LogCh, text: string, from = -1) { for (const p of this.all()) this.log(p.pid, ch, text, from); }
  private secret(pid: number, text: string) { this.log(pid, 'secret', text); }
  /** 나만 보는 컷씬 */
  private pcut(pid: number, kind: CutKind, text: string) { this.host.send(pid, { t: 'cut', kind, text }); }
  private killCut = new Set<number>();
  private cutAll(kind: CutKind, text: string, pid?: number, n?: number) { for (const p of this.all()) this.host.send(p.pid, { t: 'cut', kind, pid, text, n }); }

  view(pid: number): GameView {
    const p = this.ps.get(pid)!;
    const act = this.acts.get(pid);
    const prompt = this.prompts.get(pid);
    const killer = this.isKiller(p);
    return {
      phase: this.phase, day: this.day, night: this.night, step: this.step, endsAt: this.endsAt, now: Date.now(), seq: this.seq,
      players: this.all().map((q) => ({ pid: q.pid, name: q.name, alive: q.alive, online: q.online, shown: q.revealedAs })),
      me: {
        pid, role: p.role, alive: p.alive, mates: this.matesOf(p),
        mateRoles: this.matesOf(p).map((m) => [m, this.ps.get(m)!.role] as [number, string]),
        act: act ? { kind: act.kind, targets: act.targets, optional: act.optional, done: act.done, locked: act.locked, choice: act.choice } : null,
        teamVotes: killer && this.step === 2 ? [...this.killVotes] : undefined,
        chats: this.chatsOf(p),
        notesLeft: this.phase === 'day' && p.alive ? p.notesLeft : 0,
        canTime: this.phase === 'day' && p.alive && !p.timeUsed,
        vote: this.votes.has(pid) ? this.votes.get(pid) : undefined,
        canVote: p.alive && ((this.phase === 'vote1') || (this.phase === 'vote2' && !this.cands.includes(pid))),
        prompt: prompt ? { key: prompt.key, options: prompt.options, text: prompt.text } : null,
        drone: p.role === 'elena' ? { count: p.drones, tries: this.phase === 'night' && p.alive ? p.droneTries : 0 } : undefined,
        proxyFor: this.proxy && this.proxy.joan === pid && this.phase === 'defense' ? this.proxy.target : undefined,
        farm: this.inFarm(p) ? this.farmView() : undefined,
        silenced: !!this.proxy && this.proxy.target === pid && this.phase === 'defense',
      },
      cands: this.cands,
      counts: this.counts,
      plaza: plazaPhase(this.phase) ? this.plazaView() : undefined,
      stage: this.phase === 'defense' || this.phase === 'vote2' || this.phase === 'verdict' ? this.stage : undefined,
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
    if (this.phase === 'defense') {
      if (this.proxy?.target === p.pid) return [];
      if (this.proxy?.joan === p.pid) return ['defense'];
      return this.cands.includes(p.pid) ? ['defense'] : [];
    }
    if (this.phase === 'night') {
      const out: ChatCh[] = [];
      if (this.inNifelChat(p)) out.push('nifel');
      if (this.inFarm(p)) out.push('dead');
      return out;
    }
    return [];
  }

  /** 이 채널 메시지를 볼 수 있는 사람 */
  private readers(ch: ChatCh): GP[] {
    switch (ch) {
      case 'day': case 'defense': return this.all();
      case 'nifel': return this.all().filter((q) => this.inNifelChat(q) || !q.alive);
      case 'dead': return this.all().filter((q) => !q.alive || this.inFarm(q));
    }
  }

  // ── 진행 ─────────────────────────────────────────

  /**
   * 단계 타이머: 게임에 단 하나. 새 단계를 시작할 때마다 번호(seq)가 바뀌고,
   * 이전 단계의 늦은 콜백은 번호가 달라 실행되지 않는다. 다른 예약(접속 대기·봇·연출)은 건드리지 않는다.
   */
  private seq = 0;
  private phaseHandle: ReturnType<typeof setTimeout> | undefined;
  private phaseFn: (() => void) | null = null;
  private disposed = false;
  private timer(sec: number, fn: () => void) {
    const k = ((globalThis as { __MAFIA_SPEED?: number }).__MAFIA_SPEED ?? 1) / this.pace; // 테스트용 시간 배속
    this.seq++;
    this.armPhase(sec * 1000 * k, fn);
  }
  /** 지금 단계의 마감만 다시 잡는다 (토론 시간 조정) */
  private armPhase(ms: number, fn: () => void) {
    clearTimeout(this.phaseHandle);
    const s = this.seq;
    this.phaseFn = fn;
    this.endsAt = Date.now() + ms;
    this.phaseHandle = setTimeout(() => {
      if (this.disposed || this.over || s !== this.seq) return;
      this.phaseFn = null;
      fn();
    }, ms);
  }
  /** 단계 타이머 취소 (투표가 일찍 끝남 등) */
  private clearPhase() { clearTimeout(this.phaseHandle); this.phaseFn = null; this.seq++; }
  /**
   * 광장·농장 이동은 받는 즉시 위치만 고쳐 두고, 0.1초마다 모아서 한 번에 보낸다
   * (12명이 걸어도 사람마다 초당 10번만 받음). 판정과 무관한 연출용이라 지연은 문제없다.
   */
  private movedP = new Set<number>();
  private movedF = new Set<number>();
  private moveTimer: ReturnType<typeof setTimeout> | undefined;
  private queueMoves() {
    if (this.moveTimer !== undefined) return;
    this.moveTimer = setTimeout(() => { this.moveTimer = undefined; this.flushMoves(); }, 100);
  }
  private flushMoves() {
    if (this.disposed || this.over) { this.movedP.clear(); this.movedF.clear(); return; }
    if (this.movedP.size && plazaPhase(this.phase)) {
      const m: [number, number, number][] = [];
      for (const pid of this.movedP) { const pos = this.plazaPos.get(pid); if (pos && this.ps.get(pid)?.alive) m.push([pid, pos[0], pos[1]]); }
      for (const q of this.all()) if (q.online) { const mine = m.filter(([pid]) => pid !== q.pid); if (mine.length) this.host.send(q.pid, { t: 'gmoves', s: 'p', m: mine }); }
    }
    if (this.movedF.size) {
      const m: [number, number, number][] = [];
      for (const pid of this.movedF) { const pos = this.farmPos.get(pid); const p = this.ps.get(pid); if (pos && p && this.inFarm(p)) m.push([pid, pos[0], pos[1]]); }
      if (m.length) for (const q of this.all()) if (q.online && this.inFarm(q)) { const mine = m.filter(([pid]) => pid !== q.pid); if (mine.length) this.host.send(q.pid, { t: 'gmoves', s: 'f', m: mine }); }
    }
    this.movedP.clear();
    this.movedF.clear();
  }

  /** 방이 게임을 버릴 때: 남은 예약이 아무것도 하지 않게 */
  dispose() { this.disposed = true; this.clearPhase(); clearTimeout(this.moveTimer); }
  /** 마감이 지났는지 (타이머 콜백이 아직 안 돌았어도 서버 시각 기준으로 판정) */
  private late() { return Date.now() >= this.endsAt; }

  start() {
    this.phase = 'intro';
    if (this.testNote) this.logAll('sys', this.testNote);
    for (const p of this.all()) {
      const mates = this.matesOf(p);
      this.secret(p.pid, `당신은 ${label(p.role)}입니다. ${ROLES[p.role].desc}`);
      if (mates.length) this.secret(p.pid, `함께하는 니펠: ${mates.map(this.name).join(', ')}`);
      if (ROLES[p.role].member) this.secret(p.pid, '마피아 팀원이에요. 니펠은 아직 당신을 몰라요. 능력은 처음부터 쓸 수 있어요.');
    }
    this.timer(8, () => this.startNight());
    this.push();
  }

  /** 마피아 팀원이 니펠과 접선 */
  private contact(p: GP, how: string) {
    if (p.contacted) return;
    p.contacted = true;
    this.pcut(p.pid, 'p_contact', '접선 성공!');
    this.secret(p.pid, `🤝 접선 성공! ${how} 이제 니펠 채팅에 들어간다. 동료: ${this.matesOf(p).map(this.name).join(', ') || '없음'}`);
    for (const q of this.all()) if (q.pid !== p.pid && this.isKiller(q)) this.secret(q.pid, `🤝 ${p.name}가 접선해 왔다. 마피아 팀원(${roleName(p.role)})이다.`);
  }

  private startNight() {
    if (this.over) return;
    this.night++;
    this.phase = 'night';
    this.sealed.clear(); this.killVotes.clear(); this.visits.clear(); this.farmPos.clear(); this.killCut.clear();
    this.morning = this.emptyMorning();
    for (const p of this.all()) { p.copyRole = undefined; if (p.role === 'elena') p.droneTries = DRONE_TRIES; }
    this.logAll('event', `🌙 ${this.night}번째 밤이 찾아왔다. 모두 자기 방으로…`);
    // 우로스 부활
    for (const u of this.all()) {
      if (u.role !== 'uros' || u.alive || u.urosReviveNight !== this.night) continue;
      u.alive = true; u.diedHow = undefined; u.urosAwake = true; u.urosReviveNight = undefined;
      this.unmask(u.pid, 'uros'); // 따로 발표 없이 목록의 정체만 바뀐다
      this.cutAll('uros', '되살아났다', u.pid);
      this.logAll('event', `💫 ${u.name}가 어둠 속에서 되살아났다!`);
      this.secret(u.pid, '되살아났다! 이제 니펠로서 습격에 함께한다.');
      this.contact(u, '니펠의 손에 죽었다가 돌아왔다.');
    }
    for (const p of this.alive()) if (p.role === 'medium') this.pcut(p.pid, 'p_farm', '주말농장으로');
    this.runStep(1);
  }

  private runStep(step: 1 | 2 | 3) {
    this.step = step;
    this.acts.clear();
    for (const p of this.alive()) {
      const kind = this.kindAt(p, step);
      if (!kind) continue;
      const targets = this.targetsFor(p, kind);
      if (!targets.length) continue;
      const locked = this.sealed.has(p.pid);
      const optional = OPTIONAL_NIGHT.includes(kind) || (p.role === 'spiky' && step === 3);
      this.acts.set(p.pid, { kind, targets, optional, choice: null, locked, done: false });
      if (locked) this.secret(p.pid, '방 문이 잠겨 있다… 누군가에게 해킹당했다. 오늘 밤은 능력을 쓸 수 없다.');
    }
    if (step === 2) for (const [pid, a] of this.acts) if (a.kind === 'kill' && !a.locked) this.killVotes.set(pid, null);
    if (step === 3) for (const p of this.alive()) if (p.role === 'spiky' && p.copyRole && this.acts.has(p.pid)) this.secret(p.pid, `🎭 ${roleName(p.copyRole)}의 능력을 쓸 차례다!`);
    this.timer(STEP_SECONDS, () => this.endStep(step));
    this.push();
  }

  private act(p: GP, target: number | null) {
    const a = this.acts.get(p.pid);
    if (!a || a.locked || this.phase !== 'night') return;
    if (target !== null && !a.targets.includes(target)) return;
    if (a.kind === 'kill') {
      if (target !== null && p.role === 'nifel' && !this.killCut.has(p.pid)) { this.killCut.add(p.pid); this.pcut(p.pid, 'p_kill', `${this.name(target)} 습격!`); }
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
    const copying = p.role === 'spiky' && this.step === 3;
    // 내 직업 컷씬 (스피키가 빌려 쓴 능력은 제외)
    const PC: Partial<Record<string, [CutKind, string]>> = {
      seal: ['p_seal', '해킹!'], identify: ['p_identify', '직업 탐지'], protect: ['p_protect', '치유!'],
      investigate: ['p_investigate', '조사!'], track: ['p_track', '추적!'], disguise: ['p_disguise', '변장!'],
    };
    const pc = PC[a.kind];
    if (pc && !copying) this.pcut(p.pid, pc[0], `${t.name} ${pc[1]}`);
    // 즉발형
    switch (a.kind) {
      case 'investigate':
        this.secret(p.pid, `🔍 조사 결과: ${t.name}는 ${this.isKiller(t) ? '니펠이다!' : '니펠이 아니다.'}`);
        break;
      case 'identify': {
        const shown = t.shownRole ?? t.role;
        this.secret(p.pid, `🔎 ${t.name}의 직업은 ${label(shown)}이다.`);
        if (p.role === 'bella' && this.isKiller(t)) this.contact(p, `${t.name}가 니펠이었다.`);
        break;
      }
      case 'seal':
        if (p.role === 'mute' && this.isKiller(t)) { this.contact(p, `${t.name}는 니펠이었다. (니펠은 해킹하지 않는다)`); break; }
        if (copying) {
          // 스피키가 빌린 해킹: 아직 능력을 안 쓴 ③차례 사람을 막는다
          const ta = this.acts.get(t.pid);
          if (ta && !ta.done && ta.kind !== 'kill') { ta.locked = true; this.secret(t.pid, '방 문이 갑자기 잠겼다! 오늘 밤은 더 이상 능력을 쓸 수 없다.'); this.push(t.pid); }
        }
        break;
      case 'disguise': {
        p.usedOnce = true;
        if (this.isKiller(t)) { this.secret(p.pid, `🎭 ${t.name}로 변장하려 했지만… ${t.name}는 마피아다! 니펠의 능력은 쓸 수 없다.`); break; }
        p.copyRole = t.role;
        p.shownRole = this.isMafiaTeam(t) ? undefined : t.role;
        const k = ROLES[t.role].night;
        this.secret(p.pid, `🎭 ${t.name}로 변장했다. ${t.name}의 직업은 ${label(t.role)}!` +
          (t.role === 'medium' ? ' 오늘 밤은 이드처럼 주말농장에 갈 수 있다.'
            : k && k !== 'kill' && k !== 'disguise' ? ' ③차례에 그 능력을 한 번 쓸 수 있다.' : ' 밤에 쓰는 능력은 없는 직업이다.'));
        if (t.role === 'medium') { for (const q of this.all()) if (this.inFarm(q)) this.push(q.pid); }
        break;
      }
    }
    this.push(p.pid);
  }

  private endStep(step: 1 | 2 | 3) {
    if (this.over) return;
    // 시간 안에 못 고른 사람: 필수 능력은 무작위
    for (const [pid, a] of this.acts) {
      if (a.locked || a.kind === 'kill' || this.noAuto.has(pid)) continue;
      if (!a.done && !a.optional) {
        const p = this.ps.get(pid)!;
        this.secret(pid, '시간이 다 되어 대상이 무작위로 정해졌다.');
        this.act(p, rand(a.targets));
      }
    }
    // 방문 기록
    for (const [pid, a] of this.acts) if (!a.locked && a.kind !== 'kill' && a.choice !== null) this.visits.set(pid, a.choice);
    if (step === 1) {
      for (const [pid, a] of this.acts) {
        if (a.locked || a.choice === null || a.kind !== 'seal') continue;
        const t = this.ps.get(a.choice)!;
        if (this.ps.get(pid)!.role === 'mute' && this.isKiller(t)) continue;
        this.sealed.add(a.choice);
        if (t.role === 'medium') this.secret(t.pid, '🔒 방 문이 잠겼다… 오늘 밤은 주말농장에 갈 수 없다.');
      }
      return this.runStep(2);
    }
    if (step === 2) {
      const noKill = this.night === 1 && NO_FIRST_KILL(this.ps.size);
      const tally = new Map<number, number>();
      // 독점 습격자가 있으면 그 사람의 표만 센다
      const god = this.godKillers.size > 0;
      for (const [v, t] of this.killVotes) if (t !== null && (!god || this.godKillers.has(v))) tally.set(t, (tally.get(t) ?? 0) + 1);
      this.pendingKill = null;
      if (tally.size && !noKill) {
        const max = Math.max(...tally.values());
        const target = rand([...tally].filter(([, c]) => c === max).map(([t]) => t));
        const voters = [...this.killVotes].filter(([, t]) => t === target).map(([v]) => v);
        const executor = rand(voters);
        this.visits.set(executor, target);
        const t = this.ps.get(target)!;
        if (god) {
          // 아무것도 통하지 않는 습격 (보호·반격·접선·폭사·부활 무시)
          this.pendingKill = { target, executor, voters, god: true };
          for (const v of this.killVotes.keys()) this.secret(v, `오늘 밤 습격 대상: ${this.name(target)}`);
        } else if (t.role === 'joan' && !t.contacted) {
          for (const v of this.killVotes.keys()) this.secret(v, `${t.name}를 습격하러 갔더니… 같은 편이었다! 습격은 멈췄다.`);
          this.contact(t, '니펠이 당신을 습격하러 왔다가 서로를 알아봤다.');
        } else {
          this.pendingKill = { target, executor, voters };
          for (const v of this.killVotes.keys()) this.secret(v, `오늘 밤 습격 대상: ${this.name(target)}`);
        }
      } else {
        for (const v of this.killVotes.keys()) this.secret(v, noKill ? '첫날 밤이라 습격은 하지 않는다.' : '오늘 밤은 아무도 습격하지 않았다.');
      }
      return this.runStep(3);
    }
    // ③ 끝: 추적·공개·소원 → 밤 정산
    const m = this.morning;
    for (const [pid, a] of this.acts) {
      if (a.locked || a.choice === null) continue;
      const p = this.ps.get(pid)!;
      if (a.kind === 'track') {
        const went = this.visits.get(a.choice);
        this.secret(pid, went === undefined ? `👣 추적: ${this.name(a.choice)}는 어젯밤 방을 나서지 않았다.` : `👣 추적: ${this.name(a.choice)}는 ${this.name(went)}의 방에 갔다.`);
      }
      if (a.kind === 'reveal') {
        if (p.role === 'revealer') p.usedOnce = true;
        const t = this.ps.get(a.choice)!;
        m.reveals.push({ who: t.pid, role: t.shownRole ?? t.role, why: 'reveal' });
        this.secret(pid, `📜 아침에 ${t.name}의 직업이 공개된다.`);
      }
      if (a.kind === 'revive') {
        if (p.role === 'wish') p.usedOnce = true;
        m.revives.push(a.choice);
        this.secret(pid, `🌠 ${this.name(a.choice)}가 돌아오기를 빌었다…`);
      }
    }
    const protectedSet = new Set<number>();
    for (const [, a] of this.acts) if (a.kind === 'protect' && !a.locked && a.choice !== null) protectedSet.add(a.choice);
    const k = this.pendingKill;
    if (k) {
      const t = this.ps.get(k.target)!;
      if (k.god) m.deaths.push(t.pid);
      else if (protectedSet.has(t.pid)) m.saved.push(t.pid);
      else if (t.role === 'trap' && !t.shieldUsed) {
        t.shieldUsed = true;
        m.counters.push([t.pid, k.executor]);
        this.secret(t.pid, '습격당했지만 반격해서 막아냈다! 아침에 습격한 자와 내 정체가 모두에게 드러난다. (이제 다시는 못 막는다)');
      } else {
        m.deaths.push(t.pid);
        if (t.role === 'avenger') {
          const v = k.voters.filter((x) => this.ps.get(x)?.alive);
          if (v.length) m.blasts.push([t.pid, rand(v)]);
        }
        if (t.role === 'uros') t.urosReviveNight = this.night + UROS_REVIVE_NIGHTS;
      }
    }
    // 엘레나: 남은 조립 기회는 자동으로
    for (const p of this.alive()) if (p.role === 'elena') while (p.droneTries > 0 && !this.over) this.tryDrone(p);
    if (this.over) return;
    this.step = 0;
    this.acts.clear();
    this.startMorning();
  }

  private tryDrone(p: GP, manual = false) {
    if (p.droneTries <= 0 || p.drones >= DRONE_MAX) { p.droneTries = 0; return; }
    p.droneTries--;
    p.droneTotal++;
    const ok = p.droneTotal % DRONE_PITY === 0 || Math.random() < Math.random() * DRONE_MAX_CHANCE[Math.min(p.drones, DRONE_MAX_CHANCE.length - 1)];
    if (ok) {
      p.drones++;
      this.morning.drone = true;
      this.secret(p.pid, `🛸 드론 조립 성공! 이제 투표권 ${1 + p.drones}개.`);
      if (manual) this.pcut(p.pid, 'p_drone_ok', `드론 ${p.drones}호기 완성!`);
      if (p.drones >= DRONE_MAX) p.droneTries = 0;
      this.checkWin();
    } else {
      this.secret(p.pid, `🔧 조립 실패… (오늘 밤 남은 기회 ${p.droneTries})`);
      if (manual) this.pcut(p.pid, 'p_drone_fail', `실패… (남은 기회 ${p.droneTries})`);
    }
  }

  /** 모두에게 정체 공개 */
  private unmask(pid: number, as: RoleId) {
    const p = this.ps.get(pid);
    if (!p) return;
    p.revealed = true;
    p.revealedAs = as;
  }

  private kill(pid: number, how: GP['diedHow']) {
    const p = this.ps.get(pid);
    if (!p || !p.alive) return;
    p.alive = false;
    p.diedHow = how;
    this.secret(pid, '당신은 저택에서 사라졌습니다… 이제 죽은 사람끼리 채팅하고, 니펠의 밤 대화를 엿볼 수 있어요. 밤에는 주말농장에서 다른 죽은 사람들(과 이드)을 만나요.');
  }

  private startMorning() {
    if (this.over) return;
    this.day++;
    this.phase = 'morning';
    const m = this.morning;
    this.logAll('event', `☀ ${this.day}일째 아침`);
    const blasted = new Set(m.blasts.map(([mari]) => mari));
    const before = this.alive().length;
    for (const d of m.deaths) {
      this.kill(d, 'night');
      if (!blasted.has(d)) { this.cutAll('vanish', `${this.name(d)}가 사라졌다!`, d, before); this.logAll('event', `💀 어젯밤 ${this.name(d)}가 사라졌다.`); }
    }
    for (const [mari, nifel] of m.blasts) {
      this.kill(nifel, 'blast');
      this.unmask(mari, 'avenger'); // 따로 발표 없이 목록의 정체만 바뀐다
      this.cutAll('blast', '폭사!', mari);
      this.logAll('event', `💥 ${this.name(mari)}가 쓰러지며 폭발했다! 습격한 ${this.name(nifel)}도 함께 사라졌다.`);
    }
    for (const s of m.saved) { this.cutAll('saved', `힐데가 니펠로부터 ${this.name(s)}을(를) 살려내었다!`, s); this.logAll('event', `💚 힐데가 니펠로부터 ${this.name(s)}을(를) 살려내었다!`); }
    for (const [d, ex] of m.counters) {
      const e = this.ps.get(ex)!;
      this.unmask(d, 'trap');
      this.unmask(ex, e.role);
      this.cutAll('counter', '반격!', d);
      this.logAll('event', `🛡 ${this.name(d)}가 습격을 반격해 막아냈다! 습격한 자는 ${e.name}, 정체는 ${label(e.role)}!`);
    }
    if (!m.deaths.length && !m.saved.length && !m.counters.length) this.logAll('event', '조용한 밤이었다.');
    for (const r of m.revives) {
      const p = this.ps.get(r);
      if (!p || p.alive) continue;
      p.alive = true; p.diedHow = undefined; p.urosReviveNight = undefined;
      this.cutAll('wish', '소원이 이루어졌다', p.pid);
      this.logAll('event', `🌠 누군가의 소원이 이루어졌다! ${p.name}가 되살아났다.`);
      this.secret(p.pid, '소원의 힘으로 되살아났다!');
    }
    if (m.drone) { this.cutAll('drone', '위이이잉…'); this.logAll('event', '🛸 밤새 어디선가 드론 소리가 들렸다…'); }
    for (const r of m.reveals) {
      const p = this.ps.get(r.who)!;
      this.unmask(p.pid, r.role);
      this.cutAll('reveal', `${p.name}의 정체`, p.pid);
      this.logAll('event', `📜 저택의 계시: ${p.name}의 직업은 ${label(r.role)}이다.`);
    }
    this.quietDays = m.deaths.length ? 0 : this.quietDays + 1;
    for (const p of this.all()) { p.notesLeft = 1; p.timeUsed = false; }
    if (this.checkWin()) return;
    // 박쥐
    const bat = this.alive().find((p) => p.role === 'bat' && !p.batSide);
    if (bat && this.day >= BAT_CHOOSE_DAY) {
      this.ask(bat.pid, 'bat', ['mafia', 'citizen'], '네르가 분노하며 변신한다! 어느 편에 설까? (안 고르면 무작위)', (v) => {
        const side = v === 'mafia' || v === 'citizen' ? v : rand(['mafia', 'citizen'] as const);
        bat.batSide = side;
        this.pcut(bat.pid, 'p_bat', side === 'mafia' ? '마피아 편으로!' : '시민 편으로!');
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
    this.clearPhase();
    const tally = new Map<number, number>();
    for (const [v, t] of this.votes) if (t !== null) tally.set(t, (tally.get(t) ?? 0) + this.weight(v));
    const sorted = [...tally].sort((a, b) => b[1] - a[1]);
    this.counts = sorted;
    this.logAll('event', `1차 투표 결과 — ${sorted.map(([t, c]) => `${this.name(t)} ${c}표`).join(' · ') || '모두 기권'}`);
    if (!sorted.length) { this.logAll('event', '처형 없이 밤이 된다.'); this.timer(3, () => this.startNight()); this.push(); return; }
    const top = sorted[0][1];
    const firsts = sorted.filter(([, c]) => c === top).map(([t]) => t);
    if (firsts.length >= 2) this.cands = shuffle(firsts).slice(0, 2);
    else {
      const rest = sorted.filter(([t]) => t !== firsts[0]);
      this.cands = rest.length ? [firsts[0], rand(rest.filter(([, c]) => c === rest[0][1]).map(([t]) => t))] : [firsts[0]];
    }
    this.phase = 'defense';
    this.stage = [...this.cands];
    this.proxy = null;
    this.logAll('event', this.cands.length === 2 ? `⚖ 결선 대결: ${this.name(this.cands[0])} vs ${this.name(this.cands[1])} — 45초 동안 변론하세요!` : `⚖ ${this.name(this.cands[0])}의 최후 변론 (45초)`);
    // 죠안의 선동
    const joan = this.alive().find((p) => p.role === 'joan' && !p.usedOnce);
    if (joan) {
      const opts = this.cands.filter((c) => c !== joan.pid);
      if (opts.length) this.ask(joan.pid, 'agitate', opts, '선동 (한 번): 고른 후보가 시민 팀이면 변론 시간 내내 그 사람 대신 채팅한다. 니펠이면 실패하지만 접선한다. 쓰지 않으려면 그냥 두세요.', (v) => {
        if (typeof v !== 'number' || !opts.includes(v) || this.phase !== 'defense') return;
        joan.usedOnce = true;
        const t = this.ps.get(v)!;
        if (!this.isCitizenTeam(t)) {
          this.secret(joan.pid, `🗣 선동이 통하지 않았다. ${t.name}는 시민 팀이 아니다.`);
          // 니펠의 입을 빌리려다 서로를 알아봄 → 접선
          if (this.isKiller(t) && !joan.contacted) this.contact(joan, `${t.name}의 입을 빌리려다 니펠인 걸 알아봤다.`);
          return;
        }
        this.proxy = { joan: joan.pid, target: v };
        this.pcut(joan.pid, 'p_agitate', `${t.name} 선동!`);
        this.secret(joan.pid, `🗣 이제 ${t.name} 대신 말한다. 채팅은 ${t.name}의 이름으로 나간다.`);
        this.secret(v, '🤐 입이 막혔다… 누군가 당신의 목소리를 훔쳤다! 변론 시간 동안 말할 수 없다.');
        this.push();
      });
    }
    this.timer(45, () => this.startVote2());
    this.push();
  }

  private startVote2() {
    if (this.over) return;
    this.resolvePrompts();
    this.proxy = null;
    this.phase = 'vote2';
    this.votes.clear();
    this.counts = undefined;
    this.logAll('event', this.cands.length === 2 ? '🗳 결선 투표! 둘 중 한 명을 고르세요. 동표면 처형 없이 밤.' : '🗳 처형 찬반 투표!');
    this.timer(15, () => this.endVote2());
    this.push();
  }

  private endVote2() {
    if (this.over || this.phase !== 'vote2') return;
    this.clearPhase();
    this.resolvePrompts();
    const [a, b] = this.cands;
    const sum = (f: (t: number | null) => boolean) => [...this.votes].filter(([, t]) => f(t)).reduce((n, [v]) => n + this.weight(v), 0);
    const ca = sum((t) => t === a);
    const cb = b === undefined ? sum((t) => t === null) : sum((t) => t === b);
    this.counts = b === undefined ? [[a, ca]] : [[a, ca], [b, cb]];
    this.logAll('event', b === undefined ? `결과 — 찬성 ${ca} · 반대 ${cb}` : `결선 결과 — ${this.name(a)} ${ca}표 · ${this.name(b)} ${cb}표`);
    let executed: number | null = null;
    if (ca > cb) executed = a;
    else if (b !== undefined && cb > ca) executed = b;
    this.phase = 'verdict';
    this.stage = executed === null ? [] : [executed];
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
        this.cutAll('overturn', `판결이 뒤집혔다!`, ex);
        this.stage = [];
        this.timer(4, () => this.startNight());
        this.push();
        return;
      }
      this.execute(ex);
    });
    this.push();
  }

  private execute(pid: number) {
    const p = this.ps.get(pid)!;
    this.cutAll('execute', `${p.name} 처형`, pid);
    this.logAll('event', `⚖ ${p.name}가 처형되었다.`);
    this.kill(pid, 'vote');
    if (p.role === 'jester' && this.night >= JESTER_NIGHT) {
      this.logAll('event', `${p.name}가 웃음을 터뜨렸다. "속았지~!" — 코미였다!`);
      return void this.finish('jester');
    }
    if (p.role === 'avenger') {
      const opts = this.alive().map((q) => q.pid);
      this.ask(pid, 'avenge', opts, '💥 마리: 길동무로 함께 폭사할 사람을 고르세요! (10초)', (v) => {
        if (typeof v === 'number' && opts.includes(v) && this.ps.get(v)!.alive) {
          // 길동무: 폭사 컷씬 + 마리 정체 공개 (따로 발표 없이 목록이 바뀜)
          this.unmask(pid, 'avenger');
          this.cutAll('blast', `${p.name}가 ${this.name(v)}를 끌고 폭사했다!`, pid);
          this.logAll('event', `💥 ${p.name}가 마지막 힘으로 ${this.name(v)}를 끌고 함께 폭사했다!`);
          this.kill(v, 'avenge');
          this.push();
        }
      });
      this.timer(10, () => { this.resolvePrompts(); if (!this.checkWin()) this.startNight(); });
      this.push();
      return;
    }
    if (this.checkWin()) return;
    this.timer(4, () => this.startNight());
    this.push();
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
    const elena = alive.find((p) => p.role === 'elena');
    if (elena && 1 + elena.drones > alive.length - 1) {
      this.logAll('event', `🛸 하늘을 뒤덮은 드론! ${elena.name}(엘레나)가 저택을 손에 넣었다.`);
      return this.finish('elena');
    }
    const killers = alive.filter((p) => this.isKiller(p));
    if (!killers.length) {
      const waiting = this.all().some((p) => p.role === 'uros' && !p.alive && p.urosReviveNight !== undefined);
      if (waiting) return false;
      return this.finish('citizen');
    }
    const mafia = alive.filter((p) => this.isMafiaTeam(p)).length;
    if (mafia >= alive.length - mafia) return this.finish('mafia');
    if (this.quietDays >= 6) return this.finish('draw');
    return false;
  }

  private finish(w: Winner): true {
    if (this.over) return true;
    this.over = true;
    this.clearPhase();
    this.phase = 'end';
    const winners: number[] = [];
    for (const p of this.all()) {
      const team = this.isMafiaTeam(p) ? 'mafia' : p.role === 'bat' ? p.batSide ?? 'none' : ROLES[p.role].team;
      if (w === 'jester' ? p.role === 'jester' : w === 'elena' ? p.role === 'elena' : team === w) winners.push(p.pid);
    }
    const title = { mafia: '마피아 팀 승리!', citizen: '시민 팀 승리!', jester: '코미 승리!', elena: '엘레나 승리!', draw: '무승부' }[w];
    this.logAll('event', `🏆 ${title}`);
    const roles = this.all().map((p) => ({ pid: p.pid, role: p.role, alive: p.alive }));
    for (const p of this.all()) this.host.send(p.pid, { t: 'gend', winner: w, roles, winners });
    this.push();
    this.host.later(15_000, () => this.host.onEnd());
    return true;
  }

  // ── 메시지 ───────────────────────────────────────

  handle(pid: number, msg: C2S) {
    const p = this.ps.get(pid);
    if (!p || this.over || this.disposed) return;
    // 중요한 명령: 서버 마감이 지났거나, 클라이언트가 본 단계(seq)가 지금과 다르면 받지 않는다
    if (msg.t === 'act' || msg.t === 'vote' || msg.t === 'choice' || msg.t === 'time' || msg.t === 'drone') {
      if (this.late()) return;
      const s = (msg as { seq?: number }).seq;
      if ((msg.t === 'act' || msg.t === 'vote') && s !== undefined && s !== this.seq) return;
    }
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
        const from = msg.ch === 'defense' && this.proxy?.joan === pid ? this.proxy.target : pid;
        for (const q of this.readers(msg.ch)) this.log(q.pid, msg.ch, text, from);
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
      case 'drone':
        if (this.phase === 'night' && p.alive && p.role === 'elena' && p.droneTries > 0) { this.tryDrone(p, true); this.push(pid); }
        break;
      case 'time': {
        // 토론 시간 늘리기/줄이기: 한 사람이 하루 한 번, 15초씩
        if (this.phase !== 'day' || !p.alive || p.timeUsed) return;
        const d = msg.d === 1 ? 1 : -1;
        // 배속과 상관없이 실제 15초 (버튼에 적힌 그대로)
        const k = (globalThis as { __MAFIA_SPEED?: number }).__MAFIA_SPEED ?? 1;
        const left = this.endsAt - Date.now();
        const next = d > 0 ? left + TIME_STEP * 1000 * k : Math.max(3000 * k, left - TIME_STEP * 1000 * k);
        p.timeUsed = true;
        this.armPhase(next, this.phaseFn ?? (() => this.startVote1()));
        this.logAll('sys', d > 0 ? `⏫ ${p.name}님이 토론 시간을 ${TIME_STEP}초 늘렸다.` : `⏬ ${p.name}님이 토론 시간을 ${TIME_STEP}초 줄였다.`);
        this.push();
        break;
      }
      case 'pmove': {
        if (!plazaPhase(this.phase) || !p.alive) return;
        const x = Number(msg.x), y = Number(msg.y);
        if (!Number.isFinite(x) || !Number.isFinite(y)) return;
        const pos: [number, number] = [Math.max(PLAZA.x0, Math.min(PLAZA.x1, x)), Math.max(PLAZA.y0, Math.min(PLAZA.y1, y))];
        this.plazaPos.set(pid, pos);
        this.movedP.add(pid);
        this.queueMoves();
        break;
      }
      case 'fmove': {
        if (!this.inFarm(p)) return;
        const x = Math.max(40, Math.min(FARM_W - 40, Number(msg.x))), y = Math.max(440, Math.min(FARM_H - 40, Number(msg.y)));
        if (!Number.isFinite(x) || !Number.isFinite(y)) return;
        this.farmPos.set(pid, [x, y]);
        this.movedF.add(pid);
        this.queueMoves();
        break;
      }
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
    this.push();
  }

  /** 30초 넘게 끊긴 사람 */
  drop(pid: number) {
    const p = this.ps.get(pid);
    if (!p || !p.alive || this.over) return;
    this.logAll('event', `🔌 ${p.name}의 연결이 끊겨 저택에서 사라졌다.`);
    this.kill(pid, 'leave');
    p.urosReviveNight = undefined;
    this.checkWin();
    this.push();
  }
}
