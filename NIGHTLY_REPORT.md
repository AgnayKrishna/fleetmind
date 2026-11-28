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

**Push:** `git push origin nightly` succeeded (`a4acfcd..fd34506`, plus this line). `main` was not touched.

## 2026-11-27 · DAY

**Setup:** working tree was clean, on `nightly`, `git merge main` → already up to date.

**Tests:** `AGENT_MODE=rules .venv/Scripts/python.exe -m pytest tests -q` → **42 passed** (2 new tests). `node --check docs/app.js` → OK. Each task was tested before its commit.

**Done**
- [x] **Label sample fuel and charger data.**
  - New `SAMPLE_ENERGY_DATA = True` in `backend/data.py`. While it is True, every station suggestion has `"sample": true`, and each vehicle in `/api/state` has `fuel_stop_sample`. Set it to False once real data is connected and all the labels go away.
  - The dashboard now shows "Sample data":
    - as a small dashed tag on the Low energy item in Needs your attention
    - in the Refuel/Charge button tooltip
    - on a new "Fuel stop / Charging stop: <station>" line in the vehicle popup, shown while a stop is planned
  - The Fuel & Cost Agent log lines (stop added, refuelled/charged) end with "[Sample data]".
- [x] **Count refuel savings.**
  - When a diesel vehicle finishes a Refuel now stop, `fuel_cost` is corrected from the national average to the station's price for the litres actually bought. The net saving (price difference minus the detour fuel) goes into a new `kpi.fuel_savings`.
  - The fuel + charging KPI, cost per km and the cost chart now include it. A new KPI tile shows "€X saved at cheaper stations". The rules-mode chat answer about cost mentions it too.
  - A station dearer than average (when it's the only one on the way) counts as a negative saving, so the figure stays honest.

**Not done / limits**
- EV charging savings are not counted. Chargers are picked for speed, not price, and electricity cost still uses the €0.40/kWh average. Tell me if you want EV charging costs corrected to the charger's own price too.
- Auto-refuels at 12 % (without the button) still use the average price, because no station is chosen for them.
- No browser was available. The dashboard changes are syntax-checked only; nothing was clicked.

**Owner should check**
- Let a diesel vehicle drop below 20 %. Check the "Sample data" tag and tooltip, tap Refuel now, open the vehicle popup (it should show the stop with the tag), and once it has refuelled check that the "saved at cheaper stations" tile goes up.

**Questions**
- Is a dashed "Sample data" tag enough, or do you want it more visible (e.g. amber)?

## 2026-11-28 · NIGHT

**Setup:** working tree was clean, on `nightly`, `git merge main` → already up to date. Tasks 1-3 (roles, guest view, tile proxy) were already ticked by the earlier run, which hit the usage limit at 06:30 and left no report section. The unfinished frontend from that run (commit `25426e4`) was a good base, so I kept it and finished it.

**Tests:** `AGENT_MODE=rules .venv/Scripts/python.exe -m pytest tests -q` → **94 passed** (up from 77; 17 new). `npm --prefix frontend run build` passes; `lint` shows warnings only, no errors. I ran the tests and the build before every commit. No paid API was called.

**Done**
- [x] **Frontend rebuild in Baltic Amber.** One commit per screen, in the order asked:
  1. **Control centre.** Fixed the 3 type errors that stopped the build. The build now writes `docs/index.html` + `docs/assets/`. The old dashboard moved to `docs/classic.html`, and `driver.html`, `config.js`, `auth.js` and `vendor/` are untouched. The three tests that read the old markup at `/` now read `classic.html`. The new `tests/test_frontend.py` checks the built app.
  2. **Lite mode.** It switches on by itself when:
     - the screen is 1440 x 800 or smaller
     - the computer has 4 or fewer cores, or 4 GB or less memory
     - the map runs below 30 fps for 3 s
     - the system asks for reduced motion or transparency
     
     The "Lite mode" switch in the top bar overrides it and is remembered. The account menu has "let FleetMind decide" to undo the override. In lite mode: a flat 56 px bar with status pills, solid panels, the AI team as a 56 px rail, Needs you showing 2 items + "Show N more", a small centred sheet, and no trails or gliding.
  3. **Fleet table.** Status pills with counts, `/` to search, sortable columns, Export CSV, and only the visible rows are drawn, so 100+ vehicles stay fast. Each row has the latest AI note from the log, and clicking a row opens that vehicle on the map.
  4. **AI activity with real Undo.** Undo calls `POST /api/actions/{id}/undo`. Undone rows are crossed out and say what happens instead. Rows that can't be reversed have no Undo. Undo is only enabled where the backend allows it. A new end-to-end test undoes a real automatic assignment.
  5. **Orders board.** Five columns.
     - New cards show the suggested vehicle with an amber Assign button.
     - Problem cards have a red border and the proposed fix.
     - The amber "New order" button opens a form.
     
     The board needed one new read-only endpoint, `GET /api/orders/board` (staff roles). It returns the places list, the suggestions and today's delivered orders. Prices are removed for everyone but the company admin, and trip costs for the super admin. It is in the permission table and the role matrix tests.
  6. **Empty, offline and error states.**
     - Empty fleet: "Connect your first truck" with three ways to connect.
     - Offline: a dark banner with the time positions are from, and a greyed map. Changes you make wait in a queue ("N changes waiting to send") and send by themselves on reconnect. "Try to reconnect" retries now.
     - A service fails: a banner says what fell back, based on live data (straight-line routes, OSRM instead of TomTom/HERE, AI not answering, live weather down).
     - The first load fails: "Can't reach FleetMind" with "Try again".
- [x] **Role screens.**
  - **Dispatcher "My shift"** is now the employee's home screen. It shows their trucks (click one to see it on the map, or the speech bubble to message the driver), Needs you with their approval limit (bigger ones say they went to the admin), and driver messages.
  - **Super admin overview** is the super admin's home screen. It has a dark platform bar with the amber chip, six totals, a companies table with filters, integrations and Needs your attention. Real data is used for this company, its vehicles, AI decisions and undos, AI cost, and the health of routing, weather and Claude. Company settings and dispatchers are shown read only. Everything made up is tagged "Sample data": the other 5 companies, monthly revenue, uptime and the trial reminder.
  - **Driver Today + Delivery** is a new page at **`docs/driver-app.html`**.
    - Today: driving time left with a break warning, the current job in an amber outline with Navigate and the one button that fits the job state, later stops, messages from dispatch, Report a problem and Start break, and LV / RU / EN.
    - Delivery: photos, receiver name, a signature pad, "damaged or missing" with a note, and Delivered. Delivered needs a name and a signature.
    - It works offline: actions are saved on the phone and sent when there is signal.
    
    Backend changes for it:
    - a `break` driver action (45 min, only while driving or free)
    - a delivery proof on `delivered` (receiver, signed, photo count, damage note), kept on the order and shown on the orders board
    - damage raises an alert
    - new tests in `tests/test_driver_app.py`

**Not done / limits**
- **`docs/driver.html` is not replaced yet.** Drivers are still sent to the old page. The new one hasn't been opened on a phone, and drivers depend on it, so I didn't swap it blind. To swap after testing: delete `docs/driver.html` and `docs/driver.js`/`driver.css`, rename `frontend/driver-app.html` to `driver.html` (and its input in `vite.config.ts`), then rebuild. The `test_auth` check for the old driver markup will need updating at the same time.
- **Not shown because the backend has no data for them:**
  - AI activity: "Redo", "Ask me first next time", and the "options compared" and "safety checks" sections. The "Why" section shows the team's log lines from just before the decision.
  - Orders: "Send invoice" and customer names.
  - Delivery: the photos stay on the phone. Only the number of photos is sent, because there is no file storage yet.
- **Telegram is not connected.** "Driver messages" shows messages sent from the dashboard and problems reported on the driver page, and it says so.
- "Connect a truck" shows a "not built yet" note. Real tracker onboarding doesn't exist.
- The super admin's other nav sections (Companies, Users, Billing, AI usage, Integrations, Support) aren't separate screens. The overview covers them on one page.
- I made two process slips, both fixed straight away: one `cd frontend` that changed directory, and one build that overwrote `docs/index.html` before the old page was saved. I restored it from git as `classic.html`.

**Not verified**
- **No browser was available, so nothing was clicked.** The checks were the TypeScript build, lint, and tests that read the built files and call the API the screens use. Layout, motion, dark mode and the signature pad have not been seen on a screen.

**Owner should check**
1. Start the app and open `/`. Sign in as each demo account and check which screen opens first:
   - admin opens the map
   - employee opens My shift
   - super opens Overview
   - guest opens the map, read only
   
   Then check light/dark, and the Lite mode switch.
2. On the map: click a truck to open its sheet, Refuel/Charge from Needs you, approve something, ask the AI team with Ctrl K, and simulate an event from the flask menu.
3. Fleet: filter, search with `/`, sort, Export CSV. AI activity: Undo an "Assigned J…" line and check the order goes back to New on the Orders board.
4. Orders: New order → Assign the suggestion. Stop the backend to see the offline banner and the queued change, then start it again and check the change sends.
5. **Driver page on a phone:** sign in as `driver` at `/driver-app.html`, then go through I've arrived → Loaded → Hand over → photos, name, signature → Delivered. Try it once in airplane mode. If it's good, tell me to swap it in for `driver.html`.
6. `/classic.html` is the old dashboard, kept as a fallback. Delete it when you're happy with the new one.

**Questions**
1. May I replace `docs/driver.html` with the new driver page once you've tried it on a phone?
2. Delivery photos: should they be uploaded and stored, and if so where? For example a disk on Render, or S3 / Cloudflare R2.
3. Should "Ask me first next time" become a real setting? For example: turn this kind of AI decision (reroute, assign, service booking) into an approval for this company.
4. Lite mode turns on for screens of 1440 px wide or less, which covers most laptops, exactly as DESIGN.md says. Is that what you want, or should the limit be lower (e.g. 1280)?
5. Can I delete `docs/classic.html` and the old `docs/app.js`/`style.css` once the new dashboard is approved?

**Push:** `git push origin nightly` succeeded (`cb1d29f..dc6420f`, plus this line). `main` was not touched.
