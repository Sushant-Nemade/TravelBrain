import json
import sqlite3
from contextlib import contextmanager
from pathlib import Path


class ConflictError(Exception):
    pass


class TripStore:
    def __init__(self, path: str | Path):
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        with self.connection() as connection:
            connection.execute(
                "CREATE TABLE IF NOT EXISTS trips (id TEXT PRIMARY KEY, revision INTEGER NOT NULL, payload TEXT NOT NULL)"
            )

    @contextmanager
    def connection(self):
        connection = sqlite3.connect(self.path, timeout=5)
        try:
            with connection:
                yield connection
        finally:
            connection.close()

    def save(self, plan: dict, expected: int | None = None):
        payload = json.dumps(plan, ensure_ascii=True, allow_nan=False)
        if len(payload.encode()) > 150000:
            raise ValueError("Trip exceeds the storage limit.")
        with self.connection() as connection:
            if expected is None:
                connection.execute(
                    "INSERT INTO trips VALUES (?, ?, ?)", (plan["id"], plan["revision"], payload)
                )
                connection.execute(
                    "DELETE FROM trips WHERE rowid NOT IN (SELECT rowid FROM trips ORDER BY rowid DESC LIMIT 100)"
                )
            elif (
                connection.execute(
                    "UPDATE trips SET revision=?, payload=? WHERE id=? AND revision=?",
                    (plan["revision"], payload, plan["id"], expected),
                ).rowcount
                != 1
            ):
                raise ConflictError("The trip changed. Reload before saving again.")
        return plan

    def get(self, trip_id: str) -> dict | None:
        with self.connection() as connection:
            row = connection.execute("SELECT payload FROM trips WHERE id=?", (trip_id,)).fetchone()
        return json.loads(row[0]) if row else None

    def list(self) -> list[dict]:
        with self.connection() as connection:
            rows = connection.execute("SELECT payload FROM trips ORDER BY rowid DESC LIMIT 100").fetchall()
        return [
            {
                "id": plan["id"],
                "destination": plan["destination"],
                "start_date": plan["request"]["start_date"],
                "days": plan["request"]["days"],
                "revision": plan["revision"],
            }
            for plan in (json.loads(row[0]) for row in rows)
        ]

    def delete(self, trip_id: str):
        with self.connection() as connection:
            return connection.execute("DELETE FROM trips WHERE id=?", (trip_id,)).rowcount == 1
