import { wikidataCache, pendingWikidataIds } from './gbif';

const SPARQL_ENDPOINT = 'https://query.wikidata.org/sparql';
const CHUNK_SIZE = 50;

/**
 * Fetches multiple taxon details in massive batches from Wikidata using SPARQL.
 * This is much more efficient than individual API calls and avoids 429 rate-limiting.
 */
export async function resolveBatchWikidataInfo(gbifIds: number[], userLanguages: string[]): Promise<void> {
  const idsToFetch = gbifIds.filter(id => 
    id > 0 && 
    !wikidataCache.has(id) && 
    !pendingWikidataIds.has(id)
  );
  if (idsToFetch.length === 0) return;

  idsToFetch.forEach(id => pendingWikidataIds.add(id));

  // Chunk the requests to stay within SPARQL limits
  for (let i = 0; i < idsToFetch.length; i += CHUNK_SIZE) {
    const chunk = idsToFetch.slice(i, i + CHUNK_SIZE);
    try {
      await fetchChunk(chunk, userLanguages);
    } catch (e) {
      console.error('Wikidata SPARQL chunk failure:', e);
    } finally {
      chunk.forEach(id => pendingWikidataIds.delete(id));
    }
  }
}

async function fetchChunk(gbifIds: number[], userLanguages: string[]): Promise<void> {
  const idList = gbifIds.map(id => `'${id}'`).join(' ');
  const langList = userLanguages.map(l => `'${l}'`).join(', ');

  const filterClause = langList.length > 0 
    ? `FILTER(?lang IN (${langList}))` 
    : '';
  
  const query = `
SELECT ?gbifId ?image ?label ?lang ?taxon WHERE {
  VALUES ?gbifId { ${idList} }
  ?taxon wdt:P846 ?gbifId.
  OPTIONAL { ?taxon wdt:P18 ?image. }
  OPTIONAL {
    ?taxon rdfs:label ?label.
    BIND(LANG(?label) AS ?lang)
    ${filterClause}
  }
}
`.trim();

  const url = `${SPARQL_ENDPOINT}?format=json&query=${encodeURIComponent(query)}`;
  const res = await fetch(url, {
    headers: {
      'Accept': 'application/sparql-results+json',
      'Api-User-Agent': 'NatureMap/1.0 (https://michaltorma.github.io/NatureMap/)'
    }
  });

  if (!res.ok) throw new Error(`SPARQL Error ${res.status}`);
  const data = await res.json();
  
  // Group results by GBIF ID (since one ID can have multiple labels in different languages)
  const results = new Map<number, { img: string | null, labels: Record<string, string>, qid: string }>();

  for (const binding of data.results.bindings) {
    const gid = parseInt(binding.gbifId.value, 10);
    const qidFull = binding.taxon.value;
    const qid = qidFull.split('/').pop() || '';
    
    if (!results.has(gid)) {
      results.set(gid, { img: null, labels: {}, qid });
    }
    
    const entry = results.get(gid)!;
    if (binding.image) {
      // Convert commons tool URL to a direct thumbnail-ready or high-res URL if needed,
      // but for now we follow the same pattern as existing wikidata info.
      const rawImg = binding.image.value;
      if (rawImg.includes('Special:FilePath/')) {
         entry.img = `https://commons.wikimedia.org/wiki/Special:FilePath/${rawImg.split('/').pop()}`;
      } else {
         entry.img = rawImg;
      }
    }
    
    if (binding.label && binding.lang) {
      entry.labels[binding.lang.value] = binding.label.value;
    }
  }

  // Populate the global cache
  for (const gid of gbifIds) {
    const found = results.get(gid);
    if (found) {
      wikidataCache.set(gid, {
        imgUrl: found.img,
        wikiUrl: `https://www.wikidata.org/wiki/${found.qid}`,
        type: 'wikidata',
        labels: found.labels
      });
    } else {
      // Mark as null so we don't keep trying to fetch non-existent wikidata entries
      wikidataCache.set(gid, null);
    }
  }
}
