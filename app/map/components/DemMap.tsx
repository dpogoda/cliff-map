'use client';

import { useEffect, useRef, useState } from 'react';
import maplibregl from 'maplibre-gl';
import { cogProtocol } from '@geomatico/maplibre-cog-protocol';
import { getCogProtocolUrl, SAMPLE_LOCATIONS } from '@/lib/cog-utils';
import 'maplibre-gl/dist/maplibre-gl.css';

interface DemMapProps {
  initialLocation?: keyof typeof SAMPLE_LOCATIONS;
}

export default function DemMap({ initialLocation = 'alps' }: DemMapProps) {
  const mapContainer = useRef<HTMLDivElement | null>(null);
  const map = useRef<maplibregl.Map | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showCliffs, setShowCliffs] = useState(true);
  const [cliffIntensity, setCliffIntensity] = useState(0.8);
  const [elevation, setElevation] = useState<number | null>(null);
  const [coordinates, setCoordinates] = useState<{ lat: number; lng: number } | null>(null);

  // Register COG protocol once on component mount
  useEffect(() => {
    maplibregl.addProtocol('cog', cogProtocol);
    return () => {
      maplibregl.removeProtocol('cog');
    };
  }, []);

  useEffect(() => {
    if (!mapContainer.current || map.current) return;

    try {
      const location = SAMPLE_LOCATIONS[initialLocation];

      // Initialize map
      const mapInstance = new maplibregl.Map({
        container: mapContainer.current,
        style: {
          version: 8,
          sources: {
            'raster-tiles': {
              type: 'raster',
              tiles: [
                'https://tile.openstreetmap.org/{z}/{x}/{y}.png'
              ],
              tileSize: 256,
              attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
            }
          },
          layers: [
            {
              id: 'simple-tiles',
              type: 'raster',
              source: 'raster-tiles',
              minzoom: 0,
              maxzoom: 22
            }
          ]
        },
        center: [location.lon, location.lat],
        zoom: 11, // Zoom in to see COG tile clearly
        pitch: 0, // Start flat to see raster overlay
        bearing: 0,
      });

      // Add navigation controls
      mapInstance.addControl(new maplibregl.NavigationControl(), 'top-right');

      // Add scale control
      mapInstance.addControl(
        new maplibregl.ScaleControl({
          maxWidth: 200,
          unit: 'metric',
        }),
        'bottom-left'
      );

      mapInstance.on('load', async () => {
        setIsLoading(false);

        try {
          // Use AWS Terrain Tiles for reliable 3D terrain (Terrarium encoding)
          mapInstance.addSource('terrain-dem', {
            type: 'raster-dem',
            tiles: [
              'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'
            ],
            encoding: 'terrarium',
            tileSize: 256,
            maxzoom: 15,
          });

          // Add hillshade layer
          mapInstance.addLayer({
            id: 'hillshade',
            type: 'hillshade',
            source: 'terrain-dem',
            paint: {
              'hillshade-shadow-color': '#473B24',
              'hillshade-highlight-color': '#FFFFFF',
              'hillshade-accent-color': '#333333',
              'hillshade-illumination-direction': 315,
              'hillshade-exaggeration': 0.5,
            },
          });

          // Enable 3D terrain
          mapInstance.setTerrain({
            source: 'terrain-dem',
            exaggeration: 1.5,
          });

          // Add cliff highlighting layer - steeper slopes = more intense red
          mapInstance.addLayer({
            id: 'cliffs',
            type: 'hillshade',
            source: 'terrain-dem',
            paint: {
              'hillshade-shadow-color': '#ff0000',  // Red for steep shadows
              'hillshade-highlight-color': 'rgba(255, 100, 100, 0.3)', // Light red highlights
              'hillshade-accent-color': '#cc0000',  // Dark red accent
              'hillshade-illumination-direction': 270, // Light from west to catch east-facing cliffs
              'hillshade-exaggeration': 1.0, // Maximum exaggeration
            },
          });

          // Add another cliff layer from opposite direction for better coverage
          mapInstance.addLayer({
            id: 'cliffs-east',
            type: 'hillshade',
            source: 'terrain-dem',
            paint: {
              'hillshade-shadow-color': 'rgba(255, 50, 0, 0.6)',
              'hillshade-highlight-color': 'rgba(0, 0, 0, 0)',
              'hillshade-accent-color': '#ff3300',
              'hillshade-illumination-direction': 90, // Light from east
              'hillshade-exaggeration': 1.0,
            },
          });

          console.log('Terrain and cliff highlighting enabled');
        } catch (err) {
          console.error('Error adding terrain:', err);
          setError('Failed to load terrain: ' + (err instanceof Error ? err.message : String(err)));
        }
      });

      mapInstance.on('error', (e) => {
        console.error('Map error:', e.error?.message || e.error || e);
      });

      // Track mouse movement to show elevation
      mapInstance.on('mousemove', (e) => {
        const elev = mapInstance.queryTerrainElevation(e.lngLat);
        if (elev !== null) {
          setElevation(Math.round(elev));
          setCoordinates({ lat: e.lngLat.lat, lng: e.lngLat.lng });
        }
      });

      // Clear elevation when mouse leaves map
      mapInstance.on('mouseout', () => {
        setElevation(null);
        setCoordinates(null);
      });

      map.current = mapInstance;
    } catch (err) {
      console.error('Error initializing map:', err);
      setError('Failed to initialize map');
      setIsLoading(false);
    }

    // Cleanup
    return () => {
      if (map.current) {
        map.current.remove();
        map.current = null;
      }
    };
  }, [initialLocation]);

  return (
    <div className="relative w-full h-full">
      <div ref={mapContainer} className="w-full h-full" />

      {isLoading && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/50">
          <div className="bg-white dark:bg-zinc-900 px-6 py-4 rounded-lg shadow-lg">
            <p className="text-lg font-medium">Loading map...</p>
          </div>
        </div>
      )}

      {error && (
        <div className="absolute top-4 left-1/2 -translate-x-1/2 bg-red-500 text-white px-6 py-3 rounded-lg shadow-lg">
          <p className="font-medium">{error}</p>
        </div>
      )}

      {/* Info panel */}
      <div className="absolute top-4 left-4 bg-white dark:bg-zinc-900 px-4 py-3 rounded-lg shadow-lg border border-zinc-200 dark:border-zinc-700 max-w-xs">
        <h3 className="text-sm font-bold mb-2">Cliff Highlighter</h3>

        {/* Cliff toggle */}
        <label className="flex items-center gap-2 cursor-pointer mb-3">
          <input
            type="checkbox"
            checked={showCliffs}
            onChange={(e) => {
              setShowCliffs(e.target.checked);
              if (map.current) {
                const visibility = e.target.checked ? 'visible' : 'none';
                map.current.setLayoutProperty('cliffs', 'visibility', visibility);
                map.current.setLayoutProperty('cliffs-east', 'visibility', visibility);
              }
            }}
            className="w-4 h-4 accent-red-600"
          />
          <span className="text-sm">Show Steep Slopes</span>
          <span className="ml-auto w-3 h-3 bg-red-600 rounded-sm"></span>
        </label>

        {/* Intensity slider */}
        <div className="mb-3">
          <label className="text-xs text-zinc-600 dark:text-zinc-400 block mb-1">
            Intensity: {Math.round(cliffIntensity * 100)}%
          </label>
          <input
            type="range"
            min="0.1"
            max="1"
            step="0.1"
            value={cliffIntensity}
            onChange={(e) => {
              const intensity = parseFloat(e.target.value);
              setCliffIntensity(intensity);
              if (map.current) {
                map.current.setPaintProperty('cliffs', 'hillshade-shadow-color', `rgba(255, 0, 0, ${intensity})`);
                map.current.setPaintProperty('cliffs-east', 'hillshade-shadow-color', `rgba(255, 50, 0, ${intensity * 0.75})`);
              }
            }}
            className="w-full h-2 bg-zinc-200 rounded-lg appearance-none cursor-pointer"
          />
        </div>

        {/* Quick navigation */}
        <div className="flex gap-2">
          <button
            onClick={() => {
              if (map.current) {
                map.current.flyTo({
                  center: [-9.5, 38.78], // Cabo da Roca, Portugal (coastal cliffs)
                  zoom: 14,
                  pitch: 60,
                  bearing: 45,
                });
              }
            }}
            className="flex-1 px-2 py-1.5 text-xs font-medium bg-blue-600 hover:bg-blue-700 text-white rounded transition-colors"
          >
            Coastal Cliffs
          </button>
          <button
            onClick={() => {
              if (map.current) {
                map.current.flyTo({
                  center: [10.5, 46.5],
                  zoom: 12,
                  pitch: 60,
                  bearing: -20,
                });
              }
            }}
            className="flex-1 px-2 py-1.5 text-xs font-medium bg-zinc-600 hover:bg-zinc-700 text-white rounded transition-colors"
          >
            Alps
          </button>
        </div>

        <p className="text-xs text-zinc-500 mt-3">
          Red = steep slopes (potential cliffs)
        </p>
      </div>

      {/* Elevation display */}
      <div className="absolute bottom-20 left-4 bg-white dark:bg-zinc-900 px-4 py-3 rounded-lg shadow-lg border border-zinc-200 dark:border-zinc-700">
        <div className="flex items-center gap-4">
          <div>
            <p className="text-xs text-zinc-500 uppercase tracking-wide">Elevation</p>
            <p className="text-2xl font-bold font-mono">
              {elevation !== null ? `${elevation}m` : '—'}
            </p>
          </div>
          {coordinates && (
            <div className="border-l border-zinc-200 dark:border-zinc-700 pl-4">
              <p className="text-xs text-zinc-500">Coordinates</p>
              <p className="text-xs font-mono">
                {coordinates.lat.toFixed(4)}°, {coordinates.lng.toFixed(4)}°
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Attribution */}
      <div className="absolute bottom-4 right-4 bg-white/90 dark:bg-zinc-900/90 px-3 py-2 rounded text-xs max-w-md">
        <p className="text-zinc-700 dark:text-zinc-300">
          Terrain: AWS Terrain Tiles
        </p>
      </div>
    </div>
  );
}
