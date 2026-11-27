# FleetMind to-do

Ticks: [ ] to do, [x] done, [!] failed (see report), [?] question for owner.
The owner and Claude plan this list each evening.

## Tonight (NIGHT mode, in order)

- [ ] **Roles match the design.** Update `backend/auth.py` PERMISSIONS and the UI to follow `design/reference/roles.reference.html` and the "Roles and their screens" section of design/DESIGN.md. The employee role is a dispatcher, not read-only: can approve decisions up to an approval limit (default €300 cost impact, a per-company setting the logistics_admin can change; bigger ones stay pending for the admin and say so), create and assign orders, message drivers, undo AI actions on their own assigned trucks, and see trip costs and savings. Employees never see customer prices, revenue, profit, billing, settings or GTM. Add a simple "assigned trucks" list per employee (seed: employee gets 12 of the vehicles). Superadmin can read company settings for support but cannot approve or undo company decisions. Update the permission test so every endpoint is still covered, and add tests for the limit.
- [ ] **Public demo access.** Add "View as guest" on the login page: a read-only logistics_admin view with no write actions. Remove `super` from the public demo account list (keep the account). Keep DEMO_KEY working as an extra lock on writes. Test that guest cannot write.
- [ ] **Protect the map tile proxy.** `/api/map/tile/...` stays login-free, but only serves requests whose Origin or Referer matches `ALLOWED_ORIGINS` (env, comma separated; default allows localhost, the Render URL and the GitHub Pages URL), rate-limits per IP, and caches tiles in memory for 10 minutes. Test with mocked TomTom calls.
- [ ] **Frontend rebuild in Baltic Amber.** The React + Vite + TypeScript + Tailwind + shadcn/ui project is already set up in `frontend/` (see frontend/README.md). Build the dashboard there, following design/DESIGN.md exactly; design/reference/control-centre.reference.html is the main visual reference (match it closely; reuse its truck and van SVG symbols). Use MapLibre GL, Lucide icons and Motion. Light and dark mode with a toggle. Use the installed project skills (frontend-design, ui-ux-pro-max, design-taste-frontend, react-best-practices, motion-framer). Configure the Vite build so `npm --prefix frontend run build` outputs into docs/, keeping docs/driver.html working until the driver screen is rebuilt, so the FastAPI backend and GitHub Pages keep serving it. Every current feature must keep working: live data from /api/state, login and roles, events, approvals, chat, GTM tab (superadmin only), agent filters, Needs your attention bar with Refuel/Charge buttons, history. Build these screens in this order, committing after each: control centre, lite mode, fleet table, AI activity with real Undo, orders board, empty/offline/error states. If time or usage runs out, finish the current screen cleanly, commit, and list the screens left in the report. Do not call any paid API in tests.
- [ ] **Role screens.** In the same frontend, build: the super admin overview (`design/reference/super-admin.reference.html`, using real data where the backend has it and clearly labelled sample data where it doesn't), the dispatcher "My shift" home (`dispatcher-shift.reference.html`), and the driver Today and Delivery screens (`driver.reference.html`), replacing docs/driver.html once the new one works. Only start this after the control centre and fleet table are done.

## Daytime (DAY mode, 1-2 tasks only)

- [x] **Label sample fuel and charger data.** The fuel stations, chargers and prices added for the Refuel/Charge button are made up. Show "Sample data" wherever they appear (button tooltip, popups) until real data is connected.
- [ ] **Count refuel savings.** Include savings from choosing cheaper stations in the dashboard's fuel-cost and savings figures, not only in the log.

## Done
- 2026-11-27 night: driver hours reset fix, SQLite database, Claude API mode, TomTom/HERE/OSRM truck routing with traffic, logins and 4 roles, driver phone page.
- 2026-11-26 day: Refuel now / Charge now button, Needs your attention bar, agent log filter polish.
