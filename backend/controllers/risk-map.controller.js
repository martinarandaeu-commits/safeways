const { getHotspotsByBBox } = require('../services/risk-map.service');

function parseNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

const getRiskHotspots = async (req, res) => {
  try {
    const minLat = parseNumber(req.query.minLat);
    const maxLat = parseNumber(req.query.maxLat);
    const minLon = parseNumber(req.query.minLon);
    const maxLon = parseNumber(req.query.maxLon);
    const limit = Math.min(parseNumber(req.query.limit) || 2500, 5000);

    if ([minLat, maxLat, minLon, maxLon].some(value => value === null)) {
      return res.status(400).json({
        error: 'Debes enviar minLat, maxLat, minLon y maxLon.'
      });
    }

    const hotspots = await getHotspotsByBBox({
      minLat,
      maxLat,
      minLon,
      maxLon,
      limit
    });

    res.json({
      code: 'Ok',
      hotspots
    });
  } catch (error) {
    console.error('Error al obtener mapa de riesgo:', error.message);
    res.status(500).json({
      error: 'No se pudo obtener el mapa de riesgo.'
    });
  }
};

module.exports = { getRiskHotspots };
