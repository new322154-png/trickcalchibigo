/**
 * 게임 시작점.
 * 1) content/ 폴더의 YAML 을 읽고  2) ink 대본을 준비하고  3) 화면을 만든 뒤  4) 타이틀을 띄운다.
 */
import './styles/theme.css';
import './styles/base.css';
import { loadContent, setContent } from './engine/content';
import { loadPersist, newState, setState } from './engine/state';
import { createStory } from './engine/story';
import { game } from './engine/game';
import { buildStage } from './ui/stage';
import { buildHud } from './ui/hud';
import { buildDialogue } from './ui/dialogue';
import { openBacklog, openGameMenu, openNotebook, showTitle } from './ui/screens';
import { openPhoneApp } from './modes/phone';
import { installDebug } from './ui/debug';

function showFatal(e: unknown) {
  const el = document.getElementById('loading') ?? document.body;
  el.innerHTML = '';
  const pre = document.createElement('pre');
  pre.className = 'fatal';
  pre.textContent = '게임을 시작하지 못했습니다.\n\n' + String((e as Error)?.message ?? e);
  el.appendChild(pre);
  console.error(e);
}

try {
  setContent(loadContent());
  loadPersist();
  setState(newState());
  createStory();
  buildStage();
  buildHud({ onMenu: () => openGameMenu(), onNotebook: () => openNotebook(), onPhone: () => openPhoneApp() });
  window.addEventListener('keydown', (e) => {
    // ESC: 열린 창이 없으면 게임 메뉴
    if (e.key === 'Escape' && !document.querySelector('#layer-modal > *')) openGameMenu();
  });
  buildDialogue({
    onMenu: () => openGameMenu(),
    onBacklog: () => openBacklog(),
    onNotebook: () => openNotebook(),
    onPhone: () => openPhoneApp(),
  });
  installDebug(); // 배포 버전에서 디버그 메뉴를 숨기려면 이 줄을 지우세요
  game.onTitle = showTitle;
  showTitle();
} catch (e) {
  showFatal(e);
}
