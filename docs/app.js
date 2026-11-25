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
  "Maintenance Agent": "var(--maint)", "Fuel & Cost Agent": "var(--fuel)", "Fleet manager": "var(--mgr)" };
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
L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png", {
  attribution: "&copy; OpenStreetMap contributors &copy; CARTO", maxZoom: 18 }).addTo(map);
const markers = {}, routes = {}, jobMarkers = {}, zoneLayers = {};
let selected = null, lastState = null, lastLog = 0, approvalsKey = "";

function vehicleIcon(v) {
  const c = css(STATUS_COLOR[v.status] || "var(--idle)");
  return L.divIcon({ className: "", iconSize: [24, 24], iconAnchor: [12, 12],
    html: `<div class="vmark ${selected === v.id ? "sel" : ""}" style="background:${c}">${short(v.id)}</div>` });
}

function popup(v) {
  return `<b>${v.id}</b> · ${v.label}<br>Driver: ${esc(v.driver)}<br>Status: <b>${STATUS_TEXT[v.status] || v.status}</b>
    ${v.fault ? `<br><span style="color:var(--bad)">Fault: ${esc(v.fault)}</span>` : ""}
    <br>Job: ${v.job_id || "-"}<br>Energy: ${v.energy_pct}% (${v.range_km} km range)
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
        .on("click", () => select(v.id));
      markers[v.id].bindPopup("");
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

function select(id) {
  selected = selected === id ? null : id;
  for (const k in markers) markers[k]._k = null;
  if (selected && lastState) {
    const v = lastState.vehicles.find(x => x.id === selected);
    if (v) { map.panTo([v.lat, v.lon]); markers[selected].openPopup(); }
  }
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

function drawLog(s) {
  const box = $("#log");
  for (const e of s.log) {
    if (e.id <= lastLog) continue;
    lastLog = e.id;
    const c = AGENT_COLOR[e.agent] || "var(--muted)";
    const div = document.createElement("div");
    div.className = "entry " + e.kind;
    div.style.borderLeftColor = c;
    div.innerHTML = `<div class="meta"><span class="tag" style="color:${c};border-color:${c}">${esc(e.agent)}</span>
      <span>${esc(e.t.slice(-5))}</span>${e.model ? `<span class="model">${esc(e.model)}</span>` : ""}</div>${esc(e.text)}`;
    box.prepend(div);
  }
  while (box.children.length > 200) box.lastChild.remove();
}

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

$("#agentLegend").innerHTML = Object.entries(AGENT_COLOR).map(([n, c]) =>
  `<span class="tag" style="color:${c};border-color:${c}">${n}</span>`).join("");

// ---------- loop ----------
let failures = 0;
async function poll() {
  try {
    const s = await api(`/api/state?since=${lastLog}`);
    failures = 0; $("#offline").classList.add("hidden");
    lastState = s;
    drawHeader(s); drawMap(s); drawKpis(s); drawApprovals(s); drawLog(s); drawFleet(s); drawChart(s);
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
