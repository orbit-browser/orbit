import asyncio

from app.ai import clusterer
from app.schemas.session import TabItemRequest


def make_tabs(n: int) -> list[TabItemRequest]:
    return [
        TabItemRequest(url=f"https://example.com/{i}", title=f"tab{i}", text_content="")
        for i in range(n)
    ]


def test_below_min_tabs_skips_llm(monkeypatch):
    async def boom(*_a, **_k):
        raise AssertionError("탭이 적으면 LLM을 호출하지 않아야 함")

    monkeypatch.setattr(clusterer, "chat_completion_light", boom)

    tabs = make_tabs(3)
    result = asyncio.run(clusterer.cluster_tabs(tabs))
    assert result == [tabs]


def test_missing_and_invalid_indices_recovered(monkeypatch):
    tabs = make_tabs(5)

    async def fake_llm(*_a, **_k):
        return '{"clusters": [{"topic": "a", "indices": [0, 1, 99, -1]}]}'

    monkeypatch.setattr(clusterer, "chat_completion_light", fake_llm)

    result = asyncio.run(clusterer.cluster_tabs(tabs))
    # 범위를 벗어난 인덱스(99, -1)는 무시되고, LLM이 빠뜨린 탭(2,3,4)은 마지막 그룹(=유일한 그룹)에 회수됨
    assert len(result) == 1
    assert result[0][:2] == [tabs[0], tabs[1]]
    assert {t.title for t in result[0]} == {"tab0", "tab1", "tab2", "tab3", "tab4"}


def test_overflow_tabs_appended_to_last_group(monkeypatch):
    tabs = make_tabs(25)  # _MAX_TABS(20) 초과

    async def fake_llm(*_a, **_k):
        indices = list(range(20))
        return '{"clusters": [{"topic": "a", "indices": ' + str(indices) + "}]}"

    monkeypatch.setattr(clusterer, "chat_completion_light", fake_llm)

    result = asyncio.run(clusterer.cluster_tabs(tabs))
    titles = [t.title for group in result for t in group]
    assert "tab24" in titles


def test_llm_failure_falls_back_to_single_group(monkeypatch):
    tabs = make_tabs(5)

    async def boom(*_a, **_k):
        raise RuntimeError("network error")

    monkeypatch.setattr(clusterer, "chat_completion_light", boom)

    result = asyncio.run(clusterer.cluster_tabs(tabs))
    assert result == [tabs]
