/**
 * 배경, 캐릭터, CG, 화면 효과.
 * 캐릭터 그림:  public/assets/characters/{id}/{감정}.{gif|webp|png}
 * 그림이 없으면 이름과 감정을 적은 임시 카드가 대신 뜬다.
 */
import { C, cfg, charName, emotionKey } from '../engine/content';
import { S } from '../engine/state';
import { orDefault, sleep } from '../engine/util';
import { asset, clear, h, imageWithFallback, layer } from './dom';

const POSITIONS: Record<string, number> = {
  farleft: 12, left: 25, center: 50, right: 75, farright: 88,
  왼쪽: 25, 가운데: 50, 오른쪽: 75,
};

// ── 배경 ──
export function setBg(name: string) {
  S.stage.bg = name;
  const el = clear(layer('bg'));
  if (!name || name === 'none') return;
  if (name === 'black') {
    el.style.background = '#000';
    return;
  }
  el.style.background = '';
  const img = h('img.bg-img') as HTMLImageElement;
  imageWithFallback(img, `bg/${name}`, ['png', 'jpg', 'webp'], () => {
    img.replaceWith(h('div.bg-missing', `배경 없음: assets/bg/${name}`));
  });
  el.appendChild(img);
}

export function setCg(name: string) {
  S.stage.cg = name;
  const el = clear(layer('cg'));
  if (!name || name === 'none') return;
  const img = h('img.cg-img') as HTMLImageElement;
  imageWithFallback(img, `cg/${name}`, ['png', 'jpg', 'webp'], () => {
    img.replaceWith(h('div.bg-missing', `CG 없음: assets/cg/${name}`));
  });
  el.appendChild(img);
}

// ── 캐릭터 ──
const talkAvailable = new Map<string, boolean>();

export function spritePath(id: string, emotion: string, talk = false) {
  const ext = cfg('characters.ext', 'gif');
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
  el.dataset.emotion = st.emotion;
  checkTalk(id, st.emotion);
  const img = h('img') as HTMLImageElement;
  img.src = asset(spritePath(id, st.emotion));
  img.onerror = () => {
    img.replaceWith(h('div.sprite-missing', charName(id), h('small', st.emotion)));
  };
  clear(el).appendChild(img);
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
