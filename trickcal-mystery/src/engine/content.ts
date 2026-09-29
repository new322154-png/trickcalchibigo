/**
 * content/ 폴더의 YAML 파일을 전부 읽어 하나로 묶는다.
 * - 폴더 이름이 _ 로 시작하면(예: _새_장_템플릿) 무시한다.
 * - investigations/, board/, phone/, trials/ 안의 파일들은 id 기준으로 합친다.
 */
import YAML from 'yaml';
import { isTodo, orDefault } from './util';

// ── 콘텐츠 형식 (YAML 구조와 1:1) ──────────────────────────────

export type Lines = string[];

export interface CharacterDef {
  name: string;
  player?: boolean;
  show_sprite?: boolean | string;
  /** 대화창 위 상반신 위치 보정 [가로, 세로] px */
  bust?: [number, number];
  persuasion?: 'emotion' | 'evidence' | 'trust';
  start_affinity?: number;
  color?: string;
  emotions?: string[];
  profile?: string;
  reactions?: Record<string, Lines | string>;
}

export interface RoomDef {
  name: string;
  bg: string;
  floor?: number;
  map_pos?: [number, number];
  doors?: string[];
  first_enter?: Lines;
  locked_until?: string;
  locked_text?: Lines;
}

export interface Hotspot {
  id: string;
  label: string;
  rect: [number, number, number, number];
  lines?: Lines;
  again?: Lines;
  clue?: string;
  knot?: string;
  needs?: string;
}

export interface SpotPerson {
  who: string;
  emotion?: string;
  pos?: string;
  lines?: Lines;
  knot?: string;
}

export interface InvestigationDef {
  title: string;
  start_room: string;
  rooms: string[];
  required?: string[];
  intro?: Lines;
  outro?: Lines;
  on_complete?: string;
  spots?: Record<string, { hotspots?: Hotspot[]; people?: SpotPerson[] }>;
}

export interface BoardBlank {
  kind: 'evidence' | 'person' | 'suspect' | 'word';
  answer: string;
}
export interface BoardSentence {
  id: string;
  text: string;
  blanks: Record<string, BoardBlank>;
  solved?: Lines;
  wrong?: Lines;
  reward?: string;
}
export interface BoardDef {
  title: string;
  intro?: Lines;
  words?: Record<string, string>;
  sentences: BoardSentence[];
  outro?: Lines;
  on_complete?: string;
}
export interface ConclusionDef {
  name: string;
  text: string;
  kind: 'evidence' | 'emotion' | 'trust';
}

export interface PhoneMsg {
  from?: string;
  text?: string;
  typing?: number;
  delete_after?: number;
  recoverable?: boolean;
  image?: string;
  clue?: string;
  choice?: {
    timeout?: number;
    options: { text: string; send?: string; effects?: string[]; goto?: string }[];
    on_timeout?: { effects?: string[]; goto?: string };
  };
  label?: string;
  end?: boolean;
}
export interface ThreadDef {
  with: string;
  messages: PhoneMsg[];
  on_end?: string;
}
export interface SnoopDef {
  owner: string;
  needs?: string;
  caught?: 'never' | 'always' | number;
  messages: PhoneMsg[];
}

export interface TrialMsg {
  id: string;
  from: string;
  text: string;
  ask?: TrialMsg[];
  capture?: number;
}
export interface TrialRound {
  id: string;
  topic: string;
  messages: TrialMsg[];
  answer: { type: 'rebut' | 'compare'; message?: string; evidence?: string; messages?: string[] };
  whispers?: { after: string; from: string; text: string }[];
  solved?: Lines;
  wrong?: Lines;
}
export interface CounterRound {
  id: string;
  when: string;
  accuse?: Lines;
  defense: { type: 'evidence' | 'witness'; evidence?: string; min_affinity?: number };
  solved?: Lines;
  wrong?: Lines;
}
export interface TrialDef {
  title: string;
  checkpoint?: string;
  results: {
    correct: string;
    correct_weak?: string;
    wrong: string;
    wrong_by_target?: Record<string, string>;
    mansion?: string;
    voice_empty?: string;
    counter_fail?: string;
  };
  chat?: { intro?: Lines; rounds: TrialRound[]; outro?: Lines };
  counter?: { intro?: Lines; rounds: CounterRound[]; max_fails?: number; outro?: Lines };
  opinion?: {
    culprit: string;
    turns?: number;
    intro?: Lines;
    initial: Record<string, { target: string; conf: number }>;
    cards: Record<string, { accuses: string; key?: boolean }>;
    rebuttals?: { turn: number; lines?: Lines; sway?: Record<string, string> }[];
    before_vote?: Lines;
    extension?: Lines;
    verdict_correct?: Lines;
    verdict_wrong?: Lines;
    verdict_mansion?: Lines;
  };
}

export interface EndingDef {
  no: number;
  type: 'true' | 'normal' | 'branch';
  title: string;
  desc?: string;
  hint?: string;
  cg?: string;
  checkpoint?: string;
}

export interface FlowNode {
  type: 'start' | 'scene' | 'checkpoint' | 'ending';
  parent?: string;
  label?: string;
}

export interface TutorialDef {
  speaker: string;
  title: string;
  image?: string;
  pages: Lines;
}

export interface Content {
  game: any;
  config: any;
  ui: any;
  tutorials: Record<string, TutorialDef>;
  characters: Record<string, CharacterDef>;
  emotionAliases: Record<string, string>;
  extraSpeakers: Record<string, { color?: string }>;
  chapters: Record<string, { title?: string; title_card?: string }>;
  rooms: Record<string, RoomDef>;
  evidence: Record<string, any>;
  investigations: Record<string, InvestigationDef>;
  boards: Record<string, BoardDef>;
  conclusions: Record<string, ConclusionDef>;
  contacts: Record<string, any>;
  groups: Record<string, { name: string; members: string[] }>;
  threads: Record<string, ThreadDef>;
  snoops: Record<string, SnoopDef>;
  trials: Record<string, TrialDef>;
  endings: Record<string, EndingDef>;
  flowchart: Record<string, FlowNode>;
  extras: ExtrasDef;
}

/** 엑스트라(갤러리) — content/extras.yaml */
export interface ExtraItem {
  id: string;          // CG·배경음악 이름 (파일 이름)
  title?: string;
  desc?: string;
  artist?: string;     // 음악: 만든 사람
  art?: string;        // 음악: 원판에 들어갈 그림 (public/assets/ 기준)
  file?: string;       // 영상: 파일 이름 (확장자 없이, public/assets/ 기준)
  poster?: string;     // 영상: 재생 전 그림
  unlock?: 'always' | 'seen' | string;  // always / seen(게임에서 보거나 들으면) / 엔딩 id
}
export interface ExtrasDef {
  cg: ExtraItem[];
  music: ExtraItem[];
  videos: ExtraItem[];
}

// ── 기능 이름 기본값 (game.yaml 의 names 가 TODO 일 때 대신 씀) ──
const DEFAULT_NAMES: Record<string, string> = {
  suspect_button: '의심!',
  notebook: '수첩',
  notebook_tab_evidence: '증거',
  notebook_tab_people: '인물',
  notebook_tab_suspects: '의심 발언',
  notebook_tab_conclusions: '결론',
  investigation: '조사',
  map: '지도',
  board: '추리 보드',
  conclusion_card: '결론',
  phone: '휴대폰',
  group_chat: '단체방',
  snoop: '엿보기',
  recover: '복구',
  trial: '재판',
  trial_chat: '단톡방 심리',
  trial_counter: '역습 방어전',
  trial_opinion: '최종 여론전',
  voice_meter: '발언권',
  action_ask: '되묻기',
  action_rebut: '반박',
  action_capture: '캡처',
  action_compare: '대조',
  whisper: '귓속말',
  vote: '투표',
  extension: '연장 토론',
  affinity: '호감도',
  suspicion: '의심도',
  party_bar: '일행',
  flowchart: '사건 흐름도',
  checkpoint: '체크포인트',
  gallery: '엔딩 갤러리',
};

// ── 불러오기 ────────────────────────────────────────────────

const rawFiles = import.meta.glob('/content/**/*.yaml', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

function parseAll(): Record<string, any> {
  const out: Record<string, any> = {};
  for (const [path, text] of Object.entries(rawFiles)) {
    if (/\/_/.test(path.replace('/content/', '/'))) continue; // _ 로 시작하는 폴더 무시
    const rel = path.replace(/^\/content\//, '').replace(/\.yaml$/, '');
    try {
      out[rel] = YAML.parse(text) ?? {};
    } catch (e: any) {
      throw new Error(`YAML 오류: content/${rel}.yaml\n${e.message}`);
    }
  }
  return out;
}

function mergeFolder(files: Record<string, any>, folder: string, key?: string): Record<string, any> {
  const merged: Record<string, any> = {};
  for (const [rel, data] of Object.entries(files)) {
    if (!rel.startsWith(folder + '/')) continue;
    const src = key ? data?.[key] : data;
    if (src && typeof src === 'object') Object.assign(merged, src);
  }
  return merged;
}

export function loadContent(): Content {
  const f = parseAll();
  const game = f['game'] ?? {};
  const chars = { ...(f['characters'] ?? {}) };
  const emotionAliases = chars.emotion_aliases ?? {};
  const extraSpeakers = chars.extra_speakers ?? {};
  delete chars.emotion_aliases;
  delete chars.extra_speakers;

  // 결론 카드는 board 파일들의 conclusions 에서 모음
  const boards: Record<string, any> = {};
  const conclusions: Record<string, any> = {};
  for (const [rel, data] of Object.entries(f)) {
    if (!rel.startsWith('board/')) continue;
    for (const [id, v] of Object.entries(data ?? {})) {
      if (id === 'conclusions') Object.assign(conclusions, v);
      else boards[id] = v;
    }
  }

  const contactsFile = f['phone/contacts'] ?? {};
  const phoneThreads: Record<string, any> = {};
  const snoops: Record<string, any> = {};
  for (const [rel, data] of Object.entries(f)) {
    if (!rel.startsWith('phone/') || rel === 'phone/contacts') continue;
    Object.assign(phoneThreads, data?.threads ?? {});
    Object.assign(snoops, data?.snoop ?? {});
  }

  const tutorials = f['text/tutorial'] ?? {};

  return {
    game: { ...game, names: resolveNames(game.names ?? {}) },
    config: f['config'] ?? {},
    ui: f['text/ui'] ?? {},
    tutorials,
    characters: chars,
    emotionAliases,
    extraSpeakers,
    chapters: f['chapters'] ?? {},
    rooms: f['locations']?.rooms ?? {},
    evidence: f['evidence']?.items ?? {},
    investigations: mergeFolder(f, 'investigations'),
    boards,
    conclusions,
    contacts: contactsFile.contacts ?? {},
    groups: contactsFile.groups ?? {},
    threads: phoneThreads,
    snoops,
    trials: mergeFolder(f, 'trials'),
    endings: f['endings']?.endings ?? {},
    flowchart: f['flowchart']?.nodes ?? {},
    extras: {
      cg: listOf(f['extras']?.cg),
      music: listOf(f['extras']?.music),
      videos: listOf(f['extras']?.videos),
    },
  };
}

function listOf(v: any): ExtraItem[] {
  return Array.isArray(v) ? v.filter((x) => x && typeof x === 'object' && x.id) : [];
}

function resolveNames(names: Record<string, string>) {
  const out: Record<string, string> = { ...DEFAULT_NAMES };
  for (const [k, v] of Object.entries(names)) if (!isTodo(v)) out[k] = v;
  return out;
}

// ── 전역 접근 ────────────────────────────────────────────────

export let C: Content;
export function setContent(c: Content) {
  C = c;
}

/** "%notebook%" → 기능 이름 */
export function names(text: string): string {
  if (typeof text !== 'string') return String(text ?? '');
  return text.replace(/%(\w+)%/g, (m, k) => {
    if (k === 'player') {
      const pid = Object.entries(C.characters).find(([, d]) => d.player)?.[0];
      return pid ? charName(pid) : m;
    }
    return C.game.names[k] ?? m;
  });
}

/** ui.yaml 문구 가져오기.  t('toast.clue_get', { name: '깨진 컵' }) */
export function t(path: string, vars: Record<string, string | number> = {}): string {
  let v: any = C.ui;
  for (const p of path.split('.')) v = v?.[p];
  if (v === undefined || v === null) return `[${path}]`;
  let s = names(String(v));
  s = s.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m));
  return s;
}

/** 캐릭터 id 또는 한글 이름 → id */
export function charId(nameOrId: string): string | undefined {
  if (!nameOrId) return undefined;
  const key = nameOrId.trim();
  if (C.characters[key]) return key;
  for (const [id, def] of Object.entries(C.characters)) if (def.name === key) return id;
  return undefined;
}

/** 설정에서 정한 교주 이름 (빈 칸이면 기본 이름) */
let playerNameOverride = '';
export function setPlayerName(name: string) {
  playerNameOverride = (name ?? '').trim();
}

export function charName(id: string): string {
  if (id === 'unknown') return orDefault(C.contacts.unknown?.name, t('phone.unknown_sender'));
  const def = C.characters[id];
  if (def) return def.player ? playerNameOverride || orDefault(t('dialogue.player_name'), def.name) : def.name;
  return C.contacts[id]?.name ?? id;
}

export function charColor(id: string | undefined): string {
  if (!id) return 'var(--name-default)';
  const c = C.characters[id]?.color ?? C.extraSpeakers[id]?.color ?? C.contacts[id]?.color;
  return isTodo(c) || !c ? 'var(--name-default)' : c;
}

/** 한글 감정 이름 → 파일 이름 */
export function emotionKey(e: string | undefined): string {
  const def = orDefault(C.config?.characters?.default_emotion, 'normal');
  if (!e) return def;
  return C.emotionAliases[e] ?? e;
}

export function cfg<T = any>(path: string, fallback: T): T {
  let v: any = C.config;
  for (const p of path.split('.')) v = v?.[p];
  return v === undefined || v === null ? fallback : (v as T);
}
