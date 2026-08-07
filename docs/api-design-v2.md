# Orbit API 설계 v2 — Auto Session / Memory 엔드포인트

> 근거: 계획서 B-3, D-1, D-2, E. 기존 엔드포인트는 `docs/current-state-audit.md` §3에 정리되어 있다. 이 문서는 신규 엔드포인트 10개의 요청/응답 계약과, 기존 엔드포인트 호환 정책·오류 계약을 정의한다.
> 아래 JSON 예시는 계획서에 명시된 필드와 `docs/data-model-v2.md`의 테이블 정의로부터 도출한 설계안이다. 실제 Pydantic 스키마(`schemas/event.py`, `schemas/sync.py`)는 구현 단계(M1~M4)에서 이 계약을 기준으로 작성한다.

## 0. 공통 규칙

- 모든 신규 엔드포인트는 `user_id`를 요청/응답에 노출하지 않는다(인증 미도입 — 서버가 내부적으로 `'local'` 고정값을 사용). 인증 도입 시점에 헤더/토큰 기반으로 대체한다(MVP 범위 밖).
- 날짜/시간은 기존 `SessionDetail.created_at`과 동일하게 ISO 8601 문자열로 반환한다.
- 목록형 응답은 최신순(내림차순) 정렬을 기본으로 한다. `GET /sessions`의 정렬 키는
  `coalesce(last_activity_at, created_at)`이다 — append로 성장한 세션이 마지막 활동
  기준으로 위로 올라온다(2026-08-05 도그푸딩 피드백). `SessionDetail` 응답에
  `last_activity_at`(nullable, snapshot 세션은 null)이 포함되며 클라이언트 timeLabel도
  `last_activity_at ?? created_at`을 쓴다.
- `DELETE /sessions/{id}`는 자식 행(`session_events`, `session_versions`)을 함께
  삭제한다(FK에 ON DELETE 없음 — 애플리케이션 계층에서 정리).

## 1. `POST /events` — 배치 인제스트

이벤트 1~200개를 한 번에 전송한다(`sync/engine.ts`가 50개씩 나눠 보내지만, 서버는 최대 200개까지 허용).

**Request**

```json
{
  "events": [
    {
      "id": "b3f1c2a0-1111-4a2b-9c3d-000000000001",
      "source": "browser",
      "url": "https://www.google.com/search?q=rtx+5070+review",
      "title": "rtx 5070 review - Google 검색",
      "visited_at": "2026-08-03T05:12:00Z",
      "ended_at": "2026-08-03T05:14:30Z",
      "active_duration_ms": 150000,
      "tab_id": 481,
      "window_id": 1,
      "previous_event_id": null,
      "referrer_url": null,
      "event_type": "visit",
      "content_excerpt": null
    }
  ]
}
```

**Response `202 Accepted`**

```json
{
  "accepted": 1,
  "duplicates": 0,
  "filtered": 0,
  "pending_total": 37
}
```

- `filtered`: 시스템 URL/3초 미만 리다이렉트 등 인제스트 필터가 거부한 개수(§ target-architecture.md §6).
- `duplicates`: `id` 충돌로 `ON CONFLICT DO NOTHING` 처리된 개수(멱등 재전송 확인용).
- `normalized_url`/`domain`/`search_query`는 서버가 인제스트 시점에 계산하며 요청에는 포함하지 않는다.

## 2. `GET /events/pending-count`

```json
{ "pending": 37, "last_completed_sync_at": "2026-08-03T04:00:00Z" }
```

`last_completed_sync_at`은 `sync_batches`에서 `status='completed'`인 가장 최근 배치의 `completed_at`. 배치 이력이 없으면 `null`.

## 3. `GET /events?date=today`

Timeline 홈 화면용 — **서버에 이미 동기화된 이벤트만** 반환한다(미동기화분은 로컬 IndexedDB에서 직접 읽음). `date` 쿼리는 `today`만 우선 지원(추가 값 확인 필요 — 범위 지정 등은 MVP 이후 검토).

```json
[
  {
    "event_id": "b3f1c2a0-1111-4a2b-9c3d-000000000001",
    "url": "https://www.google.com/search?q=rtx+5070+review",
    "title": "rtx 5070 review - Google 검색",
    "domain": "google.com",
    "visited_at": "2026-08-03T05:12:00Z",
    "active_duration_ms": 150000,
    "session_id": "d290f1ee-6c54-4b01-90e6-d701748f0851",
    "session_title": "RTX 5070 구매 비교",
    "excluded": false
  }
]
```

`session_id`/`session_title`은 아직 세션에 배정되지 않은 이벤트에서는 `null`(Timeline이 "분류 대기"로 표시).
`excluded=true`는 노이즈 사전 필터/LLM이 세션 대상에서 제외한 스침 방문(`sync_status='discarded'`)으로, 삭제하지 않고 Timeline에 "제외됨" 뱃지로 계속 노출한다(2026-08-05). discarded 이벤트도 이 응답에 포함된다.

## 4. `POST /sync`

```json
{ "trigger_type": "manual" }
```

`trigger_type ∈ {manual, periodic, event_count, idle}`.

| 상황 | 응답 |
|---|---|
| 정상 접수 | `202 Accepted` — `{"batch_id": "..."}` |
| 이미 실행 중인 배치 존재 | `409 Conflict` — `{"detail": "Sync batch already running"}` |
| `pending` 이벤트 없음 | `200 OK` — `{"status": "no_pending"}` |

## 5. `GET /sync/status`

익스텐션이 배치 진행 상황을 단일 폴링으로 확인하는 엔드포인트.

```json
{
  "running": true,
  "current_batch": {
    "batch_id": "b2f...",
    "trigger_type": "manual",
    "started_at": "2026-08-03T05:20:00Z",
    "event_count": 42
  },
  "pending": 12,
  "last_batch": {
    "batch_id": "a1e...",
    "status": "completed",
    "completed_at": "2026-08-03T04:00:00Z",
    "event_count": 55
  }
}
```

`current_batch`는 실행 중인 배치가 없으면 `null`.

## 6. `GET /sessions/{id}/events` — Session Timeline

`session_events.sequence_order` 순으로 반환한다.

```json
[
  {
    "event_id": "b3f1c2a0-1111-4a2b-9c3d-000000000001",
    "url": "https://www.google.com/search?q=rtx+5070+review",
    "title": "rtx 5070 review - Google 검색",
    "domain": "google.com",
    "visited_at": "2026-08-03T05:12:00Z",
    "active_duration_ms": 150000,
    "relevance_score": 0.82,
    "sequence_order": 0
  }
]
```

세션이 존재하지 않으면 기존 `GET /sessions/{id}`와 동일하게 `404`. `origin='snapshot'` 세션(이벤트 연결이 없는 세션)은 빈 배열 `[]`을 반환한다(오류 아님).

## 7. `GET /sessions/{id}/versions`

```json
[
  {
    "version": 2,
    "title": "RTX 5070 구매 비교",
    "overview": "RTX 5070 리뷰와 가격을 비교해 구매를 결정하는 탐색입니다.",
    "purpose": "그래픽카드 구매 의사결정",
    "highlights": ["리뷰 3건 비교", "커뮤니티 반응 확인"],
    "todos": ["최저가 재확인"],
    "next_actions": ["쇼핑몰에서 결제"],
    "model": "A.X-K1",
    "created_at": "2026-08-03T05:30:00Z"
  },
  {
    "version": 1,
    "title": "그래픽카드 알아보기",
    "overview": "RTX 5070을 검색해 리뷰를 찾아보는 중입니다.",
    "purpose": "",
    "highlights": [],
    "todos": [],
    "next_actions": [],
    "model": "A.X-K1",
    "created_at": "2026-08-03T05:14:00Z"
  }
]
```

버전 내림차순(최신 먼저) 정렬. `prompt_version`은 내부 감사용 필드로 이 응답에는 노출하지 않는다(확인 필요 — 디버그 모드 노출 여부는 구현 단계 결정).

## 8. `GET /search?scope=memory` — Search by Intent

`scope` 기본값은 `sessions`이며, 이때는 **기존 `GET /search` 응답 형식을 그대로 유지**한다(하위 호환 — 구 클라이언트는 이 엔드포인트가 바뀐 것을 알 필요가 없다).

`scope=memory`일 때만 새 응답 형식을 반환한다.

**Request**: `GET /search?q=일본%20여행%20준비했던%20거&scope=memory&limit=5`

**Response (`scope=memory`)**

```json
{
  "sessions": [
    {
      "session_id": "d290f1ee-6c54-4b01-90e6-d701748f0851",
      "title": "일본 도쿄 여행 준비",
      "summary": { "overview": "...", "purpose": "...", "highlights": [], "todos": [], "next_actions": [] },
      "summary_status": "done",
      "tabs": [],
      "created_at": "2026-07-20T10:00:00Z",
      "updated_at": "2026-07-25T09:00:00Z"
    }
  ],
  "events": [
    {
      "event_id": "c1a2...",
      "url": "https://www.skyscanner.co.kr/...",
      "title": "도쿄 항공권 비교",
      "domain": "skyscanner.co.kr",
      "visited_at": "2026-07-20T10:05:00Z",
      "session_id": "d290f1ee-6c54-4b01-90e6-d701748f0851",
      "relevance_score": 0.74,
      "match_reason": "session_relevance"
    },
    {
      "event_id": "c1a3...",
      "url": "https://search.naver.com/search.naver?query=도쿄+여행",
      "title": "도쿄 여행 - 네이버 검색",
      "domain": "search.naver.com",
      "visited_at": "2026-07-19T21:00:00Z",
      "session_id": null,
      "relevance_score": null,
      "match_reason": "text_match"
    }
  ]
}
```

- `sessions` 배열: 기존 Qdrant 벡터 검색 + 선택적 리랭크(무변경 재사용, `rerank` 쿼리 파라미터도 그대로 유효).
- `events` 배열은 두 출처를 합친 것이다: ① 매칭된 세션의 `session_events` 상위(relevance×duration) — `match_reason: "session_relevance"`, ② `title`/`search_query`/`domain` ILIKE 직접 매칭 — `match_reason: "text_match"`(세션에 배정되지 않은 이벤트까지 커버).
- 이벤트 벡터는 영구 저장하지 않는다. Ask 답변 생성에서는 선택된 세션의 이벤트 후보를 요청 시점에
  `embedding-passage` batch로 계산해 현재 질문과 가까운 페이지를 고른다.

### 8.1 `POST /ask/stream` — 탐색 기록 기반 스트리밍 답변

새 탭과 사이드패널의 Ask AI가 사용하는 SSE 엔드포인트다. `EventSource`가 아닌 POST
`fetch` 스트림이다. 각 요청은 이전 질문·답변을 받거나 저장하지 않는 독립 단일턴이다.

**Request**

```json
{
  "query": "지난주 보험 비교 기록에서 가격이 가장 낮았던 선택지는?",
  "session_id": null,
  "rerank": true,
  "intent": "search_memory"
}
```

- `query`: 공백 제외 1~2,000자.
- `session_id`: 지정하면 해당 세션만 근거로 사용한다. 생략하면 기존 벡터 검색으로 최대 3개를 찾는다.
- `rerank`: 검색 후보의 LLM 재정렬 여부. 기본 `true`.
- `intent`: `find_sessions`, `search_memory`, `search_session` 중 하나. 기본은 하위 호환을 위한
  `search_memory`다. `find_sessions`는 최대 5개 세션을 반환하고 답변 LLM을 호출하지 않으며,
  `search_session`은 지정 세션 또는 가장 가까운 세션 1개만 사용한다.

클라이언트는 여러 질문과 답변을 UI에 누적 표시할 수 있지만, 그 목록은 다음 요청 본문에 포함하지 않는다.

**Response (`text/event-stream`)**

```text
event: sources
data: {"sessions":[{...SessionDetail...}]}

event: delta
data: {"text":"가장 낮은 "}

event: delta
data: {"text":"선택지는 A사였습니다 [1]."}

event: done
data: {"model":"A.X-K1"}
```

이벤트 순서는 `sources` → `delta` 0개 이상 → `done` 또는 `error`다. 오류 이벤트는
`{"code":"stream_interrupted|generation_failed","partial":true|false,"retryable":true}` 형식이다.
검색/DB 오류처럼 스트림 시작 전 실패는 기존 HTTP 오류 계약을 따른다.

답변 컨텍스트는 관련 세션 최대 3개의 요약과 세션별 질문 관련 이벤트 최대 4개의
`content_excerpt`로 제한한다. 세션별 기존 relevance 상위 12개를 후보로 제한한 뒤 질문에는
`embedding-query`, 이벤트 passage에는 `embedding-passage`를 사용한다. 임베딩 장애 시에는 기존
relevance×체류 시간 순위로 fallback한다. 미할당 이벤트는 포함하지 않으며, 페이지 본문 안의 지시문은
신뢰하지 않는 데이터로 취급한다. 답변은 근거 세션을 `[1]`, `[2]`처럼 표시한다.

모델은 A.X-K1 스트리밍을 우선 사용한다. 첫 토큰 전에 연결·rate limit·지원 상태 오류가 나면
EXAONE으로 폴백하고, 일부 토큰을 보낸 뒤 끊기면 다른 모델을 이어 붙이지 않고
`stream_interrupted`를 보낸다.

### 8.2 `POST /assistant/route` — Ask AI 통합 의도 판별

명시적인 로컬 탭 매칭에 실패한 모든 Ask 입력을 다음 네 의도 중 하나로 분류한다.

```json
{"query":"리액트 공부했던 세션 찾아줘","session_id":null}
```

```json
{
  "intent":"find_sessions",
  "confidence":1.0,
  "margin":1.0,
  "reason":"rule"
}
```

- 의도: `navigate_tab`, `find_sessions`, `search_memory`, `search_session`.
- 명확한 결과 형태는 규칙으로 먼저 구분하고 나머지는 query/passage prototype 임베딩으로 판별한다.
- retrieval 상위 의도의 격차가 작으면 `search_memory`로 fallback한다.
- `navigate_tab`은 별도 score/margin을 통과해도 아래 탭 후보 resolver를 추가로 통과해야 실행된다.
- `reason`은 `rule`, `semantic`, `fallback` 중 하나다. 요청·벡터는 저장하지 않는다.

### 8.3 `POST /tab-actions/resolve` — 열린 탭 자연어 의미 매칭

통합 라우터가 `navigate_tab`을 반환했거나 명시적 이동 문장의 로컬 매칭이 실패했을 때 호출하는
비저장 resolver다. 열린 탭 후보는
요청 처리 중 임베딩에만 사용하며 PostgreSQL·Qdrant·로그에 저장하지 않는다.

```json
{
  "query": "아까 보던 영상으로 돌아가자",
  "candidates": [
    {
      "id": "42",
      "title": "Building a Chrome Extension with React - YouTube",
      "url": "https://www.youtube.com/watch?v=orbit-demo",
      "active": false
    }
  ]
}
```

- `query`: 공백 제외 1~500자.
- `candidates`: 1~100개. 시크릿 탭은 extension 조회 단계에서 제외한다.
- 후보 passage는 제목·호스트·URL path와 알려진 사이트의 일반 용도로 구성한다.
  query string과 fragment는 임베딩 텍스트에서 제외한다.
- query에는 `embedding-query`, 의도 prototype과 후보에는 `embedding-passage`를 사용한다.
- 탭 이동 의도 점수·다른 의도와의 격차, 후보 top-1 점수·top-2 격차를 모두 통과해야 한다.

```json
{
  "action": "navigate_tab",
  "reason": "matched",
  "tab_id": "42",
  "score": 0.397971,
  "margin": 0.212456
}
```

`reason`은 `matched`, `non_navigation`, `low_confidence` 중 하나다. 자동 이동이 안전하지 않으면
`action="ask"`, `tab_id=null`을 반환한다. extension은 응답 ID가 현재 탭 목록에 여전히 있는지
검증한 뒤에만 창 포커스와 탭 활성화를 실행한다.

후보 top-1 점수는 기준을 통과했지만 top-2 격차가 작으면 `low_confidence` 응답에 가까운 후보를
최대 3개 포함한다. 절대 점수 기준을 통과하지 못한 경우에는 관련 없는 탭 노출을 막기 위해 빈 배열이다.

```json
{
  "action":"ask",
  "reason":"low_confidence",
  "tab_id":null,
  "score":0.41,
  "margin":0.01,
  "candidates":[
    {"tab_id":"43","score":0.41},
    {"tab_id":"42","score":0.40}
  ]
}
```

## 9. `GET /analytics/overview?days=7`

집계 쿼리만 수행하며 AI 호출이 없다.

```json
{
  "period_days": 7,
  "top_sessions_by_duration": [
    { "session_id": "d290f1ee-...", "title": "AI 공부", "total_active_duration_ms": 28800000 },
    { "session_id": "a1b2c3...", "title": "여행 준비", "total_active_duration_ms": 10800000 }
  ],
  "top_domains": [
    { "domain": "github.com", "visit_count": 42 },
    { "domain": "google.com", "visit_count": 31 }
  ],
  "repeat_visits": [
    { "normalized_url": "https://docs.python.org/3/...", "title": "Python 공식 문서", "visit_count": 5 }
  ],
  "repeat_search_queries": [
    { "search_query": "rtx 5070 가격", "count": 4 }
  ],
  "daily_trend": [
    { "date": "2026-07-28", "event_count": 55, "total_active_duration_ms": 7200000 },
    { "date": "2026-07-29", "event_count": 40, "total_active_duration_ms": 5400000 }
  ]
}
```

각 배열의 상위 개수(top 5 등)와 `repeat_visits`/`repeat_search_queries`의 최소 반복 횟수(2회+) 기준은 계획서 D-2 그대로 따른다. 고급 추천/행동 교정 지표는 포함하지 않는다(제외 확정).

## 10. `DELETE /events/{id}`

개인정보 통제 목적 — 서버에 이미 저장된 이벤트를 개별 삭제한다.

- 성공: `204 No Content` (기존 `DELETE /sessions/{id}`와 동일한 관례).
- 존재하지 않는 이벤트: `404 Not Found`.
- `session_events` 연쇄 정리: 해당 이벤트가 어떤 세션에 배정돼 있었다면 `session_events` 행도 함께 삭제한다. 세션 자체(및 이미 반영된 요약)는 재계산하지 않는다 — 다음 배치가 세션을 다시 다룰 때만 자연 반영된다(즉시 재요약은 MVP 범위 밖).

## 11. 기존 엔드포인트 호환 정책

| 정책 | 내용 |
|---|---|
| `SessionDetail`은 superset | `docs/data-model-v2.md` §4의 신규 컬럼(`origin`, `status`, `event_count`, `keywords` 등)은 `SessionDetail`에 **선택적(optional) 필드**로만 추가한다. 기존 필드는 이름·타입·의미를 바꾸지 않는다 — Extension은 새 필드를 무시하면 그대로 동작한다. |
| `POST /sessions/cluster` 존치 | "지금 열린 탭 스냅샷 저장" 기능으로 그대로 유지한다(`CurrentSessionCard` 경로, `origin='snapshot'`으로 저장). Auto Session이 새 기본 경로가 되어도 이 엔드포인트를 제거하거나 시맨틱을 바꾸지 않는다. |
| `retry-summary`는 origin 분기 | `POST /sessions/{id}/retry-summary`는 세션의 `origin`에 따라 다른 함수를 호출한다: `origin='snapshot'`이면 기존 `_ai_update`(탭 목록 기반 재요약) 그대로 사용, `origin='events'`이면 신규 `refresh_session_ai`(연결된 `session_events`를 다시 모아 재요약)를 호출한다. 응답 스키마(`SessionDetail`)는 동일하다. |
| `GET /search` 기본값 유지 | `scope` 파라미터 생략 시 `scope=sessions`로 취급 — 기존 응답 형식(`list[SessionDetail]`)이 그대로 반환된다. |
| 설정 범위 분리 | 동기화 주기/유휴 기준 등은 extension 로컬(chrome.storage)에서 관리한다. 자동병합 opt-in 상태만 `GET/PATCH /settings`로 서버에 저장한다. |

## 12. 오류 계약

기존 컨벤션(`api/search.py:20-65`)을 그대로 확장한다 — 외부 서비스 장애를 원인별로 구분해 응답한다.

| 상태 코드 | 의미 | 기존 적용 사례 | 신규 엔드포인트 적용 |
|---|---|---|---|
| `502` | 업스트림이 오류 응답을 반환했거나, 응답 형식이 예상과 다름 | 임베딩 서비스 `HTTPStatusError`, 응답 파싱 오류(`KeyError`/`IndexError`/`TypeError`/`ValueError`) | 배치 파이프라인의 의도 분석 LLM 호출이 형식 오류를 반환하는 경우(단, 배치는 비동기 실행이라 HTTP로 직접 노출되지 않고 `sync_batches.error_message`에 기록됨 — HTTP 502는 `POST /sync`가 즉시 검증 가능한 범위에서만 발생) |
| `503` | 연결 자체가 실패(서비스 다운) | 임베딩 서비스 `RequestError`, Qdrant 검색 실패 | `GET /search?scope=memory`가 Qdrant/임베딩 실패 시 동일하게 503 |
| `504` | 타임아웃 | 임베딩 서비스 `TimeoutException` | 신규 엔드포인트 중 외부 LLM/임베딩을 동기 호출하는 경로(`GET /search?scope=memory`)에 동일 적용 |
| `409` | 상태 충돌 | (신규) | `POST /sync`가 이미 실행 중인 배치와 충돌할 때 |
| `404` | 리소스 없음 | 세션 조회/삭제 | `GET/DELETE /events/{id}`, `GET /sessions/{id}/events`(세션 자체가 없을 때) |

배치 파이프라인(`POST /sync` 이후의 비동기 처리)의 실패는 HTTP 응답 코드가 아니라 `sync_batches.status='failed'` + `error_message`로 기록되고, `GET /sync/status`를 통해 클라이언트가 조회한다 — 계획서의 "실패 시 pending 복귀, 다음 배치가 재시도" 정책과 일치시키기 위해 동기 오류 응답 대신 상태 조회 방식을 쓴다.
