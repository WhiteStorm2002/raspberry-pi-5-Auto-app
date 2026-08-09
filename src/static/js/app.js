/* Reise-Navi – Frontend */

let map, marker, routeLayer, poiLayer, favLayer, waypointLayer;
let appConfig = {}, ws = null, lastGps = null;
let navState = null;

const REROUTE = {
  offRouteM: 80,
  minIntervalMs: 15000,
  confirmTicks: 2,
};

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
  waypointLayer = L.layerGroup().addTo(map);

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
  $("btn-quit-app").onclick = () => openModal("modal-quit");
  $("btn-quit-cancel").onclick = () => closeModal("modal-quit");
  $("btn-quit-confirm").onclick = quitApp;
  $("btn-shutdown-pi").onclick = () => openModal("modal-shutdown");
  $("btn-shutdown-cancel").onclick = () => closeModal("modal-shutdown");
  $("btn-shutdown-confirm").onclick = shutdownPi;

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

async function fetchRoute(finalDest, waypoints = []) {
  if (!lastGps?.latitude) return null;

  const res = await fetch("/api/route", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      from_lat: lastGps.latitude,
      from_lon: lastGps.longitude,
      to_lat: finalDest.lat,
      to_lon: finalDest.lon,
      waypoints: waypoints.map((w) => ({ lat: w.lat, lon: w.lon, name: w.name })),
    }),
  });

  if (!res.ok) return null;
  return res.json();
}

async function startNavigation(dest, { fitMap = true, isReroute = false, waypoints = [] } = {}) {
  if (!lastGps?.latitude) { alert("Kein GPS-Signal."); return false; }

  const route = await fetchRoute(dest, waypoints);
  if (!route) {
    if (!isReroute) alert("Route nicht gefunden.");
    return false;
  }

  applyRoute(route, dest, { fitMap, isReroute, waypoints });
  return true;
}

function drawWaypointMarkers(waypoints) {
  waypointLayer.clearLayers();
  waypoints.forEach((wp, index) => {
    L.marker([wp.lat, wp.lon], {
      icon: L.divIcon({
        className: "waypoint-marker",
        html: `<div style="background:#f39c12;color:#0b0f16;border-radius:50%;width:26px;height:26px;display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:700;border:2px solid #fff">${index + 1}</div>`,
        iconSize: [26, 26],
      }),
    })
      .bindPopup(`<strong>Zwischenstopp ${index + 1}</strong><br>${escHtml(wp.name || "Stopp")}`)
      .addTo(waypointLayer);
  });
}

function applyRoute(route, finalDest, { fitMap = true, isReroute = false, waypoints = [] } = {}) {
  const prev = navState || {};
  const routeCoords = extractRouteCoords(route.geometry);
  const steps = enrichSteps(route.steps || [], routeCoords);

  navState = {
    route: { ...route, steps },
    finalDestination: finalDest,
    waypoints: [...waypoints],
    destination: finalDest,
    eta: route.eta_local,
    routeCoords,
    lastRerouteAt: isReroute ? Date.now() : (prev.lastRerouteAt || 0),
    rerouting: false,
    offRouteCount: 0,
  };

  if (routeLayer) map.removeLayer(routeLayer);
  routeLayer = L.geoJSON(route.geometry, {
    style: { color: appConfig.accent_color || "#0044cc", weight: 5, opacity: 0.85 },
  }).addTo(map);

  drawWaypointMarkers(waypoints);

  if (fitMap) map.fitBounds(routeLayer.getBounds(), { padding: [40, 40] });

  $("eta").textContent = route.eta_local;
  $("eta-widget").classList.remove("hidden");
  $("btn-stop-nav").classList.remove("hidden");
  $("nav-banner").classList.remove("hidden");

  if (isReroute) {
    navState.rerouteMsgUntil = Date.now() + 5000;
  }

  if (lastGps?.latitude != null) {
    updateNavInstruction(lastGps.latitude, lastGps.longitude);
  }
}

function extractRouteCoords(geometry) {
  if (!geometry?.coordinates?.length) return [];
  return geometry.coordinates.map(([lon, lat]) => [lat, lon]);
}

async function startNavigationTo(lat, lon, name, { forceNew = false } = {}) {
  const hasActiveRoute = navState?.finalDestination && !forceNew;

  if (hasActiveRoute) {
    const waypoints = [...(navState.waypoints || [])];
    const duplicate = waypoints.some((w) => distM(w.lat, w.lon, lat, lon) < 80);
    if (!duplicate) {
      waypoints.push({ lat, lon, name: name || "Zwischenstopp" });
    }

    const ok = await startNavigation(navState.finalDestination, {
      fitMap: false,
      waypoints,
    });

    if (ok) {
      showInfoBanner(`Zwischenstopp hinzugefügt: ${name || "Stopp"} – Route zum Ziel bleibt.`);
    } else {
      showInfoBanner("Zwischenstopp konnte nicht gesetzt werden.", true);
    }
  } else {
    await startNavigation({ lat, lon, name }, { waypoints: [] });
  }

  closeModal("modal-favorites");
  map.closePopup();
}

function stopNavigation() {
  navState = null;
  if (routeLayer) { map.removeLayer(routeLayer); routeLayer = null; }
  waypointLayer.clearLayers();
  $("eta-widget").classList.add("hidden");
  $("btn-stop-nav").classList.add("hidden");
  $("nav-banner").classList.add("hidden");
}

function updateNavigation(pos) {
  if (!navState || navState.rerouting) return;
  const steps = navState.route.steps || [];
  if (!steps.length) return;

  const [lat, lon] = pos;
  checkReroute(lat, lon);
  updateNavInstruction(lat, lon);
  map.panTo(pos, { animate: true, duration: 0.5 });

  const dest = navState.finalDestination || navState.destination;
  if (distM(lat, lon, dest.lat, dest.lon) < 35) {
    $("nav-distance").textContent = "🎉 Ziel erreicht!";
    $("nav-instruction").textContent = dest.name || "Du bist angekommen.";
    $("nav-icon").textContent = "🏁";
  }
}

async function checkReroute(lat, lon) {
  if (!navState?.routeCoords?.length) return;

  const now = Date.now();
  if (now - navState.lastRerouteAt < REROUTE.minIntervalMs) return;

  const distToRoute = distanceToRoute(lat, lon, navState.routeCoords);
  if (distToRoute > REROUTE.offRouteM) {
    navState.offRouteCount += 1;
  } else {
    navState.offRouteCount = 0;
    return;
  }

  if (navState.offRouteCount < REROUTE.confirmTicks) return;

  navState.rerouting = true;
  navState.offRouteCount = 0;
  $("nav-distance").textContent = "↻";
  $("nav-instruction").textContent = "Route wird neu berechnet …";

  try {
    await startNavigation(navState.finalDestination, {
      fitMap: false,
      isReroute: true,
      waypoints: navState.waypoints || [],
    });
  } finally {
    if (navState) navState.rerouting = false;
  }
}

function distanceToRoute(lat, lon, coords) {
  let min = Infinity;
  for (let i = 0; i < coords.length - 1; i++) {
    const [lat1, lon1] = coords[i];
    const [lat2, lon2] = coords[i + 1];
    min = Math.min(min, distToSegment(lat, lon, lat1, lon1, lat2, lon2));
  }
  return min;
}

function distToSegment(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  if (dx === 0 && dy === 0) return distM(px, py, ax, ay);

  let t = ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy);
  t = Math.max(0, Math.min(1, t));
  return distM(px, py, ax + t * dx, ay + t * dy);
}

const ANNOUNCE_DISTANCES = [1000, 750, 500, 250, 100, 50];
const COMBINE_MANEUVER_M = 150;

function enrichSteps(steps, routeCoords) {
  return steps.map((step) => ({
    ...step,
    routeDistM: step.lat != null && step.lon != null
      ? distanceAlongRouteToPoint(step.lat, step.lon, routeCoords)
      : 0,
  }));
}

function distanceAlongRouteToPoint(lat, lon, coords) {
  if (!coords.length) return 0;
  let total = 0;
  let bestDist = Infinity;
  let bestAlong = 0;

  for (let i = 0; i < coords.length - 1; i++) {
    const [aLat, aLon] = coords[i];
    const [bLat, bLon] = coords[i + 1];
    const segLen = distM(aLat, aLon, bLat, bLon);
    const off = distToSegment(lat, lon, aLat, aLon, bLat, bLon);

    if (off < bestDist) {
      bestDist = off;
      const dx = bLon - aLon;
      const dy = bLat - aLat;
      let t = 0;
      if (dx !== 0 || dy !== 0) {
        t = ((lon - aLon) * dx + (lat - aLat) * dy) / (dx * dx + dy * dy);
        t = Math.max(0, Math.min(1, t));
      }
      bestAlong = total + segLen * t;
    }
    total += segLen;
  }
  return bestAlong;
}

function isMeaningfulManeuver(step) {
  if (!step || step.type === "depart") return false;
  if (step.type === "arrive") return true;
  if (["continue", "new name"].includes(step.type) && !step.modifier) return false;
  return true;
}

function findNextManeuver(steps, progressM) {
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    if (!isMeaningfulManeuver(step)) continue;
    if (step.routeDistM > progressM + 12) {
      return { index: i, step, distM: step.routeDistM - progressM };
    }
  }
  const last = steps[steps.length - 1];
  return { index: steps.length - 1, step: last, distM: 0 };
}

function findCombinedManeuver(steps, primaryIdx) {
  const primary = steps[primaryIdx];
  if (!primary) return null;

  for (let j = primaryIdx + 1; j < steps.length; j++) {
    const next = steps[j];
    if (next.type === "arrive") break;
    if (!isMeaningfulManeuver(next)) continue;

    const gap = next.routeDistM - primary.routeDistM;
    if (gap > COMBINE_MANEUVER_M) break;
    return next;
  }
  return null;
}

function stepDirectionShort(step) {
  if (!step) return "weiterfahren";
  const mod = step.modifier || "";
  const map = {
    left: "links",
    right: "rechts",
    straight: "geradeaus",
    "slight left": "leicht links",
    "slight right": "leicht rechts",
    "sharp left": "scharf links",
    "sharp right": "scharf rechts",
    uturn: "wenden",
  };
  if (map[mod]) return `${map[mod]} abbiegen`;
  if (step.type === "roundabout" || step.type === "rotary") return "in den Kreisverkehr fahren";
  if (step.type === "off ramp") return "Ausfahrt nehmen";
  return stepDirection(step);
}

function buildManeuverText(steps, primaryIdx) {
  const primary = steps[primaryIdx];
  const combined = findCombinedManeuver(steps, primaryIdx);

  if (combined) {
    const first = stepDirection(primary);
    const second = stepDirectionShort(combined);
    return `${first.charAt(0).toUpperCase() + first.slice(1)}, dann ${second}`;
  }

  const dir = stepDirection(primary);
  return dir.charAt(0).toUpperCase() + dir.slice(1);
}

function formatAnnounceDistance(meters) {
  if (meters < 50) return "Jetzt";
  for (const threshold of ANNOUNCE_DISTANCES) {
    if (meters >= threshold) return `In ${threshold} m`;
  }
  return "Jetzt";
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
  return formatAnnounceDistance(meters);
}

function updateNavInstruction(lat, lon) {
  if (!navState) return;
  const steps = navState.route.steps;
  const progressM = distanceAlongRouteToPoint(lat, lon, navState.routeCoords);
  const { index, step, distM } = findNextManeuver(steps, progressM);

  const instruction = buildManeuverText(steps, index);
  const combined = findCombinedManeuver(steps, index);

  $("nav-distance").textContent = step.type === "arrive"
    ? "Fast da"
    : formatAnnounceDistance(distM);
  $("nav-instruction").textContent = instruction;
  $("nav-icon").textContent = combined ? "↱" : stepIcon(step);

  if (navState.rerouteMsgUntil && Date.now() < navState.rerouteMsgUntil) {
    $("nav-meta").textContent = `↻ Route angepasst · ${navState.route.distance_km} km · Ankunft ${navState.eta}`;
  } else {
    let meta = `${navState.route.distance_km} km · ca. ${navState.route.duration_min} Min · Ankunft ${navState.eta}`;
    if (navState.waypoints?.length) {
      const nextWp = navState.waypoints[0]?.name || "Zwischenstopp";
      meta = `über ${nextWp} · ${meta}`;
    }
    $("nav-meta").textContent = meta;
  }
}

// ── POI ──

function showInfoBanner(message, isError = false) {
  const banner = $("traffic-banner");
  banner.textContent = message;
  banner.classList.toggle("severe", isError);
  banner.classList.remove("hidden");
  clearTimeout(showInfoBanner._timer);
  showInfoBanner._timer = setTimeout(() => banner.classList.add("hidden"), 6000);
}

async function showPoi(type) {
  if (!lastGps?.latitude) {
    showInfoBanner("Kein GPS-Signal – POI-Suche nicht möglich.", true);
    return;
  }

  const label = type === "fuel" ? "Tankstellen" : "Rastplätze";
  showInfoBanner(`${label} werden gesucht …`);

  poiLayer.clearLayers();

  let data;
  try {
    const res = await fetch(
      `/api/poi/${type}?lat=${lastGps.latitude}&lon=${lastGps.longitude}`
    );
    if (!res.ok) throw new Error("api");
    data = await res.json();
  } catch {
    showInfoBanner(`${label}: Fehler bei der Suche. Internet prüfen.`, true);
    return;
  }

  const icon = type === "fuel" ? "⛽" : "🅿️";

  if (!data.items?.length) {
    showInfoBanner(`Keine ${label} in der Nähe gefunden (10 km Radius).`, true);
    return;
  }

  data.items.forEach((item) => {
    const marker = L.marker([item.lat, item.lon], {
      icon: L.divIcon({
        className: "poi-marker",
        html: `<div style="font-size:22px">${icon}</div>`,
        iconSize: [28, 28],
      }),
    });

    const dist = formatDist(distM(lastGps.latitude, lastGps.longitude, item.lat, item.lon));
    const btnLabel = navState?.finalDestination ? "Als Zwischenstopp" : "Route starten";
    marker.bindPopup(`
      <div class="poi-popup">
        <strong>${escHtml(item.name)}</strong><br>
        <span style="color:#8b95a8;font-size:0.85rem">${dist} entfernt</span><br>
        <button class="poi-route-btn" style="margin-top:8px;padding:10px 16px;border-radius:10px;border:none;background:#0044cc;color:#fff;font-size:15px;cursor:pointer;width:100%">${btnLabel}</button>
      </div>
    `);

    marker.on("popupopen", (e) => {
      const btn = e.popup.getElement()?.querySelector(".poi-route-btn");
      if (btn) {
        btn.onclick = () => {
          map.closePopup();
          startNavigationTo(item.lat, item.lon, item.name);
        };
      }
    });

    marker.addTo(poiLayer);
  });

  showInfoBanner(`${data.items.length} ${label} gefunden – Marker auf der Karte.`);

  const bounds = L.latLngBounds(data.items.map((i) => [i.lat, i.lon]));
  bounds.extend([lastGps.latitude, lastGps.longitude]);
  map.fitBounds(bounds, { padding: [30, 30] });
}

function escHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

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

// ── App beenden / Pi ausschalten ──

async function quitApp() {
  closeModal("modal-quit");
  try {
    await fetch("/api/shutdown/app", { method: "POST" });
  } catch { /* Server beendet sich */ }
  window.close();
  document.body.innerHTML =
    '<div style="display:flex;align-items:center;justify-content:center;height:100vh;font-size:1.4rem;color:#e8edf7;background:#0b0f16">App beendet – Fenster schließen</div>';
}

async function shutdownPi() {
  $("shutdown-status").textContent = "Pi fährt herunter …";
  $("shutdown-status").classList.remove("hidden");
  $("btn-shutdown-confirm").disabled = true;

  try {
    const res = await fetch("/api/shutdown/system", { method: "POST" });
    if (!res.ok) throw new Error("failed");
    document.body.innerHTML =
      '<div style="display:flex;align-items:center;justify-content:center;height:100vh;font-size:1.4rem;color:#e8edf7;background:#0b0f16;text-align:center;padding:24px">⏻ Pi fährt herunter …<br><br><span style="font-size:1rem;color:#8b95a8">Erst vom Strom trennen, wenn die LEDs aus sind.</span></div>';
  } catch {
    $("shutdown-status").textContent = "Fehler – bitte install-pi.sh erneut ausführen.";
    $("btn-shutdown-confirm").disabled = false;
  }
}

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
