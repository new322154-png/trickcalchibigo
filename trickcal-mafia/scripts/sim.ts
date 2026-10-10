// 봇끼리 대량 시뮬레이션: node 로 실행 (esbuild 로 번들)
import { Game, type HumanIO } from '../src/engine/game';
import type { Difficulty } from '../src/engine/types';

const io: HumanIO = {
  log() {}, update() {}, pause: async () => {}, typing: async () => {},
  night: async () => null, batChoose: async () => 'citizen', day: async () => {},
  vote1: async () => null, defense: async () => '', vote2: async () => null,
  overturn: async () => false, agitate: async () => null, avenge: async () => null,
  gotMansionNote: async () => {}, gameOver: async () => {},
};

const N = Number(process.argv[2] ?? 300);
for (const diff of ['easy', 'normal', 'hard'] as Difficulty[]) {
  const rows: string[] = [];
  for (let count = 4; count <= 12; count++) {
    const w: Record<string, number> = { mafia: 0, citizen: 0, jester: 0, draw: 0 };
    let days = 0;
    for (let i = 0; i < N; i++) {
      const g = new Game({ count, difficulty: diff, humans: 0, seed: i * 7919 + count }, io);
      await g.run();
      w[g.winner!]++;
      days += g.day;
    }
    rows.push(`${count}인  시민 ${(w.citizen / N * 100).toFixed(0)}%  마피아 ${(w.mafia / N * 100).toFixed(0)}%  광대 ${(w.jester / N * 100).toFixed(0)}%  무 ${(w.draw / N * 100).toFixed(0)}%  평균 ${(days / N).toFixed(1)}일`);
  }
  console.log(`[${diff}]\n` + rows.join('\n'));
}
