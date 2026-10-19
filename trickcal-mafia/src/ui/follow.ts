/**
 * 다른 사람 캐릭터 따라가기: 서버에서 위치가 띄엄띄엄(0.1~0.25초마다) 와도
 * 다음 위치가 올 때쯤 도착하도록 일정한 속도로 걸어가게 한다 (멈췄다 뛰었다 하지 않게).
 *  lead  : 몇 초에 걸쳐 따라잡을지 (업데이트 간격과 비슷하게)
 *  floor : 최소 속도, cap: 최대 속도 (멀리 순간이동했을 땐 빠르게)
 * 돌려주는 값: 지금 걷는 중인지 (잠깐 멈춰도 0.25초는 걷는 모습 유지 → 깜빡임 방지)
 */
export interface Follower { x: number; y: number; tx: number; ty: number; mv?: number }

export function follow(a: Follower, dt: number, now: number, lead: number, floor: number, cap: number, eps: number): boolean {
  const dx = a.tx - a.x, dy = a.ty - a.y;
  const d = Math.hypot(dx, dy);
  if (d <= eps) { a.x = a.tx; a.y = a.ty; }
  else {
    const speed = Math.max(floor, Math.min(cap, d / lead));
    const step = Math.min(d, speed * dt);
    a.x += (dx / d) * step;
    a.y += (dy / d) * step;
    a.mv = now;
  }
  return a.mv !== undefined && now - a.mv < 250;
}
