import './styles/boot.css';
import './styles/main.css';
import { mountStage, setCompact } from './ui/dom';
import { showBoot } from './ui/boot';
import { GameUI } from './ui/gameui';
import { showTitle, type LobbySettings } from './ui/title';

const stage = mountStage();

function title() {
  setCompact(false);
  showTitle(stage, play);
}

function play(s: LobbySettings) {
  const ui = new GameUI(stage, s, (again) => (again ? play(s) : title()));
  void ui.start();
}

showBoot(stage, title);
