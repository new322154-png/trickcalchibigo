# 트릭컬 패러디 추리 웹게임

트릭컬 세계관을 패러디한 싱글 플레이 추리 웹게임의 프로젝트 뼈대입니다.
대화, 선택지, 조사, 추리 보드, 휴대폰(무전기) 메신저, 3페이즈 재판, 파생 엔딩, 체크포인트, 사건 흐름도가 들어 있습니다.

**엔진과 콘텐츠가 완전히 분리**되어 있어서, 대본과 텍스트는 `content/` 폴더의 파일만 고치면 됩니다. 코드를 몰라도 됩니다.

> 비공식 팬게임입니다. 원작의 모든 권리는 원저작권자에게 있습니다.

---

## 처음 한 번만: 준비

1. [Node.js](https://nodejs.org/) LTS 버전 설치 (20 이상)
2. 이 폴더에서 터미널(명령 프롬프트)을 열고:

   ```
   npm install
   ```

## 매일 작업할 때

```
npm run dev
```

브라우저에 게임이 뜹니다. **대본(.ink)이나 텍스트(.yaml)를 저장하면 게임이 자동으로 새로고침**됩니다.
대본에 문법 오류가 있으면 브라우저 화면에 파일 이름과 줄 번호가 뜹니다.

| 명령 | 하는 일 |
| --- | --- |
| `npm run dev` | 개발용 게임 실행 (저장하면 자동 새로고침) |
| `npm run todo` | 파일별로 아직 안 채운 TODO 개수 |
| `npm run todo:list` | 안 채운 칸마다 "파일:줄 · 질문" 목록 |
| `npm run check` | 끊어진 연결 검사 (없는 knot, 없는 단서 id, 틀린 label 등) |
| `npm run build` | 배포용 파일 만들기 (`dist/` 폴더). 검사에 실패하면 멈춤 |
| `npm run preview` | 만든 배포 파일을 미리 실행 |

게임 안에서 **F9** (모바일은 화면 왼쪽 위 구석을 빠르게 5번)를 누르면 디버그 메뉴가 열립니다.
원하는 장면으로 바로 이동하고, 단서·flag·호감도·의심도를 바꾸고, 조사 지점 위치를 확인할 수 있어요.

---

## 어디에 무엇을 쓰나

```
content/                        ← 작가가 채우는 곳 (전부 여기)
├─ game.yaml                    게임 제목, 고지문, 기능 이름(의심 버튼, 수첩, 재판…), 컷인 외침
├─ config.yaml                  숫자 설정 (글자 속도, 발언권, 의심도 기준, 설득 배율…)
├─ characters.yaml              등장인물 (이름표 색, 설득 성향, 기본 반응 대사)
├─ chapters.yaml                장 목록과 장 시작 화면 문구
├─ locations.yaml               저택의 방 (배경, 연결된 문, 지도 위치)
├─ evidence.yaml                단서·증거
├─ endings.yaml                 엔딩 목록 (갤러리)
├─ flowchart.yaml               사건 흐름도 지점
├─ text/ui.yaml                 화면의 모든 UI 문구
├─ text/tutorial.yaml           기능 설명(튜토리얼)
├─ investigations/ch1.yaml      1장 조사 파트 (조사 지점, 필수 단서)
├─ board/ch1.yaml               1장 추리 보드 (빈칸 문장, 결론 카드)
├─ phone/contacts.yaml          메신저 연락처·단체방
├─ phone/ch1.yaml               1장 메신저 대화, 엿보기
├─ trials/ch1.yaml              1장 재판 (단톡방 심리, 역습 방어전, 여론전)
├─ story/                       ink 대본
│  ├─ main.ink                  목차 (INCLUDE 목록)
│  ├─ prologue/prologue.ink
│  └─ ch1/ …
└─ _새_장_템플릿/               2장부터 복사해서 쓰는 틀

public/assets/                  ← 이미지·소리 (docs/03_UI_에셋_목록.md 참고)
src/                            ← 게임 엔진 코드 (작가는 안 건드려도 됨)
scripts/check-content.mjs       ← 검사기
docs/                           ← 설명서
```

## 설명서

1. [작성 체크리스트](docs/01_작성_체크리스트.md) — 어떤 순서로 무엇을 채우면 되는지
2. [대본 작성 가이드](docs/02_대본_작성_가이드.md) — ink 문법, 태그 전체 목록, 자주 하는 실수
3. [UI·에셋 목록](docs/03_UI_에셋_목록.md) — 만들어야 할 이미지와 파일 이름 규칙
4. [구조 설명](docs/04_구조_설명.md) — 엔진이 어떻게 돌아가는지 (기능을 추가할 때)

## 작성 규칙 한눈에

- **`# Q:` / `// Q:`** 로 시작하는 줄은 질문입니다. 바로 아래의 **`TODO`** 를 답으로 바꾸세요.
- 대본의 **`(TODO)`** 줄은 게임에서도 그대로 보여서, 플레이하며 빈 곳을 찾을 수 있어요.
- 대사 형식: `에르핀(웃음): 대사` · 지문은 이름 없이 그냥 씁니다.
- `%notebook%` 처럼 퍼센트로 감싸면 game.yaml 의 기능 이름으로 바뀝니다.
- 폴더 이름이 `_` 로 시작하면 게임이 무시합니다 (메모, 템플릿용).

---

## 배포 (GitHub + Cloudflare Pages, 무료)

1. GitHub에서 새 저장소를 만들고 이 폴더를 올립니다.
   ```
   git init
   git add .
   git commit -m "첫 커밋"
   git branch -M main
   git remote add origin https://github.com/<아이디>/<저장소>.git
   git push -u origin main
   ```
2. [Cloudflare 대시보드](https://dash.cloudflare.com/) → Workers & Pages → 만들기 → Pages → Git에 연결 → 저장소 선택
3. 빌드 설정
   - 프레임워크 프리셋: `없음`
   - 빌드 명령: `npm run build`
   - 빌드 출력 디렉터리: `dist`
   - 환경 변수: `NODE_VERSION` = `20`
4. 저장 후 배포. 이후로는 GitHub에 push 할 때마다 자동으로 다시 배포됩니다.

무료 플랜 제한: 파일 20,000개, 파일 하나당 25MiB. 이미지·음악이 많아져서 저장소가 무거워지면
에셋만 Cloudflare R2(무료 10GB)로 옮기는 방법이 있습니다.

`npm run build` 는 먼저 `npm run check` 를 돌리므로, 끊어진 연결이 있으면 배포가 실패합니다.
(TODO 가 남아 있는 건 괜찮습니다. 진짜 오류만 막아요.)
