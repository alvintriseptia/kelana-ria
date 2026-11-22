import type {
  GeoCoordinate,
  GeoPoi,
  GeoSnapshot,
  GeoStation,
  HideSeekQuestionFamily,
  HideSeekRulebookPack,
  LocationFix,
  MatchingQuestionItem,
  MeasuringQuestionItem,
  SeekObjectiveAnswer,
  TentaclesQuestionItem,
} from "@kelana-ria/contracts";
import { haversineMeters, isValidCoordinate } from "./rulebook-validator.js";

const TIE_EPSILON_METERS = 1e-6;

export type GpsCheckOutcome =
  | { ok: true; distanceMeters: number }
  | { ok: false; error: "invalid-fix" | "stale-fix" | "inaccurate-fix" | "outside-radius"; distanceMeters?: number };

export function verifyGpsFreshAndAccurate(
  fix: LocationFix,
  now: number,
  geography: Pick<HideSeekRulebookPack["geography"], "maxGpsAccuracyMeters" | "maxGpsFixAgeMs">,
): { ok: true } | { ok: false; error: "invalid-fix" | "stale-fix" | "inaccurate-fix" } {
  if (
    !fix ||
    !isValidCoordinate(fix) ||
    typeof fix.accuracy !== "number" ||
    !Number.isFinite(fix.accuracy) ||
    fix.accuracy < 0 ||
    typeof fix.timestamp !== "number" ||
    !Number.isFinite(fix.timestamp) ||
    fix.timestamp < 0
  ) {
    return { ok: false, error: "invalid-fix" };
  }
  if (fix.timestamp > now || now - fix.timestamp > geography.maxGpsFixAgeMs) {
    return { ok: false, error: "stale-fix" };
  }
  if (fix.accuracy > geography.maxGpsAccuracyMeters) {
    return { ok: false, error: "inaccurate-fix" };
  }
  return { ok: true };
}

export function verifyGpsAtPoint(
  target: GeoCoordinate,
  fix: LocationFix,
  now: number,
  geography: Pick<HideSeekRulebookPack["geography"], "checkInRadiusMeters" | "maxGpsAccuracyMeters" | "maxGpsFixAgeMs">,
  radiusOverrideMeters?: number,
): GpsCheckOutcome {
  const fresh = verifyGpsFreshAndAccurate(fix, now, geography);
  if (!fresh.ok) return fresh;
  const distanceMeters = Math.round(haversineMeters(target, fix) * 10) / 10;
  const limit = radiusOverrideMeters ?? geography.checkInRadiusMeters;
  if (distanceMeters > limit) {
    return { ok: false, error: "outside-radius", distanceMeters };
  }
  return { ok: true, distanceMeters };
}

export function isInsideHidingZone(
  anchor: GeoCoordinate,
  point: GeoCoordinate,
  hidingZoneRadiusMeters: number,
): { inside: boolean; distanceMeters: number } {
  const distanceMeters = Math.round(haversineMeters(anchor, point) * 10) / 10;
  return { inside: distanceMeters <= hidingZoneRadiusMeters, distanceMeters };
}

export function findNearestStation(
  point: GeoCoordinate,
  stations: GeoStation[],
  eligibleOnly = false,
): { station: GeoStation; distanceMeters: number } | null {
  const pool = eligibleOnly ? stations.filter((s) => s.eligibleHidingAnchor) : stations;
  if (pool.length === 0) return null;
  let best = pool[0];
  let bestDist = haversineMeters(point, best);
  for (let i = 1; i < pool.length; i++) {
    const d = haversineMeters(point, pool[i]);
    if (d < bestDist) {
      best = pool[i];
      bestDist = d;
    }
  }
  return { station: best, distanceMeters: Math.round(bestDist * 10) / 10 };
}

function nearestPois(point: GeoCoordinate, pois: GeoPoi[]): { pois: GeoPoi[]; distanceMeters: number } {
  if (pois.length === 0) return { pois: [], distanceMeters: Infinity };
  let minDist = Infinity;
  const dists = pois.map((poi) => {
    const d = haversineMeters(point, poi);
    if (d < minDist) minDist = d;
    return d;
  });
  const tied = pois.filter((_, idx) => Math.abs(dists[idx] - minDist) <= TIE_EPSILON_METERS);
  return { pois: tied, distanceMeters: minDist };
}

export function evaluateRadar(
  seekerPoint: GeoCoordinate,
  hiderAnchor: GeoStation,
  radiusMeters: number,
): SeekObjectiveAnswer {
  const inside = haversineMeters(seekerPoint, hiderAnchor) <= radiusMeters;
  return {
    code: inside ? "yes" : "no",
    label: inside ? "Yes" : "No",
    overlay: {
      type: "circle",
      center: { latitude: seekerPoint.latitude, longitude: seekerPoint.longitude },
      radiusMeters,
      inside,
    },
  };
}

export function evaluateThermometer(
  startPoint: GeoCoordinate,
  endPoint: GeoCoordinate,
  hiderAnchor: GeoStation,
  tieToleranceMeters: number,
): SeekObjectiveAnswer {
  const startDist = haversineMeters(startPoint, hiderAnchor);
  const endDist = haversineMeters(endPoint, hiderAnchor);
  const improvement = startDist - endDist;
  const result: "hotter" | "colder" | "equal" =
    Math.abs(improvement) <= tieToleranceMeters ? "equal" : improvement > 0 ? "hotter" : "colder";
  const label = result === "hotter" ? "Hotter" : result === "colder" ? "Colder" : "Equal";
  return {
    code: result,
    label,
    overlay: {
      type: "bisector",
      start: { latitude: startPoint.latitude, longitude: startPoint.longitude },
      end: { latitude: endPoint.latitude, longitude: endPoint.longitude },
      result,
      tieToleranceMeters,
    },
  };
}

function stationMatchSignature(
  station: GeoStation,
  item: MatchingQuestionItem,
  pois: GeoPoi[],
): string {
  switch (item.matchType) {
    case "transit_line":
      return [...station.transitLines].sort().join("|");
    case "station_name_length":
      return String(station.name.trim().length);
    case "station_attribute":
      return item.attributeKey ? (station.attributes?.[item.attributeKey] ?? "") : "";
    case "nearest_poi": {
      const catPois = pois.filter((p) => p.category === item.poiCategory);
      return nearestPois(station, catPois)
        .pois.map((p) => p.id)
        .sort()
        .join("|");
    }
  }
}

function sharesTransitLine(a: GeoStation, b: GeoStation): boolean {
  const setA = new Set(a.transitLines);
  return b.transitLines.some((line) => setA.has(line));
}

export function evaluateMatching(
  seekerStation: GeoStation,
  hiderAnchor: GeoStation,
  item: MatchingQuestionItem,
  snapshot: GeoSnapshot,
): SeekObjectiveAnswer {
  const anchors = snapshot.stations.filter((s) => s.eligibleHidingAnchor);
  const same =
    item.matchType === "transit_line"
      ? sharesTransitLine(seekerStation, hiderAnchor)
      : stationMatchSignature(seekerStation, item, snapshot.pois) ===
        stationMatchSignature(hiderAnchor, item, snapshot.pois);

  const seekerSig = stationMatchSignature(seekerStation, item, snapshot.pois);
  const matchedStationIds: string[] = [];
  const eliminatedStationIds: string[] = [];

  for (const candidate of anchors) {
    const candidateMatchesSeeker =
      item.matchType === "transit_line"
        ? sharesTransitLine(seekerStation, candidate)
        : stationMatchSignature(candidate, item, snapshot.pois) === seekerSig;
    if (candidateMatchesSeeker === same) {
      matchedStationIds.push(candidate.id);
    } else {
      eliminatedStationIds.push(candidate.id);
    }
  }

  return {
    code: same ? "same" : "different",
    label: same ? "Same" : "Different",
    overlay: {
      type: "station_filter",
      matchedStationIds,
      eliminatedStationIds,
      same,
    },
  };
}

export function evaluateMeasuring(
  seekerPoint: GeoCoordinate,
  hiderAnchor: GeoStation,
  item: MeasuringQuestionItem,
  snapshot: GeoSnapshot,
  tieToleranceMeters: number,
): SeekObjectiveAnswer {
  const targets =
    item.targetType === "named_poi"
      ? snapshot.pois.filter((p) => p.id === item.poiId)
      : snapshot.pois.filter((p) => p.category === item.poiCategory);
  const seekerNearest = nearestPois(seekerPoint, targets);
  const hiderNearest = nearestPois(hiderAnchor, targets);
  const diff = hiderNearest.distanceMeters - seekerNearest.distanceMeters;
  const result: "seeker_closer" | "hider_closer" | "equal" =
    Math.abs(diff) <= tieToleranceMeters ? "equal" : diff > 0 ? "seeker_closer" : "hider_closer";
  const label =
    result === "seeker_closer" ? "Seeker closer" : result === "hider_closer" ? "Hider closer" : "Equal";
  return {
    code: result,
    label,
    overlay: {
      type: "distance_compare",
      seekerPoint: { latitude: seekerPoint.latitude, longitude: seekerPoint.longitude },
      seekerDistanceMeters: Math.round(seekerNearest.distanceMeters * 10) / 10,
      targetPoiIds: targets.map((t) => t.id),
      result,
      tieToleranceMeters,
    },
  };
}

export function evaluateTentacles(
  seekerPoint: GeoCoordinate,
  hiderAnchor: GeoStation,
  item: TentaclesQuestionItem,
  snapshot: GeoSnapshot,
): SeekObjectiveAnswer {
  const categoryPois = snapshot.pois.filter((p) => p.category === item.poiCategory);
  const candidatePois = categoryPois.filter((p) => haversineMeters(seekerPoint, p) <= item.radiusMeters);
  const hiderDist = haversineMeters(seekerPoint, hiderAnchor);
  if (hiderDist > item.radiusMeters || candidatePois.length === 0) {
    return {
      code: "outside",
      label: "Outside radius",
      overlay: {
        type: "voronoi",
        center: { latitude: seekerPoint.latitude, longitude: seekerPoint.longitude },
        radiusMeters: item.radiusMeters,
        candidatePoiIds: candidatePois.map((p) => p.id),
        nearestPoiIds: [],
        outside: true,
      },
    };
  }
  const closest = nearestPois(hiderAnchor, candidatePois);
  const sorted = [...closest.pois].sort((a, b) => a.id.localeCompare(b.id));
  return {
    code: sorted.map((p) => p.id).join("|"),
    label: sorted.map((p) => p.name).join(" / "),
    overlay: {
      type: "voronoi",
      center: { latitude: seekerPoint.latitude, longitude: seekerPoint.longitude },
      radiusMeters: item.radiusMeters,
      candidatePoiIds: candidatePois.map((p) => p.id),
      nearestPoiIds: sorted.map((p) => p.id),
      outside: false,
    },
  };
}

export function evaluateObjectiveQuestion(params: {
  pack: HideSeekRulebookPack;
  snapshot: GeoSnapshot;
  family: Exclude<HideSeekQuestionFamily, "photo">;
  itemId: string;
  seekerPoint: GeoCoordinate;
  hiderAnchor: GeoStation;
  thermometerStart?: GeoCoordinate;
  customRadiusMeters?: number;
}): { ok: true; answer: SeekObjectiveAnswer; label: string; referenceStationId?: string } | { ok: false; error: string } {
  const { pack, snapshot, family, itemId, seekerPoint, hiderAnchor, thermometerStart, customRadiusMeters } = params;
  const tol = pack.investigationBook.tieToleranceMeters;
  const families = pack.investigationBook.families;

  switch (family) {
    case "radar": {
      const cfg = families.radar;
      if (!cfg?.enabled) return { ok: false, error: "question-family-disabled" };
      if (itemId === "custom-radar") {
        if (!cfg.allowCustomRadius || typeof customRadiusMeters !== "number" || !Number.isFinite(customRadiusMeters) || customRadiusMeters <= 0) {
          return { ok: false, error: "invalid-custom-radius" };
        }
        return {
          ok: true,
          label: `Custom radar (${customRadiusMeters} m)`,
          answer: evaluateRadar(seekerPoint, hiderAnchor, customRadiusMeters),
        };
      }
      const item = cfg.items.find((entry) => entry.id === itemId);
      if (!item) return { ok: false, error: "unknown-question-item" };
      return {
        ok: true,
        label: item.label,
        answer: evaluateRadar(seekerPoint, hiderAnchor, item.radiusMeters),
      };
    }
    case "thermometer": {
      const cfg = families.thermometer;
      if (!cfg?.enabled) return { ok: false, error: "question-family-disabled" };
      const item = cfg.items.find((entry) => entry.id === itemId);
      if (!item) return { ok: false, error: "unknown-question-item" };
      if (!thermometerStart) return { ok: false, error: "thermometer-not-started" };
      const traveled = haversineMeters(thermometerStart, seekerPoint);
      if (traveled < item.minTravelMeters) {
        return { ok: false, error: "thermometer-distance-insufficient" };
      }
      return {
        ok: true,
        label: item.label,
        answer: evaluateThermometer(thermometerStart, seekerPoint, hiderAnchor, tol),
      };
    }
    case "matching": {
      const cfg = families.matching;
      if (!cfg?.enabled) return { ok: false, error: "question-family-disabled" };
      const item = cfg.items.find((entry) => entry.id === itemId);
      if (!item) return { ok: false, error: "unknown-question-item" };
      const nearest = findNearestStation(seekerPoint, snapshot.stations);
      if (!nearest) return { ok: false, error: "no-reference-station" };
      return {
        ok: true,
        label: item.label,
        referenceStationId: nearest.station.id,
        answer: evaluateMatching(nearest.station, hiderAnchor, item, snapshot),
      };
    }
    case "measuring": {
      const cfg = families.measuring;
      if (!cfg?.enabled) return { ok: false, error: "question-family-disabled" };
      const item = cfg.items.find((entry) => entry.id === itemId);
      if (!item) return { ok: false, error: "unknown-question-item" };
      return {
        ok: true,
        label: item.label,
        answer: evaluateMeasuring(seekerPoint, hiderAnchor, item, snapshot, tol),
      };
    }
    case "tentacles": {
      const cfg = families.tentacles;
      if (!cfg?.enabled) return { ok: false, error: "question-family-disabled" };
      const item = cfg.items.find((entry) => entry.id === itemId);
      if (!item) return { ok: false, error: "unknown-question-item" };
      return {
        ok: true,
        label: item.label,
        answer: evaluateTentacles(seekerPoint, hiderAnchor, item, snapshot),
      };
    }
  }
}
