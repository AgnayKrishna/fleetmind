@echo off
REM FleetMind unattended Claude Code run (NIGHT mode). Started by Windows Task Scheduler.
cd /d "%~dp0"
if not exist nightly_logs mkdir nightly_logs
for /f %%i in ('powershell -NoProfile -Command "Get-Date -Format yyyy-MM-dd_HHmm"') do set STAMP=%%i
set ANTHROPIC_API_KEY=
claude -p "Run mode: NIGHT. Read NIGHTLY_RULES.md and follow it exactly, then do the 'Tonight' tasks from NIGHTLY_TODO.md." --model opus --permission-mode acceptEdits --allowedTools "Read,Edit,Write,Glob,Grep,Bash(git status:*),Bash(git diff:*),Bash(git log:*),Bash(git branch:*),Bash(git checkout:*),Bash(git merge main:*),Bash(git add:*),Bash(git commit:*),Bash(git push origin nightly:*),Bash(python:*),Bash(.venv\Scripts\python:*),Bash(.venv/Scripts/python:*),Bash(.venv\Scripts\pip install:*),Bash(.venv/Scripts/pip install:*),Bash(node -v:*),Bash(npm -v:*),Bash(npm install:*),Bash(npm ci:*),Bash(npm run build:*),Bash(npm run test:*),Bash(npm run lint:*),Bash(npm create vite:*),Bash(npx shadcn:*),Bash(npx tsc:*)" > "nightly_logs\night_%STAMP%.txt" 2>&1
