import json

import pytest

from app.ai.json_utils import extract_json


def test_plain_json():
    assert extract_json('{"a": 1}') == {"a": 1}


def test_json_with_fence():
    raw = '```json\n{"a": 1, "b": [1, 2]}\n```'
    assert extract_json(raw) == {"a": 1, "b": [1, 2]}


def test_fence_without_json_hint():
    raw = '```\n{"a": 1}\n```'
    assert extract_json(raw) == {"a": 1}


def test_leading_trailing_chatter():
    raw = '물론이죠, 요청하신 결과입니다:\n{"a": 1}\n이상입니다.'
    assert extract_json(raw) == {"a": 1}


def test_truncated_json_raises():
    with pytest.raises(json.JSONDecodeError):
        extract_json('{"a": 1, "b": [1, 2')
