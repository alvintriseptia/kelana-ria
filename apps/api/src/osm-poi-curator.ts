import { createHash } from "node:crypto";
import { setTimeout as wait } from "node:timers/promises";
import type {
  GeoAttribution, GeoCoordinate, StudioPoiCandidate, StudioPoiCategory, StudioPoiCurateRequest, StudioPoiCurateResponse,
  StudioResolvedPinpoint,
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
const defaultOverpassUrl = "https://overpass-api.de/api/interpreter";
const osmAttributionNotice = "© OpenStreetMap contributors (ODbL)";

export type OsmPoiCuratorOptions = {
  overpassApiUrl?: string;
  nominatimApiUrl?: string;
  mode?: "live" | "fixture" | "recorded-rehearsal";
  fetchImpl?: typeof fetch;
  now?: () => number;
  /** Recorded Nominatim search results keyed by the queried place name. */
  recordedResults?: Readonly<Record<string, readonly unknown[]>>;
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

function allowsPublicUse(tags: Record<string, unknown>): boolean {
  return !["private", "no", "customers", "residents", "members", "permit", "official"].includes(cleanText(tags.access)?.toLowerCase() ?? "") &&
    tags.military === undefined && tags.landuse !== "military" && tags.building !== "residential" &&
    tags.disused !== "yes" && tags.abandoned !== "yes";
}

function osmCategory(tags: Record<string, unknown>, requested = categoryNames): StudioPoiCategory | undefined {
  return requested.find(key => categories[key].some(([tag, ...values]: TagRule) =>
    typeof tags[tag] === "string" && values.includes(tags[tag])));
}

function normalizeElement(raw: unknown, requested: StudioPoiCategory[]): SourcePoint | undefined {
  if (!isRecord(raw) || (raw.type !== "node" && raw.type !== "way" && raw.type !== "relation") ||
      typeof raw.id !== "number" || !Number.isSafeInteger(raw.id) || raw.id <= 0 || !isRecord(raw.tags)) return;
  const tags = raw.tags;
  if (!allowsPublicUse(tags)) return;

  const coordinates = raw.type === "node" ? raw : isRecord(raw.center) ? raw.center : undefined;
  const point = { latitude: coordinates?.lat, longitude: coordinates?.lon };
  if (!isValidCoordinate(point)) return;
  const name = cleanText(tags.name);
  const category = osmCategory(tags, requested);
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
  const url = options.overpassApiUrl?.trim() || defaultOverpassUrl;
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
        attribution: { source: "OpenStreetMap Overpass API", license: "ODbL 1.0", retrievedAt: date, notice: osmAttributionNotice },
        candidates: projectCandidates(points, request),
      } };
    }

    if (options.mode === "fixture" || options.mode === "recorded-rehearsal") {
      return reply(fixturePoints(request), "recorded-rehearsal", retrievedAt, "fixture-mode");
    }
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

export type ResolvePlaceNamesFromOsmInput = Pick<StudioPoiCurateRequest,
  "boundaryPolygon" | "startPoint" | "zones" | "existingPoints"> & {
    cityLabel: string;
    places: readonly { clientKey: string; name: string }[];
  };

export type ResolvePlaceNamesFromOsmOptions = OsmPoiCuratorOptions & {
  signal?: AbortSignal;
  timeoutMs?: number;
};

const placeNameLimit = 15;
const placeNameTimeoutMs = 10_000;
const nominatimMatchLimit = 8;
const placeNameUserAgent = "KelanaRia-Studio/1.0 (+https://github.com/alvintriseptia/kelana-ria)";
const placeNameHeaders = { "user-agent": placeNameUserAgent, accept: "application/json" };

type OsmSearchPoint = GeoCoordinate & Pick<StudioResolvedPinpoint, "category" | "accessHint" | "publicHoursHint"> & {
  osmId: string;
  names: string[];
};
type SearchBounds = ReturnType<typeof bounds>;

const placeSearchCaches = new WeakMap<typeof fetch, Map<string, { expiresAt: number; points: OsmSearchPoint[] }>>();
let publicNominatimNextRequest = 0;

function nominatimUrl(options: OsmPoiCuratorOptions): string | undefined {
  return options.nominatimApiUrl?.trim() || process.env.NOMINATIM_API_URL?.trim() || undefined;
}

export function osmPlaceNameAttribution(now = Date.now(), options: OsmPoiCuratorOptions = {}): GeoAttribution {
  const source = options.mode === "fixture" || options.mode === "recorded-rehearsal"
    ? "OpenStreetMap Nominatim (recorded rehearsal)"
    : nominatimUrl(options) ? "OpenStreetMap Nominatim" : "OpenStreetMap Overpass API";
  return { source, license: "ODbL 1.0", retrievedAt: new Date(now).toISOString(), notice: osmAttributionNotice };
}

function placeNameKey(name: string): string {
  return cleanText(name, 160)?.normalize("NFKC").toLowerCase() ?? "";
}

function placeSearchBounds(polygon: GeoCoordinate[]): SearchBounds | undefined {
  if (polygon.length < 3 || polygon.length > 500 || !polygon.every(isValidCoordinate) || areaKm2(polygon) <= 0) return;
  const { south, north, west, east } = bounds(polygon);
  if (north - south > 1 || east - west > 1) return;
  // A five-kilometer margin lets the creator see nearby stops outside the authored polygon.
  const latPadding = 5 / 111;
  const lonPadding = latPadding / Math.max(0.1, Math.cos(Math.max(Math.abs(south), Math.abs(north)) * Math.PI / 180));
  return { south: Math.max(-90, south - latPadding), north: Math.min(90, north + latPadding),
    west: Math.max(-180, west - lonPadding), east: Math.min(180, east + lonPadding) };
}

function osmSearchPoint(type: unknown, id: unknown, coordinates: { lat?: unknown; lon?: unknown },
  labels: Record<string, unknown>, tags: Record<string, unknown>): OsmSearchPoint | undefined {
  if (type !== "node" && type !== "way" && type !== "relation") return;
  if (typeof id !== "number" || !Number.isSafeInteger(id) || id <= 0 || !allowsPublicUse(tags)) return;
  if (["house", "apartments", "detached", "semidetached_house", "terrace", "dormitory"].includes(String(tags.building)) ||
      tags.place === "house" || tags.boundary === "administrative") return;

  const decimal = (value: unknown) => typeof value === "string" && /^-?\d+(?:\.\d+)?$/.test(value) ? Number(value) : value;
  const point = { latitude: decimal(coordinates.lat), longitude: decimal(coordinates.lon) };
  if (!isValidCoordinate(point)) return;
  const names = Object.entries(labels).flatMap(([key, value]) =>
    /^(?:name(?::[a-z-]+)?|official_name|alt_name|short_name)$/i.test(key) && typeof value === "string"
      ? value.split(";").map(placeNameKey).filter(Boolean) : []);
  if (!names.length) return;

  const category = osmCategory(tags);
  const accessHint = cleanText(tags.access)?.toLowerCase();
  const publicHoursHint = cleanText(tags.opening_hours, 160);
  return {
    ...point, osmId: `${type}/${id}`, names,
    ...(category ? { category } : {}),
    ...(accessHint === "yes" || accessHint === "public" || accessHint === "permissive" ? { accessHint } : {}),
    ...(publicHoursHint ? { publicHoursHint } : {}),
  };
}

function normalizeNominatimResults(data: unknown): OsmSearchPoint[] {
  if (!Array.isArray(data) || data.length > nominatimMatchLimit) throw new Error("Invalid Nominatim search response");
  return data.flatMap(raw => {
    if (!isRecord(raw)) return [];
    const country = isRecord(raw.address) ? raw.address.country_code : undefined;
    if (country !== undefined && country !== "id") return [];
    const category = raw.category ?? raw.class;
    const tags = { ...(typeof category === "string" ? { [category]: raw.type } : {}), ...(isRecord(raw.extratags) ? raw.extratags : {}) };
    const names = { name: raw.name, ...(isRecord(raw.namedetails) ? raw.namedetails : {}) };
    const point = osmSearchPoint(raw.osm_type, raw.osm_id, raw, names, tags);
    return point ? [point] : [];
  });
}

function overpassNameQuery(names: string[], { south, west, north, east }: SearchBounds): string {
  const labelPattern = "^(name(:.*)?|official_name|alt_name|short_name)$";
  const nameAlternatives = names.map(name => name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
  const namePattern = `(^|;[[:space:]]*)(${nameAlternatives})([[:space:]]*;|$)`;
  const bbox = [south, west, north, east].map(value => value.toFixed(6)).join(",");
  return `[out:json][timeout:8];area["ISO3166-1"="ID"]["admin_level"="2"]->.indonesia;` +
    `nwr[~${JSON.stringify(labelPattern)}~${JSON.stringify(namePattern)},i](area.indonesia)(${bbox});out center ${elementLimit};`;
}

async function searchOsm(fetchImpl: typeof fetch, fetchUrl: URL | string, signal: AbortSignal, now: () => number,
  overpassQuery?: string): Promise<OsmSearchPoint[]> {
  const key = JSON.stringify([String(fetchUrl), overpassQuery]);
  let cache = placeSearchCaches.get(fetchImpl);
  if (!cache) {
    cache = new Map();
    placeSearchCaches.set(fetchImpl, cache);
  }
  const cached = cache.get(key);
  if (cached && cached.expiresAt > now()) return cached.points;

  if (fetchUrl instanceof URL && fetchUrl.hostname === "nominatim.openstreetmap.org") {
    // The public service permits one request per second across the application.
    const timestamp = Date.now();
    const delay = Math.max(0, publicNominatimNextRequest - timestamp);
    if (delay >= placeNameTimeoutMs) return [];
    publicNominatimNextRequest = timestamp + delay + 1_000;
    if (delay) await wait(delay, undefined, { signal });
  }
  signal.throwIfAborted();
  const response = await fetchImpl(fetchUrl, {
    signal, headers: placeNameHeaders,
    ...(overpassQuery ? { method: "POST", body: new URLSearchParams({ data: overpassQuery }) } : {}),
  });
  if (!response.ok) throw new Error("OSM place search failed");
  const data: unknown = await response.json();
  signal.throwIfAborted();

  let points: OsmSearchPoint[];
  if (overpassQuery) {
    if (!isRecord(data) || !Array.isArray(data.elements) || data.remark || data.elements.length >= elementLimit) {
      throw new Error("Incomplete Overpass place search response");
    }
    points = data.elements.flatMap(raw => {
      if (!isRecord(raw) || !isRecord(raw.tags)) return [];
      const coordinates = raw.type === "node" ? raw : isRecord(raw.center) ? raw.center : {};
      const point = osmSearchPoint(raw.type, raw.id, coordinates, raw.tags, raw.tags);
      return point ? [point] : [];
    });
  } else {
    points = normalizeNominatimResults(data);
  }
  cache.delete(key);
  cache.set(key, { expiresAt: now() + ttl, points });
  if (cache.size > cacheLimit) cache.delete(cache.keys().next().value!);
  return points;
}

function nominatimQuery(base: string, name: string, city: string | undefined, { west, north, east, south }: SearchBounds): URL {
  const url = new URL(base);
  if (url.pathname === "/") url.pathname = "/search";
  const params = {
    q: city ? `${name}, ${city}` : name, format: "jsonv2", addressdetails: "1", namedetails: "1", extratags: "1",
    countrycodes: "id", bounded: "1", limit: String(nominatimMatchLimit),
    viewbox: [west, north, east, south].map(value => value.toFixed(6)).join(","),
  };
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  return url;
}

export async function resolvePlaceNamesFromOsm(input: ResolvePlaceNamesFromOsmInput,
  options: ResolvePlaceNamesFromOsmOptions = {}): Promise<StudioResolvedPinpoint[]> {
  const requested = input.places.map(({ clientKey, name }) => ({ clientKey, name, status: "unresolved" } as const));
  const scope = placeSearchBounds(input.boundaryPolygon);
  if (!scope || options.signal?.aborted || !requested.length) return requested;

  const names = requested.slice(0, placeNameLimit).map(place => cleanText(place.name, 160) ?? "");
  const queries = new Map(names.filter(Boolean).map(name => [placeNameKey(name), name]));
  const resultsByName = new Map<string, OsmSearchPoint[]>();
  if (!queries.size) return requested;
  if (options.mode === "fixture" || options.mode === "recorded-rehearsal") {
    for (const [name, results] of Object.entries(options.recordedResults ?? {})) {
      const key = placeNameKey(name);
      if (queries.has(key) && Array.isArray(results) && results.length <= nominatimMatchLimit) {
        resultsByName.set(key, normalizeNominatimResults(results));
      }
    }
  } else {
    const fetchImpl = options.fetchImpl ?? fetch;
    const now = options.now ?? Date.now;
    const configuredNominatim = nominatimUrl(options);
    const controller = new AbortController();
    const timeoutMs = Math.min(placeNameTimeoutMs, Math.max(1, options.timeoutMs ?? placeNameTimeoutMs));
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const signal = options.signal ? AbortSignal.any([options.signal, controller.signal]) : controller.signal;
    let resolveAbort: () => void;
    const aborted = new Promise<void>(resolve => { resolveAbort = resolve; });
    signal.addEventListener("abort", resolveAbort!, { once: true });

    try {
      if (configuredNominatim) {
        const city = cleanText(input.cityLabel);
        const searches = Array.from(queries, async ([key, name]) => {
          const points = await searchOsm(fetchImpl, nominatimQuery(configuredNominatim, name, city, scope), signal, now);
          resultsByName.set(key, points);
        });
        await Promise.race([Promise.allSettled(searches), aborted]);
      } else {
        // Only place names and the authored area leave the server. Draft metadata and GPS stay local.
        const query = overpassNameQuery([...queries.values()].sort(), scope);
        const lookup = searchOsm(fetchImpl, options.overpassApiUrl?.trim() || defaultOverpassUrl, signal, now, query)
          .then(points => { for (const key of queries.keys()) resultsByName.set(key, points); });
        await Promise.race([lookup, aborted]);
      }
    } catch {
      // Unavailable or incomplete results leave the creator free to pin manually.
    } finally {
      clearTimeout(timer);
      signal.removeEventListener("abort", resolveAbort!);
    }
  }

  return requested.map((place, index) => {
    const key = placeNameKey(names[index] ?? "");
    const matches = new Map((resultsByName.get(key) ?? []).filter(point =>
      point.names.includes(key) && point.latitude >= scope.south && point.latitude <= scope.north &&
      point.longitude >= scope.west && point.longitude <= scope.east).map(point => [point.osmId, point]));
    if (matches.size !== 1) return place;
    const { names: _names, ...point } = matches.values().next().value!;
    if (!pointInPolygon(point, input.boundaryPolygon)) return { ...place, ...point, status: "outside_boundary" };
    const suggestedZoneId = nearestZone(point, input.zones);
    return { ...place, ...point, status: "resolved", source: "osm-curated", fieldVerified: false,
      ...(suggestedZoneId ? { suggestedZoneId } : {}) };
  });
}
