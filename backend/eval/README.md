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
