import './style.css';
import 'leaflet.markercluster/dist/MarkerCluster.css';
import 'leaflet.markercluster/dist/MarkerCluster.Default.css';
import L from 'leaflet';
import 'leaflet.markercluster';
import * as LucideIcons from 'lucide';
import codes, { by639_1, by639_2T, by639_2B, type Code } from 'iso-language-codes';

/* Minimal MD5 – RFC 1321 */
function md5(str: string): string {
  const k = new Uint32Array(64);
  for (let i = 0; i < 64; i++) k[i] = (Math.abs(Math.sin(i + 1)) * 0x100000000) >>> 0;
  const s = [7,12,17,22,7,12,17,22,7,12,17,22,7,12,17,22,
             5,9,14,20,5,9,14,20,5,9,14,20,5,9,14,20,
             4,11,16,23,4,11,16,23,4,11,16,23,4,11,16,23,
             6,10,15,21,6,10,15,21,6,10,15,21,6,10,15,21];
  const bytes: number[] = [];
  for (let i = 0; i < str.length; i++) {
    const c = str.charCodeAt(i);
    if (c < 0x80) bytes.push(c);
    else if (c < 0x800) { bytes.push(0xc0 | (c >> 6), 0x80 | (c & 0x3f)); }
    else { bytes.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f)); }
  }
  const bitLen = bytes.length * 8;
  bytes.push(0x80);
  while (bytes.length % 64 !== 56) bytes.push(0);
  bytes.push(bitLen & 0xff, (bitLen >>> 8) & 0xff, (bitLen >>> 16) & 0xff, (bitLen >>> 24) & 0xff, 0, 0, 0, 0);
  let a0 = 0x67452301, b0 = 0xefcdab89, c0 = 0x98badcfe, d0 = 0x10325476;
  for (let i = 0; i < bytes.length; i += 64) {
    const m = new Uint32Array(16);
    for (let j = 0; j < 64; j += 4) m[j >> 2] = bytes[i+j] | (bytes[i+j+1] << 8) | (bytes[i+j+2] << 16) | (bytes[i+j+3] << 24);
    let [a, b, c, d] = [a0, b0, c0, d0];
    for (let j = 0; j < 64; j++) {
      let f: number, g: number;
      if (j < 16) { f = (b & c) | (~b & d); g = j; }
      else if (j < 32) { f = (d & b) | (~d & c); g = (5*j+1) % 16; }
      else if (j < 48) { f = b ^ c ^ d; g = (3*j+5) % 16; }
      else { f = c ^ (b | ~d); g = (7*j) % 16; }
      const tmp = d; d = c; c = b;
      const x = (a + f + k[j] + m[g]) | 0;
      b = (b + ((x << s[j]) | (x >>> (32 - s[j])))) | 0;
      a = tmp;
    }
    a0 = (a0 + a) | 0; b0 = (b0 + b) | 0; c0 = (c0 + c) | 0; d0 = (d0 + d) | 0;
  }
  const hex = (v: number) => Array.from({length: 4}, (_, i) => ((v >>> (i * 8)) & 0xff).toString(16).padStart(2, '0')).join('');
  return hex(a0) + hex(b0) + hex(c0) + hex(d0);
}

function gbifThumb(occurrenceKey: number | string, mediaUrl: string, width = 300): string {
  return `https://api.gbif.org/v1/image/cache/${width}x/occurrence/${occurrenceKey}/media/${md5(mediaUrl)}`;
}

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
  baseLayers: LayerConfig[];
  overlays: LayerConfig[];
  gbif: {
    defaultStyle: string;
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


let errorToastTimer: any;
const showErrorToast = (message: string) => {
  const toast = document.getElementById('error-toast');
  if (!toast) return;
  toast.innerHTML = `<div class="error-toast-inner">${getIconSvg('alert-circle')}<span>${message}</span></div>`;
  toast.classList.add('visible');
  clearTimeout(errorToastTimer);
  errorToastTimer = setTimeout(() => toast.classList.remove('visible'), 5000);
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
    const STORAGE_KEY_BASE = 'mymap_base_layer';
    const STORAGE_KEY_OVERLAYS = 'mymap_overlays';
    const defaultBaseLayer = config.baseLayers.find(l => l.active)?.id || config.baseLayers[0]?.id || 'osm';
    let currentBaseLayer = urlParams.get('base') || localStorage.getItem(STORAGE_KEY_BASE) || defaultBaseLayer;
    let activeOverlayIds: Set<string> = new Set(
      urlParams.has('overlays')
        ? urlParams.get('overlays')!.split(',').filter(Boolean)
        : JSON.parse(localStorage.getItem(STORAGE_KEY_OVERLAYS) || '[]')
    );
    let gbifLayer: L.TileLayer | null = null;
    let currentTaxonKey: number | null = urlParams.has('taxon') ? parseInt(urlParams.get('taxon')!) : null;
    let currentShape = urlParams.get('shape') || 'hex';
    let currentPalette = urlParams.get('palette') || 'classic';
    let currentDensity = urlParams.has('density') ? parseInt(urlParams.get('density')!) : 45;
    let currentScaleMode = urlParams.get('scale') || 'static';
    let currentOpacity = urlParams.has('opacity') ? parseFloat(urlParams.get('opacity')!) : 0.8;
    let currentYear: number | 'ALL' = urlParams.has('year') ? (urlParams.get('year') === 'ALL' ? 'ALL' : parseInt(urlParams.get('year')!)) : 'ALL';
    let currentOrigins: string[] = urlParams.has('origins') ? urlParams.get('origins')!.split(',') : ['ALL']; 
    let gbifEnabled = true;
    let isPlaying = false;
    let playInterval: any;

    const STORAGE_KEY_LANGS = 'mymap_languages';
    const langLookup1 = by639_1 as Record<string, Code | undefined>;
    const langLookup2T = by639_2T as Record<string, Code | undefined>;
    const langLookup2B = by639_2B as Record<string, Code | undefined>;
    const resolveIso1 = (code3: string): string | undefined =>
      langLookup2T[code3]?.iso639_1 ?? langLookup2B[code3]?.iso639_1;

    // --- Taxonomic Utilities & Vector State ---
    interface TaxonomyBlock {
      kingdom: string; phylum: string; class: string; order: string; family: string; genus: string; species: string;
      kingdomKey?: number; phylumKey?: number; classKey?: number; orderKey?: number; familyKey?: number; genusKey?: number; speciesKey?: number;
    }

    interface VectorMarkerEntry {
      cssClass: string; label: string; iconUrl: string; marker: L.Marker; taxonomy: TaxonomyBlock;
    }

    interface TaxaNode {
      name: string; rank: string; count: number;
      children: Map<string, TaxaNode>; markers: L.Marker[]; taxonKey?: number;
    }

    const RANKS = ['kingdom', 'phylum', 'class', 'order', 'family', 'genus', 'species'] as const;
    const rankToKeyField: Record<(typeof RANKS)[number], keyof TaxonomyBlock> = {
      kingdom: 'kingdomKey', phylum: 'phylumKey', class: 'classKey',
      order: 'orderKey', family: 'familyKey', genus: 'genusKey', species: 'speciesKey'
    };

    const taxonKeyForRank = (t: TaxonomyBlock, rank: (typeof RANKS)[number]): number | undefined => {
      const v = t[rankToKeyField[rank]];
      return typeof v === 'number' && v > 0 ? v : undefined;
    };

    const buildTaxaTree = (markers: VectorMarkerEntry[]): TaxaNode => {
      const root: TaxaNode = { name: 'Life', rank: 'root', count: 0, children: new Map(), markers: [] };
      for (const m of markers) {
        let node = root;
        root.count++;
        root.markers.push(m.marker);
        for (const rank of RANKS) {
          const name = m.taxonomy[rank] || 'Unknown';
          if (!node.children.has(name)) {
            const tk = taxonKeyForRank(m.taxonomy, rank);
            node.children.set(name, { name, rank, count: 0, children: new Map(), markers: [], taxonKey: tk });
          }
          const child = node.children.get(name)!;
          if (!child.taxonKey) {
            const tk = taxonKeyForRank(m.taxonomy, rank);
            if (tk) child.taxonKey = tk;
          }
          child.count++;
          child.markers.push(m.marker);
          node = child;
        }
      }
      return root;
    };

    const pruneTree = (node: TaxaNode): TaxaNode => {
      const pruned = new Map<string, TaxaNode>();
      for (const [key, child] of node.children) pruned.set(key, pruneTree(child));
      node.children = pruned;
      if (node.children.size === 1 && node.rank !== 'root' && node.children.values().next().value!.rank !== 'species') {
        return node.children.values().next().value!;
      }
      return node;
    };

    const getTaxaInfo = (className: string, hasImage = false) => {
      let iconName = 'leaf', cssClass = 'default', label = 'Unknown';
      const c = className ? className.toLowerCase() : '';
      if (c === 'aves') { iconName = 'bird'; cssClass = 'aves'; label = 'Birds'; }
      else if (c === 'mammalia') { iconName = 'paw-print'; cssClass = 'mammalia'; label = 'Mammals'; }
      else if (['plantae', 'magnoliopsida', 'liliopsida', 'polypodiopsida', 'pinopsida'].includes(c)) { iconName = 'leaf'; cssClass = 'plantae'; label = 'Plants'; }
      else if (c === 'insecta') { iconName = 'bug'; cssClass = 'insecta'; label = 'Insects'; }
      else if (['fungi', 'agaricomycetes', 'lecanoromycetes', 'sordariomycetes'].includes(c)) { iconName = 'sprout'; cssClass = 'fungi'; label = 'Fungi'; }
      else if (c === 'reptilia') { iconName = 'turtle'; cssClass = 'reptilia'; label = 'Reptiles'; }
      else if (c === 'amphibia') { iconName = 'egg'; cssClass = 'amphibia'; label = 'Amphibians'; }
      else if (['actinopterygii', 'chondrichthyes'].includes(c)) { iconName = 'fish'; cssClass = 'actinopterygii'; label = 'Fish'; }
      else if (c === 'arachnida') { iconName = 'waypoints'; cssClass = 'arachnida'; label = 'Arachnids'; }
      else if (c === 'gastropoda') { iconName = 'snail'; cssClass = 'gastropoda'; label = 'Snails'; }
      else if (c === 'malacostraca') { iconName = 'shrimp'; cssClass = 'malacostraca'; label = 'Crustaceans'; }
      else if (['bivalvia', 'cephalopoda', 'polyplacophora'].includes(c)) { iconName = 'shell'; cssClass = 'mollusca'; label = 'Molluscs'; }
      else { label = className ? className.charAt(0).toUpperCase() + className.slice(1) : 'Unknown'; }
      const photoBadge = hasImage ? `<span class="marker-photo-badge">${getIconSvg('camera')}</span>` : '';
      return {
        icon: L.divIcon({
          className: 'custom-taxa-icon',
          html: `<div class="taxa-marker ${cssClass}">${getIconSvg(iconName)}${photoBadge}</div>`,
          iconSize: [38, 38], iconAnchor: [19, 19], popupAnchor: [0, -19]
        }), cssClass, label, iconName
      };
    };

    // --- Vector & Legend State ---
    let vectorMarkers: VectorMarkerEntry[] = [];
    let activeFilters: Set<string> = new Set();
    const hiddenMarkers = new Set<L.Marker>();
    const selectedNodes = new Set<string>();
    const selectedMarkersByNode = new Map<string, Set<L.Marker>>();
    const markerSpecies = new Map<L.Marker, string>();
    let lastTotalCount = 0;
    const MAX_POINTS = 10000;
    let legendSearchQuery = '';

    const legendSearchInput = document.getElementById('legend-search-input') as HTMLInputElement;
    const legendSearchClear = document.getElementById('legend-search-clear');

    const updateTaxonomyLegend = async () => {
      if (!vectorLegendBody || vectorMarkers.length === 0) return;
      vectorLegendBody.innerHTML = '';
      const markerSet = new Set(vectorMarkers.map(v => v.marker));
      markerSpecies.clear();

      const normalizeText = (text: string | undefined | null) => 
        text ? text.normalize('NFD').replace(/[\u0300-\u036f]/g, "").toLowerCase() : "";

      const filteredMarkers = vectorMarkers.filter(m => {
        if (!legendSearchQuery) return true;
        const q = normalizeText(legendSearchQuery);
        const terms = [
          m.taxonomy.species, m.taxonomy.genus, m.taxonomy.family,
          m.taxonomy.order, m.taxonomy.class, m.taxonomy.phylum, m.taxonomy.kingdom
        ].map(s => normalizeText(s));
        if (terms.some(t => t.includes(q))) return true;
        const common = vnCache.get(m.taxonomy.speciesKey || 0) || [];
        return common.some(vn => normalizeText(vn.name).includes(q));
      });

      filteredMarkers.forEach(v => markerSpecies.set(v.marker, v.taxonomy.species || v.label || 'Unknown species'));

      const refreshVisibility = () => {
        let selectedUnion: Set<L.Marker> | null = null;
        if (selectedNodes.size > 0) {
          selectedUnion = new Set<L.Marker>();
          selectedNodes.forEach(id => {
            const nodeMarkers = selectedMarkersByNode.get(id);
            if (nodeMarkers) nodeMarkers.forEach(m => selectedUnion!.add(m));
          });
        }
        markerSet.forEach(marker => {
          const allowedBySelection = selectedUnion ? selectedUnion.has(marker) : true;
          const allowedByVisibility = !hiddenMarkers.has(marker);
          if (allowedBySelection && allowedByVisibility) vectorLayer.addLayer(marker);
          else vectorLayer.removeLayer(marker);
        });
      };

      if (filteredMarkers.length === 0 && legendSearchQuery) {
        const empty = document.createElement('div');
        empty.className = 'legend-empty-state';
        empty.innerHTML = `<span class="empty-icon">${getIconSvg('search')}</span> No species match "${legendSearchQuery}"`;
        vectorLegendBody.appendChild(empty);
      }

      if (lastTotalCount > MAX_POINTS) {
        const warning = document.createElement('div');
        warning.className = 'legend-warning';
        warning.innerHTML = `${getIconSvg('alert-triangle')} Showing ${MAX_POINTS.toLocaleString()} of ${lastTotalCount.toLocaleString()} points`;
        vectorLegendBody.appendChild(warning);
      }

      const tree = pruneTree(buildTaxaTree(filteredMarkers));
      const rankLabel = (r: string) => ({ root: '', kingdom: 'K', phylum: 'P', class: 'C', order: 'O', family: 'F', genus: 'G', species: 'Sp' }[r] || r);

      const renderNode = (node: TaxaNode, container: HTMLElement, depth: number, path: string) => {
        const isLeaf = node.children.size === 0;
        const nodeId = `${path}>${node.rank}:${node.name}`;
        selectedMarkersByNode.set(nodeId, new Set(node.markers));

        const row = document.createElement('div');
        row.className = `tree-row${isLeaf ? ' tree-leaf' : ''}`;
        row.style.paddingLeft = `${depth * 14}px`;

        if (!isLeaf) {
          const ch = document.createElement('span');
          ch.className = 'tree-chevron'; ch.innerHTML = getIconSvg('chevron-right');
          row.appendChild(ch);
        }
        if (node.rank !== 'root' && node.rank !== 'kingdom') {
          const rtag = document.createElement('span');
          rtag.className = 'tree-rank'; rtag.textContent = rankLabel(node.rank);
          row.appendChild(rtag);
        }
        const nameWrap = createTaxonNameWrap(node.name, node.taxonKey);
        if (node.rank === 'species') nameWrap.classList.add('tree-species-name');
        row.appendChild(nameWrap);
        const cntEl = document.createElement('span');
        cntEl.className = 'legend-count'; cntEl.textContent = String(node.count);
        row.appendChild(cntEl);
        container.appendChild(row);

        if (!isLeaf) {
          const childContainer = document.createElement('div');
          childContainer.className = 'tree-children';
          if (depth === 0 || (node.children.size === 1 && depth > 0)) childContainer.classList.add('open');
          container.appendChild(childContainer);
          if (childContainer.classList.contains('open')) row.classList.add('expanded');

          row.addEventListener('click', (e) => {
            if ((e.target as HTMLElement).closest('.tree-eye') || (e.target as HTMLElement).closest('.tree-filter') || (e.target as HTMLElement).closest('.tree-list')) return;
            const isOpen = childContainer.classList.toggle('open');
            row.classList.toggle('expanded', isOpen);
          });
          const sorted = [...node.children.values()].sort((a, b) => b.count - a.count);
          for (const child of sorted) renderNode(child, childContainer, depth + 1, nodeId);
        }

        const eyeBtn = document.createElement('button');
        eyeBtn.className = 'tree-eye'; eyeBtn.innerHTML = getIconSvg('eye');
        row.appendChild(eyeBtn);

        let visible = true;
        eyeBtn.addEventListener('click', (e) => {
          e.stopPropagation(); visible = !visible;
          eyeBtn.innerHTML = getIconSvg(visible ? 'eye' : 'eye-off');
          row.classList.toggle('tree-hidden', !visible);
          node.markers.forEach(m => (visible ? hiddenMarkers.delete(m) : hiddenMarkers.add(m)));
          refreshVisibility();
        });

        const filterBtn = document.createElement('button');
        filterBtn.className = 'tree-filter'; filterBtn.innerHTML = getIconSvg('filter');
        row.appendChild(filterBtn);
        filterBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          const isSelected = selectedNodes.has(nodeId);
          isSelected ? selectedNodes.delete(nodeId) : selectedNodes.add(nodeId);
          row.classList.toggle('tree-selected', !isSelected);
          refreshVisibility();
        });

        const listBtn = document.createElement('button');
        listBtn.className = 'tree-list'; listBtn.innerHTML = getIconSvg('list');
        row.appendChild(listBtn);
        
        const speciesPanel = document.createElement('div');
        speciesPanel.className = 'tree-species-table'; speciesPanel.style.display = 'none';
        speciesPanel.style.paddingLeft = `${20 + depth * 14}px`;
        container.appendChild(speciesPanel);

        listBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          if (speciesPanel.style.display === 'none') {
            speciesPanel.innerHTML = '';
            const bySpecies = new Map<string, L.Marker[]>();
            node.markers.forEach(m => {
              const sp = markerSpecies.get(m) || 'Unknown species';
              if (!bySpecies.has(sp)) bySpecies.set(sp, []);
              bySpecies.get(sp)!.push(m);
            });
            const rows = [...bySpecies.entries()].sort((a, b) => b[1].length - a[1].length);
            rows.forEach(([speciesName, markers], idx) => {
              const spId = `${nodeId}::sp::${idx}`;
              selectedMarkersByNode.set(spId, new Set(markers));
              const spRow = document.createElement('div');
              spRow.className = 'tree-species-row'; spRow.dataset.filterId = spId;
              const vm = vectorMarkers.find(v => v.marker === markers[0]);
              const nameWrap = createTaxonNameWrap(speciesName, vm?.taxonomy.speciesKey);
              nameWrap.classList.add('tree-species-item', 'tree-species-name');
              const countEl = document.createElement('span');
              countEl.className = 'legend-count'; countEl.textContent = String(markers.length);
              const btnGroup = document.createElement('div');
              btnGroup.className = 'tree-species-actions';
              const spEye = document.createElement('button');
              spEye.className = 'tree-eye tree-eye-inline';
              let spVisible = !markers.every(m => hiddenMarkers.has(m));
              spEye.innerHTML = getIconSvg(spVisible ? 'eye' : 'eye-off');
              spRow.classList.toggle('tree-hidden', !spVisible);
              spEye.addEventListener('click', (e) => {
                e.stopPropagation(); spVisible = !spVisible;
                spEye.innerHTML = getIconSvg(spVisible ? 'eye' : 'eye-off');
                spRow.classList.toggle('tree-hidden', !spVisible);
                markers.forEach(m => (spVisible ? hiddenMarkers.delete(m) : hiddenMarkers.add(m)));
                refreshVisibility();
              });
              const spFilter = document.createElement('button');
              spFilter.className = 'tree-filter tree-filter-inline'; spFilter.innerHTML = getIconSvg('filter');
              spFilter.addEventListener('click', (e) => {
                e.stopPropagation();
                const on = selectedNodes.has(spId);
                on ? selectedNodes.delete(spId) : selectedNodes.add(spId);
                spRow.classList.toggle('tree-selected', !on);
                refreshVisibility();
              });
              btnGroup.append(spEye, spFilter);
              spRow.append(nameWrap, countEl, btnGroup);
              speciesPanel.appendChild(spRow);
            });
            void applyLegendLanguageToBody(speciesPanel);
            speciesPanel.style.display = 'block';
          } else {
            speciesPanel.style.display = 'none';
          }
        });
      };

      const rootSorted = [...tree.children.values()].sort((a, b) => b.count - a.count);
      for (const child of rootSorted) renderNode(child, vectorLegendBody, 0, 'root');
      
      const list = getLegendLangList();
      const langBar = document.getElementById('legend-lang-bar');
      if (langBar) {
        langBar.innerHTML = '';
        list.forEach(code => {
          const chip = document.createElement('button');
          chip.className = 'legend-lang-chip' + (code === legendDisplayLang ? ' active' : '');
          chip.textContent = code.toUpperCase();
          chip.addEventListener('click', async (e) => {
            e.stopPropagation(); legendDisplayLang = code;
            await updateTaxonomyLegend();
          });
          langBar.appendChild(chip);
        });
      }
      await applyLegendLanguageToBody(vectorLegendBody);
      showLegendFab(new Set(vectorMarkers.map(m => m.taxonomy.species)).size);
    };

    legendSearchInput?.addEventListener('input', () => {
      legendSearchQuery = legendSearchInput.value;
      legendSearchClear?.classList.toggle('hidden', !legendSearchQuery);
      updateTaxonomyLegend();
    });
    legendSearchClear?.addEventListener('click', () => {
      legendSearchInput.value = '';
      legendSearchQuery = '';
      legendSearchClear.classList.add('hidden');
      updateTaxonomyLegend();
    });

    const defaultLangs = (() => {
      const bl = navigator.language?.split('-')[0] || 'en';
      const langs = [bl];
      if (bl !== 'en') langs.push('en');
      return langs.filter(l => langLookup1[l]);
    })();
    let userLanguages: string[] = urlParams.has('langs')
      ? urlParams.get('langs')!.split(',').filter(l => langLookup1[l])
      : JSON.parse(localStorage.getItem(STORAGE_KEY_LANGS) || 'null') || defaultLangs;

    let legendDisplayLang = userLanguages[0] || defaultLangs[0] || 'en';
    let refreshTaxonomyLegendLang: (() => Promise<void>) | null = null;
    const getLegendLangList = (): string[] => (userLanguages.length > 0 ? userLanguages : defaultLangs);
    const syncLegendDisplayLang = () => {
      const list = getLegendLangList();
      if (!legendDisplayLang || !list.includes(legendDisplayLang)) legendDisplayLang = list[0] || 'en';
    };

    const initialLat = urlParams.has('lat') ? parseFloat(urlParams.get('lat')!) : (savedCenter ? JSON.parse(savedCenter)[0] : config.mapOptions.center[0]);
    const initialLng = urlParams.has('lng') ? parseFloat(urlParams.get('lng')!) : (savedCenter ? JSON.parse(savedCenter)[1] : config.mapOptions.center[1]);
    const initialCenter: L.LatLngTuple = [initialLat, initialLng];
    const initialZoom = urlParams.has('z') ? parseInt(urlParams.get('z')!) : (savedZoom ? parseInt(savedZoom) : config.mapOptions.zoom);

    // 2. Initialize Map
    const map = L.map('map', { center: initialCenter, zoom: initialZoom, layers: [] });

    /* Pan / zoom so GBIF vector popup (incl. image) stays inside the map pane; extra right/bottom padding for FABs */
    const vectorPopupMapPad = { l: 24, t: 76, r: 108, b: 44 };
    let vectorPopupFitGeneration = 0;
    const scheduleVectorPopupFit = (marker: L.Marker) => {
      const gen = ++vectorPopupFitGeneration;
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          if (gen !== vectorPopupFitGeneration) return;
          fitVectorPopupInView(marker, gen);
        });
      });
    };
    const fitVectorPopupInView = (marker: L.Marker, gen: number) => {
      const popup = marker.getPopup();
      if (!popup?.isOpen() || gen !== vectorPopupFitGeneration) return;
      const el = popup.getElement();
      if (!el) return;
      const mapEl = map.getContainer();
      const mr = mapEl.getBoundingClientRect();
      const p = vectorPopupMapPad;
      const minZ = map.getMinZoom();
      let passes = 0;
      const maxPasses = 14;

      const step = () => {
        if (!popup.isOpen() || gen !== vectorPopupFitGeneration || passes++ > maxPasses) return;
        const r = el.getBoundingClientRect();
        const availW = mr.width - p.l - p.r;
        const availH = mr.height - p.t - p.b;
        const tooBig = r.height > availH + 1 || r.width > availW + 1;

        if (tooBig && map.getZoom() > minZ) {
          map.setZoom(map.getZoom() - 1, { animate: true });
          map.once('zoomend', () => {
            map.panTo(marker.getLatLng(), { animate: false });
            requestAnimationFrame(step);
          });
          return;
        }

        let dx = 0;
        let dy = 0;
        if (r.left < mr.left + p.l) dx += (mr.left + p.l) - r.left;
        if (r.right > mr.right - p.r) dx += (mr.right - p.r) - r.right;
        if (r.top < mr.top + p.t) dy += (mr.top + p.t) - r.top;
        if (r.bottom > mr.bottom - p.b) dy += (mr.bottom - p.b) - r.bottom;

        if (dx !== 0 || dy !== 0) {
          map.panBy(L.point(-dx, -dy), { animate: true, duration: 0.28 });
          map.once('moveend', () => requestAnimationFrame(step));
          return;
        }
      };
      step();
    };

    const syncStateToURL = () => {
      const p = new URLSearchParams();
      const center = map.getCenter();
      p.set('lat', center.lat.toFixed(4));
      p.set('lng', center.lng.toFixed(4));
      p.set('z', map.getZoom().toString());
      p.set('base', currentBaseLayer);
      if (activeOverlayIds.size > 0) p.set('overlays', Array.from(activeOverlayIds).join(','));
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

    if (urlParams.toString() !== '') syncStateToURL();

    // 3. Base Layer Management
    const baseLayerInstances: Record<string, L.TileLayer> = {};
    const baseLayerPopover = document.getElementById('base-layer-popover');
    const baseLayerGrid = document.getElementById('base-layer-grid');
    const baseLayerFab = document.getElementById('base-layer-fab');

    const updateBaseLayerFabIcon = () => {
      const spec = config.baseLayers.find(l => l.id === currentBaseLayer);
      if (baseLayerFab && spec) {
        baseLayerFab.innerHTML = getIconSvg(spec.icon);
        baseLayerFab.title = spec.label;
        const nameEl = document.getElementById('active-base-layer-name');
        if (nameEl) nameEl.textContent = spec.label;
      }
    };

    const selectBaseLayer = (id: string) => {
      Object.values(baseLayerInstances).forEach(l => map.removeLayer(l));
      const layer = baseLayerInstances[id];
      if (layer) layer.addTo(map);
      currentBaseLayer = id;
      localStorage.setItem(STORAGE_KEY_BASE, id);
      updateBaseLayerFabIcon();
      baseLayerGrid?.querySelectorAll('.base-layer-option').forEach(el => {
        el.classList.toggle('active', el.getAttribute('data-layer') === id);
      });
      closeBasePopover();
      syncStateToURL();
    };

    config.baseLayers.forEach(spec => {
      const layer = spec.type === 'wms'
        ? L.tileLayer.wms(spec.url, { ...spec.options, crossOrigin: 'anonymous', zIndex: 0 })
        : L.tileLayer(spec.url, { ...spec.options, crossOrigin: 'anonymous', zIndex: 0 });
      baseLayerInstances[spec.id] = layer;
      if (spec.id === currentBaseLayer) layer.addTo(map);

      if (baseLayerGrid) {
        const btn = document.createElement('button');
        btn.className = `base-layer-option ${spec.id === currentBaseLayer ? 'active' : ''}`;
        btn.setAttribute('data-layer', spec.id);
        btn.innerHTML = `${getIconSvg(spec.icon)}<span>${spec.label}</span>`;
        btn.addEventListener('click', () => selectBaseLayer(spec.id));
        baseLayerGrid.appendChild(btn);
      }
    });

    updateBaseLayerFabIcon();

    let basePopoverOpen = false;
    const openBasePopover = () => {
      baseLayerPopover?.classList.add('open');
      basePopoverOpen = true;
    };
    const closeBasePopover = () => {
      baseLayerPopover?.classList.remove('open');
      basePopoverOpen = false;
    };

    baseLayerFab?.addEventListener('click', (e) => {
      e.stopPropagation();
      if (basePopoverOpen) closeBasePopover();
      else openBasePopover();
    });

    // 4. Overlay Management
    const overlayInstances: Record<string, L.TileLayer> = {};
    const overlayFabContainer = document.getElementById('overlay-fabs');

    config.overlays.forEach((spec, idx) => {
      const layer = spec.type === 'wms'
        ? L.tileLayer.wms(spec.url, { ...spec.options, crossOrigin: 'anonymous', zIndex: 5 + idx })
        : L.tileLayer(spec.url, { ...spec.options, crossOrigin: 'anonymous', zIndex: 5 + idx });
      overlayInstances[spec.id] = layer;

      const isActive = activeOverlayIds.has(spec.id);
      if (isActive) layer.addTo(map);

      if (overlayFabContainer) {
        const row = document.createElement('div');
        row.className = 'layer-row-item layer-stack-item';
        
        // Control Chip
        const controlChip = document.createElement('div');
        controlChip.className = 'layer-control-chip chip';
        const toggle = document.createElement('label');
        toggle.className = 'mini-toggle';
        toggle.title = `Toggle ${spec.label}`;
        const input = document.createElement('input');
        input.type = 'checkbox';
        input.checked = isActive;
        const track = document.createElement('span');
        track.className = 'mini-toggle-track';
        toggle.appendChild(input);
        toggle.appendChild(track);
        controlChip.appendChild(toggle);

        // Name Chip
        const nameChip = document.createElement('div');
        nameChip.className = 'layer-name-chip chip';
        const name = document.createElement('span');
        name.className = 'layer-name';
        name.textContent = spec.label;
        nameChip.appendChild(name);
        
        const btn = document.createElement('button');
        btn.className = `layer-fab overlay-fab ${isActive ? 'active' : ''}`;
        btn.setAttribute('data-overlay', spec.id);
        btn.title = `${spec.label} Settings`;
        btn.innerHTML = getIconSvg(spec.icon);
        
        const toggleLayer = () => {
          const nowActive = activeOverlayIds.has(spec.id);
          if (nowActive) {
            map.removeLayer(layer);
            activeOverlayIds.delete(spec.id);
            btn.classList.remove('active');
            input.checked = false;
          } else {
            layer.addTo(map);
            activeOverlayIds.add(spec.id);
            btn.classList.add('active');
            input.checked = true;
          }
          localStorage.setItem(STORAGE_KEY_OVERLAYS, JSON.stringify(Array.from(activeOverlayIds)));
          syncStateToURL();
        };

        btn.addEventListener('click', toggleLayer);
        input.addEventListener('change', toggleLayer);
        
        row.appendChild(controlChip);
        row.appendChild(nameChip);
        row.appendChild(btn);
        overlayFabContainer.appendChild(row);
      }
    });

    // 5. Layer Stack FAB UI
    const layerStack = document.getElementById('layer-stack');
    const menuFab = document.getElementById('menu-fab');
    const gbifFab = document.getElementById('gbif-fab');

    const closeLayerStack = () => {
      layerStack?.classList.remove('open');
      closeBasePopover();
    };
    menuFab?.addEventListener('click', () => layerStack?.classList.toggle('open'));
    map.on('click', () => {
      closeLayerStack();
      closeGbifPanel();
    });

    // 6. GBIF Panel UI
    const gbifPanel = document.getElementById('gbif-panel');
    const gbifPanelClose = document.getElementById('gbif-panel-close');
    const panelOverlay = document.getElementById('panel-overlay');
    const gbifToggle = document.getElementById('gbif-toggle') as HTMLInputElement;
    const gbifStatusDot = document.getElementById('gbif-section-status');

    const openGbifPanel = () => {
      gbifPanel?.classList.add('open');
      gbifFab?.classList.add('panel-open');
      panelOverlay?.classList.add('active');
      document.body.classList.add('panel-active');
    };
    const closeGbifPanel = () => {
      gbifPanel?.classList.remove('open');
      gbifFab?.classList.remove('panel-open');
      if (panelOverlay) panelOverlay.classList.remove('active');
      if (gbifPanel) gbifPanel.style.transform = '';
      if (!vectorLegend?.classList.contains('open')) {
        document.body.classList.remove('panel-active');
      }
    };

    gbifFab?.addEventListener('click', (e) => {
      e.stopPropagation();
      if (gbifPanel?.classList.contains('open')) {
        closeGbifPanel();
      } else {
        openGbifPanel();
      }
    });
    gbifPanelClose?.addEventListener('click', closeGbifPanel);
    panelOverlay?.addEventListener('click', closeGbifPanel);

    // Swipe-to-dismiss for mobile bottom sheet
    const dragHandle = gbifPanel?.querySelector('.drag-handle');
    if (dragHandle && gbifPanel) {
      let startY = 0;
      let currentDragY = 0;
      let isDragging = false;
      dragHandle.addEventListener('touchstart', (e) => {
        const te = e as TouchEvent;
        startY = te.touches[0].clientY;
        isDragging = true;
        gbifPanel.style.transition = 'none';
      });
      dragHandle.addEventListener('touchmove', (e) => {
        if (!isDragging) return;
        const te = e as TouchEvent;
        currentDragY = Math.max(0, te.touches[0].clientY - startY);
        gbifPanel.style.transform = `translateY(${currentDragY}px)`;
      });
      const endDrag = () => {
        if (!isDragging) return;
        isDragging = false;
        gbifPanel.style.transition = '';
        if (currentDragY > 100) closeGbifPanel();
        else gbifPanel.style.transform = '';
        currentDragY = 0;
      };
      dragHandle.addEventListener('touchend', endDrag);
      dragHandle.addEventListener('touchcancel', endDrag);
    }

    // GBIF toggle wired to both the FAB active state and the panel checkbox
    const updateGbifFabState = () => {
      gbifFab?.classList.toggle('active', gbifEnabled);
    };

    const gbifMenuToggle = document.getElementById('gbif-menu-toggle') as HTMLInputElement;

    const handleGbifToggle = (source: HTMLInputElement) => {
      gbifEnabled = source.checked;
      if (gbifToggle) gbifToggle.checked = gbifEnabled;
      if (gbifMenuToggle) gbifMenuToggle.checked = gbifEnabled;
      
      updateGbifFabState();
      if (gbifEnabled) {
        updateGbifLayer();
      } else {
        if (gbifLayer) map.removeLayer(gbifLayer);
        // @ts-ignore
        if (typeof vectorLayer !== 'undefined') vectorLayer.clearLayers();
        // @ts-ignore
        vectorMarkers = [];
        // @ts-ignore
        if (typeof activeFilters !== 'undefined') activeFilters.clear();
        // @ts-ignore
        if (typeof hideLegendFab === 'function') hideLegendFab();
        if (clearPointsBtn) clearPointsBtn.classList.add('hidden');
        if (searchAreaBtn) searchAreaBtn.classList.remove('hidden');
      }
    };

    gbifToggle?.addEventListener('change', () => handleGbifToggle(gbifToggle));
    gbifMenuToggle?.addEventListener('change', () => handleGbifToggle(gbifMenuToggle));
    gbifToggle?.addEventListener('click', (e) => e.stopPropagation());
    gbifMenuToggle?.addEventListener('click', (e) => e.stopPropagation());

    // 7. GBIF Biodiversity Core Logic

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

    const gbifSearch = document.getElementById('gbif-search') as HTMLInputElement;
    const gbifResults = document.getElementById('gbif-results') as HTMLElement;

    const updateFilterLabel = (name: string | null) => {
      const label = gbifFab?.querySelector('.gbif-filter-label');
      if (!label) return;
      if (name) {
        label.textContent = name;
        (label as HTMLElement).style.display = '';
      } else {
        (label as HTMLElement).style.display = 'none';
      }
    };

    const gbifYearInput = document.getElementById('gbif-year') as HTMLInputElement;
    const yearValueDisplay = document.getElementById('year-value') as HTMLElement;
    const playBtn = document.getElementById('gbif-play');
    const originBtns = document.querySelectorAll('#gbif-origin .chip-btn');
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

    const resolveGbifStyle = (palette: string, shape: string): string => {
      const isBinned = shape === 'hex' || shape === 'square';
      const isHeatmap = shape === 'heatmap';
      
      switch(palette) {
        case 'classic':
          return isBinned ? 'classic-noborder.poly' : 'classic.point';
        case 'green':
          return isBinned ? 'green-noborder.poly' : (isHeatmap ? 'greenHeat.point' : 'green.point');
        case 'blue':
          return isBinned ? 'classic-noborder.poly' : 'blueHeat.point'; 
        case 'orange':
          return isBinned ? 'red.poly' : (isHeatmap ? 'orangeHeat.point' : 'fire.point');
        case 'purpleHeat':
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
          if (!res.ok) throw new Error(`GBIF vernacularNames ${res.status} for taxon ${taxonKey}`);
          const data = await res.json();
          const allNames: VnName[] = [];
          for (const vn of data.results || []) {
            if (!vn.vernacularName || !vn.language) continue;
            const langRaw = String(vn.language).toLowerCase();
            const iso1 = langLookup1[langRaw] ? langRaw : resolveIso1(langRaw);
            if (iso1) allNames.push({ lang: iso1, name: vn.vernacularName });
          }
          vnCache.set(taxonKey, allNames);
        } catch (e) {
          console.error('[vernacular] fetch failed', { taxonKey, error: e });
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
      if (result.length > 0) return result;
      // Offensive fallback: return something rather than silently showing nothing.
      return all.slice(0, 4);
    };

    const prefetchTaxonVernaculars = async (taxonKeys: number[]) => {
      const uniq = [...new Set(taxonKeys.filter(k => k > 0))];
      await Promise.all(uniq.map(k => resolveVernacularNames(k)));
    };

    const createTaxonNameWrap = (scientificName: string, taxonKey?: number): HTMLSpanElement => {
      const wrap = document.createElement('span');
      wrap.className = 'tree-name-wrap';
      if (taxonKey && taxonKey > 0) wrap.dataset.taxonKey = String(taxonKey);
      wrap.dataset.scientific = scientificName;
      const primary = document.createElement('span');
      primary.className = 'tree-name-primary';
      primary.textContent = scientificName;
      const sci = document.createElement('span');
      sci.className = 'tree-name-sci';
      sci.textContent = scientificName;
      const allEl = document.createElement('span');
      allEl.className = 'tree-vn-all';
      wrap.appendChild(primary);
      wrap.appendChild(sci);
      wrap.appendChild(allEl);
      return wrap;
    };

    const updateTaxonNameWrap = (wrap: HTMLElement) => {
      const keyStr = wrap.dataset.taxonKey;
      const sci = wrap.dataset.scientific || '';
      const primaryEl = wrap.querySelector('.tree-name-primary') as HTMLElement | null;
      const sciEl = wrap.querySelector('.tree-name-sci') as HTMLElement | null;
      const allEl = wrap.querySelector('.tree-vn-all') as HTMLElement | null;
      if (!primaryEl || !sciEl) return;
      if (!keyStr) {
        primaryEl.textContent = sci;
        sciEl.style.display = 'none';
        if (allEl) { allEl.textContent = ''; allEl.style.display = 'none'; }
        return;
      }
      const key = parseInt(keyStr, 10);
      const all = vnCache.get(key) || [];
      const pickLc = (lang: string) => all.find(n => n.lang === lang)?.name;
      const activeName = pickLc(legendDisplayLang) || sci;
      primaryEl.textContent = activeName;
      if (activeName !== sci && sci) {
        sciEl.textContent = sci;
        sciEl.style.display = '';
      } else {
        sciEl.style.display = 'none';
      }
      const list = getLegendLangList();
      if (allEl && list.length > 0) {
        const parts: string[] = [];
        for (const lc of list) {
          const nm = pickLc(lc);
          if (nm) parts.push(`${lc.toUpperCase()}\u00a0${nm}`);
        }
        if (parts.length > 0) {
          allEl.textContent = parts.join(' · ');
          allEl.style.display = list.length > 1 ? '' : 'none';
        } else {
          allEl.textContent = '';
          allEl.style.display = 'none';
        }
      }
    };

    const applyLegendLanguageToBody = async (body: HTMLElement) => {
      const wraps = [...body.querySelectorAll<HTMLElement>('.tree-name-wrap')];
      const keys = wraps.map(w => parseInt(w.dataset.taxonKey || '', 10)).filter(k => !Number.isNaN(k) && k > 0);
      await prefetchTaxonVernaculars(keys);
      wraps.forEach(w => updateTaxonNameWrap(w));
    };

    // Dataset Name Resolver
    const datasetCache = new Map<string, string>();
    const resolveDatasetName = async (datasetKey: string): Promise<string> => {
      if (datasetCache.has(datasetKey)) return datasetCache.get(datasetKey)!;
      try {
        const res = await fetch(`https://api.gbif.org/v1/dataset/${datasetKey}`);
        if (!res.ok) throw new Error();
        const data = await res.json();
        const title = data.title || '';
        datasetCache.set(datasetKey, title);
        return title;
      } catch {
        datasetCache.set(datasetKey, '');
        return '';
      }
    };

    // Wikidata Image Resolver
    const wikidataCache = new Map<number, { imgUrl: string | null, wikiUrl: string } | null>();
    const resolveWikidataInfo = async (taxonKey: number): Promise<{ imgUrl: string | null, wikiUrl: string } | null> => {
      if (wikidataCache.has(taxonKey)) return wikidataCache.get(taxonKey)!;
      try {
        const url = `https://www.wikidata.org/w/api.php?action=query&prop=pageimages|info&inprop=url&generator=search&gsrsearch=haswbstatement:P846=${taxonKey}&piprop=thumbnail&pithumbsize=600&format=json&origin=*`;
        const res = await fetch(url);
        if (!res.ok) throw new Error();
        const data = await res.json();
        const pages = data.query?.pages;
        if (!pages) {
          console.warn(`[wikidata] No entity found for GBIF taxonKey: ${taxonKey}`);
          wikidataCache.set(taxonKey, null);
          return null;
        }
        const pageId = Object.keys(pages)[0];
        const page = pages[pageId];
        if (!page) {
          wikidataCache.set(taxonKey, null);
          return null;
        }
        const imgUrl = page.thumbnail?.source || null;
        if (!imgUrl) console.info(`[wikidata] Entity found (${page.title}) but lacks P18 image for taxonKey: ${taxonKey}`);
        let wikiUrl = page.fullurl || `https://www.wikidata.org/wiki/${page.title}`;
        
        try {
          const sites = [...new Set([...userLanguages, 'en'])].map(l => l + 'wiki').join('|');
          const slRes = await fetch(`https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${page.title}&props=sitelinks/urls&sitefilter=${sites}&format=json&origin=*`);
          if (slRes.ok) {
            const slData = await slRes.json();
            const sitelinks = slData.entities?.[page.title]?.sitelinks;
            if (sitelinks) {
              for (const lang of [...userLanguages, 'en']) {
                if (sitelinks[lang + 'wiki']?.url) {
                  wikiUrl = sitelinks[lang + 'wiki'].url;
                  break;
                }
              }
            }
          }
        } catch (err) {
          // Fallback to wikidata 
        }
        
        const result = { imgUrl, wikiUrl };
        wikidataCache.set(taxonKey, result);
        return result;
      } catch (e) {
        console.error('[wikidata] fetch failed', { taxonKey, error: e });
        wikidataCache.set(taxonKey, null);
        return null;
      }
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
        let pixels = 0;
        for (let i = 3; i < data.length; i += 4) { if (data[i] > 10) pixels++; if (pixels > 1) return true; }
        return false;
      } catch (e) { return false; }
    };

    const validateAllPalettes = async (shape: string) => {
      const tests = Array.from(paletteBtns).map(async (btn) => {
        const palette = btn.getAttribute('data-palette') || 'classic';
        btn.classList.add('testing');
        btn.classList.remove('verified', 'unsupported');
        const isValid = await checkStyleCapability(shape, palette);
        btn.classList.remove('testing');
        if (isValid) {
          btn.classList.add('verified');
          btn.removeAttribute('data-unavailable');
        } else {
          btn.classList.add('unsupported');
          btn.setAttribute('title', 'Not available for this shape');
        }
      });
      await Promise.all(tests);
    };

    const tilePixelRatio = Math.min(4, Math.ceil(window.devicePixelRatio || 1));

    const buildGbifUrl = (): string => {
      const styleParam = resolveGbifStyle(currentPalette, currentShape);
      const yearParam = currentYear === 'ALL' ? '' : `&year=1900,${currentYear}`;
      let originParam = '';
      if (!currentOrigins.includes('ALL')) originParam = currentOrigins.map(o => `&basisOfRecord=${o}`).join('');
      const taxonParam = currentTaxonKey ? `&taxonKey=${currentTaxonKey}` : '';
      return `https://api.gbif.org/v2/map/occurrence/density/{z}/{x}/{y}@${tilePixelRatio}x.png?srs=EPSG:3857&style=${styleParam}${taxonParam}${yearParam}${originParam}`;
    };

    const updateGbifLayer = () => {
      if (gbifLayer) map.removeLayer(gbifLayer);
      if (!gbifEnabled) return;
      const url = buildGbifUrl();
      
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

    const updateGbifUrlOnly = () => {
      if (!gbifLayer || !gbifEnabled) return;
      (gbifLayer as any).setUrl(buildGbifUrl());
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
          });
          gbifResults.appendChild(li);
          rows.push(rowData);
        });

        const enrichRow = async (row: typeof rows[0]): Promise<{ row: typeof rows[0]; count: number }> => {
          try {
            const [occData, vnNames] = await Promise.all([
              fetch(`https://api.gbif.org/v1/occurrence/search?taxonKey=${row.s.key}&limit=1`).then(r => r.json()),
              resolveVernacularNames(row.s.key)
            ]);
            if (gen !== searchGeneration) return { row, count: 0 };
            const count = occData.count || 0;
            const image = occData.results?.[0]?.media?.find((m: any) => m.type === 'StillImage')?.identifier
                       || occData.results?.[0]?.media?.[0]?.identifier || '';
            const validImage = image && (image.startsWith('http://') || image.startsWith('https://'));

            if (validImage) {
              const occKey = occData.results[0].key;
              const img = document.createElement('img');
              img.src = gbifThumb(occKey, image, 80);
              img.className = 'search-avatar';
              img.alt = row.s.canonicalName || '';
              img.loading = 'lazy';
              img.onerror = () => { img.outerHTML = `<div class="search-avatar">${getIconSvg('leaf')}</div>`; };
              row.avatarEl.replaceWith(img);
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

            return { row, count };
          } catch {
            row.countEl.textContent = 'No observations';
            const iconEl = row.li.querySelector('.obs-count svg');
            if (iconEl) iconEl.outerHTML = getIconSvg('globe');
            row.li.classList.add('no-observations');
            return { row, count: 0 };
          }
        };

        const enriched = await Promise.all(rows.map(enrichRow));

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
        showErrorToast('Species search failed — check your connection and try again.');
      }
    };

    let searchDebounceTimer: any;
    gbifSearch.addEventListener('input', () => {
      const query = gbifSearch.value.trim();
      if (query.length < 2) { gbifResults.style.display = 'none'; return; }
      clearTimeout(searchDebounceTimer);
      searchDebounceTimer = setTimeout(() => fetchGbif(query), 300);
    });

    gbifSearch.addEventListener('keydown', (e) => {
      const items = gbifResults.querySelectorAll('li');
      if (items.length === 0 || gbifResults.style.display === 'none') return;
      const active = gbifResults.querySelector('li.kb-focus');
      let idx = Array.from(items).indexOf(active as HTMLLIElement);
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        active?.classList.remove('kb-focus');
        idx = idx < items.length - 1 ? idx + 1 : 0;
        items[idx].classList.add('kb-focus');
        items[idx].scrollIntoView({ block: 'nearest' });
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        active?.classList.remove('kb-focus');
        idx = idx > 0 ? idx - 1 : items.length - 1;
        items[idx].classList.add('kb-focus');
        items[idx].scrollIntoView({ block: 'nearest' });
      } else if (e.key === 'Enter' && active) {
        e.preventDefault();
        (active as HTMLElement).click();
      }
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
      currentYear = val >= parseInt(gbifYearInput.max) ? 'ALL' : val;
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
          if (currentYear === 'ALL' || currentYear >= parseInt(gbifYearInput.max)) currentYear = 1900;
          if (!gbifLayer) updateGbifLayer();
          playInterval = setInterval(() => {
            if (currentYear !== 'ALL') currentYear += 5;
            if (currentYear !== 'ALL' && currentYear > parseInt(gbifYearInput.max)) {
              currentYear = 'ALL'; 
              isPlaying = false; 
              clearInterval(playInterval);
              playBtn.classList.remove('playing');
              if (icon) icon.setAttribute('data-lucide', 'play');
              LucideIcons.createIcons({ icons: iconsObject });
            }
            gbifYearInput.value = currentYear === 'ALL' ? gbifYearInput.max : currentYear.toString();
            yearValueDisplay.textContent = currentYear === 'ALL' ? 'All Years' : `1900 - ${currentYear}`;
            updateGbifUrlOnly();
          }, 800);
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
          const allBtn = document.querySelector('#gbif-origin [data-value="ALL"]');
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

    // 8. Geolocation
    const locateBtn = document.getElementById('locate-btn');
    const geoToast = document.getElementById('geo-toast');
    let userMarker: L.Marker | null = null;
    let geoStatus: 'unknown' | 'ok' | 'denied' | 'unavailable' | 'timeout' = 'unknown';

    const updateGeoIcon = () => {
      if (!locateBtn) return;
      const titles: Record<string, string> = {
        unknown: 'Find My Location',
        ok: 'Find My Location',
        denied: 'Location blocked — click for help',
        unavailable: 'Location unavailable — click for help',
        timeout: 'Location timed out — click for help'
      };
      locateBtn.title = titles[geoStatus] || 'Find My Location';
      locateBtn.classList.toggle('geo-warn', geoStatus !== 'unknown' && geoStatus !== 'ok');
    };

    const detectPlatform = (): { os: string; browser: string } => {
      const ua = navigator.userAgent;
      let os = 'unknown';
      if (/Macintosh|Mac OS X/i.test(ua)) os = 'macos';
      else if (/Windows/i.test(ua)) os = 'windows';
      else if (/Android/i.test(ua)) os = 'android';
      else if (/iPhone|iPad|iPod/i.test(ua)) os = 'ios';
      else if (/Linux/i.test(ua)) os = 'linux';
      let browser = 'unknown';
      if (/Firefox/i.test(ua)) browser = 'firefox';
      else if (/Edg\//i.test(ua)) browser = 'edge';
      else if (/Chrome/i.test(ua)) browser = 'chrome';
      else if (/Safari/i.test(ua)) browser = 'safari';
      return { os, browser };
    };

    const getGeoHelp = (code: number): { title: string; message: string; steps: string[] } => {
      const { os, browser } = detectPlatform();
      if (code === 1) {
        const steps: string[] = [];
        if (browser === 'chrome') steps.push('Click the lock/tune icon in the address bar → Site settings → Location → Allow');
        else if (browser === 'firefox') steps.push('Click the lock icon in the address bar → Clear permission for Location → Reload and allow');
        else if (browser === 'safari') steps.push('Safari → Settings → Websites → Location → set this site to Allow');
        else if (browser === 'edge') steps.push('Click the lock icon in the address bar → Permissions → Location → Allow');
        else steps.push('Check your browser\'s site permissions and allow Location access');
        if (os === 'macos') steps.push('macOS: System Settings → Privacy & Security → Location Services → enable for your browser');
        else if (os === 'windows') steps.push('Windows: Settings → Privacy & Security → Location → turn on and allow for your browser');
        else if (os === 'ios') steps.push('iOS: Settings → Privacy & Security → Location Services → turn on and allow for your browser');
        else if (os === 'android') steps.push('Android: Settings → Location → turn on; also check App permissions for your browser');
        return { title: 'Location Permission Denied', message: 'Your browser or OS is blocking location access.', steps };
      }
      if (code === 2) {
        const steps: string[] = [];
        if (os === 'macos') steps.push('macOS: System Settings → Privacy & Security → Location Services → make sure the master toggle is ON');
        else if (os === 'windows') steps.push('Windows: Settings → Privacy & Security → Location → turn on Location services');
        else if (os === 'ios') steps.push('iOS: Settings → Privacy & Security → Location Services → turn ON');
        else if (os === 'android') steps.push('Android: Settings → Location → turn ON');
        else steps.push('Check that your device\'s location/GPS service is turned on');
        steps.push('Make sure Wi-Fi is turned on (needed for location even on wired connections)');
        if (location.protocol === 'http:' && location.hostname !== 'localhost')
          steps.push('⚠ This page is served over HTTP — geolocation requires HTTPS');
        return { title: 'Location Unavailable', message: 'Your device cannot determine its position.', steps };
      }
      const steps: string[] = [];
      if (os === 'macos') {
        steps.push('macOS: System Settings → Privacy & Security → Location Services → make sure it is ON and your browser is listed');
        steps.push('Make sure Wi-Fi is turned on (macOS uses Wi-Fi for positioning)');
      } else if (os === 'windows') {
        steps.push('Windows: Settings → Privacy & Security → Location → make sure it is ON');
      } else if (os === 'ios' || os === 'android') {
        steps.push('Make sure Location/GPS is turned on in your device settings');
      } else {
        steps.push('Check that location services are enabled on your device');
      }
      steps.push('Try moving near a window or outside for better GPS signal');
      steps.push('Try reloading the page and allowing location when prompted');
      return { title: 'Location Timed Out', message: 'Could not get your position in time.', steps };
    };

    const showGeoToast = (code: number) => {
      if (!geoToast) return;
      const help = getGeoHelp(code);
      geoToast.innerHTML = `
        <div class="geo-toast-inner">
          <div class="geo-toast-header">
            ${getIconSvg('map-pin-off')}
            <strong>${help.title}</strong>
            <button class="geo-toast-close">${getIconSvg('x')}</button>
          </div>
          <p>${help.message}</p>
          <ol>${help.steps.map(s => `<li>${s}</li>`).join('')}</ol>
        </div>
      `;
      geoToast.classList.add('visible');
      geoToast.querySelector('.geo-toast-close')?.addEventListener('click', () => {
        geoToast.classList.remove('visible');
      });
    };

    const hideGeoToast = () => geoToast?.classList.remove('visible');

    const doLocate = (silent: boolean) => {
      if (!navigator.geolocation) {
        geoStatus = 'unavailable'; updateGeoIcon();
        if (!silent) showGeoToast(2);
        if (locateBtn) locateBtn.classList.remove('loading');
        return;
      }
      let settled = false;
      const tryPosition = (highAccuracy: boolean, timeout: number, isRetry: boolean) => {
        navigator.geolocation.getCurrentPosition(
          (pos) => {
            if (settled) return;
            settled = true;
            geoStatus = 'ok'; updateGeoIcon();
            hideGeoToast();
            if (locateBtn) locateBtn.classList.remove('loading');
            const latlng = L.latLng(pos.coords.latitude, pos.coords.longitude);
            map.setView(latlng, Math.min(map.getZoom() < 10 ? 16 : map.getZoom(), 16));
            const pulseIcon = L.divIcon({ className: 'user-location-marker', html: '<div class="pulse-marker"></div>', iconSize: [20, 20], iconAnchor: [10, 10] });
            if (userMarker) userMarker.setLatLng(latlng);
            else userMarker = L.marker(latlng, { icon: pulseIcon }).addTo(map);
          },
          (err) => {
            if (settled) return;
            if (!isRetry && err.code === err.TIMEOUT) {
              tryPosition(false, 20000, true);
              return;
            }
            settled = true;
            geoStatus = err.code === 1 ? 'denied' : err.code === 2 ? 'unavailable' : 'timeout'; updateGeoIcon();
            if (locateBtn) {
              locateBtn.classList.remove('loading');
              if (!silent) {
                locateBtn.classList.add('error');
                setTimeout(() => locateBtn.classList.remove('error'), 2000);
              }
            }
            if (!silent) showGeoToast(err.code);
          },
          { enableHighAccuracy: highAccuracy, timeout, maximumAge: 60000 }
        );
      };
      tryPosition(true, 10000, false);
    };

    if (locateBtn) {
      locateBtn.addEventListener('click', () => {
        locateBtn.classList.add('loading');
        doLocate(false);
      });
    }
    doLocate(!savedCenter ? false : true);

    // 9. Micro-Vector Area Search
    const vectorControls = document.getElementById('vector-search-controls');
    const searchAreaBtn = document.getElementById('search-area-btn');
    const clearPointsBtn = document.getElementById('clear-points-btn');
    const vectorLegend = document.getElementById('vector-legend');
    const vectorLegendBody = document.getElementById('vector-legend-body');
    const legendToggle = document.getElementById('legend-toggle');
    const legendClose = document.getElementById('legend-close');
    const legendBadge = document.getElementById('legend-badge');
    const TAXA_COLORS: Record<string, string> = {
      aves: '#3b82f6', mammalia: '#f97316', plantae: '#22c55e', insecta: '#a855f7',
      fungi: '#84cc16', reptilia: '#14b8a6', amphibia: '#06b6d4', actinopterygii: '#2563eb',
      arachnida: '#eab308', gastropoda: '#ec4899', malacostraca: '#f43f5e',
      mollusca: '#d946ef', default: '#64748b'
    };

    const createClusterIcon = (cluster: L.MarkerCluster) => {
      const children = cluster.getAllChildMarkers();
      const counts: Record<string, number> = {};
      children.forEach(m => {
        const cls = (m.options as any).taxaCssClass || 'default';
        counts[cls] = (counts[cls] || 0) + 1;
      });
      const total = children.length;
      const size = total < 20 ? 44 : total < 100 ? 52 : 60;
      const r = size / 2;
      const inner = r * 0.55;

      let segments = '';
      let angle = 0;
      for (const [cls, count] of Object.entries(counts)) {
        const sliceAngle = (count / total) * 360;
        const startRad = (angle - 90) * Math.PI / 180;
        const endRad = (angle + sliceAngle - 90) * Math.PI / 180;
        const largeArc = sliceAngle > 180 ? 1 : 0;
        const x1o = r + r * Math.cos(startRad), y1o = r + r * Math.sin(startRad);
        const x2o = r + r * Math.cos(endRad), y2o = r + r * Math.sin(endRad);
        const x1i = r + inner * Math.cos(endRad), y1i = r + inner * Math.sin(endRad);
        const x2i = r + inner * Math.cos(startRad), y2i = r + inner * Math.sin(startRad);
        const color = TAXA_COLORS[cls] || TAXA_COLORS.default;
        if (Object.keys(counts).length === 1) {
          segments += `<circle cx="${r}" cy="${r}" r="${r}" fill="${color}"/>`;
          segments += `<circle cx="${r}" cy="${r}" r="${inner}" fill="rgba(15,23,42,0.85)"/>`;
        } else {
          segments += `<path d="M${x1o},${y1o} A${r},${r} 0 ${largeArc} 1 ${x2o},${y2o} L${x1i},${y1i} A${inner},${inner} 0 ${largeArc} 0 ${x2i},${y2i} Z" fill="${color}"/>`;
        }
        angle += sliceAngle;
      }

      const centerBg = Object.keys(counts).length > 1
        ? `<circle cx="${r}" cy="${r}" r="${inner}" fill="rgba(15,23,42,0.85)"/>`
        : '';
      const svg = `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" xmlns="http://www.w3.org/2000/svg">
        ${segments}${centerBg}
        <text x="${r}" y="${r}" text-anchor="middle" dy=".35em" fill="#fff" font-size="${size < 50 ? 12 : 14}" font-weight="700" font-family="Inter,system-ui,sans-serif">${total}</text>
      </svg>`;

      return L.divIcon({
        html: `<div class="cluster-donut">${svg}</div>`,
        className: 'custom-cluster-icon',
        iconSize: L.point(size, size),
        iconAnchor: L.point(size / 2, size / 2)
      });
    };

    const vectorLayer = (L as any).markerClusterGroup({
      maxClusterRadius: 45,
      spiderfyOnMaxZoom: true,
      showCoverageOnHover: false,
      zoomToBoundsOnClick: true,
      iconCreateFunction: createClusterIcon,
      animate: true,
      animateAddingMarkers: false
    }).addTo(map);

    const openLegend = () => {
      vectorLegend?.classList.add('open');
      legendToggle?.classList.add('active');
      document.body.classList.add('panel-active');
    };
    const closeLegend = () => {
      vectorLegend?.classList.remove('open');
      legendToggle?.classList.remove('active');
      if (!gbifPanel?.classList.contains('open')) {
        document.body.classList.remove('panel-active');
      }
    };
    const showLegendFab = (count: number) => {
      legendToggle?.classList.remove('hidden');
      if (legendBadge) legendBadge.textContent = count.toString();
    };
    const hideLegendFab = () => {
      legendToggle?.classList.add('hidden');
      closeLegend();
      refreshTaxonomyLegendLang = null;
    };

    // 9b. Legend Resize Logic
    const resizeHandle = document.getElementById('legend-resize-handle');
    const STORAGE_KEY_LEGEND_WIDTH = 'mymap_legend_width';
    let isResizing = false;

    if (vectorLegend && resizeHandle) {
      const savedWidth = localStorage.getItem(STORAGE_KEY_LEGEND_WIDTH);
      if (savedWidth && window.innerWidth > 768) {
        vectorLegend.style.width = `${savedWidth}px`;
      }
      
      resizeHandle.addEventListener('mousedown', (e) => {
        if (window.innerWidth <= 768) return;
        isResizing = true;
        document.body.classList.add('legend-resizing');
        vectorLegend.classList.add('legend-resizing');
        e.preventDefault();
      });

      window.addEventListener('mousemove', (e) => {
        if (!isResizing || !vectorLegend) return;
        const newWidth = window.innerWidth - e.clientX - 80;
        if (newWidth >= 260 && newWidth <= 800) {
          vectorLegend.style.width = `${newWidth}px`;
        }
      });

      window.addEventListener('mouseup', () => {
        if (isResizing && vectorLegend) {
          isResizing = false;
          document.body.classList.remove('legend-resizing');
          vectorLegend.classList.remove('legend-resizing');
          localStorage.setItem(STORAGE_KEY_LEGEND_WIDTH, vectorLegend.offsetWidth.toString());
        }
      });
    }

    legendToggle?.addEventListener('click', () => {
      if (vectorLegend?.classList.contains('open')) closeLegend();
      else openLegend();
    });
    legendClose?.addEventListener('click', closeLegend);



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
        
        if (gbifLayer) map.removeLayer(gbifLayer);

        const south = Math.max(-90, bounds.getSouth());
        const north = Math.min(90, bounds.getNorth());
        const west = Math.max(-180, bounds.getWest());
        const east = Math.min(180, bounds.getEast());
        let url = `https://api.gbif.org/v1/occurrence/search?decimalLatitude=${south},${north}&decimalLongitude=${west},${east}&limit=300&occurrenceStatus=PRESENT`;
        if (currentYear !== 'ALL') url += `&year=1900,${currentYear}`;
        if (currentTaxonKey) url += `&taxonKey=${currentTaxonKey}`;
        if (!currentOrigins.includes('ALL')) url += currentOrigins.map(o => `&basisOfRecord=${o}`).join('');

        try {
          vectorLayer.clearLayers();
          vectorMarkers = [];
          hideLegendFab();
          
          let offset = 0;
          let keepFetching = true;
          let totalCount = 0;
          const limit = 300;
          const progressBar = searchAreaBtn.querySelector('.search-progress-bar') as HTMLElement;
          if (progressBar) progressBar.style.width = '2%';
          searchAreaBtn.classList.add('loading');

          while (keepFetching) {
            const pageUrl = `${url}&offset=${offset}`;
            const res = await fetch(pageUrl);
            if (!res.ok) throw new Error(`GBIF API returned ${res.status}`);
            const data = await res.json();
            
            if (offset === 0) totalCount = data.count || 0;
            
            data.results.forEach((occ: any) => {
              if (!occ.decimalLatitude || !occ.decimalLongitude) return;
              const media = occ.media?.find((m: any) => m.type === 'StillImage' && m.identifier)?.identifier
                         || occ.media?.[0]?.identifier || '';
              const hasImage = !!media && (media.startsWith('http://') || media.startsWith('https://'));
              const taxaInfo = getTaxaInfo(occ.class || occ.kingdom || occ.phylum, hasImage);
              const thisYear = new Date().getFullYear();
              const age = occ.year ? Math.max(0, Math.min(1, (occ.year - 1900) / (thisYear - 1900))) : 1;
              const marker = L.marker([occ.decimalLatitude, occ.decimalLongitude], {
                icon: taxaInfo.icon,
                opacity: 0.35 + 0.65 * age,
                taxaCssClass: taxaInfo.cssClass
              } as any).addTo(vectorLayer);
              
              const thumbUrl = hasImage ? gbifThumb(occ.key, media) : '';
              const imgHtml = hasImage ? `<img src="${thumbUrl}" alt="${occ.scientificName || ''}" loading="lazy" onerror="this.remove()">` : '';

              let dateStr = 'Unknown';
              if (occ.eventDate) {
                try { dateStr = new Date(occ.eventDate).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }); }
                catch { dateStr = occ.eventDate; }
              } else if (occ.year) { dateStr = String(occ.year); }

              const recorder = occ.recordedBy || '';
              const recorderHtml = recorder ? `<div class="popup-detail">${getIconSvg('user')} ${recorder}</div>` : '';

              const basisLabels: Record<string, string> = {
                HUMAN_OBSERVATION: 'Human Observation', MACHINE_OBSERVATION: 'Machine Observation',
                PRESERVED_SPECIMEN: 'Preserved Specimen', FOSSIL_SPECIMEN: 'Fossil Specimen',
                LIVING_SPECIMEN: 'Living Specimen', MATERIAL_SAMPLE: 'Material Sample',
                MATERIAL_CITATION: 'Material Citation', OBSERVATION: 'Observation', OCCURRENCE: 'Occurrence'
              };
              const basisHtml = occ.basisOfRecord ? `<div class="popup-detail">${getIconSvg('clipboard-list')} ${basisLabels[occ.basisOfRecord] || occ.basisOfRecord}</div>` : '';
              const datasetKey = occ.datasetKey || '';

              const gbifUrl = `https://www.gbif.org/occurrence/${occ.key}`;
              const sourceRef = occ.references || '';
              const sourceHtml = sourceRef ? `<a href="${sourceRef}" target="_blank" rel="noopener">${getIconSvg('external-link')} Source</a>` : '';

              const popupHtml = `
                <div class="vector-popup">
                  <div class="popup-image-container">
                    ${imgHtml}
                    <div class="image-source-badge">Observation</div>
                    <button class="switch-image-btn hidden" title="Switch Image Source">${getIconSvg('repeat')}</button>
                  </div>
                  <div class="title">${occ.scientificName || 'Unknown Species'}</div>
                  <div class="vernacular-popup"></div>
                  <div class="popup-details">
                    <div class="popup-detail">${getIconSvg('calendar')} ${dateStr}</div>
                    ${recorderHtml}
                    ${basisHtml}
                    <div class="popup-detail popup-dataset"></div>
                  </div>
                  <div class="popup-links">
                    <a href="${gbifUrl}" target="_blank" rel="noopener">${getIconSvg('external-link')} GBIF</a>
                    ${sourceHtml}
                    <a href="#" class="wiki-link hidden" target="_blank" rel="noopener">${getIconSvg('book-open')} Wiki</a>
                  </div>
                </div>
              `;
              marker.bindPopup(popupHtml, { maxWidth: 300, autoPan: false });
              const popupTaxonKeys = [occ.speciesKey, occ.acceptedTaxonKey, occ.taxonKey]
                .filter((k: unknown): k is number => typeof k === 'number' && k > 0);
              marker.on('popupopen', async () => {
                const popupEl = marker.getPopup()?.getElement();
                if (!popupEl) return;

                const sciName = occ.scientificName || '';
                const imageContainer = popupEl.querySelector('.popup-image-container') as HTMLElement;
                const badge = popupEl.querySelector('.image-source-badge') as HTMLElement;
                const switchBtn = popupEl.querySelector('.switch-image-btn') as HTMLElement;
                const wikiLink = popupEl.querySelector('.wiki-link') as HTMLAnchorElement;
                
                let wikimediaImgUrl: string | null = null;
                let wikidataUrl: string | null = null;
                let currentSource: 'obs' | 'wiki' = hasImage ? 'obs' : 'wiki';

                // Initial Wikidata check
                if (popupTaxonKeys.length > 0) {
                  for (const key of popupTaxonKeys) {
                    const wikiInfo = await resolveWikidataInfo(key);
                    if (wikiInfo) {
                      wikimediaImgUrl = wikiInfo.imgUrl;
                      wikidataUrl = wikiInfo.wikiUrl;
                      break;
                    }
                  }

                  if (wikidataUrl) {
                    if (wikiLink) {
                      wikiLink.href = wikidataUrl;
                      wikiLink.classList.remove('hidden');
                    }
                  }

                  if (wikimediaImgUrl) {
                    if (!hasImage) {
                      // If no observation image, show wiki immediately
                      const img = document.createElement('img');
                      img.src = wikimediaImgUrl;
                      img.alt = sciName;
                      img.loading = 'lazy';
                      img.onload = () => scheduleVectorPopupFit(marker);
                      img.onerror = () => img.remove();
                      imageContainer?.prepend(img);
                      if (badge) badge.textContent = 'Wikimedia';
                      currentSource = 'wiki';
                    } else {
                      // Show switch button if both exist
                      if (switchBtn) switchBtn.classList.remove('hidden');
                    }
                  }
                }

                if (switchBtn && hasImage && wikimediaImgUrl) {
                  switchBtn.onclick = (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    const imgEl = imageContainer?.querySelector('img') as HTMLImageElement | null;
                    if (!imgEl) return;

                    if (currentSource === 'obs') {
                      imgEl.src = wikimediaImgUrl!;
                      if (badge) badge.textContent = 'Wikimedia';
                      currentSource = 'wiki';
                    } else {
                      imgEl.src = thumbUrl;
                      if (badge) badge.textContent = 'Observation';
                      currentSource = 'obs';
                    }
                    scheduleVectorPopupFit(marker);
                  };
                }

                if (hasImage && currentSource === 'obs') {
                  const imgEl = popupEl.querySelector('img');
                  if (imgEl) {
                    if (imgEl.complete) scheduleVectorPopupFit(marker);
                    else imgEl.addEventListener('load', () => {
                      scheduleVectorPopupFit(marker);
                    }, { once: true });
                  } else scheduleVectorPopupFit(marker);
                } else scheduleVectorPopupFit(marker);

                if (popupTaxonKeys.length > 0) {
                  const el = popupEl.querySelector('.vernacular-popup') as HTMLElement | null;
                  const langSig = userLanguages.join(',');
                  if (el) {
                    // Always refresh on popup open to avoid stale/lazy-state mismatches.
                    el.innerHTML = `<span class="lang-tag">...</span> Loading names`;
                    let names: VnName[] = [];
                    for (const k of popupTaxonKeys) {
                      names = await resolveVernacularNames(k);
                      if (names.length > 0) break;
                    }
                    if (names.length > 0) {
                      el.innerHTML = names.map(n =>
                        `<span class="lang-tag">${n.lang.toUpperCase()}</span> ${n.name}`
                      ).join(' · ');
                    } else {
                      console.warn('[vernacular] no names for occurrence', {
                        occurrenceKey: occ.key,
                        taxonKeysTried: popupTaxonKeys,
                        userLanguages,
                        langSig
                      });
                      el.innerHTML = `<span class="lang-tag">INFO</span> No vernacular names available`;
                    }
                    el.dataset.langSig = langSig;
                  } else {
                    console.error('[vernacular] popup element missing .vernacular-popup node', { occurrenceKey: occ.key });
                  }
                } else {
                  console.warn('[vernacular] no taxon key on occurrence', { occurrenceKey: occ.key });
                }
                if (datasetKey) {
                  const dsEl = popupEl.querySelector('.popup-dataset');
                  if (dsEl && !dsEl.innerHTML.trim()) {
                    const name = await resolveDatasetName(datasetKey);
                    if (name) {
                      dsEl.innerHTML = `${getIconSvg('database')} <a href="https://www.gbif.org/dataset/${datasetKey}" target="_blank" rel="noopener">${name}</a>`;
                    } else {
                      dsEl.remove();
                    }
                  }
                }
                scheduleVectorPopupFit(marker);
              });
              
              vectorMarkers.push({
                cssClass: taxaInfo.cssClass, label: taxaInfo.label, iconUrl: taxaInfo.iconName, marker,
                taxonomy: {
                  kingdom: occ.kingdom || '', phylum: occ.phylum || '', class: occ.class || '',
                  order: occ.order || '', family: occ.family || '', genus: occ.genus || '',
                  species: occ.species || occ.scientificName || '',
                  kingdomKey: occ.kingdomKey, phylumKey: occ.phylumKey, classKey: occ.classKey,
                  orderKey: occ.orderKey, familyKey: occ.familyKey, genusKey: occ.genusKey,
                  speciesKey: occ.speciesKey
                }
              });
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
          if (searchAreaBtn) searchAreaBtn.classList.add('hidden');
          if (progressBar) {
            progressBar.style.width = '100%';
            setTimeout(() => { progressBar.style.width = '0%'; }, 500);
          }
          lastTotalCount = totalCount;
          updateTaxonomyLegend();
        } catch (e) {

          console.error('Vector Search Error:', e);
          showErrorToast('Area search failed — check your connection and try again.');
        } finally {
          searchAreaBtn.classList.remove('loading');
          const loaderIcon = searchAreaBtn.querySelector('svg[data-lucide="loader-2"]');
          if (loaderIcon) loaderIcon.outerHTML = getIconSvg('search');
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
        if (searchAreaBtn) searchAreaBtn.classList.remove('hidden');
        if (gbifEnabled && gbifLayer) map.addLayer(gbifLayer);
      });
    }

    // 10. Sync Deep-Link variables to UI
    if (gbifYearInput) gbifYearInput.value = currentYear === 'ALL' ? gbifYearInput.max : currentYear.toString();
    if (yearValueDisplay) yearValueDisplay.textContent = currentYear === 'ALL' ? 'All Years' : `1900 - ${currentYear}`;
    if (densityInput) densityInput.value = currentDensity.toString();
    if (densityValueTag) densityValueTag.textContent = `${currentDensity} Bins`;
    if (opacityInput) opacityInput.value = currentOpacity.toString();
    if (opacityValueTag) opacityValueTag.textContent = `${Math.round(currentOpacity * 100)}%`;
    document.querySelectorAll('#gbif-origin .chip-btn').forEach(b => {
      b.classList.toggle('active', currentOrigins.includes(b.getAttribute('data-value') || ''));
    });
    document.querySelectorAll('#gbif-shape-picker .picker-btn').forEach(b => {
      b.classList.toggle('active', b.getAttribute('data-shape') === currentShape);
    });
    document.querySelectorAll('#gbif-scale-mode .toggle-btn').forEach(b => {
      b.classList.toggle('active', b.getAttribute('data-mode') === currentScaleMode);
    });
    document.querySelectorAll('#gbif-palette-picker .palette-btn').forEach(b => {
      b.classList.toggle('active', b.getAttribute('data-palette') === currentPalette);
    });

    // 11. Collapsibles & Escape key
    const collapsibles = document.querySelectorAll('.collapsible');
    collapsibles.forEach(section => {
      section.querySelector('.section-header')?.addEventListener('click', (e) => {
        const target = e.target as HTMLElement;
        if (target.closest('.layer-toggle')) return;
        section.classList.toggle('active');
      });
    });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        if (gbifPanel?.classList.contains('open')) closeGbifPanel();
        else if (basePopoverOpen) closeBasePopover();
        else if (layerStack?.classList.contains('open')) closeLayerStack();
      }
    });

    // Close base popover when clicking outside
    document.addEventListener('click', (e) => {
      if (basePopoverOpen && !baseLayerPopover?.contains(e.target as Node) && !baseLayerFab?.contains(e.target as Node)) {
        closeBasePopover();
      }
    });

    // 12. Language Settings UI
    const langChipsContainer = document.getElementById('lang-chips');
    const langSearchInput = document.getElementById('lang-search') as HTMLInputElement;
    const langDropdown = document.getElementById('lang-dropdown') as HTMLElement;

    const onLanguagesChanged = () => {
      syncLegendDisplayLang();
      void refreshTaxonomyLegendLang?.();
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
      try {
        const testUrl = `https://api.gbif.org/v1/species/2435099`;
        const res = await fetch(testUrl, { method: 'HEAD', mode: 'cors' });
        if (gbifStatusDot) {
          const dot = document.createElement('div');
          dot.className = `status-dot ${res.ok ? 'online' : 'offline'}`;
          gbifStatusDot.appendChild(dot);
        }
      } catch (e) {
        if (gbifStatusDot) {
          const dot = document.createElement('div');
          dot.className = 'status-dot offline';
          gbifStatusDot.appendChild(dot);
        }
      }
    };
    
    // 13. Final Initialization
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
    updateGbifFabState();
    LucideIcons.createIcons({ icons: iconsObject });

    // Welcome card (first visit only)
    const WELCOME_KEY = 'mymap_welcomed';
    const welcomeCard = document.getElementById('welcome-card');
    const welcomeDismiss = document.getElementById('welcome-dismiss');
    if (welcomeCard) {
      if (localStorage.getItem(WELCOME_KEY)) {
        welcomeCard.classList.add('hidden');
      } else {
        welcomeDismiss?.addEventListener('click', () => {
          welcomeCard.classList.add('hidden');
          localStorage.setItem(WELCOME_KEY, '1');
        });
      }
    }

    // Reset All Settings
    const ALL_STORAGE_KEYS = [STORAGE_KEY_CENTER, STORAGE_KEY_ZOOM, STORAGE_KEY_LANGS, STORAGE_KEY_BASE, STORAGE_KEY_OVERLAYS, 'gbif_history', WELCOME_KEY];
    const resetBtn = document.getElementById('reset-all-btn');
    if (resetBtn) {
      let confirmPending = false;
      let confirmTimer: any;
      resetBtn.addEventListener('click', () => {
        if (!confirmPending) {
          confirmPending = true;
          resetBtn.classList.add('confirming');
          const label = resetBtn.querySelector('span');
          if (label) label.textContent = 'Tap again to confirm';
          confirmTimer = setTimeout(() => {
            confirmPending = false;
            resetBtn.classList.remove('confirming');
            if (label) label.textContent = 'Reset All Settings';
          }, 3000);
          return;
        }
        clearTimeout(confirmTimer);
        ALL_STORAGE_KEYS.forEach(k => localStorage.removeItem(k));
        window.location.href = window.location.pathname;
      });
    }

  } catch (error) {
    console.error('Error initializing map:', error);
    showErrorToast('Failed to load app configuration. Please refresh the page.');
  }
}

initMap();
