import { describe, it, expect } from 'vitest';
import { negotiateTaxonNames } from './gbif';

describe('negotiateTaxonNames', () => {
  const userLangs = ['en', 'sk', 'de'];
  const sciNameFull = 'Vaccinium vitis-idaea L.';

  it('prioritizes common names over binomial labels from Wikidata', () => {
    const gbifVns = [
      { lang: 'en', name: 'Cowberry' },
      { lang: 'en', name: 'Lingonberry' }
    ];
    const wiki = {
      imgUrl: null,
      wikiUrl: '',
      type: 'wikidata' as const,
      labels: { en: 'Vaccinium vitis-idaea' }
    };

    const { best } = negotiateTaxonNames(sciNameFull, userLangs, gbifVns, wiki);
    // Should skip "Vaccinium vitis-idaea" because it is a case-insensitive prefix of "Vaccinium vitis-idaea L."
    expect(best.name).toBe('Cowberry');
    expect(best.isScientific).toBe(false);
  });

  it('falls back to binomial if no common names exist for that language', () => {
    const wiki = {
      imgUrl: null,
      wikiUrl: '',
      type: 'wikidata' as const,
      labels: { en: 'Vaccinium vitis-idaea' }
    };
    const { best } = negotiateTaxonNames(sciNameFull, userLangs, [], wiki);
    // Here it has to pick the scientific name because there is nothing else in English
    expect(best.name).toBe('Vaccinium vitis-idaea');
    expect(best.isScientific).toBe(true);
  });

  it('correctly identifies scientific names even with complex authorship headers', () => {
    const sci = 'Entoloma griseocyaneum (Fr.) P.Kumm.';
    const candidates = [{ lang: 'en', name: 'Entoloma griseocyaneum' }];
    const { best } = negotiateTaxonNames(sci, userLangs, candidates, null);
    expect(best.name).toBe('Entoloma griseocyaneum');
    expect(best.isScientific).toBe(true);
  });

  it('respects priority of user languages', () => {
    const gbifVns = [
      { lang: 'de', name: 'Preiselbeere' },
      { lang: 'sk', name: 'brusnica obyčajná' }
    ];
    // User preferences are ['en', 'sk', 'de']
    // English is missing, so it should pick Slovak (2nd choice)
    const { best } = negotiateTaxonNames(sciNameFull, ['en', 'sk', 'de'], gbifVns, null);
    expect(best.lang).toBe('sk');
    expect(best.name).toBe('brusnica obyčajná');
  });

  it('handles exact matches and extra whitespace gracefully', () => {
    const sci = '  Homo sapiens  ';
    const candidates = [{ lang: 'en', name: 'HOMO SAPIENS' }];
    const { best } = negotiateTaxonNames(sci, ['en'], candidates, null);
    expect(best.isScientific).toBe(true);
  });

  it('includes the full scientific name in subtitles if not used as primary title', () => {
    const gbifVns = [{ lang: 'en', name: 'Cowberry' }];
    const { best, subtitles } = negotiateTaxonNames(sciNameFull, ['en'], gbifVns, null);
    expect(best.name).toBe('Cowberry');
    expect(subtitles.some(s => s.isScientific)).toBe(true);
    expect(subtitles.find(s => s.isScientific)?.name).toBe(sciNameFull);
  });

  it('prioritizes "la" (Latin) as requested in language preferences', () => {
    const gbifVns = [{ lang: 'en', name: 'Cowberry' }];
    const { best } = negotiateTaxonNames(sciNameFull, ['la', 'en'], gbifVns, null);
    expect(best.name).toBe(sciNameFull);
    expect(best.lang).toBe('la');
    expect(best.isScientific).toBe(true);
  });
});
