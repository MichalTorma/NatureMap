import './style.css';
import L from 'leaflet';
import { createIcons, Map as MapIcon, Moon, Mountain, Satellite } from 'lucide';

// Initialize Icons
createIcons({
  icons: {
    map: MapIcon,
    moon: Moon,
    mountain: Mountain,
    satellite: Satellite
  }
});

// Configure base map layers
const layers = {
  osm: L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; <a href="http://www.openstreetmap.org/copyright">OpenStreetMap</a>'
  }),
  dark: L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
    subdomains: 'abcd',
    maxZoom: 20
  }),
  topo: L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', {
    maxZoom: 17,
    attribution: 'Map data: &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors, <a href="http://viewfinderpanoramas.org">SRTM</a> | Map style: &copy; <a href="https://opentopomap.org">OpenTopoMap</a> (<a href="https://creativecommons.org/licenses/by-sa/3.0/">CC-BY-SA</a>)'
  }),
  satellite: L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
    attribution: 'Tiles &copy; Esri &mdash; Source: Esri, i-cubed, USDA, USGS, AEX, GeoEye, Getmapping, Aerogrid, IGN, IGP, UPR-EGP, and the GIS User Community'
  })
};

// Initialize Map
const map = L.map('map', {
  center: [37.7749, -122.4194], // Default to SF
  zoom: 13,
  layers: [layers.osm] // Standard layer by default
});

// Layer Toggle Logic
const buttons = document.querySelectorAll('.layer-btn');
buttons.forEach(btn => {
  btn.addEventListener('click', (e) => {
    e.preventDefault();
    const target = e.currentTarget as HTMLButtonElement;
    const layerName = target.getAttribute('data-layer') as keyof typeof layers;
    
    // Remove all layers first
    Object.values(layers).forEach(layer => map.removeLayer(layer));
    
    // Add selected layer
    if (layers[layerName]) {
      layers[layerName].addTo(map);
    }
    
    // Update UI
    buttons.forEach(b => b.classList.remove('active'));
    target.classList.add('active');
  });
});
