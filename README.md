# Orbit

> 탐색 이벤트를 상시 기억하고, 세션으로 자동 재구성해 자연어로 되짚어보는 **Personal Exploration Memory**

> **2026년도 인공지능 루키(AI Rookie) 대회 · 국내 AI 트랙 출품작**
> 세션 의도 분석 · 요약 · 답변 · 검색까지 AI 파이프라인 전 구간을 SKT A.X-K2,
> LG K-EXAONE, Upstage 임베딩으로 구성했습니다. 어느 단계에 어떤 모델이 쓰이는지는
> [국내 AI 모델 활용](#국내-ai-모델-활용), 브라우저 데이터를 어디까지 수집하고
> 무엇을 외부로 보내지 않는지는 [데이터 처리와 프라이버시](#데이터-처리와-프라이버시)에
> 정리했습니다.

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
- **열린 탭 찾기·북마크** — Ask AI에 “아까 보던 영상으로 돌아가자”처럼 자연스럽게 입력하면
  열린 탭의 제목·호스트·경로를 의미 검색해 가장 가까운 탭으로 이동한다. 세션 화면의 접힌 보조 도구에서는 탭을 직접 검색하거나
  선택한 탭을 Chrome ‘기타 북마크’에 중복 없이 일괄 추가할 수 있다
- **Search by Intent** — 세션(벡터 검색)과 관련 방문 기록을 함께 반환하는 통합 검색
  (`scope=memory`)
- **Ask AI** — 저장된 세션 요약과 실제 페이지 본문 조각을 근거로 답변을 스트리밍하고,
  답변 아래 관련 세션을 최대 3개까지 표시한다. 최근 답변 3턴을 이어서 이해해 후속 질문("그중…",
  "그럼 9070은?")에 답하며, 질문·답변 목록은 `새 대화 시작하기` 전까지 화면 전환에도 유지한다.
  통합 의도 라우터가 열린 탭 이동·세션 찾기·전체 기록 내용 검색·특정 세션 내용 검색을
  구분한다. 내용 질문은 관련 세션 안의 페이지도 질문별로 다시 의미 랭킹하며, 정확한 탭 이름은
  extension 로컬에서 즉시 처리하고 간접 이동은 탭 전용 resolver로 한 번 더 검증한다. 비슷한
  탭이 여러 개면 자동 이동하지 않고 최대 3개 후보를 표시해 사용자가 선택한다
- **Exploration Analytics** — 주제별 탐색 시간과 자주 보는 도메인을 사이드패널 요약 카드에서 확인
- **세션 병합** — 같은 주제로 나뉜 세션을 사이드패널에서 확인해 개별 또는 일괄 병합하고,
  성공 직후 되돌릴 수 있다. 명백한 중복만 처리하는 자동병합은 설정에서 opt-in한다
- **팀 워크스페이스(1단계, 세션 공유형)** — 설정에서 팀을 만들고 초대 코드로 팀원을 부른다.
  개인 세션을 펼쳐 ‘팀에 공유’를 누르면 그 세션만 팀에 보인다. 사이드패널·아틀라스 상단의
  범위 선택으로 팀을 고르면 팀에 공유된 세션을 읽기 전용으로 보고, Ask AI도 그 세션만 근거로
  답한다. 개인 기록은 그대로 나만 본다(`docs/api-design-v2.md` §14)
- **기존 스냅샷 저장/복원 유지** — "지금 열린 탭 저장"(`POST /sessions/cluster`), 세션
  검색·복원, AI 요약(A.X-K2 → EXAONE 폴백), 임베딩 + Qdrant 벡터 검색, 민감
  도메인 자동 제외는 전환 이전과 동일하게 동작

세부 설계와 결정 근거는 [`docs/product-direction-v2.md`](./docs/product-direction-v2.md),
[`docs/target-architecture.md`](./docs/target-architecture.md), 초기 구현 이력은
[`IMPLEMENTATION.md`](./IMPLEMENTATION.md)를 참고하세요.

## 국내 AI 모델 활용

대회 연계기업 5곳(KT, LG AI연구원, NC AI, SKT, 업스테이지) 가운데 **SKT · LG AI연구원 ·
업스테이지** 3곳의 모델을 사용합니다. 파이프라인의 LLM·임베딩 호출은 전부 국내 모델이며,
외산 LLM을 호출하는 코드 경로는 없습니다.

| 파이프라인 단계 | Primary | Fallback | 구현 |
|---|---|---|---|
| 세션 의도 분석(append/create/hold/discard) | SKT A.X-K2 | LG K-EXAONE | `ai/llm.py: chat_completion_intent` |
| 탭 클러스터링(스냅샷 저장) | SKT A.X-K2 | LG K-EXAONE | `ai/llm.py: chat_completion_light` |
| 세션 요약·제목 생성 | SKT A.X-K2 | LG K-EXAONE | `ai/llm.py: chat_completion` |
| Ask AI 답변 스트리밍 | SKT A.X-K2 | LG K-EXAONE | `ai/llm.py: chat_completion_stream_with_meta` |
| 검색·추천 리랭킹 | SKT A.X-K2 | LG K-EXAONE | `ai/reranker.py`, `services/recommender/llm_rerank.py` |
| 저장 임베딩 | Upstage `embedding-passage` | — | `services/embedding_sync.py` |
| 검색·의도 라우팅 임베딩 | Upstage `embedding-query` | — | `services/ask_service.py`, `services/assistant_router.py` |

- **폴백** — 모든 LLM 단계의 1순위는 A.X-K2, 대체는 K-EXAONE이다. 역할별 평가(model-eval-v1)에서
  의도 분석은 A.X-K2가 정확도 +8.8%p·JSON 유효율 100%(EXAONE 87.4%)로 앞섰고, 요약·리랭킹·Ask는
  EXAONE이 비열등을 보이지 못했다(근거: `docs/DecisionLog.md` 2026-10-22). 한 공급자가 중단돼도 기능은 유지된다.
- **호출 제약 대응** — A.X 게이트웨이의 3 RPS 제한 때문에 LLM 호출은 전역 레이트 리미터
  (`ai/llm.py: _throttle`)로 직렬화한다. 방문 이벤트마다 LLM을 호출하지 않고 동기화
  시점에 배치로만 분석하는 설계도 같은 제약에서 나왔다.
- **EXAONE 서빙 경로** — K-EXAONE을 FriendliAI dedicated endpoint(팀 전용, B200×2)로
  호출한다. FriendliAI serverless가 2026-08-20 K-EXAONE 제공을 끝내 dedicated로 옮겼다.
  `EXAONE_MODEL` 에는 모델명 대신 endpoint ID를 넣는다. K-EXAONE은 hybrid reasoning 모델이라 분류·요약
  용도에서는 `enable_thinking=False`로 추론 트레이스를 끈다(끄지 않으면 `max_tokens`를
  트레이스에 소모하고 본문이 비어 온다 — 2026-08-05 실측).
- **`openai` 패키지에 대한 주의** — 백엔드는 `openai` Python SDK를 쓰지만 OpenAI 호환
  클라이언트로만 사용하며, `base_url`은 각각 SKT A.X 게이트웨이 · FriendliAI · Upstage를 가리킨다.

## 데이터 처리와 프라이버시

브라우저 방문 이벤트를 다루는 서비스라 수집 범위를 기본값에서부터 좁게 잡았습니다.
아래는 코드 기준 실제 동작입니다(`extension/lib/settings.ts`,
`extension/lib/events/collector.ts`, `backend/app/services/event_filter.py`).

| 설정 | 기본값 | 동작 |
|---|---|---|
| `collectionEnabled` | **off** | 켜기 전까지 방문 이벤트를 한 건도 수집하지 않는다(opt-in) |
| `contentCapture` | on | 페이지 본문 발췌 수집. 끄면 제목·URL만 남는다 |
| `excludeSensitive` | on | 민감 도메인·경로의 **본문을 수집하지 않는다** |
| `autoSyncEnabled` | off | 자동 동기화도 opt-in. 끄면 수동 동기화만 동작한다 |

- **수집 대상 제한** — `http`/`https`만 수집한다. `chrome://`, `about:`,
  `chrome-extension://` 등은 수집기 진입 단계에서 걸러진다.
- **민감 정보 처리** — 금융 도메인, 정부 개인 서비스(정부24·홈택스 등), 인증 경로(`/login`, `/auth` 등)는 **본문만 제거하고
  방문 이벤트(제목·URL)는 남긴다.** 세션 복원을 유지하기 위한 절충이며 완전 미수집이
  아니다. 판정 규칙은 확장(`lib/sensitive-domains.ts`)과 백엔드
  (`services/event_filter.py`)에 같은 의미로 이중 구현해, 확장을 우회한 요청도 서버에서
  다시 걸러진다.
- **URL 정규화** — 추적 파라미터(`utm_*`, `gclid`, `fbclid`)는 인제스트 시점에 제거한다.
- **로컬 우선 큐** — 이벤트는 IndexedDB 로컬 큐에 먼저 쌓이고
  (`open→pending→syncing→synced`), 동기화가 성공한 뒤에만 정리된다. MV3 서비스 워커가
  종료돼도 유실되지 않으며, 동기화 전까지 데이터는 기기를 벗어나지 않는다.
- **외부로 나가는 데이터** — 동기화 시점에 이벤트의 제목·URL·본문 발췌가 의도 분석과
  요약을 위해 LLM API로, 이벤트의 제목·도메인·검색어가 서브클러스터링을 위해, 세션 요약이
  검색 색인을 위해 임베딩 API로 전송된다. 그 외 경로는 아래 예외뿐이다.
- **탭 이동 질의의 예외** — Ask AI에 탭 이동 가능성이 있는 입력을 넣으면 현재 일반 창
  탭의 제목·URL이 의미 매칭을 위해 백엔드와 Upstage 임베딩 API로 전송된다. 이 후보는
  DB나 Qdrant에 저장하지 않으며, `excludeSensitive`가 켜져 있으면 민감 URL은 후보에서도
  제외된다.
- **팀 공유 범위** — 팀에는 사용자가 직접 고른 세션만 들어가고, 개인 기록이 자동으로 팀에
  넘어가는 경로는 없다. 공유는 원본을 가리키는 라이브 참조라 **공유 뒤 그 세션에 추가되는 페이지도
  팀에 보이며**, 팀원은 제목·요약·페이지 목록을 보고 팀 Ask에서 페이지 본문 발췌가 근거로 쓰인다.
  공유 해제·탈퇴·팀 삭제 즉시 팀에서 사라진다. 자동병합은 공유 중인 세션을 건드리지 않는다.
  팀 기능은 팀원이 같은 백엔드에 접속해야 하며, 공용 서버 배포는 아직 정하지 않았다.

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
cp .env.example .env   # 값은 아래 "백엔드 환경변수" 참고
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

### 백엔드 환경변수

`backend/.env.example` 을 `backend/.env` 로 복사해 채웁니다.
AI 키 3종은 모두 필요합니다.

```bash
AXK1_API_KEY=<SKT A.X 키>          # 모든 LLM 단계 primary(AXK1_MODEL 기본 A.X-K2)
FRIENDLI_API_KEY=<FriendliAI 키>   # LG K-EXAONE — 모든 LLM 단계 fallback
UPSTAGE_API_KEY=<Upstage 키>       # 임베딩(저장·검색)
```

EXAONE은 FriendliAI dedicated endpoint로 호출하므로 `EXAONE_MODEL` 에 endpoint ID가 들어갑니다.
기본값은 팀 endpoint이고, 다른 Friendli 팀의 키로는 403이 납니다. 그때는
`curl -H "Authorization: Bearer $FRIENDLI_API_KEY" https://api.friendli.ai/dedicated/beta/endpoint`
로 자기 endpoint ID를 확인해 바꿉니다.

`GOOGLE_CLIENT_ID` 와 `JWT_SECRET` 은 아래 구글 로그인 설정에서 함께 채웁니다.
루트 `.env.example` 은 확장이 쓰는 `VITE_API_BASE_URL` 만 담고 있어 백엔드용이 아닙니다.

키가 비면 다음과 같이 동작합니다.

- `UPSTAGE_API_KEY` 없음 → 임베딩에는 폴백 공급자가 없어 요청이 그대로 실패한다. 검색과
  Ask AI 뿐 아니라 배치 세션화(서브클러스터링·세션 후보 탐색)까지 멈추므로 Auto Session이
  동작하지 않는다.
- `FRIENDLI_API_KEY` 없음 → EXAONE 클라이언트 생성 단계에서 예외가 나므로 모든 단계의
  폴백이 사라진다. 기능은 도는 것처럼 보이지만 **국내 AI 2종 병행 구성이 실제로는
  1종으로 축소된 상태**이므로 시연 전에 반드시 확인한다.
- `AXK1_API_KEY` 없음 → 모든 LLM 단계가 매번 EXAONE 폴백으로 처리된다.

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
# .env 는 셸이 아니므로 $(...) 를 그대로 적지 말고, 아래 명령의 출력값을 붙여 넣는다.
#   python -c "import secrets; print(secrets.token_urlsafe(48))"
JWT_SECRET=<위 명령의 출력값>

# extension/.env
VITE_GOOGLE_CLIENT_ID=<같은 클라이언트 ID>
```

4. `cd extension && pnpm build` 로 다시 빌드한 뒤 확장을 새로고침합니다.

`GOOGLE_CLIENT_ID` 가 비어 있으면 로그인 요청이 모두 거부됩니다.

익스텐션 권한: `tabs`, `storage`, `sidePanel`, `webNavigation`, `alarms`, `idle`,
그리고 새 탭 홈이 쓰는 `search`(사용자의 기본 검색엔진 사용),
`topSites`(바로가기 초기 목록), `favicon`(바로가기 아이콘 — 외부 요청 없음),
`identity`(구글 로그인).
`bookmarks`는 사용자가 체크한 열린 탭을 Chrome 기본 북마크에 추가하고 기존 중복을
확인하는 데 사용하며, 설치 시 “북마크 읽기 및 변경” 권한 경고가 표시됩니다.
탭 이동 가능성이 있는 Ask AI 입력은 현재 일반 창 탭의 제목과 URL을 의미 매칭을 위해
로컬 백엔드와 Upstage 임베딩 API에 전송합니다. 이 후보는 DB나 Qdrant에 저장하지 않습니다.
`민감 도메인 제외`가 켜져 있으면 해당 URL은 의미 검색 후보에서도 제외됩니다.

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

백엔드 테스트는 외부 API를 대역 처리하지만
`tests/test_llm_stream.py::test_stream_falls_back_before_first_token` 하나는 예외입니다 —
스트림 함수만 mock 하고 클라이언트 생성은 mock 하지 않아, `FRIENDLI_API_KEY` 가 비어 있으면
openai SDK 가 클라이언트 생성 단계에서 `Missing credentials` 예외를 던져 실패합니다.
`backend/.env` 에 키가 채워져 있으면 통과합니다.

## 기술 스택

| 레이어 | 기술 |
|---|---|
| Extension UI | WXT, React 19, TypeScript, Tailwind v4, Zustand, TanStack Query, lucide-react |
| Extension 로컬 큐 | IndexedDB + `idb` |
| Backend | FastAPI, SQLAlchemy (async) + PostgreSQL, Pydantic v2 |
| 벡터 검색 | Qdrant |
| AI | SKT A.X-K2(모든 LLM 단계 primary), LG K-EXAONE(FriendliAI dedicated endpoint — fallback), Upstage embedding-query(검색)/embedding-passage(저장). 단계별 배정은 [국내 AI 모델 활용](#국내-ai-모델-활용) 참고 |
