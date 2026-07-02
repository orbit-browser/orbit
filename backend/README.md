# Orbit Backend

FastAPI 기반 세션 API + AI 파이프라인. Extension이 보낸 탭 목록을 저장하고,
A.X-K1 / Solar Pro 3로 요약을 생성하고, embedding-query + Qdrant로 자연어 검색을 제공합니다.

## 구조

```
backend/
└─ app/
   ├─ main.py            # FastAPI 진입점, 라우터 등록, lifespan에서 DB/Qdrant 초기화
   ├─ config.py           # 환경변수 (.env) 로드
   ├─ api/
   │  ├─ sessions.py      # POST /sessions, /sessions/cluster, GET/PATCH/DELETE /sessions/{id}
   │  └─ search.py        # GET /search (임베딩 검색 + 선택적 LLM 리랭킹)
   ├─ schemas/
   │  └─ session.py       # Pydantic v2 요청/응답 스키마
   ├─ services/
   │  └─ summarizer.py    # 탭 목록 → LLM 요약 JSON, 실패 시 규칙 기반 fallback
   ├─ ai/
   │  ├─ llm.py           # A.X-K1 / Solar Pro 3 / Solar Mini 클라이언트 + fallback 로직
   │  ├─ embedding.py     # embedding-query 클라이언트 (4096차원)
   │  ├─ clusterer.py     # 탭을 주제별로 그루핑 (Solar Mini)
   │  └─ reranker.py      # 검색 결과를 쿼리 관련성 순으로 재정렬 (Solar Mini)
   └─ db/
      ├─ models.py        # SQLAlchemy Session 모델 (PostgreSQL, JSONB)
      ├─ session.py        # 비동기 DB 세션 팩토리
      └─ vector.py         # Qdrant 클라이언트, 컬렉션 초기화, upsert/search/delete
```

## 실행

```bash
docker compose up -d postgres qdrant   # 루트에서
cd backend
pip install -e .                       # 또는 uv sync
cp .env.example .env                   # UPSTAGE_API_KEY, AXK1_API_KEY 채우기
uvicorn app.main:app --reload
```

`GET /health`로 기동 확인.

## 엔드포인트

| Method | Path | 설명 |
|---|---|---|
| POST | `/sessions` | 탭 목록 저장. 규칙 기반 제목으로 즉시 응답 후, AI 요약+임베딩은 백그라운드로 처리 |
| POST | `/sessions/cluster` | 탭을 주제별로 클러스터링해 세션 N개로 분리 저장 |
| GET | `/sessions` | 세션 목록 (최신순) |
| GET | `/sessions/{id}` | 세션 상세 |
| PATCH | `/sessions/{id}` | 제목 수정 |
| DELETE | `/sessions/{id}` | 세션 삭제 (Qdrant 포인트도 함께 삭제) |
| GET | `/search?q=&rerank=` | 자연어 검색. `rerank=true`면 후보를 더 넓게 가져와 LLM으로 재정렬 |

## AI 모델 구성

| 역할 | 모델 | 비고 |
|---|---|---|
| 세션 요약 (primary) | `A.X-K1` | 429/5xx 시 `solar-pro3`로 자동 fallback |
| 탭 클러스터링 / 검색 리랭킹 (경량) | `solar-mini` | 실패 시 `solar-pro3`로 fallback |
| 임베딩 | `embedding-query` | 4096차원, Qdrant cosine 검색 |

세션 저장 흐름: 저장 요청 → 규칙 기반 제목으로 즉시 DB 저장 및 응답 →
백그라운드에서 LLM 요약 생성 → 요약 텍스트 임베딩 → PostgreSQL/Qdrant 갱신.
Extension은 `usePendingSessionPoller`로 AI 요약 완료를 폴링해 반영한다.

## 알려진 미완성 항목

- 민감 도메인(금융·의료 등) 텍스트 필터링 — Extension 설정 화면에 토글(`excludeSensitive`)만 있고
  실제 차단 로직은 없음. 현재 `chrome-bridge.ts`는 `chrome://`, `chrome-extension://`만 제외한다.
- Redis 기반 요청 큐 — `docker-compose.yml`에 정의만 되어 있고 코드에서 미사용.
  현재 세션 저장은 순차 처리로 충분해 별도 큐 없이 동작한다.
