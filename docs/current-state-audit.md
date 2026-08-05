# Orbit 현재 상태 감사 (Personal Exploration Memory 전환 전)

> 조사 기준: `feat/auto-session` 브랜치, 2026-08-03. 코드를 직접 읽고 확인한 사실만 기재한다. 확인하지 못한 부분은 "확인 필요"로 표기한다.
> 목적: `orbit-serialized-sonnet.md` 계획서의 전제("현재 상태" 절)를 코드 레벨에서 검증하고, 이후 문서(`target-architecture.md` 등)의 재사용/변경 판단 근거를 제공한다.

## 1. 디렉터리 구조

```
backend/
  app/
    ai/            clusterer.py, embedding.py, json_utils.py, llm.py, reranker.py
    api/           search.py, sessions.py
    db/            models.py, session.py, vector.py
    schemas/       session.py
    services/      summarizer.py
    config.py, main.py
  tests/           test_clusterer.py, test_json_utils.py, test_reranker.py,
                   test_search.py, test_sessions.py, test_summarizer.py, test_vector.py
  pyproject.toml, .env, .env.example, README.md

extension/
  entrypoints/
    background.ts, content.ts
    sidepanel/
      App.tsx, main.tsx
      components/  CurrentSessionCard, Favicon, Logo, OverflowMenu, SearchInput,
                   SessionCard, StatePlaceholder, SummaryPanel, TabListItem, Toast, TopNavBar
      hooks/       useSearch.ts, useSessions.ts, useTabs.ts
      store/       settings.ts, ui.ts
      views/       SearchView, SessionDetailView, SessionListView, SettingsView
  lib/             api.ts, chrome-bridge.ts, messages.ts, query-client.ts,
                   sensitive-domains.ts, storage.ts, types.ts, mock/mockSessions.ts, mock/mockTabs.ts
  wxt.config.ts, package.json

frontend/
  src/
    components/    SessionCard, SessionDetailPanel, Sidebar, Toast
    hooks/         useSessions.ts
    lib/           api.ts, types.ts
    store/         ui.ts
    views/         HomeView, SearchView, SessionListView
    App.tsx, main.tsx

docker-compose.yml   (Postgres 16 + Qdrant, 로컬 인프라)
```

## 2. Extension 이벤트 흐름 (현재 = 수동 저장 파이프라인)

현재 Extension에는 방문 감지·자동 수집 경로가 전혀 없다. 유일한 데이터 흐름은 사용자가 사이드패널에서 명시적으로 "저장"을 눌렀을 때 시작된다.

1. `extension/entrypoints/background.ts`가 `chrome.tabs.onCreated/onRemoved/onUpdated`를 구독해 50ms 디바운스 후 `TABS_CHANGED` 메시지를 사이드패널에 브로드캐스트한다(`background.ts:11-27`).
2. `extension/entrypoints/sidepanel/hooks/useTabs.ts`가 `TABS_CHANGED`를 받아 `['current-tabs']` 쿼리를 무효화하고, `chrome-bridge.ts:getCurrentWindowTabs()`로 현재 창의 탭 목록을 다시 조회한다(2초 폴링 안전망 포함, `useTabs.ts:30-35`).
3. `CurrentSessionCard.tsx`가 탭 개수와 "세션 저장" 버튼을 보여준다. 버튼 클릭 시 `useSaveSessionsClustered()` → `lib/api.ts:saveSessionsClustered()`를 호출한다.
4. `saveSessionsClustered()`는 각 탭에 대해 `enrichTabs()`를 실행한다(`lib/api.ts:97-127`): 민감 도메인(`isSensitiveUrl`, `lib/sensitive-domains.ts`)이면 본문을 비우고, 아니면 `chrome-bridge.ts:getTabPageContent()`로 `background.ts`의 `pageContentCache`(탭ID→본문 Map)를 조회한다.
5. 페이지 본문은 `content.ts`(Readability 기반 `extract()`)가 `document_idle` 시점 또는 `load` 이벤트에서 추출해 `PAGE_CONTENT_READY` 메시지로 `background.ts`에 캐시해 둔 것이다(`content.ts:27-37`, `background.ts:36-39`). 캐시 미스 시 `background.ts`가 `EXTRACT_CONTENT`로 content script에 온디맨드 요청한다(`background.ts:43-56`).
6. 완성된 탭 목록은 `POST /sessions/cluster`로 전송된다.
7. 응답으로 받은 세션 ID들은 `useUIStore.pendingSessionIds`에 추가되고, `usePendingSessionPoller()`가 3초 간격으로 `GET /sessions/{id}`를 폴링해 `summary_status`가 `pending`을 벗어나면 캐시를 무효화한다(`useSessions.ts:42-67`).

이 경로에는 영속 저장소가 없다 — 큐, IndexedDB, 재시도 로직이 전혀 없으며 사이드패널이 닫히면 진행 상태(폴링)도 함께 사라진다(단, 세션 자체는 서버에 이미 저장돼 있으므로 다음에 목록을 다시 불러오면 최신 상태를 볼 수 있다).

## 3. Backend API 흐름 (전체 엔드포인트)

`main.py`가 `sessions_router`(`/sessions` prefix)와 `search_router`를 등록한다. CORS는 `allow_origins=["*"]`로 전면 허용.

| Method | Path | 파일:라인 | 설명 |
|---|---|---|---|
| GET | `/health` | `main.py:40-42` | 헬스체크, `{"status": "ok"}` |
| POST | `/sessions` | `api/sessions.py:126-152` | 단일 세션 생성. 규칙 기반 제목/요약으로 즉시 응답 후 `BackgroundTasks`로 `_ai_update` 예약 |
| POST | `/sessions/cluster` | `api/sessions.py:155-188` | 탭을 `cluster_tabs`로 그룹핑해 세션 N개 생성. 그룹별로 `_ai_update` 백그라운드 예약 |
| GET | `/sessions` | `api/sessions.py:191-198` | 세션 목록, `created_at desc` |
| GET | `/sessions/{id}` | `api/sessions.py:201-209` | 세션 상세, 404 처리 |
| PATCH | `/sessions/{id}` | `api/sessions.py:212-226` | 제목 변경만 지원(`PatchSessionRequest.title`, 1~100자) |
| DELETE | `/sessions/{id}` | `api/sessions.py:229-239` | DB 삭제 + Qdrant 포인트 삭제(`delete_point`) |
| POST | `/sessions/{id}/retry-summary` | `api/sessions.py:242-258` | `summary_status`를 `pending`으로 되돌리고 `_ai_update` 재예약 |
| GET | `/search` | `api/search.py:20-65` | 자연어 검색. `q`(필수), `limit`(1~20, 기본 5), `rerank`(선택) |

기동 시(`main.py:19-24` lifespan): `init_db()`(테이블 생성) → `init_collection()`(Qdrant 컬렉션 확인/생성) → `recover_pending_sessions()`(미완료 요약/임베딩 복구).

## 4. DB 스키마 (현재 = `sessions` 단일 테이블)

`backend/app/db/models.py` 전체가 다음 한 테이블만 정의한다(Alembic 없음, SQLAlchemy `Base.metadata.create_all`로 기동 시 생성 — `db/session.py:10-13`).

| 컬럼 | 타입 | 기본값 | 설명 |
|---|---|---|---|
| `id` | `String(36)` PK | `uuid4()` | 세션 ID |
| `title` | `String(100)` | — | 세션 제목 |
| `tabs` | `JSONB` | `[]` | 탭 배열(원본 요청의 `TabItemRequest.model_dump()` 그대로) |
| `summary` | `JSONB` | `{}` | `SessionSummary` 직렬화 |
| `tab_count` | `Integer` | `0` | |
| `summary_status` | `String(20)` | `"pending"` | `pending`/`done`/`failed` |
| `embedding_status` | `String(20)` | `"pending"` | `pending`/`done`/`failed`, UI에는 미노출 |
| `created_at` | `DateTime(tz)` | `utcnow()` | |
| `updated_at` | `DateTime(tz)` | `utcnow()`, onupdate | |

`tabs` JSONB의 각 원소는 `{id, title, url, fav_icon_url}`(`TabItemResponse`) 형태로 응답되며, 저장 시에는 `TabItemRequest`(url/title/text_content/tab_id/fav_icon_url/excerpt/site_name) 전체가 그대로 들어간다.

Qdrant(`db/vector.py`): 컬렉션 `orbit_sessions`, 벡터 차원 4096, distance `COSINE`. 포인트 ID = 세션 ID, payload = `{session_id, title, overview, purpose}`. `search_similar()`는 `search_score_threshold`(기본 0.35, env `SEARCH_SCORE_THRESHOLD`)를 적용한다.

## 5. 세션 생성 과정 (현재 파이프라인)

`POST /sessions/cluster` 기준 전체 흐름(`api/sessions.py`):

1. `cluster_tabs(body.tabs)` (`ai/clusterer.py:40-85`) — 탭이 4개 미만이면 클러스터링 없이 단일 그룹. 그 외에는 Solar Mini에 그룹핑 프롬프트를 보내 `{clusters:[{topic, indices}]}` JSON을 받고, 누락 탭/`_MAX_TABS`(20) 초과 탭은 마지막 그룹에 강제 편입. 실패 시 전체를 단일 그룹으로 fallback.
2. 그룹별로 `rule_based_title(group)`(`services/summarizer.py:36-41`)로 즉시 표시용 제목을 만들고, `SessionModel`을 생성해 DB에 커밋 — **여기까지가 요청/응답 왕복 안에서 동기적으로 처리되는 부분**이다.
3. 응답 반환 후 각 세션에 대해 `background_tasks.add_task(_ai_update, session.id, group)`가 예약된다(`api/sessions.py:186`).
4. `_ai_update()`(`api/sessions.py:98-123`): `generate_summary(tabs)`(`services/summarizer.py:44-64`) 호출 — A.X-K1 우선, 실패 시 solar-pro3로 폴백(`ai/llm.py:chat_completion`)해 제목/개요/목적/하이라이트/todo/다음 행동을 담은 JSON을 받는다. `overview`가 비어 있으면 예외를 던져 `summary_status="failed"`로 기록하고 종료(임베딩 단계로 넘어가지 않음).
5. 요약 성공 시 `session.title`/`summary`/`summary_status="done"`을 커밋하고, 이어서 `_embed_and_upsert(session_id, title, summary)`(`api/sessions.py:73-96`) 호출.
6. `_embed_and_upsert()`: `_build_embedding_text(title, summary)`(제목+overview+purpose+highlights)로 문자열을 만들고 `embed(text, model=embedding_passage_model)`(`ai/embedding.py`)로 4096차원 벡터를 생성해 `upsert_point()`로 Qdrant에 반영, `embedding_status`를 `done`/`failed`로 기록.

`recover_pending_sessions()`(`api/sessions.py:276-298`)는 기동 시 `summary_status='pending'`인 세션과 `summary_status='done' AND embedding_status IN ('pending','failed')`인 세션을 찾아 단일 background task(`_run_pending_recovery`)로 **순차** 재처리한다(외부 API 레이트리밋 대응).

## 6. AI 호출 위치 (모델·폴백·타임아웃)

| 파일 | 함수 | 모델(우선순위) | 폴백 | 타임아웃 |
|---|---|---|---|---|
| `ai/llm.py:71-114` | `chat_completion` (요약용) | A.X-K1(`axk1_model`) | `RateLimitError`→1초 대기 후 solar-pro3 / `APIStatusError`(404,503,5xx)→solar-pro3 / 연결·타임아웃 오류→solar-pro3 | 클라이언트 타임아웃 25초(`_TIMEOUT`, `llm.py:16`) |
| `ai/llm.py:35-68` | `chat_completion_light` (클러스터링/리랭킹용) | solar-mini(`solar_mini_model`) | 모든 예외 시 solar-pro3 | 동일 25초 |
| `ai/clusterer.py:40-85` | `cluster_tabs` | `chat_completion_light` 사용 | JSON 파싱/형식 오류 시 단일 그룹 fallback | 상위 `chat_completion_light`에 위임 |
| `ai/reranker.py:23-64` | `rerank` | `chat_completion_light` 사용 | 실패 시 원래 순서 유지 | 상위에 위임 |
| `ai/embedding.py:5-19` | `embed` | `embedding_query`(기본) / `embedding_passage`(저장용, 비대칭 임베딩) | 없음 — 호출부(`api/search.py`, `_embed_and_upsert`)에서 예외 처리 | httpx 클라이언트 30초 |
| `services/summarizer.py:44-64` | `generate_summary` | `chat_completion` 사용(A.X-K1→solar-pro3) | `overview` 공백/누락 시 `ValueError`로 실패 처리(더미 요약 금지) | 상위에 위임 |

**A.X-K1 3 RPS 제한**: 코드 레벨의 전역 레이트리미터는 없다. `chat_completion`은 `RateLimitError` 발생 시에만 1초 대기 후 폴백(`llm.py:95-97`)하는 반응적 처리이며, 계획서가 요구하는 "전역 최소 간격(~500ms) 리미터"는 아직 구현되어 있지 않다 — B-4의 `llm.py` 수정 대상.

파싱: `ai/json_utils.py:extract_json()`이 코드펜스 유무와 관계없이 JSON 객체를 추출한다(정규식 2단계: 코드펜스 우선, 없으면 `{...}` 패턴 탐색). `clusterer.py`는 이 위에 추가로 인덱스 유효성 검증과 누락 탭 복구를 수행한다.

## 7. 재사용 가능 모듈

계획서 §15 "그대로 재사용" 목록과 일치함을 코드로 확인:

- `services/summarizer.py:generate_summary`, `rule_based_title`
- `ai/json_utils.py:extract_json`
- `ai/embedding.py:embed` + `db/vector.py`(Qdrant 검색/upsert/삭제), `ai/reranker.py:rerank`
- `api/sessions.py:_embed_and_upsert`(계획서상 위치만 `embedding_sync.py`로 이동 예정, 로직은 그대로)
- `extension/lib/sensitive-domains.ts:isSensitiveUrl`(서버측에 정규식 포팅 필요)
- `extension/entrypoints/content.ts`(Readability 추출), `extension/lib/chrome-bridge.ts`(복원 함수 `restoreInCurrentWindow`/`restoreInNewWindow`/`openTabs`)
- `extension/entrypoints/sidepanel/components/Favicon.tsx`, `StatePlaceholder.tsx`, `SummaryPanel.tsx`(로딩/에러/빈/성공 4상태 처리, Timeline에서도 재사용 가능)
- `api/sessions.py:recover_pending_sessions`/`_run_pending_recovery` 패턴(순차 복구)
- 테스트 컨벤션: `monkeypatch` + `asyncio.run()`, DB/네트워크/실키 미사용(`tests/test_sessions.py` 참고)

## 8. 제거·변경 필요 모듈

### 8.1 죽은 코드 (미사용 확인 — grep으로 import 0건 검증)

| 파일 | 확인 방법 | 비고 |
|---|---|---|
| `extension/lib/storage.ts` | 프로젝트 전체에서 import 없음 | `chrome.storage.local` 기반 세션 CRUD, 현재 세션 저장은 전부 백엔드 경유라 미사용 |
| `extension/lib/messages.ts` | 프로젝트 전체에서 import 없음 | `OrbitMessage` 타입 정의만 있고 실제 `background.ts`/`content.ts`는 인라인 리터럴 메시지 사용 |
| `extension/lib/mock/mockSessions.ts` | 프로젝트 전체에서 import 없음 | 디자인 목업 단계 mock, 실제 데이터는 `/sessions` 사용 |
| `extension/lib/mock/mockTabs.ts` | 프로젝트 전체에서 import 없음 | 위와 동일 |
| `extension/entrypoints/sidepanel/components/Logo.tsx` | 프로젝트 전체에서 import 없음 | |
| `extension/entrypoints/sidepanel/components/SearchInput.tsx` | 프로젝트 전체에서 import 없음 | `SearchView.tsx`가 자체 input을 직접 구현하고 있어 이 컴포넌트는 쓰이지 않음 |
| `frontend/src/components/Sidebar.tsx` | `frontend/src/App.tsx`는 `HomeView`/`SessionDetailPanel`만 렌더 | `Sidebar`가 참조하는 `sessions`/`search` 뷰 전환 UI는 `HomeView` 내부 탭으로 대체됨 |
| `frontend/src/views/SessionListView.tsx` | 위와 동일 | `HomeView`가 세션 그리드를 자체 렌더 |
| `frontend/src/views/SearchView.tsx` | 위와 동일 | `HomeView`가 검색 모드를 자체 렌더 |

### 8.2 변경 필요 모듈 (신규 방향 대응)

- `extension/lib/api.ts:3` — `import { useSettingsStore } from '../entrypoints/sidepanel/store/settings'`. Zustand `persist` 미들웨어가 `localStorage`에 의존하는데(`store/settings.ts:11-20`) 서비스 워커에는 `localStorage`가 없다. 지금은 `api.ts`가 사이드패널(React 컨텍스트)에서만 호출되어 문제가 드러나지 않지만, Auto Session의 collector/sync 엔진은 `background.ts`(SW)에서 이벤트 전송 API를 호출해야 하므로 이 import가 SW 실행을 막는 최우선 차단 요인이다(계획서 §15 "가장 먼저 수정" ①).
- `extension/wxt.config.ts:13` — `permissions: ['tabs', 'storage', 'sidePanel']`에 `webNavigation`/`alarms`/`idle` 추가 필요(§15 "가장 먼저 수정" ②).
- `backend/app/db/session.py:10-13` — `init_db()`가 `create_all`만 수행하고 Alembic이 없어 스키마 변경(컬럼 추가 등)을 감지·적용할 수단이 없음(§15 "가장 먼저 수정" ③, `migration-plan.md` 참고).
- `backend/app/ai/llm.py` — 전역 레이트리미터 부재(§6 참고), `sync_pipeline`에서 배치 내 다수 LLM 호출을 순차 처리하려면 최소 간격 리미터 추가 필요.
- `extension/entrypoints/sidepanel/store/ui.ts` / `App.tsx` — 뷰 구조(`sessions|search|detail|settings`)에 `timeline` 뷰 추가 및 기본 뷰 전환 필요(계획서 C-2).

## 9. Migration 위험

- **Alembic 부재**: `init_db()`는 `Base.metadata.create_all`만 실행하므로 기존 테이블에 컬럼을 추가하거나 새 테이블을 만들 때 자동 마이그레이션이 없다. 계획서 결정에 따라 이번엔 1회 `docker compose down -v` 리셋 + `create_all` + 멱등 ALTER 러너(`app/db/migrations.py`)로 대응하며, Alembic 도입은 대회 이후로 미룬다(`migration-plan.md` 참고).
- **`lib/api.ts:3`의 사이드패널 store import**: 위 8.2 참고. Auto Session의 이벤트 전송 경로가 SW에서 실행되려면 이 import를 제거하고 설정 접근 방식을 chrome.storage 기반으로 바꿔야 한다.
- **MV3 서비스 워커 수명**: 현재 `background.ts`의 `pageContentCache`(`Map<number, PageContent | null>`)는 모듈 스코프 변수라 SW가 유휴 종료되면 즉시 유실된다(재요청 시 content script에 온디맨드 재추출을 요청하는 방식으로만 완화되어 있음, `background.ts:43-56`). 체류시간 세그먼트처럼 SW 종료 사이에도 이어져야 하는 상태는 `chrome.storage.session`처럼 SW 재시작에도 살아남는 저장소가 필요하다 — 계획서가 `chrome.storage.session`을 지정한 이유.
- **A.X-K1 3 RPS**: 배치 파이프라인에서 그룹별로 LLM(의도 분석)을 순차 호출해야 하며, 현재 `chat_completion`에는 사전적(proactive) 레이트리밋이 없어(§6) 배치가 커질수록 429가 반복 발생할 위험이 있다. 계획서는 전역 최소 간격(~500ms) 리미터 추가와 순차 처리로 대응한다.
- **테스트 회귀 범위**: 현재 백엔드 테스트는 7개 파일에 걸쳐 총 28개(2026-07-12 개선 리포트 기준, `docs/improvement-report.md` §2)이며 전부 `monkeypatch` 기반으로 DB/네트워크를 타지 않는다. 신규 모듈(`event_filter`/`grouper`/`intent_analyzer`/`sync_pipeline`/`session_updater` 등) 추가 시 이 컨벤션을 유지해야 실제 키/DB 없이 CI가 가능하다.
