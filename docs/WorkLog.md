# Orbit 작업 기록

작업, 오류, 원인, 해결 과정과 실제 검증 결과를 시간순으로 기록한다.

## 2026-07-12 — 필수 프로젝트 문서 초기 세팅

### 요청

`AGENTS.md`를 읽고 해당 규칙에 필요한 파일을 세팅한다.

### 조사

- `AGENTS.md` 전체를 확인했다.
- `docs/`에는 `improvement-report.md`만 존재했다.
- `README.md`, `IMPLEMENTATION.md`, `ppt.md`, 개선점 리포트에서 프로젝트 목표와 현재 구현을 확인했다.
- 작업 시작 시 사용자 변경 파일은 `CLAUDE.md`, `docs/improvement-report.md`, 새 `AGENTS.md`였다.

### 변경

- 필수 문서 10종의 초기 버전을 생성했다.
- 프로젝트 목표, 정보 구조, 사용자 시나리오, 페르소나를 분리해 기록했다.
- 확인된 기술 결정과 아직 사용자 결정이 필요한 항목을 구분했다.
- 작업 프로세스와 완료 체크리스트를 추가했다.

### 오류와 해결

- 없음.

### 검증

- 필수 문서 10종의 존재 여부를 확인했다: 모두 존재.
- 각 문서의 최상위 Markdown 제목을 확인했다: 모두 존재.
- `git diff --check`를 실행했다: 오류 없음.
- 애플리케이션 코드를 변경하지 않아 테스트와 빌드는 실행하지 않는다.

## 2026-07-12 — 1차 안정화

### 요청

개선 리포트의 1차 안정화 항목을 구현하고 리포트를 읽기 쉽게 갱신한다.

### 변경

- AI 요약 오류와 빈 overview를 실패 상태로 전파했다.
- pending 폴러가 목록과 상세 캐시를 함께 갱신하도록 수정했다.
- Backend 전체 장애를 검색 빈 결과와 구분해 표시했다.
- 실제 국내 금융/결제 도메인을 보강하고 `.or.kr` 전면 차단과 미사용 `bookmarks` 권한을 제거했다.
- 기동 복구 작업을 참조가 유지되는 단일 순차 task로 변경했다.
- PATCH 제목의 최대 길이를 100자로 검증했다.
- 개선 리포트를 완료 상태와 다음 우선순위 중심으로 재구성했다.

### 오류와 해결

- 첫 검증 명령이 잘못된 작업 디렉터리와 PowerShell 실행 정책 때문에 실패했다. 저장소 루트와 `pnpm.cmd`를 사용하도록 수정했다.
- 시스템 Python에 `qdrant_client`가 없어 테스트 수집이 실패했다. `python -m pip install -e 'backend[dev]'`로 선언된 의존성을 설치했다.
- 설치된 pytest 9와 전역 pytest-asyncio 0.23.3이 충돌했다. 테스트가 `asyncio.run()` 기반이라 `-p no:asyncio`로 불필요한 플러그인을 제외했다.
- Extension에 선언된 Readability 패키지가 로컬에 설치되지 않아 타입 검사가 실패했다. lockfile 기준으로 의존성을 설치하고 재실행했다.

### 검증

- `python -m pytest -p no:asyncio`: 20 passed.
- `pnpm.cmd compile` (`extension/`): 통과.
- `pnpm.cmd build` (`extension/`): 통과.
- `pnpm.cmd build` (`frontend/`): 통과.
- 대표 민감 URL 5개와 일반 URL 2개의 `isSensitiveUrl` 판정: 통과.
- `git diff --check`: 최종 변경 후 통과.
