# Orbit

> 탐색의 흐름을 기억하고, 원하는 순간에 복원하는 **AI Browser Agent**

Orbit은 브라우저에 열린 탭들을 AI가 의미별로 분류해 **작업 세션**으로 저장하고, 자연어로 다시 찾아 복원하는 Chrome Extension 기반 서비스입니다.

## 현재 상태

- ✅ **Extension** — Chrome MV3 사이드패널, mock 제거하고 실제 Backend API와 연동 완료
- ✅ **Backend (FastAPI)** — 세션 CRUD, 탭 클러스터링, AI 요약(A.X-K1 → Solar Pro 3 fallback),
  임베딩 + Qdrant 벡터 검색, LLM 기반 검색 리랭킹까지 구현
- ✅ **웹 대시보드 (`frontend/`)** — 세션 목록/상세를 보여주는 별도 웹앱
- ✅ **민감 도메인 자동 제외** — `extension/lib/sensitive-domains.ts`로 은행·증권·정부·결제 도메인 및 로그인/결제 경로 판정, 매칭 시 본문만 제외하고 탭 자체는 유지
- ✅ **AI 실패 상태 추적** — `summary_status`/`embedding_status`로 요약·임베딩 성공 여부를 각각 추적, 실패 시 재시도 UI 제공, 서버 재시작 시 미완료 작업 자동 복구

세부 구현 이력과 최초 계획 대비 달라진 점은 [`IMPLEMENTATION.md`](./IMPLEMENTATION.md)를 참고하세요.

## 폴더 구조

```
orbit/
├─ extension/      # WXT + React + TypeScript + Tailwind (Chrome MV3 사이드패널)
├─ backend/        # FastAPI — 세션 API + AI 파이프라인 (A.X-K1 / Solar Pro 3 / embedding-query·embedding-passage, Qdrant)
├─ frontend/       # 웹 대시보드 (React + Vite)
└─ docker-compose.yml  # postgres + qdrant
```

## 실행

전체를 한 번에 띄우려면 (Docker + backend + extension + frontend):

```bash
./dev.sh                # Docker까지 포함해 전체 기동
./dev.sh --skip-docker  # Docker가 이미 떠 있는 경우
```

개별 실행:

```bash
# Backend
docker compose up -d postgres qdrant
cd backend
pip install -e .
cp .env.example .env   # UPSTAGE_API_KEY, AXK1_API_KEY 채우기
uvicorn app.main:app --reload

# Extension
cd extension
pnpm install
pnpm dev        # WXT dev 서버 → Chrome 에 확장 자동 로드

# 웹 대시보드
cd frontend
pnpm install
pnpm dev
```

확장 아이콘을 클릭하면 사이드패널이 열립니다. 프로덕션 번들은 `pnpm build`.

## 기술 스택

| 레이어 | 기술 |
|---|---|
| Extension UI | WXT, React 19, TypeScript, Tailwind v4, Zustand, TanStack Query, lucide-react |
| 웹 대시보드 | React 19, Vite, TypeScript, Tailwind v4, TanStack Query, Zustand |
| Backend | FastAPI, SQLAlchemy (async) + PostgreSQL, Pydantic v2 |
| 벡터 검색 | Qdrant |
| AI | SKT A.X-K1(primary) → Upstage Solar Pro 3(fallback), Solar Mini(경량 작업), Upstage embedding-query(검색)/embedding-passage(저장) |
