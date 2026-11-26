# Nightly reports

Newest at the bottom.

## 2026-11-26 · DAY

**Setup:** working tree was clean. The `nightly` branch did not exist, so I created it from `main`.

**Done**
- [x] **"Needs your attention" list.** A new 44 px strip under the header (`docs/index.html`, `docs/style.css`, `drawAttention` in `docs/app.js`). It is built in the browser from `/api/state` and needs no backend change. Each item has one button:
  - Pending approval → **Review** switches to Operations, scrolls to the approval card and makes it flash.
  - Late job (vehicle ETA after the deadline) → **Show** selects the vehicle on the map and opens its popup.
  - Broken vehicle → **Show** (left out when a pending approval already names that vehicle, so it isn't listed twice).
  - Low energy (below 20%, not already refuelling, broken or in service) → **Show**.
  - Overdue pending job (not picked up, past its deadline) → **Show** zooms to the pickup marker and opens its tooltip.
  - When nothing is listed it shows "All clear". The count badge matches the approvals one.
- [x] **Agent log filter polish.** Most of this was already in the code: the clicked tag stays highlighted (`.active`), the others fade, and an "All" tag comes first. The one change was renaming that tag to **"All agents"**.
- Added `tests/test_attention.py`. It checks that `/api/state` has every field the bar reads, that a breakdown event produces an approval or a broken vehicle, and that the page contains the bar.

**Not verified: tests and syntax check did not run.** In this run, every Python and Node command (`python`, `.venv\Scripts\python.exe`, `pytest`, `node --check`) needed approval and was blocked. I only read the changes; nothing was executed. Please run:
`set AGENT_MODE=rules && .venv\Scripts\python.exe -m pytest tests -q` (or `python tests\test_attention.py`) and `node --check docs\app.js`.

**Owner should check**
- Open the dashboard. Trigger a Breakdown and check that the bar shows an Approval item and that Review scrolls to the card and flashes it. Let a vehicle drop below 20% and check its Show button.
- At 1100 px and wider, the bar takes 44 px from the map/aside height (`main` height calc was updated).

**Questions**
- "Low energy" items only have a **Show** button because no API can send a vehicle to refuel early. Do you want a "Refuel now" action (new backend event)?
- **Push failed:** `git push -u origin nightly` needed approval and was blocked, so the `nightly` branch exists only on this machine. Please push it yourself.
- Should the scheduled DAY run be allowed to run `.venv\Scripts\python.exe` and `node` without approval? Otherwise the tests can never run unattended.
