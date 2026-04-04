import type L from 'leaflet';
import type { AppConfig } from './types';

export type RenderMode = 'heatmap' | 'point' | 'hex' | 'square' | 'marker' | 'circles';

export const STORAGE_KEY_CENTER = 'gbif_center';
export const STORAGE_KEY_ZOOM = 'gbif_zoom';
export const STORAGE_KEY_BASE = 'gbif_base';
export const STORAGE_KEY_OVERLAYS = 'gbif_overlays';
export const STORAGE_KEY_LANGS = 'gbif_langs';

export class AppState {
  // GBIF Rendering States
  gbifEnabled: boolean = true;
  currentTaxonKey: number | null = null;
  currentYear: number | 'ALL' = 'ALL';
  currentOrigins: string[] = ['ALL'];
  currentOpacity: number = 0.8;
  currentDensity: number = 32;
  currentPalette: string = 'classic';
  currentRenderMode: RenderMode = 'hex';
  currentNoBorders: boolean = false;

  // Base Layers & Overlays
  currentBaseLayer: string;
  activeOverlayIds: Set<string> = new Set();
  baseLayerInstances: Record<string, L.Layer> = {};
  overlayInstances: Record<string, L.Layer> = {};

  // User Preferences & Data
  userLanguages: string[] = ['en'];
  vectorMarkers: any[] = [];
  gbifLayer: any = null;
  vectorLayer: any = null; // MarkerClusterGroup — set by initVectorSearch
  /** Hide biodiversity raster while viewing loaded point occurrences (cleared on “clear” or failed load). */
  suppressGbifForVectorOccurrences = false;
  config: AppConfig;

  constructor(config: AppConfig) {
    this.config = config;
    this.currentBaseLayer = localStorage.getItem(STORAGE_KEY_BASE) || (config.baseLayers[0]?.id || 'osm');
    
    const savedLangs = localStorage.getItem(STORAGE_KEY_LANGS);
    if (savedLangs) {
      try { this.userLanguages = JSON.parse(savedLangs); } catch (e) {}
    }
    const savedOverlays = localStorage.getItem(STORAGE_KEY_OVERLAYS);
    if (savedOverlays) {
      try { 
        const ids = JSON.parse(savedOverlays);
        if (Array.isArray(ids)) this.activeOverlayIds = new Set(ids);
      } catch (e) {}
    }
    
    this.loadFromURL();
  }

  syncStateToURL(map?: L.Map) {
    const params = new URLSearchParams(window.location.hash.slice(1));
    if (this.currentTaxonKey) params.set('taxon', this.currentTaxonKey.toString());
    else params.delete('taxon');
    
    params.set('palette', this.currentPalette);
    params.set('mode', this.currentRenderMode);
    if (this.currentNoBorders) params.set('noborder', '1');
    else params.delete('noborder');
    
    params.set('year', this.currentYear.toString());
    params.set('density', this.currentDensity.toString());

    if (map) {
      const center = map.getCenter();
      params.set('lat', center.lat.toFixed(4));
      params.set('lng', center.lng.toFixed(4));
      params.set('z', map.getZoom().toString());
    }
    
    window.location.hash = params.toString();
  }

  private loadFromURL() {
    const params = new URLSearchParams(window.location.hash.slice(1));
    const taxon = params.get('taxon');
    if (taxon) this.currentTaxonKey = parseInt(taxon);
    
    this.currentPalette = params.get('palette') || 'classic';
    const rawMode = params.get('mode');
    if (rawMode) this.currentRenderMode = rawMode as RenderMode;
    
    this.currentNoBorders = params.has('noborder');
    
    const year = params.get('year');
    if (year) this.currentYear = year === 'ALL' ? 'ALL' : parseInt(year);
    
    const density = params.get('density');
    if (density) this.currentDensity = parseInt(density);
  }
}
