import { createHash } from "node:crypto";
import type {
  CurseCastingCost,
  CurseEffectModifier,
  CurseEffectPayload,
  GeoCoordinate,
  GeoPoi,
  GeoSnapshot,
  GeoStation,
  HideSeekCardCategory,
  HideSeekCardDefinition,
  HideSeekPlayPhase,
  HideSeekQuestionFamily,
  HideSeekRulebookPack,
  HideSeekRulebookValidationResult,
  RulebookValidationIssue,
  TransitMode,
} from "@kelana-ria/contracts";

const MINUTE_MS = 60_000;
const MIN_ELIGIBLE_ANCHORS = 6;
const RECOMMENDED_ELIGIBLE_ANCHORS = 12;
const MIN_POIS_PER_REFERENCED_CATEGORY = 2;
const MIN_HAND_LIMIT = 3;
const MAX_HAND_LIMIT = 8;
const MIN_DECK_CARDS = 12;
const MAX_PHOTO_AUTO_APPROVE_MS = 5 * MINUTE_MS;
const MAX_BLOCKING_CURSE_TIMER_MS = 20 * MINUTE_MS;
const MAX_BLOCKING_CURSE_SEARCH_RATIO = 0.35;
const MIN_REACHABLE_ANCHOR_RATIO = 0.5;
const FALLBACK_TRANSIT_SPEED_MPS = 5.0; // ~18 km/h conservative urban transit estimate
const FALLBACK_BOARDING_BUFFER_MS = 5 * MINUTE_MS;
const TIE_EPSILON_METERS = 1e-6;

const VALID_DIFFICULTIES = new Set(["starter", "standard", "expert"]);
const VALID_TRANSIT_MODES = new Set<TransitMode>(["walk", "mrt", "krl", "transjakarta", "lrt", "other"]);
const VALID_TURN_MODES = new Set(["everyone_hides_once", "fixed_turns"]);
const VALID_REGROUP_POLICIES = new Set(["previous_hiding_station", "last_play_checkpoint", "shared_start", "anywhere_ready"]);
const VALID_MISSED_LOCK_POLICIES = new Set(["void_turn", "auto_lock_nearest_station", "forfeit_turn"]);
const VALID_REPEAT_COST_MODES = new Set(["escalating_multiplier", "single_use_locked", "flat"]);
const VALID_PHASES = new Set<HideSeekPlayPhase>(["seeking", "endgame"]);
const VALID_QUESTION_FAMILIES = new Set<HideSeekQuestionFamily>([
  "radar",
  "thermometer",
  "matching",
  "measuring",
  "tentacles",
  "photo",
]);
const VALID_HIDE_SEEK_BLOCKERS = new Set(["none", "block_questions", "block_transit", "block_both"]);
const POWERUP_PRIMITIVES = new Set([
  "veto",
  "randomize",
  "duplicate",
  "expand_hand",
  "discard_draw",
  "time_trap",
  "move_zone",
]);

function isNonEmptyString(value: unknown, minLength = 1): value is string {
  return typeof value === "string" && value.trim().length >= minLength;
}

function isPositiveFinite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function isNonNegativeFinite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function isPositiveInt(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

function isNonNegativeInt(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

export function isValidCoordinate(point: unknown): point is GeoCoordinate {
  if (!point || typeof point !== "object") return false;
  const { latitude, longitude } = point as Partial<GeoCoordinate>;
  return (
    typeof latitude === "number" &&
    Number.isFinite(latitude) &&
    latitude >= -90 &&
    latitude <= 90 &&
    typeof longitude === "number" &&
    Number.isFinite(longitude) &&
    longitude >= -180 &&
    longitude <= 180
  );
}

export function haversineMeters(a: GeoCoordinate, b: GeoCoordinate): number {
  const radians = Math.PI / 180;
  const latDiff = (b.latitude - a.latitude) * radians;
  const lngDiff = (b.longitude - a.longitude) * radians;
  const sinLat = Math.sin(latDiff / 2);
  const sinLng = Math.sin(lngDiff / 2);
  const h =
    sinLat * sinLat +
    Math.cos(a.latitude * radians) * Math.cos(b.latitude * radians) * sinLng * sinLng;
  return 2 * 6_371_000 * Math.asin(Math.sqrt(Math.min(1, h)));
}

function pointOnSegment(point: GeoCoordinate, start: GeoCoordinate, end: GeoCoordinate): boolean {
  const eps = 1e-9;
  const cross =
    (point.latitude - start.latitude) * (end.longitude - start.longitude) -
    (point.longitude - start.longitude) * (end.latitude - start.latitude);
  if (Math.abs(cross) > eps) return false;
  const minLat = Math.min(start.latitude, end.latitude) - eps;
  const maxLat = Math.max(start.latitude, end.latitude) + eps;
  const minLng = Math.min(start.longitude, end.longitude) - eps;
  const maxLng = Math.max(start.longitude, end.longitude) + eps;
  return (
    point.latitude >= minLat &&
    point.latitude <= maxLat &&
    point.longitude >= minLng &&
    point.longitude <= maxLng
  );
}

export function pointInPolygon(point: GeoCoordinate, polygon: GeoCoordinate[]): boolean {
  if (polygon.length < 3) return false;
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i];
    const b = polygon[j];
    if (pointOnSegment(point, a, b)) return true;
    const intersects =
      (a.latitude > point.latitude) !== (b.latitude > point.latitude) &&
      point.longitude <
        ((b.longitude - a.longitude) * (point.latitude - a.latitude)) / (b.latitude - a.latitude) +
          a.longitude;
    if (intersects) inside = !inside;
  }
  return inside;
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => a.localeCompare(b));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(",")}}`;
}

export function computeGeoSnapshotHash(snapshot: Omit<GeoSnapshot, "hash">): string {
  const canonicalPayload = canonicalJson({
    id: snapshot.id,
    boundaryPolygon: snapshot.boundaryPolygon,
    startPoint: snapshot.startPoint,
    stations: snapshot.stations,
    pois: snapshot.pois,
    attributions: snapshot.attributions,
  });
  return createHash("sha256").update(canonicalPayload).digest("hex");
}

function nearestPoiIds(point: GeoCoordinate, pois: GeoPoi[]): string {
  if (pois.length === 0) return "";
  let best = Infinity;
  const distances = pois.map((poi) => {
    const d = haversineMeters(point, poi);
    if (d < best) best = d;
    return d;
  });
  return pois
    .filter((_, idx) => Math.abs(distances[idx] - best) <= TIE_EPSILON_METERS)
    .map((poi) => poi.id)
    .sort()
    .join("|");
}

function nearestPoiDistance(point: GeoCoordinate, pois: GeoPoi[]): number {
  let best = Infinity;
  for (const poi of pois) {
    const d = haversineMeters(point, poi);
    if (d < best) best = d;
  }
  return best;
}

function compareDistanceWithTolerance(firstMeters: number, secondMeters: number, toleranceMeters: number): -1 | 0 | 1 {
  const diff = firstMeters - secondMeters;
  if (Math.abs(diff) <= toleranceMeters) return 0;
  return diff > 0 ? 1 : -1;
}

function estimatedAnchorTravelMs(startPoint: GeoCoordinate, station: GeoStation): number {
  if (isPositiveFinite(station.estimatedTravelFromStartMs)) {
    return station.estimatedTravelFromStartMs;
  }
  const meters = haversineMeters(startPoint, station);
  return Math.round((meters / FALLBACK_TRANSIT_SPEED_MPS) * 1000) + FALLBACK_BOARDING_BUFFER_MS;
}

function expectedCategoryForPrimitive(primitive: string): HideSeekCardCategory | null {
  if (primitive === "time_bonus") return "time_bonus";
  if (primitive === "curse") return "curse";
  if (POWERUP_PRIMITIVES.has(primitive)) return "powerup";
  return null;
}

export function validateHideSeekRulebook(
  pack: HideSeekRulebookPack,
  snapshot: GeoSnapshot,
): HideSeekRulebookValidationResult {
  const errors: RulebookValidationIssue[] = [];
  const warnings: RulebookValidationIssue[] = [];

  const addError = (code: string, path: string, message: string) => {
    errors.push({ code, path, message, severity: "error" });
  };
  const addWarning = (code: string, path: string, message: string) => {
    warnings.push({ code, path, message, severity: "warning" });
  };

  if (!pack || typeof pack !== "object") {
    addError("invalid-pack", "", "RulebookPack must be an object.");
    return {
      ok: false,
      errors,
      warnings,
      summary: {
        eligibleAnchorCount: 0,
        reachableAnchorCount: 0,
        totalDeckCards: 0,
        objectiveQuestionCount: 0,
        photoQuestionCount: 0,
      },
    };
  }
  if (!snapshot || typeof snapshot !== "object") {
    addError("invalid-snapshot", "snapshot", "GeoSnapshot must be an object.");
    return {
      ok: false,
      errors,
      warnings,
      summary: {
        eligibleAnchorCount: 0,
        reachableAnchorCount: 0,
        totalDeckCards: 0,
        objectiveQuestionCount: 0,
        photoQuestionCount: 0,
      },
    };
  }

  // --- Gate 1: Meta, Session, Timers & Geography Config ---
  const meta = pack.meta;
  if (!meta || typeof meta !== "object") {
    addError("invalid-meta", "meta", "Pack meta section is required.");
  } else {
    if (meta.schemaVersion !== "hide-seek-rulebook-v1") {
      addError("unsupported-schema-version", "meta.schemaVersion", "Expected schemaVersion hide-seek-rulebook-v1.");
    }
    if (meta.format !== "hide-and-seek") {
      addError("invalid-format", "meta.format", "Expected format hide-and-seek.");
    }
    if (!isNonEmptyString(meta.packId, 3)) {
      addError("invalid-meta", "meta.packId", "packId must be at least 3 characters.");
    }
    if (!isPositiveInt(meta.version)) {
      addError("invalid-meta", "meta.version", "version must be a positive integer.");
    }
    if (!isNonEmptyString(meta.title, 3)) {
      addError("invalid-meta", "meta.title", "title must be at least 3 characters.");
    }
    if (!isNonEmptyString(meta.byline, 2)) {
      addError("invalid-meta", "meta.byline", "byline must be at least 2 characters.");
    }
    if (!isNonEmptyString(meta.cityLabel, 2)) {
      addError("invalid-meta", "meta.cityLabel", "cityLabel must be at least 2 characters.");
    }
    if (!VALID_DIFFICULTIES.has(meta.difficulty)) {
      addError("invalid-meta", "meta.difficulty", "difficulty must be starter, standard, or expert.");
    }
    if (!isNonNegativeInt(meta.priceIdr)) {
      addError("invalid-price", "meta.priceIdr", "priceIdr must be a non-negative integer.");
    } else if (meta.isOfficial && meta.priceIdr !== 0) {
      addError("official-pack-must-be-free", "meta.priceIdr", "Official packs must have priceIdr set to 0.");
    }
  }

  const session = pack.session;
  if (!session || typeof session !== "object") {
    addError("invalid-session", "session", "Pack session rules are required.");
  } else {
    if (!isPositiveInt(session.minPlayers) || session.minPlayers < 2 || session.minPlayers > 6) {
      addError("invalid-player-range", "session.minPlayers", "minPlayers must be an integer between 2 and 6.");
    }
    if (!isPositiveInt(session.maxPlayers) || session.maxPlayers < 2 || session.maxPlayers > 6) {
      addError("invalid-player-range", "session.maxPlayers", "maxPlayers must be an integer between 2 and 6.");
    }
    if (
      isPositiveInt(session.minPlayers) &&
      isPositiveInt(session.maxPlayers) &&
      session.minPlayers > session.maxPlayers
    ) {
      addError("invalid-player-range", "session.minPlayers", "minPlayers cannot exceed maxPlayers.");
    }
    if (!VALID_TURN_MODES.has(session.turnMode)) {
      addError("invalid-session", "session.turnMode", "turnMode must be everyone_hides_once or fixed_turns.");
    }
    if (session.turnMode === "fixed_turns" && !isPositiveInt(session.fixedTurnCount)) {
      addError("invalid-session", "session.fixedTurnCount", "fixedTurnCount must be a positive integer for fixed_turns.");
    }
    if (!VALID_REGROUP_POLICIES.has(session.regroupPolicy)) {
      addError("invalid-session", "session.regroupPolicy", "Invalid regroupPolicy.");
    }
    if (!VALID_MISSED_LOCK_POLICIES.has(session.missedLockPolicy)) {
      addError("invalid-session", "session.missedLockPolicy", "Invalid missedLockPolicy.");
    }
    if (!isNonNegativeFinite(session.endgameFreezeGraceSec) || session.endgameFreezeGraceSec > 300) {
      addError("invalid-session", "session.endgameFreezeGraceSec", "endgameFreezeGraceSec must be between 0 and 300.");
    }
    if (!isPositiveFinite(session.maxPathOffsetMeters) || session.maxPathOffsetMeters > 50) {
      addError("invalid-session", "session.maxPathOffsetMeters", "maxPathOffsetMeters must be in (0, 50].");
    }
  }

  const timers = pack.timers;
  const searchLimitMs = timers && isPositiveFinite(timers.searchLimitMs) ? timers.searchLimitMs : 0;
  const headStartMs = timers && isPositiveFinite(timers.headStartMs) ? timers.headStartMs : 0;
  if (!timers || typeof timers !== "object") {
    addError("invalid-timers", "timers", "Pack timers are required.");
  } else {
    const timerKeys = [
      "headStartMs",
      "searchLimitMs",
      "regroupLimitMs",
      "objectiveResponseMs",
      "photoResponseMs",
      "drawDecisionMs",
    ] as const;
    for (const key of timerKeys) {
      if (!isPositiveFinite(timers[key])) {
        addError("invalid-timer", `timers.${key}`, `${key} must be a positive finite number.`);
      }
    }
    if (headStartMs > 0 && searchLimitMs > 0 && searchLimitMs < 2 * headStartMs) {
      addError(
        "search-limit-too-short",
        "timers.searchLimitMs",
        "searchLimitMs must be at least 2x headStartMs so seekers have enough time to deduce and travel.",
      );
    }
  }

  const geography = pack.geography;
  if (!geography || typeof geography !== "object") {
    addError("invalid-geography", "geography", "Pack geography rules are required.");
  } else {
    if (!isPositiveFinite(geography.hidingZoneRadiusMeters) || geography.hidingZoneRadiusMeters < 100 || geography.hidingZoneRadiusMeters > 5000) {
      addError("invalid-geography", "geography.hidingZoneRadiusMeters", "hidingZoneRadiusMeters must be between 100 and 5000.");
    }
    if (!isPositiveFinite(geography.checkInRadiusMeters) || geography.checkInRadiusMeters < 10 || geography.checkInRadiusMeters > 500) {
      addError("invalid-geography", "geography.checkInRadiusMeters", "checkInRadiusMeters must be between 10 and 500.");
    }
    if (!isPositiveFinite(geography.maxGpsAccuracyMeters)) {
      addError("invalid-geography", "geography.maxGpsAccuracyMeters", "maxGpsAccuracyMeters must be positive.");
    }
    if (!isPositiveFinite(geography.maxGpsFixAgeMs)) {
      addError("invalid-geography", "geography.maxGpsFixAgeMs", "maxGpsFixAgeMs must be positive.");
    }
    if (
      !Array.isArray(geography.allowedTransitModes) ||
      geography.allowedTransitModes.length === 0 ||
      !geography.allowedTransitModes.every((mode) => VALID_TRANSIT_MODES.has(mode))
    ) {
      addError("invalid-geography", "geography.allowedTransitModes", "At least one valid transit mode is required.");
    }
    if (geography.geoSnapshotId !== snapshot.id) {
      addError("snapshot-id-mismatch", "geography.geoSnapshotId", "geoSnapshotId does not match snapshot.id.");
    }
    if (!isNonEmptyString(geography.geoSnapshotHash) || geography.geoSnapshotHash !== snapshot.hash) {
      addError("snapshot-hash-mismatch", "geography.geoSnapshotHash", "geoSnapshotHash does not match snapshot.hash.");
    }
  }

  // --- Gate 2: GeoSnapshot Integrity, Boundary, Stations & POIs ---
  if (!isNonEmptyString(snapshot.id)) {
    addError("invalid-snapshot", "snapshot.id", "snapshot.id is required.");
  }
  const computedHash = computeGeoSnapshotHash(snapshot);
  if (snapshot.hash !== computedHash) {
    addError("snapshot-hash-invalid", "snapshot.hash", "snapshot.hash does not match canonical SHA-256 content hash.");
  }

  const boundary = Array.isArray(snapshot.boundaryPolygon) ? snapshot.boundaryPolygon : [];
  const boundaryValid = boundary.length >= 3 && boundary.every(isValidCoordinate);
  if (!boundaryValid) {
    addError("invalid-boundary", "snapshot.boundaryPolygon", "boundaryPolygon must contain at least 3 valid coordinates.");
  }

  if (!snapshot.startPoint || !isValidCoordinate(snapshot.startPoint) || !isNonEmptyString(snapshot.startPoint.id) || !isNonEmptyString(snapshot.startPoint.name) || !isNonEmptyString(snapshot.startPoint.accessNotes, 4)) {
    addError("invalid-start-point", "snapshot.startPoint", "startPoint must have valid id, name, coordinates, and accessNotes.");
  } else if (boundaryValid && !pointInPolygon(snapshot.startPoint, boundary)) {
    addError("start-outside-boundary", "snapshot.startPoint", "startPoint must lie inside boundaryPolygon.");
  }

  if (!Array.isArray(snapshot.attributions) || snapshot.attributions.length === 0) {
    addError("missing-attributions", "snapshot.attributions", "At least one geo data attribution is required.");
  }

  const stations = Array.isArray(snapshot.stations) ? snapshot.stations : [];
  const stationIds = new Set<string>();
  const eligibleAnchors: GeoStation[] = [];

  for (let i = 0; i < stations.length; i++) {
    const station = stations[i];
    const basePath = `snapshot.stations[${i}]`;
    if (!station || !isNonEmptyString(station.id) || !isNonEmptyString(station.name)) {
      addError("invalid-station", basePath, "Station must have non-empty id and name.");
      continue;
    }
    const stationId = station.id;
    if (stationIds.has(stationId)) {
      addError("duplicate-station-id", `${basePath}.id`, `Duplicate station id ${stationId}.`);
      continue;
    }
    stationIds.add(stationId);
    if (!isValidCoordinate(station)) {
      addError("invalid-station-coordinate", basePath, `Station ${stationId} has invalid coordinates.`);
      continue;
    }
    if (boundaryValid && !pointInPolygon(station, boundary)) {
      addError("station-outside-boundary", basePath, `Station ${station.id} lies outside boundaryPolygon.`);
    }
    if (!Array.isArray(station.transitLines) || station.transitLines.length === 0 || !station.transitLines.every((line) => isNonEmptyString(line))) {
      addError("station-missing-transit-lines", `${basePath}.transitLines`, `Station ${station.id} must list at least one transit line.`);
    }
    if (station.eligibleHidingAnchor) {
      if (!isNonEmptyString(station.accessNotes, 4)) {
        addError("station-missing-access-notes", `${basePath}.accessNotes`, `Eligible anchor station ${station.id} requires accessNotes.`);
      }
      if (!isNonEmptyString(station.publicHours, 2)) {
        addError("station-missing-public-hours", `${basePath}.publicHours`, `Eligible anchor station ${station.id} requires publicHours.`);
      }
      eligibleAnchors.push(station);
    }
  }

  if (eligibleAnchors.length < MIN_ELIGIBLE_ANCHORS) {
    addError(
      "insufficient-anchor-stations",
      "snapshot.stations",
      `At least ${MIN_ELIGIBLE_ANCHORS} eligible anchor stations are required (found ${eligibleAnchors.length}).`,
    );
  } else if (eligibleAnchors.length < RECOMMENDED_ELIGIBLE_ANCHORS) {
    addWarning(
      "low-anchor-station-count",
      "snapshot.stations",
      `Only ${eligibleAnchors.length} eligible anchor stations; ${RECOMMENDED_ELIGIBLE_ANCHORS}+ is recommended for deduction depth.`,
    );
  }

  const pois = Array.isArray(snapshot.pois) ? snapshot.pois : [];
  const poiIds = new Set<string>();
  const poisById = new Map<string, GeoPoi>();
  const poisByCategory = new Map<string, GeoPoi[]>();

  for (let i = 0; i < pois.length; i++) {
    const poi = pois[i];
    const basePath = `snapshot.pois[${i}]`;
    if (!poi || !isNonEmptyString(poi.id) || !isNonEmptyString(poi.name) || !isNonEmptyString(poi.category)) {
      addError("invalid-poi", basePath, "POI must have non-empty id, name, and category.");
      continue;
    }
    const poiId = poi.id;
    if (poiIds.has(poiId)) {
      addError("duplicate-poi-id", `${basePath}.id`, `Duplicate POI id ${poiId}.`);
      continue;
    }
    if (!isValidCoordinate(poi)) {
      addError("invalid-poi-coordinate", basePath, `POI ${poiId} has invalid coordinates.`);
      continue;
    }
    poiIds.add(poi.id);
    poisById.set(poi.id, poi);
    const list = poisByCategory.get(poi.category) ?? [];
    list.push(poi);
    poisByCategory.set(poi.category, list);
  }

  const requirePoiCategory = (category: unknown, path: string) => {
    if (!isNonEmptyString(category)) {
      addError("missing-poi-category", path, "POI category must be a non-empty string.");
      return;
    }
    const found = poisByCategory.get(category) ?? [];
    if (found.length < MIN_POIS_PER_REFERENCED_CATEGORY) {
      addError(
        "insufficient-pois-for-category",
        path,
        `Referenced POI category "${category}" requires at least ${MIN_POIS_PER_REFERENCED_CATEGORY} POIs in GeoSnapshot (found ${found.length}).`,
      );
    }
  };

  // --- Gate 3: Investigation Book & Pairwise Objective Separability ---
  const book = pack.investigationBook;
  const enabledFamilies = new Set<HideSeekQuestionFamily>();
  let objectiveQuestionCount = 0;
  let photoQuestionCount = 0;

  if (!book || typeof book !== "object" || !book.families || typeof book.families !== "object") {
    addError("invalid-investigation-book", "investigationBook", "investigationBook and families are required.");
  } else {
    if (!VALID_REPEAT_COST_MODES.has(book.repeatCostMode)) {
      addError("invalid-investigation-book", "investigationBook.repeatCostMode", "Invalid repeatCostMode.");
    }
    if (!isNonNegativeFinite(book.tieToleranceMeters)) {
      addError("invalid-investigation-book", "investigationBook.tieToleranceMeters", "tieToleranceMeters must be non-negative.");
    }

    const validateFamilyHeader = (
      family: HideSeekQuestionFamily,
      cfg: { enabled: boolean; drawCount: number; keepCount: number; responseMs?: number; availableInPhases: HideSeekPlayPhase[]; items: { id: string; label: string }[] } | undefined,
    ): boolean => {
      if (!cfg || !cfg.enabled) return false;
      const basePath = `investigationBook.families.${family}`;
      enabledFamilies.add(family);
      if (!isPositiveInt(cfg.drawCount) || !isPositiveInt(cfg.keepCount) || cfg.keepCount > cfg.drawCount) {
        addError("invalid-question-price", basePath, `${family} must have integer drawCount >= keepCount >= 1.`);
      }
      if (cfg.responseMs !== undefined && !isPositiveFinite(cfg.responseMs)) {
        addError("invalid-question-response-ms", `${basePath}.responseMs`, `${family} responseMs must be positive.`);
      }
      if (!Array.isArray(cfg.availableInPhases) || cfg.availableInPhases.length === 0 || !cfg.availableInPhases.every((p) => VALID_PHASES.has(p))) {
        addError("invalid-question-phases", `${basePath}.availableInPhases`, `${family} must specify at least one valid play phase.`);
      }
      if (!Array.isArray(cfg.items) || cfg.items.length === 0) {
        addError("empty-question-family", `${basePath}.items`, `Enabled family ${family} must contain at least one item.`);
        return false;
      }
      const seenItemIds = new Set<string>();
      for (let i = 0; i < cfg.items.length; i++) {
        const item = cfg.items[i];
        if (!item || !isNonEmptyString(item.id) || !isNonEmptyString(item.label)) {
          addError("invalid-question-item", `${basePath}.items[${i}]`, "Question item requires non-empty id and label.");
          continue;
        }
        if (seenItemIds.has(item.id)) {
          addError("duplicate-question-item-id", `${basePath}.items[${i}].id`, `Duplicate item id ${item.id} in ${family}.`);
        }
        seenItemIds.add(item.id);
      }
      return true;
    };

    const { radar, thermometer, matching, measuring, tentacles, photo } = book.families;

    if (validateFamilyHeader("radar", radar) && radar) {
      objectiveQuestionCount += radar.items.length + (radar.allowCustomRadius ? 1 : 0);
      radar.items.forEach((item, i) => {
        if (!isPositiveFinite(item.radiusMeters)) {
          addError("invalid-radar-radius", `investigationBook.families.radar.items[${i}].radiusMeters`, "Radar radiusMeters must be positive.");
        }
      });
    }

    if (validateFamilyHeader("thermometer", thermometer) && thermometer) {
      objectiveQuestionCount += thermometer.items.length;
      thermometer.items.forEach((item, i) => {
        if (!isPositiveFinite(item.minTravelMeters)) {
          addError("invalid-thermometer-distance", `investigationBook.families.thermometer.items[${i}].minTravelMeters`, "Thermometer minTravelMeters must be positive.");
        }
      });
    }

    if (validateFamilyHeader("matching", matching) && matching) {
      objectiveQuestionCount += matching.items.length;
      matching.items.forEach((item, i) => {
        const itemPath = `investigationBook.families.matching.items[${i}]`;
        if (item.matchType === "station_attribute") {
          if (!isNonEmptyString(item.attributeKey)) {
            addError("missing-attribute-key", `${itemPath}.attributeKey`, "station_attribute matching requires attributeKey.");
          } else {
            for (const anchor of eligibleAnchors) {
              if (!anchor.attributes || !isNonEmptyString(anchor.attributes[item.attributeKey])) {
                addError(
                  "missing-station-attribute",
                  `${itemPath}.attributeKey`,
                  `Eligible anchor ${anchor.id} is missing attribute "${item.attributeKey}".`,
                );
              }
            }
          }
        } else if (item.matchType === "nearest_poi") {
          requirePoiCategory(item.poiCategory, `${itemPath}.poiCategory`);
        } else if (item.matchType !== "transit_line" && item.matchType !== "station_name_length") {
          addError("invalid-matching-type", `${itemPath}.matchType`, `Unsupported matching type "${String(item.matchType)}".`);
        }
      });
    }

    if (validateFamilyHeader("measuring", measuring) && measuring) {
      objectiveQuestionCount += measuring.items.length;
      measuring.items.forEach((item, i) => {
        const itemPath = `investigationBook.families.measuring.items[${i}]`;
        if (item.targetType === "poi_category") {
          requirePoiCategory(item.poiCategory, `${itemPath}.poiCategory`);
        } else if (item.targetType === "named_poi") {
          if (!isNonEmptyString(item.poiId) || !poisById.has(item.poiId)) {
            addError("unknown-named-poi", `${itemPath}.poiId`, `Measuring named_poi "${String(item.poiId)}" not found in GeoSnapshot.`);
          }
        } else {
          addError("invalid-measuring-type", `${itemPath}.targetType`, `Unsupported measuring targetType "${String(item.targetType)}".`);
        }
      });
    }

    if (validateFamilyHeader("tentacles", tentacles) && tentacles) {
      objectiveQuestionCount += tentacles.items.length;
      tentacles.items.forEach((item, i) => {
        const itemPath = `investigationBook.families.tentacles.items[${i}]`;
        if (!isPositiveFinite(item.radiusMeters)) {
          addError("invalid-tentacles-radius", `${itemPath}.radiusMeters`, "Tentacles radiusMeters must be positive.");
        }
        requirePoiCategory(item.poiCategory, `${itemPath}.poiCategory`);
      });
    }

    if (validateFamilyHeader("photo", photo) && photo) {
      photoQuestionCount += photo.items.length;
      photo.items.forEach((item, i) => {
        const itemPath = `investigationBook.families.photo.items[${i}]`;
        if (!isNonEmptyString(item.prompt, 4)) {
          addError("invalid-photo-prompt", `${itemPath}.prompt`, "Photo prompt must be at least 4 characters.");
        }
        if (item.phase !== "seeking" && item.phase !== "endgame" && item.phase !== "both") {
          addError("invalid-photo-phase", `${itemPath}.phase`, "Photo phase must be seeking, endgame, or both.");
        }
      });
    }

    if (objectiveQuestionCount === 0) {
      addError("no-objective-questions", "investigationBook", "At least one objective (non-photo) question is required.");
    }

    // Objective pairwise separability across all eligible anchor stations
    if (eligibleAnchors.length >= 2 && objectiveQuestionCount > 0) {
      const references: GeoCoordinate[] = [
        ...(snapshot.startPoint && isValidCoordinate(snapshot.startPoint) ? [snapshot.startPoint] : []),
        ...stations.filter(isValidCoordinate),
      ];
      const tol = isNonNegativeFinite(book.tieToleranceMeters) ? book.tieToleranceMeters : 0;

      const matchingSignatures: string[][] = [];
      if (matching?.enabled) {
        for (const item of matching.items) {
          if (item.matchType === "transit_line") {
            matchingSignatures.push(eligibleAnchors.map((a) => [...a.transitLines].sort().join("|")));
          } else if (item.matchType === "station_name_length") {
            matchingSignatures.push(eligibleAnchors.map((a) => String(a.name.trim().length)));
          } else if (item.matchType === "station_attribute" && item.attributeKey) {
            const key = item.attributeKey;
            matchingSignatures.push(eligibleAnchors.map((a) => a.attributes?.[key] ?? ""));
          } else if (item.matchType === "nearest_poi" && item.poiCategory) {
            const categoryPois = poisByCategory.get(item.poiCategory) ?? [];
            if (categoryPois.length >= MIN_POIS_PER_REFERENCED_CATEGORY) {
              matchingSignatures.push(eligibleAnchors.map((a) => nearestPoiIds(a, categoryPois)));
            }
          }
        }
      }

      const measuringAnchorDists: { refDists: number[]; anchorDists: number[] }[] = [];
      if (measuring?.enabled) {
        for (const item of measuring.items) {
          let targets: GeoPoi[] = [];
          if (item.targetType === "poi_category" && item.poiCategory) {
            targets = poisByCategory.get(item.poiCategory) ?? [];
          } else if (item.targetType === "named_poi" && item.poiId) {
            const named = poisById.get(item.poiId);
            if (named) targets = [named];
          }
          if (targets.length > 0) {
            measuringAnchorDists.push({
              refDists: references.map((r) => nearestPoiDistance(r, targets)),
              anchorDists: eligibleAnchors.map((a) => nearestPoiDistance(a, targets)),
            });
          }
        }
      }

      const radarRadii = radar?.enabled
        ? radar.items.map((item) => item.radiusMeters).filter(isPositiveFinite)
        : [];
      const customRadarEnabled = Boolean(radar?.enabled && radar.allowCustomRadius);

      const tentaclesConfigs = tentacles?.enabled
        ? tentacles.items
            .filter((item) => isPositiveFinite(item.radiusMeters) && (poisByCategory.get(item.poiCategory)?.length ?? 0) >= MIN_POIS_PER_REFERENCED_CATEGORY)
            .map((item) => ({
              radiusMeters: item.radiusMeters,
              pois: poisByCategory.get(item.poiCategory)!,
            }))
        : [];

      const thermometerThresholds = thermometer?.enabled
        ? thermometer.items.map((item) => item.minTravelMeters).filter(isPositiveFinite)
        : [];

      const refToAnchor: number[][] = references.map((ref) =>
        eligibleAnchors.map((anchor) => haversineMeters(ref, anchor)),
      );

      const separatedByObjective = (i: number, j: number): boolean => {
        for (const sigs of matchingSignatures) {
          if (sigs[i] !== sigs[j]) return true;
        }
        if (customRadarEnabled) {
          for (let r = 0; r < references.length; r++) {
            if (Math.abs(refToAnchor[r][i] - refToAnchor[r][j]) > TIE_EPSILON_METERS) return true;
          }
        }
        for (const radius of radarRadii) {
          for (let r = 0; r < references.length; r++) {
            if ((refToAnchor[r][i] <= radius) !== (refToAnchor[r][j] <= radius)) return true;
          }
        }
        for (const entry of measuringAnchorDists) {
          for (let r = 0; r < references.length; r++) {
            const cA = compareDistanceWithTolerance(entry.refDists[r], entry.anchorDists[i], tol);
            const cB = compareDistanceWithTolerance(entry.refDists[r], entry.anchorDists[j], tol);
            if (cA !== cB) return true;
          }
        }
        for (const tCfg of tentaclesConfigs) {
          for (let r = 0; r < references.length; r++) {
            const inA = refToAnchor[r][i] <= tCfg.radiusMeters;
            const inB = refToAnchor[r][j] <= tCfg.radiusMeters;
            if (inA !== inB) return true;
            if (inA && inB) {
              const poisInCircle = tCfg.pois.filter((p) => haversineMeters(references[r], p) <= tCfg.radiusMeters);
              if (poisInCircle.length > 0) {
                if (nearestPoiIds(eligibleAnchors[i], poisInCircle) !== nearestPoiIds(eligibleAnchors[j], poisInCircle)) {
                  return true;
                }
              }
            }
          }
        }
        if (thermometerThresholds.length > 0) {
          const minThreshold = Math.min(...thermometerThresholds);
          for (let r1 = 0; r1 < references.length; r1++) {
            for (let r2 = r1 + 1; r2 < references.length; r2++) {
              if (haversineMeters(references[r1], references[r2]) < minThreshold) continue;
              const dA = compareDistanceWithTolerance(refToAnchor[r1][i], refToAnchor[r2][i], tol);
              const dB = compareDistanceWithTolerance(refToAnchor[r1][j], refToAnchor[r2][j], tol);
              if (dA !== dB) return true;
            }
          }
        }
        return false;
      };

      for (let i = 0; i < eligibleAnchors.length; i++) {
        for (let j = i + 1; j < eligibleAnchors.length; j++) {
          if (!separatedByObjective(i, j)) {
            addError(
              "unseparable-anchor-pair",
              "investigationBook",
              `Eligible anchors "${eligibleAnchors[i].id}" and "${eligibleAnchors[j].id}" cannot be distinguished by any enabled objective question.`,
            );
          }
        }
      }
    }
  }

  // --- Gate 4: Deck & Anti-Grief Guardrails ---
  const deck = pack.deck;
  let totalDeckCards = 0;
  let hasTimeBonus = false;

  const validateCastingCost = (cost: CurseCastingCost, path: string) => {
    if (!cost || typeof cost !== "object") {
      addError("invalid-curse-cost", path, "Curse casting cost must be an object.");
      return;
    }
    switch (cost.type) {
      case "none":
        break;
      case "discard_cards":
        if (!isPositiveInt(cost.count) || cost.count > 4) {
          addError("invalid-curse-cost", `${path}.count`, "discard_cards count must be an integer between 1 and 4.");
        }
        break;
      case "seeker_min_distance":
      case "seeker_max_distance":
        if (!isPositiveFinite(cost.meters)) {
          addError("invalid-curse-cost", `${path}.meters`, `${cost.type} meters must be positive.`);
        }
        break;
      case "reveal_clue":
        if ((cost.clueType !== "photo_prompt" && cost.clueType !== "match_attribute") || !isNonEmptyString(cost.detail, 3)) {
          addError("invalid-curse-cost", path, "reveal_clue requires valid clueType and detail.");
        }
        break;
      default:
        addError("invalid-curse-cost", path, `Unsupported casting cost type "${String((cost as { type?: unknown }).type)}".`);
    }
  };

  const validateModifier = (mod: CurseEffectModifier, path: string) => {
    if (!mod || typeof mod !== "object") {
      addError("invalid-curse-modifier", path, "Curse modifier must be an object.");
      return;
    }
    switch (mod.type) {
      case "inflate_question_draws":
        if (!isPositiveInt(mod.extraDraws) || mod.extraDraws > 3) {
          addError("invalid-curse-modifier", `${path}.extraDraws`, "extraDraws must be an integer between 1 and 3.");
        }
        break;
      case "ban_question_family":
        if (!VALID_QUESTION_FAMILIES.has(mod.family) || !enabledFamilies.has(mod.family)) {
          addError("invalid-curse-modifier", `${path}.family`, `ban_question_family must reference an enabled family (got "${String(mod.family)}").`);
        }
        break;
      case "skip_penalty_minutes":
        if (!isPositiveFinite(mod.penaltyMinutes)) {
          addError("invalid-curse-modifier", `${path}.penaltyMinutes`, "skip_penalty_minutes penaltyMinutes must be positive.");
        }
        break;
      default:
        addError("invalid-curse-modifier", path, `Unsupported curse modifier "${String((mod as { type?: unknown }).type)}".`);
    }
  };

  const validateCurse = (curse: CurseEffectPayload, path: string) => {
    if (!curse || typeof curse !== "object") {
      addError("invalid-curse", path, "Curse payload is required.");
      return;
    }
    if (!Array.isArray(curse.castingCosts) || curse.castingCosts.length === 0 || curse.castingCosts.length > 2) {
      addError("invalid-curse-cost", `${path}.castingCosts`, "Curse must define 1 or 2 castingCosts (use { type: 'none' } for free).");
    } else {
      curse.castingCosts.forEach((cost, idx) => validateCastingCost(cost, `${path}.castingCosts[${idx}]`));
    }
    if (!VALID_HIDE_SEEK_BLOCKERS.has(curse.blockerType)) {
      addError("invalid-curse-blocker", `${path}.blockerType`, `Hide & Seek curse blockerType "${String(curse.blockerType)}" is invalid.`);
    }
    if (curse.effectModifiers !== undefined) {
      if (!Array.isArray(curse.effectModifiers)) {
        addError("invalid-curse-modifier", `${path}.effectModifiers`, "effectModifiers must be an array.");
      } else {
        curse.effectModifiers.forEach((mod, idx) => validateModifier(mod, `${path}.effectModifiers[${idx}]`));
      }
    }
    const clear = curse.clearCondition;
    const clearPath = `${path}.clearCondition`;
    if (!clear || typeof clear !== "object") {
      addError("invalid-curse-clear", clearPath, "Curse clearCondition is required.");
      return;
    }
    const isBlocking = curse.blockerType !== "none";
    const maxBlockingDuration =
      searchLimitMs > 0
        ? Math.min(MAX_BLOCKING_CURSE_TIMER_MS, Math.floor(searchLimitMs * MAX_BLOCKING_CURSE_SEARCH_RATIO))
        : MAX_BLOCKING_CURSE_TIMER_MS;

    switch (clear.type) {
      case "timer":
        if (!isPositiveFinite(clear.durationMs)) {
          addError("invalid-curse-clear", `${clearPath}.durationMs`, "Timer curse durationMs must be positive.");
        } else if (isBlocking && clear.durationMs > maxBlockingDuration) {
          addError(
            "blocking-curse-duration-exceeded",
            `${clearPath}.durationMs`,
            `Blocking curse timer (${clear.durationMs} ms) exceeds cap (${maxBlockingDuration} ms).`,
          );
        }
        break;
      case "next_n_questions":
        if (!isPositiveInt(clear.count) || clear.count > 5) {
          addError("invalid-curse-clear", `${clearPath}.count`, "next_n_questions count must be an integer between 1 and 5.");
        }
        break;
      case "gps_detour":
        requirePoiCategory(clear.poiCategory, `${clearPath}.poiCategory`);
        if (!isPositiveFinite(clear.radiusMeters) || clear.radiusMeters > 500) {
          addError("invalid-curse-clear", `${clearPath}.radiusMeters`, "gps_detour radiusMeters must be in (0, 500].");
        }
        if (clear.fallbackTimerMs !== undefined) {
          if (!isPositiveFinite(clear.fallbackTimerMs)) {
            addError("invalid-curse-clear", `${clearPath}.fallbackTimerMs`, "gps_detour fallbackTimerMs must be positive.");
          } else if (isBlocking && clear.fallbackTimerMs > maxBlockingDuration) {
            addError(
              "blocking-curse-duration-exceeded",
              `${clearPath}.fallbackTimerMs`,
              `Blocking gps_detour fallbackTimerMs (${clear.fallbackTimerMs} ms) exceeds cap (${maxBlockingDuration} ms).`,
            );
          }
        }
        break;
      case "photo_challenge":
        if (!isNonEmptyString(clear.prompt, 4)) {
          addError("invalid-curse-clear", `${clearPath}.prompt`, "photo_challenge prompt must be at least 4 characters.");
        }
        if (clear.approvalMode !== "opponent_or_timeout") {
          addError("invalid-curse-clear", `${clearPath}.approvalMode`, "photo_challenge approvalMode must be opponent_or_timeout.");
        }
        if (!isPositiveFinite(clear.autoApproveMs) || clear.autoApproveMs > MAX_PHOTO_AUTO_APPROVE_MS) {
          addError(
            "unbounded-photo-auto-approve",
            `${clearPath}.autoApproveMs`,
            `photo_challenge autoApproveMs must be in (0, ${MAX_PHOTO_AUTO_APPROVE_MS}] ms to prevent griefing.`,
          );
        }
        break;
      case "honor_task":
        if (!isNonEmptyString(clear.instruction, 6)) {
          addError("invalid-curse-clear", `${clearPath}.instruction`, "honor_task instruction must be at least 6 characters.");
        }
        if (clear.minDurationMs !== undefined && !isNonNegativeFinite(clear.minDurationMs)) {
          addError("invalid-curse-clear", `${clearPath}.minDurationMs`, "honor_task minDurationMs must be non-negative.");
        }
        break;
      default:
        addError("invalid-curse-clear", clearPath, `Unsupported clearCondition type "${String((clear as { type?: unknown }).type)}".`);
    }
  };

  const validateCard = (card: HideSeekCardDefinition, idx: number, seenIds: Set<string>) => {
    const path = `deck.cards[${idx}]`;
    if (!card || typeof card !== "object") {
      addError("invalid-card", path, "Card entry must be an object.");
      return;
    }
    if (!isNonEmptyString(card.id)) {
      addError("invalid-card", `${path}.id`, "Card id is required.");
    } else if (seenIds.has(card.id)) {
      addError("duplicate-card-id", `${path}.id`, `Duplicate card id "${card.id}".`);
    } else {
      seenIds.add(card.id);
    }
    if (!isNonEmptyString(card.title, 2) || !isNonEmptyString(card.description, 4)) {
      addError("invalid-card", path, "Card requires non-empty title and description.");
    }
    if (!isPositiveInt(card.copies)) {
      addError("invalid-card-copies", `${path}.copies`, "Card copies must be a positive integer.");
    } else {
      totalDeckCards += card.copies;
    }

    const effect = card.effect;
    if (!effect || typeof effect !== "object") {
      addError("invalid-card-effect", `${path}.effect`, "Card effect is required.");
      return;
    }
    const expectedCategory = expectedCategoryForPrimitive(effect.primitive);
    if (!expectedCategory) {
      addError("unsupported-card-primitive", `${path}.effect.primitive`, `Unsupported card primitive "${String(effect.primitive)}".`);
      return;
    }
    if (card.category !== expectedCategory) {
      addError(
        "card-category-mismatch",
        `${path}.category`,
        `Card category "${String(card.category)}" does not match primitive "${effect.primitive}" (expected "${expectedCategory}").`,
      );
    }

    switch (effect.primitive) {
      case "time_bonus": {
        hasTimeBonus = true;
        const hasMinutes = effect.minutes !== undefined;
        const hasPercent = effect.percentOfRawTime !== undefined;
        if (hasMinutes === hasPercent) {
          addError("invalid-time-bonus", `${path}.effect`, "time_bonus must specify exactly one of minutes or percentOfRawTime.");
        } else if (hasMinutes && !isPositiveFinite(effect.minutes)) {
          addError("invalid-time-bonus", `${path}.effect.minutes`, "time_bonus minutes must be positive.");
        } else if (hasPercent && (!isPositiveFinite(effect.percentOfRawTime) || effect.percentOfRawTime > 100)) {
          addError("invalid-time-bonus", `${path}.effect.percentOfRawTime`, "time_bonus percentOfRawTime must be in (0, 100].");
        }
        break;
      }
      case "veto":
      case "randomize":
      case "duplicate":
        break;
      case "expand_hand":
        if (!isPositiveInt(effect.extraSlots) || effect.extraSlots > 3) {
          addError("invalid-expand-hand", `${path}.effect.extraSlots`, "expand_hand extraSlots must be an integer between 1 and 3.");
        }
        break;
      case "discard_draw":
        if (
          !isPositiveInt(effect.discardCount) ||
          !isPositiveInt(effect.drawCount) ||
          !isPositiveInt(effect.keepCount) ||
          effect.keepCount > effect.drawCount
        ) {
          addError("invalid-discard-draw", `${path}.effect`, "discard_draw requires discardCount >= 1 and drawCount >= keepCount >= 1.");
        }
        break;
      case "time_trap":
        if (!isPositiveFinite(effect.bonusMinutes)) {
          addError("invalid-time-trap", `${path}.effect.bonusMinutes`, "time_trap bonusMinutes must be positive.");
        }
        break;
      case "move_zone":
        if (!isPositiveFinite(effect.travelWindowMs) || effect.travelWindowMs < MINUTE_MS) {
          addError("invalid-move-zone", `${path}.effect.travelWindowMs`, "move_zone travelWindowMs must be at least 60000 ms.");
        } else if (searchLimitMs > 0 && effect.travelWindowMs >= searchLimitMs) {
          addError("invalid-move-zone", `${path}.effect.travelWindowMs`, "move_zone travelWindowMs must be less than searchLimitMs.");
        }
        break;
      case "curse":
        validateCurse(effect.curse, `${path}.effect.curse`);
        break;
    }
  };

  if (!deck || typeof deck !== "object") {
    addError("invalid-deck", "deck", "Pack deck rules are required.");
  } else {
    if (!isPositiveInt(deck.baseHandLimit) || deck.baseHandLimit < MIN_HAND_LIMIT || deck.baseHandLimit > MAX_HAND_LIMIT) {
      addError("invalid-hand-limit", "deck.baseHandLimit", `baseHandLimit must be an integer between ${MIN_HAND_LIMIT} and ${MAX_HAND_LIMIT}.`);
    }
    if (!isPositiveInt(deck.maxActiveBlockingCurses) || deck.maxActiveBlockingCurses > 2) {
      addError("invalid-blocking-curse-cap", "deck.maxActiveBlockingCurses", "maxActiveBlockingCurses must be 1 or 2.");
    }
    if (!Array.isArray(deck.cards) || deck.cards.length === 0) {
      addError("empty-deck", "deck.cards", "Deck must contain at least one card definition.");
    } else {
      const seenCardIds = new Set<string>();
      deck.cards.forEach((card, idx) => validateCard(card, idx, seenCardIds));
      if (totalDeckCards < MIN_DECK_CARDS) {
        addError("deck-too-small", "deck.cards", `Deck must contain at least ${MIN_DECK_CARDS} total cards (found ${totalDeckCards}).`);
      }
      if (!hasTimeBonus) {
        addError("missing-time-bonus-card", "deck.cards", "Deck must include at least one time_bonus card.");
      }
    }
  }

  // --- Gate 5: Reachability Feasibility ---
  let reachableAnchorCount = 0;
  if (headStartMs > 0 && snapshot.startPoint && isValidCoordinate(snapshot.startPoint)) {
    for (const anchor of eligibleAnchors) {
      if (estimatedAnchorTravelMs(snapshot.startPoint, anchor) <= headStartMs) {
        reachableAnchorCount++;
      }
    }
    const minReachable = Math.ceil(eligibleAnchors.length * MIN_REACHABLE_ANCHOR_RATIO);
    if (eligibleAnchors.length > 0 && reachableAnchorCount < minReachable) {
      addError(
        "insufficient-reachable-anchors",
        "timers.headStartMs",
        `Only ${reachableAnchorCount} of ${eligibleAnchors.length} eligible anchor stations are reachable within headStartMs (minimum ${minReachable} required).`,
      );
    }
  }

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    summary: {
      eligibleAnchorCount: eligibleAnchors.length,
      reachableAnchorCount,
      totalDeckCards,
      objectiveQuestionCount,
      photoQuestionCount,
    },
  };
}
