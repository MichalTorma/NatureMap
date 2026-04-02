import type L from 'leaflet';
import { AppState } from '../state';
import type { RenderMode } from '../state';
import { getIconSvg } from './icons';
import { 
  type TaxonHistory 
} from '../map/gbif';
import { showErrorToast } from './toasts';

/**
 * GBIF Style Registry
 * Defines which rendering modes are compatible with each technical palette.
 */
const STYLE_REGISTRY: Record<string, RenderMode[]> = {
  // Standard Grids (Point + Poly)
  classic: ['point', 'hex', 'square'],
  green: ['point', 'hex', 'square'],
  purpleYellow: ['point', 'hex', 'square'],
  green2: ['point', 'hex', 'square'],
  iNaturalist: ['point', 'hex', 'square'],
  purpleWhite: ['point', 'hex', 'square'],
  red: ['point', 'hex', 'square'],
  // Heatmaps (Point only)
  purpleHeat: ['point'],
  blueHeat: ['point'],
  orangeHeat: ['point'],
  greenHeat: ['point'],
  fire: ['point'],
  glacier: ['point'],
  // Markers
  blue: ['marker'],
  orange: ['marker'],
  // Outline
  outline: ['hex', 'square']
};

export function initGbifPanel(_map: L.Map, state: AppState, updateGbifLayer: () => void) {
  const gbifPanel = document.getElementById('gbif-panel');
  const gbifPanelClose = document.getElementById('gbif-panel-close');
  const panelOverlay = document.getElementById('panel-overlay');
  const gbifFab = document.getElementById('gbif-fab');
  const gbifToggle = document.getElementById('gbif-toggle') as HTMLInputElement;
  const gbifSearch = document.getElementById('gbif-search') as HTMLInputElement;
  const gbifResults = document.getElementById('gbif-results') as HTMLElement;
  const historyShelf = document.getElementById('gbif-history');
  const gbifYearInput = document.getElementById('gbif-year') as HTMLInputElement;
  const yearValueDisplay = document.getElementById('year-value') as HTMLElement;
  const opacityInput = document.getElementById('gbif-opacity') as HTMLInputElement;
  const densityInput = document.getElementById('gbif-density') as HTMLInputElement;
  const densityValueDisplay = document.getElementById('density-value');
  const advancedToggle = document.getElementById('advanced-toggle');
  const advancedDrawer = document.getElementById('advanced-drawer');
  const noBordersToggle = document.getElementById('gbif-noborders') as HTMLInputElement;

  let currentHistory: TaxonHistory[] = JSON.parse(localStorage.getItem('gbif_history') || '[]');
  let searchGeneration = 0;

  const RANK_ORDER: Record<string, number> = {
    KINGDOM: 0, PHYLUM: 1, CLASS: 2, ORDER: 3, FAMILY: 4,
    GENUS: 5, SPECIES: 6, SUBSPECIES: 7, VARIETY: 8, FORM: 9
  };

  const openGbifPanel = () => {
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
    if (!document.getElementById('vector-legend')?.classList.contains('open')) {
      document.body.classList.remove('panel-active');
    }
  };

  gbifFab?.addEventListener('click', (e) => {
    e.stopPropagation();
    if (gbifPanel?.classList.contains('open')) closeGbifPanel();
    else openGbifPanel();
  });

  gbifPanelClose?.addEventListener('click', closeGbifPanel);
  panelOverlay?.addEventListener('click', closeGbifPanel);

  const updateGbifFabState = () => {
    gbifFab?.classList.toggle('active', state.gbifEnabled);
  };

  const handleGbifToggle = (enabled: boolean) => {
    state.gbifEnabled = enabled;
    if (gbifToggle) gbifToggle.checked = enabled;
    updateGbifFabState();
    updateGbifLayer();
  };

  gbifToggle?.addEventListener('change', () => handleGbifToggle(gbifToggle.checked));

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
      const res = await fetch(`https://api.gbif.org/v1/species/suggest?q=${encodeURIComponent(query)}&datasetKey=d7dddbf4-2cf0-4f39-9b2a-bb099caae36c&limit=8`);
      const suggestions = await res.json();
      if (gen !== searchGeneration) return;
      
      gbifResults.innerHTML = '';
      if (suggestions.length === 0) { gbifResults.style.display = 'none'; return; }
      gbifResults.style.display = 'block';

      suggestions.sort((a: any, b: any) => (RANK_ORDER[a.rank] ?? 10) - (RANK_ORDER[b.rank] ?? 10))
        .forEach(async (s: any) => {
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
            const count = await cRes.json();
            if (gen !== searchGeneration) return;
            const countText = li.querySelector('.obs-count-text');
            const loader = li.querySelector('.obs-loader');
            if (countText && loader) {
              loader.innerHTML = count > 0 ? getIconSvg('check-circle') : getIconSvg('x-circle');
              loader.classList.toggle('found', count > 0);
              loader.classList.toggle('not-found', count === 0);
              countText.textContent = count > 1000 ? (count/1000).toFixed(1) + 'k records' : count + ' records';
            }
          } catch (e) {}
        });
    } catch (e) {
      showErrorToast('Species search failed');
    }
  };

  gbifSearch.addEventListener('input', () => {
    const query = gbifSearch.value.trim();
    if (query.length < 2) { gbifResults.style.display = 'none'; return; }
    setTimeout(() => fetchGbif(query), 300);
  });

  const pickers = {
    mode: document.querySelectorAll('#gbif-mode-picker .mode-btn'),
    palette: document.querySelectorAll('.palette-btn'),
    scale: document.querySelectorAll('#gbif-scale-mode .toggle-btn')
  };

  /**
   * Refined UI compatibility logic.
   * Enables/Disables modes based on the palette capabilities.
   */
  const updateStyleCompatibility = () => {
    const compatibleModes = STYLE_REGISTRY[state.currentPalette] || ['point'];
    
    // Update Mode Buttons
    pickers.mode.forEach(btn => {
      const mode = (btn as HTMLElement).dataset.mode as RenderMode;
      const isAvailable = compatibleModes.includes(mode) || mode === 'circles'; // Circles is special
      btn.classList.toggle('unsupported', !isAvailable);
      btn.classList.toggle('active', state.currentRenderMode === mode);
    });

    // If current mode became unsupported, switch to the first compatible one
    if (!compatibleModes.includes(state.currentRenderMode) && state.currentRenderMode !== 'circles') {
      state.currentRenderMode = compatibleModes[0];
      pickers.mode.forEach(btn => {
        btn.classList.toggle('active', (btn as HTMLElement).dataset.mode === state.currentRenderMode);
      });
    }

    // Toggle NoBorders visibility
    const isPoly = state.currentRenderMode === 'hex' || state.currentRenderMode === 'square';
    const nobordersContainer = noBordersToggle?.closest('.control-group') as HTMLElement;
    if (nobordersContainer) nobordersContainer.style.display = isPoly ? '' : 'none';
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

  pickers.scale.forEach(btn => btn.addEventListener('click', () => {
    const val = (btn as HTMLElement).dataset.mode;
    if (val) {
       state.currentScaleMode = val as 'static' | 'geographic';
       pickers.scale.forEach(b => b.classList.toggle('active', b === btn));
       updateGbifLayer();
    }
  }));

  advancedToggle?.addEventListener('click', () => {
    if (advancedDrawer) {
      const isHidden = advancedDrawer.style.display === 'none';
      advancedDrawer.style.display = isHidden ? 'block' : 'none';
      advancedToggle.classList.toggle('open', isHidden);
    }
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
