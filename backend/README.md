# Orbit Backend

FastAPI 기반 세션 API + AI 파이프라인. Extension이 보낸 탭 목록을 저장하고,
A.X-K1 / Solar Pro 3로 요약을 생성하고, embedding-passage/embedding-query + Qdrant로 자연어 검색을 제공합니다.

## 구조

```
backend/
└─ app/
   ├─ main.py            # FastAPI 진입점, 라우터 등록, lifespan에서 DB/Qdrant 초기화 + 미완료 세션 복구
   ├─ config.py           # 환경변수 (.env) 로드
   ├─ api/
   │  ├─ sessions.py      # POST /sessions, /sessions/cluster, GET/PATCH/DELETE /sessions/{id}, POST /sessions/{id}/retry-summary
   │  └─ search.py        # GET /search (임베딩 검색 + 선택적 LLM 리랭킹)
   ├─ schemas/
   │  └─ session.py       # Pydantic v2 요청/응답 스키마
   ├─ services/
   │  └─ summarizer.py    # 탭 목록 → LLM 요약 JSON, 잘못된 결과는 실패 상태로 전파
   ├─ ai/
   │  ├─ llm.py           # A.X-K1 / Solar Pro 3 / Solar Mini 클라이언트 + fallback 로직
   │  ├─ embedding.py     # embedding-query/embedding-passage 클라이언트 (4096차원, 비대칭 임베딩)
   │  ├─ clusterer.py     # 탭을 주제별로 그루핑 (Solar Mini)
   │  ├─ reranker.py      # 검색 결과를 쿼리 관련성 순으로 재정렬 (Solar Mini)
   │  └─ json_utils.py    # LLM 응답에서 JSON 추출 (펜스/잡담/순수 JSON 공통 처리)
   └─ db/
      ├─ models.py        # SQLAlchemy Session 모델 (PostgreSQL, JSONB) — summary_status/embedding_status 포함
      ├─ session.py        # 비동기 DB 세션 팩토리
      └─ vector.py         # Qdrant 클라이언트, 컬렉션 초기화, upsert/search/delete
tests/                     # pytest 단위 테스트 (AI 파싱/분류/요약, 검색 API, Qdrant 계약)
```

## 실행

```bash
docker compose up -d postgres qdrant   # 루트에서
cd backend
pip install -e ".[dev]"                # 또는 uv sync
cp .env.example .env                   # UPSTAGE_API_KEY, AXK1_API_KEY 채우기
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
| PATCH | `/sessions/{id}` | 제목 수정 |
| POST | `/sessions/{id}/retry-summary` | AI 요약 실패(`summary_status=failed`) 세션 재시도 |
| DELETE | `/sessions/{id}` | 세션 삭제 (Qdrant 포인트도 함께 삭제) |
| GET | `/search?q=&rerank=` | 자연어 검색. score threshold 적용 후 `rerank=true`면 후보를 더 넓게 가져와 LLM으로 재정렬 |

검색 관련 설정:

| 환경변수 | 기본값 | 설명 |
|---|---|---|
| `SEARCH_SCORE_THRESHOLD` | `0.35` | Qdrant cosine 검색의 최소 유사도. 실제 골든셋에 맞춰 `0.0`~`1.0` 범위에서 조정 |

검색 임베딩 timeout은 504, 연결 실패는 503, upstream/응답 형식 오류는 502로 반환한다.
Qdrant 검색 장애는 503으로 반환하며 내부 예외 상세는 API 응답에 포함하지 않는다.

## AI 모델 구성

| 역할 | 모델 | 비고 |
|---|---|---|
| 세션 요약 (primary) | `A.X-K1` | 429/5xx/연결 실패/타임아웃 시 `solar-pro3`로 자동 fallback |
| 탭 클러스터링 / 검색 리랭킹 (경량) | `solar-mini` | 실패 시 `solar-pro3`로 fallback |
| 검색 쿼리 임베딩 | `embedding-query` | 4096차원, Qdrant cosine 검색 |
| 저장 문서(요약) 임베딩 | `embedding-passage` | 비대칭 임베딩 — 쿼리/문서에 서로 다른 모델 사용 |

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
  실패 시 규칙 기반 fallback으로 안정성을 확보하고 있다. solar-pro3의 JSON 모드 지원 여부는 별도 확인 필요.
