@echo off
REM FleetMind local run (Windows). Agents use your Claude subscription through Claude Code.
cd /d "%~dp0"
if not exist .venv (
  python -m venv .venv
)
call .venv\Scripts\activate
pip install -q -r requirements.txt
set AGENT_MODE=auto
set ANTHROPIC_API_KEY=
echo.
echo  FleetMind is starting... open http://localhost:8000
echo.
start "" http://localhost:8000
uvicorn backend.app:app --port 8000
