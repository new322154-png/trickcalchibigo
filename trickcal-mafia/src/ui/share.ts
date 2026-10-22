/**
 * 결과 공유 카드: 게임 끝 화면의 '📸 결과 공유' → 세로 이미지 카드(1080×1350)를 그려서
 * 저장 · 공유(휴대폰 공유 시트) · 링크 복사.
 * 화면 캡처가 아니라 캔버스에 직접 그린다 (어느 기기에서나 같은 모양, 외부 라이브러리 없음).
 */
import { bgUrl, h } from './dom';
import { emojiFile } from './emoji';
import { sfx } from './sfx';

export interface CardPlayer { name: string; role: string; job: string; img: string | null; team: string; won: boolean; alive: boolean; mvp: boolean; self: boolean }
export interface CardInfo {
  title: string; en: string; bg: string; won: boolean; day: number;
  me: CardPlayer | undefined; players: CardPlayer[]; mvp: string[];
}

const W = 1080;

const load = (src: string) => new Promise<HTMLImageElement | null>((ok) => {
  const im = new Image();
  im.onload = () => ok(im); im.onerror = () => ok(null);
  im.src = src;
});
/** CSS 의 url("…") 에서 주소만 */
const unUrl = (u: string) => u.replace(/^url\(["']?/, '').replace(/["']?\)$/, '');

function cover(ctx: CanvasRenderingContext2D, im: HTMLImageElement, x: number, y: number, w: number, h: number) {
  const k = Math.max(w / im.width, h / im.height);
  const sw = w / k, sh = h / k;
  ctx.drawImage(im, (im.width - sw) / 2, (im.height - sh) / 2, sw, sh, x, y, w, h);
}
/** 그림을 상자 안에 비율 유지로 (아래쪽 맞춤) */
function contain(ctx: CanvasRenderingContext2D, im: HTMLImageElement, x: number, y: number, w: number, h: number) {
  const k = Math.min(w / im.width, h / im.height);
  const dw = im.width * k, dh = im.height * k;
  ctx.drawImage(im, x + (w - dw) / 2, y + h - dh, dw, dh);
}
function round(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}
function fit(ctx: CanvasRenderingContext2D, text: string, max: number) {
  if (ctx.measureText(text).width <= max) return text;
  let t = text;
  while (t.length > 1 && ctx.measureText(t + '…').width > max) t = t.slice(0, -1);
  return t + '…';
}

const TEAM_INK: Record<string, string> = { mafia: '#b0342b', citizen: '#2f4f86', neutral: '#6b4a8a' };
const HEAD = "700 {s}px 'Gowun Batang', serif";
const TYPE = "{s}px Typewriter, 'Courier New', monospace";
const BODY = "{w} {s}px Pretendard, sans-serif";
const f = (t: string, s: number, w = 600) => t.replace('{s}', String(s)).replace('{w}', String(w));

/** 종이 결 무늬 (작은 노이즈 타일) */
function grain(ctx: CanvasRenderingContext2D) {
  const t = document.createElement('canvas'); t.width = t.height = 160;
  const g = t.getContext('2d')!; const d = g.createImageData(160, 160);
  for (let i = 0; i < d.data.length; i += 4) { const v = 70 + Math.random() * 60; d.data[i] = v; d.data[i + 1] = v * 0.8; d.data[i + 2] = v * 0.55; d.data[i + 3] = Math.random() * 30; }
  g.putImageData(d, 0, 0);
  return ctx.createPattern(t, 'repeat')!;
}
/** 빨간 고무도장 (기울어진 테두리 글자) */
function stamp(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, size: number, rot: number, color = '#b0342b', font = TYPE) {
  ctx.save(); ctx.translate(x, y); ctx.rotate(rot);
  ctx.font = f(font, size); ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  const w = ctx.measureText(text).width + size * 0.9, hh = size * 1.5;
  ctx.globalAlpha = 0.85; ctx.strokeStyle = color; ctx.fillStyle = color; ctx.lineWidth = Math.max(3, size / 9);
  round(ctx, -w / 2, -hh / 2, w, hh, size / 6); ctx.stroke();
  ctx.fillText(text, 0, size * 0.06);
  // 잉크 빠진 자국
  ctx.globalCompositeOperation = 'destination-out'; ctx.globalAlpha = 1;
  for (let i = 0; i < 70; i++) { ctx.fillStyle = `rgba(0,0,0,${Math.random() * 0.6})`; ctx.fillRect(-w / 2 + Math.random() * w, -hh / 2 + Math.random() * hh, 1 + Math.random() * 4, 1 + Math.random() * 3); }
  ctx.restore();
}
/** 폴라로이드 틀 + 사진 */
function polaroid(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, bottom: number, rot: number, draw: (px: number, py: number, pw: number, ph: number) => void) {
  const pad = Math.max(6, w * 0.045);
  ctx.save(); ctx.translate(x + w / 2, y + h / 2); ctx.rotate(rot); ctx.translate(-w / 2, -h / 2);
  ctx.shadowColor = 'rgba(40,25,10,.35)'; ctx.shadowBlur = w * 0.06; ctx.shadowOffsetY = w * 0.02;
  ctx.fillStyle = '#fbf8f0'; ctx.fillRect(0, 0, w, h); ctx.shadowColor = 'transparent';
  ctx.fillStyle = '#e2dccd'; ctx.fillRect(pad, pad, w - pad * 2, h - pad - bottom);
  ctx.save(); ctx.beginPath(); ctx.rect(pad, pad, w - pad * 2, h - pad - bottom); ctx.clip();
  draw(pad, pad, w - pad * 2, h - pad - bottom); ctx.restore();
  ctx.restore();
}
function tape(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, rot: number) {
  ctx.save(); ctx.translate(x, y); ctx.rotate(rot);
  ctx.fillStyle = 'rgba(240,232,200,.78)'; ctx.shadowColor = 'rgba(0,0,0,.15)'; ctx.shadowBlur = 4;
  ctx.beginPath(); ctx.moveTo(-w / 2, -16); ctx.lineTo(w / 2, -18); ctx.lineTo(w / 2 - 3, 16); ctx.lineTo(-w / 2 + 2, 18); ctx.closePath(); ctx.fill();
  ctx.restore();
}
/** 글자가 넓이에 맞게 줄어드는 글꼴 크기 */
function fitSize(ctx: CanvasRenderingContext2D, text: string, font: string, start: number, max: number, min = 20) {
  let s = start;
  for (; s > min; s -= 2) { ctx.font = f(font, s); if (ctx.measureText(text).width <= max) break; }
  return s;
}

export async function drawCard(c: CardInfo): Promise<HTMLCanvasElement> {
  await Promise.all([
    document.fonts.load("700 80px 'Gowun Batang'"), document.fonts.load('30px Typewriter'),
    document.fonts.load('600 30px Pretendard'), document.fonts.load('800 30px Pretendard'),
  ]).catch(() => {});
  // 세로 길이는 사람 수에 맞춰 (4명씩 한 줄)
  const rows = Math.ceil(Math.min(12, c.players.length) / 4);
  const top = 830, ch = 132, gap = 18;
  const H = top + rows * (ch + gap) + 100;
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const ctx = cv.getContext('2d')!;
  ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
  const [bg, star, ...imgs] = await Promise.all([
    load(unUrl(bgUrl(c.bg))),
    load(emojiFile('⭐') ?? ''),
    load(c.me?.img ?? ''),
    ...c.players.map((p) => (p.img ? load(p.img) : Promise.resolve(null))),
  ]);
  const meImg = imgs[0];
  const pImgs = imgs.slice(1);

  // 종이 바탕
  let g = ctx.createLinearGradient(0, 0, W * 0.3, H);
  g.addColorStop(0, '#f6eedb'); g.addColorStop(0.6, '#efe4cc'); g.addColorStop(1, '#e2d1ad');
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = grain(ctx); ctx.fillRect(0, 0, W, H);
  const v = ctx.createRadialGradient(W / 2, H / 2, H * 0.35, W / 2, H / 2, H * 0.8);
  v.addColorStop(0, 'rgba(120,80,30,0)'); v.addColorStop(1, 'rgba(120,80,30,.22)');
  ctx.fillStyle = v; ctx.fillRect(0, 0, W, H);

  // 머리: 타자기 글씨 + 점선
  ctx.textBaseline = 'alphabetic'; ctx.textAlign = 'left';
  ctx.fillStyle = '#b0342b'; ctx.font = f(TYPE, 26); ctx.fillText('TRICKCAL MAFIA', 60, 78);
  ctx.textAlign = 'right'; ctx.fillStyle = '#5d5146'; ctx.fillText('CASE REPORT', W - 60, 78); ctx.textAlign = 'left';
  ctx.strokeStyle = 'rgba(93,81,70,.45)'; ctx.lineWidth = 2; ctx.setLineDash([10, 8]);
  ctx.beginPath(); ctx.moveTo(60, 100); ctx.lineTo(W - 60, 100); ctx.stroke(); ctx.setLineDash([]);

  // 왼쪽: 내 사진 (폴라로이드, 끝난 장소 배경 + 내 캐릭터)
  const px = 60, py = 140, pw = 540, ph = 600;
  polaroid(ctx, px, py, pw, ph, 110, -0.035, (x, y, w, hh) => {
    if (bg) cover(ctx, bg, x, y, w, hh);
    if (meImg) {
      ctx.save(); ctx.shadowColor = 'rgba(0,0,0,.45)'; ctx.shadowBlur = 24; ctx.shadowOffsetY = 10;
      // 원본(작은 치비 그림)보다 너무 크게 키우면 흐려지므로 최대 2.8배
      const k = Math.min((w * 0.8) / meImg.width, (hh * 0.86) / meImg.height, 2.4);
      const dw = meImg.width * k, dh = meImg.height * k;
      ctx.drawImage(meImg, x + w / 2 - dw / 2, y + hh - dh - 6, dw, dh);
      ctx.restore();
    }
    if (c.me && !c.me.alive) { ctx.fillStyle = 'rgba(80,60,40,.25)'; ctx.fillRect(x, y, w, hh); }
  });
  tape(ctx, px + pw / 2, py + 4, 150, 0.04);
  if (c.me) {
    // 사진 아래 손글씨: 직업 이름 + 내 이름
    ctx.save(); ctx.translate(px + pw / 2, py + ph - 46); ctx.rotate(-0.035);
    ctx.textAlign = 'center'; ctx.fillStyle = TEAM_INK[c.me.team] ?? '#2b2420';
    ctx.font = f(HEAD, 54); ctx.fillText(c.me.role, 0, 4);
    ctx.fillStyle = '#5d5146'; ctx.font = f(BODY, 26, 600); ctx.fillText(fit(ctx, c.me.name, pw - 60), 0, 44);
    ctx.restore();
    if (c.me.mvp && star) ctx.drawImage(star, px + pw - 70, py - 30, 90, 90);
  }

  // 오른쪽: 사건 요약
  const rx = 650, rw = W - 60 - rx;
  ctx.fillStyle = '#b0342b'; ctx.font = f(TYPE, 24); ctx.fillText(fit(ctx, (c.en || 'RESULT').toUpperCase(), rw), rx, 176);
  ctx.fillStyle = '#2b2420';
  const ts = fitSize(ctx, c.title, HEAD, 76, rw, 40); ctx.font = f(HEAD, ts); ctx.fillText(c.title, rx, 176 + ts + 10);
  // 내 결과 도장
  stamp(ctx, c.won ? '승리!' : '패배…', rx + 120, 176 + ts + 110, 58, -0.12, c.won ? '#b0342b' : '#5d5146', BODY.replace('{w}', '800'));
  ctx.fillStyle = '#5d5146'; ctx.font = f(TYPE, 26); ctx.textAlign = 'left';
  ctx.fillText(`DAY ${String(c.day).padStart(2, '0')}`, rx, 176 + ts + 200);
  ctx.font = f(BODY, 26, 600); ctx.fillText(`${c.day}일째에 끝남`, rx, 176 + ts + 238);
  // 숫자 요약 (줄마다 하나)
  const winN = c.players.filter((p) => p.won).length, aliveN = c.players.filter((p) => p.alive).length;
  let y = 176 + ts + 300;
  for (const [en, ko] of [['PLAYERS', `${c.players.length}명 참가`], ['WINNERS', `승리 ${winN}명`], ['SURVIVORS', `생존 ${aliveN}명`]] as const) {
    ctx.fillStyle = '#8a7b6a'; ctx.font = f(TYPE, 18); ctx.fillText(en, rx, y);
    ctx.fillStyle = '#2b2420'; ctx.font = f(BODY, 28, 800); ctx.fillText(ko, rx + 150, y + 2);
    y += 44;
  }
  // 최고의 플레이어: 노란 쪽지
  if (c.mvp.length) {
    const my = Math.max(y + 10, 600), mh = 120;
    ctx.save(); ctx.translate(rx + rw / 2, my + mh / 2); ctx.rotate(0.03);
    ctx.shadowColor = 'rgba(40,25,10,.3)'; ctx.shadowBlur = 10; ctx.shadowOffsetY = 4;
    ctx.fillStyle = '#f6e39a'; ctx.fillRect(-rw / 2, -mh / 2, rw, mh); ctx.shadowColor = 'transparent';
    if (star) ctx.drawImage(star, -rw / 2 + 16, -30, 60, 60);
    ctx.fillStyle = '#b0342b'; ctx.font = f(TYPE, 18); ctx.fillText('BEST PLAYER', -rw / 2 + 92, -18);
    ctx.fillStyle = '#2b2420'; ctx.font = f(HEAD, 36); ctx.fillText(fit(ctx, c.mvp.join(', '), rw - 110), -rw / 2 + 92, 28);
    ctx.restore();
  }

  // 모두의 정체: 작은 사진 명단
  ctx.fillStyle = '#b0342b'; ctx.font = f(TYPE, 20); ctx.fillText('UNMASKED', 60, top - 52);
  ctx.fillStyle = '#2b2420'; ctx.font = f(HEAD, 32); ctx.fillText('가면 아래 정체', 60, top - 16);
  stamp(ctx, 'CASE CLOSED', W - 190, top - 40, 30, -0.1);
  const cols = 4, cw = (W - 120 - gap * (cols - 1)) / cols;
  c.players.slice(0, 12).forEach((p, i) => {
    const x = 60 + (i % cols) * (cw + gap), yy = top + Math.floor(i / cols) * (ch + gap);
    if (p.self) { ctx.fillStyle = 'rgba(243,211,107,.45)'; ctx.fillRect(x - 6, yy - 4, cw + 12, ch + 8); }
    const im = pImgs[i];
    polaroid(ctx, x, yy + 4, 92, 118, 20, i % 2 ? 0.05 : -0.05, (qx, qy, qw, qh) => {
      if (!im) return;
      ctx.save(); if (!p.alive) ctx.filter = 'grayscale(1) sepia(.35)';
      contain(ctx, im, qx, qy + 2, qw, qh - 2);
      ctx.restore();
    });
    const tx = x + 108, tw = cw - 112;
    ctx.fillStyle = TEAM_INK[p.team] ?? '#2b2420'; ctx.font = f(HEAD, 28);
    const role = fit(ctx, p.role, tw); ctx.fillText(role, tx, yy + 42);
    if (!p.alive) { ctx.strokeStyle = '#b0342b'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(tx - 2, yy + 32); ctx.lineTo(tx + ctx.measureText(role).width + 2, yy + 30); ctx.stroke(); }
    ctx.fillStyle = '#5d5146'; ctx.font = f(BODY, 20, 600); ctx.fillText(fit(ctx, p.name, tw), tx, yy + 74);
    ctx.font = f(TYPE, 17); ctx.fillStyle = p.alive ? '#2f6b4a' : '#8a7b6a';
    ctx.fillText(p.alive ? 'ALIVE' : 'DEAD', tx, yy + 104);
    if (p.won) { ctx.fillStyle = '#b0342b'; ctx.fillText('WIN', tx + 76, yy + 104); }
    if (p.mvp && star) ctx.drawImage(star, x + 66, yy - 6, 34, 34);
  });

  // 아래: 타자기 꼬리말
  ctx.strokeStyle = 'rgba(93,81,70,.45)'; ctx.lineWidth = 2; ctx.setLineDash([10, 8]);
  ctx.beginPath(); ctx.moveTo(60, H - 78); ctx.lineTo(W - 60, H - 78); ctx.stroke(); ctx.setLineDash([]);
  ctx.fillStyle = '#5d5146'; ctx.font = f(TYPE, 20);
  ctx.fillText(location.host, 60, H - 40); ctx.fillText(new Date().toLocaleDateString('ko-KR'), 60 + ctx.measureText(location.host).width + 30, H - 40);
  ctx.textAlign = 'right'; ctx.font = f(BODY, 20, 600); ctx.fillText('비공식 팬게임', W - 60, H - 40); ctx.textAlign = 'left';
  return cv;
}

/** 카드를 띄우고 저장 · 공유 버튼을 보여 준다 */
export async function shareCard(host: HTMLElement, c: CardInfo) {
  const wait = h('div.overlay.sh-modal', h('div.sh-wait', '카드 만드는 중…'));
  host.appendChild(wait);
  let cv: HTMLCanvasElement;
  try { cv = await drawCard(c); } catch { wait.remove(); return; }
  const blob = await new Promise<Blob | null>((ok) => cv.toBlob(ok, 'image/png'));
  const url = blob ? URL.createObjectURL(blob) : cv.toDataURL('image/png');
  const file = blob ? new File([blob], `trickcal-mafia-${Date.now()}.png`, { type: 'image/png' }) : null;
  const link = `${location.origin}/`;
  const text = `트릭컬 마피아 — ${c.title}${c.won ? ' (승리!)' : ''}`;
  const msg = h('div.sh-msg');
  const close = () => { modal.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000); };
  const canShareFile = !!file && !!navigator.canShare?.({ files: [file] });
  const modal = h('div.overlay.sh-modal', { onclick: (e: Event) => { if (e.target === modal) close(); } },
    h('div.sh-card',
      h('img.sh-img', { src: url, alt: '결과 카드' }),
      h('div.sh-side',
        h('h3', '📸 결과 공유'),
        h('p.hint', '이미지를 저장하거나 바로 공유할 수 있어요. 휴대폰에서는 이미지를 길게 눌러 저장해도 돼요.'),
        h('a.btn.gold.wide', { href: url, download: file?.name ?? 'trickcal-mafia.png', onclick: () => sfx('click') }, '💾 이미지 저장'),
        canShareFile ? h('button.btn.wide', { onclick: async () => {
          try { await navigator.share({ files: [file!], title: '트릭컬 마피아', text: `${text}\n${link}` }); } catch { /* 취소 */ }
        } }, '📤 공유하기') : '',
        h('button.btn.wide', { onclick: () => {
          void navigator.clipboard?.writeText(`${text}\n${link}`).then(() => { msg.textContent = '링크를 복사했어요!'; }, () => { msg.textContent = link; });
        } }, '🔗 링크 복사'),
        msg,
        h('button.btn.small.wide', { onclick: close }, '닫기'))));
  wait.remove();
  host.appendChild(modal);
}

