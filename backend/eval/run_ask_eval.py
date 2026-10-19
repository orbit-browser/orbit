"""Ask AI 답변 품질 평가 — 실행 중인 백엔드를 UI와 같은 경로로 호출한다(실 LLM·임베딩 호출).

  python -m eval.run_ask_eval seed              # 평가 사용자에 ask_cases.json 이벤트 인제스트 + 세션화 대기
  python -m eval.run_ask_eval ask --out a.json  # 질문 → /assistant/route → /ask/stream, 채점 결과 저장

평가 데이터는 별도 사용자(google_sub=ask-eval)에 쌓이므로 개발 계정 데이터와 섞이지 않는다.
backend/.env의 DATABASE_URL이 대상 백엔드와 같은 DB를 가리켜야 한다(평가 사용자 토큰 발급용).
"""
import argparse
import asyncio
import json
import re
import time
from pathlib import Path

import httpx
from sqlalchemy import select

from app.db.models import User
from app.db.session import AsyncSessionLocal
from app.services.auth_tokens import issue_token

_CASES = json.loads(Path(__file__).with_name("ask_cases.json").read_text(encoding="utf-8"))
# 거절 판정은 문구 기반 근사치다. 부정 질문의 답은 사람이 한 번 더 읽어 확인한다.
_REFUSAL = re.compile(
    r"찾지 못|찾을 수 없|확인되지 않|기록이 없|정보가 없|나와 있지 않|포함되어 있지 않|없(?:습니다|어요|네요|었)"
)


async def _token() -> str:
    async with AsyncSessionLocal() as db:
        user = await db.scalar(select(User).where(User.google_sub == "ask-eval"))
        if user is None:
            user = User(google_sub="ask-eval", email="ask-eval@orbit.local", name="Ask Eval")
            db.add(user)
            await db.commit()
            await db.refresh(user)
    return issue_token(user.id)[0]


async def seed(base: str) -> None:
    headers = {"Authorization": f"Bearer {await _token()}"}
    async with httpx.AsyncClient(base_url=base, headers=headers, timeout=60) as client:
        response = await client.post("/events", json={"device_id": "ask-eval", "events": _CASES["events"]})
        print("ingest", response.status_code, response.text)
        response = await client.post("/sync", json={"trigger_type": "manual"})
        print("sync", response.status_code, response.text)
        for _ in range(120):
            status = (await client.get("/sync/status")).json()
            if not status["running"] and status["pending"] == 0:
                break
            await asyncio.sleep(5)
        print("status", status)
        for session in (await client.get("/sessions")).json():
            print(f"- {session['title']} | tabs={len(session.get('tabs') or [])}")


def _norm(text: str) -> str:
    return re.sub(r"[\s,]", "", text).lower()


async def _ask(client: httpx.AsyncClient, case: dict) -> dict:
    started = time.monotonic()
    route = (await client.post("/assistant/route", json={"query": case["query"]})).json()
    # UI는 navigate_tab일 때 열린 탭을 먼저 찾고 실패하면 search_memory로 답한다. 평가는 답변만 본다.
    intent = route.get("intent", "search_memory")
    if intent == "navigate_tab":
        intent = "search_memory"

    sources: list[str] = []
    answer, model, error, event = "", None, None, None
    body = {"query": case["query"], "intent": intent, "rerank": True}
    async with client.stream("POST", "/ask/stream", json=body) as response:
        async for line in response.aiter_lines():
            if line.startswith("event: "):
                event = line[7:]
            elif line.startswith("data: "):
                data = json.loads(line[6:])
                if event == "sources":
                    sources = [session["title"] for session in data["sessions"]]
                elif event == "delta":
                    answer += data["text"]
                elif event == "done":
                    model = data.get("model")
                elif event == "error":
                    error = data

    facts = case["expected_facts"]
    # 한 항목에 "a|b"로 대안 표기를 둘 수 있다(같은 사실의 다른 표기·타당한 다른 해석).
    hit = [fact for fact in facts if any(_norm(alt) in _norm(answer) for alt in fact.split("|"))]
    citations = {int(n) for n in re.findall(r"\[(\d+)\]", answer)}
    return {
        **case,
        "route": route,
        "sources": sources,
        "answer": answer,
        "model": model,
        "error": error,
        "latency_s": round(time.monotonic() - started, 1),
        "fact_recall": len(hit) / len(facts) if facts else None,
        "missed_facts": [fact for fact in facts if fact not in hit],
        "refused": bool(_REFUSAL.search(answer)),
        "bad_citation": any(n < 1 or n > len(sources) for n in citations),
    }


async def ask(base: str, out: Path | None) -> None:
    headers = {"Authorization": f"Bearer {await _token()}"}
    results = []
    async with httpx.AsyncClient(base_url=base, headers=headers, timeout=120) as client:
        for case in _CASES["questions"]:
            result = await _ask(client, case)
            results.append(result)
            score = (
                f"recall={result['fact_recall']:.2f}"
                if result["fact_recall"] is not None
                else f"refused={result['refused']}"
            )
            print(f"{case['id']} [{case['type']}] {score} src={len(result['sources'])} {result['latency_s']}s  {case['query']}")
    if out:
        out.write_text(json.dumps(results, ensure_ascii=False, indent=1), encoding="utf-8")

    positive = [r for r in results if r["type"] != "negative"]
    negative = [r for r in results if r["type"] == "negative"]
    summary = {
        "fact_recall_mean": round(sum(r["fact_recall"] for r in positive) / len(positive), 3),
        "positive_fully_answered": f"{sum(r['fact_recall'] == 1 for r in positive)}/{len(positive)}",
        "negative_refused": f"{sum(r['refused'] for r in negative)}/{len(negative)}",
        "bad_citations": sum(r["bad_citation"] for r in results),
        "errors": sum(bool(r["error"]) for r in results),
        "models": sorted({r["model"] for r in results if r["model"]}),
        "mean_latency_s": round(sum(r["latency_s"] for r in results) / len(results), 1),
    }
    print(json.dumps(summary, ensure_ascii=False, indent=2))


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("command", choices=["seed", "ask"])
    parser.add_argument("--base", default="http://127.0.0.1:8000", help="대상 백엔드 주소")
    parser.add_argument("--out", type=Path, help="ask 결과(JSON) 저장 경로")
    args = parser.parse_args()
    asyncio.run(seed(args.base) if args.command == "seed" else ask(args.base, args.out))


if __name__ == "__main__":
    main()
