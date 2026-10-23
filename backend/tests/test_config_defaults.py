"""운영값으로 정한 하한 기본값을 고정한다. monkeypatch로 덮는 시험은 기본값 회귀를 잡지 못한다.

`Settings()`는 backend/.env를 읽으므로 코드에 적힌 기본값을 직접 본다.
"""

from app.config import Settings


def _default(name: str):
    return Settings.model_fields[name].default


def test_tab_action_match_floor_default_is_golden_value():
    # DecisionLog 2026-08-07: 실제 탭 골든셋 21건으로 정한 값.
    assert _default("tab_action_match_score_floor") == 0.20
    assert _default("tab_action_match_margin") == 0.06


def test_assistant_navigation_floor_defaults():
    # 라우팅 골든셋 + UI 시험 8문항(탭 이동 8/8, 오이동 0)으로 고른 값.
    assert _default("assistant_route_navigation_floor") == 0.20
    assert _default("assistant_route_navigation_margin") == 0.05
