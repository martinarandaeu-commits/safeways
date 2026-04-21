const express = require('express');
const router = express.Router();
const { getBaseRoute } = require('../controllers/route.controller');

router.post('/base', getBaseRoute);

module.exports = router;