import './style.css';
import 'leaflet.markercluster/dist/MarkerCluster.css';
import 'leaflet.markercluster/dist/MarkerCluster.Default.css';

// Leaflet Global Setup (must happen before plugins like markercluster)
import './leaflet-setup';
import 'leaflet.markercluster';

import { AppState } from './state';
import { initMapCore } from './map/core';
import { initFabs } from './ui/fabs';
import { initGbifPanel } from './ui/panel';
import { initLegend } from './ui/legend';
import { initTaxonHoverCard } from './ui/hover-card';
import { initGeo } from './ui/geo';
import { initLanguages } from './ui/languages';
import { initWelcome } from './ui/welcome';
import { initVectorSearch } from './map/vector';
import { initIcons } from './ui/icons';
import { showErrorToast } from './ui/toasts';
import { initGbifLayerManager } from './map/gbif-manager';

async function initMap() {
  try {
    initIcons();
    const response = await fetch('/config.json');
    if (!response.ok) throw new Error('Failed to load config.json');
    const config = await response.json();

    const state = new AppState(config);
    const map = initMapCore(state);

    const { updateGbifLayer } = initGbifLayerManager(map, state);

    // Hover card must be created before legend (legend needs showTaxonHoverCard)
    const hoverCard = initTaxonHoverCard(state);

    const { updateTaxonomyLegend, onLanguagesChanged } = initLegend(state, hoverCard);
    const { closeGbifPanel } = initGbifPanel(map, state, updateGbifLayer);

    initFabs(map, state, closeGbifPanel);
    initGeo(map);
    initLanguages(state, () => {
      // Re-render legend with new language preferences
      void onLanguagesChanged();
    });
    initWelcome();
    initVectorSearch(map, state, updateTaxonomyLegend);

    // Initial layer load
    updateGbifLayer();

  } catch (error) {
    console.error('Error initializing map:', error);
    showErrorToast('Failed to load app configuration.');
  }
}

initMap();
