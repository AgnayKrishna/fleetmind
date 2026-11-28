"""FleetMind API. Run: uvicorn backend.app:app --port 8000"""
import os
import threading
import time
from pathlib import Path
from urllib.parse import urlsplit

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from . import auth, llm, services
from .agents import AGENTS, AgentTeam
from .db import Store
from .gtm import GtmAgent
from .sim import World

def _load_dotenv(path=Path(__file__).resolve().parent.parent / ".env"):
    """KEY=value lines from .env (TOMTOM_API_KEY, HERE_API_KEY, ...). Never overrides real env vars,
    values are never logged. Tests set FLEETMIND_NO_DOTENV=1 so they can't pick up real keys."""
    if os.getenv("FLEETMIND_NO_DOTENV") or not path.is_file():
        return
    for line in path.read_text(encoding="utf-8", errors="ignore").splitlines():
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            k, v = line.removeprefix("export ").split("=", 1)
            os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))


_load_dotenv()
llm.init()
store = Store()
job_seq, appr_seq = store.next_seq()
world = World(seed=int(os.getenv("SEED", "7")), job_seq=job_seq, appr_seq=appr_seq)
team = AgentTeam(world)
gtm = GtmAgent(world, store)
store.seed_users(auth.DEMO_USERS, auth.hash_password)
for _u in auth.DEMO_USERS:
    if _u["role"] == "employee":
        store.seed_trucks(_u["username"], sorted(world.vehicles)[:auth.EMPLOYEE_DEFAULT_TRUCKS])
sessions = auth.Sessions()
threading.Thread(target=world.run_forever, daemon=True).start()
store.start(world)
world.add_log("Orchestrator", f"FleetMind online with {len(world.vehicles)} vehicles. Agent mode: "
              f"{ {'claude': 'Claude (subscription via Claude Code)', 'api': 'Claude API (Sonnet + Haiku)'}.get(llm.status()['mode'], 'rules engine')}.")
gtm.start()   # drafts only leads that have no saved draft yet

app = FastAPI(title="FleetMind")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

# Optional password. When DEMO_KEY is set, anything that changes the fleet or calls Claude
# (events, approvals, chat, controls) needs it. Viewing the dashboard stays open.
DEMO_KEY = os.getenv("DEMO_KEY", "").strip()


@app.middleware("http")
async def require_key(request: Request, call_next):
    # /api/gtm/open stays open: prospects arriving from an email link don't have the key.
    if (DEMO_KEY and request.method == "POST" and request.url.path.startswith("/api/")
            and request.url.path != "/api/gtm/open" and not request.url.path.startswith("/api/auth/")):
        given = request.headers.get("x-demo-key") or request.query_params.get("key")
        if given != DEMO_KEY:
            return JSONResponse({"ok": False, "error": "wrong or missing demo key"}, status_code=401)
    return await call_next(request)


@app.middleware("http")
async def require_role(request: Request, call_next):
    """Logins and roles on every /api endpoint (see auth.PERMISSIONS). Not listed = refused."""
    path = request.url.path
    if request.method == "OPTIONS" or not path.startswith("/api/"):
        return await call_next(request)        # CORS preflight and the static dashboard files
    found, roles = auth.rule_for(request.method, path)
    if not found:
        return JSONResponse({"ok": False, "error": "not allowed"}, status_code=403)
    user = sessions.get(auth.token_from(request))
    request.state.user = user
    if roles is auth.OPEN:
        return await call_next(request)
    if not user:
        return JSONResponse({"ok": False, "error": "login required"}, status_code=401)
    if user["role"] not in roles:
        return JSONResponse({"ok": False, "error": f"your role ({user['role']}) can't do this"}, status_code=403)
    return await call_next(request)


class LoginIn(BaseModel):
    username: str
    password: str


@app.get("/api/auth/demo-accounts")
def demo_accounts():
    """Shown on the login page. Demo only: these passwords are public."""
    return {"accounts": [{k: u[k] for k in ("username", "password", "name", "role")} | {"vehicle_id": u.get("vehicle_id")}
                         for u in auth.DEMO_USERS if u.get("public", True)],
            "guest": True}


@app.post("/api/auth/guest")
def login_guest(request: Request):
    """'View as guest': a read-only company admin view for the public demo. No password."""
    token = sessions.create(auth.GUEST_USER)
    r = JSONResponse({"ok": True, "token": token, "user": dict(auth.GUEST_USER)})
    https = request.url.scheme == "https" or request.headers.get("x-forwarded-proto") == "https"
    r.set_cookie(auth.COOKIE, token, max_age=auth.SESSION_TTL_S, httponly=True, samesite="lax", secure=https)
    return r


@app.post("/api/auth/login")
def login(body: LoginIn, request: Request):
    u = store.get_user(body.username[:64])
    if not u or not auth.verify_password(body.password[:200], u["password_hash"]):
        return JSONResponse({"ok": False, "error": "wrong username or password"}, status_code=401)
    token = sessions.create(u)
    user = {k: u[k] for k in ("username", "name", "role", "vehicle_id")}
    world.add_log("Orchestrator", f"{u['name']} signed in ({u['role']}).", "info")
    r = JSONResponse({"ok": True, "token": token, "user": user})
    https = request.url.scheme == "https" or request.headers.get("x-forwarded-proto") == "https"
    r.set_cookie(auth.COOKIE, token, max_age=auth.SESSION_TTL_S, httponly=True, samesite="lax", secure=https)
    return r


@app.post("/api/auth/logout")
def logout(request: Request):
    sessions.drop(auth.token_from(request))
    r = JSONResponse({"ok": True})
    r.delete_cookie(auth.COOKIE)
    return r


@app.get("/api/auth/me")
def me(request: Request):
    return {"ok": True, "user": request.state.user}


# ---------- driver phone view ----------
class DriverActionIn(BaseModel):
    action: str            # arrived | loaded | delivered


class ProblemIn(BaseModel):
    note: str = ""


def _driver_vehicle(request):
    vid = request.state.user.get("vehicle_id")
    return vid if vid in world.vehicles else None


@app.get("/api/driver/me")
def driver_me(request: Request):
    vid = _driver_vehicle(request)
    if not vid:
        return JSONResponse({"ok": False, "error": "no vehicle is linked to this driver account"}, status_code=404)
    return {"ok": True, "user": request.state.user} | world.driver_view(vid)


@app.post("/api/driver/action")
def driver_action(a: DriverActionIn, request: Request):
    vid = _driver_vehicle(request)
    if not vid:
        return JSONResponse({"ok": False, "error": "no vehicle is linked to this driver account"}, status_code=404)
    r = world.driver_action(vid, a.action, by=request.state.user["name"])
    return r if r["ok"] else JSONResponse(r, status_code=409)


@app.post("/api/driver/problem")
def driver_problem(p: ProblemIn, request: Request):
    """'Report a problem': runs the same breakdown pipeline as a sensor alert or the dashboard button."""
    vid = _driver_vehicle(request)
    if not vid:
        return JSONResponse({"ok": False, "error": "no vehicle is linked to this driver account"}, status_code=404)
    if world.vehicles[vid]["status"] == "broken":
        return JSONResponse({"ok": False, "error": "already reported: the Maintenance Agent is on it"}, status_code=409)
    note = " ".join(p.note.split())[:300]
    world.add_log("Fleet manager", f"Driver {request.state.user['name']} reported a problem on {vid}"
                  + (f": \"{note}\"" if note else "."), "alert")
    return team.trigger("breakdown", vid, source="driver")


class EventIn(BaseModel):
    type: str
    vehicle_id: str | None = None


class ApprovalIn(BaseModel):
    option_id: str | None = None
    approve: bool = True


class ChatIn(BaseModel):
    message: str


class ControlIn(BaseModel):
    action: str            # pause | resume | speed
    value: float | None = None


@app.get("/api/health")
def health():
    return {"ok": True, "agents": llm.status(), "key_required": bool(DEMO_KEY)}


# ---------- company settings, dispatcher trucks and the approval limit ----------
def company_settings():
    return store.get_settings(auth.DEFAULT_SETTINGS)


def own_trucks(user):
    """The vehicles an employee looks after; None = every vehicle (admins)."""
    return set(store.trucks_for(user["username"])) if user and user["role"] == "employee" else None


def admin_name():
    return next((u["name"] for u in store.list_users() if u["role"] == "logistics_admin"), "the company admin")


def can_decide(user, appr, limit):
    """(allowed, reason). Admins decide any approval, dispatchers up to the limit, nobody else."""
    if user["role"] == "logistics_admin":
        return True, None
    if user["role"] == "employee":
        if (appr.get("cost_eur") or 0) <= limit:
            return True, None
        return False, f"Over your €{limit:g} limit: sent to {admin_name()} for approval."
    if user["role"] == "guest":
        return False, "Guest view is read only. Sign in to decide."
    return False, "Only the company decides its own approvals."


def can_undo(user, action):
    if user["role"] == "logistics_admin":
        return True
    if user["role"] == "employee":
        mine = own_trucks(user)
        return bool(action["vehicles"]) and set(action["vehicles"]) <= mine
    return False


def actions_for(user):
    out = world.actions_view()
    for a in out:
        a["can_undo"] = a["reversible"] and a["state"] == "done" and can_undo(user, a)
    return out


@app.get("/api/state")
def state(request: Request, since: int = 0):
    s = world.snapshot(log_after=since)
    s["approvals"] = [{k: v for k, v in a.items() if k != "apply"} for a in s["approvals"]]
    s["agents"] = llm.status()
    s["agent_roles"] = AGENTS
    s["key_required"] = bool(DEMO_KEY)
    user = request.state.user
    role = user["role"]
    s["user"] = user
    cfg = company_settings()
    limit = cfg["approval_limit_eur"]
    mine = own_trucks(user)
    s["me"] = {"role": role, "trucks": sorted(mine) if mine is not None else None,
               "approval_limit_eur": limit if role == "employee" else None,
               "can_write": role in auth.DISPATCH, "admin_name": admin_name()}
    s["company"] = {"name": cfg["company_name"]}
    for a in s["approvals"]:
        a["can_decide"], a["blocked_reason"] = can_decide(user, a, limit)
    for v in s["vehicles"]:
        v["mine"] = mine is None or v["id"] in mine
    s["actions"] = actions_for(user)[:60]
    if role not in auth.ADMIN_VIEW:        # customer prices, revenue and profit are for the company admin
        s["jobs"] = [{k: v for k, v in j.items() if k not in auth.PRICE_FIELDS} for j in s["jobs"]]
        for k in auth.REVENUE_KPIS:
            s["kpi"].pop(k, None)
    if role == "superadmin":               # support view: no trip costs or savings either
        for k in auth.COST_KPIS:
            s["kpi"][k] = None
        s["history"] = [{k: v for k, v in h.items() if k != "cost"} for h in s["history"]]
        for v in s["vehicles"]:
            if v.get("energy_stop"):
                v["energy_stop"] = None
    if role == "superadmin":
        s["gtm_kpi"] = gtm.kpi()
    else:      # sales outreach is for the superadmin only
        s["gtm_kpi"] = None
        s["log"] = [e for e in s["log"] if e["agent"] != "GTM Agent"]
    return s


@app.get("/api/actions")
def actions(request: Request):
    """AI actions today, newest first, with Undo where it is allowed for you."""
    return {"ok": True, "actions": actions_for(request.state.user)}


@app.post("/api/actions/{aid}/undo")
def undo_action(aid: str, request: Request):
    user = request.state.user
    a = next((x for x in world.actions_view() if x["id"] == aid), None)
    if not a:
        return JSONResponse({"ok": False, "error": "unknown action"}, status_code=404)
    if not can_undo(user, a):
        return JSONResponse({"ok": False, "error": "you can only undo AI actions on your own trucks"}, status_code=403)
    r = world.undo_action(aid, by=f"{user['name']} ({user['username']}, {user['role']})")
    return r if r["ok"] else JSONResponse(r, status_code=409)


class SettingsIn(BaseModel):
    approval_limit_eur: float | None = None
    company_name: str | None = None


@app.get("/api/settings")
def get_settings():
    return {"ok": True, "settings": company_settings()}


@app.post("/api/settings")
def set_settings(body: SettingsIn, request: Request):
    who = request.state.user["name"]
    if body.approval_limit_eur is not None:
        if not 0 <= body.approval_limit_eur <= 100000:
            return JSONResponse({"ok": False, "error": "approval limit must be 0 to 100000 EUR"}, status_code=422)
        store.set_setting("approval_limit_eur", round(body.approval_limit_eur, 2), by=who)
        world.add_log("Fleet manager", f"{who} set the dispatcher approval limit to EUR {body.approval_limit_eur:g}.",
                      "approval")
    if body.company_name is not None and body.company_name.strip():
        store.set_setting("company_name", body.company_name.strip()[:80], by=who)
    return {"ok": True, "settings": company_settings()}


@app.get("/api/users")
def users():
    return {"ok": True, "users": [u | {"trucks": store.trucks_for(u["username"]) if u["role"] == "employee" else None}
                                  for u in store.list_users()]}


class TrucksIn(BaseModel):
    vehicle_ids: list[str]


@app.post("/api/users/{username}/trucks")
def set_user_trucks(username: str, body: TrucksIn):
    u = store.get_user(username)
    if not u or u["role"] != "employee":
        return JSONResponse({"ok": False, "error": "only employees have assigned trucks"}, status_code=404)
    bad = [v for v in body.vehicle_ids if v not in world.vehicles]
    if bad:
        return JSONResponse({"ok": False, "error": f"unknown vehicles: {', '.join(bad[:5])}"}, status_code=422)
    store.set_trucks(u["username"], body.vehicle_ids)
    return {"ok": True, "trucks": store.trucks_for(u["username"])}


class OrderIn(BaseModel):
    pickup: str
    dropoff: str
    weight: int
    cargo: str | None = None
    priority: str = "normal"


class AssignIn(BaseModel):
    vehicle_id: str | None = None      # default: the best feasible vehicle


class MessageIn(BaseModel):
    text: str


@app.post("/api/orders")
def create_order(o: OrderIn, request: Request):
    r = world.create_order(o.pickup, o.dropoff, o.weight, o.cargo,
                           "urgent" if o.priority == "urgent" else "normal", by=request.state.user["name"])
    return r if r["ok"] else JSONResponse(r, status_code=422)


@app.post("/api/orders/{jid}/assign")
def assign_order(jid: str, a: AssignIn, request: Request):
    r = world.assign_order(jid, a.vehicle_id, by=request.state.user["name"])
    return r if r["ok"] else JSONResponse(r, status_code=409)


@app.post("/api/vehicles/{vid}/message")
def message_driver(vid: str, m: MessageIn, request: Request):
    r = world.send_message(vid, m.text, by=request.state.user["name"])
    return r if r["ok"] else JSONResponse(r, status_code=404 if r["error"] == "unknown vehicle" else 422)


class GtmStatusIn(BaseModel):
    status: str            # draft | approved | sent | replied


class GtmOpenIn(BaseModel):
    ref: str


@app.get("/api/gtm")
def gtm_state():
    return gtm.snapshot()


@app.post("/api/gtm/open")
def gtm_open(o: GtmOpenIn):
    return gtm.demo_opened(o.ref[:64])


@app.post("/api/gtm/{lead_id}/status")
def gtm_status(lead_id: str, s: GtmStatusIn):
    return gtm.set_status(lead_id, s.status)


# ---------- map tile proxy protection ----------
# The tile proxy has no login (map images can't send a bearer header), so it only answers pages
# from our own sites (Origin or Referer), limits requests per IP, and caches tiles for 10 minutes.
DEFAULT_ALLOWED_ORIGINS = "http://localhost,http://127.0.0.1,https://fleetmind-brr9.onrender.com,https://agnaykrishna.github.io"
TILE_RATE_PER_MIN = int(os.getenv("TILE_RATE_PER_MIN", "600"))   # a full-screen map at one zoom is ~30-60 tiles


def _parse_origin(value):
    """'https://host:port/any/path' -> ('https', 'host', port or None). None if it isn't a URL."""
    try:
        u = urlsplit((value or "").strip())
        if u.scheme not in ("http", "https") or not u.hostname:
            return None
        return u.scheme, u.hostname.lower(), u.port
    except ValueError:
        return None


def allowed_origins():
    raw = os.getenv("ALLOWED_ORIGINS") or DEFAULT_ALLOWED_ORIGINS
    return [o for o in (_parse_origin(x) for x in raw.split(",")) if o]


def tile_origin_ok(request):
    """Origin (or Referer) must match ALLOWED_ORIGINS. An entry without a port allows any port.
    The backend's own pages (same host) are always allowed."""
    src = _parse_origin(request.headers.get("origin")) or _parse_origin(request.headers.get("referer"))
    if not src:
        return False
    host = (request.headers.get("host") or "").split(":")[0].lower()
    if host and src[1] == host:
        return True
    return any(src[0] == s and src[1] == h and (p is None or p == src[2]) for s, h, p in allowed_origins())


class RateLimiter:
    """Sliding one-minute window per key (client IP)."""
    def __init__(self, per_min):
        self.per_min, self._hits, self._lock = per_min, {}, threading.Lock()

    def allow(self, key, now=None):
        now = time.time() if now is None else now
        with self._lock:
            hits = [t for t in self._hits.get(key, ()) if now - t < 60]
            ok = len(hits) < self.per_min
            if ok:
                hits.append(now)
            self._hits[key] = hits
            if len(self._hits) > 10000:      # forget idle clients
                self._hits = {k: v for k, v in self._hits.items() if v and now - v[-1] < 60}
            return ok


tile_limiter = RateLimiter(TILE_RATE_PER_MIN)


def client_ip(request):
    fwd = request.headers.get("x-forwarded-for", "")   # Render / Railway put the real IP first
    return fwd.split(",")[0].strip() or (request.client.host if request.client else "?")


@app.get("/api/map/tile/{layer}/{z}/{x}/{y}.png")
def map_tile(request: Request, layer: str, z: int, x: int, y: int):
    """TomTom map / live traffic tiles through the server, so the API key never reaches the browser."""
    if not tile_origin_ok(request):
        return Response(status_code=403)
    if not tile_limiter.allow(client_ip(request)):
        return Response(status_code=429, headers={"Retry-After": "60"})
    png = services.tomtom_tile(layer, z, x, y)
    if png is None:
        return Response(status_code=404)
    return Response(png, media_type="image/png", headers={"Cache-Control": "public, max-age=600"})


@app.get("/api/history/{what}")
def history(request: Request, what: str, limit: int = 100, status: str | None = None):
    """Saved orders, approvals or agent decisions, newest first (kept across restarts)."""
    if what not in ("orders", "approvals", "decisions"):
        return JSONResponse({"ok": False, "error": "use orders, approvals or decisions"}, status_code=404)
    store.sync(world)
    rows = store.history(what, limit, status)
    if what == "orders" and request.state.user["role"] not in auth.ADMIN_VIEW:
        for r in rows:
            r["data"] = {k: v for k, v in (r.get("data") or {}).items() if k not in auth.PRICE_FIELDS}
    return {"ok": True, what: rows}


@app.post("/api/event")
def event(e: EventIn):
    return team.trigger(e.type, e.vehicle_id)


@app.post("/api/approvals/{aid}")
def approve(aid: str, a: ApprovalIn, request: Request):
    user = request.state.user
    appr = world.approvals.get(aid)
    if appr and appr["state"] == "pending":
        ok, why = can_decide(user, appr, company_settings()["approval_limit_eur"])
        if not ok:        # it stays pending for the admin
            return JSONResponse({"ok": False, "error": why, "sent_to": admin_name()}, status_code=403)
    return team.resolve(aid, a.option_id, a.approve, by=user)


class EnergyStopIn(BaseModel):
    station_id: str | None = None   # default: the station the Fuel & Cost Agent suggests


@app.post("/api/vehicles/{vid}/energy_stop")
def energy_stop(request: Request, vid: str, e: EnergyStopIn | None = None):
    mine = own_trucks(request.state.user)
    if mine is not None and vid not in mine:
        return JSONResponse({"ok": False, "error": f"{vid} isn't one of your trucks"}, status_code=403)
    r = world.add_energy_stop(vid, e.station_id if e else None, by=request.state.user["name"])
    return r if r["ok"] else JSONResponse(r, status_code=409)


@app.post("/api/chat")
def chat(c: ChatIn):
    return team.chat(c.message[:500])


@app.post("/api/control")
def control(c: ControlIn):
    with world.lock:
        if c.action == "pause":
            world.paused = True
        elif c.action == "resume":
            world.paused = False
        elif c.action == "speed" and c.value:
            world.speed = max(0.5, min(10.0, c.value))
    return {"ok": True, "paused": world.paused, "speed": world.speed}


# Serve the dashboard from /docs when running locally.
DOCS = Path(__file__).resolve().parent.parent / "docs"
if DOCS.exists():
    @app.get("/")
    def index():
        return FileResponse(DOCS / "index.html")
    app.mount("/", StaticFiles(directory=DOCS), name="static")
