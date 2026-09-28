/**
 * 16:9 고정 무대. 모든 UI는 1920×1080 좌표로 만들고, 창 크기에 맞춰 통째로 확대/축소한다.
 * 레이어 순서(아래 → 위): bg, cg, chars, mode(조사·폰·재판 화면), hud, dialogue, fx, modal, toast, debug
 * 레이어는 기본적으로 클릭을 통과시키고, 버튼 같은 요소만 클릭을 받는다 (.layer > * 에 pointer-events)
 */
import { cfg, t } from '../engine/content';
import { h } from './dom';

export const LAYERS = ['bg', 'cg', 'chars', 'mode', 'hud', 'dialogue', 'fx', 'modal', 'toast', 'debug'] as const;

export function buildStage() {
  const stage = document.getElementById('stage')!;
  stage.innerHTML = '';
  const W = cfg('screen.width', 1920);
  const H = cfg('screen.height', 1080);
  stage.style.width = W + 'px';
  stage.style.height = H + 'px';
  for (const name of LAYERS) stage.appendChild(h(`div.layer#layer-${name}`));

  const hint = document.getElementById('rotate-hint')!;
  hint.textContent = t('rotate_hint').replace(/^TODO$/, '화면을 가로로 돌려 주세요');

  const fit = () => {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const scale = Math.min(vw / W, vh / H);
    stage.style.transform = `translate(-50%, -50%) scale(${scale})`;
    document.body.classList.toggle('portrait', vh > vw && vw < 900);
  };
  window.addEventListener('resize', fit);
  fit();
}
