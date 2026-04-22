const { fetchRouteFromOSRM } = require('../services/osrm.service');
const { calculateRouteRisk } = require('../services/risk.service');

const getBaseRoute = async (req, res) => {
  try {
    const { origin, destination } = req.body;

    if (!origin || !destination) {
      return res.status(400).json({
        error: 'Debes enviar origen y destino.'
      });
    }

    const route = await fetchRouteFromOSRM(origin, destination);
    res.json(route);
  } catch (error) {
    console.error('Error al obtener ruta base:', error.message);

    if (error.response) {
      console.error('Status:', error.response.status);
      console.error('Data:', error.response.data);
    }

    res.status(500).json({
      error: 'No se pudo obtener la ruta.'
    });
  }
};

const getSafeRoute = async (req, res) => {
  try {
    const { origin, destination } = req.body;

    if (!origin || !destination) {
      return res.status(400).json({
        error: 'Debes enviar origen y destino.'
      });
    }

    const osrmData = await fetchRouteFromOSRM(origin, destination);

    if (!osrmData.routes || osrmData.routes.length === 0) {
      return res.status(404).json({
        error: 'No se encontraron rutas.'
      });
    }

    const evaluatedRoutes = [];

    for (let i = 0; i < osrmData.routes.length; i++) {
      const route = osrmData.routes[i];
      const coords = route.geometry.coordinates;

      const riskData = await calculateRouteRisk(coords, route.distance);

      evaluatedRoutes.push({
        index: i,
        geometry: route.geometry,
        distance: route.distance,
        duration: route.duration,
        risk_total: riskData.riesgo_total,
        risk_per_km: riskData.riesgo_por_km,
        critical_points: riskData.puntos_cercanos
      });
    }

    evaluatedRoutes.sort((a, b) => a.risk_per_km - b.risk_per_km);

    res.json({
      code: 'Ok',
      best_route_index: evaluatedRoutes[0].index,
      routes: evaluatedRoutes
    });
  } catch (error) {
    console.error('Error al obtener ruta segura:', error.message);
    res.status(500).json({
      error: 'No se pudo obtener la ruta segura.'
    });
  }
};

module.exports = { getBaseRoute, getSafeRoute };