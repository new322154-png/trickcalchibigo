/**
 * 서버(방)와 화면 사이에 오가는 메시지.
 * 화면 → 서버: C2S, 서버 → 화면: S2C
 */

export const WORLD_W = 1600;
export const WORLD_H = 900;
export const MAX_PLAYERS = 12;
export const MIN_PLAYERS = 4;
export const SPEED = 330; // 초당 이동 거리

export const CHARACTERS = [
  { id: 'erpin', name: '에르핀' },
  { id: 'ner', name: '네르' },
  { id: 'tig', name: '티그' },
  { id: 'uros', name: '우로스' },
  { id: 'sila', name: '실라' },
  { id: 'elena', name: '엘레나' },
  { id: 'daya', name: '다야' },
  { id: 'joan', name: '죠안' },
  { id: 'amelia', name: '아멜리아' },
  { id: 'shady', name: '셰이디' },
] as const;
export type CharId = (typeof CHARACTERS)[number]['id'];
export const isChar = (c: unknown): c is CharId => CHARACTERS.some((x) => x.id === c);

export type MiniId = 'reaction' | 'ox' | 'tag' | 'chairs';
export const MINI_NAMES: Record<MiniId, string> = { reaction: '반응속도 대결', ox: 'OX 퀴즈', tag: '술래잡기', chairs: '의자 뺏기' };
export const MINI_DESC: Record<MiniId, string> = {
  reaction: '화면이 바뀌는 순간 가장 먼저 누르세요! 먼저 누르면 실격. 3판 2선승.',
  ox: '문제를 보고 O 구역(왼쪽)이나 X 구역(오른쪽)으로 이동하세요. 틀리면 탈락!',
  tag: '술래에게 닿으면 술래가 바뀝니다. 60초가 끝날 때 술래인 사람이 패배!',
  chairs: '음악이 멈추면 의자로 달려가세요! 의자를 못 차지한 한 명이 탈락.',
};

export interface PlayerInfo {
  id: number;
  nick: string;
  char: CharId;
  x: number;
  y: number;
  host: boolean;
}

export type C2S =
  | { t: 'hello'; nick: string; char: CharId }
  | { t: 'move'; x: number; y: number }
  | { t: 'chat'; text: string }
  | { t: 'start_mini'; game: MiniId }
  | { t: 'stop_mini' }
  | { t: 'press' }
  | { t: 'ping' };

export interface Chair { id: number; x: number; y: number; by: number | null }

export type MiniState =
  | { game: 'reaction'; phase: 'ready' | 'wait' | 'go' | 'result'; round: number; scores: Record<number, number>; winner?: number | null; fouls?: number[]; time?: number }
  | { game: 'ox'; phase: 'question' | 'judge' | 'done'; q: string; answer?: boolean; left: number[]; out: number[]; endsAt: number; num: number }
  | { game: 'tag'; phase: 'play' | 'done'; it: number; endsAt: number; immune: number; loser?: number }
  | { game: 'chairs'; phase: 'music' | 'sit' | 'done'; chairs: Chair[]; left: number[]; out: number[]; endsAt: number };

export type S2C =
  | { t: 'welcome'; you: number; code: string; pub: boolean; players: PlayerInfo[] }
  | { t: 'join'; p: PlayerInfo }
  | { t: 'leave'; id: number }
  | { t: 'host'; id: number }
  | { t: 'moves'; m: [number, number, number][] }
  | { t: 'chat'; id: number; text: string }
  | { t: 'sys'; text: string }
  | { t: 'mini'; s: MiniState | null; title?: string }
  | { t: 'error'; text: string }
  | { t: 'pong' };

export const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
