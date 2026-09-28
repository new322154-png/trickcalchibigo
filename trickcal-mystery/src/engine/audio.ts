/**
 * 배경음악·효과음.  파일 위치: public/assets/bgm/{이름}.mp3 (없으면 .ogg), public/assets/se/{이름}.mp3
 * 파일이 없어도 오류 없이 조용히 넘어간다 (에셋 작업 전에도 대본 테스트 가능).
 */
import { P, S } from './state';

let bgmEl: HTMLAudioElement | null = null;
let bgmName = '';

function src(folder: string, name: string) {
  return /\.\w{3,4}$/.test(name) ? `./assets/${folder}/${name}` : `./assets/${folder}/${name}.mp3`;
}

export function playBgm(name: string) {
  if (name === bgmName) return;
  S.stage.bgm = name;
  stopBgm();
  bgmName = name;
  if (!name || name === 'none') return;
  const el = new Audio(src('bgm', name));
  el.loop = true;
  el.volume = P.settings.bgm;
  el.onerror = () => {
    if (!/\.ogg$/.test(el.src)) el.src = el.src.replace(/\.mp3$/, '.ogg');
  };
  el.play().catch(() => {
    // 브라우저 자동재생 제한: 첫 클릭 때 다시 시도
    const retry = () => {
      el.play().catch(() => {});
      window.removeEventListener('pointerdown', retry);
    };
    window.addEventListener('pointerdown', retry);
  });
  bgmEl = el;
}

export function stopBgm() {
  if (bgmEl) {
    bgmEl.pause();
    bgmEl = null;
  }
  bgmName = '';
}

export function playSe(name: string) {
  if (!name) return;
  const el = new Audio(src('se', name));
  el.volume = P.settings.se;
  el.play().catch(() => {});
}

export function applyVolume() {
  if (bgmEl) bgmEl.volume = P.settings.bgm;
}
