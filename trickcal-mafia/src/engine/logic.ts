/**
 * 발언 사이의 모순 판정. 두 발언이 "동시에 참일 수 없으면" 모순.
 * (사실 여부가 아니라 논리만 본다 — 진짜 범인을 아는 건 플레이어의 몫)
 */
import { ROLES, type RoleId } from '../data/roles';
import type { Clue, Side, Stmt } from './types';

type Fact =
  | { f: 'role'; who: number; role: RoleId }
  | { f: 'visit'; who: number; night: number; target: number } // -1 = 방에 있었음
  | { f: 'police'; who: number; side: Side }
  | { f: 'protect'; target: number; night: number }
  | { f: 'death'; who: number; night: number }
  | { f: 'notMafia'; who: number }
  | { f: 'gotNote'; who: number; night: number };

const MAFIA_ROLES: RoleId[] = ['nifel', 'sealer', 'disguiser', 'agitator', 'heir'];

export function factsOf(s: Stmt): Fact[] {
  const out: Fact[] = [];
  switch (s.kind) {
    case 'role':
      if (s.speaker >= 0) out.push({ f: 'role', who: s.speaker, role: s.role });
      break;
    case 'reveal':
      out.push({ f: 'role', who: s.who, role: s.role });
      if (!MAFIA_ROLES.includes(s.role) && s.role !== 'bat') out.push({ f: 'notMafia', who: s.who });
      break;
    case 'death':
      out.push({ f: 'death', who: s.who, night: s.night });
      break;
    case 'act': {
      const me = s.speaker;
      if (s.act === 'stay') out.push({ f: 'visit', who: me, night: s.night, target: -1 });
      else if (s.target !== undefined) out.push({ f: 'visit', who: me, night: s.night, target: s.target });
      if (s.act === 'investigate' && s.target !== undefined && (s.result === 'mafia' || s.result === 'citizen'))
        out.push({ f: 'police', who: s.target, side: s.result });
      if (s.act === 'protect' && s.target !== undefined) out.push({ f: 'protect', target: s.target, night: s.night });
      if (s.act === 'track' && s.target !== undefined && typeof s.result === 'number')
        out.push({ f: 'visit', who: s.target, night: s.night, target: s.result });
      if (s.act === 'medium' && s.target !== undefined && typeof s.result === 'string' && s.result in ROLES)
        out.push({ f: 'role', who: s.target, role: s.result as RoleId });
      // 행동을 밝혔다면 그 직업이라는 주장도 된다
      const roleByAct: Partial<Record<string, RoleId>> = { investigate: 'police', protect: 'doctor', track: 'tracker', medium: 'medium' };
      const r = roleByAct[s.act];
      if (r && me >= 0) out.push({ f: 'role', who: me, role: r });
      break;
    }
    case 'mnote':
      if (s.speaker >= 0) out.push({ f: 'gotNote', who: s.speaker, night: s.night });
      out.push(...clueFacts(s.clue, s.night));
      break;
  }
  return out;
}

function clueFacts(c: Clue, night: number): Fact[] {
  switch (c.kind) {
    case 'stayed': return [{ f: 'visit', who: c.who, night, target: -1 }];
    case 'visited': return [{ f: 'visit', who: c.who, night, target: c.target }];
    case 'notMafia': return [{ f: 'notMafia', who: c.who }];
    default: return [];
  }
}

function factsConflict(a: Fact, b: Fact): boolean {
  if (a.f === 'role' && b.f === 'role') {
    if (a.who === b.who) return a.role !== b.role;
    return a.role === b.role && a.role !== 'nifel';
  }
  if (a.f === 'visit' && b.f === 'visit') return a.who === b.who && a.night === b.night && a.target !== b.target;
  if (a.f === 'police' && b.f === 'police') return a.who === b.who && a.side !== b.side;
  if (a.f === 'gotNote' && b.f === 'gotNote') return a.night === b.night && a.who !== b.who;
  const pair = <A extends Fact['f'], B extends Fact['f']>(x: A, y: B) =>
    a.f === x && b.f === y ? [a, b] as [Extract<Fact, { f: A }>, Extract<Fact, { f: B }>]
    : b.f === x && a.f === y ? [b, a] as [Extract<Fact, { f: A }>, Extract<Fact, { f: B }>] : null;
  let p;
  if ((p = pair('protect', 'death'))) return p[0].target === p[1].who && p[0].night === p[1].night;
  if ((p = pair('notMafia', 'police'))) return p[0].who === p[1].who && p[1].side === 'mafia';
  if ((p = pair('notMafia', 'role'))) return p[0].who === p[1].who && MAFIA_ROLES.includes(p[1].role);
  if ((p = pair('police', 'role'))) {
    if (p[0].who !== p[1].who) return false;
    if (p[0].side === 'citizen') return p[1].role === 'nifel';
    return p[1].role !== 'nifel' && p[1].role !== 'heir' && p[1].role !== 'bat';
  }
  return false;
}

export function isContradiction(s1: Stmt, s2: Stmt): boolean {
  if (s1.id === s2.id) return false;
  const f1 = factsOf(s1);
  const f2 = factsOf(s2);
  return f1.some((a) => f2.some((b) => factsConflict(a, b)));
}

/** 게시판 전체에서 모순 쌍 찾기 (봇이 스스로 모순을 짚을 때) */
export function findContradictions(board: Stmt[]): [Stmt, Stmt][] {
  const out: [Stmt, Stmt][] = [];
  const useful = board.filter((s) => s.kind !== 'chat' && s.kind !== 'suspect' && s.kind !== 'trust' && s.kind !== 'contra' && s.kind !== 'refuse');
  for (let i = 0; i < useful.length; i++)
    for (let j = i + 1; j < useful.length; j++) if (isContradiction(useful[i], useful[j])) out.push([useful[i], useful[j]]);
  return out;
}

export function clueText(c: Clue, name: (id: number) => string): string {
  switch (c.kind) {
    case 'stayed': return `「어젯밤 ${name(c.who)}는 방을 나서지 않았다.」`;
    case 'visited': return `「어젯밤 ${name(c.who)}가 ${name(c.target)}의 방을 찾아갔다.」`;
    case 'visitedBy': return c.count === 0 ? `「어젯밤 ${name(c.target)}의 방에는 아무도 오지 않았다.」` : `「어젯밤 ${name(c.target)}의 방에 ${c.count}명이 찾아왔다.」`;
    case 'oneOf': return `「${name(c.a)}와 ${name(c.b)} 중 적어도 한 명은 마피아 팀이다.」`;
    case 'notMafia': return `「${name(c.who)}는 마피아 팀이 아니다.」`;
  }
}
