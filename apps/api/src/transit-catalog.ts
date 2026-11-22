import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { haversineMeters } from "./seek-engine/rulebook-validator.js";

export type TransitMode = "mrt" | "lrt" | "krl" | "transjakarta";

export const TRANSIT_MODES: readonly TransitMode[] = ["mrt", "lrt", "krl", "transjakarta"];

export type JakartaTransitStation = {
  id: string;
  name: string;
  lat: number;
  lng: number;
  mode: TransitMode;
  corridor: string;
};

export type JakartaTransitCatalog = {
  version: string;
  generatedAt: string;
  attribution: string;
  sources: string[];
  stations: JakartaTransitStation[];
};

export type OverpassElement = {
  type?: string;
  id?: number | string;
  lat?: number;
  lon?: number;
  center?: { lat?: number; lon?: number };
  tags?: Record<string, string | undefined>;
};

export const JAKARTA_BOUNDS = {
  minLat: -6.45,
  maxLat: -6.05,
  minLng: 106.65,
  maxLng: 107.05,
} as const;

export const DEFAULT_TRANSIT_ATTRIBUTION =
  "© OpenStreetMap contributors (ODbL) · Data Halte Transjakarta";

const defaultCatalogPath = fileURLToPath(new URL("../data/jakarta-transit.json", import.meta.url));
let cachedCatalog: JakartaTransitCatalog | null = null;

export function isValidJakartaCoord(lat: number, lng: number): boolean {
  return (
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    lat >= JAKARTA_BOUNDS.minLat &&
    lat <= JAKARTA_BOUNDS.maxLat &&
    lng >= JAKARTA_BOUNDS.minLng &&
    lng <= JAKARTA_BOUNDS.maxLng
  );
}

export function classifyOverpassElement(tags?: Record<string, string | undefined>): TransitMode | null {
  if (!tags) return null;
  const hay = [
    tags.name,
    tags.operator,
    tags.network,
    tags.brand,
    tags.line,
    tags.route_ref,
    tags.description,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  if (tags.station === "subway" || tags.subway === "yes" || /\bmrt\b/.test(hay)) {
    return "mrt";
  }
  if (tags.station === "light_rail" || tags.light_rail === "yes" || /\blrt\b/.test(hay)) {
    return "lrt";
  }
  if (
    tags.highway === "bus_stop" ||
    tags.amenity === "bus_station" ||
    tags.public_transport === "platform" ||
    tags.bus === "yes"
  ) {
    if (
      hay.includes("transjakarta") ||
      hay.includes("brt") ||
      hay.includes("koridor") ||
      hay.includes("halte")
    ) {
      return "transjakarta";
    }
  }
  if (
    tags.railway === "station" ||
    tags.railway === "halt" ||
    tags.public_transport === "station"
  ) {
    if (
      hay.includes("krl") ||
      hay.includes("commuter") ||
      hay.includes("kai") ||
      hay.includes("kereta") ||
      tags.railway === "station"
    ) {
      return "krl";
    }
  }
  return null;
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

export function dedupeTransitStations(
  stations: JakartaTransitStation[],
  thresholdMeters = 60,
): JakartaTransitStation[] {
  const kept: JakartaTransitStation[] = [];
  const seenIds = new Set<string>();

  for (const candidate of stations) {
    const duplicate = kept.some(
      (existing) =>
        existing.mode === candidate.mode &&
        haversineMeters(
          { latitude: existing.lat, longitude: existing.lng },
          { latitude: candidate.lat, longitude: candidate.lng },
        ) < thresholdMeters,
    );
    if (duplicate) continue;

    let finalId = candidate.id;
    let suffix = 2;
    while (seenIds.has(finalId)) {
      finalId = `${candidate.id}-${suffix++}`;
    }
    seenIds.add(finalId);
    kept.push({ ...candidate, id: finalId });
  }
  return kept;
}

export function normalizeOverpassTransitPayload(
  payload: { elements?: OverpassElement[] },
  generatedAt = new Date().toISOString(),
): JakartaTransitCatalog {
  const raw: JakartaTransitStation[] = [];
  for (const el of payload.elements ?? []) {
    const lat = typeof el.lat === "number" ? el.lat : el.center?.lat;
    const lng = typeof el.lon === "number" ? el.lon : el.center?.lon;
    const name = el.tags?.name?.trim();
    const mode = classifyOverpassElement(el.tags);
    if (!name || typeof lat !== "number" || typeof lng !== "number" || !mode) continue;
    if (!isValidJakartaCoord(lat, lng)) continue;

    const cleanSlug = slugify(name) || String(el.id ?? raw.length + 1);
    const defaultCorridor: Record<TransitMode, string> = {
      mrt: "MRT Jakarta",
      lrt: "LRT Jabodebek / Jakarta",
      krl: "KRL Commuter Line",
      transjakarta: "Transjakarta BRT",
    };
    const corridor =
      el.tags?.route_ref?.trim() ||
      el.tags?.line?.trim() ||
      el.tags?.network?.trim() ||
      defaultCorridor[mode];

    raw.push({
      id: `${mode}-${cleanSlug}`,
      name,
      lat: Number(lat.toFixed(5)),
      lng: Number(lng.toFixed(5)),
      mode,
      corridor,
    });
  }

  raw.sort((a, b) => a.mode.localeCompare(b.mode) || a.name.localeCompare(b.name));
  const stations = dedupeTransitStations(raw, 60);

  return {
    version: "1.0.0",
    generatedAt,
    attribution: DEFAULT_TRANSIT_ATTRIBUTION,
    sources: [
      "OpenStreetMap Overpass API (highway/railway/public_transport)",
      "Transjakarta BRT Corridor Reference",
    ],
    stations,
  };
}

export function loadJakartaTransitCatalog(filePath = defaultCatalogPath): JakartaTransitCatalog {
  if (filePath === defaultCatalogPath && cachedCatalog) return cachedCatalog;
  const parsed = JSON.parse(readFileSync(filePath, "utf8")) as JakartaTransitCatalog;
  if (filePath === defaultCatalogPath) cachedCatalog = parsed;
  return parsed;
}

export function filterTransitCatalog(
  catalog: JakartaTransitCatalog,
  options?: {
    modes?: TransitMode[];
    bbox?: [number, number, number, number];
  },
): JakartaTransitCatalog {
  const modeSet = options?.modes?.length ? new Set(options.modes) : null;
  const bbox = options?.bbox;
  const stations = catalog.stations.filter((st) => {
    if (modeSet && !modeSet.has(st.mode)) return false;
    if (bbox) {
      const [minLng, minLat, maxLng, maxLat] = bbox;
      if (st.lng < minLng || st.lng > maxLng || st.lat < minLat || st.lat > maxLat) return false;
    }
    return true;
  });
  return { ...catalog, stations };
}
