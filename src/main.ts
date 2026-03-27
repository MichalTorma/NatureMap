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
    availableStyles: { id: string; label: string; params: string }[];
  };
}

async function initMap() {
  try {
    const response = await fetch('/config.json');
    if (!response.ok) throw new Error('Failed to load config.json');
    const config: AppConfig = await response.json();

    // 1. Storage Helpers
    const STORAGE_KEY_CENTER = 'mymap_center';
    const STORAGE_KEY_ZOOM = 'mymap_zoom';
    
    const savedCenter = localStorage.getItem(STORAGE_KEY_CENTER);
    const savedZoom = localStorage.getItem(STORAGE_KEY_ZOOM);
    
    const initialCenter: [number, number] = savedCenter ? JSON.parse(savedCenter) : config.mapOptions.center;
    const initialZoom = savedZoom ? parseInt(savedZoom) : config.mapOptions.zoom;

    // 2. Initialize Map
    const map = L.map('map', {
      center: initialCenter,
      zoom: initialZoom,
      layers: [] 
    });

    // Save State on Change
    const saveState = () => {
      const center = map.getCenter();
      localStorage.setItem(STORAGE_KEY_CENTER, JSON.stringify([center.lat, center.lng]));
      localStorage.setItem(STORAGE_KEY_ZOOM, map.getZoom().toString());
    };
    map.on('moveend', saveState);
    map.on('zoomend', saveState);

    // 3. Health & Layer Management
    const baseLayers: Record<string, L.Layer> = {};
    const layerContainer = document.getElementById('layer-options');

    // Extract icons
    const iconsObject: Record<string, any> = {};
    for (const [key, value] of Object.entries(LucideIcons)) {
      if (typeof value === 'object' && Array.isArray(value)) {
        iconsObject[key] = value;
      }
    }

    const checkLayerHealth = async (layerSpec: LayerConfig, btn: HTMLElement) => {
      const dot = btn.querySelector('.status-dot');
      try {
        let testUrl = layerSpec.url
          .replace('{s}', 'a')
          .replace('{r}', '')
          .replace('{z}', '10')
          .replace('{x}', '511')
          .replace('{y}', '340');
          
        if (layerSpec.type === 'wms') {
           testUrl = layerSpec.url.split('?')[0] + '?SERVICE=WMS&REQUEST=GetCapabilities';
        }
        
        // Use 'cors' mode to get real status codes and avoid ORB noise
        const res = await fetch(testUrl, { method: 'HEAD', mode: 'cors' });
        if (res.ok) {
          dot?.classList.add('online');
        } else {
          throw new Error('Offline');
        }
      } catch (e) {
        dot?.classList.add('offline');
        btn.classList.add('offline');
      }
    };

    config.layers.forEach((layerSpec) => {
      const layerOptions = { 
        ...layerSpec.options, 
        errorTileUrl: '/error-tile.png',
        crossOrigin: 'anonymous' // Enable CORS to avoid ORB blocks on errors
      };

      const leafletLayer = layerSpec.type === 'wms' 
        ? L.tileLayer.wms(layerSpec.url, layerOptions)
        : L.tileLayer(layerSpec.url, layerOptions);
      
      baseLayers[layerSpec.id] = leafletLayer;
      if (layerSpec.active) leafletLayer.addTo(map);

      // Handle Live Errors
      leafletLayer.on('tileerror', () => {
        const btn = document.querySelector(`[data-layer="${layerSpec.id}"]`);
        const dot = btn?.querySelector('.status-dot');
        dot?.classList.remove('online');
        dot?.classList.add('offline');
        btn?.classList.add('offline');
      });

      if (layerContainer) {
        const btn = document.createElement('button');
        btn.className = `layer-btn ${layerSpec.active ? 'active' : ''}`;
        btn.setAttribute('data-layer', layerSpec.id);
        btn.innerHTML = `<div class="status-dot"></div><i data-lucide="${layerSpec.icon}"></i><span>${layerSpec.label}</span>`;
        layerContainer.appendChild(btn);

        btn.addEventListener('click', (e) => {
          e.preventDefault();
          if (btn.classList.contains('offline')) return;
          Object.values(baseLayers).forEach(l => map.removeLayer(l));
          leafletLayer.addTo(map);
          document.querySelectorAll('.layer-btn').forEach(b => b.classList.remove('active'));
          btn.classList.add('active');
        });

        // Run Pre-flight Health Check
        checkLayerHealth(layerSpec, btn);
      }
    });

    // 4. GBIF Overlay Logic
    let gbifLayer: L.TileLayer | null = null;
    let currentTaxonKey = config.gbif.defaultTaxon;
    let currentStyleId = config.gbif.defaultStyle;
    let currentYear = 2025;
    let currentOrigins: string[] = ['HUMAN_OBSERVATION', 'ALL']; 
    let isPlaying = false;
    let playInterval: any;

    const gbifSection = document.getElementById('gbif-section');
    const gbifHeader = gbifSection?.querySelector('.section-header');
    
    // Add health status dot to GBIF section
    if (gbifHeader) {
      const dot = document.createElement('div');
      dot.className = 'status-dot';
      gbifHeader.appendChild(dot);
    }

    const gbifSearch = document.getElementById('gbif-search') as HTMLInputElement;
    const gbifResults = document.getElementById('gbif-results') as HTMLElement;
    const gbifStyleSelect = document.getElementById('gbif-style') as HTMLSelectElement;
    const gbifYearInput = document.getElementById('gbif-year') as HTMLInputElement;
    const yearValueDisplay = document.getElementById('year-value') as HTMLElement;
    const playBtn = document.getElementById('gbif-play');
    const originBtns = document.querySelectorAll('#gbif-origin .toggle-btn');

    config.gbif.availableStyles.forEach(s => {
      const opt = document.createElement('option');
      opt.value = s.id; opt.textContent = s.label;
      gbifStyleSelect.appendChild(opt);
    });
    gbifStyleSelect.value = currentStyleId;

    const checkGbifHealth = async () => {
      const dot = gbifHeader?.querySelector('.status-dot');
      try {
        // Use a stable V1 API endpoint for the heartbeat to ensure a clean console and accurate status
        const testUrl = `https://api.gbif.org/v1/species/2435099`;
        const res = await fetch(testUrl, { method: 'HEAD', mode: 'cors' });
        if (res.ok) {
          dot?.classList.add('online');
        } else {
          throw new Error('Offline');
        }
      } catch (e) {
        dot?.classList.add('offline');
      }
    };
    checkGbifHealth();

    const updateGbifLayer = () => {
      if (gbifLayer) map.removeLayer(gbifLayer);
      
      const styleConfig = config.gbif.availableStyles.find(s => s.id === currentStyleId);
      const styleParams = styleConfig?.params || 'style=classic.poly';
      
      const yearRange = `1900,${currentYear}`;
      
      let originParam = '';
      if (!currentOrigins.includes('ALL')) {
        originParam = `&basisOfRecord=${currentOrigins.join(',')}`;
      }
      
      // Use v2 with srs=EPSG:3857 and @1x spec for most robust Varnish routing
      const url = `https://api.gbif.org/v2/map/occurrence/density/{z}/{x}/{y}@1x.png?srs=EPSG:3857&${styleParams}&taxonKey=${currentTaxonKey}&year=${yearRange}${originParam}`;
      gbifLayer = L.tileLayer(url, { 
        opacity: 0.8,
        attribution: '&copy; GBIF',
        crossOrigin: 'anonymous', // Enable CORS to avoid ORB blocks on errors (404s)
        errorTileUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=' // Silent handling for expected 404s
      }).addTo(map);
    };
    
    let updateTimeout: any;
    const debouncedUpdateGbifLayer = (delay = 300) => {
      clearTimeout(updateTimeout);
      updateTimeout = setTimeout(() => updateGbifLayer(), delay);
    };

    // Set initial UI state
    gbifSearch.value = "Puma"; 
    updateGbifLayer();

    const fetchGbif = async (query: string) => {
      const res = await fetch(`https://api.gbif.org/v1/species/suggest?q=${encodeURIComponent(query)}&datasetKey=d7dddbf4-2cf0-4f39-9b2a-bb099caae36c`);
      const suggestions = await res.json();
      gbifResults.innerHTML = '';
      if (suggestions.length > 0) {
        gbifResults.style.display = 'block';
        suggestions.slice(0, 5).forEach((s: any) => {
          const li = document.createElement('li');
          li.innerHTML = `<span class="common">${s.vernacularName || s.scientificName}</span><span class="scientific">${s.scientificName}</span>`;
          li.addEventListener('click', () => {
            currentTaxonKey = s.key;
            gbifSearch.value = s.vernacularName || s.scientificName;
            gbifResults.style.display = 'none';
            debouncedUpdateGbifLayer(10); // Nearly immediate but through common pipe
          });
          gbifResults.appendChild(li);
        });
      } else gbifResults.style.display = 'none';
    };

    let searchTimeout: any;
    gbifSearch.addEventListener('input', () => {
      clearTimeout(searchTimeout);
      const query = gbifSearch.value.trim();
      if (query.length < 3) { gbifResults.style.display = 'none'; return; }
      searchTimeout = setTimeout(() => fetchGbif(query), 600); // 600ms debounce
    });

    gbifStyleSelect.addEventListener('change', () => { 
      currentStyleId = gbifStyleSelect.value; 
      debouncedUpdateGbifLayer(100); 
    });
    
    // Split input (visual) from change (network update) to reduce API pressure
    gbifYearInput.addEventListener('input', () => {
      currentYear = parseInt(gbifYearInput.value);
      yearValueDisplay.textContent = currentYear.toString();
    });
    gbifYearInput.addEventListener('change', () => {
      debouncedUpdateGbifLayer(200);
    });

    // Playback Animation Loop
    if (playBtn) {
      playBtn.addEventListener('click', () => {
        isPlaying = !isPlaying;
        playBtn.classList.toggle('playing', isPlaying);
        const icon = playBtn.querySelector('i');
        if (icon) icon.setAttribute('data-lucide', isPlaying ? 'square' : 'play');
        LucideIcons.createIcons({ icons: iconsObject });

        if (isPlaying) {
          if (currentYear >= 2025) {
             currentYear = 1900;
             gbifYearInput.value = "1900";
          }
          playInterval = setInterval(() => {
            currentYear += 2; // Step by 2 years for speed
            if (currentYear > 2025) {
              currentYear = 2025;
              isPlaying = false;
              clearInterval(playInterval);
              playBtn.classList.remove('playing');
              if (icon) icon.setAttribute('data-lucide', 'play');
              LucideIcons.createIcons({ icons: iconsObject });
            }
            gbifYearInput.value = currentYear.toString();
            yearValueDisplay.textContent = currentYear.toString();
            updateGbifLayer();
          }, 1200); // 1200ms interval for stable grid generation
        } else {
          clearInterval(playInterval);
        }
      });
    }

    // Origin Toggles
    originBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        const value = btn.getAttribute('data-value') || 'ALL';
        
        if (value === 'ALL') {
          currentOrigins = ['ALL'];
          originBtns.forEach(b => b.classList.remove('active'));
          btn.classList.add('active');
        } else {
          document.querySelector('[data-value="ALL"]')?.classList.remove('active');
          if (currentOrigins.includes('ALL')) currentOrigins = [];
          
          if (currentOrigins.includes(value)) {
            currentOrigins = currentOrigins.filter(v => v !== value);
            btn.classList.remove('active');
          } else {
            currentOrigins.push(value);
            btn.classList.add('active');
          }
          
          if (currentOrigins.length === 0) {
            currentOrigins = ['ALL'];
            document.querySelector('[data-value="ALL"]')?.classList.add('active');
          }
        }
        debouncedUpdateGbifLayer(400); // Debounce origin toggles
      });
    });

    // 5. Geolocation Implementation & Smart Startup
    const locateBtn = document.getElementById('locate-btn');
    let userMarker: L.Marker | null = null;
    if (locateBtn) {
      locateBtn.addEventListener('click', () => {
        locateBtn.classList.add('loading');
        map.locate({ setView: true, maxZoom: 16, enableHighAccuracy: true });
      });
    }
    
    // Auto-locate on startup if no saved session
    if (!savedCenter) {
      map.locate({ setView: true, maxZoom: 13 });
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

    // 6. Responsive UI Interactivity
    const uiPanel = document.getElementById('ui-panel');
    const panelHeader = uiPanel?.querySelector('.panel-header');
    
    // Toggle Bottom Sheet on Mobile
    if (panelHeader) {
      panelHeader.addEventListener('click', () => {
        if (window.innerWidth <= 768) {
          uiPanel?.classList.toggle('collapsed');
        }
      });
    }

    // Toggle Collapsible Sections
    const collapsibles = document.querySelectorAll('.collapsible');
    collapsibles.forEach(section => {
      const header = section.querySelector('.section-header');
      header?.addEventListener('click', () => {
        // Optional: Close others
        // collapsibles.forEach(s => s.classList.remove('active'));
        section.classList.toggle('active');
      });
    });

    // Final Icons refresh
    LucideIcons.createIcons({ icons: iconsObject });

  } catch (error) {
    console.error('Error initializing map:', error);
  }
}

initMap();
