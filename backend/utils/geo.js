function metersToKm(meters) {
  return meters / 1000;
}

function projectToMeters(lat, lon, refLat) {
  const x = lon * 111320 * Math.cos((refLat * Math.PI) / 180);
  const y = lat * 110540;
  return { x, y };
}

function distancePointToSegmentMeters(point, start, end) {
  const refLat = (point.lat + start.lat + end.lat) / 3;

  const p = projectToMeters(point.lat, point.lon, refLat);
  const a = projectToMeters(start.lat, start.lon, refLat);
  const b = projectToMeters(end.lat, end.lon, refLat);

  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const apx = p.x - a.x;
  const apy = p.y - a.y;

  const ab2 = abx * abx + aby * aby;

  if (ab2 === 0) {
    return Math.sqrt((p.x - a.x) ** 2 + (p.y - a.y) ** 2);
  }

  let t = (apx * abx + apy * aby) / ab2;
  t = Math.max(0, Math.min(1, t));

  const closestX = a.x + t * abx;
  const closestY = a.y + t * aby;

  return Math.sqrt((p.x - closestX) ** 2 + (p.y - closestY) ** 2);
}

function minDistanceToPolylineMeters(point, coords) {
  if (!coords || coords.length < 2) return Infinity;

  let min = Infinity;

  for (let i = 0; i < coords.length - 1; i++) {
    const [lon1, lat1] = coords[i];
    const [lon2, lat2] = coords[i + 1];

    const dist = distancePointToSegmentMeters(
      point,
      { lat: lat1, lon: lon1 },
      { lat: lat2, lon: lon2 }
    );

    if (dist < min) min = dist;
  }

  return min;
}

function buildRouteBBox(coords, paddingMeters = 200) {
  const lats = coords.map(([, lat]) => lat);
  const lons = coords.map(([lon]) => lon);

  const minLatRaw = Math.min(...lats);
  const maxLatRaw = Math.max(...lats);
  const minLonRaw = Math.min(...lons);
  const maxLonRaw = Math.max(...lons);

  const centerLat = (minLatRaw + maxLatRaw) / 2;

  const latPad = paddingMeters / 110540;
  const lonPad = paddingMeters / (111320 * Math.cos((centerLat * Math.PI) / 180));

  return {
    minLat: minLatRaw - latPad,
    maxLat: maxLatRaw + latPad,
    minLon: minLonRaw - lonPad,
    maxLon: maxLonRaw + lonPad
  };
}

module.exports = {
  metersToKm,
  distancePointToSegmentMeters,
  minDistanceToPolylineMeters,
  buildRouteBBox
};