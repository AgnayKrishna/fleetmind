"""Live fleet simulation of a mixed freight fleet in Latvia."""
import random
import threading
import time
from collections import deque
from concurrent.futures import ThreadPoolExecutor

from . import services
from .data import (CARGO, CHARGERS, CO2, DEPOTS, DRIVER_NAMES, FLEET_MIX, FUEL_STATIONS, HAZMAT_CARGO, LOCATIONS,
                   PRICES, SAMPLE_ENERGY_DATA, VEHICLE_DIMENSIONS, VEHICLE_TYPES, loc, random_pickup)

MOVING = ("to_pickup", "to_dropoff", "to_depot", "to_fuel")
TIMED = ("loading", "unloading", "break", "refuel", "service", "broken")
BREAK_AFTER_MIN = 270      # EU rule: 4.5 h driving, then a 45 min break
BREAK_MIN = 45
DAILY_DRIVE_MAX = 540      # 9 h per day
DAILY_REST_MIN = 660       # an 11 h rest gives the driver a fresh day of driving hours
RIGA = (56.95, 24.11)
LOW_ENERGY_PCT = 20        # dashboard offers "Refuel now" / "Charge now" below this; auto-refuel stays at 12%
NEAR_ROUTE_KM = 15         # a station this close to the remaining route counts as "on the way"
DIESEL_FILL_MIN = 20
EV_CHARGE_TO = 0.9


def clock_str(sim_min):
    day = int(sim_min // 1440) + 1
    m = int(sim_min % 1440)
    return f"Day {day} {m // 60:02d}:{m % 60:02d}"


class World:
    def __init__(self, seed=7, job_seq=100, appr_seq=0):
        self.rng = random.Random(seed)
        self.lock = threading.RLock()
        self.sim = 6 * 60.0          # starts 06:00
        self._last_day = int(self.sim // 1440)
        self.speed = 2.0             # sim minutes per real second
        self.paused = False
        self.vehicles, self.jobs, self.approvals = {}, {}, {}
        self.log = deque(maxlen=400)
        self.zones = []              # traffic incidents
        self.storm = None
        self.weather = {"text": "loading...", "source": "-", "temp_c": 2, "precip_mm": 0,
                        "snow_cm": 0, "wind_kmh": 10, "code": 3}
        self.weather_real_at = 0.0
        self.kpi = dict(delivered=0, late=0, km=0.0, diesel_l=0.0, kwh=0.0, fuel_cost=0.0,
                        energy_cost=0.0, co2_kg=0.0, penalties=0.0, repairs=0.0, fuel_savings=0.0,
                        auto_decisions=0, approvals_done=0, llm_decisions=0, revenue=0.0)
        self.history = []
        self.actions = {}            # AI actions that can be undone (AI activity screen)
        self.messages = deque(maxlen=300)   # dispatcher -> driver messages
        self.seq = {"job": max(100, job_seq), "log": 0, "appr": appr_seq, "zone": 0, "act": 0, "msg": 0}
        self.next_job_at = self.sim + 20
        self.next_history = self.sim
        self.periodic_hook = None    # set by agents: called with (world, sim) every tick
        self.event_hook = None       # set by agents: random breakdowns go through it
        self.router = ThreadPoolExecutor(max_workers=2)
        self._build_fleet()
        for _ in range(22):
            self.new_job()

    # ---------------- setup ----------------
    def _build_fleet(self):
        names = list(DRIVER_NAMES)
        self.rng.shuffle(names)
        n = 0
        prefix = {"truck_diesel": "T", "van_diesel": "V", "truck_ev": "ET", "van_ev": "EV"}
        for vtype, count in FLEET_MIX:
            spec = VEHICLE_TYPES[vtype]
            for i in range(count):
                n += 1
                depot = DEPOTS[n % len(DEPOTS)]
                d = loc(depot)
                vid = f"LV-{prefix[vtype]}{i + 1:02d}"
                self.vehicles[vid] = {
                    "id": vid, "type": vtype, "label": spec["label"], "energy_type": spec["energy"],
                    "driver": names[(n - 1) % len(names)], "home": depot,
                    "lat": d["lat"] + self.rng.uniform(-0.004, 0.004),
                    "lon": d["lon"] + self.rng.uniform(-0.004, 0.004),
                    "status": "idle", "job_id": None, "route": [], "cum": [], "route_km": 0.0,
                    "pos_km": 0.0, "base_speed": spec["speed"], "route_token": 0, "after_route": None,
                    "phase_until": 0.0, "resume": None, "capacity": spec["capacity"],
                    "tank": spec["tank"], "unit": spec["unit"],
                    "energy": spec["tank"] * self.rng.uniform(0.45, 1.0),
                    "odometer": self.rng.randint(20000, 420000),
                    "km_since_service": self.rng.randint(2000, int(spec["service_km"] * 0.97)),
                    "service_km": spec["service_km"], "health": self.rng.randint(55, 100),
                    "drive_since_break": self.rng.randint(0, 60), "drive_today": 0.0, "last_drive": self.sim,
                    "use_mult": 1.0, "avoid_zones": set(), "fault": None, "trip_km": 0.0,
                    "hazmat": False, "route_source": None, "traffic_delay_min": 0.0,
                } | VEHICLE_DIMENSIONS[vtype]

    # ---------------- logging ----------------
    def add_log(self, agent, text, kind="info", model=None, extra=None):
        with self.lock:
            self.seq["log"] += 1
            self.log.append({"id": self.seq["log"], "t": clock_str(self.sim), "agent": agent,
                             "kind": kind, "text": text, "model": model, "extra": extra})

    # ---------------- jobs ----------------
    def new_job(self, urgent=False, pickup=None, dropoff=None, weight=None):
        with self.lock:
            self.seq["job"] += 1
            jid = f"J{self.seq['job']}"
            p = pickup or random_pickup(self.rng)
            d = dropoff or self.rng.choice([k for k in LOCATIONS if k != p])
            if weight is None:
                weight = (self.rng.randint(300, 1400) if self.rng.random() < 0.35
                          else self.rng.randint(4000, 15500))
            P, D = loc(p), loc(d)
            km = services.haversine(P["lat"], P["lon"], D["lat"], D["lon"]) * 1.25
            est = km / 65 * 60 + 40
            slack = self.rng.randint(60, 120) if urgent else self.rng.randint(120, 300)
            self.jobs[jid] = {
                "id": jid, "pickup": P, "dropoff": D, "weight": weight, "cargo": self.rng.choice(CARGO),
                "priority": "urgent" if urgent else "normal", "status": "pending", "vehicle": None,
                "created": self.sim, "window_end": self.sim + est + slack, "est_km": km,
                "delivered_at": None, "late": False, "customer_notified": False,
                # what the customer pays (admin only: dispatchers never see customer prices)
                "price_eur": round((80 + km * 1.15 + weight / 1000 * 9) * (1.4 if urgent else 1.0)),
                "exclude": [],       # vehicles an undo took this job away from
            }
            self.jobs[jid]["hazmat"] = self.jobs[jid]["cargo"] in HAZMAT_CARGO
            return self.jobs[jid]

    def create_order(self, pickup, dropoff, weight, cargo=None, priority="normal", by=None):
        """A dispatcher or admin types in a new order. It goes into the queue like any other."""
        if pickup not in LOCATIONS or dropoff not in LOCATIONS or pickup == dropoff:
            return {"ok": False, "error": "pick two different known places"}
        if not 1 <= int(weight) <= 40000:
            return {"ok": False, "error": "weight must be 1 to 40000 kg"}
        with self.lock:
            job = self.new_job(urgent=priority == "urgent", pickup=pickup, dropoff=dropoff, weight=int(weight))
            if cargo:
                job["cargo"] = str(cargo)[:80]
                job["hazmat"] = job["cargo"] in HAZMAT_CARGO
            job["created_by"] = by
        self.add_log("Fleet manager", f"{by or 'Fleet manager'} created order {job['id']}: {job['weight']:,} kg "
                     f"{job['cargo']}, {job['pickup']['name']} -> {job['dropoff']['name']}.", "approval")
        return {"ok": True, "job": {k: job[k] for k in ("id", "status", "weight", "cargo", "priority")}}

    def assign_order(self, jid, vid=None, by=None):
        """Assign a pending order by hand. Only vehicles the rules engine finds feasible are accepted."""
        with self.lock:
            job = self.jobs.get(jid)
            if not job or job["status"] != "pending":
                return {"ok": False, "error": "order not found or not waiting for a vehicle"}
            cands = self.dispatch_candidates(job, limit=100)
            c = next((c for c in cands if c["vehicle"] == vid), None) if vid else (cands[0] if cands else None)
            if not c:
                return {"ok": False, "error": f"{vid or 'no vehicle'} can't take {jid} right now "
                                              "(busy, too small, not enough driver hours or range)"}
            job["hold"] = False
            self.assign(c["vehicle"], jid)
        self.add_log("Fleet manager", f"{by or 'Fleet manager'} assigned {jid} to {c['vehicle']} "
                     f"({c['deadhead_km']} km away, ETA {c['eta'][-5:]}).", "approval")
        return {"ok": True, "job": jid, "vehicle": c["vehicle"]}

    # ---------------- AI actions that can be undone ----------------
    def record_action(self, agent, text, vehicles, undo=None, job=None):
        """undo: function(world) -> text saying what happens instead, or None if it is too late.
        No undo = can't be reversed (e.g. a customer message already sent)."""
        with self.lock:
            self.seq["act"] += 1
            aid = f"X{self.seq['act']}"
            self.actions[aid] = {"id": aid, "agent": agent, "text": text, "t": clock_str(self.sim),
                                 "vehicles": list(vehicles), "job": job, "state": "done",
                                 "reversible": undo is not None, "undo": undo}
            if len(self.actions) > 300:
                self.actions.pop(next(iter(self.actions)))
            return aid

    def undo_action(self, aid, by=None):
        with self.lock:
            a = self.actions.get(aid)
            if not a:
                return {"ok": False, "error": "unknown action"}
            if a["state"] != "done" or not a["undo"]:
                return {"ok": False, "error": "already undone" if a["state"] == "undone" else "this one can't be undone"}
            instead = a["undo"](self)
            if instead is None:
                return {"ok": False, "error": "too late to undo: the vehicle has moved on"}
            a["state"], a["undone_by"], a["instead"], a["undone_at"] = "undone", by, instead, clock_str(self.sim)
        self.add_log("Fleet manager", f"{by or 'Fleet manager'} undid {aid} ({a['agent']}: {a['text']}). {instead}",
                     "approval")
        return {"ok": True, "id": aid, "instead": instead}

    def actions_view(self):
        with self.lock:
            return [{k: v for k, v in a.items() if k != "undo"} for a in reversed(self.actions.values())]

    def _undo_assignment(self, vid, jid):
        """Undo for an automatic assignment: only while the vehicle is still on its way to the pickup."""
        def undo(w):
            v, job = w.vehicles.get(vid), w.jobs.get(jid)
            if not v or not job or job["status"] != "assigned" or job["vehicle"] != vid or v["job_id"] != jid:
                return None
            if v.get("fuel_stop"):
                return None
            job["status"], job["vehicle"] = "pending", None
            job.setdefault("exclude", []).append(vid)
            v["job_id"], v["status"], v["after_route"] = None, "idle", None
            v["route"], v["cum"], v["route_km"], v["pos_km"] = [], [], 0.0, 0.0
            v["route_token"] += 1           # a route still being calculated is ignored
            return f"{jid} is back in the queue and won't be given to {vid} again; {vid} stops and waits."
        return undo

    # ---------------- dispatcher -> driver messages ----------------
    def send_message(self, vid, text, by=None):
        text = " ".join(str(text).split())[:500]
        if vid not in self.vehicles:
            return {"ok": False, "error": "unknown vehicle"}
        if not text:
            return {"ok": False, "error": "empty message"}
        with self.lock:
            self.seq["msg"] += 1
            m = {"id": self.seq["msg"], "vehicle": vid, "from": by or "Dispatcher", "text": text,
                 "t": clock_str(self.sim)}
            self.messages.append(m)
        self.add_log("Fleet manager", f"{by or 'Dispatcher'} messaged the driver of {vid}: \"{text}\"", "info")
        return {"ok": True, "message": m}

    # ---------------- geometry ----------------
    @staticmethod
    def _cum(coords):
        cum = [0.0]
        for a, b in zip(coords, coords[1:]):
            cum.append(cum[-1] + services.haversine(a[0], a[1], b[0], b[1]))
        return cum

    def set_route(self, v, route):
        coords = route["coords"] or [[v["lat"], v["lon"]]]
        v["route"], v["cum"] = coords, self._cum(coords)
        v["route_km"] = v["cum"][-1]
        v["pos_km"] = 0.0
        spec_speed = VEHICLE_TYPES[v["type"]]["speed"]
        if route["minutes"] > 0:
            v["base_speed"] = max(30, min(spec_speed, route["km"] / (route["minutes"] / 60) * 0.92))
        v["route_source"] = route["source"]
        v["traffic_delay_min"] = route.get("traffic_delay_min", 0.0)

    def _point_at(self, v, km):
        cum, rt = v["cum"], v["route"]
        if not rt:
            return v["lat"], v["lon"]
        if km >= cum[-1]:
            return rt[-1][0], rt[-1][1]
        lo, hi = 0, len(cum) - 1
        while lo < hi - 1:
            mid = (lo + hi) // 2
            if cum[mid] <= km:
                lo = mid
            else:
                hi = mid
        seg = cum[hi] - cum[lo] or 1e-9
        f = (km - cum[lo]) / seg
        return rt[lo][0] + (rt[hi][0] - rt[lo][0]) * f, rt[lo][1] + (rt[hi][1] - rt[lo][1]) * f

    def route_profile(self, v, next_status=None):
        """Truck routing profile: the vehicle's dimensions, its weight with the load on board, hazmat."""
        job = self.jobs.get(v["job_id"]) if v["job_id"] else None
        loaded = bool(job) and (next_status == "to_dropoff" or job["status"] in ("loading", "in_transit"))
        return services.vehicle_profile(v, cargo_kg=job["weight"] if loaded else 0,
                                        hazmat=bool(loaded and job.get("hazmat")))

    def request_route(self, v, lat, lon, next_status, alternatives=False, pick=0):
        """Ask the routing provider for a truck route in the background; vehicle waits in 'routing'."""
        v["route_token"] += 1
        token = v["route_token"]
        v["status"], v["after_route"] = "routing", next_status
        a, b = (v["lat"], v["lon"]), (lat, lon)
        profile = self.route_profile(v, next_status)

        def work():
            routes = services.get_routes(a, b, alternatives=alternatives, vehicle=profile)
            route = routes[min(pick, len(routes) - 1)]
            with self.lock:
                if v["route_token"] == token and v["status"] == "routing":
                    self.set_route(v, route)
                    v["status"] = next_status
        self.router.submit(work)

    # ---------------- dispatch helpers ----------------
    def range_km(self, v):
        return v["energy"] / (VEHICLE_TYPES[v["type"]]["use_per_km"] * v["use_mult"])

    def dispatch_candidates(self, job, allow_bump=False, origin=None, limit=5):
        """Feasible vehicles for a job, best first. Checks capacity, driver hours, range, health."""
        P = origin or job["pickup"]
        out = []
        excluded = set(job.get("exclude") or ())
        for v in self.vehicles.values():
            bump = None
            if v["id"] in excluded:
                continue
            if v["status"] == "idle":
                pass
            elif allow_bump and v["status"] in ("to_pickup", "routing") and v["job_id"] and not v.get("fuel_stop"):
                other = self.jobs.get(v["job_id"])
                if not other or other["status"] != "assigned" or other["priority"] == "urgent":
                    continue
                bump = other["id"]
            else:
                continue
            if v["capacity"] < job["weight"] or v["health"] < 25:
                continue
            dead_km = services.haversine(v["lat"], v["lon"], P["lat"], P["lon"]) * 1.25
            trip_km = dead_km + job["est_km"]
            trip_min = trip_km / 62 * 60 + 40
            if v["drive_today"] + trip_min > DAILY_DRIVE_MAX:
                continue
            rng_km = self.range_km(v)
            needs_charge = rng_km < trip_km * 1.15
            if needs_charge and v["energy_type"] == "electric":
                continue  # EVs must make the trip on current charge
            eta = self.sim + dead_km / 62 * 60 + 20 + job["est_km"] / 62 * 60 + 20
            use = VEHICLE_TYPES[v["type"]]["use_per_km"]
            price = PRICES["diesel_eur_l"] if v["energy_type"] == "diesel" else PRICES["electricity_eur_kwh"]
            cost = trip_km * use * price
            waste = (v["capacity"] - job["weight"]) / v["capacity"]  # prefer a right-sized vehicle
            score = dead_km + waste * 25 + (30 if needs_charge else 0) + (40 if bump else 0) \
                + (15 if eta > job["window_end"] else 0)
            out.append({"vehicle": v["id"], "type": v["label"], "driver": v["driver"],
                        "deadhead_km": round(dead_km, 1), "trip_km": round(trip_km, 1),
                        "energy_cost_eur": round(cost, 2), "eta": clock_str(eta),
                        "on_time": eta <= job["window_end"], "capacity_kg": v["capacity"],
                        "range_km": round(rng_km), "driver_hours_left": round((DAILY_DRIVE_MAX - v["drive_today"]) / 60, 1),
                        "health": v["health"], "bumps_job": bump, "score": round(score, 1)})
        out.sort(key=lambda c: c["score"])
        return out[:limit]

    def assign(self, vid, jid, bump=None):
        v, job = self.vehicles[vid], self.jobs[jid]
        if bump and bump in self.jobs:
            bj = self.jobs[bump]
            bj["status"], bj["vehicle"] = "pending", None
        if v["job_id"] and v["job_id"] != jid and v["job_id"] in self.jobs:
            oj = self.jobs[v["job_id"]]
            if oj["status"] == "assigned":
                oj["status"], oj["vehicle"] = "pending", None
        job["status"], job["vehicle"] = "assigned", vid
        v["job_id"] = jid
        if job.get("transfer_from"):
            target = job["transfer_from"]
        else:
            target = job["pickup"]
        self.request_route(v, target["lat"], target["lon"], "to_pickup")

    def target_of(self, v, st=None):
        """Where a vehicle is heading for status st (default: its current one). None = nowhere."""
        st = st or (v["after_route"] if v["status"] == "routing" else v["status"])
        if st == "to_fuel" and v.get("fuel_stop"):
            return v["fuel_stop"]["station"]
        job = self.jobs.get(v["job_id"]) if v["job_id"] else None
        if st == "to_pickup" and job:
            return job.get("transfer_from") or job["pickup"]
        if st == "to_dropoff" and job:
            return job["dropoff"]
        if st == "to_depot":
            return loc(v["home"])
        return None

    # ---------------- fuel and charging stops (Fuel & Cost Agent) ----------------
    def _route_ahead(self, v, target):
        """Sample points of the road still to drive, used to find stations on the way."""
        if v["status"] in MOVING and v["route"]:
            idx = next((i for i, c in enumerate(v["cum"]) if c >= v["pos_km"]), len(v["route"]) - 1)
            pts = v["route"][idx:]
            return pts[::max(1, len(pts) // 40)] + pts[-1:]
        if target:   # no road geometry yet: straight line to the target
            return [(v["lat"] + (target["lat"] - v["lat"]) * f / 8, v["lon"] + (target["lon"] - v["lon"]) * f / 8)
                    for f in range(9)]
        return [(v["lat"], v["lon"])]

    def energy_stop_options(self, v, limit=3):
        """Best stations for a refuel (diesel: cheapest total incl. detour) or charge (EV: nearest by
        detour plus charge time). Only stations the vehicle can still reach are offered."""
        diesel = v["energy_type"] == "diesel"
        use = VEHICLE_TYPES[v["type"]]["use_per_km"] * v["use_mult"]
        rng_km = self.range_km(v)
        pts = self._route_ahead(v, self.target_of(v))
        out = []
        for row in (FUEL_STATIONS if diesel else CHARGERS):
            sid, name, lat, lon = row[:4]
            to_km = services.haversine(v["lat"], v["lon"], lat, lon) * 1.25
            if to_km > rng_km * 0.95:
                continue
            off_km = min(services.haversine(p[0], p[1], lat, lon) for p in pts) * 1.25
            detour_km = round(2 * off_km, 1)
            st = {"id": sid, "name": name, "lat": lat, "lon": lon, "detour_km": detour_km,
                  "near_route": off_km <= NEAR_ROUTE_KM, "sample": SAMPLE_ENERGY_DATA}
            if diesel:
                price = row[4]
                litres = v["tank"] - max(0.0, v["energy"] - to_km * use)
                detour_eur = detour_km * use * price
                st |= {"price_eur_l": price, "litres": round(litres),
                       "cost_eur": round(litres * price + detour_eur, 2),
                       "saving_eur": round(litres * (PRICES["diesel_eur_l"] - price) - detour_eur, 2),
                       "minutes": DIESEL_FILL_MIN}
                st["score"] = st["cost_eur"]
            else:
                kw, price = row[4], row[5]
                kwh = max(0.0, v["tank"] * EV_CHARGE_TO - max(0.0, v["energy"] - to_km * use))
                charge_min = round(kwh / kw * 60 * 1.15) + 5      # charge curve tapers, plus plug-in time
                st |= {"kw": kw, "price_eur_kwh": price, "kwh": round(kwh), "minutes": charge_min,
                       "cost_eur": round(kwh * price, 2)}
                st["score"] = detour_km + charge_min    # minutes lost: detour at ~60 km/h plus charging
            out.append(st)
        near = [s for s in out if s["near_route"]]
        pool = near or out
        pool.sort(key=lambda s: (s["score"], s["detour_km"]))
        return pool[:limit]

    def _suggested_stop(self, v):
        """The station the "Refuel now" / "Charge now" button would add, or None."""
        if not self.can_add_energy_stop(v):
            return None
        opts = self.energy_stop_options(v, limit=1)
        return {k: opts[0][k] for k in opts[0] if k != "score"} if opts else None

    def _count_refuel_saving(self, v, info):
        """When a diesel vehicle fills up at the chosen station: fuel_cost so far counts every litre at the
        national average, so correct it to the station's price for the litres bought, and add the net
        saving (price difference minus the detour fuel, as the agent estimated) to the savings KPI.
        A station dearer than average gives a negative saving, so the figure stays honest."""
        price = info.get("price_eur_l")
        if price is None:
            return
        litres = max(0.0, v["tank"] - v["energy"])
        use = VEHICLE_TYPES[v["type"]]["use_per_km"] * v["use_mult"]
        price_saving = litres * (PRICES["diesel_eur_l"] - price)
        detour_eur = info.get("detour_km", 0) * use * price
        self.kpi["fuel_cost"] -= price_saving
        self.kpi["fuel_savings"] += price_saving - detour_eur

    def can_add_energy_stop(self, v):
        return (v["energy"] / v["tank"] * 100 < LOW_ENERGY_PCT and not v.get("fuel_stop")
                and (v["status"] in MOVING or v["status"] in ("idle", "routing")))

    def add_energy_stop(self, vid, station_id=None, by=None):
        """One tap from the dashboard: add the suggested (or a chosen) station as the next stop.
        Low risk under the company policy, so it is applied straight away; the vehicle resumes its
        trip after refuelling / charging."""
        with self.lock:
            v = self.vehicles.get(vid)
            if not v:
                return {"ok": False, "error": "unknown vehicle"}
            if v.get("fuel_stop"):
                return {"ok": False, "error": f"{vid} already has a fuel or charging stop"}
            if not self.can_add_energy_stop(v):
                return {"ok": False, "error": f"{vid} can't take a stop right now ({v['status']}, "
                                              f"{round(100 * v['energy'] / v['tank'])}% {v['unit']})"}
            opts = self.energy_stop_options(v)
            st = next((s for s in opts if s["id"] == station_id), None) if station_id else (opts[0] if opts else None)
            if not st:
                return {"ok": False, "error": "no reachable station" if not station_id else "station not offered"}
            resume = v["after_route"] if v["status"] == "routing" else v["status"]
            v["fuel_stop"] = {"station": {"key": st["id"], "name": st["name"], "lat": st["lat"], "lon": st["lon"]},
                              "resume": None if resume == "idle" else resume, "minutes": st["minutes"], "info": st}
            self.request_route(v, st["lat"], st["lon"], "to_fuel")
        if v["energy_type"] == "diesel":
            more = (f"saves about EUR {st['saving_eur']} vs the national average" if st["saving_eur"] >= 0
                    else f"EUR {-st['saving_eur']} above the national average but the only station on the way")
            text = (f"{vid}: refuel stop added at {st['name']} (EUR {st['price_eur_l']}/L, about {st['litres']} L, "
                    f"+{st['detour_km']} km detour; {more}).")
        else:
            text = (f"{vid}: charging stop added at {st['name']} ({st['kw']} kW, about {st['minutes']} min for "
                    f"{st['kwh']} kWh, +{st['detour_km']} km detour).")
        self.add_log("Fleet manager", f"{by or 'Fleet manager'} tapped "
                     f"'{'Refuel' if v['energy_type'] == 'diesel' else 'Charge'} now' for {vid}.", "approval")
        if st["sample"]:
            text += " [Sample data: station and price are made up.]"
        self.add_log("Fuel & Cost Agent", text + " Low risk, applied.", "decision")
        return {"ok": True, "vehicle": vid, "stop": {k: st[k] for k in st if k != "score"}}

    # ---------------- driver phone view ----------------
    DRIVER_ACTIONS = {"arrived": "Arrived", "loaded": "Loaded", "delivered": "Delivered", "break": "Start break"}
    BREAKABLE = ("to_pickup", "to_dropoff", "to_depot", "to_fuel", "idle")   # not while a route is being planned

    def _driver_allowed(self, v):
        st = v["status"]
        return {"arrived": st in MOVING, "loaded": st == "loading", "delivered": st == "unloading",
                "break": st in self.BREAKABLE}

    def driver_view(self, vid):
        """What the driver's phone shows: their vehicle, job, next stop and which buttons work now."""
        with self.lock:
            v = self.vehicles.get(vid)
            if not v:
                return None
            job = self.jobs.get(v["job_id"]) if v["job_id"] else None
            st = v["status"]
            nxt = self.target_of(v)
            if not nxt and job and st == "loading":
                nxt = job.get("transfer_from") or job["pickup"]
            elif not nxt and job and st == "unloading":
                nxt = job["dropoff"]
            what = {"to_pickup": "Pick up", "to_dropoff": "Deliver", "to_fuel": "Refuel / charge",
                    "to_depot": "Return to depot", "loading": "Loading at", "unloading": "Unloading at"}
            return {
                "vehicle": {"id": v["id"], "label": v["label"], "driver": v["driver"], "status": st,
                            "energy_pct": round(100 * v["energy"] / v["tank"]), "unit": v["unit"],
                            "range_km": round(self.range_km(v)), "health": v["health"], "fault": v["fault"],
                            "drive_today_h": round(v["drive_today"] / 60, 1),
                            "hours_left_h": round(max(0, DAILY_DRIVE_MAX - v["drive_today"]) / 60, 1),
                            "since_break_h": round(v["drive_since_break"] / 60, 1)},
                "job": None if not job else {
                    "id": job["id"], "cargo": job["cargo"], "weight": job["weight"], "priority": job["priority"],
                    "status": job["status"], "pickup": job["pickup"]["name"], "dropoff": job["dropoff"]["name"],
                    "deadline": clock_str(job["window_end"])[-5:], "hazmat": bool(job.get("hazmat"))},
                "next_stop": None if not nxt else {"action": what.get(st if st != "routing" else v["after_route"], "Go to"),
                                                   "name": nxt["name"], "lat": nxt["lat"], "lon": nxt["lon"]},
                "trip": self._trip_info(v),
                "allowed": self._driver_allowed(v),
                "messages": [m for m in self.messages if m["vehicle"] == vid][-10:],
                "clock": clock_str(self.sim),
            }

    def driver_action(self, vid, action, by="driver", proof=None):
        """Arrived / Loaded / Delivered / Start break from the driver's phone. Only valid in the matching
        state. proof (Delivered): {"receiver", "signed", "photos", "damaged", "note"}, kept on the order."""
        damage_note = None
        with self.lock:
            v = self.vehicles.get(vid)
            if not v or action not in self.DRIVER_ACTIONS:
                return {"ok": False, "error": "unknown vehicle or action"}
            if not self._driver_allowed(v)[action]:
                return {"ok": False, "error": f"'{self.DRIVER_ACTIONS[action]}' doesn't fit right now "
                                              f"({v['status'].replace('_', ' ')})."}
            if action == "break":
                v["resume"], v["status"] = (None if v["status"] == "idle" else v["status"]), "break"
                v["phase_until"] = self.sim + BREAK_MIN
                v["drive_since_break"] = 0
                text = f"{vid}: driver {v['driver']} started a {BREAK_MIN} min break."
            elif action == "arrived":
                target = self.target_of(v)
                if v["route"]:
                    v["pos_km"] = v["route_km"]
                    v["lat"], v["lon"] = v["route"][-1][0], v["route"][-1][1]
                elif target:
                    v["lat"], v["lon"] = target["lat"], target["lon"]
                where = target["name"] if target else "the stop"
                self._arrive(v)
                text = f"{vid}: driver {v['driver']} confirmed arrival at {where}."
            else:
                job_id = v["job_id"]
                if action == "delivered" and proof and job_id in self.jobs:
                    p = {"receiver": " ".join(str(proof.get("receiver") or "").split())[:80] or None,
                         "signed": bool(proof.get("signed")), "photos": max(0, min(20, int(proof.get("photos") or 0))),
                         "damaged": bool(proof.get("damaged")),
                         "note": " ".join(str(proof.get("note") or "").split())[:300] or None}
                    self.jobs[job_id]["proof"] = p
                    if p["damaged"]:
                        damage_note = p["note"] or "no details"
                self._finish_phase(v)       # loading -> in transit, unloading -> delivered
                text = (f"{vid}: driver {v['driver']} confirmed {'loading' if action == 'loaded' else 'delivery'}"
                        f"{f' of {job_id}' if job_id else ''}.")
                if action == "delivered" and job_id in self.jobs and self.jobs[job_id].get("proof", {}).get("receiver"):
                    text = text[:-1] + f", received by {self.jobs[job_id]['proof']['receiver']}."
            status = v["status"]
        self.add_log("Dispatch Agent", text + f" (from the driver app, {by})", "decision")
        if damage_note:
            self.add_log("Fleet manager", f"Driver of {vid} reported something damaged or missing on delivery: "
                         f"\"{damage_note}\"", "alert")
        return {"ok": True, "status": status}

    # ---------------- per-tick update ----------------
    def speed_factor(self, v):
        f = services.weather_speed_factor(self.weather)
        if self.storm and self.sim < self.storm["until"]:
            f = min(f, self.storm["factor"])
        hour = (self.sim % 1440) / 60
        near_riga = services.haversine(v["lat"], v["lon"], *RIGA) < 22
        if near_riga and (7.5 <= hour <= 9.5 or 16.5 <= hour <= 18.5):
            f *= 0.8  # rush hour in Riga
        for z in self.zones:
            if z["until"] > self.sim and z["id"] not in v["avoid_zones"]:
                if services.haversine(v["lat"], v["lon"], z["lat"], z["lon"]) < z["radius_km"]:
                    f = min(f, z["factor"])
        return f

    def tick(self, dt):
        with self.lock:
            self.sim += dt
            now = self.sim
            self._reset_driver_hours(now)
            for v in self.vehicles.values():
                st = v["status"]
                if st in TIMED and now >= v["phase_until"]:
                    self._finish_phase(v)
                elif st in MOVING:
                    self._move(v, dt)
            self.zones = [z for z in self.zones if z["until"] > now]
            if self.storm and now > self.storm["until"]:
                self.add_log("Route Agent", "Storm conditions cleared, normal speeds resumed.")
                self.storm = None
            if now >= self.next_job_at or sum(j["status"] == "pending" for j in self.jobs.values()) < 3:
                j = self.new_job()
                self.next_job_at = now + self.rng.randint(25, 50)
                self.add_log("Orchestrator", f"New freight order {j['id']}: {j['weight']:,} kg {j['cargo']} "
                             f"{j['pickup']['name']} -> {j['dropoff']['name']}")
            self._routine_dispatch()
            if now >= self.next_history:
                self.next_history = now + 30
                k = self.kpi
                self.history.append({"t": clock_str(now)[-5:], "cost": round(k["fuel_cost"] + k["energy_cost"], 2),
                                     "delivered": k["delivered"], "late": k["late"]})
                self.history = self.history[-60:]
        if self.periodic_hook:
            self.periodic_hook(self, now)

    def _reset_driver_hours(self, now):
        """Drivers get fresh hours when a new sim day starts, or after an 11 h rest (no driving)."""
        day = int(now // 1440)
        new_day = day != self._last_day
        self._last_day = day
        for v in self.vehicles.values():
            rested = v["status"] not in MOVING and now - v.get("last_drive", now) >= DAILY_REST_MIN
            if new_day or (rested and (v["drive_today"] or v["drive_since_break"])):
                v["drive_today"] = 0.0
                v["drive_since_break"] = 0

    def _routine_dispatch(self):
        pending = sorted((j for j in self.jobs.values() if j["status"] == "pending" and not j.get("hold")),
                         key=lambda j: (j["priority"] != "urgent", j["window_end"]))
        done = 0
        for job in pending:
            if done >= 3:
                break
            cands = self.dispatch_candidates(job, limit=1)
            if cands:
                c = cands[0]
                self.assign(c["vehicle"], job["id"])
                self.kpi["auto_decisions"] += 1
                done += 1
                text = (f"Assigned {job['id']} ({job['weight']:,} kg) to {c['vehicle']} "
                        f"({c['type']}, {c['deadhead_km']} km away, ETA {c['eta'][-5:]}).")
                self.add_log("Dispatch Agent", text, "decision")
                self.record_action("Dispatch Agent", text, [c["vehicle"]],
                                   undo=self._undo_assignment(c["vehicle"], job["id"]), job=job["id"])

    def _move(self, v, dt):
        spec = VEHICLE_TYPES[v["type"]]
        speed = v["base_speed"] * self.speed_factor(v)
        km = min(speed * dt / 60, v["route_km"] - v["pos_km"])
        v["pos_km"] += km
        v["lat"], v["lon"] = self._point_at(v, v["pos_km"])
        # energy and cost
        mult = v["use_mult"] * (1.2 if v["energy_type"] == "electric" and (self.weather.get("temp_c") or 5) < 0 else 1)
        used = km * spec["use_per_km"] * mult
        v["energy"] = max(0.0, v["energy"] - used)
        k = self.kpi
        k["km"] += km
        if v["energy_type"] == "diesel":
            k["diesel_l"] += used
            k["fuel_cost"] += used * PRICES["diesel_eur_l"]
            k["co2_kg"] += used * CO2["diesel_kg_l"]
        else:
            k["kwh"] += used
            k["energy_cost"] += used * PRICES["electricity_eur_kwh"]
            k["co2_kg"] += used * CO2["electric_kg_kwh"]
        v["odometer"] += km
        v["km_since_service"] += km
        v["trip_km"] += km
        v["drive_since_break"] += dt
        v["drive_today"] += dt
        v["last_drive"] = self.sim
        if self.rng.random() < km * 0.004:
            v["health"] = max(0, v["health"] - 1)
        # arrival
        if v["pos_km"] >= v["route_km"] - 0.01:
            self._arrive(v)
            return
        # driver break (EU 561/2006)
        if v["drive_since_break"] >= BREAK_AFTER_MIN:
            v["resume"], v["status"] = v["status"], "break"
            v["phase_until"] = self.sim + BREAK_MIN
            v["drive_since_break"] = 0
            self.add_log("Dispatch Agent", f"{v['id']} driver {v['driver']} reached 4.5 h driving: "
                         f"mandatory 45 min break started.", "decision")
            return
        # low energy (not while already driving to a chosen station)
        if v["energy"] / v["tank"] < 0.12 and v["status"] != "to_fuel":
            v["resume"], v["status"] = v["status"], "refuel"
            mins = 20 if v["energy_type"] == "diesel" else 40
            v["phase_until"] = self.sim + mins
            what = "refuel stop" if v["energy_type"] == "diesel" else "fast-charge stop"
            self.kpi["auto_decisions"] += 1
            self.add_log("Fuel & Cost Agent", f"{v['id']} below 12% {v['unit']}: scheduled {mins} min {what}.",
                         "decision")
            return
        # rare random breakdown, more likely on poor-health vehicles
        if self.event_hook and self.rng.random() < km * 0.00002 * (1 + (100 - v["health"]) / 25):
            self.event_hook("breakdown", v["id"], source="sensor")

    def _arrive(self, v):
        job = self.jobs.get(v["job_id"]) if v["job_id"] else None
        st = v["status"]
        if st == "to_pickup" and job:
            v["status"], v["phase_until"] = "loading", self.sim + 20
            job["status"] = "loading"
        elif st == "to_dropoff" and job:
            v["status"], v["phase_until"] = "unloading", self.sim + 20
        elif st == "to_fuel" and v.get("fuel_stop"):
            v["status"], v["phase_until"] = "refuel", self.sim + v["fuel_stop"]["minutes"]
            v["resume"] = "fuel_stop"     # marker: _finish_phase routes back to the trip
        elif st == "to_depot":
            if v.get("service_pending"):
                v["status"], v["phase_until"] = "service", self.sim + 60
                v["service_pending"] = False
            else:
                v["status"] = "idle"
        else:
            v["status"] = "idle"
        v["route"], v["cum"] = [], []

    def _finish_phase(self, v):
        st = v["status"]
        job = self.jobs.get(v["job_id"]) if v["job_id"] else None
        if st == "loading" and job:
            job["status"] = "in_transit"
            job.pop("transfer_from", None)
            D = job["dropoff"]
            self.request_route(v, D["lat"], D["lon"], "to_dropoff")
        elif st == "unloading" and job:
            job["status"], job["delivered_at"] = "delivered", self.sim
            self.kpi["delivered"] += 1
            self.kpi["revenue"] += job.get("price_eur", 0)
            if self.sim > job["window_end"]:
                job["late"] = True
                self.kpi["late"] += 1
                self.kpi["penalties"] += PRICES["late_penalty_eur"]
                self.add_log("Dispatch Agent", f"{job['id']} delivered LATE by {v['id']} "
                             f"({int(self.sim - job['window_end'])} min over).", "alert")
            else:
                self.add_log("Dispatch Agent", f"{job['id']} delivered on time by {v['id']} at {job['dropoff']['name']}.")
            v["job_id"], v["status"] = None, "idle"
        elif st == "refuel" and v["resume"] == "fuel_stop":
            stop = v.pop("fuel_stop", None) or {}
            if v["energy_type"] == "diesel":
                self._count_refuel_saving(v, stop.get("info") or {})
            v["energy"] = v["tank"] * (1.0 if v["energy_type"] == "diesel" else EV_CHARGE_TO)
            v["resume"] = None
            name = stop.get("station", {}).get("name", "the station")
            self.add_log("Fuel & Cost Agent", f"{v['id']} {'refuelled' if v['energy_type'] == 'diesel' else 'charged'} "
                         f"at {name}, back on its way." + (" [Sample data]" if stop.get("info", {}).get("sample") else ""))
            resume = stop.get("resume")
            target = self.target_of(v, resume) if resume else None
            if target:
                self.request_route(v, target["lat"], target["lon"], resume)
            else:
                v["status"] = "idle"
        elif st in ("break", "refuel"):
            if st == "refuel":
                v["energy"] = v["tank"] * (1.0 if v["energy_type"] == "diesel" else EV_CHARGE_TO)
            v["status"] = v["resume"] or "idle"
            v["resume"] = None
        elif st == "service":
            v["status"], v["km_since_service"], v["health"] = "idle", 0, 100
            v["use_mult"], v["fault"] = 1.0, None
            self.add_log("Maintenance Agent", f"{v['id']} service complete, health 100%.")
        elif st == "broken":
            v["health"], v["fault"] = max(v["health"], 80), None
            v.pop("fuel_stop", None)      # a planned fuel stop is dropped; the button comes back if still low
            v["resume"] = None
            self.add_log("Maintenance Agent", f"{v['id']} repaired and back in service.")
            if job and job["vehicle"] == v["id"]:
                t = job["pickup"] if job["status"] == "assigned" else job["dropoff"]
                if job["status"] != "assigned":
                    job["status"] = "in_transit"
                self.request_route(v, t["lat"], t["lon"], "to_pickup" if job["status"] == "assigned" else "to_dropoff")
            else:
                v["job_id"], v["status"] = None, "idle"
        else:
            v["status"] = "idle"

    # ---------------- trip summary for the vehicle popup ----------------
    def _trip_info(self, v):
        """Where the vehicle is heading, how far is left and whether its job will make the deadline.
        ETA uses the current speed (weather, traffic) plus 20 min loading / unloading, like dispatch does."""
        st, job = v["status"], (self.jobs.get(v["job_id"]) if v["job_id"] else None)
        spd = max(25.0, v["base_speed"] * self.speed_factor(v))
        t = self.sim + (max(0.0, v["phase_until"] - self.sim) if st in TIMED else 0.0)
        leg = (v["route_km"] - v["pos_km"]) if v["route"] else None   # km left on the current route

        def km_to(p):
            return leg if leg is not None else services.haversine(v["lat"], v["lon"], p["lat"], p["lon"]) * 1.25

        if not job:
            if st == "to_depot" or v.get("after_route") == "to_depot":
                home = loc(v["home"])
                km = km_to(home)
                return {"destination": home["name"], "remaining_km": round(km), "eta": clock_str(t + km / spd * 60)[-5:]}
            return None
        if job["status"] == "assigned":           # still driving to the pickup (or a breakdown hand-over)
            target = job.get("transfer_from") or job["pickup"]
            first = km_to(target)
            remaining = first + job["est_km"]
            eta = t + first / spd * 60 + 20 + job["est_km"] / spd * 60 + 20
        else:                                     # loading, in transit or unloading at the drop-off
            target = job["dropoff"]
            if st == "loading":
                remaining = job["est_km"]
            elif st == "unloading":
                remaining = 0.0
            else:
                remaining = km_to(target)
            eta = t + remaining / spd * 60 + (0 if st == "unloading" else 20)
        return {"destination": target["name"], "remaining_km": round(remaining),
                "eta": clock_str(eta)[-5:], "deadline": clock_str(job["window_end"])[-5:],
                "on_time": eta <= job["window_end"], "late_min": max(0, round(eta - job["window_end"])),
                "cargo": job["cargo"], "weight": job["weight"], "priority": job["priority"],
                "pickup": job["pickup"]["name"], "dropoff": job["dropoff"]["name"],
                "customer_notified": job["customer_notified"]}

    # ---------------- snapshot for the dashboard ----------------
    def snapshot(self, log_after=0):
        with self.lock:
            vs = []
            for v in self.vehicles.values():
                remaining = []
                if v["status"] in MOVING and v["route"]:
                    idx = next((i for i, c in enumerate(v["cum"]) if c >= v["pos_km"]), len(v["route"]) - 1)
                    pts = v["route"][idx:]
                    step = max(1, len(pts) // 80)
                    remaining = [[round(p[0], 5), round(p[1], 5)] for p in pts[::step]] + ([pts[-1]] if pts else [])
                vs.append({k: v[k] for k in ("id", "type", "label", "driver", "status", "job_id", "health",
                                             "capacity", "unit", "fault")} | {
                    "lat": round(v["lat"], 5), "lon": round(v["lon"], 5),
                    "energy_pct": round(100 * v["energy"] / v["tank"]),
                    "range_km": round(self.range_km(v)),
                    "service_due_km": round(v["service_km"] - v["km_since_service"]),
                    "drive_today_h": round(v["drive_today"] / 60, 1),
                    "since_break_h": round(v["drive_since_break"] / 60, 1),
                    "odometer": round(v["odometer"]), "route": remaining, "trip": self._trip_info(v),
                    "energy_stop": self._suggested_stop(v),
                    "fuel_stop": v["fuel_stop"]["station"]["name"] if v.get("fuel_stop") else None,
                    "fuel_stop_sample": bool(v.get("fuel_stop") and v["fuel_stop"]["info"].get("sample")),
                    "route_source": v["route_source"] if remaining else None,
                    "traffic_delay_min": v["traffic_delay_min"] if remaining else 0,
                    "dims": {k2: v[k2] for k2 in ("height_m", "width_m", "length_m", "weight_kg", "axles")},
                    "speed_factor": round(self.speed_factor(v), 2) if v["status"] in MOVING else None})
            k = dict(self.kpi)
            k["on_time_pct"] = round(100 * (k["delivered"] - k["late"]) / k["delivered"]) if k["delivered"] else 100
            k["total_cost"] = round(k["fuel_cost"] + k["energy_cost"] + k["penalties"] + k["repairs"], 2)
            k["cost_per_km"] = round((k["fuel_cost"] + k["energy_cost"]) / k["km"], 3) if k["km"] > 1 else 0
            k["revenue"] = round(k["revenue"], 2)
            k["profit"] = round(k["revenue"] - k["total_cost"], 2)
            for key in ("km", "diesel_l", "kwh", "fuel_cost", "energy_cost", "co2_kg", "fuel_savings"):
                k[key] = round(k[key], 1)
            status_counts = {}
            for v in self.vehicles.values():
                status_counts[v["status"]] = status_counts.get(v["status"], 0) + 1
            return {
                "clock": clock_str(self.sim), "sim": self.sim, "speed": self.speed, "paused": self.paused,
                "vehicles": vs,
                "jobs": [j | {"window_end_str": clock_str(j["window_end"])[-5:]}
                         for j in self.jobs.values() if j["status"] != "delivered"],
                "kpi": k, "status_counts": status_counts,
                "weather": self.weather, "storm": self.storm,
                "zones": [{k2: z[k2] for k2 in ("id", "lat", "lon", "radius_km", "label")} for z in self.zones],
                "approvals": [a for a in self.approvals.values() if a["state"] == "pending"],
                "log": [e for e in self.log if e["id"] > log_after][-120:],
                "history": self.history, "prices": PRICES, "routing": dict(services.stats),
                "map": services.routing_info(),
            }

    # ---------------- background loop ----------------
    def run_forever(self):
        last = time.time()
        while True:
            time.sleep(0.5)
            now = time.time()
            real_dt, last = now - last, now
            if now - self.weather_real_at > 900:
                self.weather_real_at = now
                threading.Thread(target=self._refresh_weather, daemon=True).start()
            if not self.paused:
                self.tick(min(real_dt, 2.0) * self.speed)

    def _refresh_weather(self):
        w = services.get_weather()
        with self.lock:
            self.weather = w
