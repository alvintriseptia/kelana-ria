import { createHash } from "node:crypto";
import type {
  GeoCoordinate, StudioPoiCandidate, StudioPoiCategory, StudioPoiCurateRequest, StudioPoiCurateResponse,
} from "@kelana-ria/contracts";
import { haversineMeters, isValidCoordinate, pointInPolygon, pointOnSegment } from "./seek-engine/rulebook-validator.js";

type TagRule = readonly [key: string, ...values: string[]];
const categories = {
  taman: [["leisure", "park", "garden"]],
  monumen: [["historic", "monument", "memorial", "heritage"], ["tourism", "artwork", "viewpoint"]],
  museum: [["tourism", "museum", "gallery"]],
  pasar: [["amenity", "marketplace"]],
  ruang_publik: [["place", "square"], ["amenity", "community_centre", "public_building"], ["building", "public"]],
  ibadah: [["amenity", "place_of_worship"]],
  perpustakaan: [["amenity", "library"]],
  kuliner_ikon: [["amenity", "food_court", "restaurant", "cafe"]],
} as const satisfies Record<StudioPoiCategory, readonly TagRule[]>;

const categoryNames = Object.keys(categories) as StudioPoiCategory[];
const ttl = 10 * 60_000;
const windowMs = 60_000;
const cacheLimit = 64;
const elementLimit = 320;
const maxAreaKm2 = 250;

export type OsmPoiCuratorOptions = {
  overpassApiUrl?: string;
  mode?: "live" | "fixture";
  fetchImpl?: typeof fetch;
  now?: () => number;
};

type NormalizedRequest = StudioPoiCurateRequest & { categories: StudioPoiCategory[]; limit: number };
type SourcePoint = Omit<StudioPoiCandidate, "source" | "fieldVerified" | "alreadyInDraft" | "distanceFromStartMeters" | "suggestedZoneId">;
type CurateResult =
  | { ok: true; data: StudioPoiCurateResponse }
  | { ok: false; status: 400; error: "invalid-request" | "poi-area-too-large" }
  | { ok: false; status: 429; error: "rate-limited"; retryAfter: number };

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function samePoint(a: GeoCoordinate, b: GeoCoordinate): boolean {
  return a.latitude === b.latitude && a.longitude === b.longitude;
}

function cross(a: GeoCoordinate, b: GeoCoordinate, p: GeoCoordinate): number {
  return (b.longitude - a.longitude) * (p.latitude - a.latitude) -
    (b.latitude - a.latitude) * (p.longitude - a.longitude);
}

function segmentsIntersect(a: GeoCoordinate, b: GeoCoordinate, c: GeoCoordinate, d: GeoCoordinate): boolean {
  if (Math.max(a.longitude, b.longitude) < Math.min(c.longitude, d.longitude) ||
      Math.max(c.longitude, d.longitude) < Math.min(a.longitude, b.longitude) ||
      Math.max(a.latitude, b.latitude) < Math.min(c.latitude, d.latitude) ||
      Math.max(c.latitude, d.latitude) < Math.min(a.latitude, b.latitude)) return false;
  return cross(a, b, c) * cross(a, b, d) <= 0 && cross(c, d, a) * cross(c, d, b) <= 0;
}

function strictlyInside(point: GeoCoordinate, polygon: GeoCoordinate[]): boolean {
  if (!pointInPolygon(point, polygon)) return false;
  return !polygon.some((a, i) => {
    const b = polygon[(i + 1) % polygon.length];
    return pointOnSegment(point, a, b);
  });
}

function isSimple(points: GeoCoordinate[]): boolean {
  return points.every((point, i) => {
    const end = points[(i + 1) % points.length];
    if (samePoint(point, end)) return false;
    return points.every((other, j) =>
      j <= i + 1 || (i === 0 && j === points.length - 1) ||
      !segmentsIntersect(point, end, other, points[(j + 1) % points.length]));
  });
}

function bounds(points: GeoCoordinate[]) {
  return {
    south: Math.min(...points.map(p => p.latitude)),
    north: Math.max(...points.map(p => p.latitude)),
    west: Math.min(...points.map(p => p.longitude)),
    east: Math.max(...points.map(p => p.longitude)),
  };
}

function areaKm2(points: GeoCoordinate[]): number {
  const radians = Math.PI / 180;
  const origin = points[0];
  let sum = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    sum += (b.longitude - a.longitude) * radians *
      (Math.sin(a.latitude * radians) + Math.sin(b.latitude * radians) - 2 * Math.sin(origin.latitude * radians));
  }
  return Math.abs(sum) * 6371 ** 2 / 2;
}

function parseRequest(raw: unknown): { request: NormalizedRequest } | { error: "invalid-request" | "poi-area-too-large" } {
  if (!isRecord(raw) || !Array.isArray(raw.boundaryPolygon) || raw.boundaryPolygon.length < 3 ||
      raw.boundaryPolygon.length > 50 || !raw.boundaryPolygon.every(isValidCoordinate)) return { error: "invalid-request" };

  const boundaryPolygon = (raw.boundaryPolygon as GeoCoordinate[]).map(({ latitude, longitude }) => ({ latitude, longitude }));
  if (samePoint(boundaryPolygon[0], boundaryPolygon[boundaryPolygon.length - 1])) boundaryPolygon.pop();
  if (boundaryPolygon.length < 3 || !isSimple(boundaryPolygon)) return { error: "invalid-request" };
  const area = areaKm2(boundaryPolygon);
  if (area <= 0) return { error: "invalid-request" };
  if (area > maxAreaKm2) return { error: "poi-area-too-large" };

  const { limit = 24, startPoint, existingPoints, zones } = raw;
  if (typeof limit !== "number" || !Number.isInteger(limit) || limit < 1 || limit > 40 ||
      (startPoint !== undefined && !isValidCoordinate(startPoint)) ||
      (existingPoints !== undefined && (!Array.isArray(existingPoints) || existingPoints.length > 500 || !existingPoints.every(isValidCoordinate))) ||
      (zones !== undefined && (!Array.isArray(zones) || zones.length > 50 || !zones.every(zone =>
        isRecord(zone) && typeof zone.id === "string" && zone.id.length > 0 && zone.id.length <= 100 &&
        (zone.centroid === undefined || isValidCoordinate(zone.centroid)) &&
        (zone.landmarks === undefined || (Array.isArray(zone.landmarks) && zone.landmarks.length <= 500 && zone.landmarks.every(isValidCoordinate))))))) {
    return { error: "invalid-request" };
  }
  const requested = raw.categories === undefined ? categoryNames : raw.categories;
  if (!Array.isArray(requested) || !requested.length || requested.length > categoryNames.length ||
      !requested.every(category => typeof category === "string" && Object.hasOwn(categories, category))) {
    return { error: "invalid-request" };
  }
  return {
    request: {
      boundaryPolygon, limit, startPoint, existingPoints,
      zones: zones as StudioPoiCurateRequest["zones"],
      categories: [...new Set(requested as StudioPoiCategory[])].sort(),
    },
  };
}

function buildQuery(request: NormalizedRequest): string {
  // Only the drawn polygon is sent. Optional position and draft metadata stay local.
  const polygon = request.boundaryPolygon.map(p => `${p.latitude.toFixed(6)} ${p.longitude.toFixed(6)}`).join(" ");
  const filters = '["name"]["access"!~"^(private|no|customers|residents|members|permit)$"]["military"!~"."]["landuse"!="military"]["building"!="residential"]';
  const clauses = request.categories.flatMap(category => categories[category].map(([key, ...values]) =>
    `nwr["${key}"~"^(${values.join("|")})$"]${filters}(poly:"${polygon}");`));
  return `[out:json][timeout:8];(${clauses.join("")});out center ${elementLimit};`;
}

function cleanText(value: unknown, limit = 100): string | undefined {
  if (typeof value !== "string") return undefined;
  return value.replace(/[\u0000-\u001F\u007F<>]/g, " ").replace(/\s+/g, " ").trim().slice(0, limit) || undefined;
}

function normalizeElement(raw: unknown, requested: StudioPoiCategory[]): SourcePoint | undefined {
  if (!isRecord(raw) || (raw.type !== "node" && raw.type !== "way" && raw.type !== "relation") ||
      typeof raw.id !== "number" || !Number.isSafeInteger(raw.id) || raw.id <= 0 || !isRecord(raw.tags)) return;
  const tags = raw.tags;
  if (["private", "no", "customers", "residents", "members", "permit", "official"].includes(cleanText(tags.access)?.toLowerCase() ?? "") ||
      tags.military !== undefined || tags.landuse === "military" || tags.building === "residential" ||
      tags.disused === "yes" || tags.abandoned === "yes") return;

  const coordinates = raw.type === "node" ? raw : isRecord(raw.center) ? raw.center : undefined;
  const point = { latitude: coordinates?.lat, longitude: coordinates?.lon };
  if (!isValidCoordinate(point)) return;
  const name = cleanText(tags.name);
  const category = requested.find(key => categories[key].some(([tag, ...values]: TagRule) =>
    typeof tags[tag] === "string" && values.includes(tags[tag])));
  if (!name || !category) return;

  const safeTags: Record<string, string> = {};
  for (const key of ["leisure", "historic", "tourism", "amenity", "place", "building", "opening_hours", "wheelchair", "access", "fee"]) {
    const value = cleanText(tags[key], 160);
    if (value) safeTags[key] = value;
  }
  return {
    ...point, osmId: `${raw.type}/${raw.id}`, name, category, tags: safeTags,
    ...(safeTags.opening_hours ? { openingHours: safeTags.opening_hours } : {}),
    ...(safeTags.wheelchair ? { wheelchair: safeTags.wheelchair } : {}),
    ...(safeTags.access === "yes" || safeTags.access === "public" || safeTags.access === "permissive"
      ? { publicAccessHint: safeTags.access } : {}),
  };
}

const fixtureNames: Record<StudioPoiCategory, string> = {
  taman: "Taman", monumen: "Monumen", museum: "Museum", pasar: "Pasar",
  ruang_publik: "Ruang publik", ibadah: "Tempat ibadah", perpustakaan: "Perpustakaan", kuliner_ikon: "Kedai",
};

function fixturePoints(request: NormalizedRequest): SourcePoint[] {
  const { south, north, west, east } = bounds(request.boundaryPolygon);
  const points: SourcePoint[] = [];
  const polygonId = createHash("sha256").update(JSON.stringify(request.boundaryPolygon)).digest("hex").slice(0, 12);
  for (let y = 1; y < 10 && points.length < request.limit; y++) {
    for (let x = 1; x < 10 && points.length < request.limit; x++) {
      const point = { latitude: south + (north - south) * y / 10, longitude: west + (east - west) * x / 10 };
      if (!strictlyInside(point, request.boundaryPolygon) || points.some(other => haversineMeters(other, point) < 45)) continue;
      const category = request.categories[points.length % request.categories.length];
      points.push({
        ...point, osmId: `fixture/${polygonId}/${x}-${y}`,
        name: `${fixtureNames[category]} contoh ${points.length + 1}`, category, tags: {},
      });
    }
  }
  return points;
}

function nearestZone(point: GeoCoordinate, zones: NormalizedRequest["zones"]): string | undefined {
  let nearest: { id: string; distance: number } | undefined;
  for (const zone of zones ?? []) {
    const locations = zone.centroid ? [zone.centroid] : zone.landmarks ?? [];
    for (const location of locations) {
      const distance = haversineMeters(point, location);
      if (!nearest || distance < nearest.distance) nearest = { id: zone.id, distance };
    }
  }
  return nearest?.id;
}

function projectCandidates(points: SourcePoint[], request: NormalizedRequest): StudioPoiCandidate[] {
  const candidates: StudioPoiCandidate[] = [];
  const ids = new Set<string>();
  for (const point of points) {
    if (!strictlyInside(point, request.boundaryPolygon) || ids.has(point.osmId) || candidates.some(other => haversineMeters(point, other) < 45)) continue;
    ids.add(point.osmId);
    const suggestedZoneId = nearestZone(point, request.zones);
    candidates.push({
      ...point, source: "osm-curated", fieldVerified: false,
      alreadyInDraft: (request.existingPoints ?? []).some(existing => haversineMeters(point, existing) <= 50),
      ...(request.startPoint ? { distanceFromStartMeters: Math.round(haversineMeters(request.startPoint, point)) } : {}),
      ...(suggestedZoneId ? { suggestedZoneId } : {}),
    });
    if (candidates.length === request.limit) break;
  }
  return candidates;
}

export function createOsmPoiCurator(options: OsmPoiCuratorOptions = {}) {
  const now = options.now ?? Date.now;
  const fetchImpl = options.fetchImpl ?? fetch;
  const url = options.overpassApiUrl?.trim() || "https://overpass-api.de/api/interpreter";
  const windows = new Map<string, { until: number; count: number }>();
  const cache = new Map<string, { expiresAt: number; retrievedAt: string; points: SourcePoint[] }>();

  async function curate(creator: string, raw: unknown): Promise<CurateResult> {
    const timestamp = now();
    for (const [key, window] of windows) if (window.until <= timestamp) windows.delete(key);
    const window = windows.get(creator) ?? { until: timestamp + windowMs, count: 0 };
    if (window.count >= 10 || (!windows.has(creator) && windows.size >= 2048)) {
      return { ok: false, status: 429, error: "rate-limited", retryAfter: Math.ceil((window.until - timestamp) / 1000) };
    }
    window.count++;
    windows.set(creator, window);
    const parsed = parseRequest(raw);
    if ("error" in parsed) return { ok: false, status: 400, error: parsed.error };
    const request = parsed.request;
    const retrievedAt = new Date(timestamp).toISOString();

    function reply(points: SourcePoint[], mode: StudioPoiCurateResponse["mode"], date: string, fallbackReason?: StudioPoiCurateResponse["fallbackReason"]): CurateResult {
      return { ok: true, data: {
        mode, ...(fallbackReason ? { fallbackReason } : {}),
        attribution: { source: "OpenStreetMap Overpass API", license: "ODbL 1.0", retrievedAt: date, notice: "© OpenStreetMap contributors (ODbL)" },
        candidates: projectCandidates(points, request),
      } };
    }

    if (options.mode === "fixture") return reply(fixturePoints(request), "recorded-rehearsal", retrievedAt, "fixture-mode");
    const bbox = Object.values(bounds(request.boundaryPolygon)).map(value => value.toFixed(3));
    // Include the shape so different polygons with the same bbox cannot share incomplete results.
    const quantizedShape = request.boundaryPolygon.map(p => [p.latitude.toFixed(6), p.longitude.toFixed(6)]);
    const key = JSON.stringify([bbox, request.categories, quantizedShape]);
    const cached = cache.get(key);
    if (cached && cached.expiresAt > timestamp) return reply(cached.points, "live", cached.retrievedAt);

    try {
      const response = await fetchImpl(url, {
        method: "POST",
        body: new URLSearchParams({ data: buildQuery(request) }),
        signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok) throw new Error("Overpass request failed");
      const data: unknown = await response.json();
      if (!isRecord(data) || !Array.isArray(data.elements) || data.remark) throw new Error("Incomplete Overpass response");
      const points = data.elements.slice(0, elementLimit).flatMap(element => {
        const point = normalizeElement(element, request.categories);
        return point ? [point] : [];
      });
      cache.delete(key);
      cache.set(key, { points, retrievedAt, expiresAt: timestamp + ttl });
      if (cache.size > cacheLimit) cache.delete(cache.keys().next().value!);
      return reply(points, "live", retrievedAt);
    } catch {
      return reply(fixturePoints(request), "local-fallback", retrievedAt, "overpass-unavailable");
    }
  }

  return { curate };
}
