import './styles/boot.css';
import './styles/main.css';
import './styles/room.css';
import './styles/theme.css';
import { h, mountStage } from './ui/dom';
import { showBoot } from './ui/boot';
import { enterRoom } from './ui/room';
import { showTitle } from './ui/title';
import { loadProfile, type Profile } from './profile';
import { bgm, setSoundMode, soundMode } from './ui/bgm';
import { maybeDebug } from './ui/debug';

const stage = mountStage();
maybeDebug();

// 소리 버튼 (오른쪽 아래): 전부 켜기 → 효과음만 → 끄기
const ICON = { all: '🔊', sfx: '🔔', off: '🔇' } as const;
const TIP = { all: '음악·효과음 켜짐', sfx: '효과음만', off: '소리 끔' } as const;
const soundBtn = h('button.sound-btn', { title: TIP[soundMode()], 'aria-label': TIP[soundMode()] }, ICON[soundMode()]);
soundBtn.onclick = () => {
  const order = ['all', 'sfx', 'off'] as const;
  const m = order[(order.indexOf(soundMode()) + 1) % 3];
  setSoundMode(m);
  soundBtn.textContent = ICON[m];
  soundBtn.title = TIP[m];
  soundBtn.setAttribute('aria-label', TIP[m]);
};
document.getElementById('app')!.appendChild(soundBtn);

function title(msg?: string) {
  history.replaceState(null, '', location.pathname);
  showTitle(stage, { enterRoom: room });
  bgm('title');
  if (msg) {
    const s = stage.querySelector('.title-status');
    if (s) s.textContent = msg;
  }
}

function room(code: string, profile: Profile) {
  enterRoom(stage, code, profile, title);
}

// 초대 링크 (?room=CODE): 바로 들어가지 않고 타이틀에서 한 번 묻는다
const invite = new URLSearchParams(location.search).get('room')?.toUpperCase() ?? null;
// 새로고침·탭 복원: 방에 있던 중이면 (재접속 토큰이 남아 있으면) 바로 그 방으로 다시 들어가 자리를 이어받는다
let resumeCode: string | null = null;
try {
  const c = sessionStorage.getItem('tm.cur');
  if (c && /^[A-Z0-9]{5}$/.test(c) && sessionStorage.getItem(`tm.tok.${c}`)) resumeCode = c;
} catch { /* 저장소 없음 */ }
if (resumeCode) {
  history.replaceState(null, '', location.pathname);
  room(resumeCode, loadProfile());
} else showBoot(stage, () => {
  title(); // 주소창의 ?room= 도 여기서 지운다
  if (invite && /^[A-Z0-9]{5}$/.test(invite)) askInvite(invite);
});

function askInvite(code: string) {
  const modal = h('div.overlay',
    h('div.card.roommenu',
      h('h2', '초대받은 방'),
      h('p.hint', `방 코드 ${code} 에 들어갈까요? 오른쪽 위 프로필에서 닉네임을 먼저 바꿀 수 있어요.`),
      h('div.row.end',
        h('button.btn', { onclick: () => modal.remove() }, '취소'),
        h('button.btn.gold', { onclick: () => { modal.remove(); room(code, loadProfile()); } }, '입장'))));
  stage.appendChild(modal);
}
