const express = require('express');
const cors = require('cors');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors({
  origin: '*'
}));

app.use(express.json());

app.get('/', (req, res) => {
  res.json({ message: 'SafeWays backend operativo' });
});

app.use('/api/geocode', require('./routes/geocode.routes'));
app.use('/api/route', require('./routes/route.routes'));
app.use('/api/risk', require('./routes/risk-map.routes'));

app.listen(PORT, () => {
  console.log(`Servidor corriendo en puerto ${PORT}`);
});
