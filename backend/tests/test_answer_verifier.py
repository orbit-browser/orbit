import asyncio
import json

from app.services import answer_verifier as verifier


def _claims(*claims) -> str:
    return "검증 결과:\n" + json.dumps({"claims": list(claims)}, ensure_ascii=False)


def _claim(value, quote=None, same=False, record="서울역 출발 KTX 847", answer="청량리 출발 막차"):
    quote = f"KTX 847 / 서울역 / {value} (막차)" if quote is None else quote
    return {"value": value, "answer_subject": answer, "quote": quote, "record_subject": record, "same": same}


def test_mismatched_claims_keeps_only_quoted_different_subjects():
    raw = _claims(
        _claim("21:31"),
        _claim("21:31"),  # 같은 값은 한 번만
        _claim("05:32", same=True),
        _claim("10개", quote=""),  # 원문 없는 값은 검증기가 못 찾은 것과 구분되지 않는다
        _claim("70%", record=" "),
        _claim("12개월", quote="지원 기간: 최대 24개월"),  # 계산값(차이)은 인용에 없다
        _claim("12개월", quote="지역마다 상이(예: 12개월)", answer="두 제도의 지원 기간 차이"),  # 우연히 같은 계산값
    )

    issues = verifier.mismatched_claims(raw)

    assert [issue.model_dump() for issue in issues] == [
        {"value": "21:31", "answer_subject": "청량리 출발 막차", "record_subject": "서울역 출발 KTX 847"}
    ]


def test_mismatched_claims_matches_value_in_quote_ignoring_spaces_and_commas():
    raw = _claims(_claim("1억 2천만원", quote="최대 1억2천만원"), _claim("6,500만원", quote="초봉 6500만원"))
    assert [issue.value for issue in verifier.mismatched_claims(raw)] == ["1억 2천만원", "6,500만원"]


def test_mismatched_claims_caps_issue_count():
    raw = _claims(*[_claim(f"{n}%") for n in range(5)])
    assert len(verifier.mismatched_claims(raw)) == verifier.MAX_ISSUES


def test_is_refusal_checks_only_first_sentence():
    assert verifier.is_refusal("기록에서 찾지 못했어요. 다만 서울역 출발 막차는 21:31이에요 [1].")
    assert verifier.is_refusal("청량리 출발 막차 시각은 기록에 없어요.")
    assert not verifier.is_refusal("막차는 21:31입니다 [1]. 청량리 정차 여부는 찾지 못했어요.")


def _patch_llm(monkeypatch, result=None, error=None):
    calls: list[str] = []

    async def fake(_system, user, **_kwargs):
        calls.append(user)
        if error:
            raise error
        return result

    monkeypatch.setattr(verifier, "chat_completion_with_meta", fake)
    return calls


def test_find_conflations_returns_issues_from_primary_model(monkeypatch):
    calls = _patch_llm(monkeypatch, (_claims(_claim("21:31")), verifier.settings.axk1_model))

    issues = asyncio.run(verifier.find_conflations("질문과 근거", "막차는 21:31입니다 [1]."))

    assert [issue.value for issue in issues] == ["21:31"]
    assert calls == ["질문과 근거\n\n검증할 답변:\n막차는 21:31입니다 [1]."]


def test_find_conflations_skips_refusal_without_calling_llm(monkeypatch):
    calls = _patch_llm(monkeypatch, (_claims(_claim("x")), verifier.settings.axk1_model))
    assert asyncio.run(verifier.find_conflations("p", "기록에서 찾지 못했어요. [1]")) == []
    assert asyncio.run(verifier.find_conflations("p", "  ")) == []
    assert calls == []


def test_find_conflations_ignores_fallback_model_result(monkeypatch):
    _patch_llm(monkeypatch, (_claims(_claim("21:31")), "K-EXAONE"))
    assert asyncio.run(verifier.find_conflations("p", "막차는 21:31입니다.")) == []


def test_find_conflations_fails_open_on_malformed_json_error_and_timeout(monkeypatch):
    _patch_llm(monkeypatch, ("claims 없음", verifier.settings.axk1_model))
    assert asyncio.run(verifier.find_conflations("p", "막차는 21:31입니다.")) == []

    _patch_llm(monkeypatch, ('{"claims": [{"same": false}]}', verifier.settings.axk1_model))
    assert asyncio.run(verifier.find_conflations("p", "막차는 21:31입니다.")) == []

    _patch_llm(monkeypatch, error=RuntimeError("upstream down"))
    assert asyncio.run(verifier.find_conflations("p", "막차는 21:31입니다.")) == []

    async def slow(*_args, **_kwargs):
        await asyncio.sleep(1)

    monkeypatch.setattr(verifier, "chat_completion_with_meta", slow)
    monkeypatch.setattr(verifier, "VERIFY_TIMEOUT_S", 0.01)
    assert asyncio.run(verifier.find_conflations("p", "막차는 21:31입니다.")) == []
