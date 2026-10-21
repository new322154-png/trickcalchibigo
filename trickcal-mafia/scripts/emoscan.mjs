// 쓰는 이모지를 찾아 Twemoji SVG 를 public/assets/emoji 로 복사하고 src/ui/emoji-list.ts 를 만든다.
// 사용: git clone --depth 1 https://github.com/jdecked/twemoji 받은 뒤  node scripts/emoscan.mjs <twemoji>/assets/svg "추가로 넣을 이모지"
import fs from 'fs'; import path from 'path';
const ZWJ = String.fromCodePoint(0x200d), VS = String.fromCodePoint(0xfe0f);
const re = new RegExp(`\\p{Extended_Pictographic}(?:${VS}|[${String.fromCodePoint(0x1f3fb)}-${String.fromCodePoint(0x1f3ff)}])?(?:${ZWJ}\\p{Extended_Pictographic}${VS}?)*`, 'gu');
const extra = process.argv.slice(3).join('');
const found = new Set();
const walk = (d) => { for (const f of fs.readdirSync(d)) { const p = path.join(d, f); if (fs.statSync(p).isDirectory()) walk(p); else if (/\.(ts|html)$/.test(f)) for (const m of fs.readFileSync(p, 'utf8').matchAll(re)) found.add(m[0]); } };
for (const d of ['src', 'shared', 'index.html']) { if (fs.statSync(d).isDirectory()) walk(d); else for (const m of fs.readFileSync(d,'utf8').matchAll(re)) found.add(m[0]); }
for (const m of extra.matchAll(re)) found.add(m[0]);
const name = (e) => { let cps = [...e].map((c) => c.codePointAt(0).toString(16)); if (!e.includes(ZWJ)) cps = cps.filter((c) => c !== 'fe0f'); return cps.join('-'); };
const src = process.argv[2]; const out = 'public/assets/emoji'; fs.mkdirSync(out, { recursive: true });
const ok = [], miss = [];
for (const e of found) { const n = name(e); const f = path.join(src, n + '.svg'); if (fs.existsSync(f)) { fs.copyFileSync(f, path.join(out, n + '.svg')); ok.push(n); } else miss.push(e + ' ' + n); }
fs.writeFileSync('src/ui/emoji-list.ts', `/** 선명한 그림으로 바꿔 보여 줄 이모지 (public/assets/emoji/*.svg, Twemoji · CC-BY 4.0) — scripts/emoscan.mjs 로 생성 */\nexport const EMOJI_FILES = new Set(${JSON.stringify(ok.sort())});\n`);
console.log('ok', ok.length, 'miss', miss);
