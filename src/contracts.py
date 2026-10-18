from datetime import date, timedelta
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator


class TripRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    destination: Literal["paris", "lisbon", "kyoto"] = "paris"
    origin: str = Field(default="", max_length=80)
    start_date: date
    days: int = Field(default=4, ge=1, le=10, strict=True)
    travelers: int = Field(default=2, ge=1, le=8, strict=True)
    budget_minor: int = Field(default=180000, ge=5000, le=100000000, strict=True)
    currency: Literal["EUR", "USD", "GBP"] = "EUR"
    pace: Literal["relaxed", "balanced", "busy"] = "balanced"
    interests: list[Literal["history", "art", "food", "outdoors"]] = Field(
        default_factory=lambda: ["history", "food"], min_length=1, max_length=4
    )
    step_free: bool = False
    notes: str = Field(default="", max_length=600)
    ai: bool = False
    live_weather: bool = False
    excluded_ids: list[str] = Field(default_factory=list, max_length=36)

    @model_validator(mode="after")
    def validate_trip(self):
        if len(set(self.interests)) != len(self.interests):
            raise ValueError("Interests must be unique.")
        if len(set(self.excluded_ids)) != len(self.excluded_ids):
            raise ValueError("Excluded activities must be unique.")
        if self.start_date.year < 2000 or self.start_date.year > 2100:
            raise ValueError("Choose a date between 2000 and 2100.")
        if (self.start_date + timedelta(days=self.days - 1)).year > 2100:
            raise ValueError("Trip ends outside the supported date range.")
        return self
