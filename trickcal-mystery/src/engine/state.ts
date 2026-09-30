/**
 * 게임 상태 — 세이브 파일에 들어가는 모든 것.
 * 이야기 속 분기용 변수는 ink 안의 VAR 로도 쓸 수 있고, 여기 flags 로도 쓸 수 있다.
 *
 * persist(영구 기록)는 세이브와 별개로 브라우저에 남는 기록:
 * 본 엔딩, 지나간 흐름도 지점, 체크포인트, 읽은 대사, 본 튜토리얼, 설정.
 */
import { C, cfg, charName, t } from './content';
import { events } from './events';
import { clamp, isTodo } from './util';

export interface PhoneLogEntry {
  from: string;
  text: string;
  deleted?: boolean;
  recoverable?: boolean;
  image?: string;
}

export interface PhoneThreadState {
  log: PhoneLogEntry[];
  pos: number; // 다음에 재생할 메시지 번호
  done: boolean;
  unread: boolean;
}

export interface StageState {
  bg: string;
  bgm: string;
  cg: string;
  fx?: string;
  sprites: Record<string, { emotion: string; pos: string }>;
}

export interface GameState {
  chapter: string;
  scene: string;
  evidence: string[];
  conclusions: string[];
  affinity: Record<string, number>;
  suspicion: number;
  marks: { id: string | null; speaker: string; text: string; correct: boolean }[];
  flags: Record<string, boolean>;
  vanished: string[];
  actions: string[];
  phone: Record<string, PhoneThreadState>;
  snooped: string[];
  visitedRooms: string[];
  checkedSpots: string[];
  lastVote: string;
  vars: Record<string, any>; // 모드들이 쓰는 잡다한 진행 기록 (조사 중인 방 등)
  stage: StageState;
  /** 방탈출: 가진 아이템 */
  items: string[];
  /** 지금 시간대 (morning / day / night) 와 날짜 */
  time: string;
  day: number;
  /** 재판 결과로 갇힌 사람 */
  confined: string[];
  /** 모은 진실 조각 (truths.yaml) */
  truths: string[];
  /** 알게 된 습관 "who.habit" */
  habits: string[];
  /** 잡아낸 어긋남 (습관과 다른 말) */
  anomalies: { who: string; habit: string; text: string }[];
  /** 휴대폰으로 찍은 사진 */
  photos: Photo[];
  /** 이미 나눈 대화 주제 "who/topic" */
  topicsSeen: string[];
  /** 사진 비교로 찾은 달라진 곳 */
  diffsFound: string[];
  /** 가짜를 찾아낸 날 */
  found: number[];
  /** 오늘 지목한 횟수 */
  accusedToday: number;
}

export interface Photo {
  id: string;
  room: string;
  bg: string;
  chapter: string;
  day: number;
  time: string;
  taken: number;
}

export function newState(): GameState {
  const affinity: Record<string, number> = {};
  for (const [id, def] of Object.entries(C.characters)) {
    if (def.player) continue;
    const start = isTodo(def.start_affinity) ? cfg('start_affinity_default', 0) : Number(def.start_affinity ?? 0);
    affinity[id] = start;
  }
  return {
    chapter: 'prologue',
    scene: '',
    evidence: [],
    conclusions: [],
    affinity,
    suspicion: 0,
    marks: [],
    flags: {},
    vanished: [],
    actions: [],
    phone: {},
    snooped: [],
    visitedRooms: [],
    checkedSpots: [],
    lastVote: '',
    vars: {},
    stage: { bg: '', bgm: '', cg: '', sprites: {} },
    items: [],
    time: 'morning',
    day: 1,
    confined: [],
    truths: [],
    habits: [],
    anomalies: [],
    photos: [],
    topicsSeen: [],
    diffsFound: [],
    found: [],
    accusedToday: 0,
  };
}

/** 예전 세이브에 없는 칸 채우기 */
export function upgradeState(s: any): GameState {
  const base = newState();
  for (const k of Object.keys(base) as (keyof GameState)[]) if (s[k] === undefined) s[k] = base[k];
  return s as GameState;
}

export let S: GameState;
export function setState(s: GameState) {
  S = s;
}

// ── 상태 바꾸기 (항상 이 함수들을 통해서 → 이벤트가 나감) ──

export function giveClue(id: string, update = false) {
  if (!C.evidence[id]) console.warn(`[단서] evidence.yaml 에 없는 id: ${id}`);
  if (!S.evidence.includes(id)) {
    S.evidence.push(id);
    events.emit('clue', { id });
  } else if (update) {
    events.emit('clue', { id, update: true });
  }
}

export function giveConclusion(id: string) {
  if (S.conclusions.includes(id)) return;
  S.conclusions.push(id);
  events.emit('conclusion', { id });
}

export function addAffinity(who: string, delta: number) {
  if (!(who in S.affinity)) S.affinity[who] = 0;
  const value = clamp(S.affinity[who] + delta, cfg('affinity.min', -10), cfg('affinity.max', 10));
  S.affinity[who] = value;
  events.emit('affinity', { who, delta, value });
}

export function addSuspicion(delta: number) {
  S.suspicion = clamp(S.suspicion + delta, 0, cfg('suspicion.max', 10));
  events.emit('suspicion', { delta, value: S.suspicion });
}

export function setFlag(name: string, value = true) {
  S.flags[name] = value;
  events.emit('flag', { name, value });
}

export function vanish(who: string) {
  if (!S.vanished.includes(who)) S.vanished.push(who);
  events.emit('vanish', { who });
}

export function unvanish(who: string) {
  S.vanished = S.vanished.filter((w) => w !== who);
  events.emit('return', { who });
}

export function logAction(type: string) {
  S.actions.push(type);
  events.emit('action', { type });
}

export function isPresent(who: string) {
  return !S.vanished.includes(who) && !S.confined.includes(who);
}

// ── 방탈출 · 재판 결과 · 습관 ──

export function giveItem(id: string) {
  if (!id || S.items.includes(id)) return;
  if (!C.items[id]) console.warn(`[아이템] items.yaml 에 없는 id: ${id}`);
  S.items.push(id);
  events.emit('item', { id, gained: true });
}

export function loseItem(id: string) {
  if (!S.items.includes(id)) return;
  S.items = S.items.filter((i) => i !== id);
  events.emit('item', { id, gained: false });
}

export function confine(who: string) {
  if (!S.confined.includes(who)) S.confined.push(who);
  events.emit('confine', { who, confined: true });
}

export function release(who: string) {
  S.confined = S.confined.filter((w) => w !== who);
  events.emit('confine', { who, confined: false });
}

export function giveTruth(id: string) {
  if (S.truths.includes(id)) return;
  if (!C.truths[id]) console.warn(`[진실] truths.yaml 에 없는 id: ${id}`);
  S.truths.push(id);
  events.emit('truth', { id });
}

/** "erpin.calls_kyoju" 형식 */
export function learnHabit(key: string) {
  if (!key || S.habits.includes(key)) return;
  S.habits.push(key);
  events.emit('habit', { key });
}

// ── 날마다 바뀌는 가짜 ──

export function todayDef() {
  return C.days[String(S.day)];
}

/** 오늘 저택이 변장한 캐릭터 id (없으면 "") */
export function impostorToday() {
  return todayDef()?.impostor ?? '';
}

/** 그 캐릭터가 지금까지 가짜였던 날들 (오늘 포함) */
export function impostorDays(who: string) {
  return Object.entries(C.days).filter(([d, def]) => Number(d) <= S.day && def.impostor === who).map(([d]) => Number(d));
}

export function markFound() {
  if (S.found.includes(S.day)) return;
  S.found.push(S.day);
  events.emit('found', { day: S.day, who: impostorToday() });
}

export function setTime(time: string) {
  S.time = time;
  events.emit('time', { time });
}

/**
 * "affinity:erpin +1", "suspicion:+1", "flag:이름", "clue:id" 같은 효과 문자열 실행.
 * 대본 태그와 yaml 의 effects 가 같은 문법을 쓴다.
 */
export function applyEffect(effect: string) {
  const [key, ...rest] = effect.split(':');
  const arg = rest.join(':').trim();
  switch (key.trim()) {
    case 'affinity': {
      const [who, amount] = arg.split(/\s+/);
      addAffinity(who, Number(amount ?? 1));
      break;
    }
    case 'suspicion':
      addSuspicion(Number(arg || 1));
      break;
    case 'flag':
      setFlag(arg, true);
      break;
    case 'unflag':
      setFlag(arg, false);
      break;
    case 'clue':
      giveClue(arg);
      break;
    case 'action':
      logAction(arg);
      break;
    case 'item':
      giveItem(arg);
      break;
    case 'lose_item':
      loseItem(arg);
      break;
    case 'confine':
      confine(arg);
      break;
    case 'release':
      release(arg);
      break;
    case 'truth':
      giveTruth(arg);
      break;
    case 'habit':
      learnHabit(arg);
      break;
    default:
      console.warn('[효과] 알 수 없는 효과:', effect);
  }
}

// ── 영구 기록 ─────────────────────────────────────────────────

export interface Settings {
  textSpeed: number;
  autoDelay: number;
  master: number;
  bgm: number;
  se: number;
  skipUnread: boolean;
  /** 대화창 바탕 진하기 (0~1) */
  windowOpacity: number;
  /** 플레이어가 정한 교주 이름 (빈 칸이면 characters.yaml 의 이름) */
  playerName: string;
}

export interface Persist {
  endingsSeen: string[];
  nodesSeen: string[];
  checkpoints: Record<string, any>;
  readLines: string[];
  tutorialsSeen: string[];
  /** 엑스트라: 한 번이라도 본 CG, 들은 배경음악 */
  cgSeen: string[];
  bgmHeard: string[];
  settings: Settings;
}

const PERSIST_KEY = 'trickcal-mystery:persist';

export let P: Persist;

export function loadPersist() {
  let saved: Partial<Persist> = {};
  try {
    saved = JSON.parse(localStorage.getItem(PERSIST_KEY) || '{}');
  } catch {
    saved = {};
  }
  P = {
    endingsSeen: saved.endingsSeen ?? [],
    nodesSeen: saved.nodesSeen ?? [],
    checkpoints: saved.checkpoints ?? {},
    readLines: saved.readLines ?? [],
    tutorialsSeen: saved.tutorialsSeen ?? [],
    cgSeen: saved.cgSeen ?? [],
    bgmHeard: saved.bgmHeard ?? [],
    settings: {
      textSpeed: cfg('text.speed', 35),
      autoDelay: cfg('text.auto_delay', 1.2),
      master: 1,
      bgm: 0.7,
      se: 0.8,
      skipUnread: cfg('text.skip_unread', false),
      windowOpacity: 0.72,
      playerName: '',
      ...(saved.settings ?? {}),
    },
  };
  readSet = new Set(P.readLines);
}

let persistTimer: number | undefined;
export function savePersist() {
  // 대사를 읽을 때마다 저장하면 느려지므로 잠깐 모아서 저장
  clearTimeout(persistTimer);
  persistTimer = window.setTimeout(() => {
    P.readLines = [...readSet];
    try {
      localStorage.setItem(PERSIST_KEY, JSON.stringify(P));
    } catch (e) {
      console.error(e);
      events.emit('toast', { text: t('error.save_failed'), kind: 'error' });
    }
  }, 300);
}

let readSet = new Set<string>();
export function markRead(lineId: string) {
  if (!readSet.has(lineId)) {
    readSet.add(lineId);
    savePersist();
  }
}
export function isRead(lineId: string) {
  return readSet.has(lineId);
}

/** 엑스트라 해금 기록 (CG 를 봤을 때, 음악을 들었을 때) */
export function markSeen(kind: 'cgSeen' | 'bgmHeard', id: string) {
  if (!id || id === 'none' || P[kind].includes(id)) return;
  P[kind].push(id);
  savePersist();
}

export function flowchartUnlocked() {
  return P.endingsSeen.some((id) => C.endings[id]?.type === 'branch');
}

export function personLabel(id: string) {
  return charName(id);
}
