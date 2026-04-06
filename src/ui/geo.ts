import L from 'leaflet';
import { AppState } from '../state';
import { getIconSvg } from './icons';

export type GeoStatus = 'unknown' | 'ok' | 'denied' | 'unavailable' | 'timeout';

export function initGeo(map: L.Map, state: AppState) {
  const locateBtn = document.getElementById('locate-btn');
  const geoToast = document.getElementById('geo-toast');
  let userMarker: L.Marker | null = null;
  let geoStatus: GeoStatus = 'unknown';

  const updateGeoIcon = () => {
    if (!locateBtn) return;
    const titles: Record<GeoStatus, string> = {
      unknown: 'Find My Location',
      ok: 'Find My Location',
      denied: 'Location blocked — click for help',
      unavailable: 'Location unavailable — click for help',
      timeout: 'Location timed out — click for help'
    };
    locateBtn.title = titles[geoStatus] || 'Find My Location';
    locateBtn.classList.toggle('geo-warn', geoStatus !== 'unknown' && geoStatus !== 'ok');
  };

  const detectPlatform = () => {
    const ua = navigator.userAgent;
    let os = 'unknown';
    if (/Macintosh|Mac OS X/i.test(ua)) os = 'macos';
    else if (/Windows/i.test(ua)) os = 'windows';
    else if (/Android/i.test(ua)) os = 'android';
    else if (/iPhone|iPad|iPod/i.test(ua)) os = 'ios';
    else if (/Linux/i.test(ua)) os = 'linux';
    let browser = 'unknown';
    if (/Firefox/i.test(ua)) browser = 'firefox';
    else if (/Edg\//i.test(ua)) browser = 'edge';
    else if (/Chrome/i.test(ua)) browser = 'chrome';
    else if (/Safari/i.test(ua)) browser = 'safari';
    return { os, browser };
  };

  const getGeoHelp = (code: number) => {
    const { os, browser } = detectPlatform();
    if (code === 1) {
      const steps: string[] = [];
      if (browser === 'chrome') steps.push('Click the lock/tune icon in the address bar → Site settings → Location → Allow');
      else if (browser === 'firefox') steps.push('Click the lock icon in the address bar → Clear permission for Location → Reload and allow');
      else if (browser === 'safari') steps.push('Safari → Settings → Websites → Location → set this site to Allow');
      else if (browser === 'edge') steps.push('Click the lock icon in the address bar → Permissions → Location → Allow');
      else steps.push('Check your browser\'s site permissions and allow Location access');
      if (os === 'macos') steps.push('macOS: System Settings → Privacy & Security → Location Services → enable for your browser');
      else if (os === 'windows') steps.push('Windows: Settings → Privacy & Security → Location → turn on and allow for your browser');
      else if (os === 'ios') steps.push('iOS: Settings → Privacy & Security → Location Services → turn on and allow for your browser');
      else if (os === 'android') steps.push('Android: Settings → Location → turn on; also check App permissions for your browser');
      return { title: 'Location Permission Denied', message: 'Your browser or OS is blocking location access.', steps };
    }
    if (code === 2) {
      const steps: string[] = [];
      if (os === 'macos') steps.push('macOS: System Settings → Privacy & Security → Location Services → make sure the master toggle is ON');
      else if (os === 'windows') steps.push('Windows: Settings → Privacy & Security → Location → turn on Location services');
      else if (os === 'ios') steps.push('iOS: Settings → Privacy & Security → Location Services → turn ON');
      else if (os === 'android') steps.push('Android: Settings → Location → turn ON');
      else steps.push('Check that your device\'s location/GPS service is turned on');
      steps.push('Make sure Wi-Fi is turned on (needed for location even on wired connections)');
      if (location.protocol === 'http:' && location.hostname !== 'localhost')
        steps.push('⚠ This page is served over HTTP — geolocation requires HTTPS');
      return { title: 'Location Unavailable', message: 'Your device cannot determine its position.', steps };
    }
    const steps: string[] = [];
    if (os === 'macos') {
      steps.push('macOS: System Settings → Privacy & Security → Location Services → make sure it is ON and your browser is listed');
      steps.push('Make sure Wi-Fi is turned on (macOS uses Wi-Fi for positioning)');
    } else if (os === 'windows') {
      steps.push('Windows: Settings → Privacy & Security → Location → make sure it is ON');
    } else if (os === 'ios' || os === 'android') {
      steps.push('Make sure Location/GPS is turned on in your device settings');
    } else {
      steps.push('Check that location services are enabled on your device');
    }
    steps.push('Try moving near a window or outside for better GPS signal');
    steps.push('Try reloading the page and allowing location when prompted');
    return { title: 'Location Timed Out', message: 'Could not get your position in time.', steps };
  };

  const showGeoToast = (code: number) => {
    if (!geoToast) return;
    const help = getGeoHelp(code);
    geoToast.innerHTML = `
      <div class="geo-toast-inner">
        <div class="geo-toast-header">
          ${getIconSvg('map-pin-off')}
          <strong>${help.title}</strong>
          <button class="geo-toast-close">${getIconSvg('x')}</button>
        </div>
        <p>${help.message}</p>
        <ol>${help.steps.map(s => `<li>${s}</li>`).join('')}</ol>
      </div>
    `;
    geoToast.classList.add('visible');
    geoToast.querySelector('.geo-toast-close')?.addEventListener('click', () => {
      geoToast.classList.remove('visible');
    });
  };

  const doLocate = (silent: boolean) => {
    if (!navigator.geolocation) {
      geoStatus = 'unavailable'; updateGeoIcon();
      if (!silent) showGeoToast(2);
      if (locateBtn) locateBtn.classList.remove('loading');
      return;
    }
    let settled = false;
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        if (settled) return; settled = true;
        geoStatus = 'ok'; updateGeoIcon();
        const latlng = L.latLng(pos.coords.latitude, pos.coords.longitude);
        if (userMarker) userMarker.setLatLng(latlng);
        else {
          userMarker = L.marker(latlng, {
            icon: L.divIcon({
              className: 'user-location-marker',
              html: '<div class="pulse-marker"></div>',
              iconSize: [24, 24], iconAnchor: [12, 12]
            }),
            zIndexOffset: 1000
          }).addTo(map);
          state.userLocationMarker = userMarker;
        }
        map.flyTo(latlng, 15, { duration: 1.5 });
        if (locateBtn) locateBtn.classList.remove('loading');
      },
      (err) => {
        if (settled) return; settled = true;
        if (err.code === 1) geoStatus = 'denied';
        else if (err.code === 2) geoStatus = 'unavailable';
        else geoStatus = 'timeout';
        updateGeoIcon();
        if (!silent) showGeoToast(err.code);
        if (locateBtn) locateBtn.classList.remove('loading');
      },
      { timeout: 10000, enableHighAccuracy: true }
    );
  };

  locateBtn?.addEventListener('click', () => {
    if (geoStatus !== 'ok' && geoStatus !== 'unknown') showGeoToast(geoStatus === 'denied' ? 1 : (geoStatus === 'unavailable' ? 2 : 3));
    else {
      locateBtn.classList.add('loading');
      doLocate(false);
    }
  });

  // Initial silent attempt
  doLocate(true);
}
