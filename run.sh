#!/usr/bin/env bash
# FleetMind local run (Mac/Linux). Agents use your Claude subscription through Claude Code.
cd "$(dirname "$0")"
[ -d .venv ] || python3 -m venv .venv
source .venv/bin/activate
pip install -q -r requirements.txt
export AGENT_MODE=auto
unset ANTHROPIC_API_KEY
echo "FleetMind is starting... open http://localhost:8000"
uvicorn backend.app:app --port 8000
