// Cloudflare Workers 런타임 타입 (필요한 것만)
interface DurableObjectId {}
interface DurableObjectStub {
  fetch(input: string | Request, init?: RequestInit): Promise<Response>;
}
interface DurableObjectNamespace {
  idFromName(name: string): DurableObjectId;
  get(id: DurableObjectId): DurableObjectStub;
}
interface DurableObjectState {
  id: DurableObjectId;
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
