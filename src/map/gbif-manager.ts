import L from 'leaflet';
import { AppState } from '../state';
import { GbifLayerClass } from './gbif';

export function initGbifLayerManager(map: L.Map, state: AppState) {
  const tilePixelRatio = Math.min(4, Math.ceil(window.devicePixelRatio || 1));

  const buildGbifUrl = (): string => {
    // Simplified style resolver or import it
    const styleParam = `palette=${state.currentPalette}&styles=${state.currentShape === 'point' ? 'point' : 'poly'}`;
    const yearParam = state.currentYear === 'ALL' ? '' : `&year=1900,${state.currentYear}`;
    let originParam = '';
    if (!state.currentOrigins.includes('ALL')) {
      originParam = state.currentOrigins.map(o => `&basisOfRecord=${o}`).join('');
    }
    const taxonParam = state.currentTaxonKey ? `&taxonKey=${state.currentTaxonKey}` : '';
    return `https://api.gbif.org/v2/map/occurrence/density/{z}/{x}/{y}@${tilePixelRatio}x.png?srs=EPSG:3857&style=${styleParam}${taxonParam}${yearParam}${originParam}`;
  };

  const updateGbifLayer = () => {
    if (state.gbifLayer) map.removeLayer(state.gbifLayer);
    if (!state.gbifEnabled) return;
    
    const url = buildGbifUrl();
    const isBinned = state.currentShape === 'hex' || state.currentShape === 'square';
    const maxNative = isBinned ? (state.currentScaleMode === 'geographic' ? 17 : 14) : 17;

    state.gbifLayer = new (GbifLayerClass as any)(url, {
      opacity: state.currentOpacity,
      attribution: '&copy; GBIF',
      crossOrigin: 'anonymous',
      zIndex: 10,
      tileSize: 512,
      zoomOffset: -1,
      maxNativeZoom: maxNative,
      gbifShape: state.currentShape,
      gbifDensity: state.currentDensity,
      gbifGridMode: state.currentScaleMode,
      errorTileUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='
    }).addTo(map);
    
    state.syncStateToURL();
  };

  return { updateGbifLayer };
}
