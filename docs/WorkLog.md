# Orbit 작업 기록

작업, 오류, 원인, 해결 과정과 실제 검증 결과를 시간순으로 기록한다.

## 2026-08-12 — 다크 모드를 네비게이터·대시보드·사이드패널까지

### 대시보드와 네비게이터가 안 바뀌던 이유 — 명시도가 아니라 스코프

`styles/atlas.css` 의 팔레트는 `:root` 가 아니라 **`.atlas-page, .nav-drawer` 클래스에**
선언돼 있었다. CSS 변수는 **가장 가까운 조상**이 이기므로, `html[data-theme='dark']` 에
아무리 다크 값을 걸어도 `.atlas-page` 안쪽에서는 그 클래스에 붙은 라이트 값이 그대로
이긴다. 명시도 싸움이 아니라 어느 조상에서 값을 집어 오느냐의 문제다.

다크 블록의 선택자를 같은 요소까지 짚도록 고쳤다.

```css
html[data-theme='dark'],
html[data-theme='dark'] .atlas-page,
html[data-theme='dark'] .nav-drawer { … }
```

같은 결함이 다른 곳에도 있는지 스크립트로 훑었다 — 팔레트성 토큰을 `:root`/`data-theme`
바깥에서 선언하는 블록은 이 하나뿐이었다.

### 사이드패널

Tailwind v4 `@theme` 은 `:root` 에 변수를 만든다. `html[data-theme='dark']` 에서 같은
이름을 다시 선언해 덮으면 유틸 클래스(`bg-orbit-surface` 등)는 그대로 둔 채 색만 바뀐다.

- `styles/tailwind.css` — `--color-orbit-*`, `--shadow-orbit-*` 다크 한 벌 + `color-scheme`.
- `App.tsx` — 새 탭과 같은 방식으로 `html[data-theme]` 을 세운다. `system` 이면
  `prefers-color-scheme` 을 구독해 패널을 다시 열지 않아도 따라간다.
- `store/settings.ts` — `setTheme` 추가(상태는 `OrbitSettings` 를 펼치므로 자동 포함).
- `views/SettingsView.tsx` — `모양`(시스템·라이트·다크) 행 추가. 새 탭과 같은 값을 쓰므로
  어느 쪽에서 바꾸든 양쪽이 함께 바뀐다.

### 남아 있던 하드코딩

`atlas.css` 의 위험색(`#a63232`, `#b8452b`)과 모달 딤·그림자를 토큰(`--danger`,
`--overlay-dim`, `--overlay-shadow`)으로 바꿨다. 새 탭 홈의 유리면(`rgba(255,255,255,.58/.62/.78)`)과
카드 그라디언트도 `--glass-*`, `--bg-canvas-warm` 으로 뽑았다.

### 검증

라이트 팔레트의 모든 토큰이 다크에도 선언돼 있는지 세 파일에 대해 확인했다 — 누락 없음.

```
cd extension && pnpm test     # 14 files, 158 passed
cd extension && pnpm compile  # tsc --noEmit, 오류 없음
cd extension && pnpm build    # 887.63 kB
```

실제 브라우저 스모크는 미실시(도구가 `chrome-extension://` 에 접근하지 못한다).

## 2026-08-12 — 설정 여백 조정과 다크 모드

### 여백

내용 영역을 `max-width: 660px` 로 묶어 둬서, 1180px 패널에서 오른쪽이 통째로 비었다.
폭 제한을 920px 로 풀고 여백은 padding(44px) 으로만 준다. 줄 높이·구간 간격도 한 단계
줄였다(행 15→13px, 구간 34→26px, 머리 30→24px).

### 다크 모드

- `lib/settings.ts` — `theme: 'system' | 'light' | 'dark'` 추가(기본 `system`).
  `chrome.storage.local` 이라 사이드패널과 같은 저장소를 쓴다.
- `hooks/useTheme.ts` (신규) — `html[data-theme]` 을 세운다. `system` 이면
  `prefers-color-scheme` 을 구독해 OS 설정이 바뀌면 새로고침 없이 따라간다.
- `main.tsx` — 로그인 여부와 무관하게 첫 화면부터 적용한다.
- `styles/index.css`, `styles/atlas.css` — `html[data-theme='dark']` 에 팔레트 한 벌.
  순검정이 아니라 따뜻한 흙빛(#17130f / #211b16)으로 내려 코랄 강조색이 그대로 얹히게 했다.
  강조색은 어두운 바탕에서 대비를 얻으려고 한 단계 밝게(#ff8a63) 잡았다.
- 설정 `일반 > 환경설정 > 모양` 에 시스템·라이트·다크 세 아이콘 세그먼트.

**토큰화가 먼저였다.** 두 CSS 에 hover 용 `rgba(178,112,84,0.0x)` 와 흰 판(`#ffffff`),
아이보리 그라디언트가 하드코딩돼 있어 팔레트만 바꿔서는 다크에서 그대로 밝게 남는다.
`--wash-1..3`, `--glass-58/62/78`, `--bg-canvas-warm`, `--node-rim`, `--fade-page-0/94`,
`--overlay-dim`, `--overlay-shadow`, `--accent-soft-flat`, `--danger` 로 뽑아낸 뒤
다크에서 갈아 끼운다.

### 범위 밖

사이드패널은 Tailwind 토큰(`orbit-*`)을 쓰는 별도 디자인 시스템이라 이번 다크 모드에
포함하지 않았다. 새 탭(홈·대시보드)만 적용된다.

### 검증

```
cd extension && pnpm test     # 14 files, 158 passed
cd extension && pnpm compile  # tsc --noEmit, 오류 없음
cd extension && pnpm build    # 885.66 kB
```

실제 브라우저 스모크는 미실시(도구가 `chrome-extension://` 에 접근하지 못한다).
다크 팔레트의 실제 대비는 화면에서 확인이 필요하다.

## 2026-08-12 — 설정을 데스크톱 작업 공간으로 재설계

### 배경

직전 설정은 좁고 긴 모달 하나에 모든 설정을 세로로 늘어놓은 형태였다. 무엇이 어디 있는지
알려면 목록을 끝까지 훑어야 했고, 데스크톱 확장의 설정이라기보다 모바일 설정 화면에 가까웠다.

정보 구조 자체를 바꿨다 — `전체 목록` 에서 `분류 선택 → 그 분류의 설정만` 으로.

### 변경

- `components/layout/settings-nav.ts` (신규) — 분류 정의와 `filterSettingsNav`.
  각 항목에 **검색용 키워드**를 붙였다. 분류 이름만으로는 "본문 저장", "로그아웃" 같은
  실제 설정 이름으로 찾을 수 없어 검색이 무용지물이 된다.
- `components/layout/SettingsPages.tsx` (신규) — 페이지 8개와 공용 부품
  (`PageHeader`, `Section`, `Row`, `Switch`, `Stepper`, `Status`).
- `components/layout/SettingsPanel.tsx` — 좌(236px 분류) · 우(설정 내용) 2단 셸.
  1180×760 상한, 화면 중앙, 딤 배경.
- `styles/index.css` — 설정 스타일 전면 교체.
- `lib/api.ts` — `apiBaseUrl` 을 내보낸다(연결 화면이 붙어 있는 주소를 보여 준다).
- `tests/unit/settings-nav.test.ts` (신규) — 분류 중복 없음, 검색 매칭, 빈 그룹 제거 등 7건.

### 페이지 배치

| 분류 | 내용 |
| --- | --- |
| 일반 | 연결 상태 · 단축키 · 버전 |
| 수집 및 동기화 | 탐색 기록(수집·본문 저장·민감 도메인) / 동기화(자동 동기화 + **켜졌을 때만** 주기·유휴·개수) |
| 세션 및 검색 | 자동 병합 |
| AI | 더 정확한 결과 보기 · AI 가 쓰이는 곳 |
| 개인정보 보호 | 저장 원칙 + 현재 상태 요약(읽기 전용) + 변경 화면으로 보내기 |
| 데이터 관리 | 로그인 계정 · 저장 데이터 설명 · 로그아웃 |
| 연결 | 상태 · 서버 주소 · 다시 확인 |
| 정보 | 소개 · 버전 · 단축키 |

### 설계 메모

**줄을 카드로 감싸지 않는다.** 대부분의 설정은 캔버스 위에 얇은 구분선으로만 나뉜다.
카드(`.settings-callout`)는 묶음이나 상태를 따로 말할 때만 쓴다 — 모든 줄이 카드가 되면
테두리가 겹쳐 위계가 사라진다.

**선택 표시는 옅은 바탕 + 왼쪽 2.5px 주황 눈금.** 큰 알약으로 채우면 사이드바가 무거워진다.
주황은 활성 상태·선택·상태 표시·토글에만 쓴다.

**점진적 노출** — 자동 동기화가 꺼져 있으면 주기·유휴·개수를 아예 그리지 않는다.
조건이 꺼져 있는데 그 조건의 세부값을 물어볼 이유가 없다.

**가짜 컨트롤을 만들지 않았다.** 지금 있는 설정은 9개(로컬 8 + 서버 1)뿐이라
분류 8개를 채우면 몇 페이지는 얇다. 빈 자리를 동작하지 않는 토글로 메우는 대신
읽기 전용 정보(개인정보 원칙, 저장 데이터 설명, 서버 주소)로 채웠다.
설정이 늘어나면 해당 페이지에 그대로 붙이면 된다.

### 검증

```
cd extension && pnpm test     # 14 files, 158 passed (분류 7건 추가)
cd extension && pnpm compile  # tsc --noEmit, 오류 없음
cd extension && pnpm build    # 881.21 kB
```

실제 브라우저 스모크는 미실시(도구가 `chrome-extension://` 에 접근하지 못한다).

## 2026-08-12 — 새 탭 프로필 메뉴 정리와 설정 패널

### 변경

- `components/layout/UserMenu.tsx` — 동작이 없던 항목 **친구 초대 · 의견 보내기 ·
  커뮤니티 참여를 제거**했다(전부 빈 `onClick`). 남는 것은 설정과 로그아웃.
  쓰지 않게 된 아이콘 import 와 `.user-menu__external` CSS 도 함께 정리.
- `components/layout/SettingsPanel.tsx` (신규) — 프로필 메뉴의 "설정" 에서 여는
  **화면 가운데 모달**. 사이드패널 설정과 **같은 값**을 다룬다(백엔드 연결, 탐색 기록 수집,
  자동 동기화와 주기, 유휴·개수 기준, 본문 저장, 민감 도메인 제외, 자동 병합,
  정확한 결과 보기, 단축키·버전). 새 탭 어법으로 다시 그렸다.
  - `createPortal(document.body)` — 프로필 메뉴 안에 두면 그 컨테이너의 위치·겹침 규칙에
    갇혀 화면 가운데로 나오지 못한다.
  - 딤을 덮고 바깥을 **누르기 시작했을 때만** 닫는다(`onMouseDown` + `target === currentTarget`).
    패널 안에서 시작한 드래그가 밖에서 끝나도 닫히지 않는다.
  - 그룹 안에 상자를 두지 않는다 — 모달 테두리 안에 카드 테두리가 또 겹치면 답답하다.
    작은 제목 + 구분선으로 나눈 줄만 남겼다.
- `hooks/useOrbitSettings.ts` (신규) — `lib/settings.ts`(chrome.storage.local)를 직접 보는
  훅. 사이드패널의 zustand 스토어를 끌어다 쓰지 않는다 — 그쪽 엔트리포인트에 묶인 상태라
  경계를 넘게 된다. 진실 원천이 같으니 한쪽에서 바꾸면 다른 쪽도 따라 바뀐다.
- `styles/index.css` — `.settings-overlay`, `.settings-panel`, `.settings-switch`,
  `.settings-segment`, `.settings-stepper` 추가.

### 설계 메모

설정 값을 새 탭용으로 복제하지 않았다. 로컬 설정은 `chrome.storage.local`,
자동 병합은 서버 `/settings` 로 사이드패널과 같은 곳을 본다 — 두 화면이 서로 다른 값을
보여 주는 일이 생기지 않는다. 새로 만든 것은 표현뿐이다.

### 검증

```
cd extension && pnpm test     # 13 files, 151 passed
cd extension && pnpm compile  # tsc --noEmit, 오류 없음
cd extension && pnpm build    # 868.55 kB
```

실제 브라우저 스모크는 미실시(도구가 `chrome-extension://` 에 접근하지 못한다).

## 2026-08-12 — 세션을 펼칠 때 계가 순간이동하던 문제

### 원인 — 씬 전환이 아니라 트레이 높이였다

앞선 커밋에서 "폴더 → 세션" 을 씬 전환으로 보고 교차 디졸브를 넣었는데, 사용자가 지적한
전환은 **같은 폴더 씬 안**이었다. 폴더 안 세션을 펼치면 아래 트레이가 뜨면서
`bottomInset` 이 40 → 250(`TRAY_INSET`)으로 한 프레임에 뛴다. `planetY` 가 여기서
계산되므로 행성·궤도·칩·위성이 통째로 위로 순간이동했다.

### 변경

- `AtlasCanvas` — `bottomInset` 을 회전·초점과 같은 rAF 루프(`Motion`/`advance`)로
  미끄러뜨린다. 계 전체가 트레이가 올라오는 속도에 맞춰 함께 올라간다. 안내 알약 위치도
  같은 값을 쓴다. 반경 계산은 최악 높이 상수(`INSET_MAX`)를 그대로 써서 전환 중에 궤도
  크기가 흔들리지 않는다.
- `AtlasTray` / `atlas.css` — 등장 애니메이션을 `translateY(16px)` 에서
  `translateY(100%)` 로 바꿔 화면 아래에서 올라오게 하고, 길이를 0.42s 로 맞춰
  캔버스가 올라가는 시간과 겹치게 했다.
- 세션만 바뀔 때는 트레이가 그대로 있어야 하므로 **트레이의 `key` 를 걷어내고 카드 묶음에만
  걸었다**. 트레이가 매번 아래로 내려갔다 올라오지 않고 카드만 가볍게 뜬다.
  가로 스크롤은 `session.id` 가 바뀔 때 0 으로 되돌린다(마운트에 기대던 것을 명시적으로).
- `AtlasDetail` — 폴더·빈 상태의 아이콘을 없앴다. 아이콘은 그것이 무엇인지 알려 줄 때만
  둔다 — 페이지·세션은 대표 파비콘이 정보지만 일반 기호는 자리만 차지한다.
  직전에 넣었던 `OrbitGlyph.tsx` 는 삭제.

### 검증

```
cd extension && pnpm test     # 13 files, 151 passed
cd extension && pnpm compile  # tsc --noEmit, 오류 없음
cd extension && pnpm build    # 860.5 kB
```

실제 브라우저 스모크는 미실시(도구가 `chrome-extension://` 에 접근하지 못한다).

## 2026-08-12 — 씬 전환(폴더 ↔ 세션) 교차 디졸브와 폴더 글리프

### 씬 전환이 계단처럼 튀던 문제

폴더에서 세션으로 넘어가면 `scene` 객체가 통째로 갈린다 — 중심 노드, 궤도, 칩, 위성,
색이 전부 다른 것이 같은 프레임에 나타난다. 초점 애니메이션은 **한 씬 안에서** 궤도를
옮기는 것이라 이 전환에는 아무 영향이 없었다.

`AtlasCanvas` 가 그리는 씬을 한 박자 늦춘다. 씬 id 가 바뀌면 먼저 옅어지고(`leaving`,
`opacity 0` + `scale(0.975)`, 0.18s), 보이지 않는 사이에 내용을 갈아 끼운 뒤 다시 짙어진다.
같은 씬의 데이터 갱신(이름 변경·재조회)은 지연 없이 그대로 반영한다.

**연속 전환 방어**: 전환 중에 씬이 또 바뀌어도 타이머를 다시 걸지 않는다. 다시 걸면
화살표를 누르고 있는 동안 교체가 계속 미뤄져 화면이 흐린 채로 남는다. 예약된 교체가
그 시점의 마지막 씬을 집어 간다.

### 폴더 글리프

상세 패널 폴더 층의 아이콘을 `ph-folder-simple` 에서 **Orbit 마크의 선만 딴 글리프**로
바꿨다(`components/atlas/OrbitGlyph.tsx` — 궤도 타원 + 행성 + 위성, `currentColor` 라
폴더 색을 그대로 받는다). 일반 폴더 기호는 캔버스가 그리고 있는 것(행성 하나에 궤도가
도는 계)과 어긋난다.

### 검증

```
cd extension && pnpm test     # 13 files, 151 passed
cd extension && pnpm compile  # tsc --noEmit, 오류 없음
cd extension && pnpm build    # 860.67 kB
```

실제 브라우저 스모크는 미실시(도구가 `chrome-extension://` 에 접근하지 못한다).
전환 길이(180ms 씩, 왕복 360ms)는 화면에서 보고 조정이 필요할 수 있다.

## 2026-08-12 — 폴더만 골랐을 때 상세 패널이 폴더를 모르던 문제

### 배경

캔버스에는 폴더가 떠 있는데 오른쪽 상세 패널은 "Orbit Atlas · 세션을 선택해 주세요"
빈 상태에 비활성 버튼 두 개만 남아 있었다. `AtlasDetail` 은 `session`/`page` 만 받고
폴더라는 층을 몰랐다.

### 변경

`AtlasDetail` 에 `folder` 층을 넣었다. 세션을 고르지 않은 채 폴더를 보고 있으면 폴더 개요를 낸다.

- 머리: 폴더 색 아이콘 + 폴더 이름 + `폴더 · 세션 N개`, 지표는 페이지 수와 활성 시간
- 인사이트: `세션 N개에 걸쳐 <도메인> 중심으로 <시간>을 썼습니다. 가장 큰 탐색은 "…"(Np) 입니다.`
  비어 있으면 채우는 방법을 알려 준다.
- `세션 N개` 목록 — 궤도 색과 같은 점 + 제목 + `Np · 날짜`. 누르면 그 세션의 궤도가 펼쳐진다.
- `주요 도메인` — 폴더 전체 기준.
- **비활성 버튼 제거.** 이름 편집(연필)은 세션에만 두고(폴더 이름은 네비게이터에서 고친다),
  "세션 탭 모두 열기"류 작업 섹션은 열 세션이 있을 때만 그린다.

집계는 `data.ts` 의 순수 함수로 뺐다 — `folderTotals`, `folderTopDomains`, `largestSession`.
`buildFolderScene` 도 `folderTotals` 를 쓰게 해 캔버스 부제와 패널이 같은 수를 보게 했다.

### 검증

```
cd extension && pnpm test     # 13 files, 151 passed (폴더 집계 5건 추가)
cd extension && pnpm compile  # tsc --noEmit, 오류 없음
cd extension && pnpm build    # 859.77 kB
```

실제 브라우저 스모크는 미실시(도구가 `chrome-extension://` 에 접근하지 못한다).

## 2026-08-12 — 남은 튐 제거와 간격 추가 확보

### 아직 "짜안" 하던 것 — 구간 경계에서 값이 계단처럼 뛰었다

교차 페이드를 넣고도 전환에 튐이 남았다. 원인은 **연속값(초점 거리)으로 위치는 옮기면서
표현은 구간별 상수로 줬던 것**이다. 궤도가 구간 경계를 넘는 순간 값이 점프한다.

| 튀던 값 | 전 | 후 |
| --- | --- | --- |
| 궤도선 농도 | `beyond > 0` 이면 0.36 기준, 아니면 0.92/0.44 — 경계에서 0.44→0.36 점프 | `(0.42 + 0.5 * near) * tail` 한 식으로 잇는다 |
| 흐린 궤도 선 모양 | `.atlas-arc--beyond` 가 실선↔점선으로 갈림 | 점선 제거 — 농도만으로 구분 |
| 칩 크기·굵기 | `.atlas-chip--aside` 클래스가 높이 26↔30, 글자 11.5↔12 를 갈아 끼움 | `--chip-focus` 로 `height: calc(26px + 4px * ...)` 연속 보간 |
| 칩 농도 | 초점 1.0 / 이웃 0.62 이분 | `fade * (chipRoom ? 0.6 + 0.4 * near : near)` |

`near = max(0, 1 - |offset|)` 는 초점까지의 거리라 프레임마다 이어진다.
자리가 좁아 이웃 칩을 지울 때도 `near` 로 0 까지 내려 보내 잘라내지 않는다.

### 간격

`R_ABS_MAX` 430 → 460, `RING_COMPRESS` 0.28 → 0.20(흐린 궤도를 끝으로 더 몰아 온전한
구간에 자리를 넘긴다). 간격 95px → 117px.

### 정리 안 됨 섹션

세션이 0개면 줄 자체를 감춘다 — "0" 만 적힌 줄은 아무것도 알려주지 않는다.
다만 이 줄은 **폴더에서 세션을 빼는 유일한 드롭 대상**이라, 세션을 끌기 시작하면
(`onDragStart`) 다시 꺼내 놓는다. 그러지 않으면 폴더를 비울 방법이 드래그로는 사라진다.

### 검증

```
cd extension && pnpm test     # 13 files, 146 passed
cd extension && pnpm compile  # tsc --noEmit, 오류 없음
cd extension && pnpm build    # 857.53 kB
```

실제 브라우저 스모크는 미실시(도구가 `chrome-extension://` 에 접근하지 못한다).

## 2026-08-12 — 궤도 간격 넓히기와 세션 전환 교차 페이드

사용자 보고 4건.

### 1. 간격이 좁다

두 원인이 겹쳤다.

- 칩을 자기 궤도 아래로 내리는 값이 **초점만 +24, 나머지는 +11** 이었다. 그래서 초점
  바로 아래 칩과의 간격만 13px 더 좁아졌다(첨부 이미지의 위 150 / 아래 78 비대칭).
  → 모든 칩에 같은 `CHIP_DROP = 22` 를 준다.
- `R_ABS_MAX = 360` 이 반경을 묶고 있었다. 넓은 화면에서 남는 공간을 안 썼다.
  → `R_ABS_MAX` 430, `R_INNER_MIN` 132. 간격이 68px → 95px 로 늘었다.

### 2. 다음 세션이 "짠" 하고 나타난다

칩을 `beyond === 0` 불리언으로 켜고 껐다 — 초점이 미끄러지는 도중 불투명도 1로 갑자기
등장했다. → `beyond` 로 연속 페이드(`1 - min(1, beyond)`)하고, 궤도선 농도도 그리기를
멈추는 지점에서 정확히 0 이 되도록 고쳤다(전에는 0.057 에서 잘렸다).

### 3. 세션 안 페이지(탭)도 같은 문제

세션을 옮기면 이전 궤도의 위성이 제자리에서 사라지고 새 위성이 제자리에 나타났다.
→ 방금 닫힌 궤도를 초점 애니메이션 동안 붙잡아 두고(`leavingTrackId`), 위성 농도를
`--sat-near`(= 초점까지의 거리)로 준다. 나가는 궤도는 멀어지며 옅어지고 들어오는 궤도는
다가오며 짙어져 서로 교차한다. 미끄러지는 중인 궤도는 `pointer-events: none` 이라
엉뚱한 세션이 잡히지 않는다.

트레이(세션의 페이지 카드)도 같은 이유로 제자리에서 갈아 끼워졌다. `key={session.id}` 로
다시 마운트해 기존 등장 애니메이션(`atlas-tray-in`)을 태운다. 가로 스크롤도 함께 처음으로
돌아간다.

### 4. "바깥 세션 N개 더" 버튼 제거

버튼과 `.atlas-stage__axis` CSS 를 함께 지웠다. 흐린 궤도가 이미 같은 신호를 준다.
안내 알약이 이 버튼을 피해 올라가던 보정도 제거.

### 검증

```
cd extension && pnpm test     # 13 files, 146 passed
cd extension && pnpm compile  # tsc --noEmit, 오류 없음
cd extension && pnpm build    # 857.71 kB
```

실제 브라우저 스모크는 미실시(도구가 `chrome-extension://` 에 접근하지 못한다).

## 2026-08-12 — 폴더 궤도를 초점 기반으로: 세션이 많아도 안 몰리게

### 배경

세션 5개짜리 폴더에서 궤도와 칩이 몰려 읽히지 않는다는 보고. 요구는 셋이었다 —
가독성, "더 있다"는 시각 신호, 그리고 탭을 넘기듯 스르륵 이어지는 세션 이동.

기존 배치는 `r0`(≈179)와 `rMax`(≤360) 사이에 궤도를 **개수로 균등 분할**했다.
세션이 늘수록 간격이 줄어 5개면 간격 45px, 칩 세로 간격 36px — 칩 높이가 30px이라
6px만 남았다. 여기에 칩이 겹치면 좌우로 ±126px 튕겨 내는 보정(`--chip-dx`)까지 있어
어느 칩이 어느 궤도인지 잇기도 어려웠다.

### 변경

- `components/atlas/data.ts` — `ringPlacement(index, focus, total)` 추가.
  위성 배치(`orbitPlacement`)와 같은 어법이다. 초점 기준 `ORBIT_RING_SIDE(1)` 칸까지는
  균등 간격, 그 바깥 `ORBIT_RING_HINTS(2)` 칸은 간격을 0.28배로 눌러 흐린 궤도로 남기고,
  더 먼 궤도는 그리지 않는다. **그리는 궤도 수가 세션 수와 무관하게 고정**된다.
- `components/atlas/AtlasCanvas.tsx`
  - 궤도 반경을 `rFocus + offset * ringSpacing` 으로 계산한다. `ringSpacing` 은 세션 수가
    아니라 `ORBIT_RING_REACH` 로 나눠 정해지므로 세션이 늘어도 간격이 줄지 않는다.
  - **초점은 연속값이고 애니메이션한다.** 회전량과 같은 rAF 루프(`advance`)를 쓴다 —
    세션을 옮기면 궤도와 칩이 안팎으로 미끄러진다.
  - 초점 궤도는 언제나 같은 반경. 단 온전한 구간에 다 들어가는 작은 폴더(≤3)는 초점을
    고정하지 않고 가운데로 모은다 — 넘길 것이 없는데 한쪽에 몰리면 비어 보인다.
  - 칩은 온전한 구간에만 달고, 자리가 좁으면 초점 칩만 남긴다. `--chip-dx` 좌우 튕김 제거.
  - 궤도 축 창(`axisIndex`, `MAX_RENDERED_ORBITS`) 제거. 휠과 안쪽/바깥 버튼은 초점 이동
    (= 이웃 세션 펼치기)으로 바꿨다. 휠은 관성 한 번에 여러 칸이 넘어가지 않도록 260ms 잠근다.
  - 궤도선 농도를 인덱스가 아니라 초점 거리로 계산한다.
- `styles/atlas.css` — `.atlas-chip--aside`(이웃 세션 칩, 한 단계 물린 크기·농도) 추가.

### 함께 고친 것

`AtlasDetail` 왼쪽 경로의 세션 이름이 잘리기만 하고 `…` 이 안 붙었다.
`.atlas-detail__crumb` 이 파비콘과 나란히 놓으려고 `inline-flex` 인데,
**`text-overflow` 는 flex 컨테이너에 적용되지 않는다.** 글자를 안쪽 블록
(`.atlas-detail__crumb-label`)으로 감싸 거기서 자르도록 했다.

### 검증

```
cd extension && pnpm test     # 13 files, 146 passed (링 배치 8건 추가)
cd extension && pnpm compile  # tsc --noEmit, 오류 없음
cd extension && pnpm build    # 858.41 kB
```

실제 브라우저 스모크는 미실시(도구가 `chrome-extension://` 에 접근하지 못한다).
간격·농도 수치는 화면에서 보고 조정이 필요할 수 있다.

## 2026-08-12 — 세션 하나가 궤도 여러 개로 쪼개지던 문제

### 원인

`buildSessionScene` 이 `splitPagesIntoOrbits(session.pages)` 로 페이지를 `ORBIT_CAPACITY = 14`
단위로 잘라 궤도를 만들었다. 페이지 23개짜리 세션은 14 + 9 두 궤도가 됐다.

이 정원은 **옛 슬롯 모델의 잔재**다. 앞면 슬롯 7개 + 뒤편 7개 = 14 가 궤도 하나가 담을 수
있는 전부였다(`ORBIT_CAPACITY = ORBIT_VISIBLE_SLOTS * 2`). 2026-08-12 연속 각도 모델로
바꾸면서 궤도 하나가 담는 점의 수에 상한이 사라졌는데, 분할 로직만 그대로 남아 있었다.

### 변경

- `components/atlas/data.ts`
  - `ORBIT_CAPACITY`, `splitPagesIntoOrbits` 제거.
  - `buildSessionScene` 이 페이지 수와 무관하게 **궤도 하나**를 만든다. 앞면에 못 놓는
    만큼은 뒤편에 있다가 회전으로 올라온다. 페이지가 없으면 궤도도 없다(빈 상태 안내).
  - `pickAdjacentOrbit` 제거 — 세션 씬 궤도가 하나뿐이라 도달할 수 없는 코드가 됐다.
- `components/VariantAtlasReplica.tsx` — `stepVertically` 에서 궤도 이동 분기 제거.
  ↑↓ 는 네비게이터 세로 이동만 한다.
- `tests/unit/atlas-data.test.ts` — 분할 테스트와 궤도 세로 이동 테스트를 "궤도 하나"
  계약 테스트로 교체(페이지 40개 → 궤도 1개, 라벨 없음, 페이지 0개 → 궤도 없음).

직전 커밋에서 넣은 "궤도 여러 줄을 ↑↓ 로 훑기"는 이 변경으로 필요가 없어져 함께 걷어냈다.

### 검증

```
cd extension && pnpm test     # 13 files, 138 passed
cd extension && pnpm compile  # tsc --noEmit, 오류 없음
cd extension && pnpm build    # 857.64 kB
```

실제 브라우저 스모크는 미실시(도구가 `chrome-extension://` 에 접근하지 못한다).

## 2026-08-12 — 여러 줄로 쌓인 궤도도 ↑↓ 로 위에서 아래로

### 배경

궤도가 여러 줄인 화면에서 위에서부터 아래로 내려가게 해달라는 요청(첨부: 페이지 23개가
14+9 두 궤도로 나뉜 세션 씬).

직전 변경에서 ↑↓ 를 네비게이터 이동으로 넘기면서 **세션 씬의 궤도 사이 이동이 빠졌다**.
←→ 는 선택된 페이지가 있는 궤도 하나만 몰기 때문에, 두 번째 궤도(15~23쪽)에 키보드로
닿을 방법이 없었다.

### 변경

- `components/atlas/data.ts` — `pickAdjacentOrbit(scene, selectedPointId, direction)` 추가.
  세션 씬에서 궤도가 둘 이상일 때 이웃 궤도를 돌려준다. 아직 어느 궤도에도 들어가 있지
  않으면 방향에 맞는 끝에서 시작한다 — ↓ 면 **최상단(가장 안쪽) 궤도부터**. 양 끝을
  넘어서면 null 을 돌려 호출자가 네비게이터 이동으로 넘기게 한다.
  폴더 씬의 궤도는 세션이라 여기서 다루지 않는다(네비게이터 줄로 이미 이어져 있다).
- `components/VariantAtlasReplica.tsx` — `stepVertically` 가 궤도 이동을 먼저 시도하고,
  갈 곳이 없을 때 네비게이터 이동으로 넘어간다. 궤도로 옮길 때는 그 궤도의 첫 페이지를
  고른다 — 선택이 회전과 축 이동을 끌고 오므로 곧바로 ←→ 로 그 궤도를 훑을 수 있다.

**정렬 순서 불일치도 함께 고쳤다.** 네비게이터는 `sortSessions` 로 정렬해 그리는데
`buildFolderScene` 은 원본 순서로 궤도를 그렸다. 가나다순에서 두 화면의 "위에서 아래로"가
서로 다른 뜻이 됐다. 정렬을 `VariantAtlasReplica` 에서 한 번만 적용하고, 정렬된 목록을
씬·네비게이터 줄·네비게이터 컴포넌트에 모두 넘긴다.

### 검증

```
cd extension && pnpm test     # 13 files, 147 passed (궤도 세로 이동 7건 추가)
cd extension && pnpm compile  # tsc --noEmit, 오류 없음
cd extension && pnpm build    # 858.15 kB
```

실제 브라우저 스모크는 미실시(도구가 `chrome-extension://` 에 접근하지 못한다).

## 2026-08-12 — ↑↓ 를 네비게이터 세로 순서 전체로 넓힘

### 배경

폴더끼리, 정리 안 된 세션끼리도 ↑↓ 로 옮기고 싶다는 요청. 직전 구현의 ↑↓ 는 폴더 씬에서
**그 폴더 안의 세션끼리만** 움직였고(`AtlasCanvas.stepTrack`), 세션 씬에서는 궤도 축을
밀었다 — 폴더 사이나 미정리 세션 사이로는 갈 수 없었다.

### 변경

- `components/atlas/data.ts` — `buildNavRows(folders, unfiled, openFolderId)` 와
  `stepNavRow(rows, current, direction)` 순수 함수 추가.
  폴더 줄을 차례로 놓고 **지금 보고 있는 폴더의 세션만** 그 아래에 끼운 뒤 정리 안 된
  세션을 붙인다. 폴더·폴더 안 세션·미정리 세션이 한 줄로 이어져 끝에 닿으면 다음 층으로
  자연스럽게 넘어간다.
- `components/VariantAtlasReplica.tsx` — ↑↓ 를 여기서 처리한다. 도착한 줄이
  폴더면 폴더를 열고, 미정리 세션이면 그 세션을 열고, **폴더 안 세션이면 폴더 화면을
  유지한 채 그 세션의 궤도만 펼친다**(폴더를 훑는 동안 화면이 바뀌지 않는다).
- `components/atlas/AtlasCanvas.tsx` — ↑↓ 처리와 `stepTrack` 제거. 캔버스는 ←→(궤도 안
  페이지 이동)만 맡는다. 궤도 축 이동은 휠과 "바깥 궤도" 버튼에 남았다.
- 안내 알약 문구를 `↑↓ 폴더·세션 이동, ←→ 페이지 이동` 으로 갱신.

### 설계 메모

**모든 폴더를 펼쳐 잇지 않는다.** 그러면 폴더 하나 건너가는 데 그 안의 세션을 전부
지나야 한다. 보고 있는 폴더의 세션만 낀다.

**양 끝에서 감기지 않는다.** 맨 아래에서 맨 위로 튀면 어디까지 훑었는지 잃는다.

순서 계산을 컴포넌트에서 `data.ts` 로 뺐다 — UI 없이 검증할 수 있고, 캔버스와 페이지가
같은 규칙을 본다.

### 검증

```
cd extension && pnpm test     # 13 files, 140 passed (세로 이동 8건 추가)
cd extension && pnpm compile  # tsc --noEmit, 오류 없음
cd extension && pnpm build    # 857.68 kB
```

실제 브라우저 스모크는 미실시(도구가 `chrome-extension://` 에 접근하지 못한다).

## 2026-08-12 — 아틀라스 트레이·안내 알약 다듬기

사용자 보고 3건.

1. **안내 알약이 트레이 카드를 가린다.** `.atlas-stage__hint` 가 `bottom: 22px` 로 스테이지
   바닥에 고정돼 있어, 세션 트레이(높이 250px)가 열리면 그 위에 겹쳐 앉았다.
   → `--hint-bottom` 을 인라인으로 받아 `bottomInset + 12px` 에 둔다. 바깥 궤도 버튼
   (`.atlas-stage__axis--out`, 같은 자리에 뜬다)이 있으면 `+56px` 로 한 칸 더 올린다.
2. **사이드패널을 열면 트레이 카드 제목이 두 줄로 접힌다.** `.atlas-card__name` 이
   `-webkit-line-clamp: 2` 였다. → `white-space: nowrap` + `text-overflow: ellipsis` 한 줄.
   캔버스 폭이 줄어도 카드 높이가 흔들리지 않는다.
3. **트레이 헤더의 세션/수집 중 배지 제거.** `AtlasTray` 의 `.atlas-tray__badge` 와 CSS 삭제.

### 검증

```
cd extension && pnpm test     # 13 files, 132 passed
cd extension && pnpm compile  # tsc --noEmit, 오류 없음
cd extension && pnpm build    # 857.01 kB
```

실제 브라우저 스모크는 미실시(도구가 `chrome-extension://` 에 접근하지 못한다).

## 2026-08-12 — 세션 별칭(alias)과 네비게이터 정렬

### 배경

세션 이름을 사용자가 고칠 수 있어야 하는데, 이름 자체가 바뀌면 기존 로직이 깨질 위험이
있다는 사용자 지적. 실제로 `PATCH /sessions/{id}` 는 `session.title` 을 덮어쓰고 있었고,
`title` 은 임베딩 텍스트·병합 게이팅의 제목 Jaccard·추천 term 추출의 기준이며 배치
세션화(`session_updater`)가 매번 다시 만들어 낸다 — 즉 **사용자가 바꾼 이름이 다음 배치에
덮이고** 저장된 벡터와도 어긋난다.

함께 요청: 네비게이터에서 세션 이름 편집, 최신순·가나다순 정렬.

### 변경

**backend**

- `app/db/models.py` — `Session.alias` 컬럼. 응답 경계 전용 헬퍼 `session_display_title()`
  과 컬럼 조회용 SQL 식 `SESSION_DISPLAY_TITLE`(= `coalesce(alias, title)`).
- `app/db/migrations.py` — `sessions.alias` additive 등록.
- `app/schemas/session.py` — `PatchSessionRequest` 를 `{title}` 에서 `{alias}` 로 교체,
  `SessionDetail.alias` 추가.
- `app/api/sessions.py` — `_to_detail` 이 표시 이름을 내보내고, `patch_session` 은 별칭만
  쓴다. 공백만 남은 별칭은 지우기로 본다.
- `app/api/analytics.py`, `app/api/events.py`, `app/api/search.py` — 사용자에게 보이는
  세션 이름을 표시 이름으로 교체.
- `app/services/merge_suggester.py` — `SessionMeta` 에 `display_title` 을 더해 **점수용
  canonical 과 카드 라벨을 분리**. 판정만 검증하는 호출자가 채우지 않아도 되도록 기본값 `""`.
- `app/services/recommender/service.py` — 추천 카드 라벨을 표시 이름으로.

**extension**

- `lib/types.ts`, `lib/api.ts` — `Session.alias`, `renameSession` → `setSessionAlias`.
- `entrypoints/sidepanel/hooks/useSessions.ts`, `views/SessionDetailView.tsx`,
  `newtab/components/atlas/AtlasDetail.tsx` — 기존 편집 진입점 2곳을 별칭 경로로 전환.
- `newtab/components/atlas/data.ts` — `SessionNode.alias`, `sortSessions()`.
- `newtab/lib/nav-state.ts` — `sessionSort` 공유 상태.
- `newtab/hooks/useFolders.ts` — `renameSessionAlias` 뮤테이션.
- `newtab/components/atlas/AtlasNavigator.tsx` — 세션 행 인라인 이름 편집(연필 버튼),
  헤드에 정렬 토글. 폴더 안 세션과 미정리 목록 모두에 정렬 적용.
- `newtab/components/VariantAtlasReplica.tsx`, `components/layout/NavigatorDrawer.tsx` —
  정렬 상태 전달.

### 설계 메모

**표시 이름은 서버가 합친다.** `SessionDetail.title` 이 `coalesce(alias, title)` 이고
원본은 응답에 싣지 않는다. 클라이언트가 화면마다 합치면 대시보드 캔버스·네비게이터·트레이·
상세·사이드패널·검색·추천 중 한 곳만 빠져도 같은 세션이 두 이름으로 보인다.

`session_display_title` 을 모델의 `@property` 가 아니라 **모듈 함수**로 둔 이유: 매퍼를
검증하는 테스트 대역(SimpleNamespace)이 실제 컬럼 `alias` 만 흉내 내면 되고, 파생 규칙을
대역이 따라 적지 않아도 된다. 처음에 property 로 넣었다가 대역 3곳이
`AttributeError: no attribute 'display_title'` 로 깨져 바꿨다.

의도적 예외 — Ask 프롬프트와 추천 리랭크 프롬프트는 `SessionDetail`/`SessionSignals` 를
거치므로 별칭을 본다. 사용자가 부르는 이름이 질의와 더 가까워 유리하고, 저장된 벡터와
대조하는 경로가 아니다.

정렬은 **표시 이름 기준**이다. 별칭을 붙였는데 원래 이름으로 정렬되면 가나다순 목록이
뒤죽박죽으로 보인다. `numeric: true` 로 "실험 10"이 "실험 2" 앞에 오는 사전순을 피한다.

### 검증

```
backend  ../.conda/bin/python -m pytest -p no:asyncio   # 488 passed
extension pnpm test                                     # 13 files, 132 passed
extension pnpm compile                                  # tsc --noEmit, 오류 없음
extension pnpm build                                    # 857.37 kB
```

추가한 테스트

- backend `tests/test_sessions.py` — 별칭이 표시 이름이 되는지, 없으면 원래 이름으로
  떨어지는지, `PATCH` 가 `title` 을 건드리지 않는지, 공백 별칭이 지워지는지, 길이 경계.
- extension `tests/unit/atlas-data.test.ts` — 별칭 매핑 2건, `sortSessions` 5건.

마이그레이션은 백엔드 재기동으로 실제 적용했고 `\d sessions` 로 `alias varchar(100)` 확인.
`coalesce` 왕복(별칭 지정 → 표시 이름 변경 → 별칭 삭제 → 원래 이름 복귀)을 롤백하는
트랜잭션 안에서 확인했다 — 실제 데이터는 건드리지 않았다.

**미실시 — 실제 브라우저 스모크.** `chrome-extension://` 페이지는 브라우저 자동화 도구가
접근하지 못한다. 확장 새로고침 후 사용자 확인이 필요하다.

- 네비게이터 세션 행 연필 → 이름 수정 → 대시보드·사이드패널 양쪽에 반영
- 이름을 비우면 AI 가 만든 원래 이름으로 복귀
- 헤드 정렬 버튼으로 최신순 ↔ 가나다순

## 2026-08-12 — 궤도 캔버스: 선택 페이지 최하단 고정과 화살표 이동

### 배경

사용자 보고 세 건.

1. 대시보드에서 폴더 생성 버튼을 누르면 같은 폴더가 두 개 생길 때가 있다.
2. 폴더를 연 뒤 화살표 키로 세션·페이지를 옮길 수 없다.
3. 선택한 페이지가 궤도 어디에나 놓여(첨부 이미지에서는 왼쪽 끝) 어느 것이 선택된
   것인지 읽히지 않는다. 선택된 페이지는 늘 행성 바로 아래여야 하고, 좌우 이동은
   궤도가 도는 애니메이션으로 보여야 하며, 궤도 밖에 페이지가 더 있다는 신호가 필요하다.

### 원인

**(1) 폴더 중복 생성** — `AtlasNavigator.tsx` 의 새 폴더 입력창은 `onKeyDown(Enter)` 와
`onBlur` 가 같은 `submitNewFolder()` 를 부른다. 그 함수는 `await create.mutateAsync(name)`
동안 입력창을 그대로 두고 성공한 뒤에야 `setCreating(false)` 로 지운다. 그 시점에
포커스를 가진 입력창이 DOM 에서 빠지며 `onBlur` 가 한 번 더 발화해 **같은 이름으로
두 번째 생성 요청**이 나갔다. 재진입을 막는 장치가 없었다.
같은 결함이 이름 변경에도 있었고, `Escape` 취소는 입력값을 남긴 채 창만 닫아
뒤따르는 blur 가 오히려 폴더를 만들었다.

**(2) 화살표 무반응** — `←→` 는 `rotateTrack` 만 불렀고 그 함수는 페이지가 7개 이하면
즉시 반환했다. `↑↓` 는 궤도가 4개 이하면 즉시 반환했다. 흔한 크기의 폴더에서는 두
방향 모두 아무 일도 하지 않았고, 회전은 선택을 바꾸지 않아 애초에 "이동"이 아니었다.

**(3) 선택 위치** — `slotAngle()` 이 앞면 반원을 7개 고정 슬롯으로 나눠 점을 넣었다.
선택된 점은 어느 슬롯이든 갈 수 있었고, 칩이 있는 궤도는 최하단을 칩 자리로 비우려고
점을 좌우로 갈라 놓아 선택된 페이지가 화면 끝에 붙었다. 뒤편 점은 잘라내 흔적을
남기지 않아 "밖에 더 있다"가 회전 컨트롤의 숫자로만 표현됐다.

### 변경

- `components/atlas/AtlasNavigator.tsx` — 폴더 생성·이름 변경 모두 **입력창을 먼저 닫고**
  요청을 보내며, 실패했을 때만 되돌린다. `Escape` 는 입력값을 함께 비워 blur 가 요청을
  보내지 않게 한다.
- `components/atlas/data.ts` — 슬롯 모델(`orbitSlot`, `isVisibleSlot`, `visibleIndices`,
  `ORBIT_VISIBLE_SLOTS`)을 걷어내고 **연속 각도 모델**로 교체.
  `ringDelta`, `alignOffset`, `orbitGap`, `orbitPlacement` 추가.
  회전량이 가리키는 점이 90도(최하단)이고, 좌우 3칸까지 균등 배치,
  그 바깥 3칸은 간격을 0.34배로 눌러 양 끝에 몰아 둔다.
- `components/atlas/AtlasCanvas.tsx` — 회전량을 `requestAnimationFrame` 지수 감쇠로
  보간하고 좌표를 매 프레임 다시 계산한다. 선택이 바뀌면 `alignOffset` 으로 최단 방향
  목표를 잡는다. `←→` = 페이지 이동, `↑↓` = 세션(궤도) 이동으로 키 재정의.
  회전 컨트롤을 좌우 페이지 이동 버튼으로 바꾸고 페이지가 2개 이상이면 항상 노출.
  펼친 궤도의 칩과 컨트롤을 최하단 위성 아래로 내렸다.
- `styles/atlas.css` — `.atlas-sat--edge` 추가. 크기·농도를 `--sat-fade` 에 걸고
  전이를 끈다(매 프레임 갱신되는 값이라 전이를 걸면 회전을 따라오지 못한다).
- `tests/unit/atlas-data.test.ts` — 슬롯 테스트 8건을 각도 배치 테스트 10건으로 교체.

### 설계 메모

점을 `left/top` 전이로 옮기면 두 점을 잇는 **현**을 따라가 궤도를 벗어난다. 그래서
좌표가 아니라 **회전량**을 보간한다. 보간값은 프레임마다 바뀌므로 상태가 아닌 ref 에
두고 리렌더만 튕긴다 — 상태 갱신 함수 안에서 "애니메이션을 이어갈지"를 판단하면
StrictMode 이중 호출에 걸린다.

`orbitPlacement` 의 `beyond` 를 정수 단계가 아니라 연속값으로 돌려주는 이유도 같다.
회전이 연속이라 온전한 점에서 축소 점으로 끊김 없이 이어져야 한다.

### 검증

```
cd extension && pnpm test      # 13 files, 125 passed
cd extension && pnpm compile   # tsc --noEmit, 오류 없음
cd extension && pnpm build     # 855.81 kB
```

백엔드는 `docker compose up -d`(postgres, qdrant) 후 `uvicorn app.main:app --port 8000`
으로 기동해 `/health` 200 확인. 궤도 변경은 프론트 전용이라 백엔드 테스트는 돌리지 않았다.

**미실시 — 실제 브라우저 스모크.** `chrome-extension://` 페이지는 사용 중인 브라우저
자동화 도구가 접근하지 못한다. 다음은 사용자 확인이 필요하다.

- 폴더 생성 1회 = 폴더 1개
- 폴더 안 세션 4개 이하, 페이지 7개 이하에서도 `↑↓` `←→` 동작
- 선택된 페이지가 항상 최하단, 좌우 이동이 회전으로 보임
- 페이지가 많으면 궤도 양 끝에 축소 점, 적으면 없음


## 2026-08-07 — 사용자 폴더와 궤도 캔버스 2뎁스

### 배경

대시보드 세션 목록이 1뎁스 시간순이라 기록이 쌓이면 스크롤 외에는 찾을 방법이 없었다.
캔버스를 살펴보니 `AtlasCanvas.tsx` 의 궤도는 `PAGES_PER_ORBIT = 8` 로 페이지를 8개씩
잘라 담는 페이지네이션이라 궤도 반경이 아무 정보도 전달하지 않았고,
`atlas/data.ts:139-142` 에는 "백엔드에 Orbit 엔티티가 없어 세션을 중심 노드로 직접
쓴다"는 주석이 남아 있었다. 주제 계층은 원래 설계에 있었으나 미구현 상태였다.

궤도=세션 매핑을 그대로 넣으면 깨지는 지점을 먼저 계산했다. `ORBIT_GAP = 58`,
`R_ABS_MAX = 390`, 최소 반경 150 이라 궤도는 실질 5줄이 한계고, 세션당 페이지 20~40개를
반원 아크에 배치하면 점이 100개 넘게 겹친다. 그래서 밀도 통제(궤도 정원 + 동시 렌더 상한)를
설계에 먼저 넣었다.

### 변경

**backend**

- `app/db/models.py` — `Folder` 신규 테이블, `Session.folder_id` 추가(단일 소속)
- `app/db/migrations.py` — `sessions.folder_id` 를 additive 컬럼으로 등록
- `app/schemas/folder.py` — 신규. 이름 60자, 일괄 배정 200건 상한
- `app/schemas/session.py` — `SessionDetail.folder_id` (superset 정책)
- `app/api/folders.py` — 신규 라우터. CRUD + 일괄 배정 + 폴더에서 빼기
- `app/api/sessions.py` — `_to_detail` 에 `folder_id` 매핑
- `app/main.py` — `folders_router` 를 인증 의존성과 함께 등록

**extension**

- `lib/types.ts` — `Folder`, `FolderAssignResult`, `Session.folderId`
- `lib/api.ts` — 폴더 API 클라이언트 5종
- `entrypoints/newtab/hooks/useAtlasData.ts` — 세션과 폴더를 함께 조회해
  `{sessions, folders, unfiled}` 로 반환
- `entrypoints/newtab/hooks/useFolders.ts` — 신규. 폴더 변경 뮤테이션 묶음
- `entrypoints/newtab/components/atlas/data.ts` — 궤도 각도·회전 순수 함수,
  `OrbitScene` 빌더, 폴더 그룹핑
- `entrypoints/newtab/components/atlas/AtlasCanvas.tsx` — 씬 기반으로 재작성
- `entrypoints/newtab/components/atlas/AtlasNavigator.tsx` — 3뎁스 트리, 드래그앤드롭
- `entrypoints/newtab/components/atlas/FolderAssignDialog.tsx` — 신규. 일괄 선택
- `entrypoints/newtab/components/VariantAtlasReplica.tsx` — 폴더/세션 씬 분기
- `entrypoints/newtab/components/layout/NavigatorDrawer.tsx`, `App.tsx` — 새 계약 반영
- `entrypoints/newtab/lib/nav-state.ts` — `focusedFolderId` 추가
- `entrypoints/newtab/styles/atlas.css` — 폴더 행, 궤도 라벨, 축 이동, 대화상자

### 해결한 문제

- **`test_ask_ownership.py` 실패** — `SessionDetail.folder_id` 를 추가하자 `_to_detail` 이
  `session.folder_id` 를 읽는데 테스트의 `SimpleNamespace` 페이크에 그 속성이 없어
  `AttributeError`. `getattr(..., None)` 로 감싸면 실제 누락도 함께 감춰지므로,
  페이크가 실제 모델을 반영하도록 `folder_id=None` 을 추가했다.
- **휠 이벤트가 먹지 않는 문제** — React 의 `onWheel` 은 passive 로 등록돼
  `preventDefault` 가 동작하지 않아 궤도 축을 옮기면 페이지도 같이 스크롤된다.
  `stageRef` 에 `{ passive: false }` 로 직접 리스너를 걸었다.
- **축 이동 버튼이 트레이에 가리는 문제** — `bottom: 0` 이면 높이 250px 짜리 하단 트레이
  뒤에 깔린다. `bottomInset` 을 인라인 `bottom` 으로 써서 트레이 위에 띄웠다.

### 설계 결정

- **궤도 각도 모델** — 앞면 반원 180도를 7슬롯으로 나눠 점 간격을 고정하고, 같은 간격을
  원 한 바퀴에 이어 붙여 정원 14개를 얻었다. 간격이 일정해 "뒤에서 돌아 나온다"가
  물리적으로 일관되고, 앞면/뒤편 판정이 `0 < angle < 180` 한 줄로 끝난다.
- **동시 렌더 궤도 4개 + 창 밖 1개** — 전부 그리면 바깥 궤도가 화면 폭을 넘어 좌우가
  잘린다. 창 밖 첫 궤도만 흐리게 걸쳐 두어 "더 있다"를 시각적으로 남겼다.
- **궤도 라벨을 30도 지점에 배치** — 아크 끝점(y=0)에 두면 궤도마다 x 만 다르고 y 가 같아
  라벨이 겹친다. 30도면 `ry` 차이가 y 간격으로 벌어지고 첫 점과 둘째 점 사이라 점도 가리지 않는다.
- **낙관적 갱신을 쓰지 않음** — 일괄 배정은 서버가 소유권을 확인해 일부만 반영될 수 있어
  (`skipped`) 화면이 먼저 앞서가면 실제 결과와 어긋난다.
- **`sessions.folder_id` 에 FK 없음** — ALTER 로 추가되는 컬럼이고 폴더 삭제는
  애플리케이션이 NULL 되돌리기로 처리한다. 조회 측은 존재하지 않는 폴더 id 를 미정리로
  간주해 방어한다(다른 기기에서 폴더가 지워졌을 때 세션이 사라져 보이지 않도록).

### 검증

```
cd backend && python -m pytest -p no:asyncio     # 483 passed
cd extension && pnpm test                        # 13 files, 118 passed
cd extension && pnpm compile                     # 오류 없음
cd extension && pnpm build                       # 852.96 kB, 13.5s
```

- 인증 경계 테스트(`test_auth_boundary.py`)가 신규 폴더 경로 6개를 자동으로 커버한다(76 passed).
- `app.openapi()` 로 `/folders`, `/folders/{folder_id}`, `/folders/{folder_id}/sessions`,
  `/folders/{folder_id}/sessions/{session_id}` 등록을 확인했다.

### 남은 일

- **실제 브라우저 스모크가 남아 있다.** 폴더 생성·드래그 배정·궤도 회전·축 이동은
  단위 테스트와 타입 검사로만 확인했고 실제 확장에서 눌러 보지 않았다.
- 폴더 순서 변경(`position`)은 API·스키마만 있고 UI가 없다.
- 폴더 씬에서 세션이 5개를 넘을 때의 실데이터 밀도는 확인하지 않았다.

### 후속 (2026-08-07) — 실제 화면 확인에서 나온 두 건

**폴더 생성이 404로 실패** — 원인은 코드가 아니라 백엔드가 새 코드로 재기동되지 않은 것.
`GET /folders` 가 404 였고 postgres 에 `folders` 테이블과 `sessions.folder_id` 가 모두
없었다. 테이블 생성(`create_all`)과 컬럼 추가(`run_migrations`)는 `app/main.py` 의
lifespan 에서만 실행되므로 스키마를 바꾼 뒤에는 서버 재시작이 필수다.

**궤도 라벨이 화면 왼쪽 밖으로 잘림** — 라벨을 궤도 왼쪽 바깥에 `translate(-100%)` 로
붙였는데, 궤도가 화면 폭을 거의 채우면 라벨(최대 190px)과 회전 컨트롤(약 120px)이 놓일
자리가 없다. 두 가지로 고쳤다.

- 궤도가 하나뿐인 세션 씬은 궤도 라벨을 비운다 — 중심 노드 아래 제목과 같은 글자라 중복이었다.
- 왼쪽 여백이 라벨+컨트롤 폭에 못 미치면 `atlas-track--flip` 으로 아크 안쪽에 배치한다.
  고정 임계값 대신 라벨 유무와 회전 가능 여부로 필요 폭을 계산한다.

`tests/unit/atlas-data.test.ts` 에 라벨 규칙 테스트 2건 추가(120 passed).

**기존 플레이키 테스트 수정** — `tests/unit/engine.test.ts` 의 "BATCH_SIZE(50) 초과
pending" 테스트가 전체 실행 시 간헐 실패했다(6회 중 1회, 격리 실행은 6회 모두 통과).

`sync/engine.ts` 의 drain 순서는 `postEventBatch` → `markSynced`(배치마다 반복) →
`triggerServerSync` 다. 테스트는 `waitUntil` 로 synced 표시만 기다린 뒤 **밖에서**
`mockServerSync` 를 단언해, 마지막 한 걸음이 아직 남아 있으면 실패했다. 부하가 큰 전체
실행에서만 드러나는 경합이다.

세션화 트리거까지 확인해야 하는 단언을 `waitUntil` 안으로 옮겼다(3곳). 검증 내용은 그대로
두고 기다리는 조건만 정확히 했다 — 단언을 지우거나 약화시키지 않았다. 오히려 "세션화 트리거
실패는 drain 을 실패시키지 않는다" 테스트는 트리거가 실제로 호출됐는지 확인하지 않아
공허하게 통과할 수 있었으므로 `toHaveBeenCalledTimes(1)` 을 추가해 강화했다.

전체 스위트 8회 연속 120 passed 로 재현되지 않음을 확인했다.

**개발 서버 기동 방식** — 실행 중이던 백엔드는 `--reload` 없이 떠 있어(`python -m uvicorn
app.main:app --host 127.0.0.1 --port 8000`) 코드 변경이 반영되지 않았다. `--reload` 를 붙여
다시 띄웠고, `folders` 테이블과 `sessions.folder_id` 생성, `GET /folders` 가 404 에서 401 로
바뀐 것을 확인했다. `dev.sh`/`dev_conda.sh` 는 원래 `--reload` 를 쓴다 — 수동 기동에서만
빠져 있었다.

### 후속 (2026-08-08) — 287823c 원본 디자인에 맞춤

사용자가 "디자인이 안 맞는다"고 지적했다. 최초 Atlas 를 만든 커밋 `287823c`
(`feat(newtab): Orbit 홈·대시보드를 새 탭으로 제공하고 디자인 토큰 통일`)의
Orbit(주제) → Session → Page 3계층 디자인과 대조해 세 가지 어긋남을 찾았다.

| | 원본 287823c | 내 구현(수정 전) |
|---|---|---|
| 세션 라벨 | 호 최하단의 **칩** (제목 · `Np · 시간` · 날짜) | 궤도 왼쪽 바깥 텍스트 |
| 페이지 점 | **선택한 세션 것만** 위성으로 | 모든 궤도의 점을 동시에 |
| 네비 계층 | 폴더=컬러 아이콘, 세션=`atlas-row--session` | 폴더=색 점, 세션이 `--orbit` 오용 |

`atlas-chip` 계열 CSS 는 원본 그대로 파일에 남아 있었는데 내가 쓰지 않고 새 스타일을
따로 만들고 있었다. 원본 부품을 되살리는 방향으로 맞췄다.

**궤도 회전 모델을 각도 기반에서 슬롯 기반으로 교체** — 칩이 붙은 궤도는 최하단을 비워야
해서 점 간격이 궤도마다 달라진다. 각도를 데이터 계층에서 계산하던 `orbitAngle`/
`isFrontAngle` 을 `orbitSlot`/`isVisibleSlot` 으로 바꾸고, 슬롯 → 각도 변환은 칩 유무를
아는 캔버스가 맡는다. 칩이 있으면 원본 `satelliteAngle` 의 `acos` 기반 컷오프로 칩 폭만큼
비우고 좌우로 갈라 놓는다.

**"선택한 세션만 펼치기" 가 밀도 문제도 함께 푼다** — 초기 구현에서 궤도 정원과 동시 렌더
상한으로 막으려던 점 겹침이, 한 번에 한 세션만 펼치면 구조적으로 사라진다. 화면에 남는
위성이 최대 7개다. 나머지 궤도는 칩만으로 무엇이 있는지 알린다.

**칩 클릭은 화면을 바꾸지 않는다** — 세션 씬으로 넘어가지 않고 그 자리에서 페이지만
펼친다(다시 누르면 접힘). 폴더 안을 훑는 동안 화면이 전환되면 어디를 보고 있었는지 잃는다.

그 밖에 원본 값으로 되돌린 것: `RATIO` 0.68 → **0.8**, `R_ABS_MAX` 390 → **360**,
궤도선 농도 그라데이션(`arcOpacity` — 안쪽이 진하고 바깥이 옅음), 궤도선 상단 페이드
마스크(`atlas-arc-mask`), 반경을 트레이 열린 최악 높이 기준으로 잡는 계산.

변경 파일: `atlas/data.ts`, `atlas/AtlasCanvas.tsx`, `atlas/AtlasNavigator.tsx`,
`VariantAtlasReplica.tsx`, `styles/atlas.css`, `tests/unit/atlas-data.test.ts`.

검증: `pnpm test` 122 passed, `pnpm compile` 오류 없음, `pnpm build` 854.06 kB.
실제 브라우저 확인은 사용자 몫으로 남아 있다.

### 블로그 소재

- "궤도 UI 의 밀도 한계를 UI 를 그리기 전에 계산하기" — `ORBIT_GAP`, `R_ABS_MAX` 로
  궤도 상한을 먼저 구하고 설계를 거기 맞춘 과정
- "2뎁스는 오분류의 비용을 키운다" — 자동 클러스터링 대신 수동 폴더를 택한 이유와
  검색을 평면으로 유지한 완화책

## 2026-08-07 — 확장 ID 고정(manifest key) — 팀 다중 환경 로그인 준비

### 배경

구글 로그인 구현 현황을 점검하다가, 개발 루프가 구조적으로 깨지는 지점을 찾았다.
`manifest.key` 가 없어 확장 ID 가 **설치 경로에서 유도**되고 있었다. 그 결과
`pnpm dev`(`.output/chrome-mv3-dev`)와 `pnpm build`(`.output/chrome-mv3`)가 서로 다른 ID 를
갖는데, 구글 OAuth 클라이언트에는 항목 ID 를 하나만 등록한다. 둘 중 한쪽에서만 로그인이
되고, 재설치·경로 이동·다른 팀원 머신에서도 모두 깨진다.

점검 중 `.output/chrome-mv3-dev` 가 08-05 산출물이라 `oauth2`·`identity` 가 아예 없는 것도
확인했다(구글 로그인 구현 이전 빌드). 결함이 아니라 낡은 산출물이며 재빌드로 해소됐다.

### 변경

- `extension/wxt.config.ts` — RSA 2048 공개키(SPKI DER base64)를 `EXTENSION_KEY` 상수로 두고
  `manifest.key` 에 주입. **`.env` 가 아니라 소스에 커밋**했다. `client_id` 와 달리 환경마다
  달라지면 안 되는 값이라 환경변수 성격이 아니고, 팀원이 각자 채우면 오히려 ID 가 갈린다.
  공개키라 비밀이 아니다.
- `.gitignore` — `.keys/` 추가. 짝이 되는 개인키(`extension/.keys/extension.pem`)가 유출되면
  제3자가 같은 ID 로 확장을 서명할 수 있다.
- `extension/.env.example`, `backend/.env.example` — 고정된 항목 ID 를 명시하고, 확장 ID 는
  채울 값이 아님을 안내. 팀원 계정이 OAuth 동의 화면의 테스트 사용자로 등록되어야 한다는
  조건을 추가(미등록 계정은 403 access_denied).

### 검증

- `pnpm compile` 통과, `pnpm build` 통과(830.26 kB).
- `npx wxt build --mode development` 로 dev 산출물 재생성.
- 두 산출물의 `manifest.key` 에서 확장 ID 를 직접 유도해 일치를 확인했다 —
  dev·build 모두 `aghgamoeifieijjckhpfkmhiibacnhml`. `oauth2.client_id` 주입과
  `identity` 권한도 양쪽 모두 확인.
- 점검 과정에서 실행한 기존 테스트: backend `test_auth.py`+`test_auth_boundary.py` **79 passed**,
  extension `pnpm test` **105 passed (13 files)**.
- **런타임 점검(8010 포트에 현재 코드로 별도 기동).** 인증 경계 4종(`/sessions`,
  `/events/pending-count`, `/recommendations`, `/analytics/overview`) 토큰 없이 401,
  위조 bearer 401, `/auth/google` 에 가짜 토큰 → 실제 구글 `tokeninfo` 왕복 후 401
  "유효하지 않은 access token입니다". `/auth/*` 3개와 `/recommendations` 노출 확인.
- **8000 포트에 인증 이전 버전 서버가 떠 있었다.** `/auth/google` 404, `/sessions` 가 토큰
  없이 **200**. 프로세스는 당일 21:41 기동(`python -m uvicorn app.main:app --port 8000`)인데
  적재된 코드에 인증이 없다. 확장이 붙는 대상이 이 서버라 **재시작 전에는 로그인이 불가능**하다.
  사용자 프로세스라 종료하지 않고 별도 포트로 검증했다.
- **P0 실증.** `.env.example` 39행의 안내 문구만으로 서명 키를 추측해 만료 10년짜리 토큰을
  만들었더니 `/auth/me` 가 "계정을 찾을 수 없습니다"(= **서명 검증 통과**)로 응답했다.
  대조군(무관한 키)은 "유효하지 않은 토큰입니다"로 차단됐다. 현재 유일한 방어는 해당 UUID 의
  계정이 DB 에 없다는 것뿐이며, 한 번 로그인해 자기 `user_id` 를 알면 무기한 토큰을 자가 발급할 수 있다.
- **DB 상태.** `users` 0행, `recommendation_cache` 생성됨. `user_id='local'` 레거시 데이터는
  sessions 25 / events 199 / sync_batches 30 — `claim_legacy_data` 규칙상 **가장 먼저 가입한
  계정 한 명**이 전부 가져간다. 팀 테스트 시 로그인 순서에 주의해야 한다.
- **미실행:** 실제 브라우저 로그인 플로우. `chrome.identity` 는 확장 컨텍스트에서 크롬 프로필
  계정으로 동작해 에이전트가 대신 수행할 수 없다. 아래 남은 일이 선행되어야 한다.

### 점검 중 발견한 미해결 문제

- **(P0) `backend/.env` 의 `JWT_SECRET` 이 `.env.example` 의 안내 명령 문자열 리터럴**
  (`$(python -c "...")`). `.env` 는 셸이 아니라 명령 치환이 일어나지 않는다. 로드해서 확인함
  (길이 63, `$(` 로 시작). 서명 키가 공개 문서의 값이라 임의 `sub` 로 토큰 위조가 가능하다.
  교체 시 전원 재로그인이 필요해 사용자 승인 대기 중.
- **(P1) 비로그인 상태 수집분의 소유권.** `collector.ts` 는 `collectionEnabled` 만 보고 로그인
  여부를 확인하지 않으며 `signOut()` 은 큐를 비우지 않는다. 계정 A 로그아웃 중 쌓인 이벤트가
  계정 B 로그인 시 B 에게 전송된다. 팀 다중 계정 테스트에서 드러나기 쉬운 경로다.
- **(P3) `config.py:35`** 주석의 "부팅 시 경고"가 실제로는 없다. 설정 누락이 조용히 넘어간다.

### 후속 조치 — JWT_SECRET 교체와 서버 재시작 (같은 날)

- `backend/.env` 의 `JWT_SECRET` 을 `secrets.token_urlsafe(48)` 난수로 교체(63자 리터럴 → 64자).
  `.env` 에 LLM API 키가 함께 있어 파일 전체를 읽지 않고 해당 줄만 정규식 치환했고,
  교체 전 백업 생성 + 나머지 45줄 동일성 검증을 스크립트가 수행했다.
  백업(`backend/.env.env.bak-*`)은 `.gitignore` 의 `.env.*` 규칙으로 무시된다.
- 8000 포트의 낡은 프로세스를 종료하고 현재 코드로 재기동했다.
- 재기동 후 검증:
  - `/auth/google`·`/auth/logout`·`/auth/me` + `/recommendations` 노출 확인(총 27 paths).
  - 인증 경계 4종 토큰 없이 **401**, 위조 bearer **401**.
  - **이전에 서명 검증을 통과했던 위조 토큰이 이제 "유효하지 않은 토큰입니다"로 차단**됨.
    P0 해소를 회귀로 확인한 셈이다.

### 남은 일

- Google Cloud Console 에서 OAuth 클라이언트의 항목 ID 를 `aghgamoeifieijjckhpfkmhiibacnhml`
  로 맞추고, 팀원 구글 계정을 테스트 사용자에 등록.
- 확장 재설치(크롬에서 기존 Orbit 제거 후 `.output/chrome-mv3` 재로드). `key` 추가로 확장 ID 가
  바뀌므로 기존 설치본의 `chrome.storage.local`(로그인 세션·설정)과 IndexedDB 큐는 승계되지 않는다.
- 팀원이 다른 머신에서 테스트할 때의 백엔드 접속 방식(각자 로컬 / 공유 서버) 미결정.
  공유 서버로 갈 경우 `host_permissions` 와 `VITE_API_BASE_URL` 갱신, `JWT_SECRET` 공유 정책이
  함께 필요하다.

## 2026-08-07 — PR #11 최신 main 인증 변경 통합

- PR 생성 직후 원격 `main`의 Google 로그인·사용자별 데이터 격리·추천 세션 변경과 충돌한 것을 확인했다.
- Ask 의도별 검색 개수와 페이지 의미 랭킹을 유지하면서 세션 검색·컨텍스트 로딩에 요청 사용자 ID를 전달하도록 계약을 결합했다.
- `/assistant/route`, `/tab-actions/resolve`, `/ask/stream`과 extension 스트리밍 호출을 인증 경계 안에 두고 `identity`·`bookmarks` 권한을 모두 보존했다.
- 첫 backend 실행은 최신 의존성 `PyJWT`가 로컬 환경에 없어 수집 단계에서 실패했고 `python -m pip install -e .`로 프로젝트 의존성을 갱신한 뒤 재실행했다.
- 통합 후 backend **461 passed**, extension **105 passed (13 files)**, TypeScript 검사와 Chrome MV3 빌드 통과(829.79 kB).

## 2026-08-07 — Ask AI 입력 포커스와 최신 답변 자동 스크롤

- 질문 전송 버튼이 스트리밍 중단 버튼으로 교체될 때 입력 포커스가 사라지는 문제를 입력 ref와 `preventScroll` 포커스 복원으로 수정했다.
- 새 탭 대시보드는 최신 대화 하단 marker로, 사이드패널은 내부 스크롤 영역의 `scrollHeight`로 새 질문과 스트리밍 답변을 따라가도록 했다.
- 포커스 복원이 대시보드의 문서 스크롤을 입력창으로 되돌리지 않도록 스크롤과 포커스를 분리했다.
- extension 전체 테스트 **87 passed**, TypeScript 검사와 Chrome MV3 프로덕션 빌드 통과(810.72 kB).

## 2026-08-07 — Ask AI 복수 탭 후보 선택

- 두 개 이상의 로컬 정확 일치는 자동 이동을 중단하고 최대 3개 후보로 변환했다.
- backend 탭 resolver는 절대 점수를 통과하고 상위 후보가 근접한 경우에만 후보 ID·점수를 반환한다.
- Ask turn에 후보 탭과 선택 오류 상태를 추가하고 새 탭·사이드패널에 제목·호스트/경로 버튼을 표시한다.
- 클릭 시 전체 열린 탭을 다시 조회해 ID를 검증하고 원래 창을 포커스한 뒤 탭을 활성화한다.
- 실제 API: 두 YouTube + GitHub 후보에서 `ask/low_confidence`, 후보 ID `43,42` 2개.
- backend 관련 테스트 11개, extension 관련 테스트 18개와 TypeScript 검사 통과.
- backend를 PID 18064로 재기동하고 `GET /health` HTTP 200 확인.
- 전체 회귀: backend **328 passed**, extension **87 passed (10 files)**.
- Chrome MV3 프로덕션 빌드 통과(810.04 kB).

## 2026-08-07 — Ask AI 통합 의도 라우팅과 질문 기반 페이지 검색

### 요청과 결정

- 사용자가 Ask AI의 세션 검색·세션 내부 내용 검색·열린 탭 이동 의도를 더 정확히 구분하고
  실제 데이터로 검증해 달라고 요청했다.
- 결과 형태 규칙과 비대칭 임베딩을 결합하고 탭 이동은 기존 후보 resolver까지 이중 검증한다.

### 구현

- `POST /assistant/route`와 네 의도 계약을 추가했다.
- extension 공용 Ask 훅을 로컬 정확 탭 매칭 → 통합 라우터 → 탭 resolver 또는 의도별 Ask stream
  흐름으로 변경했다. 라우터 장애 시 특정 세션 컨텍스트가 있으면 `search_session`, 아니면
  `search_memory`로 fallback한다.
- `POST /ask/stream`에 retrieval intent를 추가했다. 세션 찾기는 최대 5개를 반환하고 답변 생성을
  생략하며, 특정 세션 검색은 1개, 전체 기록 검색은 최대 3개를 사용한다.
- 내용 질문마다 세션별 이벤트 후보 12개를 query/passage batch 임베딩하고 상위 4개를 답변 근거로
  사용한다. URL query·fragment는 passage에서 제외하고 임베딩 장애 시 기존 relevance 랭킹을 쓴다.
- 통합 의도 골든셋과 현재 DB 이벤트를 읽기 전용으로 평가하는 하네스를 추가했다.

### 실제 평가와 검증

- 실제 Upstage 의도 평가: **42/42**, 탭 이동 오탐 **0건**.
- 현재 DB 이벤트 20개 probe: **hit@1 17/20**, **hit@3 20/20**.
- 실제 HTTP 네 의도 route가 모두 기대 intent를 반환했다.
- 실제 저장 세션 기반 Ask SSE: HTTP 200, sources 1, delta 33, done 1, error 0, 완료 모델 확인.
- backend 전체: **327 passed**.
- extension 전체: **86 passed (10 files)**.
- TypeScript 검사와 Chrome MV3 빌드 통과(804.9 kB).
- backend를 최신 코드로 PID 14592에서 재기동하고 `GET /health` HTTP 200 확인.
- 미실시: 변경된 확장을 Chrome에서 다시 로드한 뒤 사용자의 실제 열린 탭을 활성화하는 시각 스모크.

## 2026-08-07 — 자연어 열린 탭 의미 resolver

### 요청과 결정

- 사용자가 고정된 `탭으로 이동` 문장과 문자열 매칭 품질을 지적하고 임베딩 유사도 검색 및
  실제 데이터 테스트를 요청했다.
- 로컬 정확 매칭은 빠른 경로로 유지하고, 간접 조작 표현만 backend 의미 resolver에 보낸다.

### 구현

- `POST /tab-actions/resolve` 스키마·서비스·API를 추가했다.
- 이동/질문/새 검색 prototype과 탭 제목·호스트·path·사이트 용도를 query/passage 임베딩으로
  비교하고 intent/match의 score와 margin을 모두 적용한다.
- URL query·fragment를 제외하고 후보·벡터를 저장하거나 원문 로그에 남기지 않는다.
- extension에 광범위한 이동 가능성 판별, 8초 resolver timeout, 응답 탭 ID 재검증,
  낮은 신뢰도·비이동·resolver 장애 fallback을 추가했다.
- `민감 도메인 제외` 기본 설정이 켜져 있으면 민감 URL을 의미 resolver 후보에서 제거한다.
  정확한 탭 이름은 외부 전송 없이 기존 로컬 매칭으로 계속 이동할 수 있다.
- 실제 골든셋과 평가 실행기를 추가했다.

### 실제 API 평가와 오류

- 최초 inline 평가가 PowerShell stdin의 한글을 `?`로 바꾸고 `nav_youtube` 같은 case ID로
  정답을 누출한 것을 발견해 결과를 폐기했다.
- UTF-8과 숫자 ID로 수정한 실제 Upstage 평가: 이동 **10/11**, 안전 차단 **10/10**, 전체 **20/21**.
- 최초 sweep 구현은 625개 설정마다 4096차원 코사인을 재계산해 120초 timeout이 났다.
  점수를 한 번만 계산하고 임계값만 비교하도록 고쳐 약 3초에 완료했다.
- 업데이트된 backend를 PID 13224로 재기동했다.
- 실제 HTTP smoke: `navigate_tab`, YouTube 후보 ID 42, score 0.397971, margin 0.212456.

### 최종 검증

- `python -m pytest -p no:asyncio`: **308 passed**.
- `pnpm.cmd test`: **85 passed (10 files)**.
- `pnpm.cmd compile`: 통과.
- `pnpm.cmd build`: 통과(WXT chrome-mv3, 804.58 kB).
- `python -m eval.run_tab_action_eval`: 실제 Upstage API로 **20/21** 재현.
- 실행 중 backend `GET /health`: HTTP 200.
- 미실시: 변경된 Chrome 확장 재로드 후 실제 사용자의 열린 탭을 대상으로 한 시각 스모크.

## 2026-08-07 — 자연어 탭 이동 한글 서비스명 매칭 수정

### 재현과 원인

- “지금 열려있는 유튜브 탭으로 이동해줘”에서 검색 대상이 `지금 열려있는 유튜브`로 남았다.
- “유튜브 탭으로 이동해”에서는 추출 대상은 맞았지만 실제 Chrome 탭의 `YouTube` 제목과
  `youtube.com` 주소를 한글 `유튜브`와 단순 substring으로 비교해 결과가 없었다.

### 수정

- 탭 이름 앞의 `지금`, `현재`, `열려있는`, `떠 있는`, `열린` 수식어를 제거한다.
- 유튜브·깃허브·노션 등 일반적인 한글 서비스명을 영문 제목과 공식 호스트 별칭으로 확장해
  기존 관련도 점수 안에서 비교한다. 사용자에게 보여주는 검색 대상 문구는 원래 한글을 유지한다.
- 스크린샷의 두 입력 형태와 `YouTube` 실제 제목·URL 조합을 회귀 테스트에 추가했다.

### 검증

- 수정 전 관련 테스트 9개 중 2개 실패로 재현했다.
- 수정 후 관련 테스트 14개 통과.
- 전체 테스트 **83개**, TypeScript 검사, Chrome MV3 빌드(802.49 kB) 통과.

## 2026-08-07 — 자연어 열린 탭 이동 + 접이식 선택 북마크

### 요청과 결정

- Ask AI PR #8을 squash merge하고 원격/로컬 기능 브랜치를 정리한 뒤
  `feat/tab-actions`에서 새 작업을 시작했다.
- 전체 일반 창의 열린 탭을 검색하고 원래 창으로 이동하는 기능을 extension 로컬로 구현한다.
- 사용자가 체크한 열린 탭만 Chrome 기본 ‘기타 북마크’에 추가한다.
- 공식 Chrome 문서에 따라 `bookmarks` 권한과 설치 경고를 명시한다.
- 후속 요청에 따라 수동 열린 탭 도구는 세션 화면에서 기본 접힘으로 바꾸고, Ask AI의
  명시적인 자연어 탭 이동 명령을 핵심 진입점으로 추가한다.

### 변경

- `OpenTabItem`과 제목·URL 필터, bookmark 가능 URL 판정, 선택 내 중복 제거 로직을 추가했다.
- Chrome bridge에 전체 일반 창 탭 조회, 창 포커스+탭 활성화, 기존 북마크 확인 후 생성 기능을 추가했다.
- 탭 생성·삭제·URL/제목 변경뿐 아니라 활성 탭·포커스 창 변경 시에도 현재 창/전체 창 Query를
  함께 무효화하도록 참조 카운트 기반 구독을 공유했다.
- 세션 화면에 검색, 창 번호·활성 상태, 이동, 개별/검색 결과 전체 선택,
  선택 북마크 추가 UI를 추가하고 제목 버튼으로 펼칠 때만 마운트되도록 변경했다.
- 공용 Ask AI 훅에서 `탭 + 이동/전환/열기/띄우기` 문장을 로컬 의도로 판별한다.
  일반 질문은 기존 스트리밍 API로 보내고, 로컬 명령은 전체 탭의 제목·호스트·URL 관련도를
  계산해 최적 결과를 활성화한 뒤 결과를 대화 목록에 누적한다.
- 대상 누락, 검색 결과 없음, 실행 중 탭 닫힘을 구분하고, 일반적인 “탭 목록을 보여줘” 같은
  질문은 이동 명령으로 오인하지 않도록 범위를 제한했다.
- manifest에 `bookmarks` 권한을 추가하고 README·IA·결정·조사 문서를 갱신했다.
- `tab-actions.test.ts`에서 검색, URL 허용 범위, 선택 중복, 탭 정렬, 이동 호출 순서,
  기존 북마크 중복 처리를 검증한다.

### 검증

- 관련 테스트 13개 통과.
- `pnpm.cmd test`: **83 passed (10 files)**.
- `pnpm.cmd compile`: 통과.
- `pnpm.cmd build`: 통과(WXT chrome-mv3, 802.49 kB).
- 빌드 manifest 권한에 `bookmarks`가 포함된 것을 확인했다.
- `git diff --check`: 통과.
- 미실시: Chrome 재로드 후 실제 자연어 다중 창 탭 이동과 ‘기타 북마크’ 생성 시각 스모크.

## 2026-08-07 — Ask AI 스트리밍 RAG + 독립 질문 누적

### 요청과 결정

- 기존 Ask AI의 구현 수준을 확인한 뒤 실제 스트리밍 답변과 관련 세션 출처를 추가했다.
- 사용자 후속 결정에 따라 각 질문은 이전 질문·답변을 참조하지 않는 독립 단일턴으로 처리한다.
  질문·답변 목록은 `새 대화 시작하기` 전까지 계속 누적하고 화면 전환에도 유지한다.
- 새 탭과 사이드패널 모두 같은 답변 계약을 사용한다.

### 변경

- `POST /ask/stream` SSE API를 추가했다. 관련 세션 최대 3개를 먼저 보내고 답변 delta와
  완료 모델 또는 구조화된 오류를 순서대로 보낸다.
- 기존 Qdrant 세션 검색과 선택적 리랭킹을 재사용하고, 세션 요약과 세션별 상위 이벤트
  `content_excerpt` 최대 4개로 RAG 컨텍스트를 구성했다. 미할당 이벤트는 제외했다.
- 페이지 본문의 지시를 무시하는 프롬프트와 전체/개별 본문 길이 제한을 적용했다.
- A.X-K1 스트리밍과 첫 토큰 전 EXAONE 폴백을 추가했다. 첫 토큰 이후 장애는 부분 오류로 처리한다.
- extension 공용 SSE 파서와 Zustand 기반 문서 수명 대화 상태를 추가했다. 화면 전환 시
  컴포넌트가 언마운트돼도 누적 목록과 진행 중 스트림이 유지되며, 취소, 재시도,
  새 대화 시작, 비정상 종료, 부분 답변 상태를 처리한다.
- extension 단위 테스트로 요청 본문에 과거 대화가 없고, 컴포넌트 밖 공용 상태에 답변이
  남으며 `새 대화 시작하기`에서만 비워지는 회귀 경로를 고정했다.
- 사이드패널 검색 결과 화면을 대화 UI로 전환하고 관련 세션 카드를 상세 화면에 연결했다.
- 새 탭 AI 모드에 답변 패널과 번호가 붙은 관련 세션 카드를 추가하고 Atlas로 연결했다.
- 새 탭 검색/AI 모드를 상위 상태로 올려, AI 모드에서만 누적 대화를 렌더링한다. 검색 모드는
  기존 홈 콘텐츠를 표시하고 AI로 돌아오면 공용 상태에 남은 대화를 다시 보여준다.

### 오류와 해결

- 새 탭 출처는 API `Session`이고 홈 카드는 Atlas `SessionNode`라 직접 재사용 시 타입 오류가 났다.
  출처 클릭은 세션 ID로 네비게이션 상태를 갱신하도록 분리했다.
- `TabItem`에는 `domain`이 없어 출처 보조 문구를 실제 탭 제목 목록으로 변경했다.
- PowerShell에서는 `pnpm.ps1` 대신 `pnpm.cmd`로 공식 검증을 실행했다.

### 검증

- `python -m pytest -p no:asyncio`: **298 passed**.
- `pnpm.cmd test`: **73 passed (9 files)**.
- `pnpm.cmd compile`: 통과.
- `pnpm.cmd build`: 통과(WXT chrome-mv3, 788.99 kB).
- 현재 브랜치로 백엔드를 PID 6596에서 재시작하고 `GET /health`: 200 확인.
- OpenAPI의 Ask 요청 필드가 `query,session_id,rerank`만 포함하고 history가 없음을 확인했다.
- 실 세션 지정 요청으로 `POST /ask/stream`: 200,
  `sources → delta* → done`, 관련 세션 포함을 확인했다.
- 미실시: Chrome 확장 재로드 후 실제 화면 레이아웃·취소 버튼의 브라우저 시각 스모크.

## 2026-08-07 — newtab 목업 제거 + Session/Page 백엔드 연결

### 요청과 결정

- 새 탭 대시보드가 계속 mock 데이터로 보이는 문제를 확인했다.
- 백엔드에는 Orbit 관계가 없고 Session/Event만 있으므로 가상 그룹을 만들지 않기로 했다.
- 사용자 결정에 따라 Session 이름을 Atlas 중심 원에 표시하고, 해당 페이지 이벤트를
  `sequence_order` 순서대로 한 궤도에 배치하는 2단계 IA를 적용했다.

### 변경

- `components/atlas/data.ts` — 578줄 정적 `ATLAS_ORBITS`를 제거하고 Session/Event →
  Atlas 뷰 모델 변환을 추가했다. 이벤트가 없는 snapshot 세션은 tabs로 보완한다.
- `hooks/useAtlasData.ts` — `/sessions`와 세션별 `/events`를 조회한다. 이벤트 요청은 최대
  6개씩 처리하고 React Query 캐시를 사용한다.
- `main.tsx` — newtab에 `QueryClientProvider`를 연결했다.
- 홈 카드·타임라인·드로어와 Atlas 네비게이터·캔버스·트레이·상세 패널을 실제 데이터로 전환했다.
  loading, error/retry, empty, 페이지 없는 세션 상태를 처리했다.
- Atlas 네비게이터를 Session → Page 2단계로 단순화하고 중심 원은 세션명, 궤도 노드는
  시간순 페이지 이벤트로 변경했다.
- AI 질문 모드는 `/search?scope=memory&rerank=true` 결과의 실제 세션으로 이동한다.
- `lib/types.ts` Session에 선택적 `lastActivityAt`을 추가해 실제 마지막 활동 기준으로 정렬한다.
- `tests/unit/atlas-data.test.ts` — 시간 순서, 재방문 수, tabs fallback, 최신순/상태,
  빈 페이지 helper를 검증한다.
- 후속 개선: 한 궤도당 페이지를 최대 8개로 제한하고, 초과분은 방문 순서를 유지한 채
  바깥쪽 동심 궤도에 배치했다. 0개·8개·17개와 잘못된 제한값 경계를 테스트했다.

### 오류와 해결

- PowerShell 실행 정책이 `pnpm.ps1`을 차단해 공식 명령의 실행 파일을 `pnpm.cmd`로 바꿨다.
- 첫 설계는 백엔드에 없는 단일 가상 Orbit 아래 모든 세션을 넣으려 했으나, 사용자 피드백에 따라
  Session 자체를 중심 노드로 사용하는 2단계 구조로 계획과 구현을 수정했다.
- 최종 전체 테스트 첫 실행에서 기존 sync engine 테스트 1개가 서버 sync mock을 보지 못해 실패했다.
  해당 파일 단독 재실행은 7개 모두 통과했고, 전체 테스트 재실행도 67개 모두 통과해 간헐 실패로 기록했다.

### 검증

- `pnpm.cmd test`: **69 passed (8 files)**.
- `pnpm.cmd compile`: 통과.
- `pnpm.cmd build`: 통과(WXT chrome-mv3, 778.1 kB).
- 로컬 백엔드 `GET /health`: 200, `GET /sessions`: 실제 세션 14개,
  첫 세션 `GET /sessions/{id}/events`: 실제 이벤트 1개 응답 확인.
- 미실시: Chrome에 빌드를 다시 로드한 뒤 실제 새 탭 렌더링을 눈으로 확인하는 브라우저 스모크.

## 2026-08-07 — merge UI 사이드패널 포팅 + 독립 웹 frontend 제거

### 요청과 결정

- `main`에 병합 기능이 추가됐지만 extension의 업데이트된 UI에는 없다는 문제를 확인.
- 실제 서버 연결 UI는 extension 사이드패널이고 newtab 홈·아틀라스는 목업 데이터 기반임을 조사했다.
- 사용자 승인에 따라 병합 기능을 사이드패널로 옮기고 `frontend/`를 제거했다.
- 웹 전용 상세 Analytics(반복 방문·반복 검색·일별 추이)는 종료하고 사이드패널 최소 요약은 유지했다.

### 변경

- `extension/lib/types.ts`·`lib/api.ts` — 병합 제안·실행·되돌리기와 서버 자동병합 설정 계약/매퍼/API 추가.
- `extension/lib/merge.ts` — 일괄병합에서 이미 성공한 병합과 겹치는 세션 쌍을 거르는 순수 로직 추가.
- `entrypoints/sidepanel/hooks/useMergeSuggestions.ts`·`useServerSettings.ts` — Query/Mutation과 관련 캐시 무효화 추가.
- `components/MergeSuggestionsSection.tsx` — 세션 목록에 개별/일괄 병합, 확인창, 유사도·키워드 근거,
  개별/일괄 되돌리기 액션 추가. 로딩·오류·제안 없음은 기존 목록을 방해하지 않도록 숨김.
- `SettingsView.tsx` — "세션 관리" 영역에 서버 저장 자동병합 opt-in 토글 추가. 로딩·오류·저장 중 상태 처리.
- `store/ui.ts`·`components/Toast.tsx` — 액션 토스트, 6초 유지, 명시적 닫기, 연속 토스트 타이머 정리와 클릭 가능 UI 추가.
- `tests/unit/merge.test.ts`·`ui-store.test.ts` — API wire 계약, 중복 세션 가드, 토스트 유지/타이머 교체 테스트 추가.
- 추적 중인 `frontend/` 소스·설정·lockfile 제거. ignored 로컬 `.env`·`node_modules`·`dist`는 보존.
- `dev.sh`·`dev_conda.sh`에서 frontend 의존성 검사·Vite 실행·안내 제거.
- 현재 제품 구조와 병합 정책을 설명하는 README, AGENTS, IA, 프로젝트/아키텍처/API/데이터/프로세스 문서 갱신.

### 오류와 해결

- PowerShell 실행 정책이 `pnpm.ps1`을 차단해 첫 기준선 명령이 실행되지 않았다. Windows용 `pnpm.cmd`로 재실행했다.
- 스크립트 수정 후 Windows 체크아웃 줄바꿈이 mixed/CRLF가 되어 `bash -n`이 실패했다. `dev.sh`와
  `dev_conda.sh`를 LF로 정규화한 뒤 구문 검사를 통과했다.

### 검증

- 변경 전 extension: `pnpm.cmd test` 57 passed, `pnpm.cmd compile` 통과, `pnpm.cmd build` 통과.
- 변경 전 frontend: `pnpm.cmd build` 통과(1851 modules transformed).
- 변경 후 extension: `pnpm.cmd test` **63 passed (7 files)**, `pnpm.cmd compile` 통과,
  `pnpm.cmd build` 통과(WXT chrome-mv3, 794.02 kB).
- `bash -n dev.sh dev_conda.sh` 통과.
- `git diff --check` 통과.
- 미실시: 백엔드 코드는 변경하지 않아 pytest 미실행. 실 브라우저 렌더 스모크와 실제 병합 클릭은
  실행 환경 및 사용자 데이터 변경이 필요해 수행하지 않음.

## 2026-08-07 — 자동병합 사용자 토글(UI 버튼) + 설정 저장소 (feat/merge-suggestions 이어서)

### 요청

"자동병합은 버튼을 만들어 사용자가 선택할 수 있게". env 플래그가 아니라 런타임 UI 토글 필요.

### 변경 (backend — 앱 설정 저장소)

- `app/db/models.py` — `AppSetting`(key-value, JSONB) 신규 테이블. create_all이 생성(마이그레이션 불필요).
- `app/services/app_settings.py`(신규) — `get_bool`/`set_bool` + `is_auto_merge_enabled()`(DB 값 우선, 없으면 env 기본값).
- `app/schemas/settings.py`·`app/api/settings.py`(신규) — `GET /settings`·`PATCH /settings`(auto_merge_enabled 토글).
- `app/main.py` — settings 라우터 등록.
- `app/services/sync_pipeline.py` — 자동병합 게이트를 `settings.auto_merge_enabled`(env 고정) → `await is_auto_merge_enabled()`(런타임 DB 값)로 교체.
- `tests/test_sync_pipeline.py` — `_process_batch` 테스트 2곳에 신규 협력자 `is_auto_merge_enabled` 대역 추가(실 DB 접근 방지).
- `tests/test_app_settings.py`(신규) — get/set bool 6종(기본값·저장값·비-bool 폴백·insert/update).

### 변경 (frontend — 토글 UI)

- `lib/types.ts`·`lib/api.ts` — `AppSettings{autoMergeEnabled}` + `fetchSettings`/`updateSettings`.
- `hooks/useSettings.ts`(신규) — 설정 조회 + 갱신(성공 시 캐시 즉시 setQueryData).
- `components/merge/MergeSuggestionsSection.tsx` — 헤더에 `AutoMergeToggle` 스위치. 켜짐 안내 문구.
  섹션 노출 규칙 변경: 설정 로드 성공 시 노출, 단 "자동병합 OFF + 제안 0"이면 숨김(자동병합 ON이면 끌 수 있게 항상 노출).

### 검증

- **backend**: `pytest -p no:asyncio` **291 passed**. 라우트 `GET/PATCH /settings` 등록 확인.
- **frontend**: `pnpm build`(tsc 포함) 1851 모듈, 타입 에러 0.
- **라이브 브라우저 토글 스모크**: 대시보드에서 토글 클릭 → `GET /settings` `true` + 스위치 [checked] + 안내 문구 노출 →
  다시 클릭 → `false` 복구. 서버 왕복 완전 동작 확인. **자동병합은 OFF 기본값으로 원복하고 종료**(세션 데이터 무변경).

### 남은 일 / TODO

- 자동병합은 이제 UI 토글로 사용자가 켜고 끌 수 있음(기본 OFF). 켜면 다음 동기화 배치에서 명백한 중복만 자동 병합.
- (선택) 임계값(cos 0.80/제목 자카드 0.80)도 UI 노출할지 여부.

## 2026-08-07 — 일괄병합 + gated 자동병합(기본 OFF) (feat/merge-suggestions 이어서)

### 요청

"P4 계속 진행·검증 + 병합 화면에 일괄병합 추가 + 자동병합 제안·위험 고려".

### 판단 (일괄병합 ≠ 자동병합)

- **일괄병합**(사람이 한 번 확인, 가역) → human-in-loop이라 안전 → 구현.
- **자동병합**(배치 후 시스템 실행) → 문서화된 "자동 파괴 금지"(merge-design §2, AGENTS §11)와 충돌 →
  임의로 켜지 않고 **opt-in·기본 OFF·고임계 '명백한 중복'만·로그·가역** 메커니즘만 구현. 사용자 결정 대기.

### 변경 (frontend — 일괄병합)

- `frontend/src/components/merge/MergeSuggestionsSection.tsx` — "모두 병합" 버튼 추가. 순차 병합하되
  한 배치에서 이미 소비된 세션이 다시 등장하면 건너뛰고(stale 충돌 방지), 성공분은 "모두 되돌리기" 토스트로 일괄 undo.

### 변경 (backend — gated 자동병합, 기본 OFF)

- `app/config.py` — `auto_merge_enabled=False`(기본), `auto_merge_floor=0.80`, `auto_merge_title_jaccard=0.80`.
- `app/services/merge_service.py` — `_title_jaccard`, `is_auto_merge_candidate`(순수: cos≥floor AND 제목 자카드≥임계),
  `auto_merge_duplicates(db)`(제안 중 명백한 중복만 병합, 소비 세션 스킵, (survivor,absorbed) 목록 반환).
- `app/services/sync_pipeline.py` — 배치 재요약 뒤 `if settings.auto_merge_enabled: _run_auto_merge()`(기본 OFF라
  평소 비용 0). 병합 생존 세션 재요약 + 흡수 세션 Qdrant 포인트 삭제. 실패해도 배치는 성공 마무리.
- `tests/test_merge_service.py` — 자동병합 후보 판정 5종(제목 자카드·floor·제목상이 거부).

### 검증

- **backend**: `pytest -p no:asyncio` **286 passed**(자동병합 5종 추가). import 순환 없음(sync_pipeline↔merge_service).
- **frontend**: `pnpm build`(tsc 포함) 1850 모듈, 타입 에러 0.
- **자동병합 게이트 실데이터 프리뷰(읽기 전용, 실행 안 함)**: 실 제안 5쌍에 게이트 적용 시 가비아 중복
  (cos 0.847·제목 자카드 1.00)만 AUTO, 나머지(제주항공권·이터널리턴·낭만인프라)는 제목 상이(자카드 0.17~0.60)로 전부 skip.
- **미실시**: 실 브라우저 렌더 스모크 — 실 DB에 두 번째 백엔드를 붙이면 기동 복구 로직이 사용자 실데이터를
  변경할 수 있어 데이터 보호상 보류(격리 시드 환경에서 별도 확인 제안).

### 남은 일 / TODO

- 자동병합 **켤지 여부는 사용자 결정 대기**(현재 OFF). 켜려면 env `AUTO_MERGE_ENABLED=true`.
- (선택) 격리 시드 환경 실 브라우저 E2E 스모크, 배치 후 제안 뱃지, 익스텐션 사이드패널.

## 2026-08-07 — 세션 병합 P4 대시보드 UI + 실데이터 재튜닝 (feat/merge-suggestions 이어서)

### 요청

"P4 진행 + 도그푸딩 실데이터로 한번 더 튜닝".

### 실데이터 재튜닝 (읽기 전용)

- 도그푸딩 실 DB(18세션)+Qdrant 벡터로 153쌍 코사인 + 키워드 게이트를 읽기 전용 측정.
- 실 세션 요약은 골든보다 코사인이 낮게 분포 → 골든값 0.56이면 정답(낭만인프라↔인프라모니터링 0.533,
  이터널리턴강의↔나어나이 0.544)을 놓침. 분리 구간 [0.44, 0.533] 사이 **0.52** 확정.
- 실 orchestrator `find_merge_suggestions`로 최종 확인: floor 0.52에서 제안 5쌍 전부 진짜 과분할
  (가비아 중복·제주항공권 9+3·이터널리턴 2건·낭만인프라). `app/config.py` merge_suggest_floor=0.52.

### P4 — 대시보드 병합 제안 UI (frontend)

백엔드 변경 없음(기존 `GET /merge-suggestions` + `POST /merge`·`/unmerge`를 대시보드가 온디맨드 소비).

- `frontend/src/lib/types.ts` — `MergeSuggestion` 타입.
- `frontend/src/lib/api.ts` — `fetchMergeSuggestions`/`mergeSessions`/`unmergeSessions` + snake→camel 매핑.
- `frontend/src/hooks/useMergeSuggestions.ts`(신규) — react-query 훅(제안 조회 + merge/unmerge mutation,
  성공 시 sessions·merge-suggestions·관련 session 캐시 무효화).
- `frontend/src/store/ui.ts`·`components/Toast.tsx` — 토스트에 선택적 액션(되돌리기) 지원(액션 시 6초 표시).
- `frontend/src/components/merge/MergeSuggestionsSection.tsx`(신규) — 제안 쌍 카드 목록 + 병합 버튼.
  로딩/에러/제안 없음이면 조용히 숨김(AnalyticsSection 방어 패턴). 병합은 confirm() 확인 후 실행,
  성공 시 "되돌리기" 액션 토스트로 unmerge 노출.
- `frontend/src/views/HomeView.tsx` — 세션 목록과 탐색 분석 사이에 `<MergeSuggestionsSection/>` 삽입.

### 검증

- **frontend**: `pnpm build`(tsc --noEmit 포함) — 1850 모듈 변환, 타입 에러 0, 빌드 성공.
- **실 백엔드 경로(읽기 전용)**: additive 마이그레이션(merged_into·merged_from_session_id 컬럼 추가, 멱등·데이터
  미변경) 적용 후 `find_merge_suggestions` 실행 → 실데이터 5쌍 정상 반환(Qdrant get_vector +
  search_similar_with_scores@0.52 + evaluate_pair 전 경로).
- **backend**: `pytest -p no:asyncio` 281 통과 유지.
- 미실시: 실 브라우저 렌더 스모크(양 서버 기동 필요). 실 세션 병합 클릭은 사용자 데이터 보호를 위해 하지 않음.

### 남은 일 / TODO

- (선택) 실 브라우저 E2E 스모크 — 대시보드에서 병합 제안 섹션 렌더/병합/되돌리기 흐름 육안 확인.
- (선택) 배치 후 제안 자동 생성 + 뱃지, 익스텐션 사이드패널 노출은 미구현(대시보드 우선 결정에 따라 보류).
- 실 DB에 additive 컬럼이 적용됨 — main 체크아웃 시에도 무해(미사용 nullable).

## 2026-08-07 — 세션 병합 P2 실행 + P3 undo + floor 튜닝 (feat/merge-suggestions 이어서)

### 요청

"이 브랜치에서 전체 구현 + 테스트 + 튜닝까지". P0+P1에 이어 P2(병합 실행)·P3(undo) 구현 + `merge_suggest_floor` 실측 튜닝.

### 변경

- `app/db/models.py` — `SessionEvent.merged_from_session_id VARCHAR(36) NULL`(undo 복원 기준).
- `app/db/migrations.py` — 러너를 `{table: [(col, ddl)]}` 다중 테이블로 일반화(멱등 유지), session_events 컬럼 추가.
- `app/services/merge_service.py`(신규) — `merge_sessions`/`unmerge_sessions` + 게이트웨이(`_fetch_events_ordered`,
  `_move_event`, `_delete_event`, `_recompute_session_stats`) + 순수 `_union_keywords`. `MergeError(code)`→HTTP 매핑.
- `app/schemas/session.py` — `MergeRequest{absorbed_id}`.
- `app/api/sessions.py` — `POST /sessions/{id}/merge`·`/unmerge`(동기 DB + 백그라운드 재요약/재임베딩),
  `list_sessions`에 `status!='merged'` 필터.
- `app/services/sync_pipeline.py` — `_fetch_candidates` 최종 조회에 `status=='active'` 이중 방어(Qdrant 삭제 실패 대비).
- `app/config.py` — `merge_suggest_floor` 0.6 → 0.56(골든) → **0.52**(실데이터 튜닝 최종).
- `tests/test_merge_service.py`(신규) — merge/unmerge 검증 분기·정상 경로·`_union_keywords` 10종.
- `eval/merge_golden.json`·`eval/tune_merge_floor.py`(신규) — 병합 탐지 골든셋 + 실 임베딩 floor 튜닝 하네스.

### 검증

- `python -m pytest -p no:asyncio` — **281 passed**(P0+P1 15 + P2/P3 10 신규 포함).
- 앱 전체 임포트·라우트 등록 확인(merge/unmerge/merge-suggestions 정상 등록).
- **실 SQL 통합**: 일회용 postgres 컨테이너(포트 55432, 사용자 데이터 미접촉)에 A/B+events 삽입 →
  merge → 검증(A 5건·B 0건·shared dedup·b1/b2 merged_from='B' 태그·재계산·keyword 합집합·B `status='merged'`) →
  unmerge → 검증(A 3건·B 2건·태그 제거·B 재활성화). 전 항목 통과 후 컨테이너 제거.
- **튜닝(골든)**: `python -m eval.tune_merge_floor`(실 Upstage passage 임베딩) — 양성 0.645~0.739, 음성 0.236~0.472,
  완전 분리(gap +0.173) → 밴드 중앙값 0.56.
- **튜닝(실데이터, 최종)**: 도그푸딩 18세션 153쌍 읽기 전용 측정(실 Qdrant 벡터+키워드 게이트) — 실 요약은 코사인이
  더 낮게 분포해 0.56이 정답을 놓침(낭만인프라 0.533, 이터널리턴강의↔나어나이 0.544). 분리 구간 [0.44, 0.533] 사이
  **0.52** 확정. 0.52에서 제안 5쌍 전부 진짜 과분할(가비아 중복·제주항공권 9+3·이터널리턴 2건·낭만인프라).
  실데이터 접근은 읽기 전용(필요 컬럼만 select, 스키마·데이터 미변경).

### 남은 일 / TODO

- P4(배치 후 자동 제안 생성 + 대시보드/사이드패널 UI). UI 위치는 대시보드 우선으로 합의됨.
- 병합 전용 version note는 record_version 시그니처에 없어 미기록(재요약이 새 version 자연 생성) — 필요 시 추후.
- 골든 양성 4개는 curated 소표본 — 실데이터 제안 품질은 P4 노출 후 재측정.

## 2026-08-07 — 세션 병합 P0 스키마 + P1 제안 API (feat/merge-suggestions)

### 요청

merge 구현 착수. 먼저 merge-design §9 열린 결정을 사용자와 합의한 뒤 P0+P1만 구현.

### 결정 (2026-08-07 확정, DecisionLog 참조)

범위=P0(스키마)+P1(읽기 전용 제안), 탐지=벡터 floor AND 키워드 겹침(정밀 우선),
생존=이벤트 많은 쪽(동률 시 이른 started_at→id), UI 위치=웹 대시보드 우선(구현은 P2).

### 조사 / 사실 정정

- 세션 요약 임베딩은 Qdrant `orbit_sessions`(COSINE, dim 4096)에 `embedding_status='done'`일 때만 저장.
  `search_similar_with_scores`로 점수 기반 근접 검색 가능.
- 마이그레이션 러너(`db/migrations.py`)는 sessions 테이블 컬럼 추가만 담당(멱등 ALTER).
- **[정정]** merge-design §5의 "list API는 status='active'만 반환" 가정은 **틀림** —
  `list_sessions`에 status 필터가 없다. 이번 범위(merged 세션 미생성)에서는 무해하나 **P2에서 필터 필수**.
- FastAPI 라우트 순서상 `/sessions/merge-suggestions`를 `/sessions/{session_id}`보다 먼저 등록해야 함.

### 변경

- `app/db/models.py` — `Session.merged_into VARCHAR(36) NULL` 추가(P0, 기록은 P2부터).
- `app/db/migrations.py` — `_SESSIONS_COLUMNS`에 `merged_into` 멱등 ALTER 추가.
  `session_events.merged_from_session_id`는 이벤트 이전이 실제 일어나는 P2로 연기(러너 일반화 필요·현재 미사용).
- `app/config.py` — `merge_suggest_floor`(기본 0.6, 미측정 잠정값), `merge_suggest_max_pairs`(50).
- `app/db/vector.py` — `get_vector(session_id)` 추가(저장 벡터 조회, 실패/부재 시 None).
- `app/services/merge_suggester.py`(신규) — 순수 판정 함수(`evaluate_pair`, `keyword_overlap`,
  `_pick_survivor`) + 오케스트레이터(`find_merge_suggestions`, 읽기 전용).
- `app/schemas/session.py` — `MergeSignal`, `MergeSuggestion` 추가.
- `app/api/sessions.py` — `GET /sessions/merge-suggestions`(읽기 전용, `/{session_id}`보다 먼저 등록).
- `tests/test_merge_suggester.py`(신규) — 순수 함수 15종(floor 경계·AND 미충족·생존자 tie-break·제목 fallback).
- `docs/Plan.md` — merge P0+P1 계획으로 갱신.

### 검증

- `python -m pytest -p no:asyncio` — **271 passed**(기존 256 + 신규 15).
- 라우트 등록 순서 확인: `/sessions/merge-suggestions`가 `/sessions/{session_id}` 앞에 등록됨.
- 오케스트레이터(Qdrant/DB 의존)는 단위 테스트 미대상 — 로직을 순수 함수에 집중(AGENTS §12).

### 남은 일

- `merge_suggest_floor` 골든/실데이터 튜닝 후 DecisionLog 갱신.
- P2(병합 실행 API + `list_sessions` status 필터 + `merged_from_session_id`), P3(undo), 대시보드 UI.

## 2026-08-07 — 추천 세션 (feat/google-auth 2단계)

### 요청

최신순이나 단일 모델이 아니라 다중 신호 후보 생성 + LLM 리랭킹 구조.
갱신 시점은 "새 탭을 띄우고 추천하는 시간 뒤쯤 다시 계산" — API 비용 고려, 설계는 위임.

### 변경

- `services/recommender/scoring.py` — 1차 점수(순수 함수, I/O 없음).
  similarity/unfinished/recency/revisit/current_context 5신호, 지정 가중치 그대로.
  recency는 반감기 3일 지수 감쇠, unfinished는 남은 할 일 3개에서 포화,
  revisit는 서로 다른 날 4일에서 포화. 동점은 세션 id로 깨서 결정적으로 만들었다.
- `services/recommender/llm_rerank.py` — 후보 → 3개 선정 + 추천 이유.
  성격(continue/related/rediscover)을 섞고, LLM 실패·형식 오류·범위 밖 인덱스·중복은
  전부 규칙 기반 폴백으로 흡수한다.
- `services/recommender/service.py` — 신호 수집(요약의 todos/next_actions, 방문 일수,
  컨텍스트 임베딩 유사도) + 캐시(stale-while-revalidate).
- `db/models.py` — `recommendation_cache` 테이블(신규, create_all 대상).
- `api/recommendations.py` — `GET /recommendations`. 추천 실패가 새 탭을 막지 않도록
  빈 목록으로 응답하되 조용히 성공으로 위장하지 않는다.
- `sync_pipeline` — 배치가 세션을 바꾸면 캐시를 낡은 것으로 표시.
- 익스텐션 — `fetchRecommendations`, `useRecommendations`(staleTime 무한, 폴링 없음),
  카드 배지를 추천 성격으로, 추천 이유를 카드에 노출. 서버 추천이 없으면 최근 세션 폴백.

### 오류와 수정

- **`extract_json` 예외 미처리.** LLM이 "죄송합니다…" 같은 문장을 주면 `_parse_picks` 가
  JSONDecodeError로 터져 폴백까지 가지 못했다. 테스트가 먼저 잡았고 try/except로 감쌌다.
- 캐시 테스트 헬퍼가 `items=None` 을 기본값으로 흡수해 "items가 실제 NULL인 행"을
  만들 수 없었다. sentinel로 교체(테스트 쪽 버그).

### 검증

- backend **411 passed** — scoring 22, rerank 14, cache 11 신규.
  인증 경계 테스트가 56 → **58**로 자동 증가했다. 라우터 단위 인증 의존성을 쓴 덕에
  새 엔드포인트가 별도 조치 없이 보호 대상에 포함됐다.
- extension **81 passed**, compile·build 통과.
- **미실행:** 실제 LLM 호출 경로. `eval` 하네스와 마찬가지로 비용이 발생해
  사용자 요청 시에만 돌린다. 폴백 경로는 전부 테스트로 덮었다.

### 남은 일

- 실데이터에서 가중치 튜닝(특히 `unfinished` 정의와 recency 반감기 3일).
- implicit feedback 수집(추천 클릭·복원·무시) — 개인별 weight 학습의 전제.

## 2026-08-07 — 구글 로그인 기반 회원가입·로그인 (feat/google-auth)

### 요청

구글 로그인 연동 기반으로만 가입·로그인을 넣는다. 추천 세션은 후속.

### 조사

- 인증이 전무했다 — users 테이블·미들웨어·토큰 개념 없음. API 6개 전부 공개.
- 다만 `user_id` 컬럼은 3개 테이블(`sessions`·`exploration_events`·`sync_batches`)에
  이미 있었고 전부 `"local"` 하드코딩. 스키마는 멀티유저를 염두에 뒀고 주체만 없었다.
- 익스텐션은 `lib/api.ts` 의 `request()` 한 곳으로 요청이 모여 헤더 주입 지점이 하나였다.

### 변경 (backend)

- 신규 `users` 테이블(구글 sub unique). `create_all` 이 생성하므로 ALTER 러너 대상 아님.
- `services/google_auth.py` — access token 검증. `tokeninfo` 로 **aud 일치 확인**,
  타임아웃 5초 + 재시도 2회, 검증 실패와 구글 장애를 예외 타입으로 분리(401 vs 503).
- `services/auth_tokens.py` — HS256 JWT 발급·검증. 알고리즘 목록 고정으로 alg 혼동 방어.
- `services/users.py` — sub 기준 조회/생성, 최초 가입자에 한해 `local` 데이터 1회 이관.
- `api/deps.py`, `api/auth.py` — `get_current_user` 의존성, `/auth/google|me|logout`.
- `main.py` — 데이터 라우터 6개에 **라우터 단위** 인증 의존성.
- `"local"` 하드코딩 전 구간 제거. 세션 소유자는 이벤트에서 파생시켜(`session_updater`)
  별도 인자 전달 없이 drift 를 막았다.
- 소유자 필터 추가: sessions(단건·목록·병합), search(벡터·키워드), events, analytics 5종,
  merge_suggester, auto_merge, sync_pipeline 후보 검색.

### 변경 (extension)

- `lib/auth.ts` — getAuthToken → `/auth/google` 교환 → `chrome.storage.local` 저장.
  로그아웃 시 크롬 토큰 캐시도 제거(안 지우면 다음 로그인이 계정 선택 없이 통과).
- `lib/api.ts` — `request()` 와 `/sync` 에 Authorization 주입, 401 시 세션 폐기 + 재로그인 유도.
- `lib/useAuth.ts` — 저장소 변경 구독. 한쪽에서 로그인/로그아웃하면 다른 쪽도 따라 바뀐다.
- 로그인 게이트: 사이드패널 `LoginGate`, 새 탭 `LoginScreen`(홈·아틀라스 모두 차단).
- `UserMenu` 를 실제 계정(이름·이메일·사진)과 연결, 설정에 계정·로그아웃 섹션.
- manifest: `identity` 권한 + `oauth2` (client_id 는 `.env` 에서 읽어 커밋하지 않음).

### 오류와 수정

- **`get_session_events` 소유권 확인 누락.** 일괄 패치에서 빠져 남의 세션 타임라인이
  열릴 수 있었다. `db.get(SessionModel)` 잔존 지점을 전수 grep 해서 발견·수정.
  `retry_summary` 도 같은 이유로 누락돼 있었다.
- **경계 테스트가 공허하게 통과.** 처음엔 FastAPI 내부 라우트 구조를 뒤졌는데
  0.138 의 `_IncludedRouter` 때문에 APIRoute 를 하나도 못 찾아 검사 대상이 0개였다.
  "경로가 0개면 실패"라는 방어 테스트가 이를 잡았고, 내부 구조 대신 **실제 요청을 보내
  401을 확인**하는 방식으로 바꿨다.
- 기존 테스트 50개가 시그니처 변경으로 실패 → 새 계약에 맞춰 갱신(삭제·완화 없음).
  정규식 일괄 치환이 여러 줄 호출과 중첩 괄호를 깨뜨려 되돌리고 지점별로 수정했다.

### 검증

- backend `pytest` — **362 passed** (인증 15건 + 경계 56건 신규).
  경계 테스트는 보호 경로 26개 × (토큰 없음 / 위조 토큰) 을 실제 요청으로 확인한다.
- extension `pnpm test` **75 passed**, `pnpm compile`·`pnpm build` 통과.
- manifest 에 `identity` 권한과 `oauth2` 반영 확인.
- **미실행:** 실제 구글 로그인 플로우. OAuth 클라이언트가 아직 발급되지 않았다.

### 남은 일

- Google Cloud Console 에서 "Chrome 확장 프로그램" 유형 OAuth 클라이언트 발급 후
  `backend/.env` 의 `GOOGLE_CLIENT_ID`·`JWT_SECRET`, `extension/.env` 의
  `VITE_GOOGLE_CLIENT_ID` 기입 → 실제 로그인 스모크 테스트.
- 추천 세션 로직(2단계) — 스펙은 로컬 `plan.md` 에 정리됨.

## 2026-08-07 — 세션 진입을 대시보드로 통일 + 세션 복원 (feat/design-upgrade 3차)

### 요청

상세 보기가 별도 모달을 띄우지 말고 **해당 세션의 대시보드(아틀라스)로 이동**하게 할 것.
`이어서 탐색` 을 `세션 복원` 으로 바꾸고, 세션 상세에 있던 복원(새 창으로 포함) 메커니즘을
그대로 넣을 것. 홈 더미 데이터가 대시보드 세션과 매칭되지 않으면 맞출 것.
그리고 히어로의 Orbit 그래픽으로 들어갈 때만 네비게이터를 펼친 채 열 것.

### 조사

- 홈 더미 데이터는 이미 `ATLAS_ORBITS` 에서 `pickEntry()` 로 뽑아 쓰고 있었다.
  참조 7쌍(`first-car/car-insurance`, `kyoto-2024/kyoto-ryokan`, `design-system/design-tokens`,
  `first-car/car-compare`, `gaussian-splatting/3dgs-survey`, `jeonse-loan/loan-compare`)이
  **모두 실제 대시보드 세션에 매칭**됨을 확인 — 데이터 변경 불필요.
- 복원은 사이드패널이 쓰는 `lib/chrome-bridge.ts` 의 `restoreInCurrentWindow` ·
  `restoreInNewWindow` 가 이미 있다. 새로 만들지 않고 재사용.
- 아틀라스는 진입 시 `nav.open` 을 강제하지 않고 공유 상태를 그대로 읽는다
  (`VariantAtlasReplica:67`). 따라서 열림 여부는 **진입점이 결정**하면 된다.

### 변경

- `App.tsx` — `SessionDetail` 모달 제거. `openDashboard()` 하나로 최근 탐색·상세 보기·
  AI 응답 진입을 통일하고, 네비게이터 선택 상태를 맞춘 뒤 `?orbit=&session=` 으로 이동한다.
- `components/sections/ExploreCard.tsx` — 버튼을 `상세 보기`(대시보드 이동) +
  `세션 복원`(복원)으로 교체. `restore-group` hover 로 `새 창으로 세션 복원` 이 펼쳐진다.
- `components/sections/ContinueExploring.tsx` — props 를 `onOpenDashboard`·`onRestore` 로 교체.
- `lib/restore.ts`(신규) — `chrome-bridge` 를 감싸 실패를 문자열로 돌려준다.
- `components/sections/OrbitHero.tsx` — 그래픽 클릭 시 `patchNavState({ open: true })` 후 이동.
- `components/sections/SessionDetail.tsx` 삭제, `styles/index.css` 에서 이 모달 전용
  스타일 **281줄 제거**(참조하는 컴포넌트가 없어짐).

### 검증

- `pnpm test` **57 passed**, `pnpm compile`·`pnpm build` 통과. 번들 786KB.
- 빌드 결과를 로컬 서버로 띄워 실제 크롬에서 확인:
  - `상세 보기` → `#/orbit-atlas?orbit=first-car&session=car-compare` 로 이동,
    트레이·상세 패널이 그 세션으로 열림, **네비게이터 닫힘**
  - Orbit 그래픽 클릭 → `#/orbit-atlas`, **네비게이터 열림**
  - `세션 복원` hover → `새 창으로 세션 복원` 펼쳐짐
  - 콘솔 에러는 확장 밖 `chrome.storage` 부재 1건뿐(의도대로 처리·표시됨)
- **확장 밖에서 확인 불가:** 복원의 실제 탭 열기(`chrome.tabs`/`chrome.windows` 부재).

### 남은 일

- 목업 페이지 URL 은 가짜(`https://hyundai.com/car-compare-0`)라 지금 복원하면
  죽은 탭이 열린다. 실데이터 연결 시 해소된다.

## 2026-08-07 — 아틀라스 전체 이식 + 바로가기 (feat/design-upgrade 2차)

### 요청

"목업 채로 들고와줘" — 시안의 두 번째 화면(아틀라스)과 네비게이션, 마우스 상호작용을
그대로 이식. 이어서 검색창 아래 `검색 범위`를 **바로가기**로 바꾸고 펼침/접힘 지원.
새 탭의 탭 이름을 `Orbit` → `새 탭`.

### 조사

- 시안에서 **도달 가능한 컴포넌트만** 추렸다. `OrbitDetailPanel`·`OrbitAtlasCanvas`·
  `OrbitSidebar`·`DesignedByVariantChip` 은 어디서도 import 되지 않는 죽은 코드였고,
  하필 Tailwind 클래스를 쓰는 유일한 파일이 `OrbitDetailPanel` 이라 이를 빼면서
  새 탭에서 Tailwind 유틸리티 의존이 사라졌다.
- Phosphor 아이콘이 41종 쓰인다(`data.ts` 의 `icon` 필드 + 아틀라스 마크업).
  lucide 매핑은 손실이 커서 폰트를 로컬 번들하기로 했다.
- 시안 라우팅은 `window.location.pathname === '/orbit-atlas'`. 확장 페이지 URL 은
  `chrome-extension://<id>/newtab.html` 이라 경로 pushState 후 새로고침하면 깨진다.

### 변경

- `entrypoints/newtab/` — 시안 소스 이식(6,200여 줄). 1차의 단순화 컴포넌트
  (`HomeHeader`·`HomeSearch`·`SignatureOrbit`·`home-mock.ts`·`home.css`)는 원본으로 대체·삭제.
- `lib/navigation.ts` — 해시 라우팅(`#/orbit-atlas`)으로 전환. 나머지 동작은 시안과 동일.
- `styles/phosphor.css` + `public/fonts/Phosphor.woff2` — `@phosphor-icons/web@2.1.2` 의
  regular 세트에서 @font-face 만 다시 선언해 **woff2 하나만** 참조하게 했다.
- `components/sections/Shortcuts.tsx` + `lib/shortcuts.ts` — 바로가기. topSites 초기값,
  추가·삭제, 펼침 상태 저장.
- `wxt.config.ts` — `topSites`·`favicon` 권한 추가.
- `entrypoints/newtab/index.html` — `<title>새 탭</title>`.

### 오류와 수정

- **Phosphor 번들이 4.1MB 증가.** 패키지 style.css 가 svg/ttf/woff/woff2 4종을 모두
  참조해 Vite 가 전부 번들했다(svg 만 3MB). woff2 만 쓰도록 @font-face 를 다시 선언해
  **4.76MB → 786KB**. 크롬은 woff2 만으로 충분하다.
- **바로가기가 로딩 상태에 갇힘.** `chrome.storage` 호출이 거부되면 `setLoaded(true)` 에
  도달하지 못해 자리표시자만 남고 아무것도 안 보였다. 실패해도 항상 목록을 돌려주고
  실패 사유를 `error` 로 함께 넘기도록 고쳐, 저장·조회 실패가 화면에 드러나게 했다.

### 검증

- `pnpm test` — **57 passed (5 files)**. `shortcuts` 14건 신규(정규화·중복·상한·위험 스킴 거부).
- `pnpm compile`·`pnpm build` 통과. manifest 권한 9종, `chrome_url_overrides.newtab`,
  `<title>새 탭</title>` 확인.
- 빌드 결과를 로컬 서버로 띄워 실제 크롬에서 확인:
  - 홈 렌더 + 네비게이터 드로어 + Phosphor 아이콘 정상
  - 시그니처 그래픽 클릭 → `#/orbit-atlas` 이동, 아틀라스 캔버스·상세 패널 렌더
  - 캔버스의 세션 레이블 클릭 → 트레이 펼침 + 네비게이터 확장 + 궤도에 페이지 노드 표시
  - 콘솔 에러 0건
  - 바로가기: 펼침/접힘, 추가 폼 열림·포커스, 주소 아닌 입력 거부, 유효 주소 추가,
    저장 실패 시 오류 노출
- **확장 밖에서 확인 불가:** 바로가기의 topSites 초기 목록과 파비콘 이미지
  (`chrome.topSites`·`chrome.runtime.getURL` 부재). 실제 크롬 로드 확인 필요.

### 남은 일

- 실제 크롬에서 바로가기 파비콘·topSites 확인, 사이드패널 시각 확인.
- 아틀라스는 전부 목업 데이터다. 백엔드 실데이터 연결은 후속.
- 사이드패널 `TimelineItem` 은 아직 외부 파비콘 서비스(google s2)를 쓴다.
  새 탭이 쓰는 확장 내장 파비콘으로 통일하는 것이 좋다.

## 2026-08-07 — 목업 디자인 이식: 새 탭 홈 + 사이드패널 톤 통일 (feat/design-upgrade)

### 요청

`orbit-browser/orbit_front` 시안의 메인 화면을 크롬 새 탭 스타팅 화면으로 만들고, 검색창은
브라우저 첫 화면처럼 검색·주소 이동까지만 연결한다. 나머지 컨트롤은 시안 모습만 유지한다.
기존 사이드패널도 같은 디자인 언어로 통일하고, 배경이 붙어 나오는 아이콘을 교체한다.

### 조사

- 시안 토큰은 `orbit_front/src/index.css:14-28`에 집약(샌드 `#fefaf6` / 테라코타 `#f07550` /
  radius 28·16·pill / 따뜻한 그림자 `rgba(178,112,84,.12)`). 익스텐션 토큰은 `#f2660a`·`#f7f8fa`·
  회색 계열로 톤이 어긋나 있었다.
- 아이콘 증상의 원인은 익스텐션 코드가 아니라 `wxt.config.ts`가 가리키던
  `public/orbit_icon.png` 자체였다 — **1242×1242 주황 단색 배경** 이미지. 크롬이 사이드패널 헤더·
  툴바에 이 이미지를 그리므로 주변과 분리돼 보인다. `orbit_front/src/assets/orbit-mark.png`가
  같은 마크의 알파 배경 버전.
- 익스텐션에 newtab 엔트리포인트가 없었다. WXT는 `entrypoints/newtab/index.html`을 두면
  `chrome_url_overrides.newtab`을 자동 생성한다.
- 시안은 Phosphor 아이콘을 CDN `<script>`로, 폰트를 Google Fonts로 불러온다. 둘 다 MV3에서
  쓰지 않기로 한 방식이라 각각 lucide-react(기존 의존성)와 시스템 폰트 스택으로 대체했다.

### 변경

- `extension/public/` — `orbit-mark.png`(원본) + 알파 배경 정사각 아이콘 16/32/48/128 생성.
  `orbit_icon.png` 삭제. `wxt.config.ts`의 `icons`·`action.default_icon` 교체, `search` 권한 추가.
- `extension/lib/omnibox.ts`(신규) — 주소창 입력 해석기(순수 함수). http/https/file만 이동 허용,
  `javascript:`·`data:`·`chrome:` 등은 검색으로 강등.
- `extension/entrypoints/newtab/`(신규) — 홈 화면 일체. `styles/home.css`(시안 CSS 이식),
  `components/`(HomeHeader·SignatureOrbit·HomeSearch·RecentExploration·ContinueExploring·
  ExploreCard), `data/home-mock.ts`(시안 더미 데이터 중 홈이 쓰는 6개 세션만 추림).
  검색창 외 컨트롤은 전부 `disabled`.
- `extension/entrypoints/sidepanel/styles/tailwind.css` — 토큰을 시안 팔레트로 교체,
  `--color-orbit-danger`·`--radius-orbit-card`·따뜻한 그림자 3종 신설.
- 사이드패널 부품 정리 — 하드코딩 `red-*` 5곳을 danger 토큰으로, 카드 컨테이너
  `rounded-xl`→`rounded-orbit-card`(20px), `shadow-xs`/`shadow-lg`→따뜻한 그림자,
  세그먼티드 컨트롤과 텍스트 액션 버튼을 pill 형태로.

### 오류와 수정

- **`localhost:5173`이 검색으로 새어 나감.** 파서의 스킴 판별 정규식이 `localhost:`를 스킴으로
  잡았다. 콜론 뒤가 숫자면 포트로 보도록 `(?!\d)` 부정 전방탐색 추가. 단위 테스트가 먼저 잡았다.
- **로컬 주소에 https가 붙는 문제.** 브라우저 실렌더 확인 중 발견. 크롬 주소창은 localhost를
  HTTPS-First 대상에서 제외하는데 그대로 두면 개발 서버가 연결 실패로만 보인다.
  루프백(`localhost`, `127.*`)은 http로 붙이도록 수정하고 테스트 2건 추가.

### 검증

- `pnpm test` — **43 passed (4 files)**. omnibox 파서 12건 신규.
- `pnpm compile`(tsc --noEmit) 통과, `pnpm build` 통과.
  빌드 산출물에 `newtab.html`과 `chrome_url_overrides.newtab` 생성 확인.
- 새 탭 홈은 빌드 결과를 로컬 서버로 띄워 실제 크롬에서 확인:
  렌더·반응형·비활성 컨트롤 정상, 검색 실패 시 오류 문구 노출 확인,
  `localhost:8899/newtab.html?navigated=1` 입력 시 **http로** 이동하는 것을 서버 접근 로그로 확인.
- 사이드패널은 확장 밖에서 실행 불가(`chrome.storage` 부재로 마운트 실패) → 빌드된 CSS에서
  신규 토큰 6종 반영과 구 팔레트 5종 완전 제거를 확인하는 것으로 대체. **실제 크롬 로드 확인은 미실행.**

### 남은 일

- 사이드패널 시각 확인(실제 크롬 로드), 새 탭 홈의 백엔드 실데이터 연결, 비활성 컨트롤 기능 연결.

## 2026-08-06 — 메일 노이즈 규칙 title 보강 + 세션 병합 설계 (feat/subcluster-append-gating 이어서)

### 요청

실데이터 검수 후속: (1) gmail·naver 받은편지함 스침이 세션에 새어드는 문제를 노이즈 규칙으로 보강,
(2) 같은 주제 과분할·중복 세션에 대한 merge 설계.

### 조사

- 새어든 메일 이벤트 실 URL 확인: gmail `/mail/u/1/#inbox`→정규화 `/mail/u/1/`(경로에 inbox 신호 소멸),
  naver 루트 `mail.naver.com/`(folders 경로 아님). 둘 다 **title은 "받은편지함/받은메일함"으로 시작**.
  개별 메일 읽기는 title이 메일 제목이라 구분 가능. naver `/v2/folders/0/all`는 기존 folders 경로 규칙으로
  이미 discard(그래서 root 1s만 샜음).
- merge: models에 merge 필드 없음. 기존 원칙 "자동 병합 금지 + 사용자 확인 UI"(improvement-report,
  ProjectContext) 확인 → 제안+확인+가역 방향으로 설계.

### 변경

- `app/services/noise_filter.py` — `_MAIL_LIST_TITLE_RE`(`^(받은편지함|받은메일함)`) 추가,
  `_is_mail_list_view(host, path, title)`로 시그니처 확장(목록 경로 OR 받은편지함 title). `is_noise`가 title 전달.
- `tests/test_noise_filter.py` — `_event`에 title 파라미터, 신규 테스트 3종(gmail/naver 받은편지함 noise,
  개별 읽기 보존). 기존 `test_gmail_root_ambiguous_survives`(title 없음)는 그대로 통과.
- `eval/golden/mail_inbox_refresh_is_noise.json` — gmail `/mail/u/1/#inbox`·naver 루트 케이스 2건 추가.
- `docs/merge-design.md`(신규) — 세션 병합 설계(제안+확인+가역, 다중 신호 탐지, soft-delete+undo,
  스키마·API 3단계·로드맵·열린 결정).

### 검증

- `pytest tests/test_noise_filter.py` 통과, 전체 **259 passed**.
- 골든 `mail_inbox_refresh_is_noise` 단독 실행: 노이즈 제외율 100%, 실패 0(gmail/naver 루트 discard 확인).

### 남은 일

- merge는 설계만. `merge-design.md` §9 열린 결정(임계값·생존 선택·노출 시점·UI) 합의 후 P1(읽기 전용 제안)부터 착수.

## 2026-08-06 — 그룹 내 서브클러스터링 + append 게이팅 (feat/subcluster-append-gating)

### 요청

Auto Session 재세션화의 "그룹 간 과잉 append" 구조적 불안정을 1+2(임베딩 서브클러스터링 +
append 게이팅)로 해결. 계약부터 잡고 골든셋으로 검증.

### 조사

- `_process_group` 흐름 확인: 그룹 전체 1회 임베딩 → 후보검색 → analyze(그룹 전체) → apply.
  다주제 그룹이 한 임베딩·한 LLM 호출로 들어가 뭉침 여지. `search_similar_with_scores`는 score를
  계산하나 `_fetch_candidates`가 버림(게이팅에 재활용 가능).
- numpy 2.2.6 사용 가능, Upstage 임베딩 배열 입력(배치) 가능 확인.
- 골든 이벤트 임베딩 코사인 분포 실측(진단 스크립트) → subcluster_threshold 안전 밴드 도출.

### 변경

- `app/services/subclusterer.py`(신규) — average-linkage 응집 서브클러스터링 순수 함수.
- `app/ai/embedding.py` — `embed_many`(배열 배치 임베딩, 순서 보존) 추가.
- `app/services/sync_pipeline.py` — `_process_group` 재작성(embed_many→subcluster→클러스터별
  후보검색/analyze/게이트→collect-then-apply). `_event_embedding_text`·`_centroid`·`_gate_appends`·
  `_append_blocked` 추가. `_fetch_candidates`/`_sessions_to_candidates`가 벡터 score 노출.
  `_process_group` 반환을 모델 목록으로 변경, `_process_batch`가 이를 카운트.
- `app/config.py` — `subcluster_threshold`(0.31)·`append_score_floor`(0.35)·`append_max_age_days`(3).
- `eval/run_eval.py` — 서브클러스터링 경로 반영(embed_many+subcluster, 클러스터별 analyze),
  임베딩 record/replay 추가(call_key에 cluster_index), `_scenario_paths`가 `_`접두 파일 제외.
- `tests/test_subclusterer.py`·`test_embedding.py`(신규), `test_sync_pipeline.py`(게이트·하드스플릿·
  score 케이스 갱신).

### 오류와 해결

- **replay `KeyError('name')`**: 기록 파일을 `eval/golden/`에 저장했더니 시나리오 glob(`*.json`)이
  기록 파일을 시나리오로 로드하려다 실패. 원인=파일 위치와 glob 충돌. 해결=`_scenario_paths`가
  `_`접두 파일(기록 산출물)을 제외(docstring의 `_recorded.json` 컨벤션과 일치).

### 설계 결정

- 조건부 하드 스플릿(사용자 승인): 클러스터 2개 이상일 때만 분리 → 뭉침 구조적 차단, 단일주제 그룹은
  호출 1회 유지. collect-then-apply로 재병합 방지.
- subcluster_threshold=0.31: 골든 코사인 실측 안전 밴드 [0.30,0.32] 중앙(과분할 경고 존중).
- 게이트는 append→create 강등만(순수 함수), 실패 시 session_updater fallback 제목 사용.

### 검증

- `python -m pytest -p no:asyncio` → **256 passed**.
- 골든 11개(실 LLM+임베딩): Assignment/Purity/Coverage **100%**, 노이즈 94.1%, New-vs-Existing 81.8%.
  mixed_topics가 travel/coding 2 클러스터로 정확 분리(교차주제 메가 뭉침 소멸).
- New/existing 2건 미스매치는 서브클러스터링 회귀 아님을 실증: 단일 클러스터라 LLM 입력이 기존과 동일,
  재실행 시 append↔create 뒤집힘(비결정성) + EXAONE create-bias. 클러스터링 품질 지표는 100% 유지.
- 백엔드 전용 변경이라 extension/frontend 무영향.

### 실데이터 검증 (재세션화 2회, 사용자 승인)

- 대상: 라이브 DB 이벤트 150개(2026-08-05). 사전 DB 백업(pg_dump 463KB, 복구용). 이벤트 pending 복귀
  + event-origin 세션 삭제 + 단일 배치 재구성을 2회 반복(각 배치 후 남은 hold는 드레인 배치로 해소).
- **핵심 개선 확인**: before의 메가 뭉침("여행 계획 및 항공권 검색" 18개가 항공권+브랜드로고+여름음악
  +맥미니+행성궤도를 흡수, "이터널 리턴" 33개)이 **두 run 모두에서 재발하지 않음**. 여행/항공권이
  무관 주제를 흡수하지 않고, 여름음악(2)·맥미니(2)·행성궤도(2)·Tailscale(13)·강의(2)가 독립 세션으로
  안정 재현. 150개 전부 처리(0 pending, discarded 16~19).
- **잔여 변동(경미)**: 하나의 일관된 주제 영역 *내부* 세분화가 run별로 다름(이터널리턴 20+12+2+1 ↔ 32+2,
  항공권 6+5 ↔ 9+3). 교차주제 오염이 아니라 클러스터 내 LLM 판단 + EXAONE create-bias(중복 제목
  "나어나이 이터널 리턴" 2건) — merge(후순위) 영역.
- **게이트는 이 데이터셋에서 사실상 미발동**: 전부 같은 날(08-05)이라 배치 내 새 세션은 recent-24h
  경로(score None)로 후보에 올라 유사도 게이트를 우회하고 age(3일)도 0일이라 안 걸린다. 즉 이번 개선은
  거의 전부 서브클러스터링 효과이며, append 게이트(유사도 하한/시간 근접)의 실효 검증은 교차-일(cross-day)
  ·오래된 후보가 있는 데이터가 필요하다(현재는 단위 테스트로만 검증).
- **부수 관측(기존 취약점, 본 작업 무관)**: 일부 배치에서 EXAONE serverless rate limit(→A.X 폴백) 다발 +
  `extract_json`의 greedy `_JSON_OBJ_RE`가 JSON 뒤 추가 텍스트에 "Extra data"로 실패→그룹 hold. 재시도
  (다음 배치)로 자연 해소돼 최종 결과에는 영향 없음. 파서 강건화(raw_decode)는 별도 소과제 후보.

### 남은 일

- append 게이트 임계값 실효 검증·튜닝은 cross-day/오래된 후보가 있는 실데이터 필요(단일일 데이터로는 미발동).
- EXAONE create-bias 중복 세션(같은 주제 재생성)은 merge(후순위) 영역 — 별도 결정.
- (선택) `extract_json` raw_decode 강건화로 "Extra data" hold 감소.
- 현재 DB는 재세션화 결과 상태(17 세션). 원상복구가 필요하면 scratchpad의 백업 SQL로 복원 가능.

## 2026-07-12 — 필수 프로젝트 문서 초기 세팅

### 요청

`AGENTS.md`를 읽고 해당 규칙에 필요한 파일을 세팅한다.

### 조사

- `AGENTS.md` 전체를 확인했다.
- `docs/`에는 `improvement-report.md`만 존재했다.
- `README.md`, `IMPLEMENTATION.md`, `ppt.md`, 개선점 리포트에서 프로젝트 목표와 현재 구현을 확인했다.
- 작업 시작 시 사용자 변경 파일은 `CLAUDE.md`, `docs/improvement-report.md`, 새 `AGENTS.md`였다.

### 변경

- 필수 문서 10종의 초기 버전을 생성했다.
- 프로젝트 목표, 정보 구조, 사용자 시나리오, 페르소나를 분리해 기록했다.
- 확인된 기술 결정과 아직 사용자 결정이 필요한 항목을 구분했다.
- 작업 프로세스와 완료 체크리스트를 추가했다.

### 오류와 해결

- 없음.

### 검증

- 필수 문서 10종의 존재 여부를 확인했다: 모두 존재.
- 각 문서의 최상위 Markdown 제목을 확인했다: 모두 존재.
- `git diff --check`를 실행했다: 오류 없음.
- 애플리케이션 코드를 변경하지 않아 테스트와 빌드는 실행하지 않는다.

## 2026-07-12 — 1차 안정화

### 요청

개선 리포트의 1차 안정화 항목을 구현하고 리포트를 읽기 쉽게 갱신한다.

### 변경

- AI 요약 오류와 빈 overview를 실패 상태로 전파했다.
- pending 폴러가 목록과 상세 캐시를 함께 갱신하도록 수정했다.
- Backend 전체 장애를 검색 빈 결과와 구분해 표시했다.
- 실제 국내 금융/결제 도메인을 보강하고 `.or.kr` 전면 차단과 미사용 `bookmarks` 권한을 제거했다.
- 기동 복구 작업을 참조가 유지되는 단일 순차 task로 변경했다.
- PATCH 제목의 최대 길이를 100자로 검증했다.
- 개선 리포트를 완료 상태와 다음 우선순위 중심으로 재구성했다.

### 오류와 해결

- 첫 검증 명령이 잘못된 작업 디렉터리와 PowerShell 실행 정책 때문에 실패했다. 저장소 루트와 `pnpm.cmd`를 사용하도록 수정했다.
- 시스템 Python에 `qdrant_client`가 없어 테스트 수집이 실패했다. `python -m pip install -e 'backend[dev]'`로 선언된 의존성을 설치했다.
- 설치된 pytest 9와 전역 pytest-asyncio 0.23.3이 충돌했다. 테스트가 `asyncio.run()` 기반이라 `-p no:asyncio`로 불필요한 플러그인을 제외했다.
- Extension에 선언된 Readability 패키지가 로컬에 설치되지 않아 타입 검사가 실패했다. lockfile 기준으로 의존성을 설치하고 재실행했다.

### 검증

- `python -m pytest -p no:asyncio`: 20 passed.
- `pnpm.cmd compile` (`extension/`): 통과.
- `pnpm.cmd build` (`extension/`): 통과.
- `pnpm.cmd build` (`frontend/`): 통과.
- 대표 민감 URL 5개와 일반 URL 2개의 `isSensitiveUrl` 판정: 통과.
- `git diff --check`: 최종 변경 후 통과.

## 2026-07-12 — P2 검색 정확도 및 오류 계약

### 요청

1차 안정화를 커밋하고 P2 검색 정확도 개선을 진행한다.

### 변경

- 1차 안정화 변경을 `930a5ce`로 커밋했다.
- Qdrant 검색에 설정 가능한 score threshold를 추가하고 기본값을 `0.35`로 정했다.
- 저장 임베딩 입력에 세션 제목을 포함했다.
- 검색 임베딩 timeout, 연결, upstream 상태, 응답 형식 오류를 504/503/502로 구분했다.
- Qdrant 검색 장애를 내부 상세가 없는 503 응답으로 변환했다.
- threshold 전달, 제목 임베딩 텍스트, 검색 오류 매핑 테스트를 추가했다.

### 제한과 후속 작업

- `0.35`는 초기 기본값이며 실제 골든셋 실측 후 조정해야 한다.
- 기존 Qdrant 포인트는 자동 재색인되지 않아 신규·재처리 세션부터 제목 임베딩이 적용된다.

### 검증

- `python -m pytest -p no:asyncio`: 28 passed.
- `pnpm.cmd compile` (`extension/`): 통과.
- `pnpm.cmd build` (`extension/`): 통과.
- `pnpm.cmd build` (`frontend/`): 통과.
- `git diff --check`: 최종 변경 후 통과.

## 2026-08-03 — M2 수집기 & 로컬 큐 & 동기화 엔진 (`feat/auto-session`)

### 요청

`docs/Plan.md` M2(6~10단계) — 상시 방문 이벤트 수집, IndexedDB 기반 Persistent Queue,
체류시간 세그먼트, 본문 부착, 4트리거 동기화 엔진을 구현한다. M1에서 준비된
`lib/settings.ts`와 매니페스트 권한(webNavigation/alarms/idle)을 그대로 사용한다.

### 변경

- `extension/lib/events/types.ts`(신규): 로컬 `ExplorationEvent`(camelCase) ↔ 서버
  `WireEvent`(snake_case) 변환 경계. `toWire()`가 `source: 'browser'` 고정, `domain`
  제외(서버가 인제스트 시 재계산).
- `extension/lib/events/db.ts`(신규): `idb`로 `orbit` DB(`events` 스토어, `by-status`/
  `by-visitedAt` 인덱스)를 여는 lazy 싱글턴.
- `extension/lib/events/queue.ts`(신규): 상태 기계(open→pending→syncing→synced) 전이
  전체 — `addEvent`/`attachContent`/`addDwell`/`finalizeOpenEvent`/`finalizeAllOpen`/
  `claimPending`/`markSynced`/`releaseToPending`(지수 백오프)/`resetStaleSyncing`/
  `prune`(48h)/`evictIfOver`(5000, synced 우선). 모든 뮤테이션 후 `orbit:syncStatus`
  (`pendingCount`/`todayCount`/`lastSyncAt`/`lastError`/`droppedCount`)를
  `chrome.storage.local`에 갱신.
- `extension/lib/events/collector.ts`(신규): `webNavigation.onCommitted`/
  `onHistoryStateUpdated`(SPA, 500ms 디바운스)/`tabs.onUpdated`(title)/
  `tabs.onActivated`/`windows.onFocusChanged`/`idle.onStateChanged`/`tabs.onRemoved`를
  `initCollector()`에서 동기적으로 등록. 탭 상태·활성 세그먼트는 `chrome.storage.session`
  (SW 종료 생존). 3초 미만 리다이렉트는 URL 치환, 그 외에는 새 이벤트 생성. 모든 큐 호출은
  fail-open(try/catch로 감싸 브라우징을 막지 않음).
- `extension/lib/sync/engine.ts`(신규): `navigator.locks`(`ifAvailable`) 뮤텍스로
  `requestDrain(reason)`을 직렬화. 50개씩 `postEventBatch` 전송, 성공 시 `markSynced`
  반복, 실패 시 `releaseToPending(backoff)` + `orbit-retry` 1회성 알람 예약 후 중단.
- `extension/lib/sync/triggers.ts`(신규): 수동(`SYNC_NOW` 메시지)/주기(`orbit-sync`
  알람, 설정 반응형)/개수(`countThreshold` 이상 시)/유휴 4트리거를 `requestDrain`으로
  수렴. SW 시작 시 `resetStaleSyncing(5분)` + `prune` + `evictIfOver` 실행.
- `extension/entrypoints/background.ts`: 컴포지션 루트화 — `initCollector()`/
  `initTriggers()` 호출 추가. 기존 `TABS_CHANGED`/`GET_CURRENT_TABS`/`GET_PAGE_CONTENT`
  동작은 무변경. `PAGE_CONTENT_READY` 핸들러가 기존 캐시 갱신에 더해
  `handlePageContentReady`(큐 부착)도 호출.
- `extension/lib/api.ts`: `postEventBatch` 추가(기존 `enrichTabs`/세션 API는 무변경).
- `extension/lib/messages.ts`(죽은 코드 부활): 기존 메시지 + `SYNC_NOW`/
  `GET_SYNC_STATUS`를 포함한 타입드 유니온으로 갱신(현재 실사용처는 아직 없음 — M4
  사이드패널에서 소비 예정).
- `extension/package.json`: `pnpm add idb`로 `idb@8.0.3` 의존성 추가.
- `extension/entrypoints/content.ts`: 변경 없음 — 기존 `EXTRACT_CONTENT` 핸들러가
  매 호출마다 현재 DOM을 새로 파싱해 응답하므로, SPA 온디맨드 pull에 그대로 재사용 가능해
  추가 변경이 불필요했다.

### 계약과 다르게 구현한 부분 (이유)

- `ExplorationEvent`에 계약 명세에 없는 `syncingStartedAt: string | null` 필드를
  추가했다(`toWire()`에서는 제외). `resetStaleSyncing(olderThanMs)`이 "오래 syncing에
  머문" 이벤트를 판별하려면 syncing 전환 시각이 필요한데, 명세된 필드만으로는 이 값을
  알 수 없었다.
- `WireEvent.content_excerpt`를 `string`(non-null)으로 정의하고 `toWire()`에서
  `null → ''`로 치환한다. `backend/app/schemas/event.py`의 `ExplorationEventIn`이
  `content_excerpt: str = ""`로 선언돼 있어(널 불허) `docs/api-design-v2.md`의
  `"content_excerpt": null` 예시와 실제 스키마가 어긋났다 — 과제 지시대로 스키마 파일을
  최종 근거로 따랐다.
- 유휴 트리거를 "idle.onStateChanged==='idle'이면 즉시 requestDrain"이 아니라,
  idle 진입 시 `settings.idleSyncMin`분짜리 1회성 `chrome.alarms`를 예약하고 active
  복귀 시 취소하는 방식으로 구현했다. `chrome.idle.setDetectionInterval(60)`(체류시간
  세그먼트용, 60초)과 별개로 "유휴가 idleSyncMin(기본 10분) 지속되면 동기화"라는
  `target-architecture.md` §4의 트리거 정의를 만족시키려면 60초 단위 idle 신호와
  실제 동기화 시점을 분리해야 했다. `setTimeout`은 MV3 SW가 유휴 중 종료되면 유실되므로
  쓰지 않고 `chrome.alarms`(SW 재시작에도 생존)로 구현했다.
- 개수 트리거(`pending ≥ countThreshold`)는 `queue.ts`가 `sync/triggers.ts`를 직접
  참조하지 않도록, `setPendingChangeListener` 콜백 훅으로 느슨하게 연결했다(모든
  뮤테이션 후 재계산된 `pendingCount`를 리스너에 전달).

### 검증

- `pnpm compile` (`extension/`): 통과.
- `pnpm build` (`extension/`): 통과. `.output/chrome-mv3/manifest.json`에
  `webNavigation`/`alarms`/`idle`/`tabs`/`storage`/`sidePanel` 권한이 모두 유지됨을 확인.

### 수동 검증이 필요한 항목 (브라우저 실행 불가로 이번 세션에서는 확인하지 못함)

- SW devtools 강제 종료 후 `chrome.storage.session`의 탭 상태·활성 세그먼트 생존, 재시작
  직후 `resetStaleSyncing`이 고아 `syncing` 이벤트를 되돌리는지.
- YouTube/Maps 등 SPA 폭주 사이트에서 500ms 디바운스가 충분한지, 짧은 리다이렉트(<3초)
  치환이 실제로 이벤트 수를 줄이는지.
- 체류시간 세그먼트: 탭 전환/창 포커스 아웃/유휴/탭 종료 각 케이스에서 dwell이 정확히
  마감되고 30분 상한이 적용되는지.
- 유휴 트리거: `idleSyncMin` 경과 후 실제로 `requestDrain('idle')`이 호출되고, 중간에
  active로 돌아오면 알람이 취소되는지.
- 동기화 엔진: 백엔드 다운 상태에서 지수 백오프(최대 30분) 후 `orbit-retry` 알람으로
  재시도되는지, 회복 후 `duplicates` 카운트로 중복 전송이 없는지.
- 큐 상한(5,000) 초과 시 `synced` 우선 정리 → 최고령 `pending` 퇴출 → `droppedCount`가
  사이드패널에 노출 가능한 형태로 쌓이는지(사이드패널 UI 자체는 M4 범위).

## 2026-08-03~04 — Personal Exploration Memory 전환 종합 (M0~M5, `feat/auto-session`)

### 요청과 배경

열린 탭을 분류·요약해 저장하는 것 자체는 지속적인 사용자 가치가 아니고, 탐색 중
사고의 흐름(Context)이 시간이 지나면 사라지는 문제가 더 근본적이라는 판단에 따라
(`docs/DecisionLog.md` 2026-08-03 "제품 방향 전환" 항목) Orbit을 "탭 스냅샷 분류"
도구에서 "상시 이벤트 수집 + 배치 세션화" 기반 Personal Exploration Memory로
전환했다. 기존 요약(`generate_summary`)·임베딩 검색(Qdrant)·복원·민감 도메인 필터는
새로 만들지 않고 그대로 재사용하는 것을 전제로, M0(설계 문서) → M1(이벤트 인제스트) →
M2(수집기·로컬 큐·동기화 엔진) → M3(배치 세션화 파이프라인) → M4(Timeline·Intent 검색) →
M5(Analytics·평가 하네스) 순으로 진행했다. M2는 별도 항목(위 "M2 수집기 & 로컬 큐 &
동기화 엔진")으로 이미 기록되어 있어 여기서는 전체 마일스톤 관점에서 6개 커밋과
전체 검증 결과를 종합한다.

### 마일스톤별 커밋과 범위

- `71d5344` (M0, docs) — `product-direction-v2`/`current-state-audit`/
  `target-architecture`/`data-model-v2`/`api-design-v2`/`migration-plan`/
  `evaluation-plan`/`implementation-roadmap` 신규 작성, `ProjectContext`/
  `DecisionLog`(2026-08-03 결정 6건)/`Plan`/`Personas`/`IA`/`UserScenarios` 갱신.
- `866fea9` (M1, feat(events)) — `exploration_events`/`sync_batches`/
  `sync_batch_events`/`session_events`/`session_versions` 모델과 `sessions` additive
  컬럼 9개, 멱등 ALTER 러너(`app/db/migrations.py`), `event_filter.py`(URL 정규화·
  시스템 URL 거부·민감 도메인 판정·검색어 추출), `POST /events`, Extension
  `lib/settings.ts`(chrome.storage 기반 공용 설정)와 매니페스트 신규 권한
  (webNavigation/alarms/idle).
- `9afec1d` (M2, feat(collector)) — IndexedDB 기반 Persistent Queue와 이벤트 상태
  기계(open→pending→syncing→synced), `webNavigation` 방문 감지·체류시간 세그먼트,
  `navigator.locks` 기반 동기화 엔진과 4트리거(수동/주기/개수/유휴). 상세는 위 M2
  항목 참고.
- `c14d023` (M3, feat(sync)) — 배치 내 중복 병합·시간 그룹화(`grouper.py`), LLM 의도
  분석(append/create/hold/discard, `intent_analyzer.py`), 세션 생성/갱신
  (`session_updater.py`), `asyncio.Lock` 직렬화 배치 파이프라인(`sync_pipeline.py`),
  `POST /sync`/`GET /sync/status`. A.X-K1 전역 0.5초 최소 호출 간격 리미터 추가.
- `c09f73b` (M4, feat(timeline)) — `GET /sessions/{id}/events`·`/versions`,
  `GET /search?scope=memory`(세션+관련 이벤트 통합), `GET /events?date=`,
  `DELETE /events/{id}`. Extension `TimelineView`를 사이드패널 기본 홈으로,
  `SyncStatusCard`(opt-in 온보딩), `SettingsView` 수집·동기화 섹션 추가.
- `397189a` (M5, feat(analytics)) — `GET /analytics/overview`(순수 SQL 집계, AI
  호출 없음), `backend/eval`(골든셋 3개 + `run_eval.py`, 지표 5종), 웹 대시보드
  `HomeView` 탐색 분석 섹션, 미참조 죽은 코드 9파일 삭제.

### 검증

- `python -m pytest -p no:asyncio`: 204 passed (이번 문서 갱신 세션에서 재실행해
  재확인).
- Extension `pnpm compile` / `pnpm build`, Frontend `pnpm build`: 각 커밋 시점에
  통과(커밋 메시지 기준. 최종 상태 재확인은 이번 세션에서 다시 실행하지 않았다).
- 실환경 E2E 스모크(실 Postgres/Qdrant/LLM, 커밋 메시지 기록 기준): M3에서 이벤트
  4개 인제스트(멱등성·필터) → 배치 → 'RTX 5070 구매 분석' 단일 세션 자동 생성 →
  `session_events` 순서/버전 기록 → 벡터 검색 히트까지 확인. M4에서 timeline/versions/
  memory 검색 실 DB 스모크(UTF-8 정상) 확인. M5에서 analytics 실 DB 스모크 확인.
- 세션 분류 평가 하네스(`backend/eval/run_eval.py`, 실 LLM 1회 실행, 커밋 메시지
  기록 기준): Assignment Accuracy·Purity·Coverage·New-vs-Existing 4개 지표 100%,
  노이즈 제외율(noise exclusion rate) 50%. 원인: 골든셋의 노이즈 이벤트(체류시간이
  짧은 SNS 방문 등)를 의도 분석이 discard로 제외하지 않고 별도 세션으로 새로
  생성(create)한 사례가 있었다 — 프롬프트 개선이 필요한 항목으로 식별되었다.

### 남은 일

- 크롬 실기기 수동 검증: 위 M2 항목에 정리된 SW 강제 종료 생존/디바운스/체류시간/
  유휴 트리거/동기화 백오프·복구/큐 상한 목록에 더해, M4~M5에서 추가된 TimelineView·
  SyncStatusCard 온보딩·SearchView 2그룹 렌더·Analytics 대시보드도 실제 Chrome에서
  아직 수동으로 확인하지 못했다.
- 노이즈 제외율 50%의 원인이 된 의도 분석 프롬프트의 discard 판단 기준 보강.
- 검색 score threshold(`0.35`, `docs/DecisionLog.md` 2026-07-12 항목) 실측 튜닝 —
  골든셋을 더 늘려 임계값 조정 여부를 재평가해야 한다.

### 완료 게이트 (fresh-eyes 교차 검토, 2026-08-04)

요구사항 원문과 diff만 보는 무맥락 리뷰어가 확인 결함 5건을 보고했고 전부 수정했다.

- [Critical] 수동/주기/유휴 동기화가 이벤트 전송만 하고 서버 배치 세션화를 호출하지
  않음 — "지금 저장"을 눌러도 세션이 생성되지 않는 결함. `sync/engine.ts`의 drain
  성공 후 `POST /sync`를 트리거 타입과 함께 호출하도록 연결(`triggerServerSync`,
  409/200은 정상 흐름 처리).
- [High] hold 판정 이벤트가 `processing`에 갇혀 재판단 불가(사실상 유실) —
  `session_updater.py` hold 분기에서 강제 create 대상이 아닌 이벤트를 `pending`으로
  명시 복귀 + 이를 검증하는 테스트 2건 보강.
- [High] SPA 연속 라우팅 시 다른 페이지 본문이 직전 이벤트에 부착될 수 있음 —
  `queue.attachContent`에 `status === 'open'` 가드 추가(finalize된 이벤트에는 부착 안 함).
- [Medium] Timeline 세션 배지가 '오늘' 외 날짜에서 표시되지 않음 — 서버 조회를
  로컬 synced 이벤트가 걸친 날짜별(최대 3일)로 확장(`fetchEventsByDate`).
- [Low] memory 검색 이벤트 타입이 실제 wire 형태와 불일치(`relevance_score`/
  `match_reason` → 실제는 `matched_by`/`session_title`/`active_duration_ms`) — 타입·매퍼 정정.

리뷰어가 지적한 6번째 항목(extension lib/events·lib/sync 단위 테스트 부재)은 이번
범위에서 테스트 프레임워크 도입 없이 수동 검증 목록으로 유지한다 — vitest 등 도입은
사용자 결정 필요 항목(신규 dev 의존성)으로 남긴다.

수정 후 재검증: backend 테스트 205개 통과, extension compile/build 통과.

## 2026-08-05 — AGENTS.md 실환경 정합 및 CLAUDE.md 단일화

### 요청

프로젝트 CLAUDE.md를 검토하고 개선점을 반영한다.

### 조사

- CLAUDE.md와 AGENTS.md가 바이트 단위 동일한 복사본 2개로 존재했다(드리프트 위험).
- 16장 환경 규칙의 테스트 명령(`.venv\Scripts\python.exe -m unittest discover -s tests`)이
  실제와 불일치 — 백엔드는 pytest(`pyproject.toml`의 `[tool.pytest.ini_options]`),
  `.venv`는 루트/backend 어디에도 없고 dev.sh는 `backend/.venv` 자동 감지 후 시스템
  Python 폴백, dev_conda.sh는 프로젝트 로컬 `.conda`를 사용한다.
- 문서 전체가 범용 프로세스 규칙뿐이라 모노레포 구조·파트별 검증 명령 등 프로젝트
  특화 정보가 없었다. docs/의 v2 설계 문서 4종도 문서 지도에 빠져 있었다.

### 변경

- `AGENTS.md` — "프로젝트 개요와 공식 명령" 섹션 신설(3파트 구조, dev 스크립트,
  파트별 검증 명령, eval 하네스 비용 경고). 2장에 큰 변경 기준 미만의 작은 변경은
  Plan.md 생략 가능 예외 추가. 5장에 v2 설계 기준 문서 4종 지도 추가. 16장을 실제
  환경(pytest, bash 전용 스크립트, Python 환경 감지 순서)에 맞게 교체.
- `CLAUDE.md` — 동일 복사본을 `@AGENTS.md` import 한 줄로 전환해 단일 소스 유지.

### 오류와 해결

- 없음.

### 검증

- `cd backend && python -m pytest -p no:asyncio --collect-only -q` — 205개 테스트
  정상 수집(문서화한 명령이 이 머신에서 동작함을 확인). 전체 테스트 실행과
  extension/frontend 빌드는 코드 변경이 없어 실행하지 않았다.

## 2026-08-05 — M6 검증: vitest 도입 + Playwright E2E 스모크

### 요청

남은 검증을 진행한다. Playwright MCP 설치와 vitest 도입을 사용자가 승인했다.

### 변경

- **Playwright MCP 등록** — `claude mcp add playwright`(cmd /c npx @playwright/mcp@latest,
  로컬 스코프). 연결 확인 완료. MCP 도구는 다음 Claude Code 세션부터 대화형으로 사용
  가능하며, 이번 세션 E2E는 스크래치패드의 Playwright 스크립트로 수행했다(저장소에
  E2E 코드 미포함).
- **vitest 도입** (`extension/`) — `vitest@4.1.10` + `fake-indexeddb` devDependency,
  `vitest.config.ts`, `tests/setup.ts`(fake-indexeddb/auto + `wxt/testing` fakeBrowser를
  chrome 전역에 설치), `tests/helpers.ts`, `package.json`에 `test: vitest run` 스크립트.
  WxtVitest 플러그인은 쓰지 않았다(DecisionLog 2026-08-05 참조).
- **단위 테스트 31개 신규** — `tests/unit/types.test.ts`(wire 변환·null 본문 치환·
  로컬 필드 제외), `tests/unit/queue.test.ts`(상태 기계: finalize/attachContent open
  가드/claim 순서·limit·백오프 대기 제외/markSynced/백오프 2^n·30분 상한/stale-syncing
  리셋/48h prune/evict synced 우선·droppedCount/개수 트리거 리스너),
  `tests/unit/engine.test.ts`(drain: manual 선마감, 50개 배치 반복, threshold→event_count
  매핑, 빈 큐 시 manual만 세션화 트리거, 실패 시 pending 복귀+재시도 알람+세션화
  미트리거, 세션화 트리거 실패 무해성).

### E2E 스모크 결과 (Playwright, 실 Chromium + 실 백엔드 + 실 LLM 1배치)

빌드 산출물(`.output/chrome-mv3`)을 launchPersistentContext로 로드, docker
postgres/qdrant(기존 가동) + uvicorn으로 백엔드 기동. **9/9 PASS**:

1. 확장 SW 기동 및 확장 ID 확인
2. 수집 기본 off(opt-in) — 온보딩 카드 렌더 스크린샷 확인
3. 실제 방문 3건(example.com/example.org/wikipedia) 이벤트 수집
4. 마지막 방문 open 유지, 이전 방문 finalize→pending 전이
5. SYNC_NOW 수동 동기화 → 전량 synced
6. syncStatus lastSyncAt/todayCount 기록
7. 서버 배치 세션화로 Auto Session 자동 생성 — "웹 브라우저 및 도메인 정보 탐색"
8. 동기화 후 사이드패널: 수집 상태 카드(3 방문/0 미처리/마지막 동기화), 타임라인
   이벤트 3건 + 세션 배지, 주간 탐색 분석 카드 렌더 확인(스크린샷)
9. 브라우저 재시작 후 IndexedDB 큐 생존(3건 유지)

관찰: example.org 이벤트는 세션 배지 없이 "동기화됨"으로 표시 — 의도 분석이 해당
이벤트를 세션에 미포함한 것으로 보임(노이즈 처리 경로 동작). 세션별 탐색 시간이
"0분"으로 표시(체류 수 초를 분 단위 반올림) — 표시 정책 검토 후보.

### 검증

- `pnpm test` (extension): 31 passed (3 files)
- `pnpm compile` (extension): 통과 (테스트 파일 포함 타입 검사)
- `pnpm build` (extension): 통과
- E2E 스모크: 9/9 PASS (위 상세)
- backend pytest는 이번 변경과 무관해 재실행하지 않았다.

### 오류와 해결

- Git Bash에서 `claude mcp add ... cmd /c`의 `/c`가 `C:/`로 경로 변환됨 —
  `MSYS_NO_PATHCONV=1`로 재등록.
- 첫 `pnpm compile`에서 테스트 타입 오류 2건 — mock 응답에 `EventBatchResponse`
  필수 필드(filtered/pending_total) 누락 보강, fakeBrowser alarms.create 타입이
  단일 인자 오버로드만 선언해 2인자 호출 검증부를 명시 캐스팅.

### 남은 일 (이전 목록 갱신)

- ~~수동 동기화·큐 생존·Timeline/SyncStatusCard/Analytics 렌더 수동 검증~~ → E2E로 확인 완료.
- 실기기 미검증 잔여: SW 강제 종료 시 체류시간 세그먼트 생존, 유휴/주기 트리거 실시간
  동작, SearchView 2그룹 렌더, 백엔드 다운 시 백오프 실기기 동작(로직은 단위 테스트로 커버).
- 노이즈 제외율 50% 원인인 의도 분석 discard 기준 보강(프롬프트).
- 검색 score threshold(0.35) 실측 튜닝 — 골든셋 확대 후 재평가.
- 세션별 탐색 시간 "0분" 표시 정책 검토(분 미만 반올림).

## 2026-08-05 — M6 검증(계속): SW 강제 종료 생존 + 유휴 트리거 E2E

### 요청

남은 실기기 검증 항목 중 SW 강제 종료와 유휴 트리거를 이어서 검증한다.

### 방법

Playwright E2E 스크립트 2탄(스크래치패드, 저장소 미포함). 새 프로필에 빌드 확장 로드,
uvicorn + 기존 docker로 백엔드 기동. SW 종료는 브라우저 레벨 CDP
`Target.closeTarget`으로 수행하고 종료 후 SW 타깃 부재를 재조회로 확인했다.

### 결과 — 14/14 PASS

**SW 강제 종료 생존:**
- 방문 A 후 활성 세그먼트가 `chrome.storage.session`(`orbit:activeSegment`)에 열림
- 8초 체류 후 SW 강제 종료 → 세그먼트가 동일 값(activeSince/eventId)으로 생존
- 방문 B로 SW 재기동 → A finalize(pending) + **체류시간 11.8초 정산** — 세그먼트
  열림→SW 사망 구간→B 방문까지 벽시계(14.8초) 내 전 구간 반영, 유실 없음
- 탭 상태(`orbit:tabState`)도 생존 — B가 A를 previousEventId/referrerUrl로 정확히 체이닝

**유휴 트리거:**
- SW 재기동 인스턴스에서 `idle.onStateChanged`/`alarms.onAlarm` 리스너 등록 확인
- collector가 유휴 진입 시 예약하는 것과 동일한 `orbit-idle-drain` 1회성 알람을 30초
  뒤로 예약 → 실제 chrome.alarms 발화 → `drain('idle')` 실행 → pending(A)만 synced,
  open(B)은 finalize되지 않음(설계 일치), 알람 소진(재예약 없음), lastSyncAt 갱신

**검증 한계(정직 고지):** 실제 OS 유휴(60초 무입력)로 `idle.onStateChanged`가 발화하는
구간은 사용 중인 기기에서 자동화 불가 — 리스너 등록 확인 + 알람→drain 체인 실발화로
대체했고, "idle 진입 → 알람 예약" 10줄 리스너는 코드 리뷰로 갈음했다. 완전한 확인이
필요하면 idleSyncMin=1로 두고 기기를 약 2.5분 방치하는 수동 테스트로 가능하다.

### 오류와 해결

- 1차 실행에서 "SW 종료 후 세그먼트 생존" FAIL — 테스트 스크립트가 SW를 죽이기 전에
  `chrome://serviceworker-internals` 탭을 열어 `tabs.onActivated`가 세그먼트를 먼저
  정산(제품의 정상 동작). CDP 전용 kill(탭/포커스 무변화)로 스크립트를 수정해 재실행,
  제품 결함 아님.

### 남은 일

- SearchView 2그룹 렌더 실기기 확인(다음 세션에서 Playwright MCP로 가능).
- 노이즈 제외율 50% — 의도 분석 discard 기준 프롬프트 보강.
- 검색 score threshold(0.35) 실측 튜닝.
- 세션별 탐색 시간 "0분" 표시 정책 검토.

## 2026-08-05 — SearchView E2E + 의도 분석 discard 프롬프트 보강

### 요청

SearchView 2그룹 렌더 검증을 마치고 discard 프롬프트를 보강한다.

### SearchView E2E — 5/5 PASS

Playwright로 사이드패널 Ask AI 탭에서 "웹 브라우저 탐색하던 기록" 검색(실 임베딩 호출):
결과 상태("관련 결과 5개"), 그룹1 "세션"(SessionCard 2개 + 복원 버튼), 그룹2 "관련
기록"(TimelineItem 3개) 렌더를 스크린샷과 함께 확인. 이로써 실기기 검증 목록의 마지막
항목이 완료됐다.

### discard 프롬프트 보강 (intent_analyzer.py, PROMPT_VERSION v1→v2)

증상: 노이즈 제외율 50% — 골든셋의 노이즈 이벤트 2개(Instagram 15초/20초) 중 하나를
discard하지 않고 별도 세션으로 create.

반복 실험 과정(각 라운드 실 LLM 평가):
1. discard 기준에 "짧은 스침 방문(SNS 등)" 추가 → noise 100%가 됐지만 과교정 —
   여행 흐름의 Google 번역(1.5분)까지 discard(accuracy 86.7%).
2. 도구성 방문 보호 지침 추가("번역기·지도 등이 주제 흐름에 속하면 포함") →
   1회차 전 지표 100%. 그러나 재실행에서 noise 50%, MDN→여행 그룹핑 오류 재발 —
   temperature 미지정(0.3)의 실행 간 변동성 확인.
3. temperature=0.0 고정 → 완전 결정적(3회 동일)이지만 나쁜 greedy 경로에 고정:
   여행+코딩 인터리브 이벤트를 세션 하나로 뭉침(coverage 0.75, noise 50%).
4. "서로 다른 주제는 assignment 분리" 지침 + JSON 예시를 다중
   assignment(append/create/discard 3건)로 확장 → greedy 경로 교정.

최종 결과(temp 0, 3회 실행): accuracy 100/100/100, purity 100/95/100,
coverage 100/100/100, noise **100/50/100**(기준선: 항상 50), new_vs_existing 100×3.
잔여 변동은 temp 0에서도 남는 API 측 비결정성(또는 primary→fallback 모델 전환).

### 검증

- backend `python -m pytest -p no:asyncio`: 205 passed (temperature 파라미터 추가 후 재실행)
- 평가 하네스 총 9회 실행(실 LLM) — 위 라운드별 수치 참조

### 남은 일

- 노이즈 제외를 결정적으로 만들려면 서버측 사전 필터(예: 체류 30초 미만 + SNS 도메인
  → LLM 무호출 discard) 도입 검토 — 데이터 처리 정책 변경이라 사용자 결정 필요.
- 검색 score threshold(0.35) 실측 튜닝, 세션별 탐색 시간 "0분" 표시 정책 검토(기존 항목 유지).
- 골든셋 확대(현재 노이즈 이벤트 2개뿐이라 노이즈 지표가 50%p 단위로만 움직임).

## 2026-08-05 — 평가 골든셋 확대 (3→7개 시나리오, 노이즈 2→9개)

### 요청

노이즈 사전 필터는 열린 결정으로 남기고(DecisionLog 표에 등록), 골든셋을 확대한다.

### 변경

`backend/eval/golden/`에 시나리오 4개 추가:

- `job_search_with_sns_checks.json` — 이직 준비 탐색 사이에 습관적 스침 3개
  (Instagram 12초, 네이버 홈 9초, X 홈 18초). 인터리브 노이즈의 discard 검증.
- `trip_flow_with_tool_visits.json` — 여행 준비 흐름 속 짧은 도구성 방문
  (구글 지도 45초, 번역 40초, 검색어 있는 30초 방문). 노이즈 0개 — discard
  과교정을 잡는 가드 시나리오.
- `existing_session_with_noise.json` — 기존 세션 append와 discard 혼합
  (YouTube Shorts 14초, 다음 홈 8초 + React 상태관리 학습 이어가기).
- `shopping_with_ad_and_error_noise.json` — 광고 배너 랜딩(5초, utm 파라미터)과
  404 오류 페이지(4초) 노이즈. 유형별 discard 기준 검증.

이벤트 id ↔ expected.assignments 키 일치를 스크립트로 확인했다.

### 평가 결과 (프롬프트 v2 + temp 0, 전체 7개 시나리오 42이벤트)

- 3회 연속 전체 실행: **5개 지표 모두 100% × 3회** (assignment/purity/coverage/
  noise/new_vs_existing).
- 노이즈 지표 해상도가 이벤트 2개(50%p 단위) → 9개(11%p 단위)로 개선.
- 단, 단일 시나리오 예비 실행 1회에서 낮은 점수(accuracy 0.4) 후 재실행 정상 —
  temp 0에서도 API 측 변동성이 잔존함을 재확인. 평가는 단일 실행이 아니라 3회
  이상 반복으로 판단해야 한다.

### 검증

- 골든셋 무결성 검사(7파일 전부 events↔expected 키 일치) 통과
- `python -m eval.run_eval` 전체 3회 실 LLM 실행 — 위 수치
- 코드 변경 없음(데이터 추가만) — backend pytest 재실행 생략

### 남은 일

- 검색 score threshold(0.35) 실측 튜닝 — 골든셋이 확대됐으므로 이제 착수 가능.
- 평가 반복 실행 자동화(`--runs N` 플래그 등)는 CLI 변경이라 필요 시 별도 결정.
- 세션별 탐색 시간 "0분" 표시 정책 검토(기존 항목 유지).
- main 병합.

## 2026-08-05 — 검색 score threshold 실측 튜닝 (0.35 → 0.28)

### 요청

골든셋 확대에 이어 검색 threshold 튜닝을 진행한다.

### 변경

- `eval/golden_retrieval.json` 신규 — 세션 요약 10개(분류 골든셋 7개 주제 + 요리/
  세금/캠핑 distractor 3개), 긍정 질의 14개(SearchView 사용 문체), 음성 질의 5개.
- `eval/run_retrieval_eval.py` 신규 — 실제 파이프라인과 동일한 passage 텍스트
  구성(`build_embedding_text`)과 비대칭 임베딩(passage/query)으로 코사인 점수 행렬을
  만들고 threshold 0.20~0.60 스윕(Recall@1/@3, 음성 차단율). Qdrant Cosine 점수와
  동일 값이라 별도 컬렉션 없이 측정 가능.
- `app/config.py` — `search_score_threshold` 기본값 0.35 → 0.28 (근거 주석 포함).
- `eval/README.md` — 검색 평가 사용법 추가.

### 실측 결과

| threshold | R@1 | R@3 | 음성 차단 |
|---|---|---|---|
| 0.25 | 100% | 100% | 80% |
| **0.28** | **100%** | **100%** | **100%** |
| 0.30 | 92.9% | 92.9% | 100% |
| 0.35(기존) | 85.7% | 85.7% | 100% |

- 분리 구간: 음성 최고 0.2648 < 정답 최저 0.2888. 기존 0.35는 짧은 자연어
  질의("리트코드 문제 풀던 세션" 등) 2건을 유실하고 있었다.
- Recall@1 = Recall@3 전 구간 동일 — 랭킹 자체는 정확하고 threshold가 유일한 병목.

### 검증

- backend `python -m pytest -p no:asyncio`: 205 passed (기본값 변경 후)
- `python -m eval.run_retrieval_eval` 2회 실행(임베딩 결정적 — 두 실행 점수 일치)
- 0.28 단독 검증: 정답 통과 100%, 음성 차단 100%

### 남은 일 / 주의

- 분리 폭이 0.024로 좁다 — 검색 골든셋을 확대하면 재검증 필요(스크립트로 재실행만 하면 됨).
- 세션별 탐색 시간 "0분" 표시 정책 검토(기존 항목 유지).
- main 병합.

## 2026-08-05 — LLM 재배정 (클러스터링=EXAONE, 요약·의도분석·리랭킹=A.X)

### 요청

사용자 자체 평가 결과에 따라 클러스터링은 LG EXAONE, 세션 요약·채팅·리랭킹은 SK
A.X를 쓰도록 재배정한다. 확인 질의로 결정: A.X는 기존 A.X-K1 유지, 의도분석도 A.X
유지, 폴백은 상호 폴백(A.X ↔ EXAONE).

### 변경

- `app/config.py` — FriendliAI 설정 3종 추가(friendli_api_key/base_url/exaone_model),
  Solar 채팅 모델 설정 제거(Upstage는 임베딩 전용).
- `app/ai/llm.py` — `chat_completion_light`: EXAONE 우선 → A.X-K1 폴백.
  `chat_completion(_with_meta)`: A.X-K1 우선 → EXAONE 폴백. EXAONE 호출에
  `chat_template_kwargs.enable_thinking=false` 상시 전달(아래 실측 참조), 감사용
  모델명은 `exaone/<endpoint id>` 라벨.
- `app/ai/reranker.py` — light → `chat_completion`(A.X 경로) 전환, temperature 0.1 유지.
- `tests/test_reranker.py` — monkeypatch 대상 갱신.
- `.env.example` — FriendliAI 항목 추가, SEARCH_SCORE_THRESHOLD 0.28 정정.
  실 키는 `backend/.env`에만 추가(커밋 안 됨).

### 실측과 발견

- EXAONE 4.0은 hybrid reasoning 모델 — thinking을 끄지 않으면 max_tokens를 추론
  트레이스에 소모하고 `message.content`가 null로 온다. `enable_thinking=false`로 해결.
- **엔드포인트 지연 문제(미해결)**: FriendliAI dedicated endpoint가 웜 상태 연속
  4회 호출에서 57~62초/호출. 25초 타임아웃에 걸려 클러스터링이 항상 A.X로 폴백된다
  (시스템은 정상 동작하나 EXAONE 미활용 + 호출당 25초 낭비). 콜드스타트가 아님을
  확인(연속 호출 동일). FriendliAI 콘솔에서 인스턴스 사양/sleep 설정 확인 필요 —
  DecisionLog 열린 결정 등록.

### 검증

- backend `python -m pytest -p no:asyncio`: 205 passed
- 실호출 스모크: A.X primary 정상, EXAONE 타임아웃 → A.X 폴백 정상(fail-open),
  A.X 강제 다운 → EXAONE 폴백 시도 확인(현재는 지연으로 타임아웃)
- README 기술 스택 표·핵심 기능 서술 갱신

## 2026-08-05 — EXAONE serverless 전환 (속도 재측정 결과)

### 요청

EXAONE 엔드포인트 속도를 재측정한다.

### 측정

- dedicated 재측정 5회: 54~70초/호출 — 변화 없음. 타이밍 분해로 원인 확정:
  DNS 0.02초/연결 0.08초/TLS 0.14초/**첫 바이트 55.1초** → 전부 서버측 지연.
- 같은 토큰의 serverless 모델 목록에서 `LGAI-EXAONE/K-EXAONE-236B-A23B` 발견
  ($0.2/$0.8 per M). 3회 측정: **0.34~0.53초** + enable_thinking=false 정상 동작.
- 사용자 결정: serverless 전환.

### 변경

- `app/config.py` — friendli_base_url 기본값 serverless로, exaone_model 기본값
  `LGAI-EXAONE/K-EXAONE-236B-A23B`(공개 모델명이라 코드 기본값 가능).
- `backend/.env` — dedicated endpoint ID 제거(기본값 사용). `.env.example` 정리.

### 검증

- backend pytest 205 passed
- 실배선 스모크: EXAONE light 3회 0.38~2.27초(첫 호출만 클라이언트 초기화 포함),
  A.X with_meta 0.52초, A.X 강제 다운 → EXAONE 폴백 3.25초 성공
  (`model=exaone/LGAI-EXAONE/K-EXAONE-236B-A23B` 감사 라벨 확인).
- 관찰: serverless는 버스트 rate limit 있음 — 테스트 연속 호출 중 429 1회, 45초 후
  회복. 전역 0.5초 리미터로 통상 트래픽은 문제없다고 판단, DecisionLog에 기록.

## 2026-08-05 — 클러스터링 실경로 스모크 (EXAONE 전환 후)

### 요청

main 병합 전, LLM 재배정에서 유일하게 실측이 빠졌던 스냅샷 클러스터링 경로를 검증한다.

### 검증

- 클러스터러 직접 호출 2회(여행 3탭 + React 3탭 혼합): 1.1~2.5초, 두 번 모두 주제별
  2그룹 정확 분리, 폴백 경고 없음(EXAONE serverless가 직접 응답).
- `POST /sessions/cluster` 전체 경로(실 서버·docker): HTTP 201, 4.1초에 세션 2개
  생성 — "상태 관리 전략 분석", "오사카 여행 준비". 요약(A.X) 둘 다 done, 서버
  로그에 폴백/오류 없음.

이로써 재배정된 모든 LLM 경로(클러스터링=EXAONE, 요약·의도분석·리랭킹=A.X, 상호
폴백)가 실측 검증됐다. 다음: main 병합.

## 2026-08-05 — 도그푸딩 1차 피드백 수정 (세션 최신성·후보 recency·골든셋 실데이터화)

### 요청

도그푸딩 첫날 사용자 보고 2건을 조사·수정한다: ① 항공권 세션에 무관 방문(대학 포털
로그인·Kaggle 홈)이 섞임 ② 새로 만들어진 세션이 옛 테스트 세션들 밑에 깔림. 조사 후
사용자 승인으로 4개 항목(정렬 수정·후보 recency 컷·골든셋 확장·테스트 세션 삭제)을
모두 진행했다.

### 조사 결과

- "밑에 깔린 새 세션"의 정체: 새 세션이 아니라 **7/3 테스트 세션에 append**된 것.
  벡터 유사 후보에 시간 제한이 없어 한 달 전 세션이 후보로 올라갔고 LLM이 append했다.
  목록 정렬·표시가 `created_at` 기준이라 append된 세션이 옛 날짜로 아래에 묻혔다
  (`last_activity_at`은 정상 갱신되고 있었으나 정렬·표시에 미사용).
- `DELETE /sessions/{id}`가 자식 행(`session_events`, `session_versions`)을 지우지
  않아 버전이 있는 세션 삭제 시 FK IntegrityError가 나는 잠재 결함 발견(테스트 세션
  삭제에 필요해 함께 수정).
- 실데이터 체류시간은 골든셋 가정(분 단위)과 달리 초 단위(항공권 42s·5s, 검색 5s)로
  훨씬 마진이 얇았다.

### 변경

- `backend/app/api/sessions.py` — 목록 정렬 `coalesce(last_activity_at, created_at) desc`,
  `_to_detail`에 last_activity_at 포함, delete_session이 자식 행 정리 후 삭제.
- `backend/app/schemas/session.py` — `SessionDetail.last_activity_at`(nullable) 추가.
- `backend/app/services/sync_pipeline.py` — 후보 세션에 recency 컷 7일 적용
  (벡터 후보 포함, `_CANDIDATE_MAX_AGE_DAYS`), 후보 dict에 `last_activity_days_ago`.
- `backend/app/services/intent_analyzer.py` — 후보 프롬프트 라인에 "마지막 활동:
  오늘/N일 전" 표기(없으면 생략, 골든셋 하위호환), PROMPT_VERSION v2→v3.
- `backend/eval/golden/` — 실데이터 시나리오 2개 추가:
  `flight_rebooking_with_stray_visits`(주제 맞는 후보 존재), 
  `flight_search_vs_generic_candidate`(일반 제목 후보만 존재 — 라이브 실패 재현).
- `extension/lib/api.ts`, `frontend/src/lib/api.ts` — timeLabel을
  `last_activity_at ?? created_at` 기준으로. `SessionDetailView` 라벨 "저장"→"활동".
- 테스트: `test_sync_pipeline.py` 후보 포맷 갱신, `test_intent_analyzer.py`에
  후보 라인 표기/생략 테스트 추가.

### 프롬프트 보강 시도와 반려 (중요 발견)

- discard 예시 확대("사이트 홈·로그인 화면")와 "스침 방문 끼워넣기 금지" 지침을 각각
  시도 → 둘 다 job_search 시나리오를 무너뜨림(정확도 100%→40%, 후자는 2회 재현).
  **두 보강 모두 반려**하고 v3는 후보 최신활동 표기만 유지.
- **A.X-K1은 temperature 0에서도 실행 간 판정이 흔들린다** — 같은 프롬프트로 전체
  골든셋이 100% ↔ 실패 2건을 오감(서버측 비결정성). 특히 초 단위 체류의 경계 이벤트
  (스침 방문)는 discard/hold/세션 혼입 사이를 오간다. 배정 정확도는 안정적으로 높음
  (97~100%), 노이즈 제외율만 변동(0~100%). → 프롬프트 미세조정으로 해결 불가.
  구조적 해법(노이즈 사전 필터)의 우선순위를 상향해 열린 결정에 반영.
- 최종 확정 평가(9개 시나리오): 배정 정확도 97.4%, purity 97.9%, coverage 100%,
  new/existing 100%, 노이즈 제외 69.2%(변동 구간).

### 데이터 정리 (사용자 삭제 승인)

- 테스트 세션 21개 삭제: 7/3 세션 17개 + 오늘 스모크 4개(example.com 3개 +
  클러스터링 스모크 "상태 관리 전략 분석"). 수정된 DELETE로 FK 오류 없이 완료.
- 항공권 실이벤트 5건 재세션화: LLM 재배치를 2회 시도했으나 매번 다른 형태로 뒤섞임
  (1차: GitHub 세션에 전부 append, 2차: 한밭대가 GitHub 세션에 붙고 세션 제목까지
  "한밭대 포털 로그인"으로 오염, 42초 핵심 방문은 discard). **LLM 재배치 중단** 후
  결정적 수술로 복구: 한밭대(2건)·Kaggle 이벤트 분리·discard, 항공권 3건을 한 세션
  ("제주 항공권 검색")으로 통합(오폐기 42초 방문은 `assigned_by='user'`로 복원),
  `_resync_tabs`·통계 재계산·retry-summary로 마무리.
- 최종 상태: 실사용 세션 3개(브라우저 탐색/가비아/제주 항공권 검색)만 남음.
- 관찰: 배치가 discard로 마킹한 이벤트의 session_events 행이 남아 있는 사례 1건 발견
  (원인 미상 — 재발 시 apply_assignments 트랜잭션 검토 필요).

### 검증

- backend `python -m pytest -p no:asyncio`: 207 passed
- extension `pnpm test`(31 passed) + `pnpm compile` + `pnpm build`: 통과
- frontend `pnpm build`(tsc 포함): 통과
- 평가 `python -m eval.run_eval`: 위 "프롬프트 보강" 절 참조(사용자 승인 하 실행)
- 라이브 확인: 세션 목록이 마지막 활동 기준 정렬로 반환, last_activity_at 필드 노출,
  DELETE 자식 정리 21회 무오류

## 2026-08-05 — 노이즈 사전 필터 (결정적 규칙) + discarded 이벤트 Timeline 뱃지

### 요청

프롬프트로 못 잡는 스침 방문 혼입을 결정적 규칙으로 차단한다(직전 세션의 "프롬프트
추가 보강 반려" 후속). 사용자 승인 사항: 규칙은 추천안(로그인·습관성 60초/고립 루트
30초)대로, discarded 이벤트는 Timeline에 "제외됨" 뱃지로 계속 노출.

### 설계 핵심

실데이터에서 의미 있는 탐색도 5~42초였다는 게 설계 제약이었다 — 체류시간 단독 컷은
탐색 본체를 날린다. 그래서 "짧으면 버린다"가 아니라 **구제 조건(검색어/도메인 반복/
체류 미측정) 우선 + 짧음이 특정 신호(로그인 경로·습관성 도메인·고립 루트)와 겹칠
때만 좁게 버린다"** 로 설계했다.

### 변경

- `backend/app/services/noise_filter.py` — 신규 순수 함수 모듈. `split_noise(group)`,
  `is_noise(event, domain_counts)`, `is_short_stray(event)`.
- `backend/app/services/sync_pipeline.py` — `_process_group`에서 is_system_url 재검사
  직후 `split_noise` 적용, 걸린 이벤트를 discarded로.
- `backend/app/services/session_updater.py` — hold 상한 도달 시 짧은 스침은 강제
  create 대신 discard(`is_short_stray`).
- `backend/app/api/events.py` + `schemas/event.py` — `GET /events?date=`가 discarded도
  반환, `EventListItem.excluded` 추가(sync_status=='discarded').
- `backend/eval/run_eval.py` — 실 파이프라인과 동일하게 LLM 전 `split_noise` 적용.
- `extension/` — `TodayEvent.excluded`, api 매퍼, `TimelineBadge`에 'excluded' 종류
  추가, `SessionBadge`에 "제외됨" muted 뱃지, useTimeline 매핑.
- 테스트: `test_noise_filter.py` 신규(15), `test_session_updater.py` hold 정책 갱신 +
  스침 discard 케이스 추가, `test_events_api.py` excluded 플래그 테스트 추가.

### 오류와 해결

- `test_events_api.py`의 SimpleNamespace 이벤트 픽스처에 `sync_status`가 없어
  `event.sync_status == "discarded"`에서 AttributeError → 픽스처 3개에 sync_status 추가.
- hold 정책 변경으로 기존 forced-create 테스트 2개가 깨짐(기본 이벤트가 1초/검색어
  없음 → 이제 스침으로 분류되어 discard) → 테스트를 긴 체류(120초) 이벤트로 수정하고
  스침 discard 전용 테스트 추가.

### 검증

- backend `python -m pytest -p no:asyncio`: **224 passed**
- extension `pnpm test`(31) + compile + build: 통과
- frontend build: 통과
- 골든셋 평가 2회(사용자 승인 범위): **노이즈 제외율 69%(변동) → 100%(결정적)**,
  배정 정확도·purity·coverage 100% 고정, 실패 0건. 남은 new/existing 변동(88.9%↔100%)은
  append vs create LLM 판단으로 이 필터 범위 밖.

## 2026-08-05 — AI 챗 대화 URL 정규화 + 노이즈 필터 진입화면 규칙 + 재세션화

### 요청

세션에 이질 주제가 뒤섞이는 도그푸딩 2차 피드백("여름 음악에 명함") 조사·수정.
사용자 승인: ①(AI 챗 URL 정규화)+③(노이즈 필터 보강) 후 재세션화.

### 조사 결과

- `chatgpt.com/c/<id>` 대화 하나가 SPA nav로 최대 5~6개 이벤트로 수집됨. 같은
  normalized_url인데도 여러 배치에 흩어져 dedup을 못 거쳐 여러 세션으로 파편화.
- 노이즈 필터 "도메인 반복" 구제가 `chatgpt.com/`(진입 화면)을 살려버림.
- **추가 발견(범위 밖)**: LLM이 시간 인접한 이질 주제(음악·맥미니 구매·브랜딩)를
  한 세션에 뭉치고, 그룹 간 append로 확산. 이건 ①③으로 해결 안 되는 별개 문제.

### 변경

- `backend/app/services/event_filter.py` — `_AI_CHAT_HOSTS` 상수·`_is_ai_chat_host`,
  normalize_url이 AI 챗 도메인은 query를 통째로 제거(휘발성 messageId 등 제거).
- `backend/app/services/noise_filter.py` — AI 챗 진입 화면(대화 id 없는 루트·/new)을
  도메인 반복 구제보다 우선해 discard(검색어·체류 미측정 구제는 유지).
- 테스트: `test_event_filter.py` 정규화 4케이스, `test_noise_filter.py` 진입화면 4케이스.

### 재세션화

- 오염 세션(event-origin 4개) 삭제, 전체 이벤트 normalized_url 재계산·pending 복귀
  후 수동 sync 1배치. **주의**: 1차 시도는 구코드 서버(b05cbaa)로 돌아 진입화면
  규칙이 미적용됐다 — 서버를 현재 코드로 재기동 후 재실행해 바로잡음.

### 검증

- backend `python -m pytest -p no:asyncio`: **231 passed**
- 골든셋 평가 1회: 전 지표 100%, 실패 0건(회귀 없음)
- 재세션화 결과:
  - ✅ 대화 파편화 해소: 6a6b4e7b 5→1, 6a73028c 6→1 이벤트로 dedup.
  - ✅ `chatgpt.com/`(31s) 진입 화면 discard됨(구코드에선 생존했던 것).
  - ✅ 항공권 세션은 08:49·11:02 방문이 깔끔히 한 세션으로.
  - ❌ **미해결**: LLM이 "여름 음악 및 맥미니 구매"(음악+구매+브랜딩+명함 9개),
    "메일 및 브라우저 분석"(메일+로고+옛 위키 6개)처럼 이질 주제를 여전히 뭉침.
    노이즈 필터는 스침만 제거하고 주제 분리는 LLM 몫인데 A.X가 실패 — 별도 과제.
  - 잔여: 옛 테스트 이벤트(example.com, Web browser Wikipedia 06:45)가 재유입돼 오염.

## 2026-08-05 — 의도분석 EXAONE-primary 하이브리드 전환 + v4 프롬프트 + 실데이터 검증

### 요청

공정 재평가에서 EXAONE(튜닝)이 A.X와 대등함을 확인한 뒤, 사용자 결정: "EXAONE을 메인으로,
너무 오래 대기하면 A.X로 fallback, 실데이터로 검증."

### 변경

- `app/ai/llm.py` — `chat_completion_intent(system, user) -> (content, model)` 신설.
  EXAONE primary → A.X-K1 fallback. 핵심: FriendliAI 클라이언트를 `max_retries=0` +
  `timeout=12s`로 만들어 429/지연 시 내부 백오프 없이 **즉시** A.X로 폴백(오래 대기 방지).
  기존 `chat_completion_with_meta`(A.X primary)는 `chat_completion`(요약·리랭킹)이 감싸므로
  건드리지 않고 별도 함수로 분리.
- `app/services/intent_analyzer.py` — `chat_completion_intent` 사용, PROMPT_VERSION v3→v4.
  v4 = 공정 재평가에서 EXAONE 과분할을 잡은 튜닝 프롬프트: 시스템 프롬프트에 "같은 주제는
  하나로 묶어라" 원칙, 유저 템플릿에 "[매우 중요 — 과분할 금지]" 블록(WRONG/RIGHT 예시 +
  title·purpose 강제).
- `tests/test_intent_analyzer.py`, `eval/run_eval.py` — 목/패치 대상 함수명 갱신.

### 검증

- backend pytest: **231 passed**
- 골든셋 하이브리드 end-to-end: 배정·순도·커버리지·노이즈 100%, 실패 0건(무회귀).
- **실데이터 재세션화(139개 이벤트)**:
  - EXAONE 폴백 **3건만** 발생(나머지 그룹은 EXAONE 처리) — fair_eval의 429 폭주와 달리
    실제 배치는 그룹 간 임베딩·DB·0.5초 스로틀로 호출이 벌어져 EXAONE이 대부분 통과.
    max_retries=0 덕에 폴백도 즉시(20~40초 대기 없음). 배치 오류 0.
  - **주제 분리 대폭 개선**: 기존 "여름 음악 + 맥미니 + 브랜딩" 한 덩어리 →
    "맥미니 M4 구매"(6) / "여름 플레이리스트"(2) / "AI 기반 디자인"(3)으로 정확히 분리.
  - 139개 → 12개 응집 세션 + 8개 discard(노이즈 필터). 예: "이터널 리턴 플레이어 분석"
    33개 전부 dak.gg 단일 주제로 깔끔.
  - **잔여 한계**: "항공권 예약 및 결제 확인"(16)은 항공권 + 확인 메일 여러 개가 뭉쳐 있음
    (예약→확인메일 흐름으로 볼 여지도 있으나 nangman.cloud 메일 9건·github는 과포함).
    v4로 최악의 뭉침은 사라졌으나 flight+mail류 잔여 뭉침은 남음.

### 알려진 이슈(경미)

- `SyncBatch.model` 감사 필드가 그룹별 사용 모델 집합에서 임의 1개만 기록(`next(iter(...))`)해
  이번 배치가 EXAONE 위주였는데도 "A.X-K1"로 표기됨. 폴백률 관측을 위해 향후 개선 여지.

## 2026-08-05 — 잔여 뭉침(flight+mail) 개선(프롬프트 v5) + 배치 감사 필드 개선

### 요청

하이브리드 전환 후 남은 flight+mail 뭉침을 개선하고, 폴백률이 안 보이던 감사 필드를 개선.

### 조사

"항공권 예약 및 결제 확인"(16개)을 뜯어보니 항공권(08:49~08:50)과 메일 확인
(11:04~11:23, 약 2.5시간 뒤)이 한 세션. 원인은 그룹 내 뭉침이 아니라 **그룹 간 과잉
append** — 나중 메일 그룹 처리 시 방금 만든 항공권 세션이 후보로 잡혀 LLM이 "결제 확인"
으로 append. 나망 받은편지함 8건은 대부분 1~6초 습관성.

### 변경

- `app/services/intent_analyzer.py` — PROMPT_VERSION v4→v5. "받은편지함·메일 목록 같은
  일반 메일 확인은 특정 작업의 확인 메일이 명백하지 않으면 무관한 세션에 append하지 말고
  별도 '메일 확인' 세션(create)으로, 스침이면 discard" 지침 추가.
- `app/services/sync_pipeline.py` — `_summarize_models()` 신설. 배치 `model` 감사 필드를
  그룹별 사용 모델 카운트 요약으로 기록(예: `exaone:12,A.X-K1:3`). EXAONE 긴 라벨은
  "exaone"으로 축약, String(50) 상한. `_process_batch`가 Counter로 집계.
- `eval/golden/mail_browsing_not_appended_to_flight.json` — 신규. 항공권 후보 + 업무 메일
  읽기(명확한 활동) → 별도 mail_check 세션으로 분리(항공권에 append 금지) 검증.
- 테스트: `test_summarize_models_counts_and_shortens` 추가, `_process_batch` 모델 단언 갱신.

### 검증

- backend pytest: **232 passed**
- 골든셋 전체(10개): 배정·순도·커버리지·노이즈 100%, 실패 0건. 신규 메일 시나리오 단독
  2회 모두 100%(항공권에 안 붙고 별도 세션). (초기 시나리오는 15~26초 스침이라 noise/hold
  경계로 불안정 → 명확한 메일 읽기 활동으로 개정해 안정화.)
- **실데이터 재세션화(139개, v5)**:
  - 감사 필드 `exaone:3,A.X-K1:1` — 4개 그룹 중 EXAONE 3 / A.X 폴백 1 관측 가능.
  - flight+mail 뭉침 해소: 항공권 2세션(전부 flight.naver), 나망 메일 9건 → 독립 세션,
    네이버 메일 2건 → 독립 세션, gmail/github 각각 분리. 15개 세션 모두 응집 도메인.

### 남은 한계(경미)

- 항공권이 시간 버스트에 따라 2세션으로 분리됨(둘 다 flight, 오분류 아님·경미한 과분할).
- 나망 받은편지함 세션 제목이 내용 기반 "이메일 마케팅 자동화 분석"으로 다소 부정확(분리는
  성공). 습관성 짧은 inbox 스침의 세션화 vs discard 경계는 추후 노이즈 필터 확장 후보.

## 2026-08-05 — 메일 목록 보기 노이즈 규칙(C안: 실제 읽은 메일만 기억)

### 요청

사용자 결정: 받은편지함·폴더 목록 새로고침은 기억 안 함, 실제로 읽은 메일만 세션화.

### 변경

- `app/services/noise_filter.py` — 웹메일 목록/폴더 보기 규칙 추가. `_MAIL_HOST_RE`
  (mail.*/outlook.*), `_MAIL_LIST_PATH_RE`(inbox/folders/sent/…), `_MAIL_MESSAGE_PATH_RE`
  (message/read/msg/view). `_is_mail_list_view`: 웹메일 호스트 + 목록 경로 + 개별 메일
  읽기 아님 → discard. is_noise에서 체류·도메인 반복과 무관하게 최우선 적용(받은편지함
  버스트가 도메인 반복 구제에 걸리지 않도록). gmail은 정규화 후 /mail/u/N/ 하나라
  목록/읽기 구분 불가 → 규칙에 안 걸려 보존(LLM 판단).
- `eval/golden/mail_inbox_refresh_is_noise.json` — 신규(목록 보기 4건 → 전부 noise).
- 테스트: test_noise_filter에 목록 discard·메일 읽기 보존·gmail 보존·도메인 반복 우회 6건.

### 검증

- backend pytest: **237 passed**
- 골든셋 11개: 배정·순도·커버리지·노이즈 100%, 실패 0건(무회귀). mail_inbox_refresh 노이즈
  100%, mail_browsing(개별 읽기) 세션화 100%.
- 실데이터 재세션화(139개): 나망 받은편지함 목록 보기 전부 discard, "이메일 마케팅 자동화
  분석" 잡동사니 세션 소멸. 세션에 남은 메일은 gmail 루트·네이버 루트(구분 불가, 의도적 보존)뿐.

### 이번 run에서 재확인된 구조적 문제(메일 규칙과 무관)

- "여행 계획 및 항공권 검색"(18개)이 항공권+브랜딩(ChatGPT 명함·로고)+맥미니 구매+여름
  플레이리스트+github을 흡수한 메가 뭉침 발생. 원인은 **그룹 간 과잉 append** — 직전 run은
  잘 분리됐으나 이번엔 뭉침(LLM 변동). 재세션화 품질이 run마다 출렁이는 근본 원인.
- 프롬프트 튜닝(v4 과분할 금지, v5 메일)은 특정 케이스는 잡지만 그룹 간 append 불안정을
  구조적으로 못 잡는다. append 게이팅(벡터 유사도 하한+시간 근접) 또는 그룹 내 임베딩
  서브클러스터링이 필요 — DecisionLog "LLM 주제 뭉침" 열린 결정과 연결.

## 2026-08-12 — 사이드패널 개편: 세션 행 리스트 + Ask AI 상시 독

브랜치 `feat/sidepanel-redesign`. 시안 두 장(세션 탭 행 리스트, Ask AI 답변 화면) 기준.

사용자 결정: 행 클릭=상세·caret=인라인 펼침, 복원/삭제는 펼친 영역 액션 줄, 요약 중·실패는
접힌 행에서도 표시, 병합 제안은 세션 탭 상단 유지, 열린 탭은 세 번째 탭으로 승격, 입력창은
메인 탭에만(상세·설정 제외), 현재 세션(수동 저장)은 제거. 타임라인·설정은 다음 섹션.

### 변경

- `store/ui.ts` — `View` 에서 `search` 제거, `tabs` 추가. `askOpen`/`openAsk`/`closeAsk` 신설.
  `openSession` 이 `askOpen` 을 함께 끈다(상세에는 독이 없어 답변 화면을 되돌릴 수 없음).
  독 노출 화면을 `isAskDockView` 로 한 곳에 모음. 쓰이지 않던 `searchQuery` 와 호출자가
  사라진 `isClustering`/`startClustering`/`stopClustering` 제거.
- `components/SessionRow.tsx` — 신규. 행 리스트 아이템. caret 펼침, 도메인 중복 제거 파비콘
  스택(최대 4 + `+N`), 펼친 영역에 요약·탭 목록·복원/삭제 액션 줄.
- `components/AskDock.tsx` — 신규. 하단 상주 입력창. 전송 시 `openAsk()` + `ask()`.
  플레이스홀더 회전과 스트리밍 중단 버튼은 기존 SearchView 동작을 옮김.
- `views/AskView.tsx` — 신규. 답변 오버레이. 항상 마운트한 채 `translate-y` 로만 오르내린다
  (언마운트하면 대화 스크롤 위치가 매번 초기화됨).
- `views/OpenTabsView.tsx` — 신규. `OpenTabsPanel` 컨테이너.
- `views/SessionListView.tsx` — 병합 제안 + 행 리스트로 재구성. 현재 세션·열린 탭 접이식·
  그리드·`ClusteringCard` 제거.
- `components/TopNavBar.tsx` — 탭 라벨 `타임라인/세션/열린 탭`. `askOpen` 일 때 `‹ Ask AI`
  헤더로 교체(설정 헤더와 같은 패턴), 대화가 있을 때만 `새 대화` 노출.
- `components/OpenTabsPanel.tsx` — 목록 영역 `max-h-80` → `flex-1 min-h-0`, 루트를
  `flex h-full flex-col` 로. 독립 탭에서 화면 높이를 채우도록.
- `App.tsx` — `main` 을 `relative` 로 만들어 오버레이를 담고, 메인 탭에서만 독을 렌더.
- `views/SearchView.tsx`, `components/CurrentSessionCard.tsx` — 삭제.
- `hooks/useSessions.ts` — 호출자가 사라진 `useSaveSessionsClustered` 제거.
- `tests/unit/ui-store.test.ts` — 독 노출 화면, 세션 열 때 답변 화면 닫힘, 닫아도 탭 유지 3건 추가.

### 검증

- `pnpm test` — 13 파일 **125 passed**
- `pnpm compile` — 통과 (`View` union 변경 잔여 참조 없음)
- `pnpm build` — 통과 (sidepanel 70.73 kB)
- 실제 브라우저 스모크 미실시.

### 남은 것

- `lib/api.ts:391 saveSessionsClustered` 와 `hooks/useTabs.ts:39 useTabs` 가 미사용이 됐다.
  API 경계·백엔드 `/sessions/cluster` 와 맞물려 있어 이번엔 두고 보고에만 남김.
- Ask 답변의 "관련 세션"은 여전히 `SessionCard`(카드)를 쓴다. 목록은 행, 답변은 카드로
  표현이 갈린다 — 다음 섹션에서 정리 필요.
- 타임라인 탭·설정 화면 디자인은 미착수.

## 2026-08-12 — 타임라인 개편: 상단 카드 해체 + 로컬 필터

같은 브랜치 `feat/sidepanel-redesign` 이어서. 타임라인의 역할을 "방문 기록 대체"로 확정하고
상시 카드 두 개를 걷어냈다.

사용자 결정: 새로고침과 지금 저장 통합, 도메인 뭉치기는 이번엔 보류, 로컬 필터 추가,
화면 구성은 sticky 날짜 헤더가 상태 줄을 겸하는 안.

### 조사에서 나온 것

- 타임라인 목록의 원천은 서버가 아니라 로컬 IndexedDB 큐(48시간 보관)다
  (`useTimeline.ts:56-60`). 서버 조회는 세션 배지용이고 최대 3일치 캡(`:78`).
  그런데 하단 분석 카드만 7일치를 보고 있어 한 화면 안에서 시간 범위가 어긋나 있었다.
- `SyncStatusCard` 한 컴포넌트가 opt-in 온보딩 / 수동 동기화 / 상태 표시 세 가지를 겸하고
  있어, 통째로 지우면 수집을 켜는 인라인 경로까지 사라지는 구조였다.
- Ask 는 서버 데이터만 검색한다. 방금 본 페이지는 아직 로컬 큐에 `분류 대기`로 있어
  Ask 로 안 잡힌다 — "5분 전에 본 것"이 검색 사각지대였다.

### 변경

- `views/TimelineView.tsx` — 재구성. `SyncStatusCard`·`AnalyticsSummaryCard` 제거, 필터 입력
  추가, 맨 위 그룹 헤더에만 동기화 현황 전달. 수집 꺼짐 + 기록 없음이면 안내가 화면 전체를
  쓰고, 기록이 있으면 한 줄 안내로 축소하고 목록은 계속 보여준다.
- `components/timeline/TimelineDateHeader.tsx` — sticky 로 바꾸고 우측에 상태 슬롯 추가.
  미처리는 있을 때만 점+숫자, 마지막 동기화 시각은 항상. `status` 는 맨 위 그룹에만 넘긴다
  (날짜별 값이 아니라 "지금 상태"라서).
- `components/timeline/CollectionOptInNotice.tsx` — 신규. `SyncStatusCard` 의 opt-in 블록을
  분리하고 `compact` 변형 추가.
- `hooks/useTimeline.ts` — `filterTimelineEntries` 순수 함수 추가(제목·도메인·URL 부분일치,
  대소문자 무시). `useTimeline(query)` 로 필터를 받고, 필터 결과 없음(`isFilteredOut`)과
  기록 자체 없음(`isEmpty`)을 구분해 안내 문구가 갈리게 함. 내부 `query` 변수명이
  파라미터와 충돌해 `timelineQuery` 로 개명.
- `components/TopNavBar.tsx` — 새로고침 아이콘을 `triggerManualSync` + 쿼리 무효화로 통합.
  진행 중 스피너. 동기화 요청 실패해도 화면 새로고침은 수행하고 그 사실을 토스트로 알린다
  (fallback 이 실패를 감추지 않도록).
- `components/SyncStatusCard.tsx` — 삭제.
- `wxt.config.ts` — `build: { modulePreload: false }`. chrome-extension:// 페이지에서
  crossorigin modulepreload 가 cross-world mismatch 로 버려지며 콘솔 경고를 남기던 것 제거.
  빌드 후 sidepanel.html·newtab.html 에서 preload 태그가 사라진 것을 확인했다.
- `tests/unit/timeline-filter.test.ts` — 신규 7건(빈 검색어, 제목·도메인·URL 일치,
  대소문자, pending 기록 포함, 무일치).

### 검증

- `pnpm test` — 14 파일 **132 passed**
- `pnpm compile` — 통과
- `pnpm build` — 통과
- 실제 브라우저 스모크 미실시.

### 남은 것

- `lib/api.ts` 의 `fetchAnalyticsOverview` 가 호출자를 잃었다. 백엔드
  `GET /analytics/overview` 는 그대로 살아 있다.
- 연속 같은 도메인 방문 뭉치기 — 하루 이벤트가 100개를 넘으면 필요. 실데이터 미측정.
- 타임라인을 48시간 너머로 넓히려면 백엔드 기간 조회가 필요(미결정).

### 후속 — 타임라인 행을 한 줄로 (2026-08-12)

사용자 결정: 도메인 제거, 파비콘 폴백 케이스는 hover 툴팁으로 감수, 세션 상세와 통일.

- `components/timeline/TimelineItem.tsx` — 2줄 → 1줄. 둘째 줄(도메인 · 체류시간)을 없애고
  체류시간만 배지 왼쪽으로 옮김. 행 높이 약 48px → 32px(목록 영역 500px 기준 10줄 → 15줄).
  `title` 속성에 제목+URL 을 넣어, 파비콘이 중립 아이콘으로 떨어진 행에서도 hover 로 사이트를
  확인할 수 있게 함. `formatDuration` 을 분 단위 위로 초를 버리도록 축약(`45초`/`12분`/`2시간`)
  — 배지(`max-w-[120px]`)와 우측 예산을 나눠 써야 해서 `12분 34초` 는 제목을 너무 잘랐다.
- 같은 파일에서 `compact` prop 제거 — 유일한 사용처였던 `SearchView` 가 삭제되면서 호출자가
  사라졌고, 한 줄 구조에서는 의미도 없어졌다.
- 세션 상세의 탐색 타임라인도 같은 컴포넌트라 함께 한 줄이 된다(의도된 통일).

검증: `pnpm test` 132 passed · `pnpm compile` 통과 · `pnpm build` 통과. 브라우저 스모크 미실시.

### 후속 — 타임라인 배지 정리와 파비콘 폴백 (2026-08-12)

실제 화면 스크린샷 리뷰에서 나온 3건. 사용자 결정: 배지 정리, 세션 배지 축약, 파비콘 조사.

**증상** — 7행 중 4행에서 제목이 `틀자마자 ...`, `AI RO...` 수준으로 붕괴했고, 경쟁하던 세션
배지도 `AI ROOKIE 대회 본...`으로 잘려 둘 다 못 읽는 상태였다. 별도로 3행의 파비콘이 빈 원.

**원인** — 세션 배지 `max-w-[120px]` 예산을 짧은 상태 배지(`분류 대기`) 기준으로 잡은 오판.
실제로는 세션명이 그 폭을 다 쓰면서 제목 몫이 남지 않았다. 파비콘 쪽은 DB 조회로 해당 행이
`https://github.com/orbit-browser/orbit/branches` 임을 확인했다.

**변경**

- `components/timeline/SessionBadge.tsx` — `동기화됨`·`제외됨` 은 렌더하지 않는다(null).
  정상 상태라 사용자가 취할 행동이 없는데 제목 폭만 가져갔다. `분류 대기` 는 `대기` 로 줄이고
  툴팁에 설명. 세션 배지는 이름을 펼치지 않고 20px 아이콘 칩으로 축약 — 이름은 툴팁,
  세션 이동은 클릭 그대로.
- `lib/favicon.ts` — `faviconUrl` 이 페이지 URL 을 **출처(origin) 로 정규화**해서 조회한다.
  크롬 파비콘 DB 는 페이지 URL 색인이라 깊은 경로는 항목이 없을 수 있고, 그때 `_favicon/` 은
  오류가 아니라 200 + 기본 아이콘을 돌려준다 — `<img onError>` 가 안 터져 호출측 폴백 체인이
  통째로 죽는다. 루트로 물으면 적중률이 올라가고, 페이지마다 파비콘이 다른 사이트는 드물어
  잃는 것이 거의 없다.
- `lib/favicon.ts` — `faviconLetter` 추가. `components/Favicon.tsx` 최종 폴백을 중립 Globe
  아이콘에서 도메인 첫 글자로 교체(새 탭 `SessionFavicons` 가 쓰는 방식과 통일). 모든 사이트가
  같은 회색 아이콘이면 구분에 쓸모가 없다.
- `tests/unit/favicon.test.ts` — 신규 4건(호스트 첫 글자, `www.` 건너뛰기, 도메인 문자열,
  빈 값 폴백).

**검증** — `pnpm test` 15 파일 136 passed · `pnpm compile` 통과 · `pnpm build` 통과.

**미해결** — origin 정규화가 GitHub 아이콘을 실제로 살리는지는 **브라우저에서 확인해야 한다.**
`_favicon/` 의 200+기본아이콘 동작은 증상에 부합하는 추정이며 코드로 검증하지 못했다.
실패가 계속되면 수집기가 `tab.favIconUrl` 을 로컬 큐에 함께 저장하는 방안이 근본 해결이지만,
`ExplorationEvent` 스키마 변경이라 사용자 결정이 필요하다.

### 후속 — 타임라인 행 우측 정돈 (2026-08-12)

배지 정리 후 화면에서 우측이 어색하다는 지적. 원인 두 가지였다.

1. 삭제 버튼이 `opacity-0` 로만 숨겨져 있어 **평소에도 자리를 차지**했다(아이콘 22px + flex
   gap 10px ≈ 32px). hover 전에는 아무것도 안 보이는데 여백만 남았다.
2. 순서가 `체류시간 → 배지` 라서, 배지가 없는 행(`동기화됨` 제거로 다수)과 있는 행의
   체류시간 위치가 어긋나 우측 끝이 들쭉날쭉했다.

**변경** — `components/timeline/TimelineItem.tsx`

- 순서를 `배지 → 체류시간` 으로 바꾸고 체류시간에 고정폭(`w-9 text-right`)을 줬다.
  배지 유무와 관계없이 숫자가 한 열로 선다.
- 삭제 버튼을 `w-0` + `-ml-2.5`(flex gap 상쇄)로 접어 두고 `group-hover` 에서만 폭과 간격을
  펼치도록 했다. 평소 빈자리가 사라지고, hover 시 배지를 덮지 않으면서 나타난다.

**검증** — `pnpm test` 136 passed · `pnpm compile` 통과 · `pnpm build` 통과. 브라우저 스모크 미실시.

### 후속 — 타임라인 필터를 접기 (2026-08-12)

상단 필터 입력이 상시로 자리를 차지하는 게 어색하다는 지적. 선택지 A(접기) 채택.
B(하단 Ask 독이 필터를 겸해 입력창을 1개로 통합)는 보류.

**변경**

- `components/timeline/TimelineDateHeader.tsx` — `onOpenFilter` 를 받으면 우측 끝에 돋보기
  버튼을 그린다(맨 위 그룹 전용, 이미 열려 있으면 숨김).
- `views/TimelineView.tsx` — `filterOpen` 상태 추가. 접힘이 기본이고 세로를 전혀 쓰지 않는다.
  열면 목록 위 고정 영역에 입력창이 나오고 자동 포커스, `Esc`/`✕` 로 닫는다.
  닫을 때 입력을 비운다 — 접힌 채로 필터가 남아 있으면 목록이 왜 짧은지 알 수 없다.

**설계 주의** — 입력창을 날짜 헤더 안에 넣지 않았다. 필터 결과가 0건이면 그룹이 없어져
헤더까지 사라지고, 그러면 사용자가 입력을 고치거나 지울 방법이 없어진다. 토글 버튼만
헤더에 두고 입력창은 목록 밖 고정 영역에 둔다.

**검증** — `pnpm test` 136 passed · `pnpm compile` 통과 · `pnpm build` 통과.

**미해결 (재확인)** — 파비콘. 이번 스크린샷에서 GitHub 행이 여전히 빈 원이고 첫 글자 폴백도
안 뜬다. 폴백이 실행되지 않았다는 것은 `_favicon/` 이 오류 없이 200 + 기본 아이콘을 준다는
뜻으로, 추정이 화면으로 확인됐다. origin 정규화로는 해결되지 않는다. 근본 해결은 수집기가
`tab.favIconUrl` 을 로컬 큐에 함께 저장하는 것이며 `ExplorationEvent` 스키마 변경이라
사용자 결정 대기.

### 후속 — 필터 펼치기 애니메이션 (2026-08-12)

`views/TimelineView.tsx` — 조건부 마운트(`{filterOpen && ...}`)를 걷어내고 항상 마운트한 채
`grid-template-rows` 를 `0fr ↔ 1fr` 로 전환한다(200ms ease-out). 높이를 재서 px 로 넣지 않아도
되고 입력창 높이가 바뀌어도 그대로 맞는다. 내용에는 opacity + 살짝 위로 미는 transform 을
같이 걸어 펼침이 자연스럽게 보이도록 했다.

동반 처리:

- 항상 마운트라 `autoFocus` 가 안 걸린다 → `filterOpen` 전환에서 ref 로 직접 포커스.
  닫을 때는 blur.
- 접힌 입력창이 Tab 순회와 스크린리더에 남지 않도록 `tabIndex={-1}` + `aria-hidden`.
- 수집 안내(`CollectionOptInNotice compact`)를 애니메이션 컨테이너 밖으로 분리 —
  필터와 함께 접혔다 펴지면 안 된다.
- 패딩을 애니메이션 영역 안쪽에 둬서 접힘 높이가 정확히 0 이 되게 했다.

**검증** — `pnpm test` 136 passed · `pnpm compile` 통과 · `pnpm build` 통과.

### 후속 — 세션 행 경량화 (2026-08-12)

사용자 지시: 글씨 축소, `N개 탭 · 시간` 을 펼친 영역으로 이동, 행 클릭으로 상세 진입하는 동작
제거하고 행 전체가 펼침 토글이 되게.

**변경** — `components/SessionRow.tsx`

- 제목 `text-[15px] font-bold` → `text-sm font-semibold`. 행 패딩 `py-3` → `py-2.5`.
- `N개 탭 · timeLabel` 둘째 줄을 접힌 행에서 제거하고 펼친 영역 맨 위로 옮겼다.
  접힌 목록은 제목만 읽힌다.
- caret 을 버튼에서 표시용 `span` 으로 바꾸고, 행 전체(`role="button"`)가 펼침을 토글한다.
  중첩 버튼이 사라졌고 표적도 커졌다. Space 키의 기본 스크롤은 `preventDefault` 로 막았다.
- `openSession` 호출 제거 — 목록에서 세션 상세로 들어가는 경로가 없어졌다.

**주의 — 세션 상세 뷰가 목록에서 도달 불가능해졌다.** 남은 진입로는 Ask 답변의 관련 세션
카드와 타임라인의 세션 배지뿐이다. 상세에만 있는 기능(세션 이름 변경, AI 요약 패널,
탐색 타임라인)은 세션 탭에서 쓸 수 없다. 지시대로 구현했고 보완 여부는 사용자 결정 대기.

**검증** — `pnpm test` 136 passed · `pnpm compile` 통과 · `pnpm build` 통과.

### 후속 — 세션 목록 시각 방향 "관측 기록" (2026-08-12)

행 13개가 같은 굵기·같은 색·같은 리듬으로 서 있어 눈이 붙잡을 곳이 없다는 지적.
글자 크기는 증상이고, 진짜 원인은 앞선 변경에서 **시간 축이 목록에서 사라진 것**이었다.

**방향** — 시간이 뼈대, 세션은 색을 가진 천체. 새 색을 만들지 않고 새 탭 궤도 캔버스의
세계(세션 hue 6색)를 사이드패널로 끌어왔다.

**변경**

- `lib/session-hue.ts` — 신규. `SESSION_HUES` + `hueForSession` 을 아틀라스
  `atlas/data.ts` 에서 꺼내 공용화. 두 화면이 같은 팔레트·같은 배정 규칙을 쓰지 않으면
  같은 세션이 다른 색을 갖게 된다. `data.ts` 는 이 모듈을 import 하도록 수정(중복 제거).
- `lib/session-groups.ts` — 신규. `groupSessionsByRecency`. `오늘 / 어제 / 지난 7일 /
  지난 30일 / 그 이전` 5구간. 날짜별로 쪼개면 하루 한 개짜리 그룹이 줄줄이 생겨 더 산만해진다.
  기준 시각은 `lastActivityAt ?? updatedAt ?? createdAt`(append 로 자라는 세션은 마지막으로
  손댄 때가 기억과 맞다). 시계 어긋남으로 미래 시각이 와도 '오늘'로 담는다.
- `views/SessionListView.tsx` — 묶음 렌더링. 묶음 헤더는 타임라인과 같은 sticky 라벨.
- `components/SessionRow.tsx`
  - caret 컬럼 → **세션 색 점**(5px). 원색이 줄줄이 서면 무지개로 읽히므로
    `color-mix(in srgb, hue 55%, transparent)` 로 채도를 배경 쪽으로 눌렀다.
    hover·펼침에서는 **같은 자리**에서 화살표로 교체(자리를 옮기면 목록이 흔들린다).
  - 제목 `text-sm/600` → `text-[13px]/500`. 묶음이 리듬을 만드니 행마다 굵을 이유가 없다.
  - 행 구분선 제거, 행에 `rounded-lg` + hover 배경. 표가 아니라 목록으로 읽히게.
  - 파비콘 상한 4 → 3, `+N` 알약 배지 → 우측 고정폭(`w-6`) 머티드 숫자. 아이콘 개수가 달라도
    오른쪽 끝이 반듯해진다.
  - 펼친 영역에 세션 색 헤어라인(`border-l`, 40% 채도). 액션 줄의 채운 버튼들을 텍스트
    버튼으로 낮추고, 빨간 `다시 시도` 배지도 조용한 텍스트 버튼으로 바꿨다.
- `tests/unit/session-groups.test.ts` — 신규 5건(5구간 배정, 빈 묶음 제외, 묶음 내 정렬,
  `updatedAt` 폴백, 미래 시각).

**검증** — `pnpm test` 16 파일 141 passed · `pnpm compile` 통과 · `pnpm build` 통과.
브라우저 스모크 미실시.

### 후속 — 세션 액션 줄 라벨과 위계 (2026-08-12)

`새 창` / `이어서` 는 동작이 아니라 명사였고, 특히 `이어서` 는 목적어가 없어 무엇을 이어서
하는지 읽히지 않았다. 실제로는 둘 다 "세션의 탭을 전부 연다"이고 차이는 목적지뿐인데
나란히 놓여 서로 다른 두 기능처럼 보였다.

- `components/SessionRow.tsx` — `새 창에서 열기`(강조) / `현재 창에 열기`(조용) / `삭제`.
  hover 에 배경 알약(각각 primary-soft / bg / danger-soft)을 얹어 자연스럽게 강조되게 했다.
  토스트 문구도 버튼과 같은 낱말로 맞췄다 — "열기"로 눌렀는데 "복원했어요"가 뜨면 다른 일로
  읽힌다(`새 창에서 열었어요` / `현재 창에 열었어요`).

**넣지 않은 것** — 탭이 많은 세션을 열 때의 확인 창. 사용자가 hover 강조만 요청해 보류했다.
탭 20개짜리 세션에서 잘못 누르면 창 하나에 20개가 쏟아지는 위험은 그대로 남아 있다.

**미정리** — `SessionCard`(Ask 답변의 관련 세션)와 `SessionDetailView` 는 아직 "복원" 어휘를
쓴다. 각 화면 안에서는 버튼과 토스트가 일치하지만 제품 전체로는 어휘가 둘로 갈려 있다.

**검증** — `pnpm test` 141 passed · `pnpm compile` 통과 · `pnpm build` 통과.

`현재 창에 열기` 도 같은 강조로 올렸다(사용자 요청). 두 열기가 동등한 선택지가 되고 위계는
`열기 둘 : 삭제` 로만 남는다. 어느 창에 열지는 상황이 정하는 것이라 한쪽을 기본으로 미는
것보다 맞다.

### 후속 — 펼친 서랍에 방문 시각과 이름 바꾸기 (2026-08-12)

세션 상세 뷰에만 있던 기능을 목록의 펼친 서랍으로 가져오는 작업. 사용자 제안:
"이름 변경이랑 타임라인을 펼친 곳에 넣고, 타임라인은 지금 뜨는 목록에 시간만 추가하면 되지 않나".

**조사에서 나온 제약** — `TabItem` 에는 시각 필드가 없다(`id/title/url/favIconUrl` 뿐).
방문 시각은 `SessionTimelineEvent`(`GET /sessions/{id}/events`)에만 있으므로 "시간만 추가"는
불가능하고 이벤트를 조회해야 한다.

**설계 결정** — 이벤트를 그대로 나열하지 않는다. 방문 이벤트는 발생 건 단위라 같은 페이지를
세 번 본 세션이 세 줄이 되고, 타임라인 탭에서 이미 확인한 "같은 페이지 반복" 잡음이 그대로
재현된다. 대신 **페이지 단위를 유지한 채 처음 본 시각과 방문 횟수만 얹고 시각 오름차순으로
정렬**했다. 흐름은 순서가, 반복은 `×N` 이 나른다. 정렬이 오름차순인 이유는 세션 안에서는
"어떻게 시작해 어디로 갔나"가 읽혀야 하기 때문(타임라인 탭의 내림차순과 목적이 다르다).

**변경**

- `lib/session-visits.ts` — 신규. `attachVisits(tabs, events)`. URL 로 이벤트를 묶어 처음 본
  시각(이벤트 순서와 무관하게 최소값)과 횟수를 계산하고, 시각 있는 탭을 오름차순으로 앞에,
  없는 탭은 원래 순서로 뒤에 붙인다.
- `components/SessionRow.tsx`
  - 펼쳤을 때만(`enabled: expanded`) 세션 이벤트를 조회한다. `fetchSessionEvents` 가 실패를
    빈 배열로 흡수하므로 조회가 실패해도 탭 목록은 그대로 보인다.
  - 탭 행 왼쪽에 `HH:MM`, 오른쪽에 재방문 `×N`.
  - 메타 줄에 연필 버튼 → 인라인 이름 편집(`Enter` 확정 / `Esc` 취소 / blur 시 확정).
    빈 값이나 기존과 같은 값이면 요청하지 않는다.
- `tests/unit/session-visits.test.ts` — 신규 5건(오름차순 정렬, 재방문 집계, 최소 시각 선택,
  이벤트 없는 탭 뒤로, 이벤트 0건이면 원본 유지).

**검증** — `pnpm test` 17 파일 146 passed · `pnpm compile` 통과 · `pnpm build` 통과.
브라우저 스모크 미실시.

**남음** — 세션 상세 뷰의 AI 요약 패널(핵심 정보·미완료 작업·다음 행동)은 아직 서랍에 없다.
서랍에는 개요 한 줄만 있다.

---

## 2026-08-12 — 열린 탭 화면 경량화

사용자 요청에 따라 열린 탭 화면에서 세션 저장 액션은 추가하지 않고 검색·이동·북마크 흐름만
정리했다.

- `OpenTabsPanel.tsx`
  - 외곽 카드와 상시 노출되던 비활성 북마크 버튼을 제거했다.
  - 전체/검색 결과 수와 선택 동작을 한 줄로 묶고 검색 입력을 전폭으로 확장했다.
  - 선택한 탭이 있을 때만 `N개 선택됨 / 북마크에 추가` 작업 바를 표시한다.
  - 비북마크 탭의 비활성 체크박스를 숨기고 행 정렬은 유지했다.
  - 전체 URL 대신 위치 라벨·창 번호를 표시하고, 행 본문 전체를 탭 이동 버튼으로 바꿨다.
- `tab-actions.ts` — 웹 URL은 `www.`를 제외한 호스트, Chrome 내부 URL은 scheme+host,
  파일 URL은 `로컬 파일`로 표시하는 `openTabLocationLabel`을 추가했다.
- `tab-actions.test.ts` — 웹·Chrome·파일·빈 URL 위치 라벨 4개 경계를 검증했다.
- `IA.md` — 조건부 북마크 작업 바와 행 본문 탭 이동 구조를 현재 UI와 맞췄다.

**검증** — `pnpm test` 17개 파일 147개 통과 · `pnpm compile` 통과 · `pnpm build` 통과.
`git diff --check` 통과.

**미실시** — Chrome에서 확장을 다시 로드한 뒤 실제 열린 탭 데이터로 수행하는 시각 스모크.

### 후속 — 타임라인·세션 목록과 시각 일관성 조정

실제 화면 확인 후 열린 탭만 다른 화면보다 크고 무거워 보인다는 피드백을 반영했다.

- 타임라인과 같이 작은 목록 헤더 우측 검색 아이콘으로 입력을 펼치며 `Esc`/닫기에서 검색을
  비우고 접는다.
- `OpenTabsView`의 외곽 패딩을 없애고 내부 목록 여백을 타임라인의 `px-3 pb-4`와 맞췄다.
- 행을 `gap-2.5 px-2 py-1.5`, 16px 파비콘, `13px/500` 제목으로 낮춰 세션·타임라인과
  같은 밀도를 사용한다.
- 반복되는 이동 아이콘은 공간을 차지하지 않다가 행 hover 또는 focus에서만 나타난다.
- 선택 작업 바는 유지하되 높이와 버튼 무게를 줄였으며 세션 저장 액션은 추가하지 않았다.

**검증** — `pnpm test` 17개 파일 147개 통과 · `pnpm compile` 통과 · `pnpm build` 통과.

**미실시** — Chrome 확장 재로드 후 접이식 검색 애니메이션과 실제 hover/focus 시각 스모크.

### 후속 — 검색 전개 방향과 탭 메타 통일

- 열린 탭 검색 입력을 목록 헤더보다 앞에 배치해 타임라인과 같이 헤더 위에서 아래로 공간을
  밀며 펼쳐지게 했다. 두 화면 모두 `검색 입력 → 목록 헤더 → 결과` 순서를 사용한다.
- 검색이 닫혔을 때는 기존 상단 여백을 유지하고, 열렸을 때는 입력과 헤더 사이의 중복 여백을
  제거했다.
- 탭 행의 `창 N` 표시는 제거하고 도메인만 남겼다. 실제 창 포커스와 탭 활성화 동작은 유지된다.

**검증** — `pnpm test` 17개 파일 147개 통과 · `pnpm compile` 통과 · `pnpm build` 통과.

**미실시** — Chrome 확장 재로드 후 타임라인·열린 탭 검색 전개 방향 비교 스모크.

---

## 2026-08-12 — `main` 최신 변경과 사이드패널 개편 통합

PR 병합 전 `origin/main`의 대시보드 재설계·세션 별칭·다크모드 변경을 기능 브랜치에 병합했다.

- `App.tsx` — 메인의 테마 적용 effect와 사이드패널의 Ask 독 표시 조건을 함께 유지했다.
- `useSessions.ts` — 제거된 수동 저장 훅은 되살리지 않고, 이름 변경은 메인의
  `setSessionAlias` 계약으로 통합했다.
- `atlas/data.ts` — 메인의 연속 각도 궤도 배치를 유지하면서 공용 `hueForSession`을 사용한다.
- `Plan.md`, `DecisionLog.md` — 대시보드·별칭 작업과 사이드패널 작업 기록을 모두 보존했다.
- 타입 검사에서 메인이 추가한 필수 `Session.alias`가 세션 그룹 테스트 fixture에 빠진 것을
  확인해 `alias: null`을 추가했다.

**검증** — `pnpm test` 18개 파일 183개 통과 · `pnpm compile` 통과 · `pnpm build` 통과 ·
`git diff --check` 통과.

**미실시** — Chrome 확장 재로드 후 다크모드와 Ask 독·열린 탭을 함께 확인하는 통합 스모크.

### 문서 병합 후속 — DecisionLog 과거 기록 복구

PR #14 충돌 해결 과정에서 `DecisionLog.md`를 재구성할 때 출력 분량 제한으로 과거 기록
470줄이 잘린 것을 최종 점검에서 발견했다. PR #13 병합 직전 문서(`04e418a`)를 기준으로
전체 기록을 복원하고, 사이드패널의 신규 결정 2개만 문서 상단에 추가했다.

**검증** — `04e418a` 대비 `DecisionLog.md` diff는 신규 결정 60줄 추가·삭제 0줄이며,
`git diff --check` 통과.

---

## 2026-08-12 — 대시보드 다크 모드 버튼 대비 수정

대시보드의 반전형 버튼과 추천 세션 이동 버튼에 라이트 모드 전용 흰색이 고정돼 있어,
다크 모드에서 밝은 배경과 밝은 아이콘·텍스트가 겹치던 문제를 수정했다.

- 검색 실행, 세션 복원, 아틀라스 인사이트 버튼의 전경색을 각 화면의 테마 표면 토큰으로 교체했다.
- 추천 세션 이동 버튼 배경을 `--bg-canvas` 토큰으로 교체하고 화살표 전경색을 명시했다.

**환경 오류** — PowerShell 실행 정책이 `pnpm.ps1`을 차단해 첫 `pnpm test`는 시작되지 않았다.
동일 스크립트를 Windows 실행 파일인 `pnpm.cmd`로 다시 실행했다.

**검증** — `pnpm.cmd test` 18개 파일 183개 통과 · `pnpm.cmd compile` 통과 ·
`pnpm.cmd build` 통과 · `git diff --check` 통과.

**미실시** — Chrome 확장 재로드 후 라이트·다크 모드 버튼 대비 시각 스모크.

---

## 2026-08-12 — 수동 동기화를 타임라인 `세션 분류`로 이동

처음에는 상단 새로고침 아이콘을 `지금 저장`으로 바꿨지만, 무엇이 저장되는지 여전히 알기
어렵다는 피드백에 따라 실제 제품 동작인 세션 분류 문맥으로 다시 정리했다.

- 상단 바의 수동 동기화 버튼을 제거했다.
- 타임라인 첫 날짜 헤더에 분류 대기가 있을 때만 `대기 N · 세션 분류` 버튼을 표시한다.
- 버튼은 기존 `SYNC_NOW` 요청을 재사용하고 토스트는 `세션 분류를 요청했어요`로 바꿨다.
- 분류 상태 갱신은 기존 storage 구독과 주기 재조회에 맡긴다.

**검증** — `pnpm.cmd test` 18개 파일 183개 통과 · `pnpm.cmd compile` 통과 ·
`pnpm.cmd build` 통과 · `git diff --check` 통과.

**미실시** — Chrome 확장 재로드 후 좁은 폭에서 날짜 헤더 버튼 배치와 실제 분류 요청 토스트를
확인하는 시각 스모크.

---

## 2026-08-12 — 새 탭·사이드패널 로그인 화면 통일

기존 로그인 화면은 로고·설명·버튼이 배경 중앙에 떠 있어 빈 상태처럼 보였고, 새 탭과
사이드패널의 제목·설명도 서로 달랐다. 인증 로직은 유지하면서 같은 정보 위계로 정리했다.

- 새 탭: 420px 표면 카드, 약한 오렌지 광원, Orbit 브랜드, 탐색 재개 중심 카피, 전체 폭 CTA.
- 사이드패널: 같은 구조를 카드 테두리 없이 320px 안에 축소했다.
- 두 화면 모두 `Google 계정으로 계속`과 로그인 후 수집 여부를 선택할 수 있다는 안내를 쓴다.
- 기존 Orbit 이미지와 테마 토큰만 재사용하고 새 자산·의존성은 추가하지 않았다.

**검증** — `pnpm.cmd test` 18개 파일 183개 통과 · `pnpm.cmd compile` 통과 ·
`pnpm.cmd build` 통과 · `git diff --check` 통과.

**미실시** — Chrome 확장 재로드 후 새 탭·사이드패널의 라이트/다크 화면과 실제 Google 로그인
팝업을 확인하는 시각·통합 스모크.

---

## 2026-08-12 — 최초 설치 온보딩 프로토타입

설치→로그인→수집 opt-in→핵심 기능 이해 흐름을 새 기능 브랜치에서 구현했다.

- `orbit:onboarding` 상태를 추가했다. 저장값이 없으면 complete로 보므로 기존 사용자는 영향을 받지 않는다.
- 최초 설치에서만 온보딩 새 탭을 열고, 로그인 후 사용자 CTA로 사이드패널을 연다.
- 패널 열기용 실제 window ID를 CTA 렌더 전에 구해 사용자 클릭 안에서 `sidePanel.open()`을 호출한다.
- 사이드패널에는 mock 타임라인·세션·Ask와 4단계 spotlight, 다음·건너뛰기·진행률을 넣었다.
- 첫 단계만 실제 `collectionEnabled`를 켜며, mock 데이터는 API나 저장소에 쓰지 않는다.
- 열린 탭·설정은 핵심 첫 사용 흐름에서 제외했다.

**오류와 수정** — 온보딩 테스트의 `chrome.tabs.create` 대역이 fakeBrowser에서 `void`를 반환하는
타입이라 실제 `Tab` 객체를 반환하던 mock이 타입 검사에 실패했다. `undefined` 반환으로 맞췄다.

**검증** — `pnpm.cmd test` 19개 파일 187개 통과 · `pnpm.cmd compile` 통과 ·
`pnpm.cmd build` 통과 · `git diff --check` 통과.

**미실시** — 실제 Chrome에서 신규 설치 이벤트, Google 로그인, 사이드패널 열기, spotlight 위치,
라이트·다크 모드의 시각·통합 스모크.

---

### 후속 — Playwright MCP 시각 검증과 온보딩 직접 조작

- Codex 전역 MCP 설정에 `@playwright/mcp`를 등록하고 활성 상태를 확인했다.
- spotlight 오버레이를 강조 영역 바깥의 네 입력 차단면으로 나눠 실제 대상은 클릭 가능하게 했다.
- 첫 단계 설명 카드의 중복 `수집 켜기` CTA를 제거하고 실제 설정 카드 버튼으로만 진행되게 했다.
- 타임라인과 세션의 강조 범위를 대표 헤더·첫 항목으로 줄여 설명 카드가 콘텐츠를 가리지 않게 했다.
- 대상과 카드 크기를 동기 측정하고 `ResizeObserver`로 재측정해 최초 프레임과 크기 변경에도 배치를
  안정화했다.

**오류와 수정** — 첫 MCP 측정에서 420×800 최초 프레임의 설명 카드가 상단에 잠깐 남아 수집
카드와 겹쳤다. 대상 측정을 다음 animation frame으로 미룬 것이 원인이어서 layout effect에서 즉시
측정하고, 대상 좌표가 준비되기 전에는 설명 카드를 렌더링하지 않도록 수정했다. 첫 타입 검사에서는
nullable 요소를 `ResizeObserver.observe`에 넘겨 실패했으며 명시적 null 분기로 바로잡았다.

**Playwright MCP 검증** — 빌드 확장을 headless Chromium에 로드해 420×800·320×700에서 4단계
모두 강조 영역과 설명 카드가 겹치지 않음을 좌표로 확인했다. `elementFromPoint`가 실제 `수집 켜기`
버튼을 반환했고, 직접 클릭 후 `collectionEnabled: true`와 onboarding step 1 저장을 확인했다.

**검증** — `pnpm.cmd test` 19개 파일 187개 통과 · `pnpm.cmd compile` 통과 ·
`pnpm.cmd build` 통과 · `git diff --check` 통과.

**미실시** — 실제 Google 계정 로그인과 브라우저 UI의 사이드패널 열기 동작은 자동화하지 않았다.

---

### 후속 — mock 화면을 실제 사이드패널 형식으로 통일

사용자 확인에서 mock 방문 기록·세션 카드가 실제 화면 형식과 다르고, 실제 패널 높이에서는 첫
설명 카드가 수집 버튼 위로 겹치는 문제가 확인됐다.

- 별도 mock 카드와 상단 `온보딩 미리보기` 줄을 제거했다.
- 실제 `CollectionOptInNotice`, `TimelineDateHeader`, `TimelineItem`, `SessionRow`를 mock 값과 함께
  재사용해 운영 화면과 같은 행 높이·파비콘·대기 배지·세션 접힘 형식을 사용한다.
- 수집 안내의 compact CTA를 `켜기`에서 `수집 켜기`로 명확히 하고, 선택적 `onEnabled` 콜백으로
  실제 설정 저장 직후 온보딩 다음 단계가 진행되게 했다.
- 수집·타임라인·세션 설명은 강조 영역 아래, Ask 설명은 위에만 배치해 강조 영역과 겹치는
  fallback을 제거했다. 실제 조작이 필요 없는 2~4단계의 강조 영역은 입력도 차단한다.

**Playwright MCP 검증** — 다크 모드 461×799에서 4단계 전체, 461×767과 320×700에서 첫 단계를
확인했다. 모든 설명 카드가 viewport 안에 있고 강조 영역과 겹치지 않았다. `수집 켜기`가 실제
최상단 포인터 대상이며 클릭 후 `collectionEnabled: true`, onboarding step 1 저장을 확인했다.

**검증** — `pnpm.cmd test` 20개 파일 200개 통과 · `pnpm.cmd compile` 통과 ·
`pnpm.cmd build` 통과 · `git diff --check` 통과.

---

### 후속 — 충분한 mock 데이터와 사용자 주도 탭 이동

자동으로 화면이 바뀌어 내용을 파악하기 어렵다는 사용자 피드백에 따라 투어를 7단계로 확장했다.

- 타임라인 10개, 세션 6개, 열린 탭 8개의 mock 항목을 채워 각 화면의 실제 밀도를 확인할 수 있게 했다.
- 타임라인·세션·열린 탭 설명에서는 대표 행 여러 개를 함께 강조하고 나머지 데이터도 화면에 유지했다.
- `타임라인 설명 → 세션 탭 직접 클릭 → 세션 설명 → 열린 탭 직접 클릭 → 열린 탭 설명` 순서로
  바꾸고, 두 탭 이동 단계에서는 `다음` 버튼을 제거했다.
- 사용자가 강조된 실제 탭을 눌렀을 때만 화면과 저장 단계가 함께 바뀌며, 저장된 단계로 재개할 때도
  해당 화면이 복원된다.

**Playwright MCP 검증** — 다크 모드 461×799에서 7단계 모두 설명 카드와 강조 영역이 겹치지 않고
viewport 안에 있음을 확인했다. `elementFromPoint`로 수집·세션·열린 탭 버튼이 실제 포인터 입력을
받는 것을 확인했으며, 직접 탭 클릭 뒤 각각 onboarding step 3·5 저장과 화면 전환을 확인했다.
320×700과 461×767에서도 첫 단계의 직접 수집 클릭 영역과 카드 배치를 확인했다.

**검증** — `pnpm.cmd test` 20개 파일 200개 통과 · `pnpm.cmd compile` 통과 ·
`pnpm.cmd build` 통과 · `git diff --check` 통과.

---

## 2026-08-12 — 새 탭 검색창 최근 검색 기록

**브랜치:** `feat/search-history`

### 배경

새 탭 히어로 검색창은 검색을 실행하기만 하고 무엇을 검색했는지 남기지 않았다. 크롬 기본 새 탭이나
구글에서는 검색창에 커서를 넣으면 최근 검색어가 뜨는데, Orbit 새 탭은 매번 처음부터 타이핑해야 했다.

### 결정한 데이터 출처

구글 새 탭의 최근 검색 목록은 구글 계정 검색 기록이라 확장이 읽을 수 없고, 크롬 주소창에서 한
검색도 확장에는 보이지 않는다. `history` 권한을 붙여 방문 기록의 검색엔진 URL에서 쿼리를 역추적할
수도 있지만 보조 기능 하나에 전체 방문 기록 읽기 권한은 과하다고 보고, **Orbit 검색창에서 실행한
검색어만 로컬에 남기는 방식**으로 사용자 확인을 받아 진행했다(`DecisionLog.md` 같은 날짜 항목).

### 변경 내용

- `entrypoints/newtab/lib/search-history.ts` (신규) — 저장 형식과 순수 로직. 바로가기
  (`shortcuts.ts`)와 같이 순수 함수와 `chrome.storage.local` 접근을 나눴다.
  같은 검색어는 새로 쌓지 않고 시각만 갱신해 맨 위로 올리고, 상한 10개를 넘기면 오래된 것이
  밀려난다. 저장된 값이 손상됐으면 형식이 맞는 항목만 남긴다.
- `entrypoints/newtab/components/sections/SearchHistoryDropdown.tsx` (신규) — 드롭다운.
  `combobox`/`listbox` 역할과 `aria-activedescendant`로 키보드 선택을 스크린리더에 전달한다.
- `entrypoints/newtab/components/sections/OrbitHero.tsx` — 검색 실행부를 `runSearch`로 분리하고
  검색어일 때만 기록을 남긴다. 포커스 시 목록 표시, 입력값으로 필터, ↑↓ 이동, Enter·클릭으로 즉시
  검색, Esc로 닫기, 항목별 삭제를 배선했다. 기존 Tab 모드 전환은 그대로 유지한다.
- `entrypoints/newtab/styles/index.css` — `.search-history` 계열 스타일. 절대 배치라 아래
  바로가기 줄을 밀어내지 않는다. 삭제 버튼은 활성 줄에서만 보인다.
- `tests/unit/search-history.test.ts` (신규) — 중복 승격, 상한, 빈 입력 무시, 대소문자 무시 필터,
  손상된 저장값, 저장소 읽기·쓰기 실패 경로.

### 구현 중 처리한 문제

- **드롭다운 클릭이 먹지 않는 순서 문제** — 입력창의 `blur`가 항목 `click`보다 먼저 일어나 목록이
  닫히면 클릭이 사라진다. 항목과 삭제 버튼의 `onMouseDown`에서 `preventDefault()`로 포커스가
  입력창에 남게 했다.
- **결과 페이지가 탭을 대체하는 타이밍** — `chrome.search.query({ disposition: 'CURRENT_TAB' })`는
  이 탭을 결과 페이지로 바꾼다. 검색 후에 저장하면 실행되지 않을 수 있어 기록을 먼저 저장한다.
- **주소 입력 제외** — `parseOmniboxInput`이 `navigate`로 판정한 입력은 검색어가 아니므로 기록하지
  않고 그대로 이동한다.

### 검증

```
pnpm test     → 20 files / 200 tests 통과 (신규 13개 포함)
pnpm compile  → 통과
pnpm build    → 통과 (chrome-mv3, 921.33 kB)
```

**미실시** — 실제 브라우저에서 확장을 로드한 화면 스모크. 포커스 시 목록 표시와 선택 시 검색 실행은
사용자 확인이 필요하다.
