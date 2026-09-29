/// <reference types="vite/client" />

// tools/vite-plugin-ink.ts 가 만들어 주는 가상 모듈 (컴파일된 ink JSON 문자열)
declare module 'virtual:ink-story' {
  const json: string;
  export default json;
}

/** 배포 번호 (vite.config.ts 의 define) */
declare const __BUILD_ID__: string;
