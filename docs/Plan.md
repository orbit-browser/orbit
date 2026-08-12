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

### 작업 목표와 조사 결과

확장 설치 직후 로그인부터 수집 opt-in, 핵심 기능 이해까지 이어지는 첫 실행 흐름을 만든다. 신규
사용자에게는 실데이터가 없고 `chrome.sidePanel.open()`은 사용자 제스처가 필요하므로, 로그인 후
별도 CTA로 패널을 열고 격리된 mock 데이터를 사용한다.

### 포함 범위와 제외 범위

- 포함: 최초 설치 안내 탭, 로그인 후 패널 시작 CTA, storage 상태, 7단계 spotlight, 충분한 mock
  타임라인·세션·열린 탭, Ask, 다음·건너뛰기·완료, 단계 재개.
- 제외: 백엔드 API·스키마, 실제 데이터 저장, 분석 이벤트, A/B 테스트, 기존 사용자 강제 노출,
  설정 기능 안내.

### 변경 파일과 구현 순서

- `lib/onboarding.ts`, `lib/useOnboarding.ts` — 상태 계약·저장·구독.
- `entrypoints/background.ts` — 최초 설치 탭 열기.
- `entrypoints/newtab/main.tsx`, `OnboardingLaunch.tsx` — 로그인 후 사용자 클릭으로 패널 열기.
- `entrypoints/sidepanel/App.tsx`, `components/onboarding/*` — mock 화면과 spotlight.
- `CollectionOptInNotice.tsx` — 실제 수집 설정 완료 콜백.
- `tests/unit/onboarding.test.ts` — 저장 상태와 설치 분기.

1. pending/touring/complete 상태 계약을 만든다.
2. 설치 시에만 안내 탭을 열고 로그인 후 CTA에서 touring 상태와 패널 열기를 요청한다.
3. `수집 → 타임라인 설명 → 세션 탭 직접 클릭 → 세션 설명 → 열린 탭 직접 클릭 → 열린 탭 설명
   → Ask` 순서로 구성한다.
4. 타임라인 10개, 세션 6개, 열린 탭 8개를 채우고 실제 행 형식을 재사용한다.
5. 수집·세션·열린 탭 단계의 실제 대상만 포인터 입력을 허용하며, 안내 카드는 강조 영역과 겹치지
   않게 배치한다.
6. 테스트·타입 검사·빌드·Playwright MCP 시각 검증 후 문서를 갱신한다.

### 검증, 위험과 완료 조건

- `pnpm.cmd test`, `pnpm.cmd compile`, `pnpm.cmd build`, `git diff --check`.
- 461×799 다크 모드 전체 7단계와 320×700·461×767 첫 단계에서 가림·잘림·직접 클릭을 확인한다.
- 패널 열기 실패 시 툴바 아이콘으로 계속할 수 있음을 안내한다.
- mock은 실제 저장·API 호출을 하지 않고, 건너뛰기는 수집을 임의로 켜지 않는다.
- 사용자가 세션·열린 탭을 직접 눌러야 화면이 전환되고 저장 단계로 정상 재개되면 완료다.
