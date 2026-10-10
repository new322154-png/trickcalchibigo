/** 타이틀 · 봇전 설정 · 규칙 */
import { COMPOSITION, ROLES, roleName, type RoleId } from '../data/roles';
import type { Difficulty } from '../engine/types';
import { asset, clear, h } from './dom';
import { sfx } from './sfx';

export const GAME_TITLE = '트릭컬 마피아 (가제)';

export interface LobbySettings {
  count: number;
  difficulty: Difficulty;
  forceRole?: RoleId;
}

const saved = (): LobbySettings => {
  try {
    const s = JSON.parse(localStorage.getItem('tm.lobby') ?? '');
    if (s && s.count >= 4 && s.count <= 12) return { count: s.count, difficulty: s.difficulty ?? 'hard' };
  } catch { /* 없음 */ }
  return { count: 8, difficulty: 'hard' };
};

export function showTitle(root: HTMLElement, onStart: (s: LobbySettings) => void) {
  clear(root);
  const screen = h('div.title', { style: { backgroundImage: `url(${asset('ui/title_bg.jpg')})` } },
    h('div.title-shade'),
    h('div.title-box',
      h('div.title-kicker', 'TRICKCAL · MAFIA'),
      h('h1.title-name', GAME_TITLE),
      h('div.title-sub', '거짓말쟁이는 누구인가 — 4~12인 추리 마피아'),
      h('div.title-menu',
        h('button.btn.big.gold', { onclick: () => { sfx('click'); showLobby(root, onStart); } }, '봇전 시작'),
        h('button.btn.big', { disabled: true, title: '준비 중' }, '다인전 (준비 중)'),
        h('button.btn.big', { onclick: () => { sfx('click'); showRules(root); } }, '규칙 · 직업 보기'),
      ),
    ),
    h('div.fan-notice', '본 게임은 트릭컬 리바이브의 비공식 팬게임입니다.'),
  );
  root.appendChild(screen);
}

function showLobby(root: HTMLElement, onStart: (s: LobbySettings) => void) {
  const s = saved();
  const countLabel = h('div.stepper-value');
  const compo = h('div.lobby-compo');
  const renderCount = () => {
    countLabel.textContent = `${s.count}명`;
    const [nifel, members, rnd, neutral] = COMPOSITION[s.count];
    clear(compo).append(
      h('span.tag.mafia', `니펠 ${nifel}`),
      members ? h('span.tag.mafia', `마피아 팀원 ${members}`) : '',
      h('span.tag.citizen', `의사·경찰 + 시민 ${rnd}`),
      neutral ? h('span.tag.neutral', `중립 ${neutral}`) : '',
    );
  };
  const step = (d: number) => { s.count = Math.max(4, Math.min(12, s.count + d)); sfx('click'); renderCount(); };
  const diffBtns = (['easy', 'normal', 'hard'] as Difficulty[]).map((d) =>
    h(`button.seg${s.difficulty === d ? '.on' : ''}`, {
      onclick: (e: Event) => {
        s.difficulty = d;
        sfx('click');
        for (const b of (e.currentTarget as HTMLElement).parentElement!.children) b.classList.remove('on');
        (e.currentTarget as HTMLElement).classList.add('on');
      },
    }, { easy: '쉬움', normal: '보통', hard: '어려움' }[d]));
  const roleSel = h('select.role-sel') as HTMLSelectElement;
  roleSel.append(h('option', { value: '' }, '무작위'));
  for (const r of Object.values(ROLES)) roleSel.append(h('option', { value: r.id }, `${roleName(r.id)} (${r.job})`));
  renderCount();
  const modal = h('div.overlay',
    h('div.card.lobby',
      h('h2', '봇전 설정'),
      h('div.row', h('label', '인원'), h('div.stepper', h('button.btn.sq', { onclick: () => step(-1) }, '−'), countLabel, h('button.btn.sq', { onclick: () => step(1) }, '+'))),
      compo,
      h('div.row', h('label', '봇 난이도'), h('div.segs', diffBtns)),
      h('div.row.small', h('label', '내 직업 (연습용)'), roleSel),
      h('div.row.end',
        h('button.btn', { onclick: () => { sfx('close'); modal.remove(); } }, '취소'),
        h('button.btn.gold', {
          onclick: () => {
            sfx('open');
            try { localStorage.setItem('tm.lobby', JSON.stringify({ count: s.count, difficulty: s.difficulty })); } catch { /* 무시 */ }
            modal.remove();
            onStart({ ...s, forceRole: (roleSel.value || undefined) as RoleId | undefined });
          },
        }, '시작'),
      ),
    ),
  );
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
        h('li', h('b', '밤'), ' — 능력이 있는 사람은 대상을 고른다. 니펠은 서로 투표해서 한 명을 습격한다.'),
        h('li', h('b', '아침'), ' — 사라진 사람이 발표된다. 죽은 사람의 직업은 공개되지 않는다.'),
        h('li', h('b', '저택 쪽지'), ' — 저택이 진짜 단서가 적힌 봉인 쪽지를 무작위로 한 명에게 보낸다. 받은 사람은 공개하거나, 숨기거나, 바꿔서 공개할 수 있다.'),
        h('li', h('b', '증언판 · 심문'), ' — 직업과 조사 결과를 주장하고, 질문하고, 익명 쪽지를 보낸다.'),
        h('li', h('b', '모순 지목'), ' — 동시에 참일 수 없는 두 발언을 골라 거짓말쟁이를 지목한다.'),
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
