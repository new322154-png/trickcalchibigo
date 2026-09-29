/**
 * 배경음악·효과음.  파일 위치: public/assets/bgm/{이름}.mp3 (없으면 .ogg), public/assets/se/{이름}.mp3
 * 파일이 없어도 오류 없이 조용히 넘어간다 (에셋 작업 전에도 대본 테스트 가능).
 */
import { asset } from '../ui/dom';
import { P, S, markSeen } from './state';

let bgmEl: HTMLAudioElement | null = null;
let bgmName = '';

function src(folder: string, name: string) {
  return asset(/\.\w{3,4}$/.test(name) ? `${folder}/${name}` : `${folder}/${name}.mp3`);
}

export function playBgm(name: string) {
  if (name === bgmName) return;
  S.stage.bgm = name;
  stopBgm();
  bgmName = name;
  if (!name || name === 'none') return;
  markSeen('bgmHeard', name);
  const el = new Audio(src('bgm', name));
  el.loop = true;
  el.volume = P.settings.bgm * P.settings.master;
  el.onerror = () => {
    if (!/\.ogg(\?|$)/.test(el.src)) el.src = el.src.replace(/\.mp3(\?|$)/, '.ogg$1');
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
  el.volume = P.settings.se * P.settings.master;
  el.play().catch(() => {});
}

export function applyVolume() {
  if (bgmEl) bgmEl.volume = P.settings.bgm * P.settings.master;
}

/** 지금 게임에서 흐르는 배경음악 이름 */
export function currentBgm() {
  return bgmName;
}

/** 음악 감상실을 여는 동안 게임 배경음악을 잠시 멈추고, 닫으면 이어 튼다 */
export function pauseBgm(paused: boolean) {
  if (!bgmEl) return;
  if (paused) bgmEl.pause();
  else bgmEl.play().catch(() => {});
}

/** 배경음악 파일 주소 (음악 감상실용) */
export function bgmSrc(name: string) {
  return src('bgm', name);
}
