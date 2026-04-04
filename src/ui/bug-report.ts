import html2canvas from 'html2canvas';
import type L from 'leaflet';
import { AppState } from '../state';
import type { AppConfig } from '../types';
import { initIcons } from './icons';
import { showErrorToast } from './toasts';

const TMPFILES_UPLOAD = 'https://tmpfiles.org/api/v1/upload';
/** GitHub stores issue bodies up to 65,536 chars; stay under for query-string prefills. */
const GITHUB_BODY_SAFE_MAX = 62_000;

type Snapshot = ReturnType<typeof buildSnapshot>;

type LastReportPayload = {
  shareUrl: string;
  imageDlUrl: string | null;
  snapshot: Snapshot;
};

function buildSnapshot(_map: L.Map, state: AppState) {
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
    ui: {
      gbifPanelOpen: document.getElementById('gbif-panel')?.classList.contains('open') ?? false,
      langPanelOpen: document.getElementById('lang-panel')?.classList.contains('open') ?? false,
      legendOpen: document.getElementById('vector-legend')?.classList.contains('open') ?? false,
    },
  };
}

/**
 * tmpfiles.org returns a HTML page URL; GitHub needs the raw /dl/… URL (image/jpeg or image/png).
 */
function toTmpfilesDirectUrl(pageUrl: string): string {
  const u = new URL(pageUrl);
  return `https://tmpfiles.org/dl${u.pathname}`;
}

async function uploadScreenshotToTmpfiles(blob: Blob, filename: string): Promise<string> {
  const fd = new FormData();
  fd.append('file', blob, filename);
  const res = await fetch(TMPFILES_UPLOAD, { method: 'POST', body: fd });
  if (!res.ok) {
    throw new Error(`tmpfiles HTTP ${res.status} ${res.statusText}`);
  }
  const json = (await res.json()) as { status?: string; data?: { url?: string } };
  if (json.status !== 'success' || typeof json.data?.url !== 'string') {
    console.error('Bug report: tmpfiles unexpected JSON', { json });
    throw new Error('tmpfiles: unexpected response');
  }
  return toTmpfilesDirectUrl(json.data.url);
}

function downscaleCanvas(source: HTMLCanvasElement, maxWidth: number): HTMLCanvasElement {
  const w = source.width;
  const h = source.height;
  if (w <= maxWidth) return source;
  const nw = maxWidth;
  const nh = Math.round((h * maxWidth) / w);
  const c = document.createElement('canvas');
  c.width = nw;
  c.height = nh;
  const ctx = c.getContext('2d');
  if (!ctx) throw new Error('Could not get 2d canvas context for screenshot resize');
  ctx.drawImage(source, 0, 0, nw, nh);
  return c;
}

function canvasToJpegBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) reject(new Error('JPEG export returned null'));
        else resolve(blob);
      },
      'image/jpeg',
      quality
    );
  });
}

/** Markdown block under ### What happened (no placeholder text — user's words or a single fallback line). */
function normalizeUserDescription(raw: string): string {
  const t = raw.trim();
  if (!t) {
    return '_No description was entered in NatureMap._\n\n_See screenshot and diagnostics below._';
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
  imageDlUrl: string | null,
  diagnosticsJson: string
): string {
  const parts: string[] = [
    '### What happened',
    whatHappenedBlock,
    '',
    '### Screenshot',
    '',
  ];
  if (imageDlUrl) {
    parts.push(`![NatureMap screenshot](${imageDlUrl})`);
    parts.push('');
  } else {
    parts.push('_No auto-uploaded image — attach **Download PNG** from the bug dialog here if needed._');
    parts.push('');
  }
  parts.push('### Reproduce');
  parts.push(shareUrl);
  parts.push('');
  parts.push('### Diagnostics');
  parts.push('```json');
  parts.push(diagnosticsJson);
  parts.push('```');
  return parts.join('\n');
}

function fitIssueBody(
  userRaw: string,
  shareUrl: string,
  imageDlUrl: string | null,
  snapshot: Snapshot
): string {
  let whatHappened = normalizeUserDescription(userRaw);
  let diag = JSON.stringify(snapshot);

  for (let attempt = 0; attempt < 48; attempt++) {
    const body = assembleIssueBody(whatHappened, shareUrl, imageDlUrl, diag);
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
      imageDlUrl,
      `${diag.slice(0, 400)}…`
    );
  }
  return assembleIssueBody(whatHappened, shareUrl, imageDlUrl, diag);
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
  const imgPreview = modal.querySelector('#bug-report-preview') as HTMLImageElement | null;
  const textarea = modal.querySelector('#bug-report-diagnostics') as HTMLTextAreaElement | null;
  const btnClose = modal.querySelector('#bug-report-close') as HTMLButtonElement | null;
  const btnCopy = modal.querySelector('#bug-report-copy') as HTMLButtonElement | null;
  const btnDownload = modal.querySelector('#bug-report-download') as HTMLButtonElement | null;
  const btnGithub = modal.querySelector('#bug-report-github') as HTMLButtonElement | null;
  const statusEl = modal.querySelector('#bug-report-status') as HTMLElement | null;

  let lastPngBlob: Blob | null = null;
  let lastReport: LastReportPayload | null = null;
  let lastFilename = `naturemap-bug.png`;

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
    if (imgPreview) imgPreview.removeAttribute('src');
    lastPngBlob = null;
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
    setStatus('');
    lastReport = null;
    if (userMessage) userMessage.value = '';
    btnGithub?.classList.add('bug-report-github-disabled');

    try {
      if (state.userLocationMarker && map.getBounds().contains(state.userLocationMarker.getLatLng())) {
        showErrorToast('Privacy alert: Your location is visible on the map. Please pan away to report a bug.');
        fab.disabled = false;
        return;
      }

      state.syncStateToURL(map);
      const shareUrl = state.getRedactedURL();
      const snapshot = buildSnapshot(map, state);

      const canvas = await html2canvas(document.body, {
        useCORS: true,
        allowTaint: false,
        scale: Math.min(2, window.devicePixelRatio || 1),
        logging: false,
        ignoreElements: (element) => {
          if (element.closest('.bug-report-ui')) return true;
          return element.id === 'splash-screen';
        },
      });

      await new Promise<void>((resolve, reject) => {
        canvas.toBlob(
          (blob) => {
            if (!blob) {
              reject(new Error('PNG toBlob returned null'));
              return;
            }
            lastPngBlob = blob;
            resolve();
          },
          'image/png',
          0.92
        );
      });

      lastFilename = `naturemap-bug-${new Date().toISOString().replace(/[:.]/g, '-')}.png`;

      const dataUrl = canvas.toDataURL('image/png');
      if (imgPreview) imgPreview.src = dataUrl;
      if (textarea) textarea.value = JSON.stringify(snapshot, null, 2);

      let imageDlUrl: string | null = null;
      const skipUpload = config.issueTracker?.skipTemporaryImageUpload === true;

      if (!skipUpload) {
        setStatus('Uploading screenshot for GitHub (temporary host)…');
        try {
          const scaled = downscaleCanvas(canvas, 1920);
          const jpeg = await canvasToJpegBlob(scaled, 0.82);
          imageDlUrl = await uploadScreenshotToTmpfiles(jpeg, 'naturemap-screenshot.jpg');
        } catch (error) {
          console.error('Bug report: temporary image upload failed', {
            endpoint: TMPFILES_UPLOAD,
            error,
          });
          showErrorToast(
            'Screenshot could not be uploaded for the GitHub issue link. Diagnostics are still included; use Download PNG to attach the image.'
          );
        }
      }

      lastReport = { shareUrl, imageDlUrl, snapshot };

      const hasTracker = Boolean(config.issueTracker?.newIssueUrl?.trim());
      if (hasTracker) {
        btnGithub?.classList.remove('bug-report-github-disabled');
      } else {
        btnGithub?.classList.add('bug-report-github-disabled');
      }

      setStatus(
        hasTracker
          ? skipUpload
            ? 'Describe the bug, then open GitHub — your text, diagnostics, and attach PNG if needed.'
            : imageDlUrl
              ? 'Describe the bug, then open GitHub — your text, screenshot, and diagnostics will be prefilled.'
              : 'Describe the bug, then open GitHub — your text and diagnostics will be prefilled (attach PNG if needed).'
          : 'Set issueTracker.newIssueUrl in config.json to open GitHub from here.'
      );

      openModal();
    } catch (error) {
      console.error('Bug report capture failed', { error });
      showErrorToast(
        'Could not capture the screen. Try again, or use a system screenshot and your share URL from the address bar.'
      );
    } finally {
      fab.disabled = false;
    }
  });

  btnGithub?.addEventListener('click', () => {
    if (!lastReport || btnGithub.classList.contains('bug-report-github-disabled')) {
      showErrorToast('Set issueTracker.newIssueUrl in config.json to open GitHub, or capture again.');
      return;
    }
    const userRaw = userMessage?.value ?? '';
    const body = fitIssueBody(userRaw, lastReport.shareUrl, lastReport.imageDlUrl, lastReport.snapshot);
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
      setStatus('Diagnostics copied (fallback).');
    } catch (error) {
      console.error('Bug report: clipboard write failed', { error });
      showErrorToast('Could not copy to clipboard.');
    }
  });

  btnDownload?.addEventListener('click', () => {
    const blob = lastPngBlob;
    if (!blob) {
      console.error('Bug report: no PNG blob for download');
      showErrorToast('No screenshot available. Close and try Report bug again.');
      return;
    }
    const a = document.createElement('a');
    const url = URL.createObjectURL(blob);
    a.href = url;
    a.download = lastFilename;
    a.click();
    URL.revokeObjectURL(url);
    setStatus('PNG download started.');
  });
}
