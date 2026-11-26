# FleetMind to-do

Ticks: [ ] to do, [x] done, [!] failed (see report), [?] question for owner.
The owner and Claude plan this list each evening.

## Tonight (NIGHT mode, in order)

- [ ] **Fix: vehicles stop driving.** In backend/sim.py, `drive_today` and `drive_since_break` never reset, so after some hours every driver hits DAILY_DRIVE_MAX and dispatch finds no vehicle. Reset them when a new sim day starts and after an 11 h rest. Add a test that runs a full sim day at high speed and checks vehicles are still being assigned at the end.
- [ ] **Database.** Add SQLite with SQLAlchemy so orders, approvals, agent decisions and GTM leads survive restarts. Seed demo data on first start. Keep the simulation working exactly as now.
- [ ] **Claude API mode.** Add AGENT_MODE=api using the official anthropic SDK and ANTHROPIC_API_KEY from the environment (never committed). Sonnet for the Orchestrator and GTM, Haiku for specialists. Fall back to rules if a call fails. Log tokens per call and estimated cost. Keep "claude" and "rules" modes unchanged. Do not call the API in tests.
- [ ] **Powered by TomTom: truck routing, map and live traffic.** Replace OSRM in backend/services.py with a routing provider setting `ROUTING_PROVIDER` (tomtom, here, osrm). TomTom Routing API is the main one: travelMode truck with each vehicle's height, width, length, weight, axle count and hazmat flag, plus live traffic for ETAs. HERE truck routing (transportMode=truck) is the automatic backup, OSRM the last fallback. Keys TOMTOM_API_KEY and HERE_API_KEY come from .env and are never committed; with no keys everything still works on OSRM. Add height, width, length, weight and axles to every vehicle (sensible defaults per vehicle type). In the dashboard, use TomTom map tiles with a live traffic layer when a key is set, else OpenFreeMap, and show a small "Routing and traffic: TomTom" attribution plus the routing source on each route. Mock the APIs in tests; never call them in tests.
- [ ] **Frontend rebuild in Baltic Amber.** Rebuild the dashboard as React + Vite + Tailwind + shadcn/ui + Lucide icons + Motion (framer) + MapLibre GL. Follow design/DESIGN.md exactly and use design/reference/control-centre.reference.html as the visual reference (match it closely; reuse its truck and van SVG symbols). Use the installed project skills: frontend-design, ui-ux-pro-max, taste-skill, React best practices, motion-framer, and the shadcn MCP server for components. Light and dark mode with a toggle. The build output must go to docs/ so the FastAPI backend and GitHub Pages keep serving it, and every current feature must keep working (live data from /api/state, events, approvals, chat, GTM tab, agent filters). Do not call any paid API in tests. Commit in small steps.
- [ ] **Logins and 4 roles.** Demo login (hashed passwords, session cookie) for superadmin, logistics_admin, employee and driver, with seeded demo accounts shown on the login page. Enforce roles on every API endpoint, not only in the UI. Driver gets a phone layout with their vehicle, job, next stop, Arrived / Loaded / Delivered buttons and "Report a problem" that triggers the breakdown pipeline. Log who approved each decision.

## Daytime (DAY mode, 1-2 tasks only)

- [ ] **"Needs your attention" list** at the top of the dashboard: pending approvals, late jobs, broken vehicles and low fuel, each with one clear button.
- [ ] **Agent log filter polish:** keep the clicked agent tag highlighted and show an "All agents" tag first.
