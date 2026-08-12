# 사이드패널 개편 — 세션 행 리스트와 Ask AI 상시 독

**상태:** 구현 완료 (2026-08-12) — 실제 브라우저 스모크 미실시
**브랜치:** `feat/sidepanel-redesign`

## 작업 목표

- 세션 탭을 카드 그리드에서 새 탭 아틀라스와 같은 계열의 **행 리스트**로 바꾼다.
- Ask AI를 상단 탭에서 빼고 **메인 탭 하단에 상주하는 입력창**으로 옮긴다. 질문을 보내면
  답변 화면이 아래에서 올라와 덮고, 뒤로가기로 원래 탭에 복귀한다.
- 세션 탭 안에 접혀 있던 **열린 탭 찾기·북마크**를 Ask AI가 비운 세 번째 탭으로 승격한다.
- **현재 세션(수동 저장)** 카드를 없앤다. 세션화는 이벤트 배치가 담당하므로 수동 저장 경로가
  제품 흐름에서 필요하지 않다.

## 현재 상태와 조사 결과

- `TopNavBar.tsx:28-32` — 세그먼트 탭 3개(`타임라인` / `세션` / `Ask AI`). `Ask AI` 탭의 실체는
  `activeView === 'search'` → `SearchView`다.
- 검색 경로는 Ask 하나뿐이다. `useAskConversation`이 질문을 `search_memory` /
  `search_session` / `navigate_tab`으로 라우팅하므로(`useAskConversation.ts:139-217`),
  Ask를 채팅창으로 옮겨도 잃는 검색 기능이 없다.
- `useAskConversation`의 턴 저장소는 모듈 전역 zustand store다(`useAskConversation.ts:38-41`).
  뷰가 언마운트돼도 대화가 남으므로 오버레이 개폐 구조에 그대로 맞는다.
- `SessionCard.tsx` 한 장에 제목·요약 2줄·복원 버튼·오버플로 메뉴·파비콘·시간이 모두 들어 있고,
  `SessionListView.tsx:69`에서 폭에 따라 1~3열 그리드로 깔린다. 행 리스트에는 자리가 없다.
- `Session.timeLabel`은 이미 `8/7 20:45` 형식이다(`lib/api.ts:173`). 시안의
  `20개 탭 · 8/7 22:31`을 `tabs.length` + `timeLabel`로 그대로 만들 수 있다.
- `CurrentSessionCard`는 `useSaveSessionsClustered`와 `isClustering`의 **유일한 호출자**다.
  이걸 없애면 `SessionListView`의 `ClusteringCard`("주제 분류 중…")를 켤 주체도 사라진다.
- `OpenTabsPanel`의 목록 영역은 `max-h-80`으로 고정돼 있다(`OpenTabsPanel.tsx:139`).
  독립 탭으로 올리면 화면 높이를 채우도록 바꿔야 한다.

## 사용자 결정 사항 (확인 완료)

- 세션 행: **행 클릭 = 상세 진입, caret = 탭 목록 인라인 펼침**.
- 복원·삭제는 caret으로 펼친 영역 맨 아래 액션 줄에 둔다.
- AI 요약문은 펼친 영역 상단. 단 **요약 중·요약 실패는 접힌 행에서도** 보인다.
- 병합 제안은 세션 탭 상단에 그대로 유지한다.
- 열린 탭 찾기·북마크는 세 번째 탭으로 승격한다.
- 키워드·세션 검색은 계속 채팅창이 처리한다.
- 하단 입력창은 메인 탭(타임라인/세션/열린 탭)에만. 상세·설정에는 없다.
- 현재 세션 카드와 수동 저장은 제거한다.
- 타임라인 탭과 설정 화면은 이번 범위 밖 — 다음 섹션에서 다룬다.

## 포함 범위

- 사이드패널 탭 구성 변경과 뷰 라우팅(`store/ui.ts`, `TopNavBar`, `App`).
- 세션 목록의 행 리스트 전환(`SessionRow` 신규, `SessionListView` 재구성).
- Ask 상시 독과 답변 오버레이(`AskDock`, `AskView` 신규, `SearchView` 대체).
- 열린 탭 탭 승격(`OpenTabsView` 신규, `OpenTabsPanel` 높이 대응).
- 현재 세션 카드·수동 저장 훅·클러스터링 표시 제거.

## 제외 범위

- 타임라인 뷰, 설정 뷰, 세션 상세 뷰의 디자인 (다음 섹션).
- 백엔드 변경 없음. `/sessions/cluster` 엔드포인트는 그대로 둔다.
- Ask 답변의 "관련 세션"은 기존 `SessionCard`를 계속 쓴다. 목록과 표현이 갈리지만
  이번 지시 범위가 세션 탭이므로 임의로 바꾸지 않는다.

## 변경할 파일

| 파일 | 변경 |
| --- | --- |
| `store/ui.ts` | `View`에서 `search` 제거·`tabs` 추가, `askOpen`/`openAsk`/`closeAsk` 추가, 죽은 `searchQuery`·클러스터링 상태 제거 |
| `components/TopNavBar.tsx` | 탭 라벨 `타임라인/세션/열린 탭`, ask 열림 시 `‹ Ask AI` 헤더 + 새 대화 |
| `components/SessionRow.tsx` | 신규 — 행 리스트 아이템, caret 펼침, 파비콘 스택 |
| `components/AskDock.tsx` | 신규 — 하단 상주 입력창 |
| `views/AskView.tsx` | 신규 — 답변 오버레이 (SearchView의 대화 렌더링 이관) |
| `views/OpenTabsView.tsx` | 신규 — 열린 탭 탭 컨테이너 |
| `views/SessionListView.tsx` | 병합 제안 + 행 리스트로 재구성 |
| `components/OpenTabsPanel.tsx` | 목록 영역 `max-h-80` → 부모 높이 채움 |
| `App.tsx` | 독·오버레이 레이아웃 |
| `views/SearchView.tsx` | 삭제 (AskView가 대체) |
| `components/CurrentSessionCard.tsx` | 삭제 |
| `hooks/useSessions.ts` | `useSaveSessionsClustered` 제거 |
| `tests/unit/ui-store.test.ts` | ask 오버레이·뷰 전환 테스트 추가 |

## 구현 순서

1. `store/ui.ts` 계약 확정 (View union, askOpen).
2. `SessionRow` 신규 + `SessionListView` 재구성 + `CurrentSessionCard` 제거.
3. `OpenTabsView` + `OpenTabsPanel` 높이 대응.
4. `AskDock` + `AskView` + `TopNavBar` ask 헤더 + `App` 레이아웃, `SearchView` 삭제.
5. 테스트 추가 후 `pnpm test && pnpm compile && pnpm build`.
6. 문서 갱신(IA / DecisionLog / WorkLog).

## 테스트 및 검증

- `cd extension && pnpm test` — ui store 신규 상태 전이 포함.
- `pnpm compile` — `View` union 변경이 남긴 참조를 타입 검사로 잡는다.
- `pnpm build`.
- 실제 브라우저 스모크는 사용자 확인 필요(자동 검증 불가).

## 위험

- `View`에서 `search`를 없애면 참조가 남을 수 있다 → `pnpm compile`로 확인한다.
- 수동 저장 제거로 `lib/api.ts:391 saveSessionsClustered`와 `hooks/useTabs.ts:39 useTabs`가
  미사용이 된다. API 경계·백엔드 엔드포인트와 맞물려 있어 이번엔 지우지 않고 보고에 남긴다.
- 하단 독이 세로 약 60px을 상시 점유한다. 행 높이가 커진 만큼 한 화면 세션 수가 줄어든다.

## 완료 조건

- 세션 탭이 시안의 행 리스트로 보이고, caret 펼침에서 요약·탭 목록·복원/삭제가 모두 된다.
- 요약 중·요약 실패가 접힌 행에서 보이고 재시도가 동작한다.
- 메인 세 탭 하단에 입력창이 있고, 전송하면 답변 화면이 올라오고 뒤로가기로 복귀한다.
- 열린 탭이 독립 탭으로 동작한다.
- 테스트·타입 검사·빌드 통과.

---

# 2단계 — 타임라인 개편 (같은 브랜치)

**상태:** 구현 완료 (2026-08-12) — 실제 브라우저 스모크 미실시

## 작업 목표

타임라인의 역할을 **브라우저 방문 기록의 대체**로 확정한다. "아까 본 거 뭐였지"를 즉시
되짚어 다시 들어가는 화면으로, 최근 48시간을 훑는 밀도를 최우선으로 한다.

## 현재 상태와 조사 결과

- 목록의 원천은 서버가 아니라 로컬 IndexedDB 큐(48시간 보관)다(`useTimeline.ts:56-60`).
  서버 조회는 세션 배지용이며 최대 3일치 캡(`:78`). **타임라인은 본질적으로 48시간 화면이다.**
- 하단 `이번 주 탐색 분석` 카드만 7일치를 보고 있어 화면 안에서 시간 범위가 어긋나 있었다.
- `SyncStatusCard` 가 opt-in 온보딩 / 수동 동기화 / 상태 표시 세 기능을 겸하고 있어,
  통째로 지우면 수집을 켜는 인라인 경로까지 사라진다.
- Ask 는 서버 데이터만 검색한다 — 방금 본 페이지(로컬 큐 `분류 대기`)는 검색 사각지대.

## 사용자 결정 사항 (확인 완료)

- 새로고침과 `지금 저장`을 상단 바 아이콘 하나로 통합한다.
- 미처리·마지막 동기화는 sticky 날짜 헤더 우측에 붙인다(상태 전용 카드 없음).
- 수집 안내는 조건부로 남긴다.
- 로컬 필터를 추가한다.
- 연속 같은 도메인 뭉치기는 이번에 하지 않는다(구현 난이도).
- `이번 주 탐색 분석` 카드는 제거한다.

## 제외 범위

- 도메인 뭉치기(보류).
- 타임라인을 48시간 너머로 넓히는 것 — 백엔드 기간 조회가 필요(미결정).
- 설정 화면(다음 섹션).

## 변경한 파일

| 파일 | 변경 |
| --- | --- |
| `views/TimelineView.tsx` | 카드 2개 제거, 필터 입력, 조건부 수집 안내 |
| `components/timeline/TimelineDateHeader.tsx` | sticky + 상태 슬롯 |
| `components/timeline/CollectionOptInNotice.tsx` | 신규 — opt-in 안내 (전체/한 줄) |
| `hooks/useTimeline.ts` | `filterTimelineEntries` 추가, `isFilteredOut` 구분 |
| `components/TopNavBar.tsx` | 새로고침 = 동기화 + 무효화 통합 |
| `components/SyncStatusCard.tsx` | 삭제 |
| `wxt.config.ts` | `modulePreload: false` — 확장 페이지 preload 경고 제거 |
| `tests/unit/timeline-filter.test.ts` | 신규 7건 |

## 완료 조건

- 상단 상태 카드와 하단 분석 카드가 없고, 첫 화면 목록 노출이 늘었다.
- 미처리·마지막 동기화가 맨 위 sticky 헤더에서 보인다.
- 상단 바 아이콘 하나로 동기화가 트리거된다.
- 필터가 아직 동기화되지 않은 기록까지 즉시 걸러낸다.
- 수집이 꺼져 있을 때 켜는 경로가 화면에 남아 있다.
- 테스트·타입 검사·빌드 통과.
