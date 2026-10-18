from datetime import datetime, timedelta, timezone
from uuid import uuid4

from src.catalog import CATALOG_VERSION, DESTINATIONS
from src.contracts import TripRequest


def amount(euros: int, currency: str) -> int:
    numerator, denominator = {"EUR": (100, 1), "USD": (110, 1), "GBP": (85, 1)}[currency]
    return euros * numerator // denominator


def build_plan(request: TripRequest) -> dict:
    place = DESTINATIONS[request.destination]
    catalog = [
        {
            "id": f"{request.destination}-{index}",
            "title": title,
            "category": category,
            "cost_minor": amount(cost, request.currency) * request.travelers,
            "source": source,
            "access_review": accessible,
        }
        for index, (title, category, cost, source, accessible) in enumerate(place["activities"])
    ]
    if not set(request.excluded_ids).issubset({item["id"] for item in catalog}):
        raise ValueError("Excluded activity is not in the selected destination.")
    candidates = [
        item
        for item in catalog
        if item["id"] not in request.excluded_ids and (not request.step_free or item["access_review"])
    ]
    candidates.sort(key=lambda item: item["category"] not in request.interests)
    per_day = {"relaxed": 1, "balanced": 2, "busy": 3}[request.pace]
    days = []
    for index in range(request.days):
        items = candidates[index * per_day : (index + 1) * per_day]
        activities = []
        for position, item in enumerate(items):
            activities.append(
                {
                    **item,
                    "time": ("09:30", "13:00", "16:00")[position],
                    "duration_minutes": 90,
                    "detail": "Flexible visit; check opening times, access and reservations at the source.",
                }
            )
        days.append(
            {
                "date": (request.start_date + timedelta(days=index)).isoformat(),
                "number": index + 1,
                "activities": activities,
                "free_time": "Unallocated time for meals, transfers and independent exploration.",
            }
        )
    activities_total = sum(item["cost_minor"] for day in days for item in day["activities"])
    rooms = (request.travelers + 1) // 2
    lines = [
        {
            "label": "Accommodation",
            "amount_minor": amount(place["night_eur"], request.currency) * max(request.days - 1, 0) * rooms,
            "basis": f"{max(request.days - 1, 0)} nights, {rooms} room(s), illustrative nightly allowance",
        },
        {
            "label": "Meals",
            "amount_minor": amount(40, request.currency) * request.days * request.travelers,
            "basis": "Illustrative daily allowance per traveler; tastings are additional",
        },
        {
            "label": "Local transport",
            "amount_minor": amount(12, request.currency) * request.days * request.travelers,
            "basis": "Illustrative daily allowance per traveler, not route quotes",
        },
        {
            "label": "Activities and tastings",
            "amount_minor": activities_total,
            "basis": "Planning placeholders, not verified ticket prices",
        },
    ]
    subtotal = sum(line["amount_minor"] for line in lines)
    lines.append(
        {
            "label": "Contingency",
            "amount_minor": (subtotal + 9) // 10,
            "basis": "10% of the estimated subtotal, rounded up",
        }
    )
    total = sum(line["amount_minor"] for line in lines)
    warnings = [
        "All costs are illustrative planning allowances, not live prices or offers.",
        "Flights, intercity travel, insurance, taxes and booking charges are excluded.",
        "Opening hours, reservations, weather and route accessibility need independent confirmation.",
        "EUR/USD/GBP conversions use fixed illustrative ratios (1 / 1.10 / 0.85), not market exchange rates.",
        "Schedule slots allow breaks but are not a route or opening-hours feasibility guarantee.",
    ]
    if request.step_free:
        warnings.append(
            "Known stair-heavy options were excluded; step-free access is NOT independently verified."
        )
    if len(candidates) < request.days * per_day:
        warnings.append(
            "The bounded catalog has fewer activities than requested slots; remaining time is deliberately unallocated."
        )
    if request.start_date < datetime.now(timezone.utc).date():
        warnings.append("The selected trip starts in the past.")
    if total > request.budget_minor:
        warnings.append("Estimated destination costs exceed your budget; no costs were silently reduced.")
    if request.notes:
        warnings.append(
            "Free-text notes are retained for review; the deterministic planner does not interpret them as constraints."
        )
    return {
        "id": str(uuid4()),
        "revision": 1,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "request": request.model_dump(mode="json"),
        "destination": place["name"],
        "country": place["country"],
        "timezone": place["timezone"],
        "catalog_version": CATALOG_VERSION,
        "days": days,
        "budget": {
            "currency": request.currency,
            "lines": lines,
            "total_minor": total,
            "remaining_minor": request.budget_minor - total,
            "over_budget": total > request.budget_minor,
        },
        "sources": sorted({item["source"] for day in days for item in day["activities"]}),
        "warnings": warnings,
        "ai_notes": None,
        "weather": {"status": "not_requested", "days": [], "source": "https://open-meteo.com/"},
        "flights": {
            "status": "unavailable",
            "detail": "No live flight fares or availability are provided. Arrange origin travel separately.",
        },
        "hotels": {
            "status": "estimate_only",
            "detail": "Accommodation is a room/night allowance, not a property listing or availability check.",
        },
    }


def markdown(plan: dict) -> str:
    lines = [f"# {plan['destination']} trip", "", "Planning reference; no booking or price guarantee.", ""]
    for day in plan["days"]:
        lines.append(f"## Day {day['number']} - {day['date']}")
        lines.extend(f"- {item['time']}: {item['title']} ({item['source']})" for item in day["activities"])
        lines.extend([day["free_time"], ""])
    lines.extend(["## Budget", f"Currency: {plan['budget']['currency']} (illustrative)"])
    lines.extend(f"- {line['label']}: {line['amount_minor'] / 100:.2f}" for line in plan["budget"]["lines"])
    lines.extend([f"Total: {plan['budget']['total_minor'] / 100:.2f}", "", "## Limitations"])
    lines.extend(f"- {warning}" for warning in plan["warnings"])
    return "\n".join(lines) + "\n"
