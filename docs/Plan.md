# Orbit Personal Exploration Memory 전환 계획 (Auto Session · Timeline · Intent 검색 · Analytics)

**상태:** 진행 중 (2026-08-03 시작)
**브랜치:** `feat/auto-session`

## 작업 목표

Orbit을 "열린 탭 스냅샷을 AI가 분류·요약해 저장하는 도구"에서 **Personal Exploration Memory(AI Exploration OS)**로 전환한다. 핵심 원칙은 **방문 이벤트마다 LLM을 호출하지 않는다**는 것이다 — 이벤트는 실시간으로 로컬 큐에 저장하고, 동기화 트리거(수동/주기/개수/유휴) 시점에 배치로 분석해 세션을 자동 생성·갱신한다(Auto Session — 세션은 사용자가 만드는 게 아니라 스스로 성장한다).

새 핵심 기능 5개: ① Exploration Timeline ② Auto Session ③ Personal Memory(단계적 확장) ④ Search by Intent ⑤ Exploration Analytics.

리라이트가 아니다 — 기존 요약(`generate_summary`), 임베딩 검색(Qdrant), 복원, 민감 도메인 필터를 최대한 재사용한다.

## 현재 상태와 조사 결과 (요약)

- **백엔드**(FastAPI + async SQLAlchemy + Postgres 16 + Qdrant): 단일 `sessions` 테이블(tabs/summary JSONB). Alembic 없음(create_all). 큐/워커/스케줄러 없음 — 비동기는 Starlette BackgroundTasks + 시작 시 `recover_pending_sessions`. 유일한 생성 경로 `POST /sessions/cluster`(요청 경로에서 blocking LLM 호출). A.X-K1 → solar-pro3 폴백, solar-mini(클러스터/리랭크), Upstage 임베딩 4096차원(passage/query 비대칭).
- **익스텐션**(WXT MV3 + React 19 + TanStack Query + Zustand): 권한 `tabs/storage/sidePanel`만 — history/idle/alarms/webNavigation 전무. 영속 저장소 제로(설정은 localStorage — SW에서 읽기 불가). `lib/api.ts:3`이 사이드패널 Zustand store를 import해 SW에서 사용 불가. content.ts의 Readability push/pull 경로 재사용 가능. 죽은 코드: `lib/storage.ts`, `lib/messages.ts`, `lib/mock/*`, `Logo.tsx`, `SearchInput.tsx`.
- **프론트엔드(웹)**: 뉴탭 스타일 read-only 대시보드(목록/검색/상세/삭제/재시도). 저장·복원 없음. 익스텐션과 타입/매퍼 중복. 죽은 파일 3개. → Analytics Dashboard의 자연스러운 자리(수집 경로가 없어 재편 비용 최소).
- **문서**: 이 방향을 예상한 문서가 없었다. 충돌 3건을 해소해야 했다 — ① `Personas.md` "히스토리 대체 비목표" ② 최소 권한 원칙 vs 신규 권한(webNavigation 등) ③ `UserScenarios.md` 6개 시나리오 전부 수동 저장 시작. `ppt.md`의 HDBSCAN/Structured Output 서술은 기존부터 오류였고, 이후 마일스톤에서 일괄 정정한다.

## 포함 범위와 제외 범위

### 포함 범위 (MVP 12개 항목)

1. 방문 이벤트 수집(webNavigation 기반 `collector.ts`, onCommitted/onHistoryStateUpdated/tabs.onUpdated)
2. 로컬 Persistent Queue(IndexedDB + `idb`, 상태 기계 open→pending→syncing→synced, 상한 5,000개)
3. 체류시간 세그먼트 측정(`chrome.storage.session`, SW 종료 생존, 30분 캡)
4. 동기화 엔진(수동/주기/개수/유휴 4개 트리거 수렴, `navigator.locks` 뮤텍스, 지수 백오프)
5. 이벤트 인제스트 API(`POST /events`, 시스템 URL 거부·민감 본문 제거·정규화, 멱등 insert)
6. 배치 세션화 파이프라인(그룹화 → 후보 세션 검색 → LLM 의도 분석 1회 → session_updater)
7. 세션 버전 이력(`session_versions`, 스냅샷 경로도 공용 `record_version` 사용)
8. Timeline UI(사이드패널 홈 = TimelineView, 세션 상세의 탐색 타임라인 섹션)
9. Search by Intent(`GET /search?scope=memory` — 세션 + 관련 방문 기록 통합 검색)
10. 개인정보 통제(수집 opt-in 기본 off, 동기화 전/후 이벤트 삭제, 서버측 민감 도메인 이중 방어)
11. Exploration Analytics 최소 기능(`GET /analytics/overview`, 웹 대시보드 Analytics 섹션, CSS 막대)
12. 평가 체계(골든셋 포맷 + `backend/eval/run_eval.py` + 지표 정의)

### 제외 범위 (MVP 제외 확인)

- ChatGPT/Gemini 연동(P5 → Stage 3 로드맵으로만 문서화)
- Team Workspace/세션 공유(P4 → Stage 4 로드맵으로만 문서화)
- 모바일 지원, 예측 추천, 자동 북마크, MCP, 멀티에이전트
- 세션 자동 병합(merge) — 스키마만 예약, 실제 병합 로직은 제외
- 동기화 설정 API(설정은 익스텐션 로컬 + 백엔드 env로만 관리)
- 이벤트 단위 임베딩(세션 임베딩+키워드로 충분한지 골든셋으로 판단 후 결정)
- Analytics용 차트 라이브러리 신규 도입(CSS 막대로 대체)
- LangSmith 연동(선택 — 자체 `sync_batches` 기록으로 대체 가능)
- 기존 프론트/익스텐션 타입·매퍼 중복 해소(위생 작업, 대회 이후)

## 변경할 파일 또는 모듈

- **BE 신규**: `db/migrations.py`, `api/{events,sync,analytics}.py`, `schemas/{event,sync}.py`, `services/{event_filter,grouper,intent_analyzer,session_updater,embedding_sync,sync_pipeline}.py`
- **BE 수정**: `models.py`, `vector.py`(score 포함 검색), `llm.py`(리미터+`chat_completion_with_meta`), `api/{sessions,search}.py`, `schemas/session.py`, `config.py`, `main.py`
- **EXT 신규**: `lib/settings.ts`, `lib/events/{types,db,queue,collector}.ts`, `lib/sync/{engine,triggers}.ts`, `views/TimelineView.tsx`, `components/timeline/{TimelineItem,TimelineDateHeader,SessionBadge}.tsx`, `components/SyncStatusCard.tsx`
- **EXT 수정**: `wxt.config.ts`(webNavigation/alarms/idle + commands + 배포 host), `background.ts`(컴포지션 루트화), `lib/api.ts`(store import 제거·postEventBatch·memory 검색), `store/settings.ts`(chrome.storage 어댑터), `App.tsx`/`ui.ts`(뷰 재편), `SearchView/SettingsView/SessionDetailView/SessionListView`, `package.json`(idb 의존성 추가)
- **FE 수정**: `HomeView.tsx`(Analytics 섹션), 신규 `components/analytics/{TopicTimeBar,DomainTopList,DailyTrend,RepeatVisits}.tsx`(CSS 막대), `lib/api.ts`(analytics fetch). 죽은 파일 3개는 이번 범위에서는 정리하지 않는다(별도 위생 작업).
- **프롬프트**: intent 분석 프롬프트는 `intent_analyzer.py`에 `PROMPT_VERSION` 상수로 중앙화(기존 summarizer/clusterer/reranker 컨벤션 준수), 파싱은 `extract_json` + `clusterer.py`식 방어적 인덱스 복구 재사용.
- **문서(이번 작업)**: `ProjectContext.md`, `DecisionLog.md`, `Plan.md`(본 문서), `Personas.md`, `IA.md`, `UserScenarios.md`.

## 구현 순서

**M0 — 문서**: 신규 8종 문서(`product-direction-v2.md` 등) + 기존 6개 문서 갱신 + DecisionLog 기록. (본 계획 문서 작업이 M0에 해당한다.)

**M1 — 계약 확정 & 인제스트** (P1 시작, 이후 BE/EXT 병렬)
1. BE: 모델 5개 + `migrations.py` 러너 + config — 1회 `down -v`, 기존 28 테스트 green
2. BE: `event_filter.py`(정규화/검색어 추출/시스템 URL 거부/민감 본문 제거) + 테스트
3. BE: `POST /events` + pending-count(멱등 insert) + 테스트
4. EXT: 설정 마이그레이션 — `lib/settings.ts`, zustand chrome.storage 어댑터(+localStorage 1회 이관), `enrichTabs` store import 제거
5. EXT: 매니페스트 — webNavigation/alarms/idle + commands(Alt+Shift+O 정합화) + 배포 host_permissions

**M2 — 수집 & 동기화 엔진** (P1)
6. EXT: `lib/events/{types,db,queue}.ts`(idb, 상태 기계, `orbit:syncStatus` 요약)
7. EXT: `collector.ts` — onCommitted/SPA 디바운스(500ms)/리다이렉트 치환(<3s)/opt-in 게이트, 수집 실패 fail-open
8. EXT: 체류시간 — storage.session 세그먼트(onActivated/onFocusChanged/idle/onRemoved, 30분 캡)
9. EXT: 본문 부착 — PAGE_CONTENT_READY 재사용, SPA는 1.5s 후 EXTRACT_CONTENT, contentCapture/민감 게이트
10. EXT: `sync/{engine,triggers}.ts` — navigator.locks 뮤텍스, 4개 트리거 수렴, 백오프, stale-syncing 리셋

**M3 — 배치 세션화 = Auto Session 코어** (P1)
11. `grouper.py`(순수 함수) / `vector.py` score 검색 / `llm.py` 리미터+meta / `_embed_and_upsert` → `embedding_sync.py` 이동(유일한 기존 코드 리팩터) + 테스트
12. `intent_analyzer.py` — 프롬프트+방어적 파싱(미할당 fallback, 인덱스 복구) + 테스트
13. `session_updater.py` — 결정 적용, tabs 대표 페이지 동기화, `record_version`(스냅샷 경로 공용), `refresh_session_ai` + 테스트
14. `sync_pipeline.py` + `api/sync.py` + 주기 루프 + 개수 트리거 + 시작 복구 확장 + 테스트

**M4 — Timeline UI & Intent 검색** (P2)
15. EXT: TimelineView(홈) + SyncStatusCard + timeline 컴포넌트 3종 + 이벤트 삭제 + SettingsView 수집·동기화 섹션 + App/ui.ts 뷰 재편
16. BE+EXT: 세션 Timeline — `GET /sessions/{id}/events`(+versions) + SessionDetailView 타임라인 섹션
17. BE+EXT: Intent 검색 — `/search?scope=memory` + SearchView 그룹 렌더 + `DELETE /events/{id}` + retry-summary origin 분기 + 검색→복원 E2E

**M5 — Analytics·평가·마무리** (P3)
18. BE: `GET /analytics/overview` + EXT TimelineView 요약 카드 + FE 대시보드 Analytics 섹션(CSS 막대)
19. 평가: 골든셋 시나리오 + `eval/run_eval.py` + 지표 리포트
20. E2E 스모크 + 문서 최종 정합(README/ppt.md 포함) + WorkLog 갱신

구현 작업은 Sonnet 서브에이전트에 위임한다(CLAUDE.md §19 준수 — 동시 최대 2개, 마일스톤 병렬 구간은 3개까지, 에이전트별 수정 파일 비겹침(BE/EXT/FE·문서로 분리), 중첩 위임 금지). 계약(스키마·타입·API)과 아키텍처 통합, diff·테스트 검토는 메인 에이전트가 직접 수행한다.

## 테스트 및 검증 방법

- **BE**: `python -m pytest -p no:asyncio` — 기존 28개 + 신규(event_filter/grouper/intent_analyzer/sync_pipeline/session_updater/event_schemas/analytics/search-memory). 기존 monkeypatch 스타일 유지, DB/네트워크/실키 미사용.
- **EXT**: `pnpm compile` + `pnpm build`. 스텝별 수동 검증: SW devtools에서 IDB 확인 → SW 강제 종료 후 세그먼트/큐 생존 확인 → 백엔드 다운 → 백오프 → 회복 → 중복 없음(duplicates 카운트).
- **FE**: `tsc --noEmit && vite build`.
- **E2E**: docker compose 기동 → 수집 활성화 → 5개 사이트 순차 방문 → 수동 동기화 → 1개 세션 자동 생성 확인 → Timeline에서 흐름 확인 → Intent 검색 → 복원 → Analytics 카드 확인. 기존 기능(탭 스냅샷 저장·검색·복원) 무파손 확인.
- **품질**: 골든셋 지표(Event-to-Session Assignment Accuracy / Session Purity / Coverage / New-vs-Existing Decision Accuracy / 노이즈 제외율 / Retrieval Recall@K) 측정 — 임계값·프롬프트 튜닝의 판단 기준.

## 위험과 사용자 결정이 필요한 사항

### 확정된 사용자 결정 (2026-08-03, `DecisionLog.md` 기록)

1. **DB 마이그레이션**: 1회 `docker compose down -v` 리셋 + create_all + 멱등 ALTER 러너(`app/db/migrations.py`). Alembic은 대회 이후.
2. **방문 감지**: webNavigation 중심(`onCommitted`/`onHistoryStateUpdated`/`tabs.onUpdated`). `history` 권한 미사용 — 설치 경고가 기존 tabs와 동일.
3. **로컬 큐**: IndexedDB + `idb`(~1.2KB, 신규 의존성 1개).
4. **세션 요약 저장**: `summary` JSONB 유지, `session_versions`만 개별 컬럼.

계획 내 추가 기본값(되돌리기 쉬움): 배치 실행은 in-process asyncio(신규 인프라 없음) / Analytics 차트는 CSS 막대 / LangSmith는 선택 / 수집 기본 off(opt-in).

### 기술 위험 top 5

1. **의도 분석 품질** — 오할당이 좋은 세션을 오염시킬 수 있다. create 편향 프롬프트 + relevance/assigned_by 감사 필드 + 골든셋 측정으로 대응.
2. **A.X-K1 3 RPS 하 배치 소요 2~5분** — 순차 처리 + `/sync/status` 진행 노출로 대응.
3. **재시작 mid-batch 복구 불변식** — 전용 테스트 필요.
4. **MV3 SW 수명** — 체류시간 세그먼트 유실 가능. `storage.session` + 30분 캡으로 대응.
5. **SPA 이벤트 폭주**(YouTube/Maps 등) — 디바운스 튜닝, 실사이트 조기 테스트 필요.

### 남아 있는 미결정 사항 (구현 전 별도 결정 필요, `DecisionLog.md` "열린 결정" 참고)

- 저장한 페이지 본문의 보관 기간과 재요약 지원 범위
- 외부 배포 시 인증, 허용 origin, 운영 환경 구성
- 웹 대시보드에서 세션 복원을 어디까지 지원할지

## 완료 조건

- §16 핵심 성공 기준에 해당하는 8개 E2E 동작이 확인된다: 상시 수집(방문마다 LLM 무호출) → 안전 저장(SW 종료/재시작 생존) → 배치 세션화(Auto Session) → Timeline으로 탐색 경로 이해 → Intent 검색으로 과거 탐색 재발견 → 복원으로 작업 재개 → Analytics로 탐색 패턴 확인.
- 포함 범위의 MVP 12개 항목이 모두 완료된다.
- 기존 기능(탭 스냅샷 저장·검색·복원·요약 재시도)이 무파손으로 동작한다.
- 골든셋 평가(`eval/run_eval.py`)를 실행할 수 있다.
- `WorkLog.md`와 `DecisionLog.md`가 이번 작업 내용으로 갱신된다.
