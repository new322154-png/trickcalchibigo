/**
 * 대기실: 캐릭터 이동 · 채팅 · 멀티 미니게임.
 * 위치는 내 화면에서 먼저 움직이고(즉시 반응), 서버에는 0.08초마다 알린다.
 */
import {
  MAX_PLAYERS, MINI_DESC, MINI_NAMES, SPEED, WALK_TOP, WORLD_H, WORLD_W, clamp,
  type MiniId, type MiniState, type PlayerInfo, type S2C,
} from '../../shared/protocol';
import { playCatch } from '../mini/catch';
import { playMatch } from '../mini/match';
import { connect, type RoomLink } from '../net';
import { GameUI } from './game';
import { AUTO_START, GAME_MIN } from '../../shared/protocol';
import { charImg, type Profile } from '../profile';
import { bgUrl, clear, h, setCompact } from './dom';
import { MoveInput, isTouch } from './input';
import { sfx } from './sfx';

interface Avatar {
  info: PlayerInfo;
  el: HTMLElement;
  bubble: HTMLElement;
  x: number; y: number; tx: number; ty: number;
  /** 보간: 직전 위치에서 목표 위치까지 일정한 속도로 */
  fx: number; fy: number; at: number;
  bubbleTimer?: number;
  moving: boolean;
}

export function enterRoom(root: HTMLElement, code: string, profile: Profile, onExit: (msg?: string) => void) {
  setCompact(true);
  const avatars = new Map<number, Avatar>();
  let me = -1;
  let pub = false;
  let mini: MiniState | null = null;
  let alive = true;
  let gameUI: GameUI | null = null;
  let startingAt: number | null = null;
  const tokKey = `tm.tok.${code}`;
  const getTok = () => { try { return sessionStorage.getItem(tokKey) ?? undefined; } catch { return undefined; } };

  // ── 화면 ──
  const world = h('div.world');
  world.style.setProperty('--lobby-bg', bgUrl('lobby.webp'));
  const miniLayer = h('div.mini-layer');
  world.appendChild(miniLayer);
  const worldWrap = h('div.world-wrap', world);
  const input = new MoveInput();
  if (isTouch()) worldWrap.appendChild(input.el);
  const pressBtn = h('button.press-btn.hidden', { onpointerdown: (e: Event) => { e.preventDefault(); press(); } }, '누르기!');
  worldWrap.appendChild(pressBtn);
  const banner = h('div.mini-banner.hidden');
  worldWrap.appendChild(banner);

  const codeEl = h('div.room-code');
  const countEl = h('div.room-count');
  const hostBar = h('div.host-bar');
  const plist = h('div.r-plist');
  const chatLog = h('div.chat-log');
  const chatIn = h('input.chat-in', { placeholder: '채팅 (Enter)', maxLength: 80 }) as HTMLInputElement;
  const sendChat = () => {
    const t = chatIn.value.trim();
    if (!t) return;
    link.send({ t: 'chat', text: t });
    chatIn.value = '';
    if (isTouch()) chatIn.blur();
  };
  chatIn.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); sendChat(); } else if (e.key === 'Escape') chatIn.blur(); });

  const screen = h('div.room.t-day',
    h('div.r-top',
      codeEl, countEl, h('div.spacer'),
      h('button.btn.small', { onclick: () => playSolo() }, '🎮 혼자 놀기'),
      h('button.btn.small', { onclick: () => leave() }, '나가기')),
    h('div.r-cols',
      worldWrap,
      h('div.r-side', hostBar, plist, chatLog, h('div.chat-row', chatIn, h('button.btn.small.gold', { onclick: sendChat }, '전송')))),
  );
  clear(root).appendChild(screen);

  // 월드 크기 맞추기 (작은 화면에서는 확대해서 내 캐릭터를 따라간다)
  let baseK = 1;
  const follow = () => root.classList.contains('compact');
  const fit = () => { baseK = Math.min(worldWrap.clientWidth / WORLD_W, worldWrap.clientHeight / WORLD_H); };
  const ro = new ResizeObserver(fit);
  ro.observe(worldWrap);
  fit();
  const place = () => {
    const mine = avatars.get(me);
    if (!follow() || !mine) { world.style.transform = `translate(-50%, -50%) scale(${baseK})`; return; }
    const k = baseK * 1.6;
    const lim = (size: number, view: number) => Math.max(0, (size * k - view) / 2);
    const ox = clamp((WORLD_W / 2 - mine.x) * k, -lim(WORLD_W, worldWrap.clientWidth), lim(WORLD_W, worldWrap.clientWidth));
    const oy = clamp((WORLD_H / 2 - mine.y + 40) * k, -lim(WORLD_H, worldWrap.clientHeight), lim(WORLD_H, worldWrap.clientHeight));
    world.style.transform = `translate(calc(-50% + ${ox}px), calc(-50% + ${oy}px)) scale(${k})`;
  };

  // ── 연결 ──
  let link: RoomLink = connect(code, { t: 'hello', nick: profile.nick, char: profile.char, token: getTok() });
  let retries = 0;
  const wire = () => {
    link.onMessage = (m) => { retries = 0; onMsg(m); };
    link.onClose = (reason) => {
      if (!alive) return;
      // 게임 중이면 다시 연결 시도 (30초 안에 돌아오면 이어하기)
      if (gameUI && retries < 8) {
        retries++;
        sys(`연결이 끊겼어요. 다시 연결하는 중… (${retries})`);
        setTimeout(() => { if (!alive) return; link = connect(code, { t: 'hello', nick: profile.nick, char: profile.char, token: getTok() }); if (gameUI) gameUI.link = link; wire(); }, 2500);
        return;
      }
      cleanup(); onExit(reason);
    };
  };
  wire();

  function leave() {
    if (gameUI && !confirm('게임 중에 나가면 30초 뒤 사망 처리돼요. 나갈까요?')) return;
    link.close(); cleanup(); onExit();
  }
  function cleanup() {
    alive = false;
    gameUI?.destroy();
    gameUI = null;
    cancelAnimationFrame(raf);
    input.destroy();
    ro.disconnect();
    window.removeEventListener('keydown', onKey);
    setCompact(false);
  }

  function onMsg(m: S2C) {
    if (m.t === 'g' || m.t === 'glog' || m.t === 'gcmove' || m.t === 'fmove' || m.t === 'pmove' || m.t === 'cut' || m.t === 'gend') {
      if (!gameUI) {
        gameUI = new GameUI(root, link, me);
        input.enabled = false;
        setMini(null);
      }
      gameUI.onMsg(m);
      return;
    }
    switch (m.t) {
      case 'token':
        try { sessionStorage.setItem(tokKey, m.token); } catch { /* 무시 */ }
        break;
      case 'starting':
        startingAt = m.at;
        refresh();
        break;
      case 'welcome':
        // 게임 중 재접속이면 게임 화면 그대로
        if (gameUI && gameUI.v?.phase !== 'end') { me = m.you; sys('다시 연결됐어요.'); break; }
        // 게임이 끝났으면 대기실로
        if (gameUI) { gameUI.destroy(); gameUI = null; input.enabled = true; }
        me = m.you; pub = m.pub;
        for (const a of avatars.values()) a.el.remove();
        avatars.clear();
        for (const p of m.players) addAvatar(p);
        codeEl.replaceChildren(
          h('span', pub ? '빠른 매칭 방' : '방 코드'), h('b', m.code),
          pub ? '' : h('button.btn.small', { onclick: copyInvite }, '초대 링크 복사'));
        sys(pub ? '빠른 매칭 방에 들어왔어요. 사람이 모이는 동안 미니게임을 즐겨 보세요!' : `방 코드 ${m.code} — 친구에게 초대 링크를 보내 주세요.`);
        refresh();
        break;
      case 'join': addAvatar(m.p); sfx('pop'); refresh(); break;
      case 'leave': avatars.get(m.id)?.el.remove(); avatars.delete(m.id); refresh(); break;
      case 'host':
        for (const a of avatars.values()) a.info.host = a.info.id === m.id;
        refresh();
        break;
      case 'moves': {
        const t = performance.now();
        for (const [id, x, y] of m.m) {
          const a = avatars.get(id);
          if (!a || id === me) continue;
          a.fx = a.x; a.fy = a.y; a.tx = x; a.ty = y; a.at = t;
        }
        break;
      }
      case 'pos': {
        const a = avatars.get(me);
        if (a) { a.x = m.x; a.y = m.y; }
        break;
      }
      case 'chat': {
        const a = avatars.get(m.id);
        const nick = a?.info.nick ?? '?';
        chatLog.appendChild(h(`div.cl-line${m.id === me ? '.mine' : ''}`, h('b', nick), ' ', m.text));
        chatLog.scrollTop = chatLog.scrollHeight;
        if (a) {
          a.bubble.textContent = m.text;
          a.bubble.classList.add('show');
          clearTimeout(a.bubbleTimer);
          a.bubbleTimer = window.setTimeout(() => a.bubble.classList.remove('show'), 4000);
        }
        sfx('note');
        break;
      }
      case 'sys': sys(m.text); break;
      case 'error': sys('⚠ ' + m.text); sfx('wrong'); break;
      case 'mini': setMini(m.s); break;
    }
  }

  function sys(text: string) {
    chatLog.appendChild(h('div.cl-sys', text));
    chatLog.scrollTop = chatLog.scrollHeight;
  }

  function copyInvite() {
    const url = `${location.origin}${location.pathname}?room=${code}`;
    void navigator.clipboard?.writeText(url).then(() => sys('초대 링크를 복사했어요.'), () => sys(`초대 링크: ${url}`));
  }

  function addAvatar(p: PlayerInfo) {
    avatars.get(p.id)?.el.remove();
    const bubble = h('div.ch-bubble');
    const el = h(`div.ch${p.id === me ? '.me' : ''}`,
      bubble,
      h('div.ch-tag'),
      h('div.ch-body', h('img', { src: charImg(p.char), alt: '' })),
      h('div.ch-shadow'),
      h('div.ch-name', p.nick));
    world.appendChild(el);
    avatars.set(p.id, { info: p, el, bubble, x: p.x, y: p.y, tx: p.x, ty: p.y, fx: p.x, fy: p.y, at: performance.now(), moving: false });
  }

  function refresh() {
    const n = avatars.size;
    countEl.textContent = `${n} / ${MAX_PLAYERS}명`;
    const amHost = avatars.get(me)?.info.host;
    clear(plist);
    for (const a of avatars.values()) {
      plist.appendChild(h(`div.rp${a.info.id === me ? '.self' : ''}`, h('img', { src: charImg(a.info.char), alt: '' }), h('span', a.info.nick), a.info.host ? h('span.tag.me', '방장') : ''));
      a.el.querySelector('.ch-name')!.textContent = (a.info.host ? '👑 ' : '') + a.info.nick;
    }
    clear(hostBar);
    const waiting = startingAt ? `곧 게임이 시작됩니다!` : n < GAME_MIN ? `${GAME_MIN}명 이상 모이면 게임을 시작할 수 있어요 (${n}/${GAME_MIN})` : pub ? `${AUTO_START}명이 모이면 자동으로 시작해요 (${n}/${AUTO_START})` : '방장이 게임을 시작할 수 있어요';
    hostBar.append(h('div.wait-msg', pub && !startingAt ? `매칭 중… ${waiting}` : waiting));
    if (amHost) {
      hostBar.append(
        h('div.host-label', '👑 방장 메뉴 — 멀티 미니게임'),
        h('div.mini-btns', (Object.keys(MINI_NAMES) as MiniId[]).map((g) =>
          h('button.btn.small', { disabled: !!mini || n < 2, title: MINI_DESC[g], onclick: () => link.send({ t: 'start_mini', game: g }) }, MINI_NAMES[g]))),
        mini ? h('button.btn.small.wide', { onclick: () => link.send({ t: 'stop_mini' }) }, '미니게임 끝내기') : '',
        h('button.btn.gold.wide', { disabled: n < GAME_MIN || !!mini, onclick: () => link.send({ t: 'start_game' }) }, n < GAME_MIN ? `게임 시작 (${GAME_MIN}명부터)` : `게임 시작 (${n}명)`),
      );
    } else hostBar.append(h('div.dim', '방장이 미니게임이나 게임을 시작할 수 있어요.'));
  }

  // ── 미니게임 표시 ──
  let bannerTimer = 0;
  function setMini(s: MiniState | null) {
    const was = mini?.game;
    mini = s;
    clear(miniLayer);
    banner.classList.add('hidden');
    pressBtn.classList.add('hidden');
    clearInterval(bannerTimer);
    for (const a of avatars.values()) a.el.classList.remove('it', 'out', 'seated');
    if (!s) { if (was) sfx('gavel'); refresh(); return; }
    if (!was) { sfx('open'); refresh(); }
    const nick = (id: number) => avatars.get(id)?.info.nick ?? '?';
    const showBanner = (title: string, sub = '', endsAt?: number) => {
      banner.classList.remove('hidden');
      const subEl = h('div.mb-sub', sub);
      banner.replaceChildren(h('div.mb-title', title), subEl);
      if (endsAt) {
        const upd = () => { const left = Math.max(0, Math.ceil((endsAt - Date.now()) / 1000)); subEl.textContent = `${sub}${sub ? ' · ' : ''}${left}초`; };
        upd();
        bannerTimer = window.setInterval(upd, 250);
      }
    };
    switch (s.game) {
      case 'reaction': {
        pressBtn.classList.remove('hidden');
        const fouled = (s.fouls ?? []).includes(me);
        const panel = h(`div.react-panel.${s.phase}`);
        const score = Object.entries(s.scores).map(([id, v]) => `${nick(Number(id))} ${v}`).join(' · ');
        if (s.phase === 'ready') panel.append(h('b', `${s.round}라운드`), h('span', '준비…'));
        if (s.phase === 'wait') { panel.append(h('b', fouled ? '실격!' : '기다려…'), h('span', fouled ? '너무 빨랐어요' : '초록색이 되면 누르세요')); }
        if (s.phase === 'go') { panel.append(h('b', fouled ? '실격' : '지금!'), h('span', '누르세요!')); if (!fouled) sfx('vote'); }
        if (s.phase === 'result') panel.append(h('b', s.winner ? `${nick(s.winner)} 승!` : '무효'), h('span', s.winner && s.time ? `${s.time}ms` : '아무도 못 눌렀어요'));
        panel.append(h('small', score));
        miniLayer.appendChild(panel);
        break;
      }
      case 'ox': {
        miniLayer.append(h(`div.ox-zone.o${s.phase === 'judge' && s.answer === true ? '.right' : ''}`, 'O'), h(`div.ox-zone.x${s.phase === 'judge' && s.answer === false ? '.right' : ''}`, 'X'));
        for (const id of s.out) avatars.get(id)?.el.classList.add('out');
        if (s.phase === 'question') showBanner(`Q${s.num}. ${s.q}`, '정답 구역으로 이동하세요', s.endsAt);
        if (s.phase === 'judge') { showBanner(`정답: ${s.answer ? 'O' : 'X'}`, `남은 사람 ${s.left.length}명`); sfx(s.left.includes(me) ? 'win' : 'lose'); }
        if (s.phase === 'done') showBanner('OX 퀴즈 끝!', `우승: ${s.left.map(nick).join(', ') || '없음'}`);
        break;
      }
      case 'tag':
        avatars.get(s.it)?.el.classList.add('it');
        if (s.phase === 'play') showBanner(s.it === me ? '당신이 술래!' : `술래: ${nick(s.it)}`, '술래에게 닿으면 술래가 바뀌어요', s.endsAt);
        else showBanner('술래잡기 끝!', `마지막 술래: ${nick(s.loser ?? s.it)}`);
        if (s.phase === 'play') sfx('vote');
        break;
      case 'chairs':
        for (const c of s.chairs) {
          miniLayer.appendChild(h(`div.chair${c.by !== null ? '.taken' : ''}`, { style: { left: c.x + 'px', top: c.y + 'px' } }));
          if (c.by !== null) avatars.get(c.by)?.el.classList.add('seated');
        }
        for (const id of s.out) avatars.get(id)?.el.classList.add('out');
        if (s.phase === 'music') showBanner('♪ 돌아다니세요…', `남은 사람 ${s.left.length}명 · 의자 ${s.chairs.length}개`);
        if (s.phase === 'sit') { showBanner('앉아!!', '빈 의자로 달려가세요', s.endsAt); sfx('gavel'); }
        if (s.phase === 'done') showBanner('의자 뺏기 끝!', `우승: ${s.left.map(nick).join(', ')}`);
        break;
    }
  }

  function press() {
    if (mini?.game === 'reaction') { link.send({ t: 'press' }); sfx('click'); }
  }
  const onKey = (e: KeyboardEvent) => {
    if (document.activeElement === chatIn || gameUI) return;
    if (mini?.game === 'reaction' && (e.key === ' ' || e.key === 'Enter')) { e.preventDefault(); press(); return; }
    if (e.key === 'Enter') { e.preventDefault(); chatIn.focus(); }
  };
  window.addEventListener('keydown', onKey);

  function playSolo() {
    input.enabled = false;
    (document.activeElement as HTMLElement | null)?.blur();
    const back = () => { input.enabled = true; };
    const modal = h('div.overlay', { onclick: (e: Event) => e.target === modal && (modal.remove(), back()) },
      h('div.card.minimenu',
        h('h2', '🎮 혼자 놀기'),
        h('p.hint', '방에서 나가지 않고 할 수 있어요. 누가 들어오면 채팅창에 표시돼요.'),
        h('div.mini-cards',
          h('button.mini-card', { onclick: () => { modal.remove(); playCatch(root, profile.char, back); } }, h('div.mc-icon', '🍞'), h('b', '빵 받기')),
          h('button.mini-card', { onclick: () => { modal.remove(); playMatch(root, back); } }, h('div.mc-icon', '🃏'), h('b', '짝 맞추기'))),
        h('button.btn.wide', { onclick: () => { modal.remove(); back(); } }, '닫기')));
    root.appendChild(modal);
  }

  // ── 움직임 ──
  let raf = 0, last = performance.now(), lastSent = 0, sentX = -1, sentY = -1;
  const frozen = () => {
    if (!mini) return false;
    if (mini.game === 'reaction') return true;
    if (mini.game === 'chairs' && mini.chairs.some((c) => c.by === me)) return true;
    return false;
  };
  function loop() {
    raf = requestAnimationFrame(loop);
    const t = performance.now();
    const dt = Math.min(0.05, (t - last) / 1000);
    last = t;
    const mine = avatars.get(me);
    if (mine) {
      const d = document.activeElement === chatIn || frozen() ? { x: 0, y: 0 } : input.dir();
      mine.x = clamp(mine.x + d.x * SPEED * dt, 30, WORLD_W - 30);
      mine.y = clamp(mine.y + d.y * SPEED * dt, WALK_TOP, WORLD_H - 20);
      mine.moving = d.x !== 0 || d.y !== 0;
      if (d.x) mine.el.classList.toggle('flip', d.x > 0);
      if (t - lastSent > 80 && (Math.abs(mine.x - sentX) > 0.5 || Math.abs(mine.y - sentY) > 0.5)) {
        link.send({ t: 'move', x: Math.round(mine.x), y: Math.round(mine.y) });
        sentX = mine.x; sentY = mine.y; lastSent = t;
      }
    }
    for (const a of avatars.values()) {
      if (a.info.id !== me) {
        // 서버가 80ms마다 보내는 위치 사이를 일정한 속도로 이어 준다
        const k = Math.min(1, (t - a.at) / 95);
        const nx = a.fx + (a.tx - a.fx) * k, ny = a.fy + (a.ty - a.fy) * k;
        const dx = nx - a.x;
        a.moving = k < 1 && Math.hypot(a.tx - a.fx, a.ty - a.fy) > 2;
        if (Math.abs(dx) > 0.5) a.el.classList.toggle('flip', dx > 0);
        a.x = nx; a.y = ny;
      }
      const tf = `translate3d(${a.x.toFixed(1)}px, ${a.y.toFixed(1)}px, 0)`;
      if (a.el.style.transform !== tf) a.el.style.transform = tf;
      const z = String(Math.round(a.y));
      if (a.el.style.zIndex !== z) a.el.style.zIndex = z;
      if (a.el.classList.contains('moving') !== a.moving) a.el.classList.toggle('moving', a.moving);
    }
    place();
  }
  loop();
}
