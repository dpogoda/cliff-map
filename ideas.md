# GeoTIFF to Cloud Optimized GeoTIFF (COG) Conversion and Display

## Overview
This document summarizes a conversation about converting GeoTIFF files to Cloud Optimized GeoTIFF (COG/CloudTIFF) format and displaying Copernicus DEM GLO-30 data using MapLibre in a Next.js application.

## Converting GeoTIFF to COG

### Simplest Method (GDAL CLI)

```bash
gdal_translate input.tif output_cog.tif \
  -of COG \
  -co COMPRESS=LZW \
  -co TILING_SCHEME=GoogleMapsCompatible
```

Or, without a tiling scheme:

```bash
gdal_translate input.tif output_cog.tif -of COG -co COMPRESS=LZW
```

**GDAL handles:**
- Tiling
- Internal overviews
- Correct metadata
- Byte-range placement for HTTP range requests

### Python (rasterio)

```python
import rasterio
from rasterio.shutil import copy as rio_copy

rio_copy(
  "input.tif",
  "output_cog.tif",
  driver="COG",
  compress="LZW"
)
```

### Notes
- Use `float32` or `uint16` when possible to reduce size
- For Sentinel-2: typical compressions are LZW or DEFLATE
- Avoid tiled GeoTIFFs without overviews; they won't be COG-compliant

## NPM Packages for Displaying COG

### 1. OpenLayers (Easiest for Plain Web Maps)

OpenLayers has first-class GeoTIFF/COG support:

```bash
npm install ol
```

**Example:**

```js
import Map from 'ol/Map.js';
import TileLayer from 'ol/layer/WebGLTile.js';
import GeoTIFF from 'ol/source/GeoTIFF.js';

const source = new GeoTIFF({
  sources: [
    {
      url: 'https://your-bucket/path/to/your_cog.tif',
    },
  ],
});

const map = new Map({
  target: 'map',
  layers: [
    new TileLayer({ source }),
  ],
  view: source.getView(), // derives extent/resolution from COG
});
```

This directly reads the COG via HTTP range requests and renders it as a tiled WebGL layer.

**Reference:** [OpenLayers COG Example](https://openlayers.org/en/latest/examples/cog.html)

### 2. MapLibre GL JS + COG Protocol

If you prefer Mapbox-style vector maps:

```bash
npm install maplibre-gl @geomatico/maplibre-cog-protocol
```

**Example:**

```js
import maplibregl from 'maplibre-gl';
import { cogProtocol } from '@geomatico/maplibre-cog-protocol';

maplibregl.addProtocol('cog', cogProtocol);

const map = new maplibregl.Map({
  container: 'map',
  style: 'https://demotiles.maplibre.org/styles/osm-bright-gl-style/style.json',
  center: [lon, lat],
  zoom: 10,
});

map.on('load', () => {
  map.addSource('cogSource', {
    type: 'raster',
    url: 'cog://https://your-bucket/path/to/your_cog.tif',
    tileSize: 256,
  });
  
  map.addLayer({
    id: 'cogLayer',
    type: 'raster',
    source: 'cogSource',
  });
});
```

This uses a custom `cog://` protocol handler to stream tiles directly from the COG.

**Reference:** [MapLibre COG Example](https://www.maplibre.org/maplibre-gl-js/docs/examples/add-a-cog-raster-source/)

### 3. Low-level Parsing in JS

If you want to handle the pixels yourself (e.g., for analysis, custom shaders):

- **`geotiff` / `geotiff.js`** (browser + Node):
  ```bash
  npm install geotiff
  ```
  Can read COGs over HTTP/S3 with range requests; you then pipe data into your own renderer (Canvas/WebGL).

- **`@cogeotiff/core` / `cogeotiff`**: High-performance COG access; supports huge COGs, lazy loading, S3, etc. More low-level, you build your own visualization.

### 4. Leaflet Ecosystem

There isn't a "one official" COG package, but common patterns:
- Use `geotiff.js` + a Leaflet raster layer plugin (e.g., `leaflet-geotiff-2`) where you supply tiles from the COG
- Or stand up a tile server (TiTiler) and just consume standard XYZ/WMTS tiles in Leaflet

## Copernicus DEM GLO-30 Project Plan

### Original Plan
Download the whole GLO-30 DEM as GeoTIFF → turn into COG → host it somewhere → provide a map via Next.js

### Feasibility Assessment

**Short answer:** Yes, technically feasible, but downloading + hosting the entire GLO-30 yourself is probably unnecessary and expensive.

**Key points:**

1. **Dataset size and tiling:**
   - Copernicus DEM GLO-30 is ≈3.4 TB globally
   - It's distributed as ~26,500 1°×1° tiles
   - On AWS and other mirrors, many tiles are already in COG or easily converted

2. **Challenges of full download:**
   - Handling multiple TB locally
   - Long conversion times
   - Non-trivial storage + egress cost at your host

### Recommended Approach: Use Existing Public Hosting

**Copernicus DEM GLO-30 is already mirrored as open data on AWS and other platforms:**

- **AWS Registry of Open Data**, with GLO-30 public tiles
- **MyOpenTopo/OpenTopography**, which even offers COG tiles and bulk download

**You can:**
- Leave the DEM where it is (on AWS/etc.)
- Directly read those COGs in the browser via HTTP range requests using `ol/source/GeoTIFF` in OpenLayers, or a COG protocol for MapLibre
- Your Next.js app then just becomes a thin frontend that talks to public COGs

**No need to:**
- Store several TB yourself
- Pay for outgoing traffic to users (beyond what the public dataset host pays)

### Next.js + COG Integration

**Feasible and already a common pattern:**

1. Use Next.js for the app shell (React)
2. Add OpenLayers or MapLibre client-side only (dynamic import to bypass SSR issues)
3. Example for OpenLayers COG support: `ol/source/GeoTIFF` + `WebGLTile` layer

**For DEM visualization you can:**
- Render greyscale elevation
- Generate hillshade client-side (possible, but GPU-heavy)
- Or pre-compute hillshade COGs server-side and show those

## Public Tile Links and Pricing

### 1. AWS Public Copernicus DEM (GLO-30) COGs

**Registry of Open Data page:**
- [Copernicus DEM on AWS](https://registry.opendata.aws/copernicus-dem/)

**The actual S3 bucket for the 30 m data:**
- **Bucket:** `copernicus-dem-30m`
- **Public HTTP endpoint (no auth):** `https://copernicus-dem-30m.s3.amazonaws.com/`

**Tiles are 1°×1° COGs with filenames encoding the tile origin. Typical paths look like:**
```
https://copernicus-dem-30m.s3.amazonaws.com/Copernicus_DSM_COG_10_N51_00_E007_00_DEM/Copernicus_DSM_COG_10_N51_00_E007_00_DEM.tif
```

You can derive paths programmatically from lat/lon (or use tools like `rio-tiler-pds`' `Dem30Reader`, which already knows the naming scheme).

**Pricing on AWS:**
- The dataset itself is **free to read** (no S3 request or data charges from the bucket owner)
- If you read it directly from your users' browsers (HTTP range requests straight to `copernicus-dem-30m.s3.amazonaws.com`), **you pay nothing**
- If you copy tiles into your own S3 bucket or proxy through your own AWS account, then normal S3/storage/egress pricing applies to your bucket, not to the public one

### 2. OpenTopography Access

**OpenTopography wraps the same GLO-30 dataset and exposes it via their portal and APIs:**
- [Dataset metadata page for Copernicus DEM](https://portal.opentopography.org/datasetMetadata?otCollectionID=OT.032021.4326.1)

**You typically:**
- Use their web map / API / QGIS plugin to request DEM for a bounding box
- They generate a cutout (e.g., GeoTIFF) you can download

**OpenTopography pricing / usage:**
- Access to global Copernicus GLO-30 and GLO-90 via OpenTopography is **free** for research and most general uses
- They require registration and an API key for programmatic access
- They enforce usage limits / fair-use quotas (number of requests, data volume)
- OpenTopography's model is: free academic/service with rate limits, not a metered commercial cloud service like AWS

### What This Means for Your Next.js Map

**For your "host COGs and show them in a Next.js app" idea, the simplest and cheapest is:**
- Do **not** mirror the DEM
- Point your frontend (OpenLayers / MapLibre with COG protocol) directly at `https://copernicus-dem-30m.s3.amazonaws.com/...DEM.tif`
- Let the browser issue HTTP range requests against the public bucket

**You pay zero for the DEM itself and only for your own app hosting.**

## Using MapLibre with COG Protocol for GLO-30

### Setup

**Install:**
```bash
npm install maplibre-gl @geomatico/maplibre-cog-protocol
```

### Basic React/Next.js Client Component

```ts
import { useEffect, useRef } from 'react';
import maplibregl from 'maplibre-gl';
import { cogProtocol } from '@geomatico/maplibre-cog-protocol';

export default function DemMap() {
  const mapContainer = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!mapContainer.current) return;

    // register the custom protocol once
    maplibregl.addProtocol('cog', cogProtocol);

    const map = new maplibregl.Map({
      container: mapContainer.current,
      style: 'https://demotiles.maplibre.org/styles/osm-bright-gl-style/style.json',
      center: [7, 51], // somewhere over Germany
      zoom: 8,
    });

    map.on('load', () => {
      map.addSource('dem', {
        type: 'raster-dem',
        // NOTE: you need a valid Copernicus DEM COG URL here:
        // Example tile (replace with the tile you want):
        // Copernicus_DSM_COG_10_N51_00_E007_00_DEM.tif
        url: 'cog://https://copernicus-dem-30m.s3.amazonaws.com/Copernicus_DSM_COG_10_N51_00_E007_00_DEM/Copernicus_DSM_COG_10_N51_00_E007_00_DEM.tif#dem',
        tileSize: 256,
      });

      // use as terrain (3D)
      map.setTerrain({ source: 'dem' });

      // or hillshade layer:
      map.addLayer({
        id: 'hillshade',
        type: 'hillshade',
        source: 'dem',
      });
    });

    return () => map.remove();
  }, []);

  return (
    <div
      ref={mapContainer}
      style={{ width: '100%', height: '100%' }}
    />
  );
}
```

**Key bits:**
- `maplibregl.addProtocol('cog', cogProtocol);`
- `url: 'cog://<COG_URL>#dem'` for single-band DEMs (Copernicus GLO-30 tiles)

**Reference:** [GitHub - maplibre-cog-protocol](https://github.com/geomatico/maplibre-cog-protocol)

### Using This in Next.js Specifically

Because MapLibre touches `window`, use a client component / dynamic import:

```ts
// app/dem-map/page.tsx or similar
'use client';
import DemMap from './DemMap'; // the component above

export default function Page() {
  return (
    <div style={{ width: '100%', height: '100vh' }}>
      <DemMap />
    </div>
  );
}
```

Or:

```ts
const DemMap = dynamic(
  () => import('./DemMap'),
  { ssr: false }
);
```

**So: yes, you can fetch Copernicus GLO-30 COGs directly from AWS in the browser via MapLibre + `@geomatico/maplibre-cog-protocol`, no extra server needed.**

The main remaining work is: given a viewport / lat-lon, pick the correct tile URL (you can hardcode a few for Europe to start, or later write a small helper to map bbox → tile name).

## AWS Storage Format Confirmation

**On AWS it's stored as Cloud Optimized GeoTIFFs, not plain GeoTIFFs.**

The AWS readme for `copernicus-dem-30m` explicitly states:
- "Data is provided as Cloud Optimized GeoTIFFs."
- It then details COG-specific properties (tiling, overviews, DEFLATE compression, etc.)

**So for your MapLibre + COG protocol idea you can treat every Copernicus GLO-30 tile on that AWS bucket as a proper COG.**

## Licensing and Advertisement Usage

### ✅ What the License Allows

- The dataset is available on a **free-basis for the general public** under the licence
- The licence grants rights of use including reproduction, distribution and communication to the public
- The licence says "use free of charge"

### ⚠️ What You Must Watch Out For

1. **You must cite the source correctly** when distributing or communicating the data or its derivatives. Example:
   > "© DLR e.V. 2010-2014 and © Airbus Defence and Space GmbH 2014-2018 provided under COPERNICUS by the European Union and ESA; all rights reserved."

2. **You must ensure you do not imply endorsement** by the data provider or the European Space Agency / European Commission

3. The licence states the data is provided "as-is" and the provider bears no liability for your use

4. While the licence grants distribution/communication rights, you might need to check if there are **any commercial restrictions** for your specific usage

### 🔍 Specifically for Advertisement Usage

**Since you're planning to run a web map that uses the DEM and show ads:**

- From what I see, the licence **doesn't explicitly prohibit commercial use** such as ads, provided you comply with the obligations (crediting, non-endorsement, etc)
- However because the wording "free basis for the general public" and some access conditions (registration, etc) appear, it would be prudent to **review the full licence document** (for version you use) or reach out to the data provider for explicit confirmation
- If you modify/derive from the DEM (e.g., generate hillshades, process elevation to profiles), you must apply the proper notice for adaptations

## Summary

1. **Conversion:** Use GDAL (`gdal_translate -of COG`) or Python (`rasterio.shutil.copy` with `driver="COG"`)

2. **Display:** Use MapLibre GL JS with `@geomatico/maplibre-cog-protocol` to display COGs directly from AWS

3. **Data Source:** Use public AWS bucket `copernicus-dem-30m` - data is already in COG format and free to access

4. **Cost:** Zero cost for reading directly from AWS public bucket in browser

5. **Next.js Integration:** Use client components with dynamic imports to avoid SSR issues

6. **Licensing:** Free to use, but must cite source and comply with Copernicus license terms

## References

- [OpenLayers COG Example](https://openlayers.org/en/latest/examples/cog.html)
- [MapLibre COG Protocol GitHub](https://github.com/geomatico/maplibre-cog-protocol)
- [Copernicus DEM on AWS](https://registry.opendata.aws/copernicus-dem/)
- [AWS S3 Bucket](https://copernicus-dem-30m.s3.amazonaws.com/)
- [OpenTopography Copernicus DEM](https://portal.opentopography.org/datasetMetadata?otCollectionID=OT.032021.4326.1)

