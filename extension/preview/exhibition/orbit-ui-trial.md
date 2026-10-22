# UI trial fix2 — 검색 품질 2차 수리 후 같은 조건 재시험 (2026-10-22)

제품 커밋 `6415285 fix(memory): narrow answer grounding, restore streaming, enrich session embeddings`.
URL 26개·고정 8문항·같은 하네스·격리 자원(DB 5543, Qdrant 6335, API 8015, CDP 9355). 질문과 방문 스크립트의
sha256이 42005d4·fix1과 같다(`compare.py` assert). 확장은 `VITE_API_BASE_URL=http://127.0.0.1:8015`로 빌드하고
`background.js`의 API 주소가 8015 하나뿐임을 확인했다. 실효 임계값은 `environment.json`.

## 결과

| 지표 | 수정 전(42005d4) | fix1 | fix2 | 수용 기준 |
|---|---:|---:|---:|---:|
| 정답 포함 후보 | 3/6 | 2/6 | **3/6** | 5/6 이상 — 미달 |
| 정답 후보 + 답변 모순 없음 | 2/6 | 2/6 | 3/6 | |
| 부정 질문 거절 | 2/2 | 2/2 | **2/2** | 2/2 — 충족 |
| 복원된 목표 URL | 4/9 | 4/9 | **4/9** | 6/9 이상 — 미달 |
| 추가로 열린 다른 URL | 5 | 0 | **0** | 0 — 충족 |
| 대체 안내문으로 바뀐 답변 | — | — | 0 | (따로 셈) |
| 세션 수 | 6 | 11 | 12 | |

세 결함 재발 0: 혼입 0(12세션 모두 한 주제, 제주 3페이지 그대로), 오이동 0(dev_shared는 0.2338/0.0325로
`search_memory` fallback), 기록 부정 모순 0.

| 질문 | 후보 | 첫 카드(ms) | 첫 본문(ms) | 경로 | 정답 세션 실제 점수(순위) |
|---|---:|---:|---:|---|---|
| travel_car | 1 | 219.6 | 220.6 | find_sessions(rule) | 0.376 (1위) |
| travel_flight | 0 | — | 264.7 | search_memory(rule) | 0.269 (1위, 0.28 미만) |
| dev_shared | 0 | — | 675.2 | search_memory(fallback) | 0.201 (1위, 0.28 미만) |
| dev_reset | 0 | — | 281.5 | find_sessions(rule) | 0.248 (1위, 0.28 미만) |
| gpu_specs | 1 | 310.8 | 311.2 | find_sessions(rule) | 0.308 (1위) |
| gpu_benchmark | 1 | 1349.7 | 1651.7 | search_memory(fallback) | Blender 0.289 (2위) |
| negative_garden | 1 | — | 327.1 | find_sessions(rule) | 최고 오답 0.141 |
| negative_piano | 1 | — | 658.2 | search_memory(fallback) | 최고 오답 0.183 |

점수는 `raw/pipeline_trace.jsonl`의 `ask_search`(시험 프로세스 안에서 Qdrant만 다시 읽은 값, provider 호출 없음).

## 무엇이 나아졌고 무엇이 남았나

1. **gpu_benchmark 회복(0→1):** Blender 두 페이지가 `Blender 성능 벤치마크` 세션으로 남았다. 의도 분석 원문을 보면
   LLM은 이번에 두 페이지를 discard하지 않고 `웹 개발 학습 세션`(MDN)에 append하려 했다(점수 없는 최근 후보 S3).
   fix1의 append 게이트가 막아 별도 세션이 됐다. 42005d4에서 Blender가 CSS Grid 세션에 붙던 것과 같은 패턴이다.
   discard 가드는 이번 실행에서 발동하지 않았다(가드 trace 0건). 답변은 Blender [1]을 근거로 들고 "비교표는 기록에서
   확인되지 않는다"는 한계를 말했고, 좁힌 검사가 이를 통과시켰다(replace 0).
2. **스트리밍 복원:** LLM 답변 문항(gpu_benchmark)의 첫 카드→첫 본문 간격 302ms(fix1 1259ms), DOM 표본 44개로
   본문이 점진 표시됐다. LLM 생성 문항이 1개뿐이라 p50 비교는 할 수 없다.
3. **남은 검색 누락 3건(travel_flight, dev_shared, dev_reset):** 정답 세션이 모두 **1위**인데 점수가 0.28 미만이다.
   세션 임베딩 텍스트에 페이지 제목·경로를 넣어도 넘지 못했다(`diagnostics/cosine_table.json`, 아래).
   부정 문항 최고점은 0.183이다. 이 실행만 보면 하한 0.19~0.20이 6/6·부정 2/2를 주지만, 여유가 0.02 안팎이고
   이 8문항으로 하한을 고르면 0.28을 질문 누설 요약으로 정한 실수를 반복한다. 그래서 하한은 바꾸지 않았다.
4. **복원 4/9:** React가 검색되지 않아 react 묶음 복원이 없다. gpu 묶음은 첫 성공 문항(gpu_specs)의 RTX 1페이지 세션을
   복원 대상으로 고정하는 하네스 규칙 때문에 Blender 2페이지가 복원 대상에서 빠진다(규칙은 바꾸지 않음).

## 진단 (임베딩만, LLM 없음)

- `diagnostics/route_sweep.py` → `route_sweep.json`: 라우팅 골든셋 42건 + UI 8문항. 임베딩 배치 2회.
  0.35/0.05는 탭 이동 6/8. 0.20/0.05에서 8/8·오이동 0. 간접 탭 이동은 격차 0.079 이상, 오이동 후보는 0.033 이하.
- `diagnostics/cosine_table.py` → `cosine_table.json`: fix1의 실제 LLM 요약 11세션 × 8문항. 임베딩 배치 4회.

| 변형 | 정답 최저점 | 부정 최고점 | 0.28 이상 정답 |
|---|---:|---:|---:|
| base(요약만, 수정 전) | 0.182 | 0.176 | 2/5 |
| pages(+페이지 제목·도메인·경로, 이번 수리) | 0.194 | 0.170 | 2/5 |
| page_max(페이지 단위 최고점, 이벤트 벡터의 대리) | 0.234 | 0.135 | 1/5 |

  페이지 단위 점수는 정답과 부정의 간격이 0.10으로 가장 넓다. 이벤트 단위 벡터가 필요하다는 근거다(저장 구조 변경이라
  대표 결정 사항, 구현하지 않음).

## 실행 수치

- 26 URL → 26 이벤트. processed 25, discarded 1(visitseoul 루트, 노이즈 필터). 배치 2회(자동 20개 + '세션 분류' 1회 6개).
- 첫 방문 → 첫 세션 391.3초, → 마지막 배치 완료 525.0초, 클릭 → 완료 11.6초.
- Provider HTTP 시도: LLM 23회, 임베딩 30회, 모두 200.
- 관찰 283회 모두 focused=true, `chrome.idle`은 283회 모두 idle(Mac 전체 입력 기준, 사람 자리 비움). 이벤트 체류는
  fix1과 같은 범위였다. 제주항공은 이번에도 403.

## 하네스 변경(측정 기준 불변)

`environment.json`의 `harness_changes`. 요약: 시험 프로세스 안 래퍼로 의도 분석 입력·출력·클러스터·후보 점수·
가드 변화·Ask 검색 점수를 `raw/pipeline_trace.jsonl`에 남김(운영 로그와 별개, 키·헤더 없음). `ask.mjs`에 첫 카드/첫 본문
분리 기록, `grade.py`에 SSE `replace` 횟수. fix1에서 손으로 한 CDP 준비와 사이드패널 클릭을 `setup.mjs`,
`manual_sync.mjs`로 적었다. 판정 기준·질문·방문 순서·체류는 그대로다.

## 정리

격리 컨테이너 2개 삭제(ID는 `raw/cleanup.json`), 시험 백엔드·Chrome·monitor 종료, 임시 인증·프로필 삭제.
8000 서버, 개발 compose, 대표 데이터, 메인 체크아웃은 건드리지 않았다.
