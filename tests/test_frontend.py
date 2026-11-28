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


def bundle(page="/"):
    """The page's HTML and all the JS it loads (entry + shared chunks), joined."""
    html = client.get(page).text
    scripts = re.findall(r'(?:src|href)="\./(assets/[^"]+\.js)"', html)
    assert scripts, f"{page} should load the Vite bundle from ./assets"
    js = []
    for s in scripts:
        r = client.get("/" + s)
        assert r.status_code == 200, s
        js.append(r.text)
    return html, "\n".join(js)


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


def test_super_admin_overview_in_bundle_and_data():
    _, js = bundle()
    for needle in ("Platform totals", "Integrations", "Needs your attention", "read only, for support", "Kurzeme Logistika",
                   "Not connected yet"):
        assert needle in js, needle
    c = TestClient(app)
    c.post("/api/auth/login", json={"username": "super", "password": "fleetmind-super"})
    s = c.get("/api/state").json()
    assert s["company"]["name"] and "auto_decisions" in s["kpi"] and isinstance(s["actions"], list)
    assert c.get("/api/settings").json()["ok"] and c.get("/api/users").json()["ok"]    # read only, for support
    assert c.post("/api/settings", json={"approval_limit_eur": 1}).status_code == 403


def test_new_driver_page_in_bundle():
    html, js = bundle("/driver-app.html")
    assert '<div id="root">' in html and 'name="viewport"' in html and 'src="./config.js"' in html
    assert "maplibre" not in html                                   # the phone page doesn't load the map library
    for needle in ("/api/driver/me", "/api/driver/action", "/api/driver/problem", "fmDriverQueue", "Hand over the load",
                   "Nodot kravu", "Сдать груз", "Start break", "Something is damaged or missing", "Works offline",
                   "google.com/maps/dir"):
        assert needle in js, needle


def test_lite_mode_in_bundle():
    _, js = bundle()
    for needle in ("Lite mode", "fmLite", "(max-width: 1440px), (max-height: 800px)", "prefers-reduced-transparency",
                   "hardwareConcurrency", "deviceMemory", "below 30 frames"):
        assert needle in js, needle
