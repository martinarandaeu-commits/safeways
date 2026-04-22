const express = require('express');
const router = express.Router();
const { getRiskHotspots } = require('../controllers/risk-map.controller');

router.get('/hotspots', getRiskHotspots);

module.exports = router;
