const express = require('express');
const router = express.Router();
const { searchPlaces } = require('../controllers/geocode.controller');

router.get('/search', searchPlaces);

module.exports = router;