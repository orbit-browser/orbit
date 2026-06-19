# Orbit

> 탐색의 흐름을 기억하고, 원하는 순간에 복원하는 **AI Browser Agent**

Orbit은 브라우저에 열린 탭들을 AI가 의미별로 분류해 **작업 세션**으로 저장하고, 자연어로 다시 찾아 복원하는 Chrome Extension 기반 서비스입니다.

## 현재 상태

이 저장소는 초기 스캐폴딩 단계입니다.

- ✅ **Extension 프론트엔드** — 디자인 목업 기준 UI 구현 (현재 **mock 데이터**로 동작)
- 🚧 **Backend (FastAPI)** — 폴더 스켈레톤만 존재, 미구현
- 🚧 **AI 파이프라인 / DB** — 후속 단계

전체 기술 스택과 단계 계획은 도전제안서(`orbit도전제안서.pdf`)와 `ppt.md`를 참고하세요.

## 폴더 구조

```
orbit/
├─ extension/      # WXT + React + TypeScript + Tailwind (Chrome MV3 사이드패널)
├─ backend/        # FastAPI 스켈레톤 (미구현)
└─ docker-compose.yml  # postgres + qdrant + redis (후속 단계용)
```

## 프론트엔드 실행

```bash
cd extension
pnpm install
pnpm dev        # WXT dev 서버 → Chrome 에 확장 자동 로드
```

확장 아이콘을 클릭하면 사이드패널이 열립니다. 프로덕션 번들은 `pnpm build`.

## 기술 스택

| 레이어 | 기술 |
|---|---|
| Extension UI | WXT, React 19, TypeScript, Tailwind v4, Zustand, TanStack Query, lucide-react |
| Backend (후속) | Python, FastAPI, SQLAlchemy, PostgreSQL |
| Vector / 캐시 (후속) | Qdrant, Redis |
| AI (후속) | Upstage Solar Pro 3 · Solar Embedding, SKT A.X K1 |
