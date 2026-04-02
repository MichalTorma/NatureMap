import L from 'leaflet';
import { AppState, STORAGE_KEY_CENTER, STORAGE_KEY_ZOOM } from '../state';

/* Pan / zoom so GBIF vector popup (incl. image) stays inside the map pane; extra right/bottom padding for FABs */
export const vectorPopupMapPad = { l: 24, t: 76, r: 108, b: 44 };
let vectorPopupFitGeneration = 0;

export const scheduleVectorPopupFit = (map: L.Map, marker: L.Marker) => {
  const gen = ++vectorPopupFitGeneration;
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      if (gen !== vectorPopupFitGeneration) return;
      fitVectorPopupInView(map, marker, gen);
    });
  });
};

export const fitVectorPopupInView = (map: L.Map, marker: L.Marker, gen: number) => {
  const popup = marker.getPopup();
  if (!popup?.isOpen() || gen !== vectorPopupFitGeneration) return;
  const el = popup.getElement();
  if (!el) return;
  const mapEl = map.getContainer();
  const mr = mapEl.getBoundingClientRect();
  const p = vectorPopupMapPad;
  const minZ = map.getMinZoom();
  let passes = 0;
  const maxPasses = 14;

  const step = () => {
    if (!popup.isOpen() || gen !== vectorPopupFitGeneration || passes++ > maxPasses) return;
    const r = el.getBoundingClientRect();
    const availW = mr.width - p.l - p.r;
    const availH = mr.height - p.t - p.b;
    const tooBig = r.height > availH + 1 || r.width > availW + 1;

    if (tooBig && map.getZoom() > minZ) {
      map.setZoom(map.getZoom() - 1, { animate: true });
      map.once('zoomend', () => {
        map.panTo(marker.getLatLng(), { animate: false });
        requestAnimationFrame(step);
      });
      return;
    }

    let dx = 0;
    let dy = 0;
    if (r.left < mr.left + p.l) dx += (mr.left + p.l) - r.left;
    if (r.right > mr.right - p.r) dx += (mr.right - p.r) - r.right;
    if (r.top < mr.top + p.t) dy += (mr.top + p.t) - r.top;
    if (r.bottom > mr.bottom - p.b) dy += (mr.bottom - p.b) - r.bottom;

    if (dx !== 0 || dy !== 0) {
      map.panBy(L.point(-dx, -dy), { animate: true, duration: 0.28 });
      map.once('moveend', () => requestAnimationFrame(step));
      return;
    }
  };
  step();
};

export function initMapCore(state: AppState) {
  const { config } = state;
  const urlParams = new URLSearchParams(window.location.hash.slice(1));
  const savedCenter = localStorage.getItem(STORAGE_KEY_CENTER);
  const savedZoom = localStorage.getItem(STORAGE_KEY_ZOOM);

  const initialLat = urlParams.has('lat') ? parseFloat(urlParams.get('lat')!) : (savedCenter ? JSON.parse(savedCenter)[0] : config.mapOptions.center[0]);
  const initialLng = urlParams.has('lng') ? parseFloat(urlParams.get('lng')!) : (savedCenter ? JSON.parse(savedCenter)[1] : config.mapOptions.center[1]);
  const initialCenter: L.LatLngTuple = [initialLat, initialLng];
  const initialZoom = urlParams.has('z') ? parseInt(urlParams.get('z')!) : (savedZoom ? parseInt(savedZoom) : config.mapOptions.zoom);

  const map = L.map('map', { center: initialCenter, zoom: initialZoom, layers: [] });
  
  return map;
}
