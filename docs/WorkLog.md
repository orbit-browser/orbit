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
