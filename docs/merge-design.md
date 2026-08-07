# 세션 병합(Merge) 설계

**상태:** 구현 완료 (2026-08-07) — 제안·병합·되돌리기·일괄병합·gated 자동병합과 extension 사이드패널 UI.
**관련:** DecisionLog 2026-08-03(merge 후순위·스키마 예약), 2026-08-06(서브클러스터링 잔여 한계),
`docs/product-direction-v2.md`, `docs/api-design-v2.md`, `docs/data-model-v2.md`.

## 1. 배경 — 왜 필요한가

서브클러스터링 + append 게이팅으로 **교차주제 메가 뭉침**(한 세션이 무관한 여러 주제를 삼키는 것)은
구조적으로 해소됐다(DecisionLog 2026-08-06, 실데이터 검증). 그러나 반대 방향의 잔여 결함이 남는다 —
**같은 주제가 여러 세션으로 쪼개짐(과분할·중복)**. 실데이터 재세션화(2026-08-06)에서 관찰:

* `제주도 항공권 검색`(9) + `제주 항공권 예약`(3) — 같은 항공권 탐색이 2세션.
* `나어나이 이터널 리턴` — 큰 세션 안 11건 + 별도 세션 2건으로 분리.
* `낭만 인프라` — `인프라 모니터링 탐색`(4) + `낭만 인프라 탐색`(1)로 분산.

근본 원인은 세 가지가 겹친다:

1. **EXAONE create-bias** — 프롬프트가 "확실하지 않으면 append보다 create"라 안전하게 새 세션을 만든다.
2. **append 게이트의 비대칭** — 게이트는 append→create 강등만 하고 create→append 승격은 하지 않는다.
   즉 과분할을 애초에 못 막는다(설계상 의도 — 오염 방지 우선).
3. **시간 그룹 경계** — 같은 주제의 방문이 30분 gap을 넘겨 다른 배치/그룹으로 갈리면 각자 세션이 된다.

이 셋은 append 경로에서 고칠 수 없다(고치려 하면 오염↑). **사후 병합**이 올바른 계층이다.

## 2. 목표 / 비목표

**목표**
* 같은 주제로 쪼개진 세션들을 **탐지해 병합을 제안**하고, 사용자가 확인하면 하나로 합친다.
* 병합은 **가역적**이어야 한다(잘못된 병합 되돌리기).

**비목표**
* **광범위한 자동 병합 금지** — 자동병합은 기본 OFF인 명시적 opt-in이며, 켜져도 높은 벡터 유사도와
  거의 같은 제목 조건을 모두 통과한 명백한 중복만 처리한다. 일반 후보는 항상 제안+사용자 확인을 거친다.
* 클러스터 내부 LLM 과분할 자체를 없애는 것(그건 서브클러스터링/프롬프트 계층의 몫).
* 사용자 간(cross-user) 병합, 세션 분할(split, 이미 assignment 분리로 지원).

## 3. 핵심 설계 결정 (관점과 트레이드오프)

### 3.1 자동 vs 제안 — **제안+확인으로 확정**
기존 원칙과 안전성(파괴적·비가역 위험)상 자동 병합은 배제. 시스템은 후보 쌍을 점수와 함께 제시하고,
사용자가 확인한 병합만 실행한다. (장점: 안전·신뢰·오탐 통제. 단점: 사용자 손이 필요 → 제안 품질이 관건.)

### 3.2 후보 탐지 신호 — 다중 신호 AND (오탐 억제)
단일 신호는 위험하다. 아래를 **조합**해 후보를 만든다.
* **벡터 유사도**(주 신호) — 두 세션 요약 임베딩(Qdrant, 이미 저장됨)의 코사인이 `merge_suggest_floor`
  이상. append 게이트(0.35)보다 **높게**(예 0.6~0.7) 잡아 "거의 같은 주제"만.
* **키워드/제목 겹침**(보조) — keywords 교집합 또는 제목 토큰 겹침. 벡터만으로는 "여행 전반"처럼 넓은
  유사가 잡히므로 겹침을 요구해 정밀도↑.
* **시간 근접**(선택) — 두 세션 활동 구간이 가까우면(같은 날/N일 내) 가중. 단, 시간축을 강제하면
  "며칠에 걸친 같은 탐색"을 놓치므로 하드 컷이 아니라 가점으로.
> 열린 결정: 임계값(floor)과 "벡터만 vs 벡터+겹침 필수"는 골든/실데이터로 튜닝(§7).

### 3.3 병합 방향(생존 세션 선택) — 규칙 기반, 결정적
후보 쌍 (A, B) 중 **생존자(survivor)**를 결정적으로 고른다. 후보 정책:
* 이벤트 수가 많은 쪽, 동률이면 `started_at`이 이른 쪽(원 세션 우선). → 큰 세션이 작은 세션을 흡수.
> 열린 결정: "먼저 만든 세션 우선" vs "이벤트 많은 세션 우선" 중 택. 기본은 이벤트 수 우선.

### 3.4 소프트 삭제 + 가역성 — hard delete 대신 status='merged'
흡수된 세션 B를 **하드 삭제하지 않고** `status='merged'`, `merged_into=A.id`로 남긴다. B의
session_events는 A로 이전하되 **출처 태그**(`merged_from_session_id`)를 붙여, undo 시 원 세션으로
되돌릴 수 있게 한다. (장점: 가역·감사. 단점: 스키마·정리 로직 추가.)

## 4. 병합 연산 의미 (데이터 반영)

`merge(survivor A, absorbed B)`:
1. B의 `session_events`를 A로 이전 — `session_id=A`, `sequence_order`는 A의 max+1부터,
   `event_id` 중복은 on-conflict-do-nothing(dedup). 이전 행에 `merged_from_session_id=B.id` 기록.
2. A 재계산 — `event_count`, `total_active_duration_ms`, `started_at=min`, `last_activity_at=max`,
   `keywords` 합집합, `tabs`는 `_resync_tabs`로 재선정.
3. A 재요약 — `refresh_session_ai(A)`로 요약/제목/임베딩 갱신(session_updater 재사용, 단일 작성자 원칙).
4. A에 `record_version`으로 병합 이력 기록(prompt_version=None, note="merge:<B.id>").
5. B는 `status='merged'`, `merged_into=A.id`로 마킹. B의 Qdrant 포인트 삭제(검색 노출 방지).
   B의 session_events는 A로 옮겨졌으므로 B에는 남기지 않는다(undo는 태그로 복원).
6. 모두 한 트랜잭션. 실패 시 롤백(부분 병합 금지).

`unmerge(A, B)`(undo): A의 session_events 중 `merged_from_session_id=B.id`를 B로 되돌리고,
A/B 재계산·재요약, B `status='active'`·`merged_into=NULL`·Qdrant 재임베딩. (P3, §6)

## 5. 스키마 변경 (additive, 멱등 ALTER — DecisionLog 2026-08-03 러너)

`sessions`:
* `merged_into VARCHAR(36) NULL` — 흡수된 세션이 가리키는 생존 세션 id. NULL=병합 안 됨.
* `status`에 값 `merged` 추가(컬럼 재사용, enum 아님). 기존 active/archived와 공존.

`session_events`:
* `merged_from_session_id VARCHAR(36) NULL` — 이 행이 병합으로 다른 세션에서 옮겨왔음을 표기(undo용).

세션 조회 API는 기본적으로 `status='active'`만 반환하므로 `merged` 세션은 자동으로 목록에서 빠진다
(별도 필터 추가 불필요 — 확인 필요). 벡터 검색 후보(sync_pipeline)도 `status='active'`만 보므로
병합된 세션이 후보로 다시 안 올라온다.

## 6. API 설계 (api-design-v2 스타일, 3단계)

* **P1 — 제안(읽기 전용, 안전)**
  `GET /sessions/merge-suggestions` → `[{survivor, absorbed, score, signals:{vector,keyword_overlap}}]`.
  서버가 활성 세션 쌍을 스캔해 §3.2 조건을 만족하는 후보를 점수순 반환. **아무것도 변경하지 않음.**
* **P2 — 병합 실행(확인)**
  `POST /sessions/{survivor_id}/merge` body `{absorbed_id}` → §4 수행, 갱신된 survivor 반환.
  사용자 확인 후에만 호출(파괴적 → 자동 호출 금지).
* **P3 — 되돌리기**
  `POST /sessions/{survivor_id}/unmerge` body `{absorbed_id}` → §4 undo.

배치 완료 후 자동으로 제안을 "생성"할 수는 있으나(관측·뱃지용), **실행은 항상 사용자 클릭**.

## 7. 검증 방법

* **단위 테스트** — 병합 연산(session_events 이전·재계산·중복 event_id dedup·undo 복원)을
  DB 대역/실 DB로. 순수 후보탐지 함수(두 세션 메타 → 병합 제안 여부)를 합성 데이터로.
* **골든셋** — 병합 후보 탐지 골든(합쳐야 할 쌍: 제주항공권 2세션류 / 합치면 안 되는 쌍: 여행 vs 코딩류)을
  추가해 precision/recall 측정. 임계값 튜닝.
* **실데이터** — 현재 재세션화 결과(제주항공권 9+3, 나어나이 11+2)로 제안이 이 쌍을 잡고, 무관 쌍은
  안 잡는지 확인.

## 8. 단계별 로드맵

1. **P0 스키마** — `merged_into`/`merged_from_session_id` ALTER + `status='merged'` 관례.
2. **P1 탐지+제안 API** — 읽기 전용. 골든으로 임계값 튜닝. (안전, 먼저 배포 가능)
3. **P2 병합 실행 API + UI 확인 흐름** — 사용자 확인 후 병합.
4. **P3 undo**.
5. **P4** — extension 사이드패널에서 제안 온디맨드 조회 + 개별/일괄 병합 + 되돌리기 노출.

## 9. 확정 사항

| 항목 | 결정 |
|---|---|
| 자동 vs 제안 | 일반 후보는 제안+확인. 자동병합은 기본 OFF, 명백한 중복만 opt-in |
| 후보 임계값 | 벡터+키워드 겹침 AND, `merge_suggest_floor=0.52`(실데이터 튜닝) |
| 생존 세션 선택 | 이벤트 많은 쪽(동률 시 이른 started_at→id) |
| 삭제 방식 | soft-delete(`status=merged`) + undo |
| 제안 노출 시점 | 사이드패널 세션 화면 진입 시 온디맨드 조회 |
| UI 위치 | extension 사이드패널 |

## 10. 구현 결과

P0~P3 백엔드와 P4 UI가 구현되었다. 병합 실행은 확인창을 거치고 성공 직후 되돌리기를 제공한다.
일괄병합은 같은 세션이 한 배치에서 중복 소비되지 않도록 건너뛰며, 자동병합은 서버 설정에서 사용자가
명시적으로 켠 경우에만 다음 동기화 배치에서 동작한다.
