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
- 길이 초과는 422로 거르지 않고 잘라서 받는다. 확장은 실패한 배치를 통째로 재시도하므로, 이벤트 하나 때문에 큐 전체가 막히지 않게 하려는 것이다. 상한은 `content_excerpt` 16,000자(확장 `MAX_CONTENT_EXCERPT_LENGTH`와 같음), `title` 500자, `url`·`referrer_url` 32,768자, `event_type`·`source` 20자, `device_id` 64자, `previous_event_id` 36자다(뒤의 넷은 DB 열 너비).

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
    "model": "A.X-K2",
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
    "model": "A.X-K2",
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
`fetch` 스트림이다. 후속 질문을 위해 최근 대화(`history`)를 요청에 함께 받을 수 있지만 서버는 저장하지 않는다.

**Request**

```json
{
  "query": "지난주 보험 비교 기록에서 가격이 가장 낮았던 선택지는?",
  "session_id": null,
  "rerank": true,
  "intent": "search_memory",
  "workspace_id": null,
  "history": [
    {"query": "보험 비교한 거 정리해줘", "answer": "A사, B사, C사를 비교했어요 [1].", "source_session_ids": ["s1"]}
  ]
}
```

- `query`: 공백 제외 1~2,000자.
- `session_id`: 지정하면 해당 세션만 근거로 사용한다. 생략하면 벡터 검색으로 후보를 찾고 본문 근거로 최대 3개를 고른다.
- `rerank`: 검색 후보의 LLM 재정렬 여부. 기본 `true`. `find_sessions`·`search_session`에만 적용한다.
  `search_memory`는 본문 근거 점수로 출처를 다시 고르므로 LLM 재정렬을 쓰지 않는다.
- `intent`: `find_sessions`, `search_memory`, `search_session` 중 하나. 기본은 하위 호환을 위한
  `search_memory`다. `find_sessions`는 최대 5개 세션을 반환하고 답변 LLM을 호출하지 않으며,
  `search_session`은 지정 세션 또는 가장 가까운 세션 1개만 사용한다.
- `workspace_id`: 팀 워크스페이스 id(§14). 주면 그 팀에 공유된 세션만 근거로 쓰고, `session_id`도
  그 팀에 공유된 세션이어야 한다. 멤버가 아니면 `404`.

- `history`: 선택, 오래된 순 최대 3턴. 각 턴은 `query`(1~2,000자), `answer`(4,000자 초과분은 서버가 자름),
  `source_session_ids`(최대 5개). 비우거나 생략하면 기존과 같은 독립 단일턴이다. 클라이언트는 답변이 끝난
  Ask 턴만 보낸다(탭 이동 결과·오류 턴 제외).

`history`가 있으면 서버는 LLM으로 마지막 질문을 단독 검색 질문으로 바꿔("그럼 9070은?" → "RX 9070 최저가는?")
벡터 검색과 본문 조각 점수에 쓴다. 실패하면 직전 질문과 이어 붙인 문장으로 검색한다. 직전 턴의
`source_session_ids`는 지금 읽을 수 있는 활성 세션(개인은 요청자 소유, 팀은 그 팀의 현재 공유 세션)만 불러와 새 검색 후보 뒤에 두고, 최종 출처는 같은 근거 점수 규칙으로 고른다.
답변 프롬프트에는 원래 질문과 이전 대화(근거 번호 제거, 답변 600자)를 "지시어 해석용"으로만 넣으며,
재작성한 검색 질문은 넣지 않는다.

**Response (`text/event-stream`)**

```text
event: sources
data: {"sessions":[{...SessionDetail...}]}

event: delta
data: {"text":"가장 낮은 선택지는 A사였습니다 [1]."}

event: done
data: {"model":"exaone/depmkuykpfon9lg"}

event: verification
data: {"issues":[{"value":"21:31","answer_subject":"청량리에서 출발하는 강릉행 KTX 막차","record_subject":"서울역 출발 KTX 847 (막차)"}]}
```

이벤트 순서는 `sources` → `delta` 0개 이상 → (`replace` 0개 또는 1개) → `done` 또는 `error`이고, `done` 뒤에
`verification`이 0~1개 올 수 있다. 오류 이벤트는
`{"code":"stream_interrupted|generation_failed","partial":true|false,"retryable":true}` 형식이다.

소스 카드는 즉시 전송하고, 생성 답변도 토큰 단위 `delta`로 바로 흘려 보낸다. 생성이 끝난 뒤
답변을 검사해, 소스가 있는데 방문 기록 자체를 부정하는 문장(근거 번호 없는 "기록에 없습니다" 등)이거나
빈 답변이면 `replace`(`{"text":"..."}`)를 한 번 보낸다. 클라이언트는 그때까지 쌓은 본문을 이 텍스트로
통째로 바꾼다. 대체 텍스트는 확인 실패 안내와 확인된 세션 제목·방문 URL이다. 대체는 서버 로그
`Ask answer replaced: reason=record_denial|empty_answer`로 따로 센다. 세부 수치·내용이 확인되지 않는다는
한계 표현과 "…기록은 없지만 … [1]" 같은 양보 표현은 대체하지 않는다. 생성이 중간에 끊기면 이미 보낸 본문이
있을 때 오류의 `partial`이 `true`다.

`verification`은 비슷한 대상 혼동 검증 결과다. 답변이 끝나면(`done`) 서버가 같은 답변 프롬프트와 답변을 A.X-K2에
다시 보내, 답변의 값마다 답변이 말한 대상(`answer_subject`)·기록 원문·원문의 대상(`record_subject`)을 적게 한다.
원문에 그 값이 실제로 있으면서 대상이 다른 값만 최대 3개 보낸다(계산값과 원문 없는 값은 제외). 답변은 고치지 않으며 클라이언트는 답변 아래에 경고로 보여 준다. 첫 문장에서 못 찾았다고 답한 경우,
`find_sessions`, 검증 호출의 실패·타임아웃(15초)·형식 오류·EXAONE 폴백이면 이벤트를 보내지 않는다(서버 로그만).
클라이언트는 `done`에서 다음 질문을 받을 수 있고, 그 사이 새 질문으로 스트림을 끊으면 경고만 받지 못한다.
검색/DB 오류처럼 스트림 시작 전 실패는 기존 HTTP 오류 계약을 따른다.

`search_memory`의 출처 선택: 벡터 검색으로 후보를 최대 5개(점수 하한 0.15) 받는다. 후보 세션이 모두
기본 임계값(`SEARCH_SCORE_THRESHOLD`, 0.28)에 못 미치고 본문 조각 최고점도 0.40 미만이면 근거 없음으로
끝낸다(여정 단위로 커진 세션은 세부 질문의 세션 점수가 낮아 본문 조각으로도 판단한다). 후보 세션의
페이지 본문을 700자 조각으로 나눠 질문과의 유사도를 매기고, 근거 점수 1위 세션과 0.05 이내이거나,
0.15 이내이면서 0.30 이상인 세션만 최대 3개 남긴다. `sources` 이벤트의 순서가 답변의 `[n]` 번호다.

답변 컨텍스트는 출처 세션의 요약, 세션 기간, 세션별 질문과 가까운 본문 조각(전체 16,000자를 세션
수로 나눈 예산, 세션당 최소 4,000자·페이지 10개)과 각 페이지의 방문 시각·검색어, 오늘 날짜(KST)로
구성한다. 조각은 관련 높은 페이지마다 가장 가까운 조각을 하나씩 먼저 넣고 남은 예산을 점수 순으로 채운다. 세션별 relevance×체류 시간 상위 20개(같은 URL은 1개)를 후보로 두고, 질문에는
`embedding-query`, 조각에는 `embedding-passage`를 사용한다. 임베딩은 (모델, 문장) 단위로 프로세스 메모리
LRU(최대 2,000개)에 재사용되어 같은 세션을 다시 묻는 후속 질문은 Upstage를 다시 호출하지 않는다. 임베딩 장애 시에는 relevance×체류 시간
상위 4개 페이지의 본문 앞 1,200자로 fallback한다. 미할당 이벤트는 포함하지 않으며, 페이지 본문 안의
지시문은 신뢰하지 않는 데이터로 취급한다. 답변은 근거 세션을 `[1]`, `[2]`처럼 표시한다.

모델은 K-EXAONE 스트리밍(`enable_thinking: false`)을 우선 사용한다(DecisionLog 2026-10-23). `done.model`은
실제로 답한 모델 라벨이다(EXAONE은 `exaone/<endpoint id>`, 폴백은 `A.X-K2`). 첫 토큰 전에 연결·rate limit·
키 권한(401/403)·지원 상태 오류나 빈 스트림이 오면 A.X-K2로 폴백하고, 일부 토큰을 보낸 뒤 끊기면 다른 모델을 이어 붙이지 않고
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
- 의미 기반 탭 이동의 기본 하한은 점수 `0.35`, 격차 `0.05`이며, 미달이면 `search_memory`로 간다.
  열린 대상이 없거나 resolver에서 확실한 후보를 못 찾으면 확장은 저장 기록 검색으로 이어간다.
  충분한 점수의 열린 후보 여러 개를 resolver가 반환한 경우에는 기존 선택 UI를 유지한다.
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

## 13. 사용자 폴더 (`/folders`)

사용자가 직접 만드는 세션 그룹. 서버는 폴더를 만들거나 이름을 짓지 않는다. 사용자 폴더 안에서만 새 세션을
확실할 때 자동 배정하고 애매하면 제안한다(§13.4). 세션은 폴더 하나에만 속한다(단일 소속).

| 메서드 | 경로 | 설명 |
|---|---|---|
| `GET` | `/folders` | 폴더 목록. `position`, `created_at` 순. `session_count`는 병합으로 흡수된 세션(`status='merged'`)을 제외한 수 |
| `POST` | `/folders` | 생성. 이름만 받고 색(`hue`)과 `position`은 서버가 정한다(팔레트 순환, 항상 맨 뒤) |
| `PATCH` | `/folders/{folder_id}` | 부분 갱신 — `name` / `hue` / `position` 중 보낸 것만 반영 |
| `DELETE` | `/folders/{folder_id}` | 폴더만 삭제. **소속 세션은 지우지 않고** `folder_id`·`folder_assigned_by`를 NULL로 되돌린다(다시 제안될 수 있음) |
| `POST` | `/folders/{folder_id}/sessions` | 세션 일괄 배정(최대 200건). 다른 폴더에 있던 세션도 이동한다. `folder_assigned_by='user'` |
| `DELETE` | `/folders/{folder_id}/sessions/{session_id}` | 폴더에서 빼 미정리로 되돌린다. `folder_assigned_by='user'`(자동 배정 되돌리기 포함) |
| `GET` | `/folders/suggestions` | 미정리 세션의 폴더 제안(§13.4) |
| `POST` | `/folders/suggestions/{session_id}/dismiss` | 제안 닫기 — 미정리로 두고 `folder_assigned_by='user'`. 204, 남의·병합된 세션은 404 |

### 13.1 일괄 배정의 부분 성공

`POST /folders/{id}/sessions`는 존재하지 않거나 남의 세션 id가 섞여 있어도 요청 전체를
실패시키지 않는다. 실제로 옮긴 것과 건너뛴 것을 나눠 돌려준다.

```json
{ "folder_id": "...", "assigned": ["s1", "s2"], "skipped": ["ghost"] }
```

한 건 때문에 나머지가 통째로 취소되면 사용자가 원인을 알 수 없기 때문이다.

### 13.2 소유권과 오류

- 남의 폴더·세션에는 `403`이 아니라 `404`를 반환한다 — `403`은 그 id가 존재한다는
  사실 자체를 알려준다(`api/sessions.py`의 `_owned_session`과 같은 정책).
- `DELETE /folders/{id}/sessions/{session_id}`는 세션이 그 폴더에 없으면 `404`.

### 13.3 `SessionDetail` 확장

`folder_id: str | null` 필드를 추가한다(§11 superset 정책). 폴더 기능을 모르는
클라이언트는 이 필드를 무시하면 그대로 동작한다.

`folder_assigned_by: "user" | "auto" | null` — 폴더 소속을 정한 주체. `auto`면 자동 분류가 넣은 것이라
클라이언트가 '자동' 표시를 붙인다. `null`은 아직 아무도 정하지 않은 세션이다(기능 이전에 폴더에 넣은 세션도 `null`).

### 13.4 자동 분류와 제안

- 대상 폴더는 사용자가 만든 폴더뿐이다. 근거는 그 폴더에 **사용자가 넣은** 세션들의 벡터다
  (`folder_assigned_by`가 `user`이거나 `null`이고 요약·임베딩이 성공한 소속 세션, 최근 활동 순 최대 500개). 자동 배정 세션은 근거에서 뺀다.
- 폴더 점수는 그 폴더 근거 세션 중 가장 비슷한 2개 세션 벡터 유사도의 평균이다.
- **자동 배정**: 동기화 배치 끝에, 그 배치에서 만들어지거나 바뀐 세션 중 미정리이면서 `folder_assigned_by`가
  `null`이고 요약·임베딩이 성공한 세션에 대해(재요약 실패 세션은 벡터가 낡아 제외), 1위 폴더 점수 ≥ 0.47이고 2위 폴더와 차이 ≥ 0.12이고 근거 세션이 2개 이상이면
  `folder_id`를 넣고 `folder_assigned_by='auto'`로 둔다. `GET/PATCH /settings`의 `auto_folder_enabled`
  (기본 `true`)로 끈다. 실패해도 배치는 성공으로 끝난다.
- **제안** (`GET /folders/suggestions`): 미정리이면서 `folder_assigned_by`가 `null`이고 요약·임베딩이 끝난 세션
  (최근 활동 순 최대 50개) 중 1위 폴더 점수 ≥ 0.40인 세션. 자동 기준을 넘더라도 배치 밖의 기존 세션은 제안으로만
  보여 준다. 점수 내림차순. 벡터 조회·검색 실패 시 `503`. 클라이언트는 Atlas 데이터와 따로 불러와 실패하면 제안 없이 그린다.

```json
[{"session_id": "s1", "folder_id": "f1", "score": 0.4322, "similar_session_ids": ["s7", "s9"]}]
```

- 수락은 일반 배정(`POST /folders/{id}/sessions`)이다. 사용자가 옮기거나 빼거나 제안을 닫은 세션은
  `folder_assigned_by='user'`라 자동 분류와 제안이 다시 다루지 않는다.


## 14. 팀 워크스페이스 (`/workspaces`) — 1단계 세션 공유형

팀원이 각자 고른 세션을 한 공간에 공유해 함께 보고 검색·Ask 한다. 공유는 사본이 아니라 원본
세션을 가리키는 **라이브 참조**라, 공유 뒤 Auto Session이 붙인 페이지도 팀에 보인다. 팀원은
읽기만 하고, 세션을 고치는 일(이름·삭제·병합·재요약)은 소유자만 한다. 결정 근거는
`DecisionLog.md` 2026-10-17 "팀 워크스페이스".

| 메서드 | 경로 | 권한 | 설명 |
|---|---|---|---|
| `GET` | `/workspaces` | 로그인 | 내가 속한 팀. `{workspace_id, name, hue, role, member_count, created_at}` |
| `POST` | `/workspaces` | 로그인 | `{name}`(앞뒤 공백 제거 후 1~60자). 만든 사람이 owner. 색은 폴더와 같은 팔레트 순환 |
| `POST` | `/workspaces/join` | 로그인 | `{code}`. 이미 멤버면 아무것도 바꾸지 않고 그 팀을 돌려준다(역할 유지) |
| `PATCH` | `/workspaces/{id}` | owner | `{name}` |
| `DELETE` | `/workspaces/{id}` | owner | 팀·멤버십·공유 관계만 삭제. 원본 세션은 각자의 개인 기록에 남는다 |
| `POST` | `/workspaces/{id}/invite-code` | owner | 새 초대 코드 `{code, expires_at}`(7일). 이전 코드는 즉시 무효 |
| `GET` | `/workspaces/{id}/members` | member | `{user_id, name, email, picture, role, joined_at}`. owner 먼저, 그다음 참여 순. `email`은 owner와 본인에게만 채워지고 다른 멤버에게는 `null` |
| `DELETE` | `/workspaces/{id}/members/{user_id}` | owner(남) / 본인(탈퇴) | 나간 사람이 그 팀에 건 공유가 모두 풀린다. owner 본인은 `409` |
| `GET` | `/workspaces/{id}/sessions` | member | 공유된 세션 = `SessionDetail` + `shared_by{user_id, name, picture}` + `shared_at`. 병합으로 흡수된 세션 제외, 최근 활동순 |
| `POST` | `/workspaces/{id}/sessions` | member | `{session_ids}`(1~200). 내 소유의 흡수되지 않은 세션만 공유 |
| `DELETE` | `/workspaces/{id}/sessions/{session_id}` | 공유한 사람 / owner | 공유 해제 |

### 14.1 권한과 오류

- 멤버가 아니면 그 팀의 모든 경로가 `404`다 — `403`은 그 id의 존재를 알려준다(§13.2와 같은 정책).
- 멤버가 owner 전용 작업을 하면 `403`. 멤버는 이미 팀의 존재를 안다.
- 초대 코드가 없거나 만료됐거나 재발급으로 무효가 되면 `POST /workspaces/join`은 `400`이며
  세 경우를 구분하지 않는다(코드 추측에 단서를 주지 않는다).
- 서버는 초대 코드의 SHA-256 해시만 저장한다. 평문은 발급 응답에서 한 번만 보인다.
- owner가 멤버를 내보내면 현재 초대 코드도 무효가 된다 — 내보낸 사람이 아직 유효한 같은 코드로
  다시 들어오지 못하게. 스스로 나간 경우에는 코드를 그대로 둔다.
- 공유는 **공유한 사람이 그 팀 멤버인 동안만** 유효하다. 탈퇴·내보내기와 같은 순간 들어온 공유 행이
  남더라도 팀 목록·팀 검색·읽기 판정이 공유한 사람의 멤버십을 다시 확인해 걸러 낸다.

### 14.2 공유의 부분 성공

`POST /workspaces/{id}/sessions`는 §13.1 폴더 배정과 같은 규칙을 따른다. 남의·없는·흡수된
세션이 섞여도 전체를 실패시키지 않는다. 이미 공유된 세션은 `shared`에 그대로 포함된다(멱등).

```json
{ "workspace_id": "...", "shared": ["s1", "s2"], "skipped": ["ghost"] }
```

### 14.3 기존 경로 변경

- `SessionDetail`에 `shared_workspace_ids: string[]`를 추가한다(§11 superset). 이 세션이 공유된 팀
  id이며 **`GET /sessions` 목록과 `GET /sessions/{id}`에서 소유자에게만** 채워진다. 다른 응답(PATCH·
  merge·retry·검색·Ask)과 팀원이 받은 응답에서는 항상 빈 배열이라, 팀원은 그 세션이 다른 팀에도
  공유됐는지 알 수 없다.
- 팀원이 받은 응답(공유 세션 단건, 팀 목록, 팀 범위 검색·Ask 근거)은 `folder_id`와 `folder_assigned_by`도 `null`이다 —
  폴더는 소유자의 개인 정리 정보다.
- `GET /sessions/{id}`, `/sessions/{id}/events`, `/sessions/{id}/versions`: 읽기 권한을 "소유자 또는 그
  세션이 공유된 팀의 멤버"로 넓힌다. 병합으로 흡수된 세션은 팀원에게 `404`다(팀 목록·검색에서 빠지는
  것과 같게). 쓰기 경로(`PATCH`·`DELETE`·`merge`·`unmerge`·`retry-summary`)는 소유자 전용 그대로다.
- `GET /search`: `workspace_id` 쿼리 파라미터. 주면 그 팀에 공유된 세션만 검색하고, `scope=memory`의
  키워드 이벤트도 공유된 세션에 속한 방문만 돌려준다. 멤버가 아니면 `404`.
- `POST /ask/stream`: `workspace_id`(§8.1).
- 팀 검색의 세션·방문 조회와 Ask의 근거·본문 조회는 **각 SQL 실행 시점**에 조회자와 공유자의
  멤버십, 해당 팀의 공유 행, 세션의 비흡수 상태를 함께 판정한다. 임베딩 전에 얻은 공유 id 목록은
  Qdrant 후보 필터에만 쓴다. Ask는 세션과 본문을 같은 SQL로 읽고, 제외된 근거는 SSE와 생성
  프롬프트에서도 뺀다. 단, 해당 SQL의 스냅샷 이후 철회는 이미 읽은 자료를 회수하지 않는다.
  검색 리랭킹·Ask 본문 임베딩·답변 생성·스트리밍 중 철회에 따른 취소까지 보장하지는 않는다.
- `GET/PATCH /settings`: 사용자별 값이다. 이전의 전역 값은 읽지 않는다(`data-model-v2.md` §11).
  `team_collect_excluded_domains: string[]`(최대 200, 호스트 접미사 일치, 소문자)를 더한다(§15).

## 15. 팀 수집 모드 (`/workspaces/{id}/collect`) — 2단계

팀을 켜 둔 동안 이 기기에서 연 페이지를 팀 스트림으로 보내고, 멤버별로 세션화한 뒤 그 팀에 자동 공유한다.
설계·결정·불변 조건 17개는 `docs/team-collect-mode.md`. 권한 정책은 §14.1과 같다(비멤버 404, owner 전용 403).

| 메서드 | 경로 | 권한 | 설명 |
|---|---|---|---|
| `GET` | `/workspaces?device_id=` | 로그인 | 항목에 `collect_allowed`, `my_collect`(이 기기의 활성 창 `{window_id, workspace_id, device_id, started_at, expires_at}` 또는 `null`) |
| `PATCH` | `/workspaces/{id}` | owner | `{name?, collect_allowed?}`. 허용을 끄면 그 팀의 열린 창이 모두 끝난다 |
| `GET` | `/workspaces/{id}/collect` | member | `{allowed, my_windows[], collecting[{user_id,name,picture,expires_at}]}`. `my_windows`는 내 모든 기기, `collecting`에는 남의 기기 정보가 없다 |
| `POST` | `/workspaces/{id}/collect` | member | `{device_id, duration_minutes: 30\|60\|120\|240\|480(기본 120), consent_version}` → `201 {window, server_now, ended_workspace_id}`. 허용 안 된 팀·동시 시작은 `409`. 같은 기기의 다른 창은 끝낸다 |
| `DELETE` | `/workspaces/{id}/collect?device_id=&reason=` | member | `reason: stop\|pause\|browser_restart\|account_switch`. `device_id`를 빼면 이 팀의 내 모든 창. 멱등 `204` |
| `GET` | `/workspaces/{id}/collect/windows/{wid}/sessions` | 창 주인 | 돌아보기 — 그 창의 방문이 들어간 내 세션(`SessionDetail[]`). 남의 창 `404` |
| `POST` | `/workspaces/{id}/collect/windows/{wid}/withdraw` | 창 주인 | 세션에 묶이지 않은 그 창의 방문을 개인으로. 열린 창이면 함께 끝낸다. `{withdrawn_events, sessions: SessionDetail[], window_closed}`. 남의 창 `404` |
| `POST` | `/workspaces/{id}/collect/sessions/{sid}/restore` | 세션 주인 | 뺀 수집 세션 되돌리기 — 공유 행과 스트림을 함께. 개인 방문이 섞였거나 멤버십·가입 시각이 깨졌으면 `409`. 성공 `204` |

### 15.1 인제스트

- `POST /events` 이벤트마다 `workspace_id`, `collect_window_id`(둘 다 있어야 판정. 기존 `window_id`는 브라우저 창 번호).
  서버가 그 창 하나로 사람·팀·기기·현재 멤버십(`started_at ≥ joined_at`)·허용·빼기·서버 수신 시각·민감/로그인 호스트/
  기본 제외(웹메일·메신저·검색 결과)/사용자 제외 목록을 판정해 통과한 것만 저장한다. 어기면 거절하지 않고 개인으로 저장한다.
- 응답에 `team_accepted`, `team_downgraded`, `window_closed`(가리킨 창이 서버에서 이미 끝났다 — 확장이 로컬 수집을 끄는 유일한 신호).
- 이미 있는 id는 `ON CONFLICT DO NOTHING`이라 재전송으로 팀 표시를 바꿀 수 없다. 바꾸는 길은 `withdraw`뿐이다.

### 15.2 기존 경로 변경

- 팀원 응답(팀 범위)의 페이지 주소는 쿼리·프래그먼트를 지운다(민감 URL은 도메인만): 공유 세션 단건 `tabs[].url`,
  `/sessions/{id}/events`의 `url`, 팀 목록, 팀 세션 검색, 팀 방문 검색, Ask 근거. `referrer_url`·`previous_event_id`는 싣지 않는다.
- `SessionDetail.collect_workspace_id`: 소유자에게만. `WorkspaceSessionItem.collected`: 이 팀의 수집 세션인가.
- 팀 공유 해제(`DELETE /workspaces/{id}/sessions/{sid}`)는 누가 풀든 그 팀의 수집 세션이면 스트림도 해제한다.
- 병합·병합 제안: 스트림(`collect_workspace_id`)이 다르면 `409`/제안 제외.
- 탈퇴·추방·팀 삭제는 창을 먼저 잠가 닫고 방문 표시·세션 스트림을 비운 뒤 공유를 지운다.
