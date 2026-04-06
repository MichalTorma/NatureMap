import { getIconSvg } from './icons';
import {
  DEPENDENCY_INFO,
  getHealthLevel,
  getLastHealthSnapshot,
  runExternalHealthChecks,
  subscribeHealthSnapshots,
  userHintForDependency,
  type DependencyId,
  type HealthSnapshot,
} from '../health/external-status';

const REFRESH_COOLDOWN_MS = 30_000;
let lastManualRefresh = 0;

function formatCheckedAt(ts: number): string {
  const relative = Date.now() - ts;
  if (relative < 5000) return 'just now';
  if (relative < 60_000) return `${Math.round(relative / 1000)}s ago`;
  if (relative < 3600_000) return `${Math.round(relative / 60_000)}m ago`;
  return new Date(ts).toLocaleString();
}

function renderDetailList(snap: HealthSnapshot, listEl: HTMLElement) {
  listEl.innerHTML = '';
  const order: DependencyId[] = ['gbif_rest', 'gbif_maps', 'wikidata'];
  for (const id of order) {
    const r = snap.dependencies[id];
    const meta = DEPENDENCY_INFO[id];
    const row = document.createElement('div');
    row.className = 'external-status-row';
    const ok = r.ok;
    row.innerHTML = `
      <div class="external-status-row-head">
        <span class="external-status-dot ${ok ? 'ok' : 'bad'}" aria-hidden="true"></span>
        <span class="external-status-name">${meta.label}</span>
      </div>
      <p class="external-status-hint">${userHintForDependency(r)}</p>
      <a class="external-status-link" href="${meta.helpUrl}" target="_blank" rel="noopener noreferrer">Status / help ${getIconSvg('external-link')}</a>
    `;
    listEl.appendChild(row);
  }

  const foot = document.createElement('p');
  foot.className = 'external-status-foot';
  foot.textContent =
    'Basemap tiles (OpenStreetMap, etc.) are not checked here — a blank base map usually means a provider or network issue.';
  listEl.appendChild(foot);
}

export function initExternalStatusUi(): void {
  const btn = document.getElementById('external-status-btn') as HTMLButtonElement | null;
  const popover = document.getElementById('external-status-popover');
  const dot = document.getElementById('external-status-dot');
  const listEl = document.getElementById('external-status-list');
  const refreshBtn = document.getElementById('external-status-refresh');
  const summaryEl = document.getElementById('external-status-summary');

  if (!btn || !popover || !dot || !listEl || !refreshBtn) {
    console.error('external-status-ui: missing DOM nodes', {
      hasBtn: !!btn,
      hasPopover: !!popover,
    });
    return;
  }

  let open = false;

  const closePopover = () => {
    open = false;
    btn.setAttribute('aria-expanded', 'false');
    popover.classList.remove('open');
  };

  const applySnapshot = (snap: HealthSnapshot | null) => {
    const level = getHealthLevel(snap);
    const showBubble = snap !== null && level !== 'ok';

    dot.className =
      'external-status-dot' +
      (level === 'ok'
        ? ' ok'
        : level === 'degraded'
          ? ' warn'
          : level === 'critical'
            ? ' bad'
            : ' unknown');

    if (showBubble) {
      btn.hidden = false;
      if (level === 'degraded') {
        btn.title = 'Wikidata may be unavailable — tap for details';
        btn.setAttribute('aria-label', 'External services: Wikidata issue — view details');
      } else if (level === 'critical') {
        btn.title = 'GBIF or essential services look unavailable — tap for details';
        btn.setAttribute('aria-label', 'External services: critical issue — view details');
      } else {
        btn.title = 'Checking external services…';
        btn.setAttribute('aria-label', 'External services status');
      }
    } else {
      btn.hidden = true;
      btn.title = '';
      closePopover();
    }

    if (snap && summaryEl) {
      const when = formatCheckedAt(snap.checkedAt);
      summaryEl.textContent = `Last check: ${when}`;
    } else if (summaryEl) {
      summaryEl.textContent = 'Running checks…';
    }
    if (open && snap) renderDetailList(snap, listEl);
  };

  subscribeHealthSnapshots((snap) => applySnapshot(snap));

  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (btn.hidden) return;
    open = !open;
    btn.setAttribute('aria-expanded', open ? 'true' : 'false');
    popover.classList.toggle('open', open);
    const snap = getLastHealthSnapshot();
    if (open && snap) renderDetailList(snap, listEl);
    else if (open && !snap) {
      listEl.innerHTML = `<p class="external-status-loading">Running checks…</p>`;
    }
  });

  document.addEventListener('click', (e) => {
    if (!popover.classList.contains('open')) return;
    if (btn.contains(e.target as Node) || popover.contains(e.target as Node)) return;
    closePopover();
  });

  const runRefresh = async (isManual: boolean) => {
    if (isManual) {
      const now = Date.now();
      if (now - lastManualRefresh < REFRESH_COOLDOWN_MS) {
        const wait = Math.ceil((REFRESH_COOLDOWN_MS - (now - lastManualRefresh)) / 1000);
        if (summaryEl) summaryEl.textContent = `Wait ${wait}s before refreshing again`;
        return;
      }
      lastManualRefresh = now;
    }
    refreshBtn.setAttribute('disabled', 'true');
    try {
      await runExternalHealthChecks();
    } catch (err) {
      console.error('runExternalHealthChecks failed', err);
    } finally {
      refreshBtn.removeAttribute('disabled');
    }
  };

  refreshBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    void runRefresh(true);
  });

  void runExternalHealthChecks();
  setInterval(() => void runExternalHealthChecks(), 10 * 60 * 1000);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void runExternalHealthChecks();
  });
}
