import { getIconSvg } from './icons';

let toastTimer: ReturnType<typeof setTimeout> | undefined;

export const showErrorToast = (message: string) => {
  const toast = document.getElementById('error-toast');
  if (!toast) return;
  toast.classList.remove('error-toast--info');
  toast.innerHTML = `<div class="error-toast-inner">${getIconSvg('alert-circle')}<span>${message}</span></div>`;
  toast.classList.add('visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('visible'), 5000);
};

export const showInfoToast = (message: string) => {
  const toast = document.getElementById('error-toast');
  if (!toast) return;
  toast.classList.add('error-toast--info');
  toast.innerHTML = `<div class="error-toast-inner">${getIconSvg('check-circle')}<span>${message}</span></div>`;
  toast.classList.add('visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toast.classList.remove('visible', 'error-toast--info');
  }, 3500);
};
