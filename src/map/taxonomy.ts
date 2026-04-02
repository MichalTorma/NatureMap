import type { VectorMarkerEntry, Rank } from '../types';

export interface TaxaNode {
  name: string;
  rank: Rank;
  count: number;
  children: Map<string, TaxaNode>;
  isFiltered?: boolean;
}

export function buildTaxaTree(markers: VectorMarkerEntry[]): TaxaNode {
  const root: TaxaNode = { name: 'Root', rank: 'KINGDOM', count: 0, children: new Map() };

  markers.forEach(m => {
    let current = root;
    const path: { name: string; rank: Rank }[] = [
      { name: m.taxonomy.kingdom, rank: 'KINGDOM' },
      { name: m.taxonomy.phylum, rank: 'PHYLUM' },
      { name: m.taxonomy.class, rank: 'CLASS' },
      { name: m.taxonomy.order, rank: 'ORDER' },
      { name: m.taxonomy.family, rank: 'FAMILY' },
      { name: m.taxonomy.genus, rank: 'GENUS' },
      { name: m.taxonomy.species, rank: 'SPECIES' }
    ];

    path.forEach(p => {
      if (!p.name) return;
      if (!current.children.has(p.name)) {
        current.children.set(p.name, { name: p.name, rank: p.rank, count: 0, children: new Map() });
      }
      current = current.children.get(p.name)!;
      current.count++;
    });
    root.count++;
  });

  return root;
}

export function pruneTree(node: TaxaNode): TaxaNode {
  if (node.children.size === 1) {
    const child = node.children.values().next().value!;
    return pruneTree(child);
  }
  return node;
}
