import { 
  STORAGE_KEY_CENTER, 
  STORAGE_KEY_ZOOM, 
  STORAGE_KEY_LANGS, 
  STORAGE_KEY_BASE, 
  STORAGE_KEY_OVERLAYS 
} from '../state';

export function initWelcome() {
  const WELCOME_KEY = 'mymap_welcomed';
  const welcomeCard = document.getElementById('welcome-card');
  const welcomeDismiss = document.getElementById('welcome-dismiss');
  if (welcomeCard) {
    if (localStorage.getItem(WELCOME_KEY)) {
      welcomeCard.classList.add('hidden');
    } else {
      welcomeDismiss?.addEventListener('click', () => {
        welcomeCard.classList.add('hidden');
        localStorage.setItem(WELCOME_KEY, '1');
      });
    }
  }

  // Reset All Settings
  const ALL_STORAGE_KEYS = [
    STORAGE_KEY_CENTER, 
    STORAGE_KEY_ZOOM, 
    STORAGE_KEY_LANGS, 
    STORAGE_KEY_BASE, 
    STORAGE_KEY_OVERLAYS, 
    'gbif_history', 
    WELCOME_KEY
  ];
  const resetBtn = document.getElementById('reset-all-btn');
  if (resetBtn) {
    let confirmPending = false;
    let confirmTimer: any;
    resetBtn.addEventListener('click', () => {
      if (!confirmPending) {
        confirmPending = true;
        resetBtn.classList.add('confirming');
        const label = resetBtn.querySelector('span');
        if (label) label.textContent = 'Tap again to confirm';
        confirmTimer = setTimeout(() => {
          confirmPending = false;
          resetBtn.classList.remove('confirming');
          if (label) label.textContent = 'Reset All Settings';
        }, 3000);
        return;
      }
      clearTimeout(confirmTimer);
      ALL_STORAGE_KEYS.forEach(k => localStorage.removeItem(k));
      window.location.href = window.location.pathname;
    });
  }
}
