const axios = require('axios');

const fetchRouteFromOSRM = async (origin, destination) => {
  const url = `https://router.project-osrm.org/route/v1/driving/${origin.lng},${origin.lat};${destination.lng},${destination.lat}`;

  const response = await axios.get(url, {
    params: {
      overview: 'full',
      geometries: 'geojson',
      alternatives: true,
      steps: false
    },
    timeout: 10000
  });

  return response.data;
};

module.exports = { fetchRouteFromOSRM };