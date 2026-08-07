# Orbit

> 탐색 이벤트를 상시 기억하고, 세션으로 자동 재구성해 자연어로 되짚어보는 **Personal Exploration Memory**

Orbit은 브라우저 방문 이벤트를 opt-in 상시 수집해 로컬 큐에 쌓고, 동기화 시점에 배치로
LLM 의도 분석을 거쳐 탐색 세션을 자동 생성·성장(Auto Session)시키는 Chrome Extension +
FastAPI 백엔드 서비스입니다. "지금 열린 탭을 저장"하는 기존 스냅샷 흐름도 그대로 유지합니다.

## 핵심 기능

- **상시 이벤트 수집** — `webNavigation` 기반 방문 감지(opt-in, 기본 off), SW 종료에도
  안전한 IndexedDB 로컬 큐, 수동/주기/개수/유휴 4트리거 배치 동기화
- **Auto Session** — 배치마다 LLM이 이벤트 그룹을 append(기존 세션에 추가)/create(신규
  생성)/hold(보류)/discard(제외)로 판단해 세션을 사용자 개입 없이 자동 생성·갱신
- **Orbit 홈(새 탭)** — 크롬 새 탭을 대체하는 시작 화면. 브라우저 주소창과 같게 검색어는
  사용자의 기본 검색엔진으로, 주소는 그대로 이동한다. 검색창 아래에는 자주 방문한 사이트
  기반 **바로가기**(추가·삭제·접기 가능)가 붙는다
- **Orbit 아틀라스(`#/orbit-atlas`)** — 실제 세션을 중심 노드로, 방문 페이지를 시간순
  궤도로 그리는 두 번째 화면. 좌측 세션·페이지 네비게이터, 캔버스, 페이지 트레이,
  상세 패널이 백엔드 `/sessions`와 세션 이벤트 API를 사용한다
- **Exploration Timeline** — 사이드패널 기본 화면. 날짜별 이벤트 스트림 + 세션 배지 +
  수집/동기화 상태 카드, 세션 상세에서 탐색 경로를 시간순으로 복기
- **Search by Intent** — 세션(벡터 검색)과 관련 방문 기록을 함께 반환하는 통합 검색
  (`scope=memory`)
- **Ask AI** — 저장된 세션 요약과 실제 페이지 본문 조각을 근거로 답변을 스트리밍하고,
  답변 아래 관련 세션을 최대 3개까지 표시한다. 각 질문은 이전 답변을 참조하지 않는
  독립 단일턴이며, 질문·답변 목록은 `새 대화 시작하기` 전까지 화면 전환에도 유지한다
- **Exploration Analytics** — 주제별 탐색 시간과 자주 보는 도메인을 사이드패널 요약 카드에서 확인
- **세션 병합** — 같은 주제로 나뉜 세션을 사이드패널에서 확인해 개별 또는 일괄 병합하고,
  성공 직후 되돌릴 수 있다. 명백한 중복만 처리하는 자동병합은 설정에서 opt-in한다
- **기존 스냅샷 저장/복원 유지** — "지금 열린 탭 저장"(`POST /sessions/cluster`), 세션
  검색·복원, AI 요약(A.X-K1 ↔ EXAONE 상호 폴백), 임베딩 + Qdrant 벡터 검색, 민감
  도메인 자동 제외는 전환 이전과 동일하게 동작

세부 설계와 결정 근거는 [`docs/product-direction-v2.md`](./docs/product-direction-v2.md),
[`docs/target-architecture.md`](./docs/target-architecture.md), 초기 구현 이력은
[`IMPLEMENTATION.md`](./IMPLEMENTATION.md)를 참고하세요.

## 아키텍처 개요

```
[Extension]                              [Backend]
webNavigation 방문 감지                    POST /events (인제스트: 필터·정규화·검색어 추출)
  → 필터(시스템URL/opt-in)                    ↓
  → IndexedDB 로컬 큐(open→pending→          exploration_events (pending)
     syncing→synced)                          ↓
  → 4트리거(수동/주기/개수/유휴)            POST /sync → sync_pipeline.run_batch:
     동기화 엔진                               중복 병합 → 시간 그룹화(30분 gap)
                                               → 그룹별 후보 세션 검색(Qdrant + 최근 활성)
                                               → LLM 의도 분석(append/create/hold/discard)
                                               → session_updater(세션 생성/갱신)
                                               → 변경 세션만 요약(generate_summary 재사용)
                                                 + passage 임베딩 → Qdrant upsert
                                                    ↓
                            Timeline · Search(scope=memory) · Ask AI(SSE) · Analytics — 조회 계층
```

이 파이프라인은 Event Stream(수집) → Session Builder(그룹화·의도분석·세션갱신) →
Memory Store(`exploration_events`/`sessions`/`session_events`/`session_versions`) →
Embedding(기존 재사용) → 조회 계층(Timeline/Search/Analytics) 순으로 구성되며, 방문
이벤트 하나마다 LLM을 호출하지 않고 배치 단위로만 분석합니다.

## 폴더 구조

```
orbit/
├─ extension/      # WXT + React + TypeScript + Tailwind (Chrome MV3 새 탭 + 사이드패널)
│  └─ lib/events, lib/sync   # 이벤트 수집기·로컬 큐·동기화 엔진
├─ backend/        # FastAPI — 이벤트 인제스트, 배치 세션화, 세션 API, AI 파이프라인
│  ├─ app/services  # event_filter, grouper, intent_analyzer, session_updater,
│  │                # sync_pipeline, summarizer, embedding_sync
│  └─ eval/         # 세션 분류 평가 하네스 (골든셋 + run_eval.py)
└─ docker-compose.yml  # postgres + qdrant
```

## 실행

전체를 한 번에 띄우려면 (Docker + backend + extension):

```bash
./dev.sh                # Docker까지 포함해 전체 기동
./dev.sh --skip-docker  # Docker가 이미 떠 있는 경우
```

> **최초 1회**: 이벤트/세션 관련 테이블이 새로 추가되어 기존 로컬 DB 볼륨과 스키마가
> 맞지 않을 수 있습니다. 이전에 `docker compose up`을 실행한 적이 있다면 한 번은
> `docker compose down -v`로 볼륨을 초기화한 뒤 다시 올려주세요(로컬/데모 데이터가
> 1회 초기화됩니다). Alembic 없이 `create_all` + 멱등 ALTER 러너(`app/db/migrations.py`)로
> 이후 스키마 변경은 재기동만으로 반영됩니다.

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
```

확장 아이콘을 클릭하면 사이드패널이 열립니다. 프로덕션 번들은 `pnpm build`
(산출물 `extension/.output/chrome-mv3` → `chrome://extensions` > 개발자 모드 > 압축해제 로드).

설치하면 **새 탭이 Orbit 홈으로 대체**됩니다(`chrome_url_overrides.newtab`).
되돌리려면 확장을 비활성화하거나 `extension/entrypoints/newtab/`을 제거하고 다시 빌드하세요.

### 구글 로그인 설정 (필수)

Orbit 은 구글 계정 로그인이 **필수**입니다. 최초 1회 OAuth 클라이언트를 발급해야 합니다.

1. `chrome://extensions` 에서 확장을 로드하고 **확장 ID** 를 확인합니다.
2. [Google Cloud Console](https://console.cloud.google.com/apis/credentials) >
   사용자 인증 정보 > OAuth 클라이언트 ID 만들기
   - 애플리케이션 유형: **Chrome 확장 프로그램**
   - 항목 ID: 위에서 확인한 확장 ID
3. 발급된 클라이언트 ID 를 두 곳에 같은 값으로 넣습니다.

```bash
# backend/.env
GOOGLE_CLIENT_ID=<클라이언트 ID>
JWT_SECRET=$(python -c "import secrets; print(secrets.token_urlsafe(48))")

# extension/.env
VITE_GOOGLE_CLIENT_ID=<같은 클라이언트 ID>
```

4. `cd extension && pnpm build` 로 다시 빌드한 뒤 확장을 새로고침합니다.

`GOOGLE_CLIENT_ID` 가 비어 있으면 로그인 요청이 모두 거부됩니다.

익스텐션 권한: `tabs`, `storage`, `sidePanel`, `webNavigation`, `alarms`, `idle`,
그리고 새 탭 홈이 쓰는 `search`(사용자의 기본 검색엔진 사용),
`topSites`(바로가기 초기 목록), `favicon`(바로가기 아이콘 — 외부 요청 없음),
`identity`(구글 로그인).

### 테스트

```bash
# Backend
cd backend
python -m pytest -p no:asyncio

# Extension — 단위 테스트(vitest) + 타입 검사 + 빌드
cd extension && pnpm test && pnpm compile && pnpm build

# 세션 분류 평가 하네스 (실 LLM 호출, backend/.env 키 필요)
cd backend
python -m eval.run_eval
```

## 기술 스택

| 레이어 | 기술 |
|---|---|
| Extension UI | WXT, React 19, TypeScript, Tailwind v4, Zustand, TanStack Query, lucide-react |
| Extension 로컬 큐 | IndexedDB + `idb` |
| Backend | FastAPI, SQLAlchemy (async) + PostgreSQL, Pydantic v2 |
| 벡터 검색 | Qdrant |
| AI | SKT A.X-K1(요약·의도분석·리랭킹 primary), LG K-EXAONE(FriendliAI serverless, 클러스터링 primary) — 상호 폴백, Upstage embedding-query(검색)/embedding-passage(저장) |
