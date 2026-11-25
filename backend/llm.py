"""Talks to Claude through the Claude Code CLI, so it runs on your Claude
subscription login instead of a paid API key.

AGENT_MODE env var:
  auto   (default) use Claude Code if the `claude` command exists, else rules
  claude force Claude Code
  rules  never call an LLM (use this on Railway)
"""
import glob
import json
import os
import re
import shutil
import subprocess
import tempfile
import threading

MODELS = {"orchestrator": os.getenv("ORCHESTRATOR_MODEL", "sonnet"),
          "specialist": os.getenv("SPECIALIST_MODEL", "haiku")}
TIMEOUT = int(os.getenv("CLAUDE_TIMEOUT", "120"))

_status = {"mode": "rules", "claude_path": None, "calls": 0, "errors": 0, "last_error": None}
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


def init():
    want = os.getenv("AGENT_MODE", "auto").lower()
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
    return dict(_status, models=MODELS)


def enabled():
    return _status["mode"] == "claude"


def ask(prompt: str, role: str = "specialist") -> str | None:
    """Send one prompt to Claude Code headless mode. Returns text or None on failure."""
    if not enabled():
        return None
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
