"""Truck routing: TomTom first, HERE backup, OSRM last, straight line if all fail.
Every HTTP call is mocked; no test calls TomTom, HERE or OSRM.
Run: AGENT_MODE=rules python -m pytest tests"""
import os
import sys
from pathlib import Path
from types import SimpleNamespace

import pytest

os.environ["AGENT_MODE"] = "rules"
os.environ["FLEETMIND_NO_DOTENV"] = "1"
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from backend import services  # noqa: E402
from backend.data import VEHICLE_DIMENSIONS  # noqa: E402

A, B = (56.95, 24.11), (57.39, 21.56)       # Riga -> Ventspils
PROFILE = {"height_m": 4.0, "width_m": 2.55, "length_m": 16.5, "weight_kg": 35000, "axles": 5, "hazmat": True}


def _enc_uint(v, out):
    while v > 0x1F:
        out.append(services._FP_CHARS[(v & 0x1F) | 0x20])
        v >>= 5
    out.append(services._FP_CHARS[v])


def encode_flexible_polyline(points, precision=5):
    out = []
    _enc_uint(1, out)
    _enc_uint(precision, out)
    last = [0, 0]
    for lat, lon in points:
        for d, val in enumerate((lat, lon)):
            n = round(val * 10 ** precision)
            delta, last[d] = n - last[d], n
            _enc_uint((delta << 1) if delta >= 0 else (~delta << 1) | 1, out)
    return "".join(out)


TOMTOM_OK = {"routes": [{"summary": {"lengthInMeters": 190000, "travelTimeInSeconds": 9000,
                                     "trafficDelayInSeconds": 420},
                         "legs": [{"points": [{"latitude": A[0], "longitude": A[1]},
                                              {"latitude": 57.1, "longitude": 23.0},
                                              {"latitude": B[0], "longitude": B[1]}]}]}]}
HERE_PTS = [[A[0], A[1]], [57.2, 22.5], [B[0], B[1]]]
HERE_OK = {"routes": [{"sections": [{"polyline": encode_flexible_polyline(HERE_PTS),
                                     "summary": {"length": 195000, "duration": 9300, "baseDuration": 9000}}]}]}
OSRM_OK = {"routes": [{"geometry": {"coordinates": [[A[1], A[0]], [B[1], B[0]]]}, "distance": 200000,
                       "duration": 9600}]}


class FakeHttp:
    """Stands in for httpx.get. fail = set of providers that error."""
    def __init__(self, fail=()):
        self.fail, self.calls = set(fail), []

    def __call__(self, url, params=None, **kw):
        provider = "tomtom" if "tomtom" in url else "here" if "hereapi" in url else "osrm"
        self.calls.append((provider, url, dict(params or {})))
        if provider in self.fail:
            raise RuntimeError(f"{provider} down")
        body = {"tomtom": TOMTOM_OK, "here": HERE_OK, "osrm": OSRM_OK}[provider]
        return SimpleNamespace(raise_for_status=lambda: None, json=lambda: body, content=b"\x89PNG")


@pytest.fixture
def net(monkeypatch):
    services._route_cache.clear()
    for p in services.PROVIDERS:
        services._down_until[p], services._streak[p] = 0.0, 0
    monkeypatch.setattr(services, "_last_call", [0.0])
    monkeypatch.delenv("TOMTOM_API_KEY", raising=False)
    monkeypatch.delenv("HERE_API_KEY", raising=False)
    monkeypatch.delenv("ROUTING_PROVIDER", raising=False)

    def install(fail=()):
        fake = FakeHttp(fail)
        monkeypatch.setattr(services.httpx, "get", fake)
        return fake
    return install


def test_chain_depends_on_keys_and_setting(net, monkeypatch):
    assert services.routing_chain() == ["osrm"]
    monkeypatch.setenv("TOMTOM_API_KEY", "tt-test")
    assert services.routing_chain() == ["tomtom", "osrm"]
    monkeypatch.setenv("HERE_API_KEY", "here-test")
    assert services.routing_chain() == ["tomtom", "here", "osrm"]
    monkeypatch.setenv("ROUTING_PROVIDER", "here")
    assert services.routing_chain() == ["here", "osrm"]
    monkeypatch.setenv("ROUTING_PROVIDER", "osrm")
    assert services.routing_chain() == ["osrm"]
    monkeypatch.setenv("ROUTING_PROVIDER", "tomtom")
    info = services.routing_info()
    assert info["provider"] == "tomtom" and info["attribution"] == "Routing and traffic: TomTom" and info["tomtom_tiles"]


def test_tomtom_truck_route_with_dimensions_and_traffic(net, monkeypatch):
    monkeypatch.setenv("TOMTOM_API_KEY", "tt-test")
    fake = net()
    r = services.plan_routes(A, B, vehicle=PROFILE)[0]
    assert r["source"] == "tomtom" and r["km"] == 190 and r["minutes"] == 150 and r["traffic_delay_min"] == 7
    assert len(r["coords"]) == 3
    provider, _, p = fake.calls[0]
    assert provider == "tomtom"
    assert p["travelMode"] == "truck" and p["traffic"] == "true"
    assert (p["vehicleHeight"], p["vehicleWidth"], p["vehicleLength"]) == (4.0, 2.55, 16.5)
    assert p["vehicleWeight"] == 35000 and p["vehicleNumberOfAxles"] == 5
    assert p["vehicleLoadType"] == "otherHazmatGeneral"


def test_here_is_backup_when_tomtom_fails(net, monkeypatch):
    monkeypatch.setenv("TOMTOM_API_KEY", "tt-test")
    monkeypatch.setenv("HERE_API_KEY", "here-test")
    fake = net(fail={"tomtom"})
    r = services.plan_routes(A, B, vehicle=PROFILE)[0]
    assert r["source"] == "here"
    assert [[round(x, 5) for x in c] for c in r["coords"]] == HERE_PTS
    assert r["km"] == 195 and r["traffic_delay_min"] == 5
    here_params = next(c[2] for c in fake.calls if c[0] == "here")
    assert here_params["transportMode"] == "truck" and here_params["vehicle[height]"] == 400
    assert here_params["vehicle[axleCount]"] == 5 and here_params["vehicle[shippedHazardousGoods]"] == "other"


def test_osrm_is_last_fallback_then_straight_line(net, monkeypatch):
    monkeypatch.setenv("TOMTOM_API_KEY", "tt-test")
    monkeypatch.setenv("HERE_API_KEY", "here-test")
    net(fail={"tomtom", "here"})
    assert services.plan_routes(A, B, vehicle=PROFILE)[0]["source"] == "osrm"
    services._route_cache.clear()
    fake = net(fail={"tomtom", "here", "osrm"})
    routes = services.plan_routes(A, B, alternatives=True, vehicle=PROFILE)
    assert [r["source"] for r in routes] == ["fallback", "fallback"]
    assert {c[0] for c in fake.calls} == {"tomtom", "here", "osrm"}


def test_no_keys_uses_osrm_only(net):
    fake = net()
    assert services.plan_routes(A, B, vehicle=PROFILE)[0]["source"] == "osrm"
    assert [c[0] for c in fake.calls] == ["osrm"]


def test_vehicles_have_dimensions_and_hazmat_loads_route_as_hazmat():
    from backend.sim import World
    w = World(seed=7)
    for v in w.vehicles.values():
        for k in ("height_m", "width_m", "length_m", "weight_kg", "axles"):
            assert v[k] == VEHICLE_DIMENSIONS[v["type"]][k]
    v = next(x for x in w.vehicles.values() if x["type"] == "truck_diesel")
    job = w.new_job(weight=12000)
    job["cargo"], job["hazmat"], job["status"] = "fertiliser bags", True, "in_transit"
    v["job_id"] = job["id"]
    prof = w.route_profile(v, "to_dropoff")
    assert prof["hazmat"] and prof["weight_kg"] == v["empty_kg"] + 12000
    v["job_id"] = None
    assert w.route_profile(v)["weight_kg"] == v["empty_kg"] and not w.route_profile(v)["hazmat"]
    snap = next(x for x in w.snapshot()["vehicles"] if x["id"] == v["id"])
    assert snap["dims"]["axles"] == 5 and "route_source" in snap


def test_tile_proxy_keeps_key_on_server(net, monkeypatch):
    from fastapi.testclient import TestClient
    from backend.app import app
    client = TestClient(app, headers={"Referer": "http://localhost:8000/"})   # tiles only answer our own pages
    client.post("/api/auth/login", json={"username": "employee", "password": "fleetmind-employee"})
    assert client.get("/api/map/tile/basic/8/145/78.png").status_code == 404      # no key: OpenFreeMap
    assert client.get("/api/state").json()["map"]["tomtom_tiles"] is False
    monkeypatch.setenv("TOMTOM_API_KEY", "tt-test")
    fake = net()
    r = client.get("/api/map/tile/traffic/8/145/78.png")
    assert r.status_code == 200 and r.headers["content-type"] == "image/png"
    assert "tt-test" not in r.text and fake.calls[0][2]["key"] == "tt-test"
    assert client.get("/api/map/tile/nope/8/145/78.png").status_code == 404
