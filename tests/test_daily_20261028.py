import pytest

from src.utils.async_utils import truncate


def test_negative_truncation_budget_is_rejected():
    with pytest.raises(ValueError):
        truncate("abcdef", -1)


def test_valid_truncation_behavior_is_preserved():
    assert truncate(123456, 3) == "123"
    assert truncate("abcdef", 0) == ""
