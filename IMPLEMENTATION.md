# Orbit — AI 파이프라인 구현 계획

> **상태: 1~3단계 구현 완료 (2026-06-29 `feat/backend-ai-pipeline` 병합).**
> 아래 계획 본문은 구현 착수 전 설계 기록으로 남겨두고, 실제 결과와 달라진 부분은
> 문서 맨 끝 [실제 구현 결과 — 계획 대비 차이](#실제-구현-결과--계획-대비-차이)에 정리했다.

## 확정된 모델

| 역할 | 모델 | 비고 |
|---|---|---|
| 세션 요약 / 이름 생성 (primary) | `A.X-K1` | 한국어 특화, reasoning mode 지원 |
| 세션 요약 fallback | `solar-pro3` | RPS 초과 / 장애 시 |
| 탭 클러스터링 / 검색 리랭킹 (경량) | `solar-mini` | 계획에는 없었으나 구현 단계에서 추가, 실패 시 `solar-pro3` fallback |
| 임베딩 | `embedding-query` | 4096차원, Upstage |
| STT | 미사용 | 음성 입력 없음 |

### API 접속 정보 (검증 완료)

| 서비스 | Base URL | Auth |
|---|---|---|
| A.X-K1 | `https://awf-gw.adot.ai` | `Authorization: Bearer {KEY}` |
| Upstage | `https://api.upstage.ai/v1` | `Authorization: Bearer {KEY}` |

---

## 현재 상태

```
✅ Extension UI (세션 저장/복원/삭제/이름변경)
✅ 페이지 콘텐츠 추출 (Readability.js, 최대 8000자)
✅ chrome.storage.local CRUD
✅ Backend AI 파이프라인 (요약 + fallback + 탭 클러스터링)
✅ Extension ↔ Backend 연동 (mock 제거, 실제 fetch)
✅ 임베딩 + Qdrant 벡터 검색 + LLM 리랭킹
```

---

## 구현 단계

### 1단계 — Backend AI 파이프라인

**목표:** 세션 저장 시 A.X-K1이 요약을 생성하고 DB에 저장

#### 1-1. 디렉토리 구조

```
backend/app/
├── ai/
│   ├── __init__.py
│   ├── llm.py          # A.X-K1 / solar-pro3 클라이언트
│   └── embedding.py    # embedding-query 클라이언트
├── services/
│   ├── __init__.py
│   └── summarizer.py   # 탭 목록 → 요약 JSON 생성
├── api/
│   ├── __init__.py
│   └── sessions.py     # POST /sessions, GET /sessions
├── schemas/
│   ├── __init__.py
│   └── session.py      # Pydantic 요청/응답 스키마
├── db/
│   ├── __init__.py
│   ├── models.py       # SQLAlchemy Session 모델
│   └── session.py      # DB 세션 팩토리
└── main.py             # 라우터 등록
```

#### 1-2. 핵심 스키마

```python
# 요청: Extension → Backend
class TabItem(BaseModel):
    url: str
    title: str
    text_content: str   # Readability.js 추출 텍스트 (최대 8000자)
    excerpt: str | None
    site_name: str | None

class SaveSessionRequest(BaseModel):
    tabs: list[TabItem]
    saved_at: str       # ISO 8601

# 응답: Backend → Extension
class SessionSummary(BaseModel):
    overview: str       # 한 줄 개요
    purpose: str        # 탐색 목적
    highlights: list[str]   # 핵심 정보
    todos: list[str]         # 미완료 작업
    next_actions: list[str]  # 다음 행동

class SaveSessionResponse(BaseModel):
    session_id: str
    title: str          # 자동 생성된 세션명
    summary: SessionSummary
```

#### 1-3. A.X-K1 요약 프롬프트 전략

```python
SYSTEM_PROMPT = """
당신은 브라우저 탭 묶음을 분석해 사용자의 탐색 목적과 맥락을 파악하는 AI입니다.
반드시 JSON 형식으로만 응답하고, 한국어로 작성하세요.
"""

USER_PROMPT = """
다음은 사용자가 열어둔 탭 목록입니다.

{tabs_text}

아래 JSON 스키마로 분석 결과를 반환하세요:
{{
  "title": "세션 제목 (20자 이내)",
  "overview": "한 줄 개요",
  "purpose": "탐색 목적",
  "highlights": ["핵심 정보1", "핵심 정보2"],
  "todos": ["미완료 작업"],
  "next_actions": ["다음 행동"]
}}
"""
```

- `enable_thinking: false` — 요약은 빠른 응답 우선
- `temperature: 0.3` — 일관된 구조화 출력
- `max_tokens: 500` — 요약이므로 충분

#### 1-4. Fallback 로직

```
A.X-K1 호출
  └─ 성공 → 반환
  └─ 429 (RPS 초과) → 1초 대기 → solar-pro3 호출
  └─ 5xx → solar-pro3 호출
  └─ solar-pro3도 실패 → 규칙 기반 제목 생성 (탭 제목 첫 번째)
```

#### 1-5. 엔드포인트

```
POST /sessions
  - 탭 목록 수신 → LLM 요약 → DB 저장 → summary 반환

GET  /sessions
  - 저장된 세션 목록 반환

GET  /sessions/{session_id}
  - 세션 상세 (탭 목록 + summary)

DELETE /sessions/{session_id}
PATCH  /sessions/{session_id}  (title 수정)
```

---

### 2단계 — Extension ↔ Backend 연동

**목표:** mock API를 실제 백엔드 호출로 교체

#### 2-1. Extension 변경 파일

**`extension/lib/api.ts`** — mock → fetch

```typescript
const BASE = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8000"

export async function saveSession(tabs: TabItem[]): Promise<Session> {
  const res = await fetch(`${BASE}/sessions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ tabs, saved_at: new Date().toISOString() }),
  })
  return res.json()
}

export async function fetchSessions(): Promise<Session[]> {
  const res = await fetch(`${BASE}/sessions`)
  return res.json()
}
```

**`extension/.env`** (로컬 개발)

```
VITE_API_BASE_URL=http://localhost:8000
```

#### 2-2. SaveSessionButton 변경

세션 저장 시 `pageContent` (Readability.js 결과)를 함께 전송하도록 수정.
현재 저장 로직에 `getTabPageContent()` 호출이 포함되어 있으므로,
수집된 `text_content`를 API 요청 body에 포함.

#### 2-3. UI: 요약 표시

`SummaryPanel.tsx`에 백엔드에서 받은 `summary` 데이터 렌더링.
현재 컴포넌트 구조는 이미 준비되어 있음.

---

### 3단계 — 임베딩 + Qdrant 벡터 검색

**목표:** 자연어로 과거 세션을 검색하고 복원

#### 3-1. Qdrant 설정

`docker-compose.yml`에 이미 포함되어 있음. 실행:

```bash
docker compose up -d qdrant
```

컬렉션 스키마:

```python
# 벡터 차원: 4096 (embedding-query 출력)
# 거리: Cosine
collection_name = "orbit_sessions"
payload = {
    "session_id": str,
    "title": str,
    "overview": str,
    "purpose": str,
}
```

#### 3-2. 임베딩 생성 시점

세션 저장 시 (1단계 POST /sessions 파이프라인에 포함):

```
탭 텍스트 수신
  → A.X-K1 요약 생성
  → [overview + purpose + highlights] 텍스트 조합
  → embedding-query로 벡터 생성 (4096차원)
  → PostgreSQL + Qdrant 동시 저장
```

#### 3-3. 검색 엔드포인트

```
GET /search?q=항공권 비교
  → 쿼리 텍스트 → embedding-query → 4096차원 벡터
  → Qdrant cosine similarity 검색 (top 5)
  → 세션 ID 목록 → PostgreSQL에서 상세 조회
  → 결과 반환
```

#### 3-4. Extension 검색 연동

`extension/hooks/useSearch.ts` — 현재 로컬 필터링 → `/search` API 호출로 교체.

---

## 구현 순서 요약

```
Week 1
  ├─ backend 의존성 설치 (pip install -e .)
  ├─ app/ai/llm.py — A.X-K1 + solar-pro3 클라이언트
  ├─ app/ai/embedding.py — embedding-query 클라이언트
  ├─ app/services/summarizer.py — 요약 생성 로직
  ├─ app/schemas/session.py — Pydantic 스키마
  ├─ app/api/sessions.py — POST /sessions
  └─ 수동 테스트 (curl / Python)

Week 2
  ├─ app/db/models.py — SQLAlchemy Session 모델
  ├─ docker compose up (PostgreSQL)
  ├─ GET /sessions, DELETE, PATCH 엔드포인트
  ├─ extension/lib/api.ts — mock 제거, 실제 fetch
  ├─ SaveSessionButton.tsx — pageContent 포함 전송
  └─ SummaryPanel.tsx — 실제 summary 렌더링

Week 3
  ├─ docker compose up (Qdrant)
  ├─ app/db/vector.py — Qdrant 클라이언트
  ├─ 세션 저장 시 임베딩 생성 + Qdrant 저장
  ├─ GET /search 엔드포인트
  └─ useSearch.ts — 백엔드 검색 연동
```

---

## 주의사항

1. **컨텍스트 크기**: 탭이 많을 경우 8000자 × N탭이 A.X-K1의 64K 토큰 한도를 초과할 수 있음.
   → 탭당 최대 2000자로 줄이거나, 탭 수 10개 이하로 제한.

2. **RPS 제한**: A.X-K1은 팀당 RPS 3. 세션 저장은 순차 처리이므로 데모 수준에서 문제 없음.
   동시 저장 요청이 발생하면 큐(Redis) 처리 고려.

3. **개인정보**: 탭 텍스트 콘텐츠는 외부 AI API로 전송됨.
   민감 정보(금융, 의료 등) 필터링 로직 추가 권장.

4. **Structured Output**: LLM 응답이 JSON 파싱 실패 시 규칙 기반 fallback 필수.
   `try/except` + 최소 필드(title, overview)만 보장하는 안전망 구현.

5. **solar-pro 모델명**: 테스트에서 `solar-pro` alias로 동작했으나,
   공식 목록 기준 최신 모델은 `solar-pro3`. 프로덕션에서는 `solar-pro3` 사용.

---

## 실제 구현 결과 — 계획 대비 차이

`backend/app/`, `extension/lib/api.ts`, `extension/entrypoints/sidepanel/hooks/useSessions.ts` 기준으로 확인.

- **동기/비동기(주의사항의 열린 질문)**: 비동기로 확정. `POST /sessions`는 규칙 기반 제목으로
  즉시 저장·응답하고, LLM 요약·임베딩은 `BackgroundTasks`로 처리한다. Extension은
  `usePendingSessionPoller`로 3초 간격 폴링하며, "N개 탭 세션" 형태의 임시 overview가
  실제 요약으로 바뀌면 완료로 간주한다.
- **모델 티어링(주의사항 4의 열린 질문)**: 계획에 없던 `solar-mini`를 추가해
  탭 클러스터링(`ai/clusterer.py`)과 검색 리랭킹(`ai/reranker.py`) 같은 경량 작업에 쓰고,
  세션 요약처럼 복잡한 작업만 A.X-K1을 사용하도록 나눴다.
- **탭 클러스터링 추가 기능**: 계획에는 없던 `POST /sessions/cluster` 엔드포인트가 추가됐다.
  탭 4개 미만이면 단일 세션, 그 이상이면 `solar-mini`로 주제별 그룹을 나눠 세션 여러 개로 저장한다.
- **LLM 리랭킹 추가 기능**: `GET /search?rerank=true`로 Qdrant 유사도 검색 결과 상위 후보를
  `solar-mini`가 쿼리 관련성 순으로 재정렬한다. Extension 설정 화면의 "더 정확한 결과 보기"
  토글과 연결되어 있다.
- **미완성으로 남은 부분**: Extension 설정 화면에 "민감 도메인 제외" 토글(`excludeSensitive`,
  기본값 on)이 있지만, 실제 필터링 로직은 구현되지 않았다. `extension/lib/chrome-bridge.ts`는
  `chrome://`, `chrome-extension://` URL만 제외할 뿐 금융·의료 등 도메인 블랙리스트는 없다.
  주의사항 3에서 언급한 "민감 정보 필터링 로직"은 UI만 준비된 상태.
- **Redis**: `docker-compose.yml`과 `.env.example`에는 남아 있지만 백엔드 코드에서는
  어디서도 사용하지 않는다. 세션 저장이 순차 처리로 충분하다는 계획의 전제가 유지되고 있다.
