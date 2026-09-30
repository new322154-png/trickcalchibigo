/**
 * 게임 시작점.
 * 1) content/ 폴더의 YAML 을 읽고  2) ink 대본을 준비하고  3) 화면을 만든 뒤  4) 타이틀을 띄운다.
 */
import './styles/theme.css';
import './styles/base.css';
import { loadContent, setContent, setPlayerName } from './engine/content';
import { P, loadPersist, newState, setState } from './engine/state';
import { createStory } from './engine/story';
import { game } from './engine/game';
import { buildStage } from './ui/stage';
import { buildHud } from './ui/hud';
import { buildDialogue } from './ui/dialogue';
import { openBacklog, openGameMenu, openNotebook, showTitle } from './ui/screens';
import { openPhoneApp } from './modes/phone';
import { installDebug } from './ui/debug';
import { installUiSounds } from './ui/sfx';
import { showBoot } from './ui/boot';

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
  setPlayerName(P.settings.playerName);
  document.documentElement.style.setProperty('--dlg-opacity', String(P.settings.windowOpacity));
  setState(newState());
  createStory();
  buildStage();
  buildHud({ onMenu: () => openGameMenu(), onNotebook: () => openNotebook(), onPhone: () => openPhoneApp(), onBacklog: () => openBacklog() });
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
  installUiSounds();
  installDebug(); // 배포 버전에서 디버그 메뉴를 숨기려면 이 줄을 지우세요
  game.onTitle = showTitle;
  // 첫 접속: 스마트폰 홈 화면 → 게임 앱을 누르면 (소리 켜짐) 로고 → 타이틀
  showBoot(showTitle);
} catch (e) {
  showFatal(e);
}
