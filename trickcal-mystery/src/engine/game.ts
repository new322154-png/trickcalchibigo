/**
 * 게임 진행의 중심.
 * ink 대본을 한 줄씩 읽고 → 태그를 실행하고 → 대사를 보여주고 → 선택지를 받고,
 * 모드 태그(#investigate, #board, #trial, #phone, #ending)를 만나면 그 모드로 넘겼다가
 * 모드가 알려주는 knot 에서 대본을 이어간다.
 */
import { C, cfg, charId, names, t } from './content';
import { events } from './events';
import {
  P, S, addAffinity, addSuspicion, applyEffect, giveClue, giveConclusion, logAction,
  newState, savePersist, setFlag, setState, unvanish, vanish,
} from './state';
import * as story from './story';
import type { Line } from './story';
import { Resume, Snapshot, applySnapshot, makeSnapshot, saveCheckpoint, writeSlot } from './save';
import { playBgm, playSe, stopBgm } from './audio';
import { Aborted, asArray, cancelAllWaits, hash, isTodo, pick, sleep, waitFor } from './util';
import * as scene from '../ui/scene';
import * as dlg from '../ui/dialogue';
import { closeAllModals, openModal, toast } from '../ui/modal';
import { clear, h, layer } from '../ui/dom';
import { refreshHud, setHudVisible } from '../ui/hud';
import { runInvestigation } from '../modes/investigation';
import { runBoard } from '../modes/board';
import { runPhoneThread } from '../modes/phone';
import { runTrial } from '../modes/trial';
import { runEnding } from '../modes/ending';

/** 대사 다음에 실행되는 태그 (화면이 바뀌는 것들) */
const DEFERRED = new Set(['investigate', 'board', 'trial', 'phone', 'ending', 'title']);

export type ModeResult = string | null; // 이어갈 knot 이름 (null 이면 원래 흐름 계속)

class Game {
  private runId = 0;
  private nextChoiceTimer = 0;
  private queued: string[] = [];
  resume: Resume = { mode: 'choices' };
  /** 모드 안에서 저장을 막을 때 true (재판 중) */
  saveLocked = false;
  onTitle: () => void = () => {};

  // ── 시작 / 불러오기 ─────────────────────────────

  async newGame() {
    await this.start(() => {
      story.resetInk();
      setState(newState());
      scene.hideAll();
      scene.setBg('');
      scene.setCg('');
      dlg.backlog.length = 0;
    });
  }

  async loadSnapshot(snap: Snapshot) {
    await this.start(async () => {
      applySnapshot(snap);
      scene.restoreStage();
      playBgm(S.stage.bgm);
      dlg.backlog.length = 0;
      events.emit('stateLoaded', {});
      await this.resumeFrom(snap.resume);
    });
  }

  /** 디버그: 지금 상태 그대로 원하는 knot 으로 이동 */
  async debugJump(knot: string) {
    await this.start(() => {
      if (!S) setState(newState());
      story.goto(knot);
    });
  }

  toTitle() {
    this.runId++;
    cancelAllWaits();
    closeAllModals();
    clear(layer('mode'));
    scene.hideAll();
    stopBgm();
    this.onTitle();
  }

  private async start(setup: () => void | Promise<void>) {
    const id = ++this.runId;
    cancelAllWaits();
    closeAllModals();
    clear(layer('mode'));
    dlg.stopAutoSkip();
    setHudVisible(true);
    refreshHud();
    try {
      await setup();
      this.check(id);
      await this.playUntilStop(id);
      this.check(id);
      // 대본이 완전히 끝남 → 타이틀로
      this.toTitle();
    } catch (e) {
      if (e instanceof Aborted) return;
      console.error(e);
      toast(String((e as Error).message ?? e), 'error');
    }
  }

  private check(id: number) {
    if (id !== this.runId) throw new Aborted();
  }

  private async resumeFrom(r: Resume) {
    const id = this.runId;
    if (r.mode === 'line' && r.line) {
      await this.showLine(r.line);
      this.check(id);
      await this.runDeferred(r.line.tags);
    } else if (r.mode === 'trial' && r.id) {
      await this.enterMode('trial', r.id);
    } else if (r.mode === 'investigate' && r.id) {
      await this.enterMode('investigate', r.id);
    } else if (r.mode === 'board' && r.id) {
      await this.enterMode('board', r.id);
    }
  }

  // ── 메인 루프 ───────────────────────────────────

  /** 대본이 더 이상 진행할 수 없을 때까지(DONE/END) 재생 */
  async playUntilStop(id = this.runId) {
    while (true) {
      this.check(id);
      if (story.canContinue()) {
        const line = story.nextLine();
        await this.applyTags(line.tags, line);
        this.check(id);
        if (line.body.trim()) {
          this.resume = { mode: 'line', line };
          await this.showLine(line);
          this.check(id);
        }
        await this.flushQueued();
        this.check(id);
        await this.runDeferred(line.tags);
        continue;
      }
      const choices = story.choices();
      if (choices.length > 0) {
        this.resume = { mode: 'choices' };
        const timer = this.nextChoiceTimer;
        this.nextChoiceTimer = 0;
        const idx = await dlg.choose(choices.map((c) => ({ text: c.text })), timer);
        this.check(id);
        dlg.backlog.push({ name: '▶', color: 'var(--accent)', text: names(choices[idx].text) });
        story.choose(choices[idx].index);
        continue;
      }
      return;
    }
  }

  /** knot 하나를 끝까지 재생 (조사 중 대화 등). 끝나면 호출한 곳으로 돌아감 */
  async runKnot(knot: string) {
    story.goto(knot);
    await this.playUntilStop();
  }

  private lastSpeaker: string | undefined;

  /** "(분노)대사" 처럼 감정만 붙은 줄 → 직전 화자가 이어서 말함 */
  private fillSpeaker(line: Line) {
    if (!line.speakerId && !line.speakerName && line.emotion) line.speakerId = this.lastSpeaker;
    if (line.speakerId) this.lastSpeaker = line.speakerId;
  }

  private async showLine(line: Line) {
    this.fillSpeaker(line);
    // 감정만 바뀌는 경우 표정 갱신
    if (line.speakerId && line.emotion) {
      if (S.stage.sprites[line.speakerId]) scene.setEmotion(line.speakerId, line.emotion);
    }
    const def = line.speakerId ? C.characters[line.speakerId] : undefined;
    const suspectable = !!def && !def.player;
    await dlg.say(line, { suspectable });
  }

  /** yaml 에 적힌 대사 목록 재생 */
  async sayLines(lines: string[] | string | undefined, opts: { suspectable?: boolean } = {}) {
    for (const raw of asArray(lines)) {
      if (raw === undefined || raw === null) continue;
      const text = String(raw);
      const parsed = story.parseSpeaker(text);
      const line: Line = { ...parsed, raw: text, tags: [], id: hash('yaml|' + text) };
      this.fillSpeaker(line);
      if (line.speakerId && line.emotion && S.stage.sprites[line.speakerId]) {
        scene.setEmotion(line.speakerId, line.emotion);
      }
      await dlg.say(line, { suspectable: opts.suspectable ?? false });
    }
  }

  /** 다른 창(폰 등)에서 반응 대사를 띄울 때: 대사가 떠 있으면 그 다음에, 아니면 바로 */
  async sayOrQueue(lines: string[]) {
    if (dlg.isSaying()) this.queued.push(...lines);
    else await this.sayLines(lines);
  }

  private async flushQueued() {
    while (this.queued.length) {
      const l = this.queued.shift()!;
      await this.sayLines([l]);
    }
  }

  // ── 태그 ────────────────────────────────────────

  private async applyTags(tags: string[], line: Line) {
    for (const tag of tags) {
      const [cmd, ...rest] = tag.split(':');
      const arg = rest.join(':').trim();
      const key = cmd.trim();
      if (DEFERRED.has(key)) continue;
      try {
        await this.tag(key, arg, line);
      } catch (e) {
        if (e instanceof Aborted) throw e;
        console.error(`[태그 오류] #${tag}`, e);
      }
    }
  }

  private async tag(cmd: string, arg: string, line: Line) {
    const args = arg.split(/\s+/).filter(Boolean);
    switch (cmd) {
      // 화면
      case 'bg': scene.setBg(arg); break;
      case 'cg': scene.setCg(arg); break;
      case 'show': {
        const who = charId(args[0]);
        if (who) scene.showChar(who, args[1], args[2]);
        else console.warn('[show] 모르는 캐릭터:', args[0]);
        break;
      }
      case 'hide': { const who = charId(args[0]); if (who) scene.hideChar(who); break; }
      case 'hideall': scene.hideAll(); break;
      case 'shake': await scene.shake(Number(args[0] || 1)); break;
      case 'flash': await scene.flash(args[0] || '#fff'); break;
      case 'fadeout': await scene.fade(true, Number(args[0] || 0.5) * 1000); break;
      case 'fadein': await scene.fade(false, Number(args[0] || 0.5) * 1000); break;
      case 'wait': await sleep(Number(arg || 1) * 1000); break;
      // 소리
      case 'bgm': playBgm(arg); break;
      case 'se': playSe(arg); break;
      // 상태
      case 'clue': giveClue(arg); await this.tutorial('notebook'); break;
      case 'clue_update': giveClue(arg, true); break;
      case 'conclusion': giveConclusion(arg); break;
      case 'affinity': addAffinity(charId(args[0]) ?? args[0], Number(args[1] ?? 1)); await this.tutorial('affinity'); break;
      case 'suspicion': addSuspicion(Number(arg || 1)); await this.tutorial('suspicion'); break;
      case 'flag': setFlag(arg, true); break;
      case 'unflag': setFlag(arg, false); break;
      case 'action': logAction(arg); break;
      case 'vanish': vanish(charId(arg) ?? arg); scene.hideChar(charId(arg) ?? arg); break;
      case 'return': unvanish(charId(arg) ?? arg); break;
      case 'effect': applyEffect(arg); break;
      // 진행 기록
      case 'chapter': await this.chapterCard(arg); break;
      case 'scene': S.scene = arg; break;
      case 'node': this.markNode(arg); break;
      case 'checkpoint': this.checkpoint(arg, { mode: 'line', line }); break;
      case 'tutorial': await this.tutorial(arg); break;
      case 'timer': this.nextChoiceTimer = Number(arg || 0); break;
      case 'notify': this.notify(arg); break;
      case 'suspect': break; // 의심 표시 정답 표시용 (onSuspect 에서 읽음)
      default:
        console.warn(`[태그] 모르는 태그 #${cmd}`);
    }
  }

  private async runDeferred(tags: string[]) {
    for (const tag of tags) {
      const [cmd, ...rest] = tag.split(':');
      const arg = rest.join(':').trim();
      if (!DEFERRED.has(cmd.trim())) continue;
      await this.enterMode(cmd.trim(), arg);
    }
  }

  /** 모드 실행 후, 모드가 알려준 knot 으로 이동 */
  async enterMode(mode: string, id: string) {
    const runId = this.runId;
    let next: ModeResult = null;
    dlg.stopAutoSkip();
    switch (mode) {
      case 'investigate':
        this.resume = { mode: 'investigate', id };
        next = await runInvestigation(id);
        break;
      case 'board':
        this.resume = { mode: 'board', id };
        next = await runBoard(id);
        break;
      case 'trial':
        this.checkpoint(C.trials[id]?.checkpoint ?? id, { mode: 'trial', id });
        this.saveLocked = true;
        try {
          next = await runTrial(id);
        } finally {
          this.saveLocked = false;
        }
        break;
      case 'phone':
        next = await runPhoneThread(id, true);
        break;
      case 'ending':
        await runEnding(id);
        // runEnding 이 체크포인트/타이틀로 이동시키므로 여기로 돌아오지 않음
        throw new Aborted();
      case 'title':
        this.toTitle();
        throw new Aborted();
    }
    this.check(runId);
    if (next) {
      story.goto(next);
    }
  }

  // ── 의심 표시 ───────────────────────────────────

  onSuspect(line: Line) {
    const tag = line.tags.find((t) => t.startsWith('suspect'));
    const who = line.speakerId!;
    if (tag !== undefined) {
      const id = tag.split(':')[1]?.trim() || null;
      if (!S.marks.some((m) => m.id === id && id !== null)) {
        S.marks.push({ id, speaker: who, text: line.body, correct: true });
        if (S.marks.length > cfg('suspect.max_marks', 20)) S.marks.shift();
      }
      toast(t('toast.suspect_marked'), 'clue');
      events.emit('mark', { id, speaker: who, text: line.body, correct: true });
    } else {
      toast(t('toast.suspect_wrong'), 'warn');
      addAffinity(who, cfg('suspect.wrong_affinity', -1));
      addSuspicion(cfg('suspect.wrong_suspicion', 1));
      logAction('wrong_suspect');
      void this.tutorial('suspicion');
      const reaction = pick(asArray(C.characters[who]?.reactions?.wrong_suspect as any)) as string | undefined;
      if (reaction && !isTodo(reaction)) {
        const name = C.characters[who].name;
        this.queued.push(/^[(（]/.test(reaction) ? `${name}${reaction}` : `${name}: ${reaction}`);
      }
      events.emit('mark', { id: null, speaker: who, text: line.body, correct: false });
    }
  }

  // ── 진행 기록 ───────────────────────────────────

  markNode(id: string) {
    if (!P.nodesSeen.includes(id)) {
      P.nodesSeen.push(id);
      savePersist();
    }
    events.emit('node', { id });
  }

  checkpoint(id: string, resume: Resume) {
    this.markNode(id);
    saveCheckpoint(id, makeSnapshot(resume));
    toast(t('toast.checkpoint_saved'));
  }

  autosave() {
    if (!cfg('save.autosave', true) || this.saveLocked) return;
    try {
      writeSlot('auto', makeSnapshot(this.resume));
    } catch (e) {
      console.warn('자동 저장 실패', e);
    }
  }

  /** 지금 상태를 저장용 스냅샷으로 */
  snapshot(): Snapshot | null {
    if (this.saveLocked) return null;
    return makeSnapshot(this.resume);
  }

  private async chapterCard(id: string) {
    S.chapter = id;
    events.emit('chapter', { id });
    const ch = C.chapters[id];
    const card = ch?.title_card;
    const title = ch?.title;
    if ((card && !isTodo(card)) || (title && !isTodo(title))) {
      const el = h('div.chapter-card', h('div.chapter-title', isTodo(title) ? '' : names(title!)), h('div.chapter-sub', isTodo(card) ? '' : names(card!)));
      layer('fx').appendChild(el);
      await waitFor<void>((resolve) => {
        const timer = setTimeout(resolve, 3000);
        const click = () => resolve();
        el.addEventListener('click', click);
        return () => clearTimeout(timer);
      });
      el.remove();
    }
    this.autosave();
  }

  private notify(threadId: string) {
    if (!C.threads[threadId]) {
      console.warn('[notify] phone 파일에 없는 대화:', threadId);
      return;
    }
    S.phone[threadId] = S.phone[threadId] ?? { log: [], pos: 0, done: false, unread: true };
    S.phone[threadId].unread = true;
    events.emit('phone', { thread: threadId, notify: true });
  }

  // ── 튜토리얼 ────────────────────────────────────

  async tutorial(id: string, force = false) {
    const tut = C.tutorials[id];
    if (!tut) return;
    if (!force && P.tutorialsSeen.includes(id)) return;
    if (!force) {
      P.tutorialsSeen.push(id);
      savePersist();
    }
    const pages = asArray(tut.pages).filter((p) => !isTodo(p));
    if (pages.length === 0) return; // 아직 안 쓴 튜토리얼은 건너뜀
    const speaker = isTodo(tut.speaker) ? 'system' : tut.speaker;
    const who = charId(speaker);
    if (who) {
      const name = C.characters[who].name;
      await this.sayOrQueue(pages.map((p) => (/^[(（]/.test(p) ? `${name}${p}` : `${name}: ${p}`)));
      return;
    }
    // 설명 창
    let page = 0;
    await waitFor<void>((resolve) => {
      const m = openModal(isTodo(tut.title) ? '' : names(tut.title), 'tutorial', { closable: false });
      const render = () => {
        clear(m.body);
        if (tut.image && !isTodo(tut.image)) m.body.appendChild(h('img.tutorial-img', { src: `./assets/ui/tutorial/${tut.image}` }));
        m.body.appendChild(h('p.tutorial-text', names(pages[page])));
        m.body.appendChild(
          h('div.tutorial-nav',
            h('span', `${page + 1} / ${pages.length}`),
            h('button.btn', { onclick: () => (page + 1 < pages.length ? (page++, render()) : resolve()) }, page + 1 < pages.length ? '다음' : '닫기'),
          ),
        );
      };
      render();
      return () => m.close();
    });
  }
}

export const game = new Game();
dlg.setSuspectHandler((line) => game.onSuspect(line));
