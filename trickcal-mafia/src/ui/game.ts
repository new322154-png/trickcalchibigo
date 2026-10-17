/**
 * 마피아 본게임 화면 (대기실 위에 덮어서 띄운다).
 *  낮: 채팅 · 투표 · 익명 쪽지 · 메모
 *  밤: 내 방(혼자 미니게임) → 내 차례에 문을 열고 복도로 → 대상의 방 문 앞에서 능력 사용
 */
import { ROLES, roleName, type RoleId } from '../../shared/roles';
import { CHARACTERS, type ChatCh, type GameView, type LogCh, type S2C } from '../../shared/protocol';
import { playCatch } from '../mini/catch';
import { playMatch } from '../mini/match';
import type { RoomLink } from '../net';
import { clear, h } from './dom';
import { MoveInput, isTouch } from './input';
import { sfx } from './sfx';

const CW = 1600, CH = 900;
const STEP_NAMES = ['', '① 뮤트 · 스피키', '② 니펠', '③ 그 밖의 능력'];
const ACT_LABEL: Record<string, string> = {
  kill: '습격', seal: '해킹', disguise: '변장', protect: '지키기', investigate: '조사', track: '지켜보기', reveal: '직업 공개', identify: '직업 알아내기', revive: '소원 빌기',
};
const CH_LABEL: Record<ChatCh, string> = { day: '전체', nifel: '니펠', dead: '죽은 사람', defense: '변론' };
const MEMO = ['', '의심', '마피아?', '시민?', '확정 시민', '확정 마피아'];

/** 직업 캐릭터 (assets/chars/<id>.png) */
function roleChar(role: string) {
  const name = ROLES[role as RoleId]?.char;
  return CHARACTERS.find((x) => x.name === name)?.id ?? null;
}
function roleImg(role: string): string | null {
  const c = roleChar(role);
  return c ? `./assets/chars/${c}.png` : null;
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
  private lastKey = '';

  constructor(private root: HTMLElement, public link: RoomLink, private myPid: number) {
    this.chatIn.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); this.sendChat(); } });
    this.el = h('div.game-screen',
      this.top,
      h('div.g-cols',
        this.plist,
        h('div.g-center', this.log, this.chatRow),
        this.panel),
      this.nightEl);
    root.appendChild(this.el);
    this.tick = window.setInterval(() => this.renderTimer(), 250);
  }

  destroy() {
    clearInterval(this.tick);
    this.corridor?.destroy();
    this.el.remove();
  }

  name = (pid: number) => (pid < 0 ? '저택' : this.v?.players.find((p) => p.pid === pid)?.name ?? '?');
  private left() { return this.v ? Math.max(0, Math.ceil((this.v.endsAt - (Date.now() + this.skew)) / 1000)) : 0; }

  // ── 서버 메시지 ──────────────────────────────────

  onMsg(m: S2C) {
    if (m.t === 'g') this.update(m.v);
    else if (m.t === 'glog') this.addLog(m.ch, m.from, m.text);
    else if (m.t === 'gcmove') this.corridor?.mate(m.pid, m.x, m.y);
    else if (m.t === 'gend') this.showEnd(m.winner, m.roles, m.winners);
  }

  private update(v: GameView) {
    const first = !this.v;
    const prevPhase = this.v?.phase, prevStep = this.v?.step;
    this.skew = v.now - Date.now();
    this.v = v;
    if (first) this.showRoleCard();
    if (prevPhase !== v.phase || prevStep !== v.step) {
      if (v.phase === 'night' && prevPhase !== 'night') sfx('night');
      if (v.phase === 'morning') sfx('morning');
      if (v.phase === 'vote1' || v.phase === 'vote2') sfx('gavel');
    }
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
    this.nightLog(ch, who, text);
  }

  // ── 위쪽 ────────────────────────────────────────

  private renderTop() {
    const v = this.v!;
    const phaseName: Record<string, string> = {
      intro: '게임 시작', night: `밤 · ${STEP_NAMES[v.step] ?? ''}`, morning: '아침', day: '낮 토론', vote1: '1차 투표', defense: '결선 변론', vote2: '결선 투표', verdict: '판결', end: '게임 끝',
    };
    const role = v.me.role;
    clear(this.top).append(
      h(`div.phase-pill.${v.phase === 'night' ? 'night' : 'day'}`, phaseName[v.phase]),
      h('div.day-label', v.day ? `${v.day}일째` : ''),
      this.timerEl,
      h('div.spacer'),
      h(`button.me-chip.${ROLES[role as RoleId]?.team ?? ''}`, { onclick: () => this.showRoleCard() }, `나: ${this.name(this.myPid)} · ${roleName(role as RoleId)}`, v.me.alive ? '' : h('small', ' (사망)')),
    );
    this.renderTimer();
  }

  private renderTimer() {
    if (!this.v) return;
    const l = this.left();
    this.timerEl.textContent = this.v.phase === 'end' ? '' : `⏱ ${l}초`;
    this.timerEl.classList.toggle('urgent', l <= 5);
    const nt = this.nightEl.querySelector('.n-timer');
    if (nt) nt.textContent = `${l}초`;
    this.corridor?.timer(l);
  }

  // ── 플레이어 목록 · 메모 ─────────────────────────

  private renderPlayers() {
    const v = this.v!;
    clear(this.plist).append(h('div.g-title', '플레이어 (눌러서 메모)'));
    for (const p of v.players) {
      const m = this.memo.get(p.pid) ?? 0;
      const tags: (HTMLElement | string)[] = [];
      if (p.pid === this.myPid) tags.push(h('span.tag.me', '나'));
      if (v.me.mates.includes(p.pid)) tags.push(h('span.tag.mafia', '동료'));
      if (m) tags.push(h(`span.tag.memo.m${m}`, MEMO[m]));
      if (!p.online && p.alive) tags.push(h('span.tag', '연결 끊김'));
      const cnt = v.counts?.find(([pid]) => pid === p.pid)?.[1];
      if (cnt !== undefined && (v.phase === 'defense' || v.phase === 'vote2' || v.phase === 'verdict')) tags.push(h('span.tag.info', `${cnt}표`));
      if (v.cands.includes(p.pid) && (v.phase === 'defense' || v.phase === 'vote2')) tags.push(h('span.tag.mafia', '결선'));
      this.plist.appendChild(h(`button.g-p${p.alive ? '' : '.dead'}${p.pid === this.myPid ? '.self' : ''}`,
        { onclick: () => { if (p.pid === this.myPid) return; this.memo.set(p.pid, (m + 1) % MEMO.length); this.renderPlayers(); } },
        h('div.g-pname', p.name, p.alive ? '' : h('span.dead-mark', ' 사망')), h('div.ptags', tags)));
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
    if (!me.alive) { head('👻 관전 중', '죽은 사람끼리 채팅할 수 있고, 밤에는 니펠의 대화를 엿볼 수 있어요. 캐시는 밤에 죽은 사람과 대화해요.'); return; }
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
    const night = v.phase === 'night' && v.me.alive;
    this.nightEl.classList.toggle('hidden', !night);
    if (!night) { this.corridor?.destroy(); this.corridor = null; clear(this.nightEl); this.nightLogEl = h('div.n-log'); return; }
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
      h('div.n-room',
        h('div.n-window'), h('div.n-bed'),
        h('div.n-me', img ? h('img', { src: img, alt: '' }) : h('div.n-sil', '?')),
        h('div.n-door', myTurn ? h('button.btn.gold.big', { onclick: () => this.goCorridor() }, '🚪 문 열고 나가기') : h('div.n-door-shut', act?.locked ? '🔒' : ''))),
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
    const title = ({ mafia: '마피아 팀 승리', citizen: '시민 팀 승리', jester: '코미 승리', elena: '엘레나 승리', draw: '무승부' } as Record<string, string>)[winner];
    const ov = h('div.overlay',
      h('div.card.result',
        h(`div.res-big.${won ? 'win' : 'lose'}`, won ? '승리!' : '패배…'),
        h('div.res-title', title),
        h('table.res-table', roles.map((r) => h(`tr.${ROLES[r.role as RoleId]?.team ?? ''}${r.pid === this.myPid ? '.self' : ''}`,
          h('td', this.name(r.pid)),
          h('td', h('b', roleName(r.role as RoleId)), h('small', ` ${ROLES[r.role as RoleId]?.job ?? ''}`)),
          h('td', r.alive ? '생존' : '사망'),
          h('td', winners.includes(r.pid) ? '🏆' : '')))),
        h('p.hint', '15초 뒤 대기실로 돌아갑니다.'),
        h('button.btn.wide', { onclick: () => ov.remove() }, '닫기')));
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
  private onKey = (e: KeyboardEvent) => {
    if ((e.key === 'e' || e.key === 'E' || e.key === ' ' || e.key === 'Enter') && this.near !== null && (e.target as HTMLElement)?.tagName !== 'INPUT') { e.preventDefault(); this.use(); }
  };

  constructor(host: HTMLElement, private v: GameView, private myPid: number, img: string | null, private name: (p: number) => string,
    private onAct: (target: number | null) => void, private onMove: (x: number, y: number) => void, private onExit: () => void) {
    // 복도 배치: 위·아래 벽에 문
    const ids = v.players.map((p) => p.pid);
    const half = Math.ceil(ids.length / 2);
    ids.forEach((pid, i) => {
      const top = i < half;
      const k = top ? i : i - half;
      const n = top ? half : ids.length - half;
      const x = 160 + ((CW - 320) * (k + 0.5)) / n;
      const y = top ? 250 : 700;
      const p = v.players.find((q) => q.pid === pid)!;
      const el = h(`div.c-door${top ? '.top' : '.bottom'}${p.alive ? '' : '.dead'}${pid === myPid ? '.mine' : ''}`, { style: { left: x + 'px', top: y + 'px' } },
        h('div.c-plate', pid === myPid ? '내 방' : p.name), h('div.c-leaf'));
      this.world.appendChild(el);
      this.doors.push({ pid, x, y: top ? y + 70 : y - 70, el });
    });
    this.me = h('div.ch.me', h('div.ch-body', img ? h('img', { src: img, alt: '' }) : h('div.n-sil', '?')), h('div.ch-shadow'), h('div.ch-name', '나'));
    this.world.appendChild(this.me);
    this.wrap = h('div.corridor',
      h('div.cw-wrap', this.world),
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
    this.y = Math.max(330, Math.min(640, this.y + d.y * 420 * dt));
    if (d.x) this.me.classList.toggle('flip', d.x < 0);
    this.me.classList.toggle('moving', d.x !== 0 || d.y !== 0);
    this.me.style.transform = `translate(${this.x}px, ${this.y}px)`;
    if (t - this.lastSent > 120 && this.v.me.act?.kind === 'kill') { this.onMove(Math.round(this.x), Math.round(this.y)); this.lastSent = t; }
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
    // 화면 맞추기
    const w = this.wrap.querySelector('.cw-wrap') as HTMLElement;
    const k = Math.min(w.clientWidth / CW, w.clientHeight / CH);
    this.world.style.transform = `translate(-50%, -50%) scale(${k})`;
  };

  destroy() {
    cancelAnimationFrame(this.raf);
    this.input.destroy();
    window.removeEventListener('keydown', this.onKey);
    this.wrap.remove();
  }
}
