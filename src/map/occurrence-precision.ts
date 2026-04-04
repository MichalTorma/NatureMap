/**
 * Location uncertainty for GBIF occurrences: stated meters, coordinatePrecision°, or decimal-place heuristic.
 */

export type PrecisionTier = 'tight' | 'medium' | 'coarse' | 'unknown';

export type UncertaintySource =
  | 'gbif_uncertainty_meters'
  | 'gbif_coordinate_precision'
  | 'estimated_from_decimals'
  | 'unknown';

export interface ResolvedLocationUncertainty {
  meters: number | null;
  source: UncertaintySource;
  /** When true, badge is prefixed with ~ and popup explains estimation */
  isEstimate: boolean;
  detail: {
    /** coordinatePrecision interpreted as decimal degrees */
    precisionDeg?: number;
    /** coordinatePrecision interpreted as “number of decimal digits” */
    asDecimalDigits?: number;
    decimalPlacesLat?: number;
    decimalPlacesLng?: number;
  };
}

const M_PER_DEG_LAT = 111_320;
export const MAX_UNCERTAINTY_DISPLAY_M = 250_000;

function halfDiagonalMetersFromSteps(stepLatDeg: number, stepLngDeg: number, latDeg: number): number {
  const latRad = (latDeg * Math.PI) / 180;
  const ns = stepLatDeg * M_PER_DEG_LAT;
  const ew = stepLngDeg * M_PER_DEG_LAT * Math.max(Math.cos(latRad), 0.05);
  return 0.5 * Math.hypot(ns, ew);
}

function parseNumericField(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string') {
    const t = v.trim();
    if (!t) return null;
    const x = Number(t);
    return Number.isFinite(x) ? x : null;
  }
  return null;
}

/** Fractional decimal places inferred from a JS number (trailing zeros in JSON are lost). */
function decimalPlacesFromNumber(n: number): number {
  if (!Number.isFinite(n)) return 0;
  let s = n.toFixed(10);
  if (s.includes('.')) s = s.replace(/\.?0+$/, '');
  const i = s.indexOf('.');
  if (i < 0) return 0;
  return Math.min(s.length - i - 1, 8);
}

function capMeters(m: number): number {
  return Math.min(Math.max(m, 1), MAX_UNCERTAINTY_DISPLAY_M);
}

function metersFromCoordinatePrecisionField(
  occ: Record<string, unknown>,
  latDeg: number,
): { meters: number; precisionDeg?: number; asDecimalDigits?: number } | null {
  const p = parseNumericField(occ.coordinatePrecision);
  if (p === null || p <= 0) return null;

  // Integer 1..15: treat as “coordinates given to N decimal places”
  if (p >= 1 && p <= 15 && Number.isInteger(p)) {
    const deg = Math.pow(10, -p);
    const m = halfDiagonalMetersFromSteps(deg, deg, latDeg);
    return { meters: capMeters(m), asDecimalDigits: p };
  }

  // Typical Darwin Core: precision in decimal degrees (e.g. 0.00001)
  if (p < 1) {
    const m = halfDiagonalMetersFromSteps(p, p, latDeg);
    return { meters: capMeters(m), precisionDeg: p };
  }

  return null;
}

function estimateMetersFromDecimalPlaces(lat: number, lng: number): {
  meters: number;
  decimalPlacesLat: number;
  decimalPlacesLng: number;
} | null {
  const dlat = decimalPlacesFromNumber(lat);
  const dlng = decimalPlacesFromNumber(lng);
  const stepLatDeg = dlat > 0 ? Math.pow(10, -dlat) : 1;
  const stepLngDeg = dlng > 0 ? Math.pow(10, -dlng) : 1;
  const m = halfDiagonalMetersFromSteps(stepLatDeg, stepLngDeg, lat);
  if (!Number.isFinite(m) || m <= 0) return null;
  return {
    meters: capMeters(m),
    decimalPlacesLat: dlat,
    decimalPlacesLng: dlng,
  };
}

export function resolveLocationUncertainty(occ: Record<string, unknown>): ResolvedLocationUncertainty {
  const lat = parseNumericField(occ.decimalLatitude);
  const lng = parseNumericField(occ.decimalLongitude);
  const emptyDetail = {} as ResolvedLocationUncertainty['detail'];

  if (lat === null || lng === null) {
    return { meters: null, source: 'unknown', isEstimate: false, detail: emptyDetail };
  }

  const explicit = parseNumericField(occ.coordinateUncertaintyInMeters);
  if (explicit !== null && explicit > 0) {
    return {
      meters: explicit,
      source: 'gbif_uncertainty_meters',
      isEstimate: false,
      detail: emptyDetail,
    };
  }

  const fromPrec = metersFromCoordinatePrecisionField(occ, lat);
  if (fromPrec !== null) {
    return {
      meters: fromPrec.meters,
      source: 'gbif_coordinate_precision',
      isEstimate: true,
      detail: {
        precisionDeg: fromPrec.precisionDeg,
        asDecimalDigits: fromPrec.asDecimalDigits,
      },
    };
  }

  const fromDec = estimateMetersFromDecimalPlaces(lat, lng);
  if (fromDec !== null) {
    return {
      meters: fromDec.meters,
      source: 'estimated_from_decimals',
      isEstimate: true,
      detail: {
        decimalPlacesLat: fromDec.decimalPlacesLat,
        decimalPlacesLng: fromDec.decimalPlacesLng,
      },
    };
  }

  return { meters: null, source: 'unknown', isEstimate: false, detail: emptyDetail };
}

export function precisionTierFromResolved(res: ResolvedLocationUncertainty): PrecisionTier {
  return precisionTierFromUncertaintyMeters(res.meters);
}

export function precisionTierFromUncertaintyMeters(meters: number | null): PrecisionTier {
  if (meters === null) return 'unknown';
  if (meters <= 30) return 'tight';
  if (meters <= 2000) return 'medium';
  return 'coarse';
}

function formatShortMeters(m: number): string {
  if (m < 1000) return `${Math.round(m)}m`;
  return `${Math.round(m / 1000)}km`;
}

export function shortUncertaintyBadgeText(res: ResolvedLocationUncertainty): string {
  if (res.meters === null) return '?';
  const core = formatShortMeters(res.meters);
  return res.isEstimate ? `~${core}` : core;
}

function plainRadiusText(meters: number): string {
  if (meters < 1000) return `${Math.round(meters)} metres`;
  if (meters < 10_000) return `${(meters / 1000).toFixed(1)} km`;
  return `${Math.round(meters / 1000)} km`;
}

export function uncertaintyBadgeTitle(res: ResolvedLocationUncertainty): string {
  if (res.meters === null) {
    return 'No uncertainty field and no coordinatePrecision — we cannot draw a radius. Open GBIF for the full record.';
  }
  const r = plainRadiusText(res.meters);
  if (res.source === 'gbif_uncertainty_meters') {
    return `Publisher stated uncertainty: about ${r} (coordinateUncertaintyInMeters).`;
  }
  if (res.source === 'gbif_coordinate_precision') {
    return `Estimated ~${r} from coordinatePrecision (converted using latitude). Tap the pin for details.`;
  }
  return `Estimated ~${r} from decimal places in the coordinates. Tap the pin for details — JSON numbers can hide trailing zeros.`;
}

/**
 * Popup copy: explains source; numeric values are interpolated as text only (safe for innerHTML).
 */
export function humanUncertaintyPopupHtml(res: ResolvedLocationUncertainty): string {
  if (res.meters === null) {
    return (
      'This record has <strong>no coordinateUncertaintyInMeters</strong>, no usable ' +
      '<strong>coordinatePrecision</strong>, and we could not infer precision from the numeric ' +
      'coordinates alone. The pin may still be exact — check the record on GBIF.'
    );
  }

  const r = plainRadiusText(res.meters);

  if (res.source === 'gbif_uncertainty_meters') {
    return (
      `The data publisher stated <strong>coordinateUncertaintyInMeters</strong>: the true location is ` +
      `likely <strong>within about ${r}</strong> of this pin.`
    );
  }

  if (res.source === 'gbif_coordinate_precision') {
    const d = res.detail;
    let precBit = '';
    if (typeof d.asDecimalDigits === 'number') {
      precBit = `We read <strong>coordinatePrecision</strong> as <strong>${d.asDecimalDigits} decimal places</strong> ` +
        `(grid step ≈ 10<sup>−${d.asDecimalDigits}</sup>° per axis).`;
    } else if (typeof d.precisionDeg === 'number') {
      const degStr =
        d.precisionDeg >= 0.0001
          ? d.precisionDeg.toFixed(6).replace(/\.?0+$/, '')
          : d.precisionDeg.toExponential(2);
      precBit = `Darwin Core <strong>coordinatePrecision</strong> is <strong>${degStr}°</strong> per axis.`;
    } else {
      precBit = 'We used the <strong>coordinatePrecision</strong> field from the occurrence.';
    }
    return (
      `<span class="popup-precision-estimated">~ Estimated</span> — ${precBit} ` +
      `Converted to ground distance at this latitude, that is about <strong>±${r}</strong> ` +
      `(half diagonal of the implied grid cell — approximate).`
    );
  }

  const dlat = res.detail.decimalPlacesLat ?? 0;
  const dlng = res.detail.decimalPlacesLng ?? 0;
  const latNote =
    dlat === 0
      ? 'latitude looks like a <strong>whole number</strong> in the JSON number (so we assume up to <strong>1°</strong> steps)'
      : `latitude is shown with <strong>${dlat}</strong> digit(s) after the decimal in the value GBIF returned`;
  const lngNote =
    dlng === 0
      ? 'longitude looks like a <strong>whole number</strong>'
      : `longitude has <strong>${dlng}</strong> digit(s) after the decimal`;

  return (
    `<span class="popup-precision-estimated">~ Estimated</span> — No uncertainty fields; we inferred a grid from ` +
    `the coordinates: ${latNote}; ${lngNote}. That suggests about <strong>±${r}</strong> on the ground ` +
    `(approximate — <strong>trailing zeros are not visible</strong> in JSON numbers).`
  );
}
