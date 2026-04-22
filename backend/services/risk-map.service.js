const { supabaseAdmin } = require('./supabase.service');

async function getHotspotsByBBox({ minLat, maxLat, minLon, maxLon, limit = 2500 }) {
  const { data, error } = await supabaseAdmin
    .from('puntos_criticos')
    .select('lat, lon, riesgo_norm')
    .gte('lat', minLat)
    .lte('lat', maxLat)
    .gte('lon', minLon)
    .lte('lon', maxLon)
    .not('riesgo_norm', 'is', null)
    .order('riesgo_norm', { ascending: false })
    .limit(limit);

  if (error) {
    console.error('Error hotspots Supabase:', error);
    throw new Error('No se pudo consultar el mapa de riesgo.');
  }

  return data || [];
}

module.exports = { getHotspotsByBBox };