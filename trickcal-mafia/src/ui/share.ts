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
const TEAM: Record<string, string> = { mafia: '#ff4d6a', citizen: '#4da3ff', neutral: '#b57bff' };

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

export async function drawCard(c: CardInfo): Promise<HTMLCanvasElement> {
  await Promise.all([document.fonts.load('80px "Black Han Sans"'), document.fonts.load('40px Jua'), document.fonts.load('700 30px "Noto Sans KR"')]).catch(() => {});
  // 세로 길이는 사람 수에 맞춰 (4명씩 한 줄)
  const rows = Math.ceil(Math.min(12, c.players.length) / 4);
  const H = 820 + rows * 126 + 110;
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

  // 배경
  ctx.fillStyle = '#14162a'; ctx.fillRect(0, 0, W, H);
  if (bg) { ctx.globalAlpha = 0.9; cover(ctx, bg, 0, 0, W, 760); ctx.globalAlpha = 1; }
  let g = ctx.createLinearGradient(0, 0, 0, 780);
  g.addColorStop(0, 'rgba(10,12,28,.55)'); g.addColorStop(0.55, 'rgba(10,12,28,.15)'); g.addColorStop(1, '#14162a');
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, 780);

  // 제목
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = '#ffd38a'; ctx.font = '700 26px "Noto Sans KR", sans-serif';
  ctx.fillText('트릭컬 마피아', 60, 86);
  ctx.font = '104px "Black Han Sans", "Jua", sans-serif';
  ctx.lineJoin = 'round'; ctx.lineWidth = 14; ctx.strokeStyle = '#1d2030';
  ctx.strokeText(c.title, 56, 196); ctx.fillStyle = '#fff'; ctx.fillText(c.title, 56, 196);
  // 내 결과
  ctx.font = '40px Jua, sans-serif';
  const res = c.won ? '승리!' : '패배…';
  const rw = ctx.measureText(res).width + 52;
  ctx.fillStyle = c.won ? '#ffb648' : '#4a4f60';
  ctx.beginPath(); ctx.moveTo(74, 222); ctx.lineTo(60 + rw + 14, 222); ctx.lineTo(60 + rw, 280); ctx.lineTo(60, 280); ctx.closePath(); ctx.fill();
  ctx.fillStyle = c.won ? '#2b1a05' : '#e3e6f0'; ctx.fillText(res, 86, 266);
  ctx.font = '30px Jua, sans-serif'; ctx.fillStyle = 'rgba(255,255,255,.85)';
  ctx.fillText(`${c.day}일차에 끝남`, 60 + rw + 34, 264);

  // 내 캐릭터 (크게)
  if (c.me) {
    const m = c.me;
    if (meImg) {
      ctx.save(); ctx.shadowColor = 'rgba(0,0,0,.5)'; ctx.shadowBlur = 30; ctx.shadowOffsetY = 12;
      // 원본(작은 치비 그림)보다 너무 크게 키우면 흐려지므로 최대 2.8배
      const k = Math.min(470 / meImg.width, 520 / meImg.height, 2.8);
      const dw = meImg.width * k, dh = meImg.height * k;
      ctx.drawImage(meImg, 795 - dw / 2, 700 - dh, dw, dh);
      ctx.restore();
    }
    // 이름표
    ctx.font = '46px Jua, sans-serif';
    const role = `${m.role}`;
    const bw = Math.max(ctx.measureText(role).width, 220) + 60;
    const bx = 795 - bw / 2, by = 690;
    ctx.fillStyle = TEAM[m.team] ?? '#888'; round(ctx, bx, by, bw, 104, 18); ctx.fill();
    ctx.fillStyle = '#fff'; ctx.textAlign = 'center';
    ctx.fillText(role, 795, by + 52);
    ctx.font = '700 24px "Noto Sans KR", sans-serif'; ctx.fillStyle = 'rgba(255,255,255,.9)';
    ctx.fillText(fit(ctx, `${m.name} · ${m.job}`, bw - 30), 795, by + 88);
    ctx.textAlign = 'left';
    if (m.mvp && star) { ctx.drawImage(star, bx + bw - 44, by - 40, 76, 76); }
  }

  // 최고의 플레이어
  let y = 330;
  if (c.mvp.length) {
    ctx.fillStyle = 'rgba(20,22,40,.78)'; round(ctx, 56, y, 470, 120, 20); ctx.fill();
    if (star) ctx.drawImage(star, 74, y + 22, 76, 76);
    ctx.fillStyle = '#ffd38a'; ctx.font = '700 22px "Noto Sans KR", sans-serif'; ctx.fillText('최고의 플레이어', 166, y + 46);
    ctx.fillStyle = '#fff'; ctx.font = '38px Jua, sans-serif'; ctx.fillText(fit(ctx, c.mvp.join(', '), 340), 166, y + 94);
    y += 150;
  }
  // 생존 · 승리 요약
  const winN = c.players.filter((p) => p.won).length;
  ctx.fillStyle = 'rgba(255,255,255,.85)'; ctx.font = '30px Jua, sans-serif';
  ctx.fillText(`${c.players.length}명 참가 · 승리 ${winN}명 · 생존 ${c.players.filter((p) => p.alive).length}명`, 60, y + 30);

  // 모두의 정체
  const top = 820;
  ctx.fillStyle = '#ffd38a'; ctx.font = '700 22px "Noto Sans KR", sans-serif'; ctx.fillText('가면 아래 정체', 60, top - 18);
  const cols = 4, gap = 14, cw = (W - 120 - gap * (cols - 1)) / cols, ch = 112;
  c.players.slice(0, 12).forEach((p, i) => {
    const x = 60 + (i % cols) * (cw + gap), yy = top + Math.floor(i / cols) * (ch + gap);
    ctx.fillStyle = p.self ? 'rgba(255,182,72,.22)' : 'rgba(255,255,255,.07)';
    round(ctx, x, yy, cw, ch, 14); ctx.fill();
    ctx.fillStyle = TEAM[p.team] ?? '#888'; ctx.fillRect(x, yy + 12, 6, ch - 24);
    const im = pImgs[i];
    if (im) {
      ctx.save(); if (!p.alive) { ctx.globalAlpha = 0.45; ctx.filter = 'grayscale(1)'; }
      contain(ctx, im, x + 12, yy + 6, 78, ch - 12);
      ctx.restore();
    }
    ctx.fillStyle = '#fff'; ctx.font = '28px Jua, sans-serif';
    ctx.fillText(fit(ctx, p.role, cw - 106), x + 96, yy + 44);
    ctx.fillStyle = 'rgba(255,255,255,.7)'; ctx.font = '700 19px "Noto Sans KR", sans-serif';
    ctx.fillText(fit(ctx, p.name, cw - 106), x + 96, yy + 74);
    ctx.font = '700 16px "Noto Sans KR", sans-serif';
    ctx.fillStyle = p.alive ? '#9be37a' : '#8890b0';
    ctx.fillText(p.alive ? '생존' : '사망', x + 96, yy + 98);
    if (p.won) { ctx.fillStyle = '#ffb648'; ctx.fillText('WIN', x + 150, yy + 98); }
    if (p.mvp && star) ctx.drawImage(star, x + cw - 40, yy + 8, 32, 32);
  });

  // 아래
  ctx.fillStyle = 'rgba(255,255,255,.55)'; ctx.font = '700 22px "Noto Sans KR", sans-serif';
  ctx.fillText(`${location.host} · ${new Date().toLocaleDateString('ko-KR')}`, 60, H - 40);
  ctx.textAlign = 'right'; ctx.fillText('비공식 팬게임', W - 60, H - 40); ctx.textAlign = 'left';
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

