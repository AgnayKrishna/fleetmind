const params = new URLSearchParams(location.search);
const API = (params.get("api") || window.FLEET_API_URL || "").replace(/\/$/, "");
let KEY = params.get("key") || sessionStorage.getItem("fleetKey") || "";
if (KEY) sessionStorage.setItem("fleetKey", KEY);
const STATUS_COLOR = { to_pickup: "var(--ok)", to_dropoff: "var(--ok)", to_depot: "var(--ok)", routing: "var(--accent)",
  loading: "var(--load)", unloading: "var(--load)", idle: "var(--idle)", break: "var(--warn)", refuel: "var(--warn)",
  broken: "var(--bad)", service: "var(--svc)" };
const STATUS_TEXT = { to_pickup: "to pickup", to_dropoff: "delivering", to_depot: "to depot", routing: "planning route",
  loading: "loading", unloading: "unloading", idle: "idle", break: "driver break", refuel: "refuel/charge",
  broken: "BROKEN", service: "in service" };
const AGENT_COLOR = { "Orchestrator": "var(--orch)", "Route Agent": "var(--route)", "Dispatch Agent": "var(--disp)",
  "Maintenance Agent": "var(--maint)", "Fuel & Cost Agent": "var(--fuel)", "GTM Agent": "var(--gtm)",
  "Fleet manager": "var(--mgr)" };
// A prospect opening the demo from an outreach email (?ref=<lead id>) gets the plain fleet demo:
// no GTM panel, tile or log lines, so they never see the lead list or other companies' activity.
const REF = (params.get("ref") || "").trim().toLowerCase();
const css = v => getComputedStyle(document.documentElement).getPropertyValue(v.slice(4, -1)).trim() || v;
const short = id => id.replace("LV-", "");
const $ = s => document.querySelector(s);
const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

async function api(path, body) {
  const r = await fetch(API + path, body ? { method: "POST", headers: { "Content-Type": "application/json",
    "X-Demo-Key": KEY }, body: JSON.stringify(body) } : {});
  if (r.status === 401 && body) {
    const k = prompt("Demo password:");
    if (k) { KEY = k.trim(); sessionStorage.setItem("fleetKey", KEY); return api(path, body); }
  }
  if (!r.ok) throw new Error(r.status);
  return r.json();
}

// ---------- map ----------
const map = L.map("map", { zoomControl: true }).setView([56.95, 24.3], 8);
// Vector basemap from OpenFreeMap (free, no API key), drawn by MapLibre GL inside
// Leaflet's tile pane, so routes and markers stay on top of it.
const MAP_STYLE = "https://tiles.openfreemap.org/styles/dark";
const MAP_STYLE_FALLBACK = "https://tiles.openfreemap.org/styles/fiord";
const basemap = L.maplibreGL({ style: MAP_STYLE,
  attribution: '<a href="https://openfreemap.org">OpenFreeMap</a> &copy; OpenStreetMap contributors' }).addTo(map);
{
  const gl = basemap.getMaplibreMap();
  let styleLoaded = false, fellBack = false;
  gl.once("style.load", () => { styleLoaded = true; });
  gl.on("error", () => {   // the dark style could not be loaded: switch to fiord once
    if (styleLoaded || fellBack) return;
    fellBack = true;
    gl.once("style.load", () => { styleLoaded = true; });
    gl.setStyle(MAP_STYLE_FALLBACK);
  });
}
const markers = {}, routes = {}, jobMarkers = {}, zoneLayers = {};
let selected = null, lastState = null, lastLog = 0, approvalsKey = "";

function vehicleIcon(v) {
  const c = css(STATUS_COLOR[v.status] || "var(--idle)");
  return L.divIcon({ className: "", iconSize: [24, 24], iconAnchor: [12, 12],
    html: `<div class="vmark ${selected === v.id ? "sel" : ""}" style="background:${c}">${short(v.id)}</div>` });
}

// Job + trip block: cargo, pickup -> drop-off, where it's heading now, km left,
// ETA against the deadline and whether the customer has been told.
function tripHtml(v) {
  const t = v.trip;
  if (!t) return `<br>Job: -`;
  if (!t.cargo) return `<br>Heading to: ${esc(t.destination)}<br>Remaining: ${t.remaining_km} km · ETA ${t.eta}`;
  const due = t.on_time
    ? `<span style="color:var(--ok);font-weight:600">on time</span>`
    : `<span style="color:var(--bad);font-weight:600">late${t.late_min ? ` by ${t.late_min} min` : ""}</span>`;
  return `<hr class="pop-sep">Job: <b>${v.job_id}</b>${t.priority === "urgent" ? ` <span style="color:var(--bad)">URGENT</span>` : ""}
    <br>Cargo: ${esc(t.cargo)} · ${t.weight.toLocaleString()} kg
    <br>${esc(t.pickup)} → ${esc(t.dropoff)}
    <br>Heading to: <b>${esc(t.destination)}</b>
    <br>Remaining: ${t.remaining_km} km to drop-off
    <br>ETA ${t.eta} · deadline ${t.deadline} · ${due}
    <br>Customer notified: ${t.customer_notified ? "yes" : "no"}`;
}

function popup(v) {
  return `<b>${v.id}</b> · ${v.label}<br>Driver: ${esc(v.driver)}<br>Status: <b>${STATUS_TEXT[v.status] || v.status}</b>
    ${v.fault ? `<br><span style="color:var(--bad)">Fault: ${esc(v.fault)}</span>` : ""}
    ${tripHtml(v)}
    <br>Energy: ${v.energy_pct}% (${v.range_km} km range)
    <br>Health: ${v.health}% · service in ${v.service_due_km.toLocaleString()} km
    <br>Driving today: ${v.drive_today_h} h · since break ${v.since_break_h} h
    ${v.speed_factor !== null && v.speed_factor < 1 ? `<br>Slowed to ${Math.round(v.speed_factor * 100)}% speed` : ""}`;
}

function drawMap(s) {
  const seen = new Set();
  for (const v of s.vehicles) {
    seen.add(v.id);
    if (!markers[v.id]) {
      markers[v.id] = L.marker([v.lat, v.lon], { icon: vehicleIcon(v), zIndexOffset: 500 }).addTo(map)
        .on("click", () => select(v.id, true));
      markers[v.id].bindPopup("", { autoPanPaddingTopLeft: [20, 60] });  // clear the legend bar
    }
    const m = markers[v.id];
    m.setLatLng([v.lat, v.lon]);
    const key = v.status + (selected === v.id);
    if (m._k !== key) { m.setIcon(vehicleIcon(v)); m._k = key; }
    if (m.isPopupOpen()) m.setPopupContent(popup(v)); else m.getPopup().setContent(popup(v));
    // routes
    if (v.route && v.route.length > 1) {
      const style = { color: selected === v.id ? "#ffffff" : css(STATUS_COLOR[v.status]), weight: selected === v.id ? 4 : 2,
        opacity: selected === v.id ? 0.95 : 0.35 };
      if (!routes[v.id]) routes[v.id] = L.polyline(v.route, style).addTo(map);
      else routes[v.id].setLatLngs(v.route).setStyle(style);
    } else if (routes[v.id]) { map.removeLayer(routes[v.id]); delete routes[v.id]; }
  }
  // pending job pickups
  const jseen = new Set();
  for (const j of s.jobs.filter(j => j.status === "pending")) {
    jseen.add(j.id);
    const color = j.priority === "urgent" ? "#f87171" : "#e2e8f0";
    if (!jobMarkers[j.id]) {
      jobMarkers[j.id] = L.marker([j.pickup.lat + 0.01 * (parseInt(j.id.slice(1)) % 5 - 2) / 4, j.pickup.lon], {
        icon: L.divIcon({ className: "", iconSize: [10, 10], html: `<div class="jmark" style="background:${color}"></div>` }) })
        .addTo(map).bindTooltip(`${j.id} ${j.priority === "urgent" ? "URGENT " : ""}· ${j.weight.toLocaleString()} kg ${esc(j.cargo)}<br>${esc(j.pickup.name)} → ${esc(j.dropoff.name)}<br>Due ${j.window_end_str}`);
    }
  }
  for (const id in jobMarkers) if (!jseen.has(id)) { map.removeLayer(jobMarkers[id]); delete jobMarkers[id]; }
  // traffic zones
  const zseen = new Set();
  for (const z of s.zones) {
    zseen.add(z.id);
    if (!zoneLayers[z.id]) zoneLayers[z.id] = L.circle([z.lat, z.lon], { radius: z.radius_km * 1000, color: "#f87171",
      fillColor: "#f87171", fillOpacity: 0.18, weight: 1.5, dashArray: "4 4" }).addTo(map).bindTooltip("🚧 " + esc(z.label));
  }
  for (const id in zoneLayers) if (!zseen.has(id)) { map.removeLayer(zoneLayers[id]); delete zoneLayers[id]; }
}

// fromMap: the click was on the marker itself. Leaflet's bindPopup click handler
// already opens/closes the popup then, so opening it here too would toggle it shut.
function select(id, fromMap = false) {
  selected = selected === id ? null : id;
  for (const k in markers) markers[k]._k = null;
  if (selected && lastState) {
    const v = lastState.vehicles.find(x => x.id === selected);
    // A clicked marker is already on screen; Leaflet's popup auto-pan then fits the popup.
    if (v && !fromMap) { map.panTo([v.lat, v.lon]); markers[selected].openPopup(); }
  } else if (!selected && !fromMap) map.closePopup();
  if (lastState) { drawMap(lastState); drawFleet(lastState); }
}

// ---------- panels ----------
function drawHeader(s) {
  $("#clock").textContent = "🕒 " + s.clock + (s.paused ? " · paused" : "");
  const w = s.weather;
  $("#weather").textContent = (s.storm ? "❄️ STORM · " : "") + `${w.text} ${w.temp_c ?? "--"}°C · ${w.wind_kmh ?? "--"} km/h`;
  $("#weather").classList.toggle("storm", !!s.storm);
  $("#weather").title = `Source: ${w.source}${s.storm ? "\n" + s.storm.label : ""}`;
  const a = s.agents, m = $("#mode");
  if (a.mode === "claude") {
    m.textContent = `🤖 Claude · ${a.models.orchestrator} + ${a.models.specialist}`;
    m.className = "chip mode claude";
    m.title = `Running on your Claude subscription via Claude Code.\nCalls: ${a.calls}, errors: ${a.errors}` + (a.last_error ? `\nLast error: ${a.last_error}` : "");
  } else { m.textContent = "⚙️ Rules engine"; m.className = "chip mode"; m.title = "No LLM: Claude Code not found or AGENT_MODE=rules"; }
  $("#pause").textContent = s.paused ? "▶" : "❚❚";
  document.querySelectorAll(".spd").forEach(b => b.classList.toggle("on", Number(b.dataset.v) === s.speed));
}

function drawKpis(s) {
  const k = s.kpi, c = s.status_counts;
  const moving = (c.to_pickup || 0) + (c.to_dropoff || 0) + (c.to_depot || 0);
  const items = [
    [moving + "/" + s.vehicles.length, "vehicles on the road"], [k.delivered, "delivered"],
    [k.on_time_pct + "%", "on time"], [Math.round(k.km).toLocaleString(), "km driven"],
    ["€" + Math.round(k.fuel_cost + k.energy_cost).toLocaleString(), "fuel + charging"],
    ["€" + k.cost_per_km.toFixed(2), "energy cost / km"], [Math.round(k.co2_kg).toLocaleString(), "kg CO₂"],
    [k.auto_decisions + " / " + k.approvals_done, "auto / approved"]];
  const g = s.gtm_kpi;
  if (g && !REF) items.push([`${g.leads}/${g.sent}/${g.replies}/${g.opens}`, "leads / sent / replies / demo opens"]);
  $("#kpis").innerHTML = items.map(([b, t]) => `<div class="kpi"><b>${b}</b><span>${t}</span></div>`).join("");
}

function drawApprovals(s) {
  const n = s.approvals.length;
  $("#apprCount").textContent = n; $("#apprCount").classList.toggle("zero", n === 0);
  const key = s.approvals.map(a => a.id).join(",");
  if (key === approvalsKey) return;
  approvalsKey = key;
  if (!n) { $("#approvals").innerHTML = `<p class="empty">Nothing to approve. Low-risk decisions are applied automatically.</p>`; return; }
  $("#approvals").innerHTML = s.approvals.map(a => `
    <div class="appr" data-id="${a.id}">
      <h3>⚠️ ${esc(a.title)}</h3>
      <p>${esc(a.summary)}</p>
      ${a.options.map(o => `<label><input type="radio" name="${a.id}" value="${o.id}" ${o.id === a.recommended ? "checked" : ""}>
        <span>${esc(o.label)}${o.id === a.recommended ? '<span class="rec">RECOMMENDED</span>' : ""}<small>${esc(o.detail || "")}</small></span></label>`).join("")}
      <div class="btns"><button class="approve">Approve</button><button class="reject">Reject</button></div>
    </div>`).join("");
}

$("#approvals").addEventListener("click", async e => {
  const card = e.target.closest(".appr"); if (!card) return;
  const approve = e.target.classList.contains("approve"), reject = e.target.classList.contains("reject");
  if (!approve && !reject) return;
  const opt = card.querySelector("input:checked")?.value;
  card.style.opacity = .5;
  await api(`/api/approvals/${card.dataset.id}`, { option_id: opt, approve });
  approvalsKey = ""; poll();
});

// ---------- needs your attention ----------
// One strip above the map: pending approvals, late or overdue jobs, broken vehicles and low energy,
// each with a single button that takes you to the thing that needs a decision.
const LOW_ENERGY_PCT = 20;   // same red threshold as the fleet table; the sim auto-refuels at 12%
let attnKey = "";

function attentionItems(s) {
  const items = [];
  for (const a of s.approvals)
    items.push({ c: "var(--warn)", kind: "Approval", text: a.title, btn: "Review", act: "approval", id: a.id });
  const inApproval = id => s.approvals.some(a => `${a.title} ${a.summary}`.includes(id));
  for (const v of s.vehicles) {
    if (v.status === "broken" && !inApproval(v.id))
      items.push({ c: "var(--bad)", kind: "Broken", text: `${v.id}${v.fault ? " · " + v.fault : ""}`, btn: "Show", act: "vehicle", id: v.id });
    const t = v.trip;
    if (t && t.cargo && !t.on_time)
      items.push({ c: "var(--bad)", kind: "Late", text: `${v.job_id} on ${v.id}${t.late_min ? ` · ${t.late_min} min` : ""}`,
        btn: "Show", act: "vehicle", id: v.id });
    if (v.energy_pct < LOW_ENERGY_PCT && !["refuel", "broken", "service"].includes(v.status))
      items.push({ c: "var(--fuel)", kind: "Low energy", text: `${v.id} · ${v.energy_pct}% (${v.range_km} km)`,
        btn: "Show", act: "vehicle", id: v.id });
  }
  for (const j of s.jobs)
    if (j.status === "pending" && j.window_end < s.sim)
      items.push({ c: "var(--bad)", kind: "Overdue", text: `${j.id} not picked up · due ${j.window_end_str}`,
        btn: "Show", act: "job", id: j.id });
  return items;
}

function drawAttention(s) {
  const items = attentionItems(s), n = items.length;
  $("#attnCount").textContent = n; $("#attnCount").classList.toggle("zero", n === 0);
  const key = JSON.stringify(items);
  if (key === attnKey) return;   // only redraw on change so a button isn't swapped out under the cursor
  attnKey = key;
  $("#attnList").innerHTML = n ? items.map(i => `<div class="attn-item" style="--c:${i.c}">
      <span><b>${esc(i.kind)}</b> ${esc(i.text)}</span>
      <button data-act="${i.act}" data-id="${esc(i.id)}">${esc(i.btn)}</button></div>`).join("")
    : `<p class="empty">All clear. Nothing needs you right now.</p>`;
}

function focusVehicle(id) {
  if (selected !== id) return select(id);   // select() pans and opens the popup
  const v = lastState?.vehicles.find(x => x.id === id);
  if (v) { map.panTo([v.lat, v.lon]); markers[id]?.openPopup(); }
}

$("#attnList").addEventListener("click", e => {
  const b = e.target.closest("button[data-act]"); if (!b) return;
  const id = b.dataset.id;
  if (b.dataset.act === "approval") {
    showTab("ops");
    const card = [...document.querySelectorAll("#approvals .appr")].find(c => c.dataset.id === id);
    if (card) { card.scrollIntoView({ block: "nearest", behavior: "smooth" });
      card.classList.remove("flash"); void card.offsetWidth; card.classList.add("flash"); }
  } else if (b.dataset.act === "vehicle") focusVehicle(id);
  else if (b.dataset.act === "job") {
    const m = jobMarkers[id];
    if (m) { map.setView(m.getLatLng(), Math.max(map.getZoom(), 10)); m.openTooltip(); }
  }
});

// Agent activity filter: null = show every agent, otherwise only that agent's entries.
let logFilter = null;

function drawLog(s) {
  const box = $("#log");
  for (const e of s.log) {
    if (e.id <= lastLog) continue;
    lastLog = e.id;
    if (REF && e.agent === "GTM Agent") continue;
    const c = AGENT_COLOR[e.agent] || "var(--muted)";
    const div = document.createElement("div");
    div.className = "entry " + e.kind;
    div.dataset.agent = e.agent;
    div.hidden = !!logFilter && e.agent !== logFilter;   // new entries follow the active filter
    div.style.borderLeftColor = c;
    div.innerHTML = `<div class="meta"><button class="tag filterable" data-agent="${esc(e.agent)}" style="color:${c};border-color:${c}"
      title="Show only ${esc(e.agent)}">${esc(e.agent)}</button>
      <span>${esc(e.t.slice(-5))}</span>${e.model ? `<span class="model">${esc(e.model)}</span>` : ""}</div>${esc(e.text)}`;
    box.prepend(div);
  }
  while (box.children.length > 200) box.lastChild.remove();
  updateLogEmpty();
}

function updateLogEmpty() {
  const empty = $("#logEmpty");
  const none = !!logFilter && ![...$("#log").children].some(d => !d.hidden);
  empty.classList.toggle("hidden", !none);
  if (none) empty.textContent = `No entries from ${logFilter} yet. New ones will show up here.`;
}

function setLogFilter(agent) {
  logFilter = agent && agent !== logFilter ? agent : null;   // same tag again = back to all
  for (const d of $("#log").children) d.hidden = !!logFilter && d.dataset.agent !== logFilter;
  $("#log").scrollTop = 0;
  renderLegend();
  updateLogEmpty();
}

function renderLegend() {
  const tags = Object.entries(AGENT_COLOR).filter(([n]) => !(REF && n === "GTM Agent"));
  $("#agentLegend").classList.toggle("filtering", !!logFilter);
  $("#agentLegend").innerHTML =
    `<button class="tag filterable${logFilter ? "" : " active"}" data-agent="" style="color:var(--text);border-color:var(--muted)"
      aria-pressed="${!logFilter}">All agents</button>` +
    tags.map(([n, c]) => `<button class="tag filterable${logFilter === n ? " active" : ""}" data-agent="${esc(n)}"
      style="color:${c};border-color:${c}" aria-pressed="${logFilter === n}">${esc(n)}</button>`).join("");
}
renderLegend();
$("#agentLegend").addEventListener("click", e => { const t = e.target.closest(".tag"); if (t) setLogFilter(t.dataset.agent); });
$("#log").addEventListener("click", e => { const t = e.target.closest(".tag"); if (t) setLogFilter(t.dataset.agent); });

function drawFleet(s) {
  const rows = [...s.vehicles].sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }));
  $("#fleet tbody").innerHTML = rows.map(v => {
    const ec = v.energy_pct < 20 ? "var(--bad)" : v.energy_pct < 40 ? "var(--warn)" : "var(--ok)";
    const hc = v.health < 40 ? "var(--bad)" : v.health < 70 ? "var(--warn)" : "var(--ok)";
    return `<tr data-id="${v.id}" style="${selected === v.id ? "background:var(--panel2)" : ""}">
      <td><b>${v.id}</b></td><td>${v.label}</td>
      <td><span class="st" style="color:${STATUS_COLOR[v.status]}">${STATUS_TEXT[v.status] || v.status}</span></td>
      <td>${v.job_id || "-"}</td>
      <td><span class="bar"><i style="width:${v.energy_pct}%;background:${ec}"></i></span>${v.energy_pct}% ${v.unit}</td>
      <td><span class="bar"><i style="width:${v.health}%;background:${hc}"></i></span>${v.health}%</td>
      <td>${v.drive_today_h} h</td><td>${v.service_due_km.toLocaleString()} km</td></tr>`;
  }).join("");
}
$("#fleet tbody").addEventListener("click", e => { const tr = e.target.closest("tr"); if (tr) select(tr.dataset.id); });

let chart;
function drawChart(s) {
  const h = s.history;
  if (!chart) {
    chart = new Chart($("#costChart"), {
      data: { labels: [], datasets: [
        { type: "line", label: "Fuel + charging (€)", data: [], borderColor: "#4fa3ff", backgroundColor: "rgba(79,163,255,.15)", fill: true, tension: .3, yAxisID: "y", pointRadius: 0 },
        { type: "bar", label: "Delivered", data: [], backgroundColor: "rgba(52,211,153,.55)", yAxisID: "y1" }] },
      options: { animation: false, maintainAspectRatio: false, plugins: { legend: { labels: { color: "#8b9bb0", boxWidth: 10 } } },
        scales: { x: { ticks: { color: "#8b9bb0", maxTicksLimit: 10 }, grid: { color: "#1c2735" } },
          y: { ticks: { color: "#8b9bb0" }, grid: { color: "#1c2735" } },
          y1: { position: "right", ticks: { color: "#8b9bb0", precision: 0 }, grid: { display: false } } } } });
  }
  chart.data.labels = h.map(x => x.t);
  chart.data.datasets[0].data = h.map(x => x.cost);
  chart.data.datasets[1].data = h.map(x => x.delivered);
  chart.update();
}

// ---------- right column tabs ----------
function showTab(name) {
  if (REF) name = "ops";                      // prospects only ever see the operations view
  $("#paneOps").classList.toggle("hidden", name !== "ops");
  $("#paneGtm").classList.toggle("hidden", name !== "gtm");
  document.querySelectorAll(".tab").forEach(t => {
    const on = t.dataset.tab === name;
    t.classList.toggle("on", on); t.setAttribute("aria-selected", on);
  });
  try { localStorage.setItem("fmTab", name); } catch { /* storage blocked: tab just isn't remembered */ }
  if (name === "gtm") { gtmKey = ""; drawGtm(); }
}
document.querySelectorAll(".tab").forEach(t => t.addEventListener("click", () => showTab(t.dataset.tab)));

// ---------- GTM outreach tab ----------
const GTM_LABEL = { draft: "draft", approved: "approved", sent: "sent", replied: "replied" };
let gtmData = null, gtmOpen = null, gtmKey = "";

function setGtmCount(n) { $("#gtmTabCount").textContent = n == null ? "" : `(${n})`; }

function gmailUrl(r) {
  const d = r.draft;
  return "https://mail.google.com/mail/?view=cm&to=" + encodeURIComponent(r.email) +
    "&su=" + encodeURIComponent(d.subject) + "&body=" + encodeURIComponent(d.body);
}

function leadCard(r) {
  const d = r.draft, sc = d ? d.score : null, open = gtmOpen === r.id;
  const scc = sc == null ? "var(--muted)" : sc >= 8 ? "var(--ok)" : sc >= 6 ? "var(--warn)" : "var(--idle)";
  const sentDone = r.status === "sent" || r.status === "replied";
  let html = `<div class="lead${open ? " open" : ""}" data-id="${r.id}">
    <div class="lead-top" data-act="toggle" title="Show or hide the email">
      <span class="score" style="color:${scc};border-color:${scc}" title="Fit score">${sc ?? "…"}</span>
      <span class="lname"><b>${esc(r.name)}</b><small>${esc(r.city)}${r.opens ? ` · 👀 ${r.opens} demo open${r.opens > 1 ? "s" : ""}` : ""}</small></span>
      <span class="gst ${r.status}">${GTM_LABEL[r.status] || esc(r.status)}</span>
    </div>
    <div class="lead-actions">
      <button class="lbtn${open ? " on" : ""}" data-act="toggle" ${d ? "" : "disabled"}>${open ? "Hide email" : "View email"}</button>
      ${d ? `<a class="lbtn primary" data-act="gmail" href="${esc(gmailUrl(r))}" target="_blank" rel="noopener">Open in Gmail</a>`
          : `<button class="lbtn primary" disabled>Open in Gmail</button>`}
      <button class="lbtn" data-act="status" data-s="sent" ${sentDone ? "disabled" : ""}>Mark sent</button>
      <button class="lbtn" data-act="status" data-s="replied" ${r.status === "replied" ? "disabled" : ""}>Mark replied</button>
    </div>`;
  if (open) {
    html += !d ? `<p class="note">Draft not ready yet.</p>` : `
      <p class="why">${esc(d.reason)} <small>(${esc(d.model)}${d.site_read ? ", website read" : ""})</small></p>
      <div class="mail"><div><span>To</span> ${esc(r.email)}</div><div><span>Subject</span> ${esc(d.subject)}</div>
        <pre>${esc(d.body)}</pre></div>
      <div class="lead-actions">
        <button class="lbtn" data-act="copy">Copy</button>
        ${r.status === "draft" ? `<button class="lbtn" data-act="status" data-s="approved">Approve</button>` : ""}
        ${r.status !== "draft" ? `<button class="lbtn" data-act="status" data-s="draft">Back to draft</button>` : ""}
        <a class="lbtn" href="${esc(r.website)}" target="_blank" rel="noopener">Website</a>
      </div>
      ${r.last_open ? `<p class="note">Last demo open: ${esc(r.last_open.replace("T", " ").slice(0, 16))} UTC</p>` : ""}
      <p class="note">Nothing is sent automatically. Send it yourself from Gmail, then mark it sent.</p>`;
  }
  return html + `</div>`;
}

function drawGtm() {
  if (!gtmData) return;
  const rows = gtmData.leads, p = gtmData.progress, k = gtmData.kpi;
  setGtmCount(rows.length);
  $("#gtmProgress").textContent = p.running ? `· researching ${p.done}/${p.todo}…` : "";
  const n = st => rows.filter(r => r.status === st).length;
  $("#gtmSummary").textContent = `Draft ${n("draft")} · Approved ${n("approved")} · Sent ${n("sent")} · Replied ${n("replied")} · Demo opens ${k.opens}`;
  // only redraw when something changed, so an open card doesn't flicker while you read it
  const key = JSON.stringify([rows.map(r => [r.id, r.status, r.opens, r.draft?.score, r.draft?.generated]), gtmOpen]);
  if (key === gtmKey) return;
  gtmKey = key;
  $("#gtmList").innerHTML = rows.map(leadCard).join("") || `<p class="empty">No leads in docs/leads.json.</p>`;
}

async function pollGtm() {
  if (REF) return;
  try { gtmData = await api("/api/gtm"); drawGtm(); } catch { /* the main poll shows the offline banner */ }
}

$("#gtmList").addEventListener("click", async e => {
  const card = e.target.closest(".lead"), el = e.target.closest("[data-act]");
  if (!card || !el) return;
  const id = card.dataset.id, r = gtmData.leads.find(x => x.id === id), act = el.dataset.act;
  if (act === "toggle") {
    if (!r.draft) return;
    gtmOpen = gtmOpen === id ? null : id; drawGtm();
    const list = $("#gtmList"), open = list.querySelector(".lead.open");
    if (open) list.scrollTop = open.offsetTop;   // show the opened card from its top (list is position: relative)
  } else if (act === "status") {
    el.disabled = true;
    await api(`/api/gtm/${id}/status`, { status: el.dataset.s });
    await pollGtm(); poll();
  } else if (act === "gmail") {
    // the link opens Gmail by itself; opening the compose window counts as approving the draft
    if (r.status === "draft") api(`/api/gtm/${id}/status`, { status: "approved" }).then(pollGtm).then(poll).catch(() => {});
  } else if (act === "copy") {
    const text = `To: ${r.email}\nSubject: ${r.draft.subject}\n\n${r.draft.body}`;
    let ok = true;
    try { await navigator.clipboard.writeText(text); }
    catch {   // older browsers / blocked clipboard API: copy through a hidden textarea
      const ta = Object.assign(document.createElement("textarea"), { value: text });
      document.body.append(ta); ta.select(); ok = document.execCommand("copy"); ta.remove();
    }
    el.textContent = ok ? "Copied ✓" : "Copy failed"; setTimeout(() => { el.textContent = "Copy"; }, 1500);
  }
});

if (REF) {
  $("#tabs").classList.add("hidden");
  $("#paneGtm").classList.add("hidden");
  if (!sessionStorage.getItem("fmRef")) {   // one open per browser tab session; the backend also de-dupes
    sessionStorage.setItem("fmRef", REF);
    api("/api/gtm/open", { ref: REF }).catch(() => {});
  }
} else {
  pollGtm(); setInterval(pollGtm, 4000);
  let saved = null; try { saved = localStorage.getItem("fmTab"); } catch { /* ignore */ }
  showTab(saved === "gtm" ? "gtm" : "ops");
}

// ---------- loop ----------
let failures = 0;
async function poll() {
  try {
    const s = await api(`/api/state?since=${lastLog}`);
    failures = 0; $("#offline").classList.add("hidden");
    lastState = s;
    if (s.gtm_kpi && !REF) setGtmCount(s.gtm_kpi.leads);
    drawHeader(s); drawMap(s); drawKpis(s); drawApprovals(s); drawAttention(s); drawLog(s); drawFleet(s); drawChart(s);
  } catch (e) {
    if (++failures > 2) { $("#apiUrl").textContent = API || location.origin; $("#offline").classList.remove("hidden"); }
  }
}
setInterval(poll, 1500); poll();

// ---------- controls ----------
document.querySelectorAll(".events button").forEach(b => b.addEventListener("click", async () => {
  b.classList.add("fired"); setTimeout(() => b.classList.remove("fired"), 1500);
  await api("/api/event", { type: b.dataset.ev, vehicle_id: selected }); setTimeout(poll, 400);
}));
$("#pause").addEventListener("click", () => api("/api/control", { action: lastState?.paused ? "resume" : "pause" }).then(poll));
document.querySelectorAll(".spd").forEach(b => b.addEventListener("click", () =>
  api("/api/control", { action: "speed", value: Number(b.dataset.v) }).then(poll)));

// ---------- chat ----------
$("#chatBtn").onclick = () => { $("#chat").classList.toggle("hidden"); $("#chatIn").focus(); };
$("#chatClose").onclick = () => $("#chat").classList.add("hidden");
$("#chatForm").addEventListener("submit", async e => {
  e.preventDefault();
  const q = $("#chatIn").value.trim(); if (!q) return;
  $("#chatIn").value = "";
  const box = $("#chatMsgs");
  box.insertAdjacentHTML("beforeend", `<div class="msg me">${esc(q)}</div>`);
  const wait = document.createElement("div"); wait.className = "msg bot"; wait.textContent = "Thinking…"; box.append(wait);
  box.scrollTop = box.scrollHeight;
  try {
    const r = await api("/api/chat", { message: q });
    wait.innerHTML = `${esc(r.answer)}<small>${esc(r.model)}</small>`;
  } catch { wait.textContent = "Couldn't reach the backend."; }
  box.scrollTop = box.scrollHeight;
});
