import type { LayerSpecification, StyleSpecification } from "maplibre-gl";

export const playerMapPalette = {
  land: "#f2ebd9",
  urban: "#eee5d0",
  blocks: "#e9dfc8",
  building: "#ddd5bf",
  buildingEdge: "#c8bea5",
  park: "#a8c89a",
  woodland: "#9bb78e",
  water: "#95c8d5",
  street: "#fffdf5",
  primaryStreet: "#fff1cd",
  streetEdge: "#c7b690",
  path: "#987a56",
  rail: "#718f85",
  ink: "#28493d",
  mutedInk: "#4c6054",
  schematic: "#7c9989",
};

// Match the published osm-bright layer IDs and preserve other layers as supplied.
function pastelLayer(layer: LayerSpecification): LayerSpecification {
  const id = layer.id;
  const colors = playerMapPalette;
  if (layer.type === "background" && id === "background") {
    return { ...layer, paint: { ...layer.paint, "background-color": colors.land } };
  }
  if (layer.type === "fill") {
    let color;
    if (id === "water" || id === "water-offset") color = colors.water;
    if (id === "landcover-grass" || id === "landcover-grass-park") color = colors.park;
    if (id === "landcover-wood") color = colors.woodland;
    if (id === "landuse-residential") color = colors.urban;
    if (/^landuse-(commercial|industrial|school|hospital|railway|cemetery)$/.test(id)) color = colors.blocks;
    if (id === "highway-area") color = colors.street;
    if (id === "building" || id === "building-top") {
      return { ...layer, paint: { ...layer.paint, "fill-color": colors.building, "fill-outline-color": colors.buildingEdge } };
    }
    // The "park" layer also includes protected districts. Keep their original category and mute the fill.
    if (id === "park") return { ...layer, paint: { ...layer.paint, "fill-opacity": 0.12 } };
    if (color) return { ...layer, paint: { ...layer.paint, "fill-color": color } };
  }
  if (layer.type === "line") {
    const road = /^(?:(?:bridge|tunnel)-|highway-)/.test(id);
    let color;
    if (id.startsWith("waterway")) color = colors.water;
    if (road && /(?:^|-)railway(?:-|$)/.test(id) || id.startsWith("railway")) color = colors.rail;
    else if (road && id.endsWith("-casing")) color = colors.streetEdge;
    else if (road && /-(?:path|steps)$/.test(id)) color = colors.path;
    else if (road && /(?:^|-)(?:primary|trunk|motorway)(?:-|$)/.test(id)) color = colors.primaryStreet;
    else if (road) color = colors.street;
    if (color) return { ...layer, paint: { ...layer.paint, "line-color": color } };
  }
  if (layer.type === "symbol" && /^(?:place-|highway-name-|waterway-name$|water-name-|poi-)/.test(id)) {
    const minorPoi = /^poi-level-[23]$/.test(id);
    return {
      ...layer,
      ...(minorPoi && { minzoom: Math.min(layer.maxzoom ?? 24, Math.max(layer.minzoom ?? 0, 16)) }),
      paint: {
        ...layer.paint,
        "text-color": id.startsWith("poi-") && id !== "poi-railway" ? colors.mutedInk : colors.ink,
        "text-halo-color": colors.street,
      },
    };
  }
  return layer;
}

/** Kelana Ria player basemap v1. Sources, tile URLs and navigation geometry stay upstream. */
export function playerMapStyle(style: StyleSpecification): StyleSpecification {
  return {
    ...style,
    metadata: {
      ...(style.metadata && typeof style.metadata === "object" ? style.metadata : {}),
      "kelana:player-basemap": "pastel-v1",
    },
    layers: style.layers.map(pastelLayer),
  };
}
