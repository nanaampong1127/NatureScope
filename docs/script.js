// NatureScope - Wildlife Sighting Map

let map;
let highlightedLayer = null;
let sightingMarkersLayer = null;
const sightingMarkerMap = {}; // sighting id -> marker (for opening popup from list)
const countyData = {};
let countyBounds = {}; // store bounds keyed by county name

// Pagination and filtering state
let currentSightings = [];
let currentPage = 1;
const itemsPerPage = 10;
let selectedYear = null; // null means show all years
let selectedKingdom = null; // null means show all (fauna and flora)

// Header hide/show state
let lastScrollTop = 0;
let isHeaderHidden = false;
let headerShowTimeout = null;

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
    const closeBtn = document.querySelector('.modal-close');

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

    // Setup image upload functionality
    const fileInput = document.getElementById('speciesImageInput');
    const uploadArea = document.querySelector('.upload-area');
    const uploadLabel = document.querySelector('.upload-label');
    const identifyResults = document.getElementById('identifyResults');

    if (fileInput) {
        // Click to upload
        fileInput.addEventListener('change', function (e) {
            handleImageUpload(e.target.files[0]);
        });

        // Drag and drop
        if (uploadArea) {
            uploadArea.addEventListener('dragover', function (e) {
                e.preventDefault();
                uploadArea.classList.add('dragover');
                if (uploadLabel) uploadLabel.style.opacity = '0.7';
            });

            uploadArea.addEventListener('dragleave', function (e) {
                e.preventDefault();
                uploadArea.classList.remove('dragover');
                if (uploadLabel) uploadLabel.style.opacity = '1';
            });

            uploadArea.addEventListener('drop', function (e) {
                e.preventDefault();
                uploadArea.classList.remove('dragover');
                if (uploadLabel) uploadLabel.style.opacity = '1';

                const files = e.dataTransfer.files;
                if (files.length > 0) {
                    handleImageUpload(files[0]);
                }
            });
        }
    }

    // Setup reset map button
    const resetMapBtn = document.getElementById('resetMapBtn');
    if (resetMapBtn) {
        resetMapBtn.addEventListener('click', resetMapView);
    }

    // Setup header hide/show on scroll and hover
    const header = document.querySelector('header');

    window.addEventListener('scroll', function () {
        const scrollTop = window.pageYOffset || document.documentElement.scrollTop;

        // Only hide if scrolled past 100px
        if (scrollTop > 100) {
            if (scrollTop > lastScrollTop) {
                // Scrolling down - hide header
                if (!isHeaderHidden) {
                    header.classList.add('hide-header');
                    isHeaderHidden = true;
                }
            }
        } else {
            // Always show header when near top
            if (isHeaderHidden) {
                header.classList.remove('hide-header');
                isHeaderHidden = false;
            }
        }

        lastScrollTop = scrollTop;
    });

    // Show header on hover at top of page
    document.addEventListener('mousemove', function (e) {
        if (isHeaderHidden && e.clientY < 50) {
            // Hovering near top - show header after 500ms
            if (!headerShowTimeout) {
                headerShowTimeout = setTimeout(function () {
                    header.classList.remove('hide-header');
                    isHeaderHidden = false;
                    headerShowTimeout = null;
                }, 500);
            }
        }
    });

    // Hide header again when mouse leaves top area
    document.addEventListener('mouseleave', function () {
        if (headerShowTimeout) {
            clearTimeout(headerShowTimeout);
            headerShowTimeout = null;
        }
        const scrollTop = window.pageYOffset || document.documentElement.scrollTop;
        if (scrollTop > 100) {
            header.classList.add('hide-header');
            isHeaderHidden = true;
        }
    });
});

function initializeMap() {
    // Create map centered on Wisconsin
    console.log('Initializing map...');
    map = L.map('map').setView([44.2685, -89.6165], 7);

    // Add OpenStreetMap tile layer
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; OpenStreetMap contributors',
        maxZoom: 19
    }).addTo(map);

    sightingMarkersLayer = L.layerGroup().addTo(map);

    console.log('Map initialized');
    // Load US counties GeoJSON
    loadCounties();
}

function resetMapView() {
    // Reset map to Wisconsin view
    map.setView([44.2685, -89.6165], 7);
    console.log('Map view reset to Wisconsin');
}

// --- Modal Functions ---
function openImageModal(imageUrl, caption, recordedBy) {
    const modal = document.getElementById('imageModal');
    const modalImage = document.getElementById('modalImage');
    const modalCaption = document.getElementById('modalCaption');

    if (modal && modalImage) {
        modalImage.src = imageUrl;
        if (modalCaption) {
            let captionText = caption || 'Wildlife Sighting';
            if (recordedBy) {
                captionText += ` • Contributed by ${recordedBy}`;
            }
            modalCaption.textContent = captionText;
        }
        modal.classList.add('show');
        console.log('Opened image modal for:', caption);
    } else {
        console.error('Modal elements not found in DOM');
    }
}

// --- Helper function for species links ---
function createSpeciesLinks(speciesName) {
    if (!speciesName || speciesName === 'Unknown' || speciesName === 'Unknown Species') {
        return speciesName;
    }

    // Encode species name for URLs
    const encodedName = encodeURIComponent(speciesName);
    const wikipediaUrl = `https://en.wikipedia.org/wiki/${encodedName.replace(/%20/g, '_')}`;
    const inaturalistUrl = `https://www.inaturalist.org/search?q=${encodedName}`;
    const gbifUrl = `https://www.gbif.org/species/search?q=${encodedName}`;

    return `<span class="species-name-wrapper">
        <strong>${speciesName}</strong>
        <span class="species-links">
            <a href="${wikipediaUrl}" target="_blank" rel="noopener noreferrer" class="species-link" title="View on Wikipedia">📖</a>
            <a href="${inaturalistUrl}" target="_blank" rel="noopener noreferrer" class="species-link" title="Search on iNaturalist">🔍</a>
            <a href="${gbifUrl}" target="_blank" rel="noopener noreferrer" class="species-link" title="View on GBIF">🌿</a>
        </span>
    </span>`;
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
    console.log('Loading counties from Plotly GeoJSON...');
    fetch('https://raw.githubusercontent.com/plotly/datasets/master/geojson-counties-fips.json')
        .then(response => response.json())
        .then(data => {
            console.log('GeoJSON loaded, total features:', data.features.length);
            // filter features for Wisconsin only
            const wiFeatures = (data.features || []).filter(f => {
                // feature id is the county FIPS (string or number). Normalize to string.
                const id = String(f.id || (f.properties && f.properties.FIPS) || '');
                return id.startsWith(WI_FIPS);
            });

            console.log('Wisconsin counties found:', wiFeatures.length);
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

    // store bounds - try to get them immediately and on add
    const bounds = layer.getBounds();
    if (bounds && bounds.isValid()) {
        countyBounds[countyName] = bounds;
    }

    layer.on('add', function () {
        if (!countyBounds[countyName]) {
            const bounds = layer.getBounds();
            if (bounds && bounds.isValid()) {
                countyBounds[countyName] = bounds;
            }
        }
    });

    // simple popup showing county identifier
    layer.bindPopup(`<strong>${countyName}</strong>`);

    // click: make this the highlighted (selected) county
    layer.on('click', function () {
        setHighlightedLayer(this, countyName);
        // Zoom to the county bounds
        if (countyBounds[countyName]) {
            map.fitBounds(countyBounds[countyName], { padding: [50, 50] });
        }
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
    const clearBtn = document.getElementById('clearBtn');
    if (countyNameEl) countyNameEl.textContent = countyName;
    if (clearBtn) {
        clearBtn.style.display = 'inline-block';
        clearBtn.onclick = () => clearSelection();
    }

    // render sightings (skeleton)
    renderSightings(countyName, layer);
}

// --- GBIF API Integration ---
function fetchGBIFData(bounds, limit = 300, maxTotal = 600) {
    // GBIF API documentation: https://www.gbif.org/developer/occurrence
    // GBIF max limit per request is 300, use pagination to fetch all results up to maxTotal
    const minLat = bounds.getSouthWest().lat;
    const minLng = bounds.getSouthWest().lng;
    const maxLat = bounds.getNorthEast().lat;
    const maxLng = bounds.getNorthEast().lng;

    // Build GBIF occurrence search URL using WKT geometry format (more reliable)
    // WKT format: POLYGON((longitude latitude, ...))
    const polygon = `POLYGON((${minLng} ${minLat}, ${maxLng} ${minLat}, ${maxLng} ${maxLat}, ${minLng} ${maxLat}, ${minLng} ${minLat}))`;
    
    // Fetch all results with pagination (up to maxTotal)
    const fetchPage = (offset = 0, allResults = []) => {
        const url = `https://api.gbif.org/v1/occurrence/search?geometry=${encodeURIComponent(polygon)}&limit=${limit}&offset=${offset}&hasGeometry=true`;
        
        console.log(`Fetching GBIF page: offset=${offset}, limit=${limit}, collected=${allResults.length}/${maxTotal}`);
        
        return fetch(url)
            .then(response => {
                console.log('GBIF response status:', response.status);
                if (!response.ok) {
                    throw new Error(`GBIF API returned status ${response.status}`);
                }
                return response.json();
            })
            .then(data => {
                console.log('GBIF data received:', data);
                if (!data.results || data.results.length === 0) {
                    if (offset === 0) {
                        console.warn('No occurrences found for bounds:', bounds);
                        console.warn('Response meta:', data.count, data.limit, data.offset);
                    }
                    return allResults;
                }
                
                console.log(`Fetched ${data.results.length} occurrences (offset: ${offset}, total available: ${data.count})`);
                
                // Add to results
                const pageResults = data.results.map(r => {
                    const kingdom = r.kingdom || '';
                    let type = 'Other';
                    if (kingdom.toLowerCase() === 'animalia') {
                        type = 'Fauna';
                    } else if (kingdom.toLowerCase() === 'plantae') {
                        type = 'Flora';
                    } else if (kingdom.toLowerCase() === 'fungi') {
                        type = 'Fungi';
                    }

                    return {
                        id: r.key,
                        species: r.species || r.scientificName || 'Unknown',
                        date: r.eventDate ? r.eventDate.split('T')[0] : r.year ? `${r.year}-01-01` : 'Unknown',
                        year: r.year || (r.eventDate ? parseInt(r.eventDate.split('-')[0]) : null),
                        taxonRank: r.taxonRank || '',
                        kingdom: kingdom,
                        type: type,
                        recordedBy: r.recordedBy || '',
                        lat: r.decimalLatitude,
                        lng: r.decimalLongitude,
                        mediaCount: r.mediaCount || 0,
                        mediaItems: r.media || []
                    };
                });
                
                allResults = allResults.concat(pageResults);
                
                // Stop if we've reached maxTotal or no more results
                if (allResults.length >= maxTotal) {
                    console.log(`✓ Fetched ${allResults.length} occurrences (limit reached: ${maxTotal})`);
                    return allResults.slice(0, maxTotal);
                }
                
                // Check if there are more results to fetch
                const nextOffset = offset + limit;
                if (nextOffset < data.count) {
                    console.log(`More results available: ${nextOffset}/${data.count}, fetching next page...`);
                    // Fetch next page recursively
                    return fetchPage(nextOffset, allResults);
                }
                
                console.log(`✓ Fetched all ${allResults.length} occurrences`);
                return allResults;
            })
            .catch(error => {
                console.error('Error fetching GBIF data:', error);
                console.error('Error details:', error.message, error.stack);
                return allResults;
            });
    };
    
    return fetchPage();
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

function getFilteredSightings() {
    let filtered = currentSightings || [];
    if (selectedYear) filtered = filtered.filter(s => s.year === selectedYear);
    if (selectedKingdom) filtered = filtered.filter(s => s.type === selectedKingdom);
    return filtered;
}

function updateSightingMarkers(sightings) {
    if (!sightingMarkersLayer) return;
    sightingMarkersLayer.clearLayers();
    Object.keys(sightingMarkerMap).forEach(k => delete sightingMarkerMap[k]);

    const withCoords = (sightings || []).filter(s => s.lat != null && s.lng != null);
    withCoords.forEach(s => {
        const marker = L.circleMarker([s.lat, s.lng], {
            radius: 6,
            fillColor: '#2e7d32',
            color: '#fff',
            weight: 1.5,
            opacity: 1,
            fillOpacity: 0.85
        });

        const buildPopupContent = (imageSection) => {
            const recordedBy = s.recordedBy ? `<br><small>Recorded by ${s.recordedBy}</small>` : '';
            return `
                <strong class="popup-species-link" style="cursor:pointer; color:#2d5016; text-decoration:underline; user-select:none;" title="Click to view on Wikipedia" data-species-name="${s.species}">${s.species}</strong><br>
                <span style="color:#666">${s.date} · ${s.type || 'Unknown'}</span>${recordedBy}
                <div style="margin:0.5rem 0; text-align:center;">${imageSection}</div>
            `;
        };

        marker.bindPopup(buildPopupContent('<span style="color:#999;font-size:0.85rem;">Loading...</span>'), {
            maxWidth: 220,
            minWidth: 200
        });

        marker.on('popupopen', function () {
            fetchOccurrenceMedia(s.id, s.species, s.mediaItems).then(imageUrl => {
                const popup = marker.getPopup();
                if (!popup.isOpen()) return;
                if (imageUrl) {
                    const imgHtml = `<img src="${imageUrl}" alt="${s.species}" style="max-width:180px; max-height:140px; object-fit:cover; border-radius:6px; cursor:pointer; display:block; margin:0 auto;" crossorigin="anonymous" title="Click to enlarge">`;
                    popup.setContent(buildPopupContent(imgHtml));
                    const imgEl = popup.getElement()?.querySelector('img');
                    if (imgEl) {
                        imgEl.addEventListener('click', () => openImageModal(imageUrl, s.species, s.recordedBy));
                    }
                } else {
                    popup.setContent(buildPopupContent('<span style="color:#999;font-size:0.85rem;">No image available</span>'));
                }
                // Add click handler to species name in popup
                const speciesLink = popup.getElement()?.querySelector('.popup-species-link');
                if (speciesLink) {
                    speciesLink.addEventListener('click', (e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        const speciesName = speciesLink.getAttribute('data-species-name');
                        if (speciesName) {
                            const encodedName = encodeURIComponent(speciesName);
                            const wikipediaUrl = `https://en.wikipedia.org/wiki/${encodedName.replace(/%20/g, '_')}`;
                            window.open(wikipediaUrl, '_blank', 'noopener,noreferrer');
                        }
                    });
                }
            });
        });

        marker.on('click', function () {
            map.setView([s.lat, s.lng], Math.max(map.getZoom(), 14));
        });

        sightingMarkerMap[s.id] = marker;
        sightingMarkersLayer.addLayer(marker);
    });
}

function focusSightingOnMap(sighting) {
    if (!sighting || sighting.lat == null || sighting.lng == null) return;
    map.setView([sighting.lat, sighting.lng], Math.max(map.getZoom(), 14));
    const marker = sightingMarkerMap[sighting.id];
    if (marker) marker.openPopup();
}

function highlightSightingInList(sightingId) {
    // Find the list item with this sighting ID
    const listItem = document.querySelector(`[data-sighting-id="${sightingId}"]`);
    if (!listItem) {
        console.warn('Sighting not found in current page view:', sightingId);
        return;
    }

    // Remove previous highlights
    document.querySelectorAll('.sightingItem-highlighted').forEach(item => {
        item.classList.remove('sightingItem-highlighted');
    });

    // Add highlight to the target item
    listItem.classList.add('sightingItem-highlighted');

    // Scroll the item into view smoothly
    listItem.scrollIntoView({
        behavior: 'smooth',
        block: 'nearest',
        inline: 'nearest'
    });

    // Remove highlight after 3 seconds
    setTimeout(() => {
        listItem.classList.remove('sightingItem-highlighted');
    }, 3000);
}

function renderSightings(countyName, layer) {
    const list = document.getElementById('sightingsList');
    if (!list) return;

    // clear and show loading with progress info
    list.innerHTML = '<li class="noSightings">Loading sightings from GBIF database...</li>';

    // get bounds from stored county bounds, or try to get from layer
    let bounds = countyBounds[countyName];
    if (!bounds || !bounds.isValid()) {
        // Try to get bounds directly from the layer
        try {
            bounds = layer.getBounds();
            if (bounds && bounds.isValid()) {
                countyBounds[countyName] = bounds;
            } else {
                list.innerHTML = '<li class="noSightings">Error: unable to determine county bounds.</li>';
                console.error('Invalid bounds for county:', countyName, bounds);
                return;
            }
        } catch (e) {
            list.innerHTML = '<li class="noSightings">Error: unable to determine county bounds.</li>';
            console.error('Error getting bounds:', e);
            return;
        }
    }

    console.log('Rendering sightings for county:', countyName, 'with bounds:', bounds);

    // Set a reasonable timeout for the API call
    const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('GBIF API request timeout after 15 seconds')), 15000)
    );

    // fetch GBIF data with timeout
    Promise.race([fetchGBIFData(bounds), timeoutPromise]).then(sightings => {
        currentSightings = sightings;
        currentPage = 1;
        selectedYear = null;
        selectedKingdom = null;

        if (sightings.length === 0) {
            updateSightingMarkers([]);
            list.innerHTML = '';
            const li = document.createElement('li');
            li.className = 'noSightings';
            li.textContent = 'No sightings found for this county.';
            list.appendChild(li);
            return;
        }

        // Extract unique years for filtering (all available from GBIF data)
        const years = [...new Set(sightings.map(s => s.year).filter(Boolean))].sort((a, b) => b - a);
        const yearRange = years.length > 0 ? `${Math.max(...years)} - ${Math.min(...years)}` : 'N/A';

        // Extract unique types (Fauna, Flora, etc.) for filtering
        const types = [...new Set(sightings.map(s => s.type).filter(Boolean))].sort();
        const typeCounts = {};
        types.forEach(type => {
            typeCounts[type] = sightings.filter(s => s.type === type).length;
        });

        // Update sightings controls with both filters
        const controlsDiv = document.getElementById('sightingsControls');
        if (controlsDiv) {
            let filterHTML = `<div class="filter-header">
                <span class="filter-title">Filters</span>
                <button class="filter-toggle-btn" onclick="toggleFilters()" title="Toggle filters visibility">▼</button>
            </div>
            <div class="sightingsFilterGroup">
                <div class="filterRow">
                    <div class="filterItem">
                        <label for="typeFilter">Filter by Type:</label>
                        <select id="typeFilter" onchange="filterByType(this.value)">
                            <option value="" selected>All Types (${sightings.length})</option>`;
            types.forEach(type => {
                filterHTML += `<option value="${type}">${type} (${typeCounts[type]})</option>`;
            });
            filterHTML += `</select>
                    </div>
                    <div class="filterItem">
                        <label for="yearFilter">Filter by Year (<span class="yearRangeLabel">${yearRange}</span>):</label>
                        <select id="yearFilter" onchange="filterByYear(this.value)">
                            <option value="" selected>All Years (${sightings.length})</option>`;
            years.forEach(year => {
                const yearCount = sightings.filter(s => s.year === year).length;
                filterHTML += `<option value="${year}">${year} (${yearCount})</option>`;
            });
            filterHTML += `</select>
                    </div>
                </div>
                <button class="clearFilterBtn" onclick="clearAllFilters()">Clear All Filters</button>
                <span class="sightingCount">Total: ${sightings.length} sightings</span>
            </div>`;
            controlsDiv.innerHTML = filterHTML;
        }

        updateSightingMarkers(getFilteredSightings());
        renderPage();
    }).catch(error => {
        console.error('Error in renderSightings:', error);
        list.innerHTML = '<li class="noSightings">Unable to load sightings. ' + error.message + ' Please try another county or check your connection.</li>';
    });
}

// Render current page with current filters applied
function renderPage() {
    updateSightingMarkers(getFilteredSightings());

    const list = document.getElementById('sightingsList');
    if (!list) return;

    list.innerHTML = '';

    // Filter sightings by selected year and type
    let filteredSightings = currentSightings;
    if (selectedYear) {
        filteredSightings = filteredSightings.filter(s => s.year === selectedYear);
    }
    if (selectedKingdom) {
        filteredSightings = filteredSightings.filter(s => s.type === selectedKingdom);
    }

    if (filteredSightings.length === 0) {
        const li = document.createElement('li');
        li.className = 'noSightings';
        li.textContent = selectedYear ? `No sightings found for ${selectedYear}.` : 'No sightings found.';
        list.appendChild(li);
        return;
    }

    // Calculate pagination
    const totalPages = Math.ceil(filteredSightings.length / itemsPerPage);
    const startIdx = (currentPage - 1) * itemsPerPage;
    const endIdx = startIdx + itemsPerPage;
    const pageItems = filteredSightings.slice(startIdx, endIdx);

    // Render items for current page
    pageItems.forEach((s, index) => {
        const li = document.createElement('li');
        li.className = 'sightingItem' + (s.lat != null && s.lng != null ? ' sightingItem-clickable' : '');
        li.setAttribute('data-sighting-id', s.id);

        const speciesHTML = createSpeciesLinks(s.species);
        const textContent = `${speciesHTML} — ${s.date}`;

        // Create container with text on left
        li.innerHTML = `
            <div class="sightingContent">
                <div class="sightingText">${textContent}</div>
                <div class="sightingImage" id="img-${s.id}"><div class="imageLoading">Loading...</div></div>
            </div>
        `;
        if (s.lat != null && s.lng != null) {
            li.addEventListener('click', function (e) {
                if (e.target.closest('.sightingImage img')) return;
                focusSightingOnMap(s);
            });
        }
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
                            openImageModal(imageUrl, s.species, s.recordedBy);
                        });
                    }
                } else {
                    imgContainer.innerHTML = '<div class="imageNotFound">No image available</div>';
                }
            }
        });
    });

    // Add pagination controls
    if (totalPages > 1) {
        const paginationDiv = document.createElement('div');
        paginationDiv.className = 'pagination';

        const prevBtn = document.createElement('button');
        prevBtn.textContent = 'Previous';
        prevBtn.disabled = currentPage === 1;
        prevBtn.onclick = () => previousPage();

        const pageInfo = document.createElement('span');
        pageInfo.className = 'pageInfo';
        pageInfo.innerHTML = `Page 
            <input type="number" 
                   class="pageNumberInput" 
                   min="1" 
                   max="${totalPages}" 
                   value="${currentPage}"
                   onchange="goToPage(parseInt(this.value))" 
                   title="Enter page number"> 
            of ${totalPages}`;

        const nextBtn = document.createElement('button');
        nextBtn.textContent = 'Next';
        nextBtn.disabled = currentPage === totalPages;
        nextBtn.onclick = () => nextPage();

        paginationDiv.appendChild(prevBtn);
        paginationDiv.appendChild(pageInfo);
        paginationDiv.appendChild(nextBtn);

        list.appendChild(paginationDiv);
    }
}

// Pagination functions
function nextPage() {
    const filteredSightings = selectedYear ? currentSightings.filter(s => s.year === selectedYear) : currentSightings;
    const totalPages = Math.ceil(filteredSightings.length / itemsPerPage);
    if (currentPage < totalPages) {
        currentPage++;
        renderPage();
    }
}

function previousPage() {
    if (currentPage > 1) {
        currentPage--;
        renderPage();
    }
}

function filterByYear(year) {
    selectedYear = year ? parseInt(year) : null;
    currentPage = 1;
    renderPage();
}

function filterByType(type) {
    selectedKingdom = type ? type : null;
    currentPage = 1;
    renderPage();
}

function clearAllFilters() {
    selectedYear = null;
    selectedKingdom = null;
    currentPage = 1;
    renderPage();
}

function toggleFilters() {
    const filterGroup = document.querySelector('.sightingsFilterGroup');
    const toggleBtn = document.querySelector('.filter-toggle-btn');
    const controlsDiv = document.getElementById('sightingsControls');

    if (filterGroup && toggleBtn && controlsDiv) {
        controlsDiv.classList.toggle('filters-collapsed');
        toggleBtn.textContent = controlsDiv.classList.contains('filters-collapsed') ? '▶' : '▼';
    }
}

function goToPage(pageNum) {
    const filteredSightings = getFilteredSightings();
    const totalPages = Math.ceil(filteredSightings.length / itemsPerPage);

    if (pageNum >= 1 && pageNum <= totalPages) {
        currentPage = pageNum;
        renderPage();
    } else {
        // Reset to valid page if invalid input
        renderPage();
    }
}

function clearSelection() {
    if (highlightedLayer) {
        if (highlightedLayer.defaultStyle) highlightedLayer.setStyle(highlightedLayer.defaultStyle);
        highlightedLayer = null;
    }
    const countyNameEl = document.getElementById('countyName');
    const clearBtn = document.getElementById('clearBtn');
    const list = document.getElementById('sightingsList');
    const controlsDiv = document.getElementById('sightingsControls');

    if (countyNameEl) countyNameEl.textContent = 'Select a County';
    if (clearBtn) clearBtn.style.display = 'none';
    if (list) list.innerHTML = '';
    if (controlsDiv) controlsDiv.innerHTML = '<p class="hint">Sightings will be shown here. Filters and controls will appear here.</p>';

    if (sightingMarkersLayer) sightingMarkersLayer.clearLayers();
    Object.keys(sightingMarkerMap).forEach(k => delete sightingMarkerMap[k]);

    // Reset pagination state
    currentSightings = [];
    currentPage = 1;
    selectedYear = null;
    selectedKingdom = null;
}

// --- SPECIES IDENTIFICATION ---

let lastUploadedImageData = null;

function handleImageUpload(file) {
    if (!file) return;

    // Validate file
    if (!file.type.startsWith('image/')) {
        showIdentifyError('Please upload an image file');
        return;
    }

    if (file.size > 5 * 1024 * 1024) {
        showIdentifyError('Image must be less than 5MB');
        return;
    }

    // Show loading state
    showIdentifyLoading();

    // Read and display the image
    const reader = new FileReader();
    reader.onload = function (e) {
        const imageData = e.target.result;
        lastUploadedImageData = imageData;

        // Display uploaded image in results area
        setTimeout(() => {
            displayUploadedImage(imageData);
            // Here you would call your backend API to analyze the image
            // For now, we'll show a placeholder for the species identification
            sendImageToBackend(imageData, file.name);
        }, 500);
    };
    reader.readAsDataURL(file);
}

function displayUploadedImage(imageSrc) {
    const identifyResults = document.getElementById('identifyResults');
    identifyResults.innerHTML = `
        <div class="results-content">
            <img src="${imageSrc}" alt="Uploaded species image" class="results-image" />
            <div style="width: 100%;">
                <div class="loading-spinner"></div>
                <p class="loading-text">Analyzing image...</p>
            </div>
        </div>
    `;
}

function showIdentifyLoading() {
    const identifyResults = document.getElementById('identifyResults');
    identifyResults.innerHTML = `
        <div style="text-align: center;">
            <div class="loading-spinner"></div>
            <p class="loading-text">Processing image...</p>
        </div>
    `;
}

function showIdentifyError(message) {
    const identifyResults = document.getElementById('identifyResults');
    identifyResults.innerHTML = `
        <div class="error-message">
            <strong>Error:</strong> ${message}
        </div>
        <p class="results-placeholder">Try uploading another image</p>
    `;
}

function displayIdentificationResults(results) {
    const identifyResults = document.getElementById('identifyResults');

    if (!results || results.error) {
        showIdentifyError(results?.error || 'Failed to identify species');
        return;
    }

    // Handle label being null
    const species = results.label || 'Unknown Species';
    const confidence = results.confidence ? (Math.round(results.confidence * 100)) + '%' : 'N/A';
    const source = results.source || 'unknown';

    // Build alternative labels section if available
    let alternativeLabelsHTML = '';
    if (results.all_labels && results.all_labels.length > 1) {
        alternativeLabelsHTML = `
            <div class="details-section">
                <h4>Alternative Classifications</h4>
                <div class="alternatives-list">
                    ${results.all_labels.slice(1, 5).map(label => {
            const alternativeLinks = createSpeciesLinks(label.description);
            return `
                            <div class="alternative-item">
                                <span>${alternativeLinks}</span>
                                <span class="confidence-badge">${Math.round(label.score * 100)}%</span>
                            </div>
                        `;
        }).join('')}
                </div>
            </div>
        `;
    }

    // Build detected objects section if available
    let objectsHTML = '';
    if (results.additional_details && results.additional_details.detected_objects && results.additional_details.detected_objects.length > 0) {
        objectsHTML = `
            <div class="details-section">
                <h4>Other Detected Objects</h4>
                <div class="objects-list">
                    ${results.additional_details.detected_objects.map(obj => `
                        <div class="object-item">
                            <span>${obj.name}</span>
                            <span class="confidence-badge">${Math.round(obj.score * 100)}%</span>
                        </div>
                    `).join('')}
                </div>
            </div>
        `;
    }

    // Build colors section if available
    let colorsHTML = '';
    if (results.additional_details && results.additional_details.dominant_colors && results.additional_details.dominant_colors.length > 0) {
        colorsHTML = `
            <div class="details-section">
                <h4>Dominant Colors</h4>
                <div class="colors-list">
                    ${results.additional_details.dominant_colors.map(color => `
                        <div class="color-item">
                            <div class="color-box" style="background-color: ${color.hex};"></div>
                            <div class="color-info">
                                <span>${color.hex}</span>
                                <span class="color-percentage">${Math.round(color.pixel_fraction * 100)}%</span>
                            </div>
                        </div>
                    `).join('')}
                </div>
            </div>
        `;
    }

    // Build text detection section if available
    let textHTML = '';
    if (results.additional_details && results.additional_details.detected_text) {
        textHTML = `
            <div class="details-section">
                <h4>Text Detected in Image</h4>
                <p class="detected-text">"${results.additional_details.detected_text}"</p>
            </div>
        `;
    }

    const uploadedImageHTML = lastUploadedImageData ? `
        <img src="${lastUploadedImageData}" alt="Uploaded species image" class="results-image" />
    ` : '';

    const speciesLinksHTML = createSpeciesLinks(species);

    const resultsHTML = `
        <div class="results-content">
            ${uploadedImageHTML}
            <div class="results-header">
                <h3>${speciesLinksHTML}</h3>
                <div class="result-item">
                    <span class="result-label">Confidence:</span>
                    <span class="result-value confidence-score">${confidence}</span>
                </div>
            </div>

            <div class="results-info">
                <div class="result-item">
                    <span class="result-label">Detection Method:</span>
                    <span class="result-value method-badge">${source}</span>
                </div>
            </div>

            ${alternativeLabelsHTML}
            ${objectsHTML}
            ${colorsHTML}
            ${textHTML}
        </div>
    `;

    identifyResults.innerHTML = resultsHTML;
}

function sendImageToBackend(imageData, fileName) {
    // Convert data URL to Blob for FormData
    const byteString = atob(imageData.split(',')[1]);
    const mimeString = imageData.split(',')[0].match(/:(.*?);/)[1];
    const ab = new ArrayBuffer(byteString.length);
    const ia = new Uint8Array(ab);
    for (let i = 0; i < byteString.length; i++) {
        ia[i] = byteString.charCodeAt(i);
    }
    const blob = new Blob([ab], { type: mimeString });

    // Prepare FormData
    const formData = new FormData();
    formData.append('image', blob, fileName);

    // Get backend URL (defaults to localhost:5000, change as needed)
    const backendUrl = 'https://nonenvious-kirsten-unprefixally.ngrok-free.dev/predict';

    fetch(backendUrl, {
        method: 'POST',
        body: formData
    })
        .then(response => {
            if (!response.ok) {
                throw new Error(`Backend error: ${response.status}`);
            }
            return response.json();
        })
        .then(data => {
            if (data.success && data.result) {
                displayIdentificationResults(data.result);
            } else {
                showIdentifyError(data.result?.error || 'Classification failed');
            }
        })
        .catch(error => {
            console.error('Error sending image to backend:', error);
            showIdentifyError('Could not connect to classifier backend. Make sure it is running on http://localhost:5000');
        });
}

// Mock results function (kept for reference, no longer used)
// function showMockIdentificationResults() {
//     const mockResults = {
//         species: 'American Robin',
//         scientificName: 'Turdus migratorius',
//         kingdom: 'Animalia',
//         type: 'Fauna',
//         confidence: 0.92,
//         description: 'A common songbird found throughout North America.',
//         imageUrl: null
//     };
//     displayIdentificationResults(mockResults);
// }
