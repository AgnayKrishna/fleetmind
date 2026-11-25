// Where the dashboard finds the FleetMind backend.
// Empty string = same server that serves this page (local run).
// On GitHub Pages this points at the Render backend; anywhere else (local run,
// share.bat) it stays empty so the page talks to the server that served it.
// You can also override it with ?api=https://... in the page URL.
window.FLEET_API_URL = location.hostname.endsWith("github.io")
  ? "https://fleetmind-brr9.onrender.com"
  : "";
