import L from 'leaflet';

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
    
    if (this.options.gbifGridMode === 'geographic') {
        const z = this._getZoomForUrl ? this._getZoomForUrl() : coords.z;
        if (shape === 'hex') {
            const dynamicDensity = Math.max(1, Math.round(baseDensity / Math.pow(2, z)));
            url += `&bin=hex&hexPerTile=${dynamicDensity}`;
        } else if (shape === 'square') {
            const baseSize = 4096 / baseDensity;
            const scaledSize = Math.min(4096, baseSize * Math.pow(2, z));
            const p2 = Math.pow(2, Math.round(Math.log2(scaledSize)));
            const validP2 = Math.max(2, Math.min(4096, p2));
            url += `&bin=square&squareSize=${validP2}`;
        }
    } else {
        if (shape === 'hex') url += `&bin=hex&hexPerTile=${baseDensity}`;
        if (shape === 'square') {
            const baseSize = 4096 / baseDensity;
            const p2 = Math.pow(2, Math.round(Math.log2(baseSize)));
            const validP2 = Math.max(2, Math.min(4096, p2));
            url += `&bin=square&squareSize=${validP2}`;
        }
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

export async function resolveVernacularNames(taxonKey: number, userLanguages: string[] = ['en']): Promise<VnName[]> {
  if (!vnCache.has(taxonKey)) {
    try {
      const res = await fetch(`https://api.gbif.org/v1/species/${taxonKey}/vernacularNames?limit=200`);
      if (!res.ok) throw new Error(`GBIF error ${res.status}`);
      const data = await res.json();
      const allNames: VnName[] = [];
      for (const vn of data.results || []) {
        if (!vn.vernacularName || !vn.language) continue;
        const langRaw = String(vn.language).toLowerCase();
        allNames.push({ lang: langRaw, name: vn.vernacularName });
      }
      vnCache.set(taxonKey, allNames);
    } catch (e) {
      vnCache.set(taxonKey, []);
    }
  }
  const all = vnCache.get(taxonKey)!;
  const result: VnName[] = [];
  const seen = new Set<string>();
  for (const lc of userLanguages) {
    const match = all.find(n => n.lang === lc && !seen.has(lc));
    if (match) { result.push(match); seen.add(lc); }
  }
  return result.length > 0 ? result : all.slice(0, 4);
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

export interface WikiInfo { imgUrl: string | null, wikiUrl: string, type: 'wikipedia' | 'wikidata' }
export const wikidataCache = new Map<number, WikiInfo | null>();

export async function resolveWikidataInfo(taxonKey: number, _userLanguages: string[] = ['en']): Promise<WikiInfo | null> {
  if (wikidataCache.has(taxonKey)) return wikidataCache.get(taxonKey)!;
  try {
    const url = `https://www.wikidata.org/w/api.php?action=query&prop=pageimages|info&inprop=url&generator=search&gsrsearch=haswbstatement:P846=${taxonKey}&piprop=thumbnail&pithumbsize=600&format=json&origin=*`;
    const res = await fetch(url);
    const data = await res.json();
    const pages = data.query?.pages;
    if (!pages) return null;
    const pageId = Object.keys(pages)[0];
    const page = pages[pageId];
    const imgUrl = page.thumbnail?.source || null;
    let wikiUrl = page.fullurl || `https://www.wikidata.org/wiki/${page.title}`;
    let type: 'wikipedia' | 'wikidata' = 'wikidata';

    const result: WikiInfo = { imgUrl, wikiUrl, type };
    wikidataCache.set(taxonKey, result);
    return result;
  } catch (e) {
    wikidataCache.set(taxonKey, null);
    return null;
  }
}
