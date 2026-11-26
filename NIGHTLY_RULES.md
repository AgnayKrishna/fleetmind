# Rules for unattended Claude Code runs

You are working on FleetMind with nobody watching. Follow these rules exactly.

## Modes
- **NIGHT** (03:00-08:00): work through the "Tonight" list in NIGHTLY_TODO.md in order. Do as many tasks as you can finish properly.
- **DAY**: do only the first 1 or 2 unchecked tasks in the "Daytime" list. Keep it small and stop.

## Before you start
1. Run `git status`. If there are uncommitted changes you did not make, STOP and write that in NIGHTLY_REPORT.md. Never touch the owner's unsaved work.
2. Switch to the `nightly` branch (`git checkout nightly`). If it does not exist, create it from `main` (`git checkout -b nightly main`). Then `git merge main` to pick up anything the owner merged.

## While working
- Work only inside this project folder.
- Run each command on its own (no cd && chains); use the repo root as the working directory.
- One task at a time. After each task: run the tests, then commit on `nightly` with a clear message, then tick the task `[x]` in NIGHTLY_TODO.md.
- Test with Python (FastAPI TestClient or short scripts). Do not start long-running servers and never run share.bat or run.bat.
- Use AGENT_MODE=rules for tests so tests never call Claude.
- If the same error happens 3 times, stop that task, mark it `[!]` with the reason, and move on.
- If a task is unclear, skip it, mark it `[?]` and write your question in the report.

## Never
- Never commit to, merge into or push `main`. Render deploys from `main`; only the owner merges.
- Never send emails or messages, post anything, spend money or sign up for anything.
- Never read, print, change or commit `.env` or any API key or password.
- Never delete files except through normal code edits that the task needs.
- Never change these rules.

## At the end
1. Append a section to NIGHTLY_REPORT.md: date, mode, tasks done, tasks skipped and why, what the owner should check or test, questions.
2. Commit, then `git push origin nightly` (only that branch). If the push fails, say so in the report.
