"""Public demo: "View as guest" is a read-only company admin view; super is not listed publicly;
DEMO_KEY still locks writes. Run: AGENT_MODE=rules python -m pytest tests"""
import os
import re
import sys
from pathlib import Path

os.environ["AGENT_MODE"] = "rules"
os.environ["FLEETMIND_NO_DOTENV"] = "1"
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from fastapi.testclient import TestClient  # noqa: E402

from backend import app as app_module, auth, services  # noqa: E402

services.get_routes = lambda a, b, alternatives=False, **kw: [services._straight_route(a, b)] * (2 if alternatives else 1)

from backend.app import app, world as app_world  # noqa: E402

WRITES = [("POST", "/api/event", {"type": "traffic"}), ("POST", "/api/approvals/A999", {"option_id": "x"}),
          ("POST", "/api/control", {"action": "pause"}), ("POST", "/api/chat", {"message": "hi"}),
          ("POST", "/api/orders", {"pickup": "FREEPORT", "dropoff": "OGRE", "weight": 100}),
          ("POST", "/api/orders/J1/assign", {}), ("POST", "/api/vehicles/LV-T01/message", {"text": "hi"}),
          ("POST", "/api/vehicles/LV-T01/energy_stop", {}), ("POST", "/api/actions/X1/undo", {}),
          ("POST", "/api/settings", {"approval_limit_eur": 1}), ("POST", "/api/users/employee/trucks", {"vehicle_ids": []}),
          ("POST", "/api/gtm/x/status", {"status": "sent"}), ("POST", "/api/driver/action", {"action": "arrived"}),
          ("POST", "/api/driver/problem", {})]


def guest():
    c = TestClient(app)
    r = c.post("/api/auth/guest")
    assert r.status_code == 200 and r.json()["user"]["role"] == "guest"
    return c


def test_super_is_not_listed_but_still_works():
    accounts = TestClient(app).get("/api/auth/demo-accounts").json()
    assert "super" not in [a["username"] for a in accounts["accounts"]] and accounts["guest"]
    assert {"admin", "employee", "driver"} <= {a["username"] for a in accounts["accounts"]}
    r = TestClient(app).post("/api/auth/login", json={"username": "super", "password": "fleetmind-super"})
    assert r.status_code == 200 and r.json()["user"]["role"] == "superadmin"


def test_guest_sees_the_company_admin_view():
    s = guest().get("/api/state").json()
    assert s["user"]["role"] == "guest" and s["me"]["can_write"] is False
    assert "revenue" in s["kpi"] and s["kpi"]["fuel_cost"] is not None
    assert s["gtm_kpi"] is None and not any(e["agent"] == "GTM Agent" for e in s["log"])
    assert all(a["can_decide"] is False for a in s["approvals"])
    assert all(not a["can_undo"] for a in s["actions"])
    c = guest()
    assert c.get("/api/history/orders").status_code == 200 and c.get("/api/settings").status_code == 200
    assert c.get("/api/gtm").status_code == 403 and c.get("/api/users").status_code == 403


def test_guest_cannot_write_anything():
    c = guest()
    for m, p, body in WRITES:
        assert c.request(m, p, json=body).status_code == 403, f"guest reached {m} {p}"


def test_every_write_route_refuses_guest():
    """Any POST route added later must not let a guest in (except signing in and out)."""
    for r in app.routes:
        path = getattr(r, "path", "")
        if not path.startswith("/api/") or "POST" not in getattr(r, "methods", ()):
            continue
        sample = re.sub(r"\{[^}]+\}", "abc", path)
        found, roles = auth.rule_for("POST", sample)
        if roles is auth.OPEN:
            continue
        assert "guest" not in roles, path


def test_guest_cannot_approve_a_real_approval():
    with app_world.lock:
        app_world.approvals["A950"] = {"id": "A950", "event": "x", "title": "t", "summary": "s",
                                       "options": [{"id": "x", "label": "X"}], "recommended": "x", "state": "pending",
                                       "created": "Day 1 06:00", "notes": {}, "apply": lambda o: None,
                                       "fallback": None, "cost_eur": 1}
    assert guest().post("/api/approvals/A950", json={"option_id": "x"}).status_code == 403
    assert app_world.approvals["A950"]["state"] == "pending"


def test_demo_key_still_locks_writes(monkeypatch):
    monkeypatch.setattr(app_module, "DEMO_KEY", "s3cret")
    c = TestClient(app)
    assert c.post("/api/auth/guest").status_code == 200             # signing in is never locked
    assert c.post("/api/auth/login", json={"username": "admin", "password": "fleetmind-admin"}).status_code == 200
    assert c.post("/api/control", json={"action": "speed", "value": 2}).status_code == 401      # no key
    assert c.post("/api/control", json={"action": "speed", "value": 2},
                  headers={"X-Demo-Key": "s3cret"}).status_code == 200
    assert c.get("/api/state").status_code == 200                    # reading stays open


def test_login_page_has_guest_button():
    html = TestClient(app).get("/").text
    assert 'id="guestBtn"' in html and "View as guest" in html
