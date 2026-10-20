/**
 * 직업(= 캐릭터) 목록과 인원별 구성.
 * 직업 이름이 곧 캐릭터 이름이다. job 은 능력을 한눈에 알아보기 위한 짧은 설명.
 */

export type Team = 'mafia' | 'citizen' | 'neutral';

export type RoleId =
  | 'nifel'
  // 마피아 팀원 (능력은 처음부터, 접선은 각자 조건으로)
  | 'mute' | 'uros' | 'joan' | 'bella'
  // 시민
  | 'doctor' | 'police' | 'medium' | 'tracker' | 'revealer' | 'overturn' | 'trap' | 'avenger' | 'spiky' | 'wish'
  // 중립
  | 'bat' | 'jester' | 'elena';

/** 밤에 대상을 고르는 능력의 종류 */
export type NightKind = 'kill' | 'seal' | 'disguise' | 'protect' | 'investigate' | 'track' | 'reveal' | 'identify' | 'revive';

export interface RoleDef {
  id: RoleId;
  /** 캐릭터 이름 = 직업 이름 */
  char: string;
  /** 능력 한 줄 요약 */
  job: string;
  team: Team;
  /** 마피아 팀원 여부 (니펠 제외) */
  member?: boolean;
  /** 밤 능력 */
  night?: NightKind;
  /** 한 판에 한 번만 쓰는 능력 */
  once?: boolean;
  /** 대상으로 자기 자신을 고를 수 있는지 */
  selfTarget?: boolean;
  desc: string;
}

export const ROLES: Record<RoleId, RoleDef> = {
  // ── 마피아 ──
  nifel: {
    id: 'nifel', char: '니펠', job: '습격', team: 'mafia', night: 'kill',
    desc: '밤마다 다른 니펠들과 투표해서 한 명을 습격한다. 니펠끼리는 처음부터 서로를 안다.',
  },
  mute: {
    id: 'mute', char: '뮤트', job: '해킹', team: 'mafia', member: true, night: 'seal',
    desc: '밤 ①에 한 명을 해킹해 그날 밤 능력을 막는다(방 문이 잠긴다). 니펠을 해킹하면 막지 않고 접선한다.',
  },
  uros: {
    id: 'uros', char: '우로스', job: '부활', team: 'mafia', member: true,
    desc: '니펠도 우로스를 모른다. 니펠에게 습격당해 죽으면, 그 뒤 3번째 밤에 되살아나 니펠로 합류한다. (되살아나는 순간 정체가 드러난다)',
  },
  joan: {
    id: 'joan', char: '죠안', job: '선동', team: 'mafia', member: true, once: true,
    desc: '한 번, 결선 변론 때 후보 한 명의 입을 빌린다. 시민 팀이면 변론 45초 동안 그 사람 대신 채팅한다. 고른 후보가 니펠이면 선동은 실패하지만 접선한다. 니펠이 죠안을 습격해도 죽지 않고 접선한다.',
  },
  bella: {
    id: 'bella', char: '벨라', job: '직업 탐지', team: 'mafia', member: true, night: 'identify',
    desc: '밤마다 한 명의 직업을 알아낸다. 니펠을 알아내면 접선한다.',
  },

  // ── 시민 ──
  doctor: {
    id: 'doctor', char: '힐데', job: '치유', team: 'citizen', night: 'protect', selfTarget: true,
    desc: '밤에 한 명을 치유한다. 그 사람이 습격당해도 살려낸다. 자기 자신도, 같은 사람을 연속으로도 치유할 수 있다.',
  },
  police: {
    id: 'police', char: '폴랑', job: '조사', team: 'citizen', night: 'investigate',
    desc: '밤에 한 명을 조사해서 니펠인지 아닌지 알아낸다. (니펠이 아닌 마피아 팀원은 시민으로 나온다)',
  },
  medium: {
    id: 'medium', char: '이드', job: '영매', team: 'citizen',
    desc: '밤마다 주말농장으로 가서 사라진 사람들과 만나 이야기한다. 이드는 니펠의 대화를 못 듣지만, 엿들은 죽은 사람들이 전해 줄 수 있다. 죽은 사람은 거짓말을 할 수도 있다. 해킹당한 밤에는 농장에 못 간다.',
  },
  tracker: {
    id: 'tracker', char: '버터', job: '추적', team: 'citizen', night: 'track',
    desc: '밤에 한 명을 지켜보고, 그 사람이 누구의 방에 갔는지 알아낸다.',
  },
  revealer: {
    id: 'revealer', char: '하이디', job: '공개', team: 'citizen', night: 'reveal', once: true,
    desc: '한 번, 밤에 한 명을 골라 다음 날 아침 그 사람의 직업을 모두에게 공개한다.',
  },
  overturn: {
    id: 'overturn', char: '리온', job: '판결 뒤집기', team: 'citizen', once: true,
    desc: '한 번, 결선 투표로 정해진 처형을 무효로 만든다.',
  },
  trap: {
    id: 'trap', char: '디아나(왕년)', job: '반격', team: 'citizen',
    desc: '습격을 한 번 반격해서 막아낸다. 막아내는 순간 디아나의 정체가 모두에게 드러나고, 다시는 쓸 수 없다.',
  },
  avenger: {
    id: 'avenger', char: '마리', job: '길동무', team: 'citizen',
    desc: '투표로 처형당하면 한 명을 골라 함께 데려간다. 밤에 습격당해 죽으면 자신을 찍은 니펠 중 한 명과 함께 폭사한다. (폭사하면 마리의 정체가 드러난다)',
  },
  spiky: {
    id: 'spiky', char: '스피키', job: '변장', team: 'citizen', night: 'disguise', once: true,
    desc: '한 번, 밤 ①에 한 명으로 변장해 그 직업을 알아내고, 그날 밤 ③에 그 능력을 한 번 쓴다. 이후 직업이 공개되면 그 직업으로 보인다. 이드로 변장하면 그날 밤 주말농장에 들어갈 수 있다(이드가 둘로 보인다). 니펠은 능력을 못 쓰는 대신 마피아인 걸 알게 되고, 마피아 팀원으로 변장했다면 공개 때 스피키로 보인다.',
  },
  wish: {
    id: 'wish', char: '우이', job: '소원', team: 'citizen', night: 'revive', once: true,
    desc: '한 번, 밤에 소원을 빌어 죽은 사람 한 명을 다음 날 아침 되살린다.',
  },

  // ── 중립 ──
  bat: {
    id: 'bat', char: '네르', job: '박쥐', team: 'neutral',
    desc: '3일째 아침에 마피아 팀과 시민 팀 중 하나를 골라 그 팀이 된다. 고르기 전에는 조사에 시민으로 나온다. 고르기 전에 사라지면 패배.',
  },
  jester: {
    id: 'jester', char: '코미', job: '광대', team: 'neutral',
    desc: '4번째 밤이 지난 뒤 투표로 처형당하면 혼자 승리한다. 그 전에 처형당하면 그냥 사라진다.',
  },
  elena: {
    id: 'elena', char: '엘레나', job: '드론', team: 'neutral',
    desc: '밤마다 방에서 드론 조립을 3번 시도한다(성공할 때마다 투표권 +1, 최대 3대). 대수가 늘수록 조립이 어려워지고, 누적 9번째 시도마다 한 대는 반드시 완성된다. 내 투표권이 다른 생존자 수보다 많아지면 즉시 혼자 승리한다.',
  },
};

export const roleName = (id: RoleId) => ROLES[id]?.char || ROLES[id]?.job || '?';

/** 마피아 팀원 후보 (판마다 하나) */
export const MEMBER_POOL: RoleId[] = ['mute', 'uros', 'joan', 'bella'];
/** 힐데·폴랑을 뺀 시민 후보 */
export const CITIZEN_POOL: RoleId[] = ['medium', 'tracker', 'revealer', 'overturn', 'trap', 'avenger', 'spiky', 'wish'];
/** 중립 후보 (7인 이상에서 항상 1명) */
export const NEUTRAL_POOL: RoleId[] = ['bat', 'jester', 'elena'];

/** 인원별 구성: [니펠, 마피아 팀원, 시민 무작위, 중립] (힐데·폴랑은 항상 1명씩) */
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
/** 코미가 이길 수 있게 되는 밤 수 (이 밤이 지난 뒤부터) */
export const JESTER_NIGHT = 4;
/** 우로스가 되살아나는 밤 (죽은 뒤 n번째 밤) */
export const UROS_REVIVE_NIGHTS = 3;
/** 엘레나 드론 */
export const DRONE_TRIES = 3;
export const DRONE_MAX = 3;
/** 누적 시도 9번째마다 확정 성공 (3번째 밤마다 한 번) */
export const DRONE_PITY = 9;
/** 한 번 시도의 최대 확률 (0~이 값 사이 무작위). 갈수록 어려워진다: 1호기 40% → 2호기 20% → 3호기 10% */
export const DRONE_MAX_CHANCE = [0.4, 0.2, 0.1];

/** 밤 차례: ① 뮤트·스피키 → ② 니펠 → ③ 나머지 능력 */
export const NIGHT_STEP: Record<NightKind, 1 | 2 | 3> = {
  seal: 1, disguise: 1, kill: 2, protect: 3, investigate: 3, track: 3, reveal: 3, identify: 3, revive: 3,
};
/** 시간 안에 안 골라도 되는 능력 (안 고르면 안 씀). 나머지는 무작위로 정해진다 */
export const OPTIONAL_NIGHT: NightKind[] = ['kill', 'protect', 'seal', 'disguise', 'reveal', 'revive'];
