# Orbit P2 검색 정확도 및 오류 계약 계획

**상태:** 완료 (2026-07-12)
**브랜치:** `fix/first-stabilization`
**선행 커밋:** `930a5ce` (1차 안정화)

## 작업 목표

무관한 자연어 검색에서 억지 결과가 반환되는 문제를 줄이고, 제목 키워드 검색을 강화하며, 임베딩 서비스와 Qdrant 장애를 구분 가능한 안전한 API 오류로 제공한다.

## 현재 상태와 조사 결과

- Qdrant `query_points` 호출에 `score_threshold`가 없어 유사도가 낮아도 top-N을 반환한다.
- Qdrant Client 1.18의 `query_points`는 `score_threshold: float | None`을 지원한다.
- 저장 임베딩 입력은 overview, purpose, highlights만 포함하고 세션 제목은 제외한다.
- 검색 임베딩과 Qdrant 예외가 모두 처리되지 않아 일반 500 응답으로 노출된다.
- Extension은 검색 API 실패 시 로컬 substring 검색으로 fallback하고, Backend 전체 장애는 별도 오류 UI로 표시한다.
- 기존 Qdrant 포인트는 새 임베딩 입력으로 자동 재색인되지 않는다.

## 포함 범위

- 저장 임베딩 입력에 세션 제목 포함
- Qdrant score threshold 적용
- threshold를 `SEARCH_SCORE_THRESHOLD` 환경변수로 설정
- 임베딩 timeout, 연결, upstream 상태, 응답 형식 오류 구분
- Qdrant 검색 장애를 503으로 변환
- threshold 전달과 검색 오류 응답 단위 테스트
- Backend README, env 예시, 개선 리포트, 작업/결정 로그 갱신

## 제외 범위

- 실제 사용자 골든셋 수집과 threshold 재튜닝
- 기존 Qdrant 포인트 자동 재색인
- Extension/Frontend 검색 UI 추가 변경
- 리랭커 프롬프트 변경
- API 인증 및 CORS 변경

## 변경할 파일 또는 모듈

- `backend/app/config.py`
- `backend/app/api/sessions.py`
- `backend/app/api/search.py`
- `backend/app/db/vector.py`
- `backend/.env.example`
- `backend/tests/test_vector.py`
- `backend/tests/test_search.py`
- `backend/README.md`
- `docs/Plan.md`
- `docs/DecisionLog.md`
- `docs/WorkLog.md`
- `docs/improvement-report.md`

## 구현 순서

1. threshold 설정 계약을 추가한다.
2. Qdrant 검색 호출에 threshold를 전달하고 단위 테스트한다.
3. 저장 임베딩 입력에 제목을 추가한다.
4. 검색 API에서 외부 임베딩 오류와 Qdrant 오류를 분리한다.
5. 정상, timeout, upstream, Qdrant 장애 테스트를 추가한다.
6. Backend 전체 테스트와 Extension/Frontend 빌드를 실행한다.
7. 설정과 기존 인덱스 적용 범위를 문서화한다.

## 테스트 및 검증 방법

- `python -m pytest -p no:asyncio` in `backend/`
- Qdrant mock client에 `score_threshold=0.35`가 전달되는지 확인
- 검색 임베딩 timeout은 504, 연결 실패는 503, upstream/응답 오류는 502인지 확인
- Qdrant 검색 실패는 503인지 확인
- Extension compile/build와 Frontend build로 API 호환성 확인
- `git diff --check`

## 위험과 결정 사항

- 기본 threshold는 `0.35`로 시작한다. 실제 검색 골든셋 없이 확정값으로 간주하지 않고 환경변수로 조정한다.
- API 오류 메시지는 영어 ASCII 고정 문구로 제공하고 외부 응답 본문과 키를 노출하지 않는다.
- 제목 임베딩은 신규 세션과 요약 재처리 세션부터 적용한다. 기존 포인트 재색인은 별도 운영 작업으로 남긴다.
- threshold가 너무 높으면 관련 결과가 누락되고, 너무 낮으면 무관한 결과가 남을 수 있다.

## 완료 조건

- Qdrant 검색에 설정된 threshold가 전달된다.
- 새로 생성하거나 재처리한 세션의 임베딩에 제목이 포함된다.
- 임베딩과 벡터 저장소 오류가 일반 500이나 내부 상세 노출 없이 구분된다.
- 관련 테스트와 빌드가 통과한다.
- README, env 예시, 개선 리포트와 작업 로그가 실제 구현과 일치한다.

## 완료 결과

- score threshold 설정과 Qdrant 전달 계약을 구현했다.
- 제목이 포함된 저장 임베딩 텍스트를 구현했다.
- 임베딩 및 Qdrant 오류 응답을 구분했다.
- Backend 테스트 28개, Extension 타입 검사/빌드, Frontend 빌드를 통과했다.
- 기본값 `0.35`의 골든셋 실측과 기존 포인트 재색인은 후속 작업으로 남겼다.
