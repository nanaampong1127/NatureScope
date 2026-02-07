// NatureScope - Wildlife Sighting Map

let map;
let highlightedCounty = null;
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
    // Using a public GeoJSON source for US counties
    fetch('https://raw.githubusercontent.com/plotly/datasets/master/geojson-counties-fips.json')
        .then(response => response.json())
        .then(data => {
            L.geoJSON(data, {
                style: getCountyStyle,
                onEachFeature: onCountyFeature
            }).addTo(map);
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
    const countyName = feature.properties.properties?.name || 'Unknown County';

    layer.bindPopup(`<strong>${countyName}</strong><br><button onclick="highlightCounty('${countyName}')">View Sightings</button>`);

    layer.on('click', function () {
        highlightCounty(countyName);
    });

    layer.on('mouseover', function () {
        this.setStyle({
            fillOpacity: 0.7,
            color: '#4CAF50',
            weight: 2
        });
    });

    layer.on('mouseout', function () {
        this.setStyle({
            fillOpacity: 0.4,
            color: '#666',
            weight: 1
        });

        // Keep highlighted county visible
        if (highlightedCounty === countyName) {
            this.setStyle({
                fillOpacity: 0.7,
                color: '#4CAF50',
                weight: 3
            });
        }
    });
}

function highlightCounty(countyName) {
    highlightedCounty = countyName;
    const infoDiv = document.getElementById('countyInfo');
    infoDiv.innerHTML = `<strong>${countyName}</strong><br><p>Wildlife sightings data will be displayed here.</p>`;
}
