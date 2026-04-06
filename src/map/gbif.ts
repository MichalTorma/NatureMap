import L from 'leaflet';
import codes from 'iso-language-codes';

/* Minimal MD5 – RFC 1321 */
export function md5(str: string): string {
  const k = new Uint32Array(64);
  for (let i = 0; i < 64; i++) k[i] = (Math.abs(Math.sin(i + 1)) * 0x100000000) >>> 0;
  const s = [7,12,17,22,7,12,17,22,7,12,17,22,7,12,17,22,
             5,9,14,20,5,9,14,20,5,9,14,20,5,9,14,20,
             4,11,16,23,4,11,16,23,4,11,16,23,4,11,16,23,
             6,10,15,21,6,10,15,21,6,10,15,21,6,10,15,21];
  const bytes: number[] = [];
  for (let i = 0; i < str.length; i++) {
    const c = str.charCodeAt(i);
    if (c < 0x80) bytes.push(c);
    else if (c < 0x800) { bytes.push(0xc0 | (c >> 6), 0x80 | (c & 0x3f)); }
    else { bytes.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f)); }
  }
  const bitLen = bytes.length * 8;
  bytes.push(0x80);
  while (bytes.length % 64 !== 56) bytes.push(0);
  bytes.push(bitLen & 0xff, (bitLen >>> 8) & 0xff, (bitLen >>> 16) & 0xff, (bitLen >>> 24) & 0xff, 0, 0, 0, 0);
  let a0 = 0x67452301, b0 = 0xefcdab89, c0 = 0x98badcfe, d0 = 0x10325476;
  for (let i = 0; i < bytes.length; i += 64) {
    const m = new Uint32Array(16);
    for (let j = 0; j < 64; j += 4) m[j >> 2] = bytes[i+j] | (bytes[i+j+1] << 8) | (bytes[i+j+2] << 16) | (bytes[i+j+3] << 24);
    let [a, b, c, d] = [a0, b0, c0, d0];
    for (let j = 0; j < 64; j++) {
      let f: number, g: number;
      if (j < 16) { f = (b & c) | (~b & d); g = j; }
      else if (j < 32) { f = (d & b) | (~d & c); g = (5*j+1) % 16; }
      else if (j < 48) { f = b ^ c ^ d; g = (3*j+5) % 16; }
      else { f = c ^ (b | ~d); g = (7*j) % 16; }
      const tmp = d; d = c; c = b;
      const x = (a + f + k[j] + m[g]) | 0;
      b = (b + ((x << s[j]) | (x >>> (32 - s[j])))) | 0;
      a = tmp;
    }
    a0 = (a0 + a) | 0; b0 = (b0 + b) | 0; c0 = (c0 + c) | 0; d0 = (d0 + d) | 0;
  }
  const hex = (v: number) => Array.from({length: 4}, (_, i) => ((v >>> (i * 8)) & 0xff).toString(16).padStart(2, '0')).join('');
  return hex(a0) + hex(b0) + hex(c0) + hex(d0);
}

export const GbifLayerClass = L.TileLayer.extend({
  getTileUrl: function(this: any, coords: any) {
    let url = L.TileLayer.prototype.getTileUrl.call(this, coords);
    const shape = this.options.gbifShape;
    const baseDensity = this.options.gbifDensity;
    
    if (shape === 'hex') {
        url += `&bin=hex&hexPerTile=${baseDensity}`;
    } else if (shape === 'square') {
        // Enforce squareSize is a nearest valid power of 2 based on density
        const targetSize = 4096 / baseDensity;
        const p2 = Math.pow(2, Math.round(Math.log2(targetSize)));
        const validP2 = Math.max(2, Math.min(4096, p2));
        url += `&bin=square&squareSize=${validP2}`;
    }
    
    return url;
  }

});

export function gbifThumb(occurrenceKey: number | string, mediaUrl: string, width = 300): string {
  return `https://api.gbif.org/v1/image/cache/${width}x/occurrence/${occurrenceKey}/media/${md5(mediaUrl)}`;
}

export interface VnName { lang: string; name: string }
export interface TaxonHistory {
  key: number | null;
  name: string;
  names?: VnName[];
}
export const vnCache = new Map<number, VnName[]>();

/**
 * Normalizes language codes from mixed formats (eng, en, en-US, spa...) 
 * into 2-letter ISO 639-1 codes for consistent matching with UI preferences.
 */
/**
 * Robust mapping for common 3-letter ISO codes to 2-letter equivalents.
 * GBIF often returns these from legacy datasets.
 */
const ISO3_TO_2: Record<string, string> = {
  eng: 'en', spa: 'es', fra: 'fr', deu: 'de', ita: 'it', por: 'pt', rus: 'ru',
  zho: 'zh', jpn: 'ja', ara: 'ar', hin: 'hi', nld: 'nl', swe: 'sv', nor: 'no',
  dan: 'da', fin: 'fi', pol: 'pl', ces: 'cs', slk: 'sk', slo: 'sk', hun: 'hu', tur: 'tr'
};

function normalizeLanguageCode(code: string): string {
  if (!code) return '';
  const norm = code.toLowerCase().trim();
  if (norm.length === 2) return norm;
  
  // Try hardcoded common mappings first (fastest)
  if (ISO3_TO_2[norm]) return ISO3_TO_2[norm];

  // Search in iso-language-codes library
  const info = codes.find(c => 
    c.iso639_1 === norm || 
    (c as any).iso639_2 === norm || 
    (c as any).iso639_2T === norm ||
    (c as any).iso639_2B === norm ||
    (c as any).iso639_3 === norm ||
    c.name.toLowerCase() === norm
  );
  if (info) return info.iso639_1;
  
  // Handle locale variants (en-US, pt-BR)
  if (norm.includes('-')) return norm.split('-')[0];
  if (norm.includes('_')) return norm.split('_')[0];
  
  return norm;
}

export async function resolveVernacularNames(taxonKey: number): Promise<VnName[]> {
  if (!taxonKey) return [];
  if (!vnCache.has(taxonKey)) {
    try {
      const res = await fetch(`https://api.gbif.org/v1/species/${taxonKey}/vernacularNames?limit=150`);
      if (!res.ok) throw new Error(`GBIF error ${res.status}`);
      const data = await res.json();
      const allNames: VnName[] = [];
      const seen = new Set<string>();
      
      for (const vn of data.results || []) {
        if (!vn.vernacularName || !vn.language) continue;
        const langRaw = normalizeLanguageCode(String(vn.language));
        if (!langRaw) continue;
        const key = `${langRaw}:${vn.vernacularName.toLowerCase()}`;
        if (seen.has(key)) continue;
        allNames.push({ lang: langRaw, name: vn.vernacularName });
        seen.add(key);
      }
      vnCache.set(taxonKey, allNames);
    } catch (e) {
      console.warn(`Failed to fetch vernacular names for ${taxonKey}:`, e);
      vnCache.set(taxonKey, []);
    }
  }
  return vnCache.get(taxonKey)!;
}

/**
 * Negotiates the best display name based on user language preferences.
 * 'la' (Latin) is treated as a request for the Scientific Name.
 */
export interface TaxonNameRow {
  name: string;
  lang: string;
  isScientific: boolean;
}

export function negotiateTaxonNames(
  scientificName: string,
  userLanguages: string[],
  gbifVernaculars: VnName[],
  wikiInfo: WikiInfo | null
): { best: TaxonNameRow, subtitles: TaxonNameRow[] } {
  const allCandidates: VnName[] = [...gbifVernaculars];
  if (wikiInfo?.labels) {
    for (const [lang, name] of Object.entries(wikiInfo.labels)) {
      // Prioritize Wikidata labels by unshifting
      allCandidates.unshift({ lang, name });
    }
  }

  const preferred: TaxonNameRow[] = [];
  const seenLangs = new Set<string>();

  for (const lc of userLanguages) {
    if (lc === 'la') {
      if (!seenLangs.has('la')) {
        preferred.push({ name: scientificName, lang: 'la', isScientific: true });
        seenLangs.add('la');
      }
      continue;
    }

    const matches = allCandidates.filter(c => c.lang === lc);
    if (matches.length > 0) {
      const isLikeScientific = (name: string) => {
        const n = name.toLowerCase().trim();
        const s = scientificName.toLowerCase().trim();
        return n === s || s.startsWith(n + ' ');
      };

      // CRITICAL FIX: Prefer a name that is NOT the scientific name
      const commonMatch = matches.find(m => !isLikeScientific(m.name));
      const selected = commonMatch || matches[0];
      const isSci = isLikeScientific(selected.name);
      
      if (!seenLangs.has(lc)) {
        preferred.push({ name: selected.name, lang: lc, isScientific: isSci });
        seenLangs.add(lc);
      }
    }
  }

  const best = preferred[0] || { name: scientificName, lang: 'la', isScientific: true };
  const subtitles = preferred.filter(p => p !== best);

  // Ensure scientific name is always available in subtitles if not already the best title
  if (!best.isScientific && !subtitles.find(s => s.isScientific)) {
    subtitles.push({ name: scientificName, lang: 'la', isScientific: true });
  }

  return { best, subtitles };
}

export function getBestTaxonName(scientificName: string, userLanguages: string[], allVernaculars: VnName[]): { name: string, lang: string, isScientific: boolean } {
  // Keeping this for potential legacy use, but it should ideally be replaced by negotiateTaxonNames
  const { best } = negotiateTaxonNames(scientificName, userLanguages, allVernaculars, null);
  return best;
}


export const datasetCache = new Map<string, string>();
export async function resolveDatasetName(datasetKey: string): Promise<string> {
  if (datasetCache.has(datasetKey)) return datasetCache.get(datasetKey)!;
  try {
    const res = await fetch(`https://api.gbif.org/v1/dataset/${datasetKey}`);
    const data = await res.json();
    const title = data.title || '';
    datasetCache.set(datasetKey, title);
    return title;
  } catch {
    datasetCache.set(datasetKey, '');
    return '';
  }
}

export interface WikiInfo { 
  imgUrl: string | null, 
  wikiUrl: string, 
  type: 'wikipedia' | 'wikidata',
  labels: Record<string, string> 
}
export const wikidataCache = new Map<number, WikiInfo | null>();

export async function resolveWikidataInfo(taxonKey: number, userLanguages: string[] = ['en']): Promise<WikiInfo | null> {
  if (wikidataCache.has(taxonKey)) return wikidataCache.get(taxonKey)!;
  try {
    const langParam = encodeURIComponent(userLanguages.join('|'));
    const searchParam = encodeURIComponent(`haswbstatement:P846=${taxonKey}`);
    const url = `https://www.wikidata.org/w/api.php?action=query&prop=pageimages|info&inprop=url&generator=search&gsrsearch=${searchParam}&piprop=thumbnail&pithumbsize=600&format=json&origin=*`;
    
    const res = await fetch(url);
    const data = await res.json();
    const pages = data.query?.pages;
    if (!pages) return null;
    const pageId = Object.keys(pages)[0];
    const page = pages[pageId];
    
    const imgUrl = page.thumbnail?.source || null;
    const wikiUrl = page.fullurl || `https://www.wikidata.org/wiki/${page.title}`;
    
    // Explicitly fetch labels using wbgetentities for 100% reliability
    const labels: Record<string, string> = {};
    const qid = page.title; // generator=search with P846 search returns Qid as title
    if (qid.startsWith('Q')) {
      const entityUrl = `https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${qid}&props=labels&languages=${langParam}&format=json&origin=*`;
      const entityRes = await fetch(entityUrl);
      const entityData = await entityRes.json();
      const entityEntry = entityData.entities?.[qid];
      if (entityEntry && entityEntry.labels) {
        for (const lc of userLanguages) {
          if (entityEntry.labels[lc]) labels[lc] = entityEntry.labels[lc].value;
        }
      }
    }

    const result: WikiInfo = { imgUrl, wikiUrl, type: 'wikidata', labels };
    wikidataCache.set(taxonKey, result);
    return result;
  } catch (e) {
    wikidataCache.set(taxonKey, null);
    return null;
  }
}
