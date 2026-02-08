// NatureScope - Wildlife Sighting Map

let map;
let highlightedLayer = null;
const countyData = {};
let countyBounds = {}; // store bounds keyed by county name

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

    // Setup modal close handlers
    const modal = document.getElementById('imageModal');
    const closeBtn = document.querySelector('.modalClose');

    if (closeBtn) {
        closeBtn.addEventListener('click', closeImageModal);
    }

    if (modal) {
        modal.addEventListener('click', function (e) {
            if (e.target === modal) {
                closeImageModal();
            }
        });
    }
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

// --- Modal Functions ---
function openImageModal(imageUrl, caption) {
    const modal = document.getElementById('imageModal');
    const modalImage = document.getElementById('modalImage');
    const modalCaption = document.getElementById('modalCaption');

    if (modal && modalImage) {
        modalImage.src = imageUrl;
        if (modalCaption) {
            modalCaption.textContent = caption || 'Wildlife Sighting';
        }
        modal.classList.add('show');
    }
}

function closeImageModal() {
    const modal = document.getElementById('imageModal');
    if (modal) {
        modal.classList.remove('show');
    }
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

    // store bounds for GBIF queries later
    layer.on('add', function () {
        const bounds = layer.getBounds();
        if (bounds && bounds.isValid()) {
            countyBounds[countyName] = bounds;
        }
    });

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
    renderSightings(countyName, layer);
}

// --- GBIF API Integration ---
function fetchGBIFData(bounds, limit = 50) {
    // GBIF API documentation: https://www.gbif.org/developer/occurrence
    // We'll search in Wisconsin within the county bounds
    const minLat = bounds.getSouthWest().lat;
    const minLng = bounds.getSouthWest().lng;
    const maxLat = bounds.getNorthEast().lat;
    const maxLng = bounds.getNorthEast().lng;

    // Build GBIF occurrence search URL with geometry bounding box - include offset to get varied results
    const url = `https://api.gbif.org/v1/occurrence/search?geometry=POLYGON((${minLng} ${minLat}, ${maxLng} ${minLat}, ${maxLng} ${maxLat}, ${minLng} ${maxLat}, ${minLng} ${minLat}))&stateProvince=Wisconsin&limit=${limit}&offset=0&hasGeometry=true`;

    return fetch(url)
        .then(response => response.json())
        .then(data => {
            if (!data.results || data.results.length === 0) {
                console.log('No occurrences found');
                return [];
            }
            console.log(`Found ${data.results.length} occurrences`);
            // transform GBIF results to our sighting format
            return data.results.map(r => ({
                id: r.key,
                species: r.species || r.scientificName || 'Unknown',
                date: r.eventDate ? r.eventDate.split('T')[0] : r.year ? `${r.year}-01-01` : 'Unknown',
                taxonRank: r.taxonRank || '',
                recordedBy: r.recordedBy || '',
                lat: r.decimalLatitude,
                lng: r.decimalLongitude,
                mediaCount: r.mediaCount || 0,
                mediaItems: r.media || []  // may include media URLs
            }));
        })
        .catch(error => {
            console.error('Error fetching GBIF data:', error);
            return [];
        });
}

// Fetch media (images) for a specific occurrence from GBIF
function fetchOccurrenceMedia(occurrenceKey, species, mediaItems) {
    // First, try to use media items already in the occurrence record
    if (mediaItems && Array.isArray(mediaItems) && mediaItems.length > 0) {
        const media = mediaItems[0];
        if (media.identifier) {
            console.log(`Using embedded media for ${occurrenceKey}: ${media.identifier}`);
            return Promise.resolve(media.identifier);
        }
    }

    // Fallback: try to fetch media via direct API call
    const url = `https://api.gbif.org/v1/occurrence/${occurrenceKey}`;
    return fetch(url)
        .then(response => response.json())
        .then(data => {
            console.log(`Full occurrence record for ${occurrenceKey}:`, data);
            if (data.media && Array.isArray(data.media) && data.media.length > 0) {
                const imageUrl = data.media[0].identifier;
                if (imageUrl) {
                    console.log(`Found media URL: ${imageUrl}`);
                    return imageUrl;
                }
            }
            // Last fallback: use Wikimedia Commons to get image by species
            if (species && species !== 'Unknown') {
                console.log(`No GBIF media found, trying Wikimedia Commons for ${species}`);
                return fetchWikimediaImage(species);
            }
            return null;
        })
        .catch(error => {
            console.error(`Error fetching media for ${occurrenceKey}:`, error);
            // Fallback to Wikimedia
            if (species) {
                return fetchWikimediaImage(species);
            }
            return null;
        });
}

// Fetch image from Wikimedia Commons by species name
function fetchWikimediaImage(species) {
    const searchUrl = `https://en.wikipedia.org/w/api.php?action=query&titles=${encodeURIComponent(species)}&prop=pageimages&format=json&origin=*&pithumbsize=100`;

    return fetch(searchUrl)
        .then(response => response.json())
        .then(data => {
            if (data.query && data.query.pages) {
                const page = Object.values(data.query.pages)[0];
                if (page.thumbnail && page.thumbnail.source) {
                    console.log(`Found Wikimedia image for ${species}: ${page.thumbnail.source}`);
                    return page.thumbnail.source;
                }
            }
            console.log(`No Wikimedia image found for ${species}`);
            return null;
        })
        .catch(error => {
            console.error('Error fetching Wikimedia image:', error);
            return null;
        });
}

function renderSightings(countyName, layer) {
    const list = document.getElementById('sightingsList');
    if (!list) return;

    // clear and show loading
    list.innerHTML = '<li class="noSightings">Loading sightings...</li>';

    // get bounds from stored county bounds
    const bounds = countyBounds[countyName];
    if (!bounds || !bounds.isValid()) {
        list.innerHTML = '<li class="noSightings">Error: unable to determine county bounds.</li>';
        return;
    }

    // fetch GBIF data
    fetchGBIFData(bounds).then(sightings => {
        list.innerHTML = '';

        if (sightings.length === 0) {
            const li = document.createElement('li');
            li.className = 'noSightings';
            li.textContent = 'No sightings found for this county.';
            list.appendChild(li);
            return;
        }

        // display up to 20 most recent with images
        const displayCount = Math.min(20, sightings.length);
        let imagesLoaded = 0;

        sightings.slice(0, displayCount).forEach((s, index) => {
            const li = document.createElement('li');
            li.className = 'sightingItem';

            const note = s.recordedBy ? ` (recorded by ${s.recordedBy})` : '';
            const textContent = `<strong>${s.species}</strong> — ${s.date}${note}`;

            // Create container with text on left
            li.innerHTML = `
                <div class="sightingContent">
                    <div class="sightingText">${textContent}</div>
                    <div class="sightingImage" id="img-${s.id}"><div class="imageLoading">Loading...</div></div>
                </div>
            `;
            list.appendChild(li);

            // Fetch image asynchronously - pass species for fallback
            fetchOccurrenceMedia(s.id, s.species, s.mediaItems).then(imageUrl => {
                const imgContainer = document.getElementById(`img-${s.id}`);
                if (imgContainer) {
                    if (imageUrl) {
                        // Try loading with CORS handling
                        imgContainer.innerHTML = `<img src="${imageUrl}" alt="${s.species}" class="sightingThumbnail" crossorigin="anonymous" onerror="this.parentElement.innerHTML='<div class=imageError>No image</div>'">`;

                        // Add click handler to image to expand it
                        const img = imgContainer.querySelector('img');
                        if (img) {
                            img.addEventListener('click', function () {
                                openImageModal(imageUrl, s.species);
                            });
                        }
                    } else {
                        imgContainer.innerHTML = '<div class="imageNotFound">No image available</div>';
                    }
                }
            });
        });

        if (sightings.length > 20) {
            const li = document.createElement('li');
            li.className = 'noSightings';
            li.textContent = `... and ${sightings.length - 20} more sightings`;
            list.appendChild(li);
        }
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
