import pytest
from pydantic import ValidationError

from src.contracts import TripRequest


def test_default_trip_and_whitespace():
    trip = TripRequest(start_date="2027-02-01", origin="  London  ")
    assert trip.origin == "London"
    assert trip.days == 4
    assert trip.budget_minor == 180000


@pytest.mark.parametrize(
    "fields",
    [
        {"days": 0},
        {"days": 11},
        {"days": True},
        {"travelers": 9},
        {"budget_minor": 1},
        {"budget_minor": 123.4},
        {"interests": ["food", "food"]},
        {"destination": "unknown"},
        {"database_url": "postgresql://untrusted"},
        {"start_date": "2100-12-31", "days": 2},
    ],
)
def test_invalid_trip_rejected(fields):
    with pytest.raises(ValidationError):
        TripRequest.model_validate({"start_date": "2027-02-01", **fields})
