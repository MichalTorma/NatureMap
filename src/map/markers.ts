import L from 'leaflet';
import { getIconSvg } from '../ui/icons';

export const getTaxaInfo = (className: string, hasImage = false) => {
  let iconName = 'leaf', cssClass = 'default', label = 'Unknown';
  const c = className ? className.toLowerCase() : '';
  if (c === 'aves') { iconName = 'bird'; cssClass = 'aves'; label = 'Birds'; }
  else if (c === 'mammalia') { iconName = 'paw-print'; cssClass = 'mammalia'; label = 'Mammals'; }
  else if (['plantae', 'magnoliopsida', 'liliopsida', 'polypodiopsida', 'pinopsida'].includes(c)) { iconName = 'leaf'; cssClass = 'plantae'; label = 'Plants'; }
  else if (c === 'insecta') { iconName = 'bug'; cssClass = 'insecta'; label = 'Insects'; }
  else if (['fungi', 'agaricomycetes', 'lecanoromycetes', 'sordariomycetes'].includes(c)) { iconName = 'sprout'; cssClass = 'fungi'; label = 'Fungi'; }
  else if (c === 'reptilia') { iconName = 'turtle'; cssClass = 'reptilia'; label = 'Reptiles'; }
  else if (c === 'amphibia') { iconName = 'egg'; cssClass = 'amphibia'; label = 'Amphibians'; }
  else if (['actinopterygii', 'chondrichthyes'].includes(c)) { iconName = 'fish'; cssClass = 'actinopterygii'; label = 'Fish'; }
  else if (c === 'arachnida') { iconName = 'waypoints'; cssClass = 'arachnida'; label = 'Arachnids'; }
  else if (c === 'gastropoda') { iconName = 'snail'; cssClass = 'gastropoda'; label = 'Snails'; }
  else if (c === 'malacostraca') { iconName = 'shrimp'; cssClass = 'malacostraca'; label = 'Crustaceans'; }
  else if (['bivalvia', 'cephalopoda', 'polyplacophora'].includes(c)) { iconName = 'shell'; cssClass = 'mollusca'; label = 'Molluscs'; }
  else { label = className ? className.charAt(0).toUpperCase() + className.slice(1) : 'Unknown'; }
  const photoBadge = hasImage ? `<span class="marker-photo-badge">${getIconSvg('camera')}</span>` : '';
  return {
    icon: L.divIcon({
      className: 'custom-taxa-icon',
      html: `<div class="taxa-marker ${cssClass}">${getIconSvg(iconName)}${photoBadge}</div>`,
      iconSize: [38, 38], iconAnchor: [19, 19], popupAnchor: [0, -19]
    }), cssClass, label, iconName
  };
};
