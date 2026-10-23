# Orbit Backend

FastAPI 기반 이벤트 인제스트 + 세션 API + AI 파이프라인. Extension이 보낸 방문 이벤트를
받아 배치로 세션화하고, 국내 LLM(SKT A.X-K2 우선, LG K-EXAONE 폴백)으로 의도 분석과
요약을 수행하며, Upstage embedding-passage/embedding-query + Qdrant로 자연어 검색을
제공합니다. "지금 열린 탭 저장" 스냅샷 경로도 그대로 유지합니다.

## 구조

```
backend/
└─ app/
   ├─ main.py             # FastAPI 진입점, 라우터 등록, lifespan에서 DB/Qdrant 초기화 + 미완료 세션 복구
   ├─ config.py           # 환경변수 (.env) 로드
   ├─ api/
   │  ├─ events.py        # POST /events — 방문 이벤트 인제스트
   │  ├─ sync.py          # POST /sync — 배치 세션화 트리거
   │  ├─ sessions.py      # 세션 CRUD, /sessions/cluster(스냅샷), 요약 재시도, 병합
   │  ├─ search.py        # GET /search (임베딩 검색 + 선택적 LLM 리랭킹)
   │  ├─ ask.py           # POST /ask/stream — 근거 기반 SSE 답변
   │  ├─ assistant.py     # POST /assistant/route — Ask 입력 의도 판별
   │  ├─ tab_actions.py   # POST /tab-actions/resolve — 열린 탭 이동 대상 판별
   │  ├─ analytics.py     # 탐색 통계 집계
   │  ├─ recommendations.py, folders.py, settings.py, auth.py, deps.py
   ├─ schemas/            # Pydantic v2 요청/응답 스키마 (도메인별 분리)
   ├─ services/
   │  ├─ event_filter.py  # 인제스트 전처리 — 시스템 URL 제외, URL 정규화, 민감 URL 판정
   │  ├─ grouper.py       # 30분 공백 기준 시간 그룹화
   │  ├─ subclusterer.py  # 임베딩 average-linkage 선분리 (평균 코사인 임계값)
   │  ├─ intent_analyzer.py  # 그룹 → append/create/hold/discard 판단
   │  ├─ session_updater.py  # 판단 결과를 세션에 반영 + 버전 기록
   │  ├─ sync_pipeline.py    # 위 단계를 묶는 배치 오케스트레이션(run_batch)
   │  ├─ summarizer.py       # 세션 → LLM 요약 JSON, 잘못된 결과는 실패 상태로 전파
   │  ├─ embedding_sync.py   # 요약 → passage 임베딩 → Qdrant upsert
   │  ├─ noise_filter.py     # 규칙 기반 노이즈 이벤트 제외
   │  ├─ merge_suggester.py, merge_service.py  # 세션 병합 제안·실행·되돌리기
   │  ├─ ask_service.py, assistant_router.py, tab_action_resolver.py
   │  ├─ recommender/        # 추천 세션 스코어링 + LLM 리랭킹
   │  └─ google_auth.py, auth_tokens.py, users.py, app_settings.py
   ├─ ai/
   │  ├─ llm.py           # A.X-K2 / K-EXAONE 클라이언트 + A.X 우선 폴백, 전역 레이트 리미터
   │  ├─ embedding.py     # embedding-query/embedding-passage 클라이언트 (4096차원, 비대칭 임베딩)
   │  ├─ clusterer.py     # 스냅샷 경로에서 탭을 주제별로 그루핑
   │  ├─ reranker.py      # 검색 결과를 쿼리 관련성 순으로 재정렬
   │  └─ json_utils.py    # LLM 응답에서 JSON 추출 (펜스/잡담/순수 JSON 공통 처리)
   └─ db/
      ├─ models.py        # SQLAlchemy 모델 (PostgreSQL, JSONB) — 이벤트/세션/매핑/버전
      ├─ migrations.py    # 멱등 ALTER 러너 (Alembic 미도입 — docs/migration-plan.md)
      ├─ session.py       # 비동기 DB 세션 팩토리
      └─ vector.py        # Qdrant 클라이언트, 컬렉션 초기화, upsert/search/delete
tests/                    # pytest 단위 테스트 (외부 API·DB·LLM은 전부 대역 처리)
eval/                     # 골든셋 평가 하네스 — 세션 분류·검색 리콜·Ask 라우팅·탭 이동
```

## 실행

```bash
docker compose up -d postgres qdrant   # 루트에서
cd backend
pip install -e ".[dev]"                # 또는 uv sync
cp .env.example .env                   # 값 채우기
# AXK1_API_KEY, FRIENDLI_API_KEY, UPSTAGE_API_KEY 3종이 모두 필요하며,
# 구글 로그인용 GOOGLE_CLIENT_ID / JWT_SECRET 은 루트 README 참고.
uvicorn app.main:app --reload
```

`GET /health`로 기동 확인. 테스트는 `python -m pytest -p no:asyncio` (backend 디렉터리에서 실행).
`tests/conftest.py`가 SQLAlchemy의 실제 DB 연결을 차단하며, 서비스가 연결 예외를 잡아도
시험 종료 시 실패로 처리한다. DB를 쓰는 의존성은 각 시험에서 대역으로 교체해야 한다.

> `summary_status`/`embedding_status` 컬럼이 추가되었습니다. `create_all`은 기존 테이블에
> 컬럼을 자동으로 추가하지 않으므로, 기존 로컬 DB가 있다면 `docker compose down -v` 후
> 다시 올려야 합니다.

## 엔드포인트

| Method | Path | 설명 |
|---|---|---|
| POST | `/sessions` | 탭 목록 저장. 규칙 기반 제목으로 즉시 응답 후, AI 요약+임베딩은 백그라운드로 처리 |
| POST | `/sessions/cluster` | 탭을 주제별로 클러스터링해 세션 N개로 분리 저장 |
| GET | `/sessions` | 세션 목록 (최신순) |
| GET | `/sessions/{id}` | 세션 상세 |
| PATCH | `/sessions/{id}` | 이름 수정 — `{"alias": "..."}`. 내부 이름(`title`)은 그대로 두고 별칭만 저장한다. `null`/빈 문자열이면 별칭을 지운다 |
| POST | `/sessions/{id}/retry-summary` | AI 요약 실패(`summary_status=failed`) 세션 재시도 |
| DELETE | `/sessions/{id}` | 세션 삭제 (Qdrant 포인트도 함께 삭제) |
| GET | `/search?q=&rerank=` | 자연어 검색. score threshold 적용 후 `rerank=true`면 후보를 더 넓게 가져와 LLM으로 재정렬 |
| POST | `/assistant/route` | Ask 입력을 탭 이동·세션 찾기·전체/특정 세션 내용 검색으로 판별 |
| POST | `/ask/stream` | 의도별 세션 범위와 질문 관련 페이지를 근거로 SSE 답변 생성 |
| POST | `/tab-actions/resolve` | 열린 탭 후보 중 이동 대상을 의미 검색하고 낮은 신뢰도는 실행 보류 |
| GET·POST | `/workspaces` | 내 팀 목록·팀 만들기 (팀 워크스페이스 1단계, `docs/api-design-v2.md` §14) |
| POST | `/workspaces/join` | 초대 코드로 팀 참여 |
| PATCH·DELETE | `/workspaces/{id}` | 팀 이름 변경·삭제 (owner) |
| POST | `/workspaces/{id}/invite-code` | 초대 코드 발급. 이전 코드는 무효 (owner) |
| GET·DELETE | `/workspaces/{id}/members[/{user_id}]` | 팀원 목록·내보내기·탈퇴 |
| GET·POST·DELETE | `/workspaces/{id}/sessions[/{session_id}]` | 팀 공유 세션 목록·공유·해제 |

`GET /sessions/{id}`(와 `/events`·`/versions`)는 소유자 외에 그 세션이 공유된 팀의 멤버도 읽을 수 있다.
`/search`와 `/ask/stream`은 `workspace_id`를 주면 그 팀에 공유된 세션만 대상으로 한다.

검색 관련 설정:

| 환경변수 | 기본값 | 설명 |
|---|---|---|
| `SEARCH_SCORE_THRESHOLD` | `0.28` | Qdrant cosine 검색의 최소 유사도. 실제 골든셋에 맞춰 `0.0`~`1.0` 범위에서 조정 |
| `ASSISTANT_ROUTE_NAVIGATION_FLOOR` | `0.20` | Ask 라우터가 탭 이동을 선택할 최소 점수. 격차(`_MARGIN`)와 함께 라우팅 골든셋으로 고른 값 |
| `ASSISTANT_ROUTE_NAVIGATION_MARGIN` | `0.05` | 탭 이동과 다음 의도의 최소 점수 격차 |
| `ASSISTANT_ROUTE_RETRIEVAL_MARGIN` | `0.015` | 이보다 모호한 검색 의도는 전체 기록 검색으로 fallback |

검색 임베딩 timeout은 504, 연결 실패는 503, upstream/응답 형식 오류는 502로 반환한다.
Qdrant 검색 장애는 503으로 반환하며 내부 예외 상세는 API 응답에 포함하지 않는다.

## AI 모델 구성

모든 LLM 역할의 primary는 A.X-K2, fallback은 K-EXAONE이다. 한 공급자가 중단돼도 기능이
멈추지 않는다(근거: `docs/DecisionLog.md` 2026-10-22, model-eval-v1).

| 역할 | Primary | Fallback | 구현 |
|---|---|---|---|
| 배치 의도 분석 (append/create/hold/discard) | `A.X-K2` | `K-EXAONE` | `llm.chat_completion_intent` |
| 탭 클러스터링 (스냅샷 경로) | `A.X-K2` | `K-EXAONE` | `llm.chat_completion_light` |
| 세션 요약 | `A.X-K2` | `K-EXAONE` | `llm.chat_completion(_with_meta)` |
| 검색·추천 리랭킹 | `A.X-K2` | `K-EXAONE` | `llm.chat_completion` |
| Ask 답변 스트리밍 | `A.X-K2` | `K-EXAONE` | `llm.chat_completion_stream_with_meta` |
| 검색 쿼리 임베딩 | `embedding-query` | — | 4096차원, Qdrant cosine 검색 |
| 저장 문서(요약) 임베딩 | `embedding-passage` | — | 비대칭 임베딩 — 쿼리/문서에 서로 다른 모델 |

- 의도 분석은 A.X-K2가 정확도 87.6% 대 78.8%, JSON 유효율 100% 대 87.4%로 앞섰다. 1순위의
  rate limit(429)·지연·빈 응답은 `max_retries=0` + 12초 타임아웃으로 즉시 EXAONE에 넘긴다.
- 모든 LLM 호출은 전역 최소 간격 리미터(`_MIN_CALL_INTERVAL` 0.5초 = 최대 2 RPS)로 직렬화한다.
  A.X 게이트웨이의 "3 RPS 제한"(A.X-K1 시절 안내값)에 맞춘 값이다. 2026-10-23 실측(`eval/probe_rate_limit.py`)에서는
  A.X-K2 짧은 요청(max_tokens 8)을 1→2→3→4→6 RPS로 단계마다 10초씩 보냈다. 160회가 모두 성공했고(성공 지연 p50 약 140ms),
  429와 `x-ratelimit-*` 헤더는 없었다. 긴 요청과 분 단위 한도는 재지 않았다.
- `K-EXAONE`은 FriendliAI dedicated endpoint(`EXAONE_MODEL` = endpoint ID)로 호출하며,
  hybrid reasoning 모델이라 `chat_template_kwargs.enable_thinking=false`를 항상 보낸다.
  끄지 않으면 출력 토큰을 추론 트레이스가 소진해 content가 비어 온다.
- Ask 스트리밍은 첫 토큰 전 실패에만 폴백한다. 토큰을 이미 보낸 뒤 끊기면 다른 모델로
  이어붙일 수 없어 `StreamInterruptedError`로 호출자에게 부분 실패를 알린다.
- 폴백 대상 상태 코드는 401·403·404·429·5xx다(`llm._should_fallback`). 401/403은 그 공급자의
  키·모델 권한 문제라 다른 공급자는 정상일 수 있다. 400·422 같은 요청 오류는 그대로 던진다.
- Ask 출처·컨텍스트 선택 규칙은 `docs/api-design-v2.md` §8.1, 품질 평가는
  `python -m eval.run_ask_eval`(eval/README.md).

세션 저장 흐름: 저장 요청 → 규칙 기반 제목으로 즉시 DB 저장(`summary_status=pending`) 및 응답 →
백그라운드에서 LLM 요약 생성(`summary_status=done|failed`) → 요약 텍스트를 embedding-passage로
임베딩(`embedding_status=done|failed`) → PostgreSQL/Qdrant 갱신.
Extension은 `usePendingSessionPoller`로 `summary_status`를 폴링해 반영하고, `failed`면
재시도 버튼을 노출한다. 서버가 재시작되면 `lifespan`에서 미완료(`pending`) 세션과
임베딩 미완료 세션을 자동으로 재처리한다.

저장 임베딩에는 세션 제목, overview, purpose, highlights와 대표 페이지(`tabs`, 최대 20개)의
페이지 제목·도메인·URL 경로 토큰이 포함된다(예: `react.dev learn preserving and resetting state`).
LLM 요약이 여러 주제를 한 문단에 섞어도 페이지 단위 질문이 검색되게 하기 위해서다.
이 변경 전에 생성된 Qdrant 포인트는 자동 재색인되지 않는다. 기존 세션에 적용하려면 백필을 한 번 돌린다.

```bash
cd backend
python -m app.services.embedding_sync --user-id <id> --dry-run   # 대상 DB·Qdrant와 세션 수만 출력
python -m app.services.embedding_sync --user-id <id> --yes       # 한 사용자만 재임베딩
python -m app.services.embedding_sync --all --dry-run            # 모든 사용자 대상 미리보기
```

`--user-id`나 `--all` 중 하나는 필수다. 실행하면 먼저 대상(DB 호스트/이름, Qdrant 호스트, 컬렉션,
사용자, 세션 수)을 출력하고, `--yes`가 없으면 아무 호출 없이 멈춘다(종료 코드 1). 비밀번호는 출력하지 않는다.
세션마다 embedding-passage 호출이 1회 발생한다(유료, 순차 실행). `backend/.env`의 DB·Qdrant를 대상으로
하므로 `--dry-run` 출력으로 대상 환경을 확인한 뒤 `--yes`를 붙인다. 실패한 세션은 `embedding_status=failed`로
남고 기동 복구가 다시 시도한다.

## 알려진 미완성 항목

- Structured Output(`response_format`) 미적용 — 현재는 프롬프트 지시 + JSON 추출(`json_utils`) +
  실패 시 규칙 기반 fallback으로 안정성을 확보하고 있다. A.X-K1과 K-EXAONE의 JSON 모드
  지원 여부는 별도 확인이 필요하다.
- Alembic 미도입 — `create_all` + 멱등 ALTER 러너(`db/migrations.py`)로 대응 중이다.
  실사용 데이터가 쌓이면 버전 관리 마이그레이션으로 전환해야 한다.
