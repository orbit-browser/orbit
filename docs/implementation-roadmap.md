# Orbit 구현 로드맵 — M0~M5 태스크 분해

> 근거: 계획서 G(구현 순서), B-4(모듈 배치), §14 Phase 4 11단계 매핑, H(단계적 확장). 브랜치는 `feat/auto-session` 하나로 진행하며, 구현은 Sonnet 서브에이전트에 위임하되 계약(스키마·타입·API)과 아키텍처 통합은 메인 에이전트가 직접 관리한다(계획서 G 서두, CLAUDE.md §19 준수).
> 각 마일스톤은 이전 단계 검증이 green이어야 다음 단계로 진행한다. 마일스톤별 "기존 기능 무파손 확인 방법"은 `docs/migration-plan.md` §4에 별도로 정리되어 있다 — 이 문서는 태스크 단위의 목적/파일/완료조건/위험에 집중한다.

## M0 — 문서 (A 전체)

**목적**: 구현 착수 전 설계를 문서로 고정해 서브에이전트 위임 시 계약이 흔들리지 않게 한다.

- 신규 문서 8종(이 문서를 포함한 `docs/product-direction-v2.md` ~ `docs/implementation-roadmap.md`)
- 기존 문서 갱신: `ProjectContext.md`(방향 재정의), `DecisionLog.md`(확정 결정 4건 + 권한 확장 + 비목표 수정 + in-process 배치), `Plan.md`(이 작업으로 교체), `Personas.md`(비목표 수정), `IA.md`(Timeline 중심 재편), `UserScenarios.md`(신규 시나리오 추가, 기존 6개 유지), `README.md`/`ppt.md`(실제 파이프라인 반영 + HDBSCAN 서술 정정), `WorkLog.md`
- **완료 조건**: 8개 신규 문서 작성 완료, 기존 문서 갱신 완료. 이 문서 자체는 코드 변경이 없으므로 테스트 실행 대상 아님 — 마크다운/문서 간 정합성만 확인.
- **예상 위험**: 문서 작성 단계에서 계획서에 없는 설계를 임의로 추가하면 이후 구현 단계에서 계약 불일치가 생긴다 — 계획서를 단일 진실 원천으로 유지.

## M1 — 계약 확정 & 인제스트 (P1 시작, 이후 BE/EXT 병렬)

### M1-1. BE: 모델 5개 + `migrations.py` 러너 + config

- **목적**: Memory Store 스키마를 코드에 반영하고, 1회 리셋 이후의 스키마 변경을 흡수할 러너를 마련한다(§15 "가장 먼저 수정" ③).
- **변경 파일**: `backend/app/db/models.py`(`sessions` 확장 컬럼 추가), `backend/app/config.py`(신규 env — 동기화 주기 기본값, 리미터 간격 등)
- **신규 파일**: `backend/app/db/migrations.py`(멱등 ALTER 러너, ~25줄)
- **DB Migration**: `docs/migration-plan.md` §2 절차대로 1회 `docker compose down -v` → `create_all`이 신규 5테이블(`exploration_events`/`sync_batches`/`sync_batch_events`/`session_events`/`session_versions`) + 확장된 `sessions`를 생성. 이후 컬럼 추가는 `migrations.py`가 담당.
- **API 변경**: 없음(이 태스크는 스키마·설정만).
- **테스트 방법**: 기존 백엔드 테스트 28개 green(`python -m pytest -p no:asyncio`). `migrations.py` 자체에 대해 "컬럼이 이미 있으면 건너뛴다"는 멱등성 단위 테스트 추가.
- **완료 조건**: 리셋 후 서버가 정상 기동하고 신규 테이블/컬럼이 모두 존재. 기존 세션 CRUD가 그대로 동작.
- **예상 위험**: `NOT NULL` 컬럼에 기본값을 빠뜨리면 기존 행이 있는 `sessions` 테이블에서 ALTER가 실패한다(리셋 직후에는 데이터가 없어 드러나지 않을 수 있음 — 러너 자체 로직 리뷰 필요).

### M1-2. BE: `event_filter.py`

- **목적**: 인제스트 시점에 정규화/검색어 추출/시스템 URL 거부/민감 본문 제거를 수행해, 배치 파이프라인이 이미 정제된 이벤트만 다루게 한다.
- **신규 파일**: `backend/app/services/event_filter.py`
- **변경 파일**: 없음(신규 모듈 단독 테스트 가능)
- **DB Migration**: 없음(M1-1에서 이미 반영).
- **API 변경**: 없음(이 태스크는 `POST /events`가 호출할 순수 함수 준비 단계).
- **테스트 방법**: `docs/data-model-v2.md` §8의 검색엔진별 URL 패턴, 시스템 URL 거부, 민감 도메인 정규식 이식(기존 `extension/lib/sensitive-domains.ts`와 동일 규칙)에 대한 단위 테스트.
- **완료 조건**: 구글/네이버/유튜브/빙 URL에서 `search_query` 추출, `chrome://`/`about:` 등 시스템 URL 거부, 민감 도메인 URL의 본문 필드만 제거되는 것을 테스트로 확인.
- **예상 위험**: 익스텐션 쪽 `sensitive-domains.ts`와 정규식이 어긋나면 "본문만 제외"라는 기존 정책(DecisionLog 2026-07-05)이 클라이언트/서버 간 불일치하게 된다 — 정규식 소스를 한쪽에서 복사해 오되 향후 변경 시 양쪽을 함께 갱신해야 함을 코드 주석으로 남긴다.

### M1-3. BE: `POST /events` + `pending-count`

- **목적**: 익스텐션이 로컬 큐를 서버로 동기화할 수 있는 최초 진입점을 만든다.
- **신규 파일**: `backend/app/schemas/event.py`
- **변경 파일**: `backend/app/api/__init__.py`(신규 라우터 등록), `backend/app/main.py`(라우터 include)
- **신규 파일(라우터)**: `backend/app/api/events.py`
- **DB Migration**: 없음(M1-1에서 반영된 `exploration_events` 사용).
- **API 변경**: `docs/api-design-v2.md` §1, §2 — `POST /events`(멱등 insert, `on_conflict_do_nothing`), `GET /events/pending-count`.
- **테스트 방법**: 동일 `id` 중복 전송 시 `duplicates` 카운트 확인, `event_filter`가 걸러낸 이벤트가 `filtered` 카운트에 잡히는지 확인.
- **완료 조건**: 1~200개 배치 전송이 202로 응답하고, 중복 전송이 실제 레코드를 늘리지 않는다.
- **예상 위험**: 클라이언트(M2에서 구현될 `sync/engine.ts`)가 아직 없는 상태이므로, 이 태스크의 테스트는 API 자체만 단위 검증하고 실제 E2E 확인은 M2 이후로 미뤄진다.

### M1-4. EXT: 설정 마이그레이션

- **목적**: `localStorage` 기반 Zustand persist를 SW에서도 접근 가능한 `chrome.storage`로 옮겨, `lib/api.ts:3`의 SW 차단 요인을 제거한다(§15 "가장 먼저 수정" ①).
- **신규 파일**: `extension/lib/settings.ts`(chrome.storage 어댑터)
- **변경 파일**: `extension/entrypoints/sidepanel/store/settings.ts`(chrome.storage 어댑터로 persist 미들웨어 교체 + 기존 `localStorage` 값 1회 이관), `extension/lib/api.ts`(`enrichTabs`의 `useSettingsStore` 직접 import 제거 — 설정 값을 파라미터로 주입받는 형태로 변경)
- **DB Migration**: 없음(익스텐션 로컬 상태).
- **API 변경**: 없음.
- **테스트 방법**: `pnpm compile && pnpm build`. 기존 사용자의 `orbit-settings`(localStorage) 값이 최초 실행 시 `chrome.storage.local`로 정확히 1회 이관되는지 수동 확인(재실행 시 중복 이관되지 않아야 함).
- **완료 조건**: `lib/api.ts`가 더 이상 사이드패널 전용 모듈을 import하지 않아 SW 컨텍스트에서도 로드 가능. 기존 설정 화면(`SettingsView`)의 토글 동작은 그대로 유지.
- **예상 위험**: persist 미들웨어 교체 시 기존 사용자의 `rerankEnabled`/`excludeSensitive` 값이 초기화되면 안 된다 — 이관 로직 누락 시 조용히 기본값으로 되돌아갈 수 있어 반드시 이관 테스트 필요.

### M1-5. EXT: 매니페스트 권한 확장

- **목적**: 방문 감지(`webNavigation`)와 동기화 트리거(`alarms`, `idle`)에 필요한 권한을 추가한다(§15 "가장 먼저 수정" ②).
- **변경 파일**: `extension/wxt.config.ts`(`permissions`에 `webNavigation`/`alarms`/`idle` 추가, `commands` 추가로 기존 Alt+Shift+O 단축키 정합화, 배포 환경용 `host_permissions` 정리)
- **DB Migration**: 없음.
- **API 변경**: 없음.
- **테스트 방법**: `pnpm build` 후 매니페스트 파일에 권한이 정확히 반영됐는지 확인. 설치 시 권한 경고 문구가 기존 `tabs`와 동일 등급인지(새로운 심각도의 경고가 뜨지 않는지) 수동 확인.
- **완료 조건**: 권한 추가 후에도 기존 사이드패널이 정상 로드되고, `chrome.tabs`/`chrome.storage`/`chrome.sidePanel` 관련 기존 기능이 깨지지 않는다.
- **예상 위험**: 권한이 추가돼도 M2에서 실제 리스너를 등록하기 전까지는 아무 동작도 하지 않으므로, 이 태스크 자체는 낮은 위험도. 다만 배포용 `host_permissions` 설정을 이 시점에 함께 정리하지 않으면 이후 배포 시 별도 작업이 필요해진다.

## M2 — 수집 & 동기화 엔진 (P1)

### M2-6. EXT: `lib/events/{types,db,queue}.ts`

- **목적**: IndexedDB 기반 로컬 큐와 이벤트 상태 기계(open→pending→syncing→synced)를 구현한다.
- **신규 파일**: `extension/lib/events/types.ts`, `extension/lib/events/db.ts`(`idb` 래퍼), `extension/lib/events/queue.ts`(상태 전이, `orbit:syncStatus` 요약 조회)
- **변경 파일**: `extension/package.json`(`idb` 의존성 추가)
- **DB Migration**: 없음(로컬 IndexedDB — 서버 DB 아님).
- **API 변경**: 없음.
- **테스트 방법**: `pnpm compile`. SW devtools의 Application 탭에서 IndexedDB 스키마와 상태 전이를 수동 확인. 큐 상한 5,000개 초과 시 `synced` 우선 정리 → 최고령 `pending` 퇴출 로직을 단위 테스트(순수 함수로 분리 가능한 부분).
- **완료 조건**: 이벤트 CRUD와 상태 전이가 IndexedDB에 정확히 반영되고, 상한 초과 시 `droppedCount`가 계산된다.
- **예상 위험**: `idb` 래퍼 설계가 이후 `collector.ts`/`sync/engine.ts`/Timeline UI 세 소비자의 접근 패턴을 모두 만족해야 한다 — 초기 스키마 설계가 좁으면 이후 태스크에서 재설계가 필요해질 수 있다.

### M2-7. EXT: `collector.ts`

- **목적**: `webNavigation` 이벤트를 실제로 감지해 큐에 적재한다.
- **신규 파일**: `extension/lib/events/collector.ts`
- **변경 파일**: `extension/entrypoints/background.ts`(컴포지션 루트화 — collector 초기화 호출 추가, 단 이 태스크에서는 등록만 하고 전면 리팩터는 M2-10에서 마무리)
- **DB Migration**: 없음.
- **API 변경**: 없음.
- **테스트 방법**: `onCommitted`(frameId 0)/`onHistoryStateUpdated`(SPA, 500ms 디바운스)/리다이렉트 치환(<3초)/opt-in 게이트 각각에 대한 단위 테스트(가능한 부분은 순수 함수로 분리). 실제 사이트(특히 YouTube/Maps 등 SPA 폭주 위험 사이트)에서 수동 확인.
- **완료 조건**: 수집이 opt-in(기본 off) 상태에서는 전혀 동작하지 않고, 켜진 뒤에는 시스템 URL/짧은 리다이렉트가 걸러진 상태로 큐에 쌓인다.
- **예상 위험**: 계획서 §15 기술 위험 5번(SPA 이벤트 폭주)에 해당 — YouTube/Maps 등에서 디바운스가 부족하면 큐가 짧은 시간에 과도하게 쌓일 수 있어 조기 실사이트 테스트가 필요.
- **원칙**: 수집 실패는 fail-open — 어떤 이유로든 수집 로직이 예외를 던지더라도 사용자의 정상 브라우징을 막아서는 안 된다.

### M2-8. EXT: 체류시간 세그먼트

- **목적**: SW 종료에도 살아남는 체류시간 계산을 구현한다(계획서 §15 기술 위험 4번 — MV3 SW 수명).
- **변경 파일**: `extension/lib/events/collector.ts`(세그먼트 갱신 로직 추가) 또는 별도 파일로 분리(구현 단계에서 판단)
- **DB Migration**: 없음.
- **API 변경**: 없음.
- **테스트 방법**: `chrome.storage.session`에 세그먼트가 저장되는지, SW를 devtools에서 강제 종료한 뒤에도 값이 유지되는지 수동 확인. `onActivated`/`onFocusChanged`/`idle`/`onRemoved` 각 이벤트에서 세그먼트가 갱신되는지, 30분 캡이 적용되는지 단위 테스트.
- **완료 조건**: 탭 전환/창 포커스 변경/유휴/탭 종료 시점에 체류시간이 정확히 마감되고, SW 재시작 후에도 진행 중이던 세그먼트가 유실되지 않는다.
- **예상 위험**: 캡(30분) 설정이 없으면 브라우저를 켜둔 채 며칠씩 방치된 탭이 비정상적으로 긴 체류시간으로 기록될 수 있다.

### M2-9. EXT: 본문 부착

- **목적**: 기존 `content.ts`의 Readability 추출 경로를 이벤트에도 재사용해, 요약 품질에 필요한 본문 발췌를 이벤트 레코드에 붙인다.
- **변경 파일**: `extension/entrypoints/background.ts`(이벤트 생성 시 `PAGE_CONTENT_READY` 캐시를 조회해 붙이는 로직 추가), `collector.ts`(SPA는 네비게이션 후 1.5초 뒤 `EXTRACT_CONTENT` 요청)
- **DB Migration**: 없음.
- **API 변경**: 없음.
- **테스트 방법**: `contentCapture` 토글이 꺼져 있으면 본문이 전혀 붙지 않는지, 민감 도메인이면 토글과 무관하게 본문이 비는지(기존 `enrichTabs`와 동일한 정책) 확인.
- **완료 조건**: 이벤트의 `content_excerpt`가 본문 캡처 설정과 민감 도메인 정책을 정확히 반영한다.
- **예상 위험**: `content.ts`는 기존에 "저장 버튼을 누른 시점"에만 온디맨드로 호출됐지만, 이제는 방문마다(opt-in 시) 호출 빈도가 늘어난다 — 성능 영향 확인 필요(확인 필요 — 실측 전까지는 가정).

### M2-10. EXT: `sync/{engine,triggers}.ts`

- **목적**: 4개 트리거를 하나의 동기화 엔진으로 수렴시키고, 실패 시 백오프와 재시도를 구현한다.
- **신규 파일**: `extension/lib/sync/engine.ts`, `extension/lib/sync/triggers.ts`
- **변경 파일**: `extension/entrypoints/background.ts`(컴포지션 루트 마무리 — collector/sync 엔진 초기화를 한곳에서 조합)
- **DB Migration**: 없음.
- **API 변경**: 이 태스크는 `POST /events`(M1-3에서 이미 존재)를 실제로 호출하는 첫 지점. `POST /sync`/`GET /sync/status`는 M3-14에서 백엔드가 준비된 뒤 연동.
- **테스트 방법**: `navigator.locks` 뮤텍스로 트리거 중복 실행이 방지되는지, 서버 다운 상태에서 지수 백오프(최대 30분)가 동작하는지, `stale-syncing` 리셋이 동작하는지 수동 확인(백엔드 다운 → 백오프 → 회복 → 중복 없음 확인, 계획서 검증 절).
- **완료 조건**: 4개 트리거(수동/주기/개수/유휴) 중 어느 것이 발생해도 동일한 엔진으로 수렴하고, 중복 전송이 발생하지 않는다(`duplicates` 카운트로 확인).
- **예상 위험**: 계획서 §15 기술 위험 2·3번(배치 소요 시간, 재시작 mid-batch 복구)과 맞물린다 — 클라이언트 쪽 백오프 정책이 서버 쪽 배치 소요 시간(2~5분)과 충돌하지 않도록 재시도 간격을 넉넉히 잡아야 한다.

## M3 — 배치 세션화 = Auto Session 코어 (P1)

### M3-11. `grouper.py` / `vector.py` 확장 / `llm.py` 리미터 / `_embed_and_upsert` 이동

- **목적**: 세션화 파이프라인의 재료(그룹화, 점수 포함 벡터 검색, 레이트리밋)를 준비하고 유일한 기존 코드 리팩터(`_embed_and_upsert` 위치 이동)를 수행한다.
- **신규 파일**: `backend/app/services/grouper.py`(순수 함수 — 시간 간격 30분 gap 기준 그룹화), `backend/app/services/embedding_sync.py`(`_embed_and_upsert` 이동 대상)
- **변경 파일**: `backend/app/db/vector.py`(`search_similar`가 score를 포함해 반환하도록 확장 — 기존 세션 후보 검색 top3, threshold 0.35), `backend/app/ai/llm.py`(전역 최소 간격 ~500ms 리미터 추가, `chat_completion_with_meta` — 모델/소요시간 등 메타 반환), `backend/app/api/sessions.py`(`_embed_and_upsert` 제거, `embedding_sync.py` import로 교체)
- **DB Migration**: 없음(M1-1에서 이미 반영).
- **API 변경**: 없음(내부 서비스 계층 변경).
- **테스트 방법**: `_embed_and_upsert` 이동 전/후 동일 동작을 보장하는 회귀 테스트(기존 `test_sessions.py`의 관련 테스트를 새 위치 기준으로 갱신). `grouper.py`는 순수 함수이므로 다양한 시간 간격 케이스에 대한 단위 테스트(30분 이내는 같은 그룹, 초과는 분리) 용이.
- **완료 조건**: 기존 스냅샷 경로(`POST /sessions/cluster`)가 이동된 `embedding_sync.py`를 통해 동일하게 동작. `search_similar`가 score를 반환해도 기존 호출부(`api/search.py`)는 무변경으로 동작(하위 호환).
- **예상 위험**: 리팩터 과정에서 import 경로 누락이나 순환 참조가 생기기 쉬움 — 이동 직후 전체 테스트 스위트를 반드시 재실행.

### M3-12. `intent_analyzer.py`

- **목적**: 그룹화된 이벤트에 대해 LLM 의도 분석(append/create/hold/discard 판단)을 수행한다.
- **신규 파일**: `backend/app/services/intent_analyzer.py`(프롬프트 + `PROMPT_VERSION` 상수 — 기존 summarizer/clusterer/reranker 컨벤션과 동일하게 프롬프트 중앙화)
- **변경 파일**: 없음(독립 모듈).
- **DB Migration**: 없음.
- **API 변경**: 없음(내부 서비스).
- **테스트 방법**: `extract_json` + `clusterer.py`식 방어적 인덱스 복구(잘못된 인덱스, 범위 초과, 누락 이벤트 처리)에 대한 단위 테스트. 미할당 이벤트에 대한 fallback(hold 처리) 테스트. `docs/evaluation-plan.md`의 골든셋으로 실측 정확도 평가는 M5-19에서 진행.
- **완료 조건**: LLM이 형식에 안 맞는 응답을 반환해도 예외로 전체 배치가 죽지 않고, 해당 그룹은 안전하게 `hold` 처리된다.
- **예상 위험**: 계획서 §15 기술 위험 1번(의도 분석 품질) — 오할당이 세션을 오염시킬 수 있어, `relevance`/`assigned_by` 감사 필드(§data-model-v2.md `session_events`)를 반드시 함께 기록해 사후 검증 가능하게 한다.

### M3-13. `session_updater.py`

- **목적**: 의도 분석 결과를 실제 DB 반영(세션 생성/갱신, `session_events`, `tabs` 대표 페이지 동기화, 버전 기록)으로 옮긴다.
- **신규 파일**: `backend/app/services/session_updater.py`
- **변경 파일**: `backend/app/api/sessions.py`(공용 `record_version()` 추출 — 스냅샷 경로 `_ai_update`도 이 함수를 호출하도록 수정, `refresh_session_ai` 추가 — `retry-summary`의 origin 분기 대상)
- **DB Migration**: 없음.
- **API 변경**: 없음(내부 서비스 — `POST /sessions/{id}/retry-summary`의 origin 분기는 M4-17에서 라우터 레벨로 연결).
- **테스트 방법**: `tabs` JSONB 단일 작성자 원칙(§data-model-v2.md §4.1) 위반 여부 테스트 — 두 작성자가 동시에 갱신하는 경로가 없는지 코드 리뷰 + 동시성 테스트. `record_version`이 스냅샷/이벤트 두 경로 모두에서 호출되는지 확인.
- **완료 조건**: `append`/`create`/`discard` 세 액션이 각각 올바르게 세션을 갱신/생성/무시하고, 변경된 세션마다 `session_versions`에 새 버전이 기록된다.
- **예상 위험**: `tabs` top-20 대표 페이지 선정 로직(relevance×sequence_order)이 명확히 정의되지 않으면 기존 UI가 기대하는 "대표 탭" 품질이 떨어질 수 있음 — 구현 시 `docs/data-model-v2.md` §4.1 기준을 그대로 따른다.

### M3-14. `sync_pipeline.py` + `api/sync.py`

- **목적**: M3-11~13의 결과를 하나의 배치 실행 흐름으로 조립하고, HTTP 트리거(`POST /sync`)와 주기 루프/개수 트리거를 연결한다.
- **신규 파일**: `backend/app/services/sync_pipeline.py`, `backend/app/api/sync.py`
- **변경 파일**: `backend/app/main.py`(라우터 등록 + 시작 복구 확장 — 기존 `recover_pending_sessions`와 유사하게 `running`이던 배치를 `failed`로, `processing`이던 이벤트를 `pending`으로 되돌리는 로직 추가)
- **DB Migration**: 없음.
- **API 변경**: `docs/api-design-v2.md` §4, §5 — `POST /sync`, `GET /sync/status`.
- **테스트 방법**: 배치 동시 실행 방지(모듈 레벨 `asyncio.Lock` + `sync_batches.status='running'`)에 대한 전용 테스트. 재시작 시 mid-batch 복구 불변식 테스트(계획서 §15 기술 위험 3번 — "전용 테스트" 명시).
- **완료 조건**: `POST /sync`가 실행 중인 배치와 충돌하면 409, `pending` 이벤트가 없으면 200(no_pending)을 반환하고, 정상 접수 시 202 + `batch_id`를 반환한다. 서버 재시작 후에도 중단된 배치가 안전하게 복구된다.
- **예상 위험**: A.X-K1 3 RPS 제약으로 배치 소요가 2~5분에 이를 수 있어(§15 기술 위험 2번), `/sync/status`의 진행 노출이 없으면 사용자가 "멈춘 것"으로 오인할 수 있다.

## M4 — Timeline UI & Intent 검색 (P2)

### M4-15. EXT: TimelineView + SyncStatusCard + 뷰 재편

- **목적**: 사이드패널 홈을 세션 카드 목록에서 이벤트 타임라인으로 재편한다(기존 `SessionListView`는 유지 — 대체가 아니라 추가).
- **신규 파일**: `extension/entrypoints/sidepanel/views/TimelineView.tsx`, `extension/entrypoints/sidepanel/components/SyncStatusCard.tsx`, `extension/entrypoints/sidepanel/components/timeline/{TimelineItem,TimelineDateHeader,SessionBadge}.tsx`
- **변경 파일**: `extension/entrypoints/sidepanel/App.tsx`(`timeline` 뷰 추가 및 기본 뷰로 전환), `extension/entrypoints/sidepanel/store/ui.ts`(`View` 타입에 `timeline` 추가), `extension/entrypoints/sidepanel/views/SettingsView.tsx`(수집·동기화 섹션 — 마스터 토글, 자동 동기화 on/off+주기, 유휴/개수 기준, 본문 저장 토글)
- **DB Migration**: 없음.
- **API 변경**: `GET /events?date=today`(M1 이후 이미 존재해야 함 — 아직 라우터가 없다면 이 태스크에서 함께 추가, 계획서 매핑상 M2에 해당하나 실제 소비는 이 시점).
- **테스트 방법**: `pnpm compile && pnpm build`. 미동기화 이벤트가 IndexedDB에서 직접 읽혀 SW를 깨우지 않고 렌더링되는지 확인. 개별 이벤트 삭제(동기화 전) 동작 확인.
- **완료 조건**: 사이드패널 첫 진입 화면이 Timeline이고, 기존 `sessions`/`search`/`settings` 뷰로도 전환 가능하다(TopNavBar 세그먼트: 타임라인/세션/Ask AI).
- **예상 위험**: 기본 뷰 전환이 기존 사용자 흐름(세션 목록이 첫 화면)을 예상하고 만들어진 시나리오와 달라지므로, `docs/UserScenarios.md` 갱신과 함께 진행해야 함(문서-코드 정합).

### M4-16. BE+EXT: 세션 Timeline

- **목적**: 세션 상세 화면에서 "어떤 흐름으로 이 결론에 도달했는지"를 보여준다.
- **변경 파일**: `backend/app/api/sessions.py`(`GET /sessions/{id}/events`, `GET /sessions/{id}/versions` 라우트 추가), `extension/entrypoints/sidepanel/views/SessionDetailView.tsx`("탐색 타임라인" 섹션 추가 — 필드 존재 시에만 표시해 백엔드와 독립 배포 가능하게)
- **신규 파일**: 없음(기존 파일에 라우트/섹션 추가).
- **DB Migration**: 없음.
- **API 변경**: `docs/api-design-v2.md` §6, §7.
- **테스트 방법**: `origin='snapshot'` 세션(이벤트 연결 없음)에 대해 빈 배열이 반환되는지, `origin='events'` 세션은 `sequence_order` 순으로 반환되는지 테스트.
- **완료 조건**: 세션 상세 화면에서 기존 요약(`SummaryPanel`, 무변경)과 새 타임라인 섹션이 함께 표시된다. 항목 클릭 시 페이지가 열린다.
- **예상 위험**: 프론트가 필드 부재를 견고하게 처리하지 않으면(옵셔널 체이닝 누락 등) 구버전 세션(이벤트 없음)에서 오류가 날 수 있음.

### M4-17. BE+EXT: Intent 검색

- **목적**: "탭 검색"을 "탐색 기억 검색"으로 확장한다.
- **변경 파일**: `backend/app/api/search.py`(`scope` 파라미터 추가, `scope=memory` 분기), `backend/app/api/events.py`(`DELETE /events/{id}` 추가), `backend/app/api/sessions.py`(`retry-summary`의 origin 분기 — `session_updater.refresh_session_ai` 연결), `extension/lib/api.ts`(`searchSessions`가 memory 응답 형식도 처리하도록 확장), `extension/entrypoints/sidepanel/views/SearchView.tsx`(결과를 "세션/관련 기록" 두 그룹으로 렌더)
- **DB Migration**: 없음.
- **API 변경**: `docs/api-design-v2.md` §8, §10, §11(retry-summary origin 분기).
- **테스트 방법**: `scope` 생략 시 기존 `list[SessionDetail]` 응답이 그대로 반환되는지(하위 호환 회귀 테스트) 필수 확인. `scope=memory` 응답의 `events` 배열이 `session_relevance`/`text_match` 두 출처를 모두 포함하는지 테스트. 검색→복원 E2E 수동 확인(계획서 검증 절).
- **완료 조건**: 기존 `GET /search` 클라이언트 동작 무변화 + 신규 memory 검색이 세션과 이벤트를 함께 반환.
- **예상 위험**: `scope` 파라미터 처리 로직이 기존 로직과 뒤섞이면 하위 호환이 깨질 수 있음 — 분기 초입에서 조기 분리하는 구조 권장.

## M5 — Analytics · 평가 · 마무리 (P3)

### M5-18. BE: Analytics + EXT/FE 노출

- **목적**: 순수 집계 기반 Exploration Analytics를 제공한다(AI 호출 없음).
- **신규 파일**: `backend/app/api/analytics.py`, `frontend/src/components/analytics/{TopicTimeBar,DomainTopList,DailyTrend,RepeatVisits}.tsx`(CSS 막대, 차트 라이브러리 미도입)
- **변경 파일**: `extension/entrypoints/sidepanel/views/TimelineView.tsx`(하단 요약 카드), `frontend/src/views/HomeView.tsx`(Analytics 섹션 추가), `frontend/src/lib/api.ts`(analytics fetch 함수 추가), `extension/lib/api.ts`(analytics fetch 함수 추가)
- **DB Migration**: 없음(집계 쿼리만, 스키마 변경 없음).
- **API 변경**: `docs/api-design-v2.md` §9 — `GET /analytics/overview?days=N`.
- **테스트 방법**: 각 집계(세션별 탐색 시간 top5, 최다 방문 도메인 top5, 반복 방문 2회+, 반복 검색어, 일별 추이)에 대한 쿼리 단위 테스트.
- **완료 조건**: 사이드패널과 웹 대시보드 양쪽에서 동일한 집계 데이터를 CSS 막대로 시각화.
- **예상 위험**: 고급 추천/행동 교정 기능을 이 태스크 범위에 포함시키지 않도록 주의(제외 확정 항목).

### M5-19. 평가: 골든셋 + `run_eval.py`

- **목적**: `docs/evaluation-plan.md`에서 정의한 지표를 실제로 계산 가능하게 한다.
- **신규 파일**: `backend/eval/golden/*.json`(10~30개), `backend/eval/run_eval.py`
- **변경 파일**: 없음.
- **DB Migration**: 없음.
- **API 변경**: 없음(오프라인 스크립트).
- **테스트 방법**: `docs/evaluation-plan.md` §5의 6개 지표가 실제로 계산되어 리포트에 출력되는지 확인. 기록 재생 모드가 실 LLM 모드와 동일한 지표를 재현하는지 확인(결정론적 회귀).
- **완료 조건**: 골든셋 평가 실행 가능(계획서 완료 조건 항목).
- **예상 위험**: 골든셋 작성이 팀원 수작업이라 일정 지연 위험 — 최소 1개 시나리오(RTX 5070 예시)라도 먼저 확보해 스크립트 개발과 병행 진행.

### M5-20. E2E 스모크 + 문서 최종 정합

- **목적**: 전체 파이프라인이 실제로 동작함을 확인하고, 문서를 실제 구현과 일치시킨다.
- **변경 파일**: `README.md`, `ppt.md`(HDBSCAN/Structured Output 서술 정정 — 실제로는 Solar Mini LLM 클러스터링, JSON 지시+파싱+검증+fallback 구조), `docs/WorkLog.md`
- **DB Migration**: 없음.
- **API 변경**: 없음.
- **테스트 방법**: 계획서 검증 절의 E2E 시나리오 전체 실행 — docker compose 기동 → 수집 활성화 → 5개 사이트 순차 방문(RTX 5070 검색→리뷰→가격 비교→커뮤니티) → 수동 동기화 → 1개 세션 자동 생성 확인 → Timeline에서 흐름 확인 → "그래픽카드 알아본 거" Intent 검색 → 복원 → Analytics 카드 확인. 기존 기능(탭 스냅샷 저장·검색·복원) 무파손 확인.
- **완료 조건**: 계획서 §16 핵심 성공 기준 8개(`docs/product-direction-v2.md` §8) 전부 충족, MVP 12개 항목 완료, `WorkLog.md`/`DecisionLog.md` 갱신.
- **예상 위험**: 마지막 단계에서 문서-코드 불일치가 발견되면 범위가 다시 벌어질 수 있음 — M0에서 고정한 문서를 기준으로 "계획과 다르게 구현된 부분"만 갱신하고 새 설계를 추가하지 않는다.

## §14 Phase 4 — 11단계와 마일스톤 매핑

계획서 §14가 정의한 Auto Session 파이프라인의 11단계가 실제로 어느 마일스톤에서 구현되는지 매핑한다.

| # | 단계 | 매핑 마일스톤 |
|---|---|---|
| ① | schema/queue (스키마·큐) | M1, M2 |
| ② | collector (수집기) | M2 |
| ③ | ingestion (인제스트) | M1 |
| ④ | trigger (동기화 트리거) | M2, M3 |
| ⑤ | preprocessing (전처리 — 그룹화 등) | M3 |
| ⑥ | sessionization (세션화 — 의도 분석) | M3 |
| ⑦ | session update (세션 갱신) | M3 |
| ⑧ | Timeline UI | M4 |
| ⑨ | retrieval/restore (검색/복원) | M4 |
| ⑩ | analytics | M5 |
| ⑪ | 평가 | M5 |

같은 마일스톤 번호가 여러 단계에 걸쳐 있는 경우(예: M2가 ①·②·④), 실제 태스크 번호는 위 M1~M5 절의 세부 태스크(M1-1~M5-20)를 참고한다.

## H — Session 기반 → Memory 중심 단계적 확장 (P4·P5 로드맵, MVP 미구현)

계획서 H를 구현 로드맵 관점에서 정리한다. 아래 Stage는 이번 `feat/auto-session` 브랜치·MVP 범위에 포함되지 않으며, 대회 이후 별도 계획으로 착수한다.

| 단계 | 시점 | 데이터 모델 영향 | 구현 방향 |
|---|---|---|---|
| Stage 1(이번 MVP) | M1~M5 | `exploration_events`가 Memory 원자 단위, `source`/`event_type` 필드로 확장 지점 확보(`docs/data-model-v2.md` §7) | 브라우저 방문 + 열린 탭까지 |
| Stage 2 | 대회 후 | 스키마 변경 없음 — `source='bookmark'\|'pdf'\|'github'` 값만 추가 | 소스 어댑터를 같은 `POST /events`로 인제스트. `event_filter.py`에 소스별 정규화 로직 추가. 파이프라인(`grouper`/`intent_analyzer`/`session_updater`)·검색·Timeline은 무변경으로 새 소스를 흡수(설계상 이미 소스 불문으로 만들어져 있어야 함 — Stage 1 구현 시 이 전제를 깨지 않도록 주의) |
| Stage 3 (P5) | 대회 후 | `source='chatgpt'`, `content_excerpt`에 질문/응답 요약 | ChatGPT/Gemini 대화를 이벤트로 흡수 — 대화와 방문이 한 세션 Timeline에 병렬 표시. 검색 Recall 측정 결과에 따라 이벤트 단위 임베딩 도입 여부 재검토 |
| Stage 4 (P4) | 대회 후 | `user_id`가 이미 전 테이블에 존재 — 데이터 모델 변경 불필요 | 인증 + 권한 계층 추가만으로 Team Workspace 구현. 세션 단위 read-only 공유부터 시작 |

이 확장 로드맵이 Stage 1 구현에 요구하는 유일한 제약은 "새 소스가 추가될 때 스키마 변경이 필요 없어야 한다"는 것이다 — M1-1에서 `source`/`event_type`을 문자열 컬럼으로 열어 둔 이유가 여기에 있다(`docs/data-model-v2.md` §7).
