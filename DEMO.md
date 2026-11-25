# 5-minute demo script

**Before class (at home):** set the PC to never sleep, run `share.bat`, and send yourself the `https://...trycloudflare.com/?key=...` link (WhatsApp or email). Open it on your phone to check the badge says 🤖 Claude.
**In class:** open the link on the university PC about 3 minutes early so trucks are already on the road. Keep speed on 2×.
**Backup plan:** if the tunnel fails, open the Railway / GitHub Pages link (rules mode), and keep a screen recording of the Claude version on a USB stick.

**0:00 – 0:40 · The problem**
"Fleet managers in Latvia juggle trucks, drivers, fuel and breakdowns all day. FleetMind gives them a team of AI agents: an Orchestrator and four specialists for routes, dispatch, maintenance and fuel costs."
Point at the map: 30 real vehicles, real OpenStreetMap roads, live Riga weather, real diesel price of €2.08.

**0:40 – 1:30 · Routine work runs itself**
Scroll the Agent activity panel: new orders get assigned, drivers take their mandatory break after 4.5 hours, low-battery EVs go for a charge. "These happen every minute, so they're fast rules. The LLM agents step in for exceptions."

**1:30 – 2:20 · Traffic jam (auto-applied)**
Click **🚧 Traffic jam**. A red zone appears on the map. Read the log: the Orchestrator calls the Route Agent and the Fuel & Cost Agent, they compare the detour against the delay, and the reroute is applied **automatically** because it's low risk.

**2:20 – 3:40 · Breakdown (human approval)**
Click **🔧 Breakdown**. The Maintenance Agent diagnoses the fault, the Dispatch Agent ranks replacement trucks, and the Orchestrator flags it as **high risk** (cargo transfer + tow cost). It shows up under *Waiting for your approval* with a recommendation. Click **Approve** and watch the new truck head to the breakdown site.
Key point: "The AI can only choose from options the rules engine already checked (capacity, driver hours, EV range), and it can raise the risk level but never lower it."

**3:40 – 4:30 · Chat**
Open **💬 Ask the agents** → "Which jobs are at risk and what did fuel cost today?" The Orchestrator answers from live data.

**4:30 – 5:00 · Wrap up**
KPI strip: on-time %, cost per km, CO₂, auto vs approved decisions. "Sonnet runs the orchestration, Haiku runs the specialists, all on a normal Claude subscription through Claude Code. The public version runs on Railway and GitHub Pages in rules mode."

**If Claude is slow:**, the same buttons still work. The rules engine answers in under a second and the log shows "rules fallback".
