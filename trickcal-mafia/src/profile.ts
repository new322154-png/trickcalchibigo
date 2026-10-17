/** 내 닉네임 · 캐릭터 (이 기기에만 저장) */
import { CHARACTERS, isChar, type CharId } from '../shared/protocol';

export interface Profile { nick: string; char: CharId }

export function loadProfile(): Profile {
  try {
    const p = JSON.parse(localStorage.getItem('tm.profile') ?? '');
    if (p && typeof p.nick === 'string' && isChar(p.char)) return { nick: p.nick.slice(0, 10), char: p.char };
  } catch { /* 없음 */ }
  return { nick: '교주' + Math.floor(100 + Math.random() * 900), char: CHARACTERS[Math.floor(Math.random() * CHARACTERS.length)].id };
}

export function saveProfile(p: Profile) {
  try { localStorage.setItem('tm.profile', JSON.stringify(p)); } catch { /* 저장 못 해도 진행 */ }
}

export const charImg = (c: CharId) => `./assets/chars/${c}.webp`;
export const charName = (c: CharId) => CHARACTERS.find((x) => x.id === c)?.name ?? c;
