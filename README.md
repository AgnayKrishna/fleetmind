# FleetMind: multi-agent fleet control for Latvia

FleetMind runs a live, mixed freight fleet (30 vehicles: diesel trucks, diesel vans, electric trucks and electric vans) around Riga and the rest of Latvia. A team of five AI agents watches it and reacts when something goes wrong.

| Agent | What it does | Model |
|---|---|---|
| **Orchestrator** | Takes in every event, decides which specialists to call, merges their advice, applies the risk policy, answers the manager's chat | Claude Sonnet |
| **Route Agent** | Routes on real OpenStreetMap roads, traffic incidents, live weather impact, ETAs | Claude Haiku |
| **Dispatch Agent** | Matches jobs to vehicles: capacity, driver hours (EU 561/2006), time windows, EV range | Claude Haiku |
| **Maintenance Agent** | Vehicle health, service intervals, breakdown diagnosis | Claude Haiku |
| **Fuel & Cost Agent** | Fuel and charging, cost per km, CO₂, spots fuel consumption anomalies | Claude Haiku |

## How a decision gets made

```
 Event (traffic / snowstorm / breakdown / urgent order)
        │
        ▼
 Orchestrator ──► picks the specialists it needs
        │
        ├─► Rules engine builds the list of FEASIBLE options
        │   (capacity, driver hours, EV range, vehicle health)
        │
        ├─► Lead specialist picks an option + reason
        ├─► Advisor specialists add notes (cost, maintenance...)
        │
        ▼
 Orchestrator merges everything ──► Risk policy
        │                              │
   low risk                        high risk
   (reroutes, customer notices)    (moving cargo between trucks, bumping
        │                           jobs, pausing work, costs over €300)
        ▼                              ▼
 Applied automatically          Manager approves on the dashboard
```

Two safety rules are built in. The LLM can only choose from options the rules engine has already checked, so it can't send a van that's too small or a driver who's out of hours. The LLM can also raise the risk level of a decision, but it can never lower it.

Routine work (assigning new orders, mandatory driver breaks, refuel stops, service scheduling) is handled by fast rules every tick. The LLM agents are only called for exceptions, which keeps the simulation smooth.

## Real data used

- **Roads and routes:** OpenStreetMap via the public OSRM server (falls back to straight-line estimates if it can't be reached)
- **Weather:** live Riga weather from Open-Meteo (free, no key). The snowstorm button fetches the real weather, then simulates an escalation on top
- **Fuel price:** diesel €2.08/L, petrol €1.85/L, the Latvian national average from the EU Weekly Oil Bulletin, 9 Nov 2026. Electricity €0.40/kWh is an estimate
- **Locations:** real Latvian freight sites (Freeport of Riga, Riga Airport cargo, ports of Liepāja and Ventspils, Jelgava, Valmiera and others)
- **Traffic:** Riga rush hours (07:30–09:30, 16:30–18:30) plus simulated incidents. There's no free live traffic feed for Latvia

## Running it on your PC (with Claude)

The agents use **your Claude subscription through Claude Code**, not a paid API key.

1. Install Python 3.10+ and Claude Code, then run `claude` once in a terminal and log in with your Claude account
2. Windows: double-click `run.bat`. Mac/Linux: `./run.sh`
3. Open http://localhost:8000

The badge at the top should say **🤖 Claude · sonnet + haiku**. If it says **⚙️ Rules engine**, the `claude` command wasn't found. Hover over the badge to see the last error.

> The scripts clear `ANTHROPIC_API_KEY` on purpose, so Claude Code always uses your subscription login and never bills an API key.

Settings (environment variables): `AGENT_MODE` = `auto` / `claude` / `rules`, `ORCHESTRATOR_MODEL` (default `sonnet`), `SPECIALIST_MODEL` (default `haiku`), `DATABASE_URL` (default: SQLite file `backend/fleetmind.db`).

**Saved history.** Orders, approvals, agent decisions and GTM leads are copied to SQLite every 2 seconds and survive a restart. The live simulation itself starts fresh each time. Order and approval numbers continue from where they stopped, and approvals still pending at shutdown are marked `expired`. Read the history at `/api/history/orders`, `/api/history/approvals` or `/api/history/decisions` (`?limit=100&status=...`). On the first start the GTM leads, drafts and statuses are seeded from `docs/leads.json`, `backend/gtm_drafts.json` and `backend/gtm_state.json`.

## Presenting from another computer (e.g. the university PC)

Run FleetMind with Claude on your home PC and open it anywhere through a free Cloudflare tunnel:

1. On your home PC, double-click `share.bat`. The first time, it installs `cloudflared`. Pick a demo password when it asks
2. Wait for a link like `https://random-words.trycloudflare.com`
3. On the university PC, open `https://random-words.trycloudflare.com/?key=YOURPASSWORD`

Anyone can view the page, but pressing buttons, approving and chatting need the password, so strangers can't use up your Claude limits. Keep the home PC on and set it to never sleep. The link changes every time you run `share.bat`.

## Putting it online (GitHub Pages + Railway)

Your subscription can't be used on a server, so the hosted copy runs in **rules mode**. It's the same dashboard and agent pipeline, just without the LLM reasoning. Use it as the public link and run the Claude version live from your laptop.

**Backend on Railway**
1. Push this repo to GitHub
2. Railway → New Project → Deploy from GitHub repo → pick this repo (it reads `railway.json`)
3. Variables: `AGENT_MODE=rules`
4. Settings → Networking → Generate Domain. Copy the URL

**Dashboard on GitHub Pages**
1. Put the Railway URL in `docs/config.js`: `window.FLEET_API_URL = "https://your-app.up.railway.app";`
2. GitHub repo → Settings → Pages → Source: *Deploy from a branch* → `main` / `/docs`
3. Open `https://<your-username>.github.io/<repo>/`

You can also point any copy of the page at a backend with `?api=https://...`.

## API

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/state?since=<logId>` | Full fleet snapshot for the dashboard |
| POST | `/api/event` `{type, vehicle_id?}` | `traffic`, `weather`, `breakdown`, `urgent_order` |
| POST | `/api/approvals/{id}` `{option_id, approve}` | Manager decision |
| POST | `/api/chat` `{message}` | Ask the Orchestrator |
| POST | `/api/control` `{action, value?}` | `pause`, `resume`, `speed` |
| GET | `/api/health` | Agent mode and status |

## Project layout

```
backend/
  app.py       FastAPI server, also serves the dashboard locally
  sim.py       Live simulation: vehicles, jobs, driver hours, energy, costs
  agents.py    Orchestrator + 4 specialists, risk policy, approvals, chat
  llm.py       Claude Code CLI wrapper (subscription login, no API key)
  services.py  OSRM routing and Open-Meteo weather, with offline fallbacks
  data.py      Latvian locations, vehicle types, prices
docs/          Dashboard (GitHub Pages serves this folder)
DEMO.md        5-minute presentation script
```
