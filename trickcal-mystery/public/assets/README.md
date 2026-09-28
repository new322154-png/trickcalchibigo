# 에셋 폴더

| 폴더 | 내용 | 파일 이름 규칙 |
| --- | --- | --- |
| `characters/{id}/` | 캐릭터 감정 그림 | `normal.gif`, `smile.gif`, `smile_talk.gif`(선택), `icon.png`(인원 체크) |
| `bg/` | 배경 | 대본의 `#bg:이름` → `이름.png` (jpg, webp 도 됨) |
| `cg/` | 이벤트 그림 | `#cg:이름` → `이름.png` |
| `ui/` | UI 이미지 | `docs/03_UI_에셋_목록.md` 참고 |
| `bgm/` | 배경음악 | `#bgm:이름` → `이름.mp3` (또는 .ogg) |
| `se/` | 효과음 | `#se:이름` → `이름.mp3` |
| `evidence/` | 증거 그림 | evidence.yaml 의 `image` 에 적은 이름 그대로 |

파일이 없어도 게임은 돌아갑니다. `.gitkeep` 은 빈 폴더를 GitHub 에 올리기 위한 빈 파일이라 지워도 됩니다.
