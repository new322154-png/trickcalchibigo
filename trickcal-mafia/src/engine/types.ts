import type { RoleId } from '../data/roles';

export type Side = 'mafia' | 'citizen';
export type Difficulty = 'easy' | 'normal' | 'hard';
export type PersonaId = 'hot' | 'calm' | 'timid' | 'doubt' | 'naive';

export interface Player {
  id: number;
  /** 익명 닉네임 (교주A …) */
  name: string;
  role: RoleId;
  human: boolean;
  persona: PersonaId;
  alive: boolean;
  diedDay?: number;
  diedHow?: 'night' | 'vote' | 'avenge';
  /** 마피아 팀원: 니펠과 접선했는가 */
  contacted: boolean;
  /** 후계: 니펠 능력을 이어받았는가 */
  heirAwake: boolean;
  /** 한 번 쓰는 능력을 썼는가 */
  usedOnce: boolean;
  /** 튼튼·함정: 습격을 한 번 버텼는가 */
  shieldUsed: boolean;
  /** 박쥐: 고른 진영 */
  batSide?: Side;
  /** 공개 능력·함정 등으로 캐릭터가 모두에게 공개됐는가 */
  revealed: boolean;
}

/** 저택 쪽지에 적히는 진짜 단서 */
export type Clue =
  | { kind: 'stayed'; who: number }              // who 는 어젯밤 방을 나서지 않았다
  | { kind: 'visited'; who: number; target: number } // who 가 어젯밤 target 의 방에 갔다
  | { kind: 'visitedBy'; target: number; count: number } // 어젯밤 target 의 방에 count 명이 찾아왔다
  | { kind: 'oneOf'; a: number; b: number }      // a, b 중 적어도 한 명은 마피아 팀이다
  | { kind: 'notMafia'; who: number };           // who 는 마피아 팀이 아니다

export type ActKind = 'investigate' | 'protect' | 'track' | 'medium' | 'stay';

/** 게시판에 올라오는 발언 (논리 판정에 쓰는 구조 + 표시용 글) */
export type Stmt = {
  id: number;
  day: number;
  /** 말한 사람. -1 = 저택(시스템, 항상 사실) */
  speaker: number;
  text: string;
  /** 익명 쪽지처럼 발신자가 숨겨진 발언 */
  anon?: boolean;
} & (
  | { kind: 'role'; role: RoleId }
  | { kind: 'refuse' }
  | { kind: 'act'; night: number; act: ActKind; target?: number; result?: Side | RoleId | number }
  | { kind: 'suspect'; target: number }
  | { kind: 'trust'; target: number }
  | { kind: 'mnote'; night: number; clue: Clue }
  | { kind: 'contra'; a: number; b: number; blame: number; valid: boolean }
  | { kind: 'death'; night: number; who: number }
  | { kind: 'reveal'; who: number; role: RoleId }
  | { kind: 'chat' }
);

export type StmtInput = Stmt extends infer S ? (S extends Stmt ? Omit<S, 'id' | 'day'> : never) : never;

/** 화면에 띄우는 기록 한 줄 */
export interface LogEntry {
  kind: 'system' | 'phase' | 'say' | 'note' | 'secret' | 'vote' | 'death' | 'win';
  text: string;
  speaker?: number;
  stmtId?: number;
  /** 나에게만 보이는 정보 */
  privateTo?: number;
}

export interface NightResult {
  deaths: number[];
  saved: number[];
  reveals: { who: number; role: RoleId }[];
  trapExposed: { trap: number; nifel: number }[];
}

export interface VoteRecord {
  voter: number;
  target: number | null;
}
