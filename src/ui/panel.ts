import type L from 'leaflet';
import { AppState } from '../state';
import type { RenderMode } from '../state';
import { getIconSvg } from './icons';
import { 
  type TaxonHistory 
} from '../map/gbif';
import { showErrorToast } from './toasts';
import { describeFetchFailure, getLastHealthSnapshot } from '../health/external-status';

/**
 * GBIF Shape Registry
 * Maps each rendering shape to its supported palette group ID and fallback palette.
 */
const SHAPE_REGISTRY: Record<string, { group: string, defaultPalette: string }> = {
  hex: { group: 'group-standard', defaultPalette: 'classic' },
  square: { group: 'group-standard', defaultPalette: 'classic' },
  point: { group: 'group-standard', defaultPalette: 'classic' },
  heatmap: { group: 'group-heatmaps', defaultPalette: 'purpleHeat' },
  marker: { group: 'group-markers', defaultPalette: 'blue' },
  circles: { group: '', defaultPalette: 'scaled.circles' } // special, uses no specific palettes
};


export function initGbifPanel(_map: L.Map, state: AppState, updateGbifLayer: () => void) {
  const gbifPanel = document.getElementById('gbif-panel');
  const gbifPanelClose = document.getElementById('gbif-panel-close');
  const panelOverlay = document.getElementById('panel-overlay');
  const gbifFab = document.getElementById('gbif-fab');
  const gbifToggle = document.getElementById('gbif-toggle') as HTMLInputElement;
  const gbifMenuToggle = document.getElementById('gbif-menu-toggle') as HTMLInputElement;
  const gbifSearch = document.getElementById('gbif-search') as HTMLInputElement;
  const gbifResults = document.getElementById('gbif-results') as HTMLElement;
  const historyShelf = document.getElementById('gbif-history');
  const gbifYearInput = document.getElementById('gbif-year') as HTMLInputElement;
  const yearValueDisplay = document.getElementById('year-value') as HTMLElement;
  const opacityInput = document.getElementById('gbif-opacity') as HTMLInputElement;
  const densityInput = document.getElementById('gbif-density') as HTMLInputElement;
  const densityValueDisplay = document.getElementById('density-value');
  const noBordersToggle = document.getElementById('gbif-noborders') as HTMLInputElement;
  const gridControlsContainer = document.getElementById('grid-controls') as HTMLElement;

  let currentHistory: TaxonHistory[] = JSON.parse(localStorage.getItem('gbif_history') || '[]');
  let searchGeneration = 0;

  const RANK_ORDER: Record<string, number> = {
    KINGDOM: 0, PHYLUM: 1, CLASS: 2, ORDER: 3, FAMILY: 4,
    GENUS: 5, SPECIES: 6, SUBSPECIES: 7, VARIETY: 8, FORM: 9
  };

  const openGbifPanel = () => {
    document.getElementById('base-layer-popover')?.classList.remove('open');
    document.getElementById('lang-panel')?.classList.remove('open');
    document.getElementById('lang-fab')?.classList.remove('panel-open');
    const langPanelEl = document.getElementById('lang-panel') as HTMLElement | null;
    if (langPanelEl) langPanelEl.style.transform = '';

    gbifPanel?.classList.add('open');
    gbifFab?.classList.add('panel-open');
    panelOverlay?.classList.add('active');
    document.body.classList.add('panel-active');
  };

  const closeGbifPanel = () => {
    gbifPanel?.classList.remove('open');
    gbifFab?.classList.remove('panel-open');
    panelOverlay?.classList.remove('active');
    if (gbifPanel) gbifPanel.style.transform = '';
    if (
      !document.getElementById('vector-legend')?.classList.contains('open') &&
      !document.getElementById('lang-panel')?.classList.contains('open')
    ) {
      document.body.classList.remove('panel-active');
    }
  };

  gbifFab?.addEventListener('click', (e) => {
    e.stopPropagation();
    if (gbifPanel?.classList.contains('open')) closeGbifPanel();
    else openGbifPanel();
  });

  gbifPanelClose?.addEventListener('click', closeGbifPanel);

  const updateGbifFabState = () => {
    gbifFab?.classList.toggle('active', state.gbifEnabled);
  };

  const handleGbifToggle = (enabled: boolean) => {
    state.gbifEnabled = enabled;
    if (gbifToggle) gbifToggle.checked = enabled;
    if (gbifMenuToggle) gbifMenuToggle.checked = enabled;
    updateGbifFabState();
    updateGbifLayer();
  };

  gbifToggle?.addEventListener('change', () => handleGbifToggle(gbifToggle.checked));
  gbifMenuToggle?.addEventListener('change', () => handleGbifToggle(gbifMenuToggle.checked));

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

  const renderHistory = () => {
    if (!historyShelf) return;
    historyShelf.innerHTML = '';
    const globalChip = document.createElement('div');
    globalChip.className = `history-chip global ${state.currentTaxonKey === null ? 'active' : ''}`;
    globalChip.textContent = 'Global Biodiversity';
    globalChip.addEventListener('click', () => {
      state.currentTaxonKey = null;
      gbifSearch.value = '';
      updateFilterLabel(null);
      renderHistory();
      updateGbifLayer();
    });
    historyShelf.appendChild(globalChip);

    currentHistory.forEach(h => {
      const chip = document.createElement('div');
      chip.className = `history-chip ${state.currentTaxonKey === h.key ? 'active' : ''}`;
      const displayName = (h.names && h.names.length > 0) ? h.names[0].name : h.name;
      chip.textContent = displayName;
      chip.addEventListener('click', () => {
        state.currentTaxonKey = h.key;
        gbifSearch.value = displayName;
        updateFilterLabel(displayName);
        renderHistory();
        updateGbifLayer();
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

  const fetchGbif = async (query: string) => {
    const gen = ++searchGeneration;
    try {
      const suggestUrl = `https://api.gbif.org/v1/species/suggest?q=${encodeURIComponent(query)}&datasetKey=d7dddbf4-2cf0-4f39-9b2a-bb099caae36c&limit=8`;
      const res = await fetch(suggestUrl);
      if (gen !== searchGeneration) return;
      if (!res.ok) {
        console.error('GBIF species suggest failed', { suggestUrl, status: res.status });
        showErrorToast(describeFetchFailure('gbif', null, res, getLastHealthSnapshot()));
        return;
      }
      let suggestions: any[];
      try {
        suggestions = await res.json();
      } catch (parseErr) {
        console.error('GBIF species suggest: invalid JSON', { suggestUrl, error: parseErr });
        showErrorToast(describeFetchFailure('gbif', parseErr, res, getLastHealthSnapshot()));
        return;
      }
      if (gen !== searchGeneration) return;
      if (!Array.isArray(suggestions)) {
        console.error('GBIF species suggest: expected array', { suggestUrl, body: suggestions });
        showErrorToast('Species search returned an unexpected response.');
        return;
      }

      gbifResults.innerHTML = '';
      if (suggestions.length === 0) { gbifResults.style.display = 'none'; return; }
      gbifResults.style.display = 'block';

      suggestions.sort((a: any, b: any) => (RANK_ORDER[a.rank] ?? 10) - (RANK_ORDER[b.rank] ?? 10))
        .forEach(async (s: any) => {
          const li = document.createElement('li');
          const rankHtml = s.rank ? `<span class="scientific-rank">${s.rank}</span>` : '';
          
          // Determine best primary name for this result
          let nameToUse = s.vernacularName || s.canonicalName || s.scientificName;
          if (state.userLanguages[0] === 'la') {
            nameToUse = s.scientificName || s.canonicalName;
          }

          li.innerHTML = `
            <div class="search-avatar">${getIconSvg('leaf')}</div>
            <div class="search-title-row">
              <span class="common">${nameToUse}</span>
              ${rankHtml}
              <span class="scientific">${s.scientificName}</span>
            </div>
            <div class="vernacular-names"></div>
            <div class="obs-count">
              <span class="obs-loader">${getIconSvg('loader-2')}</span>
              <span class="obs-count-text">...</span>
            </div>
          `;

          li.addEventListener('click', () => {
            state.currentTaxonKey = s.key;
            gbifSearch.value = nameToUse;
            gbifResults.style.display = 'none';
            updateFilterLabel(nameToUse);
            saveToHistory({ key: s.key, name: nameToUse });
            updateGbifLayer();
          });
          gbifResults.appendChild(li);
          
          try {
            const countUrl = `https://api.gbif.org/v1/occurrence/count?taxonKey=${s.key}`;
            const cRes = await fetch(countUrl);
            if (gen !== searchGeneration) return;
            const countText = li.querySelector('.obs-count-text');
            const loader = li.querySelector('.obs-loader');
            if (!cRes.ok) {
              console.error('GBIF occurrence count failed', { countUrl, status: cRes.status, taxonKey: s.key });
              if (countText && loader) {
                loader.innerHTML = getIconSvg('alert-circle');
                loader.classList.remove('found', 'not-found');
                countText.textContent = '—';
              }
              return;
            }
            const countPayload = await cRes.json();
            const count = typeof countPayload === 'number' ? countPayload : countPayload?.count;
            if (typeof count !== 'number' || !Number.isFinite(count)) {
              console.error('GBIF occurrence count: unexpected body', { countUrl, taxonKey: s.key, countPayload });
              if (countText && loader) {
                loader.innerHTML = getIconSvg('alert-circle');
                loader.classList.remove('found', 'not-found');
                countText.textContent = '—';
              }
              return;
            }
            if (gen !== searchGeneration) return;
            if (countText && loader) {
              loader.innerHTML = count > 0 ? getIconSvg('check-circle') : getIconSvg('x-circle');
              loader.classList.toggle('found', count > 0);
              loader.classList.toggle('not-found', count === 0);
              countText.textContent = count > 1000 ? (count/1000).toFixed(1) + 'k records' : count + ' records';
            }
          } catch (e) {
            console.error('GBIF occurrence count error', { taxonKey: s.key, error: e });
            const countText = li.querySelector('.obs-count-text');
            const loader = li.querySelector('.obs-loader');
            if (countText && loader) {
              loader.innerHTML = getIconSvg('alert-circle');
              loader.classList.remove('found', 'not-found');
              countText.textContent = '—';
            }
          }
        });
    } catch (e) {
      console.error('Species search error', { error: e });
      showErrorToast(
        e instanceof Error
          ? describeFetchFailure('gbif', e, null, getLastHealthSnapshot())
          : describeFetchFailure('gbif', new Error(String(e)), null, getLastHealthSnapshot()),
      );
    }
  };

  gbifSearch.addEventListener('input', () => {
    const query = gbifSearch.value.trim();
    if (query.length < 2) { gbifResults.style.display = 'none'; return; }
    setTimeout(() => fetchGbif(query), 300);
  });

  const pickers = {
    mode: document.querySelectorAll('#gbif-mode-picker .mode-btn'),
    palette: document.querySelectorAll('.palette-btn')
  };

  /**
   * Refined UI compatibility logic (Shape-First).
   * Displays the correct palette group based on the selected shaping mode.
   */
  const updateStyleCompatibility = () => {
    const shapeConfig = SHAPE_REGISTRY[state.currentRenderMode] || SHAPE_REGISTRY['point'];
    const activeGroupId = shapeConfig.group;
    
    // Toggle visibility of palette groups
    document.querySelectorAll('.style-group').forEach(group => {
      const g = group as HTMLElement;
      g.style.display = g.id === activeGroupId ? '' : 'none';
      
      // If the current palette is not in the newly visible group, we need to switch it.
      // But we only care if the group actually changed and the current palette is hidden.
      // Easiest is to check if the currently selected palette button is visible.
    });

    // Check if the current palette button is visible in the new group layout
    const activePaletteBtn = document.querySelector(`.palette-btn[data-palette="${state.currentPalette}"]`) as HTMLElement;
    const isVisible = activePaletteBtn && activePaletteBtn.closest('.style-group')?.id === activeGroupId;

    if (!isVisible && activeGroupId) {
      // Auto-switch to the default palette for this shape
      state.currentPalette = shapeConfig.defaultPalette;
      pickers.palette.forEach(btn => {
        btn.classList.toggle('active', (btn as HTMLElement).dataset.palette === state.currentPalette);
      });
    }

    // Toggle Contextual Grid options
    const isGrid = state.currentRenderMode === 'hex' || state.currentRenderMode === 'square';
    if (gridControlsContainer) gridControlsContainer.style.display = isGrid ? 'flex' : 'none';
  };


  pickers.mode.forEach(btn => btn.addEventListener('click', () => {
    const mode = (btn as HTMLElement).dataset.mode as RenderMode;
    if (mode && !btn.classList.contains('unsupported')) {
      state.currentRenderMode = mode;
      pickers.mode.forEach(b => b.classList.toggle('active', b === btn));
      updateStyleCompatibility();
      updateGbifLayer();
    }
  }));

  pickers.palette.forEach(btn => btn.addEventListener('click', () => {
    const palette = (btn as HTMLElement).dataset.palette;
    if (palette) {
      state.currentPalette = palette;
      pickers.palette.forEach(b => b.classList.toggle('active', b === btn));
      updateStyleCompatibility();
      updateGbifLayer();
    }
  }));

  noBordersToggle?.addEventListener('change', () => {
    state.currentNoBorders = noBordersToggle.checked;
    updateGbifLayer();
  });


  gbifYearInput.addEventListener('input', () => {
    const val = parseInt(gbifYearInput.value);
    state.currentYear = val >= parseInt(gbifYearInput.max) ? 'ALL' : val;
    yearValueDisplay.textContent = state.currentYear === 'ALL' ? 'All Years' : `1900 - ${state.currentYear}`;
  });
  gbifYearInput.addEventListener('change', updateGbifLayer);

  opacityInput.addEventListener('input', () => {
    state.currentOpacity = parseFloat(opacityInput.value);
    if (state.gbifLayer) state.gbifLayer.setOpacity(state.currentOpacity);
  });

  densityInput.addEventListener('input', () => {
    state.currentDensity = parseInt(densityInput.value);
    if (densityValueDisplay) densityValueDisplay.textContent = `${state.currentDensity} Bins`;
  });
  densityInput.addEventListener('change', updateGbifLayer);

  // Initial Sync
  noBordersToggle.checked = state.currentNoBorders;
  updateStyleCompatibility();
  renderHistory();

  return { openGbifPanel, closeGbifPanel };
}
