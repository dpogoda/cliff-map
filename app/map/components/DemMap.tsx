'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import maplibregl from 'maplibre-gl';
import { cogProtocol } from '@geomatico/maplibre-cog-protocol';
import { SAMPLE_LOCATIONS } from '@/lib/cog-utils';
import {
  sampleElevationGrid,
  calculateSlopeGrid,
  createSlopeGeoJSON,
} from '@/lib/slope-utils';
import 'maplibre-gl/dist/maplibre-gl.css';

interface DemMapProps {
  initialLocation?: keyof typeof SAMPLE_LOCATIONS;
}

export default function DemMap({ initialLocation = 'alps' }: DemMapProps) {
  const mapContainer = useRef<HTMLDivElement | null>(null);
  const map = useRef<maplibregl.Map | null>(null);
  const updateTimeout = useRef<NodeJS.Timeout | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showCliffs, setShowCliffs] = useState(true);
  const [showTutorial, setShowTutorial] = useState(true);
  const [minSlopeAngle, setMinSlopeAngle] = useState(15); // Minimum slope in degrees
  const [elevation, setElevation] = useState<number | null>(null);
  const [coordinates, setCoordinates] = useState<{ lat: number; lng: number } | null>(null);
  const [isCalculating, setIsCalculating] = useState(false);
  const [currentZoom, setCurrentZoom] = useState(6);
  const [showInfoModal, setShowInfoModal] = useState(false);

  const SLOPE_ZOOM_THRESHOLD = 10; // Switch from hillshade to slope at this zoom

  // Register COG protocol once on component mount
  useEffect(() => {
    maplibregl.addProtocol('cog', cogProtocol);
    return () => {
      maplibregl.removeProtocol('cog');
    };
  }, []);

  // Function to update layer visibility based on zoom
  const updateLayerVisibility = useCallback((mapInstance: maplibregl.Map, zoom: number) => {
    if (!showCliffs) return;

    const useSlope = zoom >= SLOPE_ZOOM_THRESHOLD;

    // Toggle cliff-hillshade visibility (show at low zoom)
    if (mapInstance.getLayer('cliff-hillshade')) {
      mapInstance.setLayoutProperty(
        'cliff-hillshade',
        'visibility',
        useSlope ? 'none' : 'visible'
      );
    }
    if (mapInstance.getLayer('cliff-hillshade-2')) {
      mapInstance.setLayoutProperty(
        'cliff-hillshade-2',
        'visibility',
        useSlope ? 'none' : 'visible'
      );
    }

    // Toggle slope layers visibility (show at high zoom)
    if (mapInstance.getLayer('slope-fill')) {
      mapInstance.setLayoutProperty('slope-fill', 'visibility', useSlope ? 'visible' : 'none');
      mapInstance.setLayoutProperty('slope-outline', 'visibility', useSlope ? 'visible' : 'none');
    }
  }, [showCliffs, SLOPE_ZOOM_THRESHOLD]);

  // Function to update slope visualization
  const updateSlopeVisualization = useCallback(() => {
    if (!map.current || !showCliffs) return;

    const mapInstance = map.current;
    const zoom = mapInstance.getZoom();
    setCurrentZoom(zoom);

    // Update layer visibility
    updateLayerVisibility(mapInstance, zoom);

    // Only calculate slope at zoom level 10+
    if (zoom < SLOPE_ZOOM_THRESHOLD) {
      // Clear slope layer at low zoom (hillshade is shown instead)
      if (mapInstance.getSource('slope-data')) {
        (mapInstance.getSource('slope-data') as maplibregl.GeoJSONSource).setData({
          type: 'FeatureCollection',
          features: [],
        });
      }
      return;
    }

    setIsCalculating(true);

    // Debounce the calculation
    if (updateTimeout.current) {
      clearTimeout(updateTimeout.current);
    }

    updateTimeout.current = setTimeout(() => {
      try {
        const bounds = mapInstance.getBounds();

        // Adjust grid size based on zoom level
        const gridSize = zoom >= 14 ? 60 : zoom >= 12 ? 40 : 25;

        // Sample elevation grid
        const { elevations, lngs, lats } = sampleElevationGrid(mapInstance, bounds, gridSize);

        // Calculate slopes
        const slopeCells = calculateSlopeGrid(elevations, lngs, lats);

        // Calculate cell size
        const cellSizeLng = (bounds.getEast() - bounds.getWest()) / gridSize;
        const cellSizeLat = (bounds.getNorth() - bounds.getSouth()) / gridSize;
        const cellSize = Math.max(cellSizeLng, cellSizeLat);

        // Create GeoJSON
        const geoJson = createSlopeGeoJSON(slopeCells, cellSize, minSlopeAngle);

        // Update source
        if (mapInstance.getSource('slope-data')) {
          (mapInstance.getSource('slope-data') as maplibregl.GeoJSONSource).setData(geoJson);
        }

        console.log(`Slope calculated: ${geoJson.features.length} steep cells found`);
      } catch (err) {
        console.error('Error calculating slope:', err);
      } finally {
        setIsCalculating(false);
      }
    }, 300);
  }, [showCliffs, minSlopeAngle, updateLayerVisibility]);

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
        center: [12.5, 55.5], // Baltic/North Sea region
        zoom: 6,
        pitch: 45,
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

          // Add hillshade layer (base terrain shading)
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

          // Add cliff-highlighting hillshade (red tint for steep areas - shown at low zoom)
          // Using multiple hillshade layers with different light directions for better coverage
          mapInstance.addLayer({
            id: 'cliff-hillshade',
            type: 'hillshade',
            source: 'terrain-dem',
            paint: {
              'hillshade-shadow-color': '#dd2200', // Bright red shadows
              'hillshade-highlight-color': 'rgba(255, 200, 100, 0.1)', // Slight warm highlight
              'hillshade-accent-color': '#ff3300', // Bright red-orange accent
              'hillshade-illumination-direction': 315,
              'hillshade-exaggeration': 1.0, // Full exaggeration
            },
          });

          // Second cliff hillshade from different angle for better coverage
          mapInstance.addLayer({
            id: 'cliff-hillshade-2',
            type: 'hillshade',
            source: 'terrain-dem',
            paint: {
              'hillshade-shadow-color': '#cc0000', // Red shadows
              'hillshade-highlight-color': 'rgba(255, 255, 255, 0)', // Transparent
              'hillshade-accent-color': '#ff4400', // Orange-red
              'hillshade-illumination-direction': 135, // Opposite direction
              'hillshade-exaggeration': 0.7,
            },
          });

          // Enable 3D terrain
          mapInstance.setTerrain({
            source: 'terrain-dem',
            exaggeration: 1.5,
          });

          // Add slope data source (GeoJSON for calculated slopes)
          mapInstance.addSource('slope-data', {
            type: 'geojson',
            data: {
              type: 'FeatureCollection',
              features: [],
            },
          });

          // Add slope fill layer
          mapInstance.addLayer({
            id: 'slope-fill',
            type: 'fill',
            source: 'slope-data',
            paint: {
              'fill-color': ['get', 'color'],
              'fill-opacity': 0.7,
            },
          });

          // Add slope outline for better visibility
          mapInstance.addLayer({
            id: 'slope-outline',
            type: 'line',
            source: 'slope-data',
            paint: {
              'line-color': ['get', 'color'],
              'line-width': 1,
              'line-opacity': 0.5,
            },
          });

          console.log('Terrain and slope visualization enabled');
        } catch (err) {
          console.error('Error adding terrain:', err);
          setError('Failed to load terrain: ' + (err instanceof Error ? err.message : String(err)));
        }
      });

      mapInstance.on('error', (e) => {
        console.error('Map error:', e.error?.message || e.error || e);
      });

      // Track zoom changes for UI updates
      mapInstance.on('zoom', () => {
        setCurrentZoom(mapInstance.getZoom());
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

  // Effect to handle slope visualization updates
  useEffect(() => {
    if (!map.current) return;

    const mapInstance = map.current;

    // Update slope on view changes
    const handleUpdate = () => updateSlopeVisualization();

    mapInstance.on('moveend', handleUpdate);
    mapInstance.on('zoomend', handleUpdate);

    // Initial calculation if map is already loaded
    if (mapInstance.loaded()) {
      setTimeout(updateSlopeVisualization, 300);
    } else {
      mapInstance.once('idle', () => {
        setTimeout(updateSlopeVisualization, 500);
      });
    }

    return () => {
      mapInstance.off('moveend', handleUpdate);
      mapInstance.off('zoomend', handleUpdate);
    };
  }, [updateSlopeVisualization]);

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
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-sm font-bold">Slope Analysis</h3>
          <button
            onClick={() => setShowInfoModal(true)}
            className="w-5 h-5 rounded-full bg-zinc-200 dark:bg-zinc-700 hover:bg-zinc-300 dark:hover:bg-zinc-600 flex items-center justify-center text-zinc-600 dark:text-zinc-300 text-xs font-bold transition-colors"
            title="How it works"
          >
            ?
          </button>
        </div>

        {/* Slope toggle */}
        <label className="flex items-center gap-2 cursor-pointer mb-3">
          <input
            type="checkbox"
            checked={showCliffs}
            onChange={(e) => {
              setShowCliffs(e.target.checked);
              if (map.current) {
                const zoom = map.current.getZoom();
                const useSlope = zoom >= SLOPE_ZOOM_THRESHOLD;

                if (e.target.checked) {
                  // Show appropriate layer based on zoom
                  map.current.setLayoutProperty('cliff-hillshade', 'visibility', useSlope ? 'none' : 'visible');
                  map.current.setLayoutProperty('cliff-hillshade-2', 'visibility', useSlope ? 'none' : 'visible');
                  map.current.setLayoutProperty('slope-fill', 'visibility', useSlope ? 'visible' : 'none');
                  map.current.setLayoutProperty('slope-outline', 'visibility', useSlope ? 'visible' : 'none');
                  updateSlopeVisualization();
                } else {
                  // Hide all cliff layers
                  map.current.setLayoutProperty('cliff-hillshade', 'visibility', 'none');
                  map.current.setLayoutProperty('cliff-hillshade-2', 'visibility', 'none');
                  map.current.setLayoutProperty('slope-fill', 'visibility', 'none');
                  map.current.setLayoutProperty('slope-outline', 'visibility', 'none');
                }
              }
            }}
            className="w-4 h-4 accent-red-600"
          />
          <span className="text-sm">Show Steep Slopes</span>
          {isCalculating && (
            <span className="ml-auto text-xs text-blue-600">calculating...</span>
          )}
        </label>

        {/* Min slope angle slider */}
        <div className="mb-3">
          <label className="text-xs text-zinc-600 dark:text-zinc-400 block mb-1">
            Min slope angle: {minSlopeAngle}°
          </label>
          <input
            type="range"
            min="5"
            max="45"
            step="5"
            value={minSlopeAngle}
            onChange={(e) => {
              setMinSlopeAngle(parseInt(e.target.value));
            }}
            onMouseUp={() => updateSlopeVisualization()}
            onTouchEnd={() => updateSlopeVisualization()}
            className="w-full h-2 bg-zinc-200 rounded-lg appearance-none cursor-pointer"
          />
          <div className="flex justify-between text-xs text-zinc-400 mt-1">
            <span>5° gentle</span>
            <span>45° cliff</span>
          </div>
        </div>

        {/* Color legend */}
        <div className="mb-3 p-2 bg-zinc-50 dark:bg-zinc-800 rounded">
          <p className="text-xs text-zinc-600 dark:text-zinc-400 mb-1">Slope gradient:</p>
          <div className="flex items-center gap-1">
            <div className="h-3 flex-1 rounded" style={{ background: 'linear-gradient(to right, transparent, #ffcc00, #ff6600, #cc0000)' }}></div>
          </div>
          <div className="flex justify-between text-xs text-zinc-400 mt-1">
            <span>flat</span>
            <span>steep</span>
          </div>
        </div>

        {/* Quick navigation */}
        <div className="flex gap-2">
          <button
            onClick={() => {
              if (map.current) {
                map.current.flyTo({
                  center: [-9.5, 38.78],
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
          {currentZoom < SLOPE_ZOOM_THRESHOLD ? (
            <>Hillshade mode (zoom {Math.round(currentZoom)}) — zoom to 10+ for precise slope</>
          ) : (
            <>Slope mode (zoom {Math.round(currentZoom)}) — calculating actual angles</>
          )}
        </p>
      </div>

      {/* Tutorial overlay */}
      {showTutorial && (
        <div className="absolute inset-0 bg-black/60 flex items-center justify-center z-50">
          <div className="bg-white dark:bg-zinc-900 rounded-xl shadow-2xl max-w-md mx-4 overflow-hidden">
            <div className="bg-gradient-to-r from-blue-600 to-blue-700 px-6 py-4">
              <h2 className="text-xl font-bold text-white">Welcome to Cliff Finder</h2>
              <p className="text-blue-100 text-sm">Explore terrain and discover steep coastal cliffs</p>
            </div>
            <div className="px-6 py-4 space-y-4">
              <div className="flex gap-3">
                <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center text-blue-600 font-bold shrink-0">1</div>
                <div>
                  <p className="font-medium">Navigate the map</p>
                  <p className="text-sm text-zinc-500">Drag to pan, scroll to zoom, right-drag to rotate</p>
                </div>
              </div>
              <div className="flex gap-3">
                <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center text-blue-600 font-bold shrink-0">2</div>
                <div>
                  <p className="font-medium">View elevation</p>
                  <p className="text-sm text-zinc-500">Move your mouse to see height in meters</p>
                </div>
              </div>
              <div className="flex gap-3">
                <div className="w-8 h-8 rounded-full bg-red-100 flex items-center justify-center text-red-600 font-bold shrink-0">3</div>
                <div>
                  <p className="font-medium">Find steep slopes</p>
                  <p className="text-sm text-zinc-500">Enable "Show Steep Slopes" to highlight cliffs in red</p>
                </div>
              </div>
              <div className="flex gap-3">
                <div className="w-8 h-8 rounded-full bg-green-100 flex items-center justify-center text-green-600 font-bold shrink-0">4</div>
                <div>
                  <p className="font-medium">Quick locations</p>
                  <p className="text-sm text-zinc-500">Use buttons to fly to famous coastal cliffs or mountains</p>
                </div>
              </div>
            </div>
            <div className="px-6 py-4 bg-zinc-50 dark:bg-zinc-800">
              <button
                onClick={() => setShowTutorial(false)}
                className="w-full py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-lg transition-colors"
              >
                Start Exploring
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Info modal */}
      {showInfoModal && (
        <div className="absolute inset-0 bg-black/60 flex items-center justify-center z-50">
          <div className="bg-white dark:bg-zinc-900 rounded-xl shadow-2xl max-w-lg mx-4 overflow-hidden max-h-[90vh] overflow-y-auto">
            <div className="bg-gradient-to-r from-zinc-700 to-zinc-800 px-6 py-4 flex items-center justify-between">
              <div>
                <h2 className="text-xl font-bold text-white">How Slope Analysis Works</h2>
                <p className="text-zinc-300 text-sm">Technical details about the computation</p>
              </div>
              <button
                onClick={() => setShowInfoModal(false)}
                className="text-white hover:text-zinc-300 text-2xl leading-none"
              >
                &times;
              </button>
            </div>
            <div className="px-6 py-4 space-y-4 text-sm">
              <div>
                <h3 className="font-bold text-base mb-2">Two Visualization Modes</h3>
                <p className="text-zinc-600 dark:text-zinc-400 mb-2">
                  The application uses different techniques depending on zoom level for optimal performance and accuracy.
                </p>
              </div>

              <div className="p-3 bg-orange-50 dark:bg-orange-900/20 rounded-lg border border-orange-200 dark:border-orange-800">
                <h4 className="font-bold text-orange-700 dark:text-orange-400 mb-1">Hillshade Mode (Zoom &lt; 10)</h4>
                <p className="text-zinc-600 dark:text-zinc-400">
                  At low zoom levels, we use <strong>hillshade rendering</strong> with red-tinted shadows.
                  This technique simulates light hitting the terrain from multiple angles (315° and 135°),
                  creating shadows on steep slopes. Fast but approximate — shows steepness relative to light direction.
                </p>
              </div>

              <div className="p-3 bg-blue-50 dark:bg-blue-900/20 rounded-lg border border-blue-200 dark:border-blue-800">
                <h4 className="font-bold text-blue-700 dark:text-blue-400 mb-1">Slope Mode (Zoom &ge; 10)</h4>
                <p className="text-zinc-600 dark:text-zinc-400">
                  At higher zoom levels, we calculate <strong>true slope angles</strong> in degrees.
                  The map is divided into a grid, elevation is sampled at each point, and slope is computed using:
                </p>
                <div className="mt-2 p-2 bg-white dark:bg-zinc-800 rounded font-mono text-xs">
                  slope = arctan(elevation_change / horizontal_distance)
                </div>
                <p className="text-zinc-600 dark:text-zinc-400 mt-2">
                  Horizontal distance is calculated using the <strong>Haversine formula</strong> for accurate
                  Earth-surface distances. Maximum slope from 4 directions (N, E, S, W + diagonal) is used.
                </p>
              </div>

              <div>
                <h4 className="font-bold mb-1">Color Scale</h4>
                <div className="flex items-center gap-2 mb-2">
                  <div className="h-4 flex-1 rounded" style={{ background: 'linear-gradient(to right, transparent, #ffcc00, #ff6600, #cc0000)' }}></div>
                </div>
                <ul className="text-zinc-600 dark:text-zinc-400 space-y-1">
                  <li><span className="inline-block w-3 h-3 rounded bg-yellow-400 mr-2"></span><strong>Yellow:</strong> Moderate slopes (15-25°)</li>
                  <li><span className="inline-block w-3 h-3 rounded bg-orange-500 mr-2"></span><strong>Orange:</strong> Steep slopes (25-35°)</li>
                  <li><span className="inline-block w-3 h-3 rounded bg-red-600 mr-2"></span><strong>Red:</strong> Very steep / cliffs (35°+)</li>
                </ul>
              </div>

              <div>
                <h4 className="font-bold mb-1">Data Source</h4>
                <p className="text-zinc-600 dark:text-zinc-400">
                  Elevation data comes from <strong>AWS Terrain Tiles</strong> (Terrarium encoding),
                  derived from multiple sources including SRTM, ETOPO1, and GMTED2010.
                  Resolution varies by location but is typically 30-90 meters.
                </p>
              </div>

              <div>
                <h4 className="font-bold mb-1">Grid Resolution</h4>
                <p className="text-zinc-600 dark:text-zinc-400">
                  Slope calculation uses adaptive grid sizing:
                </p>
                <ul className="text-zinc-600 dark:text-zinc-400 mt-1 space-y-1">
                  <li>• Zoom 10-11: 25×25 grid cells</li>
                  <li>• Zoom 12-13: 40×40 grid cells</li>
                  <li>• Zoom 14+: 60×60 grid cells</li>
                </ul>
              </div>
            </div>
            <div className="px-6 py-4 bg-zinc-50 dark:bg-zinc-800">
              <button
                onClick={() => setShowInfoModal(false)}
                className="w-full py-2.5 bg-zinc-700 hover:bg-zinc-600 text-white font-medium rounded-lg transition-colors"
              >
                Got it
              </button>
            </div>
          </div>
        </div>
      )}

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
