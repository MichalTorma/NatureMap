import type { AppState } from '../state';
import { resolveVernacularNames, resolveWikidataInfo } from '../map/gbif';
import { getIconSvg } from './icons';

export interface HoverCardController {
  showTaxonHoverCard: (btn: HTMLElement, taxonKey: number, sciName: string) => Promise<void>;
  hideTaxonHoverCard: (btn: HTMLElement) => void;
}

export function initTaxonHoverCard(state: AppState): HoverCardController {
  const hoverCardEl = document.createElement('div');
  hoverCardEl.className = 'taxon-hover-card hidden';
  document.body.appendChild(hoverCardEl);

  let hoverCardTimeout: ReturnType<typeof setTimeout> | undefined;
  let activeHoverBtn: HTMLElement | null = null;

  // Click outside to dismiss
  document.addEventListener('click', (e) => {
    if (
      !hoverCardEl.classList.contains('hidden') &&
      activeHoverBtn &&
      activeHoverBtn !== e.target &&
      !hoverCardEl.contains(e.target as Node) &&
      !(e.target as HTMLElement).closest('.tree-info-btn')
    ) {
      hoverCardEl.classList.add('hidden');
      activeHoverBtn = null;
    }
  });

  hoverCardEl.addEventListener('mouseenter', () => clearTimeout(hoverCardTimeout));
  hoverCardEl.addEventListener('mouseleave', () => {
    hoverCardEl.classList.add('hidden');
    activeHoverBtn = null;
  });

  const showTaxonHoverCard = async (btn: HTMLElement, taxonKey: number, sciName: string) => {
    clearTimeout(hoverCardTimeout);

    // Toggle on mobile if already open for same button
    if (activeHoverBtn === btn && !hoverCardEl.classList.contains('hidden')) {
      if (window.innerWidth <= 768) {
        hoverCardEl.classList.add('hidden');
        activeHoverBtn = null;
      }
      return;
    }

    activeHoverBtn = btn;
    const rect = btn.getBoundingClientRect();
    const isMobile = window.innerWidth <= 768;

    if (isMobile) {
      hoverCardEl.style.top = 'auto';
      hoverCardEl.style.bottom = `${window.innerHeight - rect.top + 10}px`;
      hoverCardEl.style.right = '16px';
      hoverCardEl.style.left = '16px';
    } else {
      hoverCardEl.style.top = `${Math.max(10, rect.top - 10)}px`;
      hoverCardEl.style.right = `${window.innerWidth - rect.left + btn.offsetWidth + 8}px`;
      hoverCardEl.style.left = 'auto';
      hoverCardEl.style.bottom = 'auto';
    }

    // Show loader immediately
    hoverCardEl.innerHTML = `
      <div class="vector-popup taxon-hover-inner">
        <div class="hover-loading">
          ${getIconSvg('loader-2')}
          <span>Loading info...</span>
        </div>
      </div>
    `;
    hoverCardEl.classList.remove('hidden');

    if (!taxonKey) {
      hoverCardEl.innerHTML = `<div class="vector-popup taxon-hover-inner"><div class="title">${sciName}</div></div>`;
      return;
    }

    const [names, wikiInfo] = await Promise.all([
      resolveVernacularNames(taxonKey),
      resolveWikidataInfo(taxonKey, state.userLanguages),
    ]);

    // Bail if user already moved to another button
    if (activeHoverBtn !== btn) return;

    const vnamesHtml = names.length > 0
      ? names
          .filter(n => state.userLanguages.includes(n.lang))
          .slice(0, 6)
          .map(n => `<span class="lang-tag">${n.lang.toUpperCase()}</span> ${n.name}`)
          .join(' · ') || `<span class="lang-tag">INFO</span> No vernacular names`
      : `<span class="lang-tag">INFO</span> No vernacular names`;

    const imgHtml = wikiInfo?.imgUrl
      ? `<img src="${wikiInfo.imgUrl}" alt="${sciName}" loading="lazy" class="hover-card-img" onerror="this.style.display='none'">`
      : '';

    const wikiLinkHtml = wikiInfo
      ? `<a href="${wikiInfo.wikiUrl}" class="wiki-link" target="_blank" rel="noopener">
          ${getIconSvg(wikiInfo.type === 'wikidata' ? 'database' : 'book-open')}
          ${wikiInfo.type === 'wikidata' ? 'Wikidata' : 'Wikipedia'}
         </a>`
      : '';

    hoverCardEl.innerHTML = `
      <div class="vector-popup taxon-hover-inner">
        ${imgHtml ? `<div class="popup-image-container hover-img-container">${imgHtml}</div>` : ''}
        <div class="title">${sciName}</div>
        <div class="vernacular-popup">${vnamesHtml}</div>
        <hr style="border:0;border-top:1px solid rgba(255,255,255,0.08);margin:8px 0"/>
        <div class="popup-links">${wikiLinkHtml}</div>
      </div>
    `;

    // Clamp bottom on desktop
    if (!isMobile) {
      const cardRect = hoverCardEl.getBoundingClientRect();
      if (cardRect.bottom > window.innerHeight - 10) {
        hoverCardEl.style.top = `${window.innerHeight - cardRect.height - 10}px`;
      }
    }
  };

  const hideTaxonHoverCard = (btn: HTMLElement) => {
    hoverCardTimeout = setTimeout(() => {
      if (activeHoverBtn === btn) {
        hoverCardEl.classList.add('hidden');
        activeHoverBtn = null;
      }
    }, 200);
  };

  return { showTaxonHoverCard, hideTaxonHoverCard };
}
