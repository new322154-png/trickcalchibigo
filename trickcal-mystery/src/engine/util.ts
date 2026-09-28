/** 작은 공용 도구들 */

/** 작가가 아직 안 채운 칸인가? */
export function isTodo(v: unknown): boolean {
  return v === undefined || v === null || (typeof v === 'string' && /^\s*TODO\s*$/.test(v));
}

/** TODO 이거나 비어 있으면 기본값 */
export function orDefault<T>(v: T | undefined | null, fallback: T): T {
  if (isTodo(v) || v === '') return fallback;
  return v as T;
}

export function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

export function pick<T>(arr: T[] | undefined | null): T | undefined {
  if (!arr || arr.length === 0) return undefined;
  return arr[Math.floor(Math.random() * arr.length)];
}

export function asArray<T>(v: T | T[] | undefined | null): T[] {
  if (v === undefined || v === null) return [];
  return Array.isArray(v) ? v : [v];
}

export function sleep(ms: number) {
  return new Promise<void>((r) => setTimeout(r, ms));
}

/** 짧은 문자열 해시 (읽은 대사 기록용) */
export function hash(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

/** "{name}" 자리 채우기 */
export function fill(template: string, vars: Record<string, string | number> = {}): string {
  return template.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m));
}

/**
 * 게임을 처음으로 되돌리거나 불러올 때, 기다리던 입력(클릭, 선택)을 모두 취소하기 위한 장치.
 * UI 쪽 await 은 전부 waitFor() 로 만들고, reset 때 cancelAll() 을 부른다.
 */
export class Aborted extends Error {
  constructor() {
    super('aborted');
  }
}

const pendingRejects = new Set<(e: Error) => void>();

export function waitFor<T>(executor: (resolve: (v: T) => void) => void | (() => void)): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let cleanup: void | (() => void);
    const rej = (e: Error) => {
      pendingRejects.delete(rej);
      if (cleanup) cleanup();
      reject(e);
    };
    pendingRejects.add(rej);
    cleanup = executor((v) => {
      pendingRejects.delete(rej);
      if (cleanup) cleanup();
      resolve(v);
    });
  });
}

export function cancelAllWaits() {
  for (const rej of [...pendingRejects]) rej(new Aborted());
}
