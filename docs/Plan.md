# 도그푸딩 1차 피드백 수정 계획 (세션 최신성 정렬 · 후보 recency 컷 · 골든셋 확장)

**상태:** 완료 (2026-08-05) — 3번은 골든셋 확장까지 완료, 프롬프트 보강은 회귀로 반려(DecisionLog 참조)
**브랜치:** `fix/dogfood-session-recency`

> 이전 계획(Personal Exploration Memory 전환, feat/auto-session)은 2026-08-05 main 병합으로 완료. 내용은 git 이력 참조.

## 작업 목표

도그푸딩 첫날 발견된 3가지 문제를 수정하고 테스트 데이터를 정리한다.

1. append로 탭이 추가된 세션이 목록에서 옛 날짜(`created_at`)로 표시·정렬되어 아래에 묻힘
2. 벡터 유사 후보에 시간 제한이 없어 한 달 전 세션에 조용히 append됨
3. 스침 방문(대학 포털 로그인 3초, 서비스 홈 29초)이 discard되지 않고 세션에 혼입됨
4. 7/3 테스트 세션들이 실사용 데이터를 오염시킴 (사용자 삭제 승인 완료)

## 현재 상태와 조사 결과

- 세션 목록 API가 `created_at desc` 정렬 (`backend/app/api/sessions.py:178`), 응답에 `last_activity_at` 없음.
- 사이드패널·웹 대시보드 모두 `created_at`으로 timeLabel 생성 (`extension/lib/api.ts:111`, `frontend/src/lib/api.ts:61`).
- `sync_pipeline._fetch_candidates`: 최근 활성 후보는 24h 컷이 있으나 벡터 후보(top3)는 무제한. 후보 프롬프트 라인에 최근 활동 정보 없음.
- append 시 `last_activity_at`은 `session_updater`가 올바르게 갱신함 — 정렬·표시만 안 쓰는 상태.
- `DELETE /sessions/{id}`가 자식 행(`session_events`, `session_versions`)을 지우지 않음 — FK에 ON DELETE 없음 → 버전이 있는 세션(사실상 전부) 삭제 시 IntegrityError. 테스트 세션 삭제에 필요해 함께 수정.
- 실데이터 오분류: 이벤트 그룹(한밭대 로그인 3초 + Kaggle 홈 29초 + 네이버 항공권 3건)을 LLM이 전부 기존 항공권 세션에 append. 프롬프트 v2의 discard 예시가 SNS/포털 홈만 언급.

## 포함 범위

1. **최신성 정렬·표시** — 목록 정렬 `coalesce(last_activity_at, created_at) desc`, `SessionDetail.last_activity_at` 추가, 확장·프론트 timeLabel을 `last_activity_at ?? created_at` 기준으로.
2. **벡터 후보 recency 컷(7일)** + 후보 dict/프롬프트 라인에 "마지막 활동 N일 전" 표기(`last_activity_days_ago`, 없으면 생략). PROMPT_VERSION v2→v3.
3. **골든셋 확장** — 실데이터 케이스 `flight_rebooking_with_stray_visits.json` 추가, 평가 실행(사용자 승인됨). 실패 시 discard 예시 최소 보강 후 재평가.
4. **DELETE 세션 자식 행 정리** — session_events·session_versions 삭제 후 세션 삭제.
5. **데이터 정리** — 테스트 세션 삭제(7/3 전체 + 오늘 스모크 3건, 탭 내용 확인 후), 항공권 세션의 실이벤트 5건 pending 복귀 후 세션 삭제, 백엔드 재기동 후 수동 sync로 재세션화.

## 제외 범위

- 노이즈 사전 필터(오픈 결정 유지), Alembic 도입, 프론트 대시보드 구조 변경.

## 변경할 파일

- `backend/app/schemas/session.py` — SessionDetail.last_activity_at
- `backend/app/api/sessions.py` — 정렬, _to_detail, delete_session 자식 정리
- `backend/app/services/sync_pipeline.py` — 벡터 후보 recency 컷, 후보 dict 확장
- `backend/app/services/intent_analyzer.py` — 후보 라인 최근활동 표기, PROMPT_VERSION v3
- `backend/eval/golden/flight_rebooking_with_stray_visits.json` — 신규
- `backend/tests/test_sync_pipeline.py` 등 — 후보 포맷 테스트 갱신
- `extension/lib/api.ts`, `extension/lib/types.ts`, `extension/entrypoints/sidepanel/views/SessionDetailView.tsx`
- `frontend/src/lib/api.ts`, `frontend/src/lib/types.ts`

## 테스트 및 검증

- backend: `python -m pytest -p no:asyncio`
- extension: `pnpm test && pnpm compile && pnpm build`
- frontend: `pnpm build`
- 평가: `python -m eval.run_eval` (신규 시나리오 포함, 사용자 승인)
- 데이터 정리 후 수동 sync 스모크: 재세션화 결과에서 항공권 세션이 오늘 날짜로 생성되고 스침 방문이 discard되는지 확인

## 위험

- 프롬프트 보강 시 과교정(도구성 방문 오폐기) — 골든셋 전체 회귀로 확인.
- last_activity_at이 없는 스냅샷 세션은 created_at 기준으로 동작(의도된 fallback).

## 완료 조건

- 세션 목록이 마지막 활동 기준으로 정렬·표시된다.
- 7일 지난 세션은 벡터 후보로 올라오지 않는다.
- 신규 골든 시나리오 포함 평가 통과.
- 테스트 세션이 삭제되고 실이벤트 5건이 새 세션으로 재구성된다.
- WorkLog/DecisionLog/api-design-v2 문서 갱신.
