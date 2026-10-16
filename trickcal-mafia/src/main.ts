import './styles/boot.css';
import './styles/main.css';
import { mountStage } from './ui/dom';
import { showBoot } from './ui/boot';
import { showTitle } from './ui/title';

const stage = mountStage();
showBoot(stage, () => showTitle(stage));
