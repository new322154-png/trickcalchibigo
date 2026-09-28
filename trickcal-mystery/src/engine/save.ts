/**
 * 저장/불러오기.
 * - 슬롯은 브라우저 localStorage 에 저장한다.
 * - 파일로 내보내기/가져오기를 지원한다 (브라우저를 바꾸거나 기록을 백업할 때).
 * - 체크포인트는 슬롯과 별개로 영구 기록(P.checkpoints)에 남는다 → 흐름도에서 점프.
 */
import { C } from './content';
import { S, GameState, P, savePersist, setState } from './state';
import { loadInk, saveInk } from './story';
import type { Line } from './story';

export const SAVE_VERSION = 1;
const SLOT_KEY = (i: number | string) => `trickcal-mystery:slot:${i}`;

/** 불러온 뒤 어디서부터 다시 시작할지 */
export interface Resume {
  mode: 'line' | 'choices' | 'trial' | 'investigate' | 'board';
  id?: string;
  line?: Line;
}

export interface Snapshot {
  version: number;
  time: number;
  chapter: string;
  scene: string;
  ink: string;
  state: GameState;
  resume: Resume;
}

export function makeSnapshot(resume: Resume): Snapshot {
  return {
    version: SAVE_VERSION,
    time: Date.now(),
    chapter: S.chapter,
    scene: S.scene,
    ink: saveInk(),
    state: JSON.parse(JSON.stringify(S)),
    resume,
  };
}

export function applySnapshot(snap: Snapshot) {
  loadInk(snap.ink);
  setState(JSON.parse(JSON.stringify(snap.state)));
}

export function writeSlot(slot: number | string, snap: Snapshot) {
  localStorage.setItem(SLOT_KEY(slot), JSON.stringify(snap));
}

export function readSlot(slot: number | string): Snapshot | null {
  try {
    const raw = localStorage.getItem(SLOT_KEY(slot));
    return raw ? (JSON.parse(raw) as Snapshot) : null;
  } catch {
    return null;
  }
}

export function deleteSlot(slot: number | string) {
  localStorage.removeItem(SLOT_KEY(slot));
}

/** 가장 최근 저장 (이어하기) */
export function latestSlot(maxSlots: number): { slot: number | string; snap: Snapshot } | null {
  let best: { slot: number | string; snap: Snapshot } | null = null;
  for (const slot of ['auto', ...Array.from({ length: maxSlots }, (_, i) => i + 1)]) {
    const snap = readSlot(slot);
    if (snap && (!best || snap.time > best.snap.time)) best = { slot, snap };
  }
  return best;
}

export function saveCheckpoint(id: string, snap: Snapshot) {
  P.checkpoints[id] = snap;
  savePersist();
}

export function slotLabel(snap: Snapshot): string {
  const ch = C.chapters[snap.chapter]?.title;
  const chName = !ch || ch === 'TODO' ? snap.chapter : ch;
  return `${chName}${snap.scene ? ' · ' + snap.scene : ''}`;
}

export function exportSave(snap: Snapshot) {
  const blob = new Blob([JSON.stringify(snap)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  const d = new Date(snap.time);
  a.download = `save_${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
}

export function importSave(): Promise<Snapshot | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'application/json,.json';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return resolve(null);
      try {
        const snap = JSON.parse(await file.text());
        if (!snap.ink || !snap.state) return resolve(null);
        resolve(snap);
      } catch {
        resolve(null);
      }
    };
    input.click();
  });
}
