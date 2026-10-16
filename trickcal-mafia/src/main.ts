import './styles/boot.css';
import './styles/main.css';
import './styles/room.css';
import { mountStage } from './ui/dom';
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

// 초대 링크 (?room=CODE) 로 들어오면 바로 그 방으로
const invite = new URLSearchParams(location.search).get('room');
showBoot(stage, () => {
  if (invite && /^[A-Z0-9]{5}$/.test(invite)) room(invite, loadProfile());
  else title();
});
