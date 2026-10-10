/**
 * 봇전 게임 화면. 왼쪽 플레이어 목록 · 가운데 기록(증언판) · 오른쪽 행동 패널.
 * HumanIO 를 구현해서, 게임이 플레이어에게 무언가를 물으면 오른쪽 패널에 선택지를 띄운다.
 */
import { ROLES, roleName, type RoleId } from '../data/roles';
import { Game, nightTitle, type HumanIO, type NightChoice } from '../engine/game';
import { clueText, factsOf } from '../engine/logic';
import type { Clue, LogEntry, Side, StmtInput, VoteRecord } from '../engine/types';
import { clear, h, setCompact, sleep } from './dom';
import { sfx } from './sfx';
import type { LobbySettings } from './title';

const HUES = [0, 30, 55, 95, 150, 185, 210, 235, 265, 290, 320, 345];

export class GameUI implements HumanIO {
  game!: Game;
  root: HTMLElement;
  private plist = h('div.plist');
  private feed = h('div.feed');
  private panel = h('div.panel');
  private phaseEl = h('div.phase-pill');
  private dayEl = h('div.day-label');
  private meEl = h('button.me-chip');
  private quotaEl = h('div.quota');
  private fast = false;
  private dayResolve: (() => void) | null = null;
  private pickMode: { picked: number[]; onDone: (ids: number[]) => void } | null = null;
  private isNight = true;
  private pendingNote: Clue | null = null;

  constructor(host: HTMLElement, private settings: LobbySettings, private onExit: (again: boolean) => void) {
    const speedBtn = h('button.btn.small', { onclick: () => { this.fast = !this.fast; speedBtn.textContent = this.fast ? '빠르게 ▶▶' : '보통 속도 ▶'; } }, '보통 속도 ▶');
    this.root = h('div.game',
      h('div.topbar', this.phaseEl, this.dayEl, this.meEl, this.quotaEl, h('div.spacer'), speedBtn,
        h('button.btn.small', { onclick: () => { if (confirm('게임을 그만두고 타이틀로 돌아갈까요?')) this.onExit(false); } }, '나가기')),
      h('div.cols', this.plist, this.feed, this.panel),
    );
    clear(host).appendChild(this.root);
    setCompact(true);
    this.meEl.onclick = () => this.showRoleCard(false);
  }

  async start() {
    this.game = new Game({ count: this.settings.count, difficulty: this.settings.difficulty, humans: 1, forceRole: this.settings.forceRole }, this);
    this.update();
    await this.showRoleCard(true);
    await this.game.run();
  }

  // ── 상태 표시 ────────────────────────────────────

  private get me() { return this.game.human!; }

  update() {
    const g = this.game;
    if (!g) return;
    const me = this.me;
    this.meEl.replaceChildren(h('span.avatar.sm', { style: avatarStyle(me.id) }, me.name.slice(-1)), `${me.name} · ${roleName(me.role)}`, h('small', me.alive ? '' : ' (사망)'));
    this.meEl.className = `me-chip ${teamOf(me.role)}`;
    this.dayEl.textContent = g.day ? `${g.day}일째` : '';
    this.phaseEl.textContent = this.isNight ? '밤' : g.over ? '종료' : '낮';
    this.phaseEl.className = `phase-pill ${this.isNight ? 'night' : 'day'}`;
    this.root.classList.toggle('night', this.isNight);
    this.quotaEl.textContent = this.dayResolve ? `심문 ${g.quota.ask} · 쪽지 ${g.quota.note} · 지목 ${g.quota.contra} · 주장 ${g.quota.claim}` : '';
    const mates = g.mafiaMatesOf(me);
    clear(this.plist);
    for (const p of g.players) {
      const claim = lastClaim(g, p.id);
      const tags: (HTMLElement | string)[] = [];
      if (p.id === me.id) tags.push(h('span.tag.me', '나'));
      if (mates.includes(p.id)) tags.push(h('span.tag.mafia', g.isKiller(p) ? '니펠' : '동료'));
      const mark = g.marks.get(p.id);
      if (mark) tags.push(h(`span.tag.${mark.includes('마피아') || mark.includes('니펠') ? 'mafia' : 'info'}`, mark));
      if (p.revealed) tags.push(h('span.tag.reveal', `정체: ${roleName(p.role)}`));
      if (claim) tags.push(h('span.tag.claim', `주장: ${roleName(claim)}`));
      const row = h(`div.prow${p.alive ? '' : '.dead'}${p.id === me.id ? '.self' : ''}`,
        h('span.avatar', { style: avatarStyle(p.id) }, p.name.slice(-1)),
        h('div.pinfo', h('div.pname', p.name, p.alive ? '' : h('span.dead-mark', ' 사망')), h('div.ptags', tags)),
      );
      this.plist.appendChild(row);
    }
  }

  log(e: LogEntry) {
    const g = this.game;
    if (e.privateTo !== undefined && e.privateTo !== g?.human?.id) return;
    let el: HTMLElement;
    const sp = e.speaker !== undefined && e.speaker >= 0 ? g.players[e.speaker] : null;
    switch (e.kind) {
      case 'phase':
        el = h('div.f-phase', h('span', e.text));
        if (/밤/.test(e.text)) { this.isNight = true; sfx('night'); }
        else if (/아침/.test(e.text)) { this.isNight = false; sfx('morning'); }
        else sfx('gavel');
        this.update();
        break;
      case 'say':
        el = h(`div.f-say${sp?.id === g.human?.id ? '.mine' : ''}`,
          h('span.avatar.sm', { style: avatarStyle(sp?.id ?? 0) }, sp?.name.slice(-1) ?? '?'),
          h('div.bubble', h('div.who', sp?.name ?? ''), h('div.txt', e.text)));
        break;
      case 'note':
        el = h('div.f-note', e.text);
        sfx('note');
        break;
      case 'secret':
        el = h('div.f-secret', h('span.lock', '🔒'), e.text);
        sfx('secret');
        break;
      case 'vote':
        el = h('div.f-vote', e.text);
        sfx('vote');
        break;
      case 'death':
        el = h('div.f-death', e.text);
        sfx('death');
        if (g.human && !g.human.alive) setTimeout(() => this.spectate(), 0);
        break;
      case 'win':
        el = h('div.f-win', e.text);
        break;
      default:
        el = h('div.f-system', e.text);
        if (e.speaker === -1 && e.stmtId) el.classList.add('fact');
    }
    if (e.stmtId) {
      el.dataset.stmt = String(e.stmtId);
      const s = g.board.find((x) => x.id === e.stmtId);
      if (s && s.kind === 'contra') { el.classList.add(s.valid ? 'contra-ok' : 'contra-bad'); sfx('contra'); }
      el.addEventListener('click', () => this.onStmtClick(e.stmtId!, el));
    }
    this.feed.appendChild(el);
    this.feed.scrollTop = this.feed.scrollHeight;
    if (e.kind === 'say' || e.kind === 'death' || e.kind === 'vote') this.update();
  }

  async pause(ms: number) {
    await sleep(this.fast ? ms * 0.3 : ms);
  }

  // ── 패널 도우미 ──────────────────────────────────

  private ask<T>(build: (done: (v: T) => void) => (HTMLElement | string)[]): Promise<T> {
    return new Promise<T>((resolve) => {
      const done = (v: T) => { sfx('click'); clear(this.panel); resolve(v); };
      clear(this.panel).append(...build(done));
    });
  }

  private peopleButtons(ids: number[], onPick: (id: number) => void, opts: { danger?: boolean } = {}) {
    return h('div.pbtns', ids.map((id) => {
      const p = this.game.players[id];
      return h(`button.pbtn${opts.danger ? '.danger' : ''}${p.alive ? '' : '.deadp'}`, { onclick: () => onPick(id) },
        h('span.avatar.sm', { style: avatarStyle(id) }, p.name.slice(-1)), p.name, id === this.me.id ? ' (나)' : '');
    }));
  }

  private head(title: string, sub?: string) {
    return h('div.ph-head', h('div.ph-title', title), sub ? h('div.ph-sub', sub) : '');
  }

  // ── HumanIO: 밤 ──────────────────────────────────

  night(c: NightChoice): Promise<number | null> {
    const def = ROLES[this.me.role];
    const sub = c.kind === 'kill' ? '니펠끼리 표가 가장 많은 사람을 습격합니다. 동률이면 당신의 선택을 따릅니다.' : c.kind === 'contact' ? '고른 사람이 니펠이면 접선에 성공합니다.' : def.desc;
    return this.ask<number | null>((done) => [
      this.head(`🌙 ${nightTitle(c.kind)}`, sub),
      this.peopleButtons(c.targets, (id) => done(id), { danger: c.kind === 'kill' }),
      h('button.btn.wide', { onclick: () => done(null) }, c.kind === 'kill' ? '다른 니펠에게 맡기기' : '오늘 밤은 쉬기'),
    ]);
  }

  batChoose(): Promise<Side> {
    return this.ask<Side>((done) => [
      this.head('🦇 진영을 고를 시간!', '네르가 분노하며 변신한다! 어느 편에 설까?'),
      h('div.bigbtns',
        h('button.btn.big.mafia', { onclick: () => done('mafia') }, '마피아 팀'),
        h('button.btn.big.citizen', { onclick: () => done('citizen') }, '시민 팀')),
    ]);
  }

  async gotMansionNote(clue: Clue) {
    this.pendingNote = clue;
  }

  // ── HumanIO: 낮 ──────────────────────────────────

  day(): Promise<void> {
    return new Promise<void>((resolve) => {
      this.dayResolve = () => { this.dayResolve = null; this.exitPick(); clear(this.panel); this.update(); resolve(); };
      this.update();
      this.dayMenu();
    });
  }

  private dayMenu() {
    const g = this.game;
    const q = g.quota;
    const items: HTMLElement[] = [];
    if (this.pendingNote && !g.notePublished) {
      items.push(h('button.act.gold', { onclick: () => this.noteForm() }, h('b', '🔏 받은 저택 쪽지'), h('small', '공개 · 위조 · 숨기기')));
    }
    items.push(
      h(`button.act${q.claim ? '' : '.off'}`, { onclick: () => q.claim && this.claimMenu() }, h('b', '📢 주장하기'), h('small', `직업·조사 결과·의심 (${q.claim})`)),
      h(`button.act${q.ask ? '' : '.off'}`, { onclick: () => q.ask && this.askForm() }, h('b', '❓ 심문하기'), h('small', `한 명에게 질문 (${q.ask})`)),
      h(`button.act${q.note ? '' : '.off'}`, { onclick: () => q.note && this.sendNoteForm() }, h('b', '✉ 익명 쪽지'), h('small', `몰래 한 명에게 (${q.note})`)),
      h(`button.act${q.contra ? '' : '.off'}`, { onclick: () => q.contra && this.contraForm() }, h('b', '⚡ 모순 지목'), h('small', `두 발언이 안 맞는다! (${q.contra})`)),
    );
    clear(this.panel).append(
      this.head('☀ 낮 — 토론', '증언판을 읽고, 묻고, 거짓말쟁이를 찾으세요.'),
      h('div.acts', items),
      h('button.btn.wide.gold.vote-go', { onclick: () => this.dayResolve?.() }, '투표하러 가기 →'),
    );
    this.update();
  }

  private back() {
    return h('button.btn.small.back', { onclick: () => { this.exitPick(); this.dayMenu(); } }, '← 돌아가기');
  }

  private others(includeDead = false) {
    return this.game.players.filter((p) => p.id !== this.me.id && (includeDead || p.alive)).map((p) => p.id);
  }

  private claimMenu() {
    const g = this.game;
    const night = g.night;
    const submit = (input: StmtInput) => { g.humanClaim(input); this.dayMenu(); };
    const pickPerson = (title: string, ids: number[], then: (id: number) => void) => {
      clear(this.panel).append(this.back(), this.head(title), this.peopleButtons(ids, then));
    };
    const myRoles: RoleId[] = (Object.keys(ROLES) as RoleId[]).filter((r) => r !== 'nifel');
    clear(this.panel).append(
      this.back(),
      this.head('📢 무엇을 주장할까?', '거짓말도 할 수 있어요. 대신 들키면 모순 지목을 당합니다.'),
      h('div.acts',
        h('button.act', {
          onclick: () => clear(this.panel).append(this.back(), this.head('나의 직업은…'),
            h('div.rolebtns', myRoles.map((r) => h(`button.rbtn.${teamOf(r)}`, { onclick: () => submit({ kind: 'role', speaker: 0, role: r, text: `나는 ${roleName(r)}(${ROLES[r].job})야.` }) }, roleName(r), h('small', ROLES[r].job))))),
        }, h('b', '직업 주장'), h('small', '나는 ○○다')),
        h('button.act', {
          onclick: () => pickPerson('누구를 조사했다고 할까? (경찰 주장)', this.others(), (t) =>
            clear(this.panel).append(this.back(), this.head(`${g.name(t)}의 조사 결과는?`), h('div.bigbtns',
              h('button.btn.big.mafia', { onclick: () => submit({ kind: 'act', speaker: 0, night, act: 'investigate', target: t, result: 'mafia', text: `나 경찰이야. ${g.name(t)} 조사했는데 마피아였어!` }) }, '마피아'),
              h('button.btn.big.citizen', { onclick: () => submit({ kind: 'act', speaker: 0, night, act: 'investigate', target: t, result: 'citizen', text: `나 경찰이야. ${g.name(t)} 조사했는데 시민이었어.` }) }, '시민')))),
        }, h('b', '조사 결과'), h('small', '경찰로서 결과 발표')),
        h('button.act', {
          onclick: () => pickPerson('어젯밤 누구를 지켰다고 할까? (의사 주장)', this.game.alive().map((p) => p.id), (t) =>
            submit({ kind: 'act', speaker: 0, night, act: 'protect', target: t, text: `나 의사야. 어젯밤 ${g.name(t)}를 지켰어.` })),
        }, h('b', '지킨 사람'), h('small', '의사로서 발표')),
        h('button.act', {
          onclick: () => pickPerson('누구를 지켜봤다고 할까? (추적 주장)', this.others(), (t) =>
            clear(this.panel).append(this.back(), this.head(`${g.name(t)}는 어젯밤 어디에 갔나?`),
              this.peopleButtons(this.others(true).filter((x) => x !== t).concat(this.me.id), (w) => submit({ kind: 'act', speaker: 0, night, act: 'track', target: t, result: w, text: `나 추적이야. 어젯밤 ${g.name(t)}가 ${g.name(w)}의 방에 갔어!` })),
              h('button.btn.wide', { onclick: () => submit({ kind: 'act', speaker: 0, night, act: 'track', target: t, result: -1, text: `나 추적이야. ${g.name(t)}는 어젯밤 방을 나서지 않았어.` }) }, '아무 데도 안 갔다'))),
        }, h('b', '추적 결과'), h('small', '누가 어디에 갔나')),
        h('button.act', { onclick: () => submit({ kind: 'act', speaker: 0, night, act: 'stay', text: '어젯밤엔 방에만 있었어.' }) }, h('b', '방에 있었다'), h('small', '어젯밤 아무 데도 안 갔다')),
        h('button.act', { onclick: () => pickPerson('누가 수상하다고 할까?', this.others(), (t) => submit({ kind: 'suspect', speaker: 0, target: t, text: `${g.name(t)}가 수상해.` })) }, h('b', '의심'), h('small', '○○가 수상하다')),
        h('button.act', { onclick: () => pickPerson('누구를 믿는다고 할까?', this.others(), (t) => submit({ kind: 'trust', speaker: 0, target: t, text: `${g.name(t)}는 믿어도 될 것 같아.` })) }, h('b', '믿음'), h('small', '○○는 믿을 만하다')),
      ),
    );
  }

  private askForm() {
    const g = this.game;
    clear(this.panel).append(this.back(), this.head('❓ 누구에게 물어볼까?'),
      this.peopleButtons(this.others(), (t) => {
        clear(this.panel).append(this.back(), this.head(`${g.name(t)}에게 질문`),
          h('div.acts',
            h('button.act', { onclick: () => { g.humanAsk(t, 'role'); this.dayMenu(); } }, h('b', '직업이 뭐야?')),
            h('button.act', { onclick: () => { g.humanAsk(t, 'night'); this.dayMenu(); } }, h('b', '어젯밤 뭐 했어?')),
            h('button.act', { onclick: () => { g.humanAsk(t, 'suspect'); this.dayMenu(); } }, h('b', '누가 제일 수상해?')),
          ));
      }));
  }

  private sendNoteForm() {
    const g = this.game;
    clear(this.panel).append(this.back(), this.head('✉ 누구에게 익명 쪽지를?', '받은 사람만 읽고, 보낸 사람은 모릅니다.'),
      this.peopleButtons(this.others(), (to) => {
        const send = (input: StmtInput) => { g.humanNote(to, input); this.dayMenu(); };
        const pickT = (title: string, make: (t: number) => StmtInput) =>
          clear(this.panel).append(this.back(), this.head(title), this.peopleButtons(this.others().filter((x) => x !== to).concat(this.me.id), (t) => send(make(t))));
        clear(this.panel).append(this.back(), this.head(`${g.name(to)}에게 보낼 내용`),
          h('div.acts',
            h('button.act', { onclick: () => pickT('누가 마피아라고 쓸까?', (t) => ({ kind: 'suspect', speaker: 0, target: t, text: `${g.name(t)}가 마피아야.` })) }, h('b', '○○가 마피아야')),
            h('button.act', { onclick: () => pickT('누구를 믿으라고 쓸까?', (t) => ({ kind: 'trust', speaker: 0, target: t, text: `${g.name(t)}는 믿어도 돼.` })) }, h('b', '○○는 믿어도 돼')),
            h('button.act', { onclick: () => pickT('경찰인 척: 누가 마피아였다고 쓸까?', (t) => ({ kind: 'act', speaker: 0, night: g.night, act: 'investigate', target: t, result: 'mafia', text: `난 경찰이야. ${g.name(t)}는 마피아였어.` })) }, h('b', '경찰인데, ○○는 마피아')),
          ));
      }));
  }

  private noteForm() {
    const g = this.game;
    const clue = this.pendingNote!;
    const publish = (c: Clue) => { g.humanPublishNote(c); this.pendingNote = null; this.dayMenu(); };
    const forge = () => {
      const alive = g.alive().map((p) => p.id);
      const pick2 = (title: string, then: (a: number, b: number) => void) => {
        clear(this.panel).append(this.back(), this.head(title + ' — 첫 번째'), this.peopleButtons(alive, (a) =>
          clear(this.panel).append(this.back(), this.head(title + ' — 두 번째'), this.peopleButtons(alive.filter((x) => x !== a), (b) => then(a, b)))));
      };
      clear(this.panel).append(this.back(), this.head('🖋 쪽지 내용을 바꾼다', '들키면 거짓말쟁이가 됩니다. 진짜 쪽지는 하나뿐이니까요.'),
        h('div.acts',
          h('button.act', { onclick: () => pick2('「A와 B 중 적어도 한 명은 마피아 팀」', (a, b) => publish({ kind: 'oneOf', a, b })) }, h('b', 'A와 B 중 한 명은 마피아')),
          h('button.act', { onclick: () => clear(this.panel).append(this.back(), this.head('「○○는 마피아 팀이 아니다」'), this.peopleButtons(alive, (w) => publish({ kind: 'notMafia', who: w }))) }, h('b', '○○는 마피아가 아니다')),
          h('button.act', { onclick: () => clear(this.panel).append(this.back(), this.head('「○○는 방을 나서지 않았다」'), this.peopleButtons(alive, (w) => publish({ kind: 'stayed', who: w }))) }, h('b', '○○는 방에 있었다')),
          h('button.act', { onclick: () => pick2('「A가 B의 방을 찾아갔다」', (a, b) => publish({ kind: 'visited', who: a, target: b })) }, h('b', 'A가 B의 방에 갔다')),
        ));
    };
    clear(this.panel).append(this.back(), this.head('🔏 저택의 봉인 쪽지', '이 쪽지의 내용은 진짜입니다. 받은 사람은 당신뿐이에요.'),
      h('div.mnote', clueText(clue, g.name)),
      h('div.acts',
        h('button.act.gold', { onclick: () => publish(clue) }, h('b', '그대로 공개')),
        h('button.act', { onclick: forge }, h('b', '내용을 바꿔서 공개'), h('small', '위조')),
        h('button.act', { onclick: () => { this.pendingNote = null; this.dayMenu(); } }, h('b', '숨기기'), h('small', '아무에게도 말하지 않는다')),
      ));
  }

  private contraForm() {
    const g = this.game;
    const info = h('div.ph-sub', '가운데 기록에서 서로 안 맞는 발언 2개를 누르세요. (0/2)');
    clear(this.panel).append(this.back(), this.head('⚡ 모순 지목'), info);
    this.root.classList.add('picking');
    this.pickMode = {
      picked: [],
      onDone: ([a, b]) => {
        this.exitPick();
        const sa = g.board.find((s) => s.id === a)!;
        const sb = g.board.find((s) => s.id === b)!;
        const blames = [...new Set([sa.speaker, sb.speaker])].filter((x) => x >= 0 && x !== this.me.id);
        if (!blames.length) { this.dayMenu(); return; }
        clear(this.panel).append(this.back(), this.head('누가 거짓말을 했나?'),
          h('div.quote', `「${sa.text}」`), h('div.quote', `「${sb.text}」`),
          this.peopleButtons(blames, (blame) => { g.humanContra(a, b, blame); this.dayMenu(); }, { danger: true }));
      },
    };
    const refresh = () => (info.textContent = `가운데 기록에서 서로 안 맞는 발언 2개를 누르세요. (${this.pickMode?.picked.length ?? 0}/2)`);
    (this.pickMode as unknown as { refresh: () => void }).refresh = refresh;
  }

  private onStmtClick(id: number, el: HTMLElement) {
    const pm = this.pickMode;
    if (!pm) return;
    const s = this.game.board.find((x) => x.id === id);
    if (!s || !factsOf(s).length) {
      el.classList.add('shake');
      setTimeout(() => el.classList.remove('shake'), 400);
      return;
    }
    const i = pm.picked.indexOf(id);
    if (i >= 0) { pm.picked.splice(i, 1); el.classList.remove('picked'); }
    else { pm.picked.push(id); el.classList.add('picked'); }
    (pm as unknown as { refresh: () => void }).refresh?.();
    if (pm.picked.length === 2) pm.onDone([...pm.picked]);
  }

  private exitPick() {
    this.pickMode = null;
    this.root.classList.remove('picking');
    this.feed.querySelectorAll('.picked').forEach((e) => e.classList.remove('picked'));
  }

  // ── HumanIO: 투표 ────────────────────────────────

  vote1(targets: number[]): Promise<number | null> {
    return this.ask((done) => [
      this.head('🗳 1차 투표', '가장 많이 표를 받은 두 명이 결선 대결에 오릅니다.'),
      this.peopleButtons(targets, (id) => done(id), { danger: true }),
      h('button.btn.wide', { onclick: () => done(null) }, '기권'),
    ]);
  }

  defense(): Promise<string> {
    const presets = ['나 아니야! 진짜 마피아를 놓치는 거야!', '내 발언을 처음부터 다시 봐. 모순은 없어.', '날 처형하면 내일 후회할 거야.', '…할 말은 다 했어. 판단은 맡길게.'];
    return this.ask<string>((done) => {
      const input = h('input.txt-in', { placeholder: '직접 쓰기…', maxLength: 80 }) as HTMLInputElement;
      return [
        this.head('⚖ 결선 대결 — 당신의 변론', '모두가 당신의 마지막 말을 듣습니다.'),
        h('div.acts', presets.map((p) => h('button.act', { onclick: () => done(p) }, p))),
        h('div.row-in', input, h('button.btn.gold', { onclick: () => input.value.trim() && done(input.value.trim()) }, '말하기')),
      ];
    });
  }

  vote2(a: number, b: number | null): Promise<number | null> {
    return this.ask((done) => [
      this.head('⚖ 결선 투표', b === null ? `${this.game.name(a)}를 처형할까요?` : '둘 중 한 명을 고르세요. 동표면 처형 없이 밤이 됩니다.'),
      b === null
        ? h('div.bigbtns', h('button.btn.big.mafia', { onclick: () => done(a) }, '처형'), h('button.btn.big', { onclick: () => done(null) }, '반대'))
        : this.peopleButtons([a, b], (id) => done(id), { danger: true }),
    ]);
  }

  overturn(target: number): Promise<boolean> {
    return this.ask((done) => [
      this.head('↺ 뒤집기 능력', `${this.game.name(target)}의 처형이 결정됐습니다. 단 한 번, 판결을 무효로 만들 수 있어요.`),
      h('div.bigbtns', h('button.btn.big.citizen', { onclick: () => done(true) }, '뒤집는다'), h('button.btn.big', { onclick: () => done(false) }, '그대로 둔다')),
    ]);
  }

  agitate(votes: VoteRecord[], a: number, b: number | null): Promise<{ voter: number; to: number | null } | null> {
    const g = this.game;
    return this.ask((done) => [
      this.head('🗣 선동 (한 번)', '누군가의 표 하나를 옮길 수 있습니다.'),
      h('div.acts', votes.filter((v) => v.voter !== this.me.id).map((v) => {
        const to = v.target === a ? b : a;
        return h('button.act', { onclick: () => done({ voter: v.voter, to }) },
          h('b', `${g.name(v.voter)}의 표`), h('small', `${v.target === null ? '반대' : g.name(v.target)} → ${to === null ? '반대' : g.name(to)}`));
      })),
      h('button.btn.wide', { onclick: () => done(null) }, '쓰지 않는다'),
    ]);
  }

  avenge(targets: number[]): Promise<number | null> {
    return this.ask((done) => [
      this.head('☠ 길동무', '처형당하기 전에 한 명을 데려갈 수 있습니다.'),
      this.peopleButtons(targets.filter((t) => t !== this.me.id), (id) => done(id), { danger: true }),
      h('button.btn.wide', { onclick: () => done(null) }, '혼자 간다'),
    ]);
  }

  private spectate() {
    if (this.game.over || this.panel.querySelector('.spectate')) return;
    clear(this.panel).append(this.head('👻 관전 중', '당신은 저택에서 사라졌습니다. 남은 사람들의 결말을 지켜보세요. (죽은 사람끼리 채팅은 다인전에서)'), h('div.spectate'));
  }

  // ── 카드 · 결과 ──────────────────────────────────

  private showRoleCard(first: boolean): Promise<void> {
    const me = this.me;
    const def = ROLES[me.role];
    const mates = this.game.mafiaMatesOf(me);
    return new Promise((resolve) => {
      const close = () => { sfx('close'); ov.remove(); resolve(); };
      const ov = h('div.overlay', { onclick: (e: Event) => e.target === ov && close() },
        h(`div.card.rolecard.${teamOf(me.role)}`,
          first ? h('div.rc-kicker', `당신은 ${me.name}`) : '',
          h('div.rc-team', { mafia: '마피아 팀', citizen: '시민 팀', neutral: '중립' }[def.team]),
          h('div.rc-name', roleName(me.role)),
          h('div.rc-job', def.job),
          h('p.rc-desc', def.desc),
          mates.length ? h('div.rc-mates', `동료: ${mates.map(this.game.name).join(', ')}`) : '',
          h('button.btn.gold.wide', { onclick: close }, first ? '게임 시작' : '닫기'),
        ));
      sfx('open');
      this.root.appendChild(ov);
    });
  }

  gameOver(): Promise<void> {
    const g = this.game;
    const won = g.winners.includes(this.me.id);
    sfx(won ? 'win' : 'lose');
    const title = { mafia: '마피아 팀 승리', citizen: '시민 팀 승리', jester: '광대 승리', draw: '무승부' }[g.winner ?? 'draw'];
    return new Promise((resolve) => {
      const ov = h('div.overlay',
        h('div.card.result',
          h(`div.res-big.${won ? 'win' : 'lose'}`, won ? '승리!' : '패배…'),
          h('div.res-title', title),
          h('table.res-table', g.players.map((p) => h(`tr.${teamOf(p.role)}${p.id === this.me.id ? '.self' : ''}`,
            h('td', h('span.avatar.sm', { style: avatarStyle(p.id) }, p.name.slice(-1)), ' ', p.name),
            h('td', h('b', roleName(p.role)), h('small', ` ${ROLES[p.role].job}`)),
            h('td', p.alive ? '생존' : p.diedHow === 'vote' ? '처형' : p.diedHow === 'avenge' ? '길동무' : '습격'),
            h('td', g.winners.includes(p.id) ? '🏆' : '')))),
          h('div.row.end',
            h('button.btn', { onclick: () => { ov.remove(); resolve(); this.onExit(false); } }, '타이틀로'),
            h('button.btn.gold', { onclick: () => { ov.remove(); resolve(); this.onExit(true); } }, '한 판 더')),
        ));
      this.root.appendChild(ov);
    });
  }
}

function teamOf(r: RoleId) {
  return ROLES[r].team;
}

function avatarStyle(id: number) {
  const hue = HUES[id % HUES.length];
  return { background: `hsl(${hue} 45% 32%)`, borderColor: `hsl(${hue} 70% 62%)` };
}

/** 게시판에서 이 사람이 마지막으로 주장한 직업 */
function lastClaim(g: Game, id: number): RoleId | null {
  let r: RoleId | null = null;
  for (const s of g.board) {
    if (s.speaker !== id || s.anon) continue;
    for (const f of factsOf(s)) if (f.f === 'role' && f.who === id) r = f.role;
  }
  return r;
}
