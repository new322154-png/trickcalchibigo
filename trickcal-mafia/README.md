# 트릭컬 마피아 (가제) — 비공식 팬게임

4~12인 추리 마피아. 지금은 **봇전**(플레이어 1명 + 캐릭터 봇)만 있고, 다인전은 같은 규칙 위에 추가 예정.

## 하루 흐름
밤(능력) → 아침 발표 → 저택 쪽지(진짜 단서, 무작위 1명에게) → 증언판 → 심문·익명 쪽지·모순 지목 → 1차 투표 → 결선 대결 → 처형

## 고칠 곳
| 바꾸고 싶은 것 | 파일 |
| --- | --- |
| 캐릭터 이름 (직업 = 캐릭터) | `src/data/roles.ts` 의 `char` |
| 인원별 구성 | `src/data/roles.ts` 의 `COMPOSITION` |
| 봇 말투 | `src/data/lines.ts` |
| 게임 제목 | `src/ui/title.ts` 의 `GAME_TITLE` |

## 실행
```
npm install
npm run dev      # 개발 서버
npm run build    # dist/ 에 빌드
```
주소 뒤에 `?skip` 을 붙이면 첫 스마트폰 화면을 건너뛴다.

## 배포 (Cloudflare Workers)
기존 Worker `trickcalchibigo` 를 그대로 쓴다. 설정 → 빌드에서 루트 디렉터리 `trickcal-mafia`, 빌드 명령 `npm run build`, 배포 명령 `npx wrangler deploy`.
