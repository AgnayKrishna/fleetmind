"""SQLite storage (SQLAlchemy) so orders, approvals, agent decisions and GTM leads survive restarts.

The simulation itself is unchanged: it keeps running in memory. A background thread copies
new and changed orders, approvals and decision log lines into the database every couple of
seconds (Store.sync). After a restart the live sim starts fresh as before, but the history is
kept, order / approval numbers carry on where they stopped, and approvals that were still
pending are marked "expired" (their actions belonged to the old run and can't be applied).

DATABASE_URL overrides the location (default: sqlite file backend/fleetmind.db, not in git).
"""
import json
import os
import re
import threading
import time
from datetime import datetime, timezone
from pathlib import Path

from sqlalchemy import JSON, Boolean, Float, Integer, String, Text, create_engine, func, select
from sqlalchemy.orm import DeclarativeBase, Mapped, Session, mapped_column

DEFAULT_URL = f"sqlite:///{Path(__file__).resolve().parent / 'fleetmind.db'}"
DECISION_KINDS = ("decision", "llm", "approval", "alert", "gtm")   # log lines worth keeping


def _now():
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


class Base(DeclarativeBase):
    pass


class Order(Base):
    __tablename__ = "orders"
    id: Mapped[str] = mapped_column(String(16), primary_key=True)
    seq: Mapped[int] = mapped_column(Integer, index=True)
    run: Mapped[str] = mapped_column(String(32))
    pickup: Mapped[str] = mapped_column(String(80))
    dropoff: Mapped[str] = mapped_column(String(80))
    weight: Mapped[int] = mapped_column(Integer)
    cargo: Mapped[str] = mapped_column(String(80))
    priority: Mapped[str] = mapped_column(String(16))
    status: Mapped[str] = mapped_column(String(16), index=True)
    vehicle: Mapped[str | None] = mapped_column(String(16), nullable=True)
    late: Mapped[bool] = mapped_column(Boolean, default=False)
    created_sim: Mapped[float] = mapped_column(Float)
    delivered_sim: Mapped[float | None] = mapped_column(Float, nullable=True)
    data: Mapped[dict] = mapped_column(JSON)          # the full job as the sim has it
    updated_at: Mapped[str] = mapped_column(String(32))


class Approval(Base):
    __tablename__ = "approvals"
    id: Mapped[str] = mapped_column(String(16), primary_key=True)
    seq: Mapped[int] = mapped_column(Integer, index=True)
    run: Mapped[str] = mapped_column(String(32))
    event: Mapped[str] = mapped_column(String(32))
    title: Mapped[str] = mapped_column(Text)
    summary: Mapped[str] = mapped_column(Text)
    state: Mapped[str] = mapped_column(String(16), index=True)   # pending | approved | rejected | expired
    recommended: Mapped[str | None] = mapped_column(String(64), nullable=True)
    decision: Mapped[str | None] = mapped_column(String(64), nullable=True)
    created_sim: Mapped[str] = mapped_column(String(16))
    decided_sim: Mapped[str | None] = mapped_column(String(16), nullable=True)
    data: Mapped[dict] = mapped_column(JSON)          # options, notes, fallback
    updated_at: Mapped[str] = mapped_column(String(32))


class Decision(Base):
    __tablename__ = "decisions"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    run: Mapped[str] = mapped_column(String(32), index=True)
    log_id: Mapped[int] = mapped_column(Integer)
    sim_time: Mapped[str] = mapped_column(String(16))
    agent: Mapped[str] = mapped_column(String(40), index=True)
    kind: Mapped[str] = mapped_column(String(16))
    text: Mapped[str] = mapped_column(Text)
    model: Mapped[str | None] = mapped_column(String(80), nullable=True)
    created_at: Mapped[str] = mapped_column(String(32))


class Lead(Base):
    __tablename__ = "gtm_leads"
    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    position: Mapped[int] = mapped_column(Integer)
    info: Mapped[dict] = mapped_column(JSON)          # name, city, website, email, focus, ...
    status: Mapped[str] = mapped_column(String(16), default="draft")
    draft: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    opens: Mapped[list] = mapped_column(JSON, default=list)
    updated_at: Mapped[str] = mapped_column(String(32))


def _seq(id_str):
    m = re.search(r"\d+", id_str or "")
    return int(m.group()) if m else 0


def _fingerprint(d):
    return json.dumps(d, sort_keys=True, default=str)


class Store:
    def __init__(self, url=None):
        url = url or os.getenv("DATABASE_URL") or DEFAULT_URL
        self.engine = create_engine(url, connect_args={"check_same_thread": False, "timeout": 15}
                                    if url.startswith("sqlite") else {})
        Base.metadata.create_all(self.engine)
        self.run = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S")
        self.wlock = threading.Lock()    # one writer at a time
        self.slock = threading.Lock()    # one sync at a time (background thread + API)
        self._seen_orders, self._seen_appr, self._final = {}, {}, set()
        self._last_log = 0
        self._thread = None
        with Session(self.engine) as s, s.begin():
            # approvals left pending by the previous run can't be applied any more
            for a in s.scalars(select(Approval).where(Approval.state == "pending")):
                a.state, a.updated_at = "expired", _now()

    # ---------- start-up ----------
    def next_seq(self):
        """Last order and approval numbers used, so a restarted sim continues the numbering."""
        with Session(self.engine) as s:
            return (s.scalar(select(func.max(Order.seq))) or 0, s.scalar(select(func.max(Approval.seq))) or 0)

    def seed_leads(self, leads, drafts=None, state=None):
        """First start: put the GTM leads (and any existing drafts / statuses) in the database.
        Later starts only add leads that are new in docs/leads.json."""
        drafts, state = drafts or {}, state or {}
        with self.wlock, Session(self.engine) as s, s.begin():
            have = {r.id: r for r in s.scalars(select(Lead))}
            for i, lead in enumerate(leads):
                row = have.get(lead["id"])
                if row is None:
                    s.add(Lead(id=lead["id"], position=i, info=lead,
                               status=state.get("status", {}).get(lead["id"], "draft"),
                               draft=drafts.get(lead["id"]), opens=state.get("opens", {}).get(lead["id"], []),
                               updated_at=_now()))
                else:
                    row.position, row.info = i, lead
                    if row.draft is None and drafts.get(lead["id"]):
                        row.draft = drafts[lead["id"]]

    # ---------- GTM ----------
    def load_leads(self):
        with Session(self.engine) as s:
            rows = list(s.scalars(select(Lead).order_by(Lead.position)))
            return ([r.info for r in rows], {r.id: r.draft for r in rows if r.draft},
                    {r.id: r.status for r in rows if r.status != "draft"}, {r.id: list(r.opens) for r in rows if r.opens})

    def save_lead(self, lid, **fields):
        with self.wlock, Session(self.engine) as s, s.begin():
            row = s.get(Lead, lid)
            if row is None:
                return
            for k, v in fields.items():
                setattr(row, k, v)
            row.updated_at = _now()

    # ---------- world sync ----------
    def sync(self, world):
        """Copy new / changed orders, approvals and decision log lines from the live world."""
        with self.slock:
            return self._sync(world)

    def _sync(self, world):
        with world.lock:
            orders = []
            for jid, j in world.jobs.items():
                if jid in self._final:
                    continue
                fp = _fingerprint(j)
                if self._seen_orders.get(jid) != fp:
                    orders.append((jid, dict(j), fp))
            apprs = []
            for aid, a in world.approvals.items():
                clean = {k: v for k, v in a.items() if k != "apply"}
                fp = _fingerprint(clean)
                if self._seen_appr.get(aid) != fp:
                    apprs.append((aid, clean, fp))
            logs = [dict(e) for e in world.log if e["id"] > self._last_log]
        if not (orders or apprs or logs):
            return 0
        now = _now()
        with self.wlock, Session(self.engine) as s, s.begin():
            for jid, j, _ in orders:
                row = s.get(Order, jid) or Order(id=jid, seq=_seq(jid), run=self.run)
                row.pickup, row.dropoff = j["pickup"]["name"], j["dropoff"]["name"]
                row.weight, row.cargo, row.priority = int(j["weight"]), j["cargo"], j["priority"]
                row.status, row.vehicle, row.late = j["status"], j["vehicle"], bool(j["late"])
                row.created_sim, row.delivered_sim = j["created"], j["delivered_at"]
                row.data = json.loads(_fingerprint(j))
                row.updated_at = now
                s.merge(row)
            for aid, a, _ in apprs:
                row = s.get(Approval, aid) or Approval(id=aid, seq=_seq(aid), run=self.run)
                row.event, row.title, row.summary = a.get("event", ""), a.get("title", ""), a.get("summary", "")
                row.state, row.recommended = a.get("state", "pending"), a.get("recommended")
                row.decision, row.decided_sim = a.get("decision"), a.get("decided_at")
                row.created_sim = a.get("created", "")
                row.data = json.loads(_fingerprint({k: a.get(k) for k in ("options", "notes", "fallback")}))
                row.updated_at = now
                s.merge(row)
            for e in logs:
                if e["kind"] in DECISION_KINDS:
                    s.add(Decision(run=self.run, log_id=e["id"], sim_time=e["t"], agent=e["agent"], kind=e["kind"],
                                   text=e["text"], model=e.get("model"), created_at=now))
        for jid, j, fp in orders:
            self._seen_orders[jid] = fp
            if j["status"] == "delivered":
                self._final.add(jid)
                self._seen_orders.pop(jid, None)
        for aid, _, fp in apprs:
            self._seen_appr[aid] = fp
        if logs:
            self._last_log = logs[-1]["id"]
        return len(orders) + len(apprs) + len(logs)

    def start(self, world, every_s=2.0):
        def loop():
            while True:
                time.sleep(every_s)
                try:
                    self.sync(world)
                except Exception as e:  # noqa: BLE001 - never let storage stop the sim
                    world.add_log("Orchestrator", f"Database sync failed: {e}", "alert")
                    time.sleep(10)
        self._thread = threading.Thread(target=loop, daemon=True)
        self._thread.start()

    # ---------- history for the API ----------
    def history(self, what, limit=100, status=None):
        limit = max(1, min(int(limit), 1000))
        model = {"orders": Order, "approvals": Approval, "decisions": Decision}[what]
        q = select(model)
        if status and what != "decisions":
            q = q.where(model.status == status if what == "orders" else model.state == status)
        q = q.order_by((model.id if what == "decisions" else model.seq).desc()).limit(limit)
        with Session(self.engine) as s:
            return [{c.name: getattr(r, c.name) for c in model.__table__.columns} for r in s.scalars(q)]
