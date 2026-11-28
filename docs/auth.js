// Shared sign-in for the dashboard (index.html) and the driver app (driver.html).
// The backend sets an HttpOnly cookie for same-origin use and also returns a token, which is kept in
// sessionStorage and sent as "Authorization: Bearer" so a dashboard on another origin
// (GitHub Pages -> backend) works too.
const FM = (() => {
  const params = new URLSearchParams(location.search);
  const API = (params.get("api") || window.FLEET_API_URL || "").replace(/\/$/, "");
  let token = sessionStorage.getItem("fmToken") || "";
  let user = null, waiting = null;
  const ROLE_LABEL = { superadmin: "Super admin", logistics_admin: "Company admin", employee: "Dispatcher", driver: "Driver" };
  const escH = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const headers = () => (token ? { Authorization: "Bearer " + token } : {});

  async function me() {
    try {
      const r = await fetch(API + "/api/auth/me", { headers: headers() });
      return r.ok ? (await r.json()).user : null;
    } catch { return null; }
  }

  async function fillDemoAccounts() {
    const box = document.getElementById("demoAccounts");
    if (!box || box.dataset.done) return;
    try {
      const r = await fetch(API + "/api/auth/demo-accounts");
      const { accounts } = await r.json();
      box.innerHTML = accounts.map(a => `<button type="button" class="demo-acc" data-u="${escH(a.username)}" data-p="${escH(a.password)}">
        <b>${escH(ROLE_LABEL[a.role] || a.role)}</b><span>${escH(a.username)} / ${escH(a.password)}</span>
        <small>${escH(a.name)}${a.vehicle_id ? " · " + escH(a.vehicle_id) : ""}</small></button>`).join("");
      box.dataset.done = "1";
      box.addEventListener("click", e => {
        const b = e.target.closest(".demo-acc"); if (!b) return;
        document.getElementById("loginUser").value = b.dataset.u;
        document.getElementById("loginPass").value = b.dataset.p;
        document.getElementById("loginForm").requestSubmit();
      });
    } catch { box.innerHTML = `<p class="note">Can't reach the backend at ${escH(API || location.origin)}.</p>`; }
  }

  // Show the sign-in screen; resolves with the user once they are signed in.
  function requireLogin() {
    if (waiting) return waiting;
    token = ""; sessionStorage.removeItem("fmToken");
    const box = document.getElementById("login");
    box.classList.remove("hidden");
    fillDemoAccounts();
    document.getElementById("loginUser").focus();
    waiting = new Promise(resolve => {
      const form = document.getElementById("loginForm"), err = document.getElementById("loginErr");
      form.onsubmit = async e => {
        e.preventDefault();
        err.classList.add("hidden");
        try {
          const r = await fetch(API + "/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ username: document.getElementById("loginUser").value.trim(),
                                   password: document.getElementById("loginPass").value }) });
          const d = await r.json();
          if (!r.ok) throw new Error(d.error || "Sign-in failed");
          token = d.token; sessionStorage.setItem("fmToken", token);
          user = d.user; box.classList.add("hidden"); waiting = null;
          resolve(user);
        } catch (ex) { err.textContent = ex.message === "Failed to fetch" ? "Can't reach the backend." : ex.message; err.classList.remove("hidden"); }
      };
    });
    return waiting;
  }

  async function logout() {
    try { await fetch(API + "/api/auth/logout", { method: "POST", headers: headers() }); } catch { /* signed out locally anyway */ }
    token = ""; sessionStorage.removeItem("fmToken");
    location.reload();
  }

  // Signed-in user, asking for a login first if needed. Sends each role to the right page.
  async function boot(page) {
    user = (await me()) || (await requireLogin());
    const isDriver = user.role === "driver";
    if (page === "dashboard" && isDriver) { location.replace("driver.html" + location.search); return new Promise(() => {}); }
    if (page === "driver" && !isDriver) { location.replace("index.html" + location.search); return new Promise(() => {}); }
    document.body.dataset.role = user.role;
    const chip = document.getElementById("userChip"), out = document.getElementById("logoutBtn");
    if (chip) { chip.textContent = `${user.name} · ${ROLE_LABEL[user.role] || user.role}`; chip.classList.remove("hidden"); }
    if (out) { out.classList.remove("hidden"); out.onclick = logout; }
    return user;
  }

  return { API, headers, boot, requireLogin, logout, get user() { return user; }, ROLE_LABEL };
})();
