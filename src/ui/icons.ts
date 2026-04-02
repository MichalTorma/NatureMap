import * as LucideIcons from 'lucide';

const iconsObject: Record<string, any> = {};
for (const [key, value] of Object.entries(LucideIcons)) {
  if (typeof value === 'object' && Array.isArray(value)) {
    iconsObject[key] = value;
  }
}

const ICON_CACHE: Record<string, string> = {};

export const getIconSvg = (name: string): string => {
  if (ICON_CACHE[name]) return ICON_CACHE[name];
  const temp = document.createElement('div');
  temp.innerHTML = `<i data-lucide="${name}"></i>`;
  (LucideIcons as any).createIcons({
    icons: iconsObject,
    root: temp
  });
  const svg = temp.innerHTML;
  ICON_CACHE[name] = svg;
  return svg;
};

export const initIcons = (root: HTMLElement = document.body) => {
  (LucideIcons as any).createIcons({
    icons: iconsObject,
    root
  });
};
