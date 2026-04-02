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

  const hideLegendFab = () => {
    document.getElementById('legend-toggle')?.classList.add('hidden');
    document.getElementById('vector-legend')?.classList.remove('open');
  };

  searchAreaBtn?.addEventListener('click', async () => {
    if (!state.gbifEnabled) return;
    const bounds = map.getBounds();
    const south = Math.max(-90, bounds.getSouth()), north = Math.min(90, bounds.getNorth());
    const west = Math.max(-180, bounds.getWest()), east = Math.min(180, bounds.getEast());

    let url = `https://api.gbif.org/v1/occurrence/search?decimalLatitude=${south},${north}&decimalLongitude=${west},${east}&limit=300&occurrenceStatus=PRESENT`;
    if (state.currentYear !== 'ALL') url += `&year=1900,${state.currentYear}`;
    if (state.currentTaxonKey) url += `&taxonKey=${state.currentTaxonKey}`;

    try {
      vectorLayer.clearLayers();
      state.vectorMarkers = [];
      hideLegendFab();
      
      const res = await fetch(url);
      const data = await res.json();
      
      data.results.forEach((occ: any) => {
        if (!occ.decimalLatitude || !occ.decimalLongitude) return;
        const media = occ.media?.find((m: any) => m.type === 'StillImage')?.identifier || '';
        const hasImage = !!media;
        const taxaInfo = getTaxaInfo(occ.class || occ.kingdom, hasImage);
        const marker = L.marker([occ.decimalLatitude, occ.decimalLongitude], {
          icon: taxaInfo.icon,
          taxaCssClass: taxaInfo.cssClass
        } as any).addTo(vectorLayer);
        
        // Popup Initialization
        const popup = L.popup({ maxWidth: 260, className: 'vector-popup' })
          .setContent(`<div class="vector-popup-loading">${getIconSvg('loader-2')}</div>`);
        marker.bindPopup(popup);

        marker.on('popupopen', async () => {
          scheduleVectorPopupFit(map, marker);
          
          const vernaculars = await resolveVernacularNames(occ.taxonKey, state.userLanguages);
          const wiki = await resolveWikidataInfo(occ.taxonKey);
          const datasetName = await resolveDatasetName(occ.datasetKey);
          
          const gbifImg = media ? gbifThumb(occ.key, media) : null;
          let currentImg = gbifImg || (wiki ? wiki.imgUrl : null);
          const hasVn = vernaculars && vernaculars.length > 0;
          const vnHtml = hasVn ? `<div class="vernacular-popup">${vernaculars[0].name}</div>` : '';

          const content = document.createElement('div');
          content.className = 'vector-popup';
          content.innerHTML = `
            ${currentImg ? `<div class="popup-image-container">
                <img src="${currentImg}" alt="${occ.scientificName}">
                ${(gbifImg && wiki?.imgUrl) ? `<button class="switch-image-btn" title="Switch Image Source">${getIconSvg('refresh-cw')}</button>` : ''}
                <div class="image-source-badge">${currentImg === gbifImg ? 'GBIF' : 'WIKI'}</div>
              </div>` : ''}
            <div class="title">${occ.scientificName}</div>
            ${vnHtml}
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

      if (clearPointsBtn) clearPointsBtn.classList.remove('hidden');
      if (searchAreaBtn) searchAreaBtn.classList.add('hidden');
      updateTaxonomyLegend();
    } catch (e) {
      showErrorToast('Area search failed');
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
