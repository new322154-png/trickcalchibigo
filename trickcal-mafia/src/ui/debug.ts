/**
 * 테스트용 성능 표시: 주소 끝에 ?debug 를 붙이면 켜진다 (이 탭에선 계속 유지, ?debug=0 으로 끔).
 * 초당 2번만 갱신 — 표시 자체가 부담이 되지 않게.
 *  FPS · 최근 5초 프레임 간격 p95 · 100ms 넘게 멈춘 횟수 · 왕복 지연(RTT) · 마지막 수신 후 경과 · 연결 상태 · 빌드
 */
import { currentLink } from '../net';

export function maybeDebug() {
  const q = new URLSearchParams(location.search).get('debug');
  try {
    if (q === '0') sessionStorage.removeItem('tm.debug');
    else if (q !== null) sessionStorage.setItem('tm.debug', '1');
    if (sessionStorage.getItem('tm.debug') !== '1') return;
  } catch { if (q === null || q === '0') return; }

  const box = document.createElement('div');
  box.style.cssText = 'position:fixed;left:6px;bottom:6px;z-index:3000;font:12px/1.35 ui-monospace,Menlo,monospace;color:#d8ffe0;background:rgba(0,0,0,.72);padding:6px 8px;border-radius:6px;pointer-events:none;white-space:pre';
  document.body.appendChild(box);
  const gaps: number[] = []; // 최근 프레임 간격 (ms)
  let last = performance.now();
  let frames = 0;
  let stalls = 0;
  const loop = (t: number) => {
    const d = t - last;
    last = t;
    if (!document.hidden) {
      frames++;
      gaps.push(d);
      if (gaps.length > 600) gaps.splice(0, gaps.length - 600);
      if (d > 100) stalls++;
    }
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
  let t0 = performance.now();
  setInterval(() => {
    const now = performance.now();
    const fps = Math.round((frames * 1000) / (now - t0));
    frames = 0; t0 = now;
    const recent = gaps.slice(-300).sort((a, b) => a - b);
    const p95 = recent.length ? recent[Math.floor(recent.length * 0.95)] : 0;
    const s = currentLink?.stats();
    box.textContent =
      `FPS ${fps}  p95 ${p95.toFixed(0)}ms  멈춤>100ms ${stalls}\n` +
      (s ? `RTT ${s.rtt || '-'}ms  수신 ${Math.round(s.lastRx / 1000)}초 전  ${s.state}\n` : '연결 없음\n') +
      `DPR ${devicePixelRatio}  ${innerWidth}×${innerHeight}  build ${__BUILD__}`;
  }, 500);
}
