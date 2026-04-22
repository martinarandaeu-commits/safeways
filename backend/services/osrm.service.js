const axios = require('axios');

const OSRM_BASE_URL = 'https://router.project-osrm.org/route/v1/driving';
const TARGET_ROUTE_COUNT = 3;
const CANDIDATE_ROUTE_COUNT = 5;
const DETOUR_ROUTE_COUNT = 2;
const BASE_TIMEOUT_MS = 3000;
const DETOUR_TIMEOUT_MS = 800;
const CACHE_TTL_MS = 2 * 60 * 1000;
const routeCache = new Map();

function buildRouteUrl(points) {
  const coordinates = points
    .map(point => `${point.lng},${point.lat}`)
    .join(';');

  return `${OSRM_BASE_URL}/${coordinates}`;
}

async function requestRoutes(
  points,
  alternatives = false,
  timeout = BASE_TIMEOUT_MS,
  steps = false
) {
  const response = await axios.get(buildRouteUrl(points), {
    params: {
      overview: 'full',
      geometries: 'geojson',
      alternatives,
      steps
    },
    timeout
  });

  return response.data;
}

function getCacheKey(origin, destination) {
  return [
    origin.lat.toFixed(4),
    origin.lng.toFixed(4),
    destination.lat.toFixed(4),
    destination.lng.toFixed(4)
  ].join(',');
}

function buildDetourPoints(origin, destination) {
  const latDelta = destination.lat - origin.lat;
  const lngDelta = destination.lng - origin.lng;
  const distanceDegrees = Math.max(Math.sqrt(latDelta ** 2 + lngDelta ** 2), 0.01);
  const baseOffset = Math.min(Math.max(distanceDegrees * 0.45, 0.012), 0.07);
  const length = Math.max(Math.sqrt(latDelta ** 2 + lngDelta ** 2), 0.0001);
  const perpendicular = {
    lat: -lngDelta / length,
    lng: latDelta / length
  };
  const fractions = [0.35, 0.65];
  const offsets = [baseOffset, baseOffset * 1.5];
  const points = [];

  for (const fraction of fractions) {
    const base = {
      lat: origin.lat + latDelta * fraction,
      lng: origin.lng + lngDelta * fraction
    };

    for (const offset of offsets) {
      points.push({
        lat: base.lat + perpendicular.lat * offset,
        lng: base.lng + perpendicular.lng * offset
      });
      points.push({
        lat: base.lat - perpendicular.lat * offset,
        lng: base.lng - perpendicular.lng * offset
      });
    }
  }

  return points;
}

function getRouteSignature(route) {
  const coords = route?.geometry?.coordinates || [];
  if (coords.length === 0) return '';

  const first = coords[0];
  const mid = coords[Math.floor(coords.length / 2)];
  const last = coords[coords.length - 1];

  return [first, mid, last]
    .map(([lng, lat]) => `${lng.toFixed(3)},${lat.toFixed(3)}`)
    .join('|');
}

function addUniqueRoute(routes, seenSignatures, route) {
  const signature = getRouteSignature(route);
  if (!signature || seenSignatures.has(signature)) return false;

  seenSignatures.add(signature);
  routes.push(route);
  return true;
}

const fetchRouteFromOSRM = async (origin, destination) => {
  const cacheKey = getCacheKey(origin, destination);
  const cached = routeCache.get(cacheKey);

  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    return cached.data;
  }

  const detourRequests = buildDetourPoints(origin, destination)
    .slice(0, DETOUR_ROUTE_COUNT)
    .map(waypoint => requestRoutes(
      [origin, waypoint, destination],
      false,
      DETOUR_TIMEOUT_MS,
      false
    ));

  const [baseResult, ...detourResults] = await Promise.allSettled([
    requestRoutes([origin, destination], TARGET_ROUTE_COUNT, BASE_TIMEOUT_MS, false),
    ...detourRequests
  ]);

  if (baseResult.status === 'rejected') {
    throw baseResult.reason;
  }

  const baseData = baseResult.value;
  const routes = [];
  const seenSignatures = new Set();

  for (const route of baseData.routes || []) {
    addUniqueRoute(routes, seenSignatures, route);
  }

  for (const result of detourResults) {
    if (result.status === 'fulfilled') {
      const detourData = result.value;
      const [route] = detourData.routes || [];

      if (route) {
        addUniqueRoute(routes, seenSignatures, route);
      }
    } else {
      console.error('No se pudo generar ruta alternativa con desvio:', result.reason.message);
    }

    if (routes.length >= CANDIDATE_ROUTE_COUNT) break;
  }

  const data = {
    ...baseData,
    routes
  };

  routeCache.set(cacheKey, {
    timestamp: Date.now(),
    data
  });

  return data;
};

module.exports = { fetchRouteFromOSRM };
