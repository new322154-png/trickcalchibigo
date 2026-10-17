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
import { bgUrl, clear, h } from './dom';
import { MoveInput, isTouch } from './input';
import { Scene } from './scene';
import { playCut, preloadCuts } from './cut';
import { sfx } from './sfx';

/** 밤 복도 (배경 2172×724 → 높이 900 기준) */
const CW = 2700, CH = 900, WALL = 374, FLOOR0 = 398, FLOOR1 = 676;
/** 배경 속 기둥 위치 (문은 기둥 사이 칸에 들어간다) */
const PILLARS = [99, 621, 1144, 1678, 2195, 2672];
const STEP_NAMES = ['', '① 뮤트 · 스피키', '② 니펠', '③ 그 밖의 능력'];
const ACT_LABEL: Record<string, string> = {
  kill: '습격', seal: '해킹', disguise: '변장', protect: '지키기', investigate: '조사', track: '지켜보기', reveal: '직업 공개', identify: '직업 알아내기', revive: '소원 빌기',
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
  private phaseTotal = 1;

  constructor(private root: HTMLElement, public link: RoomLink, private myPid: number) {
    this.chatIn.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); this.sendChat(); } });
    this.scene = new Scene(myPid, () => roleImg(this.v?.me.role ?? '') ?? ANON, maskImg, this.name, (x, y) => this.link.send({ t: 'pmove', x, y }));
    this.el = h('div.game-screen',
      this.scene.el,
      this.top,
      h('div.g-cols',
        this.plist,
        h('div.g-center', h('div.g-dialog', h('div.g-dialog-head', h('span', 'LOG'), h('b', '대화 기록')), this.log, this.chatRow)),
        this.panel),
      this.nightEl);
    if (isTouch()) this.el.appendChild(this.scene.joy);
    this.el.style.setProperty('--anon', `url("${new URL(ANON, location.href).href}")`);
    root.appendChild(this.el);
    this.tick = window.setInterval(() => this.renderTimer(), 250);
  }

  destroy() {
    clearInterval(this.tick);
    this.corridor?.destroy();
    this.farm?.destroy();
    this.scene.destroy();
    this.el.remove();
  }

  name = (pid: number) => (pid < 0 ? '저택' : this.v?.players.find((p) => p.pid === pid)?.name ?? '?');
  private left() { return this.v ? Math.max(0, Math.ceil((this.v.endsAt - (Date.now() + this.skew)) / 1000)) : 0; }

  // ── 서버 메시지 ──────────────────────────────────

  onMsg(m: S2C) {
    if (m.t === 'g') this.update(m.v);
    else if (m.t === 'glog') this.addLog(m.ch, m.from, m.text);
    else if (m.t === 'gcmove') this.corridor?.mate(m.pid, m.x, m.y);
    else if (m.t === 'fmove') this.farm?.move(m.pid, m.x, m.y);
    else if (m.t === 'pmove') this.scene.move(m.pid, m.x, m.y);
    else if (m.t === 'gend') this.showEnd(m.winner, m.roles, m.winners);
    else if (m.t === 'cut') {
      const mine = m.kind.startsWith('p_');
      sfx(m.kind === 'execute' || m.kind === 'vanish' || m.kind === 'blast' ? 'death' : mine ? 'secret' : 'gavel');
      const fb = mine ? roleImg(this.v?.me.role ?? '') ?? ANON : m.pid !== undefined ? maskImg(m.pid) : ANON;
      playCut(this.el, m.kind, m.text, fb, { n: m.n });
    }
  }

  private update(v: GameView) {
    const first = !this.v;
    const prevPhase = this.v?.phase, prevStep = this.v?.step;
    this.skew = v.now - Date.now();
    this.v = v;
    if (first) { this.showRoleCard(); preloadCuts(v.me.role); }
    if (prevPhase !== v.phase || prevStep !== v.step) {
      if (v.phase === 'night' && prevPhase !== 'night') sfx('night');
      if (v.phase === 'morning') sfx('morning');
      if (v.phase === 'vote1' || v.phase === 'vote2') sfx('gavel');
    }
    this.scene.update(v);
    this.el.classList.toggle('walking', this.scene.walkingNow);
    const theme = v.phase === 'night' ? 't-night' : v.phase === 'defense' || v.phase === 'vote2' || v.phase === 'verdict' ? 't-trial' : 't-day';
    if (!this.el.classList.contains(theme)) { this.el.classList.remove('t-day', 't-trial', 't-night'); this.el.classList.add(theme); }
    if (prevPhase !== v.phase || prevStep !== v.step) this.phaseTotal = Math.max(1, this.left());
    this.renderTop();
    this.renderPlayers();
    this.renderChat();
    this.renderPanel();
    this.renderNight();
  }

  private addLog(ch: LogCh, from: number, text: string) {
    const who = from >= 0 ? this.name(from) : '';
    let el: HTMLElement;
    if (ch === 'event') { el = h('div.gl-event', text); if (/사라졌|처형/.test(text)) sfx('death'); }
    else if (ch === 'secret') { el = h('div.gl-secret', '🔒 ', text); sfx('secret'); }
    else if (ch === 'note') { el = h('div.gl-note', '✉ 익명 쪽지: ', text); sfx('note'); }
    else if (ch === 'sys') el = h('div.gl-sys', text);
    else el = h(`div.gl-chat.ch-${ch}${from === this.myPid ? '.mine' : ''}`, ch !== 'day' ? h('span.gl-ch', CH_LABEL[ch]) : '', h('b', who), ' ', text);
    this.log.appendChild(el);
    this.log.scrollTop = this.log.scrollHeight;
    this.corridor?.toast(ch, who, text);
    if (ch === 'dead' && from >= 0) this.farm?.say(from, text);
    if ((ch === 'day' || ch === 'defense') && from >= 0) this.scene.say(from, text);
    this.nightLog(ch, who, text);
  }

  // ── 위쪽 ────────────────────────────────────────

  private renderTop() {
    const v = this.v!;
    const phaseName: Record<string, string> = {
      intro: '게임 시작', night: `밤 · ${STEP_NAMES[v.step] ?? ''}`, morning: '아침', day: '낮 토론', vote1: '1차 투표', defense: '결선 변론', vote2: '결선 투표', verdict: '판결', end: '게임 끝',
    };
    const role = v.me.role;
    const EN: Record<string, string> = {
      intro: 'GAME START', night: 'NIGHT', morning: 'MORNING', day: 'DISCUSSION', vote1: 'VOTE', defense: 'FINAL DEFENSE', vote2: 'FINAL VOTE', verdict: 'VERDICT', end: 'GAME OVER',
    };
    const myImg = roleImg(role);
    clear(this.top).append(
      h('div.phase-title',
        v.phase === 'night'
          ? h('div.pt-day', String(v.night).padStart(2, '0'), h('small', 'NIGHT'))
          : h('div.pt-day', String(Math.max(1, v.day)).padStart(2, '0'), h('small', 'DAY')),
        h('div.pt-main', h('b', phaseName[v.phase]), h('small', EN[v.phase] ?? ''), this.timerEl)),
      h('div.spacer'),
      h(`button.me-chip.${ROLES[role as RoleId]?.team ?? ''}`, { onclick: () => this.showRoleCard() },
        myImg ? h('img.mc-img', { src: myImg, alt: '' }) : '',
        h('div.mc-text', h('small', v.me.alive ? this.name(this.myPid) : `${this.name(this.myPid)} · 사망`), h('b', roleName(role as RoleId)))),
    );
    this.renderTimer();
  }

  private renderTimer() {
    if (!this.v) return;
    this.el.classList.toggle('in-corridor', !!this.corridor);
    const l = this.left();
    this.timerEl.replaceChildren(h('span', this.v.phase === 'end' ? '' : `${l}s`), h('i'));
    this.timerEl.classList.toggle('empty', this.v.phase === 'end');
    this.timerEl.classList.toggle('urgent', l <= 5);
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
      if (v.me.mates.includes(p.pid)) tags.push(h('span.tag.mafia', '동료'));
      if (m) tags.push(h(`span.tag.memo.m${m}`, MEMO[m]));
      if (!p.online && p.alive) tags.push(h('span.tag', '연결 끊김'));
      const cnt = v.counts?.find(([pid]) => pid === p.pid)?.[1];
      if (cnt !== undefined && (v.phase === 'defense' || v.phase === 'vote2' || v.phase === 'verdict')) tags.push(h('span.tag.info', `${cnt}표`));
      if (v.cands.includes(p.pid) && (v.phase === 'defense' || v.phase === 'vote2')) tags.push(h('span.tag.mafia', '결선'));
      this.plist.appendChild(h(`button.g-p${p.alive ? '' : '.dead'}${p.pid === this.myPid ? '.self' : ''}`,
        { onclick: () => { if (p.pid === this.myPid) return; this.memo.set(p.pid, (m + 1) % MEMO.length); this.renderPlayers(); } },
        h('img.g-anon', { src: p.pid === this.myPid ? roleImg(v.me.role) ?? ANON : maskImg(p.pid), alt: '' }),
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
    const key = JSON.stringify([v.phase, v.step, me.vote, me.prompt?.key, me.notesLeft, me.alive, v.cands, me.canVote, me.proxyFor, me.silenced]);
    if (key === this.lastKey) return;
    this.lastKey = key;
    clear(this.panel);
    const head = (t: string, s?: string) => this.panel.append(h('div.ph-head', h('div.ph-title', t), s ? h('div.ph-sub', s) : ''));
    const people = (ids: number[], on: (pid: number) => void, selected?: number | null) =>
      h('div.pbtns', ids.map((id) => h(`button.pbtn${selected === id ? '.sel' : ''}`, { onclick: () => on(id) }, this.name(id))));

    if (me.prompt) {
      const pr = me.prompt;
      head('⚡ 선택', pr.text);
      const label = (o: number | string) => typeof o === 'number' ? this.name(o) : ({ mafia: '마피아 팀', citizen: '시민 팀', yes: '뒤집는다', no: '그대로 둔다' } as Record<string, string>)[o] ?? o;
      this.panel.append(h('div.pbtns', pr.options.map((o) => h('button.pbtn', { onclick: () => { sfx('click'); this.link.send({ t: 'choice', key: pr.key, value: o }); } }, label(o)))));
      if (pr.key === 'agitate' || pr.key === 'avenge') this.panel.append(h('button.btn.wide', { onclick: () => this.link.send({ t: 'choice', key: pr.key, value: null }) }, '쓰지 않는다'));
      return;
    }
    if (!me.alive) { head('👻 관전 중', '죽은 사람끼리 채팅할 수 있어요. 밤에는 주말농장에서 다른 죽은 사람들, 그리고 이드를 만나요. 니펠의 밤 대화도 엿들을 수 있어요.'); return; }
    switch (v.phase) {
      case 'intro': head('게임 시작!', '직업을 확인하세요. 곧 첫 밤이 찾아옵니다.'); break;
      case 'night': head('🌙 밤', '자기 방에 있어요.'); break;
      case 'morning': head('☀ 아침', '어젯밤 일이 발표됩니다.'); break;
      case 'day': {
        head('☀ 낮 — 토론', '채팅으로 토론하세요. 왼쪽 목록을 눌러 메모를 남길 수 있어요.');
        if (me.notesLeft > 0) this.panel.append(h('button.btn.wide', { onclick: () => this.noteForm() }, `✉ 익명 쪽지 보내기 (${me.notesLeft})`));
        break;
      }
      case 'vote1': {
        head('🗳 1차 투표', '가장 많이 표를 받은 두 명이 결선에 오릅니다.');
        const ids = v.players.filter((p) => p.alive && p.pid !== this.myPid).map((p) => p.pid);
        this.panel.append(people(ids, (id) => { sfx('vote'); this.link.send({ t: 'vote', target: id }); }, me.vote));
        this.panel.append(h(`button.btn.wide${me.vote === null ? '.sel' : ''}`, { onclick: () => this.link.send({ t: 'vote', target: null }) }, '기권'));
        if (me.vote !== undefined) this.panel.append(h('div.ph-sub', `투표함: ${me.vote === null ? '기권' : this.name(me.vote)} (바꿀 수 있어요)`));
        break;
      }
      case 'defense':
        if (me.silenced) head('🤐 입이 막혔다', '누군가 당신의 목소리를 훔쳤어요. 이번 변론에서는 말할 수 없어요.');
        else if (me.proxyFor !== undefined) head('🗣 선동 중', `지금 채팅은 ${this.name(me.proxyFor)}의 이름으로 나갑니다.`);
        else head('⚖ 결선 변론', v.cands.includes(this.myPid) ? '당신이 결선에 올랐어요! 45초 동안 변론하세요.' : `${v.cands.map(this.name).join(' vs ')} — 변론을 들어 보세요.`);
        break;
      case 'vote2': {
        if (!me.canVote) { head('🗳 결선 투표', '다른 사람들이 투표하고 있어요.'); break; }
        head('🗳 결선 투표', v.cands.length === 2 ? '둘 중 한 명을 고르세요. 동표면 처형 없이 밤.' : `${this.name(v.cands[0])}를 처형할까요?`);
        if (v.cands.length === 2) this.panel.append(people(v.cands, (id) => { sfx('vote'); this.link.send({ t: 'vote', target: id }); }, me.vote));
        else this.panel.append(h('div.bigbtns',
          h(`button.btn.big.mafia${me.vote === v.cands[0] ? '.sel' : ''}`, { onclick: () => this.link.send({ t: 'vote', target: v.cands[0] }) }, '처형'),
          h(`button.btn.big${me.vote === null ? '.sel' : ''}`, { onclick: () => this.link.send({ t: 'vote', target: null }) }, '반대')));
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
    if (this.v?.phase !== 'night') return;
    if (ch === 'secret' || ch === 'event' || ch === 'nifel' || ch === 'dead') {
      this.nightLogEl.appendChild(h(`div.nl.${ch}`, who ? h('b', who + ' ') : '', text));
      this.nightLogEl.scrollTop = this.nightLogEl.scrollHeight;
    }
  }

  private renderNight() {
    const v = this.v!;
    const farm = !!v.me.farm;
    const night = v.phase === 'night' && (v.me.alive || farm);
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
      : `${STEP_NAMES[v.step]} 차례 — 누군가 움직이고 있다…`;
    clear(this.nightEl).append(
      h('div.n-room', { style: `--room-bg: ${bgUrl('night_room.webp')}` },
        h('div.n-me', img ? h('img', { src: img, alt: '' }) : h('div.n-sil', '?')),
        h('div.n-door', myTurn ? h('button.btn.gold.big', { onclick: () => this.goCorridor() }, '🚪 문 열고 나가기') : act?.locked ? h('div.n-door-shut', '🔒 문이 잠겼다') : '')),
      h('div.n-side',
        h('div.n-title', `🌙 ${v.night}번째 밤`, h('span.n-timer', `${this.left()}초`)),
        h('div.n-step', STEP_NAMES.slice(1).map((s, i) => h(`span${v.step === i + 1 ? '.on' : ''}`, s))),
        h('div.n-status', status),
        act && act.optional && myTurn ? h('button.btn.small', { onclick: () => this.link.send({ t: 'act', target: null }) }, '오늘은 쓰지 않기') : '',
        v.me.drone ? h('div.n-drone', `🛸 드론 ${v.me.drone.count}/3 · 투표권 ${1 + v.me.drone.count}`,
          v.me.drone.tries > 0 && v.me.drone.count < 3 ? h('button.btn.small.gold', { onclick: () => { sfx('click'); this.link.send({ t: 'drone' }); } }, `🔧 조립하기 (남은 기회 ${v.me.drone.tries})`) : h('span.dim', ' 오늘 밤 조립 끝')) : '',
        this.nightLogEl,
        v.me.chats.length ? h('div.n-chat', h('span', CH_LABEL[v.me.chats[0]]), this.nightChatInput()) : '',
        h('div.n-mini', h('span', '기다리는 동안:'),
          h('button.btn.small', { onclick: () => playCatch(this.root, roleChar(v.me.role) ?? 'nifel', () => {}) }, '🍞 빵 받기'),
          h('button.btn.small', { onclick: () => playMatch(this.root, () => {}) }, '🃏 짝 맞추기'))),
    );
  }

  /** 밤의 주말농장 (이드 + 죽은 사람) */
  private renderFarm(v: GameView) {
    if (this.farm) { this.farm.sync(v); return; }
    this.corridor?.destroy(); this.corridor = null;
    // 정체 보호: 나는 내 직업 캐릭터, 이드(와 이드로 변장한 스피키)는 이드, 나머지는 공용 모습.
    // 남의 직업은 서버가 아예 보내지 않으므로 화면 오류로 드러날 일은 없다.
    const myImg = roleImg(v.me.role) ?? ANON;
    const ideImg = roleImg('medium') ?? ANON;
    const img = (pid: number, ide: boolean) => (pid === this.myPid ? myImg : ide ? ideImg : maskImg(pid));
    const area = h('div.farm-area');
    const me = v.players.find((p) => p.pid === this.myPid);
    clear(this.nightEl).append(area,
      h('div.n-side',
        h('div.n-title', `🌾 주말농장 · ${v.night}번째 밤`, h('span.n-timer', `${this.left()}초`)),
        h('div.n-status', me?.alive
          ? '이드는 밤마다 주말농장에서 사라진 사람들을 만나요. 니펠의 대화는 들을 수 없지만, 죽은 사람들이 전해 줄 수 있어요.'
          : '죽은 사람들이 모이는 주말농장이에요. 니펠의 밤 대화를 엿들을 수 있어요. 이드가 오면 전해 줄 수도, 속일 수도 있어요.'),
        this.nightLogEl,
        v.me.chats.length ? h('div.n-chat', h('span', '농장'), this.nightChatInput()) : '',
        h('div.n-mini', h('span', '심심하면:'),
          h('button.btn.small', { onclick: () => playCatch(this.root, (roleChar(v.me.role) ?? 'nifel') as never, () => {}) }, '🍞 빵 받기'),
          h('button.btn.small', { onclick: () => playMatch(this.root, () => {}) }, '🃏 짝 맞추기'))));
    this.farm = new Farm(area, v, this.myPid, this.name, img, (x, y) => this.link.send({ t: 'fmove', x, y }));
  }

  private nightChatInput() {
    const inp = h('input.chat-in', { placeholder: '밤 채팅', maxLength: 120 }) as HTMLInputElement;
    inp.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' || !inp.value.trim()) return;
      this.link.send({ t: 'gchat', text: inp.value.trim(), ch: this.v!.me.chats[0] });
      inp.value = '';
    });
    return inp;
  }

  private goCorridor() {
    sfx('open');
    const v = this.v!;
    this.corridor = new Corridor(this.nightEl, v, this.myPid, roleImg(v.me.role), this.name, (target) => {
      this.link.send({ t: 'act', target });
      sfx('click');
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
        h('div.rc-team', { mafia: '마피아 팀', citizen: '시민 팀', neutral: '중립' }[def.team]),
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

  private showEnd(winner: string, roles: { pid: number; role: string; alive: boolean }[], winners: number[]) {
    const won = winners.includes(this.myPid);
    sfx(won ? 'win' : 'lose');
    const T: Record<string, [string, string, string]> = {
      mafia: ['마피아 팀 승리', 'MAFIA WINS', 'hall_night.webp'],
      citizen: ['시민 팀 승리', 'CITIZENS WIN', 'hall_day.webp'],
      jester: ['코미 승리', 'JESTER WINS', 'end_comi.webp'],
      elena: ['엘레나 승리', 'DRONE QUEEN', 'end_elena.webp'],
      draw: ['무승부', 'DRAW', 'hall_day.webp'],
    };
    const [title, en, bg] = T[winner] ?? T.draw;
    const champs = roles.filter((r) => winners.includes(r.pid));
    const others = roles.filter((r) => !winners.includes(r.pid));
    // 단체 사진: 가운데가 앞·크게, 바깥으로 갈수록 뒤로
    const photo = h('div.end-photo');
    champs.forEach((r, i) => {
      const n = champs.length;
      const off = i - (n - 1) / 2;
      const img = roleImg(r.role);
      photo.appendChild(h(`div.end-champ${r.pid === this.myPid ? '.me' : ''}`, { style: `--x:${off}; --ax:${Math.abs(off)}; --i:${i}; z-index:${20 - Math.round(Math.abs(off) * 2)}` },
        img ? h('img', { src: img, alt: '' }) : h('div.n-sil', '?'),
        h('div.end-label', h('b', roleName(r.role as RoleId)), h('small', this.name(r.pid)))));
    });
    // 진 사람들은 구석에서 시무룩
    const losers = h('div.end-losers', others.map((r, i) => {
      const img = roleImg(r.role);
      return h('div.end-loser', { style: `--i:${i}` }, img ? h('img', { src: img, alt: '' }) : '', h('small', roleName(r.role as RoleId)));
    }));
    // 정체 공개표: 케이크 가면이 하나씩 벗겨진다
    const list = h('div.end-list', h('div.end-list-head', h('span', 'UNMASKED'), h('b', '모두의 정체')),
      ...roles.map((r, i) => {
        const img = roleImg(r.role);
        const team = ROLES[r.role as RoleId]?.team ?? '';
        return h(`div.end-row.${team}${r.pid === this.myPid ? '.self' : ''}${winners.includes(r.pid) ? '.won' : ''}`, { style: `--i:${i}` },
          h('div.end-face', h('img.mask', { src: maskImg(r.pid), alt: '' }), img ? h('img.real', { src: img, alt: '' }) : ''),
          h('div.end-who', h('b', this.name(r.pid)), h('small', `${roleName(r.role as RoleId)} · ${ROLES[r.role as RoleId]?.job ?? ''}`)),
          h('div.end-state', r.alive ? '생존' : '사망', winners.includes(r.pid) ? h('i', 'WIN') : ''));
      }));
    const ov = h(`div.end-screen.w-${winner}`, { style: `--bg: ${bgUrl(bg)}` },
      h('div.end-bg'),
      h('div.end-title', h('small', en), h('b', title), h(`div.end-me.${won ? 'win' : 'lose'}`, won ? '승리!' : '패배…')),
      photo, losers, list,
      h('div.end-foot', h('span', '15초 뒤 대기실로 돌아갑니다'), h('button.btn.small', { onclick: () => ov.remove() }, '닫기')));
    this.el.appendChild(ov);
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
    this.world.style.setProperty('--cw-bg', bgUrl('corridor.webp'));
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
    this.world.append(h('div.cw-dust'));
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
      h('div', isTouch() ? '방향패드로 이동 · 문 앞에서 버튼' : 'WASD/방향키로 이동 · 문 앞에서 E 또는 스페이스'),
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
  private avs = new Map<number, { el: HTMLElement; bubble: HTMLElement; x: number; y: number; tx: number; ty: number; timer: number }>();
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
        const dx = a.tx - a.x, dy = a.ty - a.y;
        const k = Math.min(1, dt * 12);
        a.x += dx * k; a.y += dy * k;
        if (Math.abs(dx) > 0.5) a.el.classList.toggle('flip', dx > 0);
        a.el.classList.toggle('moving', Math.hypot(dx, dy) > 2);
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
