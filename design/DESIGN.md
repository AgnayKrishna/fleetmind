# FleetMind design spec: Baltic Amber

The approved look for the whole product. Visual reference: `design/reference/control-centre.reference.html`
(a design mock-up, not production code; copy its look, not its code). Online canvas:
https://claude.ai/artifact/PyTvJwL8Be7j9UcfNCw8co

## Principles
- Map-first control centre, like Uber/Bolt; polish like Linear/Stripe; Apple-level attention to detail.
- One brand colour: amber. Quiet neutrals everywhere else. No pine green, no gradients as decoration.
- Floating frosted-glass panels over a full-screen map.
- Subtle, smooth motion that always means something. Respect "reduce motion".
- Every screen answers "what needs me right now?". Decisions and actions, not just data.
- Light mode by default, dark mode toggle, both first-class.

## Type
- Font: **Manrope** (Google Fonts), weights 400/500/600/700/800. Nothing else.
- Sizes: 13 (notes), 14-15 (body), 20 (panel titles, 800), 22-26 (key numbers, 800, letter-spacing -0.4px).

## Colour tokens
| Token | Light | Dark |
|---|---|---|
| map background | #ECEDEF | #141517 |
| water | #D5E1EA | #1A2530 |
| park | #DFE8DD | #18221B |
| main road | #FFFFFF | #2A2C30 |
| minor road | #F6F6F7 | #202225 |
| map label | #80848B | #7C8088 |
| glass panel | rgba(255,255,255,0.74) + blur 22px saturate 170% | rgba(30,31,34,0.72) + same blur |
| glass border | rgba(255,255,255,0.75) | rgba(255,255,255,0.08) |
| panel shadow | 0 1px 2px rgba(24,25,28,.06), 0 12px 32px rgba(24,25,28,.10) | 0 1px 2px rgba(0,0,0,.4), 0 16px 40px rgba(0,0,0,.45) |
| text | #18191C | #F1EFEA |
| muted text | #5E6168 | #A2A5AB |
| line / border | rgba(24,25,28,0.12) | rgba(255,255,255,0.14) |
| chip / subtle fill | rgba(24,25,28,0.05) | rgba(255,255,255,0.07) |
| **amber (brand, primary buttons)** | #F2A42B with text #1C1408 | #FFB547 with text #1C1408 |
| amber text | #8F5400 | #FFC46B |
| amber tint | #FCEBCB | rgba(255,181,71,0.16) |
| status good (on schedule) | #1F9D6B | #3BC48A |
| status watch (needs watching) | #7C5CE0 | #9C82FF |
| status act (act now) | #D93A3A | #FF5C5C |

Amber is the brand, so "needs watching" is violet, never amber. Amber never shows a status.

## Vehicle status colours (everywhere: map halos, table chips, filters)
| Status | Dot | Chip fill | Chip text | When |
|---|---|---|---|---|
| On route | #1F9D6B | #DDF2E8 | #13684A | driving and on schedule |
| Loading | #2F7FD8 | #E1EDFB | #1D5FAE | at a pickup or drop-off |
| Parked | #8A8F98 | #ECEDEF | #44474E | free, on a break or at the depot |
| Delay risk | #7C5CE0 | #ECE7FC | #5B3FC4 | may be late, an AI teammate is on it |
| Act now | #D93A3A | #FBE3E3 | #B42828 | breakdown, accident, missed slot |
| No signal | #5E6168 | none, 1px dashed #8A8F98 border | #44474E | tracker silent 10 min or more |
Reference: `design/reference/status-and-lite-rules.reference.html`. Dark mode uses the same hues, lighter (as in the token table).

## Vehicles on the map
- Soft 3D top-down icons (exact SVG symbols `truck` and `van` in the reference file). Keep them as they are.
- Colours: diesel truck #2E3035 (dark mode #5C616B), diesel van #F7F7F5, electric truck amber, electric van #F6D49A.
- Each icon rotates to its real heading and glides smoothly between GPS updates (interpolate position and heading).
- Status = soft halo under the icon (good / watch / act colours at ~15% fill). Act now = gentle red pulse.
- Moving vehicles leave a short fading amber trail behind them.
- Selecting a vehicle draws its route in amber (animated stroke, ~1.6 s).

## Layout of the control centre
- Full-screen map (MapLibre; OpenFreeMap or TomTom tiles styled with the map tokens above).
- Top bar (glass, 22px radius): logo, search/command bar with Ctrl K, 4 key numbers, light/dark toggle, avatar.
- Left panel "Needs you" (360px): only decisions for a human; one clear button each.
- Right panel "Your AI team" (320px): Atlas (lead, amber avatar), Dina, Max, Ruta, Leo, each with a live one-line status; animated dots while working.
- Bottom sheet (Bolt-style, 26px radius, grab handle) for the selected vehicle: icon, plate, badges (Recommended, Arrives on time), driver, distance, hours left, ETA vs deadline, buttons; one full-width amber primary action.
- Phone width: panels stack under the map.

## Components
- Radius: 22-26 panels, 14-16 rows and buttons, 999 pills. Buttons at least 44px tall.
- One amber primary button per panel. Secondary buttons use the chip fill.
- Badges: soft tint background + darker text of the same hue, sentence case.
- Copy: sentence case, plain verbs ("Send LV-T03 to collect the load"), no ALL CAPS labels.

## Lite mode (automatic solid panels)
Reference: `design/reference/lite-mode.reference.html` (1366x768 laptop).
- Switches on by itself when any is true: screen width <= 1440 px or height <= 800 px; `navigator.hardwareConcurrency` <= 4 or `navigator.deviceMemory` <= 4; map below 30 fps for 3 s; `prefers-reduced-transparency` or `prefers-reduced-motion`.
- Lite mode: solid white panels with a 1px border (no backdrop blur), no trails or gliding animations (jump to new positions), AI team folds into a 56px icon rail with status dots, "Needs you" shows the top 2 with "Show N more", smaller bottom sheet.
- A "Lite mode" toggle in the top bar overrides the automatic choice; remember it in localStorage (wrapped in try/catch).

## Other screens (top nav: Map, Fleet, Orders, AI activity, Reports)
- **Fleet table** (`fleet-table.reference.html`): one row per vehicle: plate with vehicle-colour swatch, driver, status chip, where, next stop + ETA, load bar, fuel/charge (red under 20%), drive time left, AI note. Status filter pills with counts (pressed = dark fill), search with "/" shortcut, sortable columns, Export CSV. Must stay fast with 100+ vehicles (virtualise rows).
- **Orders board** (`orders.reference.html`): columns New, Assigned, In progress, Delivered, Problem. Cards: order id, price, route, customer, load, time window, vehicle and driver. New cards show the AI suggestion with a one-click amber "Assign" button. Problem cards get a 2px red border and the proposed fix. Delivered cards show who signed + photo, and "Send invoice". Amber "New order" button in the top bar.
- **AI activity** (`ai-activity.reference.html`): today's list of decisions the AI made by itself: who, what, when, "Why: ...", the result (saved EUR / arrives on time). Each reversible one has Undo (crossed out after, with what happens instead) and Redo. Things that cannot be reversed (messages already sent) have no Undo. Detail panel: the full reason, the options compared, the safety checks passed, Undo, and "Ask me first next time" (turns that kind of decision into an approval). Undo must really revert the action in the backend and be logged.
- **Empty, offline and error states** (`states.reference.html`): no vehicles yet = "Connect your first truck" with three ways (tracker, existing GPS system, driver phone) and an amber button. Offline = dark banner "You're offline. Positions are from HH:MM.", greyed map, actions queue and show "N changes waiting to send", "Try to reconnect". A service fails = never blank; say what fell back and what to watch (TomTom -> HERE -> basic routes; AI down = rules keep running, nothing new auto-approved; tracker silent = No signal + ask the driver on Telegram), with a retry button.

## Roles and their screens
Reference: `design/reference/roles.reference.html` is the permission table. Enforce it in the backend (deny by default), not only in the UI. Each company sees only its own data.
- **Super admin** (`super-admin.reference.html`): FleetMind staff. Dark top bar with an amber "Super admin" chip. Nav: Overview, Companies, Users, Billing, AI usage, Integrations, Support. Six totals (companies, vehicles connected, monthly revenue, AI cost this month with % of revenue, AI decisions today with how many were undone, 30-day uptime). Companies table (plan, vehicles, monthly, tracker data source, AI decisions today, AI cost, health) with filter pills. Integrations status list and a "Needs your attention" list. Can open a company's settings for support only; never approves or undoes a company's decisions.
- **Company admin** (logistics_admin): everything inside their company: map, fleet, orders, AI activity, prices, revenue and profit, settings, users, AI limits, approvals of any size.
- **Dispatcher** (employee) (`dispatcher-shift.reference.html`): home is "My shift": their assigned trucks (status chips), "Needs you" with approvals up to their limit (default €300 cost impact, set per company by the admin; bigger ones show "sent to <admin> for approval"), and driver messages from Telegram with the original language noted. Sees trip costs and savings but never customer prices, revenue, profit, billing or settings. Can create and assign orders, message drivers, and undo AI actions on their own trucks. Can open the full map, fleet and orders.
- **Driver** (`driver.reference.html`): a phone web page opened from a Telegram link, no app install. "Today": driving time left with break warning, current job card (amber outline) with Navigate and "I've arrived", later jobs, "Report a problem" (red outline) and "Start break", language switch (LV / RU / EN). Delivery: photos, receiver name, signature, "Something is damaged or missing", big amber "Delivered"; works offline and sends later. Buttons only enabled in the matching job state (server checks again).
- **Public demo:** a "View as guest" button on the login page gives a read-only company view. The `super` account is not listed publicly. `DEMO_KEY` stays as an extra lock on writes.
