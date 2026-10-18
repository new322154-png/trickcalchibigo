// Cloudflare Workers 런타임 타입 (필요한 것만)
interface DurableObjectId {}
interface DurableObjectStub {
  fetch(input: string | Request, init?: RequestInit): Promise<Response>;
}
interface DurableObjectNamespace {
  idFromName(name: string): DurableObjectId;
  get(id: DurableObjectId, opts?: { locationHint?: string }): DurableObjectStub;
}
interface SqlCursor { toArray(): Record<string, string | number | null>[] }
interface DurableObjectStorage {
  get<T = unknown>(key: string): Promise<T | undefined>;
  put(key: string, value: unknown): Promise<void>;
  sql: { exec(query: string, ...bindings: unknown[]): SqlCursor };
}
interface DurableObjectState {
  id: DurableObjectId;
  storage: DurableObjectStorage;
  blockConcurrencyWhile<T>(fn: () => Promise<T>): Promise<T>;
}
interface CfWebSocket extends WebSocket {
  accept(): void;
}
declare class WebSocketPair {
  0: CfWebSocket;
  1: CfWebSocket;
}
interface ResponseInit {
  webSocket?: WebSocket;
}
