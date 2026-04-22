const express = require('express');
const router = express.Router();
const { getBaseRoute, getSafeRoute } = require('../controllers/route.controller');

router.post('/base', getBaseRoute);
router.post('/safe', getSafeRoute);

module.exports = router;