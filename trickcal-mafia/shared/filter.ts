/**
 * 채팅 검열 · 도배 방지 (서버에서 처리, 대기실 채팅 · 게임 채팅 · 쪽지 · 닉네임).
 *
 * 가벼운 욕(씨발 등)은 그대로 두고, 아래 목록의 심한 말만 ***로 가린다.
 * 띄어쓰기 · 숫자 · 기호를 끼워 넣어도 잡는다 (예: "느 1 금 마").
 * 목록에 넣고 빼기만 하면 된다. 너무 짧은 말(두 글자)은 다른 낱말 속에서 잘못 걸리기 쉬우니 조심.
 */
export const BANNED: string[] = [
  // 패드립 (부모 욕)
  '느금마', '느금빠', '니애미', '니애비', '느그애미', '느그애비', '느그엄마', '니미럴', '니기미', '애미뒤', '애비뒤', '애미없', '애비없',
  '엄마없는새', '아빠없는새', '엠창', '앰창', '니엄마죽', '부모없', '고아새',
  // 성적인 말
  '섹스', '보지털', '보짓', '자지털', '좆물', '강간', '윤간', '딸딸이', '야동', '자위행위', '창녀', '창년', '걸레년',
  // 혐오 · 비하
  '한남충', '김치녀', '김치남', '된장녀', '메갈', '일베충', '홍어새', '홍어족', '틀딱', '짱깨', '쪽바리', '깜둥', '흑형', '애자새', '장애인새',
  '정신병자새', '병신새끼들', '게이새', '트젠',
  // 위협
  '자살해', '자살하라', '칼빵', '목매달',
  // 영어
  'nigger', 'nigga', 'faggot', 'retard',
];

/** 검사할 때 무시하는 글자 (공백 · 숫자 · 기호) */
const SKIP = /[\s0-9!-/:-@[-`{-~·•…’‘“”、。ㆍ]/;

const words = BANNED.map((w) => [...w.toLowerCase()].filter((c) => !SKIP.test(c)).join('')).filter((w) => w.length >= 2);

/** 심한 말을 ***로 바꾼다 (원문의 띄어쓰기는 그대로 둔다) */
export function censor(text: string): string {
  const chars = [...text];
  const kept: string[] = [];
  const at: number[] = [];
  chars.forEach((c, i) => { if (!SKIP.test(c)) { kept.push(c.toLowerCase()); at.push(i); } });
  const flat = kept.join('');
  const hit = new Array<boolean>(chars.length).fill(false);
  let any = false;
  for (const w of words) {
    let from = 0;
    for (;;) {
      const k = flat.indexOf(w, from);
      if (k < 0) break;
      for (let j = at[k]; j <= at[k + w.length - 1]; j++) hit[j] = true;
      any = true;
      from = k + 1;
    }
  }
  if (!any) return text;
  return chars.map((c, i) => (hit[i] && !/\s/.test(c) ? '*' : c)).join('');
}

/** 같은 글자 반복은 8개까지만 (ㅋㅋㅋㅋ… 도배) */
export const squash = (text: string) => text.replace(/(.)\1{8,}/gu, (_m, c: string) => c.repeat(8));

/** 비교용: 공백·기호 빼고 소문자 */
const norm = (t: string) => [...t.toLowerCase()].filter((c) => !SKIP.test(c)).join('');

/**
 * 도배 판정: 같은 말을 5초 안에 연달아 보내거나, 최근 5개 중 3개가 같은 말이면 막는다.
 * hist 는 사람마다 하나씩 들고 있는 [시각, 정규화한 말] 목록.
 */
export function isSpam(hist: [number, string][], text: string, now: number): boolean {
  const n = norm(text) || text;
  while (hist.length && now - hist[0][0] > 30_000) hist.shift();
  const last = hist[hist.length - 1];
  const same = hist.slice(-5).filter(([, t]) => t === n).length;
  if ((last && last[1] === n && now - last[0] < 5000) || same >= 2) return true;
  hist.push([now, n]);
  if (hist.length > 8) hist.shift();
  return false;
}

/** 채팅 한 줄 정리: 제어 문자 제거 · 길이 제한 · 반복 줄이기 · 검열 */
const CTRL = new RegExp(`[${String.fromCharCode(0)}-${String.fromCharCode(31)}${String.fromCharCode(0x200b)}-${String.fromCharCode(0x200f)}${String.fromCharCode(0x2028)}-${String.fromCharCode(0x202e)}]`, 'g');
export const cleanText = (raw: unknown, max: number) => censor(squash(String(raw ?? '').replace(CTRL, '').trim().slice(0, max)));
