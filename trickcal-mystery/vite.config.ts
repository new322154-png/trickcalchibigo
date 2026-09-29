import { defineConfig } from 'vite';
import inkPlugin from './tools/vite-plugin-ink';

export default defineConfig({
  // Cloudflare Pages / GitHub Pages 어디서든 동작하도록 상대 경로로 빌드
  base: './',
  plugins: [inkPlugin({ entry: 'content/story/main.ink' })],
  // 배포할 때마다 바뀌는 번호. 에셋 주소 뒤에 붙여서 예전에 캐시된 파일 대신 새 파일을 받게 한다
  define: { __BUILD_ID__: JSON.stringify(Date.now().toString(36)) },
  server: { port: 5173, open: true },
  build: {
    outDir: 'dist',
    // public/assets(게임 에셋)와 섞이지 않게 코드 파일은 build/ 폴더로
    assetsDir: 'build',
    assetsInlineLimit: 0,
    chunkSizeWarningLimit: 4000,
  },
});
