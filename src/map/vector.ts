import L from 'leaflet';
import { AppState } from '../state';
import { getTaxaInfo } from './markers';
import { 
  gbifThumb, 
  resolveWikidataInfo, 
  resolveVernacularNames, 
  resolveDatasetName
} from './gbif';
import { scheduleVectorPopupFit } from './core';
import { getIconSvg } from '../ui/icons';
import { showErrorToast } from '../ui/toasts';

export function initVectorSearch(map: L.Map, state: AppState, updateTaxonomyLegend: () => void) {
  const searchAreaBtn = document.getElementById('search-area-btn');
  const clearPointsBtn = document.getElementById('clear-points-btn');
  const vectorControls = document.getElementById('vector-search-controls');

  const TAXA_COLORS: Record<string, string> = {
    aves: '#3b82f6', mammalia: '#f97316', plantae: '#22c55e', insecta: '#a855f7',
    fungi: '#84cc16', reptilia: '#14b8a6', amphibia: '#06b6d4', actinopterygii: '#2563eb',
    arachnida: '#eab308', gastropoda: '#ec4899', malacostraca: '#f43f5e',
    mollusca: '#d946ef', default: '#64748b'
  };

  const createClusterIcon = (cluster: any) => {
    const children = cluster.getAllChildMarkers();
    const counts: Record<string, number> = {};
    children.forEach((m: any) => {
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

    const svg = `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" xmlns="http://www.w3.org/2000/svg">
      ${segments}<circle cx="${r}" cy="${r}" r="${inner}" fill="rgba(15,23,42,0.85)"/>
      <text x="${r}" y="${r}" text-anchor="middle" dy=".35em" fill="#fff" font-size="${size < 50 ? 12 : 14}" font-weight="700">${total}</text>
    </svg>`;

    return L.divIcon({
      html: `<div class="cluster-donut">${svg}</div>`,
      className: 'custom-cluster-icon',
      iconSize: L.point(size, size), iconAnchor: L.point(size / 2, size / 2)
    });
  };

  const vectorLayer = (L as any).markerClusterGroup({
    iconCreateFunction: createClusterIcon,
    maxClusterRadius: 45,
    showCoverageOnHover: false
  }).addTo(map);
  state.vectorLayer = vectorLayer;

  const hideLegendFab = () => {
    document.getElementById('legend-toggle')?.classList.add('hidden');
    document.getElementById('vector-legend')?.classList.remove('open');
  };

  const confirmModal = document.getElementById('confirm-modal');
  const confirmTitle = document.getElementById('confirm-title');
  const confirmMessage = document.getElementById('confirm-message');
  const confirmOk = document.getElementById('confirm-ok');
  const confirmCancel = document.getElementById('confirm-cancel');

  const showConfirm = (title: string, message: string): Promise<boolean> => {
    return new Promise((resolve) => {
      if (!confirmModal || !confirmTitle || !confirmMessage || !confirmOk || !confirmCancel) {
        resolve(window.confirm(`${title}\n\n${message}`));
        return;
      }
      confirmTitle.textContent = title;
      confirmMessage.textContent = message;
      confirmModal.classList.remove('hidden');

      const cleanup = (value: boolean) => {
        confirmModal.classList.add('hidden');
        confirmOk.removeEventListener('click', okHandler);
        confirmCancel.removeEventListener('click', cancelHandler);
        resolve(value);
      };

      const okHandler = () => cleanup(true);
      const cancelHandler = () => cleanup(false);

      confirmOk.addEventListener('click', okHandler);
      confirmCancel.addEventListener('click', cancelHandler);
    });
  };

  const processOccurrences = (results: any[]) => {
    results.forEach((occ: any) => {
      if (!occ.decimalLatitude || !occ.decimalLongitude) return;
      const media = occ.media?.find((m: any) => m.type === 'StillImage')?.identifier || '';
      const hasImage = !!media;
      const taxaInfo = getTaxaInfo(occ.class || occ.kingdom, hasImage);
      const marker = L.marker([occ.decimalLatitude, occ.decimalLongitude], {
        icon: taxaInfo.icon,
        taxaCssClass: taxaInfo.cssClass
      } as any).addTo(vectorLayer);
      
      const popup = L.popup({ maxWidth: 260, className: 'vector-popup' })
        .setContent(`<div class="vector-popup-loading">${getIconSvg('loader-2')}</div>`);
      marker.bindPopup(popup);

      marker.on('popupopen', async () => {
        scheduleVectorPopupFit(map, marker);
        const taxonKey = occ.taxonKey || occ.speciesKey || occ.usageKey;
        const cachedVernaculars = await resolveVernacularNames(taxonKey);
        const localVernaculars = [...cachedVernaculars];
        const wiki = await resolveWikidataInfo(taxonKey, state.userLanguages);
        const datasetName = await resolveDatasetName(occ.datasetKey);
        const gbifImg = media ? gbifThumb(occ.key, media) : null;
        let currentImg = gbifImg || (wiki ? wiki.imgUrl : null);

        if (wiki && wiki.labels) {
          for (const [lc, name] of Object.entries(wiki.labels)) {
            localVernaculars.unshift({ lang: lc, name });
          }
        }

        const preferredNames: { name: string, lang: string, isScientific: boolean }[] = [];
        for (const lc of state.userLanguages) {
          if (lc === 'la') {
            preferredNames.push({ name: occ.scientificName, lang: 'la', isScientific: true });
          } else {
            const match = localVernaculars.find(v => v.lang === lc);
            if (match) {
              const isSci = match.name.toLowerCase() === occ.scientificName.toLowerCase();
              preferredNames.push({ name: match.name, lang: lc, isScientific: isSci });
            }
          }
        }

        const best = preferredNames[0] || { name: occ.scientificName, lang: 'la', isScientific: true };
        const subtitleNames = preferredNames.filter(n => n !== best);
        if (!best.isScientific && !subtitleNames.find(n => n.isScientific)) {
          subtitleNames.push({ name: occ.scientificName, lang: 'la', isScientific: true });
        }

        const vnHtml = subtitleNames.map(n => 
          `<div class="vernacular-popup" ${n.isScientific ? 'style="font-style: italic; opacity: 0.7;"' : ''}>
            ${n.lang !== 'la' ? `<span class="lang-tag">${n.lang.toUpperCase()}</span> ` : ''}${n.name}
          </div>`
        ).join('');

        const content = document.createElement('div');
        content.className = 'vector-popup';
        content.innerHTML = `
          ${currentImg ? `<div class="popup-image-container">
              <img src="${currentImg}" alt="${best.name}">
              ${(gbifImg && wiki?.imgUrl) ? `<button class="switch-image-btn" title="Switch Image Source">${getIconSvg('refresh-cw')}</button>` : ''}
              <div class="image-source-badge">${currentImg === gbifImg ? 'GBIF' : 'WIKI'}</div>
            </div>` : ''}
          <div class="title" ${best.isScientific ? 'style="font-style: italic;"' : ''}>${best.name}</div>
          <div class="subtitle-group">${vnHtml}</div>
          <div class="popup-details">
            <div class="popup-detail">${getIconSvg('calendar')}<span>${occ.eventDate ? new Date(occ.eventDate).toLocaleDateString() : 'Unknown date'}</span></div>
            <div class="popup-detail">${getIconSvg('database')}<span>${datasetName || 'GBIF.org'}</span></div>
          </div>
          <div class="popup-links">
            <a href="https://www.gbif.org/occurrence/${occ.key}" target="_blank">${getIconSvg('external-link')} GBIF</a>
            ${wiki ? `<a href="${wiki.wikiUrl}" target="_blank" class="wiki-link">${getIconSvg('book-open')} Wiki</a>` : ''}
          </div>
        `;

        const switchBtn = content.querySelector('.switch-image-btn');
        const badge = content.querySelector('.image-source-badge');
        const img = content.querySelector('img') as HTMLImageElement;
        
        switchBtn?.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          if (currentImg === gbifImg) {
            currentImg = wiki?.imgUrl || gbifImg;
            if (badge) badge.textContent = 'WIKI';
          } else {
            currentImg = gbifImg;
            if (badge) badge.textContent = 'GBIF';
          }
          if (img) img.src = currentImg!;
        });

        popup.setContent(content);
        scheduleVectorPopupFit(map, marker);
      });
      
      state.vectorMarkers.push({
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
  };

  searchAreaBtn?.addEventListener('click', async () => {
    if (!state.gbifEnabled) return;
    const bounds = map.getBounds();
    const south = Math.max(-90, bounds.getSouth()), north = Math.min(90, bounds.getNorth());
    const west = Math.max(-180, bounds.getWest()), east = Math.min(180, bounds.getEast());

    const baseParams = `decimalLatitude=${south},${north}&decimalLongitude=${west},${east}&occurrenceStatus=PRESENT`;
    let url = `https://api.gbif.org/v1/occurrence/search?${baseParams}`;
    if (state.currentYear !== 'ALL') url += `&year=1900,${state.currentYear}`;
    if (state.currentTaxonKey) url += `&taxonKey=${state.currentTaxonKey}`;

    try {
      // 1. Initial pre-fetch to get count
      const countRes = await fetch(`${url}&limit=0`);
      const countData = await countRes.json();
      const totalCount = countData.count;

      if (totalCount === 0) {
        showErrorToast('No occurrences found in this area.');
        return;
      }

      // 2. Threshold check & Confirmation
      if (totalCount > 300) {
        const confirmed = await showConfirm(
          'Load Large Dataset?',
          `${totalCount.toLocaleString()} occurrences found. Loading all records will take some time. Tip: zoom in or use filters for faster results.`
        );
        if (!confirmed) return;
      }

      // 3. Start Loading
      const progressBar = searchAreaBtn.querySelector('.search-progress-bar') as HTMLElement;
      const btnSpan = searchAreaBtn.querySelector('span');
      const limit = 300;
      const maxToLoad = Math.min(totalCount, 10000);
      let loaded = 0;

      vectorLayer.clearLayers();
      state.vectorMarkers = [];
      hideLegendFab();
      searchAreaBtn.classList.add('loading');

      while (loaded < maxToLoad) {
        if (btnSpan) btnSpan.textContent = `Loading ${loaded} / ${maxToLoad}...`;
        if (progressBar) progressBar.style.width = `${(loaded / maxToLoad) * 100}%`;

        const pageUrl = `${url}&limit=${limit}&offset=${loaded}`;
        const res = await fetch(pageUrl);
        const data = await res.json();
        
        processOccurrences(data.results);
        loaded += data.results.length;

        if (data.endOfRecords || data.results.length === 0) break;
      }

      if (btnSpan) btnSpan.textContent = 'Search this area';
      if (progressBar) progressBar.style.width = '0%';
      searchAreaBtn.classList.remove('loading');

      if (clearPointsBtn) clearPointsBtn.classList.remove('hidden');
      if (searchAreaBtn) searchAreaBtn.classList.add('hidden');

      // Pre-warm vernacular name cache (fire-and-forget)
      const speciesKeys = [...new Set(
        state.vectorMarkers
          .map(m => m.taxonomy.speciesKey)
          .filter((k): k is number => typeof k === 'number' && k > 0)
      )];
      Promise.all(speciesKeys.map(k => resolveVernacularNames(k)));

      updateTaxonomyLegend();
    } catch (e) {
      console.error(e);
      showErrorToast('Area search failed');
      if (searchAreaBtn) searchAreaBtn.classList.remove('loading');
    }
  });

  clearPointsBtn?.addEventListener('click', () => {
    vectorLayer.clearLayers();
    state.vectorMarkers = [];
    hideLegendFab();
    clearPointsBtn.classList.add('hidden');
    if (searchAreaBtn) searchAreaBtn.classList.remove('hidden');
  });

  map.on('zoomend', () => {
    const isHighZoom = map.getZoom() >= 12;
    vectorControls?.classList.toggle('hidden', !isHighZoom);
  });
}
