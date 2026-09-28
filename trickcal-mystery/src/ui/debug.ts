/**
 * 디버그 메뉴 — 대본 테스트용.  F9 키, 또는 화면 왼쪽 위 구석을 빠르게 5번 누르면 열림.
 * 배포할 때 숨기고 싶으면 main.ts 에서 installDebug() 줄을 지우세요.
 *
 * - 원하는 knot 으로 바로 이동
 * - 단서 주기, flag 켜고 끄기, 호감도·의심도 바꾸기
 * - 조사 지점 위치 보기 (rect 조정용)
 * - 모든 엔딩 해금 / 영구 기록 초기화
 */
import storyJson from 'virtual:ink-story';
import { C } from '../engine/content';
import { game } from '../engine/game';
import { P, S, addAffinity, addSuspicion, giveClue, giveConclusion, savePersist, setFlag, unvanish, vanish } from '../engine/state';
import * as story from '../engine/story';
import { clear, h } from './dom';
import { openModal, toast } from './modal';
import { refreshHud } from './hud';

function knotNames(): string[] {
  try {
    const root = JSON.parse(storyJson).root as any[];
    const named = root[root.length - 1];
    const externals = ['has_clue', 'has_card', 'affinity', 'suspicion', 'suspected', 'flag', 'present', 'seen_ending', 'voted'];
    return Object.keys(named ?? {}).filter((k) => !k.startsWith('#') && k !== 'global decl' && !externals.includes(k)).sort();
  } catch {
    return [];
  }
}

export function installDebug() {
  window.addEventListener('keydown', (e) => {
    if (e.key === 'F9') openDebug();
  });
  let taps: number[] = [];
  window.addEventListener('pointerdown', (e) => {
    if (e.clientX > 60 || e.clientY > 60) return;
    const now = Date.now();
    taps = [...taps.filter((t) => now - t < 1500), now];
    if (taps.length >= 5) {
      taps = [];
      openDebug();
    }
  });
}

function openDebug() {
  const m = openModal('디버그', 'debug');
  const section = (title: string, ...kids: (HTMLElement | null)[]) => h('div.dbg-section', h('h4', title), ...kids);

  // knot 이동
  const knotSel = h('select', ...knotNames().map((k) => h('option', { value: k }, k))) as HTMLSelectElement;
  const jump = h('button.btn.small', {
    onclick: () => {
      m.close();
      void game.debugJump(knotSel.value);
    },
  }, '이동');

  // 단서
  const clueSel = h('select', ...Object.keys(C.evidence).map((k) => h('option', { value: k }, `${k} (${C.evidence[k]?.name})`))) as HTMLSelectElement;
  const giveBtn = h('button.btn.small', { onclick: () => { giveClue(clueSel.value); } }, '주기');
  const concSel = h('select', ...Object.keys(C.conclusions).map((k) => h('option', { value: k }, k))) as HTMLSelectElement;
  const concBtn = h('button.btn.small', { onclick: () => giveConclusion(concSel.value) }, '결론 카드 주기');

  // flag
  const flagInput = h('input', { placeholder: 'flag 이름' }) as HTMLInputElement;
  const flagOn = h('button.btn.small', { onclick: () => { setFlag(flagInput.value, true); renderState(); } }, '켜기');
  const flagOff = h('button.btn.small', { onclick: () => { setFlag(flagInput.value, false); renderState(); } }, '끄기');

  // 호감도 / 의심도 / 실종
  const charSel = h('select', ...Object.keys(C.characters).filter((c) => !C.characters[c].player).map((k) => h('option', { value: k }, C.characters[k].name))) as HTMLSelectElement;
  const affUp = h('button.btn.small', { onclick: () => { addAffinity(charSel.value, 1); renderState(); } }, '호감 +1');
  const affDown = h('button.btn.small', { onclick: () => { addAffinity(charSel.value, -1); renderState(); } }, '호감 -1');
  const vanishBtn = h('button.btn.small', { onclick: () => { vanish(charSel.value); refreshHud(); renderState(); } }, '사라지게');
  const returnBtn = h('button.btn.small', { onclick: () => { unvanish(charSel.value); refreshHud(); renderState(); } }, '돌아오게');
  const susUp = h('button.btn.small', { onclick: () => { addSuspicion(1); renderState(); } }, '의심도 +1');
  const susDown = h('button.btn.small', { onclick: () => { addSuspicion(-1); renderState(); } }, '의심도 -1');

  // 화면
  const showSpots = h('button.btn.small', { onclick: () => document.body.classList.toggle('debug-spots') }, '조사 지점 테두리 보기');
  const unlockAll = h('button.btn.small', {
    onclick: () => {
      P.endingsSeen = Object.keys(C.endings);
      P.nodesSeen = Object.keys(C.flowchart);
      savePersist();
      toast('모든 엔딩과 흐름도 지점을 해금했습니다');
    },
  }, '엔딩 전부 해금');
  const resetPersist = h('button.btn.small', {
    onclick: () => {
      if (!window.confirm('본 엔딩, 체크포인트, 읽은 대사, 튜토리얼 기록을 모두 지웁니다.')) return;
      localStorage.removeItem('trickcal-mystery:persist');
      location.reload();
    },
  }, '영구 기록 초기화');

  const stateView = h('pre.dbg-state');
  const renderState = () => {
    clear(stateView).textContent = JSON.stringify(
      { chapter: S.chapter, suspicion: S.suspicion, affinity: S.affinity, flags: S.flags, evidence: S.evidence, conclusions: S.conclusions, vanished: S.vanished, actions: S.actions, ink: story.inkStory()?.state?.currentPathString },
      null,
      1,
    );
  };
  renderState();

  m.body.append(
    section('대본 이동 (knot)', knotSel, jump),
    section('단서 · 결론', clueSel, giveBtn, concSel, concBtn),
    section('flag', flagInput, flagOn, flagOff),
    section('인물', charSel, affUp, affDown, vanishBtn, returnBtn, susUp, susDown),
    section('기타', showSpots, unlockAll, resetPersist),
    section('현재 상태', stateView),
  );
}
