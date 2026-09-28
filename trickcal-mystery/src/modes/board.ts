/**
 * 추리 보드 — 문장의 빈칸에 카드(단서·인물·의심 발언·단어)를 끼워 가설을 완성한다.
 * 맞히면 결론 카드를 얻고, 결론 카드는 재판 여론전의 논거가 된다.
 * 데이터: content/board/*.yaml
 */
import { C, charName, names, t } from '../engine/content';
import type { BoardBlank, BoardDef, BoardSentence } from '../engine/content';
import { game } from '../engine/game';
import { S, giveConclusion, setFlag } from '../engine/state';
import { isTodo, waitFor } from '../engine/util';
import { clear, h, layer } from '../ui/dom';
import * as dlg from '../ui/dialogue';
import { openModal, toast } from '../ui/modal';

type Picks = Record<string, string>; // 빈칸 번호 → 카드 id

export async function runBoard(id: string): Promise<string | null> {
  const board = C.boards[id];
  if (!board) {
    console.warn('[추리 보드] board 폴더에 없는 id:', id);
    return null;
  }
  const solvedKey = `board_solved_${id}`;
  const solved: string[] = (S.vars[solvedKey] ??= []);
  if (!S.vars[`board_intro_${id}`]) {
    S.vars[`board_intro_${id}`] = true;
    await game.sayLines(board.intro);
  }
  const picks: Record<string, Picks> = {};
  const root = layer('mode');

  while (solved.length < board.sentences.length) {
    dlg.showBox(false);
    const submit = await waitFor<BoardSentence>((resolve) => {
      render(root, board, solved, picks, resolve);
      return () => clear(root);
    });
    const pick = picks[submit.id] ?? {};
    const blanks = Object.entries(submit.blanks ?? {});
    if (blanks.some(([n]) => !pick[n])) {
      toast(t('board.incomplete'), 'warn');
      continue;
    }
    const correct = blanks.every(([n, b]) => pick[n] === b.answer);
    if (correct) {
      solved.push(submit.id);
      toast(t('board.correct'), 'clue');
      await game.sayLines(submit.solved);
      if (submit.reward && !isTodo(submit.reward)) giveConclusion(submit.reward);
    } else {
      await game.sayLines(submit.wrong?.length && !submit.wrong.every(isTodo) ? submit.wrong : [t('board.wrong')]);
    }
  }
  clear(root);
  await game.sayLines(board.outro);
  setFlag(`board_done_${id}`);
  return board.on_complete && !isTodo(board.on_complete) ? board.on_complete : null;
}

function cardLabel(kind: BoardBlank['kind'], id: string, board: BoardDef): string {
  switch (kind) {
    case 'evidence': return names(C.evidence[id]?.name ?? id);
    case 'person': return charName(id);
    case 'suspect': {
      const m = S.marks.find((x) => x.id === id);
      return m ? `${charName(m.speaker)}: 「${m.text}」` : id;
    }
    case 'word': return names(board.words?.[id] ?? id);
  }
}

function cardOptions(kind: BoardBlank['kind'], board: BoardDef): string[] {
  switch (kind) {
    case 'evidence': return [...S.evidence];
    case 'person': return Object.keys(C.characters).filter((c) => !C.characters[c].player);
    case 'suspect': return S.marks.filter((m) => m.id).map((m) => m.id!) ;
    case 'word': return Object.keys(board.words ?? {});
  }
}

function render(root: HTMLElement, board: BoardDef, solved: string[], picks: Record<string, Picks>, submit: (s: BoardSentence) => void) {
  clear(root);
  const wrap = h('div.board', h('div.board-title', isTodo(board.title) ? names('%board%') : names(board.title)), h('div.board-guide', t('board.guide').replace(/^TODO$/, '')));
  for (const s of board.sentences) {
    const done = solved.includes(s.id);
    const pick = (picks[s.id] ??= {});
    const row = h(`div.board-sentence${done ? '.done' : ''}`);
    // "[1]" 자리를 버튼으로 바꿔 끼운다
    const fallback = `(TODO) 문장 ${s.id}: ` + Object.keys(s.blanks ?? {}).map((n) => `[${n}]`).join(' ');
    const parts = String(isTodo(s.text) ? fallback : s.text).split(/(\[\d+\])/);
    for (const part of parts) {
      const m = part.match(/^\[(\d+)\]$/);
      if (!m) {
        row.appendChild(h('span', names(part)));
        continue;
      }
      const n = m[1];
      const blank = s.blanks?.[n];
      const chosen = done ? blank?.answer : pick[n];
      const label = chosen && blank ? cardLabel(blank.kind, chosen, board) : '？';
      row.appendChild(
        h(`button.board-blank${chosen ? '.filled' : ''}`, {
          disabled: done,
          onclick: () => {
            if (!blank) return;
            chooseCard(blank.kind, board, (id) => {
              pick[n] = id;
              render(root, board, solved, picks, submit);
            });
          },
        }, label),
      );
    }
    if (!done) row.appendChild(h('button.btn.board-confirm', { onclick: () => submit(s) }, t('board.confirm')));
    wrap.appendChild(row);
  }
  root.appendChild(wrap);
}

function chooseCard(kind: BoardBlank['kind'], board: BoardDef, onPick: (id: string) => void) {
  const m = openModal(t('board.select_card'), 'cards');
  const list = h('div.card-list');
  const options = cardOptions(kind, board);
  if (options.length === 0) list.appendChild(h('p.empty', t('notebook.empty_evidence').replace(/^TODO$/, '—')));
  for (const id of options) {
    list.appendChild(h('button.card', { onclick: () => { m.close(); onPick(id); } }, cardLabel(kind, id, board)));
  }
  m.body.appendChild(list);
}
