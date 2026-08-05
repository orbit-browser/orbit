# Orbit 방향 재정의 — Personal Exploration Memory

> 근거 문서: `C:\Users\User\.claude\plans\orbit-serialized-sonnet.md` (승인된 전체 계획, 이하 "계획서")
> 이 문서는 계획서의 Context, A, H, §15~16 내용을 제품 방향 문서 형식으로 정리한 것이다. 계획서에 없는 신규 설계 결정은 포함하지 않는다.

## 1. 해결하는 문제

사용자가 웹에서 탐색한 정보와 사고의 흐름(Context)은 시간이 지나면 사라진다. 지금까지 Orbit은 "열린 탭 스냅샷을 AI가 분류·요약"하는 도구였지만, 탭은 그 흐름을 구성하는 데이터 중 하나일 뿐이다. 실제로 사라지는 것은:

- 어떤 순서로, 어떤 페이지를 거쳐 지금의 결론에 도달했는지(탐색 경로)
- 그 탐색이 왜 필요했는지(의도/목적)
- 저장하지 않고 그냥 닫아버린 탭들(수동 저장 시점 이전의 탐색)

기존 제품은 사용자가 "지금 저장하자"고 명시적으로 판단한 순간의 탭 목록만 남긴다. 그 판단을 하지 않은 탐색, 또는 이미 닫아버린 뒤에야 필요성을 깨닫는 탐색은 어디에도 기록되지 않는다.

## 2. 제품 재정의: Personal Exploration Memory (AI Exploration OS)

Orbit을 **Personal Exploration Memory**로 재정의한다. 웹 탐색과 사고의 흐름을 사용자 대신 상시 기억하고, 나중에 그 흐름을 그대로 되짚어 볼 수 있게 하는 개인용 AI Exploration OS다.

### 핵심 철학

지금까지 탐색의 흔적은 브라우저 History(URL 목록), 채팅 기록(ChatGPT/Claude 대화), 북마크, 메모 앱에 파편화되어 저장된다. 각각은 "그때 무엇을 했는지"의 단편만 보여줄 뿐, "왜 그것을 했는지"와 "그 결과 무엇에 도달했는지"를 이어주지 못한다.

Personal Exploration Memory는 이 파편들을 하나의 **탐색 궤도(Exploration Orbit)** 로 통합한다. 이벤트(방문·체류)를 원자 단위로 상시 기록하고, AI가 그 위에서 의미 있는 세션(작업 단위)을 자동으로 구성한다. 세션은 사용자가 수동으로 만드는 것이 아니라, 이벤트가 쌓이면서 스스로 자라난다(Auto Session).

핵심 원칙: **방문 이벤트마다 LLM을 호출하지 않는다.** 이벤트는 실시간으로 로컬 큐에 저장하고, 동기화 트리거(수동/주기/개수/유휴) 시점에만 배치로 분석해 세션을 생성·갱신한다.

이 전환은 리라이트가 아니다 — 기존 요약(`generate_summary`), 임베딩 검색(Qdrant), 세션 복원, 민감 도메인 필터를 최대한 그대로 재사용한다. 자세한 재사용/변경 범위는 `docs/current-state-audit.md`를 참고한다.

## 3. 새 핵심 기능 5개

| # | 기능 | 정의 | 계획서 위치 | MVP 범위 |
|---|---|---|---|---|
| 1 | Exploration Timeline | 사이드패널 홈을 세션 카드 목록에서 시간 역순 이벤트 스트림으로 재편. 세션은 타임라인 안의 배지(그룹)로 표시 | C-1 | ✅ P2 |
| 2 | Auto Session | 이벤트 수집 → 배치 세션화. 세션은 사용자가 만드는 게 아니라 이벤트가 쌓이며 자동으로 생성·갱신됨 | B | ✅ P1 |
| 3 | Personal Memory | 원본 이벤트(사실)와 AI 해석(세션)을 분리해 저장하는 Memory 계층. 소스 확장(북마크/대화 등)의 기반 | H (단계적 확장) | 부분(Stage 1 — 방문 이벤트 + 열린 탭까지) |
| 4 | Search by Intent | "탭 검색"이 아니라 "탐색 기억 검색" — 세션과 개별 방문 기록을 함께 반환하는 통합 검색 | D-1 | ✅ P2 |
| 5 | Exploration Analytics | 주제별 탐색 시간, 자주 보는 사이트, 반복 검색/방문, 일별 탐색량 추이 등 집계 | D-2 + C-3 | ✅ 최소(P3) |

## 4. 우선순위 (P1~P5)

**P1 → P2 → P3 → P4 → P5** 순서로 진행하며, P4·P5는 이번 MVP에는 구현하지 않고 로드맵으로만 문서화한다(§6 참고).

| 우선순위 | 내용 |
|---|---|
| P1 | History/방문 이벤트 수집 + 자동 세션 갱신(Auto Session 코어) |
| P2 | Timeline UI + 저장 구조(Memory Store) + Intent 검색 |
| P3 | Dashboard/Exploration Analytics |
| P4 | Team Workspace(로드맵만 — MVP 제외) |
| P5 | ChatGPT/Gemini 연동(로드맵만 — MVP 제외) |

## 5. MVP 범위와 제외 목록

### 5.1 MVP 12개 항목

계획서 완료 조건(§16 대응)이 요구하는 "MVP 12개 항목"을 계획서 B~F의 구현 단위로 정리하면 다음과 같다. (계획서에 번호가 매겨져 있지는 않으며, 완료 조건에 명시된 항목 수에 맞춰 이 문서가 계획서 B/C/D/E/F 내용을 12개 단위로 구조화한 것이다.)

1. webNavigation 기반 방문 이벤트 수집(`collector.ts`) — 시스템 URL/리다이렉트/opt-in 필터 포함
2. 로컬 영속 큐(IndexedDB + `idb`) — 이벤트 상태 기계(open→pending→syncing→synced), SW 종료·재시작 생존
3. 동기화 엔진(`sync/engine.ts`) — 4개 트리거(수동/주기/개수/유휴) 수렴, 백오프, 멱등 전송
4. 인제스트 API(`POST /events`) — 시스템 URL 거부, 민감 본문 제거, URL 정규화, 검색어 추출
5. 배치 세션화 파이프라인(`sync_pipeline.py`) — 그룹화 → 후보 검색 → LLM 의도 분석 → 세션 갱신
6. Auto Session 코어(`session_updater.py`) — 세션 생성/갱신, `session_events`, `session_versions`, tabs JSONB 동기화
7. Exploration Timeline UI(사이드패널 홈) — `SyncStatusCard`, `TimelineDateHeader`, `TimelineItem`, `SessionBadge`
8. 세션 상세 타임라인(`GET /sessions/{id}/events`, `GET /sessions/{id}/versions`) — SessionDetailView 확장
9. Search by Intent(`GET /search?scope=memory`) — 세션 + 이벤트 통합 검색, SearchView 그룹 렌더
10. Exploration Analytics(`GET /analytics/overview`) — 사이드패널 요약 카드 + 웹 대시보드 Analytics 섹션
11. 개인정보 통제 — 수집 opt-in(기본 off), 이벤트/세션 삭제, 서버측 민감 도메인 이중 방어, 수집 상태 상시 표시
12. 평가 구조 — 골든셋(`backend/eval/golden/*.json`) + `run_eval.py` + 지표 리포트

### 5.2 MVP 제외 확인 (계획서 §15)

- ChatGPT/Gemini 연동 (P5 → H Stage 3)
- Team Workspace/세션 공유 (P4 → H Stage 4)
- 모바일 대응
- 예측 추천, 자동 북마크
- MCP, 멀티에이전트
- 세션 자동 병합(스키마만 예약 — `intent_analyzer`가 반환하는 assignment action에 `merge`를 위한 자리는 남기되 미구현)
- 동기화 설정 API(설정값은 익스텐션 로컬 + 백엔드 env로 관리)
- 이벤트 단위 임베딩(세션 임베딩+키워드로 충분한지 골든셋 측정 후 결정)
- 차트 라이브러리 도입(Analytics는 CSS 막대로 구현)
- LangSmith 연동(선택 — 자체 `sync_batches` 기록으로 대체)

## 6. 기존 문서와의 충돌 해소 근거

계획서 Context 조사에서 확인된 문서 충돌 3건과 해소 근거는 다음과 같다. 실제 문서 수정은 이 방향 문서 작업과 별도로 `Personas.md`/`UserScenarios.md`에 반영한다.

### 6.1 `Personas.md:34` "완전한 북마크/히스토리 대체 비목표"

기존 문구: "공통 비목표 사용자" 항목 중 "완전한 북마크/히스토리 대체를 원하는 사용자".

Personal Exploration Memory는 방문 이벤트를 상시 기록한다는 점에서 브라우저 History와 유사해 보이지만, 다음 지점에서 "완전한 히스토리 대체"와는 구분된다.

- 수집은 기본 off, opt-in 이후에만 이벤트가 쌓인다 — 브라우저 History처럼 항상 전체를 기록하지 않는다.
- 목표는 개별 URL의 전수 조회가 아니라 **의미 있는 탐색 단위(세션)로의 재구성**이다. 원본 이벤트 열람(Timeline)은 세션화의 재료이자 보조 화면이지, 브라우저 기본 History UI를 대체하는 범용 URL 검색 기능이 아니다.
- 오래된 이벤트를 무기한 보관하는 아카이브가 목표가 아니라, 현재 진행 중이거나 최근에 도달한 결론까지의 "탐색 흐름 복기"가 목표다.

따라서 `Personas.md`의 비목표 문구는 "브라우저 History를 그대로 대체하는 범용 URL 열람/검색 도구를 원하는 사용자"로 좁혀 수정하고, "탐색 흐름을 잃는 지식노동자" 관점(방문 이벤트가 쌓여 세션으로 재구성되길 원하는 사용자)을 페르소나에 반영한다.

### 6.2 최소 권한 원칙 vs 신규 권한(webNavigation)

기존 원칙: Extension은 필요한 최소 권한만 요청한다(현재 `tabs`/`storage`/`sidePanel`만 사용, `history`/`idle`/`alarms`/`webNavigation` 전무).

신규 방향은 방문 감지가 필수이므로 권한 확장이 불가피하다. 다만 아래 근거로 "최소 권한 원칙의 정신"은 유지된다.

- `history` 권한 대신 **`webNavigation`을 사용**한다. `chrome.history`는 과거 전체 방문 기록에 대한 조회 권한까지 포함해 사용자에게 더 무거운 신뢰를 요구하지만, `webNavigation`은 실시간 이벤트만 제공하고 Chrome의 설치 시 권한 경고 문구가 기존 `tabs` 권한과 **동일한 등급**이라 새로운 경고가 추가되지 않는다.
- `webNavigation.onCommitted`(frameId 0)를 방문 감지의 원천으로 쓰면 tabId/windowId/리다이렉트 판별이 이벤트에 포함되어, 상관관계 계산에 `onVisited`(history API)보다 유리하다.
- 과거 기록 백필처럼 정말 `chrome.history` 조회가 필요한 기능은 이번 MVP에 포함하지 않고, 추후 옵션으로만 검토한다(계획서 확정 사항).
- 수집 자체가 기본 off(opt-in)이므로, 권한이 부여되어도 사용자가 명시적으로 켜기 전까지는 어떤 이벤트도 수집되지 않는다 — 권한 존재와 실제 데이터 수집 범위를 분리한다.

`alarms`(주기 동기화)와 `idle`(유휴 감지) 권한도 이번 확장에 함께 추가되며, 매니페스트 변경은 M1 단계에서 가장 먼저 처리한다(§15).

### 6.3 `UserScenarios.md` 6개 시나리오 전부 "수동 저장" 시작

기존 6개 시나리오는 모두 사용자가 사이드패널에서 저장을 실행하는 시점부터 시작한다. 이 흐름 자체는 삭제하지 않는다 — "지금 열린 탭 스냅샷 저장"은 `CurrentSessionCard`/`POST /sessions/cluster` 경로로 그대로 존치되며, 전환기 데모의 안전 경로이자 기존 사용자 흐름을 깨지 않는 하위 호환 지점이다.

새 방향에서는 이 6개 시나리오에 **자동 수집 → 배치 세션화 → Timeline 확인 → Intent 검색** 시나리오를 추가하는 방식으로 `UserScenarios.md`를 갱신한다(기존 시나리오는 유지, 신규 시나리오 추가 — 대체 아님).

## 7. Personal Memory 확장 로드맵 (P4·P5, MVP 미구현)

계획서 H의 단계적 확장을 그대로 인용한다. 자세한 실행 계획은 `docs/implementation-roadmap.md` §H를 참고한다.

| 단계 | 시점 | 내용 |
|---|---|---|
| Stage 1 | 이번 MVP | `exploration_events`가 Memory의 원자 단위, 세션은 그 위의 AI 파생 뷰. `source`/`event_type` 필드를 미리 두어 확장 지점 확보. 브라우저 방문 + 열린 탭까지 |
| Stage 2 | 대회 후 | 소스 어댑터 — 북마크·PDF·GitHub 이벤트를 같은 `POST /events`로 인제스트(`source='bookmark'|'pdf'|'github'`). 파이프라인·검색·Timeline은 무변경으로 새 소스를 흡수 |
| Stage 3 (P5) | 대회 후 | ChatGPT/Gemini 대화를 이벤트로(`source='chatgpt'`) — 대화와 방문이 한 세션 Timeline에 병렬 표시. 이벤트 단위 임베딩 도입은 검색 Recall 측정 결과에 따라 검토 |
| Stage 4 (P4) | 대회 후 | Team Workspace/세션 공유 — `user_id`가 이미 전 테이블에 있어 인증+권한 계층만 추가하면 데이터 모델 변경 불필요. 세션 단위 read-only 공유부터 |

## 8. 핵심 성공 기준

계획서 완료 조건(§16 대응)의 E2E 성공 기준을 8개 항목으로 정리한다(계획서 원문은 화살표로 이어진 문장 — 아래는 그것을 항목화한 것).

1. 상시 수집 — 방문마다 LLM을 호출하지 않고 로컬 큐에 쌓인다
2. 안전 저장 — 이벤트가 서비스 워커 종료·재시작에도 유실되지 않는다
3. 배치 세션화 — 동기화 트리거 시 Auto Session이 세션을 자동 생성·갱신한다
4. Timeline으로 탐색 경로 이해 — 사용자가 "어떤 흐름으로 결론에 도달했는지" 확인할 수 있다
5. Intent 검색으로 과거 탐색 재발견 — 목적 중심 자연어 검색이 세션과 개별 방문 기록을 함께 반환한다
6. 복원으로 작업 재개 — 검색/타임라인에서 찾은 탭 묶음을 그대로 다시 연다
7. Analytics로 탐색 패턴 확인 — 주제별 탐색 시간, 반복 방문/검색 등을 대시보드에서 확인한다
8. 기존 기능 무파손 — 탭 스냅샷 저장·검색·복원 등 기존 동작이 이번 전환으로 깨지지 않는다

## 9. 핵심 메시지

> **"탭을 정리하는 것이 아니라, 탐색 흐름을 기억한다."**

Orbit은 더 이상 "열린 탭을 정리해주는 도구"가 아니라, 사용자가 무엇을 찾아 헤맸고 어떻게 지금에 도달했는지를 대신 기억해 주는 Personal Exploration Memory다.
