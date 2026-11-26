import type {
  ClaimCardDefinition,
  ClaimChallengeItem,
  ClaimChallengePrimitive,
  ClaimLandmarkDefinition,
  ClaimLeafChallengePayload,
  ClaimRulebookPack,
  ClaimRulebookValidationResult,
  GeoCoordinate,
  GeoPoi,
  GeoSnapshot,
  RulebookValidationIssue,
  TransitMode,
} from "@kelana-ria/contracts";
import {
  computeGeoSnapshotHash,
  haversineMeters,
  isValidCoordinate,
  pointInPolygon,
} from "../seek-engine/rulebook-validator.js";

const MINUTE_MS = 60_000;
const MAX_PHOTO_AUTO_APPROVE_MS = 3 * MINUTE_MS;
const MAX_TIMED_MICRO_TASK_MS = 15 * MINUTE_MS;
const MAX_SHIELD_DURATION_MS = 30 * MINUTE_MS;
const MAX_BLOCKING_CURSE_TIMER_MS = 15 * MINUTE_MS;
const MAX_BLOCKING_CURSE_DURATION_RATIO = 0.25;
const MIN_POIS_PER_CATEGORY = 2;
const FALLBACK_TRAVEL_SPEED_MPS = 4.0; // conservative urban transit/walk average
const FALLBACK_BOARDING_BUFFER_MS = 4 * MINUTE_MS;
const DEFAULT_CHALLENGE_MS = 4 * MINUTE_MS;

const VALID_DIFFICULTIES = new Set(["starter", "standard", "expert"]);
const VALID_TRANSIT_MODES = new Set<TransitMode>(["walk", "mrt", "krl", "transjakarta", "lrt", "other"]);
const VALID_TEAM_MODES = new Set(["ffa", "teams"]);
const VALID_FAIL_POLICIES = new Set(["cooldown_ms", "burned_for_player"]);
const VALID_CHALLENGE_MODES = new Set(["per_landmark", "challenge_hand"]);
const VALID_CLAIM_BLOCKERS = new Set(["block_steals", "block_claims", "block_both"]);

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

function legTravelMs(from: GeoCoordinate, to: GeoCoordinate): number {
  const meters = haversineMeters(from, to);
  return Math.round((meters / FALLBACK_TRAVEL_SPEED_MPS) * 1000) + FALLBACK_BOARDING_BUFFER_MS;
}

function countFeasibleSoloOpenings(
  start: GeoCoordinate,
  landmarks: ClaimLandmarkDefinition[],
  durationMs: number,
  targetLandmarks: number,
  targetZones: number,
): number {
  if (landmarks.length <= targetLandmarks || targetLandmarks < 1) return 0;

  let feasibleOpenings = 0;

  for (let firstIdx = 0; firstIdx < landmarks.length; firstIdx++) {
    const first = landmarks[firstIdx];
    const firstTravel = isPositiveFinite(first.estimatedTravelFromStartMs)
      ? first.estimatedTravelFromStartMs
      : legTravelMs(start, first);
    const firstCost = firstTravel + (isPositiveFinite(first.estimatedChallengeMs) ? first.estimatedChallengeMs : DEFAULT_CHALLENGE_MS);
    if (firstCost > durationMs) continue;

    // Greedy shortest-next-stop search prioritizing zone diversity until targets are met
    const visited = new Set<string>([first.id]);
    const zones = new Set<string>([first.zoneId]);
    let current: GeoCoordinate = first;
    let elapsed = firstCost;

    while (visited.size < targetLandmarks || zones.size < targetZones) {
      const needNewZone = zones.size < targetZones;
      let bestCandidate: { landmark: ClaimLandmarkDefinition; cost: number } | null = null;
      for (const candidate of landmarks) {
        if (visited.has(candidate.id)) continue;
        if (visited.size + 1 >= landmarks.length) continue; // must leave >= 1 landmark unvisited
        const travel = legTravelMs(current, candidate);
        const challenge = isPositiveFinite(candidate.estimatedChallengeMs)
          ? candidate.estimatedChallengeMs
          : DEFAULT_CHALLENGE_MS;
        const cost = travel + challenge;
        const prefersCandidate =
          !bestCandidate ||
          (needNewZone && !zones.has(candidate.zoneId) && zones.has(bestCandidate.landmark.zoneId)) ||
          ((!needNewZone || zones.has(candidate.zoneId) === zones.has(bestCandidate.landmark.zoneId)) &&
            cost < bestCandidate.cost);
        if (prefersCandidate) {
          bestCandidate = { landmark: candidate, cost };
        }
      }
      if (!bestCandidate) break;
      if (elapsed + bestCandidate.cost > durationMs) break;
      elapsed += bestCandidate.cost;
      visited.add(bestCandidate.landmark.id);
      zones.add(bestCandidate.landmark.zoneId);
      current = bestCandidate.landmark;
    }

    if (
      visited.size >= targetLandmarks &&
      zones.size >= targetZones &&
      landmarks.length - visited.size >= 1 &&
      elapsed <= durationMs
    ) {
      feasibleOpenings++;
    }
  }

  return feasibleOpenings;
}

export function validateClaimRulebook(
  pack: ClaimRulebookPack,
  snapshot: GeoSnapshot,
): ClaimRulebookValidationResult {
  const errors: RulebookValidationIssue[] = [];
  const warnings: RulebookValidationIssue[] = [];

  const addError = (code: string, path: string, message: string) => {
    errors.push({ code, path, message, severity: "error" });
  };
  const addWarning = (code: string, path: string, message: string) => {
    warnings.push({ code, path, message, severity: "warning" });
  };

  if (!pack || typeof pack !== "object" || !snapshot || typeof snapshot !== "object") {
    addError("invalid-pack", "", "ClaimRulebookPack and GeoSnapshot must be objects.");
    return {
      ok: false,
      errors,
      warnings,
      summary: { zoneCount: 0, landmarkCount: 0, totalDeckCards: 0, feasibleSoloOpenings: 0 },
    };
  }

  // --- Gate 1: Meta, Session, Claiming & Snapshot Integrity ---
  const meta = pack.meta;
  if (!meta || typeof meta !== "object") {
    addError("invalid-meta", "meta", "Pack meta section is required.");
  } else {
    if (meta.schemaVersion !== "claim-city-rulebook-v1") {
      addError("unsupported-schema-version", "meta.schemaVersion", "Expected schemaVersion claim-city-rulebook-v1.");
    }
    if (meta.format !== "claim-the-city") {
      addError("invalid-format", "meta.format", "Expected format claim-the-city.");
    }
    if (!isNonEmptyString(meta.packId, 3)) addError("invalid-meta", "meta.packId", "packId must be >= 3 chars.");
    if (!isPositiveInt(meta.version)) addError("invalid-meta", "meta.version", "version must be positive integer.");
    if (!isNonEmptyString(meta.title, 3)) addError("invalid-meta", "meta.title", "title must be >= 3 chars.");
    if (!isNonEmptyString(meta.byline, 2)) addError("invalid-meta", "meta.byline", "byline must be >= 2 chars.");
    if (!isNonEmptyString(meta.cityLabel, 2)) addError("invalid-meta", "meta.cityLabel", "cityLabel must be >= 2 chars.");
    if (!VALID_DIFFICULTIES.has(meta.difficulty)) addError("invalid-meta", "meta.difficulty", "Invalid difficulty.");
    if (!isNonNegativeInt(meta.priceIdr)) {
      addError("invalid-price", "meta.priceIdr", "priceIdr must be a non-negative integer.");
    } else if (meta.isOfficial && meta.priceIdr !== 0) {
      addError("official-pack-must-be-free", "meta.priceIdr", "Official packs must have priceIdr = 0.");
    }
  }

  const session = pack.session;
  const durationMs = session && isPositiveFinite(session.durationMs) ? session.durationMs : 0;
  if (!session || typeof session !== "object") {
    addError("invalid-session", "session", "Session rules are required.");
  } else {
    if (!isPositiveInt(session.minPlayers) || session.minPlayers < 1 || session.minPlayers > 12) {
      addError("invalid-player-range", "session.minPlayers", "minPlayers must be between 1 and 12.");
    }
    if (!isPositiveInt(session.maxPlayers) || session.maxPlayers < 1 || session.maxPlayers > 12) {
      addError("invalid-player-range", "session.maxPlayers", "maxPlayers must be between 1 and 12.");
    }
    if (
      isPositiveInt(session.minPlayers) &&
      isPositiveInt(session.maxPlayers) &&
      session.minPlayers > session.maxPlayers
    ) {
      addError("invalid-player-range", "session.minPlayers", "minPlayers cannot exceed maxPlayers.");
    }
    if (!VALID_TEAM_MODES.has(session.teamMode)) {
      addError("invalid-session", "session.teamMode", "teamMode must be ffa or teams.");
    }
    if (!isPositiveFinite(session.durationMs)) {
      addError("invalid-duration", "session.durationMs", "durationMs must be positive.");
    }
    if (session.minPlayers === 1) {
      if (
        !session.soloTargets ||
        !isPositiveInt(session.soloTargets.lockedLandmarks) ||
        !isPositiveInt(session.soloTargets.distinctZones) ||
        session.soloTargets.distinctZones < 2
      ) {
        addError(
          "invalid-solo-targets",
          "session.soloTargets",
          "Solo-capable packs require soloTargets with lockedLandmarks >= 1 and distinctZones >= 2.",
        );
      }
    }
    if (session.opponentTracking !== undefined) {
      const tracking = session.opponentTracking;
      const validModes = new Set(["off", "last_checkin", "periodic_gps"]);
      if (!tracking || typeof tracking !== "object" || !validModes.has(tracking.mode)) {
        addError(
          "invalid-opponent-tracking",
          "session.opponentTracking.mode",
          "opponentTracking.mode must be off, last_checkin, or periodic_gps.",
        );
      } else if (
        tracking.intervalMs !== undefined &&
        (!isPositiveInt(tracking.intervalMs) || tracking.intervalMs < 3_000 || tracking.intervalMs > 300_000)
      ) {
        addError(
          "invalid-opponent-tracking",
          "session.opponentTracking.intervalMs",
          "opponentTracking.intervalMs must be an integer between 3000 and 300000.",
        );
      }
    }
  }

  const claiming = pack.claiming;
  if (!claiming || typeof claiming !== "object") {
    addError("invalid-claiming-rules", "claiming", "Claiming ownership rules are required.");
  } else {
    if (!isPositiveFinite(claiming.claimWeight)) addError("invalid-claiming-rules", "claiming.claimWeight", "claimWeight must be positive.");
    if (!isPositiveFinite(claiming.lockWeight)) addError("invalid-claiming-rules", "claiming.lockWeight", "lockWeight must be positive.");
    if (!VALID_FAIL_POLICIES.has(claiming.multiplayerFailPolicy)) {
      addError("invalid-claiming-rules", "claiming.multiplayerFailPolicy", "Invalid multiplayerFailPolicy.");
    }
    if (!VALID_FAIL_POLICIES.has(claiming.soloFailPolicy)) {
      addError("invalid-claiming-rules", "claiming.soloFailPolicy", "Invalid soloFailPolicy.");
    }
    if (
      (claiming.multiplayerFailPolicy === "cooldown_ms" || claiming.soloFailPolicy === "cooldown_ms") &&
      !isPositiveFinite(claiming.failCooldownMs)
    ) {
      addError("invalid-claiming-rules", "claiming.failCooldownMs", "failCooldownMs must be positive when cooldown_ms is enabled.");
    }
  }

  // Snapshot verification
  const computedHash = computeGeoSnapshotHash(snapshot);
  if (snapshot.hash !== computedHash) {
    addError("snapshot-hash-invalid", "snapshot.hash", "snapshot.hash does not match canonical SHA-256 hash.");
  }
  const boundary = Array.isArray(snapshot.boundaryPolygon) ? snapshot.boundaryPolygon : [];
  const boundaryValid = boundary.length >= 3 && boundary.every(isValidCoordinate);
  if (!boundaryValid) {
    addError("invalid-boundary", "snapshot.boundaryPolygon", "boundaryPolygon must have >= 3 valid coordinates.");
  }
  if (!snapshot.startPoint || !isValidCoordinate(snapshot.startPoint) || !isNonEmptyString(snapshot.startPoint.accessNotes, 4)) {
    addError("invalid-start-point", "snapshot.startPoint", "Valid startPoint with accessNotes is required.");
  } else if (boundaryValid && !pointInPolygon(snapshot.startPoint, boundary)) {
    addError("start-outside-boundary", "snapshot.startPoint", "startPoint must lie inside boundaryPolygon.");
  }
  if (!Array.isArray(snapshot.attributions) || snapshot.attributions.length === 0) {
    addError("missing-attributions", "snapshot.attributions", "At least one geo attribution is required.");
  }

  const poisByCategory = new Map<string, GeoPoi[]>();
  for (const poi of Array.isArray(snapshot.pois) ? snapshot.pois : []) {
    if (poi && isNonEmptyString(poi.category) && isValidCoordinate(poi)) {
      const list = poisByCategory.get(poi.category) ?? [];
      list.push(poi);
      poisByCategory.set(poi.category, list);
    }
  }

  // --- Gate 2: Geography, Zones & Landmarks ---
  const geography = pack.geography;
  const zoneIds = new Set<string>();
  const landmarksByZone = new Map<string, ClaimLandmarkDefinition[]>();
  const validLandmarks: ClaimLandmarkDefinition[] = [];
  const landmarkIds = new Set<string>();

  if (!geography || typeof geography !== "object") {
    addError("invalid-geography", "geography", "Geography rules are required.");
  } else {
    if (!isPositiveFinite(geography.checkInRadiusMeters) || geography.checkInRadiusMeters < 10 || geography.checkInRadiusMeters > 500) {
      addError("invalid-geography", "geography.checkInRadiusMeters", "checkInRadiusMeters must be in [10, 500].");
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
      !geography.allowedTransitModes.every((m) => VALID_TRANSIT_MODES.has(m))
    ) {
      addError("invalid-geography", "geography.allowedTransitModes", "At least one valid transit mode is required.");
    }
    if (geography.geoSnapshotId !== snapshot.id) {
      addError("snapshot-id-mismatch", "geography.geoSnapshotId", "geoSnapshotId does not match snapshot.id.");
    }
    if (geography.geoSnapshotHash !== snapshot.hash) {
      addError("snapshot-hash-mismatch", "geography.geoSnapshotHash", "geoSnapshotHash does not match snapshot.hash.");
    }

    const zones = Array.isArray(geography.zones) ? geography.zones : [];
    if (zones.length < 2) {
      addError("insufficient-zones", "geography.zones", "At least 2 play zones are required.");
    }
    zones.forEach((zone, idx) => {
      if (!zone || !isNonEmptyString(zone.id) || !isNonEmptyString(zone.name) || !isNonEmptyString(zone.label)) {
        addError("invalid-zone", `geography.zones[${idx}]`, "Zone requires non-empty id, name, and label.");
        return;
      }
      if (zoneIds.has(zone.id)) {
        addError("duplicate-zone-id", `geography.zones[${idx}].id`, `Duplicate zone id "${zone.id}".`);
        return;
      }
      zoneIds.add(zone.id);
      landmarksByZone.set(zone.id, []);
    });

    const landmarks = Array.isArray(geography.landmarks) ? geography.landmarks : [];
    landmarks.forEach((landmark, idx) => {
      const path = `geography.landmarks[${idx}]`;
      if (!landmark || !isNonEmptyString(landmark.id) || !isNonEmptyString(landmark.name)) {
        addError("invalid-landmark", path, "Landmark requires non-empty id and name.");
        return;
      }
      const landmarkId = landmark.id;
      if (landmarkIds.has(landmarkId)) {
        addError("duplicate-landmark-id", `${path}.id`, `Duplicate landmark id "${landmarkId}".`);
        return;
      }
      landmarkIds.add(landmarkId);
      if (!isValidCoordinate(landmark)) {
        addError("invalid-landmark-coordinate", path, `Landmark ${landmarkId} has invalid coordinates.`);
        return;
      }
      if (boundaryValid && !pointInPolygon(landmark, boundary)) {
        addError("landmark-outside-boundary", path, `Landmark ${landmarkId} lies outside boundaryPolygon.`);
      }
      if (!zoneIds.has(landmark.zoneId)) {
        addError("unknown-landmark-zone", `${path}.zoneId`, `Landmark ${landmarkId} references unknown zone "${String(landmark.zoneId)}".`);
      } else {
        landmarksByZone.get(landmark.zoneId)!.push(landmark);
      }
      if (!isNonEmptyString(landmark.accessNotes, 4)) {
        addError("landmark-missing-access-notes", `${path}.accessNotes`, `Landmark ${landmarkId} requires accessNotes.`);
      }
      if (!isNonEmptyString(landmark.publicHours, 2)) {
        addError("landmark-missing-public-hours", `${path}.publicHours`, `Landmark ${landmarkId} requires publicHours.`);
      }
      validLandmarks.push(landmark);
    });

    let contestedZones = 0;
    for (const [zoneId, list] of landmarksByZone.entries()) {
      if (list.length === 0) {
        addError("empty-zone", "geography.zones", `Play zone "${zoneId}" has no assigned landmarks.`);
      } else if (list.length >= 2) {
        contestedZones++;
      } else {
        addWarning("single-landmark-zone", "geography.zones", `Play zone "${zoneId}" has only 1 landmark.`);
      }
    }
    if (zoneIds.size >= 2 && contestedZones < 2) {
      addError("insufficient-contested-zones", "geography.zones", "At least 2 zones must have >= 2 landmarks so leads can be contested.");
    }
  }

  // --- Gate 3: Challenge Primitives & Anti-Grief ---
  const validateLeafPayload = (payload: ClaimLeafChallengePayload, path: string) => {
    if (!payload || typeof payload !== "object") {
      addError("invalid-challenge-payload", path, "Challenge payload must be an object.");
      return;
    }
    switch (payload.primitive) {
      case "observation_mcq": {
        if (!isNonEmptyString(payload.prompt, 6)) {
          addError("invalid-challenge-payload", `${path}.prompt`, "MCQ prompt must be >= 6 chars.");
        }
        if (!Array.isArray(payload.choices) || payload.choices.length < 2) {
          addError("invalid-challenge-payload", `${path}.choices`, "MCQ requires at least 2 choices.");
        } else {
          const choiceIds = new Set<string>();
          payload.choices.forEach((choice, idx) => {
            if (!choice || !isNonEmptyString(choice.id) || !isNonEmptyString(choice.label)) {
              addError("invalid-challenge-payload", `${path}.choices[${idx}]`, "Choice requires non-empty id and label.");
            } else if (choiceIds.has(choice.id)) {
              addError("invalid-challenge-payload", `${path}.choices[${idx}].id`, `Duplicate choice id "${choice.id}".`);
            } else {
              choiceIds.add(choice.id);
            }
          });
          if (!isNonEmptyString(payload.correctChoiceId) || !choiceIds.has(payload.correctChoiceId)) {
            addError("invalid-answer-key", `${path}.correctChoiceId`, "MCQ correctChoiceId must match an existing choice.");
          }
        }
        break;
      }
      case "observation_input": {
        if (!isNonEmptyString(payload.prompt, 6)) {
          addError("invalid-challenge-payload", `${path}.prompt`, "observation_input prompt must be >= 6 chars.");
        }
        if (payload.inputMode === "text") {
          if (!Array.isArray(payload.acceptedAnswers) || payload.acceptedAnswers.length === 0 || !payload.acceptedAnswers.every((a) => isNonEmptyString(a))) {
            addError("invalid-answer-key", `${path}.acceptedAnswers`, "Text observation_input requires at least one non-empty accepted answer.");
          }
        } else if (payload.inputMode === "number") {
          const hasRange =
            payload.numericRange &&
            typeof payload.numericRange.min === "number" &&
            typeof payload.numericRange.max === "number" &&
            Number.isFinite(payload.numericRange.min) &&
            Number.isFinite(payload.numericRange.max) &&
            payload.numericRange.min <= payload.numericRange.max;
          const hasAnswers = Array.isArray(payload.acceptedAnswers) && payload.acceptedAnswers.length > 0;
          if (!hasRange && !hasAnswers) {
            addError("invalid-answer-key", path, "Numeric observation_input requires numericRange or acceptedAnswers.");
          }
        } else {
          addError("invalid-challenge-payload", `${path}.inputMode`, "inputMode must be text or number.");
        }
        break;
      }
      case "photo_proof": {
        if (!isNonEmptyString(payload.prompt, 6)) {
          addError("invalid-challenge-payload", `${path}.prompt`, "photo_proof prompt must be >= 6 chars.");
        }
        if (payload.verificationMode !== "rival_or_timeout" && payload.verificationMode !== "honor_submit") {
          addError("invalid-challenge-payload", `${path}.verificationMode`, "Invalid photo_proof verificationMode.");
        }
        if (!isPositiveFinite(payload.autoApproveMs) || payload.autoApproveMs > MAX_PHOTO_AUTO_APPROVE_MS) {
          addError(
            "unbounded-photo-auto-approve",
            `${path}.autoApproveMs`,
            `photo_proof autoApproveMs must be in (0, ${MAX_PHOTO_AUTO_APPROVE_MS}] ms.`,
          );
        }
        break;
      }
      case "timed_micro_task": {
        if (!isNonEmptyString(payload.prompt, 6)) {
          addError("invalid-challenge-payload", `${path}.prompt`, "timed_micro_task prompt must be >= 6 chars.");
        }
        if (!isPositiveFinite(payload.timeLimitMs) || payload.timeLimitMs > MAX_TIMED_MICRO_TASK_MS) {
          addError("invalid-timed-task", `${path}.timeLimitMs`, `timeLimitMs must be in (0, ${MAX_TIMED_MICRO_TASK_MS}] ms.`);
        }
        if (payload.taskType === "sub_point_gps") {
          if (!payload.subPoint || !isValidCoordinate(payload.subPoint) || !isPositiveFinite(payload.subPoint.radiusMeters)) {
            addError("invalid-timed-task", `${path}.subPoint`, "sub_point_gps requires valid subPoint coordinates and radiusMeters.");
          } else if (boundaryValid && !pointInPolygon(payload.subPoint, boundary)) {
            addError("subpoint-outside-boundary", `${path}.subPoint`, "timed_micro_task subPoint must lie inside boundaryPolygon.");
          }
        } else if (payload.taskType === "photo_proof") {
          if (!isPositiveFinite(payload.autoApproveMs) || payload.autoApproveMs > MAX_PHOTO_AUTO_APPROVE_MS) {
            addError("unbounded-photo-auto-approve", `${path}.autoApproveMs`, `Timed photo_proof autoApproveMs must be in (0, ${MAX_PHOTO_AUTO_APPROVE_MS}] ms.`);
          }
        } else if (payload.taskType === "observation_input") {
          const hasAnswers = Array.isArray(payload.acceptedAnswers) && payload.acceptedAnswers.length > 0;
          const hasRange = Boolean(payload.numericRange && payload.numericRange.min <= payload.numericRange.max);
          if (!hasAnswers && !hasRange) {
            addError("invalid-answer-key", path, "Timed observation_input requires acceptedAnswers or numericRange.");
          }
        } else {
          addError("invalid-timed-task", `${path}.taskType`, "Invalid timed_micro_task taskType.");
        }
        break;
      }
      default:
        addError("unsupported-challenge-primitive", `${path}.primitive`, `Unsupported leaf challenge primitive "${String((payload as { primitive?: unknown }).primitive)}".`);
    }
  };

  const validateChallengePayload = (payload: ClaimChallengePrimitive, path: string) => {
    if (!payload || typeof payload !== "object") {
      addError("invalid-challenge-payload", path, "Challenge payload is required.");
      return;
    }
    if (payload.primitive === "call_your_shot") {
      if (!isNonEmptyString(payload.theme, 3)) {
        addError("invalid-challenge-payload", `${path}.theme`, "call_your_shot requires a theme.");
      }
      validateLeafPayload(payload.standardTask, `${path}.standardTask`);
      validateLeafPayload(payload.boldTask, `${path}.boldTask`);
      if (!payload.boldReward || (!payload.boldReward.drawTacticalCard && !isPositiveFinite(payload.boldReward.bonusWeight))) {
        addError("invalid-challenge-payload", `${path}.boldReward`, "call_your_shot boldReward must grant a tactical card or bonus weight.");
      }
      return;
    }
    if (payload.primitive === "multi_step") {
      if (!Array.isArray(payload.steps) || payload.steps.length !== 2) {
        addError("invalid-challenge-payload", `${path}.steps`, "multi_step must contain exactly 2 leaf steps.");
        return;
      }
      validateLeafPayload(payload.steps[0], `${path}.steps[0]`);
      validateLeafPayload(payload.steps[1], `${path}.steps[1]`);
      return;
    }
    validateLeafPayload(payload, path);
  };

  const validateChallengeItem = (item: ClaimChallengeItem, path: string, seenIds: Set<string>) => {
    if (!item || typeof item !== "object") {
      addError("invalid-challenge", path, "Challenge item must be an object.");
      return;
    }
    if (!isNonEmptyString(item.id)) {
      addError("invalid-challenge", `${path}.id`, "Challenge id is required.");
    } else if (seenIds.has(item.id)) {
      addError("duplicate-challenge-id", `${path}.id`, `Duplicate challenge id "${item.id}".`);
    } else {
      seenIds.add(item.id);
    }
    if (!isNonEmptyString(item.title, 2)) addError("invalid-challenge", `${path}.title`, "Challenge title is required.");
    if (!isNonEmptyString(item.verificationNotes, 6)) {
      addError("verification-notes-required", `${path}.verificationNotes`, "Challenge requires on-site verificationNotes.");
    }
    if (item.reviewed !== true || !isNonEmptyString(item.reviewedAt, 4)) {
      addError("unreviewed-challenge", path, "Published challenges must be marked reviewed with reviewedAt.");
    }
    for (const field of ["hint", "learningExplanation"] as const) {
      if (item[field] !== undefined && !isNonEmptyString(item[field])) {
        addError("invalid-challenge-copy", `${path}.${field}`, "Optional challenge copy must be non-empty text.");
      }
    }
    if (item.estimatedSeconds !== undefined && !isPositiveInt(item.estimatedSeconds)) {
      addError("invalid-challenge-estimate", `${path}.estimatedSeconds`, "The estimated time must be a positive number of seconds.");
    }
    validateChallengePayload(item.payload, `${path}.payload`);
  };

  const challenges = pack.challenges;
  const seenChallengeIds = new Set<string>();
  let backupCount = 0;

  if (!challenges || typeof challenges !== "object") {
    addError("invalid-challenges", "challenges", "Challenges configuration is required.");
  } else {
    if (!VALID_CHALLENGE_MODES.has(challenges.challengeMode)) {
      addError("invalid-challenges", "challenges.challengeMode", "challengeMode must be per_landmark or challenge_hand.");
    }
    const backupPool = Array.isArray(challenges.backupPool) ? challenges.backupPool : [];
    backupCount = backupPool.length;
    backupPool.forEach((item, idx) => validateChallengeItem(item, `challenges.backupPool[${idx}]`, seenChallengeIds));

    if (challenges.challengeMode === "per_landmark") {
      const map = challenges.landmarkChallenges ?? {};
      for (const assignedLandmarkId of Object.keys(map)) {
        if (!landmarkIds.has(assignedLandmarkId)) {
          addError("unknown-challenge-landmark", `challenges.landmarkChallenges.${assignedLandmarkId}`, `Challenge assigned to unknown landmark "${assignedLandmarkId}".`);
        }
      }
      for (const landmark of validLandmarks) {
        const list = map[landmark.id];
        if (!Array.isArray(list) || list.length === 0) {
          addError("missing-landmark-challenge", `challenges.landmarkChallenges.${landmark.id}`, `Landmark "${landmark.id}" requires at least 1 reviewed challenge.`);
        } else {
          list.forEach((item, idx) =>
            validateChallengeItem(item, `challenges.landmarkChallenges.${landmark.id}[${idx}]`, seenChallengeIds),
          );
        }
      }
    } else if (challenges.challengeMode === "challenge_hand") {
      const handSize = challenges.challengeHandSize;
      if (!isPositiveInt(handSize) || handSize < 3 || handSize > 5) {
        addError("invalid-challenge-hand-size", "challenges.challengeHandSize", "challengeHandSize must be in 3..5.");
      }
      const pool = Array.isArray(challenges.challengeHandPool) ? challenges.challengeHandPool : [];
      if (isPositiveInt(handSize) && pool.length < handSize * 2) {
        addError("insufficient-challenge-hand-pool", "challenges.challengeHandPool", `challengeHandPool requires at least ${handSize * 2} reviewed challenges.`);
      }
      pool.forEach((item, idx) => validateChallengeItem(item, `challenges.challengeHandPool[${idx}]`, seenChallengeIds));
    }
  }

  // --- Gate 4: Tactical Deck Guardrails ---
  const deck = pack.tacticalDeck;
  let totalDeckCards = 0;
  let usesSwapChallenge = false;

  if (!deck || typeof deck !== "object") {
    addError("invalid-deck", "tacticalDeck", "tacticalDeck config is required.");
  } else if (deck.enabled) {
    if (!isPositiveInt(deck.maxHandSize) || deck.maxHandSize < 1 || deck.maxHandSize > 4) {
      addError("invalid-hand-limit", "tacticalDeck.maxHandSize", "tacticalDeck.maxHandSize must be in 1..4.");
    }
    if (!isPositiveInt(deck.maxActiveCursesPerTarget) || deck.maxActiveCursesPerTarget > 1) {
      addError("invalid-curse-cap", "tacticalDeck.maxActiveCursesPerTarget", "maxActiveCursesPerTarget must be 1 to prevent stunlock.");
    }
    const cards = Array.isArray(deck.cards) ? deck.cards : [];
    if (cards.length === 0) {
      addError("empty-deck", "tacticalDeck.cards", "Enabled tacticalDeck must contain at least one card.");
    }
    const seenCardIds = new Set<string>();
    const maxBlockingTimer =
      durationMs > 0
        ? Math.min(MAX_BLOCKING_CURSE_TIMER_MS, Math.floor(durationMs * MAX_BLOCKING_CURSE_DURATION_RATIO))
        : MAX_BLOCKING_CURSE_TIMER_MS;

    cards.forEach((card: ClaimCardDefinition, idx: number) => {
      const path = `tacticalDeck.cards[${idx}]`;
      if (!card || !isNonEmptyString(card.id) || !isNonEmptyString(card.title, 2) || !isNonEmptyString(card.description, 4)) {
        addError("invalid-card", path, "Card requires non-empty id, title, and description.");
        return;
      }
      if (seenCardIds.has(card.id)) addError("duplicate-card-id", `${path}.id`, `Duplicate card id "${card.id}".`);
      seenCardIds.add(card.id);
      if (!isPositiveInt(card.copies)) {
        addError("invalid-card-copies", `${path}.copies`, "copies must be a positive integer.");
      } else {
        totalDeckCards += card.copies;
      }
      const effect = card.effect;
      if (!effect || typeof effect !== "object") {
        addError("invalid-card-effect", `${path}.effect`, "Card effect is required.");
        return;
      }
      switch (effect.primitive) {
        case "scout_challenge":
        case "double_weight":
        case "instant_lock":
          break;
        case "swap_challenge":
          usesSwapChallenge = true;
          break;
        case "shield_claim":
          if (!isPositiveFinite(effect.durationMs) || effect.durationMs > MAX_SHIELD_DURATION_MS) {
            addError("invalid-shield-duration", `${path}.effect.durationMs`, `shield_claim durationMs must be in (0, ${MAX_SHIELD_DURATION_MS}] ms.`);
          }
          break;
        case "sabotage_curse": {
          if (!VALID_CLAIM_BLOCKERS.has(effect.blockerType)) {
            addError("invalid-curse-blocker", `${path}.effect.blockerType`, `Invalid Claim sabotage blocker "${String(effect.blockerType)}".`);
          }
          const clear = effect.clearCondition;
          const clearPath = `${path}.effect.clearCondition`;
          if (!clear || typeof clear !== "object") {
            addError("invalid-curse-clear", clearPath, "sabotage_curse requires clearCondition.");
          } else if (clear.type === "timer") {
            if (!isPositiveFinite(clear.durationMs) || clear.durationMs > maxBlockingTimer) {
              addError("blocking-curse-duration-exceeded", `${clearPath}.durationMs`, `Sabotage timer exceeds cap (${maxBlockingTimer} ms).`);
            }
          } else if (clear.type === "gps_detour") {
            const count = poisByCategory.get(clear.poiCategory)?.length ?? 0;
            if (count < MIN_POIS_PER_CATEGORY) {
              addError("insufficient-pois-for-category", `${clearPath}.poiCategory`, `Sabotage gps_detour category "${clear.poiCategory}" requires >= ${MIN_POIS_PER_CATEGORY} POIs.`);
            }
            if (!isPositiveFinite(clear.radiusMeters) || clear.radiusMeters > 500) {
              addError("invalid-curse-clear", `${clearPath}.radiusMeters`, "gps_detour radiusMeters must be in (0, 500].");
            }
          } else if (clear.type === "photo_challenge") {
            if (!isNonEmptyString(clear.prompt, 4)) addError("invalid-curse-clear", `${clearPath}.prompt`, "photo_challenge requires prompt.");
            if (!isPositiveFinite(clear.autoApproveMs) || clear.autoApproveMs > MAX_PHOTO_AUTO_APPROVE_MS) {
              addError("unbounded-photo-auto-approve", `${clearPath}.autoApproveMs`, `Sabotage photo_challenge autoApproveMs must be in (0, ${MAX_PHOTO_AUTO_APPROVE_MS}] ms.`);
            }
          } else if (clear.type === "honor_task") {
            if (!isNonEmptyString(clear.instruction, 6)) addError("invalid-curse-clear", `${clearPath}.instruction`, "honor_task requires instruction.");
          } else {
            addError("invalid-curse-clear", clearPath, `Unsupported sabotage clearCondition "${String((clear as { type?: unknown }).type)}".`);
          }
          break;
        }
        default:
          addError("unsupported-card-primitive", `${path}.effect.primitive`, `Unsupported Claim card primitive "${String((effect as { primitive?: unknown }).primitive)}".`);
      }
    });

    if (usesSwapChallenge && backupCount < 2) {
      addError("insufficient-backup-pool", "challenges.backupPool", "Packs with swap_challenge require at least 2 challenges in challenges.backupPool.");
    }
  }

  // --- Gate 5: Solo Feasibility ---
  let feasibleSoloOpenings = 0;
  if (
    session?.minPlayers === 1 &&
    session.soloTargets &&
    durationMs > 0 &&
    snapshot.startPoint &&
    isValidCoordinate(snapshot.startPoint) &&
    validLandmarks.length > 0
  ) {
    feasibleSoloOpenings = countFeasibleSoloOpenings(
      snapshot.startPoint,
      validLandmarks,
      durationMs,
      session.soloTargets.lockedLandmarks,
      session.soloTargets.distinctZones,
    );
    if (feasibleSoloOpenings < 2) {
      addError(
        "infeasible-solo-routes",
        "session.soloTargets",
        `Solo targets require at least 2 distinct feasible opening routes leaving >= 1 landmark unvisited within durationMs (found ${feasibleSoloOpenings}).`,
      );
    }
  }

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    summary: {
      zoneCount: zoneIds.size,
      landmarkCount: validLandmarks.length,
      totalDeckCards,
      feasibleSoloOpenings,
    },
  };
}
