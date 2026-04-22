const { supabaseAdmin } = require('./supabase.service');
const { minDistanceToPolylineMeters, buildRouteBBox } = require('../utils/geo');

function buildRoutesBBox(routes, paddingMeters = 120) {
  const boxes = routes
    .map(route => buildRouteBBox(route.geometry.coordinates, paddingMeters))
    .filter(Boolean);

  return {
    minLat: Math.min(...boxes.map(box => box.minLat)),
    maxLat: Math.max(...boxes.map(box => box.maxLat)),
    minLon: Math.min(...boxes.map(box => box.minLon)),
    maxLon: Math.max(...boxes.map(box => box.maxLon))
  };
}

function calculateRiskFromPoints(routeCoords, routeDistanceMeters, points) {
  let riesgoTotal = 0;
  let puntosCercanos = 0;

  for (const point of points || []) {
    const pointLat = Number(point.lat);
    const pointLon = Number(point.lon);
    const riesgoNorm = Number(point.riesgo_norm || 0);

    if (Number.isNaN(pointLat) || Number.isNaN(pointLon)) continue;

    const distance = minDistanceToPolylineMeters(
      { lat: pointLat, lon: pointLon },
      routeCoords
    );

    if (distance <= 120) {
      puntosCercanos++;
      riesgoTotal += riesgoNorm * Math.exp(-distance / 40);
    }
  }

  const distanceKm = routeDistanceMeters / 1000;
  const riesgoPorKm = distanceKm > 0 ? riesgoTotal / distanceKm : 0;

  return {
    riesgo_total: Number(riesgoTotal.toFixed(4)),
    puntos_cercanos: puntosCercanos,
    riesgo_por_km: Number(riesgoPorKm.toFixed(4))
  };
}

async function calculateRouteRisk(routeCoords, routeDistanceMeters = 1) {
  const { minLat, maxLat, minLon, maxLon } = buildRouteBBox(routeCoords, 120);

  const { data, error } = await supabaseAdmin
    .from('puntos_criticos')
    .select('lat, lon, riesgo_norm')
    .gte('lat', minLat)
    .lte('lat', maxLat)
    .gte('lon', minLon)
    .lte('lon', maxLon)
    .limit(2000);

  if (error) {
    console.error('Error Supabase:', error);
    throw new Error('No se pudo consultar Supabase.');
  }

  return calculateRiskFromPoints(routeCoords, routeDistanceMeters, data || []);
}

async function calculateRoutesRisk(routes) {
  if (!routes.length) return [];

  const { minLat, maxLat, minLon, maxLon } = buildRoutesBBox(routes, 120);

  const { data, error } = await supabaseAdmin
    .from('puntos_criticos')
    .select('lat, lon, riesgo_norm')
    .gte('lat', minLat)
    .lte('lat', maxLat)
    .gte('lon', minLon)
    .lte('lon', maxLon)
    .order('riesgo_norm', { ascending: false })
    .limit(1200);

  if (error) {
    console.error('Error Supabase:', error);
    throw new Error('No se pudo consultar Supabase.');
  }

  return routes.map(route => calculateRiskFromPoints(
    route.geometry.coordinates,
    route.distance,
    data || []
  ));
}

module.exports = { calculateRouteRisk, calculateRoutesRisk };
