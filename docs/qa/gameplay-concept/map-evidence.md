# Kelana Ria player basemap and tokens

The map comparisons extend the [gameplay prototype](README.md) for [#223](https://github.com/alvintriseptia/kelana-ria/issues/223) and [#232](https://github.com/alvintriseptia/kelana-ria/issues/232). Claim and Seek each use the pastel MapLibre style in the lobby preview and during play. The map retains the upstream geometry and the current rules for check-in, position sharing, and clues.

## Style and tokens

- [Player style v1](../../../apps/web/src/player-map-style.ts) applies known Geoapify `osm-bright` layer IDs at initial load. It preserves source layers, tile addresses, glyphs, sprites, filters and line widths. Geoapify documents the layer IDs for the November 2026 `osm-bright` style. Unmatched layers retain their source styling. The player theme emphasizes water, parks, roads, paths and transit and delays the two least prominent POI layers until close zoom. [Geoapify layer reference](https://www.geoapify.com/seasonal-map-styles/) · [MapLibre Style Spec](https://maplibre.org/maplibre-style-spec/)
- The live style and assets use the same-origin proxy. The visible credits link to Geoapify, OpenMapTiles and OpenStreetMap and retain the Transjakarta GTFS and MapLibre notices. Geoapify lists 3,000 shared daily credits on Free and 0.25 credits per tile request. The Free plan allows commercial production within its quota, rate, feature, and attribution limits. [Pricing](https://www.geoapify.com/pricing/) · [Tiles and attribution](https://www.geoapify.com/map-tiles/) · [Terms](https://www.geoapify.com/terms-and-conditions/)
- The [original Kelana Ria token artwork](../../../apps/web/src/assets/map-tokens/) depicts a generic landmark, museum or monument, park, station, start, player and visible rival. Claim uses the existing authored category or a matching public snapshot POI at the same coordinates. Unknown or other categories get the generic token. Seek stations use the station illustration. Rival coordinates come from the game's authorized room view.
- Team color and symbols identify ownership. A dashed border and a diamond mark a vulnerable claim, and a square frame and badge mark a lock. A small shield marks active protection. A dashed outline identifies an eligible target, and a solid outline identifies selection. Dimmed tokens keep their names and discoverability. The marker label and the landmark or station list preserve the action and state in text.
- Buttons use a 44 px footprint. At zoom below 14 and when buttons overlap, the illustrated face becomes smaller. In overlapping tap areas, the nearest marker center owns the tap. If centers coincide, keyboard focus and the full list keep all choices reachable. Positions, button focus, and the MapLibre canvas survive ordinary room updates.
- The offline map uses the same tokens and pastel palette, with schematic point connections and an explicit **Peta skematis luring** label. The app's existing list remains available when the map cannot load.

## MapLibre comparisons

- [Jakarta Claim at 390 × 844 and 320 × 640](evidence/claim-map.webp)
- [Bandung Seek at 390 × 844 and 320 × 640](evidence/seek-map.webp)
- [Both games using the offline-vector map at 320 × 640](evidence/offline-map.webp)
- [Seek station list after an interrupted style request](evidence/map-list-fallback.webp)

Each comparison pairs the fixture's `osm-bright`-style paint with the Kelana Ria transform on the same MapLibre camera, vector tile source, and game state. The roads, parks, and buildings come from OpenStreetMap. The selected walking segment illustrates how a route reads on the map. The Claim territory, player positions, and Seek deduction are simulated. The small geographic extracts end at the fixture boundaries.

The data fixtures were retrieved on November 28, 2026. Jakarta uses the OpenStreetMap map API bounding box `106.794,-6.245,106.802,-6.237`. Bandung uses an Overpass extract in the bounding box `-6.925,107.596,-6.910,107.612`, with the Overpass base timestamp `2026-07-15T15:22:01Z`. The fixtures select public road, park, waterway, and larger building geometry and round coordinates to six decimals. The extracts retain OSM way IDs and are available under ODbL 1.0. [OpenStreetMap copyright](https://www.openstreetmap.org/copyright) · [Jakarta source bounds](https://www.openstreetmap.org/export#map=16/-6.241/106.798) · [Bandung source bounds](https://www.openstreetmap.org/export#map=15/-6.918/107.605)

## Reproduce the evidence

```sh
npm ci
npm run build
npx --no-install playwright install --with-deps --no-shell chromium
node apps/web/qa/player-map.mjs
npm run qa:rulebook-claim --workspace @kelana-ria/web
npm run qa:rulebook-seek --workspace @kelana-ria/web
npm run qa --workspace @kelana-ria/web
python3 factory/agent.py verify --profile factory
```

The comparison checks the style spec, proxy and visible attribution, keyboard selection, overlapping station taps, stable canvas, and unchanged tile counts and bytes. It writes raw frames and a measurement report to `apps/web/qa-results/player-map/`. The Claim and Seek game suites exercise the player routes and test location, navigation, and list recovery.

## Measured results

Node 24.22.1 and Chromium 159.0.8154.6 with SwiftShader. Each pair uses a fresh context at device scale 1, reduced motion, and the same local tile server. Load and frame values are one sample per frame on a desktop host. The heap figures are Chromium page estimates that exclude GPU memory. Timing varies with browser and host load.

| Comparison | Tile requests per style | Tile response bytes per style | Ready time before → after | Pan frame gap p95 before → after | JS heap before → after |
| --- | ---: | ---: | ---: | ---: | ---: |
| Claim 390 × 844, zoom 15 | 4 | 18,630 | 817 → 502 ms | 33 → 33 ms | 8.3 → 9.3 MiB |
| Claim 320 × 640, zoom 13.6 | 1 | 14,232 | 326 → 297 ms | 17 → 17 ms | 8.6 → 7.7 MiB |
| Seek 390 × 844, zoom 15 | 2 | 14,945 | 331 → 315 ms | 50 → 50 ms | 9.4 → 10.0 MiB |
| Seek 320 × 640, zoom 13.6 | 2 | 19,273 | 330 → 303 ms | 17 → 17 ms | 8.7 → 9.1 MiB |

The fixture style transfers were identical per pair at 977 B for Claim and 906 B for Seek. The two offline frames fetched zero tiles. The proxy recorded 18 requests at an estimated 4.5 credits for this local rehearsal.

Compared with `8647979`, the lazy map JavaScript grew by 1,593 B gzip and the map CSS grew by 1,245 B gzip, including all seven inlined SVGs. The original SVG source totals 2,331 B and adds zero HTTP requests. The worker bytes are identical. The catalog cold-load median was 45,155 B of transferred JavaScript against its 100 KiB budget.

Live verification still needs the project's server-side `GEOAPIFY_API_KEY`. The public provider endpoint returned HTTP 401 without it. The comparisons use local OSM tiles and the production proxy's URL rewriting. Live provider glyphs, sprites, quota consumption and phone performance remain unmeasured. [Integration evidence](../live-integration-evidence.md)
