# 세션 병합(Merge) 전체 구현 — P0 스키마 · P1 제안 · P2 실행 · P3 undo · 튜닝

**상태:** P0~P4(대시보드 UI) 구현·검증·실데이터 튜닝 완료 (2026-08-07). 브랜치 `feat/merge-suggestions`.
남은 것 = (선택) 실 브라우저 E2E 스모크, 배치 후 자동 제안·뱃지·익스텐션 사이드패널(보류).
**설계 근거:** `docs/merge-design.md`, DecisionLog 2026-08-03·08-06·08-07.

> 사용자 지시(2026-08-07): "이 브랜치에서 전체 구현 + 테스트 + 튜닝까지". P0+P1은 선구현·검증 완료,
> 이번에 P2(실행)·P3(undo) 추가 + `merge_suggest_floor` 실 임베딩 튜닝.

## 사용자 결정 (확정)

| 항목 | 결정 |
|---|---|
| 탐지 신호 | 벡터 `merge_suggest_floor` 이상 **AND** 키워드/제목 토큰 겹침 (정밀 우선) |
| 생존 세션 | 이벤트 많은 쪽 → 동률 시 이른 started_at(→created_at) → 작은 id |
| 삭제 방식 | soft-delete(`status='merged'`, `merged_into`) + undo(가역) |
| 자동 병합 | 금지 — 실행은 항상 사용자 확인(엔드포인트 호출) |

## 범위

* P0(완료): `sessions.merged_into`, config, 벡터 헬퍼.
* P1(완료): `GET /sessions/merge-suggestions` 읽기 전용 제안.
* **P2**: `session_events.merged_from_session_id` 스키마 + `POST /sessions/{id}/merge` 실행.
  이벤트 이전(dedup)·재계산·B soft-delete·백그라운드 재요약/재임베딩. `list_sessions` merged 제외.
* **P3**: `POST /sessions/{id}/unmerge` — merged_from 태그로 원 세션 복원.
* **튜닝**: 병합 탐지 골든셋 + 오프라인 스크립트로 실 Upstage 임베딩 코사인 분포 측정 →
  `merge_suggest_floor` 확정.

## 제외 범위

* P4 배치 후 자동 제안 생성, 대시보드/사이드패널 UI(별도 작업).
* 사용자 간(cross-user) 병합, split.

## 계약 (P2/P3)

### 스키마
* `SessionEvent.merged_from_session_id VARCHAR(36) NULL` — 이 행이 병합으로 옮겨온 원 세션 id(undo용).
* 마이그레이션 러너를 `{table: [(col, ddl)]}` 다중 테이블로 일반화(멱등 유지).
* `status='merged'`는 값 관례(enum 아님).

### `app/services/merge_service.py` (신규)
* `MergeError(code, message)` — code=not_found|invalid|conflict → HTTP 404/400/409.
* 순수: `_union_keywords(a, b)`(순서 보존 합집합), `_pick_survivor`는 P1 로직 재사용(제안이 생존자를 이미 정함).
* DB 게이트웨이(테스트에서 monkeypatch): `_fetch_events_ordered`, `_move_event`, `_delete_event`,
  `_recompute_session_stats`.
* `merge_sessions(db, survivor_id, absorbed_id) -> SessionModel`:
  검증(둘 다 active·상이) → B의 session_events를 A로 이전(A에 이미 있는 event_id는 dedup 삭제,
  sequence_order=A.max+1.., `merged_from_session_id=B`) → A 재계산·keywords 합집합 →
  B `status='merged'`·`merged_into=A`·event_count=0 → A `summary_status='pending'` → commit(단일 txn).
* `unmerge_sessions(db, survivor_id, absorbed_id) -> tuple[A, B]`:
  검증(B.status='merged'·B.merged_into==A) → A에서 `merged_from_session_id==B`인 행을 B로 복원
  (sequence_order 재부여·태그 제거) → A·B 재계산 → B `status='active'`·`merged_into=NULL` →
  둘 다 `summary_status='pending'` → commit.

### API (`app/api/sessions.py`)
* `POST /sessions/{survivor_id}/merge` body `{absorbed_id}` → 동기 DB 병합 후 background로
  (B Qdrant 포인트 삭제 + A 재요약/재임베딩). 갱신된 survivor 반환.
* `POST /sessions/{survivor_id}/unmerge` body `{absorbed_id}` → 동기 복원 후 background로 A·B 재요약/재임베딩.
* `list_sessions`에 `status != 'merged'` 필터(archived 노출은 유지). `_fetch_candidates` 최종 조회에도
  방어적 `status=='active'` 필터(Qdrant 삭제 실패 대비).

### 재요약/임베딩
* 재요약은 기존 `refresh_session_ai`(별도 세션·LLM·재임베딩) 재사용 — 병합 txn과 분리(코드베이스 관행).
* 병합 전용 version note는 record_version 시그니처에 없어 추가하지 않음(재요약이 새 version 자연 생성).

## 구현 순서

1. P2 스키마(models + 러너 일반화).
2. merge_service(merge/unmerge) + 게이트웨이.
3. API 배선 + list/candidate 필터.
4. mock 단위 테스트 + 전체 pytest.
5. 도커 postgres 통합 검증(실 SQL 실행 — merge/unmerge 상태 확인).
6. 튜닝: 골든셋 + 스크립트 + 실 임베딩 측정 → floor 확정 + DecisionLog.

## 테스트 및 검증

* **단위(mock)**: merge/unmerge 디스패치·검증 분기(MergeError→HTTP), `_union_keywords`, 이벤트 이전
  호출 순서/ dedup. 기존 관행(fake DB + monkeypatch) 준수 → `pytest -p no:asyncio` 유지.
* **통합(도커 postgres)**: 실제 A/B + events 삽입 → merge → 상태·이전·재계산 검증 → unmerge → 복원 검증.
  기본 스위트에 넣지 않음(스위트는 DB-free 유지) — 검증용 스크립트로 1회 실행.
* **튜닝**: 병합 골든셋 세션 텍스트를 실 Upstage 임베딩 → 쌍별 코사인 → floor 스윕 P/R.

## 위험

* SQL 경로는 도커 통합으로 실제 실행 검증(기본 스위트는 mock). 통합 미실행 시 SQL 미검증 위험 명시.
* `merge_suggest_floor`는 튜닝 결과로 확정. 소표본 임베딩 불안정(2026-07-05 경고) 고려해 보수적 채택.
* Qdrant 포인트 삭제/재임베딩은 best-effort(실패해도 DB 상태는 정합) — candidate status 필터로 이중 방어.

## 완료 조건

* P2/P3 엔드포인트 동작(검증 분기 포함). 전체 pytest 통과.
* 도커 통합에서 merge→unmerge 왕복 후 데이터 정합(event 수·sequence·status·merged_into).
* `merge_suggest_floor` 튜닝값 확정 + DecisionLog 갱신. WorkLog 갱신.
