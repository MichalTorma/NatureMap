/**
 * Proactive checks and messaging for third-party services used by the app.
 * Official status pages are linked for humans; probes use the same hosts as the app.
 */

export type DependencyId = 'gbif_rest' | 'gbif_maps' | 'wikidata';

export type FailureKind =
  | 'ok'
  | 'timeout'
  | 'network'
  | 'http'
  | 'invalid_response'
  | 'tile_load';

export interface DependencyResult {
  id: DependencyId;
  ok: boolean;
  kind: FailureKind;
  httpStatus?: number;
  checkedAt: number;
  detail?: string;
}

export interface HealthSnapshot {
  checkedAt: number;
  dependencies: Record<DependencyId, DependencyResult>;
}

export const DEPENDENCY_INFO: Record<DependencyId, { label: string; helpUrl: string }> = {
  gbif_rest: { label: 'GBIF API', helpUrl: 'https://www.gbif.org/system-health' },
  gbif_maps: { label: 'GBIF map tiles', helpUrl: 'https://www.gbif.org/system-health' },
  wikidata: { label: 'Wikidata', helpUrl: 'https://www.wikimedia.org/status/' },
};

const GBIF_REST_URL =
  'https://api.gbif.org/v1/occurrence/search?limit=0&occurrenceStatus=PRESENT';
/** Single world tile; same endpoint family as the map layer. */
const GBIF_MAP_TILE_URL =
  'https://api.gbif.org/v2/map/occurrence/density/0/0/0@1x.png?srs=EPSG:3857&style=classic.poly';
const WIKIDATA_URL = 'https://www.wikidata.org/w/api.php?action=query&meta=siteinfo&format=json&origin=*';

const PROBE_TIMEOUT_MS = 10_000;

let lastProbeSnapshot: HealthSnapshot | null = null;
/** When many tileerror events fire but REST/map probe still passes (rare). */
let clientTileMapsFailure: DependencyResult | null = null;

let onSnapshotListeners: Array<(snap: HealthSnapshot | null) => void> = [];

export function subscribeHealthSnapshots(cb: (snap: HealthSnapshot | null) => void): () => void {
  onSnapshotListeners.push(cb);
  cb(getLastHealthSnapshot());
  return () => {
    onSnapshotListeners = onSnapshotListeners.filter((x) => x !== cb);
  };
}

function emitSnapshot() {
  const snap = getLastHealthSnapshot();
  for (const cb of onSnapshotListeners) cb(snap);
}

function mergeTileClientInto(snap: HealthSnapshot): HealthSnapshot {
  if (!clientTileMapsFailure || !snap.dependencies.gbif_maps.ok) return snap;
  return {
    ...snap,
    dependencies: {
      ...snap.dependencies,
      gbif_maps: clientTileMapsFailure,
    },
  };
}

export function getLastHealthSnapshot(): HealthSnapshot | null {
  if (!lastProbeSnapshot) return null;
  return mergeTileClientInto(lastProbeSnapshot);
}

export function getHealthLevel(snap: HealthSnapshot | null): 'unknown' | 'ok' | 'degraded' | 'critical' {
  if (!snap) return 'unknown';
  const { gbif_rest, gbif_maps, wikidata } = snap.dependencies;
  if (!gbif_rest.ok || !gbif_maps.ok) return 'critical';
  if (!wikidata.ok) return 'degraded';
  return 'ok';
}

function classifyError(error: unknown, res?: Response | null): Omit<DependencyResult, 'id' | 'checkedAt'> {
  if (res && !res.ok) {
    return {
      ok: false,
      kind: 'http',
      httpStatus: res.status,
      detail: `HTTP ${res.status} ${res.statusText || ''}`.trim(),
    };
  }
  if (error instanceof DOMException && error.name === 'AbortError') {
    return {
      ok: false,
      kind: 'timeout',
      detail: 'Request timed out',
    };
  }
  if (error instanceof TypeError) {
    return {
      ok: false,
      kind: 'network',
      detail: error.message || 'Network error',
    };
  }
  if (error instanceof Error) {
    return {
      ok: false,
      kind: 'network',
      detail: error.message,
    };
  }
  return {
    ok: false,
    kind: 'network',
    detail: String(error),
  };
}

async function probeGbifRest(): Promise<DependencyResult> {
  const id = 'gbif_rest' as const;
  const checkedAt = Date.now();
  try {
    const res = await fetch(GBIF_REST_URL, {
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
    if (!res.ok) {
      return { id, checkedAt, ...classifyError(new Error('bad status'), res) };
    }
    let data: unknown;
    try {
      data = await res.json();
    } catch {
      return {
        id,
        ok: false,
        kind: 'invalid_response',
        checkedAt,
        detail: 'Response was not valid JSON',
      };
    }
    if (typeof data !== 'object' || data === null || !('endOfRecords' in data)) {
      return {
        id,
        ok: false,
        kind: 'invalid_response',
        checkedAt,
        detail: 'Unexpected GBIF search response shape',
      };
    }
    return { id, ok: true, kind: 'ok', checkedAt };
  } catch (e) {
    return { id, checkedAt, ...classifyError(e) };
  }
}

async function probeGbifMaps(): Promise<DependencyResult> {
  const id = 'gbif_maps' as const;
  const checkedAt = Date.now();
  try {
    const res = await fetch(GBIF_MAP_TILE_URL, {
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
    if (!res.ok) {
      return { id, checkedAt, ...classifyError(new Error('bad status'), res) };
    }
    const ct = res.headers.get('content-type') || '';
    const looksLikeImageType = ct.includes('image/png') || ct.includes('image/');
    if (!looksLikeImageType) {
      const buf = await res.arrayBuffer().catch(() => null);
      const u8 = buf ? new Uint8Array(buf) : null;
      const pngMagic =
        u8 &&
        u8.length >= 8 &&
        u8[0] === 0x89 &&
        u8[1] === 0x50 &&
        u8[2] === 0x4e &&
        u8[3] === 0x47;
      if (!pngMagic) {
        console.warn('GBIF map tile probe: not a PNG', { contentType: ct, byteLength: buf?.byteLength });
        return {
          id,
          ok: false,
          kind: 'invalid_response',
          checkedAt,
          detail: `Expected a PNG map tile; got ${ct || 'unknown type'}`,
        };
      }
    }
    return { id, ok: true, kind: 'ok', checkedAt };
  } catch (e) {
    return { id, checkedAt, ...classifyError(e) };
  }
}

async function probeWikidata(): Promise<DependencyResult> {
  const id = 'wikidata' as const;
  const checkedAt = Date.now();
  try {
    const res = await fetch(WIKIDATA_URL, {
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
    if (!res.ok) {
      return { id, checkedAt, ...classifyError(new Error('bad status'), res) };
    }
    const data = await res.json().catch(() => null);
    if (!data || typeof data !== 'object' || !('query' in (data as object))) {
      return {
        id,
        ok: false,
        kind: 'invalid_response',
        checkedAt,
        detail: 'Unexpected Wikidata API response',
      };
    }
    return { id, ok: true, kind: 'ok', checkedAt };
  } catch (e) {
    return { id, checkedAt, ...classifyError(e) };
  }
}

export async function runExternalHealthChecks(): Promise<HealthSnapshot> {
  const [gbif_rest, gbif_maps, wikidata] = await Promise.all([
    probeGbifRest(),
    probeGbifMaps(),
    probeWikidata(),
  ]);

  if (gbif_maps.ok) {
    clientTileMapsFailure = null;
  }

  const snapshot: HealthSnapshot = {
    checkedAt: Math.max(gbif_rest.checkedAt, gbif_maps.checkedAt, wikidata.checkedAt),
    dependencies: { gbif_rest, gbif_maps, wikidata },
  };
  lastProbeSnapshot = snapshot;
  emitSnapshot();
  return getLastHealthSnapshot()!;
}

/** Leaflet tileerror storm: mark map tiles unhealthy and refresh subscribers. */
const TILE_ERROR_THRESHOLD = 8;
const TILE_ERROR_WINDOW_MS = 2800;

let tileErrorCount = 0;
let tileErrorWindowTimer: ReturnType<typeof setTimeout> | null = null;
let tileFailureToastSentAt = 0;

export function recordGbifMapTileError(): void {
  tileErrorCount += 1;
  if (tileErrorWindowTimer) clearTimeout(tileErrorWindowTimer);
  tileErrorWindowTimer = setTimeout(() => {
    tileErrorCount = 0;
    tileErrorWindowTimer = null;
  }, TILE_ERROR_WINDOW_MS);

  if (tileErrorCount < TILE_ERROR_THRESHOLD) return;

  tileErrorCount = 0;
  if (tileErrorWindowTimer) clearTimeout(tileErrorWindowTimer);
  tileErrorWindowTimer = null;

  clientTileMapsFailure = {
    id: 'gbif_maps',
    ok: false,
    kind: 'tile_load',
    checkedAt: Date.now(),
    detail: 'Many map tiles failed to load (browser could not load GBIF images).',
  };
  emitSnapshot();
}

/** Single toast path for tile failures; cooldown avoids spam. */
export function shouldShowGbifTileFailureToast(cooldownMs = 90_000): boolean {
  const now = Date.now();
  if (now - tileFailureToastSentAt < cooldownMs) return false;
  tileFailureToastSentAt = now;
  return true;
}

export function userHintForDependency(r: DependencyResult): string {
  if (r.ok) return 'Operational.';
  const info = DEPENDENCY_INFO[r.id];
  switch (r.kind) {
    case 'timeout':
      return `No response in time. Your network may be slow, or ${info.label} may be overloaded.`;
    case 'network':
      return `Could not complete the request. Check your connection or try again. If others fail too, ${info.label} may be unreachable.`;
    case 'http':
      return `Server returned ${r.httpStatus ?? 'an error'}. The service may be under maintenance — see status link.`;
    case 'invalid_response':
      return r.detail || 'The service returned an unexpected response.';
    case 'tile_load':
      return r.detail || 'Map tiles failed in the browser.';
    default:
      return r.detail || 'Check failed.';
  }
}

export function describeFetchFailure(
  serviceKey: 'gbif' | 'wikidata',
  error: unknown,
  res: Response | null | undefined,
  snapshot: HealthSnapshot | null,
): string {
  const parts: string[] = [];
  if (serviceKey === 'gbif') {
    const snap = snapshot ?? getLastHealthSnapshot();
    if (snap && !snap.dependencies.gbif_rest.ok) {
      parts.push(
        `GBIF API looks unreachable (${snap.dependencies.gbif_rest.detail || snap.dependencies.gbif_rest.kind}).`,
      );
    }
  }
  if (res && !res.ok) {
    parts.push(`HTTP ${res.status} ${res.statusText}`.trim());
  } else {
    if (error instanceof DOMException && error.name === 'AbortError') {
      parts.push('Request timed out');
    } else if (error instanceof Error) {
      parts.push(error.message);
    } else if (error != null) {
      parts.push('Request failed');
    }
  }
  const help =
    serviceKey === 'gbif'
      ? ' See https://www.gbif.org/system-health for GBIF status.'
      : ' See https://www.wikimedia.org/status/ if the problem persists.';
  return parts.filter(Boolean).join(' — ') + help;
}
