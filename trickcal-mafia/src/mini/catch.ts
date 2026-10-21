/**
 * 싱글 미니게임: 빵 받기
 * 떨어지는 빵을 받고 폭탄은 피한다. 목숨 3개. 갈수록 빨라진다.
 * 조작: A/D·방향키, 또는 화면을 누른 채 좌우로 끌기
 */
import type { CharId } from '../../shared/protocol';
import { h } from '../ui/dom';
import { sfx } from '../ui/sfx';
import { charImg } from '../profile';

const W = 1200, H = 760;

type Item = { x: number; y: number; vy: number; kind: 'bread' | 'gold' | 'bomb'; r: number };

export function playCatch(host: HTMLElement, char: CharId, onClose: () => void) {
  const canvas = h('canvas.mg-canvas', { width: W, height: H }) as HTMLCanvasElement;
  const ctx = canvas.getContext('2d')!;
  const scoreEl = h('div.mg-score');
  const best = Number(safeGet('tm.best.catch') ?? 0);
  const overlay = h('div.mg-overlay',
    h('div.mg-box',
      h('div.mg-head', h('b', '🍞 빵 받기'), scoreEl, h('button.btn.small', { onclick: () => close() }, '닫기')),
      canvas,
      h('div.mg-help', 'A·D 또는 방향키 / 화면을 누른 채 좌우로 움직이기 · 폭탄은 피하세요!'),
    ));
  (document.activeElement as HTMLElement | null)?.blur();
  host.appendChild(overlay);

  const img = new Image();
  img.src = charImg(char);
  let px = W / 2, score = 0, lives = 3, t = 0, spawn = 0, over = false, raf = 0, last = performance.now();
  const items: Item[] = [];
  const keys = new Set<string>();
  let dragX: number | null = null;

  const onKey = (e: KeyboardEvent) => {
    const k = e.key.toLowerCase();
    if (['a', 'd', 'arrowleft', 'arrowright'].includes(k)) { e.preventDefault(); e.stopPropagation(); if (e.type === 'keydown') keys.add(k); else keys.delete(k); }
    if (over && e.type === 'keydown' && (k === ' ' || k === 'enter')) restart();
  };
  window.addEventListener('keydown', onKey, true);
  window.addEventListener('keyup', onKey, true);
  const toCanvasX = (e: PointerEvent) => { const r = canvas.getBoundingClientRect(); return ((e.clientX - r.left) / r.width) * W; };
  canvas.addEventListener('pointerdown', (e) => { if (over) return restart(); dragX = toCanvasX(e); canvas.setPointerCapture(e.pointerId); });
  canvas.addEventListener('pointermove', (e) => { if (dragX !== null) dragX = toCanvasX(e); });
  canvas.addEventListener('pointerup', () => (dragX = null));

  function restart() {
    items.length = 0; score = 0; lives = 3; t = 0; spawn = 0; over = false; px = W / 2;
    last = performance.now();
    loop();
  }

  function close() {
    cancelAnimationFrame(raf);
    window.removeEventListener('keydown', onKey, true);
    window.removeEventListener('keyup', onKey, true);
    overlay.remove();
    onClose();
  }

  function loop() {
    raf = requestAnimationFrame(loop);
    const now = performance.now();
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    if (over) return draw();
    t += dt;
    const speed = 1 + t / 40;
    // 이동
    let dx = 0;
    if (keys.has('a') || keys.has('arrowleft')) dx -= 1;
    if (keys.has('d') || keys.has('arrowright')) dx += 1;
    px += dx * 720 * dt;
    if (dragX !== null) px += (dragX - px) * Math.min(1, dt * 14);
    px = Math.max(50, Math.min(W - 50, px));
    // 생성
    spawn -= dt;
    if (spawn <= 0) {
      spawn = Math.max(0.28, 0.9 - t / 70);
      const r = Math.random();
      const kind: Item['kind'] = r < 0.22 + Math.min(0.15, t / 300) ? 'bomb' : r > 0.93 ? 'gold' : 'bread';
      items.push({ x: 40 + Math.random() * (W - 80), y: -30, vy: (220 + Math.random() * 120) * speed, kind, r: kind === 'bomb' ? 24 : 26 });
    }
    // 낙하 · 충돌
    for (let i = items.length - 1; i >= 0; i--) {
      const it = items[i];
      it.y += it.vy * dt;
      if (it.y > H - 110 && it.y < H - 40 && Math.abs(it.x - px) < 60) {
        items.splice(i, 1);
        if (it.kind === 'bomb') { lives--; sfx('wrong'); if (lives <= 0) end(); }
        else { score += it.kind === 'gold' ? 5 : 1; sfx(it.kind === 'gold' ? 'win' : 'pop'); }
        continue;
      }
      if (it.y > H + 40) items.splice(i, 1);
    }
    draw();
  }

  function end() {
    over = true;
    const b = Math.max(best, score, Number(safeGet('tm.best.catch') ?? 0));
    safeSet('tm.best.catch', String(b));
    sfx('lose');
  }

  function draw() {
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, '#dff1ff'); g.addColorStop(1, '#fff3d6');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = '#3a2c22'; ctx.fillRect(0, H - 40, W, 40);
    for (const it of items) drawItem(it);
    // 캐릭터
    ctx.save();
    ctx.beginPath(); ctx.ellipse(px, H - 42, 46, 10, 0, 0, Math.PI * 2); ctx.fillStyle = 'rgba(58,42,34,.25)'; ctx.fill();
    if (img.complete && img.naturalHeight) {
      // 원래 비율 그대로 (높이 기준)
      const ch = 120, cw = Math.min(170, (ch * img.naturalWidth) / img.naturalHeight);
      ctx.drawImage(img, px - cw / 2, H - 52 - ch, cw, ch);
    }
    ctx.fillStyle = '#c98b4b'; ctx.fillRect(px - 52, H - 62, 104, 14); // 바구니
    ctx.restore();
    scoreEl.textContent = `점수 ${score} · ${'❤'.repeat(Math.max(0, lives))} · 최고 ${Math.max(best, Number(safeGet('tm.best.catch') ?? 0))}`;
    if (over) {
      ctx.fillStyle = 'rgba(255,250,240,.86)'; ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = '#3a2a22'; ctx.font = '84px Jua, sans-serif'; ctx.textAlign = 'center';
      ctx.fillText(`${score}점!`, W / 2, H / 2 - 20);
      ctx.font = '32px Jua, sans-serif'; ctx.fillStyle = '#7a6556';
      ctx.fillText('화면을 누르거나 스페이스로 다시 하기', W / 2, H / 2 + 40);
    }
  }

  function drawItem(it: Item) {
    ctx.save();
    ctx.translate(it.x, it.y);
    if (it.kind === 'bomb') {
      ctx.fillStyle = '#16121c'; ctx.beginPath(); ctx.arc(0, 0, it.r, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = '#e0566a'; ctx.lineWidth = 3; ctx.stroke();
      ctx.strokeStyle = '#c9a36b'; ctx.beginPath(); ctx.moveTo(8, -it.r + 2); ctx.quadraticCurveTo(18, -it.r - 12, 26, -it.r - 6); ctx.stroke();
      ctx.fillStyle = Math.floor(performance.now() / 120) % 2 ? '#ffd36a' : '#ff7a3a'; ctx.beginPath(); ctx.arc(26, -it.r - 6, 5, 0, Math.PI * 2); ctx.fill();
    } else {
      ctx.fillStyle = it.kind === 'gold' ? '#f6cf5a' : '#d79a55';
      roundRect(-30, -20, 60, 40, 18); ctx.fill();
      ctx.fillStyle = it.kind === 'gold' ? '#fff3b0' : '#f0c48c';
      roundRect(-22, -14, 44, 12, 6); ctx.fill();
      if (it.kind === 'gold') { ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; roundRect(-30, -20, 60, 40, 18); ctx.stroke(); }
    }
    ctx.restore();
  }
  function roundRect(x: number, y: number, w: number, hh: number, r: number) {
    ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + hh, r); ctx.arcTo(x + w, y + hh, x, y + hh, r); ctx.arcTo(x, y + hh, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
  }
  loop();
}

function safeGet(k: string) { try { return localStorage.getItem(k); } catch { return null; } }
function safeSet(k: string, v: string) { try { localStorage.setItem(k, v); } catch { /* 무시 */ } }
export { safeGet, safeSet };
