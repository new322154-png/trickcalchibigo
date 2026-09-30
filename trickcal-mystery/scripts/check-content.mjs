#!/usr/bin/env node
/**
 * 콘텐츠 검사기
 *
 *   npm run check          → 문법 오류와 "끊어진 연결"(없는 knot, 없는 단서 id 등)을 찾는다
 *   npm run todo           → 파일별로 아직 안 채운 TODO 개수
 *   npm run todo:list      → 안 채운 칸마다 "파일:줄  질문" 목록
 *
 * 오류(✖)가 있으면 빌드가 멈추고, 경고(!)는 알려만 준다.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CONTENT = path.join(ROOT, 'content');
const args = process.argv.slice(2);
const TODO_MODE = args.includes('--todo');
const LIST = args.includes('--list');

const errors = [];
const warnings = [];
const err = (file, msg) => errors.push(`✖ ${file}: ${msg}`);
const warn = (file, msg) => warnings.push(`! ${file}: ${msg}`);
const isTodo = (v) => v === undefined || v === null || (typeof v === 'string' && /^\s*TODO\s*$/.test(v));
const rel = (f) => path.relative(ROOT, f).split(path.sep).join('/');

// ── 파일 모으기 (_ 로 시작하는 폴더 제외) ──
function walk(dir, ext, out = []) {
  for (const name of fs.readdirSync(dir)) {
    if (name.startsWith('_') || name.startsWith('.')) continue;
    const full = path.join(dir, name);
    if (fs.statSync(full).isDirectory()) walk(full, ext, out);
    else if (name.endsWith(ext)) out.push(full);
  }
  return out;
}
const yamlFiles = walk(CONTENT, '.yaml');
const inkFiles = walk(path.join(CONTENT, 'story'), '.ink');

// ── TODO 집계 ──
if (TODO_MODE) {
  let total = 0;
  const rows = [];
  for (const f of [...yamlFiles, ...inkFiles].sort()) {
    const lines = fs.readFileSync(f, 'utf-8').split('\n');
    const isInk = f.endsWith('.ink');
    let lastQ = '';
    let qUsed = true;
    let section = '';
    let count = 0;
    const items = [];
    lines.forEach((line, i) => {
      const trimmed = line.trim();
      // 구역 이름 (yaml 맨 왼쪽 키 / ink knot·stitch)
      const sec = isInk ? line.match(/^\s*={1,3}\s*(?:function\s+)?(\w+)/) : line.match(/^([\w-]+):/);
      if (sec) section = sec[1];
      const q = line.match(/(?:#|\/\/)\s*Q:\s*(.*)$/);
      if (q) {
        lastQ = q[1];
        qUsed = false;
      }
      if (trimmed.startsWith('#') || trimmed.startsWith('//')) return;
      const code = isInk ? line : line.replace(/\s#.*$/, '');
      const hit = isInk ? /\(TODO\)/.test(code) : /(?:^|[\s\[{,:-])TODO(?=\s*(?:$|[\]},]))/.test(code);
      if (hit) {
        count++;
        const qText = !qUsed && lastQ ? `   ← Q: ${lastQ}` : '';
        qUsed = true;
        items.push(`   ${rel(f)}:${i + 1}  [${section}] ${code.trim()}${qText}`);
      }
    });
    total += count;
    if (count) rows.push([rel(f), count, items]);
  }
  console.log('\n📝 아직 채우지 않은 칸 (TODO)\n');
  for (const [file, count, items] of rows) {
    console.log(`  ${String(count).padStart(4)}  ${file}`);
    if (LIST) console.log(items.join('\n') + '\n');
  }
  console.log(`\n  합계 ${total}개\n`);
  if (!LIST) console.log('  줄 번호와 질문까지 보려면:  npm run todo:list\n');
  process.exit(0);
}

// ── YAML 읽기 ──
const data = {};
for (const f of yamlFiles) {
  const key = rel(f).replace(/^content\//, '').replace(/\.yaml$/, '');
  try {
    data[key] = YAML.parse(fs.readFileSync(f, 'utf-8')) ?? {};
  } catch (e) {
    err(rel(f), `YAML 문법 오류 — ${e.message.split('\n')[0]}`);
  }
}

// ── ink 컴파일 ──
let knots = new Set();
let inkSource = '';
for (const f of inkFiles) inkSource += '\n' + fs.readFileSync(f, 'utf-8');
try {
  const ink = loadInkCompiler();
  const entry = path.join(CONTENT, 'story', 'main.ink');
  const root = path.dirname(entry);
  const inkErrors = [];
  const fileHandler = {
    ResolveInkFilename: (name) => path.resolve(root, name),
    LoadInkFileContents: (full) => fs.readFileSync(full, 'utf-8'),
  };
  const options = new ink.CompilerOptions('main.ink', [], false, (msg, type) => {
    if (type === 2) inkErrors.push(msg);
  }, fileHandler);
  const compiler = new ink.Compiler(fs.readFileSync(entry, 'utf-8'), options);
  let story = null;
  try {
    story = compiler.Compile();
  } catch (e) {
    if (!inkErrors.length) inkErrors.push(String(e.message ?? e));
  }
  for (const m of inkErrors) err('ink 대본', m);
  if (story) {
    const json = JSON.parse(story.ToJson());
    const named = json.root[json.root.length - 1] ?? {};
    knots = new Set(Object.keys(named).filter((k) => !k.startsWith('#')));
  }
} catch (e) {
  err('ink', e.message);
}

function loadInkCompiler() {
  const tries = [
    () => require('inkjs/full'),
    () => require('inkjs/dist/ink-full.js'),
    () => ({ Compiler: require('inkjs/compiler/Compiler').Compiler, CompilerOptions: require('inkjs/compiler/CompilerOptions').CompilerOptions }),
  ];
  for (const t of tries) {
    try {
      const m = t();
      if (m?.Compiler && m?.CompilerOptions) return m;
    } catch {}
  }
  throw new Error('inkjs 컴파일러를 찾지 못했습니다. npm install 을 먼저 실행하세요.');
}

// ── 모으기 ──
const merge = (prefix, pick = (d) => d) => {
  const out = {};
  for (const [k, v] of Object.entries(data)) if (k.startsWith(prefix + '/')) Object.assign(out, pick(v) ?? {});
  return out;
};
const characters = { ...(data.characters ?? {}) };
delete characters.emotion_aliases;
delete characters.extra_speakers;
const charIds = new Set(Object.keys(characters));
const charNames = new Map(Object.entries(characters).map(([id, d]) => [d?.name, id]));
const toChar = (x) => (charIds.has(x) ? x : charNames.get(x));
const evidence = data.evidence?.items ?? {};
const rooms = data.locations?.rooms ?? {};
const investigations = merge('investigations');
const trials = merge('trials');
const boards = {};
const conclusions = {};
for (const [k, v] of Object.entries(data)) {
  if (!k.startsWith('board/')) continue;
  for (const [id, b] of Object.entries(v ?? {})) {
    if (id === 'conclusions') Object.assign(conclusions, b);
    else boards[id] = b;
  }
}
const threads = {};
const snoops = {};
for (const [k, v] of Object.entries(data)) {
  if (!k.startsWith('phone/') || k === 'phone/contacts') continue;
  Object.assign(threads, v?.threads ?? {});
  Object.assign(snoops, v?.snoop ?? {});
}
const groups = data['phone/contacts']?.groups ?? {};
const contacts = data['phone/contacts']?.contacts ?? {};
const endings = data.endings?.endings ?? {};
const flow = data.flowchart?.nodes ?? {};
const tutorials = data['text/tutorial'] ?? {};
const items = data.items?.items ?? {};
const truths = data.truths?.truths ?? {};
const days = data.days?.days ?? {};

// ── 검사 도우미 ──
const needKnot = (file, where, k) => {
  if (!k || isTodo(k)) return;
  const base = String(k).split('.')[0];
  if (knots.size && !knots.has(base)) err(file, `${where}: 대본에 "${k}" knot 이 없습니다`);
};
const needEvidence = (file, where, id) => {
  if (!id || isTodo(id) || String(id).startsWith('cap:')) return;
  if (!evidence[id]) err(file, `${where}: evidence.yaml 에 "${id}" 단서가 없습니다`);
};
const needChar = (file, where, id, extra = []) => {
  if (!id || isTodo(id) || extra.includes(id)) return;
  if (!toChar(id)) err(file, `${where}: characters.yaml 에 "${id}" 캐릭터가 없습니다`);
};
const needItem = (file, where, id) => {
  if (!id || isTodo(id)) return;
  if (!items[id]) err(file, `${where}: items.yaml 에 "${id}" 아이템이 없습니다`);
};
const needHabit = (file, where, key) => {
  if (!key || isTodo(key)) return;
  const [who, hid] = String(key).split('.');
  const c = toChar(who);
  if (!c) return err(file, `${where}: characters.yaml 에 "${who}" 캐릭터가 없습니다`);
  if (!hid || !(characters[c]?.habits ?? {})[hid]) warn(file, `${where}: ${who} 의 habits 에 "${hid}" 가 없습니다`);
};
const needRoom = (file, where, id) => {
  if (!id || isTodo(id)) return;
  if (!rooms[id]) err(file, `${where}: locations.yaml 에 "${id}" 방이 없습니다`);
};

// ── 조사 ──
for (const [id, inv] of Object.entries(investigations)) {
  const f = `investigations(${id})`;
  needRoom(f, 'start_room', inv.start_room);
  for (const r of inv.rooms ?? []) needRoom(f, 'rooms', r);
  for (const c of inv.required ?? []) needEvidence(f, 'required', c);
  needKnot(f, 'on_complete', inv.on_complete);
  for (const [room, spots] of Object.entries(inv.spots ?? {})) {
    needRoom(f, 'spots', room);
    checkSpots(f, room, spots?.hotspots, inv);
    for (const p of spots?.people ?? []) {
      needChar(f, `${room}.people`, p.who);
      needKnot(f, `${room}.people.knot`, p.knot);
      for (const tp of p.topics ?? []) {
        needEvidence(f, `${room}.${p.who}.topics.${tp.id}.clue`, tp.clue);
        needKnot(f, `${room}.${p.who}.topics.${tp.id}.knot`, tp.knot);
        if (tp.habit) needHabit(f, `${room}.${p.who}.topics.${tp.id}.habit`, `${p.who}.${tp.habit}`);
      }
      for (const [k, v] of Object.entries(p.present ?? {})) {
        if (!evidence[k] && !items[k] && !String(k).startsWith('photo:')) warn(f, `${room}.${p.who}.present: "${k}" 는 단서도 아이템도 아닙니다`);
        if (typeof v === 'string' && v.startsWith('knot:')) needKnot(f, `${room}.${p.who}.present.${k}`, v.slice(5).trim());
      }
    }
  }
  for (const [cid, cu] of Object.entries(inv.closeups ?? {})) checkSpots(f, `closeups.${cid}`, cu?.hotspots, inv);
  for (const [room, list] of Object.entries(inv.diffs ?? {})) {
    needRoom(f, 'diffs', room);
    for (const d of list ?? []) needEvidence(f, `diffs.${room}.${d.id}.clue`, d.clue);
  }
}
function checkSpots(f, where, list, inv) {
  for (const sp of list ?? []) {
    const w = `${where}/${sp.id}`;
    needEvidence(f, `${w}.clue`, sp.clue);
    needKnot(f, `${w}.knot`, sp.knot);
    needItem(f, `${w}.item`, sp.item);
    if (sp.closeup && !(inv.closeups ?? {})[sp.closeup]) err(f, `${w}.closeup: closeups 에 "${sp.closeup}" 가 없습니다`);
    for (const d of [sp.use, sp.lock]) {
      if (!d) continue;
      if (d === sp.use) needItem(f, `${w}.use.item`, d.item);
      if (!d.flag) err(f, `${w}: use/lock 에는 flag 가 꼭 있어야 합니다`);
      needEvidence(f, `${w}.clue`, d.clue);
      needItem(f, `${w}.give_item`, d.give_item);
      if (d.closeup && !(inv.closeups ?? {})[d.closeup]) err(f, `${w}.closeup: closeups 에 "${d.closeup}" 가 없습니다`);
    }
    if (!Array.isArray(sp.rect) || sp.rect.length !== 4) warn(f, `${w}: rect 는 [가로, 세로, 너비, 높이] 4개 숫자여야 합니다`);
  }
}
const protect = data.days?.protect ?? {};
for (const [who, until] of Object.entries(protect)) needChar('days(protect)', who, who);
for (const [d, def] of Object.entries(days)) {
  const f = `days(${d})`;
  needChar(f, 'impostor', def?.impostor);
  needChar(f, 'vanish_if_missed', def?.vanish_if_missed);
  needKnot(f, 'on_found', def?.on_found);
  needKnot(f, 'on_missed', def?.on_missed);
  const v = toChar(def?.vanish_if_missed);
  if (v && Number(protect[v] ?? 0) >= Number(d) + 1)
    err(f, `vanish_if_missed: ${v} 는 protect 로 ${protect[v]}일째까지 보호됩니다 — ${Number(d) + 1}일째 아침에 사라질 수 없어요`);
  if (v && toChar(def?.impostor) === v) warn(f, '가짜와 사라질 사람이 같습니다 (의도한 것인지 확인)');
  if (def?.critical) {
    if (!def.bad_ending || isTodo(def.bad_ending)) warn(f, 'critical: 이 날 실패했을 때의 bad_ending 을 적어 주세요');
    else if (!endings[def.bad_ending]) err(f, `bad_ending: endings.yaml 에 "${def.bad_ending}" 가 없습니다`);
  }
}
/** 그 날(D일째)에 이미 사라졌을 수도 있는 사람 → 사라진 날 */
const mayBeGone = (day) => {
  const out = new Map();
  for (const [d, def] of Object.entries(days)) {
    const v = toChar(def?.vanish_if_missed);
    if (v && Number(d) + 1 <= day && !out.has(v)) out.set(v, Number(d) + 1);
  }
  return out;
};
for (const [id, tr] of Object.entries(trials)) {
  if (tr?.if_suspected && !trials[tr.if_suspected]) err(`trials(${id})`, `if_suspected: trials 폴더에 "${tr.if_suspected}" 가 없습니다`);
}
for (const [id, r] of Object.entries(rooms)) for (const d of r?.doors ?? []) needRoom(`locations(${id})`, 'doors', d);

// ── 추리 보드 ──
for (const [id, b] of Object.entries(boards)) {
  const f = `board(${id})`;
  needKnot(f, 'on_complete', b.on_complete);
  for (const s of b.sentences ?? []) {
    for (const [n, blank] of Object.entries(s.blanks ?? {})) {
      if (isTodo(blank?.answer)) continue;
      if (blank.kind === 'evidence') needEvidence(f, `${s.id}[${n}]`, blank.answer);
      if (blank.kind === 'person') needChar(f, `${s.id}[${n}]`, blank.answer);
      if (blank.kind === 'word' && !(b.words ?? {})[blank.answer]) err(f, `${s.id}[${n}]: words 에 "${blank.answer}" 가 없습니다`);
      if (!isTodo(s.text) && !String(s.text).includes(`[${n}]`)) warn(f, `${s.id}: 문장에 [${n}] 빈칸이 없습니다`);
    }
    if (s.reward && !isTodo(s.reward) && !conclusions[s.reward]) err(f, `${s.id}.reward: conclusions 에 "${s.reward}" 가 없습니다`);
  }
}

// ── 휴대폰 ──
for (const [id, th] of Object.entries(threads)) {
  const f = `phone(${id})`;
  if (!groups[th.with] && !contacts[th.with]) needChar(f, 'with', th.with);
  const labels = new Set((th.messages ?? []).filter((m) => m.label).map((m) => m.label));
  for (const m of th.messages ?? []) {
    if (m.from && !contacts[m.from]) needChar(f, 'from', m.from);
    needEvidence(f, 'clue', m.clue);
    for (const o of m.choice?.options ?? []) if (o.goto && !labels.has(o.goto)) err(f, `goto "${o.goto}" label 이 없습니다`);
    const tg = m.choice?.on_timeout?.goto;
    if (tg && !labels.has(tg)) err(f, `on_timeout.goto "${tg}" label 이 없습니다`);
  }
  needKnot(f, 'on_end', th.on_end);
}
for (const [id, s] of Object.entries(snoops)) {
  needChar(`snoop(${id})`, 'owner', s.owner);
  for (const m of s.messages ?? []) needEvidence(`snoop(${id})`, 'clue', m.clue);
}

// ── 재판 ──
for (const [id, tr] of Object.entries(trials)) {
  const f = `trials(${id})`;
  for (const [k, v] of Object.entries(tr.results ?? {})) {
    if (k === 'wrong_by_target') for (const [who, knot] of Object.entries(v ?? {})) { needChar(f, 'wrong_by_target', who); needKnot(f, `wrong_by_target.${who}`, knot); }
    else needKnot(f, `results.${k}`, v);
  }
  for (const r of tr.chat?.rounds ?? []) {
    const ids = new Set();
    const collect = (list) => (list ?? []).forEach((m) => { ids.add(m.id); needChar(f, `${r.id}/${m.id}.from`, m.from); collect(m.ask); });
    collect(r.messages);
    const a = r.answer ?? {};
    if (a.type === 'rebut') {
      if (a.message && !ids.has(a.message)) err(f, `${r.id}.answer.message "${a.message}" 가 메시지 목록에 없습니다`);
      needEvidence(f, `${r.id}.answer.evidence`, a.evidence);
      if (String(a.evidence ?? '').startsWith('cap:') && !ids.has(a.evidence.slice(4))) err(f, `${r.id}.answer.evidence "${a.evidence}" 캡처할 메시지가 없습니다`);
    } else if (a.type === 'compare') {
      for (const mid of a.messages ?? []) if (!ids.has(mid)) err(f, `${r.id}.answer.messages "${mid}" 가 메시지 목록에 없습니다`);
    } else warn(f, `${r.id}: answer.type 은 rebut 또는 compare 여야 합니다`);
    for (const w of r.whispers ?? []) { needChar(f, `${r.id}.whispers`, w.from); if (!ids.has(w.after)) warn(f, `${r.id}.whispers.after "${w.after}" 메시지가 없습니다`); }
  }
  for (const r of tr.counter?.rounds ?? []) if (r.defense?.type === 'evidence') needEvidence(f, `${r.id}.defense`, r.defense.evidence);
  const op = tr.opinion;
  if (op) {
    needChar(f, 'opinion.culprit', op.culprit);
    if (isTodo(op.culprit)) warn(f, 'opinion.culprit(진범)이 아직 TODO 입니다');
    for (const [who, v] of Object.entries(op.initial ?? {})) { needChar(f, 'opinion.initial', who); needChar(f, `opinion.initial.${who}.target`, v?.target); }
    for (const [cid, c] of Object.entries(op.cards ?? {})) {
      if (!conclusions[cid]) err(f, `opinion.cards: conclusions 에 "${cid}" 가 없습니다`);
      needChar(f, `opinion.cards.${cid}.accuses`, c?.accuses);
    }
    for (const r of op.rebuttals ?? []) for (const [who, target] of Object.entries(r.sway ?? {})) { needChar(f, 'rebuttals.sway', who); needChar(f, 'rebuttals.sway', target); }
  }
}

// ── 엔딩·흐름도 ──
for (const [id, e] of Object.entries(endings)) {
  if (e.type === 'branch' && !e.checkpoint) warn(`endings(${id})`, '파생 엔딩인데 checkpoint 가 없어 "돌아가기"가 안 뜹니다');
}
for (const [id, n] of Object.entries(flow)) {
  if (n.parent && !flow[n.parent]) err(`flowchart(${id})`, `parent "${n.parent}" 지점이 없습니다`);
  if (n.type === 'ending' && !endings[id]) err(`flowchart(${id})`, 'endings.yaml 에 같은 id 의 엔딩이 없습니다');
}

// ── ink 태그 → yaml 연결 ──
const tagRe = /#\s*(\w+)\s*:\s*([^\s#]+)/g;
for (const f of inkFiles) {
  const text = fs.readFileSync(f, 'utf-8');
  const lines = text.split('\n');
  lines.forEach((line, i) => {
    const code = line.replace(/\/\/.*$/, '');
    for (const m of code.matchAll(tagRe)) {
      const [, cmd, arg] = m;
      const where = `${rel(f)}:${i + 1}`;
      switch (cmd) {
        case 'clue': case 'clue_update': needEvidence(where, `#${cmd}`, arg); break;
        case 'conclusion': if (!conclusions[arg]) err(where, `#conclusion: "${arg}" 결론 카드가 없습니다`); break;
        case 'investigate': if (!investigations[arg]) err(where, `#investigate: investigations 폴더에 "${arg}" 가 없습니다`); break;
        case 'board': if (!boards[arg]) err(where, `#board: board 폴더에 "${arg}" 가 없습니다`); break;
        case 'trial': if (!trials[arg]) err(where, `#trial: trials 폴더에 "${arg}" 가 없습니다`); break;
        case 'phone': case 'notify': if (!threads[arg]) err(where, `#${cmd}: phone 폴더에 "${arg}" 대화가 없습니다`); break;
        case 'ending': if (!endings[arg]) err(where, `#ending: endings.yaml 에 "${arg}" 가 없습니다`); break;
        case 'tutorial': if (!tutorials[arg]) warn(where, `#tutorial: tutorial.yaml 에 "${arg}" 가 없습니다`); break;
        case 'node': if (!flow[arg]) warn(where, `#node: flowchart.yaml 에 "${arg}" 지점이 없습니다`); break;
        case 'show': case 'hide': case 'vanish': case 'return': needChar(where, `#${cmd}`, arg); break;
        case 'affinity': needChar(where, '#affinity', arg); break;
        case 'item': case 'lose_item': needItem(where, `#${cmd}`, arg); break;
        case 'confine': case 'release': needChar(where, `#${cmd}`, arg); break;
        case 'truth': if (!truths[arg]) err(where, `#truth: truths.yaml 에 "${arg}" 가 없습니다`); break;
        case 'habit': case 'mismatch': needHabit(where, `#${cmd}`, arg); break;
        case 'fx': if (!['dust', 'rain', 'embers', 'none'].includes(arg)) warn(where, `#fx: dust / rain / embers / none 중 하나여야 합니다`); break;
        case 'time': if (!['morning', 'day', 'night'].includes(arg)) warn(where, `#time: morning / day / night 중 하나여야 합니다`); break;
        case 'chapter': if (!(data.chapters ?? {})[arg]) warn(where, `#chapter: chapters.yaml 에 "${arg}" 가 없습니다`); break;
      }
    }
  });
}

// ── 이야기 줄기 지키기: 사라졌을 수도 있는 사람의 대사 ──
// 대본 파일(또는 knot)에  // @day 3  처럼 며칠째 장면인지 적어 두면,
// 그날까지 사라졌을 수 있는 캐릭터가 { present("sila"): … } 없이 말할 때 경고한다.
// #next_day 를 지나면 날짜가 하나 올라간 것으로 본다.
const speakerRe = /^\s*([^\s:#{}()\-*+][^:#{}()]{0,14}?)\s*(?:\([^)]*\))?\s*:\s*\S/;
for (const f of inkFiles) {
  const lines = fs.readFileSync(f, 'utf-8').split('\n');
  let day = 0;
  const stack = []; // 열린 { } 블록마다 그 안에서 보장되는 캐릭터
  let reported = new Set();
  lines.forEach((raw, i) => {
    const dayMark = raw.match(/\/\/\s*@day\s*:?\s*(\d+)/);
    if (dayMark) { day = Number(dayMark[1]); reported = new Set(); }
    const line = raw.replace(/\/\/.*$/, '');
    // 블록 안의 분기  - present("x"): …
    const branch = line.match(/^\s*-\s*[^:]*present\(\s*"(\w+)"\s*\)[^:]*:/);
    if (branch && stack.length) stack[stack.length - 1] = toChar(branch[1]) ?? branch[1];
    else if (/^\s*-\s*(else)?\s*:/.test(line) && stack.length) stack[stack.length - 1] = null;
    const inlineGuards = [...line.matchAll(/present\(\s*"(\w+)"\s*\)/g)].map((m) => toChar(m[1]) ?? m[1]);
    if (day > 0) {
      const gone = mayBeGone(day);
      const sp = line.replace(/^\s*\{[^:{}]*:\s*/, '').match(speakerRe);
      const who = sp ? toChar(sp[1].trim()) : null;
      if (who && gone.has(who) && !stack.includes(who) && !inlineGuards.includes(who) && !reported.has(who)) {
        reported.add(who);
        warn(`${rel(f)}:${i + 1}`, `${day}일째 장면인데 ${who} 는 ${gone.get(who)}일째 아침부터 사라졌을 수 있어요 → { present("${who}"): … | 없을 때 대사 } 로 나눠 주세요`);
      }
    }
    // 블록 열고 닫기
    for (const ch of line) {
      if (ch === '{') {
        const g = line.match(/\{\s*[^:{}]*present\(\s*"(\w+)"\s*\)[^:{}]*:/);
        stack.push(g ? toChar(g[1]) ?? g[1] : null);
      } else if (ch === '}') stack.pop();
    }
    if (/#\s*next_day\b/.test(line) && day > 0) { day += 1; reported = new Set(); }
  });
}

// ── 결과 ──
console.log('');
if (warnings.length) console.log(warnings.join('\n') + '\n');
if (errors.length) {
  console.log(errors.join('\n'));
  console.log(`\n✖ 오류 ${errors.length}개, 경고 ${warnings.length}개 — 오류를 고쳐야 빌드할 수 있습니다.\n`);
  process.exit(1);
}
console.log(`✔ 검사 통과 (경고 ${warnings.length}개, 대본 knot ${knots.size}개, yaml ${yamlFiles.length}개, ink ${inkFiles.length}개)`);
console.log('  남은 TODO 는  npm run todo  로 확인하세요.\n');
