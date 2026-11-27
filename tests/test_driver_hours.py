"""Driver hours reset: a new sim day and an 11 h rest give drivers fresh hours, so dispatch keeps going.
Run: AGENT_MODE=rules python -m pytest tests  (or python tests/test_driver_hours.py)
Routing is replaced by straight lines so no test calls OSRM."""
import os
import sys
from pathlib import Path

os.environ["AGENT_MODE"] = "rules"
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from backend import services  # noqa: E402

services.get_routes = lambda a, b, alternatives=False: [services._straight_route(a, b)] * (2 if alternatives else 1)

from backend.sim import DAILY_DRIVE_MAX, DAILY_REST_MIN, World  # noqa: E402


class SyncRouter:
    def submit(self, fn):
        fn()


def make_world():
    w = World(seed=7)
    w.router = SyncRouter()
    w.weather = {"text": "test", "source": "-", "temp_c": 5, "precip_mm": 0, "snow_cm": 0, "wind_kmh": 5, "code": 1}
    return w


def test_vehicles_still_assigned_after_a_full_day():
    w = make_world()
    assigned_at = []
    orig = w.assign

    def spy(vid, jid, bump=None):
        assigned_at.append(w.sim)
        return orig(vid, jid, bump)
    w.assign = spy

    end = w.sim + 2 * 1440            # 06:00 day 1 -> 06:00 day 3, high speed (4 sim min per tick)
    while w.sim < end:
        w.tick(4.0)
    late = [t for t in assigned_at if t >= end - 360]
    assert len(late) >= 15, f"only {len(late)} assignments in the last 6 sim hours"
    assert all(v["drive_today"] <= DAILY_DRIVE_MAX for v in w.vehicles.values())


def test_new_day_resets_hours():
    w = make_world()
    v = next(iter(w.vehicles.values()))
    v["drive_today"], v["drive_since_break"] = DAILY_DRIVE_MAX, 200
    w.sim = 1440 - 1                  # one minute to midnight
    w._last_day = 0
    w.tick(2.0)
    assert v["drive_today"] == 0 and v["drive_since_break"] == 0


def test_eleven_hour_rest_resets_hours():
    w = make_world()
    v = next(x for x in w.vehicles.values() if x["status"] == "idle")
    w.sim = 1440 + 60                 # day 2 01:00, past the midnight reset
    w._last_day = 1
    v["drive_today"], v["drive_since_break"] = 300, 100
    v["last_drive"] = w.sim
    v["health"] = 10                  # dispatch skips it, so it stays idle and rests
    w.tick(DAILY_REST_MIN - 5)
    assert v["drive_today"] == 300
    w.tick(10)
    assert v["drive_today"] == 0 and v["drive_since_break"] == 0


if __name__ == "__main__":
    for name, fn in list(globals().items()):
        if name.startswith("test_"):
            fn()
            print("ok", name)
