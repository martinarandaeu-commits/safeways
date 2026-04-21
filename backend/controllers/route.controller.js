const { fetchRouteFromOSRM } = require('../services/osrm.service');

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
    console.error('Error al obtener ruta:');
    console.error('Mensaje:', error.message);

    if (error.response) {
      console.error('Status:', error.response.status);
      console.error('Data:', error.response.data);
    }

    res.status(500).json({
      error: 'No se pudo obtener la ruta.'
    });
  }
};

module.exports = { getBaseRoute };