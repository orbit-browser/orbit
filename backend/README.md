# Orbit Backend (스켈레톤)

> ⚠️ 현재 **미구현** 상태입니다. 폴더 구조와 placeholder만 존재합니다.

프론트엔드는 지금 mock 데이터로 동작하며 백엔드를 필요로 하지 않습니다.
후속 단계에서 아래 구조를 채워 나갑니다.

## 예정 구조

```
backend/
└─ app/
   ├─ main.py        # FastAPI 진입점 (현재 /health 만 존재)
   ├─ api/           # REST 라우터 (/sessions, /search, /actions/plan ...)
   ├─ schemas/       # Pydantic v2 요청/응답 스키마
   ├─ services/      # 도메인 로직
   ├─ ai/            # Solar Pro 3 / A.X K1 / Solar Embedding / 클러스터링
   └─ db/            # SQLAlchemy 모델, 세션, Alembic 마이그레이션
```

## 예정 실행 (후속)

```bash
docker compose up -d                      # postgres + qdrant + redis (루트에서)
cd backend
uv sync                                   # 또는 pip install -e .
uvicorn app.main:app --reload
```

## 외부 연동 (후속)

- Upstage (OpenAI 호환): base `https://api.upstage.ai/v1`, chat `solar-pro3`,
  embedding `solar-embedding-1-large-query` / `-passage` (4096-dim)
- SKT A.X K1: 대회 제공 엔드포인트 (형태 확인 필요)
