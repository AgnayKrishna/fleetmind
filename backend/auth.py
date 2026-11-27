"""Demo logins and roles.

Passwords are stored as salted PBKDF2-SHA256 hashes (standard library, no extra package).
A login returns a session token, sent back as an HttpOnly cookie (same-origin dashboard) and
in the JSON body so a dashboard on another origin (GitHub Pages -> backend) can send it as
"Authorization: Bearer <token>". Sessions live in memory, so a restart logs everyone out.

Roles:
  superadmin       everything, including the GTM outreach tab
  logistics_admin  fleet operations: events, approvals, refuel stops, sim controls, chat, history
  employee         read-only dashboard and chat with the agents
  driver           only the phone view of their own vehicle (/api/driver/...)

Every /api route must be listed in PERMISSIONS; anything not listed is refused (deny by default).
"""
import hashlib
import hmac
import re
import secrets
import threading
import time

ROLES = ("superadmin", "logistics_admin", "employee", "driver")
OPEN = None                                   # no login needed
ANY = set(ROLES)
OPS = {"superadmin", "logistics_admin"}
STAFF = {"superadmin", "logistics_admin", "employee"}
SUPER = {"superadmin"}
DRIVER = {"driver"}

# (method, path regex, roles). First match wins.
PERMISSIONS = [
    ("GET", r"/api/health", OPEN),
    ("GET", r"/api/auth/demo-accounts", OPEN),
    ("POST", r"/api/auth/login", OPEN),
    ("POST", r"/api/auth/logout", OPEN),
    ("GET", r"/api/auth/me", ANY),
    ("POST", r"/api/gtm/open", OPEN),          # prospects from an outreach email have no login
    ("GET", r"/api/map/tile/[^/]+/\d+/\d+/\d+\.png", OPEN),   # map images can't send a bearer header
    ("GET", r"/api/state", STAFF),
    ("GET", r"/api/history/[^/]+", OPS),
    ("GET", r"/api/gtm", SUPER),
    ("POST", r"/api/gtm/[^/]+/status", SUPER),
    ("POST", r"/api/event", OPS),
    ("POST", r"/api/approvals/[^/]+", OPS),
    ("POST", r"/api/vehicles/[^/]+/energy_stop", OPS),
    ("POST", r"/api/chat", STAFF),
    ("POST", r"/api/control", OPS),
    ("GET", r"/api/driver/me", DRIVER),
    ("POST", r"/api/driver/action", DRIVER),
    ("POST", r"/api/driver/problem", DRIVER),
]
_COMPILED = [(m, re.compile(p + r"/?"), roles) for m, p, roles in PERMISSIONS]

# Demo accounts, seeded into the database on first start and shown on the login page.
DEMO_USERS = [
    {"username": "super", "password": "fleetmind-super", "name": "Sam Superadmin", "role": "superadmin"},
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
