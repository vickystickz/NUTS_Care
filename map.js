// --- 1. CONFIGURATION ---
const wmsUrl = 'https://geoserver22s.zgis.at/geoserver/ipsdi_wt25/wms';
const wfsUrlBase = 'https://geoserver22s.zgis.at/geoserver/ipsdi_wt25/wfs';

const layerPolygons = 'ipsdi_wt25:household_status_60plus_by_region';
const layerHospitals = 'ipsdi_wt25:hospitals_AT';

const myStyles = {
    total: 'ipsdi_wt25:group6_style_normalized_t',
    female: 'ipsdi_wt25:group6_style_normalized_f',
    male: 'ipsdi_wt25:group6_style_normalized_m'
};

// Global variables for total counts
let globalTotal60Plus = 0;
let globalTotalHospitals = 0;

function fixText(str) {
    if (!str) return "";
    try { return decodeURIComponent(escape(str)); } catch (e) { return str; }
}

// Function to reset stats to global totals
function resetStats() {
    const peopleEl = document.getElementById('count-people');
    if (peopleEl) peopleEl.innerText = globalTotal60Plus.toLocaleString('en-US');

    const hospitalEl = document.getElementById('count-hospitals');
    if (hospitalEl) hospitalEl.innerText = globalTotalHospitals.toLocaleString('en-US');

    // Clear list highlight
    document.querySelectorAll('.district-item').forEach(el => el.classList.remove('active'));
}
// Helper to highlight list item
function highlightListItem(districtName) {
    document.querySelectorAll('.district-item').forEach(el => el.classList.remove('active'));

    const cleanId = 'district-' + districtName.replace(/\s+/g, '-').toLowerCase();
    const item = document.getElementById(cleanId);
    if (item) {
        item.classList.add('active');
        item.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
}

// --- 2. LAYERS ---
const osmLayer = new ol.layer.Tile({ source: new ol.source.OSM() });

function createWmsLayer(styleName, visible) {
    return new ol.layer.Tile({
        visible: visible,
        source: new ol.source.TileWMS({
            url: wmsUrl,
            params: { 'LAYERS': layerPolygons, 'STYLES': styleName, 'TILED': true },
            serverType: 'geoserver',
            crossOrigin: 'anonymous'
        })
    });
}
const lTotal = createWmsLayer(myStyles.total, true);
const lFemale = createWmsLayer(myStyles.female, false);
const lMale = createWmsLayer(myStyles.male, false);

// Hospitals (Vector)
const hospitalSource = new ol.source.Vector({
    format: new ol.format.GeoJSON(),
    url: function (extent) {
        return wfsUrlBase + '?service=WFS&version=1.1.0&request=GetFeature&typeName=' +
            layerHospitals + '&outputFormat=application/json&srsName=EPSG:3857';
    }
});

const clusterSource = new ol.source.Cluster({
    distance: 35,
    minDistance: 70,
    source: hospitalSource
});


const iconStyle = new ol.style.Style({
    image: new ol.style.Icon({
        src: 'hospital_pin.svg',
        scale: 1,
        anchor: [0.5, 0.5]
    })
});

const hospitalLayer = new ol.layer.Vector({
    source: clusterSource,
    zIndex: 2000,
    style: function (feature) {
        const size = feature.get('features').length;

        if (size > 1) {
            return new ol.style.Style({
                image: new ol.style.Circle({
                    radius: size * 0.60 + 12,
                    fill: new ol.style.Fill({ color: '#436b6b', })
                }),
                text: new ol.style.Text({
                    text: size.toString(),
                    fill: new ol.style.Fill({ color: '#fff' }),
                    fontWeight: 'bold',
                    size: '12px'
                })
            });
        } else {
            return iconStyle;
        }
    }
});

// Highlight
const highlightSource = new ol.source.Vector();
const highlightLayer = new ol.layer.Vector({
    source: highlightSource,
    zIndex: 1000,
    style: new ol.style.Style({
        stroke: new ol.style.Stroke({ color: '#f1c40f', width: 4 }),
        fill: new ol.style.Fill({ color: 'rgba(255, 255, 0, 0)' }),
        image: new ol.style.Circle({ radius: 9, fill: new ol.style.Fill({ color: '#f1c40f' }) })
    })
});

// --- 3. MAP SETUP ---
const container = document.getElementById('popup');
const content = document.getElementById('popup-content');
const closer = document.getElementById('popup-closer');
const overlay = new ol.Overlay({ element: container, autoPan: { animation: { duration: 250 } } });

closer.onclick = function () {
    overlay.setPosition(undefined);
    highlightSource.clear();
    if (document.querySelector('.district-item.active')) {
        document.querySelector('.district-item.active').classList.remove('active');
        updateVisibleCount();
    } else {
        resetStats();
    }

    closer.blur();
    return false;
};

const map = new ol.Map({
    target: 'map',
    layers: [osmLayer, lTotal, lFemale, lMale, hospitalLayer, highlightLayer],
    overlays: [overlay],
    view: new ol.View({
        center: ol.proj.fromLonLat([13.3, 47.7]),
        zoom: 8
    }),
    controls: ol.control.defaults.defaults().extend([
        new ol.control.ZoomToExtent({
            extent: [750000, 5750000, 2250000, 6250000],
            label: document.createRange().createContextualFragment('<i class="fa-solid fa-house"></i>'),
            tipLabel: 'Home'
        }),
        new ol.control.ScaleLine({
            units: 'metric',
            bar: false,
            steps: 2,
            text: true,
            minWidth: 60
        })
    ])
});

// --- 4. POPUP & UPDATE STATS ---
function showPopupAndHighlight(properties, geometry, coordinate) {
    highlightSource.clear();
    if (geometry) highlightSource.addFeature(new ol.Feature(geometry));

    const safeName = fixText(properties.name || 'Unnamed');
    let html = '';

    // CASE A: Hospital Popup
    if (properties.hasOwnProperty('code') || geometry.getType() === 'Point') {
        html += `<div style="color:#e74c3c; font-weight:700; margin-bottom:8px; font-size:1.1em;"><i class="fa-solid fa-hospital"></i> Clinic</div>`;
        html += `<div style="font-size:1.2em; font-weight:600; margin-bottom:5px;">${safeName}</div>`;
    } else {
        // CASE B: Region Popup
        html += `<div style="font-weight:700; margin-bottom:10px; font-size:1.3em; color:#00695c;">${safeName}</div>`;

        highlightListItem(safeName);

        // --- NEW LOGIC: Dynamic Sentence & Sidebar Update ---

        // 1. Sidebar Stats Update
        if (properties.total_above60 !== undefined) {
            document.getElementById('count-people').innerText = properties.total_above60.toLocaleString('en-US');
        }
        if (properties.hospitals_in_region !== undefined) {
            document.getElementById('count-hospitals').innerText = properties.hospitals_in_region.toLocaleString('en-US');
        }

        // 2. Dynamic Sentence in Popup
        if (properties.total_total) {
            const hospitalsCount = properties.hospitals_in_region || 0;
            html += `<div style="margin-bottom:12px; color:#555; line-height:1.4; font-size:0.95em; border-bottom:1px solid #eee; padding-bottom:8px;">
                <strong style="color:#2c3e50;">${properties.total_total.toLocaleString('en-US')}</strong> 
                people are living in this NUTS region and are likely to use one out of 
                <strong style="color:#e74c3c;">${hospitalsCount}</strong> hospitals.
            </div>`;
        }

        html += `<table class="popup-table">`;
        const fmt = (val) => (typeof val === 'number') ? val.toFixed(2) : val;

        if (properties.normalized_f !== undefined) html += `<tr><td class="popup-key">Index (Female):</td><td class="popup-val">${fmt(properties.normalized_f)}</td></tr>`;
        if (properties.normalized_m !== undefined) html += `<tr><td class="popup-key">Index (Male):</td><td class="popup-val">${fmt(properties.normalized_m)}</td></tr>`;

        if (properties['notinnucleus_ above60_m'] !== undefined) {
            html += `<tr><td class="popup-key">above 60 - living alone:</td><td class="popup-val">${properties['notinnucleus_ above60_m']}</td></tr>`;
        }

        // Removed redundant stats from table since they are in sidebar/text

        if (properties.average_travel_time !== undefined) html += `<tr><td class="popup-key">Travel Time:</td><td class="popup-val">${fmt(properties.average_travel_time)} min</td></tr>`;
        html += `</table>`;
    }
    content.innerHTML = html;
    overlay.setPosition(coordinate);
}

// --- 5. INTERACTION ---
map.on('pointermove', function (e) {
    const pixel = map.getEventPixel(e.originalEvent);
    const hit = map.hasFeatureAtPixel(pixel, {
        layerFilter: (l) => l === hospitalLayer
    });
    map.getTargetElement().style.cursor = hit ? 'pointer' : '';
});

map.on('singleclick', function (evt) {
    const feature = map.forEachFeatureAtPixel(evt.pixel, function (feat, layer) {
        if (layer === highlightLayer) return null;
        return feat;
    });

    if (feature) {
        let targetFeature = feature;
        const clusteredFeatures = feature.get('features');

        if (clusteredFeatures) {
            if (clusteredFeatures.length > 1) {
                const extent = ol.extent.createEmpty();
                clusteredFeatures.forEach(f => ol.extent.extend(extent, f.getGeometry().getExtent()));
                map.getView().fit(extent, { padding: [100, 500, 100, 350], duration: 1000 });
                return;
            } else {
                targetFeature = clusteredFeatures[0];
            }
        }
        const props = targetFeature.getProperties();
        const geom = targetFeature.getGeometry();

        if (props.normalized_f === undefined && props.code === undefined && props.name === undefined) return;

        showPopupAndHighlight(props, geom, evt.coordinate);

    } else {
        let source = null;
        if (lFemale.getVisible()) source = lFemale.getSource();
        else if (lMale.getVisible()) source = lMale.getSource();
        else if (lTotal.getVisible()) source = lTotal.getSource();

        if (source) {
            const url = source.getFeatureInfoUrl(
                evt.coordinate, map.getView().getResolution(), 'EPSG:3857',
                { 'INFO_FORMAT': 'application/json' }
            );
            if (url) {
                fetch(url).then(res => res.json()).then(data => {
                    if (data.features && data.features.length > 0) {
                        const props = data.features[0].properties;
                        const geom = new ol.format.GeoJSON().readGeometry(data.features[0].geometry);
                        showPopupAndHighlight(props, geom, evt.coordinate);
                    } else {
                        overlay.setPosition(undefined);
                        highlightSource.clear();
                        resetStats();
                    }
                });
            }
        }
    }
});

var peopleFeature = null

// --- 6. DATA & STATS ---
const listContainer = document.getElementById('district-list-container');
const wfsUrlPolygons = wfsUrlBase + '?service=WFS&version=1.1.0&request=GetFeature&typeName=' +
    layerPolygons + '&outputFormat=application/json&srsName=EPSG:3857';

fetch(wfsUrlPolygons)
    .then(res => res.json())
    .then(data => {
        listContainer.innerHTML = '';
        const features = data.features;

        let total60plus = 0;
        // Reset count for safety
        globalTotalHospitals = 0;

        features.forEach(f => {
            if (f.properties.total_above60) total60plus += f.properties.total_above60;
        });

        peopleFeature = features;
        globalTotal60Plus = total60plus;
        document.getElementById('count-people').innerText = total60plus.toLocaleString('en-US');

        const count = hospitalSource.getFeatures().length;
        globalTotalHospitals = count;
        document.getElementById('count-hospitals').innerText = count.toLocaleString('en-US');

        features.sort((a, b) => fixText(a.properties.name || "").localeCompare(fixText(b.properties.name || "")));

        // Create search bar container
        const searchContainer = document.createElement('div');
        searchContainer.className = 'search-container';

        const searchInput = document.createElement('input');
        searchInput.type = 'text';
        searchInput.placeholder = 'Search districts...';
        searchInput.className = 'district-search';

        searchContainer.appendChild(searchInput);
        listContainer.parentElement.insertBefore(searchContainer, listContainer);

        // Add search functionality
        searchInput.addEventListener('input', (e) => {
            const searchTerm = e.target.value.toLowerCase();
            const items = listContainer.querySelectorAll('.district-item');

            if (items.length === 0) {
                return;
            }

            let visibleCount = 0;

            items.forEach(item => {
                const districtName = item.innerText.toLowerCase();
                if (districtName.includes(searchTerm)) {
                    item.style.display = 'block';
                    visibleCount++;
                } else {
                    item.style.display = 'none';
                }
            });

            // Handle no results message
            let noResultsMsg = listContainer.querySelector('.no-results-message');

            if (visibleCount === 0 && searchTerm !== '') {
                if (!noResultsMsg) {
                    noResultsMsg = document.createElement('div');
                    noResultsMsg.className = 'no-results-message';
                    noResultsMsg.style.cssText = 'padding: 20px; text-align: center; color: #666; font-style: italic;';
                    noResultsMsg.innerText = 'District not found';
                    listContainer.appendChild(noResultsMsg);
                }
                noResultsMsg.style.display = 'block';
            } else {
                if (noResultsMsg) {
                    noResultsMsg.style.display = 'none';
                }
            }
        });

        // Original code to populate the list
        features.forEach(f => {
            const safeName = fixText(f.properties.name || "District");
            const item = document.createElement('div');
            item.className = 'district-item';
            item.innerText = safeName;

            const cleanId = 'district-' + safeName.replace(/\s+/g, '-').toLowerCase();
            item.id = cleanId;

            item.addEventListener('click', () => {
                const geom = new ol.format.GeoJSON().readGeometry(f.geometry);
                map.getView().fit(geom, { padding: [100, 500, 100, 350], duration: 1000 });
                showPopupAndHighlight(f.properties, geom, ol.extent.getCenter(geom.getExtent()));

                // Clear search after clicking
                searchInput.value = '';
                const districtItems = document.querySelectorAll('.district-item');
                districtItems.forEach(el => el.style.display = 'block');
            });
            listContainer.appendChild(item);
        });
    })
    .catch(err => listContainer.innerHTML = 'Error loading data.');





hospitalSource.on('change', function () {
    if (hospitalSource.getState() === 'ready') {
        updateVisibleHospitalCount();
    }
});

// COUNT GLOBAL HOSPITALS (ONCE)
hospitalSource.once('change', function () {
    if (hospitalSource.getState() === 'ready') {
        const count = hospitalSource.getFeatures().length;
        globalTotalHospitals = count;
        document.getElementById('count-hospitals').innerText = count.toLocaleString('en-US');
    }
});

// Function to update the count based on the current view
function updateVisibleCount() {
    const activeDistrict = document.querySelector('.district-item.active');
    if (activeDistrict) return; // Skip update if a district is active 
    const extent = map.getView().calculateExtent(map.getSize());
    const visibleHospitalFeatures = hospitalSource.getFeaturesInExtent(extent);
    const count = visibleHospitalFeatures.length;
    document.getElementById('count-hospitals').innerText = count.toLocaleString('en-US');

    highlightSource.getFeaturesInExtent(extent)
    const peopleEl = document.getElementById('count-people');
    if (peopleEl && peopleFeature) {
        let totalPeople = 0;
        peopleFeature.forEach(f => {
            const geom = new ol.format.GeoJSON().readGeometry(f.geometry);
            if (ol.extent.intersects(extent, geom.getExtent())) {
                totalPeople += f.properties.total_above60 || 0;
            }
        });
        peopleEl.innerText = totalPeople.toLocaleString('en-US');
    }
}


map.on('moveend', updateVisibleCount);


// --- 7. LAYER LOGIC ---
const boxes = document.querySelectorAll('.viz-cb');
const layerMap = { 'total': lTotal, 'female': lFemale, 'male': lMale };

function updateLayers() {
    boxes.forEach(b => { if (layerMap[b.value]) layerMap[b.value].setVisible(b.checked); });
}
boxes.forEach(box => {
    box.addEventListener('change', function () {
        if (this.checked) boxes.forEach(other => { if (other !== this) other.checked = false; });
        updateLayers();
    });
});
document.getElementById('check-hospitals').addEventListener('change', e => {
    hospitalLayer.setVisible(e.target.checked);
});

// --- 8. UI INTERACTION ---
const switcherContainer = document.getElementById('layer-switcher');
const switcherHeader = document.getElementById('layer-switcher-header');

switcherHeader.addEventListener('click', () => {
    switcherContainer.classList.toggle('collapsed');
});

setTimeout(() => {
    const homeBtn = document.querySelector('.ol-zoom-extent button');
    if (homeBtn) {
        homeBtn.addEventListener('click', () => {
            overlay.setPosition(undefined);
            highlightSource.clear();
            resetStats();
        });
    }
}, 1000);

// --- 9. DISTRICT LIST TOGGLE (MOBILE) ---
const districtLabel = document.getElementById('district-label');
const sidebar = document.getElementById('sidebar');


districtLabel.addEventListener('click', () => {
    sidebar.classList.toggle('collapsed-districts');
    // hide search input when collapsed

    const searchContainer = document.querySelector('.search-container');
    if (searchContainer) {
        searchContainer.classList.toggle('collapsed-search');
    }
});


// --- 10. INFO MODAL LOGIC ---

var closeModal = document.getElementById('info-modal-closer');
var infoContainer = document.getElementById('info-icon-container');
var infoModal = document.getElementById('info-modal');

infoContainer.addEventListener('mouseenter', function () {
    if (infoModal.style.display == 'block') {
        infoModal.style.display = 'none';
    } else {
        infoModal.style.display = 'block';
    }
});

infoContainer.addEventListener('mouseleave', function () {
    infoModal.style.display = 'none';
});


closeModal.addEventListener('click', function () {
    var infoModal = document.getElementById('info-modal');
    infoModal.style.display = 'none';
});
