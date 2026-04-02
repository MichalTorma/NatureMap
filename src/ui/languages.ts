import codes from 'iso-language-codes';
import { AppState, STORAGE_KEY_LANGS } from '../state';
import { getIconSvg } from './icons';

export function initLanguages(state: AppState, onLanguagesChanged: () => void) {
  const langChipsContainer = document.getElementById('lang-chips');
  const langSearchInput = document.getElementById('lang-search') as HTMLInputElement;
  const langDropdown = document.getElementById('lang-dropdown') as HTMLElement;

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
      const nativeName = info.nativeName.split(',')[0].trim();
      let btns = '';
      if (idx > 0)
        btns += `<button class="lang-chip-move" data-dir="up" title="Move up">${getIconSvg('chevron-up')}</button>`;
      if (idx < state.userLanguages.length - 1)
        btns += `<button class="lang-chip-move" data-dir="down" title="Move down">${getIconSvg('chevron-down')}</button>`;
      btns += `<button class="lang-chip-remove" title="Remove">${getIconSvg('x')}</button>`;
      chip.innerHTML = `
        <span class="lang-chip-code">${code.toUpperCase()}</span>
        <span class="lang-chip-name">${nativeName}</span>
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
}
