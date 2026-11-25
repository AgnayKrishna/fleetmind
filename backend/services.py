"""Real public data: OpenStreetMap routing (OSRM) and Open-Meteo weather.
Everything has an offline fallback so the demo never breaks."""
import math
import threading
import time

import httpx

OSRM_URL = "https://router.project-osrm.org/route/v1/driving/{a};{b}"
METEO_URL = "https://api.open-meteo.com/v1/forecast"

_route_cache = {}
_route_lock = threading.Lock()
_last_call = [0.0]
stats = {"osrm_ok": 0, "osrm_fail": 0, "weather_ok": 0, "weather_fail": 0}
_osrm_down_until = [0.0]   # circuit breaker: skip OSRM for a while after repeated failures
_fail_streak = [0]


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


def get_routes(a, b, alternatives=False):
    """Return a list of routes from a=(lat,lon) to b=(lat,lon). First item is the main route."""
    key = (round(a[0], 3), round(a[1], 3), round(b[0], 3), round(b[1], 3), alternatives)
    with _route_lock:
        if key in _route_cache:
            return _route_cache[key]
        routes = None
        if time.time() < _osrm_down_until[0]:
            routes = [_straight_route(a, b)]
            if alternatives:
                alt = _straight_route(a, b)
                alt["km"] *= 1.12
                alt["minutes"] *= 1.05
                routes.append(alt)
            return routes
        # The public OSRM demo server allows about 1 request per second.
        wait = 1.05 - (time.time() - _last_call[0])
        if wait > 0:
            time.sleep(wait)
        _last_call[0] = time.time()
        try:
            url = OSRM_URL.format(a=f"{a[1]},{a[0]}", b=f"{b[1]},{b[0]}")
            params = {"overview": "simplified", "geometries": "geojson",
                      "alternatives": "true" if alternatives else "false"}
            r = httpx.get(url, params=params, timeout=5, headers={"User-Agent": "FleetMind-student-demo"})
            r.raise_for_status()
            data = r.json()
            routes = [{
                "coords": [[c[1], c[0]] for c in rt["geometry"]["coordinates"]],
                "km": rt["distance"] / 1000,
                "minutes": rt["duration"] / 60,
                "source": "osrm",
            } for rt in data.get("routes", [])]
            stats["osrm_ok"] += 1
            _fail_streak[0] = 0
        except Exception:
            stats["osrm_fail"] += 1
            _fail_streak[0] += 1
            if _fail_streak[0] >= 3:
                _osrm_down_until[0] = time.time() + 120
                _fail_streak[0] = 0
        if not routes:
            routes = [_straight_route(a, b)]
            if alternatives:
                alt = _straight_route(a, b)
                alt["km"] *= 1.12
                alt["minutes"] *= 1.05
                routes.append(alt)
        _route_cache[key] = routes
        return routes


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
