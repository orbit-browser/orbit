# Orbit 세션화 평가 하네스

`backend` 디렉터리에서 실행한다(golden/*.json 전체 평가, 실 LLM 호출):

```
python -m eval.run_eval
```

단일 시나리오만: `python -m eval.run_eval --file eval/golden/rtx_5070_purchase.json`
응답 기록: `python -m eval.run_eval --record eval/golden/_recorded.json`
기록 재생(LLM 미호출, CI용): `python -m eval.run_eval --replay eval/golden/_recorded.json`

실 LLM 모드는 `backend/.env`의 `AXK1_API_KEY` 또는 `UPSTAGE_API_KEY`가 필요하다(없으면 명확한 오류로 종료).
