"""Roles follow design/reference/roles.reference.html: dispatcher approval limit, own trucks, undo,
orders, driver messages, and what each role may see. Run: AGENT_MODE=rules python -m pytest tests"""
import os
import sys
from pathlib import Path

os.environ["AGENT_MODE"] = "rules"
os.environ["FLEETMIND_NO_DOTENV"] = "1"
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from fastapi.testclient import TestClient  # noqa: E402

from backend import auth, services  # noqa: E402

services.get_routes = lambda a, b, alternatives=False, **kw: [services._straight_route(a, b)] * (2 if alternatives else 1)

from backend.app import app, store, world as app_world  # noqa: E402
from backend.sim import World  # noqa: E402

PW = {u["username"]: u["password"] for u in auth.DEMO_USERS}


def client_for(username):
    c = TestClient(app)
    assert c.post("/api/auth/login", json={"username": username, "password": PW[username]}).status_code == 200
    return c


def fake_approval(aid, cost):
    applied = []
    with app_world.lock:
        app_world.approvals[aid] = {"id": aid, "event": "breakdown", "title": f"Test {aid}", "summary": "s",
                                    "options": [{"id": "x", "label": "Do X", "cost_eur": cost}], "recommended": "x",
                                    "state": "pending", "created": "Day 1 06:00", "notes": {},
                                    "apply": applied.append, "fallback": None, "cost_eur": cost}
    return applied


def set_limit(eur):
    assert client_for("admin").post("/api/settings", json={"approval_limit_eur": eur}).json()["ok"]


def test_employee_has_12_assigned_trucks():
    s = client_for("employee").get("/api/state").json()
    assert len(s["me"]["trucks"]) == auth.EMPLOYEE_DEFAULT_TRUCKS == 12
    assert s["me"]["approval_limit_eur"] == 300 and s["me"]["can_write"]
    assert sum(v["mine"] for v in s["vehicles"]) == 12
    assert client_for("admin").get("/api/state").json()["me"]["trucks"] is None     # admin: every truck
    users = client_for("admin").get("/api/users").json()["users"]
    assert next(u for u in users if u["username"] == "employee")["trucks"] == s["me"]["trucks"]


def test_admin_changes_assigned_trucks():
    admin = client_for("admin")
    before = store.trucks_for("employee")
    try:
        r = admin.post("/api/users/employee/trucks", json={"vehicle_ids": ["LV-T05", "LV-V02"]})
        assert r.json()["trucks"] == ["LV-T05", "LV-V02"]
        assert admin.post("/api/users/employee/trucks", json={"vehicle_ids": ["LV-NOPE"]}).status_code == 422
        assert admin.post("/api/users/admin/trucks", json={"vehicle_ids": []}).status_code == 404
    finally:
        store.set_trucks("employee", before)


def test_employee_approves_up_to_the_limit():
    set_limit(300)
    emp = client_for("employee")
    applied = fake_approval("A910", 120)
    r = emp.post("/api/approvals/A910", json={"option_id": "x", "approve": True})
    assert r.status_code == 200 and r.json()["ok"] and applied == ["x"]
    assert "Eva Dispatcher" in app_world.approvals["A910"]["decided_by"]
    fake_approval("A911", 300)                                       # exactly the limit is allowed
    assert emp.post("/api/approvals/A911", json={"option_id": "x"}).json()["ok"]


def test_bigger_approvals_stay_pending_for_the_admin():
    set_limit(300)
    emp = client_for("employee")
    applied = fake_approval("A912", 450)
    r = emp.post("/api/approvals/A912", json={"option_id": "x", "approve": True})
    assert r.status_code == 403 and "Alex Logistics" in r.json()["error"] and r.json()["sent_to"] == "Alex Logistics"
    assert app_world.approvals["A912"]["state"] == "pending" and applied == []
    assert emp.post("/api/approvals/A912", json={"option_id": "x", "approve": False}).status_code == 403   # no reject either
    card = next(a for a in emp.get("/api/state").json()["approvals"] if a["id"] == "A912")
    assert card["can_decide"] is False and "sent to Alex Logistics for approval" in card["blocked_reason"]
    admin_card = next(a for a in client_for("admin").get("/api/state").json()["approvals"] if a["id"] == "A912")
    assert admin_card["can_decide"] is True
    assert client_for("admin").post("/api/approvals/A912", json={"option_id": "x"}).json()["ok"] and applied == ["x"]


def test_admin_can_raise_the_limit():
    emp = client_for("employee")
    fake_approval("A913", 450)
    try:
        set_limit(500)
        assert client_for("super").get("/api/settings").json()["settings"]["approval_limit_eur"] == 500
        assert emp.get("/api/state").json()["me"]["approval_limit_eur"] == 500
        assert emp.post("/api/approvals/A913", json={"option_id": "x"}).json()["ok"]
        assert client_for("admin").post("/api/settings", json={"approval_limit_eur": -5}).status_code == 422
    finally:
        set_limit(300)


def test_superadmin_cannot_decide_or_undo():
    fake_approval("A914", 10)
    sup = client_for("super")
    assert sup.post("/api/approvals/A914", json={"option_id": "x"}).status_code == 403
    assert app_world.approvals["A914"]["state"] == "pending"
    card = next(a for a in sup.get("/api/state").json()["approvals"] if a["id"] == "A914")
    assert card["can_decide"] is False
    assert sup.post("/api/settings", json={"approval_limit_eur": 1}).status_code == 403


def test_undo_only_on_own_trucks():
    mine = sorted(store.trucks_for("employee"))
    other = next(v for v in sorted(app_world.vehicles) if v not in mine)
    undone = []
    a_mine = app_world.record_action("Route Agent", "test reroute", [mine[0]], undo=lambda w: undone.append(1) or "back")
    a_other = app_world.record_action("Route Agent", "test reroute", [other], undo=lambda w: "back")
    a_fixed = app_world.record_action("Dispatch Agent", "customer told", [mine[0]])          # can't be reversed
    emp = client_for("employee")
    acts = {a["id"]: a for a in emp.get("/api/actions").json()["actions"]}
    assert acts[a_mine]["can_undo"] and not acts[a_other]["can_undo"] and not acts[a_fixed]["can_undo"]
    assert emp.post(f"/api/actions/{a_other}/undo").status_code == 403
    assert client_for("super").post(f"/api/actions/{a_mine}/undo").status_code == 403
    r = emp.post(f"/api/actions/{a_mine}/undo")
    assert r.status_code == 200 and r.json()["instead"] == "back" and undone == [1]
    assert emp.post(f"/api/actions/{a_mine}/undo").status_code == 409                       # only once
    assert emp.post(f"/api/actions/{a_fixed}/undo").status_code == 409
    assert client_for("admin").post(f"/api/actions/{a_other}/undo").json()["ok"]            # admin: any truck
    assert any("undid" in e["text"] and "Eva Dispatcher" in e["text"] for e in app_world.log)


class SyncRouter:
    def submit(self, fn):
        fn()


def test_undo_an_automatic_assignment_really_reverts_it():
    w = World(seed=7)
    w.router = SyncRouter()
    w._routine_dispatch()
    act = next(a for a in w.actions_view() if a["job"])
    jid, vid = act["job"], act["vehicles"][0]
    assert w.jobs[jid]["status"] == "assigned" and w.vehicles[vid]["job_id"] == jid
    r = w.undo_action(act["id"], by="Eva")
    assert r["ok"] and "back in the queue" in r["instead"]
    assert w.jobs[jid]["status"] == "pending" and w.jobs[jid]["vehicle"] is None
    assert w.vehicles[vid]["job_id"] is None and w.vehicles[vid]["status"] == "idle"
    for _ in range(5):
        w._routine_dispatch()
    assert w.jobs[jid]["vehicle"] != vid                         # never handed back to the same vehicle
    assert not w.undo_action(act["id"])["ok"]


def test_prices_revenue_and_costs_by_role():
    adm = client_for("admin").get("/api/state").json()
    assert all("price_eur" in j for j in adm["jobs"]) and "revenue" in adm["kpi"] and "profit" in adm["kpi"]
    emp = client_for("employee").get("/api/state").json()
    assert not any("price_eur" in j for j in emp["jobs"])
    assert "revenue" not in emp["kpi"] and "profit" not in emp["kpi"]
    assert emp["kpi"]["fuel_cost"] is not None and emp["kpi"]["fuel_savings"] is not None   # trip costs: yes
    sup = client_for("super").get("/api/state").json()
    assert not any("price_eur" in j for j in sup["jobs"]) and "revenue" not in sup["kpi"]
    assert sup["kpi"]["fuel_cost"] is None and sup["kpi"]["total_cost"] is None
    assert all("cost" not in h for h in sup["history"])
    assert sup["me"]["can_write"] is False


def test_employee_creates_and_assigns_an_order():
    emp = client_for("employee")
    r = emp.post("/api/orders", json={"pickup": "FREEPORT", "dropoff": "JELGAVA", "weight": 900, "cargo": "boxes"})
    assert r.status_code == 200, r.text
    jid = r.json()["job"]["id"]
    assert app_world.jobs[jid]["created_by"] == "Eva Dispatcher"
    assert emp.post("/api/orders", json={"pickup": "FREEPORT", "dropoff": "FREEPORT", "weight": 9}).status_code == 422
    assert emp.post("/api/orders/J0/assign", json={}).status_code == 409
    with app_world.lock:
        app_world.jobs[jid]["status"], app_world.jobs[jid]["vehicle"] = "pending", None
        cands = app_world.dispatch_candidates(app_world.jobs[jid], limit=1)
    if cands:     # the live sim may have taken every vehicle already
        r = emp.post(f"/api/orders/{jid}/assign", json={"vehicle_id": cands[0]["vehicle"]})
        assert r.status_code == 200 and r.json()["vehicle"] == cands[0]["vehicle"]


def test_employee_messages_a_driver():
    r = client_for("employee").post("/api/vehicles/LV-T01/message", json={"text": "Gate 4 at the Freeport, please"})
    assert r.status_code == 200
    me = client_for("driver").get("/api/driver/me").json()
    assert me["messages"][-1]["text"] == "Gate 4 at the Freeport, please" and me["messages"][-1]["from"] == "Eva Dispatcher"
    assert client_for("employee").post("/api/vehicles/LV-NOPE/message", json={"text": "hi"}).status_code == 404


def test_employee_energy_stop_only_on_own_trucks():
    mine = set(store.trucks_for("employee"))
    other = next(v for v in sorted(app_world.vehicles) if v not in mine)
    r = client_for("employee").post(f"/api/vehicles/{other}/energy_stop", json={})
    assert r.status_code == 403


def test_orders_board_hides_prices_from_employees():
    admin = client_for("admin")
    jid = admin.post("/api/orders", json={"pickup": "SALASPILS", "dropoff": "OLAINE", "weight": 500}).json()["job"]["id"]
    with app_world.lock:                 # one delivered order to look at
        j = app_world.jobs[jid]
        j["status"], j["delivered_at"], j["vehicle"] = "delivered", app_world.sim, "LV-T01"
    a = admin.get("/api/orders/board").json()
    assert a["ok"] and "SALASPILS" in {p["key"] for p in a["places"]} and all(p["name"] for p in a["places"])
    mine = next(d for d in a["delivered"] if d["id"] == jid)
    assert "price_eur" in mine and mine["delivered_str"]
    for s in a["suggestions"].values():
        assert {"vehicle", "eta", "deadhead_km", "on_time"} <= s.keys()
    e = client_for("employee").get("/api/orders/board").json()
    assert all("price_eur" not in d for d in e["delivered"])
    assert all("energy_cost_eur" not in s for s in client_for("super").get("/api/orders/board").json()["suggestions"].values())
    assert TestClient(app).get("/api/orders/board").status_code == 401


def test_undo_really_reverts_an_automatic_assignment():
    """What the AI activity screen's Undo calls: the order goes back to the queue and the truck stops."""
    r = client_for("admin").post("/api/orders", json={"pickup": "FREEPORT", "dropoff": "KEKAVA", "weight": 800})
    assert r.status_code == 200, r.text
    jid = r.json()["job"]["id"]
    with app_world.lock:
        held = [j for j in app_world.jobs.values() if j["id"] != jid and j["status"] == "pending" and not j.get("hold")]
        for j in held:                               # only our order gets dispatched
            j["hold"] = True
        app_world._routine_dispatch()
        for j in held:
            j["hold"] = False
    job = app_world.jobs[jid]
    assert job["status"] == "assigned", "the rules engine should find a vehicle for an 800 kg order"
    vid = job["vehicle"]
    app_world.vehicles[vid]["fuel_stop"] = None
    act = next(a for a in app_world.actions_view() if a["job"] == jid)
    assert act["reversible"]
    r = client_for("admin").post(f"/api/actions/{act['id']}/undo")
    assert r.status_code == 200 and r.json()["ok"], r.text
    assert job["status"] == "pending" and job["vehicle"] is None and vid in job["exclude"]
    assert app_world.vehicles[vid]["job_id"] is None and app_world.vehicles[vid]["status"] == "idle"
    assert any(f"undid {act['id']}" in e["text"] for e in app_world.log)
    view = next(a for a in client_for("admin").get("/api/actions").json()["actions"] if a["id"] == act["id"])
    assert view["state"] == "undone" and not view["can_undo"] and view["instead"]
    assert client_for("admin").post(f"/api/actions/{act['id']}/undo").status_code == 409    # only once
