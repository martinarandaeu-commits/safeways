const axios = require('axios');

const searchInNominatim = async (query) => {
  const response = await axios.get('https://nominatim.openstreetmap.org/search', {
    params: {
      q: query,
      format: 'jsonv2',
      countrycodes: 'cl',
      limit: 5,
      addressdetails: 1
    },
    headers: {
      'User-Agent': 'SafeWays/1.0 (Proyecto academico)'
    }
  });

  return response.data;
};

module.exports = { searchInNominatim };