/**
 * 직업(= 캐릭터) 목록과 인원별 구성.
 *
 * 캐릭터 이름 바꾸기: 각 직업의 char 에 캐릭터 이름을 쓰면 게임 전체에 그 이름으로 나온다.
 * char 가 비어 있으면 job(직업명)이 대신 표시된다.
 */

export type Team = 'mafia' | 'citizen' | 'neutral';

export type RoleId =
  | 'nifel'
  // 마피아 팀원 (접선해야 능력 사용)
  | 'sealer' | 'disguiser' | 'agitator' | 'heir'
  // 시민
  | 'doctor' | 'police' | 'medium' | 'tracker' | 'revealer' | 'overturn' | 'trap' | 'avenger' | 'peeker' | 'sturdy'
  // 중립
  | 'bat' | 'jester' | 'survivor';

/** 밤에 대상을 고르는 능력의 종류 */
export type NightKind = 'kill' | 'contact' | 'seal' | 'disguise' | 'protect' | 'investigate' | 'medium' | 'track' | 'reveal';

export interface RoleDef {
  id: RoleId;
  /** 캐릭터 이름 (비우면 직업명으로 표시) */
  char: string;
  /** 직업명 */
  job: string;
  team: Team;
  /** 마피아 팀원 여부 (니펠 제외, 접선 필요) */
  member?: boolean;
  /** 밤 능력 */
  night?: NightKind;
  /** 한 판에 한 번만 쓰는 능력 */
  once?: boolean;
  /** 대상으로 자기 자신을 고를 수 있는지 */
  selfTarget?: boolean;
  /** 대상으로 죽은 사람을 고르는지 */
  deadTarget?: boolean;
  /** 주장하면 마피아에게 노려지기 쉬운 핵심 직업 */
  key?: boolean;
  desc: string;
}

export const ROLES: Record<RoleId, RoleDef> = {
  // ── 마피아 ──
  nifel: {
    id: 'nifel', char: '니펠', job: '마피아', team: 'mafia', night: 'kill',
    desc: '밤마다 다른 니펠들과 투표해서 한 명을 습격한다. 니펠끼리는 처음부터 서로를 안다.',
  },
  sealer: {
    id: 'sealer', char: '', job: '봉인', team: 'mafia', member: true, night: 'seal',
    desc: '[접선 후] 밤에 한 명을 골라 그날 밤 능력을 막는다. 경찰 조사에는 시민으로 나온다.',
  },
  disguiser: {
    id: 'disguiser', char: '', job: '위장', team: 'mafia', member: true, night: 'disguise',
    desc: '[접선 후] 밤에 한 명을 골라 그날 밤 경찰 조사에 시민으로 보이게 한다. 경찰 조사에는 시민으로 나온다.',
  },
  agitator: {
    id: 'agitator', char: '', job: '선동', team: 'mafia', member: true, once: true,
    desc: '[접선 후] 한 번, 결선 투표에서 다른 사람 한 명의 표를 원하는 쪽으로 옮긴다. 경찰 조사에는 시민으로 나온다.',
  },
  heir: {
    id: 'heir', char: '', job: '후계', team: 'mafia', member: true,
    desc: '[접선 후] 니펠이 모두 사라지면 니펠이 되어 습격을 이어받는다. 경찰 조사에는 시민으로 나온다.',
  },

  // ── 시민 ──
  doctor: {
    id: 'doctor', char: '힐데', job: '의사', team: 'citizen', night: 'protect', selfTarget: true, key: true,
    desc: '밤에 한 명을 지킨다. 자기 자신도, 같은 사람을 연속으로도 지킬 수 있다.',
  },
  police: {
    id: 'police', char: '', job: '경찰', team: 'citizen', night: 'investigate', key: true,
    desc: '밤에 한 명을 조사해서 마피아인지 아닌지 알아낸다. (마피아 팀원은 시민으로 나온다)',
  },
  medium: {
    id: 'medium', char: '', job: '영매', team: 'citizen', night: 'medium', deadTarget: true,
    desc: '밤에 사라진 사람 한 명을 골라 그 사람의 캐릭터를 알아낸다.',
  },
  tracker: {
    id: 'tracker', char: '', job: '추적', team: 'citizen', night: 'track',
    desc: '밤에 한 명을 지켜보고, 그 사람이 누구를 찾아갔는지 알아낸다.',
  },
  revealer: {
    id: 'revealer', char: '', job: '공개', team: 'citizen', night: 'reveal', once: true,
    desc: '한 번, 밤에 한 명을 골라 다음 날 아침 그 사람의 캐릭터를 모두에게 공개한다.',
  },
  overturn: {
    id: 'overturn', char: '', job: '뒤집기', team: 'citizen', once: true,
    desc: '한 번, 결선 투표로 정해진 처형을 무효로 만든다.',
  },
  trap: {
    id: 'trap', char: '', job: '함정', team: 'citizen',
    desc: '습격을 한 번 버티고, 습격한 니펠 한 명의 정체를 아침에 모두에게 알린다.',
  },
  avenger: {
    id: 'avenger', char: '', job: '길동무', team: 'citizen',
    desc: '투표로 처형당하면 한 명을 골라 함께 데려간다.',
  },
  peeker: {
    id: 'peeker', char: '', job: '엿보기', team: 'citizen',
    desc: '투표 때 누가 누구에게 표를 냈는지 볼 수 있다.',
  },
  sturdy: {
    id: 'sturdy', char: '', job: '튼튼', team: 'citizen',
    desc: '습격을 한 번 버틴다.',
  },

  // ── 중립 ──
  bat: {
    id: 'bat', char: '네르', job: '박쥐', team: 'neutral',
    desc: '3일째 아침에 마피아 팀과 시민 팀 중 하나를 골라 그 팀이 된다. 고르기 전에는 경찰 조사에 시민으로 나온다. 고르기 전에 사라지면 패배.',
  },
  jester: {
    id: 'jester', char: '', job: '광대', team: 'neutral',
    desc: '투표로 처형당하면 혼자 승리한다.',
  },
  survivor: {
    id: 'survivor', char: '', job: '생존자', team: 'neutral',
    desc: '게임이 끝날 때까지 살아남으면 승리한다. (어느 팀이 이기든 함께 승리)',
  },
};

export const roleName = (id: RoleId) => ROLES[id].char || ROLES[id].job;

/** 마피아 팀원 후보 (판마다 하나) */
export const MEMBER_POOL: RoleId[] = ['sealer', 'disguiser', 'agitator', 'heir'];
/** 경찰·의사를 뺀 시민 후보 */
export const CITIZEN_POOL: RoleId[] = ['medium', 'tracker', 'revealer', 'overturn', 'trap', 'avenger', 'peeker', 'sturdy'];
/** 중립 후보 (7인 이상에서 항상 1명) */
export const NEUTRAL_POOL: RoleId[] = ['bat', 'jester', 'survivor'];

/** 인원별 구성: [니펠, 마피아 팀원, 시민 무작위, 중립] (경찰·의사는 항상 1명씩) */
export const COMPOSITION: Record<number, [number, number, number, number]> = {
  4: [1, 0, 1, 0],
  5: [1, 0, 2, 0],
  6: [1, 1, 2, 0],
  7: [1, 1, 2, 1],
  8: [1, 1, 3, 1],
  9: [2, 1, 3, 1],
  10: [2, 1, 4, 1],
  11: [2, 1, 5, 1],
  12: [3, 1, 5, 1],
};

/** 첫날 밤 습격이 없는 인원 */
export const NO_FIRST_KILL = (n: number) => n <= 5;

/** 박쥐가 진영을 고르는 날 */
export const BAT_CHOOSE_DAY = 3;
