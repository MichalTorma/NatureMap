import './style.css';
import L from 'leaflet';
import * as LucideIcons from 'lucide';
import codes, { by639_1, by639_2T, by639_2B, type Code } from 'iso-language-codes';

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

const ICON_CACHE: Record<string, string> = {};
const getIconSvg = (name: string): string => {
  if (ICON_CACHE[name]) return ICON_CACHE[name];
  const temp = document.createElement('div');
  temp.innerHTML = `<i data-lucide="${name}"></i>`;
  (LucideIcons as any).createIcons({
    icons: iconsObject,
    root: temp
  });
  const svg = temp.innerHTML;
  ICON_CACHE[name] = svg;
  return svg;
};


async function initMap() {
  try {
    const response = await fetch('/config.json');
    if (!response.ok) throw new Error('Failed to load config.json');
    const config: AppConfig = await response.json();

    // 1. URL & Storage Initialization
    const urlParams = new URLSearchParams(window.location.search);
    const STORAGE_KEY_CENTER = 'mymap_center';
    const STORAGE_KEY_ZOOM = 'mymap_zoom';
    const savedCenter = localStorage.getItem(STORAGE_KEY_CENTER);
    const savedZoom = localStorage.getItem(STORAGE_KEY_ZOOM);
    
    // Core App State
    let gbifLayer: L.TileLayer | null = null;
    let currentTaxonKey: number | null = urlParams.has('taxon') ? parseInt(urlParams.get('taxon')!) : null;
    let currentShape = urlParams.get('shape') || 'hex';
    let currentPalette = urlParams.get('palette') || 'classic';
    let currentDensity = urlParams.has('density') ? parseInt(urlParams.get('density')!) : 45;
    let currentScaleMode = urlParams.get('scale') || 'static';
    let currentOpacity = urlParams.has('opacity') ? parseFloat(urlParams.get('opacity')!) : 0.8;
    let currentYear: number | 'ALL' = urlParams.has('year') ? (urlParams.get('year') === 'ALL' ? 'ALL' : parseInt(urlParams.get('year')!)) : 'ALL';
    let currentOrigins: string[] = urlParams.has('origins') ? urlParams.get('origins')!.split(',') : ['HUMAN_OBSERVATION', 'ALL']; 
    let gbifEnabled = true;
    let isPlaying = false;
    let playInterval: any;
    let closeSearchPanel = () => {};

    const STORAGE_KEY_LANGS = 'mymap_languages';
    const langLookup1 = by639_1 as Record<string, Code | undefined>;
    const langLookup2T = by639_2T as Record<string, Code | undefined>;
    const langLookup2B = by639_2B as Record<string, Code | undefined>;
    const resolveIso1 = (code3: string): string | undefined =>
      langLookup2T[code3]?.iso639_1 ?? langLookup2B[code3]?.iso639_1;
    const defaultLangs = (() => {
      const bl = navigator.language?.split('-')[0] || 'en';
      const langs = [bl];
      if (bl !== 'en') langs.push('en');
      return langs.filter(l => langLookup1[l]);
    })();
    let userLanguages: string[] = urlParams.has('langs')
      ? urlParams.get('langs')!.split(',').filter(l => langLookup1[l])
      : JSON.parse(localStorage.getItem(STORAGE_KEY_LANGS) || 'null') || defaultLangs;
    
    const initialLat = urlParams.has('lat') ? parseFloat(urlParams.get('lat')!) : (savedCenter ? JSON.parse(savedCenter)[0] : config.mapOptions.center[0]);
    const initialLng = urlParams.has('lng') ? parseFloat(urlParams.get('lng')!) : (savedCenter ? JSON.parse(savedCenter)[1] : config.mapOptions.center[1]);
    const initialCenter: L.LatLngTuple = [initialLat, initialLng];
    const initialZoom = urlParams.has('z') ? parseInt(urlParams.get('z')!) : (savedZoom ? parseInt(savedZoom) : config.mapOptions.zoom);

    // 2. Initialize Map
    const map = L.map('map', { center: initialCenter, zoom: initialZoom, layers: [] });
    // URL Serializer
    const syncStateToURL = () => {
      const p = new URLSearchParams();
      const center = map.getCenter();
      p.set('lat', center.lat.toFixed(4));
      p.set('lng', center.lng.toFixed(4));
      p.set('z', map.getZoom().toString());
      if (currentTaxonKey) p.set('taxon', currentTaxonKey.toString());
      p.set('shape', currentShape);
      p.set('palette', currentPalette);
      p.set('density', currentDensity.toString());
      p.set('scale', currentScaleMode);
      p.set('opacity', currentOpacity.toString());
      p.set('year', currentYear.toString());
      p.set('origins', currentOrigins.join(','));
      if (userLanguages.length > 0) p.set('langs', userLanguages.join(','));
      window.history.replaceState(null, '', `?${p.toString()}`);
    };

    const saveState = () => {
      const center = map.getCenter();
      localStorage.setItem(STORAGE_KEY_CENTER, JSON.stringify([center.lat, center.lng]));
      localStorage.setItem(STORAGE_KEY_ZOOM, map.getZoom().toString());
      syncStateToURL();
    };
    map.on('moveend', saveState);
    map.on('zoomend', saveState);

    // Initial load URL push if needed
    if (urlParams.toString() !== '') syncStateToURL();

    // 3. Layer Management
    const baseLayers: Record<string, L.Layer> = {};
    const layerContainer = document.getElementById('layer-options');

    config.layers.forEach((layerSpec) => {
      const leafletLayer = layerSpec.type === 'wms' 
        ? L.tileLayer.wms(layerSpec.url, { ...layerSpec.options, crossOrigin: 'anonymous', zIndex: 0 })
        : L.tileLayer(layerSpec.url, { ...layerSpec.options, crossOrigin: 'anonymous', zIndex: 0 });
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

    const GbifLayerClass = L.TileLayer.extend({
      getTileUrl: function(coords: any) {
        let url = L.TileLayer.prototype.getTileUrl.call(this, coords);
        const shape = this.options.gbifShape;
        const baseDensity = this.options.gbifDensity;
        
        if (this.options.gbifGridMode === 'geographic') {
            const z = this._getZoomForUrl ? this._getZoomForUrl() : coords.z;
            if (shape === 'hex') {
                const dynamicDensity = Math.max(1, Math.round(baseDensity / Math.pow(2, z)));
                url += `&bin=hex&hexPerTile=${dynamicDensity}`;
            } else if (shape === 'square') {
                const baseSize = 4096 / baseDensity;
                const scaledSize = Math.min(4096, baseSize * Math.pow(2, z));
                const p2 = Math.pow(2, Math.round(Math.log2(scaledSize)));
                url += `&bin=square&squareSize=${p2}`;
            }
        } else {
            if (shape === 'hex') url += `&bin=hex&hexPerTile=${baseDensity}`;
            if (shape === 'square') {
                const baseSize = 4096 / baseDensity;
                const p2 = Math.pow(2, Math.round(Math.log2(baseSize)));
                url += `&bin=square&squareSize=${p2}`;
            }
        }
        return url;
      }
    });

    const gbifSection = document.getElementById('gbif-section');
    const gbifHeader = gbifSection?.querySelector('.section-header');
    if (gbifHeader) {
      const dot = document.createElement('div');
      dot.className = 'status-dot';
      gbifHeader.appendChild(dot);
    }

    const gbifSearch = document.getElementById('gbif-search') as HTMLInputElement;
    const gbifResults = document.getElementById('gbif-results') as HTMLElement;
    const searchFabLabel = document.getElementById('search-fab-label');
    const menuFilterLabel = document.getElementById('menu-filter-label');

    const updateFilterLabel = (name: string | null) => {
      if (searchFabLabel) {
        searchFabLabel.textContent = name || 'All Species';
        searchFabLabel.classList.toggle('filtered', !!name);
      }
      if (menuFilterLabel) {
        if (name) {
          menuFilterLabel.textContent = name;
          menuFilterLabel.style.display = '';
        } else {
          menuFilterLabel.style.display = 'none';
        }
      }
    };
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
          return isBinned ? 'classic-noborder.poly' : 'classic.point';
        case 'green':
          return isBinned ? 'green-noborder.poly' : (isHeatmap ? 'greenHeat.point' : 'green.point');
        case 'blue':
          // Ocean Palette -> 'classic-noborder' uses a deep blue/cyan scaling for polygons.
          return isBinned ? 'classic-noborder.poly' : 'blueHeat.point'; 
        case 'orange':
          // Fire Palette -> 'red' is the official corresponding native GBIF polygon ramp. (No 'noborder' variant exists natively)
          return isBinned ? 'red.poly' : (isHeatmap ? 'orangeHeat.point' : 'fire.point');
        case 'purpleHeat':
          // Royal Palette -> 'purpleYellow-noborder' is the officially supported contiguous binning ramp.
          return isBinned ? 'purpleYellow-noborder.poly' : 'purpleHeat.point';
        default:
          return 'classic.point';
      }
    };

    // History Logic
    interface VnName { lang: string; name: string }
    interface TaxonHistory { key: number | null; name: string; names?: VnName[]; }
    let currentHistory: TaxonHistory[] = JSON.parse(localStorage.getItem('gbif_history') || '[]');

    const getPrimaryName = (h: TaxonHistory): string => {
      if (h.names && h.names.length > 0) {
        for (const lc of userLanguages) {
          const m = h.names.find(n => n.lang === lc);
          if (m) return m.name;
        }
        return h.names[0].name;
      }
      return h.name;
    };

    const renderHistory = () => {
      if (!historyShelf) return;
      historyShelf.innerHTML = '';
      const globalChip = document.createElement('div');
      globalChip.className = `history-chip global ${currentTaxonKey === null ? 'active' : ''}`;
      globalChip.textContent = 'Global Biodiversity';
      globalChip.addEventListener('click', () => {
        currentTaxonKey = null;
        gbifSearch.value = '';
        updateFilterLabel(null);
        renderHistory();
        debouncedUpdateGbifLayer(10);
      });
      historyShelf.appendChild(globalChip);

      currentHistory.forEach(h => {
        const chip = document.createElement('div');
        chip.className = `history-chip ${currentTaxonKey === h.key ? 'active' : ''}`;
        const displayName = getPrimaryName(h);
        chip.textContent = displayName;
        chip.addEventListener('click', () => {
          currentTaxonKey = h.key;
          gbifSearch.value = displayName;
          updateFilterLabel(displayName);
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

    // Vernacular Name Resolver
    const vnCache = new Map<number, VnName[]>();

    const resolveVernacularNames = async (taxonKey: number): Promise<VnName[]> => {
      if (!vnCache.has(taxonKey)) {
        try {
          const res = await fetch(
            `https://api.gbif.org/v1/species/${taxonKey}/vernacularNames?limit=200`
          );
          const data = await res.json();
          const allNames: VnName[] = [];
          for (const vn of data.results || []) {
            if (!vn.vernacularName || !vn.language) continue;
            const iso1 = resolveIso1(vn.language);
            if (iso1) allNames.push({ lang: iso1, name: vn.vernacularName });
          }
          vnCache.set(taxonKey, allNames);
        } catch {
          vnCache.set(taxonKey, []);
        }
      }
      const all = vnCache.get(taxonKey)!;
      const result: VnName[] = [];
      const seen = new Set<string>();
      for (const lc of userLanguages) {
        const match = all.find(n => n.lang === lc && !seen.has(lc));
        if (match) { result.push(match); seen.add(lc); }
      }
      return result;
    };

    // Style Validation Logic
    const checkStyleCapability = async (shape: string, palette: string): Promise<boolean> => {
      const styleParam = resolveGbifStyle(palette, shape);
      let binParam = '';
      if (shape === 'hex') binParam = '&bin=hex&hexPerTile=30';
      if (shape === 'square') binParam = '&bin=square&squareSize=128';
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

    const tilePixelRatio = Math.min(4, Math.ceil(window.devicePixelRatio || 1));

    const updateGbifLayer = () => {
      if (gbifLayer) map.removeLayer(gbifLayer);
      if (!gbifEnabled) return;
      const styleParam = resolveGbifStyle(currentPalette, currentShape);
      const yearParam = currentYear === 'ALL' ? '' : `&year=1900,${currentYear}`;
      let originParam = '';
      if (!currentOrigins.includes('ALL')) originParam = currentOrigins.map(o => `&basisOfRecord=${o}`).join('');
      const taxonParam = currentTaxonKey ? `&taxonKey=${currentTaxonKey}` : '';
      
      const url = `https://api.gbif.org/v2/map/occurrence/density/{z}/{x}/{y}@${tilePixelRatio}x.png?srs=EPSG:3857&style=${styleParam}${taxonParam}${yearParam}${originParam}`;
      
      const isBinned = currentShape === 'hex' || currentShape === 'square';
      const maxNative = isBinned
        ? (currentScaleMode === 'geographic' ? 17 : 14)
        : 17;

      gbifLayer = new (GbifLayerClass as any)(url, { 
        opacity: currentOpacity, 
        attribution: '&copy; GBIF', 
        crossOrigin: 'anonymous',
        zIndex: 10,
        tileSize: 512,
        zoomOffset: -1,
        maxNativeZoom: maxNative,
        gbifShape: currentShape,
        gbifDensity: currentDensity,
        gbifGridMode: currentScaleMode,
        errorTileUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='
      }).addTo(map);
      syncStateToURL();
    };

    let updateTimeout: any;
    const debouncedUpdateGbifLayer = (delay = 300) => {
      clearTimeout(updateTimeout);
      updateTimeout = setTimeout(() => updateGbifLayer(), delay);
    };

    const RANK_ORDER: Record<string, number> = {
      KINGDOM: 0, PHYLUM: 1, CLASS: 2, ORDER: 3, FAMILY: 4,
      GENUS: 5, SPECIES: 6, SUBSPECIES: 7, VARIETY: 8, FORM: 9
    };

    let searchGeneration = 0;

    const fetchGbif = async (query: string) => {
      const gen = ++searchGeneration;
      try {
        const res = await fetch(`https://api.gbif.org/v1/species/suggest?q=${encodeURIComponent(query)}&datasetKey=d7dddbf4-2cf0-4f39-9b2a-bb099caae36c&limit=8`);
        const suggestions = await res.json();
        if (gen !== searchGeneration) return;
        gbifResults.innerHTML = '';
        if (suggestions.length === 0) { gbifResults.style.display = 'none'; return; }

        gbifResults.style.display = 'block';
        const candidates = suggestions.slice(0, 8)
          .sort((a: any, b: any) => {
            const aRank = RANK_ORDER[a.rank] ?? 10;
            const bRank = RANK_ORDER[b.rank] ?? 10;
            return aRank - bRank;
          });

        const rows: {
          li: HTMLElement; s: any; countEl: HTMLElement; avatarEl: HTMLElement;
          vnEl: HTMLElement; resolvedNames: VnName[]; primaryName: string;
        }[] = [];

        candidates.forEach((s: any) => {
          const li = document.createElement('li');
          const rankHtml = s.rank ? `<span class="scientific-rank">${s.rank}</span>` : '';
          const nameToUse = s.vernacularName || s.canonicalName || s.scientificName;

          li.innerHTML = `
            <div class="search-avatar">${getIconSvg('leaf')}</div>
            <div class="search-title-row">
              <span class="common">${nameToUse}</span>
              ${rankHtml}
              <span class="scientific">${s.scientificName}</span>
            </div>
            <div class="vernacular-names"></div>
            <div class="obs-count">
              ${getIconSvg('loader-2')}
              <span class="obs-count-text">...</span>
            </div>
          `;

          const rowData = {
            li, s,
            countEl: li.querySelector('.obs-count-text') as HTMLElement,
            avatarEl: li.querySelector('.search-avatar') as HTMLElement,
            vnEl: li.querySelector('.vernacular-names') as HTMLElement,
            resolvedNames: [] as VnName[],
            primaryName: nameToUse
          };

          li.addEventListener('click', () => {
            currentTaxonKey = s.key;
            gbifSearch.value = rowData.primaryName;
            gbifResults.style.display = 'none';
            updateFilterLabel(rowData.primaryName);
            saveToHistory({ key: s.key, name: rowData.primaryName, names: rowData.resolvedNames });
            debouncedUpdateGbifLayer(10);
            closeSearchPanel();
          });
          gbifResults.appendChild(li);
          rows.push(rowData);
        });

        const enriched: { row: typeof rows[0]; count: number }[] = [];
        for (const row of rows) {
          if (gen !== searchGeneration) return;
          try {
            const [occData, vnNames] = await Promise.all([
              fetch(`https://api.gbif.org/v1/occurrence/search?taxonKey=${row.s.key}&limit=1`).then(r => r.json()),
              resolveVernacularNames(row.s.key)
            ]);
            if (gen !== searchGeneration) return;
            const count = occData.count || 0;
            const image = occData.results?.[0]?.media?.find((m: any) => m.type === 'StillImage')?.identifier
                       || occData.results?.[0]?.media?.[0]?.identifier || '';
            const validImage = image && (image.startsWith('http://') || image.startsWith('https://'));

            if (validImage) {
              row.avatarEl.outerHTML = `<img src="${image}" class="search-avatar" alt="${row.s.canonicalName}" loading="lazy" onerror="this.outerHTML='<div class=\\'search-avatar\\'>${getIconSvg('leaf')}</div>'">`;
            }
            row.countEl.textContent = count > 0 ? `${count.toLocaleString()} observations` : 'No observations';
            const iconEl = row.li.querySelector('.obs-count svg');
            if (iconEl) iconEl.outerHTML = getIconSvg('globe');
            if (count === 0) row.li.classList.add('no-observations');

            row.resolvedNames = vnNames;
            if (vnNames.length > 0) {
              row.primaryName = vnNames[0].name;
              const commonEl = row.li.querySelector('.common');
              if (commonEl) {
                const needsTag = vnNames[0].lang !== userLanguages[0];
                commonEl.innerHTML = needsTag
                  ? `<span class="lang-tag">${vnNames[0].lang.toUpperCase()}</span> ${vnNames[0].name}`
                  : vnNames[0].name;
              }
            }
            if (vnNames.length > 1 && row.vnEl) {
              row.vnEl.innerHTML = vnNames.slice(1).map(n =>
                `<span class="lang-tag">${n.lang.toUpperCase()}</span> ${n.name}`
              ).join('<span class="vn-sep"> · </span>');
            }

            enriched.push({ row, count });
          } catch {
            row.countEl.textContent = 'No observations';
            const iconEl = row.li.querySelector('.obs-count svg');
            if (iconEl) iconEl.outerHTML = getIconSvg('globe');
            row.li.classList.add('no-observations');
            enriched.push({ row, count: 0 });
          }
        }

        if (gen !== searchGeneration) return;
        const fragment = document.createDocumentFragment();
        enriched
          .sort((a, b) => {
            const aZero = a.count === 0 ? 1 : 0;
            const bZero = b.count === 0 ? 1 : 0;
            if (aZero !== bZero) return aZero - bZero;
            const aRank = RANK_ORDER[a.row.s.rank] ?? 10;
            const bRank = RANK_ORDER[b.row.s.rank] ?? 10;
            if (aRank !== bRank) return aRank - bRank;
            return b.count - a.count;
          })
          .forEach(({ row }) => fragment.appendChild(row.li));
        gbifResults.innerHTML = '';
        gbifResults.appendChild(fragment);
      } catch (e) {
        console.error('Suggest API Error', e);
      }
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
      if (densityValueTag) densityValueTag.textContent = `${currentDensity} Bins`;
      debouncedUpdateGbifLayer(200);
    });

    const scaleBtns = document.querySelectorAll('#gbif-scale-mode .toggle-btn');
    scaleBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        scaleBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        currentScaleMode = btn.getAttribute('data-mode') || 'static';
        // When dynamic geometry is active, clear out testing tag to avoid confusion
        if (currentScaleMode === 'geographic' && paletteStatusTag) {
            paletteStatusTag.textContent = 'Geo Active';
            paletteStatusTag.className = 'val-tag status-tag online';
        }
        debouncedUpdateGbifLayer(100);
      });
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

    const shareBtn = document.getElementById('share-btn');
    if (shareBtn) {
      shareBtn.addEventListener('click', async () => {
        try {
          await navigator.clipboard.writeText(window.location.href);
          const icon = shareBtn.querySelector('i');
          if (icon) icon.setAttribute('data-lucide', 'check');
          shareBtn.classList.add('copied');
          shareBtn.setAttribute('title', 'Copied to Clipboard!');
          LucideIcons.createIcons({ icons: iconsObject });
          setTimeout(() => {
            shareBtn.classList.remove('copied');
            if (icon) icon.setAttribute('data-lucide', 'link');
            shareBtn.setAttribute('title', 'Copy Map Link');
            LucideIcons.createIcons({ icons: iconsObject });
          }, 2000);
        } catch (e) {
          console.error('Failed to copy', e);
        }
      });
    }

    // 6. Micro-Vector Area Search
    const vectorControls = document.getElementById('vector-search-controls');
    const searchAreaBtn = document.getElementById('search-area-btn');
    const clearPointsBtn = document.getElementById('clear-points-btn');
    const vectorLegend = document.getElementById('vector-legend');
    const vectorLegendBody = document.getElementById('vector-legend-body');
    const legendToggle = document.getElementById('legend-toggle');
    const legendClose = document.getElementById('legend-close');
    const legendBadge = document.getElementById('legend-badge');
    const vectorLayer = L.layerGroup().addTo(map);

    const openLegend = () => {
      vectorLegend?.classList.add('open');
      legendToggle?.classList.add('active');
    };
    const closeLegend = () => {
      vectorLegend?.classList.remove('open');
      legendToggle?.classList.remove('active');
    };
    const showLegendFab = (count: number) => {
      legendToggle?.classList.remove('hidden');
      if (legendBadge) legendBadge.textContent = count.toString();
    };
    const hideLegendFab = () => {
      legendToggle?.classList.add('hidden');
      closeLegend();
    };

    legendToggle?.addEventListener('click', () => {
      if (vectorLegend?.classList.contains('open')) closeLegend();
      else openLegend();
    });
    legendClose?.addEventListener('click', closeLegend);

    let vectorMarkers: { cssClass: string, label: string, iconUrl: string, marker: L.Marker }[] = [];
    let activeFilters: Set<string> = new Set();

    const getTaxaInfo = (className: string, hasImage = false) => {
      let iconName = 'leaf';
      let cssClass = 'default';
      let label = 'Unknown';
      const c = className ? className.toLowerCase() : '';
      if (c === 'aves') { iconName = 'bird'; cssClass = 'aves'; label = 'Birds'; }
      else if (c === 'mammalia') { iconName = 'paw-print'; cssClass = 'mammalia'; label = 'Mammals'; }
      else if (c === 'plantae' || c === 'magnoliopsida' || c === 'liliopsida' || c === 'polypodiopsida' || c === 'pinopsida') { iconName = 'leaf'; cssClass = 'plantae'; label = 'Plants'; }
      else if (c === 'insecta') { iconName = 'bug'; cssClass = 'insecta'; label = 'Insects'; }
      else if (c === 'fungi' || c === 'agaricomycetes' || c === 'lecanoromycetes' || c === 'sordariomycetes') { iconName = 'sprout'; cssClass = 'fungi'; label = 'Fungi'; }
      else if (c === 'reptilia') { iconName = 'turtle'; cssClass = 'reptilia'; label = 'Reptiles'; }
      else if (c === 'amphibia') { iconName = 'egg'; cssClass = 'amphibia'; label = 'Amphibians'; }
      else if (c === 'actinopterygii' || c === 'chondrichthyes') { iconName = 'fish'; cssClass = 'actinopterygii'; label = 'Fish'; }
      else if (c === 'arachnida') { iconName = 'waypoints'; cssClass = 'arachnida'; label = 'Arachnids'; }
      else if (c === 'gastropoda') { iconName = 'snail'; cssClass = 'gastropoda'; label = 'Snails'; }
      else if (c === 'malacostraca') { iconName = 'shrimp'; cssClass = 'malacostraca'; label = 'Crustaceans'; }
      else if (c === 'bivalvia' || c === 'cephalopoda' || c === 'polyplacophora') { iconName = 'shell'; cssClass = 'mollusca'; label = 'Molluscs'; }
      else { label = className ? className.charAt(0).toUpperCase() + className.slice(1) : 'Unknown'; }
      
      const photoBadge = hasImage ? `<span class="marker-photo-badge">${getIconSvg('camera')}</span>` : '';
      
      return {
        icon: L.divIcon({
          className: 'custom-taxa-icon',
          html: `<div class="taxa-marker ${cssClass}">${getIconSvg(iconName)}${photoBadge}</div>`,
          iconSize: [38, 38],
          iconAnchor: [19, 19],
          popupAnchor: [0, -19]
        }),
        cssClass,
        label,
        iconName
      };

    };

    map.on('zoomend', () => {
      if (map.getZoom() >= 12 && vectorControls) {
        vectorControls.classList.remove('hidden');
      } else if (vectorControls) {
        vectorControls.classList.add('hidden');
      }
    });
    if (map.getZoom() >= 12 && vectorControls) vectorControls.classList.remove('hidden');

    if (searchAreaBtn) {
      searchAreaBtn.addEventListener('click', async () => {
        if (!gbifEnabled) return;
        const bounds = map.getBounds();
        const iconContainer = searchAreaBtn.querySelector('i')?.parentElement;
        
        if (iconContainer) {
          const iconEl = searchAreaBtn.querySelector('i');
          if (iconEl) iconEl.outerHTML = getIconSvg('loader-2');
        }
        
        if (gbifLayer) map.removeLayer(gbifLayer); // Hide raster heat while viewing vectors

        let url = `https://api.gbif.org/v1/occurrence/search?decimalLatitude=${bounds.getSouth()},${bounds.getNorth()}&decimalLongitude=${bounds.getWest()},${bounds.getEast()}&limit=300&occurrenceStatus=PRESENT`;
        if (currentYear !== 'ALL') url += `&year=1900,${currentYear}`;
        if (currentTaxonKey) url += `&taxonKey=${currentTaxonKey}`;
        if (!currentOrigins.includes('ALL')) url += `&basisOfRecord=${currentOrigins.join(',')}`;

        try {
          vectorLayer.clearLayers();
          vectorMarkers = [];
          hideLegendFab();
          
          let offset = 0;
          let keepFetching = true;
          let totalCount = 0;
          const limit = 300;
          const MAX_POINTS = 3000;
          const progressBar = searchAreaBtn.querySelector('.search-progress-bar') as HTMLElement;
          if (progressBar) progressBar.style.width = '2%';
          searchAreaBtn.classList.add('loading');

          while (keepFetching) {
            const pageUrl = `${url}&offset=${offset}`;
            const res = await fetch(pageUrl);
            const data = await res.json();
            
            if (offset === 0) totalCount = data.count || 0;
            
            data.results.forEach((occ: any) => {
              if (!occ.decimalLatitude || !occ.decimalLongitude) return;
              const media = occ.media?.find((m: any) => m.type === 'StillImage' && m.identifier)?.identifier
                         || occ.media?.[0]?.identifier || '';
              const hasImage = !!media && (media.startsWith('http://') || media.startsWith('https://'));
              const taxaInfo = getTaxaInfo(occ.class || occ.kingdom || occ.phylum, hasImage);
              const marker = L.marker([occ.decimalLatitude, occ.decimalLongitude], {
                icon: taxaInfo.icon
              }).addTo(vectorLayer);
              
              const imgHtml = hasImage ? `<img src="${media}" alt="${occ.scientificName}" loading="lazy" onerror="this.remove()">` : '';
              const popupHtml = `
                <div class="vector-popup">
                  ${imgHtml}
                  <div class="title">${occ.scientificName || 'Unknown Species'}</div>
                  <div class="vernacular-popup"></div>
                  <div class="meta">${getIconSvg('calendar')} Observed: ${occ.year || 'Unknown'}</div>
                </div>
              `;
              marker.bindPopup(popupHtml);
              const popupTaxonKey = occ.speciesKey || occ.taxonKey;
              if (popupTaxonKey) {
                marker.on('popupopen', async () => {
                  const names = await resolveVernacularNames(popupTaxonKey);
                  const el = marker.getPopup()?.getElement()?.querySelector('.vernacular-popup');
                  if (el && names.length > 0) {
                    el.innerHTML = names.map(n =>
                      `<span class="lang-tag">${n.lang.toUpperCase()}</span> ${n.name}`
                    ).join(' · ');
                  }
                });
              }
              
              vectorMarkers.push({ cssClass: taxaInfo.cssClass, label: taxaInfo.label, iconUrl: taxaInfo.iconName, marker: marker });
            });
            
            offset += limit;
            
            if (progressBar && totalCount > 0) {
              const progress = Math.min(100, Math.round((offset / Math.min(totalCount, MAX_POINTS)) * 100));
              progressBar.style.width = `${progress}%`;
            }

            if (data.endOfRecords || offset >= totalCount || vectorMarkers.length >= MAX_POINTS) {
              keepFetching = false;
            }
          }
          
          if (clearPointsBtn) clearPointsBtn.classList.remove('hidden');
          
          if (progressBar) {
            progressBar.style.width = '100%';
            setTimeout(() => { progressBar.style.width = '0%'; }, 500);
          }
          
          // Generate Legend UI dynamically
          const taxaCounts = vectorMarkers.reduce((acc, m) => {
             if (!acc[m.cssClass]) acc[m.cssClass] = { count: 0, label: m.label, iconUrl: m.iconUrl };
             acc[m.cssClass].count++;
             return acc;
          }, {} as any);

          if (vectorLegendBody && Object.keys(taxaCounts).length > 0) {
            vectorLegendBody.innerHTML = '';
            activeFilters = new Set(Object.keys(taxaCounts));
            
            if (totalCount > MAX_POINTS) {
               const warning = document.createElement('div');
               warning.className = 'legend-warning';
               warning.innerHTML = `${getIconSvg('alert-triangle')} Showing ${MAX_POINTS.toLocaleString()} of ${totalCount.toLocaleString()} points`;
               vectorLegendBody.appendChild(warning);
            }

            Object.entries(taxaCounts).forEach(([cClass, info]: any) => {
               const btn = document.createElement('div');
               btn.className = `legend-item`;
               btn.innerHTML = `
                 <div class="legend-icon-badge taxa-marker ${cClass}">${getIconSvg(info.iconUrl)}</div>
                 <span class="legend-label">${info.label}</span>
                 <span class="legend-count">${info.count}</span>
               `;
               btn.addEventListener('click', () => {
                 if (activeFilters.has(cClass)) {
                   activeFilters.delete(cClass);
                   btn.classList.add('inactive');
                   vectorMarkers.filter(m => m.cssClass === cClass).forEach(m => vectorLayer.removeLayer(m.marker));
                 } else {
                   activeFilters.add(cClass);
                   btn.classList.remove('inactive');
                   vectorMarkers.filter(m => m.cssClass === cClass).forEach(m => vectorLayer.addLayer(m.marker));
                 }
               });
               vectorLegendBody.appendChild(btn);
            });

            showLegendFab(Object.keys(taxaCounts).length);
            openLegend();
          }


        } catch (e) {

          console.error('Vector Search Error:', e);
        } finally {
          const loaderIcon = searchAreaBtn.querySelector('svg[data-lucide="loader-2"]');
          if (loaderIcon) {
            loaderIcon.outerHTML = getIconSvg('search');
          }
        }
      });
    }

    if (clearPointsBtn) {
      clearPointsBtn.addEventListener('click', () => {
        vectorLayer.clearLayers();
        vectorMarkers = [];
        activeFilters.clear();
        hideLegendFab();
        clearPointsBtn.classList.add('hidden');
        if (gbifLayer) map.addLayer(gbifLayer);
      });
    }

    // Connect Deep-Link variables to UI Inputs visually
    if (gbifYearInput) gbifYearInput.value = currentYear === 'ALL' ? '2025' : currentYear.toString();
    if (yearValueDisplay) yearValueDisplay.textContent = currentYear === 'ALL' ? 'All Years' : `1900 - ${currentYear}`;
    if (densityInput) densityInput.value = currentDensity.toString();
    if (densityValueTag) densityValueTag.textContent = `${currentDensity} Bins`;
    if (opacityInput) opacityInput.value = currentOpacity.toString();
    if (opacityValueTag) opacityValueTag.textContent = `${Math.round(currentOpacity * 100)}%`;
    document.querySelectorAll('#gbif-origin .toggle-btn').forEach(b => {
      b.classList.toggle('active', currentOrigins.includes(b.getAttribute('data-value') || ''));
    });
    document.querySelectorAll('#gbif-shape .toggle-btn').forEach(b => {
      b.classList.toggle('active', b.getAttribute('data-shape') === currentShape);
    });
    document.querySelectorAll('#gbif-scale-mode .toggle-btn').forEach(b => {
      b.classList.toggle('active', b.getAttribute('data-mode') === currentScaleMode);
    });
    document.querySelectorAll('#gbif-palette .palette-btn').forEach(b => {
      b.classList.toggle('active', b.getAttribute('data-palette') === currentPalette);
    });

    // 5. UI Interactivity (Speed-dial, panel toggle, collapsibles, biodiversity toggle)
    const speedDial = document.getElementById('location-control');
    const menuFab = document.getElementById('menu-fab');

    const closeMenu = () => speedDial?.classList.remove('open');
    menuFab?.addEventListener('click', () => speedDial?.classList.toggle('open'));
    map.on('click', closeMenu);

    const uiPanel = document.getElementById('ui-panel');
    const panelOverlay = document.getElementById('panel-overlay');
    const settingsToggle = document.getElementById('settings-toggle');
    const panelCloseBtn = document.getElementById('panel-close');
    const gbifToggle = document.getElementById('gbif-toggle') as HTMLInputElement;

    const openPanel = () => {
      uiPanel?.classList.add('open');
      settingsToggle?.classList.add('active');
      panelOverlay?.classList.add('active');
    };

    const closePanel = () => {
      uiPanel?.classList.remove('open');
      settingsToggle?.classList.remove('active');
      panelOverlay?.classList.remove('active');
    };

    settingsToggle?.addEventListener('click', () => {
      if (uiPanel?.classList.contains('open')) closePanel();
      else openPanel();
    });

    panelCloseBtn?.addEventListener('click', closePanel);
    panelOverlay?.addEventListener('click', () => {
      closePanel();
      closeSearchPanel();
    });

    // Search Species Panel
    const searchPanel = document.getElementById('search-panel');
    const searchFab = document.getElementById('search-fab');
    const searchPanelClose = document.getElementById('search-panel-close');

    const openSearchPanel = () => {
      searchPanel?.classList.add('open');
      searchFab?.classList.add('active');
      panelOverlay?.classList.add('active');
      setTimeout(() => gbifSearch?.focus(), 150);
    };

    closeSearchPanel = () => {
      searchPanel?.classList.remove('open');
      searchFab?.classList.remove('active');
      if (!uiPanel?.classList.contains('open')) {
        panelOverlay?.classList.remove('active');
      }
    };

    searchFab?.addEventListener('click', () => {
      if (searchPanel?.classList.contains('open')) closeSearchPanel();
      else openSearchPanel();
    });
    searchPanelClose?.addEventListener('click', closeSearchPanel);

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        if (searchPanel?.classList.contains('open')) closeSearchPanel();
        else if (uiPanel?.classList.contains('open')) closePanel();
        else if (speedDial?.classList.contains('open')) speedDial.classList.remove('open');
      }
    });

    if (gbifToggle) {
      gbifToggle.addEventListener('click', (e) => e.stopPropagation());
      gbifToggle.addEventListener('change', () => {
        gbifEnabled = gbifToggle.checked;
        if (gbifEnabled) {
          updateGbifLayer();
        } else {
          if (gbifLayer) map.removeLayer(gbifLayer);
          vectorLayer.clearLayers();
          vectorMarkers = [];
          activeFilters.clear();
          hideLegendFab();
          if (clearPointsBtn) clearPointsBtn.classList.add('hidden');
        }
      });
    }

    const collapsibles = document.querySelectorAll('.collapsible');
    collapsibles.forEach(section => {
      section.querySelector('.section-header')?.addEventListener('click', (e) => {
        const target = e.target as HTMLElement;
        if (target.closest('.layer-toggle')) return;
        section.classList.toggle('active');
      });
    });

    // Language Settings UI
    const langChipsContainer = document.getElementById('lang-chips');
    const langSearchInput = document.getElementById('lang-search') as HTMLInputElement;
    const langDropdown = document.getElementById('lang-dropdown') as HTMLElement;

    const onLanguagesChanged = () => {
      renderHistory();
      if (currentTaxonKey) {
        const match = currentHistory.find(h => h.key === currentTaxonKey);
        if (match) {
          const name = getPrimaryName(match);
          gbifSearch.value = name;
          updateFilterLabel(name);
        }
      }
    };

    const saveLanguages = () => {
      localStorage.setItem(STORAGE_KEY_LANGS, JSON.stringify(userLanguages));
      syncStateToURL();
      onLanguagesChanged();
    };

    const renderLanguageChips = () => {
      if (!langChipsContainer) return;
      langChipsContainer.innerHTML = '';
      userLanguages.forEach((code, idx) => {
        const info = langLookup1[code];
        if (!info) return;
        const chip = document.createElement('div');
        chip.className = 'language-chip';
        const nativeName = info.nativeName.split(',')[0].trim();
        let btns = '';
        if (idx > 0)
          btns += `<button class="lang-chip-move" data-dir="up" title="Move up">${getIconSvg('chevron-up')}</button>`;
        if (idx < userLanguages.length - 1)
          btns += `<button class="lang-chip-move" data-dir="down" title="Move down">${getIconSvg('chevron-down')}</button>`;
        btns += `<button class="lang-chip-remove" title="Remove">${getIconSvg('x')}</button>`;
        chip.innerHTML = `
          <span class="lang-chip-code">${code.toUpperCase()}</span>
          <span class="lang-chip-name">${nativeName}</span>
          <span class="lang-chip-actions">${btns}</span>
        `;
        chip.querySelector('[data-dir="up"]')?.addEventListener('click', () => {
          [userLanguages[idx - 1], userLanguages[idx]] = [userLanguages[idx], userLanguages[idx - 1]];
          saveLanguages(); renderLanguageChips();
        });
        chip.querySelector('[data-dir="down"]')?.addEventListener('click', () => {
          [userLanguages[idx], userLanguages[idx + 1]] = [userLanguages[idx + 1], userLanguages[idx]];
          saveLanguages(); renderLanguageChips();
        });
        chip.querySelector('.lang-chip-remove')?.addEventListener('click', () => {
          userLanguages.splice(idx, 1);
          saveLanguages(); renderLanguageChips();
        });
        langChipsContainer.appendChild(chip);
      });
    };

    if (langSearchInput && langDropdown) {
      langSearchInput.addEventListener('input', () => {
        const q = langSearchInput.value.trim().toLowerCase();
        langDropdown.innerHTML = '';
        if (q.length < 1) { langDropdown.style.display = 'none'; return; }
        const matches = codes.filter(c =>
          !userLanguages.includes(c.iso639_1) &&
          (c.name.toLowerCase().includes(q) || c.nativeName.toLowerCase().includes(q) || c.iso639_1 === q)
        ).slice(0, 8);
        if (matches.length === 0) { langDropdown.style.display = 'none'; return; }
        langDropdown.style.display = 'block';
        matches.forEach(c => {
          const li = document.createElement('li');
          const native = c.nativeName.split(',')[0].trim();
          li.innerHTML = `<span class="lang-tag">${c.iso639_1.toUpperCase()}</span> ${c.name} <span class="lang-native">${native}</span>`;
          li.addEventListener('click', () => {
            userLanguages.push(c.iso639_1);
            saveLanguages(); renderLanguageChips();
            langSearchInput.value = '';
            langDropdown.style.display = 'none';
          });
          langDropdown.appendChild(li);
        });
      });
      langSearchInput.addEventListener('blur', () => {
        setTimeout(() => { langDropdown.style.display = 'none'; }, 200);
      });
    }

    renderLanguageChips();

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
    if (currentTaxonKey) {
      const match = currentHistory.find(h => h.key === currentTaxonKey);
      const label = match ? getPrimaryName(match) : (gbifSearch.value || `Taxon ${currentTaxonKey}`);
      gbifSearch.value = label;
      updateFilterLabel(label);
    }
    checkGbifHealth();
    validateAllPalettes(currentShape);
    updateGbifLayer();
    LucideIcons.createIcons({ icons: iconsObject });

  } catch (error) {
    console.error('Error initializing map:', error);
  }
}

initMap();
