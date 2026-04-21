const { searchInNominatim } = require('../services/nominatim.service');

const searchPlaces = async (req, res) => {
  try {
    const { q } = req.query;

    if (!q || q.trim().length < 3) {
      return res.status(400).json({
        error: 'La búsqueda debe tener al menos 3 caracteres.'
      });
    }

    const results = await searchInNominatim(q);
    res.json(results);
  } catch (error) {
  console.error('Error en geocodificación:');
  console.error('Mensaje:', error.message);

  if (error.response) {
    console.error('Status:', error.response.status);
    console.error('Data:', error.response.data);
  }

  res.status(500).json({
    error: 'Error al buscar ubicaciones.'
  });
}
};

module.exports = { searchPlaces };