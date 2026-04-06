export function initWelcome() {
  const WELCOME_KEY = 'naturemap_welcomed';
  const welcomeCard = document.getElementById('welcome-card');
  const welcomeDismiss = document.getElementById('welcome-dismiss');
  const welcomeDontShow = document.getElementById('welcome-dont-show') as HTMLInputElement;
  const aboutBtn = document.getElementById('about-btn');

  const showWelcome = () => {
    welcomeCard?.classList.remove('hidden');
  };

  const hideWelcome = () => {
    welcomeCard?.classList.add('hidden');
    // Save preference: if checked, don't show on reload. 
    // If unchecked, it will show again next time app starts.
    if (welcomeDontShow?.checked) {
      localStorage.setItem(WELCOME_KEY, '1');
    } else {
      localStorage.removeItem(WELCOME_KEY);
    }
  };

  if (welcomeCard) {
    // Check if we should show on first run
    if (!localStorage.getItem(WELCOME_KEY)) {
      showWelcome();
    }

    welcomeDismiss?.addEventListener('click', (e) => {
      e.stopPropagation();
      hideWelcome();
    });

    // Close on backdrop click (optional but nice)
    welcomeCard.addEventListener('click', (e) => {
      if (e.target === welcomeCard) hideWelcome();
    });
  }

  // Bind the settings menu "About" button
  if (aboutBtn) {
    aboutBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      showWelcome();
    });
  }

  // Reset All Settings button logic (existing)
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
      
      // Clear specific keys instead of all for safety, but here we clear everything related to the app
      localStorage.removeItem('naturemap_center');
      localStorage.removeItem('naturemap_zoom');
      localStorage.removeItem('naturemap_langs');
      localStorage.removeItem('naturemap_base');
      localStorage.removeItem('naturemap_overlays');
      localStorage.removeItem('gbif_history');
      localStorage.removeItem(WELCOME_KEY);
      
      window.location.href = window.location.pathname;
    });
  }
}
