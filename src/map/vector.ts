import L from 'leaflet';
import { AppState } from '../state';
import { getTaxaInfo } from './markers';
import {
  gbifThumb,
  resolveWikidataInfo,
  resolveVernacularNames,
  resolveDatasetName,
  negotiateTaxonNames,
  type TaxonNameRow,
} from './gbif';
import { resolveBatchWikidataInfo } from './wikidata-sparql';
import { scheduleVectorPopupFit } from './core';
import { getIconSvg } from '../ui/icons';
import { showErrorToast } from '../ui/toasts';
import { shareOrCopyUrl } from '../ui/share';
import { describeFetchFailure, getLastHealthSnapshot } from '../health/external-status';
import {
  humanUncertaintyPopupHtml,
  MAX_UNCERTAINTY_DISPLAY_M,
  resolveLocationUncertainty,
  shortUncertaintyBadgeText,
  uncertaintyBadgeTitle,
  precisionTierFromResolved,
  type ResolvedLocationUncertainty,
} from './occurrence-precision';

// Using TaxonNameRow from gbif.ts instead of local PreferredNameRow

function getOccTaxonKey(occ: { taxonKey?: number; speciesKey?: number; usageKey?: number }): number {
  return occ.taxonKey || occ.speciesKey || occ.usageKey || 0;
}

// Removed buildPreferredNameRows, mergeWikiIntoVernaculars, and bestAndSubtitles 
// in favor of centralized negotiateTaxonNames in gbif.ts

/** Hover tooltip: primary + one row per other language in settings (same rules as popup). */
function buildOccurrenceHoverTooltipEl(best: TaxonNameRow, subtitles: TaxonNameRow[]): HTMLElement {
  const root = document.createElement('div');
  root.className = 'occurrence-hover-tooltip';

  const title = document.createElement('div');
  title.className = 'occ-hover-title';
  title.textContent = best.name;
  if (best.isScientific) title.style.fontStyle = 'italic';
  root.appendChild(title);

  for (const n of subtitles) {
    const row = document.createElement('div');
    row.className = n.isScientific ? 'occ-hover-sub occ-hover-sub--sci' : 'occ-hover-sub';
    const tag = document.createElement('span');
    tag.className = 'occ-hover-lang';
    tag.textContent = n.lang === 'la' ? 'LA' : n.lang.toUpperCase();
    row.appendChild(tag);
    row.appendChild(document.createTextNode(' '));
    const nm = document.createElement('span');
    nm.className = 'occ-hover-name';
    nm.textContent = n.name;
    row.appendChild(nm);
    root.appendChild(row);
  }

  return root;
}

export function initVectorSearch(
  map: L.Map,
  state: AppState,
  updateTaxonomyLegend: () => void,
  updateGbifLayer: () => void,
) {
  const searchAreaBtn = document.getElementById('search-area-btn') as HTMLButtonElement | null;
  const clearPointsBtn = document.getElementById('clear-points-btn');
  const vectorControls = document.getElementById('vector-search-controls');

  const searchBtnLabel = () => searchAreaBtn?.querySelector<HTMLElement>('.search-area-btn-label');
  const searchBtnBar = () => searchAreaBtn?.querySelector<HTMLElement>('.search-progress-bar');
  const searchBtnFill = () => searchAreaBtn?.querySelector<HTMLElement>('.search-progress-fill');

  const resetSearchAreaButtonUi = () => {
    if (!searchAreaBtn) return;
    searchAreaBtn.disabled = false;
    searchAreaBtn.removeAttribute('aria-busy');
    searchAreaBtn.classList.remove('search-busy', 'loading');
    const bar = searchBtnBar();
    const fill = searchBtnFill();
    const label = searchBtnLabel();
    if (bar) {
      bar.style.width = '0%';
      bar.classList.remove('indeterminate');
    }
    if (fill) fill.style.width = '0%';
    if (label) label.textContent = 'Search this area';
  };

  const setSearchAreaButtonCounting = () => {
    if (!searchAreaBtn) return;
    searchAreaBtn.disabled = true;
    searchAreaBtn.setAttribute('aria-busy', 'true');
    searchAreaBtn.classList.add('search-busy');
    searchAreaBtn.classList.remove('loading');
    const bar = searchBtnBar();
    const fill = searchBtnFill();
    const label = searchBtnLabel();
    if (bar) bar.classList.add('indeterminate');
    if (fill) fill.style.width = '0%';
    if (label) label.textContent = 'Checking area…';
  };

  const setSearchAreaButtonAwaitingConfirm = (total: number) => {
    const bar = searchBtnBar();
    const fill = searchBtnFill();
    const label = searchBtnLabel();
    if (bar) {
      bar.classList.remove('indeterminate');
      bar.style.width = '0%';
    }
    if (fill) fill.style.width = '35%';
    if (label) label.textContent = `${total.toLocaleString()} found — confirm in dialog`;
  };

  const beginSearchAreaLoadPhase = (maxToLoad: number) => {
    if (!searchAreaBtn) return;
    searchAreaBtn.classList.remove('search-busy');
    searchAreaBtn.classList.add('loading');
    const bar = searchBtnBar();
    const fill = searchBtnFill();
    const label = searchBtnLabel();
    if (bar) {
      bar.classList.remove('indeterminate');
      bar.style.width = '0%';
    }
    if (fill) fill.style.width = '0%';
    if (label) label.textContent = `Loading 0 / ${maxToLoad.toLocaleString()}…`;
  };

  const updateSearchAreaLoadProgress = (loaded: number, maxToLoad: number) => {
    const pct = maxToLoad > 0 ? Math.min(100, (loaded / maxToLoad) * 100) : 0;
    const bar = searchBtnBar();
    const fill = searchBtnFill();
    const label = searchBtnLabel();
    if (bar) bar.style.width = `${pct}%`;
    if (fill) fill.style.width = `${pct}%`;
    if (label) label.textContent = `Loading ${loaded.toLocaleString()} / ${maxToLoad.toLocaleString()}…`;
  };

  const TAXA_COLORS: Record<string, string> = {
    aves: '#3b82f6', mammalia: '#f97316', plantae: '#22c55e', insecta: '#a855f7',
    fungi: '#84cc16', reptilia: '#14b8a6', amphibia: '#06b6d4', actinopterygii: '#2563eb',
    arachnida: '#eab308', gastropoda: '#ec4899', malacostraca: '#f43f5e',
    mollusca: '#d946ef', default: '#64748b'
  };

  const createClusterIcon = (cluster: any) => {
    const children = cluster.getAllChildMarkers();
    const counts: Record<string, number> = {};
    let allTight = true;
    children.forEach((m: any) => {
      const cls = (m.options as any).taxaCssClass || 'default';
      counts[cls] = (counts[cls] || 0) + 1;
      const tier = (m.options as any).occurrencePrecisionTier;
      if (tier !== 'tight') allTight = false;
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

    const mixHint = allTight
      ? ''
      : `<text x="${r}" y="${size - 5}" text-anchor="middle" fill="rgba(248,250,252,0.65)" font-size="11" font-weight="800" font-style="italic">~</text>`;
    const svg = `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" xmlns="http://www.w3.org/2000/svg">
      ${segments}<circle cx="${r}" cy="${r}" r="${inner}" fill="rgba(15,23,42,0.85)"/>
      <text x="${r}" y="${r}" text-anchor="middle" dy=".35em" fill="#fff" font-size="${size < 50 ? 12 : 14}" font-weight="700">${total}</text>
      ${mixHint}
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

  let vectorSearchBoundsRect: L.Rectangle | null = null;

  const removeVectorSearchBoundsRect = () => {
    if (vectorSearchBoundsRect) {
      map.removeLayer(vectorSearchBoundsRect);
      vectorSearchBoundsRect = null;
    }
  };

  const restoreGbifAfterVectorSearch = () => {
    state.suppressGbifForVectorOccurrences = false;
    updateGbifLayer();
  };

  const MAX_UNCERTAINTY_OVERLAY_M = MAX_UNCERTAINTY_DISPLAY_M;
  let activeUncertaintyOverlays: L.Layer[] = [];
  let activeUncertaintyMarker: L.Marker | null = null;

  const removeUncertaintyOverlay = () => {
    for (const layer of activeUncertaintyOverlays) {
      map.removeLayer(layer);
    }
    activeUncertaintyOverlays = [];
    activeUncertaintyMarker = null;
  };

  const showUncertaintyOverlayForMarker = (marker: L.Marker, res: ResolvedLocationUncertainty) => {
    removeUncertaintyOverlay();
    if (res.meters === null || !Number.isFinite(res.meters) || res.meters <= 0) return;

    activeUncertaintyMarker = marker;
    const latlng = marker.getLatLng();

    if (res.source === 'gbif_uncertainty_meters') {
      const radiusM = Math.min(Math.max(res.meters, 1), MAX_UNCERTAINTY_OVERLAY_M);
      const circle = L.circle(latlng, {
        radius: radiusM,
        color: 'rgba(14, 165, 233, 0.92)',
        weight: 2,
        fillColor: '#0ea5e9',
        fillOpacity: 0.1,
        dashArray: '8 10',
        interactive: false,
        className: 'occurrence-uncertainty-overlay',
      }).addTo(map);
      circle.bringToBack();
      activeUncertaintyOverlays.push(circle);
    } else if (res.detail.stepLatDeg && res.detail.stepLngDeg) {
      // "Rounded" interpretation: pin is at the center of the grid cell
      const halfLat = res.detail.stepLatDeg / 2;
      const halfLng = res.detail.stepLngDeg / 2;
      const centeredBounds = L.latLngBounds(
        [latlng.lat - halfLat, latlng.lng - halfLng],
        [latlng.lat + halfLat, latlng.lng + halfLng]
      );
      const centeredRect = L.rectangle(centeredBounds, {
        color: 'rgba(14, 165, 233, 0.92)',
        weight: 2,
        fillColor: '#0ea5e9',
        fillOpacity: 0.08,
        dashArray: '8 10',
        interactive: false,
        className: 'occurrence-uncertainty-overlay occurrence-uncertainty-rounded',
      }).addTo(map);
      centeredRect.bringToBack();
      activeUncertaintyOverlays.push(centeredRect);

      // "Truncated" interpretation: pin is at the SW corner of the grid cell
      const cornerBounds = L.latLngBounds(
        [latlng.lat, latlng.lng],
        [latlng.lat + res.detail.stepLatDeg, latlng.lng + res.detail.stepLngDeg]
      );
      const cornerRect = L.rectangle(cornerBounds, {
        color: 'rgba(251, 191, 36, 0.8)',
        weight: 2,
        fillColor: '#fbbf24',
        fillOpacity: 0.06,
        dashArray: '4 6',
        interactive: false,
        className: 'occurrence-uncertainty-overlay occurrence-uncertainty-truncated',
      }).addTo(map);
      cornerRect.bringToBack();
      activeUncertaintyOverlays.push(cornerRect);
    } else {
      // Fallback to circle
      const radiusM = Math.min(Math.max(res.meters, 1), MAX_UNCERTAINTY_OVERLAY_M);
      const circle = L.circle(latlng, {
        radius: radiusM,
        color: 'rgba(14, 165, 233, 0.92)',
        weight: 2,
        fillColor: '#0ea5e9',
        fillOpacity: 0.1,
        dashArray: '8 10',
        interactive: false,
        className: 'occurrence-uncertainty-overlay',
      }).addTo(map);
      circle.bringToBack();
      activeUncertaintyOverlays.push(circle);
    }
  };

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
      const uncertaintyRes = resolveLocationUncertainty(occ);
      const occurrencePrecisionTier = precisionTierFromResolved(uncertaintyRes);
      const precisionBadge = {
        text: shortUncertaintyBadgeText(uncertaintyRes),
        title: uncertaintyBadgeTitle(uncertaintyRes),
        tier: occurrencePrecisionTier,
        estimated: uncertaintyRes.isEstimate,
      };
      const taxaInfo = getTaxaInfo(occ.class || occ.kingdom, hasImage, precisionBadge);
      const marker = L.marker([occ.decimalLatitude, occ.decimalLongitude], {
        icon: taxaInfo.icon,
        taxaCssClass: taxaInfo.cssClass,
        occurrencePrecisionTier,
        occurrenceUncertaintyResolved: uncertaintyRes,
      } as any).addTo(vectorLayer);
      
      const popup = L.popup({ maxWidth: 260, className: 'vector-popup' })
        .setContent(`<div class="vector-popup-loading">${getIconSvg('loader-2')}</div>`);
      marker.bindPopup(popup);

      const scientificName = occ.scientificName || 'Unknown';
      const initialBestSubs = negotiateTaxonNames(scientificName, state.userLanguages, [], null);
      marker.bindTooltip(buildOccurrenceHoverTooltipEl(initialBestSubs.best, initialBestSubs.subtitles), {
        direction: 'top',
        sticky: true,
        opacity: 1,
        interactive: false,
        className: 'occurrence-name-tooltip-wrap',
      });

      let hoverTooltipDataPromise: Promise<{ best: TaxonNameRow; subtitles: TaxonNameRow[] }> | null = null;
      const ensureHoverTooltipData = (): Promise<{ best: TaxonNameRow; subtitles: TaxonNameRow[] }> => {
        if (!hoverTooltipDataPromise) {
          hoverTooltipDataPromise = (async () => {
            const taxonKey = getOccTaxonKey(occ);
            const cachedVernaculars = await resolveVernacularNames(taxonKey);
            const wiki = await resolveWikidataInfo(taxonKey, state.userLanguages);
            return negotiateTaxonNames(scientificName, state.userLanguages, cachedVernaculars, wiki);
          })().catch((error) => {
            console.error('Occurrence hover tooltip: failed to resolve names', {
              taxonKey: getOccTaxonKey(occ),
              error,
            });
            return initialBestSubs;
          });
        }
        return hoverTooltipDataPromise;
      };

      let precisionRingHover = false;
      marker.on('mouseover', () => {
        precisionRingHover = true;
        showUncertaintyOverlayForMarker(marker, uncertaintyRes);
        if (marker.isPopupOpen()) {
          marker.closeTooltip();
          return;
        }
        void ensureHoverTooltipData().then((data) => {
          if (marker.isPopupOpen()) return;
          marker.setTooltipContent(buildOccurrenceHoverTooltipEl(data.best, data.subtitles));
        });
      });
      marker.on('mouseout', () => {
        precisionRingHover = false;
        if (!marker.isPopupOpen()) removeUncertaintyOverlay();
      });
      marker.on('popupclose', () => {
        if (precisionRingHover) showUncertaintyOverlayForMarker(marker, uncertaintyRes);
        else removeUncertaintyOverlay();
      });

      marker.on('move', () => {
        if (activeUncertaintyOverlays.length > 0 && activeUncertaintyMarker === marker) {
          const ll = marker.getLatLng();
          for (const layer of activeUncertaintyOverlays) {
            if (layer instanceof L.Circle) {
              layer.setLatLng(ll);
            } else if (layer instanceof L.Rectangle) {
              const el = (layer as any).getElement?.();
              const isTruncated = el?.classList?.contains('occurrence-uncertainty-truncated');
              if (isTruncated) {
                layer.setBounds(L.latLngBounds(
                  [ll.lat, ll.lng],
                  [ll.lat + uncertaintyRes.detail.stepLatDeg!, ll.lng + uncertaintyRes.detail.stepLngDeg!]
                ));
              } else {
                const halfLat = uncertaintyRes.detail.stepLatDeg! / 2;
                const halfLng = uncertaintyRes.detail.stepLngDeg! / 2;
                layer.setBounds(L.latLngBounds(
                  [ll.lat - halfLat, ll.lng - halfLng],
                  [ll.lat + halfLat, ll.lng + halfLng]
                ));
              }
            }
          }
        }
      });

      marker.on('popupopen', async () => {
        marker.closeTooltip();
        showUncertaintyOverlayForMarker(marker, uncertaintyRes);
        scheduleVectorPopupFit(map, marker);
        const taxonKey = getOccTaxonKey(occ);
        const cachedVernaculars = await resolveVernacularNames(taxonKey);
        const wiki = await resolveWikidataInfo(taxonKey, state.userLanguages);
        const datasetName = await resolveDatasetName(occ.datasetKey);
        const gbifImg = media ? gbifThumb(occ.key, media) : null;
        let currentImg = gbifImg || (wiki ? wiki.imgUrl : null);

        const { best, subtitles: subtitleNames } = negotiateTaxonNames(scientificName, state.userLanguages, cachedVernaculars, wiki);

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
            <div class="popup-detail popup-detail-precision">${getIconSvg('map-pin')}<span>${humanUncertaintyPopupHtml(uncertaintyRes)}</span></div>
            <div class="popup-detail">${getIconSvg('database')}<span>${datasetName || 'GBIF.org'}</span></div>
          </div>
          <div class="popup-links">
            <button type="button" class="popup-share-btn" title="Share or copy link" aria-label="Share this observation">${getIconSvg('share-2')} Share</button>
            <a href="https://www.gbif.org/occurrence/${occ.key}" target="_blank" rel="noopener noreferrer">${getIconSvg('external-link')} GBIF</a>
            ${wiki ? `<a href="${wiki.wikiUrl}" target="_blank" rel="noopener noreferrer" class="wiki-link">${getIconSvg('book-open')} Wiki</a>` : ''}
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

        const gbifOccUrl = `https://www.gbif.org/occurrence/${occ.key}`;
        content.querySelector('.popup-share-btn')?.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          void shareOrCopyUrl({
            title: best.name,
            text: `GBIF observation: ${occ.scientificName}`,
            url: gbifOccUrl
          });
        });

        popup.setContent(content);
        scheduleVectorPopupFit(map, marker);
      });
      
      state.vectorMarkers.push({
        occurrenceKey: occ.key,
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
    setSearchAreaButtonCounting();

    const bounds = map.getBounds();
    const south = Math.max(-90, bounds.getSouth()), north = Math.min(90, bounds.getNorth());
    const west = Math.max(-180, bounds.getWest()), east = Math.min(180, bounds.getEast());

    const baseParams = `decimalLatitude=${south},${north}&decimalLongitude=${west},${east}&occurrenceStatus=PRESENT`;
    let url = `https://api.gbif.org/v1/occurrence/search?${baseParams}`;
    if (state.currentYear !== 'ALL') url += `&year=1900,${state.currentYear}`;
    if (state.currentTaxonKey) url += `&taxonKey=${state.currentTaxonKey}`;

    try {
      // 1. Initial pre-fetch to get count
      const countUrl = `${url}&limit=0`;
      const countRes = await fetch(countUrl);
      if (!countRes.ok) {
        console.error('GBIF occurrence search (count) failed', { countUrl, status: countRes.status });
        showErrorToast(describeFetchFailure('gbif', null, countRes, getLastHealthSnapshot()));
        resetSearchAreaButtonUi();
        return;
      }
      let countData: { count?: number };
      try {
        countData = await countRes.json();
      } catch (parseErr) {
        console.error('GBIF occurrence search: invalid count JSON', { countUrl, error: parseErr });
        showErrorToast(describeFetchFailure('gbif', parseErr, countRes, getLastHealthSnapshot()));
        resetSearchAreaButtonUi();
        return;
      }
      const totalCount = countData.count;
      if (typeof totalCount !== 'number' || !Number.isFinite(totalCount)) {
        console.error('GBIF occurrence search: missing or invalid count', { countUrl, countData });
        showErrorToast('Could not read occurrence count from GBIF.');
        resetSearchAreaButtonUi();
        return;
      }

      if (totalCount === 0) {
        showErrorToast('No occurrences found in this area.');
        resetSearchAreaButtonUi();
        return;
      }

      // 2. Threshold check & Confirmation
      if (totalCount > 300) {
        setSearchAreaButtonAwaitingConfirm(totalCount);
        const confirmed = await showConfirm(
          'Load Large Dataset?',
          `${totalCount.toLocaleString()} occurrences found. Loading all records will take some time. Tip: zoom in or use filters for faster results.`
        );
        if (!confirmed) {
          resetSearchAreaButtonUi();
          return;
        }
      }

      const limit = 300;
      const maxToLoad = Math.min(totalCount, 10000);
      let loaded = 0;

      beginSearchAreaLoadPhase(maxToLoad);

      const searchBounds = L.latLngBounds(L.latLng(south, west), L.latLng(north, east));
      removeVectorSearchBoundsRect();
      vectorSearchBoundsRect = L.rectangle(searchBounds, {
        className: 'vector-search-bounds-rect',
        color: '#38bdf8',
        weight: 2,
        fill: true,
        fillColor: '#38bdf8',
        fillOpacity: 0.07,
        dashArray: '10 8',
        interactive: false,
      }).addTo(map);
      vectorSearchBoundsRect.bringToBack();

      state.suppressGbifForVectorOccurrences = true;
      updateGbifLayer();

      removeUncertaintyOverlay();
      vectorLayer.clearLayers();
      state.vectorMarkers = [];
      hideLegendFab();

      let pageError = false;
      while (loaded < maxToLoad && !pageError) {
        updateSearchAreaLoadProgress(loaded, maxToLoad);

        const pageUrl = `${url}&limit=${limit}&offset=${loaded}`;
        const res = await fetch(pageUrl);
        if (!res.ok) {
          console.error('GBIF occurrence search page failed', { pageUrl, status: res.status });
          showErrorToast(describeFetchFailure('gbif', null, res, getLastHealthSnapshot()));
          pageError = true;
          break;
        }
        let data: { results?: unknown; endOfRecords?: boolean };
        try {
          data = await res.json();
        } catch (parseErr) {
          console.error('GBIF occurrence search: invalid page JSON', { pageUrl, error: parseErr });
          showErrorToast(describeFetchFailure('gbif', parseErr, res, getLastHealthSnapshot()));
          pageError = true;
          break;
        }
        if (!Array.isArray(data.results)) {
          console.error('GBIF occurrence search: missing results array', { pageUrl, data });
          showErrorToast('GBIF returned an unexpected response while loading occurrences.');
          pageError = true;
          break;
        }

        processOccurrences(data.results);
        loaded += data.results.length;
        updateSearchAreaLoadProgress(loaded, maxToLoad);

        if (data.endOfRecords || data.results.length === 0) break;
      }

      resetSearchAreaButtonUi();

      if (pageError) {
        restoreGbifAfterVectorSearch();
        removeVectorSearchBoundsRect();
        return;
      }

      if (clearPointsBtn) clearPointsBtn.classList.remove('hidden');
      if (searchAreaBtn) searchAreaBtn.classList.add('hidden');

      // Pre-warm vernacular name and Wikidata cache
      const speciesKeys = [...new Set(
        state.vectorMarkers
          .map(m => m.taxonomy.speciesKey)
          .filter((k): k is number => typeof k === 'number' && k > 0)
      )];
      Promise.all([
        ...speciesKeys.map(k => resolveVernacularNames(k)),
        resolveBatchWikidataInfo(speciesKeys, state.userLanguages)
      ]);

      updateTaxonomyLegend();
    } catch (e) {
      console.error('Area search failed', { error: e });
      restoreGbifAfterVectorSearch();
      removeVectorSearchBoundsRect();
      resetSearchAreaButtonUi();
      showErrorToast(
        e instanceof Error
          ? describeFetchFailure('gbif', e, null, getLastHealthSnapshot())
          : describeFetchFailure('gbif', new Error(String(e)), null, getLastHealthSnapshot()),
      );
    }
  });

  clearPointsBtn?.addEventListener('click', () => {
    removeUncertaintyOverlay();
    restoreGbifAfterVectorSearch();
    removeVectorSearchBoundsRect();
    vectorLayer.clearLayers();
    state.vectorMarkers = [];
    hideLegendFab();
    clearPointsBtn.classList.add('hidden');
    if (searchAreaBtn) {
      searchAreaBtn.classList.remove('hidden');
      resetSearchAreaButtonUi();
    }
  });

  map.on('zoomend', () => {
    const isHighZoom = map.getZoom() >= 12;
    vectorControls?.classList.toggle('hidden', !isHighZoom);
  });
}
