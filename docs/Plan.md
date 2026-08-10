# Plan — 사이드패널 컨트롤 센터 개편

작성 2026-08-07 · 갱신 2026-08-08 · 브랜치 `feat/design`

> 상태: **구현 완료**. 시안 피드백으로 3차례 형태를 바꿨고, 아래 §7·§5 는 최종 결과에 맞춰 갱신했다.

## 1. 작업 목표

사이드패널을 macOS **제어 센터(Control Center)** 상호작용 모델로 전면 재구성한다.

- 상단 세그먼트 탭(타임라인 / 세션 / Ask AI)을 없애고 **하나의 화면**으로 합친다.
- 각 기능은 **타일(버튼)** 로 표현하고, macOS Wi-Fi 타일처럼 눌러서 **시트(sheet)** 를 연다.
- 맨 아래에 **Ask AI 입력창**을 상시 고정하고, 입력하면 전용 시트가 올라온다.
- **북마크 기능을 제거**한다.

## 2. 현재 상태와 조사 결과

| 영역 | 현재 |
| --- | --- |
| 내비게이션 | `store/ui.ts`의 `activeView` 5종 + `TopNavBar` 세그먼트 3탭 |
| 타임라인 | `views/TimelineView.tsx` — `SyncStatusCard` + 날짜별 스트림 + 주간 분석 카드 |
| 세션 | `views/SessionListView.tsx` — 현재 세션 카드 / 열린 탭 접이식 / 병합 제안 / 세션 그리드 |
| 세션 상세 | `views/SessionDetailView.tsx` — 이름 편집·탭 목록·AI 요약·모든 탭 열기·탐색 타임라인 |
| Ask AI | `views/SearchView.tsx` — 상단 입력 + 대화 누적, 상태는 `shared/hooks/useAskConversation.ts`(전역 zustand) |
| 열린 탭 | `components/OpenTabsPanel.tsx` — 검색 입력 상시 노출 + 체크박스 + 북마크 버튼 |
| 북마크 | `lib/chrome-bridge.ts:bookmarkOpenTabs`, `lib/tab-actions.ts:{isBookmarkableUrl,uniqueBookmarkTabs}`, `OpenTabItem.bookmarkable`, manifest `bookmarks` 권한 |

`useAskConversation`은 모듈 전역 스토어라 컴포넌트를 옮겨도 대화가 유지된다 — 시트를 닫았다 열어도
대화가 살아 있어 이번 구조에 그대로 맞는다.

## 3. 포함 범위

- 사이드패널 셸 재구성(위젯 격자 / 시트 스택 / Ask 독). 헤더는 없앤다
- 공용 부품 신규: `WidgetFrame`(+`WidgetTile`/`WidgetCircle`/`WidgetStrip`), `Sheet`, `ControlRow`
- 위젯 배치 편집(드래그 재정렬 · 숨기기 · 되돌리기)과 저장
- 열린 탭 미리보기 썸네일(활성 탭 캡처 → 축소 → 캐시)
- 뷰 → 시트 이관: 타임라인, 세션 목록, 세션 상세, 열린 탭, 병합 제안, Ask AI, 설정
- 열린 탭 검색 돋보기 토글(평소 비활성 → 누르면 입력 열림, 단순 단어 일치)
- 북마크 제거(UI · 브리지 · 타입 · manifest 권한 · 테스트)
- `store/ui.ts`를 시트 스택으로 교체
- 문서 갱신(`IA.md`, `DecisionLog.md`, `WorkLog.md`, `Plan.md`)

## 4. 제외 범위

- 새 탭 홈 · 아틀라스(`entrypoints/newtab`) — 손대지 않는다
- 백엔드 API · 스키마 — 변경 없음
- Ask 라우팅 로직(`useAskConversation`, `lib/tab-actions` 의도 파싱) — 호출부만 옮긴다
- 추천 세션 로직, 동기화 엔진

## 5. 변경할 파일

### 신규

```
entrypoints/sidepanel/components/control/{Sheet,ControlRow}.tsx
entrypoints/sidepanel/components/AskDock.tsx
entrypoints/sidepanel/components/widgets/{WidgetFrame,ControlWidgets,NavigationWidgets,InsightWidgets,registry}.tsx
entrypoints/sidepanel/views/ControlDeck.tsx
entrypoints/sidepanel/store/widgets.ts
entrypoints/sidepanel/sheets/{OpenTabsSheet,TimelineSheet,SessionsSheet,AskSheet,MergeSheet,SettingsSheet,SheetHost}.tsx
entrypoints/sidepanel/components/SessionDetailBody.tsx
lib/widget-layout.ts        위젯 배치 정규화·이동·저장
lib/tab-thumbnails.ts       활성 탭 캡처·축소·캐시
lib/tab-preview.ts          탭 + 썸네일 조립(순수)
```

### 수정

```
entrypoints/sidepanel/App.tsx              셸 교체
entrypoints/sidepanel/store/ui.ts          activeView → 시트 스택
entrypoints/sidepanel/styles/tailwind.css  시트 애니메이션 + reduced-motion
lib/types.ts                               OpenTabItem.bookmarkable 제거
lib/chrome-bridge.ts                       bookmarkOpenTabs 제거
lib/tab-actions.ts                         isBookmarkableUrl / uniqueBookmarkTabs 제거
entrypoints/background.ts                  활성 탭 썸네일 캡처
entrypoints/sidepanel/components/TabListItem.tsx  행 형식으로 교체(URL 제거)
wxt.config.ts                              bookmarks 권한 제거, <all_urls> 추가
tests/unit/tab-actions.test.ts             북마크 테스트 제거
tests/unit/ui-store.test.ts                시트 스택 테스트 추가
tests/unit/{widget-layout,tab-preview}.test.ts    신규
```

### 삭제

```
entrypoints/sidepanel/components/{TopNavBar,OpenTabsPanel,CurrentSessionCard,SyncStatusCard,SessionCard}.tsx
entrypoints/sidepanel/views/{TimelineView,SessionListView,SearchView,SessionDetailView,SettingsView}.tsx
```

시안 피드백으로 중간에 만들었다가 걷어낸 것: `ControlTile`, `ToggleSwitch`, `SidePanelHeader`,
`SessionRow`, `SessionDetailSheet`(→ 인라인 `SessionDetailBody`),
`entrypoints/tab-preview.content.ts`(페이지 오버레이).

`SettingsView`의 본문은 `SettingsSheet`로 그대로 옮긴다(내용 변경 없음).

## 6. 구현 순서

계약 → 부품 → 화면 순으로 내려간다(`Process.md` §6.2).

1. **계약**: `store/ui.ts`를 시트 스택으로 교체하고 테스트를 먼저 쓴다.
2. **정리**: 북마크 제거(타입 → 브리지 → manifest → 테스트). 타입이 먼저 좁아져야 UI에서 빠뜨리지 않는다.
3. **부품**: `WidgetFrame`, `Sheet`, `ControlRow` + CSS 애니메이션.
4. **셸**: `App`, `ControlDeck`, `SheetHost`, `AskDock`.
5. **시트**: 열린 탭 → 타임라인 → 세션 목록 → 세션 상세 → 병합 → Ask → 설정.
6. **검증**과 문서.

## 7. 화면 구조 (최종)

```
┌ (relative, flex-1)
│   위젯 격자 (4열)                     SheetHost (absolute inset-0)
│     [수집 2×1][세션 저장 2×1]
│     [열린 탭 2×1][저장된 세션 2×1]
│     [타임라인 2×1][추천 세션 2×1]
│     [대시보드][새로고침][설정][병합]   ← 1×1 원형
│     [오늘의 탐색 4×1]
│                [위젯 편집]
└ AskDock ── [입력] [보내기]
```

헤더는 두지 않는다. 새로고침·설정은 격자 안의 아이콘 위젯이다.

- 시트는 격자 위에 **흰 패널**로 뜨고 스택으로 쌓인다. 최상단 한 장만 그린다.
- 시트 헤더: 깊이 1이면 오른쪽 끝 작은 `×`(닫기), 2 이상이면 왼쪽 `‹`(뒤로). `Escape` 로도 닫는다.
- **세션 상세는 시트가 아니라 목록 안 인라인 펼침**이다(`expandedSessionId`). 다른 세션이
  접히며 고른 행이 위로 올라오고 상세가 아래로 흘러내린다.
- Ask 독은 시트 위에도 항상 보인다 — 입력하면 Ask 시트가 올라오고 대화가 위로 쌓인다.

### 위젯 규칙

| 크기 | 격자 | 모양 |
| --- | --- | --- |
| `wide` | 2×1 | 원형 디스크 + 제목 + 상태 한 단어 (+ `›`) |
| `small` | 1×1 | 완전한 원, 아이콘만 |
| `full` | 4×1 | 제목 + 시각화 |

상태는 색으로만 나타낸다 — 켜짐은 흰 원 + 액센트 글리프, 꺼짐은 회색. 토글 스위치는 두지 않고
타일을 눌러 켜고 끈다. 배치는 `chrome.storage.local`(`orbit:widgets`)에 저장한다.

### 시트 목록 형식

macOS Wi-Fi 팝오버 행을 따른다 — 구역 제목 + `원형 디스크 · 이름 한 줄 · 오른쪽 보조 표시`.
주소나 부가 설명은 담지 않는다. 저장된 세션, 세션 상세의 탭 목록, Ask 답변의 관련 세션이
모두 같은 형식이다. 열린 탭 시트만 예외로 2열 미리보기 카드 그리드를 쓴다.

접었다 펴는 전환은 `.orbit-collapse`(grid `0fr → 1fr`)로 한다. `max-height` 는 실제 높이보다
큰 값을 찍어야 해서 짧은 내용이 늦게 열린다.

## 8. 테스트 및 검증

```bash
cd extension && pnpm test && pnpm compile && pnpm build
cd backend  && python -m pytest -p no:asyncio     # 회귀 확인용(변경 없음)
```

- `tests/unit/ui-store.test.ts` — 시트 push/pop/중복 방지/전체 닫기, 세션 시트 중첩
- `tests/unit/tab-actions.test.ts` — 북마크 케이스 제거 후 나머지 통과
- 수동: 크롬 로드 후 loading · empty · error 3상태와 320px 폭 확인(`Process.md` §6.3)

## 9. 위험과 결정 사항

| 항목 | 판단 |
| --- | --- |
| `bookmarks` 권한 제거 | 사용자 명시 요청. 권한 축소라 재설치 없이 반영된다 |
| `OpenTabItem.bookmarkable` 제거 | 북마크 외 사용처 없음(grep 확인). 타입 축소 |
| 세션 그리드(2·3열) 폐기 | 시트 안 단일 열 목록으로 통일 — 사이드패널 폭에서 그리드는 실익이 없었다 |
| 주간 분석 카드 | 타임라인 시트 하단으로 이동(덱 노이즈 축소) |
| `searchQuery` 스토어 필드 | 읽는 곳이 없지만 이번 범위 밖이라 유지 |
| `<all_urls>` 호스트 권한 | 썸네일 캡처에 필요. 콘텐츠 스크립트가 이미 전 사이트에서 동작해 설치 경고가 늘지 않는다 |
| 페이지 오버레이 미리보기 | 시도했으나 동작하지 않아 걷어냈다 — `DecisionLog.md` 2026-08-08 |
| 타일 배경색 신규 토큰 | 흰 디스크가 보이려면 타일이 흰색일 수 없다. 표면 규칙이 카드(흰색)/타일(샌드)로 나뉜다 |

## 10. 완료 조건

- 사이드패널에 세그먼트 탭이 없고 모든 기능이 타일 → 시트로 도달 가능하다.
- 열린 탭 검색은 돋보기를 눌러야 열리고, 북마크 UI·코드·권한이 모두 사라졌다.
- Ask 입력창이 하단에 고정되고, 전용 시트를 열고 닫을 수 있다.
- `pnpm test`, `pnpm compile`, `pnpm build` 통과.
- `IA.md`, `DecisionLog.md`, `WorkLog.md` 갱신.
