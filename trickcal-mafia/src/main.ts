import './styles/boot.css';
import './styles/main.css';
import './styles/room.css';
import './styles/theme.css';
import { h, mountStage } from './ui/dom';
import { showBoot } from './ui/boot';
import { enterRoom } from './ui/room';
import { showTitle } from './ui/title';
import { loadProfile, type Profile } from './profile';

const stage = mountStage();

function title(msg?: string) {
  history.replaceState(null, '', location.pathname);
  showTitle(stage, { enterRoom: room });
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
showBoot(stage, () => {
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
