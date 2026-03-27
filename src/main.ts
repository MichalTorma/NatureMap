import './style.css';
import L from 'leaflet';
import * as LucideIcons from 'lucide';

interface LayerConfig {
  id: string;
  type: 'xyz' | 'wms';
  label: string;
  icon: string;
  active?: boolean;
  url: string;
  options?: any;
}

interface AppConfig {
  mapOptions: {
    center: [number, number];
    zoom: number;
  };
  layers: LayerConfig[];
  gbif: {
    defaultStyle: string;
    defaultTaxon: number;
    availableStyles: { id: string; label: string }[];
  };
}

async function initMap() {
  try {
    const response = await fetch('/config.json');
    if (!response.ok) throw new Error('Failed to load config.json');
    const config: AppConfig = await response.json();

    // 1. Initialize Map
    const map = L.map('map', {
      center: config.mapOptions.center,
      zoom: config.mapOptions.zoom,
      layers: [] 
    });

    // 2. Map Layer Factory & Initialization
    const baseLayers: Record<string, L.Layer> = {};
    const layerContainer = document.getElementById('layer-options');

    // Extract icons
    const iconsObject: Record<string, any> = {};
    for (const [key, value] of Object.entries(LucideIcons)) {
      if (typeof value === 'object' && Array.isArray(value)) {
        iconsObject[key] = value;
      }
    }

    config.layers.forEach((layerSpec) => {
      const leafletLayer = layerSpec.type === 'wms' 
        ? L.tileLayer.wms(layerSpec.url, layerSpec.options)
        : L.tileLayer(layerSpec.url, layerSpec.options);
      
      baseLayers[layerSpec.id] = leafletLayer;
      if (layerSpec.active) leafletLayer.addTo(map);

      if (layerContainer) {
        const btn = document.createElement('button');
        btn.className = `layer-btn ${layerSpec.active ? 'active' : ''}`;
        btn.setAttribute('data-layer', layerSpec.id);
        btn.innerHTML = `<i data-lucide="${layerSpec.icon}"></i><span>${layerSpec.label}</span>`;
        layerContainer.appendChild(btn);

        btn.addEventListener('click', (e) => {
          e.preventDefault();
          Object.values(baseLayers).forEach(l => map.removeLayer(l));
          leafletLayer.addTo(map);
          document.querySelectorAll('.layer-btn').forEach(b => b.classList.remove('active'));
          btn.classList.add('active');
        });
      }
    });

    // 3. GBIF Implementation
    let gbifLayer: L.TileLayer | null = null;
    let currentTaxonKey = config.gbif.defaultTaxon;
    let currentStyle = config.gbif.defaultStyle;
    let currentYear = 2025;

    const gbifSearch = document.getElementById('gbif-search') as HTMLInputElement;
    const gbifResults = document.getElementById('gbif-results') as HTMLElement;
    const gbifStyleSelect = document.getElementById('gbif-style') as HTMLSelectElement;
    const gbifYearInput = document.getElementById('gbif-year') as HTMLInputElement;
    const yearValueDisplay = document.getElementById('year-value') as HTMLElement;

    // Populate styles
    config.gbif.availableStyles.forEach(s => {
      const opt = document.createElement('option');
      opt.value = s.id;
      opt.textContent = s.label;
      gbifStyleSelect.appendChild(opt);
    });
    gbifStyleSelect.value = currentStyle;

    const updateGbifLayer = () => {
      if (gbifLayer) map.removeLayer(gbifLayer);
      
      const url = `https://api.gbif.org/v2/map/occurrence/density/{z}/{x}/{y}@2x.png?style=${currentStyle}&taxonKey=${currentTaxonKey}&year=${currentYear}`;
      gbifLayer = L.tileLayer(url, {
        opacity: 0.8,
        attribution: 'Observations &copy; <a href="https://www.gbif.org">GBIF</a>'
      }).addTo(map);
    };

    // Initial load
    updateGbifLayer();

    // GBIF UI Events
    gbifStyleSelect.addEventListener('change', () => {
      currentStyle = gbifStyleSelect.value;
      updateGbifLayer();
    });

    gbifYearInput.addEventListener('input', () => {
      currentYear = parseInt(gbifYearInput.value);
      yearValueDisplay.textContent = currentYear.toString();
      updateGbifLayer();
    });

    // Species Search with debouncing
    let searchTimeout: any;
    gbifSearch.addEventListener('input', () => {
      clearTimeout(searchTimeout);
      const query = gbifSearch.value.trim();
      if (query.length < 3) {
        gbifResults.style.display = 'none';
        return;
      }

      searchTimeout = setTimeout(async () => {
        const res = await fetch(`https://api.gbif.org/v1/species/suggest?q=${encodeURIComponent(query)}&datasetKey=d7dddbf4-2cf0-4f39-9b2a-bb099caae36c`);
        const suggestions = await res.json();
        
        gbifResults.innerHTML = '';
        if (suggestions.length > 0) {
          gbifResults.style.display = 'block';
          suggestions.slice(0, 5).forEach((s: any) => {
            const li = document.createElement('li');
            li.innerHTML = `
              <span class="common">${s.vernacularName || s.scientificName}</span>
              <span class="scientific">${s.scientificName}</span>
            `;
            li.addEventListener('click', () => {
              currentTaxonKey = s.key;
              gbifSearch.value = s.vernacularName || s.scientificName;
              gbifResults.style.display = 'none';
              updateGbifLayer();
            });
            gbifResults.appendChild(li);
          });
        } else {
          gbifResults.style.display = 'none';
        }
      }, 400);
    });

    // Close results on click outside
    document.addEventListener('click', (e) => {
      if (!gbifSearch.contains(e.target as Node)) {
        gbifResults.style.display = 'none';
      }
    });

    // 4. Geolocation Implementation
    const locateBtn = document.getElementById('locate-btn');
    let userMarker: L.Marker | null = null;
    if (locateBtn) {
      locateBtn.addEventListener('click', () => {
        locateBtn.classList.add('loading');
        map.locate({ setView: true, maxZoom: 16, enableHighAccuracy: true });
      });
    }
    map.on('locationfound', (e) => {
      if (locateBtn) locateBtn.classList.remove('loading');
      const pulseIcon = L.divIcon({
        className: 'user-location-marker',
        html: '<div class="pulse-marker"></div>',
        iconSize: [20, 20],
        iconAnchor: [10, 10]
      });
      if (userMarker) userMarker.setLatLng(e.latlng);
      else userMarker = L.marker(e.latlng, { icon: pulseIcon }).addTo(map);
    });
    map.on('locationerror', (e) => {
      if (locateBtn) locateBtn.classList.remove('loading');
      alert(`Location access denied or unavailable: ${e.message}`);
    });

    // Final Icons refresh
    LucideIcons.createIcons({ icons: iconsObject });

  } catch (error) {
    console.error('Error initializing map:', error);
  }
}

initMap();
