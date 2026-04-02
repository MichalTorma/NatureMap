import type L from 'leaflet';

export interface LayerConfig {
  id: string;
  type: 'xyz' | 'wms';
  label: string;
  icon: string;
  active?: boolean;
  url: string;
  options?: any;
}

export interface AppConfig {
  mapOptions: {
    center: [number, number];
    zoom: number;
  };
  baseLayers: LayerConfig[];
  overlays: LayerConfig[];
  gbif: {
    defaultStyle: string;
    availableStyles: { id: string; label: string; params: string }[];
  };
  /** If set, "Open GitHub" pre-fills a new issue; otherwise users copy diagnostics and file manually. */
  issueTracker?: {
    newIssueUrl: string;
    /** Optional: GitHub issue template name, e.g. "bug_report" for .github/ISSUE_TEMPLATE/bug_report.md */
    template?: string;
    /**
     * If true, do not upload the screenshot to tmpfiles.org — the GitHub draft will omit the image;
     * use Download PNG and attach manually (diagnostics are still prefilled).
     */
    skipTemporaryImageUpload?: boolean;
  };
}

export interface TaxonomyBlock {
  kingdom: string; phylum: string; class: string; order: string; family: string; genus: string; species: string;
  kingdomKey?: number; phylumKey?: number; classKey?: number; orderKey?: number; familyKey?: number; genusKey?: number; speciesKey?: number;
}

export interface VectorMarkerEntry {
  cssClass: string; label: string; iconUrl: string; marker: L.Marker; taxonomy: TaxonomyBlock;
}

// TaxaNode and Rank are defined in src/map/taxonomy.ts
