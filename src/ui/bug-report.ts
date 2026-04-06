import type L from 'leaflet';
import { AppState } from '../state';
import type { AppConfig } from '../types';
import { vnCache, wikidataCache } from '../map/gbif';
import { initIcons } from './icons';
import { showErrorToast } from './toasts';

/** GitHub stores issue bodies up to 65,536 chars; stay under for query-string prefills. */
const GITHUB_BODY_SAFE_MAX = 62_000;

type Snapshot = ReturnType<typeof buildSnapshot>;

type LastReportPayload = {
  shareUrl: string;
  snapshot: Snapshot;
};

function buildSnapshot(_map: L.Map, state: AppState) {
  const activeMarkerEntry = state.vectorMarkers.find(m => m.marker.isPopupOpen());
  
  // Species Summary from current vector markers
  const speciesMap = new Map<number, { name: string, count: number }>();
  state.vectorMarkers.forEach(m => {
    const key = m.taxonomy.speciesKey;
    if (typeof key === 'number' && key > 0) {
      const existing = speciesMap.get(key);
      if (existing) {
        existing.count++;
      } else {
        speciesMap.set(key, { name: m.taxonomy.species, count: 1 });
      }
    }
  });
  const loadedSpecies = Array.from(speciesMap.entries()).map(([key, info]) => {
    const translations = {
      gbif: vnCache.get(key) || [],
      wikidata: wikidataCache.get(key)?.labels || {}
    };
    return {
      key,
      name: info.name,
      count: info.count,
      translations
    };
  });

  return {
    capturedAt: new Date().toISOString(),
    url: window.location.href,
    viewport: {
      width: window.innerWidth,
      height: window.innerHeight,
      devicePixelRatio: window.devicePixelRatio,
    },
    userAgent: navigator.userAgent,
    map: {
      center: ['<redacted>', '<redacted>'],
      zoom: _map.getZoom(),
      bounds: {
        south: '<redacted>',
        west: '<redacted>',
        north: '<redacted>',
        east: '<redacted>',
      },
    },
    app: {
      gbifEnabled: state.gbifEnabled,
      currentTaxonKey: state.currentTaxonKey,
      currentYear: state.currentYear,
      currentOrigins: state.currentOrigins,
      currentOpacity: state.currentOpacity,
      currentDensity: state.currentDensity,
      currentPalette: state.currentPalette,
      currentRenderMode: state.currentRenderMode,
      currentNoBorders: state.currentNoBorders,
      currentBaseLayer: state.currentBaseLayer,
      activeOverlayIds: [...state.activeOverlayIds],
      userLanguages: state.userLanguages,
    },
    vectorMarkerCount: state.vectorMarkers?.length ?? 0,
    activeMarker: activeMarkerEntry ? {
      occurrenceKey: activeMarkerEntry.occurrenceKey,
      taxonomy: activeMarkerEntry.taxonomy,
    } : null,
    loadedSpeciesSummary: loadedSpecies,
    ui: {
      gbifPanelOpen: document.getElementById('gbif-panel')?.classList.contains('open') ?? false,
      langPanelOpen: document.getElementById('lang-panel')?.classList.contains('open') ?? false,
      legendOpen: document.getElementById('vector-legend')?.classList.contains('open') ?? false,
    },
  };
}



/** Markdown block under ### What happened (no placeholder text — user's words or a single fallback line). */
function normalizeUserDescription(raw: string): string {
  const t = raw.trim();
  if (!t) {
    return '_No description was entered in NatureMap._\n\n_See diagnostics below._';
  }
  return t;
}

/** GitHub issue title from the first non-empty line of the user's text. */
function issueTitleForGithub(userRaw: string): string {
  const t = userRaw.trim();
  if (!t) return 'Bug report';
  const line =
    t
      .split(/\r?\n/)
      .map((s) => s.trim())
      .find((s) => s.length > 0) ?? '';
  const max = 90;
  const head = line.length <= max ? line : `${line.slice(0, max - 1)}…`;
  return `Bug: ${head}`;
}

function assembleIssueBody(
  whatHappenedBlock: string,
  shareUrl: string,
  diagnosticsJson: string
): string {
  const parts: string[] = [
    '### What happened',
    whatHappenedBlock,
    '',
    '### Reproduce',
    shareUrl,
    '',
    '### Diagnostics',
    '```json',
    diagnosticsJson,
    '```',
  ];
  return parts.join('\n');
}

function fitIssueBody(
  userRaw: string,
  shareUrl: string,
  snapshot: Snapshot
): string {
  let whatHappened = normalizeUserDescription(userRaw);
  let diag = JSON.stringify(snapshot);

  for (let attempt = 0; attempt < 48; attempt++) {
    const body = assembleIssueBody(whatHappened, shareUrl, diag);
    if (body.length <= GITHUB_BODY_SAFE_MAX) return body;

    if (diag.length > 600) {
      diag = `${diag.slice(0, Math.floor(diag.length * 0.88))}…\n[truncated: diagnostics too large for GitHub link]`;
      continue;
    }
    if (whatHappened.length > 400) {
      whatHappened = `${whatHappened.slice(0, Math.floor(whatHappened.length * 0.82))}…\n\n_[Truncated: description was shortened to fit GitHub.]_`;
      continue;
    }
    console.error('Bug report: cannot fit issue body under limit', {
      attempt,
      bodyLength: body.length,
    });
    return assembleIssueBody(
      '_[Report content was too large for a single pre-filled link. Use **Copy diagnostics** and file the issue manually.]_',
      shareUrl,
      `${diag.slice(0, 400)}…`
    );
  }
  return assembleIssueBody(whatHappened, shareUrl, diag);
}

function buildGithubNewIssueUrl(config: AppConfig, issueBody: string, issueTitle: string): string | null {
  const raw = config.issueTracker?.newIssueUrl?.trim();
  if (!raw) return null;
  try {
    const u = new URL(raw);
    u.searchParams.set('title', issueTitle);
    u.searchParams.set('body', issueBody);
    const tpl = config.issueTracker?.template?.trim();
    if (tpl) u.searchParams.set('template', tpl);
    const s = u.toString();
    if (s.length > 2_000_000) {
      console.error('Bug report: issue URL exceeds safe length', { length: s.length });
      const u2 = new URL(raw);
      u2.searchParams.set('title', issueTitle);
      u2.searchParams.set(
        'body',
        `Prefill URL was too large. Reproduce: ${window.location.href}\n\nUse **Copy diagnostics** from the bug dialog.`
      );
      return u2.toString();
    }
    return s;
  } catch (error) {
    console.error('Invalid issueTracker.newIssueUrl in config', { raw, error });
    return null;
  }
}

export function initBugReport(map: L.Map, state: AppState, config: AppConfig): void {
  const fab = document.getElementById('bug-report-fab') as HTMLButtonElement | null;
  const modal = document.getElementById('bug-report-modal');
  if (!fab || !modal) {
    console.error('initBugReport: missing DOM nodes', { fab: !!fab, modal: !!modal });
    return;
  }

  const userMessage = modal.querySelector('#bug-report-user-message') as HTMLTextAreaElement | null;
  const textarea = modal.querySelector('#bug-report-diagnostics') as HTMLTextAreaElement | null;
  const btnClose = modal.querySelector('#bug-report-close') as HTMLButtonElement | null;
  const btnCopy = modal.querySelector('#bug-report-copy') as HTMLButtonElement | null;
  const btnGithub = modal.querySelector('#bug-report-github') as HTMLButtonElement | null;
  const statusEl = modal.querySelector('#bug-report-status') as HTMLElement | null;

  let lastReport: LastReportPayload | null = null;

  const setStatus = (msg: string) => {
    if (statusEl) statusEl.textContent = msg;
  };

  const openModal = () => {
    modal.classList.remove('hidden');
    modal.setAttribute('aria-hidden', 'false');
    initIcons(modal);
    requestAnimationFrame(() => {
      userMessage?.focus();
    });
  };

  const closeModal = () => {
    modal.classList.add('hidden');
    modal.setAttribute('aria-hidden', 'true');
    lastReport = null;
    setStatus('');
  };

  btnClose?.addEventListener('click', closeModal);
  modal.addEventListener('click', (e) => {
    if (e.target === modal) closeModal();
  });

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape' && !modal.classList.contains('hidden')) {
      e.preventDefault();
      closeModal();
    }
  };
  document.addEventListener('keydown', onKeyDown);

  fab.addEventListener('click', async () => {
    fab.disabled = true;
    fab.classList.add('loading');
    setStatus('');
    lastReport = null;
    if (userMessage) userMessage.value = '';
    btnGithub?.classList.add('bug-report-github-disabled');

    try {
      // Small delay to let the browser render the loading state
      await new Promise(resolve => requestAnimationFrame(resolve));

      if (state.userLocationMarker && map.getBounds().contains(state.userLocationMarker.getLatLng())) {
        showErrorToast('Privacy alert: Your location is visible on the map. Please pan away to report a bug.');
        return;
      }

      state.syncStateToURL(map);
      const shareUrl = state.getRedactedURL();
      const snapshot = buildSnapshot(map, state);

      if (textarea) textarea.value = JSON.stringify(snapshot, null, 2);

      lastReport = { shareUrl, snapshot };

      const hasTracker = Boolean(config.issueTracker?.newIssueUrl?.trim());
      if (hasTracker) {
        btnGithub?.classList.remove('bug-report-github-disabled');
      } else {
        btnGithub?.classList.add('bug-report-github-disabled');
      }

      setStatus(
        hasTracker
          ? 'Describe the bug, then open GitHub — your text and diagnostics will be prefilled.'
          : 'Set issueTracker.newIssueUrl in config.json to open GitHub from here.'
      );

      openModal();
    } catch (error) {
      console.error('Bug report creation failed', { error });
      showErrorToast(
        'Could not prepare the report. Try again, or use your share URL from the address bar.'
      );
    } finally {
      fab.disabled = false;
      fab.classList.remove('loading');
    }
  });

  btnGithub?.addEventListener('click', () => {
    if (!lastReport || btnGithub.classList.contains('bug-report-github-disabled')) {
      showErrorToast('Set issueTracker.newIssueUrl in config.json to open GitHub, or report again.');
      return;
    }
    const userRaw = userMessage?.value ?? '';
    const body = fitIssueBody(userRaw, lastReport.shareUrl, lastReport.snapshot);
    const title = issueTitleForGithub(userRaw);
    const url = buildGithubNewIssueUrl(config, body, title);
    if (!url) {
      console.error('Bug report: missing issue tracker URL');
      showErrorToast('Set issueTracker.newIssueUrl in config.json to open GitHub.');
      return;
    }
    window.open(url, '_blank', 'noopener,noreferrer');
    setStatus('GitHub opened in a new tab — review the draft and submit.');
  });

  btnCopy?.addEventListener('click', async () => {
    const text = textarea?.value ?? '';
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setStatus('Diagnostics copied.');
    } catch (error) {
      console.error('Bug report: clipboard write failed', { error });
      showErrorToast('Could not copy to clipboard.');
    }
  });
}
