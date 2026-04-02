import { AppState } from '../state';
import { buildTaxaTree, pruneTree, type TaxaNode } from '../map/taxonomy';

export function initLegend(state: AppState) {
  const vectorLegend = document.getElementById('vector-legend');
  const vectorLegendBody = document.getElementById('vector-legend-body');
  const legendToggle = document.getElementById('legend-toggle');
  const legendClose = document.getElementById('legend-close');
  const legendBadge = document.getElementById('legend-badge');
  const resizeHandle = document.getElementById('legend-resize-handle');

  const openLegend = () => {
    vectorLegend?.classList.add('open');
    legendToggle?.classList.add('active');
    document.body.classList.add('panel-active');
  };

  const closeLegend = () => {
    vectorLegend?.classList.remove('open');
    legendToggle?.classList.remove('active');
    if (!document.getElementById('gbif-panel')?.classList.contains('open')) {
      document.body.classList.remove('panel-active');
    }
  };

  legendToggle?.addEventListener('click', () => {
    if (vectorLegend?.classList.contains('open')) closeLegend();
    else openLegend();
  });
  legendClose?.addEventListener('click', closeLegend);

  const STORAGE_KEY_LEGEND_WIDTH = 'mymap_legend_width';
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

  const renderNode = (node: TaxaNode, container: HTMLElement) => {
    const row = document.createElement('div');
    row.className = 'tree-row';
    row.innerHTML = `
      <span class="tree-rank">${node.rank.charAt(0)}</span>
      <span class="tree-name-wrap"><span class="tree-name-primary">${node.name}</span></span>
      <span class="legend-count">${node.count}</span>
    `;
    container.appendChild(row);

    if (node.children.size > 0) {
      const childrenBox = document.createElement('div');
      childrenBox.className = 'tree-children';
      container.appendChild(childrenBox);
      row.classList.add('has-children');
      row.addEventListener('click', () => {
        row.classList.toggle('expanded');
        childrenBox.classList.toggle('open');
      });
      for (const child of node.children.values()) {
        renderNode(child, childrenBox);
      }
    }
  };

  const updateTaxonomyLegend = () => {
    if (!vectorLegendBody || !legendBadge) return;
    const count = state.vectorMarkers.length;
    if (count === 0) {
      legendToggle?.classList.add('hidden');
      return;
    }
    legendToggle?.classList.remove('hidden');
    legendBadge.textContent = count.toString();

    const root = buildTaxaTree(state.vectorMarkers);
    const pruned = pruneTree(root);
    vectorLegendBody.innerHTML = '';
    renderNode(pruned, vectorLegendBody);
  };

  return { updateTaxonomyLegend };
}
