const API = 'https://macrostrat.org/api/v2';
const COLOR_PALETTE = ['#e41a1c','#377eb8','#4daf4a','#984ea3','#ff7f00','#a65628','#f781bf','#999999'];
const RANK_SUFFIX = /\s*\b(formation|member|group|subgroup|fm|mbr|gp|sgp)\b\.?\s*$/i;

const state = {
  searchResults: [],
  stateFilter: null,
  stateBboxes: {},
  layers: {},
  colorIndex: 0
};

let map;
let legendControl;

function init() {
  map = L.map('map').setView([39, -105], 5);
  L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', {
    attribution: 'Map data: &copy; <a href="https://openstreetmap.org/copyright">OpenStreetMap</a> contributors, SRTM | Style: &copy; <a href="https://opentopomap.org">OpenTopoMap</a> (CC-BY-SA)',
    maxZoom: 17
  }).addTo(map);

  legendControl = L.control({ position: 'bottomright' });
  legendControl.onAdd = function () {
    this._div = L.DomUtil.create('div', 'legend');
    L.DomEvent.disableClickPropagation(this._div);
    L.DomEvent.disableScrollPropagation(this._div);
    return this._div;
  };
  legendControl.addTo(map);

  document.getElementById('search-btn').addEventListener('click', onSearch);
  document.getElementById('query').addEventListener('keydown', e => {
    if (e.key === 'Enter') onSearch();
  });
  document.getElementById('state-select').addEventListener('change', e => {
    state.stateFilter = e.target.value || null;
  });

  loadStates();
}

async function loadStates() {
  try {
    const res = await fetch('states.json');
    state.stateBboxes = await res.json();
    const sel = document.getElementById('state-select');
    Object.entries(state.stateBboxes)
      .sort((a, b) => a[1].name.localeCompare(b[1].name))
      .forEach(([abbr, { name }]) => {
        const opt = document.createElement('option');
        opt.value = abbr;
        opt.textContent = name;
        sel.appendChild(opt);
      });
  } catch {
    showError('Could not load states list');
  }
}

function onSearch() {
  const query = document.getElementById('query').value.trim();
  if (!query) return;
  fetchStratNames(query)
    .then(results => {
      state.searchResults = results;
      renderMatchPanel(results);
      if (results.length === 0) showError(`No formations found for "${query}"`);
    })
    .catch(() => showError('Network error — check connection'));
}

async function fetchStratNames(query) {
  const clean = query.replace(RANK_SUFFIX, '').trim();
  const base = `${API}/defs/strat_names`;
  let res = await fetch(`${base}?strat_name_like=${encodeURIComponent(clean)}&rank=Fm`);
  let data = (await res.json()).success.data;
  if (data.length === 0) {
    res = await fetch(`${base}?strat_name_like=${encodeURIComponent(clean)}`);
    data = (await res.json()).success.data;
  }
  return data;
}

function renderMatchPanel(results) {
  const panel = document.getElementById('match-panel');
  if (results.length === 0) {
    panel.style.display = 'none';
    return;
  }
  panel.innerHTML =
    results.map(r => `
      <label class="match-row">
        <input type="checkbox" value="${r.strat_name_id}" data-label="${r.strat_name_long}">
        <span class="match-name">${r.strat_name_long}</span>
        <span class="match-meta">${r.rank} · ${r.b_period}–${r.t_period} (${Math.round(r.b_age)}–${Math.round(r.t_age)} Ma)</span>
      </label>`).join('') +
    '<button id="show-btn">Show on Map</button>';
  panel.style.display = 'block';
  document.getElementById('show-btn').addEventListener('click', onShowOnMap);
}

function onShowOnMap() {
  document.querySelectorAll('#match-panel input[type=checkbox]:checked').forEach(cb => {
    fetchAndAddLayer(Number(cb.value), cb.dataset.label);
  });
}

async function fetchAndAddLayer(id, label) {
  try {
    const res = await fetch(buildUrl(id));
    const geojson = (await res.json()).success.data;
    if (!geojson.features || geojson.features.length === 0) {
      showError(`No map data for "${label}"`);
      return;
    }
    addLayer(id, label, geojson);
  } catch {
    showError('Network error — check connection');
  }
}

function buildUrl(id) {
  let url = `${API}/geologic_units/map?strat_name_id=${id}&format=geojson`;
  if (state.stateFilter && state.stateBboxes[state.stateFilter]) {
    const b = state.stateBboxes[state.stateFilter].bbox;
    url += `&bbox=${b[0]},${b[1]},${b[2]},${b[3]}`;
  }
  return url;
}

function addLayer(id, label, geojson) {
  if (id in state.layers) return;
  const color = assignColor();
  const leafletLayer = L.geoJSON(geojson, {
    style: { color, weight: 1, fillColor: color, fillOpacity: 0.4 },
    onEachFeature(feature, layer) {
      layer.bindPopup(buildPopupHtml(feature.properties));
    }
  }).addTo(map);
  state.layers[id] = { label, color, featureCount: geojson.features.length, leafletLayer };
  if (geojson.features.length > 5000) {
    showError(`"${label}" returned ${geojson.features.length.toLocaleString()} polygons — map may be slow`);
  }
  updateLegend();
  fitMap();
}

function removeLayer(id) {
  if (!(id in state.layers)) return;
  map.removeLayer(state.layers[id].leafletLayer);
  delete state.layers[id];
  updateLegend();
}

function assignColor() {
  return COLOR_PALETTE[state.colorIndex++ % COLOR_PALETTE.length];
}

function buildPopupHtml(props) {
  const age = props.best_int_name
    ? `${props.best_int_name} (${props.b_age}–${props.t_age} Ma)`
    : `${props.b_age}–${props.t_age} Ma`;
  return `<strong>${props.name || '—'}</strong><br><em>${age}</em><br>${props.lith || ''}`;
}

function updateLegend() {
  const div = legendControl._div;
  const entries = Object.entries(state.layers);
  if (entries.length === 0) {
    div.innerHTML = '';
    return;
  }
  div.innerHTML = entries.map(([id, l]) =>
    `<div class="legend-row">
      <span class="legend-swatch" style="background:${l.color}"></span>
      <span class="legend-label">${l.label}</span>
      <button class="legend-remove" data-id="${id}">×</button>
    </div>`
  ).join('');
  div.querySelectorAll('.legend-remove').forEach(btn => {
    L.DomEvent.on(btn, 'click', () => removeLayer(Number(btn.dataset.id)));
  });
}

function fitMap() {
  const layers = Object.values(state.layers).map(l => l.leafletLayer);
  if (layers.length === 0) return;
  const bounds = layers.slice(1).reduce(
    (acc, l) => acc.extend(l.getBounds()),
    layers[0].getBounds()
  );
  map.fitBounds(bounds, { padding: [20, 20] });
}

function showError(msg) {
  const banner = document.getElementById('error-banner');
  banner.textContent = msg;
  banner.style.display = 'block';
  clearTimeout(showError._t);
  showError._t = setTimeout(() => { banner.style.display = 'none'; }, 4000);
}

init();
