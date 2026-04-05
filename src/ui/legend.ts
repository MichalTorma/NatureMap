import type L from 'leaflet';
import type { AppState } from '../state';
import type { HoverCardController } from './hover-card';
import { buildTaxaTree, pruneTree, type TaxaNode } from '../map/taxonomy';
import { resolveVernacularNames, vnCache, resolveWikidataInfo, negotiateTaxonNames } from '../map/gbif';
import { getIconSvg } from './icons';

// ─── Legend-local state ───────────────────────────────────────────────────────
const hiddenMarkers = new Set<L.Marker>();
const selectedNodes = new Set<string>();
const selectedMarkersByNode = new Map<string, Set<L.Marker>>();
const markerSpecies = new Map<L.Marker, string>();
let legendSearchQuery = '';
let legendDisplayLang = 'en';

// ─── Text helpers ─────────────────────────────────────────────────────────────
const normalizeText = (text: string | undefined | null): string =>
  (text ?? '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

const rankLabel = (r: string): string =>
  ({ root: '', kingdom: 'K', phylum: 'P', class: 'C', order: 'O', family: 'F', genus: 'G', species: 'Sp' }[r] ?? r);

// ─── Vernacular name helpers ──────────────────────────────────────────────────
function createTaxonNameWrap(sciName: string, taxonKey?: number): HTMLSpanElement {
  const wrap = document.createElement('span');
  wrap.className = 'tree-name-wrap';
  if (taxonKey && taxonKey > 0) wrap.dataset.taxonKey = String(taxonKey);
  wrap.dataset.scientific = sciName;

  const primary = document.createElement('span');
  primary.className = 'tree-name-primary';
  primary.textContent = sciName;

  const sci = document.createElement('span');
  sci.className = 'tree-name-sci';
  sci.textContent = sciName;

  const allEl = document.createElement('span');
  allEl.className = 'tree-vn-all';

  wrap.appendChild(primary);
  wrap.appendChild(sci);
  wrap.appendChild(allEl);
  return wrap;
}

async function updateTaxonNameWrap(wrap: HTMLElement, userLanguages: string[]): Promise<void> {
  const keyStr = wrap.dataset.taxonKey;
  const sci = wrap.dataset.scientific || '';
  const primaryEl = wrap.querySelector<HTMLElement>('.tree-name-primary');
  const sciEl = wrap.querySelector<HTMLElement>('.tree-name-sci');
  const allEl = wrap.querySelector<HTMLElement>('.tree-vn-all');
  if (!primaryEl || !sciEl) return;

  if (!keyStr) {
    primaryEl.textContent = sci;
    primaryEl.style.fontStyle = 'italic';
    sciEl.style.display = 'none';
    if (allEl) { allEl.textContent = ''; allEl.style.display = 'none'; }
    return;
  }

  const key = parseInt(keyStr, 10);
  const all = vnCache.get(key) || [];
  const wiki = await resolveWikidataInfo(key, userLanguages);
  const { best, subtitles } = negotiateTaxonNames(sci, userLanguages, all, wiki);

  // Determine the name to show for the currently selected legend display language
  const displayMatch = (best.lang === legendDisplayLang) 
    ? best 
    : subtitles.find(s => s.lang === legendDisplayLang);
  
  const activeName = displayMatch ? displayMatch.name : sci;
  const isActiveSci = displayMatch ? displayMatch.isScientific : true;

  primaryEl.textContent = activeName;
  primaryEl.style.fontStyle = isActiveSci ? 'italic' : 'normal';

  if (activeName !== sci && sci) {
    sciEl.textContent = sci;
    sciEl.style.display = '';
  } else {
    sciEl.style.display = 'none';
  }

  if (allEl && userLanguages.length > 0) {
    const parts: string[] = [];
    // Show all preferred languages in the small grey list
    const allPreferred = [best, ...subtitles];
    for (const lc of userLanguages) {
      const match = allPreferred.find(p => p.lang === lc);
      if (match) {
        parts.push(`${lc.toUpperCase()}\u00a0${match.name}`);
      }
    }
    if (parts.length > 0) {
      allEl.textContent = parts.join(' · ');
      allEl.style.display = userLanguages.length > 1 ? '' : 'none';
    } else {
      allEl.textContent = '';
      allEl.style.display = 'none';
    }
  }
}

async function prefetchVernaculars(taxonKeys: number[]): Promise<void> {
  const uniq = [...new Set(taxonKeys.filter(k => k > 0))];
  await Promise.all(uniq.map(k => resolveVernacularNames(k)));
}

async function applyLegendLanguageToBody(body: HTMLElement, userLanguages: string[]): Promise<void> {
  const wraps = [...body.querySelectorAll<HTMLElement>('.tree-name-wrap')];
  const keys = wraps
    .map(w => parseInt(w.dataset.taxonKey || '', 10))
    .filter(k => !Number.isNaN(k) && k > 0);
  await prefetchVernaculars(keys);
  await Promise.all(wraps.map(w => updateTaxonNameWrap(w, userLanguages)));
}

// ─── Main export ──────────────────────────────────────────────────────────────
export function initLegend(state: AppState, hoverCard: HoverCardController) {
  const { showTaxonHoverCard } = hoverCard;

  const vectorLegend = document.getElementById('vector-legend');
  const vectorLegendBody = document.getElementById('vector-legend-body');
  const legendToggle = document.getElementById('legend-toggle');
  const legendClose = document.getElementById('legend-close');
  const legendBadge = document.getElementById('legend-badge');
  const resizeHandle = document.getElementById('legend-resize-handle');
  const legendSearchInput = document.getElementById('legend-search-input') as HTMLInputElement | null;
  const legendSearchClear = document.getElementById('legend-search-clear') as HTMLElement | null;

  // init legendDisplayLang from user prefs
  legendDisplayLang = state.userLanguages[0] || 'en';

  // ── Open / close ─────────────────────────────────────────────────────────
  const openLegend = () => {
    vectorLegend?.classList.add('open');
    legendToggle?.classList.add('active');
    document.body.classList.add('panel-active');
  };

  const closeLegend = () => {
    vectorLegend?.classList.remove('open');
    legendToggle?.classList.remove('active');
    if (
      !document.getElementById('gbif-panel')?.classList.contains('open') &&
      !document.getElementById('lang-panel')?.classList.contains('open')
    ) {
      document.body.classList.remove('panel-active');
    }
  };

  legendToggle?.addEventListener('click', () => {
    if (vectorLegend?.classList.contains('open')) closeLegend();
    else openLegend();
  });
  legendClose?.addEventListener('click', closeLegend);

  document.addEventListener('click', (e) => {
    if (!vectorLegend?.classList.contains('open')) return;
    const t = e.target as Node;
    if (vectorLegend.contains(t)) return;
    if (legendToggle?.contains(t)) return;
    closeLegend();
  });

  // ── Resize ───────────────────────────────────────────────────────────────
  const STORAGE_KEY_LEGEND_WIDTH = 'naturemap_legend_width';
  let isResizing = false;
  if (vectorLegend && resizeHandle) {
    const savedWidth = localStorage.getItem(STORAGE_KEY_LEGEND_WIDTH);
    if (savedWidth && window.innerWidth > 768) vectorLegend.style.width = `${savedWidth}px`;

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
      if (newWidth >= 260 && newWidth <= 800) vectorLegend.style.width = `${newWidth}px`;
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

  // ── Visibility logic ─────────────────────────────────────────────────────
  const refreshVisibility = () => {
    const vl = state.vectorLayer;
    if (!vl) return;

    if (selectedNodes.size > 0) {
      // Solo mode: only show markers in at least one selected node AND not hidden
      const allowed = new Set<L.Marker>();
      selectedNodes.forEach(id => {
        selectedMarkersByNode.get(id)?.forEach(m => allowed.add(m));
      });
      state.vectorMarkers.forEach(({ marker }) => {
        const shouldShow = allowed.has(marker) && !hiddenMarkers.has(marker);
        if (shouldShow && !vl.hasLayer(marker)) vl.addLayer(marker);
        else if (!shouldShow && vl.hasLayer(marker)) vl.removeLayer(marker);
      });
    } else {
      // Normal mode: hide only explicitly hidden markers
      state.vectorMarkers.forEach(({ marker }) => {
        if (!hiddenMarkers.has(marker) && !vl.hasLayer(marker)) vl.addLayer(marker);
        else if (hiddenMarkers.has(marker) && vl.hasLayer(marker)) vl.removeLayer(marker);
      });
    }
  };

  // ── Species panel builder ─────────────────────────────────────────────────
  const buildSpeciesPanel = (
    node: TaxaNode,
    nodeId: string,
    depth: number,
  ): HTMLDivElement => {
    const panel = document.createElement('div');
    panel.className = 'tree-species-table';
    panel.style.display = 'none';
    panel.style.paddingLeft = `${20 + depth * 14}px`;

    // Group markers by species name
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
      spRow.className = 'tree-species-row';
      spRow.dataset.filterId = spId;

      const vm = state.vectorMarkers.find(v => v.marker === markers[0]);
      const nameWrap = createTaxonNameWrap(speciesName, vm?.taxonomy.speciesKey);
      nameWrap.classList.add('tree-species-item', 'tree-species-name');

      const countEl = document.createElement('span');
      countEl.className = 'legend-count';
      countEl.textContent = String(markers.length);

      const btnGroup = document.createElement('div');
      btnGroup.className = 'tree-species-actions';

      // Info button
      if (vm?.taxonomy.speciesKey) {
        const spInfo = document.createElement('button');
        spInfo.className = 'tree-info-btn tree-info-inline';
        spInfo.innerHTML = getIconSvg('info');
        spInfo.addEventListener('click', (e) => {
          e.stopPropagation();
          showTaxonHoverCard(spInfo, vm.taxonomy.speciesKey!, speciesName);
        });
        spInfo.addEventListener('mouseenter', () => {
          if (window.innerWidth > 768) showTaxonHoverCard(spInfo, vm.taxonomy.speciesKey!, speciesName);
        });
        btnGroup.appendChild(spInfo);
      }

      // Eye button
      const spEye = document.createElement('button');
      spEye.className = 'tree-eye tree-eye-inline';
      let spVisible = !markers.every(m => hiddenMarkers.has(m));
      spEye.innerHTML = getIconSvg(spVisible ? 'eye' : 'eye-off');
      spRow.classList.toggle('tree-hidden', !spVisible);
      spEye.addEventListener('click', (e) => {
        e.stopPropagation();
        spVisible = !spVisible;
        spEye.innerHTML = getIconSvg(spVisible ? 'eye' : 'eye-off');
        spRow.classList.toggle('tree-hidden', !spVisible);
        markers.forEach(m => (spVisible ? hiddenMarkers.delete(m) : hiddenMarkers.add(m)));
        refreshVisibility();
      });

      // Filter button
      const spFilter = document.createElement('button');
      spFilter.className = 'tree-filter tree-filter-inline';
      spFilter.innerHTML = getIconSvg('filter');
      spFilter.addEventListener('click', (e) => {
        e.stopPropagation();
        const on = selectedNodes.has(spId);
        on ? selectedNodes.delete(spId) : selectedNodes.add(spId);
        spRow.classList.toggle('tree-selected', !on);
        refreshVisibility();
      });

      btnGroup.append(spEye, spFilter);
      spRow.append(nameWrap, countEl, btnGroup);
      panel.appendChild(spRow);
    });

    return panel;
  };

  // ── Node renderer ─────────────────────────────────────────────────────────
  const renderNode = (node: TaxaNode, container: HTMLElement, depth: number, parentId: string) => {
    const nodeId = `${parentId}:${node.name}`;
    selectedMarkersByNode.set(nodeId, new Set(node.markers));

    const isLeaf = node.children.size === 0;

    const row = document.createElement('div');
    row.className = 'tree-row';
    row.style.paddingLeft = `${depth * 14}px`;

    // Rank badge
    const rankEl = document.createElement('span');
    rankEl.className = 'tree-rank';
    rankEl.textContent = rankLabel(node.rank);

    // Name wrap (vernacular-aware)
    const nameWrap = createTaxonNameWrap(node.name, node.taxonKey);
    if (node.rank === 'species') nameWrap.classList.add('tree-species-name');

    // Count badge
    const cntEl = document.createElement('span');
    cntEl.className = 'legend-count';
    cntEl.textContent = String(node.count);

    row.appendChild(rankEl);
    row.appendChild(nameWrap);
    row.appendChild(cntEl);

    // ── Info button ───────────────────────────────────────────────────────
    if (node.rank !== 'root' && node.taxonKey) {
      const infoBtn = document.createElement('button');
      infoBtn.className = 'tree-info-btn';
      infoBtn.innerHTML = getIconSvg('info');
      infoBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        showTaxonHoverCard(infoBtn, node.taxonKey!, node.name);
      });
      infoBtn.addEventListener('mouseenter', () => {
        if (window.innerWidth > 768) showTaxonHoverCard(infoBtn, node.taxonKey!, node.name);
      });
      row.appendChild(infoBtn);
    }

    // ── Eye button ────────────────────────────────────────────────────────
    const eyeBtn = document.createElement('button');
    eyeBtn.className = 'tree-eye';
    eyeBtn.innerHTML = getIconSvg('eye');
    let visible = true;
    eyeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      visible = !visible;
      eyeBtn.innerHTML = getIconSvg(visible ? 'eye' : 'eye-off');
      row.classList.toggle('tree-hidden', !visible);
      node.markers.forEach(m => (visible ? hiddenMarkers.delete(m) : hiddenMarkers.add(m)));
      refreshVisibility();
    });
    row.appendChild(eyeBtn);

    // ── Filter button ─────────────────────────────────────────────────────
    const filterBtn = document.createElement('button');
    filterBtn.className = 'tree-filter';
    filterBtn.innerHTML = getIconSvg('filter');
    filterBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const isSelected = selectedNodes.has(nodeId);
      isSelected ? selectedNodes.delete(nodeId) : selectedNodes.add(nodeId);
      row.classList.toggle('tree-selected', !isSelected);
      refreshVisibility();
    });
    row.appendChild(filterBtn);

    // ── List button (species drill-down) ──────────────────────────────────
    const listBtn = document.createElement('button');
    listBtn.className = 'tree-list';
    listBtn.innerHTML = getIconSvg('list');
    row.appendChild(listBtn);

    container.appendChild(row);

    // Species panel (lazy-built on first open)
    const speciesPanel = buildSpeciesPanel(node, nodeId, depth);
    container.appendChild(speciesPanel);

    listBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const isOpen = speciesPanel.style.display !== 'none';
      speciesPanel.style.display = isOpen ? 'none' : 'block';
      if (!isOpen) void applyLegendLanguageToBody(speciesPanel, state.userLanguages);
    });

    // ── Children ──────────────────────────────────────────────────────────
    if (!isLeaf) {
      const childContainer = document.createElement('div');
      childContainer.className = 'tree-children';
      // Auto-open top-level or single-child groups
      if (depth === 0 || node.children.size === 1) childContainer.classList.add('open');
      container.appendChild(childContainer);
      if (childContainer.classList.contains('open')) row.classList.add('expanded');

      row.addEventListener('click', (e) => {
        if (
          (e.target as HTMLElement).closest('.tree-eye') ||
          (e.target as HTMLElement).closest('.tree-filter') ||
          (e.target as HTMLElement).closest('.tree-list') ||
          (e.target as HTMLElement).closest('.tree-info-btn')
        ) return;
        const isOpen = childContainer.classList.toggle('open');
        row.classList.toggle('expanded', isOpen);
      });

      const sorted = [...node.children.values()].sort((a, b) => b.count - a.count);
      for (const child of sorted) renderNode(child, childContainer, depth + 1, nodeId);
    }
  };

  // ── Lang bar ──────────────────────────────────────────────────────────────
  const renderLangBar = () => {
    const langBar = document.getElementById('legend-lang-bar');
    if (!langBar) return;
    langBar.innerHTML = '';
    const langs = state.userLanguages.length > 0 ? state.userLanguages : ['en'];
    langs.forEach(code => {
      const chip = document.createElement('button');
      chip.className = 'legend-lang-chip' + (code === legendDisplayLang ? ' active' : '');
      chip.textContent = code.toUpperCase();
      chip.addEventListener('click', async (e) => {
        e.stopPropagation();
        legendDisplayLang = code;
        await updateTaxonomyLegend();
      });
      langBar.appendChild(chip);
    });
  };

  // ── Core update ───────────────────────────────────────────────────────────
  const updateTaxonomyLegend = async () => {
    if (!vectorLegendBody || !legendBadge) return;

    // Reset per-render state (but keep hiddenMarkers/selectedNodes across renders)
    selectedMarkersByNode.clear();
    markerSpecies.clear();

    if (state.vectorMarkers.length === 0) {
      legendToggle?.classList.add('hidden');
      vectorLegend?.classList.remove('open');
      return;
    }

    // ── Filter by search query ────────────────────────────────────────────
    const filteredMarkers = legendSearchQuery
      ? state.vectorMarkers.filter(m => {
          const q = normalizeText(legendSearchQuery);
          const taxFields = [
            m.taxonomy.species, m.taxonomy.genus, m.taxonomy.family,
            m.taxonomy.order, m.taxonomy.class, m.taxonomy.phylum, m.taxonomy.kingdom,
          ].map(s => normalizeText(s));
          if (taxFields.some(f => f.includes(q))) return true;
          // Also search vernacular names from cache
          const cachedNames = vnCache.get(m.taxonomy.speciesKey || 0) || [];
          return cachedNames.some(vn => normalizeText(vn.name).includes(q));
        })
      : state.vectorMarkers;

    // ── Populate markerSpecies ────────────────────────────────────────────
    filteredMarkers.forEach(v =>
      markerSpecies.set(v.marker, v.taxonomy.species || v.label || 'Unknown species')
    );

    // ── Render tree ───────────────────────────────────────────────────────
    vectorLegendBody.innerHTML = '';

    if (filteredMarkers.length === 0 && legendSearchQuery) {
      const empty = document.createElement('div');
      empty.className = 'legend-empty-state';
      empty.innerHTML = `<span class="empty-icon">${getIconSvg('search')}</span> No species match "${legendSearchQuery}"`;
      vectorLegendBody.appendChild(empty);
    } else {
      const tree = pruneTree(buildTaxaTree(filteredMarkers));
      const sorted = [...tree.children.values()].sort((a, b) => b.count - a.count);
      for (const child of sorted) renderNode(child, vectorLegendBody, 0, 'root');
    }

    // ── Lang bar ──────────────────────────────────────────────────────────
    renderLangBar();

    // ── Apply vernacular names ────────────────────────────────────────────
    await applyLegendLanguageToBody(vectorLegendBody, state.userLanguages);

    // ── Badge + FAB ───────────────────────────────────────────────────────
    const uniqueSpecies = new Set(filteredMarkers.map(m => m.taxonomy.species)).size;
    legendBadge.textContent = String(uniqueSpecies);
    legendToggle?.classList.remove('hidden');
  };

  // ── Search bar ────────────────────────────────────────────────────────────
  legendSearchInput?.addEventListener('input', () => {
    legendSearchQuery = legendSearchInput.value;
    legendSearchClear?.classList.toggle('hidden', !legendSearchQuery);
    void updateTaxonomyLegend();
  });
  legendSearchClear?.addEventListener('click', () => {
    if (legendSearchInput) legendSearchInput.value = '';
    legendSearchQuery = '';
    legendSearchClear?.classList.add('hidden');
    void updateTaxonomyLegend();
  });

  // ── Language-change callback (called by main.ts via languages.ts) ─────────
  const onLanguagesChanged = async () => {
    legendDisplayLang = state.userLanguages[0] || 'en';
    await updateTaxonomyLegend();
  };

  return { updateTaxonomyLegend, onLanguagesChanged };
}
