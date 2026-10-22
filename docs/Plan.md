# 결선 부스 현수막 7장 — 중단 작업 인계와 출력 검증 (2026-10-20)

**상태:** 구현·출력 검증 완료. Orbit UI 실측·출력소 사양·QR 부착은 별도 미완료.
**작업 브랜치:** `feat/exhibition-banners`.

## 목표와 조사 결과

- 마지막 승인: 행사 로고 없이 제작, 팀 이름 Orbit, QR은 대표가 붙일 빈 칸.
- 규격: 950×2,380mm 5장 + 455×2,380mm 2장. 좌측 [455][950],
  중앙 [950][950][950], 우측 [950][455]. 타사 사이트 화면 대신 가상 데모.
- 이전 실행은 7장 화면·혼합 크기 PDF 내보내기를 수정한 뒤 사용 한도 오류로 중단됐다.
  미커밋 구현을 보존하고 이어간다. README는 3장 기준이며 최종 내보내기는 미검증이다.
- 벤치마크 `23bd77c`는 완료됐다. 골든셋 100%와 별도 holdout 66.7%/40%,
  공급자 429 오류 22회를 함께 표시해야 한다. 서버 검색 시간과 사용자 화면 E2E는 다르다.

## 범위와 파일

- `extension/preview/exhibition/`: 기존 7장 구현 검토, 실측 `metrics.json` 반영,
  레이아웃·글꼴·PDF 실제 크기 검증, README 갱신.
- `extension/tests/unit/exhibition-metrics.test.ts`: 측정 전 전제를 측정 근거 보존 검사로 갱신.
- `docs/Plan.md`, `docs/WorkLog.md`, `docs/DecisionLog.md`: 인계·승인·검증 기록.
- 제외: 앱 기능 재설계, 제품 브랜치 통합, 유료 재측정, 배포·push·PR.
  같은 조건 Orbit UI 시험은 아직 실행 전이므로 비교표의 Orbit 행은 미측정으로 남긴다.

## 구현 순서와 검증

1. 승인 조건과 7장 순서/크기 계약(`booth.ts`)을 확인한다.
2. 동결된 벤치마크 숫자와 조건을 함께 옮기고 지표 시험을 갱신한다.
3. 7장 화면과 확대 화면을 확인해 넘침·겹침을 수정한다.
4. `cd extension && pnpm test && pnpm compile && pnpm build`.
5. `node preview/exhibition/export.mjs`로 PNG 7장, 개별 PDF 7개, 통합 PDF를 만든다.
   PDF 페이지 수·MediaBox·글꼴·텍스트를 확인하고 전 페이지를 렌더링해 검토한다.
   혼합 폭 브라우저 인쇄의 자동 축소를 피하기 위해 통합본은 로컬 Python/pypdf로
   개별 PDF를 병합한다. 제품 런타임 의존성은 추가하지 않는다.
6. README·작업 로그·회사 인계 문서를 실제 결과에 맞춘다.

## 위험과 완료 조건

- 글꼴은 외부에서 받는다. 누락 경고가 있으면 출력 완료로 보고하지 않는다.
- 인쇄용 블리드/CMYK는 출력소 사양 미확정. QR 빈 칸은 의도된 것이고 실제 QR을 만들지 않는다.
- 수치의 한계와 미실시 E2E를 숨기지 않는다. 새로운 제품·비용 결정은 이번 범위에 없다.
- 7장 출력 크기와 화면 검증, 공식 확장 검증, 관련 기록 완료를 작업 완료 조건으로 한다.

---

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

## 2026-08-12 — 온보딩 완료 후 홈 복귀, 최근 검색 기록 드롭다운 정렬

**브랜치:** `main`

### 작업 목표

1. 온보딩 투어가 끝난 뒤 안내 탭이 멈춰 있지 않고 새 탭 홈으로 돌아가게 한다.
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

- `replaceWithHome()` — `onboarding=1` 쿼리를 지우고 히스토리를 덮어쓴다
- `OnboardingLaunch`가 온보딩 상태를 구독해 `complete`가 되면 홈으로 돌아간다
- `main.tsx`가 안내 탭 여부를 상태로 들고 popstate 에서 갱신한다(홈은 라우트가 안 바뀌어
  리렌더가 일어나지 않는다)
- 드롭다운 기준을 검색창만 감싼 `form`으로 바꾸고, 열린 동안 입력창과 한 판으로 잇는다

### 제외 범위

- 온보딩 단계·문구·mock 데이터 변경
- 안내 탭이 이미 닫힌 경우 새 탭을 다시 열어 주기
- 신규 사용자의 빈 홈 화면(최근 탐색·추천 없음) 자체를 손보기

### 변경할 파일

- `entrypoints/newtab/lib/navigation.ts` — `replaceWithHome()`, `isOnboardingLaunch()`
- `entrypoints/newtab/main.tsx` — 안내 탭 여부를 상태로 관리
- `entrypoints/newtab/components/sections/OnboardingLaunch.tsx` — 완료 감지와 이동
- `entrypoints/newtab/styles/index.css` — `.search-container > form`, `.search-shell--with-history`
- `entrypoints/newtab/components/sections/OrbitHero.tsx` — 열림 상태 클래스

### 테스트 및 검증

- `pnpm test`, `pnpm compile`, `pnpm build`
- 실제 브라우저: 설치 → 로그인 → 사이드패널 투어 완료 → 안내 탭이 홈으로 바뀌는지
- 뒤로가기로 안내 화면에 돌아가지 않는지(replaceState)

### 위험과 완료 조건

- 온보딩을 이미 끝낸 사용자가 `?onboarding=1`을 직접 열면 즉시 홈으로 넘어간다(의도된 동작).
- 안내 탭이 닫혀 있으면 이동 대상이 없어 아무 일도 일어나지 않는다. 알려진 한계로 남긴다.
- 투어 완료 직후 안내 탭이 홈으로 바뀌고 드롭다운이 검색창에 붙어 열리면 완료다.

# 2026-10-17 — 팀 Orbit: 팀 워크스페이스 (세션 공유형 MVP)

**상태:** 구현 완료 (2026-10-17) — 실제 브라우저(Chrome 프로필 2개) UI 스모크 미실시, 커밋 전
**브랜치:** `feat/team-workspace`

## 작업 목표

- 개인 전용 Orbit에 팀 워크스페이스를 추가한다. 팀원이 하나의 Orbit 공간에서 서로의 탐색
  세션을 보고, 검색하고, Ask AI로 되짚을 수 있게 한다.
- 단계형으로 진행한다. 이 계획의 구현 범위는 **0단계(다중 사용자 결함 수정)와 1단계(세션
  공유형 MVP)**다. 개인 기록은 개인 것으로 두고, 사용자가 고른 세션만 팀에 **라이브 참조**로
  공유한다. 팀 수집 모드(팀 단위 수집·Auto Session)는 2단계로 미룬다.

## 현재 상태와 조사 결과

- **데이터 격리** — 모든 조회·수정·삭제가 `user_id` 소유자 조건으로 제한된다
  (DecisionLog 2026-08-07 "데이터 격리"). 세션 단건은 `_owned_session()`
  (`backend/app/api/sessions.py`)이 남의 세션에 404를 준다. 팀 공유는 이 결정을 "읽기"에
  한해 넓히는 변경이다.
- **문서 전제 정정 필요** — `product-direction-v2.md` §7과 `implementation-roadmap.md`
  Stage 4는 "`user_id`가 전 테이블에 있어 데이터 모델 변경 불필요"라고 적었다. 세션 공유에도
  워크스페이스·멤버십·공유 관계를 담을 테이블이 필요하다. 다만 1단계는 **신규 테이블만**
  추가하고 기존 테이블 컬럼은 바꾸지 않는다.
- **다중 사용자 결함 1 — 벡터 검색에 소유자 범위가 없다.** Qdrant payload는
  `session_id·title·overview·purpose`뿐이다(`services/embedding_sync.py:23`). `/search`
  (`api/search.py:58`)와 배치 후보 검색(`sync_pipeline._fetch_candidates`)이 전체 top-k를
  먼저 뽑고 SQL에서 내 세션만 거른다. 유출은 없지만 사용자가 늘면 남의 세션이 top-k를 채워
  검색 결과와 append 후보가 빈다. 팀 검색은 이 위에 범위를 하나 더 얹으므로 먼저 고친다.
- **다중 사용자 결함 2 — 설정이 전역이다.** `app_settings`는 `key`가 PK인 전역 key-value다
  (`db/models.py:175`). 자동병합 토글(`services/app_settings.py:33`)이 모든 사용자에게 공통
  적용된다.
- **처리량** — 배치 락이 서버 전체에 하나, 배치당 사용자 한 명(`sync_pipeline.py:149`),
  A.X-K1 3 RPS 전역 throttle. 1단계는 수집 경로를 바꾸지 않으므로 영향이 없다. 2단계에서 측정한다.
- **서버** — 확장 `host_permissions`가 localhost만 허용하고(`extension/wxt.config.ts:80`),
  `VITE_API_BASE_URL` 기본값도 localhost다. DecisionLog 열린 결정 "팀 다중 환경 백엔드 접속"이
  미해결이다.
- **인증 경계 테스트** — `test_auth_boundary.py`가 보호 경로 전체에 토큰 없음·위조 토큰을
  실제 요청으로 검증한다. 새 라우터도 자동으로 포함된다.
- **초대 경로 제약** — 확장 페이지(`chrome-extension://`)는 웹 링크로 바로 열리지 않는다.
- **DB 변경 방식** — 신규 테이블은 `create_all`, 기존 테이블 컬럼 추가만
  `db/migrations.py`의 멱등 ALTER가 담당한다. FK에 ON DELETE가 없어 삭제 시 자식 행을 앱이
  먼저 지운다(`api/sessions.py` `delete_session`).
- **데이터 접근이 없는 경로** — `/assistant/route`(`services/assistant_router.py`)는 세션
  데이터를 조회하지 않는다. 팀 범위 변경 대상이 아니다.

## 사용자 결정 사항 (확인 완료, 2026-10-17)

- **공유 모델:** A(세션 공유) 후 B(팀 수집 모드) 단계형.
- **공유 방식:** 라이브 참조. 공유한 뒤 Auto Session이 그 세션에 붙이는 페이지도 팀에 보이며,
  '공유 중' 배지로 알린다.
- **역할:** owner / member 2단계.
- **서버:** 개발은 로컬 서버 하나에 Chrome 프로필·Google 계정 여러 개로 검증한다. 호스팅과
  비용 결정은 MVP 이후로 미룬다.

## 이 계획에서 정한 세부 (구현 전 이의 가능)

- **초대는 코드 붙여넣기.** 확장 페이지를 웹 링크로 열 수 없어서다. 코드는 96비트 난수
  (`secrets.token_urlsafe(12)`, 16자)이며 서버는 SHA-256 해시와 만료 시각(7일)만
  `workspaces`에 둔다. 초대 테이블은 없다. owner가 재발급하면 해시가 바뀌어 이전 코드가 무효가 된다.
  (구현 중 변경: 처음엔 `JWT_SECRET` 서명 토큰이었으나, 세션 토큰과 같은 키·발급자를 쓰면 토큰
  혼동 위험이 생기고 코드가 150자 넘게 길어져 바꿨다.)
- **본문 발췌 제외 토글은 두지 않는다.** 요약이 본문 발췌로 만들어지므로 발췌만 빼도 내용이
  요약으로 드러난다. 거짓 안심을 주는 토글 대신 공유 다이얼로그에 "제목·요약·페이지 목록이
  보이고, 본문 발췌가 팀 Ask 근거로 쓰인다"를 명시한다. 실제 통제 수단인 페이지 숨기기는 2단계.
- **검색·Ask 범위는 활성 워크스페이스를 따른다.** 개인 모드는 개인 검색, 팀 모드는 그 팀의
  공유 세션만. "개인+팀 전체" 범위는 2단계.
- **팀에서는 읽기 전용.** 팀원은 공유 세션을 보고 검색·Ask만 한다. 제목·별칭·폴더·삭제·병합은
  소유자만 가능하다(기존 `_owned_session` 유지). 공유 해제는 공유한 사람 또는 owner.
- **병합과 공유:**
  - 팀 목록에는 병합으로 흡수된(`status='merged'`) 세션만 빠진다(개인 목록·폴더와 같은 규칙).
    공유한 세션이 다른 세션에 흡수되면 팀에서 사라지고, 되돌리면 다시 보인다. 흡수한 생존 세션은 자동으로 공유하지 않는다(동의 없이
    공유 범위가 넓어지지 않게).
  - 공유 중인 세션이 다른 세션을 흡수하면 흡수된 페이지도 팀에 보인다(라이브 참조의 append와
    같은 규칙). 수동 병합 확인 UI에 "팀에 공유 중" 안내를 붙인다.
  - **자동병합은 공유 중인 세션을 건드리지 않는다.** 사용자가 모르는 사이 공유 범위가 넓어지는
    것을 막는다.
- **탈퇴·내보내기:** 그 사람이 그 팀에 건 공유가 모두 해제되고 개인 세션은 그대로 남는다.
  owner는 탈퇴할 수 없고(소유권 이전은 2단계) 팀 삭제만 가능하다.
- **팀 삭제:** 멤버십·공유 관계만 지운다. 개인 세션은 그대로.
- **개인 세션 삭제:** 그 세션의 공유 관계도 같은 트랜잭션에서 지운다.
- **응답 코드:** 비멤버의 팀 접근, 접근 권한 없는 세션은 404(존재 여부를 숨긴다, 기존 규칙).
  멤버가 owner 전용 작업을 하면 403.

## 포함 범위

### 0단계 — 다중 사용자 결함 수정

- Qdrant payload에 `user_id`를 추가하고 쿼리 시 payload 필터를 건다. `user_id` payload
  index를 만든다. 기존 포인트는 기동 시 세션 테이블 기준으로 `set_payload` 멱등 backfill한다.
  **SQL 소유자 필터는 보안 경계로 그대로 둔다**(이중 방어).
- 사용자별 설정: 신규 `user_settings(user_id, key, value)`. 사용자 값이 없으면 env 기본값을 쓰고,
  **전역 `app_settings` 값은 읽지 않는다**(구현 중 변경, 2026-10-17). 그 값은 단일 사용자 시절
  누군가의 opt-in이라 다른 사용자에게 물려주면 자동병합이 동의 없이 켜진다. 기존에 자동병합을
  켜 둔 사용자는 한 번 다시 켜야 한다. 배치는 그 배치 주인의 값을 읽는다.

### 1단계 — 세션 공유형 팀 MVP

백엔드:

- 신규 테이블 `workspaces`, `workspace_members`, `workspace_sessions`.
- 워크스페이스·멤버·초대·공유 API(아래 계약).
- 공유 세션 읽기 권한: `GET /sessions/{id}`, `/events`, `/versions`를 "소유자 또는 그 세션이
  공유된 팀의 멤버"로 넓힌다. 판정은 한 함수(`_readable_session`)에 모으고, 쓰기 경로는
  `_owned_session` 그대로 둔다.
- 팀 검색·Ask: `workspace_id`가 오면 멤버십을 확인하고 그 팀 공유 세션만 대상으로 한다.
  Qdrant는 공유 세션 id 목록(`HasIdCondition`)으로 거르고, 방문 기록 검색과 Ask 본문 근거는
  **공유 세션에 속한 이벤트(`session_events` 조인)만** 쓴다. 팀원의 공유되지 않은 방문은
  섞이지 않는다.
- 자동병합 가드(공유 중인 세션 제외).

확장:

- 활성 워크스페이스 `activeWorkspaceId`(null = 개인)를 `lib/settings.ts`(chrome.storage)에 둬
  사이드패널과 새 탭이 공유한다.
- 사이드패널: `TopNavBar` 워크스페이스 스위처. 팀 모드에서는 세션 탭이 팀 공유 세션 목록
  (공유자 아바타, 읽기 전용 메뉴)이 되고 기본 화면이 된다. 타임라인 탭은 개인 이벤트 스트림이라
  팀 모드에서 숨긴다. 열린 탭 탭은 로컬 기능이라 그대로 둔다.
- 세션 행·상세: "팀에 공유" / "공유 해제" 메뉴, 공유 다이얼로그(팀 선택, 포함 내용과 라이브
  참조 안내), '공유 중' 배지.
- 설정 화면 팀 섹션: 팀 만들기, 초대 코드 발급·복사·재발급, 코드로 참여, 멤버 목록·내보내기,
  탈퇴, 팀 이름 변경·삭제.
- Ask AI: 팀 모드에서 `workspace_id`를 전달한다. 탭 이동 의도는 그대로 로컬에서 처리한다.
- 새 탭 아틀라스: 팀 모드에서 팀 공유 세션을 그리고, 세션 노드·상세에 공유자 아바타,
  네비게이터에 멤버 필터(클라이언트 필터). 폴더는 개인 전용이라 팀 모드에서 숨긴다.

## 제외 범위

- 2단계: 팀 수집 모드(팀 활성 중 방문을 팀으로, 툴바 배지, 유휴 자동 해제, 팀 도메인 규칙),
  팀 단위 Auto Session(후보를 팀 세션으로, 다중 기여자 요약, 페이지별 방문자), 공유 세션 페이지
  숨기기, 팀 단위 수집 정책, 중복 조사 알림(recommender 재사용), 팀 폴더, 팀 타임라인,
  개인+팀 전체 검색, 소유권 이전, 이메일 지정 초대. 착수 전 처리량 측정과 "팀 수집 이벤트의
  탈퇴 시 처리" 결정이 필요하다.
- 3단계: 코멘트·핀, 활동 피드·알림·실시간 갱신, 팀 인사이트, 역할 세분화, 팀별 LLM 사용량
  상한, 감사 로그.
- 비목표: 결제·요금제, SSO/SCIM, 공개 링크 공유, 팀 간 공유, 실시간 공동 브라우징.
- 팀에 적용하지 않는 기존 기능: 추천, 분석, 병합 제안, 폴더, 이벤트·동기화, 탭 액션은 개인 전용으로 둔다.
- 공용 서버 배포(`host_permissions`·`VITE_API_BASE_URL` 변경 포함).

## API 계약 (1단계)

워크스페이스·멤버:

| 메서드 | 경로 | 권한 | 요청 → 응답 |
|---|---|---|---|
| GET | `/workspaces` | 로그인 | → `WorkspaceItem[]` `{id, name, hue, role, member_count, created_at}` |
| POST | `/workspaces` | 로그인 | `{name(1~60)}` → 201 `WorkspaceItem` (생성자 owner, hue는 폴더와 같은 팔레트 순환) |
| PATCH | `/workspaces/{id}` | owner | `{name}` → `WorkspaceItem` |
| DELETE | `/workspaces/{id}` | owner | → 204 |
| GET | `/workspaces/{id}/members` | member | → `WorkspaceMember[]` `{user_id, name, email, picture, role, joined_at}` |
| DELETE | `/workspaces/{id}/members/{user_id}` | owner(남) / 본인(탈퇴) | → 204. owner 본인은 409 |
| POST | `/workspaces/{id}/invite-code` | owner | 본문 없음 → `{code, expires_at}`. 매번 새 코드, 이전 코드 무효 |
| POST | `/workspaces/join` | 로그인 | `{code}` → `WorkspaceItem`. 이미 멤버면 그대로 200, 무효·만료·재발급된 코드는 400 |

공유:

| 메서드 | 경로 | 권한 | 요청 → 응답 |
|---|---|---|---|
| GET | `/workspaces/{id}/sessions` | member | → `WorkspaceSessionItem[]` = `SessionDetail` + `shared_by{user_id, name, picture}` + `shared_at`. active만, 최근 활동순 |
| POST | `/workspaces/{id}/sessions` | member | `{session_ids}` → `{workspace_id, shared, skipped}`. 폴더 배정과 같은 부분 성공 — 내 소유의 흡수되지 않은 세션만 공유, 이미 공유된 것도 `shared`(멱등) |
| DELETE | `/workspaces/{id}/sessions/{session_id}` | 공유한 사람 / owner | → 204 |

기존 경로 변경:

- `SessionDetail`에 `shared_workspace_ids: string[]` 추가(기본 `[]`, 내 세션 목록의 배지용).
- `GET /sessions/{id}`, `/sessions/{id}/events`, `/sessions/{id}/versions`: 읽기 권한 확장.
- `GET /search`: `workspace_id` 쿼리 파라미터 추가. `POST /ask/stream`: `AskStreamRequest`에
  `workspace_id` 추가. 비멤버는 404.

## 데이터 모델 (신규 테이블, `create_all`)

```sql
CREATE TABLE workspaces (
  id             VARCHAR(36) PRIMARY KEY,
  name           VARCHAR(60) NOT NULL,
  hue            VARCHAR(20) NOT NULL,
  invite_code_hash  VARCHAR(64),   -- 초대 코드 SHA-256. 재발급하면 바뀐다
  invite_expires_at TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL,
  updated_at     TIMESTAMPTZ NOT NULL
);

CREATE TABLE workspace_members (
  workspace_id VARCHAR(36) NOT NULL REFERENCES workspaces(id),
  user_id      VARCHAR(64) NOT NULL,
  role         VARCHAR(20) NOT NULL,  -- 'owner' | 'member'
  joined_at    TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (workspace_id, user_id)
);
CREATE INDEX ix_workspace_members_user ON workspace_members (user_id);

CREATE TABLE workspace_sessions (
  workspace_id VARCHAR(36) NOT NULL REFERENCES workspaces(id),
  session_id   VARCHAR(36) NOT NULL REFERENCES sessions(id),
  shared_by    VARCHAR(64) NOT NULL,
  shared_at    TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (workspace_id, session_id)
);
CREATE INDEX ix_workspace_sessions_session ON workspace_sessions (session_id);

CREATE TABLE user_settings (
  user_id    VARCHAR(64) NOT NULL,
  key        VARCHAR(64) NOT NULL,
  value      JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (user_id, key)
);
```

- owner는 `workspace_members.role`로만 표현한다(`workspaces`에 owner 컬럼을 중복으로 두지 않는다).
- FK는 `session_events`와 같이 ON DELETE 없이 건다. 정리를 빠뜨리면 조용한 고아 행 대신
  삭제 오류로 드러나게 하기 위해서다.
- Qdrant payload에 `user_id`를 추가하고 keyword index를 만든다.

## 변경할 파일

백엔드:

- `app/db/models.py` — `Workspace`, `WorkspaceMember`, `WorkspaceSession`, `UserSetting`
- `app/db/vector.py` — 검색 함수에 소유자·ID 필터 인자, payload index, backfill
- `app/services/embedding_sync.py` — payload에 `user_id`
- `app/main.py` — 라우터 등록, 기동 시 backfill
- `app/services/app_settings.py`, `app/api/settings.py` — 사용자별 설정
- `app/services/workspaces.py`(신규) — 멤버십 확인, 초대 코드 서명·검증, 공유 정리
- `app/api/workspaces.py`(신규), `app/schemas/workspace.py`(신규)
- `app/api/sessions.py`, `app/schemas/session.py` — 읽기 권한 확장, 삭제 시 공유 정리, `shared_workspace_ids`
- `app/api/search.py`, `app/api/ask.py`, `app/schemas/ask.py`, `app/services/ask_service.py` — 팀 범위
- `app/services/sync_pipeline.py` — 후보 검색 소유자 필터, 자동병합 사용자별 설정
- `app/services/merge_service.py` 또는 `merge_suggester.py` — 자동병합 가드
- `tests/` — `test_workspaces.py`(신규), 검색·Ask 팀 범위, 사용자별 설정, 벡터 필터 테스트

확장:

- `lib/types.ts`, `lib/api.ts`, `lib/settings.ts`(`activeWorkspaceId`)
- `entrypoints/sidepanel/components/TopNavBar.tsx`, `SessionRow.tsx`,
  `MergeSuggestionsSection.tsx`, 신규 공유 다이얼로그·팀 관리 컴포넌트
- `entrypoints/sidepanel/views/SessionListView.tsx`, `SessionDetailView.tsx`, `SettingsView.tsx`
- `entrypoints/shared/hooks/useAskConversation.ts` — `workspace_id` 전달
- `entrypoints/newtab/pages/OrbitAtlasPage.tsx`와 `components/atlas/` — 팀 모드 데이터 소스,
  공유자 아바타, 멤버 필터
- `tests/unit/` — api, 활성 워크스페이스 저장·구독, 팀 모드 분기

문서: `api-design-v2.md`, `data-model-v2.md`, `IA.md`, `UserScenarios.md`, `Personas.md`,
`product-direction-v2.md` §7, `implementation-roadmap.md` Stage 4, `target-architecture.md`,
`README.md`(기능, 데이터 처리와 프라이버시), `DecisionLog.md`, `WorkLog.md`.

## 구현 순서

1. 0단계-a: Qdrant 소유자 필터 + backfill + 테스트 (`fix(search): ...`)
2. 0단계-b: 사용자별 설정 + 테스트 (`fix(settings): ...`)
3. 계약 확정: 모델·스키마, `api-design-v2.md`·`data-model-v2.md` 갱신
4. 백엔드 워크스페이스·멤버·초대 + 테스트
5. 백엔드 공유·읽기 권한·팀 세션 목록 + 테스트
6. 백엔드 팀 검색·Ask 범위, 자동병합 가드 + 테스트
7. 확장 타입·API·활성 워크스페이스 상태
8. 확장 설정 팀 섹션(생성·초대·참여·멤버)
9. 확장 공유 다이얼로그·배지·사이드패널 팀 모드
10. 확장 아틀라스 팀 모드, Ask 범위
11. 문서 갱신, 다중 계정 스모크

## 테스트 및 검증

백엔드(DB·Qdrant·LLM 대역):

- 비멤버의 팀 조회·공유·검색·Ask는 404, 멤버의 owner 전용 작업은 403.
- 남의 세션 공유 시도는 404.
- **공유되지 않은 세션·이벤트가 팀 검색 결과와 Ask 근거에 섞이지 않는다**(핵심 격리 테스트).
- 라이브 참조: 공유 후 append된 이벤트가 팀원의 세션 상세에 보인다.
- 탈퇴·내보내기 시 그 사람의 공유가 해제되고 개인 세션은 남는다. owner 탈퇴는 409.
  팀 삭제 시 멤버십·공유 관계가 정리된다.
- 초대 코드: 만료·재발급 이후의 이전 코드·위조 코드는 거부, 이미 멤버면 멱등.
- 병합: 흡수된 공유 세션은 팀 목록에서 빠지고 unmerge 시 돌아온다. 자동병합은 공유 세션을 건너뛴다.
- 개인 세션 삭제 시 공유 관계가 정리된다.
- Qdrant 필터: 다른 사용자 세션이 top-k를 채워도 내 결과가 나온다. backfill은 멱등.
- 사용자별 설정 격리. 다른 사용자 값과 전역 `app_settings` 값을 읽지 않는다.
- 새 경로의 토큰 없음·위조 토큰은 `test_auth_boundary.py`가 자동 검증.

확장: vitest(api 함수, 활성 워크스페이스 저장·구독, 팀 모드 분기), 타입 검사, 빌드.

공식 명령:

```bash
cd backend && python -m pytest -p no:asyncio
cd extension && pnpm test && pnpm compile && pnpm build
```

스모크: 로컬 서버 1개 + Chrome 프로필 2개(Google 계정 2개). A가 팀 생성·초대 코드 발급 →
B 참여 → A 세션 공유 → B가 팀 목록·상세·아틀라스·Ask에서 확인 → A 공유 해제 후 B에서 사라짐
확인 → B 탈퇴.

## 위험

- 라이브 참조라 공유 후 같은 세션에 append된 개인 탐색이 팀에 보인다(사용자 결정으로 수용).
  '공유 중' 배지와 공유 다이얼로그 문구로 알리고, 페이지 숨기기는 2단계에서 제공한다.
- 팀 Ask가 공유 세션의 본문 발췌를 근거로 쓰므로, 로그인이 필요한 페이지 내용이 팀원에게
  드러날 수 있다. 민감 도메인은 이미 본문을 수집하지 않는다. 공유 다이얼로그에 명시한다.
- 읽기 권한 확장은 "모든 조회를 소유자로 제한" 결정의 개정이다. 판정을 `_readable_session`
  하나로 모으고 쓰기 경로에는 쓰지 않으며, 격리 테스트로 고정한다.
- 팀 검색의 `HasIdCondition`은 공유 세션 id 목록을 매 쿼리에 보낸다. 팀 공유 세션이 수천 개를
  넘으면 payload `workspace_ids` 배열로 전환한다(코드에 `ponytail:` 주석으로 남긴다).
- 공용 서버가 없어서 실제 팀 사용은 호스팅 결정 전까지 불가능하다. 1단계 완료 기준은 로컬
  다중 계정 검증이다.
- 초대 코드가 유출되면 7일 안에는 누구나 참여할 수 있다. owner 재발급으로 무효화한다.

## 완료 조건

- 0단계 결함 2건이 수정되고 테스트로 고정됐다.
- 위 API·테이블이 구현되고 비멤버·비공유 데이터 격리 테스트가 통과한다.
- 확장에서 팀 생성·참여·공유·공유 해제·탈퇴, 팀 세션 보기(사이드패널·아틀라스), 팀 Ask가 동작한다.
- 공식 검증 명령이 통과하고 다중 계정 스모크 결과가 `WorkLog.md`에 기록됐다.
- 관련 문서가 코드와 일치한다.

## 구현 결과 (2026-10-17)

계획 대비 바뀐 점:

- 초대 코드: JWT 대신 난수 코드 + 해시(위 "이 계획에서 정한 세부").
- 사용자별 설정: 전역 `app_settings` 폴백 없음(위 0단계).
- 공유 결과: 404 대신 폴더 배정과 같은 부분 성공(`skipped`).
- 팀 목록·공유 대상: `active`만이 아니라 `merged`만 제외(개인 목록과 같은 규칙).
- 확장에서 공유 다이얼로그는 팀마다 즉시 반영(저장 단계 없음). 범위 선택은 네이티브 select.
- 새 탭 홈의 Ask는 범위와 무관하게 개인 기록을 쓴다. 범위는 사이드패널과 아틀라스만 따른다.
- 팀 Ask 근거 카드(SessionCard)도 읽기 전용으로 바꿨다(재시도·삭제 숨김). 계획에 없던 누락 보완이다.
- 독립 리뷰 반영: 내보내기 시 초대 코드 무효화, 공유는 공유한 사람이 멤버일 때만 유효(읽기 시
  조인), 흡수된 공유 세션은 팀원이 id로도 못 읽음, 팀원 응답에서 `folder_id` 제거, 이름 길이를
  공백 제거 뒤 검사, 다른 화면의 낡은 팀 목록이 방금 고른 팀을 지우던 문제(저장값을 지우지 않고
  목록을 다시 받음), 로그아웃 시 쿼리 캐시 비우기, 팀 화면의 요약 재시도 버튼 숨김.
- 팀원 이메일은 owner와 본인에게만 보인다(사용자 위임으로 추천안 채택).

실제로 바꾼 파일(계획의 "변경할 파일" 외 추가분):

- 백엔드: `app/services/merge_suggester.py`, `app/services/recommender/service.py`(벡터 검색 소유자
  필터 전달), `app/main.py` 기동 시 backfill 호출.
- 확장: `lib/useWorkspaces.ts`(활성 범위 공용 훅), `lib/session-groups.ts`(제네릭화), `lib/merge.ts`
  (공유 세션 병합 안내), `entrypoints/sidepanel/App.tsx`, `components/AskDock.tsx`, `views/AskView.tsx`,
  `components/SessionCard.tsx`, `components/team/*`(신규 4개), `hooks/useWorkspaces.ts`(신규),
  `entrypoints/newtab/components/VariantAtlasReplica.tsx`, `components/atlas/AtlasHeader.tsx`·
  `AtlasNavigator.tsx`·`AtlasDetail.tsx`·`data.ts`, `hooks/useAtlasData.ts`, `styles/atlas.css`.

검증 결과:

- `cd backend && python -m pytest -p no:asyncio` → 558 passed (기존 488 + 신규·인증 경계 자동 확장).
- `cd extension && pnpm test && pnpm compile && pnpm build` → 217 passed, tsc 통과, 빌드 성공.
- 실제 DB 스모크: 별도 `orbit_smoke` DB + 8011 포트 서버(LLM·임베딩 키 비움)에 사용자 3명을 넣고
  팀 생성·초대·참여·공유·읽기 격리·병합 상호작용·탈퇴·내보내기 후 재가입 차단·비멤버 공유 행
  무시·폴더 비노출·삭제·설정 격리 63개 확인 통과. 끝난 뒤 스모크 DB는 지웠다.
- Qdrant 스모크: 임시 컬렉션에서 소유자 index·backfill·소유자 필터·팀 id 필터 확인 통과(개발
  컬렉션은 건드리지 않음).
- 미실시: Chrome 프로필 2개로 확장 UI 스모크(구글 로그인이 필요해 사용자가 해야 한다).

## 2026-10-20 비교표 Orbit 실측 통합

- 목표: 대표가 요청한 미측정 칸 시험 결과를 `test/orbit-ui-trial`의 보존된 원본에서 반영한다.
- 현재: 경쟁 제품의 26 URL/8문항과 고정 체류 조건으로 격리 Chrome 확장 UI 시험 중. 제품 기준 5aef732, 실제 수집/세션화 사용.
- 범위: competitor_matrix.csv, 출처 설명, 관련 테스트, README/WorkLog/DecisionLog와 5번 패널·합본·배포 ZIP. 합성 검색 성능 숫자는 별개로 유지한다.
- 순서: 원본 결과 검토 → 판정/제약 문구 갱신 → 관련 및 전체 검증 → 해당 패널 재출력 → 7장 합본/ZIP 갱신 → PDF 시각 QA.
- 검증: 8행 CSV와 표시값 일치, 직접 시험/문서 기준 구분, 크기와 페이지 수, 변경 패널 렌더 확인.
- 위험: 사이트 403과 headless 창 방식의 차이를 표기한다. 제품 간 속도 비교나 사용자 일반화는 하지 않는다. 성공한 결과만 골라 내지 않는다.
- 완료: Orbit 4칸에 원본 근거가 있고 인쇄물도 최신값과 일치한다.

### Orbit 비교표 통합 완료

- 실제 UI 시험 원본을 반영했다: 후보3/6(1건 답변 모순), 거절2/2, 목록 일부·혼입, 복원4/9+추가5.
- headless 방식/제주항공403/조건 차이를 표 아래에 공개했다. CSV8행과 표시값 및 주의 문구를 테스트로 확인한다.
- extension224테스트·compile·build 통과. 5번 PNG/PDF 재출력 후 7장 합본을 다시 병합했고 페이지 크기/내용·표시값·시각 배치를 검증했다. 전체 미리보기 및17파일 ZIP 갱신.

## 2026-10-20 전시용 강점 강조와 분수 표기 제거

- 목표: 대표의 후속 요청대로 배너는 강점을 중심으로 편집하고 `(2/2)` 같은 성공 건수/전체 건수 표기를 없앤다.
- 조사: 실제 UI 시험의 기록 없음 두 질문에서 Orbit 100%, 로그인 Comet 50%다. 차이는 50%p이며 전체 검색 정확도나 일반 사용자 성능을 뜻하지 않는다. 합성 골든셋과 실제 UI 결과를 합칠 수 없다.
- 범위: 5번 패널의 전체 제품 비교표를 해당 항목의 큰 비율·동일 축 막대로 교체한다. 서버 성능은 A/B/D를 선별하고, 골든/holdout 품질을 모두 담은 C와 전체 제품 비교 원본은 자료에 보존한다. 제품 코드, 측정 결과, 질문, 평가 기준은 바꾸지 않는다.
- 변경 파일: `panel-tech.tsx`, `exhibition.css`, `trial-highlights.ts`, 원본 사본 `competitor_trials.csv`, 기존 지표 테스트, 현수막 README와 계획/결정/작업 문서. 출력은 5번 PNG/PDF, 7장 합본, 부스 미리보기, ZIP.
- 순서: CSV에서 비교 지표를 계산하는 타입/함수 → 비율 중심 레이아웃 → 전체 원본 보존/표기 검증 → 공식 확장 검증 → PDF 출력·시각 QA·합본/ZIP 갱신.
- 검증: 같은 부정 질문과 로그인 조건만 집계, 누락·중복·미판정 입력 거부, 100/50/50%p 대조, 배너에 분수 표기 없음, 원본 실패 결과 보존. `pnpm test && pnpm compile && pnpm build`, PDF 크기/텍스트/겹침과 합본 동일성 확인.
- 위험과 결정: 전면 분수는 제거하되 아래에 '기록이 없는 두 질문·각 1회'와 실행 방식 차이를 적어 이번 소규모 시험으로 범위를 한정한다. 새 실험/API 비용은 없다. 속도 배수나 전체 경쟁 제품 우위는 주장하지 않는다.
- 완료 조건: 요청한 강조와 표기 변경이 실제 인쇄물에 반영되고, 모든 수치가 보존한 원본에서 재현되며, 관련 문서와 출력 패키지가 일치한다.

### 비율 강조 완료

- 전면에 100%, Comet 50%, +50%p를 표시하고 분수 표기를 제거했다. 소규모 고정 두 질문·단회 및 환경 차이는 각주로 범위를 한정했다.
- 227테스트·타입 검사·빌드 통과. 5번 PNG/PDF 재출력과 시각 QA, 합본 7장 규격·텍스트·렌더 동일성, 17파일 ZIP 최신 내용 검증 완료.
- 실험 결과를 재측정하거나 수정하지 않았고, 전체 원본 및 기존 제품 실패 기록을 보존했다.
