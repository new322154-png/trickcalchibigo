/** 타이틀 · 봇전 설정 · 규칙 */
import { ROLES, roleName, type RoleId } from '../data/roles';
import { asset, clear, h } from './dom';
import { sfx } from './sfx';

export const GAME_TITLE = '트릭컬 마피아 (가제)';

export function showTitle(root: HTMLElement) {
  clear(root);
  const screen = h('div.title', { style: { backgroundImage: `url(${asset('ui/title_bg.jpg')})` } },
    h('div.title-shade'),
    h('div.title-box',
      h('div.title-kicker', 'TRICKCAL · MAFIA'),
      h('h1.title-name', GAME_TITLE),
      h('div.title-sub', '거짓말쟁이는 누구인가 — 4~12인 온라인 마피아'),
      h('div.title-menu',
        h('button.btn.big.gold', { disabled: true, title: '준비 중' }, '다인전 (준비 중)'),
        h('button.btn.big', { onclick: () => { sfx('click'); showRules(root); } }, '규칙 · 직업 보기'),
      ),
    ),
    h('div.fan-notice', '본 게임은 트릭컬 리바이브의 비공식 팬게임입니다.'),
  );
  root.appendChild(screen);
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
