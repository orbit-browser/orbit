# Orbit 세션화 평가 하네스

`backend` 디렉터리에서 실행한다(golden/*.json 전체 평가, 실 LLM 호출):

```
python -m eval.run_eval
```

단일 시나리오만: `python -m eval.run_eval --file eval/golden/rtx_5070_purchase.json`
응답 기록: `python -m eval.run_eval --record eval/golden/_recorded.json`
기록 재생(LLM 미호출, CI용): `python -m eval.run_eval --replay eval/golden/_recorded.json`

실 LLM 모드는 `backend/.env`의 `AXK1_API_KEY` 또는 `UPSTAGE_API_KEY`가 필요하다(없으면 명확한 오류로 종료).

## 검색 threshold 평가 (Retrieval Recall@K)

`golden_retrieval.json`(세션 요약 10개 + 긍정 질의 14개 + 음성 질의 5개)을 실제
파이프라인과 동일한 임베딩 경로(passage/query 비대칭)로 점수화해 threshold 후보별
Recall@1/@3과 음성 질의 차단율을 출력한다(실 임베딩 API 호출):

```
python -m eval.run_retrieval_eval
```

`search_score_threshold` 기본값 조정 근거는 `docs/DecisionLog.md` 2026-08-05 항목 참고.

## Ask AI 답변 품질 평가

`ask_cases.json`(6개 주제 34개 이벤트, 페이지 본문 포함 + 질문 20개: 사실·비교·요약·할 일·
교차 세션·부정)을 **실행 중인 백엔드**에 UI와 같은 경로(`/assistant/route` → `/ask/stream`)로
보내 채점한다(실 LLM·임베딩 호출). 데이터는 별도 평가 사용자(`google_sub=ask-eval`)에 쌓인다.

```
python -m eval.run_ask_eval seed                       # 최초 1회: 인제스트 + 세션화 대기
python -m eval.run_ask_eval ask --out ask_result.json  # 질문·채점
```

다른 주소의 백엔드는 `--base http://127.0.0.1:8001`. 지표는 기대 사실 포함률(`a|b`는 대안 표기),
완전 정답 수, 부정 질문 거절 수(문구 기반 근사), 범위 밖 인용 수, 평균 지연이다.
기준선과 개선 결과는 `docs/WorkLog.md` 2026-10-19 항목 참고.
