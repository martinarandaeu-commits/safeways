const API_URL = `${window.location.protocol}//${window.location.hostname}:3000/api`;

/* ===============================
   MAPA
================================ */
const CHILE_BOUNDS = L.latLngBounds(
  L.latLng(-56.5, -77.2),
  L.latLng(-17.2, -66.0)
);

const map = L.map('map', {
  zoomControl: false,
  minZoom: 5,
  maxZoom: 19,
  maxBounds: CHILE_BOUNDS,
  maxBoundsViscosity: 1
}).setView([-33.4489, -70.6693], 13);

const TILE_LAYERS = {
  light: 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png',
  dark: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png'
};

const baseTileLayer = L.tileLayer(TILE_LAYERS.light, {
  attribution: 'SafeWays © OpenStreetMap contributors',
  minZoom: 5,
  maxZoom: 19,
  bounds: CHILE_BOUNDS,
  noWrap: true
}).addTo(map);

L.control.zoom({
  position: 'bottomright'
}).addTo(map);

map.createPane('riskHeatPane');
map.getPane('riskHeatPane').style.zIndex = 350;
map.getPane('riskHeatPane').style.pointerEvents = 'none';

/* ===============================
   ESTADO GLOBAL
================================ */
let deviceCoords = null;
let originCoords = null;
let destinationCoords = null;

let originMarker = null;
let destinationMarker = null;
let userMarker = null;

let routeLayers = [];
let heatLayer = null;
let heatFallbackLayer = null;
let availableRoutes = [];
let selectedRouteIndex = null;
let bestRouteIndex = null;

let navigationActive = false;
let followMode = false;
let watchId = null;
let lastRouteRefresh = 0;
let isRefreshingRoute = false;
let navigationInstructions = [];
let lastSpokenAt = 0;
let arrivalAnnounced = false;

const searchTimers = {
  origin: null,
  destination: null,
  heatmap: null
};

const departureState = {
  mode: 'now',
  arrivalDate: '',
  arrivalTime: ''
};

/* ===============================
   DOM
================================ */
const plannerPanel = document.getElementById('plannerPanel');
const menuBtn = document.getElementById('menuBtn');
const settingsBtn = document.getElementById('settingsBtn');

const originInput = document.getElementById('origin-input');
const destInput = document.getElementById('dest-input');

const originResults = document.getElementById('origin-results');
const destResults = document.getElementById('dest-results');

const useGpsBtn = document.getElementById('use-gps-btn');
const swapBtn = document.getElementById('swap-btn');

const calcBtn = document.getElementById('calc-btn');
const startNavBtn = document.getElementById('start-nav-btn');
const followBtn = document.getElementById('follow-btn');

const gpsInfo = document.getElementById('gps-info');

const summaryStrip = document.getElementById('summaryStrip');
const summaryTime = document.getElementById('summary-time');
const summaryDistance = document.getElementById('summary-distance');
const summaryRisk = document.getElementById('summary-risk');

const routesPanel = document.getElementById('routesPanel');
const routesList = document.getElementById('routes-list');

const departureSelector = document.getElementById('departureSelector');
const departureToggle = document.getElementById('departureToggle');
const departureLabel = document.getElementById('departureLabel');
const departureMenu = document.getElementById('departureMenu');
const arrivalDateSelect = document.getElementById('arrivalDateSelect');
const arrivalTimeSelect = document.getElementById('arrivalTimeSelect');
const departureOptions = document.querySelectorAll('.departure-option');

/* ===============================
   HELPERS
================================ */
function formatDistance(meters) {
  return `${(meters / 1000).toFixed(1)} km`;
}

function formatDuration(seconds) {
  return `${Math.round(seconds / 60)} min`;
}

function roundRisk(value) {
  return Number(value || 0).toFixed(2);
}

function normalizeRisk(value) {
  const risk = Number(String(value || 0).replace(',', '.'));
  if (!Number.isFinite(risk) || risk <= 0) return 0;
  if (risk <= 1) return risk;
  if (risk <= 10) return Math.min(risk / 10, 1);
  return Math.min(risk / 100, 1);
}

function getRiskHeatWeight(value) {
  const risk = normalizeRisk(value);

  if (risk < 0.08) return 0;
  if (risk < 0.45) return 0.5;
  if (risk < 0.7) return 0.72;
  return 1;
}

function getRiskHeatColor(weight) {
  if (weight >= 0.72) return '#ff8a8a';
  return '#ffd166';
}

function clearResults(box) {
  box.innerHTML = '';
  box.style.display = 'none';
}

function showLoadingResults(box, text = 'Buscando...') {
  box.innerHTML = `<div class="result-item" style="cursor:default;">${text}</div>`;
  box.style.display = 'block';
}

function createPinIcon(type) {
  return L.divIcon({
    className: `map-pin map-pin--${type}`,
    iconSize: [18, 18],
    iconAnchor: [9, 9]
  });
}

function createMarker(coords, type, popupText) {
  return L.marker(coords, {
    icon: createPinIcon(type)
  }).bindPopup(popupText);
}

function updateStartButtonState() {
  startNavBtn.disabled = !(originCoords && destinationCoords && availableRoutes.length > 0);
}

function setSummaryVisible(visible) {
  summaryStrip.classList.toggle('is-visible', visible);
  routesPanel.classList.toggle('is-visible', visible);
}

function setSummary(route) {
  if (!route) {
    summaryTime.textContent = '--';
    summaryDistance.textContent = '--';
    summaryRisk.textContent = '--';
    return;
  }

  summaryTime.textContent = formatDuration(route.duration);
  summaryDistance.textContent = formatDistance(route.distance);
  summaryRisk.textContent = roundRisk(route.risk_total);
}

function setNavigationSummary(distanceMeters, route) {
  if (!route || !Number.isFinite(distanceMeters)) return;

  const progressRatio = route.distance > 0
    ? Math.max(0, Math.min(1, distanceMeters / route.distance))
    : 0;

  summaryTime.textContent = formatDuration(route.duration * progressRatio);
  summaryDistance.textContent = formatDistance(distanceMeters);
  summaryRisk.textContent = roundRisk(route.risk_total);
}

function getSelectedRoute() {
  return availableRoutes.find(route => route.index === selectedRouteIndex) || null;
}

function fitToSelectedRoute() {
  const layers = [];

  routeLayers.forEach(layer => layers.push(layer));
  if (originMarker) layers.push(originMarker);
  if (destinationMarker) layers.push(destinationMarker);
  if (userMarker && navigationActive) layers.push(userMarker);

  if (!layers.length) return;

  const group = L.featureGroup(layers);
  map.fitBounds(group.getBounds(), { padding: [60, 60] });
}

function setOriginMarker(coords, popupText = 'Origen') {
  if (originMarker) {
    map.removeLayer(originMarker);
  }

  originMarker = createMarker(coords, 'origin', popupText).addTo(map);
}

function setDestinationMarker(coords, popupText = 'Destino') {
  if (destinationMarker) {
    map.removeLayer(destinationMarker);
  }

  destinationMarker = createMarker(coords, 'destination', popupText).addTo(map);
}

function focusLocation(coords, zoom = 16) {
  if (!coords) return;
  map.setView(coords, Math.max(map.getZoom(), zoom), { animate: true });
}

function setUserMarker(coords, popupText = 'Tu ubicación') {
  if (!userMarker) {
    userMarker = createMarker(coords, 'user', popupText).addTo(map);
  } else {
    userMarker.setLatLng(coords);
  }
}

function updateGpsInfo(text) {
  gpsInfo.textContent = text;
}

function canSpeak() {
  return 'speechSynthesis' in window && 'SpeechSynthesisUtterance' in window;
}

function speakInstruction(text, { force = false } = {}) {
  if (!text || !canSpeak()) return;

  const now = Date.now();
  if (!force && now - lastSpokenAt < 3500) return;

  window.speechSynthesis.cancel();

  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = 'es-CL';
  utterance.rate = 1;
  utterance.pitch = 1;
  utterance.volume = 1;

  window.speechSynthesis.speak(utterance);
  lastSpokenAt = now;
}

function getTurnText(maneuver = {}) {
  const { type, modifier } = maneuver;

  if (type === 'arrive') return 'has llegado a tu destino';
  if (type === 'depart') return 'comienza la ruta';
  if (type === 'roundabout' || type === 'rotary') return 'entra en la rotonda';
  if (type === 'merge') return 'incorpórate';
  if (type === 'fork') {
    if (modifier && modifier.includes('left')) return 'mantente a la izquierda';
    if (modifier && modifier.includes('right')) return 'mantente a la derecha';
    return 'mantente en la bifurcación';
  }

  if (modifier === 'left') return 'gira a la izquierda';
  if (modifier === 'right') return 'gira a la derecha';
  if (modifier === 'slight left') return 'gira levemente a la izquierda';
  if (modifier === 'slight right') return 'gira levemente a la derecha';
  if (modifier === 'sharp left') return 'gira pronunciadamente a la izquierda';
  if (modifier === 'sharp right') return 'gira pronunciadamente a la derecha';
  if (modifier === 'straight') return 'continúa recto';
  if (modifier === 'uturn') return 'gira en U';

  return 'continúa';
}

function formatInstructionDistance(meters) {
  if (meters <= 35) return 'ahora';
  return `en ${Math.round(meters / 10) * 10} metros`;
}

function getStepInstruction(step, distanceMeters) {
  const action = getTurnText(step.maneuver);

  if (step.maneuver?.type === 'arrive') {
    return 'has llegado a tu destino';
  }

  return `${formatInstructionDistance(distanceMeters)} ${action}`;
}

function buildNavigationInstructions(route) {
  const steps = (route?.legs || [])
    .flatMap(leg => leg.steps || [])
    .filter(step => (
      step?.maneuver?.location?.length === 2 &&
      step.maneuver.type !== 'depart'
    ));

  return steps.map((step, index) => {
    const [lng, lat] = step.maneuver.location;

    return {
      id: `${index}-${step.maneuver.type || 'step'}-${step.maneuver.modifier || ''}`,
      step,
      coords: [lat, lng],
      announced100: false,
      announced30: false,
      completed: false
    };
  });
}

function resetVoiceNavigation(route) {
  navigationInstructions = buildNavigationInstructions(route);
  lastSpokenAt = 0;
  arrivalAnnounced = false;
}

function updateVoiceNavigation(userCoords) {
  if (!navigationActive || !userCoords || !navigationInstructions.length) return;

  const nextInstruction = navigationInstructions.find(instruction => !instruction.completed);
  if (!nextInstruction) return;

  const distance = map.distance(
    L.latLng(userCoords[0], userCoords[1]),
    L.latLng(nextInstruction.coords[0], nextInstruction.coords[1])
  );

  if (nextInstruction.step.maneuver?.type === 'arrive' && distance < 45) {
    nextInstruction.completed = true;
    if (!arrivalAnnounced) {
      arrivalAnnounced = true;
      speakInstruction('has llegado a tu destino', { force: true });
    }
    return;
  }

  if (distance <= 30 && !nextInstruction.announced30) {
    nextInstruction.announced30 = true;
    nextInstruction.completed = true;
    speakInstruction(getStepInstruction(nextInstruction.step, distance), { force: true });
    return;
  }

  if (distance <= 110 && !nextInstruction.announced100) {
    nextInstruction.announced100 = true;
    speakInstruction(getStepInstruction(nextInstruction.step, 100));
  }
}

function applyTheme(theme) {
  const isDark = theme === 'dark';

  document.body.classList.toggle('theme-dark', isDark);
  baseTileLayer.setUrl(isDark ? TILE_LAYERS.dark : TILE_LAYERS.light);

  if (settingsBtn) {
    settingsBtn.setAttribute('aria-pressed', String(isDark));
    settingsBtn.setAttribute(
      'aria-label',
      isDark ? 'Cambiar a modo claro' : 'Cambiar a modo oscuro'
    );
  }
}

function getStoredTheme() {
  return localStorage.getItem('safeways-theme') || 'light';
}

function toggleTheme() {
  const nextTheme = document.body.classList.contains('theme-dark') ? 'light' : 'dark';
  localStorage.setItem('safeways-theme', nextTheme);
  applyTheme(nextTheme);
}

function getDistanceToDestination(userCoords, destination) {
  if (!userCoords || !destination) return Infinity;
  return map.distance(
    L.latLng(userCoords[0], userCoords[1]),
    L.latLng(destination[0], destination[1])
  );
}

function getNearestDistanceToRoute(userCoords, routeCoords) {
  if (!userCoords || !routeCoords || routeCoords.length === 0) return Infinity;

  let minDistance = Infinity;

  for (let i = 0; i < routeCoords.length; i++) {
    const [lng, lat] = routeCoords[i];
    const d = map.distance(
      L.latLng(userCoords[0], userCoords[1]),
      L.latLng(lat, lng)
    );
    if (d < minDistance) minDistance = d;
  }

  return minDistance;
}

function projectToMeters(lat, lon, refLat) {
  return {
    x: lon * 111320 * Math.cos((refLat * Math.PI) / 180),
    y: lat * 110540
  };
}

function getPointToSegmentDistanceMeters(point, start, end) {
  const refLat = (point.lat + start.lat + end.lat) / 3;
  const p = projectToMeters(point.lat, point.lon, refLat);
  const a = projectToMeters(start.lat, start.lon, refLat);
  const b = projectToMeters(end.lat, end.lon, refLat);

  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const apx = p.x - a.x;
  const apy = p.y - a.y;
  const ab2 = abx * abx + aby * aby;

  if (ab2 === 0) {
    return Math.sqrt((p.x - a.x) ** 2 + (p.y - a.y) ** 2);
  }

  const t = Math.max(0, Math.min(1, (apx * abx + apy * aby) / ab2));
  const closestX = a.x + t * abx;
  const closestY = a.y + t * aby;

  return Math.sqrt((p.x - closestX) ** 2 + (p.y - closestY) ** 2);
}

function getDistanceToRouteMeters(point, routeCoords) {
  if (!routeCoords || routeCoords.length < 2) return Infinity;

  let minDistance = Infinity;

  for (let i = 0; i < routeCoords.length - 1; i++) {
    const [lon1, lat1] = routeCoords[i];
    const [lon2, lat2] = routeCoords[i + 1];
    const distance = getPointToSegmentDistanceMeters(
      point,
      { lat: lat1, lon: lon1 },
      { lat: lat2, lon: lon2 }
    );

    if (distance < minDistance) minDistance = distance;
  }

  return minDistance;
}

function getRemainingDistanceOnRoute(userCoords, routeCoords) {
  if (!userCoords || !routeCoords || routeCoords.length === 0) return Infinity;

  let nearestIndex = 0;
  let nearestDistance = Infinity;

  for (let i = 0; i < routeCoords.length; i++) {
    const [lng, lat] = routeCoords[i];
    const distance = map.distance(
      L.latLng(userCoords[0], userCoords[1]),
      L.latLng(lat, lng)
    );

    if (distance < nearestDistance) {
      nearestDistance = distance;
      nearestIndex = i;
    }
  }

  let remainingDistance = nearestDistance;

  for (let i = nearestIndex; i < routeCoords.length - 1; i++) {
    const [lng1, lat1] = routeCoords[i];
    const [lng2, lat2] = routeCoords[i + 1];

    remainingDistance += map.distance(
      L.latLng(lat1, lng1),
      L.latLng(lat2, lng2)
    );
  }

  return remainingDistance;
}

function formatDateOption(date) {
  const formatter = new Intl.DateTimeFormat('es-CL', {
    weekday: 'short',
    day: 'numeric',
    month: 'short'
  });

  return formatter.format(date).replace('.', '');
}

function formatTimeOption(date) {
  return date.toLocaleTimeString('es-CL', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  });
}

function setSelectOptions(select, values) {
  select.innerHTML = '';

  values.forEach(({ value, label }) => {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = label;
    select.appendChild(option);
  });
}

function setupArrivalSelectors() {
  const now = new Date();
  const dateOptions = [];
  const timeOptions = [];

  for (let i = 0; i < 7; i++) {
    const date = new Date(now);
    date.setDate(now.getDate() + i);
    date.setHours(0, 0, 0, 0);

    dateOptions.push({
      value: date.toISOString().slice(0, 10),
      label: formatDateOption(date)
    });
  }

  const rounded = new Date(now);
  rounded.setMinutes(Math.ceil(now.getMinutes() / 15) * 15, 0, 0);

  for (let i = 0; i < 96; i++) {
    const date = new Date(rounded);
    date.setMinutes(rounded.getMinutes() + i * 15);

    timeOptions.push({
      value: date.toTimeString().slice(0, 5),
      label: formatTimeOption(date)
    });
  }

  setSelectOptions(arrivalDateSelect, dateOptions);
  setSelectOptions(arrivalTimeSelect, timeOptions);

  departureState.arrivalDate = arrivalDateSelect.value;
  departureState.arrivalTime = arrivalTimeSelect.value;
}

function setDepartureMode(mode) {
  departureState.mode = mode;

  departureOptions.forEach(option => {
    option.classList.toggle('is-active', option.dataset.mode === mode);
  });

  if (mode === 'now') {
    departureLabel.textContent = 'Salir ahora';
    departureMenu.classList.remove('is-arrival');
    departureSelector.classList.remove('is-arrival');
    departureSelector.classList.remove('is-open');
    departureToggle.setAttribute('aria-expanded', 'false');
    return;
  }

  departureLabel.textContent = 'Llegar a las';
  departureMenu.classList.add('is-arrival');
  departureSelector.classList.add('is-arrival');
  departureSelector.classList.remove('is-open');
  departureToggle.setAttribute('aria-expanded', 'false');
}

/* ===============================
   HEATMAP
================================ */
function getRoutesBBox(routes, paddingMeters = 180) {
  const coords = routes
    .flatMap(route => route?.geometry?.coordinates || [])
    .filter(Boolean);

  if (!coords.length) return null;

  const lats = coords.map(([, lat]) => lat);
  const lons = coords.map(([lon]) => lon);
  const minLatRaw = Math.min(...lats);
  const maxLatRaw = Math.max(...lats);
  const minLonRaw = Math.min(...lons);
  const maxLonRaw = Math.max(...lons);
  const centerLat = (minLatRaw + maxLatRaw) / 2;
  const latPad = paddingMeters / 110540;
  const lonPad = paddingMeters / (111320 * Math.cos((centerLat * Math.PI) / 180));

  return {
    minLat: minLatRaw - latPad,
    maxLat: maxLatRaw + latPad,
    minLon: minLonRaw - lonPad,
    maxLon: maxLonRaw + lonPad
  };
}

async function fetchRiskHotspots(bbox) {
  if (!bbox) {
    return { code: 'Ok', hotspots: [] };
  }

  const params = new URLSearchParams({
    minLat: bbox.minLat,
    maxLat: bbox.maxLat,
    minLon: bbox.minLon,
    maxLon: bbox.maxLon,
    limit: 3000
  });

  const response = await fetch(`${API_URL}/risk-map/hotspots?${params.toString()}`);
  if (!response.ok) throw new Error('Sin mapa de riesgo');
  return response.json();
}

function normalizeHotspots(hotspots, routes = availableRoutes, corridorMeters = 140) {
  if (!routes.length) return [];

  return (hotspots || [])
    .map(point => {
      const lat = Number(point.lat);
      const lon = Number(point.lon);
      const weight = getRiskHeatWeight(point.riesgo_norm);

      if (
        !Number.isFinite(lat) ||
        !Number.isFinite(lon) ||
        !Number.isFinite(weight) ||
        weight <= 0
      ) {
        return null;
      }

      const distanceToRoutes = Math.min(
        ...routes.map(route => getDistanceToRouteMeters(
          { lat, lon },
          route?.geometry?.coordinates
        ))
      );

      if (!Number.isFinite(distanceToRoutes) || distanceToRoutes > corridorMeters) {
        return null;
      }

      return { lat, lon, weight, distanceToRoutes };
    })
    .filter(Boolean);
}

function drawHeatFallback(points) {
  if (!heatFallbackLayer) {
    heatFallbackLayer = L.layerGroup().addTo(map);
  }

  heatFallbackLayer.clearLayers();

  points.forEach(point => {
    L.circleMarker([point.lat, point.lon], {
      pane: 'riskHeatPane',
      radius: point.weight >= 0.72 ? 13 : 10,
      stroke: false,
      fillColor: getRiskHeatColor(point.weight),
      fillOpacity: point.weight >= 0.72 ? 0.42 : 0.3,
      interactive: false
    }).addTo(heatFallbackLayer);
  });
}

function drawHeatmap(hotspots, routes = availableRoutes) {
  const normalizedPoints = normalizeHotspots(hotspots, routes);
  const heatPoints = normalizedPoints.map(point => [point.lat, point.lon, point.weight]);

  drawHeatFallback(normalizedPoints);

  if (!window.L || !L.heatLayer) return;

  if (!heatLayer) {
    heatLayer = L.heatLayer(heatPoints, {
      pane: 'riskHeatPane',
      radius: 42,
      blur: 18,
      maxZoom: 17,
      minOpacity: 0.38,
      gradient: {
        0.25: '#ffe78a',
        0.55: '#ffd166',
        0.78: '#ffb199',
        1: '#ff7f8a'
      }
    }).addTo(map);
    return;
  }

  heatLayer.setLatLngs(heatPoints);
}

function clearHeatmap() {
  if (heatLayer) {
    heatLayer.setLatLngs([]);
  }
  if (heatFallbackLayer) {
    heatFallbackLayer.clearLayers();
  }
}

async function refreshHeatmapForRoutes(routes = availableRoutes) {
  const routesWithGeometry = routes.filter(route => route?.geometry?.coordinates?.length);

  if (!routesWithGeometry.length) {
    clearHeatmap();
    return;
  }

  try {
    const data = await fetchRiskHotspots(getRoutesBBox(routesWithGeometry));
    drawHeatmap(data.hotspots, routesWithGeometry);
  } catch (error) {
    clearHeatmap();
  }
}

function scheduleHeatmapRefresh() {
  clearTimeout(searchTimers.heatmap);
  searchTimers.heatmap = setTimeout(() => {
    refreshHeatmapForRoutes(availableRoutes);
  }, 350);
}

/* ===============================
   GEOCODING
================================ */
async function searchPlaces(query) {
  const response = await fetch(`${API_URL}/geocode/search?q=${encodeURIComponent(query)}`);
  if (!response.ok) throw new Error('Error de búsqueda');
  return response.json();
}

function bindSearch({ input, box, type }) {
  input.addEventListener('input', () => {
    const query = input.value.trim();
    clearTimeout(searchTimers[type]);

    if (query.length < 3) {
      clearResults(box);
      return;
    }

    showLoadingResults(box, 'Buscando...');

    searchTimers[type] = setTimeout(async () => {
      try {
        const data = await searchPlaces(query);

        box.innerHTML = '';

        if (!data || data.length === 0) {
          box.innerHTML = `<div class="result-item" style="cursor:default;">Sin resultados</div>`;
          box.style.display = 'block';
          return;
        }

        data.forEach((item) => {
          const div = document.createElement('div');
          div.className = 'result-item';
          div.textContent = item.display_name.split(',').slice(0, 3).join(',');

          div.addEventListener('click', () => {
            const coords = [parseFloat(item.lat), parseFloat(item.lon)];
            const shortLabel = item.display_name.split(',').slice(0, 3).join(',');

            if (type === 'origin') {
              originCoords = coords;
              originInput.value = shortLabel;
              setOriginMarker(coords, 'Origen');
            } else {
              destinationCoords = coords;
              destInput.value = shortLabel;
              setDestinationMarker(coords, 'Destino');
            }

            focusLocation(coords, 16);
            clearResults(box);
            updateStartButtonState();
          });

          box.appendChild(div);
        });

        box.style.display = 'block';
      } catch (error) {
        box.innerHTML = `<div class="result-item" style="cursor:default;">Sin conexión</div>`;
        box.style.display = 'block';
      }
    }, 420);
  });
}

/* ===============================
   RUTAS
================================ */
function clearRouteLayers() {
  routeLayers.forEach(layer => map.removeLayer(layer));
  routeLayers = [];
}

function drawRoutes() {
  clearRouteLayers();

  if (!availableRoutes.length) return;

  const selectedRoute = getSelectedRoute();

  availableRoutes
    .filter(route => route.index !== selectedRouteIndex)
    .forEach(route => {
      const layer = L.geoJSON(route.geometry, {
        style: {
          color: '#bfc9cf',
          weight: 6,
          opacity: 0.8,
          lineCap: 'round',
          lineJoin: 'round'
        }
      }).addTo(map);

      routeLayers.push(layer);
    });

  if (selectedRoute) {
    const outline = L.geoJSON(selectedRoute.geometry, {
      style: {
        color: '#ffffff',
        weight: 10,
        opacity: 0.96,
        lineCap: 'round',
        lineJoin: 'round'
      }
    }).addTo(map);

    const main = L.geoJSON(selectedRoute.geometry, {
      style: {
        color: '#00a99d',
        weight: 6,
        opacity: 1,
        lineCap: 'round',
        lineJoin: 'round'
      }
    }).addTo(map);

    routeLayers.push(outline, main);
  }
}

function renderRoutes() {
  routesList.innerHTML = '';

  if (!availableRoutes.length) {
    routesList.innerHTML = `<div class="empty-routes">Sin rutas.</div>`;
    return;
  }

  availableRoutes.forEach((route, idx) => {
    const item = document.createElement('article');
    item.className = `route-item ${route.index === selectedRouteIndex ? 'active' : ''}`;

    item.innerHTML = `
      <div class="route-index">${idx + 1}</div>

      <div class="route-main">
        <div class="route-time-row">
          <div class="route-time">${formatDuration(route.duration)}</div>
          ${route.index === bestRouteIndex ? '<div class="route-badge">Mejor</div>' : ''}
        </div>

        <div class="route-meta">
          <span>${formatDistance(route.distance)}</span>
          <span>${route.critical_points ?? 0} puntos</span>
        </div>
      </div>

      <div class="route-risk">${roundRisk(route.risk_total)}</div>
    `;

    item.addEventListener('click', () => {
      selectedRouteIndex = route.index;
      drawRoutes();
      renderRoutes();
      setSummary(route);

      if (navigationActive) {
        resetVoiceNavigation(route);
      }

      if (!navigationActive) {
        fitToSelectedRoute();
      }
    });

    routesList.appendChild(item);
  });
}

async function fetchSafeRoute(origin, destination) {
  const response = await fetch(`${API_URL}/route/safe`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      origin: {
        lat: origin[0],
        lng: origin[1]
      },
      destination: {
        lat: destination[0],
        lng: destination[1]
      }
    })
  });

  if (!response.ok) {
    throw new Error('Sin ruta');
  }

  return response.json();
}

async function calculateRoutes({ useCurrentOrigin = false, recenter = true } = {}) {
  const activeOrigin = useCurrentOrigin && deviceCoords ? deviceCoords : originCoords;

  if (!activeOrigin || !destinationCoords) {
    updateGpsInfo('Define origen y destino');
    return;
  }

  calcBtn.disabled = true;
  calcBtn.textContent = 'Calculando';

  try {
    const data = await fetchSafeRoute(activeOrigin, destinationCoords);

    if (!data.routes || data.routes.length === 0) {
      routesList.innerHTML = `<div class="empty-routes">Sin alternativas.</div>`;
      setSummaryVisible(true);
      setSummary(null);
      clearHeatmap();
      updateStartButtonState();
      return;
    }

    availableRoutes = data.routes;
    bestRouteIndex = data.best_route_index ?? data.routes[0].index;
    selectedRouteIndex = bestRouteIndex;

    const selectedRoute = getSelectedRoute();

    drawRoutes();
    renderRoutes();
    setSummary(selectedRoute);
    setSummaryVisible(true);
    refreshHeatmapForRoutes(availableRoutes);

    if (navigationActive) {
      resetVoiceNavigation(selectedRoute);
    }

    if (recenter) {
      fitToSelectedRoute();
    }

    updateStartButtonState();
  } catch (error) {
    routesList.innerHTML = `<div class="empty-routes">Sin ruta disponible.</div>`;
    setSummaryVisible(true);
    setSummary(null);
    clearHeatmap();
  } finally {
    calcBtn.disabled = false;
    calcBtn.textContent = 'Ver rutas';
  }
}

/* ===============================
   GPS
================================ */
function setOriginFromCurrentLocation() {
  if (deviceCoords) {
    originCoords = [...deviceCoords];
    originInput.value = 'Tu ubicación';
    setOriginMarker(originCoords, 'Origen actual');
    focusLocation(originCoords, 16);
    updateGpsInfo('Usando ubicación actual');
    updateStartButtonState();
    return;
  }

  if (!navigator.geolocation) {
    updateGpsInfo('Geolocalización no disponible');
    return;
  }

  updateGpsInfo('Obteniendo ubicación...');

  navigator.geolocation.getCurrentPosition(
    (position) => {
      deviceCoords = [position.coords.latitude, position.coords.longitude];
      originCoords = [...deviceCoords];
      originInput.value = 'Tu ubicación';
      setOriginMarker(originCoords, 'Origen actual');
      focusLocation(originCoords, 16);
      updateGpsInfo('Usando ubicación actual');
      updateStartButtonState();
    },
    () => {
      updateGpsInfo('No fue posible obtener la ubicación');
    },
    {
      enableHighAccuracy: true,
      timeout: 10000,
      maximumAge: 0
    }
  );
}

function primeCurrentLocation() {
  if (!navigator.geolocation) {
    updateGpsInfo('Geolocalización no disponible');
    return;
  }

  updateGpsInfo('Solicitando ubicación...');

  navigator.geolocation.getCurrentPosition(
    (position) => {
      deviceCoords = [position.coords.latitude, position.coords.longitude];
      originCoords = [...deviceCoords];
      originInput.value = 'Tu ubicación';
      setOriginMarker(originCoords, 'Origen actual');
      focusLocation(originCoords, 16);
      updateGpsInfo('Ubicación actual lista');
      updateStartButtonState();
    },
    () => {
      updateGpsInfo('Ubicación no definida');
    },
    {
      enableHighAccuracy: true,
      timeout: 10000,
      maximumAge: 30000
    }
  );
}

/* ===============================
   NAVEGACIÓN EN TIEMPO REAL
================================ */
function setFollowButtonVisible(visible) {
  followBtn.classList.toggle('is-visible', visible);
}

function stopNavigation({ cancelSpeech = true } = {}) {
  navigationActive = false;
  followMode = false;
  navigationInstructions = [];
  setFollowButtonVisible(false);
  startNavBtn.textContent = 'Iniciar';
  startNavBtn.classList.remove('is-stopping');
  startNavBtn.disabled = false;

  if (cancelSpeech && canSpeak()) {
    window.speechSynthesis.cancel();
  }

  if (watchId !== null && navigator.geolocation) {
    navigator.geolocation.clearWatch(watchId);
    watchId = null;
  }
}

async function refreshRouteWhileNavigating() {
  if (!navigationActive || !deviceCoords || !destinationCoords) return;
  if (isRefreshingRoute) return;

  isRefreshingRoute = true;

  try {
    originCoords = [...deviceCoords];
    originInput.value = 'Tu ubicación';
    setOriginMarker(originCoords, 'Origen actual');
    await calculateRoutes({ useCurrentOrigin: true, recenter: false });
  } finally {
    isRefreshingRoute = false;
  }
}

function startNavigation() {
  if (!navigator.geolocation) {
    updateGpsInfo('Geolocalización no disponible');
    return;
  }

  if (!destinationCoords) {
    updateGpsInfo('Selecciona un destino');
    return;
  }

  navigationActive = true;
  followMode = true;
  setFollowButtonVisible(true);
  startNavBtn.textContent = 'Detener';
  startNavBtn.classList.add('is-stopping');
  startNavBtn.disabled = false;
  updateGpsInfo('Navegación activa');
  refreshHeatmapForRoutes(availableRoutes);

  const selectedRoute = getSelectedRoute();
  resetVoiceNavigation(selectedRoute);
  speakInstruction('navegación iniciada', { force: true });

  if (watchId !== null) {
    navigator.geolocation.clearWatch(watchId);
    watchId = null;
  }

  watchId = navigator.geolocation.watchPosition(
    async (position) => {
      deviceCoords = [position.coords.latitude, position.coords.longitude];
      setUserMarker(deviceCoords, 'Tu ubicación');

      if (followMode) {
        map.setView(deviceCoords, Math.max(map.getZoom(), 16), { animate: true });
      }

      const selectedRoute = getSelectedRoute();

      if (selectedRoute) {
        updateVoiceNavigation(deviceCoords);

        const remainingDistance = getRemainingDistanceOnRoute(
          deviceCoords,
          selectedRoute.geometry.coordinates
        );

        setNavigationSummary(remainingDistance, selectedRoute);

        const nearestDistance = getNearestDistanceToRoute(
          deviceCoords,
          selectedRoute.geometry.coordinates
        );

        const now = Date.now();

        if (nearestDistance > 75 || now - lastRouteRefresh > 15000) {
          lastRouteRefresh = now;
          await refreshRouteWhileNavigating();
        }
      }

      scheduleHeatmapRefresh();

      const distanceToDestination = getDistanceToDestination(deviceCoords, destinationCoords);

      if (distanceToDestination < 45) {
        updateGpsInfo('Destino alcanzado');
        if (!arrivalAnnounced) {
          arrivalAnnounced = true;
          speakInstruction('has llegado a tu destino', { force: true });
        }
        stopNavigation({ cancelSpeech: false });
      }
    },
    () => {
      updateGpsInfo('Seguimiento interrumpido');
      stopNavigation();
    },
    {
      enableHighAccuracy: true,
      timeout: 10000,
      maximumAge: 1000
    }
  );
}

/* ===============================
   EVENTOS
================================ */
bindSearch({
  input: originInput,
  box: originResults,
  type: 'origin'
});

bindSearch({
  input: destInput,
  box: destResults,
  type: 'destination'
});

if (useGpsBtn) {
  useGpsBtn.addEventListener('click', () => {
    setOriginFromCurrentLocation();
  });
}

if (departureToggle) {
  departureToggle.addEventListener('click', () => {
    const isOpen = departureSelector.classList.toggle('is-open');
    departureToggle.setAttribute('aria-expanded', String(isOpen));
  });
}

departureOptions.forEach(option => {
  option.addEventListener('click', () => {
    setDepartureMode(option.dataset.mode);
  });
});

if (arrivalDateSelect) {
  arrivalDateSelect.addEventListener('change', () => {
    departureState.arrivalDate = arrivalDateSelect.value;
  });
}

if (arrivalTimeSelect) {
  arrivalTimeSelect.addEventListener('change', () => {
    departureState.arrivalTime = arrivalTimeSelect.value;
  });
}

if (swapBtn) {
  swapBtn.addEventListener('click', () => {
    const tempCoords = originCoords;
    const tempValue = originInput.value;

    originCoords = destinationCoords;
    originInput.value = destInput.value;

    destinationCoords = tempCoords;
    destInput.value = tempValue;

    if (originCoords) {
      setOriginMarker(originCoords, 'Origen');
    }
    if (destinationCoords) {
      setDestinationMarker(destinationCoords, 'Destino');
    }

    if (originCoords || destinationCoords) {
      fitToSelectedRoute();
    }

    updateStartButtonState();
  });
}

if (menuBtn) {
  menuBtn.addEventListener('click', () => {
    plannerPanel.classList.toggle('is-minimized');
  });
}

if (settingsBtn) {
  settingsBtn.addEventListener('click', toggleTheme);
}

calcBtn.addEventListener('click', async () => {
  navigationActive = false;
  followMode = false;
  setFollowButtonVisible(false);

  if (watchId !== null && navigator.geolocation) {
    navigator.geolocation.clearWatch(watchId);
    watchId = null;
  }

  await calculateRoutes({ useCurrentOrigin: false, recenter: true });
});

startNavBtn.addEventListener('click', async () => {
  if (navigationActive) {
    updateGpsInfo('Navegación detenida');
    stopNavigation();
    const selectedRoute = getSelectedRoute();
    if (selectedRoute) setSummary(selectedRoute);
    return;
  }

  if (!availableRoutes.length) {
    updateGpsInfo('Calcula una ruta primero');
    return;
  }

  if (!deviceCoords) {
    setOriginFromCurrentLocation();

    setTimeout(async () => {
      if (deviceCoords) {
        originCoords = [...deviceCoords];
        originInput.value = 'Tu ubicación';
        setOriginMarker(originCoords, 'Origen actual');
        await calculateRoutes({ useCurrentOrigin: true, recenter: true });
        startNavigation();
      }
    }, 1200);

    return;
  }

  originCoords = [...deviceCoords];
  originInput.value = 'Tu ubicación';
  setOriginMarker(originCoords, 'Origen actual');

  await calculateRoutes({ useCurrentOrigin: true, recenter: true });
  startNavigation();
});

followBtn.addEventListener('click', () => {
  followMode = !followMode;
  followBtn.textContent = followMode ? 'Siguiendo' : 'Seguir';

  if (followMode && deviceCoords) {
    map.setView(deviceCoords, Math.max(map.getZoom(), 16), { animate: true });
  }
});

document.addEventListener('click', (e) => {
  if (!e.target.closest('.search-box')) {
    clearResults(originResults);
    clearResults(destResults);
  }

  if (departureSelector && !e.target.closest('#departureSelector')) {
    departureSelector.classList.remove('is-open');
    departureToggle.setAttribute('aria-expanded', 'false');
  }
});

/* ===============================
   INIT
================================ */
setSummaryVisible(false);
setSummary(null);
applyTheme(getStoredTheme());
if (arrivalDateSelect && arrivalTimeSelect) {
  setupArrivalSelectors();
}
primeCurrentLocation();
updateStartButtonState();
