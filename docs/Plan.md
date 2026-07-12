# Orbit 작업 계획

**상태:** 완료 (2026-07-12)

## 작업 목표

`AGENTS.md`가 요구하는 필수 프로젝트 문서를 생성하고, 이후 구현 작업이 동일한 맥락과 절차를 따를 수 있는 기본 문서 체계를 마련한다.

## 현재 상태와 조사 결과

- 저장소는 Chrome Extension, FastAPI Backend, React 웹 대시보드로 구성되어 있다.
- 세션 저장, LLM 요약, 벡터 검색, 세션 복원 기능이 구현되어 있다.
- `docs/`에는 개선점 리포트만 있고 `AGENTS.md`의 필수 문서 10종은 모두 누락되어 있다.
- `README.md`, `IMPLEMENTATION.md`, `ppt.md`, `docs/improvement-report.md`에 프로젝트 맥락과 구현 현황이 분산되어 있다.
- 작업 트리의 `AGENTS.md`, `CLAUDE.md`, `docs/improvement-report.md` 변경은 사용자 작업이므로 수정하지 않는다.

## 포함 범위

- 필수 문서 10종의 초기 버전 생성
- 기존 문서에서 확인한 프로젝트 목표, 구조, 사용자 흐름, 주요 결정 반영
- 이후 구현 작업에서 갱신할 수 있는 명확한 섹션과 기록 형식 제공

## 제외 범위

- 애플리케이션 코드, API, 데이터 모델, 설정 변경
- `README.md`, `IMPLEMENTATION.md`, `ppt.md`, 개선점 리포트 정리
- 개선점 리포트에 제안된 기능 또는 버그 수정 구현
- Git 커밋, push, PR 생성

## 변경할 파일

- `docs/ProjectContext.md`
- `docs/Plan.md`
- `docs/IA.md`
- `docs/UserScenarios.md`
- `docs/Personas.md`
- `docs/DecisionLog.md`
- `docs/WorkLog.md`
- `docs/Process.md`
- `docs/ReviewChecklist.md`
- `docs/Research.md`

## 구현 순서

1. 프로젝트 배경과 현재 제약을 `ProjectContext.md`에 정리한다.
2. 화면 구조, 사용자 시나리오, 페르소나를 각각 독립 문서로 작성한다.
3. 확인된 주요 기술 결정을 `DecisionLog.md`에 기록한다.
4. 표준 작업 절차와 완료 체크리스트를 작성한다.
5. 기존 기술 조사와 추가 검증 대상을 `Research.md`에 구분해 기록한다.
6. 생성 작업과 검증 결과를 `WorkLog.md`에 기록한다.

## 테스트 및 검증 방법

- 필수 문서가 모두 존재하는지 파일 목록으로 확인한다.
- 각 문서에 필수 목적에 맞는 섹션이 있는지 확인한다.
- Markdown 제목 구조와 로컬 링크를 점검한다.
- `git diff --check`로 공백 오류를 검사한다.
- 코드 변경이 없으므로 애플리케이션 테스트와 빌드는 실행하지 않는다.

## 위험과 사용자 결정이 필요한 사항

- 세션 분류 단위, 기존 세션 병합, 원문 보관 기간, 외부 배포 보안 정책은 아직 제품 결정이 필요하다.
- 이번 작업에서는 해당 항목을 결정하지 않고 열린 결정으로 기록한다.
- 기존 문서 간 구현 현황 불일치는 별도 문서 정합화 작업에서 처리한다.

## 완료 조건

- `AGENTS.md`에 명시된 필수 문서가 모두 생성되어 있다.
- 각 문서가 현재 저장소에서 확인 가능한 사실과 열린 결정을 구분한다.
- 기존 사용자 변경과 애플리케이션 코드를 건드리지 않는다.
- 문서 생성 내역과 검증 결과가 `WorkLog.md`에 기록되어 있다.

## 완료 결과

- 필수 문서 10종을 모두 생성했다.
- 필수 파일 존재 여부와 최상위 Markdown 제목을 확인했다.
- `git diff --check`를 통과했다.
- 애플리케이션 코드는 변경하지 않았다.
