# Orbit Backend

FastAPI 기반 이벤트 인제스트 + 세션 API + AI 파이프라인. Extension이 보낸 방문 이벤트를
받아 배치로 세션화하고, 국내 LLM(SKT A.X-K1 ↔ LG K-EXAONE 상호 폴백)으로 의도 분석과
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
   │  ├─ llm.py           # A.X-K1 / K-EXAONE 클라이언트 + 단계별 상호 폴백, 전역 레이트 리미터
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
# backend/.env 를 직접 작성한다 (backend/.env.example 은 없다).
# AXK1_API_KEY, FRIENDLI_API_KEY, UPSTAGE_API_KEY 3종이 모두 필요하며,
# 구글 로그인용 GOOGLE_CLIENT_ID / JWT_SECRET 은 루트 README 참고.
uvicorn app.main:app --reload
```

`GET /health`로 기동 확인. 테스트는 `pytest` (backend 디렉터리에서 실행).

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

검색 관련 설정:

| 환경변수 | 기본값 | 설명 |
|---|---|---|
| `SEARCH_SCORE_THRESHOLD` | `0.28` | Qdrant cosine 검색의 최소 유사도. 실제 골든셋에 맞춰 `0.0`~`1.0` 범위에서 조정 |
| `ASSISTANT_ROUTE_NAVIGATION_FLOOR` | `0.14` | Ask 라우터가 탭 이동을 선택할 최소 점수 |
| `ASSISTANT_ROUTE_NAVIGATION_MARGIN` | `0.02` | 탭 이동과 다음 의도의 최소 점수 격차 |
| `ASSISTANT_ROUTE_RETRIEVAL_MARGIN` | `0.015` | 이보다 모호한 검색 의도는 전체 기록 검색으로 fallback |

검색 임베딩 timeout은 504, 연결 실패는 503, upstream/응답 형식 오류는 502로 반환한다.
Qdrant 검색 장애는 503으로 반환하며 내부 예외 상세는 API 응답에 포함하지 않는다.

## AI 모델 구성

두 LLM은 서로의 폴백이다. 단계별로 실측 우세한 쪽을 primary로 두되 반대쪽을 fallback으로
걸어, 한 공급자가 중단돼도 기능이 멈추지 않는다(근거: `docs/DecisionLog.md` 2026-08-05).

| 역할 | Primary | Fallback | 구현 |
|---|---|---|---|
| 배치 의도 분석 (append/create/hold/discard) | `K-EXAONE` | `A.X-K1` | `llm.chat_completion_intent` |
| 탭 클러스터링 (스냅샷 경로) | `K-EXAONE` | `A.X-K1` | `llm.chat_completion_light` |
| 세션 요약 | `A.X-K1` | `K-EXAONE` | `llm.chat_completion(_with_meta)` |
| 검색·추천 리랭킹 | `A.X-K1` | `K-EXAONE` | `llm.chat_completion` |
| Ask 답변 스트리밍 | `A.X-K1` | `K-EXAONE` | `llm.chat_completion_stream_with_meta` |
| 검색 쿼리 임베딩 | `embedding-query` | — | 4096차원, Qdrant cosine 검색 |
| 저장 문서(요약) 임베딩 | `embedding-passage` | — | 비대칭 임베딩 — 쿼리/문서에 서로 다른 모델 |

- 의도 분석만 EXAONE 우선 방향이 반대인 이유: 공정 재평가에서 품질은 대등했고
  노이즈 제외는 EXAONE이 우세했다. serverless rate limit(429)이나 지연은
  `max_retries=0` + 12초 타임아웃으로 즉시 A.X-K1에 넘겨 흡수한다.
- `A.X-K1`은 3 RPS 제한이 있어 모든 LLM 호출을 전역 최소 간격 리미터로 직렬화한다.
- `K-EXAONE`(`LGAI-EXAONE/K-EXAONE-236B-A23B`)은 FriendliAI serverless로 호출하며,
  hybrid reasoning 모델이라 `chat_template_kwargs.enable_thinking=false`를 항상 보낸다.
  끄지 않으면 출력 토큰을 추론 트레이스가 소진해 content가 비어 온다.
- Ask 스트리밍은 첫 토큰 전 실패에만 폴백한다. 토큰을 이미 보낸 뒤 끊기면 다른 모델로
  이어붙일 수 없어 `StreamInterruptedError`로 호출자에게 부분 실패를 알린다.

세션 저장 흐름: 저장 요청 → 규칙 기반 제목으로 즉시 DB 저장(`summary_status=pending`) 및 응답 →
백그라운드에서 LLM 요약 생성(`summary_status=done|failed`) → 요약 텍스트를 embedding-passage로
임베딩(`embedding_status=done|failed`) → PostgreSQL/Qdrant 갱신.
Extension은 `usePendingSessionPoller`로 `summary_status`를 폴링해 반영하고, `failed`면
재시도 버튼을 노출한다. 서버가 재시작되면 `lifespan`에서 미완료(`pending`) 세션과
임베딩 미완료 세션을 자동으로 재처리한다.

저장 임베딩에는 제목, overview, purpose, highlights가 포함된다. 이 변경 전에 생성된 Qdrant
포인트는 자동 재색인되지 않으므로 제목 검색 효과는 신규 세션과 요약 재처리 세션부터 적용된다.

## 알려진 미완성 항목

- Structured Output(`response_format`) 미적용 — 현재는 프롬프트 지시 + JSON 추출(`json_utils`) +
  실패 시 규칙 기반 fallback으로 안정성을 확보하고 있다. A.X-K1과 K-EXAONE의 JSON 모드
  지원 여부는 별도 확인이 필요하다.
- Alembic 미도입 — `create_all` + 멱등 ALTER 러너(`db/migrations.py`)로 대응 중이다.
  실사용 데이터가 쌓이면 버전 관리 마이그레이션으로 전환해야 한다.
