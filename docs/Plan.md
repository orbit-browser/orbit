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

# 열린 탭 화면 경량화 (2026-08-12)

**상태:** 구현 완료 (2026-08-12)
**브랜치:** `feat/sidepanel-redesign`

## 작업 목표

열린 탭 화면을 검색과 목록 중심의 평평한 구조로 바꾸고, 북마크는 탭을 선택했을 때만
나타나는 문맥 작업으로 정리한다. 세션 저장 기능은 추가하지 않는다.

## 현재 상태와 조사 결과

- 검색 입력과 비활성 북마크 버튼이 같은 줄에 있어 검색 폭이 좁다.
- 외곽 카드, 검색창, 목록 행에 둥근 테두리가 겹쳐 좁은 사이드패널이 답답해 보인다.
- 전체 URL을 표시해 도메인과 창 번호를 빠르게 훑기 어렵다.
- 우측 `LocateFixed` 아이콘만으로는 탭 이동 동작을 알아보기 어렵다.

## 포함 범위와 제외 범위

- 포함: 열린 탭 헤더·검색·선택·목록 행의 시각 위계, 도메인 표시, 탭 이동 affordance.
- 제외: 세션 저장, 새 필터, Chrome API 및 북마크 동작 변경, 상단 전역 내비게이션 변경.

## 변경할 파일과 구현 순서

1. `lib/tab-actions.ts`에 목록용 위치 라벨 변환을 추가하고 단위 테스트한다.
2. `components/OpenTabsPanel.tsx`를 전폭 검색 + 조건부 북마크 작업 바 + 평평한 목록으로 재구성한다.
3. 관련 테스트, 타입 검사, 빌드를 실행한다.
4. `docs/WorkLog.md`에 변경 및 검증 결과를 기록한다.

## 위험과 검증 방법

- 내부 Chrome URL과 파일 URL은 일반 호스트가 없으므로 별도 라벨 fallback이 필요하다.
- 체크 선택, 검색 결과 전체 선택, 북마크 생성, 탭 이동의 기존 이벤트 경로를 유지한다.
- `cd extension && pnpm test && pnpm compile && pnpm build`로 검증한다.

## 완료 조건

- 검색창이 전폭으로 보이고 비선택 상태에 비활성 북마크 버튼이 노출되지 않는다.
- 선택 시 북마크 작업만 나타나며 세션 저장 액션은 없다.
- 각 행에서 제목, 도메인·창 번호, 탭 이동 동작을 빠르게 구분할 수 있다.
- 관련 테스트, 타입 검사, 빌드가 통과하고 WorkLog가 갱신된다.

**검증:** `pnpm test` 17개 파일 147개 통과 · `pnpm compile` 통과 · `pnpm build` 통과.
실제 Chrome 확장 재로드 후 시각 스모크는 미실시.

## 후속 — 타임라인·세션 목록과 시각 일관성 조정

**상태:** 구현 완료 (2026-08-12)

- 타임라인의 접이식 검색과 작은 sticky 헤더 패턴을 열린 탭에도 적용한다.
- 행 패딩, 제목 굵기, 파비콘 크기를 타임라인·세션 행과 같은 밀도로 낮춘다.
- 반복되는 탭 이동 아이콘은 평소 숨기고 hover/focus에서만 노출한다.
- 검색·선택·북마크·탭 이동 동작과 세션 저장 제외 범위는 유지한다.
- `OpenTabsPanel.tsx`, `OpenTabsView.tsx`만 구현 변경하고 공식 extension 검증을 재실행한다.

**검증:** `pnpm test` 17개 파일 147개 통과 · `pnpm compile` 통과 · `pnpm build` 통과.
실제 Chrome 확장 재로드 후 시각 스모크는 미실시.

### 후속 — 검색 전개 방향 통일

**상태:** 구현 완료 (2026-08-12)

- 열린 탭 검색도 타임라인과 같이 목록 헤더 위에서 펼쳐지게 순서를 맞춘다.
- 탭 행의 `창 N` 메타는 제거하고 도메인만 표시한다.
- 검색·선택·북마크·탭 이동 동작은 변경하지 않는다.

**검증:** `pnpm test` 17개 파일 147개 통과 · `pnpm compile` 통과 · `pnpm build` 통과.
실제 Chrome 확장 재로드 후 시각 스모크는 미실시.

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

---

# 세션 별칭(alias)과 네비게이터 정렬

**상태:** 구현 중 (2026-08-12)
**브랜치:** `feat/dashboard-design`

## 작업 목표

1. 세션 이름을 사용자가 바꿀 수 있게 하되, **내부 이름(`title`)은 그대로 두고 별칭(`alias`)에
   저장**한다. 사용자에게는 그냥 "이름 수정"으로 보인다.
2. 대시보드 네비게이터에 세션 이름 편집(별칭 지정) 기능을 넣는다.
3. 네비게이터에 **최신순 / 가나다순** 정렬을 넣는다.

## 현재 상태와 조사 결과

`PATCH /sessions/{id}` 는 지금 `session.title` 을 **덮어쓴다**(`api/sessions.py:313`).
`title` 은 사용자 편집 대상이 아닌 곳에서 이미 광범위하게 쓰인다.

| 위치 | 용도 | 이름이 바뀌면 |
| --- | --- | --- |
| `api/sessions.py:429` | `_embed_and_upsert(id, title, summary)` | Qdrant 벡터가 옛 제목 기준으로 남아 검색이 어긋난다 |
| `services/merge_service.py:67` | `_title_jaccard` 병합 게이팅 | 병합 판정이 사용자 작명에 좌우된다 |
| `services/merge_suggester.py:57` | 후보 토큰 겹침 | 위와 같음 |
| `services/session_updater.py:395` | 배치가 제목을 다시 만든다 | **사용자가 바꾼 이름이 덮인다** |
| `services/recommender/service.py:93` | 추천 신호 term 추출 | 추천 근거가 흔들린다 |

즉 사용자 요청대로 이름을 별도 항목으로 분리하는 것이 맞다.

편집 진입점은 이미 둘 있고 둘 다 `renameSession`(=title 덮어쓰기)을 부른다.

- `entrypoints/sidepanel/views/SessionDetailView.tsx:51`
- `entrypoints/newtab/components/atlas/AtlasDetail.tsx:53`

네비게이터(`AtlasNavigator.tsx`)에는 폴더 이름 편집만 있고 세션 편집이 없다.
정렬은 어디에도 없다 — `buildAtlasSessions` 가 활동 시각 내림차순으로 한 번 정렬할 뿐이다.

## 설계 결정

### 표시 이름은 서버가 합친다

응답의 `title` 은 **`alias or title`(표시 이름)** 이다. `alias` 는 편집창 초기값과
"되돌리기" 판단용으로 따로 내려보낸다. 클라이언트가 매 화면에서 합치면 한 곳이라도
빠지는 순간 같은 세션이 두 이름으로 보인다 — 사용자 요구("어디든 이름 수정처럼")를
지키려면 경계 한 곳에서 끝내야 한다.

내부 로직은 ORM 의 `session.title` 을 그대로 쓰므로 canonical 이 유지된다.

**의도적 예외**: Ask 프롬프트(`ask_service._session_block`)와 추천 리랭크 프롬프트는
`SessionDetail`/`SessionSignals` 를 거치므로 별칭을 본다. 사용자가 붙인 이름은 질의와
더 가까우므로 그대로 둔다 — 벡터·병합 점수처럼 저장된 값과 대조하는 경로가 아니다.

### 별칭 지우기

`alias` 에 `null` 또는 빈 문자열을 보내면 별칭을 지우고 원래 이름으로 돌아간다.

### 정렬

`sortSessions(sessions, mode)` 순수 함수. `recent`(활동 시각 내림차순, 기존 기본값)와
`title`(표시 이름 가나다순, `localeCompare(_, 'ko')`). 폴더 안 세션과 미정리 목록에
모두 적용한다. 폴더 자체 순서는 `position` 을 유지한다(사용자가 만든 순서).

상태는 `nav-state` 에 둔다 — 메인·아틀라스가 네비게이터를 공유한다.

## 변경할 파일

**backend**

| 파일 | 변경 |
| --- | --- |
| `app/db/models.py` | `Session.alias` 컬럼, `DISPLAY_TITLE` SQL 식 |
| `app/db/migrations.py` | `sessions.alias` additive 등록 |
| `app/schemas/session.py` | `PatchSessionRequest.alias`, `SessionDetail.alias` |
| `app/api/sessions.py` | `_to_detail` 표시 이름, `patch_session` 별칭 저장 |
| `app/api/analytics.py` | top 세션 표시 이름 |
| `app/api/events.py` | 타임라인 `session_title` 표시 이름 |
| `app/api/search.py` | 검색 결과 `session_title` 표시 이름 |
| `app/services/merge_suggester.py` | 병합 제안 표시 이름 (점수는 canonical 유지) |
| `app/services/recommender/service.py` | 추천 카드 표시 이름 |

**extension**

| 파일 | 변경 |
| --- | --- |
| `lib/types.ts` | `Session.alias` |
| `lib/api.ts` | `renameSession` → `setSessionAlias`, `mapSession` 에 alias |
| `entrypoints/sidepanel/hooks/useSessions.ts` | `useRenameSession` → 별칭 뮤테이션 |
| `entrypoints/sidepanel/views/SessionDetailView.tsx` | 호출부 |
| `entrypoints/newtab/components/atlas/AtlasDetail.tsx` | 호출부 |
| `entrypoints/newtab/components/atlas/data.ts` | `SessionNode.alias`, `sortSessions` |
| `entrypoints/newtab/lib/nav-state.ts` | `sessionSort` |
| `entrypoints/newtab/hooks/useFolders.ts` | 세션 별칭 뮤테이션 추가 |
| `entrypoints/newtab/components/atlas/AtlasNavigator.tsx` | 세션 편집 UI, 정렬 버튼 |
| `entrypoints/newtab/components/VariantAtlasReplica.tsx` | 정렬 상태 전달 |
| `entrypoints/newtab/styles/atlas.css` | 필요한 스타일 |

## 구현 순서

1. 백엔드 모델·마이그레이션·스키마 (계약 먼저)
2. 백엔드 응답 경계 표시 이름 적용
3. 백엔드 테스트
4. 익스텐션 타입·API 클라이언트
5. 기존 rename 호출부 2곳 전환
6. `sortSessions` + 네비게이터 UI
7. 익스텐션 테스트·타입·빌드

## 테스트 및 검증

- backend `pytest`:
  - `PATCH {alias}` 가 `title` 을 건드리지 않는다
  - 별칭이 있으면 목록·상세의 `title` 이 별칭이다
  - `alias: null`/빈 문자열이 별칭을 지운다
  - 100자 초과는 422
- extension `vitest`:
  - `sortSessions` 최신순/가나다순, 빈 목록, 동률
  - 별칭이 있는 세션의 `SessionNode` 매핑
- `pnpm compile`, `pnpm build`

## 위험

- **`session_updater` 가 배치마다 제목을 다시 만든다**(`:395`). 별칭은 별도 컬럼이라
  덮이지 않는다 — 이것이 별칭 분리의 핵심 이득이다.
- 기존 사용자가 예전 rename 으로 이미 `title` 을 바꿔 놓았을 수 있다. 그 값은 그대로
  두고 마이그레이션하지 않는다(되돌릴 원본이 없다).
- `updated_at` 은 `onupdate` 로 자동 갱신된다. 목록 정렬은
  `coalesce(last_activity_at, created_at)` 기준이라 순서는 흔들리지 않는다.

## 완료 조건

- 이름을 바꿔도 DB `sessions.title` 이 그대로다.
- 대시보드·사이드패널·검색·추천·타임라인 어디서나 바꾼 이름이 보인다.
- 네비게이터에서 세션 이름을 편집할 수 있다.
- 네비게이터 정렬이 최신순/가나다순으로 바뀐다.

---

## 2026-08-12 — 사이드패널 세션 분류 동작 위치·표현 정리

### 목표와 조사 결과

전역 상단의 수동 동기화 아이콘은 대상과 결과가 불명확하다. 타임라인 첫 sticky 날짜 헤더에는
이미 분류 대기 개수와 마지막 동기화 시각이 있으므로, 같은 문맥에 `세션 분류` 동작을 둔다.

### 범위

- 포함: 상단 바 동작 제거, 타임라인 첫 헤더의 조건부 `세션 분류` 버튼, 토스트와 IA·결정·작업 기록.
- 제외: `SYNC_NOW` 메시지와 동기화 엔진, 백엔드 세션화 계약 변경.

### 구현·검증

1. `TopNavBar`에서 수동 동기화 UI를 제거한다.
2. `TimelineView`가 기존 `triggerManualSync`를 호출하고 상태를 `TimelineDateHeader`에 전달한다.
3. 분류 대기가 있을 때만 `대기 N · 세션 분류`를 표시한다.
4. `pnpm.cmd test`, `pnpm.cmd compile`, `pnpm.cmd build`, `git diff --check`를 실행한다.

### 위험과 완료 조건

- 메시지 응답은 분류 완료가 아니라 요청 접수이므로 토스트는 완료를 주장하지 않는다.
- 상단 바에는 설정만 남고, 타임라인에서 분류 대기와 실행 동작을 함께 확인할 수 있으면 완료다.

---

## 2026-08-12 — 새 탭·사이드패널 로그인 화면 통일

### 목표와 조사 결과

두 로그인 화면은 같은 인증 흐름을 쓰지만 새 탭은 빈 화면 중앙의 작은 묶음, 사이드패널은 별도
축소 레이아웃이라 제품 인상과 안내 문구가 다르다. 인증 로직은 유지하고 시각 구조와 카피만 맞춘다.

### 범위

- 포함: Orbit 마크, 제목·설명, Google CTA, 수집 선택 안내, 오류 상태의 공통 시각 규칙.
- 제외: 인증 API·권한·세션 저장 방식, 새 의존성, 새 이미지 자산.

### 구현·검증

1. 새 탭 로그인 화면을 표면 카드와 은은한 Orbit 배경 광원으로 정리한다.
2. 사이드패널은 같은 위계와 카피를 좁은 폭의 무경계 레이아웃으로 적용한다.
3. 기존 로고와 테마 토큰만 재사용하고 라이트·다크 모드를 함께 지원한다.
4. `pnpm.cmd test`, `pnpm.cmd compile`, `pnpm.cmd build`, `git diff --check`를 실행한다.

### 위험과 완료 조건

- Google 버튼은 새 브랜드 자산을 임의 제작하지 않고 텍스트 `G` 표식만 사용한다.
- 두 화면에서 로그인 이유와 수집 선택권이 보이고, loading·error 상태가 유지되면 완료다.

---

## 2026-08-12 — 설치 후 온보딩 프로토타입

### 작업 목표

확장 설치 직후 로그인부터 수집 opt-in, 핵심 기능 이해까지 끊기지 않는 첫 실행 흐름을 만든다.
실데이터가 없는 시점에도 제품 형태를 이해할 수 있도록 사이드패널 투어에는 mock 데이터를 쓴다.

### 현재 상태와 조사 결과

- 설치 이벤트 처리와 온보딩 상태 저장소는 아직 없다.
- 로그인 상태와 설정은 이미 `chrome.storage.local` 변경을 구독한다.
- 수집은 기본 off이며 `setCollectionEnabled(true)`가 실제 수집 시작 계약이다.
- `chrome.sidePanel.open()`은 사용자 제스처 안에서 호출해야 하므로 로그인 완료 직후 자동 호출보다
  별도 `사이드패널에서 시작하기` CTA가 안전하다.
- 신규 사용자에게 실데이터가 없으므로 기존 쿼리 화면을 그대로 쓰면 empty state만 보여 기능 설명이
  어렵다.

### 포함 범위

- 설치 시 `newtab.html?onboarding=1` 탭 열기
- 로그인 후 사이드패널 시작 CTA
- `chrome.storage.local` 기반 pending/touring/complete 상태
- 수집 켜기 → 타임라인 → 세션 → Ask의 4단계 spotlight 투어
- 다음·건너뛰기·완료, mock 타임라인/세션/Ask UI
- 완료 후 실제 사이드패널로 전환

### 제외 범위

- 백엔드 API·스키마 변경
- 실제 사용자 데이터를 온보딩에 섞기
- 열린 탭·설정·대시보드 전체 기능 투어
- 분석 이벤트와 A/B 테스트
- 기존 사용자에게 강제 노출

### 변경할 파일 또는 모듈

- `lib/onboarding.ts` — 상태 계약·저장·설치 초기화
- `entrypoints/background.ts` — 최초 설치 탭 열기
- `entrypoints/newtab/main.tsx`, `components/sections/OnboardingLaunch.tsx` — 로그인 후 패널 시작
- `entrypoints/sidepanel/App.tsx`, `components/onboarding/*` — mock 화면과 spotlight 투어
- `tests/unit/onboarding.test.ts` — 저장 상태와 설치 분기
- `docs/IA.md`, `docs/UserScenarios.md`, `docs/DecisionLog.md`, `docs/WorkLog.md`

### 구현 순서

1. 온보딩 상태 타입과 storage 계약을 만든다.
2. `onInstalled(reason === 'install')`에서 pending 상태와 안내 탭을 만든다.
3. 로그인 완료 화면에서 사용자 클릭으로 touring 상태 설정과 사이드패널 열기를 동시에 요청한다.
4. 사이드패널에서 mock 화면·spotlight·다음/건너뛰기/완료를 구현한다.
5. 첫 단계의 `수집 켜기`만 실제 설정에 반영한다.
6. 테스트·타입 검사·빌드 후 문서를 갱신한다.

### 테스트 및 검증

- 설치 이유가 `install`일 때만 pending 저장과 안내 탭 생성
- 기본 상태는 complete로 간주해 기존 사용자에게 노출하지 않음
- start/step/complete 상태 전환
- `pnpm.cmd test`, `pnpm.cmd compile`, `pnpm.cmd build`, `git diff --check`

### 위험과 완료 조건

- 패널 열기 실패 시 툴바 Orbit 아이콘으로 열 수 있다는 오류 안내를 남긴다.
- mock UI는 투어 안에서만 렌더링하고 실제 데이터 저장·API 호출을 하지 않는다.
- 건너뛰기는 수집 설정을 임의로 켜지 않고 complete만 저장한다.
- 신규 설치 흐름과 기존 사용자 비노출이 모두 확인되면 완료다.

### 후속 시각 검증 및 상호작용 보정

- Codex에 Playwright MCP를 등록하고, 빌드된 확장 화면을 사이드패널 크기로 확인한다.
- 설명 카드는 강조 영역과 겹치지 않는 쪽에 배치하며 좁은 높이에서도 화면 안에 유지한다.
- 첫 단계는 설명 카드의 대체 버튼이 아니라 강조된 실제 `수집 켜기` 버튼을 클릭해야 진행되게 한다.
- 오버레이는 강조 영역 바깥 입력만 막고 실제 `수집 켜기` 영역은 포인터 입력을 통과시킨다.
- 420×800 및 320×700 수준의 좁은 화면에서 가림·잘림·직접 클릭을 확인한다.

### 실제 화면 형식 정합성 보정

- 별도로 그린 mock 카드 대신 기존 `CollectionOptInNotice`, `TimelineDateHeader`, `TimelineItem`,
  `SessionRow`의 화면 문법을 그대로 재사용한다.
- 수집·타임라인·세션 단계의 설명 카드는 항상 강조 영역 아래, Ask 단계는 강조 영역 위에 둔다.
  공간이 부족하면 설명 카드 내부만 스크롤하며 강조 영역과 겹치는 fallback은 두지 않는다.
- 실제 조작이 필요한 수집 단계만 강조 영역 입력을 허용하고 나머지 mock 단계는 입력을 차단한다.
- 사용자가 제보한 실제 사이드패널과 같은 461×799 다크 모드를 추가 검증한다.

### 사용자가 직접 탭을 이동하는 확장 투어

- mock 타임라인·세션·열린 탭에 실제 목록 밀도를 확인할 수 있도록 여러 묶음과 충분한 행을 채운다.
- 온보딩 단계를 `수집 → 타임라인 설명 → 세션 탭 클릭 → 세션 설명 → 열린 탭 클릭 → 열린 탭
  설명 → Ask`로 확장한다.
- 화면 전환은 단계 증가로 자동 실행하지 않는다. 강조된 `세션`, `열린 탭` 버튼을 사용자가 직접
  눌렀을 때만 화면과 단계가 함께 바뀐다.
- 콘텐츠 설명 단계는 한 행이 아니라 여러 대표 행을 묶어 강조하고, 나머지 데이터도 배경에서 화면
  구조가 읽히게 유지한다.
- 단계 저장·재개 시 현재 단계에 맞는 탭 화면도 복원한다.

---

## 2026-08-12 — 새 탭 검색창 최근 검색 기록

**브랜치:** `feat/search-history`

### 작업 목표

새 탭 히어로 검색창에 커서가 들어가면 크롬·구글 새 탭처럼 최근 검색 기록 드롭다운이 뜨고,
항목을 고르면 바로 그 검색어로 검색이 실행되게 한다.

### 현재 상태와 조사 결과

- 검색 실행은 `OrbitHero.handleSubmit`이 담당한다. `parseOmniboxInput`으로 주소/검색어를
  가른 뒤 주소면 `window.location.assign`, 검색어면 `chrome.search.query`로 넘긴다.
- 검색어를 어디에도 남기지 않으므로 최근 기록의 원천이 없다.
- 확장에 `history` 권한이 없고, 이미지의 구글 드롭다운은 구글 계정 검색 기록이라 확장이
  그대로 읽을 수 없다.
- 바로가기(`newtab/lib/shortcuts.ts`)가 `chrome.storage.local` + 순수 로직 분리라는
  같은 계열의 선례를 이미 갖고 있다.

### 사용자 결정 사항 (확인 완료)

- 데이터 출처는 **Orbit 검색창에서 실행한 검색어만** 로컬에 저장한다. `history` 권한을
  추가하지 않는다.
- 드롭다운 항목을 고르면 **바로 검색을 실행**한다.

### 포함 범위

- 검색 모드에서 실행한 검색어를 `chrome.storage.local`에 최근순으로 저장 (상한 10개)
- 검색창 포커스 시 드롭다운 표시, 입력값이 있으면 그 값으로 필터
- 클릭/Enter로 즉시 검색, ↑↓ 이동, Esc·바깥 클릭으로 닫기
- 항목별 삭제

### 제외 범위

- `history` 권한과 브라우저 방문 기록 파싱
- 검색어 자동완성(외부 suggest API 호출)
- AI 모드 질문 기록
- 백엔드 저장·동기화

### 변경할 파일 또는 모듈

- `entrypoints/newtab/lib/search-history.ts` — 순수 로직과 저장소 (신규)
- `entrypoints/newtab/components/sections/SearchHistoryDropdown.tsx` — 드롭다운 (신규)
- `entrypoints/newtab/components/sections/OrbitHero.tsx` — 포커스·키보드·검색 실행 연결
- `entrypoints/newtab/styles/index.css` — 드롭다운 스타일
- `tests/unit/search-history.test.ts` — 순수 로직과 저장소 (신규)

### 구현 순서

1. 저장 형식과 순수 로직(추가·중복 승격·상한·필터)을 먼저 만들고 테스트한다.
2. 드롭다운 컴포넌트를 만든다.
3. `OrbitHero`의 검색 실행 경로에서 기록을 남기고 드롭다운을 배선한다.
4. 스타일을 추가한다.
5. `pnpm test`, `pnpm compile`, `pnpm build`를 실행한다.

### 테스트 및 검증

- 중복 검색어는 새로 쌓지 않고 맨 위로 올라간다.
- 상한을 넘으면 가장 오래된 항목이 밀려난다.
- 빈 문자열·공백만 입력은 기록하지 않는다.
- 필터는 대소문자를 구분하지 않는다.
- 저장소 읽기·쓰기 실패가 검색 자체를 막지 않는다.

### 위험과 완료 조건

- 기록은 로컬에만 남기며 동기화하지 않는다. 삭제 수단을 함께 제공한다.
- 주소로 해석되는 입력(`github.com`)은 검색어가 아니므로 기록하지 않는다.
- 드롭다운이 바로가기 영역을 밀어내지 않도록 절대 배치한다.
- 포커스 시 목록이 뜨고 선택 시 검색이 실행되며 검증 명령이 모두 통과하면 완료다.

---

# 2026-08-12 — 실 Backend·실 LLM Playwright 데모 영상

## 작업 목표

실제 Orbit 확장, Backend, PostgreSQL/Qdrant, LLM을 사용해 하나의 탐색이 자동으로 세션이 되고,
사이드패널과 새 탭 홈·Atlas에서 다시 발견·복원되는 과정을 90~120초 제품 데모 영상으로 만든다.
데모용 API 응답, UI mock, DB 직접 주입은 사용하지 않는다.

## 현재 상태와 조사 결과

- 저장소에는 Playwright로 빌드 확장을 로드해 실제 Backend·LLM까지 검증한 이력이 있지만,
  당시 스크립트는 스크래치패드에만 있었고 재사용 가능한 촬영 스크립트는 없다.
- 사이드패널은 `타임라인 / 세션 / 열린 탭`과 하단 Ask 독으로 구성되고, 새 탭 홈은 최근 탐색,
  이어서 탐색하기, 추천 세션, AI 질문, Atlas 진입을 제공한다.
- 새 탭 Atlas는 세션의 페이지와 탐색 순서를 궤도·타임라인·상세 패널로 보여주므로
  사이드패널에서 만들어진 세션이 메인 대시보드로 이어지는 장면에 적합하다.
- Extension에는 Playwright 실행 의존성이 없고 이 머신에는 `ffmpeg`가 설치되어 있지 않다.
- 현재 작업 트리의 `OrbitHero.tsx`, `newtab/styles/index.css` 변경과 `.playwright-mcp/`,
  `docs/orbit-logic.html`, `fig-map.png`, `top.png` 미추적 파일은 사용자 작업이므로 데모 작업에서
  덮어쓰거나 되돌리지 않는다.

## 사용자 결정 사항 (확인 완료)

- 브라우저 자동 조작은 Playwright를 사용한다.
- 실제 Backend와 실제 LLM 호출을 사용한다. 해당 제품 흐름에서 발생하는 LLM 비용을 허용한다.
- 사이드패널과 메인 대시보드(새 탭 홈 및 Atlas)를 모두 영상에 포함한다.
- `backend/eval/` 평가 하네스는 실행하지 않는다.

## 데모 전제와 기본 연출

- 전용 Chrome 프로필과 전용 데모 계정을 사용해 기존 기록·개인정보를 영상에 노출하지 않는다.
  기존 계정 데이터를 자동 삭제하거나 수정하지 않는다.
- 기본 이야기 소재는 **“오사카 3박 4일 여행 준비”**로 한다. 로그인·CAPTCHA가 없고 제목·본문이
  안정적인 공개 페이지 4개를 골라 교통, 숙소 지역, 관광지, 일정 탐색 흐름을 만든다.
- 한국어 자막, 다크 테마, 1920×1080, 30fps, 최종 길이 90~120초를 기본값으로 둔다.
  내레이션과 배경음악은 첫 버전에서 제외한다.
- LLM 대기 시간은 숨기지 않고 로딩 상태를 1~2초 보여준 뒤 점프 컷으로 줄인다.

## 스토리보드

1. **0~8초 — 문제와 시작**
   - 일반 Chrome 페이지와 오른쪽 Orbit 사이드패널을 함께 보여준다.
   - “찾아본 페이지가 아니라, 찾아간 흐름을 기억합니다” 자막으로 시작한다.
2. **8~28초 — 실제 탐색과 상시 수집**
   - 여행 관련 공개 페이지 4개를 순서대로 방문하고 각 페이지에서 4~8초 머문다.
   - 사이드패널 타임라인에 실제 방문 이벤트가 `분류 대기`로 쌓이는 모습을 동시에 보여준다.
3. **28~45초 — 실 LLM 자동 세션화**
   - 타임라인의 `세션 분류`를 누르고 실제 `/sync` 파이프라인을 실행한다.
   - 로딩 상태를 짧게 보여준 뒤 `세션` 탭에서 새로 만들어진 세션을 펼쳐 실제 AI 제목·요약과
     방문 시각순 페이지 목록을 보여준다.
4. **45~65초 — 메인 대시보드로 연결**
   - 새 탭 홈을 전체 화면으로 전환한다.
   - 방금 생성된 세션이 `최근 탐색`과 `이어서 탐색하기`에 나타난 것을 보여준다.
5. **65~82초 — Atlas에서 탐색 경로 확인**
   - 해당 세션의 `상세 보기`를 눌러 Atlas로 이동한다.
   - 궤도의 페이지 순서, 탐색 인사이트, AI 요약을 차례로 강조한다.
6. **82~105초 — 목적 중심으로 다시 찾기**
   - 새 탭 홈의 AI 모드에서 “오사카 여행 준비하면서 찾아본 자료 다시 보여줘”를 입력한다.
   - 실제 Ask 응답과 관련 세션을 보여주고 세션으로 다시 이동한다.
7. **105~120초 — 작업 복원과 엔딩**
   - `세션 복원`으로 관련 페이지가 다시 열리는 것을 보여준다.
   - “탭을 정리하는 것이 아니라, 탐색 흐름을 기억한다. Orbit.”으로 끝낸다.

## 포함 범위

- 공식 명령으로 Backend·인프라·Extension을 실제 기동하고 상태를 확인한다.
- Playwright persistent context에 빌드 확장을 로드하고 전용 프로필의 실제 로그인 세션을 재사용한다.
- 실제 공개 페이지 방문 → 로컬 큐 → `/sync` → 세션화 → Ask → 복원 흐름을 실행한다.
- 실제 `sidepanel.html`을 461×799 target으로 동시에 녹화하고, 탐색 페이지 영상 오른쪽에 합성한다.
  새 탭 홈과 Atlas는 1920×1080 전체 화면 장면으로 전환한다.
- 자연스러운 커서 이동, 35~65ms 타이핑 간격, 클릭 전후 300~800ms 정지를 적용한다.
- 원본 WebM과 최종 MP4를 로컬 산출물로 남긴다.

## 제외 범위

- 온보딩, 설정, 병합, 북마크, 오류 상태 등 핵심 이야기와 무관한 기능 투어
- API 응답 가로채기, fixture 데이터, DB 직접 seed, LLM 응답 수정
- 기존 사용자 데이터 삭제와 운영 환경 배포
- 음성 내레이션, 배경음악, 다국어 버전
- 제품 UI에 데모 전용 플래그·라우트·컴포넌트 추가

## 변경할 파일 또는 모듈

- `extension/scripts/demo-live.mjs` — 브라우저 조작, 상태 대기, 원본 클립 녹화, ffmpeg 합성
- `extension/package.json`, `extension/pnpm-lock.yaml` — Playwright 개발 의존성과 `demo:record` 명령
- `.gitignore` — 민감한 브라우저 프로필과 대용량 영상 산출물이 커밋되지 않게 제외
- `docs/Plan.md`, `docs/WorkLog.md` — 계획과 실행·오류·검증 이력

제품 화면·Backend 코드는 데모 중 발견된 실제 결함을 사용자가 별도 승인하지 않는 한 수정하지 않는다.

## 구현 순서

1. 큰 변경이므로 `chore/live-demo-video` 브랜치를 만들되 현재 사용자 변경을 보존한다.
2. API 키 값을 출력하지 않고 `.env` 존재, Docker/PostgreSQL/Qdrant, Backend health, 확장 빌드를
   사전 점검한다.
3. Playwright와 녹화·합성용 portable ffmpeg를 준비한다. ffmpeg는 저장소 밖 도구 캐시에 두고
   실행 파일과 바이너리를 커밋하지 않는다.
4. 전용 Chrome 프로필을 저장소 밖에 만들고 사용자가 최초 Google 로그인을 한 번 완료한다.
5. 녹화 없이 전체 제품 흐름을 한 번 드라이런한다. 새 세션은 AI 제목 문자열이 아니라 이번 방문 URL과
   가장 최근 활동 시각으로 식별한다.
6. 사이드패널과 탐색 페이지를 동시에 녹화하고, 이어서 새 탭 홈·Atlas·Ask·복원 장면을 녹화한다.
7. Playwright 원본 클립을 ffmpeg로 합성하고 자막·점프 컷·페이드만 최소 적용한다.
8. 최종 영상을 검토하고 공식 검증 명령과 문서 기록을 완료한다.

## 테스트 및 검증

- 드라이런에서 실제 방문 이벤트 4건 이상이 로컬 타임라인에 나타난다.
- 수동 분류 후 실제 Backend `sync`가 성공하고 새 세션이 생성되거나 관련 세션에 추가된다.
- 사이드패널 세션 행에서 실제 AI 요약과 방문 페이지가 표시된다.
- 새 탭 홈에서 같은 세션이 최근 탐색에 표시되고 Atlas에 실제 이벤트 순서가 나타난다.
- Ask가 동일 세션을 관련 근거로 반환하고 세션 복원이 실제 탭을 연다.
- 정확한 AI 제목·문장에는 의존하지 않고 로딩·실패·타임아웃을 구분한다.
- `cd extension && pnpm test && pnpm compile && pnpm build`
- `cd backend && python -m pytest -p no:asyncio`
- `git diff --check`
- `ffprobe`로 최종 MP4의 1920×1080, 30fps, 재생 시간, 정상 종료를 확인하고 처음부터 끝까지
  실제 재생해 개인정보·알림·비밀값 노출이 없는지 검토한다.

## 위험과 대응

- **LLM 결과 변동:** 제목 문구에 기대지 않고 최신 세션과 방문 URL로 추적한다. 분류가 갈리면
  공개 페이지 구성을 조정해 한 번만 다시 촬영하며 응답을 조작하지 않는다.
- **외부 페이지 변동:** 로그인·CAPTCHA·자동 재생·쿠키 팝업이 없는 정적 페이지를 사전 확인한다.
- **LLM 지연과 비용:** 호출을 순차 처리하고 드라이런 1회 + 본 촬영 1회를 기본 상한으로 둔다.
- **개인정보 노출:** 전용 프로필·계정만 사용하고 OS 전체 화면이 아니라 Playwright page video를
  합성한다. 토큰, `.env`, 개발자 도구, 개인 알림은 영상에 포함하지 않는다.
- **사이드패널 합성:** 실제 `sidepanel.html`과 동일한 프로필·Backend를 사용하지만 Chrome 외곽 UI는
  녹화하지 않는다. 실제 Chrome 사이드패널 컨테이너까지 필요하면 수동으로 패널을 연 뒤 OS 창 캡처가
  필요하므로 별도 촬영 방식으로 전환한다.
- **기존 작업 충돌:** 현재 수정 중인 `OrbitHero.tsx`와 `index.css`를 덮어쓰지 않고, 구현 전 diff를
  다시 확인한다.

## 완료 조건

- 실제 Backend·LLM으로 생성된 동일 세션이 사이드패널, 새 탭 홈, Atlas, Ask, 복원 장면에 이어진다.
- 최종 MP4가 90~120초 안에서 제품의 `기록 → 자동 세션화 → 재발견 → 복원` 이야기를 전달한다.
- fixture·mock·DB 직접 주입 없이 두 화면이 실제 데이터로 동작한다.
- 관련 테스트·빌드·영상 검증이 통과하고 `docs/WorkLog.md`에 비용 발생 호출, 오류, 재촬영 횟수,
  검증 결과를 기록한다.

---

## 2026-08-12 — 온보딩 완료 후 대시보드 진입, 최근 검색 기록 드롭다운 정렬

**브랜치:** `main`

### 작업 목표

1. 온보딩 투어가 끝난 뒤 안내 탭이 멈춰 있지 않고 대시보드(아틀라스)로 넘어가게 한다.
2. 최근 검색 기록 드롭다운이 검색창 바로 아래에 구글 새 탭처럼 이어 붙어 열리게 한다.

### 현재 상태와 조사 결과

- 사이드패널 투어의 `완료`·`건너뛰기`는 `completeOnboarding()`으로 `orbit:onboarding`을
  `complete`로 저장하기만 한다(`OnboardingPrototype.tsx:497,507`).
- 안내 탭(`newtab.html?onboarding=1`)의 `OnboardingLaunch`는 그 변화를 구독하지 않아
  `사이드패널에서 계속하세요` 상태로 남는다. 첫 실행이 화면 없이 끊긴다.
- `main.tsx:25`의 `onboarding` 플래그는 매 렌더 `window.location.search`를 다시 읽으므로,
  쿼리를 지우고 popstate 를 알리면 안내 화면에서 벗어난다.
- 드롭다운은 `position: absolute` 기준이 `.search-container`였는데 이 컨테이너가 검색창과
  바로가기를 함께 감싸고 있어 `top: 100%`가 바로가기 아래를 가리켰다.

### 포함 범위

- `replaceWithAtlas()` — `onboarding=1` 쿼리를 지우고 아틀라스 해시로 히스토리를 덮어쓴다
- `OnboardingLaunch`가 온보딩 상태를 구독해 `complete`가 되면 대시보드로 넘어간다
- 드롭다운 기준을 검색창만 감싼 `form`으로 바꾸고, 열린 동안 입력창과 한 판으로 잇는다

### 제외 범위

- 온보딩 단계·문구·mock 데이터 변경
- 안내 탭이 이미 닫힌 경우 새 탭을 다시 열어 주기
- 대시보드 진입 시 네비게이터를 펼친 채 열기(히어로 그래픽 경로만 유지)
- 신규 사용자의 빈 대시보드 화면 자체를 손보기

### 변경할 파일

- `entrypoints/newtab/lib/navigation.ts` — `replaceWithAtlas()`
- `entrypoints/newtab/components/sections/OnboardingLaunch.tsx` — 완료 감지와 이동
- `entrypoints/newtab/styles/index.css` — `.search-container > form`, `.search-shell--with-history`
- `entrypoints/newtab/components/sections/OrbitHero.tsx` — 열림 상태 클래스

### 테스트 및 검증

- `pnpm test`, `pnpm compile`, `pnpm build`
- 실제 브라우저: 설치 → 로그인 → 사이드패널 투어 완료 → 안내 탭이 대시보드로 바뀌는지
- 뒤로가기로 안내 화면에 돌아가지 않는지(replaceState)

### 위험과 완료 조건

- 온보딩을 이미 끝낸 사용자가 `?onboarding=1`을 직접 열면 즉시 대시보드로 넘어간다(의도된 동작).
- 안내 탭이 닫혀 있으면 이동 대상이 없어 아무 일도 일어나지 않는다. 알려진 한계로 남긴다.
- 투어 완료 직후 안내 탭이 대시보드로 바뀌고 드롭다운이 검색창에 붙어 열리면 완료다.
