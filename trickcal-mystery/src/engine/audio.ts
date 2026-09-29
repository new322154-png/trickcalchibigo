/**
 * 배경음악·효과음.  파일 위치: public/assets/bgm/{이름}.mp3 (없으면 .ogg), public/assets/se/{이름}.mp3
 * 파일이 없어도 오류 없이 조용히 넘어간다 (에셋 작업 전에도 대본 테스트 가능).
 * 배경음악은 곡 전체를 한 번 튼 뒤, extras.yaml 의 loop: [시작초, 끝초] 구간을 끊김 없이 반복한다.
 */
import { asset } from '../ui/dom';
import { C } from './content';
import { P, S, markSeen } from './state';

// 배경음악은 Web Audio 로 재생한다: 끊김 없는 반복 + 곡 안의 반복 구간(extras.yaml 의 loop)
let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let cur: { src: AudioBufferSourceNode; gain: GainNode } | null = null;
let bgmName = '';
let token = 0;
const buffers = new Map<string, Promise<AudioBuffer | null>>();

function src(folder: string, name: string) {
  return asset(/\.\w{3,4}$/.test(name) ? `${folder}/${name}` : `${folder}/${name}.mp3`);
}

function audioCtx() {
  if (!ctx) {
    ctx = new AudioContext();
    master = ctx.createGain();
    master.connect(ctx.destination);
    applyVolume();
  }
  if (ctx.state === 'suspended') {
    // 브라우저 자동재생 제한: 첫 클릭·키 입력 때 소리를 켠다
    const resume = () => {
      void ctx!.resume();
      window.removeEventListener('pointerdown', resume, true);
      window.removeEventListener('keydown', resume, true);
    };
    window.addEventListener('pointerdown', resume, true);
    window.addEventListener('keydown', resume, true);
  }
  return ctx;
}

function loadBuffer(name: string): Promise<AudioBuffer | null> {
  if (!buffers.has(name)) {
    const tryFetch = async (url: string) => {
      const res = await fetch(url);
      if (!res.ok || (res.headers.get('content-type') ?? '').includes('text/html')) throw new Error('없음');
      return audioCtx().decodeAudioData(await res.arrayBuffer());
    };
    const url = src('bgm', name);
    buffers.set(name, tryFetch(url).catch(() => tryFetch(url.replace(/\.mp3(\?|$)/, '.ogg$1'))).catch(() => null));
  }
  return buffers.get(name)!;
}

/** extras.yaml 의 music 항목에 적힌 반복 구간 [시작초, 끝초] */
function loopOf(name: string): [number, number] | null {
  const loop = C.extras?.music?.find((m) => m.id === name)?.loop;
  return Array.isArray(loop) && loop.length === 2 && loop[1] > loop[0] ? [Number(loop[0]), Number(loop[1])] : null;
}

export function playBgm(name: string) {
  if (name === bgmName) return;
  S.stage.bgm = name;
  stopBgm();
  bgmName = name;
  if (!name || name === 'none') return;
  markSeen('bgmHeard', name);
  const my = ++token;
  void loadBuffer(name).then((buf) => {
    if (!buf || my !== token) return;
    const c = audioCtx();
    const gain = c.createGain();
    gain.gain.setValueAtTime(0, c.currentTime);
    gain.gain.linearRampToValueAtTime(1, c.currentTime + 0.4);
    gain.connect(master!);
    const node = c.createBufferSource();
    node.buffer = buf;
    node.loop = true;
    const loop = loopOf(name);
    if (loop && loop[1] <= buf.duration) {
      node.loopStart = loop[0];
      node.loopEnd = loop[1];
    }
    node.connect(gain);
    node.start();
    cur = { src: node, gain };
  });
}

export function stopBgm() {
  token++;
  bgmName = '';
  if (cur && ctx) {
    const { src: node, gain } = cur;
    const t = ctx.currentTime;
    gain.gain.cancelScheduledValues(t);
    gain.gain.setValueAtTime(gain.gain.value, t);
    gain.gain.linearRampToValueAtTime(0, t + 0.5);
    node.stop(t + 0.55);
  }
  cur = null;
}

export function playSe(name: string) {
  if (!name) return;
  const el = new Audio(src('se', name));
  el.volume = P.settings.se * P.settings.master;
  el.play().catch(() => {});
}

export function applyVolume() {
  if (master) master.gain.value = P.settings.bgm * P.settings.master;
}

/** 지금 게임에서 흐르는 배경음악 이름 */
export function currentBgm() {
  return bgmName;
}

/** 음악 감상실을 여는 동안 게임 배경음악을 잠시 멈추고, 닫으면 이어 튼다 */
export function pauseBgm(paused: boolean) {
  if (!ctx) return;
  if (paused) void ctx.suspend();
  else void ctx.resume();
}

/** 배경음악 파일 주소 (음악 감상실용) */
export function bgmSrc(name: string) {
  return src('bgm', name);
}
