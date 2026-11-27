// Driver phone view: own vehicle, job, next stop, Arrived / Loaded / Delivered and "Report a problem".
const $ = s => document.querySelector(s);
const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const STATUS_TEXT = { to_pickup: "Driving to pickup", to_dropoff: "Delivering", to_depot: "Back to depot",
  to_fuel: "To fuel / charger", routing: "Planning route", loading: "Loading", unloading: "Unloading", idle: "Waiting for a job",
  break: "Driver break", refuel: "Refuelling / charging", broken: "Broken down", service: "In service" };
let last = null, busy = false;

async function call(path, body) {
  const r = await fetch(FM.API + path, body ? { method: "POST", headers: { "Content-Type": "application/json", ...FM.headers() },
    body: JSON.stringify(body) } : { headers: FM.headers() });
  if (r.status === 401) { await FM.requireLogin(); return call(path, body); }
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || `Error ${r.status}`);
  return d;
}

function say(text, bad = false) {
  const m = $("#dMsg");
  m.textContent = text; m.classList.toggle("bad", bad); m.classList.remove("hidden");
  clearTimeout(say.t); say.t = setTimeout(() => m.classList.add("hidden"), 5000);
}

function draw(d) {
  last = d;
  const v = d.vehicle, j = d.job, n = d.next_stop, t = d.trip;
  $("#dVehicle").textContent = `${v.id} · ${v.label}`;
  $("#dClock").textContent = `${d.clock} · ${v.driver}`;
  $("#dStopName").textContent = n ? `${n.action}: ${n.name}` : (STATUS_TEXT[v.status] || v.status);
  $("#dStopInfo").innerHTML = t ? `${t.remaining_km} km left · ETA ${esc(t.eta)}` +
    (t.deadline ? ` · due ${esc(t.deadline)} · <b class="${t.on_time ? "ok" : "bad"}">${t.on_time ? "on time" : `late ${t.late_min} min`}</b>` : "")
    : esc(STATUS_TEXT[v.status] || "");
  const nav = $("#dNav");
  if (n) { nav.href = `https://www.google.com/maps/dir/?api=1&destination=${n.lat},${n.lon}&travelmode=driving`; nav.classList.remove("hidden"); }
  else nav.classList.add("hidden");

  document.querySelectorAll(".d-btn").forEach(b => {
    const ok = !!d.allowed[b.dataset.action];
    b.disabled = !ok || busy; b.classList.toggle("now", ok);
  });

  $("#dJobBody").innerHTML = !j ? `<p class="d-sub">No job right now. Dispatch will send you one.</p>` : `
    <p class="d-big">${esc(j.id)} ${j.priority === "urgent" ? '<span class="pill bad">URGENT</span>' : ""}
      ${j.hazmat ? '<span class="pill warn" title="Dangerous goods: ADR rules apply">ADR hazmat</span>' : ""}</p>
    <p>${esc(j.cargo)} · ${j.weight.toLocaleString()} kg</p>
    <p class="d-route"><span>${esc(j.pickup)}</span><span aria-hidden="true">→</span><span>${esc(j.dropoff)}</span></p>
    <p class="d-sub">Deadline ${esc(j.deadline)}</p>`;

  const ec = v.energy_pct < 20 ? "var(--bad)" : v.energy_pct < 40 ? "var(--warn)" : "var(--ok)";
  $("#dVehBody").innerHTML = `
    <p><span class="pill">${esc(STATUS_TEXT[v.status] || v.status)}</span>${v.fault ? ` <span class="pill bad">${esc(v.fault)}</span>` : ""}</p>
    <div class="d-stat"><span>${v.unit === "kWh" ? "Battery" : "Fuel"}</span><b>${v.energy_pct}% · ${v.range_km} km</b></div>
    <div class="d-bar"><i style="width:${v.energy_pct}%;background:${ec}"></i></div>
    <div class="d-stat"><span>Driving today</span><b>${v.drive_today_h} h · ${v.hours_left_h} h left</b></div>
    <div class="d-stat"><span>Since last break</span><b>${v.since_break_h} h of 4.5 h</b></div>
    <div class="d-stat"><span>Health</span><b>${v.health}%</b></div>`;
  $("#dReport").disabled = v.status === "broken";
  $("#dReport").textContent = v.status === "broken" ? "🔧 Problem reported: help is on the way" : "⚠️ Report a problem";
}

async function refresh() {
  try { draw(await call("/api/driver/me")); }
  catch (e) { $("#dStopName").textContent = e.message; }
}

document.querySelector(".d-actions").addEventListener("click", async e => {
  const b = e.target.closest(".d-btn"); if (!b || b.disabled) return;
  busy = true; b.disabled = true;
  try { await call("/api/driver/action", { action: b.dataset.action }); say(`${b.textContent.trim()} ✓ Dispatch has been told.`); }
  catch (ex) { say(ex.message, true); }
  busy = false; refresh();
});

$("#dReport").onclick = () => { $("#dProblemForm").classList.remove("hidden"); $("#dReport").classList.add("hidden"); $("#dNote").focus(); };
$("#dCancel").onclick = () => { $("#dProblemForm").classList.add("hidden"); $("#dReport").classList.remove("hidden"); };
$("#dProblemForm").addEventListener("submit", async e => {
  e.preventDefault();
  try {
    await call("/api/driver/problem", { note: $("#dNote").value });
    say("Problem reported. The Maintenance Agent is planning the repair.");
    $("#dNote").value = "";
  } catch (ex) { say(ex.message, true); }
  $("#dProblemForm").classList.add("hidden"); $("#dReport").classList.remove("hidden");
  refresh();
});

FM.boot("driver").then(() => { refresh(); setInterval(refresh, 3000); });
