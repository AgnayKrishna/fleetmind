"""Driver phone page (Today + Delivery): Start break and proof of delivery. The server checks the job
state again for every button. Run: AGENT_MODE=rules python -m pytest tests"""
import os
import sys
from pathlib import Path

os.environ["AGENT_MODE"] = "rules"
os.environ["FLEETMIND_NO_DOTENV"] = "1"
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from fastapi.testclient import TestClient  # noqa: E402

from backend import services  # noqa: E402

services.get_routes = lambda a, b, alternatives=False, **kw: [services._straight_route(a, b)] * (2 if alternatives else 1)

from backend.app import app, world as app_world  # noqa: E402
from backend.sim import BREAK_MIN, World  # noqa: E402

VID = "LV-V01"          # driver2's van, so the driver tests in test_auth (LV-T01) are not disturbed


def driver():
    c = TestClient(app)
    assert c.post("/api/auth/login", json={"username": "driver2", "password": "fleetmind-driver"}).status_code == 200
    return c


def test_start_break_only_when_it_fits():
    w = World(seed=3)
    v = next(x for x in w.vehicles.values() if x["status"] == "idle")
    assert w._driver_allowed(v)["break"]
    v["drive_since_break"] = 200
    assert w.driver_action(v["id"], "break")["ok"]
    assert v["status"] == "break" and v["drive_since_break"] == 0 and v["phase_until"] == w.sim + BREAK_MIN
    assert not w.driver_action(v["id"], "break")["ok"]            # already on a break
    v["status"] = "loading"
    assert not w._driver_allowed(v)["break"]


def test_break_while_driving_resumes_the_trip():
    w = World(seed=4)
    v = next(iter(w.vehicles.values()))
    v["status"] = "to_dropoff"
    assert w.driver_action(v["id"], "break")["ok"]
    assert v["status"] == "break" and v["resume"] == "to_dropoff"


def test_delivered_keeps_the_proof_and_flags_damage():
    w = World(seed=5)
    jid = w.create_order("FREEPORT", "KEKAVA", 300)["job"]["id"]
    v = next(x for x in w.vehicles.values() if x["status"] == "idle")
    w.assign(v["id"], jid)
    w.jobs[jid]["status"], v["status"] = "in_transit", "unloading"
    r = w.driver_action(v["id"], "delivered", proof={"receiver": "  R.   Ozola ", "signed": True, "photos": 99,
                                                      "damaged": True, "note": "One pallet wet"})
    assert r["ok"]
    p = w.jobs[jid]["proof"]
    assert p == {"receiver": "R. Ozola", "signed": True, "photos": 20, "damaged": True, "note": "One pallet wet"}
    assert w.jobs[jid]["status"] == "delivered"
    texts = [e["text"] for e in w.log]
    assert any("received by R. Ozola" in t for t in texts)
    assert any("damaged or missing" in t and "One pallet wet" in t for t in texts)


def test_driver_api_accepts_break_and_proof():
    c = driver()
    me = c.get("/api/driver/me").json()
    assert me["vehicle"]["id"] == VID and "break" in me["allowed"]
    r = c.post("/api/driver/action", json={"action": "delivered", "proof": {"receiver": "X", "signed": True}})
    assert r.status_code in (200, 409)                          # 409 unless the van is unloading right now
    with app_world.lock:
        app_world.vehicles[VID]["status"] = "idle"
    assert c.post("/api/driver/action", json={"action": "break"}).json()["ok"]
    assert app_world.vehicles[VID]["status"] == "break"
    assert c.post("/api/driver/action", json={"action": "break"}).status_code == 409
