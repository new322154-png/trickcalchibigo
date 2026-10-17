/** 타이틀 메뉴: 빠른 매칭 · 방 만들기 · 미니게임 (+ 프로필, 규칙) */
import { CHARACTERS } from '../../shared/protocol';
import { ROLES, roleName, type RoleId } from '../../shared/roles';
import { playCatch } from '../mini/catch';
import { playMatch } from '../mini/match';
import { api } from '../net';
import { charImg, charName, loadProfile, saveProfile, type Profile } from '../profile';
import { asset, bgUrl, clear, h } from './dom';
import { sfx } from './sfx';

export const GAME_TITLE = '트릭컬 마피아 (가제)';

export interface TitleActions {
  enterRoom(code: string, profile: Profile): void;
}

export function showTitle(root: HTMLElement, act: TitleActions) {
  clear(root);
  let profile = loadProfile();
  const chip = h('button.profile-chip');
  const renderChip = () => chip.replaceChildren(h('img', { src: charImg(profile.char), alt: '' }), h('span', profile.nick), h('small', '프로필 ✎'));
  renderChip();
  chip.onclick = () => editProfile(root, profile, (p) => { profile = p; saveProfile(p); renderChip(); });
  const status = h('div.title-status');
  const busy = (msg: string) => { status.textContent = msg; };

  const quick = async () => {
    sfx('click');
    busy('빈자리가 있는 방을 찾는 중…');
    try { const { code } = await api('/api/match'); act.enterRoom(code, profile); }
    catch { busy('서버에 연결할 수 없어요. 잠시 후 다시 시도해 주세요.'); }
  };

  // 낮(밝은 홀) / 밤(불타는 홀)이 비스듬히 갈라진 화면 + 가면 쓴 케이크들의 무도회
  const day = h('div.tt-half.tt-day', { style: `--bg: ${bgUrl('hall_day.webp')}` });
  const night = h('div.tt-half.tt-night', { style: `--bg: ${bgUrl('hall_night.webp')}` });
  const seam = h('div.tt-seam');
  const floor = h('div.tt-floor');
  const screen = h('div.title.tt',
    day, night, seam, floor,
    chip,
    h('div.tt-logo',
      h('div.tt-kicker', 'TRICKCAL · MASQUERADE'),
      h('h1.tt-name', '트릭컬 마피아'),
      h('div.tt-sub', '가면 속 거짓말쟁이를 찾아라 — 4~12인 온라인 마피아')),
    h('div.tt-menu',
      h('button.tt-btn.main', { onclick: quick }, h('small', 'QUICK MATCH'), h('b', '빠른 매칭')),
      h('button.tt-btn', { onclick: () => { sfx('click'); roomMenu(root, () => profile, act, busy); } }, h('small', 'PRIVATE ROOM'), h('b', '방 만들기 · 코드 입장')),
      h('button.tt-btn', { onclick: () => { sfx('click'); miniMenu(root, () => profile); } }, h('small', 'MINI GAME'), h('b', '미니게임')),
      h('button.tt-rule', { onclick: () => { sfx('click'); showRules(root); } }, '규칙 · 직업 보기'),
      status),
    h('div.fan-notice', '본 게임은 트릭컬 리바이브의 비공식 팬게임입니다.'),
  );
  // 마우스가 있는 쪽이 조금 더 넓어진다
  let pend = -1;
  screen.addEventListener('pointermove', (e) => {
    if (e.pointerType !== 'mouse') return; // 터치에선 안 움직임
    const r = screen.getBoundingClientRect();
    const t = (e.clientX - r.left) / r.width;
    const v = Math.round((50 + (0.5 - t) * 14) * 2) / 2; // 0.5 단위로만 바뀌게
    if (v === pend) return;
    pend = v;
    requestAnimationFrame(() => screen.style.setProperty('--split', String(pend)));
  });
  // 가면 무도회: 케이크를 건드리면 가면 아래 정체가 잠깐 보인다
  const spots: [number, number, number][] = [[9, 96, 1], [21, 90, .86], [31, 99, 1.05], [69, 99, 1.05], [79, 90, .86], [91, 96, 1]];
  const pool = Object.values(ROLES);
  spots.forEach(([x, y, k], i) => {
    const role = pool[Math.floor(Math.random() * pool.length)];
    const ch = CHARACTERS.find((c) => c.name === role.char);
    const reveal = h('img.tt-reveal', { src: ch ? charImg(ch.id) : '', alt: '' });
    const cake = h('img.tt-cake', { src: asset(`ui/mask${(i % 4) + 1}.webp`), alt: '' });
    const tag = h('div.tt-tag', roleName(role.id));
    const el = h(`div.tt-guest${x > 50 ? '.right' : ''}${role.team === 'mafia' ? '.evil' : ''}`, { style: `left:${x}%; top:${y}%; --k:${k}; --d:${i * .37}s` }, reveal, cake, tag);
    let timer = 0;
    const peek = () => {
      clearTimeout(timer);
      el.classList.add('peek');
      sfx('click');
      timer = window.setTimeout(() => el.classList.remove('peek'), 1400);
    };
    el.addEventListener('pointerenter', peek);
    el.addEventListener('click', peek);
    floor.appendChild(el);
  });
  root.appendChild(screen);
}

function roomMenu(root: HTMLElement, profile: () => Profile, act: TitleActions, busy: (m: string) => void) {
  const input = h('input.txt-in.code-in', { placeholder: '방 코드 5자리', maxLength: 5, autocapitalize: 'characters' }) as HTMLInputElement;
  const err = h('div.err');
  const join = () => {
    const code = input.value.trim().toUpperCase();
    if (!/^[A-Z0-9]{5}$/.test(code)) { err.textContent = '방 코드 5자리를 입력하세요.'; return; }
    modal.remove();
    act.enterRoom(code, profile());
  };
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') join(); });
  const modal = h('div.overlay', { onclick: (e: Event) => e.target === modal && modal.remove() },
    h('div.card.roommenu',
      h('h2', '방 만들기'),
      h('button.btn.big.gold.wide', {
        onclick: async () => {
          modal.remove();
          busy('방을 만드는 중…');
          try { const { code } = await api('/api/room'); act.enterRoom(code, profile()); }
          catch { busy('서버에 연결할 수 없어요. 잠시 후 다시 시도해 주세요.'); }
        },
      }, '새 방 만들기'),
      h('p.hint', '친구에게 방 코드나 초대 링크를 보내 함께하세요.'),
      h('h3', '코드로 들어가기'),
      h('div.row-in', input, h('button.btn.gold', { onclick: join }, '입장')),
      err,
    ));
  root.appendChild(modal);
  setTimeout(() => input.focus(), 50);
}

export function miniMenu(root: HTMLElement, profile: () => Profile) {
  const modal = h('div.overlay', { onclick: (e: Event) => e.target === modal && modal.remove() },
    h('div.card.minimenu',
      h('h2', '🎮 혼자 하는 미니게임'),
      h('div.mini-cards',
        h('button.mini-card', { onclick: () => { modal.remove(); playCatch(root, profile().char, () => {}); } }, h('div.mc-icon', '🍞'), h('b', '빵 받기'), h('small', '떨어지는 빵을 받고 폭탄은 피하기')),
        h('button.mini-card', { onclick: () => { modal.remove(); playMatch(root, () => {}); } }, h('div.mc-icon', '🃏'), h('b', '짝 맞추기'), h('small', '같은 캐릭터 카드 찾기')),
      ),
      h('button.btn.wide', { onclick: () => modal.remove() }, '닫기'),
    ));
  root.appendChild(modal);
}

function editProfile(root: HTMLElement, cur: Profile, onSave: (p: Profile) => void) {
  const p = { ...cur };
  const input = h('input.txt-in', { value: p.nick, maxLength: 10, placeholder: '닉네임 (10자까지)' }) as HTMLInputElement;
  const grid = h('div.char-grid');
  const render = () => grid.replaceChildren(...CHARACTERS.map((c) =>
    h(`button.char-pick${c.id === p.char ? '.on' : ''}`, { onclick: () => { p.char = c.id; sfx('click'); render(); } }, h('img', { src: charImg(c.id), alt: '' }), h('span', c.name))));
  render();
  const modal = h('div.overlay',
    h('div.card.profile',
      h('h2', '프로필'),
      h('div.row', h('label', '닉네임'), input),
      h('div.row', h('label', '캐릭터'), h('span.dim', '대기실에서 움직일 캐릭터')),
      grid,
      h('div.row.end',
        h('button.btn', { onclick: () => modal.remove() }, '취소'),
        h('button.btn.gold', { onclick: () => { p.nick = input.value.trim().slice(0, 10) || cur.nick; onSave(p); modal.remove(); } }, '저장')),
    ));
  root.appendChild(modal);
}

export function showRules(root: HTMLElement) {
  const team = (t: string) => Object.values(ROLES).filter((r) => r.team === t);
  const roleRow = (r: (typeof ROLES)[RoleId]) => h('div.rule-role', h('b', roleName(r.id)), h('span.job', r.job), h('p', r.desc));
  const modal = h('div.overlay', { onclick: (e: Event) => e.target === modal && modal.remove() },
    h('div.card.rules',
      h('button.btn.close', { onclick: () => modal.remove() }, '닫기'),
      h('h2', '규칙'),
      h('ol.rule-flow',
        h('li', h('b', '밤'), ' — 모두 자기 방에서 잠든다. 차례: ① 뮤트·스피키 → ② 니펠 → ③ 그 밖의 능력 (각 15초). 능력이 있는 사람은 순서대로 자기 차례에 방을 나와, 복도를 지나 대상의 방에 들어가 능력을 쓴다. 시간 안에 못 고르면 무작위로 정해진다 (쓰지 않아도 되는 직업은 예외).'),
        h('li', h('b', '아침'), ' — 사라진 사람이 발표된다. 죽은 사람의 직업은 공개되지 않는다.'),
        h('li', h('b', '낮 토론'), ' — 채팅으로 자유롭게 토론한다. 하루 한 번 익명 쪽지를 보낼 수 있다.'),
        h('li', h('b', '1차 투표 → 결선 대결'), ' — 가장 많이 표를 받은 두 명이 변론하고, 나머지가 둘 중 한 명을 고른다. 동표면 처형 없이 밤.'),
      ),
      h('p.rule-win', '시민 팀: 니펠을 모두 찾아내면 승리 · 마피아 팀: 살아 있는 마피아 팀이 나머지 이상이 되면 승리 · 중립: 각자의 조건'),
      h('h3.mafia', '마피아 팀'), team('mafia').map(roleRow),
      h('h3.citizen', '시민 팀'), team('citizen').map(roleRow),
      h('h3.neutral', '중립'), team('neutral').map(roleRow),
    ),
  );
  root.appendChild(modal);
}
