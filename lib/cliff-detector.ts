/**
 * Cliff detection utilities for analyzing DEM data
 * Identifies areas with significant elevation changes (potential cliffs)
 */

interface SlopeParams {
  heightDiff: number; // meters (e.g., 3m)
  horizontalDist: number; // meters (e.g., 20m)
}

/**
 * Calculate if a slope represents a potential cliff
 * @param heightDiff - Height difference in meters
 * @param horizontalDist - Horizontal distance in meters
 * @returns Slope angle in degrees
 */
export function calculateSlopeAngle(heightDiff: number, horizontalDist: number): number {
  return Math.atan(heightDiff / horizontalDist) * (180 / Math.PI);
}

/**
 * Determine if slope meets cliff criteria
 * @param slopeAngle - Slope angle in degrees
 * @param minAngle - Minimum angle to be considered a cliff (default: 8.5° for 3m/20m)
 * @returns True if slope is steep enough to be a cliff
 */
export function isCliff(slopeAngle: number, minAngle: number = 8.5): boolean {
  return slopeAngle >= minAngle;
}

/**
 * Get cliff detection parameters
 */
export function getCliffParams(
  heightDiff: number = 3,
  horizontalDist: number = 20
): SlopeParams & { minAngle: number; gradient: number } {
  const gradient = (heightDiff / horizontalDist) * 100; // percentage
  const minAngle = calculateSlopeAngle(heightDiff, horizontalDist);

  return {
    heightDiff,
    horizontalDist,
    minAngle,
    gradient,
  };
}

/**
 * Analyze elevation data to find potential cliffs
 * @param elevationData - 2D array of elevation values
 * @param resolution - Spatial resolution in meters per pixel
 * @param params - Cliff detection parameters
 * @returns Array of cliff locations
 */
export function detectCliffs(
  elevationData: number[][],
  resolution: number,
  params: SlopeParams
): boolean[][] {
  const height = elevationData.length;
  const width = elevationData[0]?.length || 0;
  const cliffMask: boolean[][] = Array(height)
    .fill(null)
    .map(() => Array(width).fill(false));

  const pixelDistance = Math.ceil(params.horizontalDist / resolution);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const currentElev = elevationData[y][x];
      if (currentElev === null || isNaN(currentElev)) continue;

      // Check surrounding pixels within the horizontal distance
      for (let dy = -pixelDistance; dy <= pixelDistance; dy++) {
        for (let dx = -pixelDistance; dx <= pixelDistance; dx++) {
          if (dx === 0 && dy === 0) continue;

          const nx = x + dx;
          const ny = y + dy;

          if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;

          const neighborElev = elevationData[ny][nx];
          if (neighborElev === null || isNaN(neighborElev)) continue;

          const actualDistance = Math.sqrt(dx * dx + dy * dy) * resolution;
          if (actualDistance > params.horizontalDist) continue;

          const elevDiff = Math.abs(currentElev - neighborElev);
          const slopeAngle = calculateSlopeAngle(elevDiff, actualDistance);

          const minAngle = calculateSlopeAngle(params.heightDiff, params.horizontalDist);
          if (slopeAngle >= minAngle) {
            cliffMask[y][x] = true;
            break;
          }
        }
        if (cliffMask[y][x]) break;
      }
    }
  }

  return cliffMask;
}

/**
 * Create a GeoJSON feature collection from cliff mask
 * @param cliffMask - Boolean array indicating cliff locations
 * @param bounds - Geographic bounds [west, south, east, north]
 * @returns GeoJSON FeatureCollection of cliff points
 */
export function cliffMaskToGeoJSON(
  cliffMask: boolean[][],
  bounds: [number, number, number, number]
): GeoJSON.FeatureCollection {
  const [west, south, east, north] = bounds;
  const height = cliffMask.length;
  const width = cliffMask[0]?.length || 0;

  const features: GeoJSON.Feature[] = [];

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (!cliffMask[y][x]) continue;

      const lon = west + (x / width) * (east - west);
      const lat = north - (y / height) * (north - south);

      features.push({
        type: 'Feature',
        geometry: {
          type: 'Point',
          coordinates: [lon, lat],
        },
        properties: {
          isCliff: true,
        },
      });
    }
  }

  return {
    type: 'FeatureCollection',
    features,
  };
}
