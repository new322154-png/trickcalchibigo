/**
 * 첫 화면 — "제4의 벽" 스마트폰 홈 화면.
 *
 * 웹 브라우저는 사용자가 한 번 누르기 전까지 소리를 못 내므로,
 * 게임 시작 전에 스마트폰 홈 화면을 띄워 두고 "게임 앱"을 누르게 해서 자연스럽게 첫 클릭을 받는다.
 *   · 서비스 종료된 앱들: 누르면 흔들리고 "서비스가 종료된 앱입니다"
 *   · 트릭컬 파티마: 누르면 빅우드가 떠오르고 "스마트폰으로 돌아가기"
 *   · 이 게임: 누르면 앱이 열리듯 확대 → 팬메이드 로고가 톡 튀어오름 → 타이틀
 * 내용(앱 목록·문구)은 config.yaml 의 boot: 에서 바꾼다.
 */
import { C, cfg } from '../engine/content';
import { isTodo, sleep } from '../engine/util';
import { asset, clear, h, layer } from './dom';
import { setHudVisible } from './hud';
import { sfx } from './sfx';
import { setAmbient } from './effects';

interface BootApp {
  id: string;
  name: string;
  icon: string;
  kind: 'closed' | 'bigwood' | 'game';
}

const DEFAULT_APPS: BootApp[] = [
  { id: 'paint_heroes', name: '페인트 히어로즈', icon: 'icon_paint_heroes.jpg', kind: 'closed' },
  { id: 'log', name: '로그(LOG) - 항해의 시작', icon: 'icon_log.jpg', kind: 'closed' },
  { id: 'roll_the_chess', name: '롤 더 체스', icon: 'icon_roll_the_chess.jpg', kind: 'closed' },
  { id: 'black_citadel', name: '블랙 시타델', icon: 'icon_black_citadel.jpg', kind: 'closed' },
  { id: 'tingting_space', name: '팅팅 스페이스', icon: 'icon_tingting_space.jpg', kind: 'closed' },
  { id: 'lifting_nut', name: '리프팅 너트', icon: 'icon_lifting_nut.jpg', kind: 'closed' },
  { id: 'nyangbung', name: '날아라! 냥붕', icon: 'icon_nyangbung.jpg', kind: 'closed' },
  { id: 'fatima', name: '트릭컬 파티마', icon: 'icon_trickcal_fatima.jpg', kind: 'bigwood' },
  { id: 'game', name: '', icon: 'icon_game.jpg', kind: 'game' },
];

const s = (v: unknown, fb: string) => (typeof v === 'string' && v && !isTodo(v) ? v : fb);

/** 스테이지 좌표(1920×1080 기준)로 요소의 가운데 */
function centerInStage(el: Element) {
  const stage = document.getElementById('stage')!.getBoundingClientRect();
  const r = el.getBoundingClientRect();
  const k = stage.width / 1920;
  return { x: (r.left + r.width / 2 - stage.left) / k, y: (r.top + r.height / 2 - stage.top) / k, w: r.width / k };
}

export function showBoot(onDone: () => void) {
  if (!cfg('boot.enabled', true) || /[?&]skip(intro)?\b/.test(location.search)) return onDone();
  setHudVisible(false);
  (layer('dialogue').querySelector('.dlg-box') as HTMLElement)?.classList.add('hidden');
  setAmbient('none');
  const root = clear(layer('modal'));
  const apps: BootApp[] = (cfg('boot.apps', null) as BootApp[] | null) ?? DEFAULT_APPS;
  const gameTitle = s(C.game.title, '트릭컬 더 할로윈');

  // ── 시계 ──
  const now = () => {
    const d = new Date();
    const hm = `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
    const days = ['일', '월', '화', '수', '목', '금', '토'];
    return { hm, date: `${d.getMonth() + 1}월 ${d.getDate()}일 ${days[d.getDay()]}요일` };
  };
  const t0 = now();
  const statusTime = h('span.ph-time', t0.hm);
  const clockBig = h('div.ph-clock', t0.hm);
  const clockDate = h('div.ph-date', t0.date);
  const tick = window.setInterval(() => {
    const n = now();
    statusTime.textContent = n.hm;
    clockBig.textContent = n.hm;
    clockDate.textContent = n.date;
  }, 10_000);

  const toastBox = h('div.ph-toast');
  let toastTimer = 0;
  const phoneToast = (msg: string) => {
    toastBox.textContent = msg;
    toastBox.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => toastBox.classList.remove('show'), 1700);
  };

  let busy = false;
  const grid = h('div.ph-grid');
  for (const app of apps) {
    const label = app.kind === 'game' ? s(app.name, gameTitle) : app.name;
    const btn = h(
      `button.ph-app.${app.kind}`,
      {
        onclick: () => {
          if (busy) return;
          if (app.kind === 'closed') {
            btn.classList.remove('wiggle');
            void btn.offsetWidth;
            btn.classList.add('wiggle');
            sfx('wrong');
            phoneToast(s(cfg('boot.closed_toast', ''), '서비스가 종료된 앱입니다.'));
          } else if (app.kind === 'bigwood') {
            void openBigwood(btn);
          } else {
            void launchGame(btn);
          }
        },
      },
      h('span.ph-icon', h('img', { src: asset(`ui/boot/${app.icon}`), alt: '' })),
      h('span.ph-label', label),
    );
    grid.appendChild(btn);
  }

  const screen = h(
    'div.ph-screen',
    { style: { backgroundImage: `url(${asset(s(cfg('boot.wallpaper', ''), 'ui/title_bg.jpg'))})` } },
    h('div.ph-status', statusTime, h('span.ph-sys', h('i.sig'), h('i.wifi'), h('i.bat'))),
    h('div.ph-widget', clockBig, clockDate),
    grid,
    h('div.ph-dots', h('i.on'), h('i'), h('i')),
    toastBox,
  );
  const phone = h('div.ph', screen, h('img.ph-frame', { src: asset('ui/boot/phone_frame.png'), alt: '' }));
  const hint = h('div.boot-hint', s(cfg('boot.hint', ''), '앱을 눌러 게임을 시작하세요'));
  const wrap = h('div.boot', phone, hint);
  wrap.style.setProperty('--boot-bg', `url("${new URL(asset(s(cfg('boot.wallpaper', ''), 'ui/title_bg.jpg')), location.href).href}")`);
  root.appendChild(wrap);

  // 데스크톱: Enter 로 바로 게임 앱
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      const g = grid.querySelector('.ph-app.game') as HTMLElement | null;
      g?.click();
    }
  };
  window.addEventListener('keydown', onKey);

  // 앱이 열리듯 아이콘 자리에서 확대되는 판
  const zoomFrom = (btn: Element, panel: HTMLElement) => {
    const c = centerInStage(btn.querySelector('.ph-icon')!);
    panel.style.transformOrigin = `${c.x}px ${c.y}px`;
    wrap.appendChild(panel);
    return panel.animate(
      [
        { transform: `scale(${c.w / 1920})`, opacity: 0.3, borderRadius: '40%' },
        { transform: 'scale(1)', opacity: 1, borderRadius: '0' },
      ],
      { duration: 420, easing: 'cubic-bezier(.2,.8,.2,1)', fill: 'both' },
    );
  };

  async function openBigwood(btn: Element) {
    busy = true;
    sfx('open');
    const back = h('button.btn.bw-back', s(cfg('boot.bigwood_back', ''), '스마트폰으로 돌아가기'));
    const panel = h('div.boot-panel.bigwood', h('img.bw-img', { src: asset(`ui/boot/${s(cfg('boot.bigwood_image', ''), 'bigwood.jpg')}`), alt: '' }), back);
    await zoomFrom(btn, panel).finished;
    busy = false;
    back.onclick = async () => {
      busy = true;
      sfx('close');
      const c = centerInStage(btn.querySelector('.ph-icon')!);
      await panel.animate(
        [{ transform: 'scale(1)', opacity: 1 }, { transform: `scale(${c.w / 1920})`, opacity: 0 }],
        { duration: 320, easing: 'cubic-bezier(.5,0,.8,.4)', fill: 'both' },
      ).finished;
      panel.remove();
      busy = false;
    };
  }

  async function launchGame(btn: Element) {
    busy = true;
    sfx('open');
    const logo = h('img.splash-logo', { src: asset(`ui/boot/${s(cfg('boot.splash_image', ''), 'fanmade.jpg')}`), alt: '' });
    const panel = h('div.boot-panel.splash', logo);
    await zoomFrom(btn, panel).finished;
    await sleep(250);
    logo.classList.add('pop');
    sfx('pop');
    await sleep(Number(cfg('boot.splash_seconds', 1.8)) * 1000);
    panel.classList.add('fade-black');
    await sleep(650);
    clearInterval(tick);
    window.removeEventListener('keydown', onKey);
    onDone();
  }
}
