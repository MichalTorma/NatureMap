import L from 'leaflet';
import { AppState, STORAGE_KEY_BASE, STORAGE_KEY_OVERLAYS } from '../state';
import { getIconSvg } from './icons';

export function initFabs(map: L.Map, state: AppState, closeGbifPanel: () => void) {
  const { config, activeOverlayIds } = state;
  const baseLayerPopover = document.getElementById('base-layer-popover');
  const baseLayerGrid = document.getElementById('base-layer-grid');
  const baseLayerFab = document.getElementById('base-layer-fab');
  const baseLayerPanelClose = document.getElementById('base-layer-panel-close');
  const overlayFabContainer = document.getElementById('overlay-fabs');
  const layerStack = document.getElementById('layer-stack');
  const menuFab = document.getElementById('menu-fab');

  const updateBaseLayerFabIcon = () => {
    const spec = config.baseLayers.find(l => l.id === state.currentBaseLayer);
    if (baseLayerFab && spec) {
      baseLayerFab.innerHTML = getIconSvg(spec.icon);
      baseLayerFab.title = spec.label;
      const nameEl = document.getElementById('active-base-layer-name');
      if (nameEl) nameEl.textContent = spec.label;
    }
  };

  const closeBasePopover = () => {
    baseLayerPopover?.classList.remove('open');
  };

  const openBasePopover = () => {
    closeGbifPanel();
    baseLayerPopover?.classList.add('open');
  };

  const selectBaseLayer = (id: string) => {
    Object.values(state.baseLayerInstances).forEach(l => map.removeLayer(l));
    const layer = state.baseLayerInstances[id];
    if (layer) layer.addTo(map);
    state.currentBaseLayer = id;
    localStorage.setItem(STORAGE_KEY_BASE, id);
    updateBaseLayerFabIcon();
    baseLayerGrid?.querySelectorAll('.base-layer-option').forEach(el => {
      el.classList.toggle('active', el.getAttribute('data-layer') === id);
    });
    closeBasePopover();
    state.syncStateToURL(map);
  };

  config.baseLayers.forEach(spec => {
    const layer = spec.type === 'wms'
      ? L.tileLayer.wms(spec.url, { ...spec.options, crossOrigin: 'anonymous', zIndex: 0 })
      : L.tileLayer(spec.url, { ...spec.options, crossOrigin: 'anonymous', zIndex: 0 });
    state.baseLayerInstances[spec.id] = layer;
    if (spec.id === state.currentBaseLayer) layer.addTo(map);

    if (baseLayerGrid) {
      const btn = document.createElement('button');
      btn.className = `base-layer-option ${spec.id === state.currentBaseLayer ? 'active' : ''}`;
      btn.setAttribute('data-layer', spec.id);
      btn.innerHTML = `${getIconSvg(spec.icon)}<span>${spec.label}</span>`;
      btn.addEventListener('click', () => selectBaseLayer(spec.id));
      baseLayerGrid.appendChild(btn);
    }
  });

  updateBaseLayerFabIcon();

  baseLayerFab?.addEventListener('click', (e) => {
    e.stopPropagation();
    if (baseLayerPopover?.classList.contains('open')) closeBasePopover();
    else openBasePopover();
  });

  baseLayerPanelClose?.addEventListener('click', (e) => {
    e.stopPropagation();
    closeBasePopover();
  });

  document.addEventListener('click', (e) => {
    if (!baseLayerPopover?.classList.contains('open')) return;
    const t = e.target as Node;
    if (baseLayerPopover.contains(t)) return;
    if (baseLayerFab?.contains(t)) return;
    closeBasePopover();
  });

  config.overlays.forEach((spec, idx) => {
    const layer = spec.type === 'wms'
      ? L.tileLayer.wms(spec.url, { ...spec.options, crossOrigin: 'anonymous', zIndex: 5 + idx })
      : L.tileLayer(spec.url, { ...spec.options, crossOrigin: 'anonymous', zIndex: 5 + idx });
    state.overlayInstances[spec.id] = layer;

    const isActive = activeOverlayIds.has(spec.id);
    if (isActive) layer.addTo(map);

    if (overlayFabContainer) {
      const row = document.createElement('div');
      row.className = 'layer-row-item layer-stack-item';
      
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
        state.syncStateToURL(map);
      };

      btn.addEventListener('click', toggleLayer);
      input.addEventListener('change', toggleLayer);
      
      row.appendChild(controlChip);
      row.appendChild(nameChip);
      row.appendChild(btn);
      overlayFabContainer.appendChild(row);
    }
  });

  const closeLayerStack = () => {
    layerStack?.classList.remove('open');
    closeBasePopover();
  };

  menuFab?.addEventListener('click', () => layerStack?.classList.toggle('open'));

  document.addEventListener('click', (e) => {
    if (!layerStack?.classList.contains('open')) return;
    const t = e.target as Node;
    if (layerStack.contains(t)) return;
    const overlay = document.getElementById('panel-overlay');
    if (overlay?.classList.contains('active') && (t === overlay || overlay.contains(t))) return;
    const gbifPanel = document.getElementById('gbif-panel');
    if (gbifPanel?.classList.contains('open') && (t === gbifPanel || gbifPanel.contains(t))) return;
    const langPanel = document.getElementById('lang-panel');
    if (langPanel?.classList.contains('open') && (t === langPanel || langPanel.contains(t))) return;
    const basePopover = document.getElementById('base-layer-popover');
    if (basePopover?.classList.contains('open') && (t === basePopover || basePopover.contains(t))) return;
    const vectorLegend = document.getElementById('vector-legend');
    if (vectorLegend?.classList.contains('open') && (t === vectorLegend || vectorLegend.contains(t))) return;
    closeLayerStack();
  });
  
  return { closeLayerStack };
}
