@echo off
REM Runs FleetMind on THIS PC with Claude, and gives you a public https link
REM you can open on any other computer (e.g. the university PC).
REM Keep this PC switched on and awake during the demo.
cd /d "%~dp0"

where cloudflared >nul 2>nul
if errorlevel 1 (
  echo Installing Cloudflare Tunnel (one time)...
  winget install --id Cloudflare.cloudflared -e --accept-source-agreements --accept-package-agreements
  echo.
  echo If "cloudflared" is still not found, close this window and run share.bat again.
)

if not exist .venv ( python -m venv .venv )
call .venv\Scripts\activate
pip install -q -r requirements.txt

set AGENT_MODE=auto
set ANTHROPIC_API_KEY=
if "%DEMO_KEY%"=="" set /p DEMO_KEY=Choose a demo password (needed to press buttons / chat): 

start "FleetMind server" cmd /k "call .venv\Scripts\activate && set DEMO_KEY=%DEMO_KEY% && set AGENT_MODE=auto && set ANTHROPIC_API_KEY= && uvicorn backend.app:app --port 8000"
timeout /t 6 >nul

echo.
echo ============================================================
echo  Wait for a line like:  https://something.trycloudflare.com
echo  Open that link on the university PC and add  ?key=%DEMO_KEY%
echo  e.g.  https://something.trycloudflare.com/?key=%DEMO_KEY%
echo  Keep BOTH windows open during the demo.
echo ============================================================
echo.
cloudflared tunnel --url http://localhost:8000
