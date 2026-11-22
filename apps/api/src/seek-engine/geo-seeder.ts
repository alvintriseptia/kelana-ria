import type {
  GeoAttribution,
  GeoCoordinate,
  GeoPoi,
  GeoSnapshot,
  GeoStartPoint,
  GeoStation,
  TransitMode,
} from "@kelana-ria/contracts";
import { computeGeoSnapshotHash, pointInPolygon } from "./rulebook-validator.js";

export type GeoSeedRequest = {
  id: string;
  boundaryPolygon: GeoCoordinate[];
  startPoint: GeoStartPoint;
  transitModes: TransitMode[];
  poiCategories: string[];
  overrides?: {
    disabledStationIds?: string[];
    extraStations?: GeoStation[];
    stationPatches?: Record<string, Partial<Omit<GeoStation, "id">>>;
    extraPois?: GeoPoi[];
    disabledPoiIds?: string[];
  };
};

export type GeoSeedProvider = {
  sourceName: string;
  license?: string;
  fetchLayers: (request: {
    boundaryPolygon: GeoCoordinate[];
    transitModes: TransitMode[];
    poiCategories: string[];
  }) => Promise<{ stations: GeoStation[]; pois: GeoPoi[]; attribution: GeoAttribution }>;
};

export function createFixtureGeoSeedProvider(baseSnapshot: Omit<GeoSnapshot, "hash">): GeoSeedProvider {
  return {
    sourceName: "Recorded GeoSnapshot Fixture",
    license: "CC BY 4.0",
    async fetchLayers({ boundaryPolygon, poiCategories }) {
      const catSet = new Set(poiCategories);
      const stations = baseSnapshot.stations.filter((s) => pointInPolygon(s, boundaryPolygon));
      const pois = baseSnapshot.pois.filter((p) => catSet.size === 0 || catSet.has(p.category));
      return {
        stations,
        pois,
        attribution: baseSnapshot.attributions[0] ?? {
          source: "Recorded GeoSnapshot Fixture",
          license: "CC BY 4.0",
          retrievedAt: "2026-11-22T00:00:00Z",
          notice: "Recorded local geo layer fixture (no external API keys required).",
        },
      };
    },
  };
}

export async function seedAndFreezeGeoSnapshot(
  request: GeoSeedRequest,
  provider: GeoSeedProvider,
): Promise<GeoSnapshot> {
  const seeded = await provider.fetchLayers({
    boundaryPolygon: request.boundaryPolygon,
    transitModes: request.transitModes,
    poiCategories: request.poiCategories,
  });

  const disabledStations = new Set(request.overrides?.disabledStationIds ?? []);
  const patches = request.overrides?.stationPatches ?? {};
  const mergedStations = new Map<string, GeoStation>();

  for (const station of seeded.stations) {
    if (disabledStations.has(station.id)) continue;
    const patch = patches[station.id];
    mergedStations.set(station.id, patch ? { ...station, ...patch, attributes: { ...station.attributes, ...(patch.attributes ?? {}) } } : { ...station });
  }
  for (const extra of request.overrides?.extraStations ?? []) {
    if (!disabledStations.has(extra.id)) {
      mergedStations.set(extra.id, { ...extra });
    }
  }

  const disabledPois = new Set(request.overrides?.disabledPoiIds ?? []);
  const mergedPois = new Map<string, GeoPoi>();
  for (const poi of seeded.pois) {
    if (!disabledPois.has(poi.id)) mergedPois.set(poi.id, { ...poi });
  }
  for (const extra of request.overrides?.extraPois ?? []) {
    if (!disabledPois.has(extra.id)) mergedPois.set(extra.id, { ...extra });
  }

  const unsigned: Omit<GeoSnapshot, "hash"> = {
    id: request.id,
    boundaryPolygon: request.boundaryPolygon.map((c) => ({ ...c })),
    startPoint: { ...request.startPoint },
    stations: [...mergedStations.values()],
    pois: [...mergedPois.values()],
    attributions: [seeded.attribution],
  };

  return {
    ...unsigned,
    hash: computeGeoSnapshotHash(unsigned),
  };
}
