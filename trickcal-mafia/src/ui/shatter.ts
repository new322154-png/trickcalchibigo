/**
 * 화면이 유리처럼 깨지는 연출 (캔버스 한 장).
 * 맞은 곳(at)을 중심으로 바퀴살 + 고리 모양 조각으로 나눠 두고 (이음매는 공유해서 붙어 있으면 한 장의 그림)
 *   ① 맞은 곳부터 금이 단계적으로 번짐 → ② 군데군데 조각이 떨어져 나감 → ③ 와장창 전부 산산조각
 * 조각마다 클립해서 같은 그림을 그리므로 DOM 레이어를 늘리지 않는다 (휴대폰도 가볍게).
 * 시간(초)은 그림이 준비된 순간부터 잰다.
 */
export interface ShatterPlan {
  /** 맞은 곳 (화면 비율 0~1) */
  at: { x: number; y: number };
  /** [시각, 금 반경(맞은 곳에서 가장 먼 모서리까지를 1로)] — 시각마다 금이 한 번씩 더 번짐 */
  cracks: [number, number][];
  /** 군데군데 떨어지는 때 [시작, 끝]과 떨어지는 조각 비율 */
  drip: [number, number, number];
  /** 와장창 */
  burst: number;
  /** 첫 타격 뒤 멈칫(히트스톱) 길이 — 이 동안 화면 속 시간이 멈춤. 이후 시각은 이만큼 뒤로 밀림 */
  hitStop?: number;
}
export type ShatterEvent = 'crack' | 'drop' | 'burst' | 'done';
export interface ShatterCtl {
  /** 화면에 떠 있는 그림(예: 유리를 친 캐릭터)을 지금 보이는 자리 그대로 깨질 그림에 찍어 넣음 */
  bake(im: HTMLImageElement): void;
  stop(): void;
}

interface Shard {
  pts: [number, number][]; clip: [number, number][]; cx: number; cy: number; dx: number; dy: number; dist: number; rmax: number;
  spin: number; speed: number; drop: number; burstAt: number;
}

const clamp = (v: number, a = 0, b = 1) => Math.max(a, Math.min(b, v));
const rnd = (a: number, b: number) => a + Math.random() * (b - a);
/** 미리보기 녹화용 느린 재생 (평소 1). 캔버스는 rAF 시각을 따르므로 setTimeout 에만 쓴다 */
export const cutSpeed = () => (window as unknown as { __cutSpeed?: number }).__cutSpeed ?? 1;

export function shatter(cv: HTMLCanvasElement, src: string, P: ShatterPlan, on: { ready?: () => void; event?: (e: ShatterEvent, i: number) => void } = {}): ShatterCtl {
  const r = cv.getBoundingClientRect();
  const k = Math.min(2, window.devicePixelRatio || 1);
  const W = Math.max(2, Math.round(r.width * k)), H = Math.max(2, Math.round(r.height * k));
  cv.width = W; cv.height = H;
  const ctx = cv.getContext('2d')!;
  const C = { x: W * P.at.x, y: H * P.at.y };
  const D = Math.max(...[[0, 0], [W, 0], [0, H], [W, H]].map(([x, y]) => Math.hypot(x - C.x, y - C.y)));

  // ── 조각 나누기: 맞은 곳 가까이는 잘게, 멀수록 크게 ──
  const N = 13;
  const step = (Math.PI * 2) / N;
  const ang = Array.from({ length: N }, (_, j) => j * step + rnd(-0.28, 0.28) * step);
  const RADII = [0, 0.05, 0.13, 0.25, 0.42, 0.66, 1.3];
  const last = RADII.length - 1;
  const V: [number, number][][] = RADII.map((rr, i) => ang.map((a) => {
    const j = i === 0 || i === last ? 1 : rnd(0.8, 1.2);
    const aj = i === 0 || i === last ? a : a + rnd(-0.12, 0.12) * step;
    return [C.x + Math.cos(aj) * rr * D * j, C.y + Math.sin(aj) * rr * D * j] as [number, number];
  }));
  const shards: Shard[] = [];
  const [d0, d1, frac] = P.drip;
  const add = (pts: [number, number][], ring: number) => {
    const cx = pts.reduce((s, p) => s + p[0], 0) / pts.length, cy = pts.reduce((s, p) => s + p[1], 0) / pts.length;
    const vx = cx - C.x, vy = cy - C.y, d = Math.hypot(vx, vy) || 1;
    const rmax = Math.max(...pts.map((q) => Math.hypot(q[0] - C.x, q[1] - C.y))) / D;
    // 맞은 곳 근처 조각일수록 먼저, 자주 떨어짐 (불규칙)
    const dropOk = ring >= 1 && ring <= 4 && Math.random() < frac * (ring <= 2 ? 1.5 : 0.8);
    // 그릴 때는 1px 남짓 부풀려서 조각 사이 이음매(안티에일리어싱 실선)가 안 보이게
    const clip = pts.map(([x, y]) => { const ex = x - cx, ey = y - cy, l = Math.hypot(ex, ey) || 1; return [x + (ex / l) * 1.2 * k, y + (ey / l) * 1.2 * k] as [number, number]; });
    shards.push({
      pts, clip, cx, cy, dx: vx / d, dy: vy / d, dist: d / D, rmax,
      spin: rnd(-2.6, 2.6), speed: rnd(0.5, 1.2),
      drop: dropOk ? rnd(d0, d1) : Infinity,
      burstAt: P.burst + (d / D) * 0.14 + rnd(0, 0.07),
    });
  };
  for (let j = 0; j < N; j++) {
    const j2 = (j + 1) % N;
    add([[C.x, C.y], V[1][j], V[1][j2]], 0);
    for (let i = 1; i < last; i++) {
      const a = V[i][j], b = V[i][j2], c = V[i + 1][j2], d = V[i + 1][j];
      if (i >= 3) { if (Math.random() < 0.5) { add([a, b, c], i); add([a, c, d], i); } else { add([a, b, d], i); add([b, c, d], i); } }
      else add([a, b, c, d], i);
    }
  }
  // 떨어지는 차례를 시간순으로 (소리 내려고)
  const drops = shards.filter((s) => s.drop < Infinity).sort((a, b) => a.drop - b.drop);

  // ── 그림은 화면 크기에 맞춰 한 번만 그려 둠 ──
  const bg = document.createElement('canvas');
  bg.width = W; bg.height = H;
  const g = bg.getContext('2d')!;
  const img = new Image();
  let ready = false;
  img.onload = () => {
    const s = Math.max(W / img.width, H / img.height);
    g.drawImage(img, (W - img.width * s) / 2, (H - img.height * s) / 2, img.width * s, img.height * s);
    ready = true;
    on.ready?.();
  };
  img.src = src;

  // 금 반경: 단계마다 0.16초에 걸쳐 번짐
  const crackR = (t: number) => {
    let rr = 0, prev = 0;
    for (const [at, to] of P.cracks) {
      if (t < at) break;
      rr = prev + (to - prev) * clamp((t - at) / 0.16);
      prev = to;
    }
    return rr;
  };
  // 흔들림: 첫 타격은 크고 길게, 금이 번질 때마다 조금, 와장창은 가장 세게 (감쇠)
  const shake = (t: number) => {
    const hit = (at: number, len: number, amp: number) => (t >= at && t < at + len ? Math.pow(1 - (t - at) / len, 2) * amp * k : 0);
    let a = 0;
    P.cracks.forEach(([at], i) => { a = Math.max(a, hit(at, i === 0 ? 0.45 : 0.22, i === 0 ? 26 : 11)); });
    return Math.max(a, hit(P.burst, 0.4, 30));
  };

  // 유리 가루: 맞은 곳에서 튀는 작은 파편
  interface Bit { x: number; y: number; vx: number; vy: number; r: number; vr: number; s: number; born: number; life: number }
  const bits: Bit[] = [];
  const spray = (n: number, t: number, x: number, y: number, power: number, spread = 0) => {
    for (let i = 0; i < n; i++) {
      const a = rnd(0, Math.PI * 2), v = rnd(0.25, 1) * power * D;
      bits.push({ x: x + rnd(-spread, spread), y: y + rnd(-spread, spread), vx: Math.cos(a) * v, vy: Math.sin(a) * v - rnd(0, 0.2) * D,
        r: rnd(0, 6), vr: rnd(-14, 14), s: rnd(2.5, 8) * k, born: t, life: rnd(0.45, 0.9) });
    }
  };

  let t0 = 0, raf = 0, alive = true;
  let ci = 0, di = 0, burstFired = false;
  const frame = (now: number) => {
    if (!alive) return;
    if (!ready) { raf = requestAnimationFrame(frame); return; }
    if (!t0) t0 = now;
    // 히트스톱: 첫 타격 직후 잠깐 시간이 멈춘다
    const raw = (now - t0) / 1000, hs = P.hitStop ?? 0, h0 = P.cracks[0]?.[0] ?? Infinity;
    const t = raw <= h0 ? raw : raw < h0 + hs ? h0 : raw - hs;
    while (ci < P.cracks.length && t >= P.cracks[ci][0]) {
      spray(ci === 0 ? 46 : 12, t, C.x, C.y, ci === 0 ? 0.9 : 0.5);
      on.event?.('crack', ci++);
    }
    while (di < drops.length && t >= drops[di].drop) on.event?.('drop', di++);
    if (!burstFired && t >= P.burst) { burstFired = true; spray(90, t, C.x, C.y, 1.3, 0.3 * D); on.event?.('burst', 0); }
    ctx.clearRect(0, 0, W, H);
    const cr = crackR(t);
    const sk = shake(t);
    const sx = sk ? rnd(-0.5, 0.5) * sk : 0, sy = sk ? rnd(-0.5, 0.5) * sk : 0;
    let left = 0;
    for (const s of shards) {
      // 떨어짐(군데군데) 또는 와장창 중 먼저 오는 것
      const dropping = s.drop <= s.burstAt;
      const start = dropping ? s.drop : s.burstAt;
      const dur = dropping ? 1.0 : 0.8;
      const p = clamp((t - start) / dur);
      if (p >= 1) continue;
      left++;
      const cracked = s.rmax <= cr + 0.001;
      const gap = cracked ? 0.004 * D : 0; // 금 간 틈이 살짝 벌어져 뒤가 비침
      let ox: number, oy: number, rot: number, sc: number;
      if (dropping) {
        // 툭 떨어짐: 아래로 (중력) + 살짝 바깥, 빙그르
        ox = s.dx * (gap + 0.03 * D * p); oy = s.dy * gap + 0.9 * H * p * p;
        rot = s.spin * p * 0.8; sc = 1 + 0.08 * p;
      } else {
        // 와장창: 맞은 곳에서 바깥으로 튀어 나오며 화면 쪽으로
        const fly = (0.45 + s.speed * 0.8) * D * p;
        ox = s.dx * (gap + fly); oy = s.dy * (gap + fly) + 0.5 * H * p * p;
        rot = s.spin * p * 1.6; sc = 1 + 0.55 * p;
      }
      ctx.save();
      ctx.globalAlpha = dropping ? 1 - Math.pow(p, 3) : 1 - Math.pow(p, 0.9);
      ctx.translate(s.cx + ox + sx, s.cy + oy + sy);
      ctx.rotate(rot);
      ctx.scale(sc, sc);
      ctx.translate(-s.cx, -s.cy);
      const path = (q: [number, number][]) => { ctx.beginPath(); q.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.closePath(); };
      path(cracked || p > 0 ? s.pts : s.clip);
      ctx.save();
      ctx.clip();
      ctx.drawImage(bg, 0, 0);
      if (p > 0) { ctx.fillStyle = `rgba(255,240,240,${0.16 * (1 - p)})`; ctx.fillRect(0, 0, W, H); }
      ctx.restore();
      if (cracked || p > 0) {
        path(s.pts);
        ctx.lineJoin = 'round';
        ctx.strokeStyle = 'rgba(20,0,4,.45)'; ctx.lineWidth = 3 * k; ctx.stroke();
        ctx.strokeStyle = 'rgba(255,248,248,.92)'; ctx.lineWidth = 1.2 * k; ctx.stroke();
      }
      ctx.restore();
    }
    // 유리 가루
    for (let i = bits.length - 1; i >= 0; i--) {
      const b = bits[i], age = t - b.born;
      if (age > b.life) { bits.splice(i, 1); continue; }
      const x = b.x + b.vx * age + sx, y = b.y + b.vy * age + 0.9 * D * age * age + sy;
      ctx.save();
      ctx.globalAlpha = 1 - age / b.life;
      ctx.translate(x, y); ctx.rotate(b.r + b.vr * age);
      ctx.beginPath(); ctx.moveTo(0, -b.s); ctx.lineTo(b.s * 0.8, b.s * 0.6); ctx.lineTo(-b.s * 0.7, b.s * 0.5); ctx.closePath();
      ctx.fillStyle = 'rgba(235,245,255,.85)'; ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,1)'; ctx.lineWidth = 0.8 * k; ctx.stroke();
      ctx.restore();
    }
    if (left === 0 && bits.length === 0 && t > P.burst) { alive = false; ctx.clearRect(0, 0, W, H); on.event?.('done', 0); return; }
    raf = requestAnimationFrame(frame);
  };
  raf = requestAnimationFrame(frame);
  return {
    bake(im) {
      if (!ready || !im.complete) return;
      const cr = cv.getBoundingClientRect(), ir = im.getBoundingClientRect();
      const sx = W / cr.width, sy = H / cr.height;
      g.drawImage(im, (ir.left - cr.left) * sx, (ir.top - cr.top) * sy, ir.width * sx, ir.height * sy);
    },
    stop() { alive = false; cancelAnimationFrame(raf); },
  };
}
