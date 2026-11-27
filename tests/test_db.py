"""SQLite storage: orders, approvals, agent decisions and GTM leads survive a restart.
Run: AGENT_MODE=rules python -m pytest tests
Routing is replaced by straight lines so no test calls OSRM."""
import os
import sys
import tempfile
from pathlib import Path

os.environ["AGENT_MODE"] = "rules"
os.environ["FLEETMIND_NO_DOTENV"] = "1"
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from fastapi.testclient import TestClient  # noqa: E402

from backend import services  # noqa: E402

services.get_routes = lambda a, b, alternatives=False, **kw: [services._straight_route(a, b)] * (2 if alternatives else 1)

from backend.db import Store  # noqa: E402
from backend.gtm import GtmAgent  # noqa: E402
from backend.sim import World  # noqa: E402


class SyncRouter:
    def submit(self, fn):
        fn()


def fresh_url():
    return f"sqlite:///{Path(tempfile.mkdtemp(prefix='fleetmind-db-')) / 'fm.db'}"


def make_world(store=None):
    js, aps = store.next_seq() if store else (100, 0)
    w = World(seed=7, job_seq=js, appr_seq=aps)
    w.router = SyncRouter()
    return w


def test_orders_and_decisions_survive_restart():
    url = fresh_url()
    s1 = Store(url)
    w = make_world(s1)
    for _ in range(240):
        w.tick(2.0)
    s1.sync(w)
    orders = s1.history("orders", limit=1000)
    assert len(orders) == len(w.jobs)
    assert {o["id"] for o in orders} == set(w.jobs)
    assert any(o["status"] != "pending" for o in orders)
    decisions = s1.history("decisions", limit=1000)
    assert any(d["agent"] == "Dispatch Agent" and d["kind"] == "decision" for d in decisions)
    assert s1.sync(w) == 0                                   # nothing changed, nothing written

    # restart: new store on the same file, new world continues the numbering
    s2 = Store(url)
    assert len(s2.history("orders", limit=1000)) == len(orders)
    w2 = make_world(s2)
    assert not set(w2.jobs) & set(w.jobs)
    s2.sync(w2)
    assert len(s2.history("orders", limit=1000)) == len(orders) + len(w2.jobs)


def test_order_status_changes_are_saved():
    s = Store(fresh_url())
    w = make_world(s)
    s.sync(w)
    jid = next(iter(w.jobs))
    w.jobs[jid]["status"], w.jobs[jid]["vehicle"] = "assigned", "LV-T01"
    assert s.sync(w) >= 1
    row = next(o for o in s.history("orders", limit=1000) if o["id"] == jid)
    assert row["status"] == "assigned" and row["vehicle"] == "LV-T01" and row["data"]["id"] == jid


def test_pending_approvals_expire_on_restart_and_decisions_are_kept():
    url = fresh_url()
    s1 = Store(url)
    w = make_world(s1)
    for aid, state in (("A1", "pending"), ("A2", "approved")):
        w.approvals[aid] = {"id": aid, "event": "breakdown", "title": f"Test {aid}", "summary": "s",
                            "options": [{"id": "x", "label": "X"}], "recommended": "x", "state": state,
                            "created": "Day 1 06:10", "notes": {}, "apply": lambda o: None, "fallback": None,
                            "decision": "x" if state == "approved" else None}
    s1.sync(w)
    assert {a["id"]: a["state"] for a in s1.history("approvals")} == {"A1": "pending", "A2": "approved"}
    s2 = Store(url)
    assert {a["id"]: a["state"] for a in s2.history("approvals")} == {"A1": "expired", "A2": "approved"}
    assert s2.next_seq()[1] == 2
    assert make_world(s2).seq["appr"] == 2                   # the next approval will be A3


def test_gtm_leads_seeded_and_status_survives_restart():
    url = fresh_url()
    w = make_world()
    g1 = GtmAgent(w, Store(url))
    assert g1.leads, "leads are seeded from docs/leads.json"
    lid = g1.leads[0]["id"]
    assert g1.set_status(lid, "sent")["ok"]
    assert g1.demo_opened(lid)["counted"]
    g2 = GtmAgent(w, Store(url))
    assert [lead["id"] for lead in g2.leads] == [lead["id"] for lead in g1.leads]
    row = next(r for r in g2.snapshot()["leads"] if r["id"] == lid)
    assert row["status"] == "sent" and row["opens"] == 1


def test_history_endpoint():
    from backend.app import app
    client = TestClient(app)
    r = client.get("/api/history/orders?limit=5")
    assert r.status_code == 200 and r.json()["ok"] and 0 < len(r.json()["orders"]) <= 5
    assert client.get("/api/history/decisions").status_code == 200
    assert client.get("/api/history/approvals?status=pending").status_code == 200
    assert client.get("/api/history/nope").status_code == 404


if __name__ == "__main__":
    for name, fn in list(globals().items()):
        if name.startswith("test_"):
            fn()
            print("ok", name)
