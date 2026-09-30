/**
 * 모바일 전체화면.
 *  · 안드로이드 크롬·삼성 인터넷 등: 전체화면 API + 가로 고정
 *  · 아이폰 사파리: 웹페이지 전체화면 API 가 없음 → "홈 화면에 추가" 로 앱처럼 열면 전체화면 (manifest + apple 메타태그)
 *  화면 구석의 ⛶ 버튼, 게임 앱을 누를 때(첫 화면), 설정의 화면 모드에서 쓴다.
 */
import { cfg } from '../engine/content';

type FsDoc = Document & { webkitFullscreenElement?: Element; webkitExitFullscreen?: () => Promise<void> };
type FsEl = HTMLElement & { webkitRequestFullscreen?: () => Promise<void> };

const doc = document as FsDoc;

export const isTouch = () => matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
export const isStandalone = () => matchMedia('(display-mode: fullscreen), (display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
export const isIOS = () => /iP(hone|od|ad)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

export function canFullscreen() {
  const el = document.documentElement as FsEl;
  return !!(el.requestFullscreen || el.webkitRequestFullscreen);
}

export function isFullscreen() {
  return !!(doc.fullscreenElement || doc.webkitFullscreenElement) || isStandalone();
}

export async function enterFullscreen() {
  const el = document.documentElement as FsEl;
  try {
    if (!doc.fullscreenElement && !doc.webkitFullscreenElement) {
      if (el.requestFullscreen) await el.requestFullscreen({ navigationUI: 'hide' });
      else if (el.webkitRequestFullscreen) await el.webkitRequestFullscreen();
    }
  } catch {
    /* 사용자가 거부했거나 지원 안 함 */
  }
  try {
    // 가로 고정 (전체화면일 때만 되는 기기가 많음)
    await (screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> }).lock?.('landscape');
  } catch {
    /* 지원 안 함 */
  }
}

export async function exitFullscreen() {
  try {
    if (doc.fullscreenElement) await document.exitFullscreen();
    else if (doc.webkitFullscreenElement) await doc.webkitExitFullscreen?.();
  } catch {
    /* 무시 */
  }
}

/** 첫 화면에서 게임 앱을 누를 때: 모바일이면 전체화면으로 */
export function autoFullscreen() {
  if (isTouch() && cfg('screen.mobile_fullscreen', true) && !isFullscreen()) void enterFullscreen();
}

/** 화면 오른쪽 아래 작은 ⛶ 버튼 (모바일에서만, 전체화면이 아닐 때만) */
export function installFullscreenButton() {
  if (!isTouch()) return;
  const btn = document.createElement('button');
  btn.id = 'fs-btn';
  btn.setAttribute('aria-label', '전체화면');
  btn.innerHTML = '<svg viewBox="0 0 24 24"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/></svg>';
  const tip = document.createElement('div');
  tip.id = 'fs-tip';
  tip.innerHTML = '아이폰은 사파리 아래쪽 <b>공유 버튼</b> → <b>홈 화면에 추가</b> 로<br>게임을 열면 전체화면으로 즐길 수 있어요.';
  let tipTimer = 0;
  btn.onclick = (e) => {
    e.stopPropagation();
    if (canFullscreen()) void enterFullscreen();
    else if (isIOS()) {
      tip.classList.add('show');
      clearTimeout(tipTimer);
      tipTimer = window.setTimeout(() => tip.classList.remove('show'), 5000);
    }
  };
  tip.onclick = () => tip.classList.remove('show');
  const refresh = () => btn.classList.toggle('hidden', isFullscreen() || (!canFullscreen() && !isIOS()));
  document.addEventListener('fullscreenchange', refresh);
  document.addEventListener('webkitfullscreenchange', refresh);
  window.addEventListener('resize', refresh);
  refresh();
  document.body.append(btn, tip);

  // 세로 화면 안내를 누르면 전체화면 + 가로 고정 시도
  const hint = document.getElementById('rotate-hint');
  if (hint && canFullscreen()) hint.addEventListener('click', () => void enterFullscreen());
}
