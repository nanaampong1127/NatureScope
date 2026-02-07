// NatureScope - Wildlife Sighting Map

let map;
let highlightedLayer = null;
const countyData = {};

document.addEventListener('DOMContentLoaded', function () {
    // Initialize the map
    initializeMap();

    // Smooth scroll for navigation links
    const navLinks = document.querySelectorAll('nav a');
    navLinks.forEach(link => {
        link.addEventListener('click', function (e) {
            const href = this.getAttribute('href');
            if (href && href.startsWith('#')) {
                e.preventDefault();
                const target = document.querySelector(href);
                if (target) {
                    target.scrollIntoView({ behavior: 'smooth' });
                }
            }
        });
    });
});

function initializeMap() {
    // Create map centered on continental US
    map = L.map('map').setView([39.8283, -98.5795], 4);

    // Add OpenStreetMap tile layer
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; OpenStreetMap contributors',
        maxZoom: 19
    }).addTo(map);

    // Load US counties GeoJSON
    loadCounties();
}

function loadCounties() {
    // Using Plotly's GeoJSON of all US counties but filter to Wisconsin (state FIPS = '55')
    const WI_FIPS = '55';
    fetch('https://raw.githubusercontent.com/plotly/datasets/master/geojson-counties-fips.json')
        .then(response => response.json())
        .then(data => {
            // filter features for Wisconsin only
            const wiFeatures = (data.features || []).filter(f => {
                // feature id is the county FIPS (string or number). Normalize to string.
                const id = String(f.id || (f.properties && f.properties.FIPS) || '');
                return id.startsWith(WI_FIPS);
            });

            const wiGeo = Object.assign({}, data, { features: wiFeatures });

            const countiesLayer = L.geoJSON(wiGeo, {
                style: getCountyStyle,
                onEachFeature: onCountyFeature
            }).addTo(map);

            // Fit map to Wisconsin bounds and restrict panning to the state area
            const bounds = countiesLayer.getBounds();
            if (bounds.isValid()) {
                map.fitBounds(bounds.pad(0.1));
                // prevent panning far away from Wisconsin
                map.setMaxBounds(bounds.pad(0.2));
                // optionally set reasonable min/max zoom for WI
                map.setMinZoom(map.getZoom());
            }
        })
        .catch(error => console.error('Error loading counties:', error));
}

function getCountyStyle(feature) {
    return {
        fillColor: '#90EE90',
        weight: 1,
        opacity: 0.8,
        color: '#666',
        fillOpacity: 0.4,
        dashArray: '3'
    };
}

function onCountyFeature(feature, layer) {
    const countyName = (feature.properties && (feature.properties.name || feature.properties.NAME)) || feature.id || 'Unknown County';

    // store the default style so we can reset later
    layer.defaultStyle = getCountyStyle(feature);

    // simple popup showing county identifier
    layer.bindPopup(`<strong>${countyName}</strong>`);

    // click: make this the highlighted (selected) county
    layer.on('click', function () {
        setHighlightedLayer(this, countyName);
    });

    // hover: only a temporary visual effect, do not replace the selected county
    layer.on('mouseover', function () {
        if (highlightedLayer !== this) {
            this.setStyle({
                fillOpacity: 0.7,
                color: '#4CAF50',
                weight: 2
            });
        }
    });

    layer.on('mouseout', function () {
        if (highlightedLayer !== this) {
            this.setStyle(layer.defaultStyle);
        } else {
            // keep the highlighted layer's stronger style
            this.setStyle({
                fillOpacity: 0.7,
                color: '#4CAF50',
                weight: 3
            });
        }
    });
}

function setHighlightedLayer(layer, countyName) {
    // reset previous
    if (highlightedLayer && highlightedLayer !== layer) {
        if (highlightedLayer.defaultStyle) highlightedLayer.setStyle(highlightedLayer.defaultStyle);
    }

    // set new
    highlightedLayer = layer;
    highlightedLayer.setStyle({
        fillOpacity: 0.7,
        color: '#4CAF50',
        weight: 3
    });
    // update info panel (populate skeleton elements)
    const countyNameEl = document.getElementById('countyName');
    const clearBtn = document.getElementById('clearSelection');
    if (countyNameEl) countyNameEl.textContent = countyName;
    if (clearBtn) {
        clearBtn.style.display = 'inline-block';
        clearBtn.onclick = () => clearSelection();
    }

    // render sightings (skeleton)
    renderSightings(countyName);
}

// --- Sightings rendering skeleton ---
// Placeholder sample data (replace with API/db lookups later)
const sampleSightings = {
    'Unknown County': [],
    'Sample County': [
        { id: 1, species: 'Red-tailed Hawk', date: '2026-02-01', notes: 'Soaring above the treeline.' },
        { id: 2, species: 'White-tailed Deer', date: '2026-01-28', notes: 'Group of three near stream.' }
    ]
};

function renderSightings(countyName) {
    const list = document.getElementById('sightingsList');
    if (!list) return;

    // clear
    list.innerHTML = '';

    // get sightings from sample (replace with real fetch later)
    const sightings = sampleSightings[countyName] || [];

    if (sightings.length === 0) {
        const li = document.createElement('li');
        li.className = 'noSightings';
        li.textContent = 'No sightings for this county yet.';
        list.appendChild(li);
        return;
    }

    sightings.forEach(s => {
        const li = document.createElement('li');
        li.innerHTML = `<strong>${s.species}</strong> — ${s.date}<br><span class="notes">${s.notes}</span>`;
        list.appendChild(li);
    });
}

function clearSelection() {
    if (highlightedLayer) {
        if (highlightedLayer.defaultStyle) highlightedLayer.setStyle(highlightedLayer.defaultStyle);
        highlightedLayer = null;
    }
    const countyNameEl = document.getElementById('countyName');
    const clearBtn = document.getElementById('clearSelection');
    const list = document.getElementById('sightingsList');
    if (countyNameEl) countyNameEl.textContent = 'No county selected';
    if (clearBtn) clearBtn.style.display = 'none';
    if (list) list.innerHTML = '';
}
