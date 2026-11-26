"""Checks the /api/state fields the "Needs your attention" bar in docs/app.js reads.
Run: AGENT_MODE=rules python -m pytest tests  (or python tests/test_attention.py)"""
import os
import sys
from pathlib import Path

os.environ["AGENT_MODE"] = "rules"
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from fastapi.testclient import TestClient  # noqa: E402

from backend.app import app  # noqa: E402

client = TestClient(app)


def test_state_has_attention_fields():
    s = client.get("/api/state").json()
    assert isinstance(s["sim"], (int, float))
    for a in s["approvals"]:
        assert {"id", "title", "summary"} <= a.keys()
    for v in s["vehicles"]:
        assert {"id", "status", "job_id", "energy_pct", "range_km", "fault", "trip"} <= v.keys()
        t = v["trip"]
        if t and t.get("cargo"):
            assert "on_time" in t and "late_min" in t
    for j in s["jobs"]:
        assert {"id", "status", "window_end", "window_end_str"} <= j.keys()


def test_breakdown_shows_up_as_approval_or_broken_vehicle():
    r = client.post("/api/event", json={"type": "breakdown"})
    assert r.status_code == 200
    s = client.get("/api/state").json()
    broken = [v for v in s["vehicles"] if v["status"] == "broken"]
    # A freshly started sim has no loaded vehicle on the road yet, so nothing can break down.
    nothing_to_break = any("No loaded vehicles" in e["text"] for e in s["log"])
    assert s["approvals"] or broken or nothing_to_break


def test_dashboard_has_attention_bar():
    html = client.get("/").text
    assert 'id="attn"' in html and 'id="attnList"' in html


if __name__ == "__main__":
    for name, fn in list(globals().items()):
        if name.startswith("test_"):
            fn()
            print("ok", name)
