/**
 * 봇 말투. 성격마다 문장 후보가 있고 그중 하나를 무작위로 고른다.
 *   {t} = 대상 닉네임, {r} = 직업(캐릭터) 이름, {res} = 결과, {a}/{b} = 두 사람
 */
import type { PersonaId } from '../engine/types';
import { fill } from './talk';

export interface Persona {
  id: PersonaId;
  label: string;
  /** 일찍·과감하게 투표하는 정도 */
  aggro: number;
  /** 남의 주장을 믿는 정도 */
  trust: number;
  /** 다수를 따라가는 정도 */
  follow: number;
  /** 핵심 직업을 일찍 밝히는 정도 */
  open: number;
}

export const PERSONAS: Record<PersonaId, Persona> = {
  hot: { id: 'hot', label: '다혈질', aggro: 0.9, trust: 0.5, follow: 0.3, open: 0.8 },
  calm: { id: 'calm', label: '신중', aggro: 0.35, trust: 0.6, follow: 0.3, open: 0.4 },
  timid: { id: 'timid', label: '소심', aggro: 0.2, trust: 0.6, follow: 0.85, open: 0.3 },
  doubt: { id: 'doubt', label: '의심쟁이', aggro: 0.6, trust: 0.3, follow: 0.2, open: 0.5 },
  naive: { id: 'naive', label: '순진', aggro: 0.4, trust: 0.9, follow: 0.6, open: 0.9 },
};

type LineKey =
  | 'claim' | 'refuse' | 'stay' | 'investigate_m' | 'investigate_c' | 'protect' | 'track_none' | 'track_hit'
  | 'medium' | 'suspect' | 'nosuspect' | 'trust' | 'defend' | 'accused' | 'contra' | 'mnote' | 'counter'
  | 'lastwords' | 'vote_intent';

export const LINES: Record<PersonaId, Record<LineKey, string[]>> = {
  hot: {
    vote_intent: ['난 {t} 찍는다. 말리지 마!', '오늘은 {t}야. 확실해!'],
    claim: ['내가 {r:이다}! 됐냐?', '{r}! 나 {r:이라고}!'],
    refuse: ['그걸 왜 지금 말해야 되는데?', '때 되면 말할 거야. 재촉하지 마!'],
    stay: ['어젯밤? 방에서 잤지! 뭐!', '방에만 있었다니까!'],
    investigate_m: ['{t} 조사했어. 마피아야! 확실해!', '{t}! 너 딱 걸렸어. 마피아 나왔다!'],
    investigate_c: ['{t} 조사했는데 시민이더라.', '{t:는} 시민. 의심 풀어.'],
    protect: ['{t} 지켰어. 그게 다야.', '{t} 방 앞에서 밤새 지켰다고!'],
    track_none: ['{t} 지켜봤는데 아무 데도 안 갔어.'],
    track_hit: ['{t:가} 어젯밤 {res} 방에 들어가는 거 내가 봤어!!'],
    medium: ['사라진 {t}의 정체는 {res:이었}어!'],
    suspect: ['{t}! 너 진짜 수상해!', '난 {t} 찍는다. 이상하잖아!', '{t}, 아까부터 말이 너무 많아.'],
    nosuspect: ['아직은 모르겠어. 다들 수상해!'],
    trust: ['{t:는} 믿어도 될 것 같아.'],
    defend: ['나 아니라고!! 진짜 마피아 놓치는 거야!', '날 찍으면 너희가 지는 거다!', '억울해! 끝까지 싸울 거야!'],
    accused: ['뭐? 나를? 말도 안 돼!', '웃기지 마, {t}! 너야말로 수상해!'],
    contra: ['{a:와} {b} 말이 안 맞잖아! {t:가} 거짓말하는 거야!'],
    mnote: ['오늘 아침에 봉인된 쪽지 받았어! 내용은 이거야: {res}'],
    counter: ['{t:가} {r:이라고}? 웃기네. {r:는} 나야!'],
    lastwords: ['두고 봐… 내가 맞았다는 거 알게 될 거야!'],
  },
  calm: {
    vote_intent: ['저는 {t}에게 투표하겠습니다.', '정리하면, 오늘은 {t:가} 가장 유력해요.'],
    claim: ['제 직업은 {r}입니다.', '밝힐 때가 된 것 같네요. 저는 {r:이에요}.'],
    refuse: ['아직 밝힐 단계는 아닌 것 같습니다.', '조금 더 지켜본 뒤에 말씀드릴게요.'],
    stay: ['어젯밤엔 방에 있었습니다.', '밤새 방을 나서지 않았어요.'],
    investigate_m: ['{t:를} 조사했습니다. 결과는 마피아입니다.', '침착하게 들어주세요. {t:는} 마피아입니다.'],
    investigate_c: ['{t:를} 조사했고, 시민으로 나왔습니다.'],
    protect: ['어젯밤엔 {t:를} 지켰습니다.'],
    track_none: ['{t:를} 지켜봤지만 방을 나서지 않았어요.'],
    track_hit: ['{t:가} 어젯밤 {res}의 방을 찾아갔습니다. 확인한 사실이에요.'],
    medium: ['사라진 {t:는} {res:이었}습니다.'],
    suspect: ['지금까지 정황으로는 {t:가} 가장 의심스럽습니다.', '{t}의 발언에 앞뒤가 안 맞는 부분이 있어요.'],
    nosuspect: ['아직 판단할 근거가 부족합니다.'],
    trust: ['{t:는} 지금까지 일관적이었어요.'],
    defend: ['제 발언을 처음부터 다시 봐 주세요. 모순은 없습니다.', '저를 처형하면 마피아에게 하루를 벌어주는 셈입니다.'],
    accused: ['근거를 말씀해 주시겠어요, {t}?', '{t}, 그 주장은 성급합니다.'],
    contra: ['{a}의 발언과 {b}의 발언은 동시에 참일 수 없습니다. {t} 쪽이 거짓이에요.'],
    mnote: ['저택의 봉인 쪽지가 저에게 왔습니다. 내용: {res}'],
    counter: ['{t:가} {r:이라고}요? 이상하네요. {r:는} 저입니다.'],
    lastwords: ['제 발언을 잊지 마세요. 단서는 거기 있습니다.'],
  },
  timid: {
    vote_intent: ['저, 저는… {t}한테 할게요…'],
    claim: ['저, 저는… {r:이에요}…', '사실… 제 직업은 {r:이에요}…'],
    refuse: ['그, 그건 아직 말하기 무서워요…', '조금만 더 있다가요…'],
    stay: ['방에서… 이불 쓰고 있었어요…', '무서워서 방에만 있었어요…'],
    investigate_m: ['{t}… 조사했는데… 마, 마피아였어요…!'],
    investigate_c: ['{t:는} 시민이었어요… 다행이에요…'],
    protect: ['{t:를}… 지켰어요…'],
    track_none: ['{t:는}… 아무 데도 안 갔어요…'],
    track_hit: ['봤어요… {t:가} {res} 방에… 들어갔어요…!'],
    medium: ['{t:는}… {res:이었}대요…'],
    suspect: ['다들 {t} 이야기하길래… 저도 {t:가} 좀…', '{t}… 조금 무서워요…'],
    nosuspect: ['저는… 잘 모르겠어요…'],
    trust: ['{t:는}… 좋은 사람 같아요…'],
    defend: ['저, 저 아니에요…! 믿어주세요…', '살려주세요… 저 시민이에요…'],
    accused: ['네, 네…? 저요…?', '{t}… 왜 저를…'],
    contra: ['저기… {a:와} {b} 말이… 다른 것 같아요… {t:가} 거짓말…?'],
    mnote: ['저한테… 이상한 쪽지가 왔어요… {res}'],
    counter: ['어, 어…? {r:는}… 저인데요…? {t}…?'],
    lastwords: ['다들… 조심하세요…'],
  },
  doubt: {
    vote_intent: ['{t}. 내 표는 여기 간다.', '반대해도 소용없어. {t}다.'],
    claim: ['…좋아, 말할게. {r:이야}.', '{r:이다}. 믿든 말든.'],
    refuse: ['내가 왜 먼저 패를 까야 하지?', '수상한 사람 앞에서 직업 말할 생각 없어.'],
    stay: ['방에 있었어. 너희는 어디 있었는데?'],
    investigate_m: ['{t} 조사했어. 마피아. 역시 그럴 줄 알았지.'],
    investigate_c: ['{t:는} 시민으로 나왔어. …일단은.'],
    protect: ['{t} 지켰어. 이유는 묻지 마.'],
    track_none: ['{t:는} 방에만 있었어. 오히려 그게 수상하지만.'],
    track_hit: ['{t:가} 어젯밤 {res}한테 갔어. 내 눈으로 봤어.'],
    medium: ['{t:는} {res:이었}어. 이제 누가 거짓말했는지 보이지?'],
    suspect: ['{t}. 처음부터 마음에 안 들었어.', '난 {t} 의심해. 말이 너무 매끄러워.'],
    nosuspect: ['전부 다 의심스러워.'],
    trust: ['{t:는}… 아직까진 괜찮아.'],
    defend: ['날 의심하는 너희가 더 수상해.', '좋아, 날 처형해 봐. 내일 후회할 거야.'],
    accused: ['{t}, 날 찍는 이유가 뭐야? 너 마피아지?'],
    contra: ['{a:와} {b}, 둘 중 하나는 거짓말이야. 난 {t}라고 봐.'],
    mnote: ['나한테 봉인 쪽지가 왔어. {res} …이걸 믿을지는 너희 몫이야.'],
    counter: ['{t:가} {r}? 거짓말. {r:는} 나야.'],
    lastwords: ['내 말 안 들은 거, 후회할걸.'],
  },
  naive: {
    vote_intent: ['나는 {t}한테 투표할래!', '음… {t}! 오늘은 {t}로 할게!'],
    claim: ['나 {r:이야}! 다들 믿어줘!', '헤헤, 사실 나 {r}!'],
    refuse: ['음~ 비밀! 나중에 알려줄게!'],
    stay: ['어젯밤엔 푹 잤어!', '방에서 쿨쿨 잤지!'],
    investigate_m: ['큰일이야! {t} 조사했는데 마피아래!'],
    investigate_c: ['{t:는} 시민이야! 안심해도 돼!'],
    protect: ['어젯밤엔 {t:를} 지켰어!'],
    track_none: ['{t:는} 밤새 방에 있었어!'],
    track_hit: ['나 봤어! {t:가} {res} 방에 갔어!'],
    medium: ['{t:는} {res:이었}대! 그렇구나…'],
    suspect: ['음… {t:가} 좀 이상한 것 같아!', '{t}? 왠지 수상해!'],
    nosuspect: ['다들 착해 보이는데…'],
    trust: ['{t:는} 좋은 사람이야!'],
    defend: ['나 진짜 시민이야! 믿어줘!', '나 찍으면 슬플 거야… 진짜 아니야!'],
    accused: ['에엥? 나? 왜?', '{t}, 너무해!'],
    contra: ['어? {a:와} {b} 말이 다르잖아! {t:가} 거짓말한 거야?'],
    mnote: ['나 봉인된 쪽지 받았어! 이렇게 써 있어: {res}'],
    counter: ['어? {r:는} 난데? {t} 왜 거짓말해?'],
    lastwords: ['다들 꼭 이겨줘…!'],
  },
};

export function line(p: PersonaId, key: LineKey, vars: Record<string, string> = {}, rnd: () => number = Math.random) {
  const list = LINES[p][key];
  const s = list[Math.floor(rnd() * list.length)];
  return fill(s, vars);
}
