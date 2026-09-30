/**
 * 이벤트 버스 — 게임의 모든 "일"이 여기를 지나간다.
 * UI(알림, 인원 체크, 게이지)는 이벤트를 듣고 스스로 갱신한다.
 * 새 기능을 붙일 때도 이벤트만 들으면 되므로 다른 코드를 건드릴 필요가 적다.
 */
export interface GameEvents {
  clue: { id: string; update?: boolean };
  conclusion: { id: string };
  affinity: { who: string; delta: number; value: number };
  suspicion: { delta: number; value: number };
  flag: { name: string; value: boolean };
  vanish: { who: string };
  return: { who: string };
  mark: { id: string | null; speaker: string; text: string; correct: boolean };
  action: { type: string }; // 역습 방어전용 행동 기록 (snoop_caught 등)
  phone: { thread: string; notify: boolean };
  chapter: { id: string };
  node: { id: string };
  ending: { id: string };
  toast: { text: string; kind?: string };
  stateLoaded: {};
  item: { id: string; gained: boolean };
  confine: { who: string; confined: boolean };
  truth: { id: string };
  habit: { key: string };
  anomaly: { who: string; habit: string };
  time: { time: string };
  photo: { id: string };
  found: { day: number; who: string };
  day: { day: number; vanished: string | null };
}

type Handler<T> = (payload: T) => void;

class EventBus {
  private handlers = new Map<keyof GameEvents, Set<Handler<any>>>();

  on<K extends keyof GameEvents>(type: K, fn: Handler<GameEvents[K]>): () => void {
    if (!this.handlers.has(type)) this.handlers.set(type, new Set());
    this.handlers.get(type)!.add(fn);
    return () => this.handlers.get(type)!.delete(fn);
  }

  emit<K extends keyof GameEvents>(type: K, payload: GameEvents[K]) {
    this.handlers.get(type)?.forEach((fn) => {
      try {
        fn(payload);
      } catch (e) {
        console.error(`[event:${type}]`, e);
      }
    });
  }
}

export const events = new EventBus();
