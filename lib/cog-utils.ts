/**
 * Utilities for working with Copernicus DEM Cloud Optimized GeoTIFF tiles
 */

export interface CopernicusTile {
  lat: number;
  lon: number;
  url: string;
}

/**
 * Generates the Copernicus DEM GLO-30 tile URL for a given latitude and longitude
 *
 * Tile naming convention:
 * Copernicus_DSM_COG_10_N{lat}_00_E{lon}_00_DEM/Copernicus_DSM_COG_10_N{lat}_00_E{lon}_00_DEM.tif
 *
 * @param lat - Latitude (will be floored to nearest degree)
 * @param lon - Longitude (will be floored to nearest degree)
 * @returns The full HTTPS URL to the COG tile
 */
export function getCopernicusTileUrl(lat: number, lon: number): string {
  // Floor to nearest degree (tiles are 1° x 1°)
  const tileLat = Math.floor(lat);
  const tileLon = Math.floor(lon);

  // Determine hemisphere prefixes
  const latPrefix = tileLat >= 0 ? 'N' : 'S';
  const lonPrefix = tileLon >= 0 ? 'E' : 'W';

  // Format coordinates with leading zeros (2 digits for lat, 3 for lon)
  const latStr = Math.abs(tileLat).toString().padStart(2, '0');
  const lonStr = Math.abs(tileLon).toString().padStart(3, '0');

  // Build tile name
  const tileName = `Copernicus_DSM_COG_10_${latPrefix}${latStr}_00_${lonPrefix}${lonStr}_00_DEM`;

  // Return full URL
  return `https://copernicus-dem-30m.s3.amazonaws.com/${tileName}/${tileName}.tif`;
}

/**
 * Generates COG protocol URL for use with MapLibre (via proxy to avoid CORS)
 *
 * @param lat - Latitude
 * @param lon - Longitude
 * @returns COG protocol URL with #dem suffix for single-band DEM
 */
export function getCogProtocolUrl(lat: number, lon: number): string {
  // Floor to nearest degree (tiles are 1° x 1°)
  const tileLat = Math.floor(lat);
  const tileLon = Math.floor(lon);

  // Determine hemisphere prefixes
  const latPrefix = tileLat >= 0 ? 'N' : 'S';
  const lonPrefix = tileLon >= 0 ? 'E' : 'W';

  // Format coordinates with leading zeros (2 digits for lat, 3 for lon)
  const latStr = Math.abs(tileLat).toString().padStart(2, '0');
  const lonStr = Math.abs(tileLon).toString().padStart(3, '0');

  // Build tile name
  const tileName = `Copernicus_DSM_COG_10_${latPrefix}${latStr}_00_${lonPrefix}${lonStr}_00_DEM`;

  // Use path-based proxy to avoid CORS issues
  const proxyPath = `/api/cog/${tileName}/${tileName}.tif`;
  // Use #dem suffix to convert single-band elevation to terrain-rgb format
  return `cog://${window.location.origin}${proxyPath}#dem`;
}

/**
 * Get multiple tile URLs for a bounding box
 *
 * @param bounds - Bounding box {north, south, east, west}
 * @returns Array of tile information
 */
export function getTilesForBounds(bounds: {
  north: number;
  south: number;
  east: number;
  west: number;
}): CopernicusTile[] {
  const tiles: CopernicusTile[] = [];

  // Iterate through each degree
  for (let lat = Math.floor(bounds.south); lat < Math.ceil(bounds.north); lat++) {
    for (let lon = Math.floor(bounds.west); lon < Math.ceil(bounds.east); lon++) {
      tiles.push({
        lat,
        lon,
        url: getCopernicusTileUrl(lat, lon),
      });
    }
  }

  return tiles;
}

/**
 * Common European locations for quick testing
 */
export const SAMPLE_LOCATIONS = {
  alps: { lat: 46.5, lon: 10.5, zoom: 9, name: 'Alps' },
  pyrenees: { lat: 42.5, lon: 1.0, zoom: 9, name: 'Pyrenees' },
  carpathians: { lat: 45.5, lon: 25.0, zoom: 9, name: 'Carpathians' },
  scotland: { lat: 57.0, lon: -4.0, zoom: 8, name: 'Scottish Highlands' },
  norway: { lat: 61.0, lon: 7.0, zoom: 8, name: 'Norway' },
  germany: { lat: 51.0, lon: 7.0, zoom: 8, name: 'Germany' },
} as const;
