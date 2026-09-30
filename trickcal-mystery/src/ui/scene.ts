/**
 * 배경, 캐릭터, CG, 화면 효과.
 * 캐릭터 그림:  public/assets/characters/{id}/{감정}.{gif|webp|png}
 * 그림이 없으면 이름과 감정을 적은 임시 카드가 대신 뜬다.
 */
import { C, cfg, charName, emotionKey } from '../engine/content';
import { P, S, markSeen } from '../engine/state';
import { orDefault, sleep } from '../engine/util';
import { asset, clear, h, imageWithFallback, layer } from './dom';
import { sfx } from './sfx';

const POSITIONS: Record<string, number> = {
  farleft: 12, left: 25, center: 50, right: 75, farright: 88,
  왼쪽: 25, 가운데: 50, 오른쪽: 75,
};

// ── 배경 ──
/** 배경 바꾸기. 이전 배경 위로 새 배경이 부드럽게 겹쳐 나타난다. fallback: 그림이 없을 때 대신 쓸 배경 */
export function setBg(name: string, fallback?: string | string[]) {
  S.stage.bg = name;
  const el = layer('bg');
  if (!name || name === 'none') {
    clear(el);
    return;
  }
  if (name === 'black') {
    clear(el);
    el.style.background = '#000';
    return;
  }
  el.style.background = '';
  const old = [...el.children];
  const img = h('img.bg-img.entering') as HTMLImageElement;
  const show = () => {
    requestAnimationFrame(() => img.classList.remove('entering'));
    setTimeout(() => old.forEach((o) => o.remove()), 500);
  };
  img.addEventListener('load', show, { once: true });
  const missing = () => {
    const m = h('div.bg-missing', `배경 없음: assets/bg/${name}`);
    img.replaceWith(m);
    old.forEach((o) => o.remove());
  };
  // 그림이 없으면 대체 배경을 차례로 시도 (캐릭터 방 → 빈 객실 → 복도 …)
  // 대체 배경을 안 줬으면 locations.yaml 에서 이 배경을 쓰는 방의 bg_fallback 을 찾아 쓴다 (#bg:trial_room → dining 등)
  if (!fallback) {
    const list: string[] = [];
    let cur: string | undefined = name;
    while (cur) {
      const fb: string | undefined = Object.values(C.rooms).find((r) => r.bg === cur && r.bg_fallback)?.bg_fallback;
      if (!fb || list.includes(fb)) break;
      list.push(fb);
      cur = fb;
    }
    fallback = list;
  }
  const chain = (Array.isArray(fallback) ? fallback : fallback ? [fallback] : []).filter((f) => f && f !== name);
  const tryNext = (i: number) => {
    if (i >= chain.length) return missing();
    imageWithFallback(img, `bg/${chain[i]}`, ['jpg', 'png', 'webp'], () => tryNext(i + 1));
  };
  imageWithFallback(img, `bg/${name}`, ['jpg', 'png', 'webp'], () => tryNext(0));
  el.appendChild(img);
}

// ── 이동 연출 ──
// travel(): 지금 화면에서 떠나는 움직임 → (그 사이에 배경을 바꾸고) → arrive(): 새 화면에 도착하는 움직임
//   zoom:        문·통로를 향해 확대되며 어두워짐 (rect = 그 문 위치 %)
//   stairs_up:   계단을 오르듯 화면이 위아래로 흔들리며 어두워짐
//   stairs_down: 내려가듯
//   left/right:  옆으로 걸어가듯 밀려남
//   fade:        그냥 어두워졌다 밝아짐
export type TravelKind = 'zoom' | 'stairs_up' | 'stairs_down' | 'left' | 'right' | 'fade' | 'cut';

function travelFade() {
  const fx = layer('fx');
  let f = fx.querySelector('.travel-fade') as HTMLElement | null;
  if (!f) {
    f = h('div.travel-fade');
    fx.appendChild(f);
  }
  return f;
}

const moving = () => [layer('bg'), layer('chars'), layer('cg')];

export async function travel(kind: string = 'fade', rect?: [number, number, number, number]) {
  if (kind === 'cut') return;
  const f = travelFade();
  const targets = moving();
  const opts = { fill: 'forwards' as FillMode };
  if (kind === 'zoom') {
    const [x, y, w, hh] = rect ?? [40, 30, 20, 40];
    targets.forEach((t) => (t.style.transformOrigin = `${x + w / 2}% ${y + hh / 2}%`));
    sfx('door');
    targets.forEach((t) => t.animate([{ transform: 'scale(1)' }, { transform: 'scale(2.1)' }], { duration: 750, easing: 'cubic-bezier(.55,0,.85,.4)', ...opts }));
    f.animate([{ opacity: 0 }, { opacity: 0, offset: 0.35 }, { opacity: 1 }], { duration: 750, ...opts });
    await sleep(760);
  } else if (kind === 'stairs_up' || kind === 'stairs_down') {
    const d = kind === 'stairs_up' ? 1 : -1;
    const frames: Keyframe[] = [];
    for (let i = 0; i <= 8; i++) {
      const bob = i % 2 ? 16 : 2;
      frames.push({ transform: `translateY(${d * (bob + i * 6)}px) scale(${1 + i * 0.012})` });
    }
    targets.forEach((t) => t.animate(frames, { duration: 1100, easing: 'linear', ...opts }));
    for (let i = 0; i < 4; i++) setTimeout(() => sfx('step'), i * 260);
    f.animate([{ opacity: 0 }, { opacity: 0, offset: 0.45 }, { opacity: 1 }], { duration: 1100, ...opts });
    await sleep(1110);
  } else if (kind === 'left' || kind === 'right') {
    const d = kind === 'left' ? 1 : -1;
    for (let i = 0; i < 3; i++) setTimeout(() => sfx('step'), i * 200);
    targets.forEach((t) => t.animate([{ transform: 'translateX(0)' }, { transform: `translateX(${d * 240}px) scale(1.04)` }], { duration: 600, easing: 'ease-in', ...opts }));
    f.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 600, ...opts });
    await sleep(610);
  } else {
    f.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 350, ...opts });
    await sleep(360);
  }
}

export async function arrive(kind: string = 'fade') {
  if (kind === 'cut') return;
  const f = travelFade();
  const targets = moving();
  targets.forEach((t) => {
    t.getAnimations().forEach((a) => a.cancel());
    t.style.transformOrigin = '';
  });
  let dur = 450;
  if (kind === 'zoom') {
    targets.forEach((t) => t.animate([{ transform: 'scale(1.18)' }, { transform: 'scale(1)' }], { duration: 700, easing: 'cubic-bezier(.2,.7,.3,1)' }));
    dur = 600;
  } else if (kind === 'stairs_up' || kind === 'stairs_down') {
    const d = kind === 'stairs_up' ? 1 : -1;
    targets.forEach((t) => t.animate([{ transform: `translateY(${-d * 30}px)` }, { transform: `translateY(${d * 8}px)` }, { transform: 'translateY(0)' }], { duration: 700, easing: 'ease-out' }));
    dur = 600;
  } else if (kind === 'left' || kind === 'right') {
    const d = kind === 'left' ? 1 : -1;
    targets.forEach((t) => t.animate([{ transform: `translateX(${-d * 200}px)` }, { transform: 'translateX(0)' }], { duration: 600, easing: 'ease-out' }));
  }
  f.getAnimations().forEach((a) => a.cancel());
  f.animate([{ opacity: 1 }, { opacity: 0 }], { duration: dur, fill: 'forwards' });
  await sleep(dur);
  f.remove();
}

export function setCg(name: string) {
  S.stage.cg = name;
  markSeen('cgSeen', name);
  const el = clear(layer('cg'));
  if (!name || name === 'none') return;
  const img = h('img.cg-img') as HTMLImageElement;
  imageWithFallback(img, `cg/${name}`, ['jpg', 'png', 'webp'], () => {
    img.replaceWith(h('div.bg-missing', `CG 없음: assets/cg/${name}`));
  });
  el.appendChild(img);
}

// ── 캐릭터 ──
const talkAvailable = new Map<string, boolean>();

/** 캐릭터마다 실제로 찾은 확장자 (webp / gif / png 섞여 있어도 됨) */
const extOf = new Map<string, string>();
const EXTS = () => [...new Set([cfg('characters.ext', 'webp'), 'webp', 'gif', 'png'])];

export function spritePath(id: string, emotion: string, talk = false, extOverride?: string) {
  const ext = extOverride ?? extOf.get(id) ?? cfg('characters.ext', 'webp');
  // 움직임 끄기: 멈춘 그림(표정_still.webp) 사용
  if (!talk && P?.settings?.charMotion === false && ext === 'webp') return `characters/${id}/${emotion}_still.webp`;
  const suffix = talk ? cfg('characters.talk_suffix', '_talk') : '';
  return `characters/${id}/${emotion}${suffix}.${ext}`;
}

/** 말하는 모션 파일이 있는지 (확인 전이면 false, 확인은 백그라운드로 시작) */
export function hasTalkMotion(id: string, emotion: string) {
  checkTalk(id, emotion);
  return talkAvailable.get(`${id}/${emotion}`) === true;
}

function checkTalk(id: string, emotion: string) {
  const key = `${id}/${emotion}`;
  if (talkAvailable.has(key)) return;
  talkAvailable.set(key, false);
  const probe = new Image();
  probe.onload = () => talkAvailable.set(key, true);
  probe.src = asset(spritePath(id, emotion, true));
}

export function showChar(id: string, emotion?: string, pos?: string) {
  const def = C.characters[id];
  if (!def) {
    console.warn('[show] characters.yaml 에 없는 캐릭터:', id);
    return;
  }
  if (def.player && orDefault(def.show_sprite as any, false) !== true) return;
  const prev = S.stage.sprites[id];
  const emo = emotionKey(emotion ?? prev?.emotion);
  const position = pos ?? prev?.pos ?? 'center';
  S.stage.sprites[id] = { emotion: emo, pos: position };
  renderSprite(id);
}

export function setEmotion(id: string, emotion: string) {
  if (!S.stage.sprites[id]) return;
  S.stage.sprites[id].emotion = emotionKey(emotion);
  renderSprite(id);
}

export function hideChar(id: string) {
  delete S.stage.sprites[id];
  layer('chars').querySelector(`[data-id="${id}"]`)?.remove();
}

export function hideAll() {
  S.stage.sprites = {};
  clear(layer('chars'));
}

function renderSprite(id: string) {
  const st = S.stage.sprites[id];
  const chars = layer('chars');
  let el = chars.querySelector(`[data-id="${id}"]`) as HTMLElement | null;
  if (!el) {
    el = h('div.sprite', { 'data-id': id });
    chars.appendChild(el);
  }
  const x = POSITIONS[st.pos] ?? (Number.parseFloat(st.pos) || 50);
  el.style.left = x + '%';
  // 캐릭터 크기·서 있는 높이 (config.yaml characters.height / characters.bottom)
  el.style.height = `calc(${cfg('characters.height', '92%')} * ${C.characters[id]?.scale ?? 1})`;
  // sink: 옷자락이 발보다 아래로 늘어진 그림은 그만큼 내려서 발이 바닥에 닿게
  const sc = C.characters[id]?.scale ?? 1;
  const sink = (C.characters[id]?.sink ?? 0) / 100;
  el.style.bottom = sink ? `calc(${cfg('characters.bottom', '0%')} - ${cfg('characters.height', '92%')} * ${sc * sink})` : String(cfg('characters.bottom', '0%'));
  const motionKey = P?.settings?.charMotion === false ? 'still' : 'anim';
  // 같은 표정이 이미 떠 있으면 그림은 그대로 두고 위치만 바꾼다 (다시 불러오며 깜빡이는 것 방지)
  if (el.dataset.emotion === st.emotion && el.dataset.motion === motionKey && el.querySelector('img')) return;
  el.dataset.emotion = st.emotion;
  el.dataset.motion = motionKey;
  checkTalk(id, st.emotion);
  const img = h('img', { decoding: 'async' }) as HTMLImageElement;
  // 표정을 바꿀 때는 새 그림이 다 불러와진 뒤에 바꿔 끼운다 (그 사이 빈 화면·깜빡임 방지)
  const req = String((Number(el.dataset.req) || 0) + 1);
  el.dataset.req = req;
  const box = el;
  const old = [...box.children];
  const put = (node: Element) => {
    if (box.dataset.req !== req) return; // 그 사이 다른 표정으로 바뀜
    old.forEach((o) => o.remove());
    if (!node.isConnected) box.appendChild(node);
  };
  // 확장자를 차례로 시도 → 그 표정이 없으면 기본 표정 → 그것도 없으면 임시 표시
  const tries: [string, string][] = [];
  const exts = extOf.has(id) ? [extOf.get(id)!, ...EXTS().filter((e) => e !== extOf.get(id))] : EXTS();
  for (const emo of st.emotion === 'normal' ? ['normal'] : [st.emotion, 'normal']) for (const e of exts) tries.push([emo, e]);
  let n = 0;
  const next = () => {
    const t = tries[n++];
    if (!t) return put(h('div.sprite-missing', charName(id), h('small', st.emotion)));
    img.onload = () => {
      extOf.set(id, t[1]);
      // 그림을 다 풀어 둔 뒤에 바꿔 끼운다 (빈 칸이 한 프레임 보이며 깜빡이는 것 방지)
      img.decode().catch(() => {}).then(() => put(img));
    };
    img.src = asset(spritePath(id, t[0], false, t[1]));
  };
  img.onerror = next;
  next();
  if (!old.length) {
    // 처음 등장: 불러오는 동안은 숨겨 두었다가 준비되면 보이기
    img.style.visibility = 'hidden';
    img.addEventListener('load', () => img.decode().catch(() => {}).then(() => (img.style.visibility = '')), { once: true });
    box.appendChild(img);
  }
}

/** 대사가 출력되는 동안 말하는 모션으로 교체 (파일이 있을 때만) */
export function setTalking(id: string | undefined, talking: boolean) {
  const chars = layer('chars');
  if (cfg('characters.dim_listeners', true)) {
    chars.querySelectorAll<HTMLElement>('.sprite').forEach((s) => {
      s.classList.toggle('dim', !!id && s.dataset.id !== id);
    });
  }
  if (!id) return;
  const st = S.stage.sprites[id];
  const el = chars.querySelector(`[data-id="${id}"] img`) as HTMLImageElement | null;
  if (!st || !el) return;
  if (!talkAvailable.get(`${id}/${st.emotion}`)) return;
  el.src = asset(spritePath(id, st.emotion, talking));
}

/** 설정에서 움직임을 켜고 끌 때: 떠 있는 캐릭터 그림 다시 그리기 */
export function refreshSprites() {
  for (const id of Object.keys(S.stage.sprites)) renderSprite(id);
}

/** 불러오기 후 화면 복원 */
export function restoreStage() {
  setBg(S.stage.bg);
  setCg(S.stage.cg);
  clear(layer('chars'));
  for (const id of Object.keys(S.stage.sprites)) renderSprite(id);
}

// ── 효과 ──
export async function shake(power = 1) {
  const stage = document.getElementById('stage')!;
  stage.classList.remove('shake');
  void stage.offsetWidth;
  stage.style.setProperty('--shake', `${12 * power}px`);
  stage.classList.add('shake');
  await sleep(450);
  stage.classList.remove('shake');
}

export async function flash(color = '#fff') {
  const fx = layer('fx');
  const f = h('div.flash', { style: { background: color } });
  fx.appendChild(f);
  await sleep(400);
  f.remove();
}

export async function fade(toBlack: boolean, ms = 500) {
  const fx = layer('fx');
  let f = fx.querySelector('.fade') as HTMLElement | null;
  if (!f) {
    f = h('div.fade');
    fx.appendChild(f);
  }
  f.style.transition = `opacity ${ms}ms`;
  f.style.opacity = toBlack ? '1' : '0';
  await sleep(ms);
  if (!toBlack) f.remove();
}
