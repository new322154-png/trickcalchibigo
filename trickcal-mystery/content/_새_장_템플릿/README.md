# 새 장 템플릿

새 장(예: 2장)을 만들 때 이 폴더의 파일을 복사해서 쓰세요.
폴더 이름이 `_` 로 시작하면 게임과 검사 스크립트가 무시하므로, 여기 있는 파일은 게임에 나오지 않습니다.

## 순서 (2장 예시)

1. `story/` 안의 파일 4개를 `content/story/ch2/` 로 복사하고, 파일 이름과 내용의 `chX` 를 모두 `ch2` 로 바꾸기
   - 메모장/VS Code의 "모두 바꾸기"(Ctrl+H)로 `chX` → `ch2`, `X장` → `2장`
2. `investigations/chX.yaml`, `board/chX.yaml`, `phone/chX.yaml`, `trials/chX.yaml` 을
   각각 `content/investigations/ch2.yaml` … 로 복사하고 똑같이 바꾸기
3. `content/story/main.ink` 의 INCLUDE 목록에 4줄 추가
4. `content/chapters.yaml` 에 `ch2:` 블록 추가
5. 1장 마지막(`ch1_trial.ink` 의 `-> to_be_continued`)을 `-> ch2` 로 바꾸기
6. `content/endings.yaml`, `content/flowchart.yaml` 에 2장 엔딩과 지점 추가
7. 터미널에서 `npm run check` 로 빠진 연결이 없는지 확인

주의: 2장에서는 실라 외에 또 누가 사라졌는지에 따라 재판 파일의 `opinion.initial` 명단이 달라집니다.
사라진 사람은 게임이 자동으로 빼 주지만, 명단에 남아 있어도 문제는 없습니다.
