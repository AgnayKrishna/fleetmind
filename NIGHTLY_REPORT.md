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

## 2026-11-26 · DAY (second run)

**Setup:** working tree was clean. Switched to `nightly` and merged `main` (it was already up to date).

**Done**
- [x] **"Refuel now" / "Charge now" button** on low-energy items in the Needs your attention bar.
  - New demo data in `backend/data.py`: 24 diesel stations (Circle K, Neste, Virsi, Viada) and 16 chargers along the main Latvian freight roads. **The locations are approximate and the prices are my estimates**, spread around the 2.08 EUR/L national average.
  - The Fuel & Cost Agent (Leo) logic is in `World.energy_stop_options` in `backend/sim.py`. It only offers stations within 15 km of the road the vehicle still has to drive, and only ones the vehicle can still reach on its current range. If no station is that close, it falls back to the nearest reachable ones.
    - **Diesel:** picks the cheapest total cost (litres to fill × station price + detour fuel). The button shows the price, e.g. `Refuel now · €1.99/L`. Hovering shows the station, detour, litres, cost and the saving against the national average.
    - **Electric:** picks the charger with the least total time lost (detour + charge time to 90%). The button shows the charge time, e.g. `Charge now · 38 min`.
  - One tap calls the new `POST /api/vehicles/{id}/energy_stop`. The station becomes the vehicle's next stop (new status `to_fuel`). After refuelling or charging, the vehicle goes back to its pickup, drop-off or depot, or stays idle if it had no trip. The policy treats this as low risk, so it applies straight away with no approval. The automatic 12 % refuel rule is unchanged; it just doesn't fire while a vehicle is already driving to a station it was sent to.
  - Cases handled:
    - A vehicle can't get a second stop while it already has one (the API returns 409).
    - A vehicle on its way to a station can't be bumped for an urgent job.
    - If it breaks down, the planned stop is dropped.
    - A traffic reroute keeps the station as the destination.
    - The button only appears when the vehicle is idle, planning a route or driving. During loading, unloading or a break the item keeps its **Show** button.
  - `agents._target_of` now uses the new shared `World.target_of`.
- Added `tests/test_energy_stop.py` (4 tests). It covers: the diesel truck gets the cheapest station, refuels and resumes its job; the EV gets a charger with a charge time, charges to 90 % and goes back to idle; no button when energy is fine; the endpoint works (200, then 409 for a second tap or an unknown vehicle). Routing is swapped for straight lines, so no test calls OSRM.

**Tests:** `AGENT_MODE=rules .venv/Scripts/python.exe -m pytest tests -q` → **7 passed**. `node --check docs/app.js` → OK.

**Skipped:** nothing. This was the only unchecked Daytime task.

**Owner should check**
- On the dashboard, wait for a vehicle to drop below 20 % (or speed up the sim). Check the button text and tooltip, tap it, and watch the vehicle drive to the station, stop (status "refuel/charge"), then carry on with its trip. Leo's line should appear in the agent log.
- The fuel savings are only logged. The fuel-cost KPI still uses the national average price. Tell me if you want the savings counted in the KPIs.

**Questions**
- For EVs the task said "nearest charger". I rank chargers by detour + charge time instead. Otherwise a 50 kW charger 1 km away beats a 150 kW one 3 km away, and an electric truck could wait for hours. Is that OK?
- Do you have real station locations or prices you want in place of my estimates?

## 2026-11-27 · NIGHT

**Setup:** working tree was clean, on `nightly`, `git merge main` → already up to date.

**Tests:** `AGENT_MODE=rules .venv/Scripts/python.exe -m pytest tests -q` → **40 passed** after the last task. Each task was tested before its commit. `node --check` passes for `docs/app.js`, `docs/auth.js` and `docs/driver.js`. No test calls Claude, TomTom, HERE or OSRM.

**Installed into `.venv`** (also added to `requirements.txt`): `sqlalchemy>=2.0` and `anthropic>=0.40`.

**Done**
- [x] **Fix: vehicles stop driving.**
  - `World._reset_driver_hours` (`backend/sim.py`) resets `drive_today` and `drive_since_break` when a new sim day starts, and after an 11 h rest (`DAILY_REST_MIN`, measured from the vehicle's `last_drive`).
  - New `tests/test_driver_hours.py`. It runs 2 full sim days at 4 sim-min per tick and checks there are ≥ 15 assignments in the last 6 sim hours. With the reset turned off, the same test gets only 4, so it does catch the bug.
  - Before the fix, assignments per day went 79 → 19 → 9 → 3. After it they stay at 61–106 per day.
- [x] **Database.**
  - New `backend/db.py` (SQLAlchemy + SQLite, file `backend/fleetmind.db`, gitignored, `DATABASE_URL` overrides it). Tables: orders, approvals, decisions (agent log lines of kind decision/llm/approval/alert/gtm), gtm_leads and users.
  - The sim is unchanged: a background thread copies changed rows every 2 s.
  - After a restart:
    - Order and approval numbers continue from the database.
    - Approvals still pending are marked `expired`, because their actions belonged to the old run.
    - GTM statuses, opens and drafts now live in the DB. On the first start they are seeded from `docs/leads.json`, `gtm_drafts.json` and `gtm_state.json`.
  - New read-only `/api/history/{orders,approvals,decisions}`.
  - `tests/test_db.py` covers the restart cases.
- [x] **Claude API mode.**
  - `AGENT_MODE=api` in `backend/llm.py` uses the official `anthropic` SDK. The key comes from `ANTHROPIC_API_KEY` in the environment.
  - Sonnet (`claude-sonnet-5-5`) handles the Orchestrator, chat and GTM. Haiku (`claude-haiku-5-5`) handles the specialists.
  - A failed call returns `None`, so the existing rules answer is used.
  - Each call logs its tokens and estimated cost. The totals are on the mode badge tooltip and in `/api/health` → `agents.usage` / `recent_calls`.
  - `claude` and `rules` modes are unchanged; a test checks that Claude Code mode still strips `ANTHROPIC_API_KEY`.
  - `tests/test_llm_api.py` uses a fake client.
- [x] **Powered by TomTom.**
  - `ROUTING_PROVIDER` picks the first provider: tomtom, here or osrm. The order is always TomTom → HERE → OSRM → straight line, and providers without a key are skipped. Each provider has its own circuit breaker.
  - **TomTom:** `travelMode=truck` with height, width, length, weight (empty + load on board), axles, axle weight, and `vehicleLoadType` for hazmat. `traffic=true`; `trafficDelayInSeconds` is shown.
  - **HERE v8:** `transportMode=truck` with the same dimensions and a flexible-polyline decoder. I checked the decoder against HERE's published sample string.
  - Every vehicle has dimensions per type in `VEHICLE_DIMENSIONS` (`backend/data.py`). Fertiliser loads are flagged as hazmat.
  - **Map:** with a TomTom key, the map uses TomTom tiles plus the live traffic flow layer, proxied through `/api/map/tile/...` so the key never reaches the browser. Without one, it uses OpenFreeMap.
  - The map attribution shows "Routing and traffic: TomTom", and the vehicle popup shows the routing source, the traffic delay and the dimensions.
  - Keys are read from `.env` by a small loader in `app.py`, which never overrides real env vars and is off in tests. I did not open `.env`.
  - `tests/test_routing.py` mocks every HTTP call.
- [x] **Logins and 4 roles.**
  - `backend/auth.py`: PBKDF2-SHA256 hashes (stdlib), in-memory 12 h sessions (HttpOnly cookie plus a bearer token for the GitHub Pages → backend case), and a deny-by-default `PERMISSIONS` table. A test fails if any `/api` route is missing from it.
  - Demo accounts are seeded into the DB and listed on the login page:
    - `super` / `fleetmind-super`
    - `admin` / `fleetmind-admin`
    - `employee` / `fleetmind-employee`
    - `driver` / `fleetmind-driver` (LV-T01)
    - `driver2` / `fleetmind-driver` (LV-V01)
  - Roles:
    - superadmin can do everything, including GTM.
    - logistics_admin can trigger events, approve, add refuel stops, use the sim controls, chat and read history.
    - employee gets a read-only dashboard plus chat. Their state has no GTM data or GTM log lines.
    - driver can only use `/api/driver/*`.
  - Drivers are sent to `docs/driver.html`, a phone layout with:
    - their vehicle, job and next stop (with an "Open in maps" link)
    - **Arrived / Loaded / Delivered**, each enabled only in the matching state and checked again by the server
    - **Report a problem**, which logs the driver's note and runs the normal breakdown pipeline (`source="driver"`)
  - Approvals record and log `decided_by` (name, username and role). The DB has a new `decided_by` column with a small migration.

**Skipped / failed**
- [!] **Frontend rebuild in Baltic Amber: not started.** Every `npm` command needed approval and was blocked in this unattended run, and React, Vite, Tailwind and shadcn/ui all need npm to install and build. The shadcn MCP server was also not available. I did not try to work around the permission block. All screens are still to do: control centre, lite mode, fleet table, AI activity with Undo, orders board, and empty/offline/error states. The login screen and driver view I added tonight are in the current vanilla dashboard, so the rebuild will need to carry them over. To let the next night do it, allow `npm`/`npx` (install, create vite, build) for the unattended run, or run `npm create vite` and the installs once yourself.
- I could not use the `claude-api` reference skill (it needed approval). I took the model IDs from this session's environment info.

**Not verified**
- No browser was available, so the dashboard changes (login overlay, role-based buttons, TomTom tiles, popup lines, driver page) are syntax-checked only. Nothing was clicked.
- TomTom and HERE were never called for real. The request parameters follow their documented truck APIs, but please test once with real keys.

**Owner should check**
1. `pip install -r requirements.txt`, then start the app and sign in with each demo account:
   - `employee`: no event buttons, approve buttons, speed controls or GTM tab.
   - `admin`: no GTM tab.
   - `super`: everything.
2. Sign in as `driver` on a phone (or with narrow DevTools). Wait for LV-T01 to get a job, then step through Arrived → Loaded → Arrived → Delivered. Then try Report a problem and check that a breakdown approval appears for the admin.
3. Approve something and check that the log says "Approved by Alex Logistics (admin, logistics_admin)".
4. Put `TOMTOM_API_KEY` in `.env`. Check that the map switches to TomTom tiles with traffic, that the attribution says TomTom, and that the popups say "TomTom truck routing + live traffic".
5. API mode: `AGENT_MODE=api` with a real `ANTHROPIC_API_KEY`, started with `uvicorn backend.app:app` (`run.bat` clears the key). The first start redrafts every rules-mode GTM draft with Sonnet, which is a one-off API cost.
6. Restart the app and check that `/api/history/orders` keeps the earlier orders and that new order numbers continue.

**Questions**
1. **The public demo now needs a login.** The demo passwords are on the login page, so anyone can sign in as `super`, including prospects who open the demo from an outreach email (`?ref=` still counts the open before sign-in). Do you want:
   - a "view as guest" read-only button,
   - `super` hidden from the public list, or
   - `DEMO_KEY` kept as an extra lock on writes? It still works on top of logins.
2. Is the role split right? GTM is superadmin-only, and employees are read-only plus chat.
3. Are the API prices right? The defaults are an estimate: Sonnet $3 / $15 and Haiku $1 / $5 per million tokens (in / out). Please set the `API_PRICE_*` env vars to the current list prices.
4. **Map tile proxy:** `/api/map/tile/...` is open, because map images can't send a login token. Anyone who finds it could use your TomTom tile quota. Is that acceptable, or should it be restricted (e.g. by checking the Referer)?
5. **SQLite on Railway/Render:** the file is lost on each redeploy unless you attach a disk or set `DATABASE_URL` to a hosted database. Which do you want?
6. **Hazmat:** only "fertiliser bags" count as hazmat, as an ADR class 5.1 stand-in. Should any other cargo count?

**Push:** see below.
