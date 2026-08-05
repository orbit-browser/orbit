# Orbit 작업 기록

작업, 오류, 원인, 해결 과정과 실제 검증 결과를 시간순으로 기록한다.

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
