# 노이즈 사전 필터 (결정적 규칙) + discarded 이벤트 Timeline 뱃지

**상태:** 완료 (2026-08-05) — 골든셋 노이즈 제외율 100% 결정적 달성, 전 검증 통과
**브랜치:** `fix/dogfood-session-recency` (도그푸딩 피드백 후속 — 같은 브랜치에서 이어서 작업)

> 직전 계획(도그푸딩 1차 피드백 수정)은 완료·커밋됨(6fecbf4).

## 작업 목표

A.X-K1 비결정성으로 프롬프트로는 못 잡는 스침 방문 혼입을, LLM 호출 전 결정적 규칙으로
차단한다(DecisionLog "프롬프트 추가 보강 반려" 후속, 사용자 승인 2026-08-05).
discard된 이벤트는 Timeline에 계속 보이되 "제외됨" 뱃지를 단다(사용자 결정).

## 설계 (사용자 승인안)

구제 조건(하나라도 해당하면 규칙 무시하고 LLM에 전달):
- search_query 존재
- 그룹 내 같은 도메인 이벤트 2건 이상
- 체류시간 미측정(None) — 불확실하면 버리지 않는다

discard 규칙:
1. **인증/로그인 경로**: 경로 세그먼트가 login/signin/logon/logout/sso/auth/2fa로 시작 && 체류 < 60초
2. **습관성 도메인**: SNS 피드·쇼츠·포털 홈 목록(루트/피드 URL만) && 체류 < 60초
3. **고립 루트 방문**: 경로가 루트(`/`) && 체류 ≤ 30초 && 그룹 내 유일 도메인

hold 정책 변경: hold_count 상한 도달 시 강제 create 대신 —
체류 < 60초 && 검색어 없음이면 discard, 아니면 create.

Timeline 노출: `GET /events?date=`가 discarded 이벤트도 반환하고 `excluded: true` 필드를
추가. 사이드패널 Timeline은 excluded 이벤트에 "제외됨" 뱃지(muted 스타일).

## 변경할 파일

- `backend/app/services/noise_filter.py` — 신규(순수 함수, DB 없음)
- `backend/app/services/sync_pipeline.py` — `_process_group`에서 is_system_url 재검사 뒤 적용
- `backend/app/services/session_updater.py` — hold 상한 정책 변경
- `backend/app/api/events.py`, `backend/app/schemas/event.py` — excluded 필드·필터 제거
- `backend/eval/run_eval.py` — 파이프라인과 동일하게 사전 필터 적용(discard 예측으로 계상)
- `backend/tests/test_noise_filter.py` — 신규, `test_session_updater.py` 갱신
- `extension/lib/types.ts`, `lib/api.ts`, `hooks/useTimeline.ts`, `components/timeline/SessionBadge*` — excluded 뱃지

## 테스트 및 검증

- 단위: 규칙 3종 × 경계값(59/60초, 30/31초), 구제 조건 3종, None 체류
- backend pytest 전체 / extension pnpm test·compile·build / frontend build
- 골든셋 평가 1회(사용자 승인 범위) — 기존 노이즈 이벤트(Shorts 14s·Daum 8s·Instagram 12~15s·NAVER 9s·X 18s·한밭대 3s·Kaggle 29s)가 규칙으로 결정적으로 걸리는지 확인

## 위험

- 규칙 오폐기: 구제 조건과 보수적 임계값으로 완화. 도구성 방문(번역기 90초 등)은 임계 밖.
- Timeline에 excluded가 갑자기 보이면 UI가 소란스러울 수 있음 — muted 뱃지로 시각적 우선순위 낮춤.

## 완료 조건

- 실데이터 5건(한밭대 3s, Kaggle 29s)과 골든셋 노이즈가 LLM 무호출로 discard된다.
- 항공권 이벤트(검색어/도메인 반복)는 규칙에 걸리지 않는다.
- discarded 이벤트가 Timeline에 "제외됨" 뱃지로 보인다.
- 문서(DecisionLog·api-design-v2·WorkLog) 갱신.
