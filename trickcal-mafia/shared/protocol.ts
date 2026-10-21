/**
 * 서버(방)와 화면 사이에 오가는 메시지.
 * 화면 → 서버: C2S, 서버 → 화면: S2C
 */

export const WORLD_W = 1600;
export const WORLD_H = 900;
export const MAX_PLAYERS = 12;
export const MIN_PLAYERS = 4;
export const SPEED = 330; // 초당 이동 거리
/** 대기실에서 걸을 수 있는 가장 위쪽 (배경의 책상 매트 윗변) */
export const WALK_TOP = 380;

export const CHARACTERS = [
  { id: 'nifel', name: '니펠' },
  { id: 'mute', name: '뮤트' },
  { id: 'uros', name: '우로스' },
  { id: 'joan', name: '죠안' },
  { id: 'bella', name: '벨라' },
  { id: 'hilde', name: '힐데' },
  { id: 'polan', name: '폴랑' },
  { id: 'ide', name: '이드' },
  { id: 'butter', name: '버터' },
  { id: 'heidi', name: '하이디' },
  { id: 'rion', name: '리온' },
  { id: 'diana', name: '디아나(왕년)' },
  { id: 'mari', name: '마리' },
  { id: 'spiky', name: '스피키' },
  { id: 'ui', name: '우이' },
  { id: 'ner', name: '네르' },
  { id: 'comi', name: '코미' },
  { id: 'elena', name: '엘레나' },
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

/**
 * 메시지 형식 버전. 서버와 화면이 서로 못 알아듣게 바뀔 때만 올린다.
 * 다르면 서버가 4011 로 닫고, 화면은 '새 버전이 나왔어요 — 새로고침' 안내를 띄운다.
 */
export const PROTOCOL = 2;

export interface PlayerInfo {
  id: number;
  nick: string;
  char: CharId;
  x: number;
  y: number;
  host: boolean;
  /** 테스트용 봇 */
  bot?: boolean;
}

export type C2S =
  | { t: 'hello'; nick: string; char: CharId; token?: string; /** 프로토콜 버전 */ v?: number }
  | { t: 'move'; x: number; y: number }
  | { t: 'chat'; text: string }
  | { t: 'start_mini'; game: MiniId }
  | { t: 'stop_mini' }
  | { t: 'press' }
  | { t: 'ping' }
  /** 강퇴 투표 열기 (이미 같은 사람 투표가 있으면 찬성) — 대기실에서만 */
  | { t: 'kick'; target: number }
  | { t: 'kickvote'; yes: boolean }
  /** 감정표현 (EMOTES 중 하나, 10초에 한 번) */
  | { t: 'emote'; e: string }
  // ── 마피아 본게임 ──
  | { t: 'start_game'; test?: { roles?: Record<string, string>; speed?: number; godKill?: boolean; botVote?: boolean; botAct?: boolean; botChat?: boolean } }
  | { t: 'time'; d: 1 | -1 }
  | { t: 'add_bot' }
  | { t: 'remove_bot' }
  | { t: 'act'; target: number | null; seq?: number }
  | { t: 'vote'; target: number | null; seq?: number }
  | { t: 'gchat'; text: string; ch: ChatCh }
  | { t: 'note'; to: number; text: string }
  | { t: 'choice'; key: ChoiceKey; value: number | string | null }
  | { t: 'cmove'; x: number; y: number }
  | { t: 'drone' }
  | { t: 'fmove'; x: number; y: number }
  | { t: 'pmove'; x: number; y: number }
  /** 게임 끝: 최고의 플레이어 투표 (승리 팀 중에서) */
  | { t: 'mvp'; target: number };

export interface Chair { id: number; x: number; y: number; by: number | null }

export type MiniState =
  | { game: 'reaction'; phase: 'ready' | 'wait' | 'go' | 'result'; round: number; scores: Record<number, number>; winner?: number | null; fouls?: number[]; time?: number }
  | { game: 'ox'; phase: 'question' | 'judge' | 'done'; q: string; answer?: boolean; left: number[]; out: number[]; endsAt: number; num: number }
  | { game: 'tag'; phase: 'play' | 'done'; it: number; endsAt: number; immune: number; loser?: number }
  | { game: 'chairs'; phase: 'music' | 'sit' | 'done'; chairs: Chair[]; left: number[]; out: number[]; endsAt: number };

export type S2C =
  | { t: 'welcome'; you: number; code: string; pub: boolean; players: PlayerInfo[]; resumed?: boolean }
  | { t: 'join'; p: PlayerInfo }
  | { t: 'leave'; id: number }
  | { t: 'host'; id: number }
  | { t: 'moves'; m: [number, number, number][] }
  /** 서버가 내 위치를 고쳐 줄 때 (의자에 앉음, 너무 빠른 이동 등) */
  | { t: 'pos'; x: number; y: number }
  | { t: 'chat'; id: number; text: string }
  | { t: 'sys'; text: string }
  | { t: 'mini'; s: MiniState | null; title?: string }
  | { t: 'error'; text: string }
  | { t: 'pong' }
  | { t: 'token'; token: string }
  | { t: 'starting'; at: number | null }
  /** 잠수 경고: at 까지 아무것도 안 하면 방에서 나가게 됨 (null = 경고 끝) */
  | { t: 'afk'; at: number | null }
  /** 강퇴 투표 상태 (null = 끝남) */
  | { t: 'kickvote'; v: { target: number; by: number; yes: number; no: number; need: number; endsAt: number; voted: number[] } | null }
  /** 감정표현: 대기실은 id(플레이어), 게임은 pid */
  | { t: 'emote'; id: number; e: string }
  // ── 마피아 본게임 ──
  | { t: 'g'; v: GameView }
  | { t: 'glog'; ch: LogCh; from: number; text: string }
  /** 재접속 직후: 지금까지 내가 받았던 기록 (최근 것만) */
  | { t: 'gsync'; logs: [LogCh, number, string][] }
  | { t: 'gcmove'; pid: number; x: number; y: number }
  /** 광장(p)·농장(f) 이동을 0.1초마다 모아서 [pid, x, y] */
  | { t: 'gmoves'; s: 'p' | 'f'; m: [number, number, number][] }
  /** 주말농장(이드 + 죽은 사람) 위치 */
  | { t: 'fmove'; pid: number; x: number; y: number }
  /** 낮 광장(나무 아래) 위치 — 화면 배경 기준 %(0~100) */
  | { t: 'pmove'; pid: number; x: number; y: number }
  /** 모두가 보는 컷씬 (처형 등) */
  | { t: 'cut'; kind: CutKind; pid?: number; text: string; /** 실종: 어젯밤 살아 있던 인원 */ n?: number }
  | { t: 'gend'; winner: Winner; roles: { pid: number; role: string; alive: boolean }[]; winners: number[]; /** 최고의 플레이어 투표 마감 (없으면 투표 없음) */ mvpAt?: number; day?: number }
  /** 최고의 플레이어 투표: 몇 명이 투표했는지 · 결과 (pids 가 정해지면 끝) */
  | { t: 'mvp'; voted: number; of: number; pids?: number[]; votes?: number };

// ── 마피아 본게임 ─────────────────────────────────

export const GAME_MIN = 4;
/** 감정표현 (그림은 Twemoji) */
export const EMOTES = ['👍', '👏', '😂', '😱', '😡', '🤔', '😭', '❤️', '❓', '‼️'] as const;
/** 감정표현 간격 (도배 방지) */
export const EMOTE_GAP = 10_000;
export const AUTO_START = 8;
export const STEP_SECONDS = 15;

/** 모두가 보는 컷씬 */
export type CutKind = 'execute' | 'overturn' | 'vanish' | 'saved' | 'counter' | 'blast' | 'wish' | 'uros' | 'drone' | 'reveal'
  // 능력 쓴 사람만 보는 컷씬
  | 'p_kill' | 'p_seal' | 'p_identify' | 'p_agitate' | 'p_protect' | 'p_investigate' | 'p_track' | 'p_disguise' | 'p_farm' | 'p_bat' | 'p_contact'
  | 'p_drone_ok' | 'p_drone_fail';
export type ChatCh = 'day' | 'nifel' | 'dead' | 'defense';
export type LogCh = ChatCh | 'sys' | 'secret' | 'note' | 'event';
export type ChoiceKey = 'bat' | 'overturn' | 'avenge' | 'agitate';
export type Winner = 'mafia' | 'citizen' | 'jester' | 'elena' | 'draw';
export type Phase = 'intro' | 'night' | 'morning' | 'day' | 'vote1' | 'defense' | 'vote2' | 'verdict' | 'end';

export interface GPlayer { pid: number; name: string; alive: boolean; online: boolean; /** 모두에게 공개된 직업 */ shown?: string }

/** 주말농장 크기 */
export const FARM_W = 1600;
export const FARM_H = 900;

export interface GameView {
  phase: Phase;
  day: number;
  night: number;
  step: 0 | 1 | 2 | 3;
  endsAt: number;
  /** 서버 시각 (시계 차이 보정용) */
  now: number;
  /** 단계 번호 — 투표·능력 명령에 같이 보내 지난 단계의 늦은 명령을 거른다 */
  seq?: number;
  players: GPlayer[];
  me: {
    pid: number;
    role: string;
    alive: boolean;
    mates: number[];
    /** 동료의 직업 (동료끼리는 서로 정체를 안다) */
    mateRoles?: [number, string][];
    /** 이번 차례에 쓸 능력 (없으면 null) */
    act: { kind: string; targets: number[]; optional: boolean; done: boolean; locked: boolean; choice: number | null } | null;
    /** 니펠 차례에 같이 나온 동료들의 표 */
    teamVotes?: [number, number | null][];
    chats: ChatCh[];
    notesLeft: number;
    /** 오늘 토론 시간 늘리기/줄이기를 아직 쓸 수 있는지 */
    canTime?: boolean;
    vote: number | null | undefined;
    canVote: boolean;
    prompt: { key: ChoiceKey; options: (number | string)[]; text: string } | null;
    /** 엘레나: 드론 수 · 오늘 밤 남은 조립 기회 */
    drone?: { count: number; tries: number };
    /** 죠안: 지금 대신 말하고 있는 사람 */
    proxyFor?: number;
    /** 밤의 주말농장에 있으면: 함께 있는 사람과 위치 [pid, x, y, 이드 모습이면 1] */
    farm?: [number, number, number, number][];
    /** 죠안에게 입을 빼앗긴 상태 */
    silenced?: boolean;
  };
  cands: number[];
  counts?: [number, number][];
  /** 재판장 무대 위에 선 사람 (결선 후보 → 판결 뒤엔 처형될 사람만) */
  stage?: number[];
  /** 낮에 걸어 다니는 광장: [pid, x%, y%] (결선·투표 땐 없음) */
  plaza?: [number, number, number][];
}

/** 낮 광장에서 걸을 수 있는 범위 (배경 그림 기준 %) */
export const PLAZA = { x0: 17, x1: 79, y0: 52, y1: 67 };
export const plazaPhase = (p: Phase) => p === 'intro' || p === 'morning' || p === 'day' || p === 'vote1';

export const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
