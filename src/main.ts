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
import { initExternalStatusUi } from './ui/external-status-ui';
import { initBugReport } from './ui/bug-report';

async function initMap() {
  try {
    initIcons();
    initExternalStatusUi();
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
    const { closeLangPanel } = initLanguages(state, () => {
      // Re-render legend with new language preferences
      void onLanguagesChanged();
    });

    const panelOverlay = document.getElementById('panel-overlay');
    panelOverlay?.addEventListener('click', () => {
      if (document.getElementById('gbif-panel')?.classList.contains('open')) {
        closeGbifPanel();
      } else if (document.getElementById('lang-panel')?.classList.contains('open')) {
        closeLangPanel();
      }
    });
    initWelcome();
    initVectorSearch(map, state, updateTaxonomyLegend, updateGbifLayer);
    initBugReport(map, state, config);

    // Initial layer load
    updateGbifLayer();

    // Hide splash screen with a smooth transition
    setTimeout(() => {
      const splash = document.getElementById('splash-screen');
      if (splash) {
        splash.classList.add('hidden');
        // Remove from DOM after transition for performance
        setTimeout(() => splash.remove(), 1000);
      }
    }, 800);

  } catch (error) {
    console.error('Error initializing map:', error);
    showErrorToast('Failed to load app configuration.');
  }
}

initMap();
