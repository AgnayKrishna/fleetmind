"""Map tile proxy: no login, but only for our own sites (Origin / Referer in ALLOWED_ORIGINS),
rate-limited per IP and cached in memory for 10 minutes. TomTom is mocked; nothing calls it.
Run: AGENT_MODE=rules python -m pytest tests"""
import os
import sys
from pathlib import Path
from types import SimpleNamespace

import pytest

os.environ["AGENT_MODE"] = "rules"
os.environ["FLEETMIND_NO_DOTENV"] = "1"
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from fastapi.testclient import TestClient  # noqa: E402

from backend import app as app_module, services  # noqa: E402
from backend.app import app  # noqa: E402

TILE = "/api/map/tile/basic/8/145/78.png"


@pytest.fixture
def tomtom(monkeypatch):
    """Fake TomTom: counts calls, returns a tiny PNG. Fresh tile cache and rate limiter per test."""
    calls = []

    def fake_get(url, params=None, **kw):
        calls.append(url)
        return SimpleNamespace(content=b"\x89PNG fake", raise_for_status=lambda: None)

    monkeypatch.setenv("TOMTOM_API_KEY", "tt-test")
    monkeypatch.delenv("ALLOWED_ORIGINS", raising=False)
    monkeypatch.setattr(services.httpx, "get", fake_get)
    monkeypatch.setattr(services, "_tile_cache", {})
    monkeypatch.setattr(app_module, "tile_limiter", app_module.RateLimiter(1000))
    return calls


@pytest.mark.parametrize("headers", [
    {"Referer": "http://localhost:8000/index.html"}, {"Origin": "http://127.0.0.1:5173"},
    {"Referer": "https://agnaykrishna.github.io/fleetmind/?ref=x"}, {"Origin": "https://fleetmind-brr9.onrender.com"},
    {"Referer": "http://testserver/"},                                 # the backend's own pages (same host)
])
def test_allowed_origins_get_tiles(tomtom, headers):
    r = TestClient(app).get(TILE, headers=headers)
    assert r.status_code == 200 and r.content == b"\x89PNG fake"
    assert r.headers["content-type"] == "image/png" and "max-age=600" in r.headers["cache-control"]


@pytest.mark.parametrize("headers", [
    {}, {"Referer": "https://evil.example/map"}, {"Origin": "https://agnaykrishna.github.io.evil.example"},
    {"Origin": "https://fleetmind-brr9.onrender.com.evil.example"}, {"Referer": "not a url"},
    {"Origin": "http://fleetmind-brr9.onrender.com"},                  # wrong scheme
])
def test_other_sites_are_refused(tomtom, headers):
    assert TestClient(app).get(TILE, headers=headers).status_code == 403
    assert tomtom == []                                                # TomTom never called


def test_allowed_origins_from_env(tomtom, monkeypatch):
    monkeypatch.setenv("ALLOWED_ORIGINS", "https://fleet.example.com, https://ops.example.com:8443")
    c = TestClient(app)
    assert c.get(TILE, headers={"Origin": "https://fleet.example.com"}).status_code == 200
    assert c.get(TILE, headers={"Origin": "https://ops.example.com:8443"}).status_code == 200
    assert c.get(TILE, headers={"Origin": "https://ops.example.com:9999"}).status_code == 403   # port given: must match
    assert c.get(TILE, headers={"Referer": "http://localhost:8000/"}).status_code == 403     # defaults replaced


def test_tiles_are_cached_for_10_minutes(tomtom, monkeypatch):
    c = TestClient(app, headers={"Referer": "http://localhost:8000/"})
    now = [1000.0]
    monkeypatch.setattr(services.time, "time", lambda: now[0])
    for _ in range(5):
        assert c.get(TILE).status_code == 200
    assert len(tomtom) == 1
    now[0] += 590
    assert c.get(TILE).status_code == 200 and len(tomtom) == 1        # still fresh at 9 min 50 s
    now[0] += 20
    assert c.get(TILE).status_code == 200 and len(tomtom) == 2        # refetched after 10 min


def test_rate_limit_per_ip(tomtom, monkeypatch):
    monkeypatch.setattr(app_module, "tile_limiter", app_module.RateLimiter(3))
    c = TestClient(app, headers={"Referer": "http://localhost:8000/"})
    ip_a, ip_b = {"X-Forwarded-For": "203.0.113.7"}, {"X-Forwarded-For": "198.51.100.2, 10.0.0.1"}
    assert [c.get(TILE, headers=ip_a).status_code for _ in range(4)] == [200, 200, 200, 429]
    assert c.get(TILE, headers=ip_a).headers.get("retry-after") == "60"
    assert c.get(TILE, headers=ip_b).status_code == 200                # another IP has its own budget


def test_rate_limiter_window_slides():
    rl = app_module.RateLimiter(2)
    assert rl.allow("x", now=0) and rl.allow("x", now=1) and not rl.allow("x", now=2)
    assert rl.allow("x", now=60.5) and not rl.allow("x", now=60.6)    # the hit at 0 left the window, the one at 1 didn't


def test_bad_tile_numbers_and_no_key(tomtom, monkeypatch):
    c = TestClient(app, headers={"Referer": "http://localhost:8000/"})
    assert c.get("/api/map/tile/basic/2/9/0.png").status_code == 404   # x outside the zoom level
    assert c.get("/api/map/tile/nope/8/145/78.png").status_code == 404
    monkeypatch.delenv("TOMTOM_API_KEY")
    assert c.get(TILE).status_code == 404 and tomtom == []
