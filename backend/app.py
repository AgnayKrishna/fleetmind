"""FleetMind API. Run: uvicorn backend.app:app --port 8000"""
import os
import threading
from pathlib import Path

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
                         for u in auth.DEMO_USERS]}


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


@app.get("/api/state")
def state(request: Request, since: int = 0):
    s = world.snapshot(log_after=since)
    s["approvals"] = [{k: v for k, v in a.items() if k != "apply"} for a in s["approvals"]]
    s["agents"] = llm.status()
    s["agent_roles"] = AGENTS
    s["key_required"] = bool(DEMO_KEY)
    user = request.state.user
    s["user"] = user
    if user["role"] == "superadmin":
        s["gtm_kpi"] = gtm.kpi()
    else:      # sales outreach is for the superadmin only
        s["gtm_kpi"] = None
        s["log"] = [e for e in s["log"] if e["agent"] != "GTM Agent"]
    return s


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


@app.get("/api/map/tile/{layer}/{z}/{x}/{y}.png")
def map_tile(layer: str, z: int, x: int, y: int):
    """TomTom map / live traffic tiles through the server, so the API key never reaches the browser."""
    png = services.tomtom_tile(layer, z, x, y)
    if png is None:
        return Response(status_code=404)
    return Response(png, media_type="image/png", headers={"Cache-Control": "public, max-age=300"})


@app.get("/api/history/{what}")
def history(what: str, limit: int = 100, status: str | None = None):
    """Saved orders, approvals or agent decisions, newest first (kept across restarts)."""
    if what not in ("orders", "approvals", "decisions"):
        return JSONResponse({"ok": False, "error": "use orders, approvals or decisions"}, status_code=404)
    store.sync(world)
    return {"ok": True, what: store.history(what, limit, status)}


@app.post("/api/event")
def event(e: EventIn):
    return team.trigger(e.type, e.vehicle_id)


@app.post("/api/approvals/{aid}")
def approve(aid: str, a: ApprovalIn, request: Request):
    return team.resolve(aid, a.option_id, a.approve, by=request.state.user)


class EnergyStopIn(BaseModel):
    station_id: str | None = None   # default: the station the Fuel & Cost Agent suggests


@app.post("/api/vehicles/{vid}/energy_stop")
def energy_stop(request: Request, vid: str, e: EnergyStopIn | None = None):
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
