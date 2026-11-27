"""Real data: truck routing with live traffic (TomTom, HERE backup, OSRM last), Open-Meteo weather.
Everything has an offline fallback so the demo never breaks.

ROUTING_PROVIDER = tomtom | here | osrm picks the first provider to try (default: tomtom when
TOMTOM_API_KEY is set, else here when HERE_API_KEY is set, else osrm). The chain after it is
always TomTom -> HERE -> OSRM -> straight line, skipping providers without a key. Keys come
from the environment (.env on your machine) and never leave the server: map tiles are proxied.
"""
import math
import os
import threading
import time

import httpx

OSRM_URL = "https://router.project-osrm.org/route/v1/driving/{a};{b}"
TOMTOM_URL = "https://api.tomtom.com/routing/1/calculateRoute/{a}:{b}/json"
HERE_URL = "https://router.hereapi.com/v8/routes"
METEO_URL = "https://api.open-meteo.com/v1/forecast"
TOMTOM_TILES = {"basic": "https://api.tomtom.com/map/1/tile/basic/{style}/{z}/{x}/{y}.png",
                "traffic": "https://api.tomtom.com/traffic/map/4/tile/flow/relative0/{z}/{x}/{y}.png"}
PROVIDERS = ("tomtom", "here", "osrm")

_route_cache = {}
_route_lock = threading.Lock()
_last_call = [0.0]
stats = {"osrm_ok": 0, "osrm_fail": 0, "tomtom_ok": 0, "tomtom_fail": 0, "here_ok": 0, "here_fail": 0,
         "weather_ok": 0, "weather_fail": 0}
_down_until = {p: 0.0 for p in PROVIDERS}   # circuit breaker per provider after repeated failures
_streak = {p: 0 for p in PROVIDERS}
_osrm_down_until = [0.0]   # kept for older callers; mirrors _down_until["osrm"]
_fail_streak = [0]


def _key(name):
    return os.getenv(name, "").strip()


def routing_chain():
    """Providers to try in order, only those that can work (have a key)."""
    have = {"tomtom": bool(_key("TOMTOM_API_KEY")), "here": bool(_key("HERE_API_KEY")), "osrm": True}
    want = os.getenv("ROUTING_PROVIDER", "").strip().lower()
    if want not in PROVIDERS:
        want = "tomtom" if have["tomtom"] else "here" if have["here"] else "osrm"
    chain = [want] + [p for p in PROVIDERS if p != want and PROVIDERS.index(p) > PROVIDERS.index(want)]
    return [p for p in chain if have[p]]


def routing_info():
    """For the dashboard: which provider routes, whether TomTom map tiles and traffic are available."""
    chain = routing_chain()
    return {"provider": chain[0], "chain": chain, "tomtom_tiles": bool(_key("TOMTOM_API_KEY")),
            "attribution": "Routing and traffic: TomTom" if chain[0] == "tomtom" else
                           "Routing and traffic: HERE" if chain[0] == "here" else "Routing: OSRM / OpenStreetMap"}


def vehicle_profile(v, cargo_kg=0, hazmat=False):
    """Truck routing parameters for one vehicle (dimensions in m, weight in kg)."""
    return {"height_m": v["height_m"], "width_m": v["width_m"], "length_m": v["length_m"],
            "weight_kg": int(min(v["weight_kg"], v["empty_kg"] + cargo_kg)), "axles": v["axles"],
            "hazmat": bool(hazmat or v.get("hazmat"))}


def tomtom_params(profile, alternatives=False):
    p = {"key": _key("TOMTOM_API_KEY"), "travelMode": "truck", "traffic": "true", "routeType": "fastest",
         "routeRepresentation": "polyline", "computeTravelTimeFor": "all", "vehicleCommercial": "true",
         "maxAlternatives": 1 if alternatives else 0}
    if profile:
        p |= {"vehicleHeight": profile["height_m"], "vehicleWidth": profile["width_m"],
              "vehicleLength": profile["length_m"], "vehicleWeight": profile["weight_kg"],
              "vehicleNumberOfAxles": profile["axles"],
              "vehicleAxleWeight": int(profile["weight_kg"] / max(1, profile["axles"]))}
        if profile["hazmat"]:
            p["vehicleLoadType"] = "otherHazmatGeneral"
    return p


def parse_tomtom(data):
    out = []
    for rt in data.get("routes", []):
        s = rt["summary"]
        coords = [[pt["latitude"], pt["longitude"]] for leg in rt.get("legs", []) for pt in leg.get("points", [])]
        out.append({"coords": coords, "km": s["lengthInMeters"] / 1000, "minutes": s["travelTimeInSeconds"] / 60,
                    "traffic_delay_min": round(s.get("trafficDelayInSeconds", 0) / 60, 1), "source": "tomtom"})
    return out


def here_params(a, b, profile, alternatives=False):
    p = {"apikey": _key("HERE_API_KEY"), "transportMode": "truck", "origin": f"{a[0]},{a[1]}",
         "destination": f"{b[0]},{b[1]}", "return": "polyline,summary", "alternatives": 1 if alternatives else 0}
    if profile:
        p |= {"vehicle[grossWeight]": profile["weight_kg"], "vehicle[height]": round(profile["height_m"] * 100),
              "vehicle[width]": round(profile["width_m"] * 100), "vehicle[length]": round(profile["length_m"] * 100),
              "vehicle[axleCount]": profile["axles"]}
        if profile["hazmat"]:
            p["vehicle[shippedHazardousGoods]"] = "other"
    return p


_FP_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_"
_FP_INDEX = {c: i for i, c in enumerate(_FP_CHARS)}


def decode_flexible_polyline(s):
    """HERE flexible polyline -> [[lat, lon], ...] (third dimension, if any, is dropped)."""
    vals, cur, shift = [], 0, 0
    for ch in s:
        v = _FP_INDEX[ch]
        cur |= (v & 0x1F) << shift
        if v & 0x20:
            shift += 5
        else:
            vals.append(cur)
            cur, shift = 0, 0
    if len(vals) < 2 or vals[0] != 1:
        raise ValueError("unsupported flexible polyline")
    header = vals[1]
    prec, third = header & 15, (header >> 4) & 7
    dims = 3 if third else 2
    factor = 10 ** prec
    out, last = [], [0] * dims
    nums = [(x >> 1) ^ -(x & 1) for x in vals[2:]]        # zig-zag signed
    for i in range(0, len(nums) - dims + 1, dims):
        for d in range(dims):
            last[d] += nums[i + d]
        out.append([last[0] / factor, last[1] / factor])
    return out


def parse_here(data):
    out = []
    for rt in data.get("routes", []):
        coords, km, mins, base = [], 0.0, 0.0, 0.0
        for sec in rt.get("sections", []):
            coords += decode_flexible_polyline(sec["polyline"])
            s = sec.get("summary", {})
            km += s.get("length", 0) / 1000
            mins += s.get("duration", 0) / 60
            base += s.get("baseDuration", s.get("duration", 0)) / 60
        out.append({"coords": coords, "km": km, "minutes": mins, "traffic_delay_min": round(max(0.0, mins - base), 1),
                    "source": "here"})
    return out


def _fetch(provider, a, b, alternatives, profile):
    if provider == "tomtom":
        r = httpx.get(TOMTOM_URL.format(a=f"{a[0]},{a[1]}", b=f"{b[0]},{b[1]}"),
                      params=tomtom_params(profile, alternatives), timeout=6)
        r.raise_for_status()
        return parse_tomtom(r.json())
    if provider == "here":
        r = httpx.get(HERE_URL, params=here_params(a, b, profile, alternatives), timeout=6)
        r.raise_for_status()
        return parse_here(r.json())
    # The public OSRM demo server allows about 1 request per second.
    wait = 1.05 - (time.time() - _last_call[0])
    if wait > 0:
        time.sleep(wait)
    _last_call[0] = time.time()
    url = OSRM_URL.format(a=f"{a[1]},{a[0]}", b=f"{b[1]},{b[0]}")
    params = {"overview": "simplified", "geometries": "geojson", "alternatives": "true" if alternatives else "false"}
    r = httpx.get(url, params=params, timeout=5, headers={"User-Agent": "FleetMind-student-demo"})
    r.raise_for_status()
    return [{"coords": [[c[1], c[0]] for c in rt["geometry"]["coordinates"]], "km": rt["distance"] / 1000,
             "minutes": rt["duration"] / 60, "source": "osrm"} for rt in r.json().get("routes", [])]


def haversine(lat1, lon1, lat2, lon2):
    r = 6371.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp, dl = p2 - p1, math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(math.sqrt(a))


def _straight_route(a, b, speed_kmh=65):
    """Fallback when OSRM is unreachable: straight line with a road factor."""
    km = haversine(a[0], a[1], b[0], b[1]) * 1.25
    steps = max(2, int(km / 2))
    coords = [[a[0] + (b[0] - a[0]) * i / steps, a[1] + (b[1] - a[1]) * i / steps] for i in range(steps + 1)]
    return {"coords": coords, "km": km, "minutes": km / speed_kmh * 60, "source": "fallback"}


def _straight_routes(a, b, alternatives):
    routes = [_straight_route(a, b)]
    if alternatives:
        alt = _straight_route(a, b)
        alt["km"] *= 1.12
        alt["minutes"] *= 1.05
        routes.append(alt)
    return routes


def plan_routes(a, b, alternatives=False, vehicle=None):
    """Return a list of routes from a=(lat,lon) to b=(lat,lon). First item is the main route.
    vehicle: a vehicle_profile() dict, so TomTom / HERE plan a legal truck route."""
    prof_key = tuple(sorted(vehicle.items())) if vehicle else None
    key = (round(a[0], 3), round(a[1], 3), round(b[0], 3), round(b[1], 3), alternatives, prof_key)
    with _route_lock:
        hit = _route_cache.get(key)
        if hit and time.time() < hit[0]:
            return hit[1]
        routes, live = None, False
        for provider in routing_chain():
            if time.time() < _down_until[provider]:
                continue
            try:
                routes = _fetch(provider, a, b, alternatives, vehicle)
                if not routes or len(routes[0]["coords"]) < 2:
                    raise ValueError("no route")
                stats[f"{provider}_ok"] += 1
                _streak[provider] = 0
                live = provider in ("tomtom", "here")
                break
            except Exception:  # noqa: BLE001 - try the next provider
                routes = None
                stats[f"{provider}_fail"] += 1
                _streak[provider] += 1
                if _streak[provider] >= 3:
                    _down_until[provider] = time.time() + 120
                    _streak[provider] = 0
        _osrm_down_until[0] = _down_until["osrm"]
        if not routes:
            return _straight_routes(a, b, alternatives)     # not cached, so the next call retries
        if alternatives and len(routes) < 2:
            alt = dict(routes[0], km=routes[0]["km"] * 1.12, minutes=routes[0]["minutes"] * 1.05)
            routes = routes + [alt]
        # traffic changes, so live-traffic routes are only reused for 5 minutes
        _route_cache[key] = (time.time() + 300 if live else float("inf"), routes)
        if len(_route_cache) > 5000:
            _route_cache.clear()
        return routes


get_routes = plan_routes      # the sim calls get_routes; tests may swap it for straight lines

_tile_cache = {}
_tile_lock = threading.Lock()


def tomtom_tile(layer, z, x, y):
    """Fetch one TomTom map tile with the server-side key (cached ~5 min). Returns PNG bytes or None."""
    if layer not in TOMTOM_TILES or not _key("TOMTOM_API_KEY") or not (0 <= z <= 20):
        return None
    k = (layer, z, x, y)
    with _tile_lock:
        hit = _tile_cache.get(k)
        if hit and time.time() - hit[0] < 300:
            return hit[1]
    url = TOMTOM_TILES[layer].format(style="main", z=z, x=x, y=y)
    try:
        r = httpx.get(url, params={"key": _key("TOMTOM_API_KEY")}, timeout=8)
        r.raise_for_status()
    except Exception:  # noqa: BLE001
        return None
    with _tile_lock:
        if len(_tile_cache) > 3000:
            _tile_cache.clear()
        _tile_cache[k] = (time.time(), r.content)
    return r.content


WEATHER_CODES = {0: "Clear", 1: "Mainly clear", 2: "Partly cloudy", 3: "Overcast", 45: "Fog", 48: "Fog",
                 51: "Light drizzle", 53: "Drizzle", 55: "Heavy drizzle", 61: "Light rain", 63: "Rain",
                 65: "Heavy rain", 66: "Freezing rain", 67: "Freezing rain", 71: "Light snow", 73: "Snow",
                 75: "Heavy snow", 77: "Snow grains", 80: "Showers", 81: "Showers", 82: "Heavy showers",
                 85: "Snow showers", 86: "Heavy snow showers", 95: "Thunderstorm"}


def get_weather(lat=56.95, lon=24.11):
    """Current Riga weather from Open-Meteo (free, no key)."""
    try:
        r = httpx.get(METEO_URL, timeout=8, params={
            "latitude": lat, "longitude": lon,
            "current": "temperature_2m,precipitation,snowfall,wind_speed_10m,weather_code",
            "timezone": "Europe/Riga"})
        r.raise_for_status()
        c = r.json()["current"]
        stats["weather_ok"] += 1
        code = int(c.get("weather_code", 0))
        return {"temp_c": c.get("temperature_2m"), "precip_mm": c.get("precipitation", 0),
                "snow_cm": c.get("snowfall", 0), "wind_kmh": c.get("wind_speed_10m", 0),
                "code": code, "text": WEATHER_CODES.get(code, "Unknown"), "source": "Open-Meteo (live)"}
    except Exception:
        stats["weather_fail"] += 1
        return {"temp_c": 1.0, "precip_mm": 0.2, "snow_cm": 0, "wind_kmh": 14, "code": 3,
                "text": "Overcast", "source": "offline default"}


def weather_speed_factor(w):
    f = 1.0
    if (w.get("snow_cm") or 0) > 0 or w.get("code") in (66, 67, 71, 73, 75, 77, 85, 86):
        f = min(f, 0.75)
    elif (w.get("precip_mm") or 0) > 2 or w.get("code") in (65, 82, 95):
        f = min(f, 0.85)
    if (w.get("temp_c") or 5) < -2 and (w.get("precip_mm") or 0) > 0:
        f = min(f, 0.7)  # black ice risk
    if (w.get("wind_kmh") or 0) > 55:
        f = min(f, 0.85)
    return f
