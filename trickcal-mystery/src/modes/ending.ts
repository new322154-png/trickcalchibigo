/**
 * 엔딩 화면. 갤러리에 기록하고, 파생 엔딩이면 "체크포인트로 돌아가기"를 보여준다.
 * 데이터: content/endings.yaml
 */
import { C, names, t } from '../engine/content';
import { events } from '../engine/events';
import { game } from '../engine/game';
import { P, savePersist } from '../engine/state';
import { isTodo, waitFor } from '../engine/util';
import { h, layer } from '../ui/dom';
import * as dlg from '../ui/dialogue';
import * as scene from '../ui/scene';
import { toast } from '../ui/modal';
import { setHudVisible } from '../ui/hud';

export async function runEnding(id: string) {
  const end = C.endings[id];
  if (!end) console.warn('[엔딩] endings.yaml 에 없는 id:', id);
  const firstTime = !P.endingsSeen.includes(id);
  const hadBranchBefore = P.endingsSeen.some((e) => C.endings[e]?.type === 'branch');
  if (firstTime) {
    P.endingsSeen.push(id);
    savePersist();
  }
  game.markNode(id);
  events.emit('ending', { id });
  dlg.showBox(false);
  setHudVisible(false);
  if (end?.cg && !isTodo(end.cg)) scene.setCg(end.cg);

  const typeLabel = t(`ending.type_${end?.type ?? 'branch'}`);
  const checkpoint = end?.checkpoint ? P.checkpoints[end.checkpoint] : null;

  const choice = await waitFor<'checkpoint' | 'title'>((resolve) => {
    const el = h(
      'div.ending-screen',
      h('div.ending-header', t('ending.header', { no: String(end?.no ?? '?').padStart(2, '0') })),
      h('div.ending-type', typeLabel),
      h('div.ending-title', end && !isTodo(end.title) ? names(end.title) : id),
      firstTime ? h('div.ending-new', t('ending.new_unlock')) : null,
      h(
        'div.ending-buttons',
        checkpoint ? h('button.btn', { onclick: () => resolve('checkpoint') }, t('ending.back_to_checkpoint')) : null,
        h('button.btn', { onclick: () => resolve('title') }, t('ending.to_title')),
      ),
    );
    layer('modal').appendChild(el);
    return () => el.remove();
  });

  // 첫 파생 엔딩 → 흐름도 해금 안내
  if (end?.type === 'branch' && !hadBranchBefore) {
    toast(t('ending.flowchart_unlocked'));
    await game.tutorial('checkpoint');
    await game.tutorial('flowchart');
  }

  scene.setCg('');
  if (choice === 'checkpoint' && checkpoint) {
    void game.loadSnapshot(checkpoint);
  } else {
    game.toTitle();
  }
}
