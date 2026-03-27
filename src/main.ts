import './style.css';
import L from 'leaflet';
import * as LucideIcons from 'lucide';

interface LayerConfig {
  id: string;
  type: 'xyz' | 'wms';
  label: string;
  icon: string;
  active?: boolean;
  url: string;
  options?: any;
}

interface AppConfig {
  mapOptions: {
    center: [number, number];
    zoom: number;
  };
  layers: LayerConfig[];
}

async function initMap() {
  try {
    const response = await fetch('/config.json');
    if (!response.ok) throw new Error('Failed to load config.json');
    const config: AppConfig = await response.json();

    // 1. Initialize Map
    const map = L.map('map', {
      center: config.mapOptions.center,
      zoom: config.mapOptions.zoom,
      layers: [] // Will add default layers later
    });

    // 2. Map Layer Factory & Initialization
    const layers: Record<string, L.Layer> = {};
    const layerContainer = document.getElementById('layer-options');

    // Extract icons from the module (filter out non-icon exports)
    const iconsObject: Record<string, any> = {};
    for (const [key, value] of Object.entries(LucideIcons)) {
      if (typeof value === 'object' && Array.isArray(value)) {
        iconsObject[key] = value;
      }
    }

    config.layers.forEach((layerSpec) => {
      // Create Leaflet layer
      let leafletLayer: L.Layer;
      if (layerSpec.type === 'wms') {
        leafletLayer = L.tileLayer.wms(layerSpec.url, layerSpec.options);
      } else {
        leafletLayer = L.tileLayer(layerSpec.url, layerSpec.options);
      }
      layers[layerSpec.id] = leafletLayer;

      // Add to map if specified as active
      if (layerSpec.active) {
        leafletLayer.addTo(map);
      }

      // 3. Create UI Button
      if (layerContainer) {
        const btn = document.createElement('button');
        btn.className = `layer-btn ${layerSpec.active ? 'active' : ''}`;
        btn.setAttribute('data-layer', layerSpec.id);
        btn.setAttribute('aria-label', `${layerSpec.label} Layer`);

        // Handle Lucide Icon
        // We use the JSON-specified icon or fallback to 'Map'
        const iconName = layerSpec.icon as string;
        
        btn.innerHTML = `
          <i data-lucide="${iconName}"></i>
          <span>${layerSpec.label}</span>
        `;
        
        layerContainer.appendChild(btn);

        // 4. Attach Listener
        btn.addEventListener('click', (e) => {
          e.preventDefault();
          
          // Clear and set layer
          Object.values(layers).forEach(l => map.removeLayer(l));
          leafletLayer.addTo(map);

          // Update UI
          document.querySelectorAll('.layer-btn').forEach(b => b.classList.remove('active'));
          btn.classList.add('active');
        });
      }
    });

    // Refresh all icons found in the DOM based on data-lucide attribute
    LucideIcons.createIcons({
      icons: iconsObject
    });

  } catch (error) {
    console.error('Error initializing map application:', error);
    document.body.innerHTML += `<div class="glass-panel" style="top:50%; left:50%; transform:translate(-50%,-50%); width: auto;">
      <h2>ERROR</h2>
      <p>${error}</p>
    </div>`;
  }
}

initMap();
