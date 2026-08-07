# Ask AI 스트리밍 RAG + 독립 질문 누적

**상태:** 완료 (2026-08-07)
**브랜치:** `feat/ask-ai-streaming`

## 작업 목표

1. 기존 자연어 검색 UI를 실제 탐색 기록 기반 답변 생성 기능으로 확장한다.
2. 답변을 SSE 스트림으로 전달해 첫 토큰부터 점진적으로 표시한다.
3. 각 질문은 이전 질문·답변을 참조하지 않는 독립 단일턴으로 처리한다.
4. 독립 질문과 답변은 `새 대화 시작하기` 전까지 화면에 계속 누적하고, 다른 화면으로
   이동했다 돌아와도 같은 문서 수명 동안 유지한다.
5. 답변 근거로 사용한 관련 세션을 최대 3개까지 답변 아래 표시한다.

## 현재 상태와 조사 결과

- `GET /search?scope=memory`는 임베딩/Qdrant 검색, 선택적 LLM 리랭킹, 관련 이벤트 검색을 제공한다.
- 현재 사이드패널 Ask AI는 세션/이벤트 검색 결과만 표시하고 답변은 생성하지 않는다.
- 현재 새 탭 AI 모드는 첫 검색 결과의 Atlas로 바로 이동한다.
- `ExplorationEvent.content_excerpt`가 최대 5,000자 저장되지만 Memory 검색 응답에는 포함되지 않는다.
- 공용 LLM 어댑터는 A.X-K1 우선, EXAONE fallback과 호출 간격 제한을 제공하지만 스트리밍 함수는 없다.
- FastAPI/AsyncOpenAI 조합은 추가 의존성 없이 `StreamingResponse`와 `stream=True`를 사용할 수 있다.

## 사용자 결정

- 새 탭과 사이드패널 모두 스트리밍 답변을 제공한다.
- 출처는 답변 아래 관련 세션으로 표시한다.
- 대화는 DB나 브라우저 저장소에 저장하지 않고 extension 문서 수명 동안만 유지한다.
- 각 요청은 현재 질문만 포함하고 이전 질문·답변을 모델이나 retrieval에 전달하지 않는다.
- 질문·답변 목록은 화면 전환으로 컴포넌트가 언마운트돼도 유지하고,
  `새 대화 시작하기`를 눌렀을 때만 비운다.
- 새 탭 대시보드에서는 `AI에게 질문` 모드일 때만 누적 대화를 표시한다.
  `검색` 모드에서는 대화를 지우지 않고 기존 홈 콘텐츠를 표시한다.

## 포함 범위

- `POST /ask/stream` SSE API와 Pydantic 요청 계약
- 기존 검색을 재사용하는 관련 세션 최대 3개 retrieval
- 관련 세션의 요약 및 이벤트 `content_excerpt`를 이용한 제한된 RAG 컨텍스트
- 외부 페이지 본문의 prompt injection 방어 문구와 컨텍스트 길이 제한
- A.X-K1 우선 스트리밍, 첫 토큰 전 EXAONE fallback
- `sources`, `delta`, `done`, `error` SSE 이벤트
- extension 공용 스트리밍 파서/타입/문서 수명 대화 상태 스토어와 훅
- 사이드패널 Ask AI 대화 UI와 관련 세션 카드
- 새 탭 AI 답변 패널과 관련 세션 → Atlas 이동
- 취소, 재시도, 빈 근거, 부분 스트림 오류 처리
- 백엔드/extension 단위 테스트와 관련 문서 갱신

## 제외 범위

- 대화 DB 저장, 브라우저 재시작 복원, 서로 다른 Chrome 탭 간 동기화, 장기 대화 목록
- WebSocket, 토큰 사용량/비용 UI
- 질문으로 병합·삭제·설정 변경을 실행하는 agent action
- 이벤트 단위 임베딩 및 Qdrant 컬렉션 변경
- 인증·사용자 분리 정책 변경

## 변경할 파일 또는 모듈

- `backend/app/schemas/ask.py`
- `backend/app/api/ask.py`
- `backend/app/services/ask_service.py`
- `backend/app/ai/llm.py`
- `backend/app/main.py`
- `backend/tests/test_ask.py`, `backend/tests/test_llm.py` 또는 관련 테스트
- `extension/lib/types.ts`, `extension/lib/api.ts`
- `extension/entrypoints/shared/` 또는 공용 Ask UI/상태 모듈
- `extension/entrypoints/sidepanel/views/SearchView.tsx`
- `extension/entrypoints/newtab/App.tsx`, `components/sections/OrbitHero.tsx`
- 새 탭/사이드패널 스타일 및 테스트
- `README.md`, `docs/IA.md`, `docs/api-design-v2.md`
- `docs/DecisionLog.md`, `docs/WorkLog.md`

## 구현 순서

1. Ask 요청·SSE 이벤트·관련 세션 응답 계약을 정의한다.
2. retrieval과 프롬프트 구성을 순수/서비스 계층으로 구현하고 테스트한다.
3. LLM 스트리밍 어댑터와 첫 토큰 전 fallback을 구현한다.
4. FastAPI `StreamingResponse` 엔드포인트와 SSE 오류/취소 경로를 구현하고 테스트한다.
5. extension의 SSE 파서와 화면 전환에도 유지되는 단일턴 누적 상태를 구현하고 테스트한다.
6. 사이드패널과 새 탭 UI를 공용 계약에 연결한다.
7. 백엔드·extension 전체 테스트, 타입 검사, 빌드와 로컬 스트리밍 스모크를 수행한다.
8. IA/API/결정/작업 문서를 실제 구현에 맞춘다.

## 테스트 및 검증

```bash
cd backend && python -m pytest -p no:asyncio
cd extension && pnpm test && pnpm compile && pnpm build
```

- 관련 세션 0개/1개/3개 이상 retrieval
- 요청에 이전 질문·답변이 포함되지 않는지 검증
- 컨텍스트 길이 제한 및 본문 명령 비신뢰 처리
- SSE sources → delta* → done 정상 순서
- 첫 토큰 전 provider 실패 fallback, 첫 토큰 후 partial error
- 클라이언트 SSE 청크 경계 분할/복수 이벤트/잘못된 JSON 처리
- 사용자의 새 질문 및 컴포넌트 unmount 시 취소
- 관련 세션 클릭 시 사이드패널 상세/새 탭 Atlas 이동
- 백엔드 다운·검색 결과 없음·생성 실패·재시도 UI

## 위험과 대응

- 스트림 도중 provider를 바꾸면 중복 답변이 생길 수 있어 fallback은 첫 토큰 전에만 허용한다.
- 페이지 본문은 신뢰하지 않고 시스템 프롬프트에서 명령 무시를 강제하며 길이를 제한한다.
- SSE는 POST 요청이므로 native `EventSource` 대신 `fetch` + `ReadableStream`으로 파싱한다.
- 답변 근거는 관련 세션으로 제한한다. 세션에 연결되지 않은 이벤트는 이번 답변 컨텍스트에서 제외한다.
- 클라이언트 연결 종료 시 서버 생성 작업과 DB 세션이 정리되도록 async generator 취소를 전파한다.

## 완료 조건

- 양쪽 Ask AI 화면에서 답변이 점진적으로 표시된다.
- 각 질문은 이전 질문·답변 없이 독립적으로 처리된다.
- 화면 전환 후에도 누적 답변이 유지되고 `새 대화 시작하기`에서만 초기화된다.
- 새 탭의 검색 모드에서는 홈을, AI 모드에서는 보존된 대화 목록을 표시한다.
- 답변 아래 관련 세션 최대 3개가 표시되고 상세/Atlas 이동이 동작한다.
- 실패·취소·빈 근거 상태가 사용자에게 명확히 표시된다.
- 전체 backend/extension 검증이 통과한다.
- 관련 현재 문서, `DecisionLog.md`, `WorkLog.md`가 구현과 일치한다.

## 완료 결과

- backend 전체 테스트 298개, extension 전체 테스트 73개, 타입 검사와 프로덕션 빌드가 통과했다.
- 현재 브랜치 코드로 로컬 백엔드를 재시작하고 `/health` 200을 확인했다.
- 실제 세션을 지정한 Ask 요청에서 `sources → delta* → done` 순서를 확인했다.
- Chrome 확장 재로드 후 실제 화면의 레이아웃·취소 상호작용을 눈으로 확인하는 작업은 수동 확인으로 남긴다.
