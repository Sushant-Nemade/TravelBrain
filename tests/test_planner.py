from datetime import date, timedelta

import pytest

from src.contracts import TripRequest
from src.planner import build_plan, markdown
from src.store import ConflictError, TripStore


@pytest.mark.parametrize("destination", ["paris", "lisbon", "kyoto"])
@pytest.mark.parametrize("pace", ["relaxed", "balanced", "busy"])
def test_schedule_and_budget_invariants(destination, pace):
    request = TripRequest(start_date="2027-01-01", destination=destination, pace=pace, days=10, travelers=3)
    plan = build_plan(request)
    assert len(plan["days"]) == 10
    ids = [item["id"] for day in plan["days"] for item in day["activities"]]
    assert len(ids) == len(set(ids))
    assert all(
        day["date"] == (date(2027, 1, 1) + timedelta(days=index)).isoformat()
        for index, day in enumerate(plan["days"])
    )
    assert plan["budget"]["total_minor"] == sum(line["amount_minor"] for line in plan["budget"]["lines"])
    assert all(item["source"].startswith("https://") for day in plan["days"] for item in day["activities"])
    assert "## Budget" in markdown(plan)


def test_access_exclusions_and_low_budget_are_honest():
    plan = build_plan(
        TripRequest(start_date="2027-01-01", step_free=True, budget_minor=5000, excluded_ids=["paris-0"])
    )
    activities = [item for day in plan["days"] for item in day["activities"]]
    assert all(item["access_review"] and item["id"] != "paris-0" for item in activities)
    assert plan["budget"]["over_budget"]
    assert any("NOT independently verified" in warning for warning in plan["warnings"])
    with pytest.raises(ValueError):
        build_plan(TripRequest(start_date="2027-01-01", excluded_ids=["kyoto-0"]))


def test_store_reopen_revision_delete_and_retention(tmp_path):
    path = tmp_path / "trips.sqlite"
    store = TripStore(path)
    plan = build_plan(TripRequest(start_date="2027-01-01"))
    store.save(plan)
    assert TripStore(path).get(plan["id"]) == plan
    plan["revision"] = 2
    store.save(plan, expected=1)
    with pytest.raises(ConflictError):
        store.save(plan, expected=1)
    assert store.list()[0]["revision"] == 2
    assert store.delete(plan["id"])
    assert not store.get(plan["id"])
    for _ in range(102):
        store.save(build_plan(TripRequest(start_date="2027-01-01")))
    assert len(store.list()) == 100
