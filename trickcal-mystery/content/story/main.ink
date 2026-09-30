// ═══════════════════════════════════════════════════════════════
//  main.ink — 대본의 시작 파일
// ───────────────────────────────────────────────────────────────
//  이 파일은 다른 대본 파일들을 묶어 주는 "목차"입니다.
//  새 장을 만들면 아래 INCLUDE 에 한 줄씩 추가하세요.
//
//  대본 쓰는 법은 docs/02_대본_작성_가이드.md 를 보세요.
//  Inky(무료 ink 편집기)로 이 파일을 열면 게임 없이도 대본을 미리 플레이해 볼 수 있어요.
// ═══════════════════════════════════════════════════════════════

INCLUDE prologue/prologue.ink
INCLUDE ch1/ch1_daily.ink
INCLUDE ch1/ch1_investigation.ink
INCLUDE ch1/ch1_trial.ink
INCLUDE ch1/ch1_endings.ink
// INCLUDE ch2/ch2_daily.ink

// ── 게임이 값을 알려주는 함수들 ──
//  대본의 조건문에서 쓸 수 있어요.  예)  * {has_clue("broken_cup")} [컵 얘기를 꺼낸다]
EXTERNAL has_clue(id)        // 단서를 가지고 있나? (evidence.yaml id)
EXTERNAL has_card(id)        // 결론 카드를 가지고 있나? (board 파일의 conclusions id)
EXTERNAL affinity(who)       // 캐릭터의 교주 호감도 (숫자)
EXTERNAL suspicion()         // 교주 의심도 (숫자)
EXTERNAL suspected(id)       // 그 발언(#suspect:id)에 의심 표시를 했나?
EXTERNAL flag(name)          // flag 가 켜져 있나? (#flag:이름 으로 켬)
EXTERNAL present(who)        // 그 캐릭터가 아직 일행에 있나? (사라지지 않았나)
EXTERNAL seen_ending(id)     // (회차 기억) 그 엔딩을 본 적이 있나?
EXTERNAL voted()             // 방금 재판에서 지목된 사람 id
EXTERNAL has_item(id)        // 아이템을 가지고 있나? (items.yaml id)
EXTERNAL confined(who)       // 그 캐릭터가 재판 결과로 갇혀 있나?
EXTERNAL has_truth(id)       // 진실 조각을 모았나? (truths.yaml id)
EXTERNAL knows_habit(key)    // 그 습관을 알고 있나? 예) knows_habit("erpin.calls_kyoju")
EXTERNAL anomalies(who)      // 그 캐릭터에게서 잡아낸 어긋남 개수 ("" 이면 전체)
EXTERNAL time_now()          // 지금 시간대 (morning / day / night)
EXTERNAL day()               // 며칠째인가
EXTERNAL impostor()          // 오늘 저택이 변장한 캐릭터 id (days.yaml)
EXTERNAL was_impostor(who)   // 그 캐릭터가 지금까지 한 번이라도 가짜였나 (= 그날의 기억이 없다)
EXTERNAL found_today()       // 오늘 가짜를 찾아냈나
EXTERNAL found_day(n)        // n일째에 가짜를 찾아냈나

-> start

=== start ===
-> prologue

// ── 아래는 Inky 미리보기용 대체값입니다 (게임에서는 무시됨) ──
//  Inky에서 조건을 바꿔 테스트하고 싶으면 return 값을 잠깐 바꿔 보세요.
=== function has_clue(id) ===
~ return true
=== function has_card(id) ===
~ return true
=== function affinity(who) ===
~ return 0
=== function suspicion() ===
~ return 0
=== function suspected(id) ===
~ return false
=== function flag(name) ===
~ return false
=== function present(who) ===
~ return true
=== function seen_ending(id) ===
~ return false
=== function voted() ===
~ return ""
=== function has_item(id) ===
~ return false
=== function confined(who) ===
~ return false
=== function has_truth(id) ===
~ return false
=== function knows_habit(key) ===
~ return false
=== function anomalies(who) ===
~ return 0
=== function time_now() ===
~ return "morning"
=== function day() ===
~ return 1
=== function impostor() ===
~ return ""
=== function was_impostor(who) ===
~ return false
=== function found_today() ===
~ return false
=== function found_day(n) ===
~ return false
