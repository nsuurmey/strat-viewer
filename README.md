# Formation Outcrop Viewer

A static single-page app for finding where US geologic formations crop out before a field trip. Enter a formation name, pick candidate matches from the Macrostrat database, and display their outcrop polygons on a topographic basemap.

## Usage

1. Type a formation name (e.g. "Morrison Formation") into the search box and press **Search**
2. Check one or more matches from the results panel — each shows rank and age range
3. Click **Show on Map** to load outcrop polygons onto the map
4. Click any polygon for a popup with name, age, and lithology
5. Use the legend (bottom-right) to remove individual layers
6. Subsequent searches add layers rather than replacing them; use the **×** buttons to clear

The state dropdown sends a bounding box with the polygon request but Macrostrat currently returns the full unfiltered dataset regardless — polygons are not clipped to the selected state.

## Stack

- Vanilla JS (ES modules), no build step
- [Leaflet](https://leafletjs.com/) via CDN for the map
- [OpenTopoMap](https://opentopomap.org/) basemap
- [Macrostrat API v2](https://macrostrat.org/api/v2) for formation names and geologic map polygons

## Deployment

Push to `main` and enable GitHub Pages (Settings → Pages → source: `main`, root `/`). No build step required.
