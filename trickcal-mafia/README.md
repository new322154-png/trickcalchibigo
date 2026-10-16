# 트릭컬 마피아 (가제) — 비공식 팬게임

4~12인 온라인 마피아. 지금 있는 것:
- **빠른 매칭**: 빈자리가 있는 공개 방에 바로 들어간다
- **방 만들기**: 방 코드 5자리 · 초대 링크 (`?room=코드`)
- **미니게임**: 혼자 하는 빵 받기 · 짝 맞추기 (대기실에서도 "혼자 놀기")
- **대기실**: 캐릭터 이동(WASD·방향키 / 모바일 방향패드), 채팅 말풍선, 방장이 여는 멀티 미니게임 4종 (반응속도 대결 · OX 퀴즈 · 술래잡기 · 의자 뺏기)
- 마피아 본게임은 다음 단계

## 구조
| 폴더 | 내용 |
| --- | --- |
| `src/` | 화면 (Vite) |
| `shared/` | 화면과 서버가 같이 쓰는 코드: 메시지 형식, 방 로직(미니게임 판정), OX 문제 |
| `worker/` | Cloudflare Worker + Durable Objects (방 서버, 매칭) |

## 고칠 곳
| 바꾸고 싶은 것 | 파일 |
| --- | --- |
| 캐릭터 목록 · 이동 속도 · 최대 인원 | `shared/protocol.ts` |
| 캐릭터 그림 (데포르메) | `public/assets/chars/<id>.png` |
| OX 퀴즈 문제 | `shared/quiz.ts` |
| 마피아 직업 (= 캐릭터) | `src/data/roles.ts` |
| 게임 제목 | `src/ui/title.ts` 의 `GAME_TITLE` |

## 배포 (Cloudflare Workers)
기존 Worker `trickcalchibigo`. 루트 디렉터리 `trickcal-mafia`, 빌드 `npm run build`, 배포 `npx wrangler deploy` (wrangler.jsonc 가 방 서버까지 함께 올린다).
