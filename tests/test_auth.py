"""Logins and the 4 roles: enforced on every API endpoint, driver phone actions, who approved.
Run: AGENT_MODE=rules python -m pytest tests
Routing is replaced by straight lines so no test calls a routing service."""
import os
import re
import sys
import time
from pathlib import Path

import pytest

os.environ["AGENT_MODE"] = "rules"
os.environ["FLEETMIND_NO_DOTENV"] = "1"
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from fastapi.testclient import TestClient  # noqa: E402

from backend import auth, services  # noqa: E402

services.get_routes = lambda a, b, alternatives=False, **kw: [services._straight_route(a, b)] * (2 if alternatives else 1)

from backend.app import app, store, world as app_world  # noqa: E402
from backend.sim import World  # noqa: E402

PW = {u["username"]: u["password"] for u in auth.DEMO_USERS}


def client_for(username=None):
    c = TestClient(app)
    if username:
        r = c.post("/api/auth/login", json={"username": username, "password": PW[username]})
        assert r.status_code == 200, r.text
    return c


def test_passwords_are_hashed_with_salt():
    h1, h2 = auth.hash_password("secret"), auth.hash_password("secret")
    assert h1 != h2 and "secret" not in h1 and h1.startswith("pbkdf2_sha256$")
    assert auth.verify_password("secret", h1) and not auth.verify_password("wrong", h1)
    assert not auth.verify_password("secret", "garbage")
    stored = store.get_user("admin")["password_hash"]
    assert stored != PW["admin"] and auth.verify_password(PW["admin"], stored)


def test_every_api_route_has_a_permission_rule():
    missing = []
    for r in app.routes:
        path = getattr(r, "path", "")
        if not path.startswith("/api/"):
            continue
        sample = re.sub(r"\{(z|x|y)\}", "1", path)
        sample = re.sub(r"\{[^}]+\}", "abc", sample)
        for m in r.methods - {"HEAD"}:
            if not auth.rule_for(m, sample)[0]:
                missing.append(f"{m} {path}")
    assert not missing, f"routes without a rule: {missing}"
    assert auth.rule_for("GET", "/api/secret-new-thing") == (False, None)


def test_login_required_and_wrong_password():
    c = client_for()
    assert c.get("/api/health").status_code == 200
    assert c.get("/api/auth/demo-accounts").json()["accounts"]
    for method, path in (("GET", "/api/state"), ("POST", "/api/event"), ("GET", "/api/gtm"),
                         ("POST", "/api/chat"), ("GET", "/api/driver/me"), ("GET", "/api/history/orders")):
        assert c.request(method, path, json={}).status_code == 401, path
    assert c.post("/api/auth/login", json={"username": "admin", "password": "nope"}).status_code == 401
    assert c.get("/api/nope").status_code == 403                  # not in the table: refused


@pytest.mark.parametrize("user,allowed,denied", [
    ("employee", [("GET", "/api/state"), ("POST", "/api/chat"), ("POST", "/api/approvals/A999"),
                  ("GET", "/api/actions"), ("POST", "/api/actions/X999/undo"), ("POST", "/api/orders"),
                  ("POST", "/api/orders/J1/assign"), ("POST", "/api/vehicles/LV-T01/message")],
     [("POST", "/api/event"), ("POST", "/api/control"), ("GET", "/api/gtm"), ("GET", "/api/history/orders"),
      ("GET", "/api/driver/me"), ("GET", "/api/settings"), ("POST", "/api/settings"), ("GET", "/api/users"),
      ("POST", "/api/users/employee/trucks")]),
    ("admin", [("GET", "/api/state"), ("POST", "/api/control"), ("GET", "/api/history/orders"),
               ("POST", "/api/approvals/A999"), ("GET", "/api/settings"), ("POST", "/api/settings"),
               ("GET", "/api/users"), ("POST", "/api/orders"), ("POST", "/api/event")],
     [("GET", "/api/gtm"), ("POST", "/api/gtm/x/status"), ("GET", "/api/driver/me")]),
    ("super", [("GET", "/api/state"), ("GET", "/api/gtm"), ("POST", "/api/control"), ("GET", "/api/settings"),
               ("GET", "/api/users"), ("GET", "/api/actions")],
     [("GET", "/api/driver/me"), ("POST", "/api/approvals/A999"), ("POST", "/api/actions/X999/undo"),
      ("POST", "/api/orders"), ("POST", "/api/orders/J1/assign"), ("POST", "/api/event"), ("POST", "/api/settings"),
      ("POST", "/api/vehicles/LV-T01/message"), ("POST", "/api/vehicles/LV-T01/energy_stop"), ("POST", "/api/chat"),
      ("POST", "/api/users/employee/trucks")]),
    ("driver", [("GET", "/api/driver/me")],
     [("GET", "/api/state"), ("POST", "/api/event"), ("POST", "/api/chat"), ("POST", "/api/approvals/A999"),
      ("GET", "/api/gtm"), ("POST", "/api/orders"), ("GET", "/api/actions")]),
])
def test_role_matrix(user, allowed, denied):
    c = client_for(user)
    bodies = {"/api/chat": {"message": "status"}, "/api/control": {"action": "speed", "value": 2},
              "/api/event": {"type": "nope"}, "/api/gtm/x/status": {"status": "sent"}, "/api/settings": {}}
    for m, p in allowed:
        r = c.request(m, p, json=bodies.get(p, {}))
        assert r.status_code not in (401, 403), f"{user} should reach {m} {p}: {r.status_code}"
    for m, p in denied:
        r = c.request(m, p, json=bodies.get(p, {}))
        assert r.status_code == 403, f"{user} must not reach {m} {p}: {r.status_code}"


def test_employee_does_not_see_gtm_data():
    s = client_for("employee").get("/api/state").json()
    assert s["gtm_kpi"] is None and s["user"]["role"] == "employee"
    assert not any(e["agent"] == "GTM Agent" for e in s["log"])
    assert client_for("super").get("/api/state").json()["gtm_kpi"] is not None


def test_bearer_token_and_logout():
    token = client_for().post("/api/auth/login", json={"username": "employee", "password": PW["employee"]}).json()["token"]
    c = TestClient(app)                                         # no cookie, header only (dashboard on another origin)
    h = {"Authorization": f"Bearer {token}"}
    assert c.get("/api/auth/me", headers=h).json()["user"]["username"] == "employee"
    assert c.post("/api/auth/logout", headers=h).status_code == 200
    assert c.get("/api/state", headers=h).status_code == 401


def test_approval_records_who_decided():
    with app_world.lock:
        app_world.approvals["A900"] = {"id": "A900", "event": "breakdown", "title": "Test approval", "summary": "s",
                                       "options": [{"id": "x", "label": "Do X"}], "recommended": "x",
                                       "state": "pending", "created": "Day 1 06:00", "notes": {},
                                       "apply": lambda o: None, "fallback": None}
    r = client_for("admin").post("/api/approvals/A900", json={"option_id": "x", "approve": True})
    assert r.json()["ok"] and "Alex Logistics" in r.json()["decided_by"]
    assert app_world.approvals["A900"]["decided_by"].startswith("Alex Logistics (admin, logistics_admin)")
    assert any("Approved by Alex Logistics" in e["text"] for e in app_world.log)
    store.sync(app_world)
    row = next(a for a in store.history("approvals", limit=1000) if a["id"] == "A900")
    assert "Alex Logistics" in row["decided_by"]


class SyncRouter:
    def submit(self, fn):
        fn()


def test_driver_buttons_follow_the_job():
    w = World(seed=7)
    w.router = SyncRouter()
    v = w.vehicles["LV-T01"]
    job = next(j for j in w.jobs.values() if j["status"] == "pending" and j["weight"] <= v["capacity"])
    w.assign(v["id"], job["id"])
    view = w.driver_view("LV-T01")
    assert view["job"]["id"] == job["id"] and view["next_stop"]["name"] == job["pickup"]["name"]
    assert view["allowed"] == {"arrived": True, "loaded": False, "delivered": False}
    assert not w.driver_action("LV-T01", "delivered")["ok"]           # wrong order is refused
    assert w.driver_action("LV-T01", "arrived")["status"] == "loading"
    assert w.driver_view("LV-T01")["allowed"]["loaded"]
    assert w.driver_action("LV-T01", "loaded")["ok"] and job["status"] == "in_transit"
    assert v["status"] == "to_dropoff" and w.driver_view("LV-T01")["next_stop"]["name"] == job["dropoff"]["name"]
    assert w.driver_action("LV-T01", "arrived")["status"] == "unloading"
    assert w.driver_action("LV-T01", "delivered")["status"] == "idle"
    assert job["status"] == "delivered" and w.kpi["delivered"] == 1
    assert any("from the driver app" in e["text"] for e in w.log)
    assert not w.driver_action("LV-T01", "explode")["ok"]


def test_pages_have_login_and_driver_layout():
    c = client_for()
    html = c.get("/").text
    assert 'id="login"' in html and 'src="auth.js"' in html and "admin-only" in html and "write-only" in html
    d = c.get("/driver.html").text
    for needle in ('data-action="arrived"', 'data-action="loaded"', 'data-action="delivered"', 'id="dReport"',
                   'name="viewport"'):
        assert needle in d


def test_driver_api_and_report_a_problem():
    c = client_for("driver")
    me = c.get("/api/driver/me").json()
    assert me["vehicle"]["id"] == "LV-T01" and me["user"]["role"] == "driver" and "allowed" in me
    r = c.post("/api/driver/action", json={"action": "delivered"})
    assert r.status_code in (200, 409)
    r = c.post("/api/driver/problem", json={"note": "Warning light on the dashboard"})
    assert r.status_code == 200 and r.json()["ok"]
    assert any("reported a problem on LV-T01" in e["text"] for e in app_world.log)
    for _ in range(40):                                        # the breakdown pipeline runs in the background
        if app_world.vehicles["LV-T01"]["status"] == "broken":
            break
        time.sleep(0.05)
    assert app_world.vehicles["LV-T01"]["status"] == "broken"
    assert any(e["text"].startswith("Driver report: LV-T01") for e in app_world.log)
    assert c.post("/api/driver/problem", json={}).status_code == 409   # already being handled
