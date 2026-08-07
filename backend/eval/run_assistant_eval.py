import asyncio
import json
from collections import Counter, defaultdict
from pathlib import Path

from sqlalchemy import select

from app.ai.embedding import embed_many
from app.config import settings
from app.db.models import ExplorationEvent, Session as SessionModel, SessionEvent
from app.db.session import AsyncSessionLocal
from app.services.assistant_router import (
    _INTENT_PASSAGES,
    route_from_vectors,
    rule_intent,
)
from app.services.ask_service import _limit_event_candidates, build_event_passage
from app.services.tab_action_resolver import cosine_similarity


_CASES_PATH = Path(__file__).with_name("assistant_route_cases.json")


async def evaluate_live_content() -> dict:
    async with AsyncSessionLocal() as db:
        result = await db.execute(
            select(SessionEvent, ExplorationEvent)
            .join(ExplorationEvent, SessionEvent.event_id == ExplorationEvent.id)
            .join(SessionModel, SessionEvent.session_id == SessionModel.id)
            .where(SessionModel.status == "active", ExplorationEvent.sync_status != "discarded")
            .order_by(ExplorationEvent.visited_at.desc())
            .limit(500)
        )
        limited_rows = _limit_event_candidates(result.all())

    by_session: dict[str, list[tuple[SessionEvent, ExplorationEvent]]] = defaultdict(list)
    for session_event, event in limited_rows:
        by_session[session_event.session_id].append((session_event, event))

    probes: list[tuple[str, str, str]] = []
    seen_queries: set[str] = set()
    for session_id, rows in by_session.items():
        if len(rows) < 2:
            continue
        for _session_event, event in rows:
            query = (event.search_query or "").strip()
            source = "search_query"
            if len(query) < 3:
                query = (event.title or "").strip()
                source = "title"
            normalized = query.casefold()
            if len(query) < 5 or normalized in seen_queries:
                continue
            seen_queries.add(normalized)
            probes.append((session_id, event.id, f"{source}:{query}"))
            if len(probes) >= 20:
                break
        if len(probes) >= 20:
            break

    if not probes:
        return {"probes": 0, "hit_at_1": 0, "hit_at_3": 0}

    probe_session_ids = {probe[0] for probe in probes}
    candidate_rows = [
        row
        for session_id, rows in by_session.items()
        if session_id in probe_session_ids
        for row in rows
    ]
    query_texts = [probe[2].split(":", 1)[1] for probe in probes]
    query_vectors, passage_vectors = await asyncio.gather(
        embed_many(query_texts),
        embed_many(
            [build_event_passage(event) for _session_event, event in candidate_rows],
            model=settings.embedding_passage_model,
        ),
    )
    vectors_by_event = {
        (session_event.session_id, event.id): vector
        for (session_event, event), vector in zip(candidate_rows, passage_vectors)
    }

    hit_at_1 = 0
    hit_at_3 = 0
    for (session_id, expected_event_id, _query), query_vector in zip(probes, query_vectors):
        ranked = sorted(
            (
                (
                    event.id,
                    cosine_similarity(query_vector, vectors_by_event[(session_id, event.id)]),
                )
                for _session_event, event in by_session[session_id]
            ),
            key=lambda item: item[1],
            reverse=True,
        )
        hit_at_1 += bool(ranked and ranked[0][0] == expected_event_id)
        hit_at_3 += expected_event_id in {event_id for event_id, _score in ranked[:3]}

    return {
        "probes": len(probes),
        "search_query_probes": sum(probe[2].startswith("search_query:") for probe in probes),
        "hit_at_1": hit_at_1,
        "hit_at_3": hit_at_3,
    }


async def main() -> None:
    cases = json.loads(_CASES_PATH.read_text(encoding="utf-8"))
    semantic_cases = [case for case in cases if rule_intent(case["query"]) is None]
    query_vectors, prototype_vectors = await asyncio.gather(
        embed_many([case["query"] for case in semantic_cases]),
        embed_many(
            [passage for _intent, passage in _INTENT_PASSAGES],
            model=settings.embedding_passage_model,
        ),
    )
    vectors_by_id = {
        case["id"]: vector for case, vector in zip(semantic_cases, query_vectors)
    }

    details = []
    confusion: dict[str, Counter[str]] = defaultdict(Counter)
    for case in cases:
        ruled = rule_intent(case["query"])
        if ruled:
            intent, reason, confidence, margin = ruled, "rule", 1.0, 1.0
        else:
            result = route_from_vectors(vectors_by_id[case["id"]], prototype_vectors)
            intent = result.intent
            reason = result.reason
            confidence = result.confidence
            margin = result.margin
        correct = intent == case["expected"]
        confusion[case["expected"]][intent] += 1
        details.append(
            {
                "id": case["id"],
                "expected": case["expected"],
                "actual": intent,
                "reason": reason,
                "confidence": confidence,
                "margin": margin,
                "correct": correct,
            }
        )

    total_correct = sum(item["correct"] for item in details)
    report = {
        "config": {
            "navigation_floor": settings.assistant_route_navigation_floor,
            "navigation_margin": settings.assistant_route_navigation_margin,
            "retrieval_margin": settings.assistant_route_retrieval_margin,
        },
        "metrics": {
            "correct": total_correct,
            "total": len(details),
            "accuracy": round(total_correct / len(details), 4),
            "navigation_false_positives": sum(
                item["actual"] == "navigate_tab"
                and item["expected"] != "navigate_tab"
                for item in details
            ),
        },
        "confusion": {
            expected: dict(actual_counts)
            for expected, actual_counts in confusion.items()
        },
        "details": details,
        "live_content": await evaluate_live_content(),
    }
    print(json.dumps(report, ensure_ascii=False, indent=2))
    if report["metrics"]["navigation_false_positives"]:
        raise SystemExit(2)


if __name__ == "__main__":
    asyncio.run(main())
