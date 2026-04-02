import type L from 'leaflet';
import { AppState } from '../state';
import { getIconSvg } from './icons';
import { 
  type TaxonHistory 
} from '../map/gbif';
import { showErrorToast } from './toasts';

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
        .forEach((s: any) => {
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

          li.addEventListener('click', () => {
            state.currentTaxonKey = s.key;
            gbifSearch.value = nameToUse;
            gbifResults.style.display = 'none';
            updateFilterLabel(nameToUse);
            saveToHistory({ key: s.key, name: nameToUse });
            updateGbifLayer();
          });
          gbifResults.appendChild(li);
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

  renderHistory();

  return { openGbifPanel, closeGbifPanel };
}
