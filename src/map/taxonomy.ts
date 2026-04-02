import type L from 'leaflet';
import type { VectorMarkerEntry, TaxonomyBlock } from '../types';

export type Rank = 'root' | 'kingdom' | 'phylum' | 'class' | 'order' | 'family' | 'genus' | 'species';

export interface TaxaNode {
  name: string;
  rank: Rank;
  count: number;
  children: Map<string, TaxaNode>;
  markers: L.Marker[];
  taxonKey?: number;
}

const RANKS: (keyof TaxonomyBlock)[] = ['kingdom', 'phylum', 'class', 'order', 'family', 'genus', 'species'];
const rankToKeyField: Partial<Record<keyof TaxonomyBlock, keyof TaxonomyBlock>> = {
  kingdom: 'kingdomKey', phylum: 'phylumKey', class: 'classKey',
  order: 'orderKey', family: 'familyKey', genus: 'genusKey', species: 'speciesKey',
};

const taxonKeyForRank = (t: TaxonomyBlock, rank: keyof TaxonomyBlock): number | undefined => {
  const keyField = rankToKeyField[rank];
  if (!keyField) return undefined;
  const v = t[keyField];
  return typeof v === 'number' && v > 0 ? v : undefined;
};

export function buildTaxaTree(markers: VectorMarkerEntry[]): TaxaNode {
  const root: TaxaNode = { name: 'Life', rank: 'root', count: 0, children: new Map(), markers: [] };

  for (const m of markers) {
    let node = root;
    root.count++;
    root.markers.push(m.marker);

    for (const rank of RANKS) {
      const name = (m.taxonomy[rank] as string) || 'Unknown';
      if (!node.children.has(name)) {
        const tk = taxonKeyForRank(m.taxonomy, rank);
        node.children.set(name, {
          name,
          rank: rank as Rank,
          count: 0,
          children: new Map(),
          markers: [],
          taxonKey: tk,
        });
      }
      const child = node.children.get(name)!;
      // Opportunistically fill in taxonKey if we now know it
      if (!child.taxonKey) {
        const tk = taxonKeyForRank(m.taxonomy, rank);
        if (tk) child.taxonKey = tk;
      }
      child.count++;
      child.markers.push(m.marker);
      node = child;
    }
  }

  return root;
}

export function pruneTree(node: TaxaNode): TaxaNode {
  // Recursively prune children first
  const pruned = new Map<string, TaxaNode>();
  for (const [key, child] of node.children) pruned.set(key, pruneTree(child));
  node.children = pruned;

  // Collapse single-child non-root nodes, but never collapse a genus→species link
  if (
    node.children.size === 1 &&
    node.rank !== 'root' &&
    node.children.values().next().value!.rank !== 'species'
  ) {
    return node.children.values().next().value!;
  }
  return node;
}
