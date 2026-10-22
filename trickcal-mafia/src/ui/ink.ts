/**
 * 잉크 선 아이콘: 화면 장식용 이모지(☀ 🗳 ⚖ 🔒 …)를 같은 펜 선으로 그린 그림으로 바꾼다.
 * (사람이 쓴 채팅 · 감정표현 · 컷씬 말풍선의 이모지는 그대로 컬러 그림)
 * 모두 24×24, 선 색은 글자색(currentColor)을 따른다.
 */
const P: Record<string, string> = {
  sun: '<circle cx="12" cy="12" r="4.2"/><path d="M12 2.8v2.4M12 18.8v2.4M2.8 12h2.4M18.8 12h2.4M5.5 5.5l1.7 1.7M16.8 16.8l1.7 1.7M5.5 18.5l1.7-1.7M16.8 7.2l1.7-1.7"/>',
  moon: '<path d="M19.5 14.8A8 8 0 1 1 9.2 4.5a6.4 6.4 0 0 0 10.3 10.3z"/>',
  ballot: '<path d="M4 11h16v9H4zM8 11V4h8v7M10 7.5l1.5 1.5L14.5 6"/>',
  scales: '<path d="M12 4v16M7 20h10M5 7h14M5 7l-2.5 6a3 3 0 0 0 5 0zM19 7l-2.5 6a3 3 0 0 0 5 0z"/>',
  drone: '<path d="M9 11h6v4H9zM5 9h4M15 9h4M7 9v2M17 9v2M9 15l-2 3M15 15l2 3"/><circle cx="5" cy="8" r="1"/><circle cx="19" cy="8" r="1"/>',
  bread: '<path d="M5 11a4 4 0 0 1 3-7h8a4 4 0 0 1 3 7v8H5z"/><path d="M9 8c1 1 1 2 0 3M14 8c1 1 1 2 0 3"/>',
  cards: '<rect x="4" y="5" width="11" height="15" rx="1.5" transform="rotate(-8 9 12)"/><rect x="9" y="4" width="11" height="15" rx="1.5"/><path d="M14.5 9.5l1.5 2-1.5 2-1.5-2z"/>',
  lock: '<rect x="5" y="10.5" width="14" height="10" rx="1.5"/><path d="M8 10.5V7.5a4 4 0 0 1 8 0v3M12 14.5v2.5"/>',
  mail: '<rect x="3" y="6" width="18" height="12" rx="1.5"/><path d="m3.5 7 8.5 6 8.5-6"/>',
  camera: '<path d="M4 8h3l1.5-2h7L17 8h3v11H4z"/><circle cx="12" cy="13" r="3.5"/>',
  wheat: '<path d="M12 21V8M12 11c-3-1-4-3-4-5 3 0 4 2 4 5zM12 11c3-1 4-3 4-5-3 0-4 2-4 5zM12 16c-3-1-4-3-4-5 3 0 4 2 4 5zM12 16c3-1 4-3 4-5-3 0-4 2-4 5zM12 8c-1-2-1-3 0-5 1 2 1 3 0 5z"/>',
  speak: '<path d="M9 20v-3a6 6 0 1 1 6-6v2l1.5 1.5L15 15v2h-3"/><path d="M19 7c1.2 1.4 1.2 4.6 0 6M21.5 5c2 2.6 2 7.4 0 10"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M12 3v2.5M12 18.5V21M3 12h2.5M18.5 12H21M5.6 5.6l1.8 1.8M16.6 16.6l1.8 1.8M5.6 18.4l1.8-1.8M16.6 7.4l1.8-1.8"/><circle cx="12" cy="12" r="6.3"/>',
  pad: '<path d="M7 8h10a4 4 0 0 1 4 4v1.5a3.5 3.5 0 0 1-6.3 2.1L14 15h-4l-.7.6A3.5 3.5 0 0 1 3 13.5V12a4 4 0 0 1 4-4z"/><path d="M8 10.5v3M6.5 12h3"/><circle cx="16" cy="11" r=".6"/><circle cx="17.5" cy="13" r=".6"/>',
  robot: '<rect x="5" y="8" width="14" height="11" rx="2"/><path d="M12 8V5M9 13h.01M15 13h.01M9.5 16h5"/><circle cx="12" cy="4" r="1"/>',
  masks: '<path d="M3 6c3 1 6 1 9 0v5a4.5 4.5 0 0 1-9 0z"/><path d="M12 9c3 1 6 1 9 0v5a4.5 4.5 0 0 1-9 0"/><path d="M5.5 9h1.5M9 9h1M15 12.5h1M18 12.5h1M6.5 13c.8.6 1.7.6 2.5 0M16 17c.8-.6 1.7-.6 2.5 0"/>',
  burst: '<path d="M12 3l1.6 5 4.4-2.6-1.9 4.8 5 1.3-4.7 2 2.8 4.4-5-1.7-1 5-2.3-4.6L6.8 19l1.6-4.9-5-1.6 5-1.7-2.2-4.6 4.6 2.5z"/>',
  people: '<circle cx="9" cy="8" r="3"/><path d="M3.5 19a5.5 5.5 0 0 1 11 0"/><circle cx="16.5" cy="9" r="2.4"/><path d="M15 13.2a4.5 4.5 0 0 1 6 4.8"/>',
  hourMinus: '<path d="M6 3h12M6 21h12M7 3c0 5 5 6 5 9s-5 4-5 9M17 3c0 5-5 6-5 9s5 4 5 9"/><path d="M9 12h0"/>',
  hourPlus: '<path d="M6 3h12M6 21h12M7 3c0 5 5 6 5 9s-5 4-5 9M17 3c0 5-5 6-5 9s5 4 5 9"/>',
  hush: '<circle cx="12" cy="12" r="8.5"/><path d="M8.5 10h.01M15.5 10h.01M8 15h8M9.5 14v2M12 14v2M14.5 14v2"/>',
  trophy: '<path d="M8 4h8v5a4 4 0 0 1-8 0zM8 6H4.5a3 3 0 0 0 3.5 4M16 6h3.5a3 3 0 0 1-3.5 4M12 13v4M8.5 20h7M10 17h4v3h-4z"/>',
  wrench: '<path d="M14.5 4a4.5 4.5 0 0 0-4.2 6.1L4 16.4 7.6 20l6.3-6.3A4.5 4.5 0 0 0 20 9.5l-2.8 2.8-3-3L17 6.5A4.5 4.5 0 0 0 14.5 4z"/>',
  crown: '<path d="M4 8l4 4 4-6 4 6 4-4-2 10H6z"/><path d="M6 21h12"/>',
  flask: '<path d="M9.5 3h5M10.5 3v6L5 19a1.5 1.5 0 0 0 1.3 2h11.4a1.5 1.5 0 0 0 1.3-2l-5.5-10V3"/><path d="M7.5 15h9"/>',
  hands: '<path d="M3 12l4-4 4 2 2-1 4-1 4 4M7 8l5 6M3 12l5 5 2-1 2 2 2-1 2 1 3-3-4-4"/>',
  steps: '<path d="M8 3c1.8 0 2.5 2 2.5 4S9.5 11 8 11 5.5 9 5.5 7 6.2 3 8 3zM6 13h4l-.5 3a2 2 0 0 1-3 0zM16 8c1.8 0 2.5 2 2.5 4s-1 4-2.5 4-2.5-2-2.5-4 .7-4 2.5-4zM14 18h4l-.5 2.5a2 2 0 0 1-3 0z"/>',
  scroll: '<path d="M7 4h11a2 2 0 0 1 2 2v1h-3M7 4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7M7 4a2 2 0 0 1 2 2v12M11 9h5M11 12h5M11 15h3"/>',
  wish: '<path d="M14 3l1.4 3.6L19 8l-3.6 1.4L14 13l-1.4-3.6L9 8l3.6-1.4zM3 21l7-7"/><path d="M5 15l1 0M9 19v1"/>',
  bolt: '<path d="M13 2 5 13h6l-1 9 8-11h-6z"/>',
  ghost: '<path d="M5 20V11a7 7 0 0 1 14 0v9l-2.3-1.6L14.3 20 12 18.4 9.7 20l-2.4-1.6z"/><path d="M9.5 11h.01M14.5 11h.01"/>',
  door: '<path d="M6 21V4h12v17M3.5 21h17"/><circle cx="14.5" cy="12.5" r=".9"/>',
  eye: '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="3"/>',
  chat: '<path d="M4 5h16v11H9l-5 4z"/>',
  hourglass: '<path d="M6 3h12M6 21h12M7 3c0 5 5 6 5 9s-5 4-5 9M17 3c0 5-5 6-5 9s5 4 5 9M9.5 18h5"/>',
  signal: '<path d="M12 20v-6"/><circle cx="12" cy="12" r="1.5"/><path d="M8.5 15.5a5 5 0 0 1 0-7M15.5 8.5a5 5 0 0 1 0 7M5.6 18.4a9 9 0 0 1 0-12.8M18.4 5.6a9 9 0 0 1 0 12.8"/>',
  warn: '<path d="M12 3.5 21 19.5H3z"/><path d="M12 10v4.5M12 17h.01"/>',
  zzz: '<path d="M4 9h5l-5 6h5M12 5h5l-5 6h5M15 14h4l-4 5h4"/>',
  no: '<circle cx="12" cy="12" r="8.5"/><path d="M6 6l12 12"/>',
  clapper: '<path d="M4 10h16v10H4zM4 10l1-4 15-2 .5 3.5M8 5.5l2 3.5M13 4.8l2 3.6"/>',
  disk: '<path d="M4 4h13l3 3v13H4z"/><path d="M8 4v5h7V4M8 20v-6h8v6"/>',
  share: '<path d="M12 15V3M8 7l4-4 4 4M5 12v8h14v-8"/>',
  link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
  sound: '<path d="M4 9h4l5-4v14l-5-4H4z"/><path d="M16 9a4 4 0 0 1 0 6M18.5 6.5a8 8 0 0 1 0 11"/>',
  bell: '<path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15zM10 20a2 2 0 0 0 4 0"/>',
  mute: '<path d="M4 9h4l5-4v14l-5-4H4z"/><path d="M16.5 9.5l5 5M21.5 9.5l-5 5"/>',
  search: '<circle cx="10" cy="10" r="6"/><path d="M14.5 14.5 20 20"/>',
  skull: '<path d="M12 3a8 8 0 0 0-8 8c0 2.5 1.2 4 3 5v3h10v-3c1.8-1 3-2.5 3-5a8 8 0 0 0-8-8z"/><circle cx="9" cy="11.5" r="1.6"/><circle cx="15" cy="11.5" r="1.6"/><path d="M10 19v-2M14 19v-2"/>',
  heal: '<path d="M12 20s-7.5-4.6-7.5-10A4.3 4.3 0 0 1 12 7.5 4.3 4.3 0 0 1 19.5 10C19.5 15.4 12 20 12 20z"/><path d="M12 10v5M9.5 12.5h5"/>',
  shield: '<path d="M12 3 5 6v5c0 4.5 3 8 7 10 4-2 7-5.5 7-10V6z"/>',
  bat: '<path d="M2 9c2 0 3 1 3.5 3 1-1 2.5-1 3.5 0 .5-1.5 1.5-3 3-3s2.5 1.5 3 3c1-1 2.5-1 3.5 0 .5-2 1.5-3 3.5-3-1 3-2.5 6-5 7.5-1-1-2-1-3 0-1-1-2-1-3 0-1-1-2-1-3 0C4.5 15 3 12 2 9z"/>',
  plug: '<path d="M9 3v5M15 3v5M7 8h10v3a5 5 0 0 1-10 0zM12 16v5"/>',
  phone: '<rect x="7" y="2.5" width="10" height="19" rx="2"/><path d="M11 18.5h2"/>',
  bug: '<ellipse cx="12" cy="13.5" rx="5.5" ry="6.5"/><path d="M12 7v13M9 6.5 7.5 4M15 6.5 16.5 4M6.5 11H3.5M17.5 11h3M6.5 15.5H3.5M17.5 15.5h3"/>',
  star: '<path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z"/>',
};
/** 이모지 → 아이콘 이름 */
export const INK: Record<string, string> = {
  '☀': 'sun', '☀️': 'sun', '🌙': 'moon', '🗳': 'ballot', '🗳️': 'ballot', '⚖': 'scales', '⚖️': 'scales', '🛸': 'drone', '🍞': 'bread', '🃏': 'cards',
  '🔒': 'lock', '✉': 'mail', '✉️': 'mail', '📸': 'camera', '🌾': 'wheat', '🗣': 'speak', '🗣️': 'speak', '⚙': 'gear', '⚙️': 'gear', '🎮': 'pad', '🤖': 'robot',
  '🎭': 'masks', '💥': 'burst', '👥': 'people', '⏬': 'hourMinus', '⏫': 'hourPlus', '🤐': 'hush', '🏆': 'trophy', '🔧': 'wrench', '👑': 'crown',
  '🧪': 'flask', '🤝': 'hands', '👣': 'steps', '📜': 'scroll', '🌠': 'wish', '⚡': 'bolt', '👻': 'ghost', '🚪': 'door', '👀': 'eye', '💬': 'chat',
  '⏳': 'hourglass', '📡': 'signal', '⚠': 'warn', '⚠️': 'warn', '😴': 'zzz', '🚫': 'no', '🎬': 'clapper', '💾': 'disk', '📤': 'share', '🔗': 'link',
  '🔊': 'sound', '🔔': 'bell', '🔇': 'mute', '🔍': 'search', '🔎': 'search', '💀': 'skull', '💚': 'heal', '🛡': 'shield', '🛡️': 'shield', '🦇': 'bat',
  '🔌': 'plug', '📱': 'phone', '⭐': 'star', '🐞': 'bug',
};
const SVGNS = 'http://www.w3.org/2000/svg';
export function inkIcon(e: string): SVGSVGElement | null {
  const name = INK[e] ?? INK[e.split(String.fromCharCode(0xfe0f)).join('')];
  if (!name) return null;
  const s = document.createElementNS(SVGNS, 'svg');
  s.setAttribute('viewBox', '0 0 24 24');
  s.setAttribute('class', `ink ink-${name}`);
  s.setAttribute('aria-label', e);
  s.innerHTML = P[name];
  return s;
}
/** 이 글자 위치는 사람이 쓴 말·감정표현·컷씬이라 컬러 그림을 써야 하는 곳인지 */
export const COLOR_ZONE = '.gl-chat, .cl-line, .ch-bubble, .sc-bubble, .emote-bar, .emo-pop, .emo-float, .va-bub, .bt-sweat, .fa-bang, .f-say, .nl.dead, .nl.nifel, .chat-log .cl-line';
