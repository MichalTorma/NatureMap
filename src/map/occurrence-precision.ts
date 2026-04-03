/**
 * GBIF `coordinateUncertaintyInMeters` — how far the true coordinates might be from the pin.
 */

export type PrecisionTier = 'tight' | 'medium' | 'coarse' | 'unknown';

export function coordinateUncertaintyMetersFromOcc(occ: Record<string, unknown>): number | null {
  const v = occ.coordinateUncertaintyInMeters;
  if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) return null;
  return v;
}

export function precisionTierFromUncertaintyMeters(meters: number | null): PrecisionTier {
  if (meters === null) return 'unknown';
  if (meters <= 30) return 'tight';
  if (meters <= 2000) return 'medium';
  return 'coarse';
}

/** Short text on the map pin (keeps clusters readable). */
export function shortUncertaintyBadgeText(meters: number | null): string {
  if (meters === null) return '?';
  if (meters < 1000) return `${Math.round(meters)}m`;
  return `${Math.round(meters / 1000)}km`;
}

/** Hover / long-press explanation. */
export function uncertaintyBadgeTitle(meters: number | null): string {
  if (meters === null) {
    return 'Accuracy not in the dataset — the pin may still be exact, or rough; open GBIF for details.';
  }
  const plain = plainRadiusText(meters);
  return `GBIF: true location is probably within ${plain} of this pin.`;
}

function plainRadiusText(meters: number): string {
  if (meters < 1000) return `${Math.round(meters)} metres`;
  if (meters < 10_000) return `${(meters / 1000).toFixed(1)} km`;
  return `${Math.round(meters / 1000)} km`;
}

/** One readable sentence for the popup (HTML fragment — numeric values only). */
export function humanUncertaintyPopupHtml(meters: number | null): string {
  if (meters === null) {
    return 'The <strong>data publisher did not say</strong> how precise this pin is.';
  }
  return `The real location is probably <strong>within ${plainRadiusText(meters)}</strong> of this pin (from GBIF).`;
}
