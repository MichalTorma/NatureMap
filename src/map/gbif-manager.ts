import L from 'leaflet';
import { AppState } from '../state';
import { GbifLayerClass } from './gbif';

export function initGbifLayerManager(map: L.Map, state: AppState) {
  const tilePixelRatio = Math.min(4, Math.ceil(window.devicePixelRatio || 1));

  /**
   * Strictly maps UI palette + renderMode + noBorders combination to API v2 style strings.
   * Based on https://techdocs.gbif.org/en/openapi/v2/maps
   */
  const resolveGbifStyle = (palette: string, mode: string, noBorders: boolean): string => {
    // 1. Special Rendering Modes
    if (mode === 'circles') return 'scaled.circles';
    if (mode === 'marker') return `${palette}.marker`;

    // 2. Grids (Hex/Square)
    if (mode === 'hex' || mode === 'square') {
      const suffix = noBorders ? '-noborder' : '';
      return `${palette}${suffix}.poly`;
    }

    // 3. Points & Heatmaps
    // Ensure heat palettes use their correct .point suffix
    const heatPalettes = ['purpleHeat', 'blueHeat', 'orangeHeat', 'greenHeat', 'fire', 'glacier'];
    if (heatPalettes.includes(palette)) {
      return `${palette}.point`;
    }

    return `${palette}.point`; // Fallback to standard point
  };

  const buildGbifUrl = (): string => {
    const mode = state.currentRenderMode;
    
    // Binning parameters (handled dynamically by GbifLayerClass in gbif.ts)
    // We only provide the style string here.
    const style = resolveGbifStyle(state.currentPalette, mode, state.currentNoBorders);
    
    const yearParam = state.currentYear === 'ALL' ? '' : `&year=1900,${state.currentYear}`;
    let originParam = '';
    if (!state.currentOrigins.includes('ALL')) {
      originParam = state.currentOrigins.map(o => `&basisOfRecord=${o}`).join('');
    }
    const taxonParam = state.currentTaxonKey ? `&taxonKey=${state.currentTaxonKey}` : '';
    
    return `https://api.gbif.org/v2/map/occurrence/density/{z}/{x}/{y}@${tilePixelRatio}x.png?srs=EPSG:3857&style=${style}${taxonParam}${yearParam}${originParam}`;
  };

  const updateGbifLayer = () => {
    if (state.gbifLayer) map.removeLayer(state.gbifLayer);
    if (!state.gbifEnabled) return;
    
    const url = buildGbifUrl();
    const isSpecial = state.currentRenderMode === 'circles' || state.currentRenderMode === 'marker';
    
    // Zoom limits based on mode
    let maxNative = 16;
    if (isSpecial || state.currentRenderMode === 'heatmap') maxNative = 12; // Cap heavy renders

    state.gbifLayer = new (GbifLayerClass as any)(url, {
      opacity: state.currentOpacity,
      attribution: '&copy; GBIF',
      crossOrigin: 'anonymous',
      zIndex: 10,
      tileSize: 512,
      zoomOffset: -1,
      maxNativeZoom: maxNative,
      gbifShape: state.currentRenderMode,
      gbifDensity: state.currentDensity,
      errorTileUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='
    }).addTo(map);
    
    state.syncStateToURL();
  };

  return { updateGbifLayer };
}
