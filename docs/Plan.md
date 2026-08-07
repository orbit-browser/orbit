# 그룹 내 서브클러스터링 + 그룹 간 append 게이팅

**상태:** 구현·골든·실데이터 검증 완료 (2026-08-06). 남은 일 = 게이트 cross-day 튜닝, merge(create-bias).
**브랜치:** `feat/subcluster-append-gating`

> 결과 요약: 골든 11개 Assignment/Purity/Coverage 100%, backend pytest 256 통과.
> 실데이터 재세션화 2회에서 메가 뭉침 재발 없음(핵심 불안정 해소). 상세는 WorkLog·DecisionLog(2026-08-06).

> 직전 계획(AI 챗 정규화·노이즈 보강)은 완료·병합됨(#3). 이번은 DecisionLog
> "[재확인] 그룹 간 과잉 append" 항목의 구조적 해법 1+2를 구현한다.

## 작업 목표

Auto Session 재세션화 품질이 run마다 출렁이는 구조적 불안정을 잡는다. 두 원인을 각각 겨냥:

- **그룹 내 다주제 뭉침** → ① 임베딩 서브클러스터링으로 LLM 호출 전 주제 선분리.
- **그룹 간 과잉 append** → ② append 게이팅(벡터 유사도 하한 + 시간 근접)으로 오래됐거나
  안 비슷한 후보 세션에 조용히 붙는 것을 결정적으로 차단.

프롬프트 튜닝(v4·v5)은 특정 케이스만 잡고 구조적 불안정은 못 잡음이 확인됨(DecisionLog 2026-08-05).

## 조사 결과 (현재 구조)

`sync_pipeline._process_group` 흐름: `is_system_url` → `split_noise` → **그룹 전체 1회 임베딩**
→ `_fetch_candidates`(벡터 top3 + 최근 24h ≤5) → `intent_analyzer.analyze(그룹 전체)` → `apply_assignments`.

- 다주제 그룹 전체가 한 임베딩·한 LLM 호출로 들어가 뭉침 여지가 큼.
- `search_similar_with_scores`는 score를 계산하지만 `_fetch_candidates`가 **점수를 버림** → 게이팅에 재활용.
- `apply_assignments`는 이미 append 대상 소실 시 create fallback을 지원(§session_updater) →
  게이트의 append→create 강등이 기존 경로에 자연히 얹힘.
- numpy 2.2.6 사용 가능(코사인). Upstage 임베딩은 배열 입력 지원(그룹당 1회 HTTP 배치 가능).

## 설계 결정 (사용자 승인: 조건부 하드 스플릿)

서브클러스터가 2개 이상일 때만 클러스터별로 후보검색+LLM 분석을 분리한다. 단일주제 그룹은
클러스터 1개 → 호출 1회(기존과 동일). 뭉침을 구조적으로 차단하고, LLM 호출 증가는 실제
다주제 그룹에서만 발생(EXAONE 429는 기존 A.X 폴백이 흡수).

**과분할(주 리스크) 완화:**
- 보수적 임계값 — 명백히 다를 때만 쪼갬(2026-07-05 "소표본 임베딩 클러스터링 불안정" 경고 존중).
- **collect-then-apply** — 모든 클러스터의 후보검색·analyze를 먼저 끝낸 뒤 apply. 클러스터가
  서로가 방금 만든 세션을 후보로 보지 못하게 해 쪼갠 걸 다시 붙이는 것을 막는다.

## 계약 (구현 전 확정)

### 1. `app/services/subclusterer.py` (신규, 순수 함수·DB/IO 없음)

```python
def subcluster(embeddings: list[list[float]], threshold: float) -> list[list[int]]:
    """이벤트 임베딩을 average-linkage 응집으로 서브클러스터링, 인덱스 그룹 목록 반환.
    - 평균 코사인 ≥ threshold인 가장 유사한 클러스터 쌍을 반복 병합, 미달이면 정지.
    - 결정적: 등장 순서 보존, tie-break는 (min index) 오름차순.
    - 단일주제(모두 유사)면 [[0..n-1]] 한 그룹. 이벤트 0개면 [], 1개면 [[0]].
    """
```

### 2. `app/ai/embedding.py` — `embed_many` 추가

```python
async def embed_many(texts: list[str], *, model: str | None = None) -> list[list[float]]:
    """여러 텍스트를 1회 요청으로 임베딩(Upstage 배열 입력). 순서 보존, 빈 입력은 []."""
```

### 3. `app/services/sync_pipeline.py` — `_process_group` 재작성 + 게이트

- `_event_embedding_text(event)` — 제목 + 도메인 + 검색어(있으면).
- `_centroid(vectors)` — 정규화 평균(클러스터 후보검색용 query 벡터).
- `_fetch_candidates` 반환 dict에 `score`(벡터 매치 점수, 최근-only 후보는 None)와
  `last_activity_days_ago` 유지.
- `_gate_appends(assignments, candidates)` (순수 함수) — action=="append"이고
  target 후보의 `score < settings.append_score_floor`(벡터 매치인 경우) 또는
  `last_activity_days_ago > settings.append_max_age_days`이면 **create로 강등**
  (title/purpose 없으면 session_updater의 fallback 제목 사용).
- 흐름: system·noise 필터 → `embed_many` → `subcluster` → (phase1) 클러스터별
  centroid로 `_fetch_candidates` → `analyze` → `_gate_appends`, 모델·pending 수집 →
  (phase2) 클러스터별 `apply_assignments`. `touched`·모델 카운트는 클러스터 합산.

### 4. `app/config.py` — 임계값(env 오버라이드 가능, 실측 튜닝 대상)

```python
subcluster_threshold: float = Field(default=0.5, ge=0.0, le=1.0)   # 낮을수록 덜 쪼갬(보수적)
append_score_floor: float = Field(default=0.40, ge=0.0, le=1.0)    # 검색 0.28보다 높게(append는 강한 커밋)
append_max_age_days: int = Field(default=3, ge=0)                  # 후보 recency 7일보다 타이트
```

### 5. `eval/run_eval.py` — 서브클러스터링 경로 반영 (골든 정합성)

- 그룹별 `embed_many`(이벤트 텍스트) → `subcluster` → 클러스터별 `analyze` 호출.
- `--record`/`--replay`에 임베딩 맵 추가(재현성·비용 통제). call_key에 cluster_index 추가.
- eval은 Qdrant 미사용이라 후보는 `existing_sessions`를 그대로 전달(게이트는 eval 범위 밖,
  단위 테스트로 검증). → eval은 **서브클러스터링 + 프롬프트** 품질을 검증.

## 검증 범위 분리 (정직성)

- **단위 테스트**: `subcluster()`(합성 벡터로 분리/미분리·결정성), `_gate_appends()`
  (합성 score·days_ago로 강등/유지), `embed_many`(배열 매핑·빈 입력).
- **골든셋**(사용자 승인: "골든셋으로 검증"): 서브클러스터링 + LLM 무회귀 — 특히
  `mixed_topics_with_noise`가 travel/coding 2개로 분리되고, `existing_session_continue`·
  `trip_flow_with_tool_visits`는 단일 클러스터 유지(과분할 없음).
- **실데이터 재세션화**: 게이트 포함 전 경로 통합 검증(실 Qdrant 점수). run별 안정성 관찰.

## 임계값 튜닝 순서

1. 골든셋 이벤트 임베딩의 실제 코사인 분포를 측정(mixed_topics의 travel↔coding 거리,
   trip_flow 내부 거리) → `subcluster_threshold`를 분리 구간에 위치.
2. `append_score_floor`는 실데이터의 정당한 continuation 점수와 loose 매치 점수 분리 구간.
3. 보수적 우선(과분할·과잉게이트 회피) — 애매하면 덜 쪼개고 덜 강등.

## 변경할 파일

| 파일 | 변경 |
|---|---|
| `backend/app/services/subclusterer.py` | 신규 — subcluster 순수 함수 |
| `backend/app/ai/embedding.py` | embed_many 추가 |
| `backend/app/services/sync_pipeline.py` | _process_group 재작성, _gate_appends, _fetch_candidates score 노출 |
| `backend/app/config.py` | 임계값 3종 |
| `backend/eval/run_eval.py` | 서브클러스터 경로 + 임베딩 record/replay |
| `backend/tests/test_subclusterer.py` | 신규 |
| `backend/tests/test_sync_pipeline.py` | _process_group·_gate_appends 케이스 |
| `backend/tests/test_embedding.py` | embed_many (신규 또는 기존에 추가) |
| `docs/DecisionLog.md`, `docs/WorkLog.md` | 결정·작업 기록 |

## 위험과 사용자 결정

- **과분할**(주 리스크): 보수적 임계값 + collect-then-apply + 골든/실데이터 튜닝으로 완화.
- **비용/429**: 다주제 그룹만 호출 증가, EXAONE→A.X 폴백이 흡수. 배치당 임베딩 1 HTTP 추가(소액).
- **2026-07-05 결정 재검토**: 임베딩 클러스터링을 "거친 선분리(LLM 보조)"로 한정 도입 —
  DecisionLog에 재검토로 명시.
- 임계값은 실측 전 임시값 — 골든/실데이터로 확정 후 DecisionLog 갱신.

## 완료 조건

- 단위 테스트(subcluster·gate·embed_many) 통과.
- 골든셋 무회귀 + mixed_topics 주제 분리 확인.
- 실데이터 재세션화에서 메가 뭉침 재현 안 됨(run 반복 안정).
- backend pytest 전체 통과, 임계값 DecisionLog 기록, WorkLog 갱신.
