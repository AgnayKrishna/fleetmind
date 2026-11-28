"""Demo logins and roles.

Passwords are stored as salted PBKDF2-SHA256 hashes (standard library, no extra package).
A login returns a session token, sent back as an HttpOnly cookie (same-origin dashboard) and
in the JSON body so a dashboard on another origin (GitHub Pages -> backend) can send it as
"Authorization: Bearer <token>". Sessions live in memory, so a restart logs everyone out.

Roles (design/reference/roles.reference.html is the source of truth):
  superadmin       FleetMind staff. GTM outreach, sim controls, reads company settings and users for
                   support. Company data is read only: never approves, undoes, assigns or messages,
                   and doesn't see customer prices, revenue, profit or trip costs.
  logistics_admin  company admin: everything inside the company, approvals of any size, settings
                   (approval limit), users and their assigned trucks, prices, revenue and profit.
  employee         dispatcher: approves up to the company approval limit (bigger ones stay pending
                   for the admin), creates and assigns orders, messages drivers, undoes AI actions on
                   their own assigned trucks, sees trip costs and savings. Never sees customer prices,
                   revenue, profit, billing, settings or GTM.
  driver           only the phone view of their own vehicle (/api/driver/...)
  guest            public "View as guest": the company admin's view, read only, no write rule at all

Rules that depend on the data (approval limit, own trucks) are checked in the endpoint itself.
Every /api route must be listed in PERMISSIONS; anything not listed is refused (deny by default).
"""
import hashlib
import hmac
import re
import secrets
import threading
import time

ROLES = ("superadmin", "logistics_admin", "employee", "driver", "guest")
# guest: "View as guest" on the login page. Sees what a company admin sees, changes nothing
# (it is in no write rule below). Not a database user: the session is made on the fly.
OPEN = None                                   # no login needed
ANY = set(ROLES)
ADMIN = {"logistics_admin"}
OPS = {"superadmin", "logistics_admin"}          # admin + FleetMind support (read / platform things)
DISPATCH = {"logistics_admin", "employee"}       # people who run the company's day
STAFF = {"superadmin", "logistics_admin", "employee", "guest"}       # can look at the company dashboard
ADMIN_VIEW = {"logistics_admin", "guest"}        # see prices, revenue and profit
GUEST_USER = {"username": "guest", "name": "Guest (read only)", "role": "guest", "vehicle_id": None}
SUPER = {"superadmin"}
DRIVER = {"driver"}

# (method, path regex, roles). First match wins.
PERMISSIONS = [
    ("GET", r"/api/health", OPEN),
    ("GET", r"/api/auth/demo-accounts", OPEN),
    ("POST", r"/api/auth/login", OPEN),
    ("POST", r"/api/auth/logout", OPEN),
    ("POST", r"/api/auth/guest", OPEN),
    ("GET", r"/api/auth/me", ANY),
    ("POST", r"/api/gtm/open", OPEN),          # prospects from an outreach email have no login
    ("GET", r"/api/map/tile/[^/]+/\d+/\d+/\d+\.png", OPEN),   # map images can't send a bearer header
    ("GET", r"/api/state", STAFF),
    ("GET", r"/api/actions", STAFF),
    ("GET", r"/api/history/[^/]+", OPS | {"guest"}),
    ("GET", r"/api/gtm", SUPER),
    ("POST", r"/api/gtm/[^/]+/status", SUPER),
    ("GET", r"/api/settings", OPS | {"guest"}),   # superadmin: read only, for support
    ("POST", r"/api/settings", ADMIN),
    ("GET", r"/api/users", OPS),
    ("POST", r"/api/users/[^/]+/trucks", ADMIN),
    ("POST", r"/api/event", ADMIN),
    ("POST", r"/api/approvals/[^/]+", DISPATCH),          # employee: up to the approval limit
    ("POST", r"/api/actions/[^/]+/undo", DISPATCH),       # employee: own trucks only
    ("POST", r"/api/orders", DISPATCH),
    ("POST", r"/api/orders/[^/]+/assign", DISPATCH),
    ("POST", r"/api/vehicles/[^/]+/message", DISPATCH),
    ("POST", r"/api/vehicles/[^/]+/energy_stop", DISPATCH),   # employee: own trucks only
    ("POST", r"/api/chat", DISPATCH),          # answers include trip costs, which the superadmin doesn't get
    ("POST", r"/api/control", OPS),            # (guest is in no POST rule: read only)            # demo simulation speed, not a company decision
    ("GET", r"/api/driver/me", DRIVER),
    ("POST", r"/api/driver/action", DRIVER),
    ("POST", r"/api/driver/problem", DRIVER),
]

# What each role must not see in /api/state (stripped by the server, not only hidden in the UI).
PRICE_FIELDS = ("price_eur",)                         # customer price on each order
REVENUE_KPIS = ("revenue", "profit")
COST_KPIS = ("fuel_cost", "energy_cost", "repairs", "penalties", "total_cost", "cost_per_km", "fuel_savings")

DEFAULT_SETTINGS = {"approval_limit_eur": 300, "company_name": "Baltic Freight (demo)"}
EMPLOYEE_DEFAULT_TRUCKS = 12      # seed: the demo employee looks after 12 of the vehicles
_COMPILED = [(m, re.compile(p + r"/?"), roles) for m, p, roles in PERMISSIONS]

# Demo accounts, seeded into the database on first start and shown on the login page.
DEMO_USERS = [
    # public=False: the account works but is not listed on the public login page
    {"username": "super", "password": "fleetmind-super", "name": "Sam Superadmin", "role": "superadmin",
     "public": False},
    {"username": "admin", "password": "fleetmind-admin", "name": "Alex Logistics", "role": "logistics_admin"},
    {"username": "employee", "password": "fleetmind-employee", "name": "Eva Dispatcher", "role": "employee"},
    {"username": "driver", "password": "fleetmind-driver", "name": "Driver of LV-T01", "role": "driver",
     "vehicle_id": "LV-T01"},
    {"username": "driver2", "password": "fleetmind-driver", "name": "Driver of LV-V01", "role": "driver",
     "vehicle_id": "LV-V01"},
]

SESSION_TTL_S = 12 * 3600
COOKIE = "fm_session"
_ITER = 200_000


def hash_password(pw, salt=None):
    salt = salt or secrets.token_bytes(16)
    dk = hashlib.pbkdf2_hmac("sha256", pw.encode(), salt, _ITER)
    return f"pbkdf2_sha256${_ITER}${salt.hex()}${dk.hex()}"


def verify_password(pw, stored):
    try:
        algo, iters, salt, digest = stored.split("$")
        if algo != "pbkdf2_sha256":
            return False
        dk = hashlib.pbkdf2_hmac("sha256", pw.encode(), bytes.fromhex(salt), int(iters))
        return hmac.compare_digest(dk.hex(), digest)
    except (ValueError, AttributeError):
        return False


def rule_for(method, path):
    """(found, roles). found=False means the route is not in the table -> refuse."""
    for m, rx, roles in _COMPILED:
        if (m == method or (m == "GET" and method == "HEAD")) and rx.fullmatch(path):
            return True, roles
    return False, None


class Sessions:
    def __init__(self):
        self._s, self._lock = {}, threading.Lock()

    def create(self, user):
        token = secrets.token_urlsafe(32)
        with self._lock:
            now = time.time()
            self._s = {k: v for k, v in self._s.items() if v["expires"] > now}   # drop expired ones
            self._s[token] = {"username": user["username"], "name": user["name"], "role": user["role"],
                              "vehicle_id": user.get("vehicle_id"), "expires": now + SESSION_TTL_S}
        return token

    def get(self, token):
        if not token:
            return None
        with self._lock:
            s = self._s.get(token)
            if s and s["expires"] > time.time():
                return {k: v for k, v in s.items() if k != "expires"}
            self._s.pop(token, None)
        return None

    def drop(self, token):
        with self._lock:
            self._s.pop(token or "", None)


def token_from(request):
    h = request.headers.get("authorization", "")
    if h.lower().startswith("bearer "):
        return h[7:].strip()
    return request.cookies.get(COOKIE)
