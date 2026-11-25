"""The agent team.

Orchestrator (Claude Sonnet) receives every event, calls the specialists it needs
(Claude Haiku), merges their advice and applies the risk policy:
  low risk  -> action applied automatically
  high risk -> sent to the manager's approval queue on the dashboard

Specialists can only choose from options the rules engine has already checked
(capacity, driver hours, EV range, health), so an LLM can never pick an
impossible action. In rules mode the same pipeline runs without the LLM.
"""
import json
import random
import threading
from concurrent.futures import ThreadPoolExecutor

from . import llm, services
from .data import LOCATIONS, PRICES, loc
from .sim import MOVING, clock_str

AGENTS = {
    "Orchestrator": "Coordinates all agents, applies the risk policy, talks to the fleet manager.",
    "Route Agent": "Routes, traffic incidents, weather impact, ETAs (OpenStreetMap / OSRM, Open-Meteo).",
    "Dispatch Agent": "Matches jobs to vehicles: capacity, driver hours (EU 561/2006), time windows, EV range.",
    "Maintenance Agent": "Vehicle health, service intervals, breakdown diagnosis and repair planning.",
    "Fuel & Cost Agent": "Fuel and charging, cost per km, CO2, consumption anomalies.",
    "GTM Agent": "Finds and scores pilot customers, drafts outreach emails for manager approval (never sends).",
}

FAULTS_DIESEL = [("Engine overheating", 120, 450), ("Flat tyre", 45, 120), ("AdBlue system fault", 90, 300),
                 ("Brake pressure warning", 150, 520)]
FAULTS_EV = [("Battery cooling fault", 180, 600), ("Flat tyre", 45, 120), ("Inverter warning", 140, 480)]


def model_label(role):
    return f"Claude {llm.MODELS[role].capitalize()} via Claude Code"


class AgentTeam:
    def __init__(self, world):
        self.w = world
        self.pool = ThreadPoolExecutor(max_workers=4)       # event handlers
        self.llm_pool = ThreadPoolExecutor(max_workers=8)   # parallel specialist calls
        self.next_scan = world.sim + 60
        self.anomaly_at = world.sim + 150
        self.busy = threading.Lock()
        world.periodic_hook = self.periodic
        world.event_hook = self.trigger

    # ================= public =================
    def trigger(self, kind, vehicle_id=None, source="dashboard"):
        handlers = {"traffic": self._traffic, "weather": self._weather,
                    "breakdown": self._breakdown, "urgent_order": self._urgent}
        if kind not in handlers:
            return {"ok": False, "error": f"unknown event {kind}"}
        self.pool.submit(self._safe, handlers[kind], vehicle_id, source)
        return {"ok": True, "event": kind}

    def resolve(self, appr_id, option_id, approved=True):
        w = self.w
        with w.lock:
            a = w.approvals.get(appr_id)
            if not a or a["state"] != "pending":
                return {"ok": False, "error": "approval not found or already handled"}
            if not approved:
                a["state"] = "rejected"
                option_id = a.get("fallback")
            else:
                if option_id not in [o["id"] for o in a["options"]]:
                    option_id = a["recommended"]
                a["state"] = "approved"
            w.kpi["approvals_done"] += 1
        label = next((o["label"] for o in a["options"] if o["id"] == option_id), option_id)
        w.add_log("Fleet manager", f"{'Approved' if approved else 'Rejected'}: {a['title']} -> {label}", "approval")
        if option_id:
            a["apply"](option_id)
        return {"ok": True}

    # ================= pipeline =================
    def _safe(self, fn, *args):
        try:
            fn(*args)
        except Exception as e:  # noqa: BLE001
            self.w.add_log("Orchestrator", f"Error while handling event: {e}", "alert")

    def _decide(self, event, title, situation, decider, options, rule_choice, advisors, risk_of, apply,
                fallback=None):
        """Shared flow: specialists -> orchestrator -> risk policy -> apply or approval."""
        w = self.w
        names = [decider] + [a[0] for a in advisors]
        w.add_log("Orchestrator", f"{title}. Calling: {', '.join(names)}.", "info",
                  model=model_label("orchestrator") if llm.enabled() else "rules engine")
        option_ids = [o["id"] for o in options]
        choice, reasoning, notes = rule_choice["id"], rule_choice["why"], {}
        for name, rule_note in advisors:
            notes[name] = rule_note

        if llm.enabled():
            futs = {}
            futs[decider] = self.llm_pool.submit(llm.ask_json, self._prompt_decider(decider, situation, options))
            for name, rule_note in advisors:
                futs[name] = self.llm_pool.submit(llm.ask_json, self._prompt_advisor(name, situation, options, rule_note))
            res = {n: f.result() for n, f in futs.items()}
            d = res.get(decider)
            if d and d.get("choice") in option_ids:
                choice, reasoning = d["choice"], d.get("reasoning", reasoning)
                w.add_log(decider, f"Recommends '{self._label(options, choice)}': {reasoning}", "llm",
                          model=model_label("specialist"))
            else:
                w.add_log(decider, f"LLM answer unusable, rules fallback: {reasoning}", "decision")
            for name, _ in advisors:
                r = res.get(name)
                if r and r.get("note"):
                    notes[name] = r["note"]
                    w.add_log(name, r["note"], "llm", model=model_label("specialist"))
                else:
                    w.add_log(name, notes[name], "decision")
            o = llm.ask_json(self._prompt_orchestrator(situation, options, choice, reasoning, notes, risk_of(choice)),
                             role="orchestrator")
            summary = f"{self._label(options, choice)}. {reasoning}"
            llm_risk = None
            if o:
                if o.get("final_choice") in option_ids:
                    choice = o["final_choice"]
                summary = o.get("summary") or summary
                llm_risk = o.get("risk")
                w.kpi["llm_decisions"] += 1
        else:
            w.add_log(decider, f"Recommends '{self._label(options, choice)}': {reasoning}", "decision")
            for name, _ in advisors:
                w.add_log(name, notes[name], "decision")
            summary = f"{self._label(options, choice)}. {reasoning}"
            llm_risk = None

        # Risk policy: the LLM can raise the risk level but never lower it.
        risk = risk_of(choice)
        if llm_risk == "high":
            risk = "high"
        if risk == "low":
            apply(choice)
            w.kpi["auto_decisions"] += 1
            w.add_log("Orchestrator", f"Low risk, applied automatically: {summary}", "decision",
                      model=model_label("orchestrator") if llm.enabled() else "rules engine")
        else:
            with w.lock:
                w.seq["appr"] += 1
                aid = f"A{w.seq['appr']}"
                w.approvals[aid] = {"id": aid, "event": event, "title": title, "summary": summary,
                                    "options": options, "recommended": choice, "state": "pending",
                                    "created": clock_str(w.sim), "notes": notes, "apply": apply,
                                    "fallback": fallback}
            w.add_log("Orchestrator", f"High risk, needs manager approval ({aid}): {summary}", "approval",
                      model=model_label("orchestrator") if llm.enabled() else "rules engine")

    @staticmethod
    def _label(options, oid):
        return next((o["label"] for o in options if o["id"] == oid), oid)

    # ================= prompts =================
    def _prompt_decider(self, name, situation, options):
        return (f"You are the {name} in FleetMind, a multi-agent control system for a mixed freight fleet "
                f"(diesel trucks, diesel vans, electric trucks and vans) operating in Latvia.\n"
                f"Your job: {AGENTS[name]}\n\nSituation:\n{json.dumps(situation, default=str)}\n\n"
                f"Options (already checked as feasible by the rules engine):\n{json.dumps(options, default=str)}\n\n"
                'Pick the best option. Answer as {"choice": "<option id>", "reasoning": "<max 2 short sentences>"}')

    def _prompt_advisor(self, name, situation, options, rule_note):
        return (f"You are the {name} in FleetMind, a multi-agent fleet control system in Latvia.\n"
                f"Your job: {AGENTS[name]}\n\nSituation:\n{json.dumps(situation, default=str)}\n\n"
                f"Options being considered:\n{json.dumps(options, default=str)}\n\n"
                f"Facts from the rules engine: {rule_note}\n\n"
                'Give your specialist advice. Answer as {"note": "<max 2 short sentences, concrete numbers>"}')

    def _prompt_orchestrator(self, situation, options, choice, reasoning, notes, policy_risk):
        return ("You are the Orchestrator of FleetMind, a multi-agent fleet control system in Latvia. "
                "Merge the specialists' advice into one decision.\n"
                f"Situation: {json.dumps(situation, default=str)}\nOptions: {json.dumps(options, default=str)}\n"
                f"Lead specialist picked: {choice} because {reasoning}\nOther specialists: {json.dumps(notes)}\n"
                f"Company risk policy rates the picked option as: {policy_risk}. Reroutes and customer notices are "
                "low risk; moving cargo between trucks, bumping jobs, pausing operations or costs above EUR 300 "
                "are high risk.\n"
                'Answer as {"final_choice": "<option id>", "risk": "low" or "high", '
                '"summary": "<one sentence for the fleet manager>"}')

    def _still_free(self, vid, job, origin=None):
        """Approvals can wait a while; if the chosen vehicle got busy, take the next best one."""
        w = self.w
        if w.vehicles[vid]["status"] == "idle":
            return vid
        cands = w.dispatch_candidates(job, origin=origin, limit=1)
        if cands:
            w.add_log("Dispatch Agent", f"{vid} is no longer free, sending {cands[0]['vehicle']} instead.", "decision")
            return cands[0]["vehicle"]
        return None

    # ================= events =================
    def _target_of(self, v):
        job = self.w.jobs.get(v["job_id"]) if v["job_id"] else None
        if v["status"] == "to_pickup" and job:
            return job.get("transfer_from") or job["pickup"]
        if v["status"] == "to_dropoff" and job:
            return job["dropoff"]
        return loc(v["home"])

    def _traffic(self, vehicle_id, source):
        w = self.w
        with w.lock:
            moving = [v for v in w.vehicles.values() if v["status"] in MOVING and v["route_km"] - v["pos_km"] > 12]
            if not moving:
                w.add_log("Route Agent", "No vehicles on the road to simulate traffic for yet.", "info")
                return
            v = w.vehicles.get(vehicle_id) if vehicle_id in w.vehicles else random.choice(moving)
            ahead = min(v["pos_km"] + random.uniform(4, 9), v["route_km"] - 2)
            lat, lon = w._point_at(v, ahead)
            w.seq["zone"] += 1
            place = min(LOCATIONS.values(), key=lambda L: services.haversine(lat, lon, L[1], L[2]))[0]
            zone = {"id": f"Z{w.seq['zone']}", "lat": lat, "lon": lon, "radius_km": 5, "factor": 0.3,
                    "until": w.sim + 90, "label": f"Multi-vehicle accident near {place}"}
            w.zones.append(zone)
            affected = []
            for x in w.vehicles.values():
                if x["status"] not in MOVING or not x["route"]:
                    continue
                pts = [p for p, c in zip(x["route"], x["cum"]) if c >= x["pos_km"]]
                if any(services.haversine(p[0], p[1], lat, lon) < zone["radius_km"] for p in pts[::2]):
                    rem = x["route_km"] - x["pos_km"]
                    job = w.jobs.get(x["job_id"]) if x["job_id"] else None
                    affected.append({"vehicle": x["id"], "remaining_km": round(rem, 1),
                                     "job": job["id"] if job else None,
                                     "urgent": bool(job and job["priority"] == "urgent"),
                                     "delay_min_if_wait": 22, "extra_km_if_reroute": round(rem * 0.12, 1)})
        w.add_log("Route Agent", f"Traffic incident: {zone['label']} (speed -70% for 90 min). "
                  f"{len(affected)} vehicle(s) heading into it.", "alert")
        if not affected:
            return
        extra_km = sum(a["extra_km_if_reroute"] for a in affected)
        extra_cost = round(extra_km * 0.32 * PRICES["diesel_eur_l"], 2)
        options = [
            {"id": "reroute_all", "label": "Reroute all affected vehicles", "detail": f"+{extra_km:.0f} km, about EUR {extra_cost}"},
            {"id": "reroute_urgent", "label": "Reroute urgent jobs only", "detail": "others wait about 22 min"},
            {"id": "wait", "label": "Keep routes and wait", "detail": f"about {22 * len(affected)} vehicle-minutes of delay"},
        ]
        situation = {"incident": zone["label"], "affected": affected, "sim_time": clock_str(w.sim)}
        rule = {"id": "reroute_all", "why": f"A 22 min delay per vehicle risks time windows; detour costs only about EUR {extra_cost}."}

        def apply(choice):
            with w.lock:
                for a in affected:
                    if choice == "wait" or (choice == "reroute_urgent" and not a["urgent"]):
                        continue
                    x = w.vehicles[a["vehicle"]]
                    if x["status"] not in MOVING:
                        continue
                    x["avoid_zones"].add(zone["id"])
                    t = self._target_of(x)
                    w.request_route(x, t["lat"], t["lon"], x["status"], alternatives=True, pick=1)
            w.add_log("Route Agent", f"Applied '{self._label(options, choice)}' for {len(affected)} vehicle(s).", "decision")

        self._decide("traffic", f"Traffic incident near {place}", situation, "Route Agent", options, rule,
                     [("Fuel & Cost Agent", f"Detour adds {extra_km:.0f} km (about EUR {extra_cost} fuel); a late delivery costs EUR {PRICES['late_penalty_eur']}.")],
                     lambda c: "low", apply)

    def _weather(self, vehicle_id, source):
        w = self.w
        real = services.get_weather()
        with w.lock:
            w.weather = real
            w.storm = {"factor": 0.65, "until": w.sim + 180,
                       "label": "Heavy snow and black ice warning (simulated escalation)"}
            at_risk = []
            for j in w.jobs.values():
                if j["status"] in ("assigned", "loading", "in_transit") and j["vehicle"]:
                    v = w.vehicles[j["vehicle"]]
                    rem = max(0, v["route_km"] - v["pos_km"]) + (j["est_km"] if j["status"] != "in_transit" else 0)
                    eta = w.sim + rem / (v["base_speed"] * 0.65) * 60 + 20
                    if eta > j["window_end"]:
                        at_risk.append({"job": j["id"], "vehicle": v["id"], "late_by_min": int(eta - j["window_end"])})
            long_haul = [j["id"] for j in w.jobs.values() if j["status"] == "pending" and j["est_km"] > 150]
            evs = [v["id"] for v in w.vehicles.values() if v["energy_type"] == "electric"]
        w.add_log("Route Agent", f"Live Riga weather: {real['text']}, {real['temp_c']}°C, wind {real['wind_kmh']} km/h "
                  f"({real['source']}). Storm escalation simulated: speeds -35% for 3 h. {len(at_risk)} job(s) at risk.", "alert")
        options = [
            {"id": "notify_extend", "label": "Notify customers and extend time windows", "detail": f"{len(at_risk)} jobs, +60 min each"},
            {"id": "hold_long_haul", "label": "Also hold long-haul jobs until the storm passes", "detail": f"{len(long_haul)} pending jobs over 150 km"},
            {"id": "continue", "label": "Continue as planned", "detail": "accept possible late penalties"},
        ]
        situation = {"weather_live": real, "storm": w.storm["label"], "jobs_at_risk": at_risk,
                     "pending_long_haul": long_haul, "electric_vehicles": evs}
        rule = {"id": "notify_extend" if at_risk else "continue",
                "why": f"{len(at_risk)} deliveries would miss their window; telling customers early avoids penalties."}

        def apply(choice):
            with w.lock:
                if choice in ("notify_extend", "hold_long_haul"):
                    for r in at_risk:
                        j = w.jobs[r["job"]]
                        j["window_end"] += 60
                        j["customer_notified"] = True
                if choice == "hold_long_haul":
                    for jid in long_haul:
                        w.jobs[jid]["hold"] = True
                        w.jobs[jid]["hold_until"] = w.storm["until"] if w.storm else w.sim
            w.add_log("Dispatch Agent", f"Applied '{self._label(options, choice)}'.", "decision")

        self._decide("weather", "Severe weather warning for Latvia", situation, "Route Agent", options, rule,
                     [("Maintenance Agent", f"Cold weather: check tyres and brakes on trucks; {len(evs)} EVs lose about 20% range below 0°C."),
                      ("Fuel & Cost Agent", f"Slower speeds raise fuel use per hour; late penalty is EUR {PRICES['late_penalty_eur']} per job.")],
                     lambda c: "high" if c == "hold_long_haul" else "low", apply)

    def _breakdown(self, vehicle_id, source):
        w = self.w
        with w.lock:
            if vehicle_id in w.vehicles:
                v = w.vehicles[vehicle_id]
            else:
                cands = [x for x in w.vehicles.values() if x["status"] in MOVING and x["job_id"]]
                if not cands:
                    w.add_log("Maintenance Agent", "No loaded vehicles on the road to break down yet.")
                    return
                v = random.choice(cands)
            if v["status"] == "broken":
                return
            fault, repair_min, cost = random.choice(FAULTS_EV if v["energy_type"] == "electric" else FAULTS_DIESEL)
            v["status"], v["fault"] = "broken", fault
            v["phase_until"] = w.sim + repair_min + 30
            v["route"], v["cum"] = [], []
            v["health"] = max(10, v["health"] - 30)
            total_cost = cost + PRICES["tow_eur"]
            w.kpi["repairs"] += total_cost
            job = w.jobs.get(v["job_id"]) if v["job_id"] else None
            if job:
                job["prev_status"] = job["status"]
                if job["status"] in ("in_transit", "loading"):
                    job["transfer_from"] = {"key": "BREAKDOWN", "name": f"breakdown site of {v['id']}",
                                            "lat": v["lat"], "lon": v["lon"]}
                job["status"], job["vehicle"], job["hold"] = "pending", None, True
                cands = w.dispatch_candidates(job, origin=job.get("transfer_from"), limit=3)
            else:
                cands = []
        src = "Telematics sensor" if source == "sensor" else "Dashboard"
        w.add_log("Maintenance Agent", f"{src}: {v['id']} ({v['label']}) broke down: {fault}. "
                  f"Estimated repair {repair_min} min + tow, about EUR {total_cost}.", "alert")
        if not job:
            return
        options = [{"id": f"assign:{c['vehicle']}", "label": f"Send {c['vehicle']} ({c['type']})",
                    "detail": f"{c['deadhead_km']} km away, ETA {c['eta'][-5:]}, {'on time' if c['on_time'] else 'LATE'}, "
                              f"EUR {c['energy_cost_eur']}"} for c in cands]
        options.append({"id": "wait_repair", "label": f"Wait for {v['id']} to be repaired",
                        "detail": f"about {repair_min + 30} min delay"})
        situation = {"broken_vehicle": v["id"], "fault": fault, "repair_min": repair_min, "repair_cost_eur": total_cost,
                     "job": {k: job[k] for k in ("id", "weight", "cargo", "priority")} | {
                         "window_end": clock_str(job["window_end"]), "cargo_on_board": bool(job.get("transfer_from"))},
                     "candidates": cands}
        if cands:
            best = cands[0]
            rule = {"id": f"assign:{best['vehicle']}",
                    "why": f"{best['vehicle']} is closest that fits {job['weight']:,} kg with enough driver hours and range."}
        else:
            rule = {"id": "wait_repair", "why": "No feasible replacement vehicle right now."}
        jid, broken_id = job["id"], v["id"]

        def apply(choice):
            with w.lock:
                j = w.jobs[jid]
                j["hold"] = False
                if choice.startswith("assign:"):
                    w.vehicles[broken_id]["job_id"] = None
                    vid = self._still_free(choice.split(":", 1)[1], j, origin=j.get("transfer_from"))
                    if not vid:
                        w.add_log("Dispatch Agent", f"No vehicle free any more for {jid}; it goes back to the queue.", "alert")
                        return
                    w.assign(vid, jid)
                else:
                    j["status"], j["vehicle"] = j.get("prev_status", "assigned"), broken_id
                    j.pop("transfer_from", None)
            w.add_log("Dispatch Agent", f"{jid}: {self._label(options, choice)}.", "decision")

        self._decide("breakdown", f"Breakdown of {v['id']} carrying {job['id']}", situation, "Dispatch Agent",
                     options, rule,
                     [("Maintenance Agent", f"Fault '{fault}': repair about {repair_min} min plus tow, EUR {total_cost}. Health now {v['health']}%."),
                      ("Fuel & Cost Agent", f"Late penalty EUR {PRICES['late_penalty_eur']} vs replacement fuel cost "
                       f"EUR {cands[0]['energy_cost_eur'] if cands else 'n/a'}.")],
                     lambda c: "high", apply, fallback=None)

    def _urgent(self, vehicle_id, source):
        w = self.w
        with w.lock:
            pickup = random.choice(["FREEPORT", "RIX_CARGO", "SALASPILS"])
            drop = random.choice(["VALMIERA", "JELGAVA", "OGRE", "SIGULDA", "TUKUMS", "BAUSKA", "CESIS"])
            job = w.new_job(urgent=True, pickup=pickup, dropoff=drop, weight=random.randint(800, 9000))
            job["cargo"] = random.choice(["medical supplies", "spare parts for a stopped factory line", "frozen food"])
            job["hold"] = True
            cands = w.dispatch_candidates(job, allow_bump=True, limit=3)
        w.add_log("Orchestrator", f"URGENT order {job['id']}: {job['weight']:,} kg {job['cargo']}, "
                  f"{job['pickup']['name']} -> {job['dropoff']['name']}, deadline {clock_str(job['window_end'])[-5:]}.", "alert")
        if not cands:
            with w.lock:
                job["hold"] = False
            w.add_log("Dispatch Agent", "No feasible vehicle right now; the order stays in the queue.", "alert")
            return
        options = [{"id": f"assign:{c['vehicle']}", "label": f"Send {c['vehicle']} ({c['type']})",
                    "detail": f"{c['deadhead_km']} km away, ETA {c['eta'][-5:]}, {'on time' if c['on_time'] else 'LATE'}"
                              + (f", bumps {c['bumps_job']}" if c['bumps_job'] else "")} for c in cands]
        situation = {"urgent_job": {k: job[k] for k in ("id", "weight", "cargo")} | {
            "from": job["pickup"]["name"], "to": job["dropoff"]["name"], "deadline": clock_str(job["window_end"])},
            "candidates": cands}
        best = cands[0]
        rule = {"id": f"assign:{best['vehicle']}", "why": f"{best['vehicle']} has the best score: "
                f"{best['deadhead_km']} km away, {'on time' if best['on_time'] else 'late'}."}
        by_id = {f"assign:{c['vehicle']}": c for c in cands}
        jid = job["id"]

        def risk(choice):
            c = by_id.get(choice)
            return "high" if (not c or c["bumps_job"] or not c["on_time"]) else "low"

        def apply(choice):
            c = by_id[choice]
            with w.lock:
                w.jobs[jid]["hold"] = False
                vid = c["vehicle"]
                if not c["bumps_job"]:
                    vid = self._still_free(vid, w.jobs[jid])
                    if not vid:
                        w.add_log("Dispatch Agent", f"No vehicle free any more for {jid}; it stays first in the queue.", "alert")
                        return
                    c = dict(c, vehicle=vid)
                w.assign(vid, jid, bump=c["bumps_job"])
            w.add_log("Dispatch Agent", f"{jid} assigned to {c['vehicle']}" +
                      (f"; {c['bumps_job']} returned to the queue." if c["bumps_job"] else "."), "decision")

        self._decide("urgent_order", f"Urgent order {jid}", situation, "Dispatch Agent", options, rule,
                     [("Route Agent", f"Best ETA {best['eta'][-5:]} vs deadline {clock_str(job['window_end'])[-5:]}."),
                      ("Fuel & Cost Agent", f"Trip energy cost about EUR {best['energy_cost_eur']}.")],
                     risk, apply)

    # ================= periodic background checks (rules, no LLM) =================
    def periodic(self, w, now):
        with w.lock:
            for j in w.jobs.values():
                if j.get("hold") and j.get("hold_until") and now >= j["hold_until"]:
                    j["hold"] = False
                    j.pop("hold_until", None)
            if now >= self.anomaly_at:
                self.anomaly_at = float("inf")
                trucks = [v for v in w.vehicles.values() if v["type"] == "truck_diesel"]
                random.choice(trucks)["use_mult"] = 1.45  # hidden fuel leak for the Fuel agent to find
            if now < self.next_scan:
                return
            self.next_scan = now + 90
            sent = 0
            for v in w.vehicles.values():
                if v["status"] != "idle" or sent >= 2:
                    continue
                due = v["service_km"] - v["km_since_service"]
                if due < 1500 or v["health"] < 45:
                    v["service_pending"] = True
                    d = loc(v["home"])
                    w.request_route(v, d["lat"], d["lon"], "to_depot")
                    sent += 1
                    w.kpi["auto_decisions"] += 1
                    w.add_log("Maintenance Agent", f"{v['id']} due for service ({max(0, due)} km left, health "
                              f"{v['health']}%). Sent to {d['name']} while idle.", "decision")
            for v in w.vehicles.values():
                if v["use_mult"] > 1.2 and not v.get("anomaly_flagged") and v["trip_km"] > 20:
                    v["anomaly_flagged"] = True
                    v["service_pending"] = True
                    w.add_log("Fuel & Cost Agent", f"Anomaly: {v['id']} uses {int((v['use_mult'] - 1) * 100)}% more "
                              f"fuel than other {v['label'].lower()}s. Possible leak or fuel theft; inspection "
                              f"booked after its current job.", "alert")

    # ================= chat =================
    def chat(self, message):
        w = self.w
        snap = w.snapshot(log_after=10**9)
        if llm.enabled():
            fleet = [f"{v['id']} {v['label']} {v['status']} job={v['job_id']} energy={v['energy_pct']}% "
                     f"health={v['health']} drive_today={v['drive_today_h']}h service_due={v['service_due_km']}km"
                     + (f" fault={v['fault']}" if v['fault'] else "") for v in snap["vehicles"]]
            jobs = [f"{j['id']} {j['status']} {j['priority']} {j['weight']}kg {j['pickup']['name']}->"
                    f"{j['dropoff']['name']} due {j['window_end_str']} vehicle={j['vehicle']}" for j in snap["jobs"]]
            recent = [f"[{e['t']}] {e['agent']}: {e['text']}" for e in list(w.log)[-20:]]
            prompt = ("You are the Orchestrator agent of FleetMind, a multi-agent fleet control system for a mixed "
                      "freight fleet in Latvia. Answer the fleet manager briefly (max 120 words), using the live data "
                      f"below. Time now: {snap['clock']}.\nKPIs: {json.dumps(snap['kpi'])}\nWeather: {json.dumps(snap['weather'])}\n"
                      f"Vehicles:\n" + "\n".join(fleet) + "\nOpen jobs:\n" + "\n".join(jobs) +
                      f"\nPending approvals: {[a['title'] for a in snap['approvals']]}\nRecent agent log:\n" +
                      "\n".join(recent) + f"\n\nManager asks: {message}")
            ans = llm.ask(prompt, role="orchestrator")
            if ans:
                return {"answer": ans, "model": model_label("orchestrator")}
        return {"answer": self._rule_chat(message, snap), "model": "rules engine"}

    def _rule_chat(self, msg, snap):
        m = msg.lower()
        k = snap["kpi"]
        vs = {v["id"].lower(): v for v in snap["vehicles"]}
        for vid, v in vs.items():
            if vid in m or vid.replace("lv-", "") in m.split():
                return (f"{v['id']} ({v['label']}, driver {v['driver']}): {v['status']}, job {v['job_id'] or '-'}, "
                        f"energy {v['energy_pct']}% (~{v['range_km']} km), health {v['health']}%, "
                        f"driven {v['drive_today_h']} h today, service in {v['service_due_km']} km"
                        + (f", fault: {v['fault']}" if v["fault"] else "") + ".")
        if any(x in m for x in ("cost", "fuel", "money", "spend", "co2")):
            return (f"Fuel EUR {k['fuel_cost']} ({k['diesel_l']} L diesel at EUR {snap['prices']['diesel_eur_l']}/L), "
                    f"electricity EUR {k['energy_cost']} ({k['kwh']} kWh), repairs EUR {k['repairs']}, penalties "
                    f"EUR {k['penalties']}. Cost per km EUR {k['cost_per_km']}, CO2 {k['co2_kg']} kg.")
        if any(x in m for x in ("late", "risk", "delay")):
            risky = [j for j in snap["jobs"] if j["priority"] == "urgent" or j.get("customer_notified")]
            return (f"On-time rate {k['on_time_pct']}% ({k['late']} late of {k['delivered']}). "
                    f"Jobs to watch: {', '.join(j['id'] for j in risky) or 'none'}.")
        if any(x in m for x in ("ev", "electric", "battery")):
            evs = [v for v in snap["vehicles"] if v["unit"] == "kWh"]
            return "EVs: " + "; ".join(f"{v['id']} {v['energy_pct']}% ({v['range_km']} km) {v['status']}" for v in evs)
        if any(x in m for x in ("broken", "maint", "service", "repair")):
            b = [v for v in snap["vehicles"] if v["status"] in ("broken", "service") or v["service_due_km"] < 2000]
            return "Maintenance: " + ("; ".join(f"{v['id']} {v['status']}, service in {v['service_due_km']} km"
                                                for v in b) or "all vehicles healthy.")
        c = snap["status_counts"]
        return (f"{snap['clock']}: {len(snap['vehicles'])} vehicles ({', '.join(f'{n} {s}' for s, n in c.items())}). "
                f"{k['delivered']} delivered, on-time {k['on_time_pct']}%, {len(snap['jobs'])} open jobs, "
                f"{len(snap['approvals'])} approvals waiting. Ask about a vehicle (e.g. LV-T03), costs, late jobs, EVs or maintenance.")
