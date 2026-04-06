import codes from 'iso-language-codes';
import { AppState, STORAGE_KEY_LANGS } from '../state';
import { getIconSvg } from './icons';

export function initLanguages(state: AppState, onLanguagesChanged: () => void) {
  const langChipsContainer = document.getElementById('lang-chips');
  const langSearchInput = document.getElementById('lang-search') as HTMLInputElement;
  const langDropdown = document.getElementById('lang-dropdown') as HTMLElement;
  const langPanel = document.getElementById('lang-panel');
  const langPanelClose = document.getElementById('lang-panel-close');
  const langFab = document.getElementById('lang-fab');
  const panelOverlay = document.getElementById('panel-overlay');

  const openLangPanel = () => {
    document.getElementById('gbif-panel')?.classList.remove('open');
    document.getElementById('gbif-fab')?.classList.remove('panel-open');
    const gbifPanelEl = document.getElementById('gbif-panel') as HTMLElement | null;
    if (gbifPanelEl) gbifPanelEl.style.transform = '';
    document.getElementById('base-layer-popover')?.classList.remove('open');

    langPanel?.classList.add('open');
    langFab?.classList.add('panel-open');
    panelOverlay?.classList.add('active');
    document.body.classList.add('panel-active');
  };

  const closeLangPanel = () => {
    langPanel?.classList.remove('open');
    langFab?.classList.remove('panel-open');
    panelOverlay?.classList.remove('active');
    if (langPanel) (langPanel as HTMLElement).style.transform = '';
    if (
      !document.getElementById('vector-legend')?.classList.contains('open') &&
      !document.getElementById('gbif-panel')?.classList.contains('open')
    ) {
      document.body.classList.remove('panel-active');
    }
  };

  langFab?.addEventListener('click', () => {
    if (langPanel?.classList.contains('open')) closeLangPanel();
    else openLangPanel();
  });

  langPanelClose?.addEventListener('click', closeLangPanel);

  const saveLanguages = () => {
    localStorage.setItem(STORAGE_KEY_LANGS, JSON.stringify(state.userLanguages));
    onLanguagesChanged();
    renderLanguageChips();
  };

  const renderLanguageChips = () => {
    if (!langChipsContainer) return;
    langChipsContainer.innerHTML = '';
    state.userLanguages.forEach((code, idx) => {
      const info = codes.find(c => c.iso639_1 === code);
      if (!info) return;
      const chip = document.createElement('div');
      chip.className = 'language-chip';
      let displayName = info.nativeName.split(',')[0].trim();
      if (code === 'la') displayName = 'Scientific Name (Latin)';
      
      let btns = '';
      if (idx > 0)
        btns += `<button class="lang-chip-move" data-dir="up" title="Move up">${getIconSvg('chevron-up')}</button>`;
      if (idx < state.userLanguages.length - 1)
        btns += `<button class="lang-chip-move" data-dir="down" title="Move down">${getIconSvg('chevron-down')}</button>`;
      btns += `<button class="lang-chip-remove" title="Remove">${getIconSvg('x')}</button>`;
      chip.innerHTML = `
        <span class="lang-chip-code">${code.toUpperCase()}</span>
        <span class="lang-chip-name">${displayName}</span>
        <span class="lang-chip-actions">${btns}</span>
      `;
      chip.querySelector('[data-dir="up"]')?.addEventListener('click', () => {
        [state.userLanguages[idx - 1], state.userLanguages[idx]] = [state.userLanguages[idx], state.userLanguages[idx - 1]];
        saveLanguages();
      });
      chip.querySelector('[data-dir="down"]')?.addEventListener('click', () => {
        [state.userLanguages[idx], state.userLanguages[idx + 1]] = [state.userLanguages[idx + 1], state.userLanguages[idx]];
        saveLanguages();
      });
      chip.querySelector('.lang-chip-remove')?.addEventListener('click', () => {
        state.userLanguages.splice(idx, 1);
        saveLanguages();
      });
      langChipsContainer.appendChild(chip);
    });
  };

  if (langSearchInput && langDropdown) {
    langSearchInput.addEventListener('input', () => {
      const q = langSearchInput.value.trim().toLowerCase();
      langDropdown.innerHTML = '';
      if (q.length < 1) { langDropdown.style.display = 'none'; return; }
      const matches = codes.filter(c =>
        !state.userLanguages.includes(c.iso639_1) &&
        (c.name.toLowerCase().includes(q) || c.nativeName.toLowerCase().includes(q) || c.iso639_1 === q)
      ).slice(0, 8);
      if (matches.length === 0) { langDropdown.style.display = 'none'; return; }
      langDropdown.style.display = 'block';
      matches.forEach(c => {
        const li = document.createElement('li');
        const native = c.nativeName.split(',')[0].trim();
        li.innerHTML = `<span class="lang-tag">${c.iso639_1.toUpperCase()}</span> ${c.name} <span class="lang-native">${native}</span>`;
        li.addEventListener('click', () => {
          state.userLanguages.push(c.iso639_1);
          saveLanguages();
          langSearchInput.value = '';
          langDropdown.style.display = 'none';
        });
        langDropdown.appendChild(li);
      });
    });
    langSearchInput.addEventListener('blur', () => {
      setTimeout(() => { langDropdown.style.display = 'none'; }, 200);
    });
  }

  renderLanguageChips();
  return { openLangPanel, closeLangPanel };
}
