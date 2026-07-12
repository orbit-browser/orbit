# Orbit 1차 안정화 계획

**상태:** 완료 (2026-07-12)
**브랜치:** `fix/first-stabilization`

## 작업 목표

`docs/improvement-report.md`의 1차 안정화 항목 H1, H2, H3, H4, M1, L1을 구현해 AI 실패 상태, 검색 장애 표시, 민감정보 필터, 기동 복구의 데모 실패 경로를 제거한다. 완료 후 리포트를 상태 중심으로 읽기 쉽게 갱신한다.

## 현재 상태와 조사 결과

- 요약 서비스가 모든 예외를 규칙 기반 요약으로 바꿔 `summary_status=done`으로 기록한다.
- 정상 JSON이어도 빈 `overview`가 허용되어 상세 화면이 영구 pending처럼 보일 수 있다.
- Extension pending 폴러가 목록 캐시만 무효화하고 상세 캐시를 갱신하지 않는다.
- 검색 API 실패 뒤 세션 목록 조회도 실패하면 예외가 전달되지만 검색 화면은 오류 상태를 표시하지 않는다.
- 민감 도메인 정규식에 실제 국내 금융/결제 도메인이 누락되고 `.or.kr` 전체가 과도하게 차단된다.
- Extension manifest에 사용하지 않는 `bookmarks` 권한이 있다.
- 기동 복구가 세션마다 참조 없는 `asyncio.create_task`를 생성한다.
- 세션 제목 PATCH 요청은 DB 길이 100자를 API 경계에서 검증하지 않는다.

## 포함 범위

- H1/M4: 요약 오류 및 빈 overview를 실패 상태로 전파
- H2: pending 완료 시 목록과 상세 캐시 동시 갱신
- H3: Backend 전체 장애를 검색 빈 결과와 구분해 표시
- H4: 민감 도메인 목록 보강, `.or.kr` 전면 차단 제거, 미사용 권한 제거
- M1: 기동 복구 작업을 순차 실행하고 강한 참조 유지
- L1: PATCH 제목을 최대 100자로 검증
- 관련 Backend 단위 테스트 및 Extension 정적 검증
- 개선 리포트와 작업 기록 갱신

## 제외 범위

- D1/D3 세션 분류 고도화
- 검색 score threshold와 임베딩 내용 변경
- 대시보드 검색 동작 변경
- 인증, CORS, 저장 데이터 보관 정책 변경
- 기존 세션 데이터 마이그레이션

## 변경할 파일 또는 모듈

- `backend/app/services/summarizer.py`
- `backend/app/api/sessions.py`
- `backend/app/schemas/session.py`
- `backend/tests/test_summarizer.py`
- 필요한 경우 Backend API/복구 테스트 파일
- `extension/entrypoints/sidepanel/hooks/useSessions.ts`
- `extension/entrypoints/sidepanel/views/SearchView.tsx`
- `extension/lib/sensitive-domains.ts`
- `extension/wxt.config.ts`
- `docs/improvement-report.md`
- `docs/WorkLog.md`
- `docs/DecisionLog.md`

## 구현 순서

1. 요약 결과 계약과 PATCH 입력 검증을 강화하고 테스트한다.
2. `_ai_update` 실패 상태와 기동 복구 실행 방식을 수정한다.
3. Extension 상세 캐시 갱신과 검색 오류 UI를 수정한다.
4. 민감 도메인 판정과 manifest 권한을 수정한다.
5. Backend 테스트, Extension 타입 검사/빌드, Frontend 빌드를 실행한다.
6. 개선 리포트에 완료/잔여 상태와 검증 결과를 반영한다.
7. `WorkLog.md`, `DecisionLog.md`와 계획 상태를 갱신한다.

## 테스트 및 검증 방법

- `backend/.venv/Scripts/python.exe -m pytest` 또는 사용 가능한 프로젝트 Python으로 Backend 전체 테스트
- 요약 API 예외 전파와 빈 overview 거부 테스트
- PATCH 제목 100자/101자 경계 테스트
- 민감 도메인 판정은 별도 테스트 도구가 없어 TypeScript 검사와 대표 URL에 대한 실행 가능한 최소 검증을 우선한다.
- `pnpm compile` in `extension/`
- `pnpm build` in `extension/`
- `pnpm build` in `frontend/`
- `git diff --check`

## 위험과 결정 사항

- 검색 실패 시 로컬 fallback을 유지하되, 세션 목록까지 조회 불가능하면 명시적인 오류 상태를 표시한다. 이는 현재 API 계약을 깨지 않는다.
- 민감 도메인은 명시 목록을 사용하고 `.or.kr` 전체 차단을 제거한다. 정부 `.go.kr`와 의료/금융 기관의 명시 패턴은 유지한다.
- 규칙 기반 요약은 최초 저장 응답용으로 유지하지만 AI 처리 성공으로 기록하지 않는다.
- 복구 작업은 단일 순차 coroutine으로 실행해 외부 API 호출 폭주를 방지한다.

## 완료 조건

- AI 실패 및 빈 overview가 `failed`로 기록되고 임베딩이 실행되지 않는다.
- pending 상세 화면이 완료/실패 상태로 갱신된다.
- Backend 전체 장애가 검색 결과 없음으로 표시되지 않는다.
- 대표 민감 금융 도메인이 차단되고 일반 `.or.kr` 사이트는 차단되지 않는다.
- 기동 복구 작업이 순차 실행되고 참조가 유지된다.
- 101자 제목이 API 경계에서 거부된다.
- 관련 검증이 통과하고 문서가 실제 구현과 일치한다.

## 완료 결과

- H1, H2, H3, H4, M1, L1 구현을 완료했다.
- Backend 테스트 20개, Extension 타입 검사/빌드, Frontend 빌드를 통과했다.
- 대표 민감/일반 URL 판정을 실행해 기대 결과를 확인했다.
- 개선 리포트를 완료 상태와 잔여 우선순위 중심으로 재구성했다.
