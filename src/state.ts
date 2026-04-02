import type { AppConfig, VectorMarkerEntry } from './types';

export const STORAGE_KEY_CENTER = 'mymap_center';
export const STORAGE_KEY_ZOOM = 'mymap_zoom';
export const STORAGE_KEY_LANGS = 'mymap_user_langs';
export const STORAGE_KEY_BASE = 'mymap_base_layer';
export const STORAGE_KEY_OVERLAYS = 'mymap_overlays';

export class AppState {
  config: AppConfig;
  gbifEnabled = true;
  currentTaxonKey: number | null = null;
  currentYear: number | 'ALL' = 'ALL';
  currentDensity = 40;
  currentOpacity = 0.85;
  currentShape = 'hex';
  currentScaleMode: 'static' | 'geographic' = 'static';
  currentPalette = 'classic';
  currentOrigins: string[] = ['ALL'];

  userLanguages: string[] = ['en'];
  
  // Layer State
  currentBaseLayer: string = 'osm-voyager';
  activeOverlayIds: Set<string> = new Set();

  // Layer Instances
  baseLayerInstances: Record<string, any> = {};
  overlayInstances: Record<string, any> = {};
  gbifLayer: any = null;

  // Search Results
  vectorMarkers: VectorMarkerEntry[] = [];
  
  urlParams: URLSearchParams;

  constructor(config: AppConfig) {
    this.config = config;
    this.urlParams = new URLSearchParams(window.location.search);
    
    // Default base layer from config if available
    const activeBase = config.baseLayers.find(l => l.active);
    if (activeBase) this.currentBaseLayer = activeBase.id;

    // Load state from Storage or URL
    const taxonParam = this.urlParams.get('taxon');
    if (taxonParam) this.currentTaxonKey = parseInt(taxonParam, 10);

    const savedLangs = localStorage.getItem(STORAGE_KEY_LANGS);
    if (savedLangs) this.userLanguages = JSON.parse(savedLangs);
    else this.userLanguages = navigator.languages.map(l => l.split('-')[0]);

    const savedOpacity = localStorage.getItem('mymap_opacity');
    if (savedOpacity) this.currentOpacity = parseFloat(savedOpacity);

    const savedBase = localStorage.getItem(STORAGE_KEY_BASE);
    if (savedBase) this.currentBaseLayer = savedBase;

    const savedOverlays = localStorage.getItem(STORAGE_KEY_OVERLAYS);
    if (savedOverlays) this.activeOverlayIds = new Set(JSON.parse(savedOverlays));
    else {
      config.overlays.filter(o => o.active).forEach(o => this.activeOverlayIds.add(o.id));
    }
  }

  syncStateToURL(map?: any) {
    const url = new URL(window.location.href);
    if (this.currentTaxonKey) url.searchParams.set('taxon', this.currentTaxonKey.toString());
    else url.searchParams.delete('taxon');

    if (map) {
      const center = map.getCenter();
      url.searchParams.set('lat', center.lat.toFixed(6));
      url.searchParams.set('lng', center.lng.toFixed(6));
      url.searchParams.set('zoom', map.getZoom().toString());
    }

    window.history.replaceState({}, '', url.toString());
    
    // Save to local storage
    localStorage.setItem(STORAGE_KEY_BASE, this.currentBaseLayer);
    localStorage.setItem(STORAGE_KEY_OVERLAYS, JSON.stringify(Array.from(this.activeOverlayIds)));
  }
}
