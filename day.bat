@echo off
set "PATH=%LOCALAPPDATA%\Claude-Data\claude_pzs8sxrjxfjjc\claude-code\2.1.330\9424831ad51c;%USERPROFILE%\.local\bin;%APPDATA%\npm;%LOCALAPPDATA%\Programs\claude;%ProgramFiles%\nodejs;%PATH%"
REM FleetMind unattended Claude Code run (DAY mode). Started by Windows Task Scheduler.
cd /d "%~dp0"
if not exist nightly_logs mkdir nightly_logs
for /f %%i in ('powershell -NoProfile -Command "Get-Date -Format yyyy-MM-dd_HHmm"') do set STAMP=%%i
set ANTHROPIC_API_KEY=
claude -p "Run mode: DAY. Read NIGHTLY_RULES.md and follow it exactly, then do only the first 1 or 2 unchecked 'Daytime' tasks from NIGHTLY_TODO.md." --model opus --permission-mode acceptEdits --max-turns 60 --allowedTools "Read,Edit,Write,Glob,Grep,Bash(git status:*),Bash(git diff:*),Bash(git log:*),Bash(git branch:*),Bash(git checkout:*),Bash(git merge main:*),Bash(git add:*),Bash(git commit:*),Bash(git push origin nightly:*),Bash(python:*),Bash(.venv\Scripts\python:*),Bash(.venv/Scripts/python:*),Bash(.venv\Scripts\pip install:*),Bash(.venv/Scripts/pip install:*),Bash(node -v:*),Bash(npm -v:*),Bash(npm install:*),Bash(npm ci:*),Bash(npm run build:*),Bash(npm run test:*),Bash(npm run lint:*),Bash(npm create vite:*),Bash(npx shadcn:*),Bash(npx tsc:*)" > "nightly_logs\day_%STAMP%.txt" 2>&1
