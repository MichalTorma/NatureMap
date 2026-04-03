import { getIconSvg } from './icons';

/**
 * Mushroom and spider glyphs are adapted from Tabler Icons (MIT License).
 * Source: https://github.com/tabler/tabler-icons — icons/outline/mushroom.svg, spider.svg
 */
const MUSHROOM_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 11.1c0 -4.474 -3.582 -8.1 -8 -8.1s-8 3.626 -8 8.1a.9 .9 0 0 0 .9 .9h14.2a.9 .9 0 0 0 .9 -.9" /><path d="M10 12v7a2 2 0 1 0 4 0v-7" /></svg>';

const SPIDER_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 4v2l5 5" /><path d="M2.5 9.5l1.5 1.5h6" /><path d="M4 19v-2l6 -6" /><path d="M19 4v2l-5 5" /><path d="M21.5 9.5l-1.5 1.5h-6" /><path d="M20 19v-2l-6 -6" /><path d="M8 15a4 4 0 1 0 8 0a4 4 0 1 0 -8 0" /><path d="M10 9a2 2 0 1 0 4 0a2 2 0 1 0 -4 0" /></svg>';

const CUSTOM_SVG: Record<string, string> = {
  mushroom: MUSHROOM_SVG,
  spider: SPIDER_SVG
};

/** Lucide icon id (kebab-case) or built-in taxon glyph keys `mushroom` / `spider`. */
export const getTaxonMarkerIconSvg = (iconId: string): string =>
  CUSTOM_SVG[iconId] ?? getIconSvg(iconId);
