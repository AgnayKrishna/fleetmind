"""FleetMind API. Run: uvicorn backend.app:app --port 8000"""
import os
import threading
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from . import llm
from .agents import AGENTS, AgentTeam
from .sim import World

llm.init()
world = World(seed=int(os.getenv("SEED", "7")))
team = AgentTeam(world)
threading.Thread(target=world.run_forever, daemon=True).start()
world.add_log("Orchestrator", f"FleetMind online with {len(world.vehicles)} vehicles. Agent mode: "
              f"{'Claude (subscription via Claude Code)' if llm.enabled() else 'rules engine'}.")

app = FastAPI(title="FleetMind")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

# Optional password. When DEMO_KEY is set, anything that changes the fleet or calls Claude
# (events, approvals, chat, controls) needs it. Viewing the dashboard stays open.
DEMO_KEY = os.getenv("DEMO_KEY", "").strip()


@app.middleware("http")
async def require_key(request: Request, call_next):
    if DEMO_KEY and request.method == "POST" and request.url.path.startswith("/api/"):
        given = request.headers.get("x-demo-key") or request.query_params.get("key")
        if given != DEMO_KEY:
            return JSONResponse({"ok": False, "error": "wrong or missing demo key"}, status_code=401)
    return await call_next(request)


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
def state(since: int = 0):
    s = world.snapshot(log_after=since)
    s["approvals"] = [{k: v for k, v in a.items() if k != "apply"} for a in s["approvals"]]
    s["agents"] = llm.status()
    s["agent_roles"] = AGENTS
    s["key_required"] = bool(DEMO_KEY)
    return s


@app.post("/api/event")
def event(e: EventIn):
    return team.trigger(e.type, e.vehicle_id)


@app.post("/api/approvals/{aid}")
def approve(aid: str, a: ApprovalIn):
    return team.resolve(aid, a.option_id, a.approve)


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
