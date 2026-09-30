/**
 * ink 대본 래퍼.
 * - 컴파일된 대본(JSON)을 불러오고, 대본의 EXTERNAL 함수들을 게임 상태에 연결한다.
 * - 한 줄씩 꺼내면서 "이름(감정): 대사" 형식을 해석한다.
 */
import { Story as InkStory } from 'inkjs';
import storyJson from 'virtual:ink-story';
import { C, charId, emotionKey } from './content';
import { P, S, impostorDays, impostorToday, isPresent } from './state';
import { hash } from './util';

export interface Line {
  raw: string;
  body: string;
  speakerId?: string; // 캐릭터 id (캐릭터가 아니면 undefined)
  speakerName?: string; // 이름표에 보여줄 이름
  emotion?: string;
  tags: string[];
  id: string; // 읽음 기록용
}

export interface ChoiceItem {
  index: number;
  text: string;
  tags: string[];
}

let story: InkStory;

export function createStory() {
  story = new InkStory(storyJson);
  story.onError = (msg: string) => {
    console.error('[ink]', msg);
  };
  bindExternals();
  return story;
}

function bindExternals() {
  const bind = (name: string, fn: (...args: any[]) => any) => {
    try {
      story.BindExternalFunction(name, fn, true);
    } catch (e) {
      // 대본에서 EXTERNAL 선언을 지웠으면 그냥 넘어간다
      console.warn(`[ink] EXTERNAL ${name} 연결 실패`, e);
    }
  };
  bind('has_clue', (id: string) => S.evidence.includes(id));
  bind('has_card', (id: string) => S.conclusions.includes(id));
  bind('affinity', (who: string) => S.affinity[charId(who) ?? who] ?? 0);
  bind('suspicion', () => S.suspicion);
  bind('suspected', (id: string) => S.marks.some((m) => m.id === id));
  bind('flag', (name: string) => !!S.flags[name]);
  bind('present', (who: string) => isPresent(charId(who) ?? who));
  bind('seen_ending', (id: string) => P.endingsSeen.includes(id));
  bind('voted', () => S.lastVote || '');
  bind('has_item', (id: string) => S.items.includes(id));
  bind('confined', (who: string) => S.confined.includes(charId(who) ?? who));
  bind('has_truth', (id: string) => S.truths.includes(id));
  bind('knows_habit', (key: string) => S.habits.includes(key));
  bind('anomalies', (who: string) => S.anomalies.filter((a) => !who || a.who === (charId(who) ?? who)).length);
  bind('time_now', () => S.time);
  bind('day', () => S.day);
  bind('impostor', () => impostorToday());
  bind('was_impostor', (who: string) => impostorDays(charId(who) ?? who).length > 0);
  bind('found_today', () => S.found.includes(S.day));
  bind('found_day', (d: number) => S.found.includes(Number(d)));
}

export function inkStory() {
  return story;
}

export function canContinue() {
  return story.canContinue;
}

export function nextLine(): Line {
  const before = story.state.currentPathString ?? '';
  const raw = (story.Continue() ?? '').replace(/\n$/, '');
  const tags = [...(story.currentTags ?? [])].map((t) => t.trim());
  return { ...parseSpeaker(raw), raw, tags, id: hash(before + '|' + raw) };
}

export function choices(): ChoiceItem[] {
  return story.currentChoices.map((c: any) => ({ index: c.index, text: c.text, tags: c.tags ?? [] }));
}

export function choose(index: number) {
  story.ChooseChoiceIndex(index);
}

export function goto(knot: string) {
  story.ChoosePathString(knot);
}

export function saveInk(): string {
  return story.state.toJson();
}

export function loadInk(json: string) {
  story.state.LoadJson(json);
}

export function resetInk() {
  story.ResetState();
}

// ── "이름(감정): 대사" 해석 ─────────────────────────────────

const SPEAKER_RE = /^\s*([^:：()（）]{1,24}?)\s*(?:[(（]([^)）]{1,12})[)）])?\s*[:：]\s*(.*)$/s;

export function parseSpeaker(text: string): Pick<Line, 'body' | 'speakerId' | 'speakerName' | 'emotion'> {
  const m = text.match(SPEAKER_RE);
  if (m) {
    const [, name, emo, body] = m;
    const id = charId(name);
    const playerName = C.ui?.dialogue?.player_name;
    if (id) {
      return { body, speakerId: id, speakerName: undefined, emotion: emo ? emotionKey(emo) : undefined };
    }
    if (name === '교주' || name === playerName) {
      const pid = Object.entries(C.characters).find(([, d]) => d.player)?.[0];
      return { body, speakerId: pid, emotion: emo ? emotionKey(emo) : undefined };
    }
    if (C.extraSpeakers[name] || name === '???') {
      return { body, speakerName: name };
    }
  }
  // 캐릭터 이름이 아니면 지문
  // "(웃음)대사" 처럼 감정만 붙인 경우 → 직전 화자의 표정만 바꿈
  const em = text.match(/^\s*[(（]([^)）]{1,12})[)）]\s*(.*)$/s);
  if (em && C.emotionAliases[em[1]]) return { body: em[2], emotion: emotionKey(em[1]) };
  return { body: text };
}
