import { defineConfig } from 'vite';
// __BUILD__: 빌드 시각 (디버그 표시·버그 제보 때 어느 버전인지 확인용)
export default defineConfig({ base: './', build: { outDir: 'dist' }, define: { __BUILD__: JSON.stringify(new Date().toISOString().slice(0, 16).replace('T', ' ')) } });
