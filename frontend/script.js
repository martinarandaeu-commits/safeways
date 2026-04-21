// ===============================
// 1. CONFIGURACIÓN DEL MAPA
// ===============================
const map = L.map('map').setView([-33.4489, -70.6693], 12);

L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
  attribution: 'SafeWays © OpenStreetMap contributors',
  maxZoom: 19
}).addTo(map);

let originCoords = null;
let destinationCoords = null;

let originMarker = null;
let destinationMarker = null;
let routeLine = null;
let searchTimer = null;

// URL base del backend
const API_URL = 'http://localhost:3000/api';

// ===============================
// 2. GEOLOCALIZACIÓN DEL USUARIO
// ===============================
function inicializarUbicacion() {
  const gpsStatus = document.getElementById('gps-info');
  const originInput = document.getElementById('origin-input');

  if (navigator.geolocation) {
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        originCoords = [pos.coords.latitude, pos.coords.longitude];
        originInput.value = 'Ubicación detectada (GPS)';
        gpsStatus.innerHTML = '🟢 GPS Activo';
        gpsStatus.style.color = '#00a89e';

        if (originMarker) {
          map.removeLayer(originMarker);
        }

        originMarker = L.circleMarker(originCoords, {
          color: '#00a89e',
          radius: 7,
          fillOpacity: 0.9
        }).addTo(map).bindPopup('Tu ubicación actual');

        map.setView(originCoords, 14);
      },
      (err) => {
        console.warn('Error en GPS:', err.message);
        gpsStatus.innerText = '⚠️ Usando ubicación manual (Santiago Centro)';
        originCoords = [-33.4489, -70.6693];
        originInput.value = 'Santiago Centro';

        if (originMarker) {
          map.removeLayer(originMarker);
        }

        originMarker = L.circleMarker(originCoords, {
          color: '#00a89e',
          radius: 7,
          fillOpacity: 0.9
        }).addTo(map).bindPopup('Ubicación manual');
      }
    );
  }
}

inicializarUbicacion();

// ===============================
// 3. BUSCADOR DE DESTINO VÍA BACKEND
// ===============================
const inputDest = document.getElementById('dest-input');
const resultsBox = document.getElementById('results-list');

inputDest.addEventListener('input', () => {
  clearTimeout(searchTimer);
  const query = inputDest.value.trim();

  if (query.length < 3) {
    resultsBox.style.display = 'none';
    resultsBox.innerHTML = '';
    return;
  }

  resultsBox.innerHTML = '<div style="padding:10px; font-size:12px; color:#00a89e;">Buscando en Chile...</div>';
  resultsBox.style.display = 'block';

  searchTimer = setTimeout(async () => {
    try {
      const response = await fetch(`${API_URL}/geocode/search?q=${encodeURIComponent(query)}`);
      const data = await response.json();

      resultsBox.innerHTML = '';

      if (data && data.length > 0) {
        data.forEach(item => {
          const div = document.createElement('div');
          div.className = 'result-item';

          const parts = item.display_name.split(',');
          const shortName = parts.slice(0, 3).join(',');

          div.innerText = shortName;

          div.onclick = () => {
            inputDest.value = shortName;
            destinationCoords = [parseFloat(item.lat), parseFloat(item.lon)];
            resultsBox.style.display = 'none';

            if (destinationMarker) {
              map.removeLayer(destinationMarker);
            }

            destinationMarker = L.marker(destinationCoords)
              .addTo(map)
              .bindPopup('Destino seleccionado');

            map.flyTo(destinationCoords, 15);
          };

          resultsBox.appendChild(div);
        });
      } else {
        resultsBox.innerHTML = '<div style="padding:10px; font-size:12px;">Sin resultados en Chile.</div>';
      }
    } catch (error) {
      console.error('Error de búsqueda:', error);
      resultsBox.innerHTML = '<div style="padding:10px; font-size:12px; color:#ff4d4d;">Error de red. Intenta nuevamente.</div>';
    }
  }, 600);
});

// ===============================
// 4. DIBUJAR RUTA EN MAPA
// ===============================
function drawRoute(routeGeoJSON) {
  if (routeLine) {
    map.removeLayer(routeLine);
  }

  routeLine = L.geoJSON(routeGeoJSON, {
    style: {
      color: '#00a89e',
      weight: 6,
      opacity: 0.85
    }
  }).addTo(map);

  map.fitBounds(routeLine.getBounds(), { padding: [30, 30] });
}

// ===============================
// 5. CALCULAR RUTA DESDE BACKEND
// ===============================
document.getElementById('calc-btn').addEventListener('click', async () => {
  if (!originCoords || !destinationCoords) {
    alert('Por favor, selecciona un destino de la lista desplegable.');
    return;
  }

  const infoPanel = document.getElementById('route-panel');
  infoPanel.innerHTML = '<strong style="color:#00a89e">Analizando ruta...</strong>';

  try {
    const response = await fetch(`${API_URL}/route/base`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        origin: {
          lat: originCoords[0],
          lng: originCoords[1]
        },
        destination: {
          lat: destinationCoords[0],
          lng: destinationCoords[1]
        }
      })
    });

    const data = await response.json();

    if (!data.routes || data.routes.length === 0) {
      infoPanel.innerHTML = '<span style="color:#ff4d4d;">No se encontró una ruta.</span>';
      return;
    }

    // Tomamos la primera ruta por ahora
    const bestRoute = data.routes[0];
    drawRoute(bestRoute.geometry);

    const distanceKm = (bestRoute.distance / 1000).toFixed(2);
    const durationMin = Math.round(bestRoute.duration / 60);

    infoPanel.innerHTML = `
      <strong style="color:#00a89e">✓ RUTA CALCULADA</strong><br>
      <p style="margin:5px 0">Ruta obtenida desde backend SafeWays.</p>
      <ul style="padding-left:15px; margin:0; font-size:11px; color: #ccc;">
        <li>Distancia estimada: ${distanceKm} km</li>
        <li>Tiempo estimado: ${durationMin} min</li>
        <li>Rutas alternativas detectadas: ${data.routes.length}</li>
        <li>Estado OSRM: ${data.code}</li>
      </ul>
    `;
  } catch (error) {
    console.error('Error al calcular ruta:', error);
    infoPanel.innerHTML = '<span style="color:#ff4d4d;">Error al calcular la ruta.</span>';
  }
});

// ===============================
// 6. OCULTAR RESULTADOS AL HACER CLIC FUERA
// ===============================
document.addEventListener('click', (e) => {
  if (!e.target.closest('.search-box')) {
    resultsBox.style.display = 'none';
  }
});