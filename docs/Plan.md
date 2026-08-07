# 디자인 개편 — orbit_front 목업 이식 및 새 탭 홈 연결

**상태:** 1차(홈·사이드패널) → 2차(아틀라스 이식 + 바로가기) → 3차(세션 진입 통일 + 복원) 완료 (2026-08-07)
**브랜치:** `feat/design-upgrade`

> 직전 계획(그룹 내 서브클러스터링 + append 게이팅)은 완료·병합됨(#4). 이번 작업은
> 백엔드 파이프라인을 건드리지 않는 **프론트 전용 변경**이다.

## 작업 목표

1. `orbit-browser/orbit_front` 목업의 **메인 화면을 크롬 새 탭 스타팅 화면**으로 이식한다.
   기본 브라우저 첫 화면처럼 주소창은 비어 있고, 홈 검색창에 검색어나 URL을 넣으면
   각각 검색·주소 이동이 된다. **연결은 여기까지만** 한다.
2. 기존 사이드패널 디자인을 목업의 디자인 언어(샌드 배경 + 테라코타 액센트)로 통일한다.
3. 배경이 함께 붙어 나오는 현재 아이콘을 **투명 배경 마크**로 교체한다.

## 현재 상태와 조사 결과

### 목업 (`orbit-browser/orbit_front`, 별도 저장소)

* Vite + React 19 + Tailwind v4. 디자인 토큰은 `src/index.css:14-28`에 집약.

  | 토큰 | 값 |
  | --- | --- |
  | `--bg-sand` | `#fefaf6` (페이지 배경, 그라디언트 금지) |
  | `--bg-canvas` | `#ffffff` |
  | `--accent-orange` | `#f07550` |
  | `--accent-orange-muted` | `#f7a488` |
  | `--text-main` | `#2b2521` |
  | `--text-muted` | `#7d7069` |
  | `--border-subtle` | `rgba(170, 116, 90, 0.18)` |
  | `--shadow-warm` | `rgba(178, 112, 84, 0.12)` |
  | `--radius-lg / md / pill` | `28px / 16px / 100px` |

* 메인 화면 구성 = `src/App.tsx`
  `Header`(사이드바 토글 + 유저 메뉴) · `NavigatorDrawer` · `OrbitHero`(시그니처 토성 SVG +
  검색 셸 + 검색 범위) · `RecentExploration`(좌) · `ContinueExploring`(우) · `SessionDetail`(모달).
* 더미 데이터는 `src/components/atlas/data.ts` (578줄, Orbit → Session → Page 구조).
* 아이콘은 Phosphor를 **CDN `<script>`** 로 로드 (`index.html`). MV3 CSP에서 불가 → lucide로 대체 필요.
* 폰트는 Google Fonts `@import`. MV3에서는 원격 폰트를 쓰지 않는 것이 기존 결정
  (`extension/assets/fonts/README.md`) → 시스템 폰트 스택으로 폴백.

### 익스텐션 (`extension/`)

* 엔트리포인트는 `background` · `content` · `sidepanel` 3개. **newtab 없음** →
  스타팅 화면을 만들려면 신규 엔트리포인트 + `chrome_url_overrides.newtab` 필요.
* 현재 토큰(`entrypoints/sidepanel/styles/tailwind.css`)은 `#f2660a` / `#f7f8fa` / 회색 계열로
  목업의 샌드·테라코타 톤과 불일치.
* `wxt.config.ts:22,27`이 `/orbit_icon.png`를 아이콘으로 지정. 이 파일은
  **1242×1242 주황 단색 배경** 이미지라 크롬 사이드패널 헤더에서 배경과 분리돼 보인다.
  (사용자가 지적한 증상의 원인. 헤더 로고는 익스텐션 코드가 아니라 크롬이 manifest
  아이콘으로 그린다.)
* `orbit_front/src/assets/orbit-mark.png`(256×212, 알파 있음)가 배경 없는 동일 마크.

## 사용자 결정 (2026-08-07 확인)

| 항목 | 결정 |
| --- | --- |
| 검색창 외 버튼·메뉴 | **렌더하되 전부 비활성.** 목업과 같은 화면을 유지하되 클릭 시 동작 없음 |
| 홈 카드 데이터 | **목업 더미 데이터 그대로.** 백엔드 연결 안 함 |
| 사이드패널 개편 범위 | **토큰·아이콘 교체 + 부품 정리.** 화면 구조와 기능은 유지 |
| 검색 엔진 | **사용자 기본 검색엔진**(`chrome.search` API). `search` 권한 추가 |

## 포함 범위

* `extension/entrypoints/newtab/` 신규 — 홈 화면 일체
* `extension/public/` — 투명 배경 아이콘 세트
* `extension/wxt.config.ts` — 아이콘 경로, `search` 권한
* `extension/entrypoints/sidepanel/styles/tailwind.css` — 디자인 토큰
* 사이드패널 컴포넌트의 반경·그림자·버튼·배지 스타일 정리

## 제외 범위

* 백엔드, 이벤트 수집기, 동기화 엔진 — 일절 건드리지 않음
* 홈의 백엔드 실데이터 연결, 인증 흐름
* 아틀라스(`orbit_front`의 두 번째 화면) 이식
* 사이드패널 화면 구조·정보구조 재설계
* `orbit_front` 저장소 자체의 변경

## 변경할 파일

### 신규

```
extension/public/orbit-mark-16.png / -32.png / -48.png / -128.png
extension/entrypoints/newtab/index.html
extension/entrypoints/newtab/main.tsx
extension/entrypoints/newtab/App.tsx
extension/entrypoints/newtab/styles/home.css
extension/entrypoints/newtab/components/HomeHeader.tsx
extension/entrypoints/newtab/components/SignatureOrbit.tsx
extension/entrypoints/newtab/components/HomeSearch.tsx
extension/entrypoints/newtab/components/RecentExploration.tsx
extension/entrypoints/newtab/components/ContinueExploring.tsx
extension/entrypoints/newtab/components/ExploreCard.tsx
extension/entrypoints/newtab/data/home-mock.ts
extension/lib/omnibox.ts
extension/tests/omnibox.test.ts
```

### 수정

```
extension/wxt.config.ts
extension/entrypoints/sidepanel/styles/tailwind.css
extension/entrypoints/sidepanel/components/*.tsx  (반경·그림자·버튼 톤)
extension/entrypoints/sidepanel/views/*.tsx        (동일)
docs/Plan.md · docs/Process.md · docs/WorkLog.md · docs/DecisionLog.md · docs/IA.md
```

## 계약 — 구현 전 확정

### `extension/lib/omnibox.ts`

주소창 입력 해석기. 새 탭 홈과 향후 다른 진입점이 같은 규칙을 쓰도록 분리한다.

```ts
export type OmniboxIntent =
  | { kind: 'navigate'; url: string }
  | { kind: 'search'; query: string };

/**
 * 브라우저 주소창과 같은 규칙으로 입력을 해석한다.
 * - http/https/file 스킴이 명시되면 그대로 이동
 * - localhost[:port], IPv4, "점 + TLD" 형태의 공백 없는 문자열이면 https:// 를 붙여 이동
 * - 그 외(공백 포함, 점 없음, 위험 스킴)는 검색
 *
 * javascript:, data:, chrome: 등은 검색으로 강등한다 — 홈 입력으로 특권 스킴을
 * 실행시키지 않기 위한 경계 검증이다.
 */
export function parseOmniboxInput(raw: string): OmniboxIntent;
```

실행 측은 홈 컴포넌트가 담당한다.

```ts
// navigate → location.assign(url)  (새 탭 자신을 목적지로 대체 = 기본 브라우저 동작)
// search   → chrome.search.query({ text, disposition: 'CURRENT_TAB' })
//            실패 시 사용자에게 오류 토스트, 조용히 삼키지 않는다
```

### 홈 컴포넌트 규약

* 비활성 컨트롤은 **`disabled` 속성 + `aria-disabled` + `title="준비 중"`** 로 통일한다.
  숨기지 않고 렌더하되, 클릭 핸들러를 아예 붙이지 않는다.
* 더미 데이터임이 코드에서 드러나도록 모듈명을 `home-mock.ts`로 두고 주석에 명시한다.

### manifest 변경

```ts
permissions: [..., 'search'],   // 사용자 기본 검색엔진 사용
icons/action.default_icon: 16/32/48/128 투명 마크
// chrome_url_overrides.newtab 은 WXT 가 newtab 엔트리포인트에서 자동 생성
```

## 구현 순서

1. **에셋** — `orbit-mark.png`를 정사각 캔버스에 알파 유지로 패딩 후 16/32/48/128 생성,
   `wxt.config.ts` 아이콘 교체. (효과가 가장 즉각적이고 나머지와 독립적)
2. **계약** — `lib/omnibox.ts` + 단위 테스트. 실패·경계 입력을 먼저 고정한다.
3. **홈 골격** — newtab 엔트리포인트, `home.css` 토큰 이식, 히어로 + 검색만으로 동작 확인.
4. **홈 섹션** — 더미 데이터, 최근 탐색·이어서 탐색·추천 카드, 비활성 컨트롤.
5. **사이드패널** — 토큰 교체 → 부품 톤 정리.
6. **검증 및 문서**.

## 테스트 및 검증 방법

```bash
cd extension && pnpm test      # vitest — omnibox 파서 포함
cd extension && pnpm compile   # tsc --noEmit
cd extension && pnpm build     # wxt build
```

수동 스모크 (사용자 환경에서 확인 필요):

* 새 탭을 열었을 때 주소창이 비어 있는지
* `github.com` → 이동 / `orbit 세션 클러스터링` → 기본 검색엔진 검색
* `javascript:alert(1)` 입력이 검색으로 처리되는지
* 사이드패널 헤더 아이콘에 배경 사각형이 사라졌는지

## 위험

| 위험 | 대응 |
| --- | --- |
| 새 탭 오버라이드는 브라우저 전역 경험을 바꾼다 | 사용자 승인 완료. 되돌리려면 newtab 엔트리포인트 삭제만 하면 됨 |
| `chrome.search` 권한 추가 → 스토어 심사 시 사유 필요 | README·DecisionLog에 사유 기록 |
| 목업 CSS를 그대로 옮기면 사이드패널 Tailwind와 충돌 가능 | 홈은 별도 CSS 파일·별도 엔트리포인트로 격리, 사이드패널은 Tailwind 토큰만 교체 |
| 목업의 Phosphor CDN 아이콘은 MV3에서 로드 불가 | lucide-react(기존 의존성)로 대체 |
| 더미 데이터가 실데이터처럼 오인될 수 있음 | 모듈명·주석으로 명시, DecisionLog에 한시적 조치임을 기록 |

## 2차 확장 — 아틀라스 전체 이식 + 바로가기 (2026-08-07 추가 요청)

1차에서는 홈의 검색창만 연결하고 나머지 컨트롤을 비활성으로 두었으나, 사용자가
**"목업 채로 들고와줘"** 로 범위를 넓혔다. 두 번째 화면(아틀라스)과 네비게이션,
마우스 상호작용을 시안 그대로 이식한다.

### 추가 결정 (2026-08-07)

| 항목 | 결정 |
| --- | --- |
| 이식 범위 | 시안에서 **도달 가능한 컴포넌트 전부**. 죽은 코드(`OrbitDetailPanel`·`OrbitAtlasCanvas`·`OrbitSidebar`·`DesignedByVariantChip` — 어디서도 import 안 됨)는 제외 |
| 비활성 컨트롤 | 해제. 네비게이터·유저메뉴·세션 상세·아틀라스 진입 모두 시안대로 동작 |
| 라우팅 | 해시 라우팅(`#/orbit-atlas`). 시안의 경로 라우팅은 확장 페이지(`newtab.html`)에서 새로고침 시 깨진다 |
| Phosphor 아이콘 | CDN `<script>` → **woff2 로컬 번들**. 41종이 쓰여 lucide 매핑은 손실이 크다 |
| 검색창 아래 | `검색 범위` 제거, **바로가기**(크롬 새 탭과 같은 역할)로 교체. 펼침/접힘 지원 |
| 바로가기 초기 목록 | `chrome.topSites`. 사용자가 추가·삭제하면 그때부터 사용자 목록만 사용 |
| 바로가기 아이콘 | `favicon` 권한 + 확장 내장 `_favicon/`. 외부 파비콘 서비스에 방문 기록을 흘리지 않는다 |
| 탭 제목 | `Orbit` → `새 탭` |

### 추가/변경 파일

```
extension/entrypoints/newtab/
├─ App.tsx                    # 시안 홈 (교체)
├─ pages/OrbitAtlasPage.tsx   # 아틀라스 진입
├─ components/VariantAtlasReplica.tsx
├─ components/atlas/{data,AtlasCanvas,AtlasDetail,AtlasHeader,AtlasNavigator,AtlasTray}
├─ components/layout/{BrandMark,Header,NavigatorDrawer,SidebarToggle,UserMenu}
├─ components/sections/{OrbitHero,RecentExploration,ContinueExploring,ExploreCard,SessionDetail}
├─ components/sections/Shortcuts.tsx   # 신규 — 바로가기
├─ lib/{navigation,nav-state,shortcuts}.ts
└─ styles/{index,atlas,phosphor}.css
extension/public/fonts/Phosphor.woff2
extension/tests/unit/shortcuts.test.ts
```

1차에서 만든 단순화 컴포넌트(`HomeHeader`·`HomeSearch`·`SignatureOrbit`·`home-mock.ts`·
`home.css` 등)는 시안 원본으로 대체되며 삭제됐다.

### 시안 대비 의도적 차이

목업을 그대로 옮기되 확장에서 동작할 수 없거나 거짓말이 되는 부분만 고쳤다.

| 항목 | 시안 | 확장 | 이유 |
| --- | --- | --- | --- |
| 라우팅 | `/orbit-atlas` | `#/orbit-atlas` | 확장 페이지에서 경로 pushState 는 새로고침 시 깨짐 |
| 아이콘 | Phosphor CDN | woff2 로컬 번들 | MV3 CSP |
| 폰트 | Google Fonts | 시스템 스택 폴백 | 원격 폰트 미사용 원칙 |
| 검색 모드 | 동작 없음 | 주소 이동 / 기본 검색엔진 | 새 탭의 주소창 역할을 겸함 |
| 검색 placeholder | `탐색 기록 검색...` | `검색어 또는 주소를 입력하세요` | 실제 동작과 맞춤 |
| 검색창 아래 | 검색 범위 | 바로가기 | 사용자 요청 |
| 브랜드 마크 | 소스 에셋 import | `/orbit-mark.png` | 확장 public 에셋 |

## 3차 — 세션 진입 통일 + 세션 복원 (2026-08-07 추가 요청)

| 항목 | 결정 |
| --- | --- |
| 세션 상세 모달 | **제거.** 최근 탐색·`상세 보기`·AI 응답 모두 그 세션의 대시보드로 이동 |
| 카드 두 번째 버튼 | `이어서 탐색` → **`세션 복원`**. hover 시 `새 창으로 세션 복원` 펼침 |
| 복원 구현 | 사이드패널과 같은 `lib/chrome-bridge.ts` 재사용 (`lib/restore.ts` 로 감쌈) |
| 홈 더미 데이터 | **변경 불필요** — 참조 7쌍 모두 이미 실제 대시보드 세션에 매칭됨을 확인 |
| 네비게이터 기본값 | 닫힘. 단 **Orbit 그래픽으로 대시보드 진입할 때만** 펼친 채 연다 |

제거: `components/sections/SessionDetail.tsx`, `styles/index.css` 의 모달 전용 스타일 281줄.
추가: `lib/restore.ts`.

## 완료 조건

* 새 탭이 목업 메인 화면으로 뜨고, 검색창이 검색·주소 이동 둘 다 처리한다.
* 그 외 컨트롤은 목업과 같은 모습으로 보이되 동작하지 않는다.
* 사이드패널이 목업과 같은 팔레트·타이포·반경·그림자를 쓴다.
* 크롬 사이드패널 헤더 아이콘에 배경 사각형이 없다.
* `pnpm test` · `pnpm compile` · `pnpm build` 통과.
* `WorkLog.md` · `DecisionLog.md` 갱신.
