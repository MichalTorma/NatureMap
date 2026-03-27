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

const iconsObject: Record<string, any> = {};
for (const [key, value] of Object.entries(LucideIcons)) {
  if (typeof value === 'object' && Array.isArray(value)) {
    iconsObject[key] = value;
  }
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
    const map = L.map('map', { center: initialCenter, zoom: initialZoom, layers: [] });
    const saveState = () => {
      const center = map.getCenter();
      localStorage.setItem(STORAGE_KEY_CENTER, JSON.stringify([center.lat, center.lng]));
      localStorage.setItem(STORAGE_KEY_ZOOM, map.getZoom().toString());
    };
    map.on('moveend', saveState);
    map.on('zoomend', saveState);

    // 3. Layer Management
    const baseLayers: Record<string, L.Layer> = {};
    const layerContainer = document.getElementById('layer-options');

    config.layers.forEach((layerSpec) => {
      const leafletLayer = layerSpec.type === 'wms' 
        ? L.tileLayer.wms(layerSpec.url, { ...layerSpec.options, crossOrigin: 'anonymous' })
        : L.tileLayer(layerSpec.url, { ...layerSpec.options, crossOrigin: 'anonymous' });
      baseLayers[layerSpec.id] = leafletLayer;
      if (layerSpec.active) leafletLayer.addTo(map);

      if (layerContainer) {
        const btn = document.createElement('button');
        btn.className = `layer-btn ${layerSpec.active ? 'active' : ''}`;
        btn.setAttribute('data-layer', layerSpec.id);
        btn.innerHTML = `<div class="status-dot"></div><i data-lucide="${layerSpec.icon}"></i><span>${layerSpec.label}</span>`;
        layerContainer.appendChild(btn);
        btn.addEventListener('click', () => {
          Object.values(baseLayers).forEach(l => map.removeLayer(l));
          leafletLayer.addTo(map);
          document.querySelectorAll('.layer-btn').forEach(b => b.classList.remove('active'));
          btn.classList.add('active');
        });
      }
    });

    // 4. GBIF Biodiversity Core Logic
    let gbifLayer: L.TileLayer | null = null;
    let currentTaxonKey: number | null = null;
    let currentShape = 'hex';
    let currentPalette = 'classic';
    let currentDensity = 45;
    let currentOpacity = 0.8;
    let currentYear: number | 'ALL' = 'ALL';
    let currentOrigins: string[] = ['HUMAN_OBSERVATION', 'ALL']; 
    let isPlaying = false;
    let playInterval: any;

    const gbifSection = document.getElementById('gbif-section');
    const gbifHeader = gbifSection?.querySelector('.section-header');
    if (gbifHeader) {
      const dot = document.createElement('div');
      dot.className = 'status-dot';
      gbifHeader.appendChild(dot);
    }

    const gbifSearch = document.getElementById('gbif-search') as HTMLInputElement;
    const gbifResults = document.getElementById('gbif-results') as HTMLElement;
    const gbifYearInput = document.getElementById('gbif-year') as HTMLInputElement;
    const yearValueDisplay = document.getElementById('year-value') as HTMLElement;
    const playBtn = document.getElementById('gbif-play');
    const originBtns = document.querySelectorAll('#gbif-origin .toggle-btn');
    const shapeBtns = document.querySelectorAll('#gbif-shape-picker .picker-btn');
    const paletteBtns = document.querySelectorAll('#gbif-palette-picker .palette-btn');
    const densityInput = document.getElementById('gbif-density') as HTMLInputElement;
    const opacityInput = document.getElementById('gbif-opacity') as HTMLInputElement;
    const advancedToggle = document.getElementById('advanced-toggle');
    const advancedDrawer = document.getElementById('advanced-drawer');
    const densityValueTag = document.getElementById('density-value');
    const opacityValueTag = document.getElementById('opacity-value');
    const historyShelf = document.getElementById('gbif-history');
    const styleTester = document.getElementById('style-tester') as HTMLCanvasElement;
    const paletteStatusTag = document.getElementById('palette-status');

    const resolveGbifStyle = (palette: string, shape: string): string => {
      // 100% Strictly Typed GBIF Map Style Resolutions.
      // We must NEVER mix .point styles on .poly grids, as it destroys scientific mapping data (renders dots inside hex bins).
      const isBinned = shape === 'hex' || shape === 'square';
      const isHeatmap = shape === 'heatmap';
      
      switch(palette) {
        case 'classic':
          return isBinned ? 'classic.poly' : 'classic.point';
        case 'green':
          return isBinned ? 'green.poly' : (isHeatmap ? 'greenHeat.point' : 'green.point');
        case 'blue':
          // Ocean Palette -> 'classic-noborder' uses a deep blue/cyan scaling for polygons.
          return isBinned ? 'classic-noborder.poly' : 'blueHeat.point'; 
        case 'orange':
          // Fire Palette -> 'red' is the official corresponding native GBIF polygon ramp for heat.
          return isBinned ? 'red.poly' : (isHeatmap ? 'orangeHeat.point' : 'fire.point');
        case 'purpleHeat':
          // Royal Palette -> 'purpleYellow' is the officially supported high-visibility binning ramp.
          return isBinned ? 'purpleYellow.poly' : 'purpleHeat.point';
        default:
          return 'classic.point';
      }
    };

    const getBinParam = (shape: string, density: number): string => {
      if (shape === 'hex') return `&bin=hex&hexPerTile=${density}`;
      if (shape === 'square') return `&bin=square&squareSize=${density === 45 ? 128 : (density > 50 ? 64 : 256)}`;
      return '';
    };

    // History Logic
    interface TaxonHistory { key: number | null; name: string; }
    let currentHistory: TaxonHistory[] = JSON.parse(localStorage.getItem('gbif_history') || '[]');

    const renderHistory = () => {
      if (!historyShelf) return;
      historyShelf.innerHTML = '';
      const globalChip = document.createElement('div');
      globalChip.className = `history-chip global ${currentTaxonKey === null ? 'active' : ''}`;
      globalChip.textContent = 'Global Biodiversity';
      globalChip.addEventListener('click', () => {
        currentTaxonKey = null;
        gbifSearch.value = '';
        renderHistory();
        debouncedUpdateGbifLayer(10);
      });
      historyShelf.appendChild(globalChip);

      currentHistory.forEach(h => {
        const chip = document.createElement('div');
        chip.className = `history-chip ${currentTaxonKey === h.key ? 'active' : ''}`;
        chip.textContent = h.name;
        chip.addEventListener('click', () => {
          currentTaxonKey = h.key;
          gbifSearch.value = h.name;
          renderHistory();
          debouncedUpdateGbifLayer(10);
        });
        historyShelf.appendChild(chip);
      });
    };

    const saveToHistory = (taxon: TaxonHistory) => {
      currentHistory = currentHistory.filter(h => h.key !== taxon.key);
      currentHistory.unshift(taxon);
      currentHistory = currentHistory.slice(0, 8);
      localStorage.setItem('gbif_history', JSON.stringify(currentHistory));
      renderHistory();
    };

    // Style Validation Logic
    const checkStyleCapability = async (shape: string, palette: string): Promise<boolean> => {
      const styleParam = resolveGbifStyle(palette, shape);
      const binParam = getBinParam(shape, 30); // Test at base resolution
      const testUrl = `https://api.gbif.org/v2/map/occurrence/adhoc/0/0/0@1x.png?srs=EPSG:3857&style=${styleParam}${binParam}&taxonKey=1`;
      try {
        const res = await fetch(testUrl, { mode: 'cors' });
        if (!res.ok) return false;
        const blob = await res.blob();
        const img = await createImageBitmap(blob);
        const ctx = styleTester.getContext('2d', { willReadFrequently: true });
        if (!ctx) return false;
        ctx.clearRect(0, 0, 256, 256);
        ctx.drawImage(img, 0, 0, 256, 256);
        const data = ctx.getImageData(0, 0, 256, 256).data;
        // Verify multiple non-transparent pixels to ensure capability vs noise
        let pixels = 0;
        for (let i = 3; i < data.length; i += 4) { if (data[i] > 10) pixels++; if (pixels > 1) return true; }
        return false;
      } catch (e) { return false; }
    };

    const validateAllPalettes = async (shape: string) => {
      if (paletteStatusTag) { paletteStatusTag.textContent = 'Verifying...'; paletteStatusTag.className = 'val-tag status-tag testing'; }
      const tests = Array.from(paletteBtns).map(async (btn) => {
        const palette = btn.getAttribute('data-palette') || 'classic';
        btn.classList.add('testing');
        btn.classList.remove('verified', 'unsupported');
        const isValid = await checkStyleCapability(shape, palette);
        btn.classList.remove('testing');
        if (isValid) btn.classList.add('verified'); else btn.classList.add('unsupported');
      });
      await Promise.all(tests);
      if (paletteStatusTag) { paletteStatusTag.textContent = 'Verified'; paletteStatusTag.className = 'val-tag status-tag verified'; }
    };

    const updateGbifLayer = () => {
      if (gbifLayer) map.removeLayer(gbifLayer);
      const styleParam = resolveGbifStyle(currentPalette, currentShape);
      const binParam = getBinParam(currentShape, currentDensity);
      const yearParam = currentYear === 'ALL' ? '' : `&year=1900,${currentYear}`;
      let originParam = '';
      if (!currentOrigins.includes('ALL')) originParam = `&basisOfRecord=${currentOrigins.join(',')}`;
      const taxonParam = currentTaxonKey ? `&taxonKey=${currentTaxonKey}` : '';
      const url = `https://api.gbif.org/v2/map/occurrence/adhoc/{z}/{x}/{y}@1x.png?srs=EPSG:3857&style=${styleParam}${binParam}${taxonParam}${yearParam}${originParam}`;
      gbifLayer = L.tileLayer(url, { 
        opacity: currentOpacity, 
        attribution: '&copy; GBIF', 
        crossOrigin: 'anonymous',
        errorTileUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='
      }).addTo(map);
    };

    let updateTimeout: any;
    const debouncedUpdateGbifLayer = (delay = 300) => {
      clearTimeout(updateTimeout);
      updateTimeout = setTimeout(() => updateGbifLayer(), delay);
    };

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
            const name = s.vernacularName || s.scientificName;
            gbifSearch.value = name;
            gbifResults.style.display = 'none';
            saveToHistory({ key: s.key, name: name });
            debouncedUpdateGbifLayer(10);
          });
          gbifResults.appendChild(li);
        });
      } else gbifResults.style.display = 'none';
    };

    gbifSearch.addEventListener('input', () => {
      const query = gbifSearch.value.trim();
      if (query.length < 3) { gbifResults.style.display = 'none'; return; }
      setTimeout(() => fetchGbif(query), 600);
    });

    shapeBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        shapeBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        const newShape = btn.getAttribute('data-shape') || 'hex';
        if (newShape !== currentShape) {
          currentShape = newShape;
          validateAllPalettes(currentShape);
          debouncedUpdateGbifLayer(100);
        }
      });
    });

    paletteBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        paletteBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        currentPalette = btn.getAttribute('data-palette') || 'classic';
        debouncedUpdateGbifLayer(100);
      });
    });

    advancedToggle?.addEventListener('click', () => {
      if (advancedDrawer) {
        advancedDrawer.style.display = advancedDrawer.style.display === 'none' ? 'flex' : 'none';
        const icon = advancedToggle.querySelector('i');
        if (icon) icon.setAttribute('data-lucide', advancedDrawer.style.display === 'none' ? 'settings-2' : 'x');
        LucideIcons.createIcons({ icons: iconsObject });
      }
    });

    densityInput.addEventListener('input', () => {
      currentDensity = parseInt(densityInput.value);
      if (densityValueTag) densityValueTag.textContent = currentDensity > 60 ? 'High' : (currentDensity < 30 ? 'Low' : 'Med');
      debouncedUpdateGbifLayer(400);
    });

    opacityInput.addEventListener('input', () => {
      currentOpacity = parseFloat(opacityInput.value);
      if (opacityValueTag) opacityValueTag.textContent = `${Math.round(currentOpacity * 100)}%`;
      if (gbifLayer) gbifLayer.setOpacity(currentOpacity);
    });

    gbifYearInput.addEventListener('input', () => {
      const val = parseInt(gbifYearInput.value);
      currentYear = val >= 2025 ? 'ALL' : val;
      yearValueDisplay.textContent = currentYear === 'ALL' ? 'All Years' : `1900 - ${currentYear}`;
    });
    gbifYearInput.addEventListener('change', () => debouncedUpdateGbifLayer(200));

    if (playBtn) {
      playBtn.addEventListener('click', () => {
        isPlaying = !isPlaying;
        playBtn.classList.toggle('playing', isPlaying);
        const icon = playBtn.querySelector('i');
        if (icon) icon.setAttribute('data-lucide', isPlaying ? 'square' : 'play');
        LucideIcons.createIcons({ icons: iconsObject });
        
        if (isPlaying) {
          if (currentYear === 'ALL' || currentYear >= 2025) currentYear = 1900;
          playInterval = setInterval(() => {
            if (currentYear !== 'ALL') currentYear += 2;
            if (currentYear !== 'ALL' && currentYear > 2025) {
              currentYear = 'ALL'; 
              isPlaying = false; 
              clearInterval(playInterval);
              playBtn.classList.remove('playing');
              if (icon) icon.setAttribute('data-lucide', 'play');
              LucideIcons.createIcons({ icons: iconsObject });
            }
            gbifYearInput.value = currentYear === 'ALL' ? "2025" : currentYear.toString();
            yearValueDisplay.textContent = currentYear === 'ALL' ? 'All Years' : `1900 - ${currentYear}`;
            updateGbifLayer();
          }, 1200);
        } else clearInterval(playInterval);
      });
    }

    originBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        const value = btn.getAttribute('data-value') || 'ALL';
        if (value === 'ALL') {
          currentOrigins = ['ALL'];
          originBtns.forEach(b => b.classList.remove('active'));
          btn.classList.add('active');
        } else {
          const allBtn = document.querySelector('[data-value="ALL"]');
          allBtn?.classList.remove('active');
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
             allBtn?.classList.add('active');
          }
        }
        debouncedUpdateGbifLayer(400);
      });
    });

    const locateBtn = document.getElementById('locate-btn');
    let userMarker: L.Marker | null = null;
    if (locateBtn) {
      locateBtn.addEventListener('click', () => {
        locateBtn.classList.add('loading');
        map.locate({ setView: true, maxZoom: 16, enableHighAccuracy: true });
      });
    }
    if (!savedCenter) map.locate({ setView: true, maxZoom: 13 });
    map.on('locationfound', (e) => {
      if (locateBtn) locateBtn.classList.remove('loading');
      const pulseIcon = L.divIcon({ className: 'user-location-marker', html: '<div class="pulse-marker"></div>', iconSize: [20, 20], iconAnchor: [10, 10] });
      if (userMarker) userMarker.setLatLng(e.latlng);
      else userMarker = L.marker(e.latlng, { icon: pulseIcon }).addTo(map);
    });

    // 5. UI Interactivity (Mobile Toggles & Collapsibles)
    const uiPanel = document.getElementById('ui-panel');
    const panelHeader = uiPanel?.querySelector('.panel-header');
    if (panelHeader) {
      panelHeader.addEventListener('click', () => {
        if (window.innerWidth <= 768) {
          uiPanel?.classList.toggle('collapsed');
        }
      });
    }
    const collapsibles = document.querySelectorAll('.collapsible');
    collapsibles.forEach(section => {
      section.querySelector('.section-header')?.addEventListener('click', () => {
        section.classList.toggle('active');
      });
    });

    const checkGbifHealth = async () => {
      const dot = gbifHeader?.querySelector('.status-dot');
      try {
        const testUrl = `https://api.gbif.org/v1/species/2435099`;
        const res = await fetch(testUrl, { method: 'HEAD', mode: 'cors' });
        if (res.ok) dot?.classList.add('online'); else throw new Error();
      } catch (e) { dot?.classList.add('offline'); }
    };
    
    // 6. Final Initialization
    renderHistory();
    checkGbifHealth();
    validateAllPalettes(currentShape);
    updateGbifLayer();
    LucideIcons.createIcons({ icons: iconsObject });

  } catch (error) {
    console.error('Error initializing map:', error);
  }
}

initMap();
