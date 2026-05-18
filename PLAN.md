# PLAN.md — Formation Outcrop Viewer

## 1. API Verification Results

### Endpoint 1: Name → strat_name_ids

**Confirmed URL:** `GET https://macrostrat.org/api/v2/defs/strat_names?strat_name_like={query}&rank=Fm`

**Deviation from PRD spec:** The PRD specifies `strat_name={query}`. That parameter performs an **exact match on the short name field** (e.g., `strat_name=Morrison` matches; `strat_name=Morrison Formation` with `rank=Fm` returns `data: []`). The correct parameter for free-text user input is `strat_name_like`, which does substring matching. The `rank=Fm` filter works correctly when combined with `strat_name_like`.

**Additional normalization required:** `strat_name_like` matches on `strat_name` (the short name, e.g. "Morrison"), not `strat_name_long`. If the user types "Morrison Formation", the word "Formation" will not match anything. `fetchStratNames` will strip trailing rank words ("Formation", "Member", "Group", "Subgroup", "Fm", "Mbr", "Gp") from the query before sending it to the API.

**CORS:** `access-control-allow-origin: *` confirmed on both endpoints.

**Response envelope:**
```json
{
  "success": {
    "v": 2,
    "license": "CC-BY 4.0",
    "data": [ ... ],
    "refs": { ... }
  }
}
```

**Record fields (confirmed):**

| Field | Example | Used for |
|---|---|---|
| `strat_name_id` | `1351` | Key for polygon fetch; state key |
| `strat_name_long` | `"Morrison Formation"` | Display label |
| `rank` | `"Fm"` | Match panel display |
| `b_age` / `t_age` | `174.7` / `143.1` | Age range in Ma |
| `b_period` / `t_period` | `"Jurassic"` / `"Cretaceous"` | Age range in period names |

**Deviation — lithology hint:** No lithology field exists in the strat_names response. It is only available in the polygon feature properties after Step 2. The match panel will show rank and age range (`b_period`–`t_period`, Ma) in place of a lithology hint. See Open Questions §1.

---

### Endpoint 2: strat_name_id → polygons

**Confirmed URL:** `GET https://macrostrat.org/api/v2/geologic_units/map?strat_name_id={id}&format=geojson`

**Bbox append:** `&bbox=west,south,east,north` — parameter name not live-tested; format assumed from PRD. Will verify during build step 6.

**Response envelope:** `response.success.data` is the GeoJSON FeatureCollection (not the top-level response object itself).

**Geometry type:** `MultiPolygon` (not `Polygon` as the PRD implies by omission).

**Feature properties (confirmed):**

| Field | Example | Used for |
|---|---|---|
| `name` | `"Cedar Mountain Fm and Morrison Fm"` | Popup title |
| `lith` | `"MG sandstone, sandstone, ..."` | Popup lithology |
| `best_int_name` | `"Mesozoic"` | Popup age summary |
| `b_age` / `t_age` | `157.3` / `122.0` | Popup age in Ma |
| `color` | `"#5ABC8C"` | Not used — see §6 |

**Feature count reality check:** Morrison Formation (`strat_name_id=1351`) returns **5,759 features**. The >5000 edge case from the PRD is a normal occurrence for common formations, not a rare failure mode.

---

## 2. File Structure

```
index.html     ~65 lines   HTML shell: map div, search bar, match panel div, CDN script/link tags
app.js        ~290 lines   All application logic (see §4)
style.css      ~75 lines   Layout, match panel, legend overlay, error banner
states.json    ~55 lines   { "NM": { "name": "New Mexico", "bbox": [W, S, E, N] }, ... }
```

**Total: ~485 lines**

---

## 3. State Model

```js
const state = {
  // Replaced on each new search
  searchResults: [
    // { strat_name_id, strat_name_long, rank, b_age, t_age, b_period, t_period }
  ],

  // null = "All states"; set from dropdown selection
  stateFilter: null,           // string | null  e.g. "NM"

  // Loaded once at init from states.json; never mutated after
  stateBboxes: {
    // "NM": { name: "New Mexico", bbox: [-109.05, 31.33, -103.00, 37.00] }
  },

  // Keyed by strat_name_id; survives across searches until user removes a layer
  layers: {
    // 1351: {
    //   label: "Morrison Formation",
    //   color: "#e41a1c",
    //   featureCount: 5759,
    //   leafletLayer: <L.GeoJSON instance>
    // }
  },

  // Indexes into COLOR_PALETTE; incremented each time a new layer is added
  colorIndex: 0
};
```

---

## 4. Function Inventory

All functions live in `app.js`.

| # | Function | Purpose | Inputs | Output |
|---|---|---|---|---|
| 1 | `init()` | Wire DOM events, initialize Leaflet map with OpenTopoMap tiles, call `loadStates` | — | void |
| 2 | `loadStates()` | Fetch states.json, populate state dropdown, store in `state.stateBboxes` | — | Promise\<void\> |
| 3 | `onSearch()` | Search button handler; guards empty input; calls `fetchStratNames`, then `renderMatchPanel` | — | void |
| 4 | `fetchStratNames(query)` | Strip rank words from query, GET `strat_name_like&rank=Fm`; retry without `rank` if empty | `query: string` | Promise\<Array\> |
| 5 | `renderMatchPanel(results)` | Render checkbox list with rank + age range per candidate; show/hide panel; wire "Show on Map" button | `results: Array` | void |
| 6 | `onShowOnMap()` | Collect checked strat_name_ids + labels; call `fetchAndAddLayer` for each | — | void |
| 7 | `fetchAndAddLayer(id, label)` | Build URL via `buildUrl`, fetch GeoJSON, call `addLayer`; calls `showError` if 0 features | `id: number, label: string` | Promise\<void\> |
| 8 | `buildUrl(id)` | Construct polygon fetch URL; append bbox from `state.stateBboxes` if `state.stateFilter` is set | `id: number` | string |
| 9 | `addLayer(id, label, geojson)` | No-op if `id` already in `state.layers`; assign color, add L.GeoJSON with popup binding, update `state.layers`, call `updateLegend` and `fitMap`; warn if featureCount >5000 | `id: number, label: string, geojson: Object` | void |
| 10 | `removeLayer(id)` | Remove Leaflet layer from map, delete `state.layers[id]`, call `updateLegend` | `id: number` | void |
| 11 | `assignColor()` | Return `COLOR_PALETTE[state.colorIndex % 8]`, then increment `state.colorIndex` | — | string |
| 12 | `buildPopupHtml(props)` | Return HTML string: `name`, `best_int_name`, `b_age`–`t_age` Ma, `lith` | `props: Object` | string |
| 13 | `updateLegend()` | Re-render legend control's inner HTML from `state.layers`; each row: color swatch + label + × button wired to `removeLayer` | — | void |
| 14 | `fitMap()` | Call `map.fitBounds` on the union of all active layer bounds; no-op if no layers | — | void |
| 15 | `showError(msg)` | Show error banner with `msg`; auto-dismiss after 4 s | `msg: string` | void |

**Requirement → function mapping:**

| Requirement | Functions |
|---|---|
| 1 — search box | `onSearch`, `fetchStratNames` |
| 2 — state filter | `loadStates`, `buildUrl` |
| 3 — resolve name → ids | `fetchStratNames` |
| 4 — match-selection panel | `renderMatchPanel` |
| 5 — fetch polygons, bbox-filtered | `onShowOnMap`, `fetchAndAddLayer`, `buildUrl` |
| 6 — distinct colors per id | `addLayer`, `assignColor` |
| 7 — popup | `buildPopupHtml` |
| 8 — auto-fit | `fitMap` |
| 9 — legend + remove | `updateLegend`, `removeLayer` |
| 10 — additive layers | `addLayer` (no-op guard on duplicate id) |

---

## 5. UI Layout

```
┌────────────────────────────────────────────────────────────────┐
│ SEARCH BAR  (sticky, sits above map in normal flow)            │
│  [Formation name_______________] [State ▾] [Search]           │
├────────────────────────────────────────────────────────────────┤
│ MATCH PANEL  (normal-flow div, hidden when empty)              │
│  ☐ Morrison Formation    Fm   Jurassic–Cretaceous (174–143 Ma) │
│  ☐ Morrison River Fm     Fm   Cambrian (591–522 Ma)            │
│                                              [Show on Map]     │
├────────────────────────────────────────────────────────────────┤
│                                                                │
│          LEAFLET MAP  (#map, flex-grows to fill viewport)      │
│                                                                │
│                                   ┌───────────────────────┐   │
│                                   │ LEGEND  (bottomright)  │   │
│                                   │ ● Morrison Fm       ×  │   │
│                                   │ ● Chinle Fm         ×  │   │
│                                   └───────────────────────┘   │
└────────────────────────────────────────────────────────────────┘
```

- `body` is a flex column; `#map` fills remaining height after the search bar.
- Match panel is a `<div id="match-panel">` in normal flow between search bar and map, `display:none` when empty.
- Legend is a `L.Control` (`position: 'bottomright'`), inner HTML re-rendered by `updateLegend`.
- Error banner is `position: fixed; top: 0; left: 50%` centered, z-index above map.

---

## 6. Color Assignment Strategy

Each layer gets a color from a fixed 8-color palette (ColorBrewer Set1: `#e41a1c`, `#377eb8`, `#4daf4a`, `#984ea3`, `#ff7f00`, `#a65628`, `#f781bf`, `#999999`), cycling via `state.colorIndex`. The per-feature Macrostrat `color` property is **not used**: it varies within a single layer (one polygon can represent multiple stacked formations) and would make features of the same search appear as different colors, defeating the per-layer distinction.

---

## 7. Edge Case Handling

| Scenario | Behavior |
|---|---|
| Zero name matches | `showError("No formations found for '{query}'")`; match panel stays hidden |
| Match found, zero polygons | `showError("No map data for {label}")`; no layer added |
| >5000 features | Layer added and rendered; `showError("'{label}' returned {n} polygons — map may be slow")` |
| API network failure | `fetch` `.catch` calls `showError("Network error — check connection")` |
| Empty search input | `onSearch` guards `input.value.trim() === ''`; returns immediately |
| Same formation searched twice | `addLayer` checks `id in state.layers`; silently no-ops |

---

## 8. states.json

**Source:** Bounding boxes from Natural Earth 1:10m Admin-1 boundaries (public domain), rounded to 2 decimal places. Sufficient precision for API bbox filtering.

**Shape:**
```json
{
  "AL": { "name": "Alabama",     "bbox": [-88.47, 30.22, -84.89, 35.01] },
  "AK": { "name": "Alaska",      "bbox": [-179.15, 51.21, -129.97, 71.35] },
  "AZ": { "name": "Arizona",     "bbox": [-114.82, 31.33, -109.04, 37.00] },
  "NM": { "name": "New Mexico",  "bbox": [-109.05, 31.33, -103.00, 37.00] },
  "...": "all 50 states"
}
```

Generated by me during build step 1. You do not need to provide it.

---

## 9. Build Order

| Step | Task | Estimate |
|---|---|---|
| 1 | `states.json` — all 50 state bboxes | 20 min |
| 2 | `index.html` — DOM shell, Leaflet CDN links, div structure | 25 min |
| 3 | `style.css` — flex layout, match panel, legend, error banner | 30 min |
| 4 | `app.js`: `init`, `loadStates`, map + OpenTopoMap tile layer | 25 min |
| 5 | `app.js`: `fetchStratNames`, `renderMatchPanel`, `onSearch` | 40 min |
| 6 | `app.js`: `buildUrl`, `fetchAndAddLayer`, `onShowOnMap`; verify bbox param live | 40 min |
| 7 | `app.js`: `addLayer`, `assignColor`, `updateLegend`, `removeLayer` | 40 min |
| 8 | `app.js`: `buildPopupHtml`, `fitMap` | 20 min |
| 9 | `app.js`: `showError`, all edge case guards | 20 min |
| 10 | Smoke test: Morrison Fm + Chinle Fm, NM filter, remove one layer | 30 min |

**Total: ~5.5 hours**

---

## 10. Open Questions

1. **Lithology in match panel:** The `strat_names` endpoint returns no lithology data — it is only available in polygon feature properties after the polygon fetch. Proposed resolution: display `{b_period}–{t_period} ({b_age}–{t_age} Ma)` as the age line and omit lithology from the match panel entirely. Confirm before build.

2. **bbox parameter format:** `&bbox=west,south,east,north` was not live-tested against the polygon endpoint. Will verify in build step 6; if the parameter differs, the fix is isolated to `buildUrl`.
