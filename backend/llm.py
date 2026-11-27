"""Talks to Claude, either through the Claude Code CLI (your Claude subscription login)
or through the Claude API with the official anthropic SDK (a paid API key).

AGENT_MODE env var:
  auto   (default) use Claude Code if the `claude` command exists, else rules
  claude force Claude Code
  api    Claude API with ANTHROPIC_API_KEY from the environment (never committed).
         Sonnet for the Orchestrator and GTM, Haiku for the specialists. A failed call
         returns None, so the caller falls back to its rules answer. Tokens and an
         estimated cost are logged for every call.
  rules  never call an LLM (use this on Railway)

API settings: API_ORCHESTRATOR_MODEL (default claude-sonnet-5-5), API_SPECIALIST_MODEL
(default claude-haiku-5-5), API_MAX_TOKENS (1024), and prices in USD per million tokens
API_PRICE_<ROLE>_IN / _OUT (defaults below are estimates; check the current price list).
"""
import glob
import json
import logging
import os
import re
import shutil
import subprocess
import tempfile
import threading
from collections import deque

MODELS = {"orchestrator": os.getenv("ORCHESTRATOR_MODEL", "sonnet"),
          "specialist": os.getenv("SPECIALIST_MODEL", "haiku")}
API_MODELS = {"orchestrator": os.getenv("API_ORCHESTRATOR_MODEL", "claude-sonnet-5-5"),
              "specialist": os.getenv("API_SPECIALIST_MODEL", "claude-haiku-5-5")}
# USD per million tokens (input, output). Estimates: set the env vars to the current prices.
API_PRICES = {"orchestrator": (float(os.getenv("API_PRICE_ORCHESTRATOR_IN", "3")),
                               float(os.getenv("API_PRICE_ORCHESTRATOR_OUT", "15"))),
              "specialist": (float(os.getenv("API_PRICE_SPECIALIST_IN", "1")),
                             float(os.getenv("API_PRICE_SPECIALIST_OUT", "5")))}
API_MAX_TOKENS = int(os.getenv("API_MAX_TOKENS", "1024"))
TIMEOUT = int(os.getenv("CLAUDE_TIMEOUT", "120"))

log = logging.getLogger("fleetmind.llm")
_status = {"mode": "rules", "claude_path": None, "calls": 0, "errors": 0, "last_error": None,
           "usage": {"input_tokens": 0, "output_tokens": 0, "cost_usd": 0.0}}
_calls = deque(maxlen=50)      # last API calls: model, role, tokens, cost
_client = None                 # anthropic.Anthropic in api mode (tests swap in a fake)
_lock = threading.Lock()
_workdir = tempfile.mkdtemp(prefix="fleetmind_claude_")  # empty dir, so no project files get loaded


def _find_claude():
    """Locate the Claude Code CLI: CLAUDE_PATH env var, then PATH, then the copy
    bundled with the Claude desktop app on Windows (newest version wins)."""
    explicit = os.getenv("CLAUDE_PATH", "").strip()
    if explicit and os.path.isfile(explicit):
        return explicit
    path = shutil.which("claude")
    if path:
        return path
    local = os.getenv("LOCALAPPDATA")
    if local:
        found = glob.glob(os.path.join(local, "Claude-Data", "*", "claude-code", "*", "*", "claude.exe"))
        if found:
            return max(found, key=os.path.getmtime)
    return None


def _make_client():
    """Official SDK client. The key is read from ANTHROPIC_API_KEY by the SDK; it is never logged."""
    import anthropic
    return anthropic.Anthropic(timeout=TIMEOUT, max_retries=1)


def init():
    global _client
    want = os.getenv("AGENT_MODE", "auto").lower()
    _status["last_error"] = None
    if want == "api":
        _status["claude_path"] = None
        if not os.getenv("ANTHROPIC_API_KEY", "").strip():
            _status["mode"] = "rules"
            _status["last_error"] = "AGENT_MODE=api but ANTHROPIC_API_KEY is not set"
            return _status["mode"]
        try:
            _client = _make_client()
            _status["mode"] = "api"
        except Exception as e:  # noqa: BLE001 - e.g. the anthropic package is not installed
            _status["mode"] = "rules"
            _status["last_error"] = f"AGENT_MODE=api but the Claude API client failed: {e}"[:300]
        return _status["mode"]
    path = _find_claude()
    _status["claude_path"] = path
    if want == "rules" or (want == "auto" and not path):
        _status["mode"] = "rules"
    elif path:
        _status["mode"] = "claude"
    else:
        _status["mode"] = "rules"
        _status["last_error"] = "AGENT_MODE=claude but the `claude` command was not found"
    return _status["mode"]


def status():
    out = dict(_status, models=API_MODELS if _status["mode"] == "api" else MODELS)
    out["usage"] = dict(_status["usage"], cost_usd=round(_status["usage"]["cost_usd"], 4))
    out["recent_calls"] = list(_calls)[-10:] if _status["mode"] == "api" else []
    return out


def enabled():
    return _status["mode"] in ("claude", "api")


def model_label(role):
    """How the dashboard names the model behind a decision."""
    if _status["mode"] == "api":
        return f"{API_MODELS[role]} via Claude API"
    return f"Claude {MODELS[role].capitalize()} via Claude Code"


def estimate_cost(role, input_tokens, output_tokens):
    p_in, p_out = API_PRICES[role]
    return (input_tokens * p_in + output_tokens * p_out) / 1_000_000


def _ask_api(prompt, role):
    model = API_MODELS[role]
    try:
        msg = _client.messages.create(model=model, max_tokens=API_MAX_TOKENS,
                                      messages=[{"role": "user", "content": prompt}])
        text = "".join(getattr(b, "text", "") for b in msg.content if getattr(b, "type", "") == "text").strip()
        u = msg.usage
        tin, tout = int(getattr(u, "input_tokens", 0) or 0), int(getattr(u, "output_tokens", 0) or 0)
        cost = estimate_cost(role, tin, tout)
        rec = {"model": model, "role": role, "input_tokens": tin, "output_tokens": tout,
               "cost_usd": round(cost, 6), "stop_reason": getattr(msg, "stop_reason", None)}
        with _lock:
            _status["calls"] += 1
            _status["usage"]["input_tokens"] += tin
            _status["usage"]["output_tokens"] += tout
            _status["usage"]["cost_usd"] += cost
            _calls.append(rec)
        log.info("Claude API %s (%s): %d in / %d out tokens, about $%.5f", model, role, tin, tout, cost)
        return text or None
    except Exception as e:  # noqa: BLE001 - any failure -> caller uses its rules answer
        with _lock:
            _status["calls"] += 1
            _status["errors"] += 1
            _status["last_error"] = f"{type(e).__name__}: {e}"[:300]
        log.warning("Claude API call failed (%s), falling back to rules: %s", model, type(e).__name__)
        return None


def ask(prompt: str, role: str = "specialist") -> str | None:
    """Send one prompt to Claude (Code CLI or API). Returns text or None on failure."""
    if not enabled():
        return None
    if _status["mode"] == "api":
        return _ask_api(prompt, role)
    env = dict(os.environ)
    # Make sure the CLI uses the subscription login, never a billed API key.
    env.pop("ANTHROPIC_API_KEY", None)
    cmd = [_status["claude_path"], "-p", "--output-format", "json", "--model", MODELS[role]]
    try:
        res = subprocess.run(cmd, input=prompt, capture_output=True, text=True, encoding="utf-8",
                             timeout=TIMEOUT, cwd=_workdir, env=env)
        with _lock:
            _status["calls"] += 1
        out = res.stdout.strip()
        if res.returncode != 0:
            try:
                msg = json.loads(out).get("result")
            except Exception:  # noqa: BLE001
                msg = None
            raise RuntimeError((msg or res.stderr or out or "non-zero exit").strip()[:300])
        try:
            data = json.loads(out)
            if data.get("is_error"):
                raise RuntimeError(str(data.get("result"))[:300])
            return str(data.get("result", "")).strip()
        except json.JSONDecodeError:
            return out
    except Exception as e:  # noqa: BLE001
        with _lock:
            _status["errors"] += 1
            _status["last_error"] = str(e)[:300]
        return None


def ask_json(prompt: str, role: str = "specialist") -> dict | None:
    text = ask(prompt + "\n\nReply with ONLY a JSON object, no markdown, no extra text.", role)
    if not text:
        return None
    m = re.search(r"\{.*\}", text, re.S)
    if not m:
        return None
    try:
        return json.loads(m.group(0))
    except json.JSONDecodeError:
        return None
