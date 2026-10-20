/**
 * 테스트용 봇 플레이어. 방 서버 안에서 사람처럼 메시지를 받고 보낸다 (판정은 똑같이 서버가 함).
 * 똑똑하진 않지만 게임이 끝까지 굴러가게: 능력 쓰기 · 투표 · 선택지 · 드론 · 광장 산책 · 가끔 채팅.
 * 마피아 팀 봇은 동료를 찍지 않는다.
 */
import { PLAZA, plazaPhase, type C2S, type GameView, type S2C } from './protocol';

const pick = <T>(a: T[]) => a[Math.floor(Math.random() * a.length)];
const rnd = (a: number, b: number) => a + Math.random() * (b - a);

const LINES = ['음…', '난 시민이야', '누가 수상해?', '어젯밤 조용했네', '흠 모르겠다', '증거 있어?', 'ㅋㅋ', '일단 지켜볼게', '나 아님', '다들 직업 말해봐'];
const SUS = ['{n} 좀 수상한데', '{n} 아까부터 조용하네', '{n} 찍자', '{n}는 믿어도 될 듯'];
const DEFENSE = ['진짜 아니야!', '나 시민이라고', '나 찍으면 후회한다', '…할 말 없음'];

export class BotBrain {
  /** 촬영·테스트용: 투표 / 능력·선택 / 채팅을 할지 */
  opts = { vote: true, act: true, chat: true };
  private v: GameView | null = null;
  private timers = new Set<ReturnType<typeof setTimeout>>();
  private walk: ReturnType<typeof setInterval> | null = null;
  private pos: [number, number] = [50, 60];
  private goal: [number, number] = [50, 60];
  private saidAt = 0;
  /** 이번 차례(phase·step)에 이미 한 일 */
  private doneKey = '';
  private planned = new Set<string>();
  private dead = false;

  constructor(private send: (m: C2S) => void) {}

  destroy() {
    this.dead = true;
    for (const t of this.timers) clearTimeout(t);
    this.timers.clear();
    if (this.walk) clearInterval(this.walk);
    this.walk = null;
    if (this.farmWalk) clearInterval(this.farmWalk);
    this.farmWalk = null;
  }

  /** 한 판이 끝남: 하던 일만 멈추고 다음 판을 기다린다 */
  private reset() {
    for (const t of this.timers) clearTimeout(t);
    this.timers.clear();
    if (this.walk) clearInterval(this.walk);
    this.walk = null;
    if (this.farmWalk) clearInterval(this.farmWalk);
    this.farmWalk = null;
    this.v = null;
    this.doneKey = '';
    this.planned.clear();
  }

  /** a~b ms 뒤, 단 남은 시간 안에 (남은 시간의 15~60%) */
  private within(v: GameView, a: number, b: number) {
    const left = v.endsAt - v.now;
    return Math.max(50, Math.min(rnd(a, b), left * rnd(0.15, 0.6)));
  }

  private after(ms: number, fn: () => void) {
    const t = setTimeout(() => { this.timers.delete(t); if (!this.dead) { try { fn(); } catch { /* 봇 실수는 무시 */ } } }, ms);
    this.timers.add(t);
  }

  onMsg(m: S2C) {
    if (this.dead) return;
    if (m.t === 'g') this.onView(m.v);
    else if (m.t === 'gend') this.reset();
  }

  private onView(v: GameView) {
    const prev = this.v;
    this.v = v;
    const me = v.me;
    const key = `${v.phase}:${v.day}:${v.night}:${v.step}`;
    if (key !== this.doneKey) { this.doneKey = key; this.planned.clear(); }
    if (prev?.phase !== v.phase) this.onPhase(v);

    // 밤 능력
    if (this.opts.act && me.act && !me.act.done && !me.act.locked && !this.planned.has('act')) {
      this.planned.add('act');
      this.after(this.within(v, 1200, 6000), () => {
        const a = this.v?.me.act;
        if (!a || a.done || a.locked) return;
        if (a.optional && Math.random() < 0.15) { this.send({ t: 'act', target: null, seq: this.v?.seq }); return; }
        let ts = a.targets.filter((t) => !this.v!.me.mates.includes(t) || a.kind === 'protect');
        if (a.kind !== 'protect') ts = ts.filter((t) => t !== this.v!.me.pid);
        if (!ts.length) ts = a.targets;
        // 니펠끼리는 동료 표를 따라가 본다
        const team = this.v?.me.teamVotes?.find(([p, t]) => p !== this.v!.me.pid && t !== null);
        const target = team && Math.random() < 0.7 ? team[1] : pick(ts);
        this.send({ t: 'act', target, seq: this.v?.seq });
      });
    }
    // 선택지 (박쥐 편 고르기 · 리온 · 마리 · 죠안 등)
    if (this.opts.act && me.prompt && !this.planned.has('prompt:' + me.prompt.key)) {
      this.planned.add('prompt:' + me.prompt.key);
      this.after(this.within(v, 1500, 4000), () => {
        const p = this.v?.me.prompt;
        if (!p) return;
        const opts = p.options.filter((o) => typeof o !== 'number' || !this.v!.me.mates.includes(o));
        this.send({ t: 'choice', key: p.key, value: (p.key === 'avenge' || Math.random() < 0.75) && opts.length ? pick(opts) : null });
      });
    }
    // 투표
    if (this.opts.vote && me.canVote && me.vote === undefined && !this.planned.has('vote')) {
      this.planned.add('vote');
      this.after(this.within(v, 1500, 9000), () => {
        const w = this.v;
        if (!w || !w.me.canVote || w.me.vote !== undefined) return;
        let opts = w.phase === 'vote1' ? w.players.filter((p) => p.alive && p.pid !== w.me.pid).map((p) => p.pid) : [...w.cands];
        const safe = opts.filter((o) => !w.me.mates.includes(o) && o !== w.me.pid);
        if (safe.length) opts = safe;
        this.send({ t: 'vote', target: Math.random() < 0.9 && opts.length ? pick(opts) : null, seq: this.v?.seq });
      });
    }
    // 엘레나: 밤마다 드론 조립
    if (this.opts.act && me.drone && me.drone.tries > 0 && me.drone.count < 3 && v.phase === 'night' && !this.planned.has('drone' + me.drone.tries)) {
      this.planned.add('drone' + me.drone.tries);
      this.after(this.within(v, 800, 2500), () => this.send({ t: 'drone' }));
    }
    // 주말농장에선 조금 돌아다님
    // 주말농장: 사람처럼 한 걸음씩 걸어 다님 (순간이동 X)
    if (me.farm && !this.farmWalk) {
      const mine = me.farm.find(([p]) => p === me.pid);
      if (mine) { this.fpos = [mine[1], mine[2]]; this.fgoal = [...this.fpos]; }
      this.farmWalk = setInterval(() => this.farmStep(), 200);
    } else if (!me.farm && this.farmWalk) { clearInterval(this.farmWalk); this.farmWalk = null; }
  }

  private onPhase(v: GameView) {
    const me = v.me;
    // 광장 산책
    const walking = plazaPhase(v.phase) && !!v.plaza && me.alive;
    if (walking && !this.walk) {
      const mine = v.plaza?.find(([p]) => p === me.pid);
      if (mine) this.pos = [mine[1], mine[2]];
      this.goal = [...this.pos];
      this.walk = setInterval(() => this.step(), 220);
    } else if (!walking && this.walk) { clearInterval(this.walk); this.walk = null; }
    // 말하기
    if (!me.alive) return;
    const chat = (text: string, ch = me.chats[0]) => { if (ch) this.send({ t: 'gchat', text, ch }); };
    if (this.opts.chat && v.phase === 'day' && me.chats.includes('day')) {
      const n = 1 + Math.floor(Math.random() * 2);
      for (let i = 0; i < n; i++) this.after(rnd(2000, 30000), () => {
        if (this.v?.phase !== 'day' || Date.now() - this.saidAt < 6000) return;
        this.saidAt = Date.now();
        const others = this.v.players.filter((p) => p.alive && p.pid !== me.pid);
        const line = Math.random() < 0.4 && others.length ? pick(SUS).replace('{n}', pick(others).name) : pick(LINES);
        chat(line, 'day');
      });
    }
    // 가끔 토론 시간 조절 (주로 단축)
    if (this.opts.vote && v.phase === 'day' && me.canTime && Math.random() < 0.15) this.after(this.within(v, 5000, 40000), () => { if (this.v?.phase === 'day' && this.v.me.canTime) this.send({ t: 'time', d: Math.random() < 0.7 ? -1 : 1 }); });
    if (this.opts.chat && v.phase === 'defense' && me.chats.includes('defense')) this.after(rnd(1500, 8000), () => { if (this.v?.phase === 'defense') chat(pick(DEFENSE), 'defense'); });
  }

  private farmWalk: ReturnType<typeof setInterval> | null = null;
  private fpos: [number, number] = [800, 650];
  private fgoal: [number, number] = [800, 650];
  /** 농장 한 걸음 (사람 속도 약 360px/s 보다 조금 느리게) */
  private farmStep() {
    if (!this.v?.me.farm) return;
    const [x, y] = this.fpos, [gx, gy] = this.fgoal;
    const d = Math.hypot(gx - x, gy - y);
    if (d < 8) {
      if (Math.random() < 0.15) this.fgoal = [rnd(200, 1400), rnd(480, 820)];
      return;
    }
    const s = Math.min(d, 55);
    this.fpos = [x + ((gx - x) / d) * s, y + ((gy - y) / d) * s];
    this.send({ t: 'fmove', x: Math.round(this.fpos[0]), y: Math.round(this.fpos[1]) });
  }

  private step() {
    const v = this.v;
    if (!v || !plazaPhase(v.phase) || !v.me.alive) return;
    const [x, y] = this.pos, [gx, gy] = this.goal;
    const d = Math.hypot(gx - x, gy - y);
    if (d < 0.8) {
      // 잠깐 서 있다가 새 목적지
      if (Math.random() < 0.25) this.goal = [rnd(PLAZA.x0 + 2, PLAZA.x1 - 2), rnd(PLAZA.y0 + 1, PLAZA.y1 - 1)];
      return;
    }
    const s = Math.min(d, 2.2);
    this.pos = [x + ((gx - x) / d) * s, y + ((gy - y) / d) * s * 0.7];
    this.send({ t: 'pmove', x: Math.round(this.pos[0] * 10) / 10, y: Math.round(this.pos[1] * 10) / 10 });
  }
}
