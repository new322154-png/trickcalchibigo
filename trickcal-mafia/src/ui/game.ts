/**
 * 마피아 본게임 화면 (대기실 위에 덮어서 띄운다).
 *  낮: 채팅 · 투표 · 익명 쪽지 · 메모
 *  밤: 내 방(혼자 미니게임) → 내 차례에 문을 열고 복도로 → 대상의 방 문 앞에서 능력 사용
 */
import { ROLES, roleName, type RoleId } from '../../shared/roles';
import { CHARACTERS, FARM_H, FARM_W, type ChatCh, type GameView, type LogCh, type S2C } from '../../shared/protocol';
import { playCatch } from '../mini/catch';
import { playMatch } from '../mini/match';
import type { RoomLink } from '../net';
import { asset, bgUrl, clear, h, isPhone } from './dom';
import { follow } from './follow';
import { MoveInput, isTouch } from './input';
import { Scene } from './scene';
import { canDrop, droneRaid, pickBat, playCut, playNews, preloadCuts, type BatPick } from './cut';
import { bgm, type BgmName } from './bgm';
import { sfx } from './sfx';
import { emoteBar, type EmoteBar } from './emote';
import { openReport, setReportCtx } from './report';
import { shareCard, type CardInfo, type CardPlayer } from './share';
import { emojiFile } from './emoji';
import { EMOTES } from '../../shared/protocol';

/** 밤 복도 (배경 2172×724 → 높이 900 기준) */
const CW = 2700, CH = 900, WALL = 374, FLOOR0 = 398, FLOOR1 = 676;
/** 배경 속 기둥 위치 (문은 기둥 사이 칸에 들어간다) */
const PILLARS = [99, 621, 1144, 1678, 2195, 2672];
const STEP_NAMES = ['', '① 뮤트, 스피키', '② 니펠', '③ 그 밖의 능력'];
const ACT_LABEL: Record<string, string> = {
  kill: '습격', seal: '해킹', disguise: '변장', protect: '치유하기', investigate: '조사', track: '지켜보기', reveal: '직업 공개', identify: '직업 알아내기', revive: '소원 빌기',
};
const CH_LABEL: Record<ChatCh, string> = { day: '전체', nifel: '니펠', dead: '죽은 사람', defense: '변론' };
const MEMO = ['', '의심', '마피아?', '시민?', '확정 시민', '확정 마피아'];

/** 직업 캐릭터 (assets/chars/<id>.webp) */
function roleChar(role: string) {
  const name = ROLES[role as RoleId]?.char;
  return CHARACTERS.find((x) => x.name === name)?.id ?? null;
}
/** 게임 중 다른 사람(과 나)의 모습: 정체를 숨기는 공용 그림 */
const ANON = './assets/ui/anon.webp';
/** 게임 끝 화면: [제목, 영어, 배경] */
const END_T: Record<string, [string, string, string]> = {
  mafia: ['마피아 팀 승리', 'MAFIA WINS', 'hall_night.webp'],
  citizen: ['시민 팀 승리', 'CITIZENS WIN', 'hall_day.webp'],
  jester: ['코미 승리', 'JESTER WINS', 'end_comi.webp'],
  elena: ['엘레나 승리', 'DRONE QUEEN', 'end_elena.webp'],
  draw: ['무승부', 'DRAW', 'hall_day.webp'],
};
/** 다른 사람 모습: 가면 쓴 케이크 4종 (자리 번호로 고정, 정체와는 무관) */
const maskImg = (pid: number) => `./assets/ui/mask${(pid % 4) + 1}.webp`;
function roleImg(role: string): string | null {
  const c = roleChar(role);
  return c ? `./assets/chars/${c}.webp` : null;
}

export class GameUI {
  el: HTMLElement;
  v: GameView | null = null;
  private skew = 0;
  private top = h('div.g-top');
  private plist = h('div.g-plist');
  private log = h('div.g-log');
  private panel = h('div.g-panel');
  private chatRow = h('div.g-chatrow');
  private chatIn = h('input.chat-in', { placeholder: '채팅', maxLength: 120 }) as HTMLInputElement;
  private chatCh: ChatCh = 'day';
  private timerEl = h('div.g-timer');
  private nightEl = h('div.g-night.hidden');
  private memo = new Map<number, number>();
  private tick = 0;
  private corridor: Corridor | null = null;
  private farm: Farm | null = null;
  private scene: Scene;
  private lastKey = '';
  /** 네르 편 고르기 장면 (직접 조작) */
  private batPick: BatPick | null = null;
  private batAsked = false;
  private phaseTotal = 1;
  /** 대화창 크기: − 입력창만 · 보통 · + 크게 (PC·휴대폰 모두, 기기에 기억) */
  private dlg: 'min' | 'mid' | 'max' = (() => { try { const v = localStorage.getItem('tm.chat.game'); return v === 'min' || v === 'max' ? v : 'mid'; } catch { return 'mid'; } })();
  private dlgSize = h('div.dlg-size',
    h('button', { title: '대화창 줄이기', onclick: () => this.setDlg(-1) }, '−'),
    h('button', { title: '대화창 키우기', onclick: () => this.setDlg(1) }, '+'));
  private setDlg(d: -1 | 1) {
    const S = ['min', 'mid', 'max'] as const;
    this.dlg = S[Math.max(0, Math.min(2, S.indexOf(this.dlg) + d))];
    try { localStorage.setItem('tm.chat.game', this.dlg); } catch { /* 무시 */ }
    this.el.dataset.dlg = this.dlg;
    this.log.scrollTop = this.log.scrollHeight;
  }
  /** 오른쪽 안내판 접기 (단계가 바뀌거나 할 일이 생기면 다시 펼침) */
  private panelTab = h('button.panel-tab', { title: '안내판 접기 / 펴기', onclick: () => this.el.classList.toggle('panel-min') }, h('small.en', 'INFO'), h('i', '▸'));
  /** 구경하다가 농장으로 돌아가는 버튼 */
  private backFarm = h('button.btn.gold.small.back-farm.hidden', { onclick: () => { this.spectate = false; this.lastKey = ''; if (this.v) this.update(this.v); } }, '🌾 주말농장으로');
  private emotes: EmoteBar;
  private emoToggle!: HTMLElement;
  /** 게임 끝 화면 (최고의 플레이어 투표 결과를 채워 넣는다) */
  private endEl: HTMLElement | null = null;
  private endInfo: { winner: string; roles: { pid: number; role: string; alive: boolean }[]; winners: number[]; day: number; mvp: number[] } | null = null;

  constructor(private root: HTMLElement, public link: RoomLink, private myPid: number) {
    this.chatIn.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); this.sendChat(); } });
    this.scene = new Scene(myPid, () => roleImg(this.v?.me.role ?? '') ?? ANON, (pid) => this.face(pid), this.name, (x, y) => this.link.send({ t: 'pmove', x, y }));
    this.el = h('div.game-screen',
      this.scene.el,
      this.top,
      h('div.g-cols',
        this.plist,
        h('div.g-center', h('div.g-dialog', h('div.g-dialog-head', h('small.en', 'LOG'), h('b', '대화')), this.dlgSize, this.log, this.chatRow)),
        h('div.g-right', this.panelTab, this.panel)),
      this.nightEl);
    if (isTouch()) this.el.appendChild(this.scene.joy);
    // 휴대폰에서만 보이는 버튼: 플레이어 목록 열고 닫기
    const tog = h('button.plist-toggle', { onclick: () => { this.el.classList.toggle('plist-open'); } }, '👥');
    this.el.appendChild(tog);
    this.el.appendChild(this.backFarm);
    this.el.style.setProperty('--anon', `url("${new URL(ANON, location.href).href}")`);
    this.emotes = emoteBar((e) => this.link.send({ t: 'emote', e }));
    this.emotes.el.classList.add('g-emotes');
    this.emotes.enable(false);
    // PC: 대화 기록 머리줄 오른쪽에 (채팅 입력을 가리지 않게) / 휴대폰: 😀 버튼을 누르면 펼쳐짐 (CSS)
    (isPhone() ? this.el : this.el.querySelector('.g-dialog-head')!).appendChild(this.emotes.el);
    this.emoToggle = h('button.emote-toggle.hidden', { title: '감정표현', onclick: () => this.el.classList.toggle('emo-open') }, '😀');
    this.el.appendChild(this.emoToggle);
    this.emotes.el.addEventListener('click', (e) => { if ((e.target as HTMLElement).closest('.eb-btn')) this.el.classList.remove('emo-open'); });
    this.el.dataset.dlg = this.dlg;
    root.appendChild(this.el);
    setReportCtx('game', () => {
      const v = this.v;
      return v ? { phase: v.phase, day: v.day, night: v.night, step: v.step, left: this.left(), role: v.me.role, alive: v.me.alive, pid: this.myPid,
        players: v.players.length, aliveN: v.players.filter((p) => p.alive).length, act: v.me.act?.kind ?? null, prompt: v.me.prompt?.key ?? null,
        corridor: !!this.corridor, farm: !!this.farm, log: [...this.log.children].slice(-30).map((e) => e.textContent) } : null;
    });
    this.tick = window.setInterval(() => this.renderTimer(), 250);
  }

  destroy() {
    this.batPick?.close(); this.batPick = null;
    setReportCtx('game', null);
    this.emotes.destroy();
    clearInterval(this.tick);
    this.corridor?.destroy();
    this.farm?.destroy();
    this.scene.destroy();
    this.el.remove();
  }

  /** 투표·능력: 내가 보고 있는 단계 번호를 같이 보내 서버가 지난 단계의 늦은 명령을 거르게 */
  private cmd(m: { t: 'act' | 'vote'; target: number | null }) { this.link.send({ ...m, seq: this.v?.seq }); }

  name = (pid: number) => (pid < 0 ? '저택' : this.v?.players.find((p) => p.pid === pid)?.name ?? '?');
  private left() { return this.v ? Math.max(0, Math.ceil((this.v.endsAt - (Date.now() + this.skew)) / 1000)) : 0; }

  // ── 서버 메시지 ──────────────────────────────────

  onMsg(m: S2C) {
    if (m.t === 'g') this.update(m.v);
    else if (m.t === 'glog') this.addLog(m.ch, m.from, m.text);
    else if (m.t === 'gsync') {
      // 재접속: 기록을 서버 것으로 다시 채움 (소리 없이)
      this.log.replaceChildren();
      this.quiet = true;
      for (const [ch, from, text] of m.logs) this.addLog(ch, from, text);
      this.quiet = false;
    }
    else if (m.t === 'gcmove') this.corridor?.mate(m.pid, m.x, m.y);
    else if (m.t === 'fmove') this.farm?.move(m.pid, m.x, m.y);
    else if (m.t === 'pmove') this.scene.move(m.pid, m.x, m.y);
    else if (m.t === 'gmoves') { for (const [pid, x, y] of m.m) { if (m.s === 'p') this.scene.move(pid, x, y); else this.farm?.move(pid, x, y); } }
    else if (m.t === 'gend') this.showEnd(m.winner, m.roles, m.winners, m.mvpAt, m.day ?? this.v?.day ?? 0);
    else if (m.t === 'emote') { if ((EMOTES as readonly string[]).includes(m.e)) this.scene.emote(m.id, m.e); }
    else if (m.t === 'mvp') this.onMvp(m.voted, m.of, m.pids);
    else if (m.t === 'cut') {
      const mine = m.kind.startsWith('p_');
      if (m.kind === 'vanish') { this.sadMorning = true; if (this.v?.phase === 'morning') bgm('rain'); }
      if (m.kind === 'execute') bgm('after_trial');
      if (m.kind === 'p_bat' && this.batPick) { this.batPick.resolve(/마피아/.test(m.text) ? 'mafia' : 'citizen'); this.batPick = null; return; }
      const fb = mine ? roleImg(this.v?.me.role ?? '') ?? ANON : m.pid !== undefined ? this.face(m.pid) : ANON;
      playCut(this.el, m.kind, m.text, fb, { n: m.n, day: this.newsDay });
    }
  }

  /** 다른 사람 얼굴: 정체가 드러났으면 그 직업 캐릭터, 아니면 가면 케이크. 나는 늘 내 캐릭터 */
  private face(pid: number) {
    if (pid === this.myPid) return roleImg(this.v?.me.role ?? '') ?? ANON;
    const shown = this.v?.players.find((p) => p.pid === pid)?.shown
      ?? this.v?.me.mateRoles?.find(([m]) => m === pid)?.[1];
    return (shown && roleImg(shown)) || maskImg(pid);
  }

  private update(v: GameView) {
    const first = !this.v;
    const prevPhase = this.v?.phase, prevStep = this.v?.step;
    this.skew = v.now - Date.now();
    this.v = v;
    if (first) { this.showRoleCard(); preloadCuts(v.me.role); }
    if (prevPhase !== v.phase) { this.music(v.phase); this.el.classList.remove('panel-min'); }
    if (v.phase === 'night') this.spectate = false; // 밤이 되면 구경 끝, 농장으로
    if (prevPhase !== v.phase || prevStep !== v.step) {
      if (v.phase === 'night' && prevPhase !== 'night') sfx('night');
      if (v.phase === 'morning') sfx('morning');
      if (v.phase === 'vote1' || v.phase === 'vote2') sfx('gavel');
    }
    this.scene.update(v);
    this.el.classList.toggle('walking', this.scene.walkingNow);
    const trialPh = v.phase === 'defense' || v.phase === 'vote2' || v.phase === 'verdict';
    const canEmo = v.me.alive && !v.me.silenced && (trialPh || ['intro', 'morning', 'day', 'vote1'].includes(v.phase));
    this.emotes.enable(canEmo);
    this.emoToggle.classList.toggle('hidden', !canEmo);
    if (!canEmo) this.el.classList.remove('emo-open');
    const theme = v.phase === 'night' ? 't-night' : v.phase === 'defense' || v.phase === 'vote2' || v.phase === 'verdict' ? 't-trial' : 't-day';
    if (!this.el.classList.contains(theme)) { this.el.classList.remove('t-day', 't-trial', 't-night'); this.el.classList.add(theme); }
    if (prevPhase !== v.phase || prevStep !== v.step || this.left() > this.phaseTotal) this.phaseTotal = Math.max(1, this.left());
    this.renderTop();
    this.renderPlayers();
    this.renderChat();
    this.renderPanel();
    this.renderNight();
  }

  private quiet = false;
  /** 아침 신문에 찍을 날짜 ('☀ N일째 아침' 기록에서) */
  private newsDay = 0;
  private addLog(ch: LogCh, from: number, text: string) {
    const who = from >= 0 ? this.name(from) : '';
    const snd = (n: string) => { if (!this.quiet) sfx(n); };
    let el: HTMLElement;
    if (ch === 'event') {
      el = h('div.gl-event', text);
      if (/사라졌|처형/.test(text)) snd('death');
      const dm = /(\d+)일째 아침/.exec(text);
      if (dm) this.newsDay = Number(dm[1]);
      if (text === '조용한 밤이었다.' && !this.quiet) playNews(this.el, this.newsDay);
    }
    else if (ch === 'secret') { el = h('div.gl-secret', '🔒 ', text); snd('secret'); }
    else if (ch === 'note') { el = h('div.gl-note', '✉ 익명 쪽지: ', text); snd('note'); }
    else if (ch === 'sys') el = h('div.gl-sys', text);
    else el = h(`div.gl-chat.ch-${ch}${from === this.myPid ? '.mine' : ''}`, ch !== 'day' ? h('span.gl-ch', CH_LABEL[ch]) : '', h('b', who), ' ', text);
    this.log.appendChild(el);
    this.log.scrollTop = this.log.scrollHeight;
    if (this.quiet) return;
    this.corridor?.toast(ch, who, text);
    if (ch === 'dead' && from >= 0) this.farm?.say(from, text);
    if ((ch === 'day' || ch === 'defense') && from >= 0) this.scene.say(from, text);
    this.nightLog(ch, who, text);
  }

  // ── 위쪽 ────────────────────────────────────────

  private renderTop() {
    const v = this.v!;
    const phaseName: Record<string, string> = {
      intro: '게임 시작', night: '밤', morning: '아침', day: '낮 토론', vote1: '1차 투표', defense: '결선 변론', vote2: '결선 투표', verdict: '판결', end: '게임 끝',
    };
    const role = v.me.role;
    // 밤에만 지금 누구 차례인지 작게
    const sub = v.phase === 'night' ? `${(STEP_NAMES[v.step] ?? '').replace(/^[①②③] /, '')} 차례` : '';
    const myImg = roleImg(role);
    clear(this.top).append(
      h('div.phase-title',
        h('div.pt-main',
          h('small.en.pt-en', v.phase === 'night' ? `NIGHT ${String(v.night).padStart(2, '0')}` : `DAY ${String(Math.max(1, v.day)).padStart(2, '0')}`),
          h('b', phaseName[v.phase]), sub ? h('small.pt-sub', sub) : '', this.timerEl)),
      h('div.spacer'),
      h('button.btn.small.top-report.g-report', { title: '버그 제보', onclick: () => openReport() }, '🐞'),
      h(`button.me-chip.${ROLES[role as RoleId]?.team ?? ''}`, { onclick: () => this.showRoleCard() },
        myImg ? h('img.mc-img', { src: myImg, alt: '' }) : '',
        h('div.mc-text', h('small', v.me.alive ? this.name(this.myPid) : `${this.name(this.myPid)} (사망)`), h('b', roleName(role as RoleId)))),
    );
    this.renderTimer();
  }

  /** 장면별 배경음악. 누가 사라진 아침은 비 오는 곡 */
  private sadMorning = false;
  private music(phase: string) {
    let name: BgmName;
    if (phase === 'night') { name = 'night'; this.sadMorning = false; }
    else if (phase === 'morning') name = this.sadMorning ? 'rain' : 'mansion';
    else if (phase === 'defense' || phase === 'vote2' || phase === 'verdict') name = 'before_trial';
    else if (phase === 'end') return;
    else name = 'mansion';
    bgm(name);
  }

  private lastTick = -1;
  private renderTimer() {
    if (!this.v) return;
    this.el.classList.toggle('in-corridor', !!this.corridor);
    const l = this.left();
    this.timerEl.replaceChildren(h('span', this.v.phase === 'end' ? '' : `${l}s`), h('i'));
    this.timerEl.classList.toggle('empty', this.v.phase === 'end');
    this.timerEl.classList.toggle('urgent', l <= 5);
    if (l <= 5 && l > 0 && l !== this.lastTick && this.v.phase !== 'end') sfx('tick');
    this.lastTick = l;
    this.timerEl.style.setProperty('--p', String(Math.max(0, Math.min(1, l / this.phaseTotal))));
    const nt = this.nightEl.querySelector('.n-timer');
    if (nt) nt.textContent = `${l}초`;
    this.corridor?.timer(l);
  }

  // ── 플레이어 목록 · 메모 ─────────────────────────

  private renderPlayers() {
    const v = this.v!;
    clear(this.plist).append(h('div.g-title', '플레이어', h('small', '눌러서 메모')));
    for (const p of v.players) {
      const m = this.memo.get(p.pid) ?? 0;
      const tags: (HTMLElement | string)[] = [];
      if (p.pid === this.myPid) tags.push(h('span.tag.me', '나'));
      if (p.shown) tags.push(h(`span.tag.reveal.${ROLES[p.shown as RoleId]?.team ?? ''}`, `정체: ${roleName(p.shown as RoleId)}`));
      const mr = v.me.mateRoles?.find(([q]) => q === p.pid)?.[1];
      if (v.me.mates.includes(p.pid)) tags.push(h('span.tag.mafia', mr && !p.shown ? `동료 ${roleName(mr as RoleId)}` : '동료'));
      if (m) tags.push(h(`span.tag.memo.m${m}`, MEMO[m]));
      if (!p.online && p.alive) tags.push(h('span.tag', '연결 끊김'));
      const cnt = v.counts?.find(([pid]) => pid === p.pid)?.[1];
      if (cnt !== undefined && (v.phase === 'defense' || v.phase === 'vote2' || v.phase === 'verdict')) tags.push(h('span.tag.info', `${cnt}표`));
      if (v.cands.includes(p.pid) && (v.phase === 'defense' || v.phase === 'vote2')) tags.push(h('span.tag.mafia', '결선'));
      this.plist.appendChild(h(`button.g-p${p.alive ? '' : '.dead'}${p.pid === this.myPid ? '.self' : ''}`,
        { onclick: () => { if (p.pid === this.myPid) return; this.memo.set(p.pid, (m + 1) % MEMO.length); this.renderPlayers(); } },
        h(`img.g-anon${(p.shown || mr) && p.pid !== this.myPid ? '.shown' : ''}`, { src: this.face(p.pid), alt: '' }),
        h('div.g-pinfo', h('div.g-pname', p.name, p.alive ? '' : h('span.dead-mark', ' 사망')), h('div.ptags', tags))));
    }
  }

  // ── 채팅 ────────────────────────────────────────

  private renderChat() {
    const chats = this.v!.me.chats;
    if (!chats.includes(this.chatCh)) this.chatCh = chats[0] ?? 'day';
    clear(this.chatRow);
    if (!chats.length) { this.chatRow.append(h('div.dim', this.v!.phase === 'vote1' || this.v!.phase === 'vote2' ? '투표 중에는 채팅할 수 없어요.' : this.v!.phase === 'defense' ? (this.v!.me.silenced ? '입이 막혀 말할 수 없어요.' : '결선에 오른 두 사람만 말할 수 있어요.') : '지금은 채팅할 수 없어요.')); return; }
    if (chats.length > 1) this.chatRow.append(h('div.ch-tabs', chats.map((c) => h(`button.ch-tab${c === this.chatCh ? '.on' : ''}`, { onclick: () => { this.chatCh = c; this.renderChat(); } }, CH_LABEL[c]))));
    else this.chatRow.append(h(`span.ch-label.ch-${chats[0]}`, CH_LABEL[chats[0]]));
    this.chatRow.append(this.chatIn, h('button.btn.small.gold', { onclick: () => this.sendChat() }, '전송'));
  }

  private sendChat() {
    const text = this.chatIn.value.trim();
    if (!text) return;
    this.link.send({ t: 'gchat', text, ch: this.chatCh });
    this.chatIn.value = '';
  }

  // ── 오른쪽 패널 ──────────────────────────────────

  private renderPanel() {
    const v = this.v!;
    const me = v.me;
    const key = JSON.stringify([v.phase, v.step, me.vote, me.prompt?.key, me.notesLeft, me.alive, v.cands, me.canVote, me.proxyFor, me.silenced, me.canTime]);
    if (key === this.lastKey) return;
    this.lastKey = key;
    clear(this.panel);
    const PH_EN: Record<string, string> = { intro: 'PROLOGUE', night: 'NIGHT', morning: 'MORNING', day: 'DISCUSSION', vote1: 'VOTE', defense: 'FINAL DEFENSE', vote2: 'FINAL VOTE', verdict: 'VERDICT', end: 'GAME OVER' };
    const head = (t: string, s?: string) => this.panel.append(h('div.ph-head', h('small.en', me.prompt ? 'CHOICE' : !me.alive ? 'SPECTATOR' : PH_EN[v.phase] ?? ''), h('div.ph-title', t), s ? h('div.ph-sub', s) : ''));
    const people = (ids: number[], on: (pid: number) => void, selected?: number | null) =>
      h('div.pbtns', ids.map((id) => h(`button.pbtn${selected === id ? '.sel' : ''}`, { onclick: () => on(id) }, this.name(id))));

    this.panel.classList.remove('urgent');
    if (me.prompt?.key === 'bat' && !this.batAsked) {
      this.batAsked = true;
      this.batPick = pickBat(this.el, (side) => this.link.send({ t: 'choice', key: 'bat', value: side }), () => this.left());
    }
    if (me.prompt) {
      const pr = me.prompt;
      this.panel.classList.add('urgent');
      this.el.classList.remove('panel-min');
      head('⚡ 선택', pr.text);
      const label = (o: number | string) => typeof o === 'number' ? this.name(o) : ({ mafia: '마피아 팀', citizen: '시민 팀', yes: '뒤집는다', no: '그대로 둔다' } as Record<string, string>)[o] ?? o;
      this.panel.append(h('div.pbtns', pr.options.map((o) => h('button.pbtn', { onclick: () => { sfx('click'); this.link.send({ t: 'choice', key: pr.key, value: o }); } }, label(o)))));
      if (pr.key === 'agitate' || pr.key === 'avenge') this.panel.append(h('button.btn.wide', { onclick: () => this.link.send({ t: 'choice', key: pr.key, value: null }) }, '쓰지 않는다'));
      return;
    }
    if (!me.alive) { head('👻 구경 중', '광장을 구경하고 있어요. 채팅은 죽은 사람끼리만 돼요. 위쪽 🌾 버튼을 누르면 주말농장으로 돌아가요.'); return; }
    switch (v.phase) {
      case 'intro': head('게임 시작!', '직업을 확인하세요. 곧 첫 밤이 찾아옵니다.'); break;
      case 'night': head('🌙 밤', '자기 방에 있어요.'); break;
      case 'morning': head('☀ 아침', '어젯밤 일이 발표됩니다.'); break;
      case 'day': {
        head('☀ 낮 토론', '채팅으로 토론하세요. 왼쪽 목록을 눌러 메모를 남길 수 있어요.');
        if (me.notesLeft > 0) this.panel.append(h('button.btn.wide', { onclick: () => this.noteForm() }, `✉ 익명 쪽지 보내기 (${me.notesLeft})`));
        if (me.canTime) {
          const t = (d: 1 | -1) => () => { sfx('click'); this.link.send({ t: 'time', d }); };
          this.panel.append(h('div.time-btns',
            h('button.btn.small', { onclick: t(-1), title: '오늘 한 번, 토론 시간을 15초 줄여요' }, '⏬ 시간 단축 −15초'),
            h('button.btn.small', { onclick: t(1), title: '오늘 한 번, 토론 시간을 15초 늘려요' }, '⏫ 시간 연장 +15초')));
        } else if (me.alive) this.panel.append(h('div.dim.time-used', '오늘 시간 조절을 이미 썼어요.'));
        break;
      }
      case 'vote1': {
        head('🗳 1차 투표', '가장 많이 표를 받은 두 명이 결선에 오릅니다.');
        const ids = v.players.filter((p) => p.alive && p.pid !== this.myPid).map((p) => p.pid);
        this.panel.append(people(ids, (id) => { sfx('vote'); this.cmd({ t: 'vote', target: id }); }, me.vote));
        this.panel.append(h(`button.btn.wide${me.vote === null ? '.sel' : ''}`, { onclick: () => this.cmd({ t: 'vote', target: null }) }, '기권'));
        if (me.vote !== undefined) this.panel.append(h('div.ph-sub', `투표함: ${me.vote === null ? '기권' : this.name(me.vote)} (바꿀 수 있어요)`));
        break;
      }
      case 'defense':
        if (me.silenced) head('🤐 입이 막혔다', '누군가 당신의 목소리를 훔쳤어요. 이번 변론에서는 말할 수 없어요.');
        else if (me.proxyFor !== undefined) head('🗣 선동 중', `지금 채팅은 ${this.name(me.proxyFor)}의 이름으로 나갑니다.`);
        else head('⚖ 결선 변론', v.cands.includes(this.myPid) ? '당신이 결선에 올랐어요! 45초 동안 변론하세요.' : `${v.cands.map(this.name).join('와(과) ')}의 변론을 들어 보세요.`);
        break;
      case 'vote2': {
        if (!me.canVote) { head('🗳 결선 투표', '다른 사람들이 투표하고 있어요.'); break; }
        head('🗳 결선 투표', v.cands.length === 2 ? '둘 중 한 명을 고르세요. 동표면 처형 없이 밤.' : `${this.name(v.cands[0])}를 처형할까요?`);
        if (v.cands.length === 2) this.panel.append(people(v.cands, (id) => { sfx('vote'); this.cmd({ t: 'vote', target: id }); }, me.vote));
        else this.panel.append(h('div.bigbtns',
          h(`button.btn.big.mafia${me.vote === v.cands[0] ? '.sel' : ''}`, { onclick: () => this.cmd({ t: 'vote', target: v.cands[0] }) }, '처형'),
          h(`button.btn.big${me.vote === null ? '.sel' : ''}`, { onclick: () => this.cmd({ t: 'vote', target: null }) }, '반대')));
        break;
      }
      case 'verdict': head('⚖ 판결', '결과를 기다리는 중…'); break;
      case 'end': head('🏆 게임 끝', '곧 대기실로 돌아갑니다.'); break;
    }
  }

  private noteForm() {
    const v = this.v!;
    const input = h('input.txt-in', { placeholder: '쪽지 내용 (80자)', maxLength: 80 }) as HTMLInputElement;
    let to: number | null = null;
    const ids = v.players.filter((p) => p.alive && p.pid !== this.myPid).map((p) => p.pid);
    const btns = h('div.pbtns');
    const render = () => btns.replaceChildren(...ids.map((id) => h(`button.pbtn${to === id ? '.sel' : ''}`, { onclick: () => { to = id; render(); } }, this.name(id))));
    render();
    const modal = h('div.overlay', { onclick: (e: Event) => e.target === modal && modal.remove() },
      h('div.card.notecard',
        h('h2', '✉ 익명 쪽지'),
        h('p.hint', '받는 사람은 누가 보냈는지 몰라요. 하루 한 번.'),
        btns, input,
        h('div.row.end', h('button.btn', { onclick: () => modal.remove() }, '취소'),
          h('button.btn.gold', { onclick: () => { if (to === null || !input.value.trim()) return; this.link.send({ t: 'note', to, text: input.value.trim() }); modal.remove(); } }, '보내기'))));
    this.root.appendChild(modal);
    setTimeout(() => input.focus(), 50);
  }

  // ── 밤 ──────────────────────────────────────────

  private nightLogEl = h('div.n-log');
  private nightLog(ch: LogCh, who: string, text: string) {
    if (this.v?.phase !== 'night' && !this.farm) return;
    // 낮의 농장에서는 광장 대화도 같이 들린다 (구경하러 가지 않아도 흐름을 따라가게)
    const dayTalk = (ch === 'day' || ch === 'defense') && this.v?.phase !== 'night';
    if (ch === 'secret' || ch === 'event' || ch === 'nifel' || ch === 'dead' || dayTalk) {
      this.nightLogEl.appendChild(h(`div.nl.${ch}`, dayTalk ? h('span.nl-ch', '광장 ') : '', who ? h('b', who + ' ') : '', text));
      this.nightLogEl.scrollTop = this.nightLogEl.scrollHeight;
    }
  }

  /** 죽은 사람이 농장 대신 광장·결선을 구경하는 중 (낮에만) */
  private spectate = false;
  private renderNight() {
    const v = this.v!;
    const dayFarm = !!v.me.farm && v.phase !== 'night' && v.phase !== 'end';
    const farm = !!v.me.farm && !(dayFarm && this.spectate);
    const night = (v.phase === 'night' && (v.me.alive || farm)) || (dayFarm && !this.spectate);
    this.el.classList.toggle('spectating', dayFarm && this.spectate);
    this.backFarm.classList.toggle('hidden', !(dayFarm && this.spectate));
    this.nightEl.classList.toggle('hidden', !night);
    if (!night) { this.corridor?.destroy(); this.corridor = null; this.farm?.destroy(); this.farm = null; clear(this.nightEl); this.nightLogEl = h('div.n-log'); return; }
    if (farm) { this.renderFarm(v); return; }
    if (this.farm) { this.farm.destroy(); this.farm = null; clear(this.nightEl); }
    const act = v.me.act;
    // 복도에 나가 있는데 차례가 끝났거나 능력을 썼으면 방으로
    if (this.corridor && (!act || (act.done && act.kind !== 'kill'))) { this.corridor.destroy(); this.corridor = null; }
    if (this.corridor) { this.corridor.refresh(v); return; }
    const img = roleImg(v.me.role);
    const myTurn = !!act && !act.locked && !act.done;
    const status = act
      ? act.locked ? '🔒 방 문이 잠겼다! 오늘 밤은 아무것도 할 수 없다.'
        : act.done ? `능력을 썼어요. (${ACT_LABEL[act.kind]}: ${act.choice === null ? '쓰지 않음' : this.name(act.choice)})`
          : `지금은 당신의 차례! 문을 열고 나가 ${ACT_LABEL[act.kind]}할 사람의 방으로 가세요.${act.optional ? ' (안 써도 돼요)' : ' (시간이 지나면 무작위)'}`
      : `${STEP_NAMES[v.step]} 차례. 누군가 움직이고 있다…`;
    clear(this.nightEl).append(
      h('div.n-room', { style: `--room-bg: ${bgUrl('night_room.webp')}` },
        h('div.n-me', img ? h('img', { src: img, alt: '' }) : h('div.n-sil', '?')),
        h('div.n-door', myTurn ? h('button.btn.gold.big', { onclick: () => this.goCorridor() }, '🚪 문 열고 나가기') : act?.locked ? h('div.n-door-shut', '🔒 문이 잠겼다') : '')),
      h('div.n-side',
        h('div.n-title', h('div.n-tt', h('small.en', 'MY ROOM'), h('b', `🌙 ${v.night}번째 밤`)), h('span.n-timer', `${this.left()}초`)),
        h('div.n-step', STEP_NAMES.slice(1).map((s, i) => h(`span${v.step === i + 1 ? '.on' : ''}`, s))),
        h('div.n-status', status),
        act && act.optional && myTurn ? h('button.btn.small', { onclick: () => this.cmd({ t: 'act', target: null }) }, '오늘은 쓰지 않기') : '',
        v.me.drone ? h('div.n-drone', `🛸 드론 ${v.me.drone.count}/3, 투표권 ${1 + v.me.drone.count}`,
          v.me.drone.tries > 0 && v.me.drone.count < 3 ? h('button.btn.small.gold', { onclick: () => { sfx('click'); this.link.send({ t: 'drone' }); } }, `🔧 조립하기 (남은 기회 ${v.me.drone.tries})`) : h('span.dim', ' 오늘 밤 조립 끝')) : '',
        this.nightLogEl,
        v.me.chats.length ? h('div.n-chat', h('span', CH_LABEL[v.me.chats[0]]), this.nightChatInput()) : '',
        h('div.n-mini', h('small.en', 'WHILE WAITING'), h('div.n-mini-row',
          h('button.btn.small', { onclick: () => playCatch(this.root, roleChar(v.me.role) ?? 'nifel', () => {}) }, '🍞 빵 받기'),
          h('button.btn.small', { onclick: () => playMatch(this.root, () => {}) }, '🃏 짝 맞추기')))),
    );
  }

  /** 주말농장 (죽은 사람은 늘, 밤에는 이드도) */
  private farmTitle = h('div.n-title');
  private farmSpec = h('div.n-spec');
  private renderFarm(v: GameView) {
    const night = v.phase === 'night';
    const where = v.phase === 'defense' || v.phase === 'vote2' || v.phase === 'verdict' ? '결선' : '광장';
    this.farmTitle.replaceChildren(h('div.n-tt', h('small.en', 'WEEKEND FARM'), h('b', `🌾 주말농장`), h('small.n-when', night ? `${v.night}번째 밤` : `${Math.max(1, v.day)}일째 낮`)), h('span.n-timer', `${this.left()}초`));
    this.farmSpec.replaceChildren(night || v.phase === 'end' ? '' : h('button.btn.small.wide', { onclick: () => { this.spectate = true; this.lastKey = ''; this.update(this.v!); } }, `👀 ${where} 구경하러 가기`));
    if (this.farm) { this.farm.sync(v); return; }
    this.corridor?.destroy(); this.corridor = null;
    // 정체 보호: 나는 내 직업 캐릭터, 이드(와 이드로 변장한 스피키)는 이드, 나머지는 공용 모습.
    // 남의 직업은 서버가 아예 보내지 않으므로 화면 오류로 드러날 일은 없다.
    const myImg = roleImg(v.me.role) ?? ANON;
    const ideImg = roleImg('medium') ?? ANON;
    const img = (pid: number, ide: boolean) => (pid === this.myPid ? myImg : ide ? ideImg : this.face(pid));
    const area = h('div.farm-area');
    const me = v.players.find((p) => p.pid === this.myPid);
    clear(this.nightEl).append(area,
      h('div.n-side',
        this.farmTitle,
        this.farmSpec,
        h('div.n-status', me?.alive
          ? '이드는 밤마다 주말농장에서 사라진 사람들을 만나요. 니펠의 대화는 들을 수 없지만, 죽은 사람들이 전해 줄 수 있어요.'
          : '죽은 사람들은 낮에도 밤에도 여기 모여요. 낮에는 광장 대화가 들리고, 밤에는 니펠의 대화를 엿들을 수 있어요. 이드가 오면 전해 줄 수도, 속일 수도 있어요.'),
        this.nightLogEl,
        v.me.chats.length ? h('div.n-chat', h('span', '농장'), this.nightChatInput()) : '',
        h('div.n-mini', h('small.en', 'WHILE WAITING'), h('div.n-mini-row',
          h('button.btn.small', { onclick: () => playCatch(this.root, (roleChar(v.me.role) ?? 'nifel') as never, () => {}) }, '🍞 빵 받기'),
          h('button.btn.small', { onclick: () => playMatch(this.root, () => {}) }, '🃏 짝 맞추기')))));
    this.farm = new Farm(area, v, this.myPid, this.name, img, (x, y) => this.link.send({ t: 'fmove', x, y }));
  }

  private nightChatInput() {
    const inp = h('input.chat-in', { placeholder: this.farm || this.v?.me.farm ? '농장 채팅' : '밤 채팅', maxLength: 120 }) as HTMLInputElement;
    inp.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' || !inp.value.trim()) return;
      this.link.send({ t: 'gchat', text: inp.value.trim(), ch: this.v!.me.chats[0] });
      inp.value = '';
    });
    return inp;
  }

  private goCorridor() {
    sfx('door');
    const v = this.v!;
    this.corridor = new Corridor(this.nightEl, v, this.myPid, roleImg(v.me.role), this.name, (target) => {
      this.cmd({ t: 'act', target });
      sfx('door');
    }, (x, y) => this.link.send({ t: 'cmove', x, y }), () => { this.corridor?.destroy(); this.corridor = null; this.renderNight(); });
  }

  // ── 카드 ────────────────────────────────────────

  private showRoleCard() {
    const v = this.v!;
    const role = v.me.role as RoleId;
    const def = ROLES[role];
    const img = roleImg(role);
    const ov = h('div.overlay', { onclick: (e: Event) => e.target === ov && ov.remove() },
      h(`div.card.rolecard.${def.team}`,
        h('div.rc-team', h('small.en', { mafia: 'MAFIA', citizen: 'CITIZENS', neutral: 'NEUTRAL' }[def.team]), { mafia: '마피아 팀', citizen: '시민 팀', neutral: '중립' }[def.team]),
        img ? h('img.rc-img', { src: img, alt: '' }) : '',
        h('div.rc-name', roleName(role)),
        h('div.rc-job', def.job),
        h('p.rc-desc', def.desc),
        v.me.mates.length ? h('div.rc-mates', `동료: ${v.me.mates.map(this.name).join(', ')}`) : '',
        h('button.btn.gold.wide', { onclick: () => ov.remove() }, '확인')));
    sfx('open');
    this.el.appendChild(ov);
    if (v.phase === 'intro') setTimeout(() => ov.remove(), 7000);
  }

  private showEnd(winner: string, roles: { pid: number; role: string; alive: boolean }[], winners: number[], mvpAt: number | undefined, day: number) {
    const won = winners.includes(this.myPid);
    this.emotes.enable(false);
    this.emoToggle.classList.add('hidden');
    this.endInfo = { winner, roles, winners, day, mvp: [] };
    const real = () => {
      sfx(won ? 'win' : 'lose');
      bgm(won ? 'title' : 'rain');
      const ov = this.endScreen(winner, roles, winners, mvpAt, false);
      this.endEl = ov;
      this.el.appendChild(ov);
      return ov;
    };
    if (winner !== 'elena' && winner !== 'jester') { real(); return; }
    // 엘레나 · 코미 승리: 원래 이겼을 팀의 승리 화면이 잠깐 → 엘레나는 드론 습격, 코미는 사료캔.
    // 엘레나가 없었다면 이겼을 팀(살아남은 수가 더 많은 팀)의 승리 화면이 잠깐 → 드론 떼가 몰려와 전부 왼쪽으로 밀어내고 → 엘레나 승리
    const alive = (t: string) => roles.filter((r) => r.alive && ROLES[r.role as RoleId]?.team === t).length;
    const fakeTeam = alive('mafia') > 0 && alive('mafia') >= alive('citizen') ? 'mafia' : 'citizen';
    const fakeWin = roles.filter((r) => ROLES[r.role as RoleId]?.team === fakeTeam).map((r) => r.pid);
    sfx('win');
    const fake = this.endScreen(fakeTeam, roles, fakeWin, undefined, true);
    this.el.appendChild(fake);
    if (winner === 'elena') droneRaid(this.el, fake, () => { const ov = real(); ov.classList.add('after-raid'); this.el.insertBefore(ov, fake); }, () => fake.remove());
    // 코미 승리: 이긴 줄 알았던 캐릭터들이 사료캔에 하나씩 깔리고 → 코미가 캔 위에 → 코미 승리
    else canDrop(this.el, fake, () => { const ov = real(); ov.classList.add('after-raid', 'prep', 'canned'); this.el.insertBefore(ov, fake); return ov; }, () => fake.remove());
  }

  /** 끝 화면 한 장 (fake: 엘레나 연출용 가짜 승리 화면 — 누를 수 없고 투표 · 시간 표시 없음) */
  private endScreen(winner: string, roles: { pid: number; role: string; alive: boolean }[], winners: number[], mvpAt: number | undefined, fake: boolean) {
    const won = winners.includes(this.myPid);
    const [title, en, bg] = END_T[winner] ?? END_T.draw;
    const champs = roles.filter((r) => winners.includes(r.pid));
    const others = roles.filter((r) => !winners.includes(r.pid));
    // 최고의 플레이어 투표: 승리 팀 캐릭터 아래 ⭐ 버튼 (나는 빼고)
    const mvpBtns = new Map<number, HTMLButtonElement>();
    const voteMvp = (pid: number) => {
      this.link.send({ t: 'mvp', target: pid });
      sfx('vote');
      for (const [k, b] of mvpBtns) b.classList.toggle('on', k === pid);
    };
    // 단체 사진: 가운데가 앞·크게, 바깥으로 갈수록 뒤로
    const photo = h('div.end-photo');
    champs.forEach((r, i) => {
      const n = champs.length;
      const off = i - (n - 1) / 2;
      const img = roleImg(r.role);
      const canVote = !fake && !!mvpAt && r.pid !== this.myPid;
      const btn = canVote ? h('button.end-mvp-btn', { onclick: () => voteMvp(r.pid) }, '⭐ 최고!') as HTMLButtonElement : null;
      if (btn) mvpBtns.set(r.pid, btn);
      photo.appendChild(h(`div.end-champ${r.pid === this.myPid ? '.me' : ''}`, { style: `--x:${off}; --ax:${Math.abs(off)}; --i:${i}; z-index:${20 - Math.round(Math.abs(off) * 2)}`, 'data-pid': String(r.pid) },
        img ? h('img', { src: img, alt: '' }) : h('div.n-sil', '?'),
        h('div.end-label', h('b', roleName(r.role as RoleId)), h('small', this.name(r.pid))),
        btn ?? ''));
    });
    // 진 사람들은 구석에서 시무룩
    const losers = h('div.end-losers', others.map((r, i) => {
      const img = roleImg(r.role);
      return h('div.end-loser', { style: `--i:${i}` }, img ? h('img', { src: img, alt: '' }) : '', h('small', roleName(r.role as RoleId)));
    }));
    // 정체 공개표: 케이크 가면이 하나씩 벗겨진다
    const list = h('div.end-list', h('div.end-list-head', h('small.en', 'UNMASKED'), h('b', '가면 아래 정체')),
      ...roles.map((r, i) => {
        const img = roleImg(r.role);
        const team = ROLES[r.role as RoleId]?.team ?? '';
        return h(`div.end-row.${team}${r.pid === this.myPid ? '.self' : ''}${winners.includes(r.pid) ? '.won' : ''}`, { style: `--i:${i}` },
          h('div.end-face', h('img.mask', { src: maskImg(r.pid), alt: '' }), img ? h('img.real', { src: img, alt: '' }) : ''),
          h('div.end-who', h('b', roleName(r.role as RoleId)), h('small', this.name(r.pid))),
          h('div.end-state', r.alive ? '생존' : '사망', winners.includes(r.pid) ? h('i', 'WIN') : ''));
      }));
    const status = h('span.end-status');
    const ov = h(`div.end-screen.w-${winner}${fake ? '.fake' : ''}`, { style: `--bg: ${bgUrl(bg)}` },
      h('div.end-bg'),
      h('div.end-title', h('small.en', en), h('b', title), h(`div.end-me.${won ? 'win' : 'lose'}`, won ? '승리!' : '패배…')),
      photo, losers, list,
      h('div.end-foot', status,
        h('button.btn.small.share', { onclick: () => this.share() }, '📸 결과 공유'),
        h('button.btn.small', { onclick: () => ov.remove() }, '닫기')));
    if (fake) return ov;
    // 남은 시간 · 투표 현황
    const endAt = mvpAt ?? Date.now() + 15_000;
    const upd = () => {
      if (!ov.isConnected) { if (Date.now() > endAt) clearInterval(t); return; }
      if (ov.dataset.done) return;
      const left = Math.max(0, Math.ceil((endAt - Date.now()) / 1000));
      status.textContent = mvpAt ? `⭐ 최고의 플레이어 투표 ${left}초${ov.dataset.voted ? ` (${ov.dataset.voted})` : ''}` : `${left}초 뒤 대기실로 돌아갑니다`;
    };
    const t = window.setInterval(upd, 250);
    upd();
    return ov;
  }

  /** 최고의 플레이어 투표 현황 · 결과 */
  private onMvp(voted: number, of: number, pids?: number[]) {
    const ov = this.endEl;
    if (!ov) return;
    ov.dataset.voted = `${voted}/${of}명 투표`;
    if (!pids) return;
    ov.dataset.done = '1';
    ov.querySelectorAll<HTMLButtonElement>('.end-mvp-btn').forEach((b) => b.remove());
    const status = ov.querySelector('.end-status');
    if (status) status.textContent = '잠시 뒤 대기실로 돌아갑니다';
    if (this.endInfo) this.endInfo.mvp = pids;
    if (!pids.length) return;
    sfx('win');
    for (const pid of pids) {
      const c = ov.querySelector(`.end-champ[data-pid="${pid}"]`);
      if (!c) continue;
      c.classList.add('mvp');
      const star = emojiFile('⭐');
      if (star) c.appendChild(h('img.end-star', { src: star, alt: '' }));
    }
    ov.appendChild(h('div.end-mvp', '⭐', h('div', h('small', '최고의 플레이어'), h('br'), h('b', pids.map((p) => this.name(p)).join(', ')))));
  }

  /** 결과 공유 카드 (대기실로 돌아간 뒤에도 쓸 수 있게 방 화면에 띄운다) */
  private share() { const c = this.cardInfo(); if (c) void shareCard(this.root, c); }
  cardInfo(): CardInfo | null {
    const e = this.endInfo;
    if (!e) return null;
    const [title, en, bg] = END_T[e.winner] ?? END_T.draw;
    const card = (r: { pid: number; role: string; alive: boolean }): CardPlayer => ({
      name: this.name(r.pid), role: roleName(r.role as RoleId), job: ROLES[r.role as RoleId]?.job ?? '', img: roleImg(r.role),
      team: ROLES[r.role as RoleId]?.team ?? '', won: e.winners.includes(r.pid), alive: r.alive, mvp: e.mvp.includes(r.pid), self: r.pid === this.myPid,
    });
    const players = e.roles.map(card);
    return { title, en, bg, won: e.winners.includes(this.myPid), day: e.day, me: players.find((p) => p.self), players, mvp: e.mvp.map((p) => this.name(p)) };
  }

}

/** 밤의 복도: 문 앞으로 걸어가서 능력 사용 */
class Corridor {
  private world = h('div.cw');
  private wrap: HTMLElement;
  private input = new MoveInput();
  private me: HTMLElement;
  private x = CW / 2;
  private y = CH / 2;
  private raf = 0;
  private last = performance.now();
  private doors: { pid: number; x: number; y: number; el: HTMLElement }[] = [];
  private near: number | null = null;
  private actBtn = h('button.btn.gold.big.c-act.hidden');
  private info = h('div.c-info');
  private timerEl = h('div.c-timer');
  private toastEl = h('div.c-toast');
  private mates = new Map<number, HTMLElement>();
  private lastSent = 0;
  private view!: HTMLElement;
  private vw = 0;
  private vh = 0;
  private lastFit = 0;
  private onKey = (e: KeyboardEvent) => {
    if ((e.key === 'e' || e.key === 'E' || e.key === ' ' || e.key === 'Enter') && this.near !== null && (e.target as HTMLElement)?.tagName !== 'INPUT') { e.preventDefault(); this.use(); }
  };

  constructor(host: HTMLElement, private v: GameView, private myPid: number, img: string | null, private name: (p: number) => string,
    private onAct: (target: number | null) => void, private onMove: (x: number, y: number) => void, private onExit: () => void) {
    // 복도 배치: 긴 벽을 따라 문이 한 줄로, 바닥을 걸어 다닌다 (화면은 나를 따라 옆으로 움직임)
    // 배경은 CSS 배경이 아니라 <img> 한 장: 스크롤할 때 다시 그리지 않고 그림 그대로 옮기기만 한다 (모바일 버벅임 원인이었음)
    this.world.appendChild(h('img.cw-bg', { src: asset('bg/corridor.webp'), alt: '', decoding: 'async' }));
    const ids = v.players.map((p) => p.pid);
    const n = ids.length;
    // 기둥 사이 5칸에 고르게 나눠 배치
    const bays = PILLARS.length - 1;
    const slots: number[] = [];
    for (let b = 0; b < bays; b++) {
      const cnt = Math.floor(n / bays) + (b < n % bays ? 1 : 0);
      const l = PILLARS[b] + 70, r = PILLARS[b + 1] - 70;
      for (let k = 0; k < cnt; k++) slots.push(l + ((r - l) * (k + 0.5)) / cnt);
    }
    ids.forEach((pid, i) => {
      const x = slots[i];
      const p = v.players.find((q) => q.pid === pid)!;
      const el = h(`div.c-door${p.alive ? '' : '.dead'}${pid === myPid ? '.mine' : ''}`, { style: { left: x + 'px', top: WALL + 'px' } },
        h('div.c-frame', h('div.c-leaf.l'), h('div.c-leaf.r')), h('div.c-plate', pid === myPid ? '내 방' : p.name), h('div.c-shadow'));
      this.world.appendChild(el);
      this.doors.push({ pid, x, y: FLOOR0 + 20, el });
    });
    const mine = this.doors.find((d) => d.pid === myPid);
    if (mine) this.x = mine.x;
    this.y = FLOOR0 + 50;
    this.me = h('div.ch.me', h('div.ch-body', img ? h('img', { src: img, alt: '' }) : h('div.n-sil', '?')), h('div.ch-shadow'), h('div.ch-name', '나'));
    this.world.appendChild(this.me);
    this.view = h('div.cw-wrap', this.world, h('div.cw-vignette'));
    this.wrap = h('div.corridor',
      this.view,
      h('div.c-hud', this.info, this.timerEl),
      this.toastEl,
      this.actBtn,
      h('button.btn.small.c-back', { onclick: () => this.onExit() }, '← 방으로 돌아가기'));
    if (isTouch()) this.wrap.appendChild(this.input.el);
    host.appendChild(this.wrap);
    this.actBtn.onclick = () => this.use();
    window.addEventListener('keydown', this.onKey);
    this.refresh(v);
    this.loop();
  }

  refresh(v: GameView) {
    this.v = v;
    const act = v.me.act;
    const k = act?.kind ?? '';
    const tv = v.me.teamVotes ?? [];
    this.info.replaceChildren(
      h('b', `${ACT_LABEL[k] ?? ''}할 사람의 방 문 앞으로 가세요`),
      h('div', isTouch() ? '방향패드로 이동, 문 앞에서 버튼' : 'WASD/방향키로 이동, 문 앞에서 E 또는 스페이스'),
      k === 'kill' && tv.length ? h('div.c-votes', '니펠 투표: ', tv.map(([p, t]) => `${p === this.myPid ? '나' : this.name(p)}→${t === null ? '?' : this.name(t)}`).join(', ')) : '',
    );
    for (const d of this.doors) d.el.classList.toggle('chosen', act?.choice === d.pid);
  }

  timer(l: number) { this.timerEl.textContent = `${l}초`; }

  mate(pid: number, x: number, y: number) {
    let el = this.mates.get(pid);
    if (!el) {
      el = h('div.ch.mate', h('div.ch-body', h('div.n-sil', '니')), h('div.ch-shadow'), h('div.ch-name', this.name(pid)));
      this.world.appendChild(el);
      this.mates.set(pid, el);
    }
    el.style.transform = `translate(${x}px, ${y}px)`;
  }

  toast(ch: LogCh, who: string, text: string) {
    if (ch !== 'secret' && ch !== 'nifel') return;
    this.toastEl.appendChild(h('div', who ? `${who}: ` : '', text));
    while (this.toastEl.children.length > 4) this.toastEl.firstChild?.remove();
  }

  private use() {
    const act = this.v.me.act;
    if (this.near === null || !act || act.locked) return;
    if (!act.targets.includes(this.near)) return;
    this.onAct(this.near);
  }

  private loop = () => {
    this.raf = requestAnimationFrame(this.loop);
    const t = performance.now();
    const dt = Math.min(0.05, (t - this.last) / 1000);
    this.last = t;
    const d = this.input.dir();
    this.x = Math.max(60, Math.min(CW - 60, this.x + d.x * 420 * dt));
    this.y = Math.max(FLOOR0, Math.min(FLOOR1, this.y + d.y * 420 * dt));
    if (d.x) this.me.classList.toggle('flip', d.x > 0);
    this.me.classList.toggle('moving', d.x !== 0 || d.y !== 0);
    this.me.style.transform = `translate(${this.x}px, ${this.y}px)`;
    if ((d.x || d.y) && t - this.lastSent > 120 && this.v.me.act?.kind === 'kill') { this.onMove(Math.round(this.x), Math.round(this.y)); this.lastSent = t; }
    // 가까운 문
    const act = this.v.me.act;
    let best: number | null = null, bd = 110;
    for (const dr of this.doors) {
      const dd = Math.hypot(dr.x - this.x, dr.y - this.y);
      if (dd < bd && act?.targets.includes(dr.pid)) { bd = dd; best = dr.pid; }
    }
    if (best !== this.near) {
      this.near = best;
      for (const dr of this.doors) dr.el.classList.toggle('near', dr.pid === best);
      this.actBtn.classList.toggle('hidden', best === null);
      if (best !== null && act) this.actBtn.textContent = `${ACT_LABEL[act.kind]} → ${best === this.myPid ? '나' : this.name(best)}`;
    }
    // 화면 맞추기: 높이에 맞추고 가로는 나를 따라 스크롤
    if (!this.vw || t - this.lastFit > 500) { this.vw = this.view.clientWidth; this.vh = this.view.clientHeight; this.lastFit = t; }
    const k = this.vh / CH;
    const viewW = this.vw / k;
    const camX = Math.max(0, Math.min(CW - viewW, this.x - viewW / 2));
    this.world.style.transform = `scale(${k}) translateX(${-camX}px)`;
  };

  destroy() {
    cancelAnimationFrame(this.raf);
    this.input.destroy();
    window.removeEventListener('keydown', this.onKey);
    this.wrap.remove();
  }
}

/** 밤의 주말농장: 대기실처럼 걸어 다니며 말풍선으로 대화 */
class Farm {
  private world = h('div.farm-world');
  private wrap: HTMLElement;
  private input = new MoveInput();
  private avs = new Map<number, { el: HTMLElement; bubble: HTMLElement; x: number; y: number; tx: number; ty: number; timer: number; mv?: number; mvOn?: boolean }>();
  private raf = 0;
  private last = performance.now();
  private lastFit = -1e9;
  private lastSent = 0;

  constructor(host: HTMLElement, v: GameView, private myPid: number, private name: (p: number) => string,
    private img: (pid: number, ide: boolean) => string, private onMove: (x: number, y: number) => void) {
    this.world.style.setProperty('--farm-bg', bgUrl('farm.webp'));
    this.wrap = h('div.farm-wrap', this.world);
    host.appendChild(this.wrap);
    if (isTouch()) host.appendChild(this.input.el);
    this.sync(v);
    this.loop();
  }

  sync(v: GameView) {
    const list = v.me.farm ?? [];
    const ids = new Set(list.map(([p]) => p));
    for (const [pid, a] of this.avs) if (!ids.has(pid)) { a.el.remove(); this.avs.delete(pid); }
    for (const [pid, x, y, ide] of list) {
      if (this.avs.has(pid)) continue;
      const alive = !!ide;
      const bubble = h('div.ch-bubble');
      const el = h(`div.ch${pid === this.myPid ? '.me' : ''}${alive ? '.ide' : '.ghost'}`,
        h('div.ch-body', h('img', { src: this.img(pid, !!ide), alt: '' })), h('div.ch-shadow'), h('div.ch-name', pid === this.myPid ? '나' : this.name(pid)), bubble);
      this.world.appendChild(el);
      this.avs.set(pid, { el, bubble, x, y, tx: x, ty: y, timer: 0 });
    }
  }

  move(pid: number, x: number, y: number) {
    const a = this.avs.get(pid);
    if (a && pid !== this.myPid) { a.tx = x; a.ty = y; }
  }

  say(pid: number, text: string) {
    const a = this.avs.get(pid);
    if (!a) return;
    a.bubble.textContent = text;
    a.bubble.classList.add('show');
    clearTimeout(a.timer);
    a.timer = window.setTimeout(() => a.bubble.classList.remove('show'), 4000);
  }

  private loop = () => {
    this.raf = requestAnimationFrame(this.loop);
    const t = performance.now();
    const dt = Math.min(0.05, (t - this.last) / 1000);
    this.last = t;
    const me = this.avs.get(this.myPid);
    const typing = (document.activeElement as HTMLElement | null)?.tagName === 'INPUT';
    if (me) {
      const d = typing ? { x: 0, y: 0 } : this.input.dir();
      me.x = Math.max(40, Math.min(FARM_W - 40, me.x + d.x * 360 * dt));
      me.y = Math.max(440, Math.min(FARM_H - 40, me.y + d.y * 360 * dt));
      if (d.x) me.el.classList.toggle('flip', d.x > 0);
      me.el.classList.toggle('moving', d.x !== 0 || d.y !== 0);
      if ((d.x || d.y) && t - this.lastSent > 90) { this.onMove(Math.round(me.x), Math.round(me.y)); this.lastSent = t; }
    }
    for (const [pid, a] of this.avs) {
      if (pid !== this.myPid) {
        const dx = a.tx - a.x;
        // 농장 px 단위: 0.2초에 걸쳐 따라감
        const on = follow(a, dt, t, 0.2, 60, 2000, 1);
        if (Math.abs(dx) > 4) a.el.classList.toggle('flip', dx > 0);
        if (on !== a.mvOn) { a.mvOn = on; a.el.classList.toggle('moving', on); }
      }
      const tf = `translate3d(${a.x.toFixed(1)}px, ${a.y.toFixed(1)}px, 0)`;
      if (a.el.style.transform !== tf) { a.el.style.transform = tf; a.el.style.zIndex = String(Math.round(a.y)); }
    }
    if (t - this.lastFit > 500) {
      this.lastFit = t;
      const k = Math.min(this.wrap.clientWidth / FARM_W, this.wrap.clientHeight / FARM_H);
      const tf = `translate(-50%, -50%) scale(${k.toFixed(4)})`;
      if (this.world.style.transform !== tf) this.world.style.transform = tf;
    }
  };

  destroy() {
    cancelAnimationFrame(this.raf);
    this.input.destroy();
    for (const a of this.avs.values()) clearTimeout(a.timer);
    this.wrap.remove();
  }
}
