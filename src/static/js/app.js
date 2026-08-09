/* Reise-Navi – Frontend */

let map, marker, routeLayer, poiLayer, favLayer;
let appConfig = {}, ws = null, lastGps = null;
let navState = null; // { route, stepIndex, destination, eta }

const $ = (id) => document.getElementById(id);

const TILE_LAYERS = {
  carto_dark: {
    url: "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png",
    options: {
      attribution: '&copy; OSM &copy; CARTO',
      subdomains: "abcd", maxZoom: 19,
    },
  },
  osm: {
    url: "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
    options: { attribution: '&copy; OSM', maxZoom: 19 },
  },
};

const CAT_LABELS = { hotel: "Unterkunft", shop: "Einkaufen", park: "Parkplatz", other: "Sonstiges" };

// ── Init ──

async function init() {
  const res = await fetch("/api/config");
  appConfig = await res.json();
  document.documentElement.style.setProperty("--accent", appConfig.accent_color || "#0044cc");
  document.documentElement.style.setProperty("--radius", `${appConfig.border_radius || 16}px`);
  document.title = appConfig.window_title || "Reise-Navi";

  initMap();
  bindButtons();
  startClock();
  loadFavoritesOnMap();
  connectWebSocket();
}

function initMap() {
  const center = [appConfig.default_lat || 48.137, appConfig.default_lon || 11.576];
  map = L.map("map", { center, zoom: appConfig.default_zoom || 15, zoomControl: true });
  const prov = TILE_LAYERS[appConfig.tile_provider] || TILE_LAYERS.carto_dark;
  L.tileLayer(prov.url, prov.options).addTo(map);

  poiLayer = L.layerGroup().addTo(map);
  favLayer = L.layerGroup().addTo(map);

  marker = L.circleMarker(center, {
    radius: 11, fillColor: appConfig.accent_color || "#0044cc",
    color: "#fff", weight: 2, fillOpacity: 1,
  }).addTo(map);
}

function bindButtons() {
  $("btn-destination").onclick = () => openModal("modal-destination");
  $("btn-favorites").onclick = () => { openFavorites(); openModal("modal-favorites"); };
  $("btn-save-fav").onclick = () => openModal("modal-save");
  $("btn-fuel").onclick = () => showPoi("fuel");
  $("btn-rest").onclick = () => showPoi("rest");
  $("btn-stop-nav").onclick = stopNavigation;

  $("btn-dest-cancel").onclick = () => closeModal("modal-destination");
  $("btn-dest-search").onclick = searchDestination;
  $("btn-fav-close").onclick = () => closeModal("modal-favorites");
  $("btn-save-cancel").onclick = () => closeModal("modal-save");
  $("btn-save-confirm").onclick = saveFavorite;

  $("dest-input").addEventListener("keydown", (e) => {
    if (e.key === "Enter") searchDestination();
  });
}

// ── WebSocket / Status ──

function connectWebSocket() {
  const proto = location.protocol === "https:" ? "wss:" : "ws:";
  ws = new WebSocket(`${proto}//${location.host}/ws`);
  ws.onmessage = (e) => updateUI(JSON.parse(e.data));
  ws.onclose = () => setTimeout(connectWebSocket, 2000);
}

function updateUI(data) {
  lastGps = data.gps || {};
  const limit = data.speed_limit || {};
  const tol = appConfig.speed_warning_tolerance || 5;

  $("current-speed").textContent = lastGps.speed_kmh != null ? Math.round(lastGps.speed_kmh) : "—";
  $("speed-limit").textContent = limit.limit_kmh != null ? limit.limit_kmh : "—";

  const over = data.speed_warning ||
    (lastGps.speed_kmh != null && limit.limit_kmh != null && lastGps.speed_kmh > limit.limit_kmh + tol);
  $("current-speed-card").classList.toggle("over-limit", over);

  if (data.weather?.temperature_c != null) {
    $("weather").textContent = `${Math.round(data.weather.temperature_c)}°C`;
  }

  updateGpsStatus(lastGps);
  updateTrafficBanner(data.traffic || []);

  if (lastGps.latitude != null && lastGps.longitude != null) {
    const pos = [lastGps.latitude, lastGps.longitude];
    marker.setLatLng(pos);
    if (navState) {
      updateNavigation(pos);
    } else {
      map.panTo(pos, { animate: true, duration: 0.5 });
    }
  }
}

function updateGpsStatus(gps) {
  const el = $("gps-status");
  el.classList.remove("active", "searching", "error");
  const labels = { none: "Kein GPS", searching: "GPS …", "2d": "GPS 2D", "3d": "GPS OK", error: "GPS Fehler" };
  $("gps-status-text").textContent = labels[gps.fix_quality] || "GPS …";
  if (gps.fix_quality === "3d" || gps.fix_quality === "2d") el.classList.add("active");
  else if (gps.fix_quality === "error") el.classList.add("error");
  else el.classList.add("searching");
}

function updateTrafficBanner(warnings) {
  const banner = $("traffic-banner");
  if (!warnings.length) { banner.classList.add("hidden"); return; }

  const top = warnings[0];
  const dist = top.distance_m ? ` (${formatDist(top.distance_m)})` : "";
  banner.textContent = `⚠ ${top.message}${dist}`;
  banner.classList.toggle("severe", top.severity === "high");
  banner.classList.remove("hidden");
}

// ── Clock ──

function startClock() {
  const tick = () => {
    $("clock").textContent = new Date().toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" });
  };
  tick();
  setInterval(tick, 10000);
}

// ── Navigation ──

async function searchDestination() {
  const query = $("dest-input").value.trim();
  if (!query) return;

  $("dest-status").textContent = "Suche …";

  try {
    const geoRes = await fetch(
      `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(query)}`,
      { headers: { "Accept-Language": "de" } }
    );
    const results = await geoRes.json();
    if (!results.length) {
      $("dest-status").textContent = "Ort nicht gefunden.";
      return;
    }

    const dest = { lat: parseFloat(results[0].lat), lon: parseFloat(results[0].lon), name: results[0].display_name };
    await startNavigation(dest);
    closeModal("modal-destination");
  } catch {
    $("dest-status").textContent = "Fehler bei der Suche.";
  }
}

async function startNavigation(dest) {
  if (!lastGps?.latitude) { alert("Kein GPS-Signal."); return; }

  const res = await fetch("/api/route", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      from_lat: lastGps.latitude, from_lon: lastGps.longitude,
      to_lat: dest.lat, to_lon: dest.lon,
    }),
  });

  if (!res.ok) { alert("Route nicht gefunden."); return; }
  const route = await res.json();

  navState = { route, stepIndex: 0, destination: dest, eta: route.eta_local };

  if (routeLayer) map.removeLayer(routeLayer);
  routeLayer = L.geoJSON(route.geometry, {
    style: { color: appConfig.accent_color || "#0044cc", weight: 5, opacity: 0.85 },
  }).addTo(map);
  map.fitBounds(routeLayer.getBounds(), { padding: [40, 40] });

  $("eta").textContent = route.eta_local;
  $("eta-widget").classList.remove("hidden");
  $("btn-stop-nav").classList.remove("hidden");
  $("nav-banner").classList.remove("hidden");
  updateNavInstruction(lastGps.latitude, lastGps.longitude);
}

async function startNavigationTo(lat, lon, name) {
  await startNavigation({ lat, lon, name });
  closeModal("modal-favorites");
}

function stopNavigation() {
  navState = null;
  if (routeLayer) { map.removeLayer(routeLayer); routeLayer = null; }
  $("eta-widget").classList.add("hidden");
  $("btn-stop-nav").classList.add("hidden");
  $("nav-banner").classList.add("hidden");
}

function updateNavigation(pos) {
  if (!navState) return;
  const steps = navState.route.steps || [];
  if (!steps.length) return;

  const [lat, lon] = pos;
  let idx = navState.stepIndex;

  while (idx < steps.length - 1) {
    const step = steps[idx];
    if (step.lat != null && distM(lat, lon, step.lat, step.lon) < 40) idx++;
    else break;
  }
  navState.stepIndex = idx;
  updateNavInstruction(lat, lon);

  if (idx === steps.length - 1 && distM(lat, lon, navState.destination.lat, navState.destination.lon) < 30) {
    $("nav-distance").textContent = "🎉 Ziel erreicht!";
    $("nav-instruction").textContent = navState.destination.name || "Du bist angekommen.";
    $("nav-icon").textContent = "🏁";
  }
}

function getUpcomingStep(steps, idx) {
  for (let i = idx; i < steps.length; i++) {
    if (steps[i].type === "depart") continue;
    return { step: steps[i], index: i };
  }
  return { step: steps[steps.length - 1], index: steps.length - 1 };
}

function stepDirection(step) {
  if (!step) return "weiterfahren";
  if (step.type === "arrive") return "am Ziel ankommen";

  const mod = step.modifier || "";
  const map = {
    left: "links abbiegen",
    right: "rechts abbiegen",
    straight: "geradeaus fahren",
    "slight left": "leicht links halten",
    "slight right": "leicht rechts halten",
    "sharp left": "scharf links abbiegen",
    "sharp right": "scharf rechts abbiegen",
    uturn: "wenden",
  };
  if (map[mod]) return map[mod];

  if (step.type === "roundabout" || step.type === "rotary") return "in den Kreisverkehr fahren";
  if (step.type === "off ramp") return "Ausfahrt nehmen";
  if (step.type === "on ramp") return "Auffahrt nehmen";
  if (step.type === "merge") return "einfädeln";
  if (step.type === "fork") return "an der Gabelung halten";
  if (step.type === "continue" || step.type === "new name") return "geradeaus fahren";

  return (step.instruction || "weiterfahren").toLowerCase();
}

function stepIcon(step) {
  if (!step) return "➤";
  if (step.type === "arrive") return "🏁";
  const mod = step.modifier || "";
  if (mod.includes("left")) return "↰";
  if (mod.includes("right")) return "↱";
  if (step.type === "roundabout" || step.type === "rotary") return "⟳";
  if (mod === "uturn") return "↩";
  return "➤";
}

function formatDistanceLabel(meters) {
  if (meters < 80) return "Jetzt";
  if (meters < 1000) {
    const rounded = Math.round(meters / 10) * 10;
    return `In ${rounded} m`;
  }
  return `In ${(meters / 1000).toFixed(1)} km`;
}

function updateNavInstruction(lat, lon) {
  if (!navState) return;
  const steps = navState.route.steps;
  const { step } = getUpcomingStep(steps, navState.stepIndex);

  let distanceM = 0;
  if (lat != null && lon != null && step?.lat != null && step?.lon != null) {
    distanceM = distM(lat, lon, step.lat, step.lon);
  }

  const direction = stepDirection(step);
  $("nav-distance").textContent = step.type === "arrive"
    ? "Fast da"
    : formatDistanceLabel(distanceM);
  $("nav-instruction").textContent = direction.charAt(0).toUpperCase() + direction.slice(1);
  $("nav-icon").textContent = stepIcon(step);
  $("nav-meta").textContent = `${navState.route.distance_km} km · ca. ${navState.route.duration_min} Min · Ankunft ${navState.eta}`;
}

// ── POI ──

async function showPoi(type) {
  if (!lastGps?.latitude) { alert("Kein GPS-Signal."); return; }

  poiLayer.clearLayers();
  const res = await fetch(`/api/poi/${type}?lat=${lastGps.latitude}&lon=${lastGps.longitude}`);
  const data = await res.json();
  const icon = type === "fuel" ? "⛽" : "🅿️";

  data.items.forEach((item) => {
    L.marker([item.lat, item.lon], {
      icon: L.divIcon({
        className: "poi-marker",
        html: `<div style="font-size:22px">${icon}</div>`,
        iconSize: [28, 28],
      }),
    })
      .bindPopup(`<div class="poi-popup"><strong>${item.name}</strong><br><button onclick="navigateToPoi(${item.lat},${item.lon},'${esc(item.name)}')" style="margin-top:6px;padding:8px 14px;border-radius:8px;border:none;background:#0044cc;color:#fff;font-size:14px;cursor:pointer">Route</button></div>`)
      .addTo(poiLayer);
  });

  if (data.items.length) {
    const bounds = L.latLngBounds(data.items.map((i) => [i.lat, i.lon]));
    bounds.extend([lastGps.latitude, lastGps.longitude]);
    map.fitBounds(bounds, { padding: [30, 30] });
  }
}

window.navigateToPoi = (lat, lon, name) => startNavigationTo(lat, lon, name);

// ── Favoriten ──

async function loadFavoritesOnMap() {
  favLayer.clearLayers();
  const res = await fetch("/api/favorites");
  const data = await res.json();

  data.items.forEach((fav) => {
    L.marker([fav.lat, fav.lon], {
      icon: L.divIcon({
        className: "fav-marker",
        html: `<div style="background:#0044cc;color:#fff;border-radius:50%;width:28px;height:28px;display:flex;align-items:center;justify-content:center;font-size:14px;border:2px solid #fff">⭐</div>`,
        iconSize: [28, 28],
      }),
    }).bindPopup(`<strong>${fav.name}</strong>`).addTo(favLayer);
  });
}

async function openFavorites() {
  const res = await fetch("/api/favorites");
  const data = await res.json();
  const list = $("fav-list");

  if (!data.items.length) {
    list.innerHTML = '<p class="hint">Noch keine Favoriten. „Hier speichern" nutzen.</p>';
    return;
  }

  list.innerHTML = data.items.map((f) => `
    <div class="fav-item">
      <div class="fav-info">
        <div class="fav-name">${esc(f.name)}</div>
        <div class="fav-cat">${CAT_LABELS[f.category] || f.category}</div>
      </div>
      <div class="fav-actions">
        <button class="btn btn-primary btn-small" onclick="startNavigationTo(${f.lat},${f.lon},'${esc(f.name)}')">Route</button>
        <button class="btn btn-small" onclick="deleteFavorite('${f.id}')">✕</button>
      </div>
    </div>
  `).join("");
}

async function saveFavorite() {
  const name = $("save-name").value.trim();
  if (!name || !lastGps?.latitude) return;

  await fetch("/api/favorites", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name, lat: lastGps.latitude, lon: lastGps.longitude,
      category: $("save-category").value,
    }),
  });

  $("save-name").value = "";
  closeModal("modal-save");
  loadFavoritesOnMap();
}

window.deleteFavorite = async (id) => {
  await fetch(`/api/favorites/${id}`, { method: "DELETE" });
  openFavorites();
  loadFavoritesOnMap();
};

window.startNavigationTo = startNavigationTo;

// ── Helpers ──

function openModal(id) { $(id).classList.remove("hidden"); }
function closeModal(id) { $(id).classList.add("hidden"); }

function distM(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const toR = (d) => (d * Math.PI) / 180;
  const dLat = toR(lat2 - lat1), dLon = toR(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toR(lat1)) * Math.cos(toR(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function formatDist(m) {
  return m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${m} m`;
}

function esc(s) {
  return s.replace(/'/g, "\\'").replace(/"/g, "&quot;");
}

init();
