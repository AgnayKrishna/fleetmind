"""The 'Refuel now' / 'Charge now' button in the Needs your attention bar.
Run: AGENT_MODE=rules python -m pytest tests  (or python tests/test_energy_stop.py)
Routing is replaced by straight lines so no test calls OSRM."""
import os
import sys
from pathlib import Path

os.environ["AGENT_MODE"] = "rules"
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from fastapi.testclient import TestClient  # noqa: E402

from backend import services  # noqa: E402

services.get_routes = lambda a, b, alternatives=False: [services._straight_route(a, b)] * (2 if alternatives else 1)

from backend.app import app, world as app_world  # noqa: E402
from backend.data import PRICES  # noqa: E402
from backend.sim import World  # noqa: E402


class SyncRouter:
    """Runs route requests straight away so the test is deterministic."""
    def submit(self, fn):
        fn()


def make_world():
    w = World(seed=7)
    w.router = SyncRouter()
    return w


def first(w, vtype, status="idle"):
    return next(v for v in w.vehicles.values() if v["type"] == vtype and v["status"] == status)


def run_until(w, cond, max_min=600):
    for _ in range(max_min):
        w.tick(1.0)
        if cond():
            return True
    return False


def test_diesel_gets_cheapest_station_and_resumes_job():
    w = make_world()
    v = first(w, "truck_diesel")
    job = next(j for j in w.jobs.values() if j["status"] == "pending" and j["weight"] <= v["capacity"])
    w.assign(v["id"], job["id"])
    assert v["status"] == "to_pickup"
    v["energy"] = v["tank"] * 0.15

    snap = next(x for x in w.snapshot()["vehicles"] if x["id"] == v["id"])
    st = snap["energy_stop"]
    assert st and st["price_eur_l"] > 0 and st["litres"] > 0
    opts = w.energy_stop_options(v, limit=50)
    assert st["id"] == opts[0]["id"]
    assert all(o["cost_eur"] >= st["cost_eur"] for o in opts)   # cheapest total, detour included
    assert st["saving_eur"] == round(st["litres"] * (PRICES["diesel_eur_l"] - st["price_eur_l"])
                                     - st["detour_km"] * 0.32 * st["price_eur_l"], 2)

    r = w.add_energy_stop(v["id"])
    assert r["ok"] and r["stop"]["id"] == st["id"]
    assert v["status"] == "to_fuel" and v["fuel_stop"]["resume"] == "to_pickup"
    assert w.add_energy_stop(v["id"])["ok"] is False                 # no double stop
    assert next(x for x in w.snapshot()["vehicles"] if x["id"] == v["id"])["energy_stop"] is None

    assert run_until(w, lambda: v["status"] == "refuel")
    assert run_until(w, lambda: v["status"] not in ("refuel", "break", "routing"))
    assert v["energy"] >= v["tank"] * 0.95 and "fuel_stop" not in v
    assert v["status"] == "to_pickup" and w.target_of(v) == job["pickup"]   # back on the original job
    assert any("Refuel now" in e["text"] for e in w.log)


def test_ev_gets_charger_with_charge_time():
    w = make_world()
    v = first(w, "van_ev")
    v["energy"] = v["tank"] * 0.15
    st = next(x for x in w.snapshot()["vehicles"] if x["id"] == v["id"])["energy_stop"]
    assert st and st["kw"] > 0 and st["minutes"] > 5 and "price_eur_l" not in st
    opts = w.energy_stop_options(v, limit=50)
    assert all(o["detour_km"] + o["minutes"] >= st["detour_km"] + st["minutes"] for o in opts)

    assert w.add_energy_stop(v["id"])["ok"]
    assert run_until(w, lambda: v["status"] == "refuel")
    assert run_until(w, lambda: v["status"] != "refuel")
    assert v["status"] == "idle" and abs(v["energy"] - v["tank"] * 0.9) < 0.5


def test_no_button_when_energy_is_fine():
    w = make_world()
    v = first(w, "van_diesel")
    v["energy"] = v["tank"] * 0.8
    assert next(x for x in w.snapshot()["vehicles"] if x["id"] == v["id"])["energy_stop"] is None
    assert w.add_energy_stop(v["id"])["ok"] is False


def test_energy_stop_endpoint():
    client = TestClient(app)
    with app_world.lock:
        v = next(x for x in app_world.vehicles.values() if x["energy_type"] == "diesel" and x["status"] == "idle")
        v["energy"] = v["tank"] * 0.15
    s = client.get("/api/state").json()
    assert next(x for x in s["vehicles"] if x["id"] == v["id"])["energy_stop"]
    r = client.post(f"/api/vehicles/{v['id']}/energy_stop", json={})
    assert r.status_code == 200 and r.json()["ok"]
    assert client.post(f"/api/vehicles/{v['id']}/energy_stop", json={}).status_code == 409
    assert client.post("/api/vehicles/NOPE/energy_stop", json={}).status_code == 409


if __name__ == "__main__":
    for name, fn in list(globals().items()):
        if name.startswith("test_"):
            fn()
            print("ok", name)
