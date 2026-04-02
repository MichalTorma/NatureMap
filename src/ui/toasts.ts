import { getIconSvg } from './icons';

let errorToastTimer: any;
export const showErrorToast = (message: string) => {
  const toast = document.getElementById('error-toast');
  if (!toast) return;
  toast.innerHTML = `<div class="error-toast-inner">${getIconSvg('alert-circle')}<span>${message}</span></div>`;
  toast.classList.add('visible');
  clearTimeout(errorToastTimer);
  errorToastTimer = setTimeout(() => toast.classList.remove('visible'), 5000);
};
