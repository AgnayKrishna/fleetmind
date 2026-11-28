"""The React dashboard (frontend/, built into docs/ with `npm --prefix frontend run build`) is what
FastAPI and GitHub Pages serve at /. These checks read the built files, so rebuild before running.
Run: AGENT_MODE=rules python -m pytest tests"""
import os
import re
import sys
from pathlib import Path

os.environ["AGENT_MODE"] = "rules"
os.environ["FLEETMIND_NO_DOTENV"] = "1"
ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from fastapi.testclient import TestClient  # noqa: E402

from backend.app import app  # noqa: E402

client = TestClient(app)


def bundle():
    html = client.get("/").text
    scripts = re.findall(r'src="\./(assets/index-[^"]+\.js)"', html)
    assert scripts, "docs/index.html should load the Vite bundle from ./assets"
    r = client.get("/" + scripts[0])
    assert r.status_code == 200
    return html, r.text


def test_root_serves_the_react_app():
    html, js = bundle()
    assert '<div id="root">' in html and 'src="./config.js"' in html and "Manrope" in html
    css = re.findall(r'href="\./(assets/[^"]+\.css)"', html)
    assert css and all(client.get("/" + c).status_code == 200 for c in css)


def test_classic_and_driver_pages_still_served():
    assert 'id="attn"' in client.get("/classic.html").text
    assert 'data-action="delivered"' in client.get("/driver.html").text
    assert client.get("/config.js").status_code == 200


def test_control_centre_features_in_bundle():
    _, js = bundle()
    for needle in ("Needs you", "Your AI team", "View as guest", "/api/state", "/api/approvals/", "/energy_stop",
                   "/api/chat", "/api/event", "Switch to dark mode", "Sample data", "Ctrl K"):
        assert needle in js, needle


def test_fleet_table_in_bundle():
    _, js = bundle()
    for needle in ("Export CSV", "Filter by status", "Search plate, driver or place", "Drive left", "AI note", "text/csv"):
        assert needle in js, needle


def test_ai_activity_in_bundle():
    _, js = bundle()
    for needle in ("What your AI team did today", "/api/actions/", "/undo", "Decision details", "can’t be undone"):
        assert needle in js, needle


def test_orders_board_in_bundle():
    _, js = bundle()
    for needle in ("Orders today", "/api/orders/board", "/assign", "New order", "In progress", "Problem",
                   "revenue planned", "Create order"):
        assert needle in js, needle


def test_states_in_bundle_and_fields_they_read():
    _, js = bundle()
    for needle in ("Connect your first truck", "You're offline.", "waiting to send", "Try to reconnect",
                   "Truck routing is unavailable", "isn’t answering", "Live weather is unavailable", "Try again"):
        assert needle in js, needle
    c = TestClient(app)
    c.post("/api/auth/login", json={"username": "admin", "password": "fleetmind-admin"})
    s = c.get("/api/state").json()
    assert isinstance(s["map"]["chain"], list) and s["map"]["chain"]
    assert {"mode", "errors"} <= s["agents"].keys() and "source" in s["weather"]
    assert all(v["route_source"] in (None, "tomtom", "here", "osrm", "fallback") for v in s["vehicles"])


def test_dispatcher_shift_in_bundle_and_state():
    _, js = bundle()
    for needle in ("My shift", "My trucks", "Driver messages", "the company admin", "within your limit"):
        assert needle in js, needle
    c = TestClient(app)
    c.post("/api/auth/login", json={"username": "employee", "password": "fleetmind-employee"})
    me = c.get("/api/state").json()["me"]
    assert me["role"] == "employee" and me["trucks"] and me["approval_limit_eur"] is not None and me["admin_name"]


def test_lite_mode_in_bundle():
    _, js = bundle()
    for needle in ("Lite mode", "fmLite", "(max-width: 1440px), (max-height: 800px)", "prefers-reduced-transparency",
                   "hardwareConcurrency", "deviceMemory", "below 30 frames"):
        assert needle in js, needle
