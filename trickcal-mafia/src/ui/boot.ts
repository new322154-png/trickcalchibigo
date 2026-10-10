/**
 * 첫 화면 — "제4의 벽" 스마트폰 홈 화면 (트릭컬 더 할로윈에서 가져옴).
 * 게임 앱을 눌러야 들어가서, 브라우저의 "첫 클릭 전에는 소리 금지"도 자연스럽게 넘긴다.
 */
import { asset, clear, h, sleep } from './dom';
import { preloadSfx, sfx } from './sfx';
import { GAME_TITLE } from './title';

interface BootApp { name: string; icon: string; kind: 'closed' | 'bigwood' | 'game' }

const APPS: BootApp[] = [
  { name: '페인트 히어로즈', icon: 'icon_paint_heroes.jpg', kind: 'closed' },
  { name: '로그(LOG) - 항해의 시작', icon: 'icon_log.jpg', kind: 'closed' },
  { name: '롤 더 체스', icon: 'icon_roll_the_chess.jpg', kind: 'closed' },
  { name: '블랙 시타델', icon: 'icon_black_citadel.jpg', kind: 'closed' },
  { name: '팅팅 스페이스', icon: 'icon_tingting_space.jpg', kind: 'closed' },
  { name: '리프팅 너트', icon: 'icon_lifting_nut.jpg', kind: 'closed' },
  { name: '날아라! 냥붕', icon: 'icon_nyangbung.jpg', kind: 'closed' },
  { name: '트릭컬 파티마', icon: 'icon_trickcal_fatima.jpg', kind: 'bigwood' },
  { name: '', icon: 'icon_game.jpg', kind: 'game' },
];

function centerIn(root: HTMLElement, el: Element) {
  const s = root.getBoundingClientRect();
  const r = el.getBoundingClientRect();
  const k = s.width / 1920;
  return { x: (r.left + r.width / 2 - s.left) / k, y: (r.top + r.height / 2 - s.top) / k, w: r.width / k };
}

export function showBoot(root: HTMLElement, onDone: () => void) {
  if (/[?&]skip\b/.test(location.search)) return onDone();
  preloadSfx(['pop']);
  clear(root);
  const now = () => {
    const d = new Date();
    const days = ['일', '월', '화', '수', '목', '금', '토'];
    return { hm: `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`, date: `${d.getMonth() + 1}월 ${d.getDate()}일 ${days[d.getDay()]}요일` };
  };
  const t0 = now();
  const statusTime = h('span.ph-time', t0.hm);
  const clockBig = h('div.ph-clock', t0.hm);
  const clockDate = h('div.ph-date', t0.date);
  const tick = window.setInterval(() => {
    const n = now();
    statusTime.textContent = clockBig.textContent = n.hm;
    clockDate.textContent = n.date;
  }, 10_000);
  const toastBox = h('div.ph-toast');
  let toastTimer = 0;
  const toast = (msg: string) => {
    toastBox.textContent = msg;
    toastBox.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => toastBox.classList.remove('show'), 1700);
  };

  let busy = false;
  const grid = h('div.ph-grid');
  for (const app of APPS) {
    const btn: HTMLElement = h(`button.ph-app.${app.kind}`, {
      onclick: () => {
        if (busy) return;
        if (app.kind === 'closed') {
          btn.classList.remove('wiggle');
          void btn.offsetWidth;
          btn.classList.add('wiggle');
          sfx('wrong');
          toast('서비스가 종료된 앱입니다.');
        } else if (app.kind === 'bigwood') void openBigwood(btn);
        else void launch(btn);
      },
    }, h('span.ph-icon', h('img', { src: asset(`ui/boot/${app.icon}`), alt: '' })), h('span.ph-label', app.name || GAME_TITLE));
    grid.appendChild(btn);
  }
  const screen = h('div.ph-screen', { style: { backgroundImage: `url(${asset('ui/boot/wallpaper.jpg')})` } },
    h('div.ph-status', statusTime, h('span.ph-sys', h('i.sig'), h('i.wifi'), h('i.bat'))),
    h('div.ph-widget', clockBig, clockDate), grid, h('div.ph-dots', h('i.on'), h('i'), h('i')), toastBox);
  const phone = h('div.ph', screen, h('img.ph-frame', { src: asset('ui/boot/phone_frame.png'), alt: '' }));
  const wrap = h('div.boot', phone, h('div.boot-hint', '앱을 눌러 게임을 시작하세요'));
  wrap.style.setProperty('--boot-bg', `url("${new URL(asset('ui/title_bg.jpg'), location.href).href}")`);
  root.appendChild(wrap);

  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') (grid.querySelector('.ph-app.game') as HTMLElement | null)?.click();
  };
  window.addEventListener('keydown', onKey);

  const zoomFrom = (btn: Element, panel: HTMLElement) => {
    const c = centerIn(root, btn.querySelector('.ph-icon')!);
    panel.style.transformOrigin = `${c.x}px ${c.y}px`;
    wrap.appendChild(panel);
    return panel.animate(
      [{ transform: `scale(${c.w / 1920})`, opacity: 0.3, borderRadius: '40%' }, { transform: 'scale(1)', opacity: 1, borderRadius: '0' }],
      { duration: 420, easing: 'cubic-bezier(.2,.8,.2,1)', fill: 'both' },
    );
  };

  async function openBigwood(btn: Element) {
    busy = true;
    sfx('open');
    const back = h('button.btn.bw-back', '스마트폰으로 돌아가기');
    const panel = h('div.boot-panel.bigwood', h('img.bw-img', { src: asset('ui/boot/bigwood.jpg'), alt: '' }), back);
    await zoomFrom(btn, panel).finished;
    busy = false;
    back.onclick = async () => {
      busy = true;
      sfx('close');
      const c = centerIn(root, btn.querySelector('.ph-icon')!);
      await panel.animate([{ transform: 'scale(1)', opacity: 1 }, { transform: `scale(${c.w / 1920})`, opacity: 0 }], { duration: 320, easing: 'cubic-bezier(.5,0,.8,.4)', fill: 'both' }).finished;
      panel.remove();
      busy = false;
    };
  }

  async function launch(btn: Element) {
    busy = true;
    if (matchMedia('(pointer: coarse)').matches) void document.documentElement.requestFullscreen?.().catch(() => {});
    sfx('open');
    const logo = h('img.splash-logo', { src: asset('ui/boot/fanmade.png'), alt: '' });
    const panel = h('div.boot-panel.splash', logo);
    await zoomFrom(btn, panel).finished;
    await sleep(250);
    logo.classList.add('pop');
    sfx('pop');
    await sleep(1800);
    await Promise.all([
      logo.animate([{ opacity: 1, transform: 'scale(1)' }, { opacity: 0, transform: 'scale(.96)' }], { duration: 450, easing: 'ease-in', fill: 'forwards' }).finished,
      panel.animate([{ backgroundColor: '#fff' }, { backgroundColor: '#000' }], { duration: 650, easing: 'ease-in-out', fill: 'forwards' }).finished,
    ]);
    await sleep(120);
    clearInterval(tick);
    window.removeEventListener('keydown', onKey);
    onDone();
  }
}
