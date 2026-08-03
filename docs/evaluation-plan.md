# Orbit 평가 계획 — Auto Session 골든셋 · 지표 · 평가 스크립트

> 근거: 계획서 F(§13 평가 구조), G의 M5-19, 검증 절의 E2E 시나리오. 세션화 파이프라인(`grouper.py`/`intent_analyzer.py`/`session_updater.py`)은 `docs/target-architecture.md`, 스키마는 `docs/data-model-v2.md` 참고.

## 1. 왜 평가 구조가 필요한가

Auto Session의 핵심 위험은 "의도 분석 품질 — 오할당이 좋은 세션을 오염시키는 것"이다(계획서 §15 기술 위험 top 5의 1번). LLM이 이벤트를 어떤 세션에 붙일지, 새 세션을 만들지, 노이즈로 버릴지를 자동으로 판단하기 때문에, 이 판단의 정확도를 사람이 매번 눈으로 확인할 수 없다. 골든셋과 정량 지표는 프롬프트·임계값(threshold 0.35 등)을 튜닝할 때 "감"이 아니라 측정값으로 판단하기 위한 장치다.

## 2. 골든셋 포맷

경로: `backend/eval/golden/*.json`. 팀원이 10~30개 시나리오를 작성한다.

```json
{
  "name": "rtx_5070_purchase_research",
  "events": [
    {
      "id": "e1",
      "url": "https://www.google.com/search?q=rtx+5070+가격",
      "title": "rtx 5070 가격 - Google 검색",
      "domain": "google.com",
      "visited_at": "2026-08-01T10:00:00Z",
      "active_duration_ms": 40000,
      "search_query": "rtx 5070 가격"
    },
    {
      "id": "e2",
      "url": "https://www.danawa.com/product/rtx-5070",
      "title": "RTX 5070 다나와 최저가 비교",
      "domain": "danawa.com",
      "visited_at": "2026-08-01T10:02:00Z",
      "active_duration_ms": 180000
    },
    {
      "id": "e3",
      "url": "https://www.youtube.com/watch?v=example-review",
      "title": "RTX 5070 리뷰 - 벤치마크 비교",
      "domain": "youtube.com",
      "visited_at": "2026-08-01T10:06:00Z",
      "active_duration_ms": 420000
    },
    {
      "id": "e4",
      "url": "https://gall.dcinside.com/board/view/?id=graphic",
      "title": "RTX 5070 써본 사람 있음?",
      "domain": "gall.dcinside.com",
      "visited_at": "2026-08-01T10:14:00Z",
      "active_duration_ms": 90000
    },
    {
      "id": "e5",
      "url": "https://www.instagram.com/",
      "title": "Instagram",
      "domain": "instagram.com",
      "visited_at": "2026-08-01T10:16:00Z",
      "active_duration_ms": 20000
    }
  ],
  "existing_sessions": [],
  "expected": {
    "session_count": 1,
    "assignments": {
      "e1": "gpu_research",
      "e2": "gpu_research",
      "e3": "gpu_research",
      "e4": "gpu_research",
      "e5": "noise"
    },
    "new_vs_existing": "new",
    "titles_hint": ["RTX 5070 구매 비교", "그래픽카드 알아보기"]
  }
}
```

- `events`: 이벤트 시퀀스(계획서 검증 절 E2E 예시인 "RTX 5070 검색→리뷰→가격 비교→커뮤니티" 흐름을 골든셋 형태로 옮긴 예시). 실제 `exploration_events` 스키마 중 평가에 필요한 필드만 포함해도 된다(전체 컬럼 필수 아님).
- `existing_sessions`: 배치 시점에 이미 존재한다고 가정하는 세션 목록(append 판단을 테스트하려면 여기 채워 넣는다). 위 예시처럼 비어 있으면 "새 세션 생성" 판단만 테스트한다.
- `expected.assignments`: `event_id → session_key`(문자열 키, 실제 DB ID가 아니라 골든셋 내부 식별자) 또는 `"noise"`(노이즈로 제외되어야 하는 이벤트).
- `expected.new_vs_existing`: 이 배치가 `existing_sessions` 중 하나에 append 되어야 하는지(`"existing"`), 새 세션을 만들어야 하는지(`"new"`).
- `expected.titles_hint`: 세션 제목이 반드시 이 문자열과 정확히 같아야 한다는 뜻이 아니라, LLM-as-Judge(§6)가 제목 품질을 채점할 때 참고하는 힌트다.

## 3. `backend/eval/run_eval.py` 설계

**입력**: `backend/eval/golden/*.json` 전체(또는 `--file`로 단일 파일 지정).

**처리 흐름** (오프라인 투입 — `sync_pipeline`의 배치 로직 중 이벤트 인제스트 이전 단계는 건너뛰고, 필터→그룹화→의도분석 부분만 재사용):

```
골든셋 로드
  → event_filter 적용(정규화 — 실 파이프라인과 동일 함수 재사용, 골든셋도 실 인제스트 규칙을 통과해야 함)
  → grouper.py로 시간 간격 그룹화(순수 함수 — 실 파이프라인과 동일 함수)
  → 그룹별 intent_analyzer 호출(§4 real/replay 모드)
  → 예측 결과(assignments) 수집
  → expected와 비교해 §5 지표 계산
  → 리포트 출력(JSON + 사람이 읽는 요약)
```

- `event_filter`/`grouper`는 실제 파이프라인(`sync_pipeline.py`)이 쓰는 함수를 그대로 import해서 쓴다 — 평가가 실제 코드 경로와 분리된 별도 로직으로 채점하면 평가 자체가 실제 동작을 대표하지 못하게 되기 때문이다.
- 출력 리포트는 지표별 점수 + 실패한 개별 케이스(어떤 이벤트가 어디로 잘못 배정됐는지)를 함께 남겨, 프롬프트 수정 시 회귀 여부를 바로 확인할 수 있게 한다.

## 4. 실 LLM 모드 vs 기록 재생 모드

| 모드 | 동작 | 용도 |
|---|---|---|
| 실 LLM 모드 | `intent_analyzer.py`가 실제로 A.X-K1/solar-pro3 API를 호출 | 프롬프트 튜닝 후 실측 성능 확인, 정기적인 품질 점검(비용 발생) |
| 기록 재생 모드 | 이전 실 LLM 모드 실행에서 저장해 둔 원문 응답을 그대로 재생해 동일한 assignments를 재계산 | CI에서 비용 없이 회귀 확인, 지표 계산 로직 자체의 버그를 잡을 때 |

이는 계획서 §12(테스트와 검증)의 "단위 테스트는 monkeypatch, 평가는 실 호출" 원칙과 같은 선을 따른다 — `backend/tests/`의 단위 테스트는 `intent_analyzer`가 특정 형식의 JSON을 올바르게 파싱/방어하는지만 monkeypatch로 검증하고, `backend/eval/run_eval.py`는 실제 모델 성능(정확도)을 측정하는 별도 트랙이다. 두 트랙을 분리해야 "테스트는 항상 통과하지만 실제 배치는 품질이 나쁜" 상황을 놓치지 않는다.

## 5. 지표 정의와 계산식

`N`은 골든셋 전체(또는 파일 단위) 평가 대상 이벤트 수, `noise`는 `expected.assignments`에서 값이 `"noise"`인 이벤트 집합이다.

| 지표 | 정의 | 계산식 |
|---|---|---|
| Event-to-Session Assignment Accuracy | noise가 아닌 이벤트 중 예측 `session_key`가 정답과 일치한 비율 | `일치 이벤트 수 / (N - |noise|)` |
| Session Purity | 예측된 각 세션(클러스터) 안에서 가장 많이 등장하는 정답 라벨의 비율을 세션별로 구해 평균 | `(1/예측세션수) * Σ_i max_j(예측세션 i ∩ 정답라벨 j)` — 표준 클러스터링 purity 정의 |
| Coverage | 정답이 요구하는 세션(신규+기존) 중 예측 결과에서 실제로 대응되는 세션이 존재하는 비율 | `대응되는 정답 세션 수 / 정답 세션 총수` |
| New-vs-Existing Decision Accuracy | `expected.new_vs_existing` 판단과 예측된 create/append 판단이 일치한 배치의 비율 | `일치 배치 수 / 전체 배치 수` |
| 노이즈 제외율 | `noise`로 라벨링된 이벤트 중 실제로 `discard`로 판정된 비율(노이즈 검출 재현율) | `discard로 판정된 noise 이벤트 수 / |noise|` |
| Retrieval Recall@K | 골든셋에 포함된 자연어 질의 → 정답 세션 쌍에 대해, `/search` 결과 상위 K개 안에 정답 세션이 포함된 비율 | `정답이 top-K 안에 있는 질의 수 / 전체 질의 수` |

- Assignment Accuracy/Purity/Coverage/New-vs-Existing/노이즈 제외율은 계획서 F에 명시된 5개 지표를 그대로 정의한 것이다.
- Retrieval Recall@K는 계획서 F "골든셋에 자연어 질의→정답 세션 쌍 포함, `/search` 대상 측정"을 구체화한 것 — 이 지표가 Intent 검색의 리랭크 사용 여부, 0.35 score threshold 유지 여부, 이벤트 단위 임베딩 도입 여부를 결정하는 실측 근거가 된다(계획서 D-1 "세션 임베딩+키워드로 충분한지 골든셋으로 판단 후 결정").

## 6. LLM-as-Judge와 Restore Success Rate

- **LLM-as-Judge**: 제목/요약 품질은 정답이 하나로 고정되지 않는 주관적 영역이라 정확도로 채점하기 어렵다. 별도 LLM 호출로 "생성된 제목/요약이 `titles_hint`와 골든셋 이벤트 내용에 비추어 타당한가"를 채점하되, 이 점수는 **보조 지표로만** 사용한다 — §5의 정량 지표(Assignment Accuracy 등)를 대체하지 않는다.
- **Restore Success Rate**: 세션 복원(탭 재오픈)의 성공 여부는 골든셋 오프라인 평가로 측정할 수 없다(브라우저 API가 필요하므로). 계획서 검증 절의 E2E 체크리스트(수집 활성화 → 방문 → 동기화 → 세션 생성 → Timeline 확인 → Intent 검색 → 복원 → Analytics 확인)로 수동/E2E 스모크 테스트에서 측정한다.

## 7. 운영 지표

`sync_batches` 테이블(`docs/data-model-v2.md` §2)이 이미 기록하는 `prompt_version`/`model`/`event_count`/`started_at`~`completed_at`(소요시간)/`error_message`를 그대로 운영 지표의 원천으로 쓴다.

- **평균 동기화 시간**: `AVG(completed_at - started_at) WHERE status='completed'` — A.X-K1 3 RPS 제약 하 배치 소요(계획서 예상 2~5분)가 실제로 어느 정도인지 확인.
- **배치당 비용 추적**: `event_count`와 `model`을 조합해 배치당 LLM 호출 횟수·모델 사용량을 추정.
- **실패율**: `status='failed'` 배치 비율과 `error_message` 패턴 분석.
- **LangSmith 연동은 선택**(계획서 "LangSmith는 선택(자체 sync_batches 기록으로 대체)") — 이번 MVP는 LangSmith 없이 `sync_batches` 자체 기록만으로 운영 지표를 충당하고, 필요 시 이후 LangSmith를 추가 연동하는 방식으로 남겨둔다.

## 8. 평가 결과의 활용

골든셋 지표는 다음 판단에 직접 쓰인다(계획서 원문 근거를 함께 표기):

- Qdrant 후보 검색 `score_threshold=0.35`를 유지할지 재조정할지 — Recall@K 측정 결과로 판단(기존 `docs/DecisionLog.md`의 "검색 score threshold를 설정으로 관리" 결정에 신규 데이터를 더하는 것)
- 이벤트 단위 임베딩 도입 여부 — "세션 임베딩+키워드로 충분한지 골든셋으로 판단 후 결정"(계획서 D-1)
- `intent_analyzer.py` 프롬프트 수정 — Assignment Accuracy/Purity/노이즈 제외율의 회귀 여부로 판단
- `hold_count ≥ 3` 강제 create 임계값 조정 — New-vs-Existing Decision Accuracy와 함께 검토
