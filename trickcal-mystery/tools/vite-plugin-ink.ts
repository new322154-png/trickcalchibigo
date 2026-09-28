/**
 * ink 대본을 빌드 시점에 컴파일하는 Vite 플러그인.
 *
 * - 게임 코드에서 `import storyJson from 'virtual:ink-story'` 로 컴파일된 JSON을 받는다.
 * - 개발 서버(npm run dev)에서 .ink 파일을 저장하면 자동으로 다시 컴파일하고 새로고침한다.
 * - 문법 오류가 있으면 브라우저 화면에 "파일명, 줄 번호, 오류 내용"이 뜬다.
 */
import type { HmrContext, Plugin, ViteDevServer } from 'vite';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';

const require = createRequire(import.meta.url);

const VIRTUAL_ID = 'virtual:ink-story';
const RESOLVED_ID = '\0' + VIRTUAL_ID;

export interface InkCompileResult {
  json: string;
  files: string[];
  warnings: string[];
}

/** inkjs 의 컴파일러 불러오기 (버전에 따라 경로가 달라서 몇 곳을 시도) */
function loadInkCompiler(): { Compiler: any; CompilerOptions: any } {
  const tries = [
    () => require('inkjs/full'),
    () => require('inkjs/dist/ink-full.js'),
    () => ({
      Compiler: require('inkjs/compiler/Compiler').Compiler,
      CompilerOptions: require('inkjs/compiler/CompilerOptions').CompilerOptions,
    }),
  ];
  for (const t of tries) {
    try {
      const m = t();
      if (m?.Compiler && m?.CompilerOptions) return m;
    } catch {
      /* 다음 경로 시도 */
    }
  }
  throw new Error('inkjs 컴파일러를 찾지 못했습니다. npm install 을 먼저 실행하세요.');
}

/** check-content 스크립트와 공유하는 컴파일 함수 */
export function compileInk(entryPath: string): InkCompileResult {
  const { Compiler, CompilerOptions } = loadInkCompiler();
  const root = path.dirname(path.resolve(entryPath));
  const files: string[] = [path.resolve(entryPath)];
  const errors: string[] = [];
  const warnings: string[] = [];

  const fileHandler = {
    ResolveInkFilename: (filename: string) => path.resolve(root, filename),
    LoadInkFileContents: (fullFilename: string) => {
      files.push(fullFilename);
      return fs.readFileSync(fullFilename, 'utf-8');
    },
  };

  const errorHandler = (message: string, type: number) => {
    // type: 0 = Author(TODO), 1 = Warning, 2 = Error
    if (type === 2) errors.push(message);
    else warnings.push(message);
  };

  const source = fs.readFileSync(entryPath, 'utf-8');
  const options = new CompilerOptions(path.basename(entryPath), [], false, errorHandler, fileHandler);
  const compiler = new Compiler(source, options);

  let story: any = null;
  try {
    story = compiler.Compile();
  } catch (e) {
    if (errors.length === 0) errors.push(String(e));
  }
  if (errors.length > 0 || !story) {
    const err = new Error('ink 대본 컴파일 오류\n\n' + errors.join('\n'));
    (err as any).inkErrors = errors;
    throw err;
  }
  return { json: story.ToJson(), files, warnings };
}

export default function inkPlugin(opts: { entry: string }): Plugin {
  let lastFiles: string[] = [];
  return {
    name: 'trickcal-ink',
    resolveId(id: string) {
      if (id === VIRTUAL_ID) return RESOLVED_ID;
      return null;
    },
    load(id: string) {
      if (id !== RESOLVED_ID) return null;
      const result = compileInk(opts.entry);
      lastFiles = result.files;
      for (const f of result.files) this.addWatchFile(f);
      for (const w of result.warnings) this.warn(w);
      return `export default ${JSON.stringify(result.json)};`;
    },
    handleHotUpdate(ctx: HmrContext) {
      if (!ctx.file.endsWith('.ink')) return;
      const mod = ctx.server.moduleGraph.getModuleById(RESOLVED_ID);
      if (mod) ctx.server.moduleGraph.invalidateModule(mod);
      ctx.server.ws.send({ type: 'full-reload' });
      return [];
    },
    configureServer(server: ViteDevServer) {
      // 새로 추가한 .ink 파일도 감시
      server.watcher.add(path.resolve('content/story'));
      server.watcher.on('add', (file: string) => {
        if (file.endsWith('.ink') && !lastFiles.includes(file)) {
          const mod = server.moduleGraph.getModuleById(RESOLVED_ID);
          if (mod) server.moduleGraph.invalidateModule(mod);
        }
      });
    },
  };
}
