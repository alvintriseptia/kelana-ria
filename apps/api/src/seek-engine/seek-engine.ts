import { randomInt, randomUUID } from "node:crypto";
import type {
  GeoCoordinate,
  GeoSnapshot,
  GeoStation,
  HideSeekPlayPhase,
  HideSeekQuestionFamily,
  HideSeekRulebookPack,
  SeekDrawBatch,
  SeekEngineAction,
  SeekEngineActionReply,
  SeekEngineMenuEntry,
  SeekEngineOutcome,
  SeekEnginePhase,
  SeekEngineQuestion,
  SeekEngineRoomView,
  SeekEngineSeat,
  SeekEngineTurnResult,
} from "@kelana-ria/contracts";
import {
  evaluateObjectiveQuestion,
  findNearestStation,
  isInsideHidingZone,
  verifyGpsAtPoint,
  verifyGpsFreshAndAccurate,
} from "./geo-evaluator.js";
import { validateHideSeekRulebook } from "./rulebook-validator.js";

type InternalSeat = SeekEngineSeat & {
  credentialHash: string;
};

export type SeekEngineMatch = {
  code: string;
  pack: HideSeekRulebookPack;
  snapshot: GeoSnapshot;
  phase: SeekEnginePhase;
  turnNumber: number;
  turnOrder: string[];
  seats: InternalSeat[];
  startedAt: number | null;
  releaseAt: number | null;
  phaseEndsAt: number | null;
  // Private current-turn state (reset on every turn swap)
  anchorStationId: string | null;
  hiderLastPosition: GeoCoordinate | null;
  hiderOutOfZone: boolean;
  foundCode: string | null;
  endgameTriggeredAt: number | null;
  endgameFreezeAt: number | null;
  hiderFrozen: boolean;
  moveZoneUntil: number | null;
  revealedOldAnchorStationId: string | null;
  thermometerStart: GeoCoordinate | null;
  questionUseCounts: Record<string, number>;
  questions: SeekEngineQuestion[];
  pendingDrawBatches: SeekDrawBatch[];
  // Score adjustments populated by deck/curse engine (#37)
  currentTurnBonusMs: number;
  currentTurnTrapBonusMs: number;
  currentTurnPenaltyMs: number;
  // External curse hooks populated by deck/curse engine (#37)
  questionBlockedUntil: number | null;
  bannedFamilies: Partial<Record<HideSeekQuestionFamily, number>>;
  extraDrawPerQuestion: number;
  // Regroup target between turns
  regroupPoint: { id: string; name: string; latitude: number; longitude: number } | null;
  // Completed turn results and terminal outcome
  turns: SeekEngineTurnResult[];
  outcome: SeekEngineOutcome | null;
  // Idempotent action cache per seat
  appliedActions: Map<string, Omit<SeekEngineActionReply, "room">>;
  generateFoundCode: () => string;
};

function defaultFoundCode(): string {
  return String(randomInt(0, 10_000)).padStart(4, "0");
}

function questionKey(family: HideSeekQuestionFamily, itemId: string): string {
  return `${family}:${itemId}`;
}

function totalPlannedTurns(match: SeekEngineMatch): number {
  if (match.pack.session.turnMode === "fixed_turns" && match.pack.session.fixedTurnCount) {
    return Math.min(match.pack.session.fixedTurnCount, Math.max(match.turnOrder.length, 1));
  }
  return Math.max(match.turnOrder.length, match.seats.length);
}

export function activeHiderSeatId(match: SeekEngineMatch): string | null {
  if (match.turnNumber < 1 || match.turnNumber > match.turnOrder.length) return null;
  return match.turnOrder[match.turnNumber - 1] ?? null;
}

function findSeat(match: SeekEngineMatch, seatId: string): InternalSeat | undefined {
  return match.seats.find((s) => s.seatId === seatId);
}

export function findSeekEngineSeat(match: SeekEngineMatch, credentialHash: string): string | undefined {
  return match.seats.find((s) => s.credentialHash === credentialHash)?.seatId;
}

function findAnchorStation(match: SeekEngineMatch, stationId: string | null): GeoStation | undefined {
  if (!stationId) return undefined;
  return match.snapshot.stations.find((s) => s.id === stationId);
}

function startVerified(seat: InternalSeat, now: number, requireStartCheckIn: boolean): boolean {
  if (!requireStartCheckIn) return true;
  return seat.startVerifiedUntil !== null && seat.startVerifiedUntil >= now;
}

function clearTurnState(match: SeekEngineMatch) {
  match.anchorStationId = null;
  match.hiderLastPosition = null;
  match.hiderOutOfZone = false;
  match.foundCode = null;
  match.endgameTriggeredAt = null;
  match.endgameFreezeAt = null;
  match.hiderFrozen = false;
  match.moveZoneUntil = null;
  match.revealedOldAnchorStationId = null;
  match.thermometerStart = null;
  match.questionUseCounts = {};
  match.questions = [];
  match.pendingDrawBatches = [];
  match.currentTurnBonusMs = 0;
  match.currentTurnTrapBonusMs = 0;
  match.currentTurnPenaltyMs = 0;
  match.questionBlockedUntil = null;
  match.bannedFamilies = {};
  match.extraDrawPerQuestion = 0;
  for (const seat of match.seats) {
    seat.regrouped = false;
    seat.confirmedFound = false;
  }
}

function beginTurn(match: SeekEngineMatch, at: number) {
  clearTurnState(match);
  match.phase = "head_start";
  match.releaseAt = at + match.pack.timers.headStartMs;
  match.phaseEndsAt = match.releaseAt;
}

function purgeAllPhotos(match: SeekEngineMatch): string[] {
  const purged: string[] = [];
  for (const question of match.questions) {
    if (question.photoId) {
      purged.push(question.photoId);
      delete question.photoId;
    }
  }
  for (const turn of match.turns) {
    for (const question of turn.clues) {
      if (question.photoId) {
        purged.push(question.photoId);
        delete question.photoId;
      }
    }
  }
  return purged;
}

function closeMatch(
  match: SeekEngineMatch,
  phase: Extract<SeekEnginePhase, "finished" | "void" | "incomplete" | "canceled">,
  reason: SeekEngineOutcome["reason"],
  at: number,
  winnerSeatId: string | null = null,
): string[] {
  match.phase = phase;
  match.phaseEndsAt = null;
  match.outcome = { winnerSeatId, reason, at };
  match.foundCode = null;
  match.moveZoneUntil = null;
  for (const question of match.questions) {
    if (question.status === "pending") {
      question.status = "closed";
      delete question.privateComputedAnswer;
    }
  }
  return purgeAllPhotos(match);
}

function pickMatchWinner(turns: SeekEngineTurnResult[]): string | null {
  if (turns.length === 0) return null;
  // Aggregate per hider in case fixed_turns has multiple entries, or single turn per hider
  const scores = new Map<string, { adjustedMs: number; rawHidingMs: number }>();
  for (const turn of turns) {
    const prev = scores.get(turn.hiderSeatId) ?? { adjustedMs: 0, rawHidingMs: 0 };
    scores.set(turn.hiderSeatId, {
      adjustedMs: prev.adjustedMs + turn.adjustedMs,
      rawHidingMs: prev.rawHidingMs + turn.rawHidingMs,
    });
  }
  const ranked = [...scores.entries()].sort(([, a], [, b]) => {
    if (b.adjustedMs !== a.adjustedMs) return b.adjustedMs - a.adjustedMs;
    return b.rawHidingMs - a.rawHidingMs;
  });
  if (ranked.length >= 2) {
    const [, first] = ranked[0];
    const [, second] = ranked[1];
    if (first.adjustedMs === second.adjustedMs && first.rawHidingMs === second.rawHidingMs) {
      return null;
    }
  }
  return ranked[0][0];
}

function resolveRegroupPoint(
  match: SeekEngineMatch,
  completedAnchorStationId: string | null,
): { id: string; name: string; latitude: number; longitude: number } | null {
  const policy = match.pack.session.regroupPolicy;
  if (policy === "anywhere_ready") return null;
  if (policy === "previous_hiding_station" && completedAnchorStationId) {
    const anchor = findAnchorStation(match, completedAnchorStationId);
    if (anchor) {
      return { id: anchor.id, name: anchor.name, latitude: anchor.latitude, longitude: anchor.longitude };
    }
  }
  const start = match.snapshot.startPoint;
  return { id: start.id, name: start.name, latitude: start.latitude, longitude: start.longitude };
}

function completeTurn(
  match: SeekEngineMatch,
  reason: "found" | "timeout" | "missed_lock",
  at: number,
): string[] {
  const hiderSeatId = activeHiderSeatId(match);
  if (!hiderSeatId) throw new Error("Cannot complete turn without active hider");

  for (const question of match.questions) {
    if (question.status === "pending") {
      question.status = "closed";
      delete question.privateComputedAnswer;
    }
  }

  const rawHidingMs =
    reason === "missed_lock" || match.releaseAt === null ? 0 : Math.max(0, at - match.releaseAt);
  const bonusMs = match.currentTurnBonusMs;
  const trapBonusMs = match.currentTurnTrapBonusMs;
  const penaltyMs = match.currentTurnPenaltyMs;
  const adjustedMs = Math.max(0, rawHidingMs + bonusMs + trapBonusMs - penaltyMs);

  const archivedClues = match.questions.map(({ privateComputedAnswer: _omit, ...publicClue }) => ({
    ...publicClue,
  }));

  const completedAnchorId = match.anchorStationId;
  match.turns.push({
    turnNumber: match.turnNumber,
    hiderSeatId,
    anchorStationId: completedAnchorId,
    rawHidingMs,
    bonusMs,
    trapBonusMs,
    penaltyMs,
    adjustedMs,
    reason,
    completedAt: at,
    clues: archivedClues,
  });

  if (match.turnNumber < totalPlannedTurns(match)) {
    clearTurnState(match);
    match.phase = "regroup";
    match.phaseEndsAt = at + match.pack.timers.regroupLimitMs;
    match.regroupPoint = resolveRegroupPoint(match, completedAnchorId);
    return [];
  }

  const winner = pickMatchWinner(match.turns);
  return closeMatch(match, "finished", "scored", at, winner);
}

export function createSeekEngineMatch(params: {
  code: string;
  pack: HideSeekRulebookPack;
  snapshot: GeoSnapshot;
  hostSeatId: string;
  hostName: string;
  hostCredentialHash: string;
  generateFoundCode?: () => string;
}): SeekEngineMatch {
  const validation = validateHideSeekRulebook(params.pack, params.snapshot);
  if (!validation.ok) {
    throw new Error(
      `Invalid HideSeekRulebookPack: ${validation.errors.map((e) => `${e.code}:${e.path}`).join(", ")}`,
    );
  }
  return {
    code: params.code,
    pack: params.pack,
    snapshot: params.snapshot,
    phase: "lobby",
    turnNumber: 1,
    turnOrder: [params.hostSeatId],
    seats: [
      {
        seatId: params.hostSeatId,
        name: params.hostName,
        isHost: true,
        startVerifiedUntil: null,
        ready: false,
        regrouped: false,
        confirmedFound: false,
        credentialHash: params.hostCredentialHash,
      },
    ],
    startedAt: null,
    releaseAt: null,
    phaseEndsAt: null,
    anchorStationId: null,
    hiderLastPosition: null,
    hiderOutOfZone: false,
    foundCode: null,
    endgameTriggeredAt: null,
    endgameFreezeAt: null,
    hiderFrozen: false,
    moveZoneUntil: null,
    revealedOldAnchorStationId: null,
    thermometerStart: null,
    questionUseCounts: {},
    questions: [],
    pendingDrawBatches: [],
    currentTurnBonusMs: 0,
    currentTurnTrapBonusMs: 0,
    currentTurnPenaltyMs: 0,
    questionBlockedUntil: null,
    bannedFamilies: {},
    extraDrawPerQuestion: 0,
    regroupPoint: null,
    turns: [],
    outcome: null,
    appliedActions: new Map(),
    generateFoundCode: params.generateFoundCode ?? defaultFoundCode,
  };
}

export function joinSeekEngineMatch(
  match: SeekEngineMatch,
  params: { seatId: string; name: string; credentialHash: string },
): { ok: true } | { ok: false; error: string } {
  if (match.phase !== "lobby") return { ok: false, error: "room-already-started" };
  if (match.seats.some((s) => s.credentialHash === params.credentialHash)) {
    return { ok: true };
  }
  if (match.seats.length >= match.pack.session.maxPlayers) {
    return { ok: false, error: "room-full" };
  }
  if (match.seats.some((s) => s.seatId === params.seatId)) {
    return { ok: false, error: "seat-taken" };
  }
  match.seats.push({
    seatId: params.seatId,
    name: params.name,
    isHost: false,
    startVerifiedUntil: null,
    ready: false,
    regrouped: false,
    confirmedFound: false,
    credentialHash: params.credentialHash,
  });
  match.turnOrder.push(params.seatId);
  for (const seat of match.seats) seat.ready = false;
  return { ok: true };
}

export function expireSeekEngineMatch(match: SeekEngineMatch, now: number): { changed: boolean; purgedPhotoIds: string[] } {
  let changed = false;
  const purgedPhotoIds: string[] = [];

  const expireIntraPhase = (through: number) => {
    if (match.phase === "seeking" || match.phase === "endgame") {
      for (const question of match.questions) {
        if (question.status === "pending" && question.deadline <= through) {
          if (question.family === "photo") {
            question.status = "timeout";
            question.answerCode = "timeout";
            question.answerLabel = "Photo timed out";
          } else if (question.privateComputedAnswer) {
            question.status = "timeout";
            question.answerCode = question.privateComputedAnswer.code;
            question.answerLabel = question.privateComputedAnswer.label;
            question.overlay = question.privateComputedAnswer.overlay;
            delete question.privateComputedAnswer;
          } else {
            question.status = "timeout";
          }
          changed = true;
        }
      }
      if (match.phase === "endgame" && !match.hiderFrozen && match.endgameFreezeAt !== null && match.endgameFreezeAt <= through) {
        match.hiderFrozen = true;
        changed = true;
      }
      if (match.moveZoneUntil !== null && match.moveZoneUntil <= through) {
        match.moveZoneUntil = null;
        changed = true;
      }
      if (match.questionBlockedUntil !== null && match.questionBlockedUntil <= through) {
        match.questionBlockedUntil = null;
        changed = true;
      }
      for (const [family, until] of Object.entries(match.bannedFamilies) as [HideSeekQuestionFamily, number][]) {
        if (until <= through) {
          delete match.bannedFamilies[family];
          changed = true;
        }
      }
    }
  };

  while (match.phaseEndsAt !== null && now >= match.phaseEndsAt) {
    const at = match.phaseEndsAt;
    expireIntraPhase(at - 1);
    switch (match.phase) {
      case "head_start": {
        if (match.anchorStationId === null) {
          const policy = match.pack.session.missedLockPolicy;
          if (policy === "auto_lock_nearest_station") {
            const refPoint = match.hiderLastPosition ?? match.snapshot.startPoint;
            const nearest = findNearestStation(refPoint, match.snapshot.stations, true);
            if (nearest) {
              match.anchorStationId = nearest.station.id;
              match.phase = "seeking";
              match.releaseAt = at;
              match.phaseEndsAt = at + match.pack.timers.searchLimitMs;
              match.foundCode = match.generateFoundCode();
            } else {
              purgedPhotoIds.push(...closeMatch(match, "void", "missed_lock", at));
            }
          } else if (policy === "forfeit_turn") {
            purgedPhotoIds.push(...completeTurn(match, "missed_lock", at));
          } else {
            purgedPhotoIds.push(...closeMatch(match, "void", "missed_lock", at));
          }
        } else {
          match.phase = "seeking";
          match.releaseAt = at;
          match.phaseEndsAt = at + match.pack.timers.searchLimitMs;
          match.foundCode = match.generateFoundCode();
        }
        break;
      }
      case "seeking":
      case "endgame": {
        purgedPhotoIds.push(...completeTurn(match, "timeout", at));
        break;
      }
      case "regroup": {
        purgedPhotoIds.push(...closeMatch(match, "incomplete", "regroup_timeout", at));
        break;
      }
      default:
        match.phaseEndsAt = null;
        break;
    }
    changed = true;
  }

  expireIntraPhase(now);
  return { changed, purgedPhotoIds };
}

function buildDrawBatches(
  pack: HideSeekRulebookPack,
  drawCount: number,
  keepCount: number,
  useCount: number,
  extraDrawPerQuestion: number,
): { multiplier: number; batches: SeekDrawBatch[]; locked: boolean } {
  const mode = pack.investigationBook.repeatCostMode;
  if (mode === "single_use_locked" && useCount >= 1) {
    return { multiplier: 0, batches: [], locked: true };
  }
  const multiplier = mode === "escalating_multiplier" ? useCount + 1 : 1;
  const batches: SeekDrawBatch[] = Array.from({ length: multiplier }, () => ({
    drawCount: drawCount + extraDrawPerQuestion,
    keepCount,
  }));
  return { multiplier, batches, locked: false };
}

function buildMenu(match: SeekEngineMatch): SeekEngineMenuEntry[] {
  if (match.phase !== "seeking" && match.phase !== "endgame") return [];
  const playPhase: HideSeekPlayPhase = match.phase;
  const entries: SeekEngineMenuEntry[] = [];
  const { families } = match.pack.investigationBook;
  const defaultObjMs = match.pack.timers.objectiveResponseMs;
  const defaultPhotoMs = match.pack.timers.photoResponseMs;

  const pushFamily = (
    family: HideSeekQuestionFamily,
    cfg: {
      enabled: boolean;
      drawCount: number;
      keepCount: number;
      responseMs?: number;
      availableInPhases: HideSeekPlayPhase[];
      items: { id: string; label: string; prompt?: string; phase?: HideSeekPlayPhase | "both" }[];
      allowCustomRadius?: boolean;
    } | undefined,
  ) => {
    if (!cfg?.enabled) return;
    const responseMs = cfg.responseMs ?? (family === "photo" ? defaultPhotoMs : defaultObjMs);
    const familyAllowedInPhase = cfg.availableInPhases.includes(playPhase);
    for (const item of cfg.items) {
      const itemAllowedInPhase =
        familyAllowedInPhase &&
        (item.phase === undefined || item.phase === "both" || item.phase === playPhase);
      const useCount = match.questionUseCounts[questionKey(family, item.id)] ?? 0;
      const { multiplier, batches, locked } = buildDrawBatches(
        match.pack,
        cfg.drawCount,
        cfg.keepCount,
        useCount,
        match.extraDrawPerQuestion,
      );
      entries.push({
        family,
        itemId: item.id,
        label: item.label,
        ...(item.prompt ? { prompt: item.prompt } : {}),
        useCount,
        nextRepeatMultiplier: multiplier,
        drawBatches: batches,
        lockedSingleUse: locked,
        availableInCurrentPhase: itemAllowedInPhase,
        responseMs,
      });
    }
    if (family === "radar" && cfg.allowCustomRadius) {
      const useCount = match.questionUseCounts[questionKey("radar", "custom-radar")] ?? 0;
      const { multiplier, batches, locked } = buildDrawBatches(
        match.pack,
        cfg.drawCount,
        cfg.keepCount,
        useCount,
        match.extraDrawPerQuestion,
      );
      entries.push({
        family: "radar",
        itemId: "custom-radar",
        label: "Custom radius",
        useCount,
        nextRepeatMultiplier: multiplier,
        drawBatches: batches,
        lockedSingleUse: locked,
        availableInCurrentPhase: familyAllowedInPhase,
        responseMs,
        isCustomRadius: true,
      });
    }
  };

  pushFamily("radar", families.radar);
  pushFamily("thermometer", families.thermometer);
  pushFamily("matching", families.matching);
  pushFamily("measuring", families.measuring);
  pushFamily("tentacles", families.tentacles);
  pushFamily("photo", families.photo);
  return entries;
}

export function viewSeekEngineMatch(match: SeekEngineMatch, seatId: string, now: number): SeekEngineRoomView {
  const hiderId = activeHiderSeatId(match);
  const inActiveTurn =
    match.phase === "head_start" || match.phase === "seeking" || match.phase === "endgame";
  const isHider = inActiveTurn && seatId === hiderId;
  const role: "hider" | "seeker" | "lobby" =
    match.phase === "lobby" ? "lobby" : seatId === hiderId ? "hider" : "seeker";

  const publicSeats: SeekEngineSeat[] = match.seats.map(({ credentialHash: _omit, ...seat }) => ({ ...seat }));
  const questions: SeekEngineQuestion[] = match.questions.map((question) => {
    if (isHider && question.status === "pending") {
      return { ...question };
    }
    const { privateComputedAnswer: _secret, ...publicQuestion } = question;
    return publicQuestion;
  });

  const playPhase: HideSeekPlayPhase | undefined =
    match.phase === "seeking" || match.phase === "endgame" ? match.phase : undefined;

  return {
    code: match.code,
    now,
    seatId,
    role,
    packMeta: match.pack.meta,
    phase: match.phase,
    turnNumber: match.turnNumber,
    totalPlannedTurns: totalPlannedTurns(match),
    turnOrder: [...match.turnOrder],
    hiderSeatId: hiderId,
    startedAt: match.startedAt,
    releaseAt: match.releaseAt,
    phaseEndsAt: match.phaseEndsAt,
    endgameTriggeredAt: match.endgameTriggeredAt,
    endgameFreezeAt: match.endgameFreezeAt,
    hiderFrozen: match.hiderFrozen,
    canMoveZone: match.phase === "seeking" && match.moveZoneUntil === null,
    regroupPoint: match.regroupPoint,
    seats: publicSeats,
    thermometerStart: role === "seeker" ? match.thermometerStart : null,
    questionUseCounts: { ...match.questionUseCounts },
    menu: role === "seeker" ? buildMenu(match) : [],
    questions,
    turns: match.turns.map((turn) => ({ ...turn, clues: turn.clues.map((c) => ({ ...c })) })),
    outcome: match.outcome,
    ...(playPhase ? { playPhase } : {}),
    ...(isHider
      ? {
          ...(match.anchorStationId ? { ownAnchorStationId: match.anchorStationId } : {}),
          ownHidingZoneRadiusMeters: match.pack.geography.hidingZoneRadiusMeters,
          hiderOutOfZone: match.hiderOutOfZone,
          ...(match.phase === "endgame" && match.foundCode ? { foundCode: match.foundCode } : {}),
          pendingDrawBatches: [...match.pendingDrawBatches],
        }
      : {}),
  };
}

export function applySeekEngineAction(
  match: SeekEngineMatch,
  seatId: string,
  action: SeekEngineAction,
  now: number,
): SeekEngineActionReply {
  const { purgedPhotoIds } = expireSeekEngineMatch(match, now);
  const seat = findSeat(match, seatId);
  if (!seat) {
    return { room: viewSeekEngineMatch(match, seatId, now), error: "unknown-seat" };
  }

  const dedupeKey = `${seatId}:${action.actionId}`;
  const cached = match.appliedActions.get(dedupeKey);
  if (cached) {
    return { ...cached, room: viewSeekEngineMatch(match, seatId, now) };
  }

  const finish = (outcome: Omit<SeekEngineActionReply, "room"> = {}): SeekEngineActionReply => {
    const mergedPurged = [...purgedPhotoIds, ...(outcome.purgedPhotoIds ?? [])];
    const finalOutcome: Omit<SeekEngineActionReply, "room"> = {
      ...outcome,
      ...(mergedPurged.length > 0 ? { purgedPhotoIds: mergedPurged } : {}),
    };
    match.appliedActions.set(dedupeKey, finalOutcome);
    return { ...finalOutcome, room: viewSeekEngineMatch(match, seatId, now) };
  };

  if (match.outcome) {
    return finish({ error: "match-finished" });
  }

  const hiderId = activeHiderSeatId(match);
  const isHider = seatId === hiderId;

  switch (action.type) {
    case "leave": {
      if (match.phase === "lobby") {
        if (seat.isHost) {
          const purged = closeMatch(match, "canceled", "canceled", now);
          return finish({ purgedPhotoIds: purged });
        }
        match.seats = match.seats.filter((s) => s.seatId !== seatId);
        match.turnOrder = match.turnOrder.filter((id) => id !== seatId);
        for (const s of match.seats) s.ready = false;
        return finish();
      }
      const remaining = match.seats.filter((s) => s.seatId !== seatId);
      const winner = remaining.length === 1 ? remaining[0].seatId : null;
      const purged = closeMatch(match, "finished", "forfeit", now, winner);
      return finish({ purgedPhotoIds: purged });
    }

    case "set-turn-order": {
      if (match.phase !== "lobby") return finish({ error: "room-phase-changed" });
      if (!seat.isHost) return finish({ error: "host-only" });
      const unique = new Set(action.turnOrder);
      const seatIds = new Set(match.seats.map((s) => s.seatId));
      if (unique.size !== seatIds.size || ![...unique].every((id) => seatIds.has(id))) {
        return finish({ error: "invalid-turn-order" });
      }
      match.turnOrder = [...action.turnOrder];
      for (const s of match.seats) s.ready = false;
      return finish();
    }

    case "check-in-start": {
      if (match.phase !== "lobby") return finish({ error: "room-phase-changed" });
      const check = verifyGpsAtPoint(match.snapshot.startPoint, action.fix, now, match.pack.geography);
      if (!check.ok) return finish({ error: check.error, distanceMeters: check.distanceMeters });
      seat.startVerifiedUntil = Math.max(
        seat.startVerifiedUntil ?? 0,
        action.fix.timestamp + match.pack.geography.maxGpsFixAgeMs,
      );
      return finish({ distanceMeters: check.distanceMeters });
    }

    case "ready": {
      if (match.phase !== "lobby") return finish({ error: "room-phase-changed" });
      if (action.ready && !startVerified(seat, now, match.pack.session.requireStartCheckIn)) {
        return finish({ error: "start-unverified" });
      }
      seat.ready = action.ready;
      return finish();
    }

    case "start": {
      if (!seat.isHost) return finish({ error: "host-only" });
      if (match.startedAt !== null) return finish();
      if (match.phase !== "lobby") return finish({ error: "room-phase-changed" });
      if (match.seats.length < match.pack.session.minPlayers) {
        return finish({ error: "not-enough-players" });
      }
      const allReady = match.seats.every(
        (s) => s.ready && startVerified(s, now, match.pack.session.requireStartCheckIn),
      );
      if (!allReady) return finish({ error: "players-not-ready" });
      match.startedAt = now;
      match.turnNumber = 1;
      beginTurn(match, now);
      return finish();
    }

    case "lock-anchor": {
      const relocating = match.phase === "seeking" && match.moveZoneUntil !== null && now < match.moveZoneUntil;
      if (match.phase !== "head_start" && !relocating) return finish({ error: "room-phase-changed" });
      if (!isHider) return finish({ error: "hider-only" });
      if (match.phase === "head_start" && match.anchorStationId !== null) {
        return finish({ error: "already-locked" });
      }
      const station = match.snapshot.stations.find((s) => s.id === action.stationId && s.eligibleHidingAnchor);
      if (!station) return finish({ error: "invalid-anchor-station" });
      const check = verifyGpsAtPoint(station, action.fix, now, match.pack.geography);
      if (!check.ok) return finish({ error: check.error, distanceMeters: check.distanceMeters });
      match.anchorStationId = station.id;
      match.hiderLastPosition = { latitude: action.fix.latitude, longitude: action.fix.longitude };
      match.hiderOutOfZone = false;
      if (relocating) {
        match.moveZoneUntil = null;
      }
      return finish({ distanceMeters: check.distanceMeters });
    }

    case "report-hider-position": {
      if (match.phase !== "head_start" && match.phase !== "seeking") {
        return finish({ error: "room-phase-changed" });
      }
      if (!isHider) return finish({ error: "hider-only" });
      const fresh = verifyGpsFreshAndAccurate(action.fix, now, match.pack.geography);
      if (!fresh.ok) return finish({ error: fresh.error });
      match.hiderLastPosition = { latitude: action.fix.latitude, longitude: action.fix.longitude };
      if (match.phase === "seeking" && match.anchorStationId && match.moveZoneUntil === null) {
        const anchor = findAnchorStation(match, match.anchorStationId);
        if (anchor) {
          const zoneCheck = isInsideHidingZone(anchor, action.fix, match.pack.geography.hidingZoneRadiusMeters);
          match.hiderOutOfZone = !zoneCheck.inside;
          return finish({ distanceMeters: zoneCheck.distanceMeters });
        }
      }
      return finish();
    }

    case "confirm-freeze": {
      if (match.phase !== "endgame") return finish({ error: "room-phase-changed" });
      if (!isHider) return finish({ error: "hider-only" });
      match.hiderFrozen = true;
      return finish();
    }

    case "seeker-check-in": {
      if (match.phase !== "seeking" && match.phase !== "endgame") {
        return finish({ error: "room-phase-changed" });
      }
      if (isHider) return finish({ error: "seeker-only" });
      const fresh = verifyGpsFreshAndAccurate(action.fix, now, match.pack.geography);
      if (!fresh.ok) return finish({ error: fresh.error });
      if (match.phase === "seeking" && action.offTransit && match.anchorStationId && match.moveZoneUntil === null) {
        const anchor = findAnchorStation(match, match.anchorStationId);
        if (anchor) {
          const zoneCheck = isInsideHidingZone(anchor, action.fix, match.pack.geography.hidingZoneRadiusMeters);
          if (zoneCheck.inside) {
            match.phase = "endgame";
            match.endgameTriggeredAt = now;
            match.endgameFreezeAt = now + match.pack.session.endgameFreezeGraceSec * 1000;
            match.hiderFrozen = match.pack.session.endgameFreezeGraceSec === 0;
            return finish({ endgameTriggered: true });
          }
        }
      }
      return finish({ endgameTriggered: false });
    }

    case "start-thermometer": {
      if (match.phase !== "seeking" && match.phase !== "endgame") {
        return finish({ error: "room-phase-changed" });
      }
      if (isHider) return finish({ error: "seeker-only" });
      const fresh = verifyGpsFreshAndAccurate(action.fix, now, match.pack.geography);
      if (!fresh.ok) return finish({ error: fresh.error });
      match.thermometerStart = { latitude: action.fix.latitude, longitude: action.fix.longitude };
      return finish();
    }

    case "ask": {
      if (match.phase !== "seeking" && match.phase !== "endgame") {
        return finish({ error: "room-phase-changed" });
      }
      if (isHider) return finish({ error: "seeker-only" });
      if (match.moveZoneUntil !== null && now < match.moveZoneUntil) {
        return finish({ error: "hider-relocating" });
      }
      if (match.questionBlockedUntil !== null && now < match.questionBlockedUntil) {
        return finish({ error: "questions-blocked" });
      }
      const bannedUntil = match.bannedFamilies[action.family];
      if (bannedUntil !== undefined && now < bannedUntil) {
        return finish({ error: "question-family-banned" });
      }
      if (match.questions.some((q) => q.status === "pending")) {
        return finish({ error: "question-pending" });
      }
      const fresh = verifyGpsFreshAndAccurate(action.fix, now, match.pack.geography);
      if (!fresh.ok) return finish({ error: fresh.error });

      const menuEntry = buildMenu(match).find(
        (entry) => entry.family === action.family && entry.itemId === action.itemId,
      );
      if (!menuEntry) return finish({ error: "unknown-question-item" });
      if (!menuEntry.availableInCurrentPhase) return finish({ error: "question-unavailable-in-phase" });
      if (menuEntry.lockedSingleUse) return finish({ error: "question-already-used" });

      const anchor = findAnchorStation(match, match.anchorStationId);
      if (!anchor) return finish({ error: "hider-not-locked" });

      const seekerPoint: GeoCoordinate = { latitude: action.fix.latitude, longitude: action.fix.longitude };
      let privateComputedAnswer: SeekEngineQuestion["privateComputedAnswer"];
      let referenceStationId: string | undefined;
      let label = menuEntry.label;
      let thermometerStartUsed: GeoCoordinate | undefined;

      if (action.family !== "photo") {
        const evalResult = evaluateObjectiveQuestion({
          pack: match.pack,
          snapshot: match.snapshot,
          family: action.family,
          itemId: action.itemId,
          seekerPoint,
          hiderAnchor: anchor,
          thermometerStart: match.thermometerStart ?? undefined,
          customRadiusMeters: action.customRadiusMeters,
        });
        if (!evalResult.ok) return finish({ error: evalResult.error });
        privateComputedAnswer = evalResult.answer;
        referenceStationId = evalResult.referenceStationId;
        label = evalResult.label;
        if (action.family === "thermometer") {
          thermometerStartUsed = match.thermometerStart ?? undefined;
          match.thermometerStart = null;
        }
      }

      const key = questionKey(action.family, action.itemId);
      match.questionUseCounts[key] = (match.questionUseCounts[key] ?? 0) + 1;

      const question: SeekEngineQuestion = {
        id: randomUUID(),
        family: action.family,
        itemId: action.itemId,
        label,
        ...(menuEntry.prompt ? { prompt: menuEntry.prompt } : {}),
        referencePoint: seekerPoint,
        ...(referenceStationId ? { referenceStationId } : {}),
        ...(thermometerStartUsed ? { thermometerStart: thermometerStartUsed } : {}),
        ...(action.customRadiusMeters !== undefined ? { customRadiusMeters: action.customRadiusMeters } : {}),
        askedBySeatId: seatId,
        askedAt: now,
        deadline: Math.min(match.phaseEndsAt ?? now + menuEntry.responseMs, now + menuEntry.responseMs),
        repeatMultiplier: menuEntry.nextRepeatMultiplier,
        drawBatches: menuEntry.drawBatches,
        status: "pending",
        ...(privateComputedAnswer ? { privateComputedAnswer } : {}),
      };
      match.questions.push(question);
      return finish();
    }

    case "answer-question": {
      if (match.phase !== "seeking" && match.phase !== "endgame") {
        return finish({ error: "room-phase-changed" });
      }
      if (!isHider) return finish({ error: "hider-only" });
      const question = match.questions.find((q) => q.id === action.questionId && q.status === "pending");
      if (!question) return finish({ error: "question-closed" });

      if (question.family === "photo") {
        if (!action.photoId || !action.photoId.trim()) return finish({ error: "photo-required" });
        question.photoId = action.photoId;
        question.answerCode = "photo";
        question.answerLabel = "Photo delivered";
      } else {
        if (!question.privateComputedAnswer) return finish({ error: "missing-computed-answer" });
        question.answerCode = question.privateComputedAnswer.code;
        question.answerLabel = question.privateComputedAnswer.label;
        question.overlay = question.privateComputedAnswer.overlay;
        delete question.privateComputedAnswer;
      }

      question.status = "answered";
      match.pendingDrawBatches.push(...question.drawBatches);
      return finish({ earnedDrawBatches: question.drawBatches });
    }

    case "cannot-answer-endgame": {
      if (match.phase !== "endgame") return finish({ error: "endgame-only" });
      if (!isHider) return finish({ error: "hider-only" });
      const question = match.questions.find((q) => q.id === action.questionId && q.status === "pending");
      if (!question) return finish({ error: "question-closed" });
      delete question.privateComputedAnswer;
      question.status = "cannot_answer_endgame";
      question.answerCode = "cannot_answer_endgame";
      question.answerLabel = "Cannot answer (Endgame)";
      match.pendingDrawBatches.push(...question.drawBatches);
      return finish({ earnedDrawBatches: question.drawBatches });
    }

    case "submit-found-code": {
      if (match.phase !== "endgame") return finish({ error: "endgame-only" });
      if (isHider) return finish({ error: "seeker-only" });
      if (!match.foundCode || action.code.trim() !== match.foundCode) {
        return finish({ error: "invalid-found-code" });
      }
      const purged = completeTurn(match, "found", now);
      return finish({ purgedPhotoIds: purged });
    }

    case "confirm-found": {
      if (match.phase !== "endgame") return finish({ error: "endgame-only" });
      seat.confirmedFound = true;
      const hiderSeat = hiderId ? findSeat(match, hiderId) : undefined;
      const anySeekerConfirmed = match.seats.some((s) => s.seatId !== hiderId && s.confirmedFound);
      if (hiderSeat?.confirmedFound && anySeekerConfirmed) {
        const purged = completeTurn(match, "found", now);
        return finish({ purgedPhotoIds: purged });
      }
      return finish();
    }

    case "regroup-check-in": {
      if (match.phase !== "regroup") return finish({ error: "room-phase-changed" });
      if (seat.regrouped) return finish();
      if (match.regroupPoint) {
        if (!action.fix) return finish({ error: "location-required" });
        const check = verifyGpsAtPoint(match.regroupPoint, action.fix, now, match.pack.geography);
        if (!check.ok) return finish({ error: check.error, distanceMeters: check.distanceMeters });
        seat.regrouped = true;
        if (match.seats.every((s) => s.regrouped)) {
          match.turnNumber++;
          match.regroupPoint = null;
          beginTurn(match, now);
        }
        return finish({ distanceMeters: check.distanceMeters });
      }
      seat.regrouped = true;
      if (match.seats.every((s) => s.regrouped)) {
        match.turnNumber++;
        match.regroupPoint = null;
        beginTurn(match, now);
      }
      return finish();
    }
  }
}

// --- Clean Deck/Curse Extension Hooks for #37 ---

export function cancelPendingQuestionForVeto(
  match: SeekEngineMatch,
  now: number,
): { ok: true; questionId: string } | { ok: false; error: string } {
  expireSeekEngineMatch(match, now);
  const question = match.questions.find((q) => q.status === "pending");
  if (!question) return { ok: false, error: "no-pending-question" };
  question.status = "vetoed";
  question.answerCode = "vetoed";
  question.answerLabel = "Question vetoed";
  delete question.privateComputedAnswer;
  return { ok: true, questionId: question.id };
}

export function randomizePendingQuestion(
  match: SeekEngineMatch,
  now: number,
  pickIndex: (length: number) => number = (len) => randomInt(0, len),
): { ok: true; question: SeekEngineQuestion } | { ok: false; error: string } {
  expireSeekEngineMatch(match, now);
  const question = match.questions.find((q) => q.status === "pending");
  if (!question) return { ok: false, error: "no-pending-question" };
  const anchor = findAnchorStation(match, match.anchorStationId);
  if (!anchor) return { ok: false, error: "hider-not-locked" };

  const candidates = buildMenu(match).filter(
    (entry) =>
      entry.family === question.family &&
      entry.itemId !== question.itemId &&
      entry.itemId !== "custom-radar" &&
      entry.useCount === 0 &&
      entry.availableInCurrentPhase,
  );
  if (candidates.length === 0) return { ok: false, error: "no-unused-question-in-family" };

  const chosen = candidates[Math.abs(pickIndex(candidates.length)) % candidates.length];
  if (question.family !== "photo") {
    const evalResult = evaluateObjectiveQuestion({
      pack: match.pack,
      snapshot: match.snapshot,
      family: question.family,
      itemId: chosen.itemId,
      seekerPoint: question.referencePoint,
      hiderAnchor: anchor,
      thermometerStart: question.thermometerStart,
    });
    if (!evalResult.ok) return { ok: false, error: evalResult.error };
    question.privateComputedAnswer = evalResult.answer;
    question.referenceStationId = evalResult.referenceStationId;
    question.label = evalResult.label;
  } else {
    question.label = chosen.label;
    question.prompt = chosen.prompt;
  }

  question.itemId = chosen.itemId;
  const key = questionKey(question.family, chosen.itemId);
  match.questionUseCounts[key] = (match.questionUseCounts[key] ?? 0) + 1;
  return { ok: true, question };
}

export function startMoveZoneRelocation(
  match: SeekEngineMatch,
  now: number,
  travelWindowMs: number,
  revealOldStation: boolean,
): { ok: true; revealedOldAnchorStationId: string | null; moveZoneUntil: number } | { ok: false; error: string } {
  expireSeekEngineMatch(match, now);
  if (match.phase === "endgame") return { ok: false, error: "move-disabled-in-endgame" };
  if (match.phase !== "seeking") return { ok: false, error: "room-phase-changed" };
  if (match.moveZoneUntil !== null) return { ok: false, error: "already-relocating" };
  const oldId = revealOldStation ? match.anchorStationId : null;
  match.revealedOldAnchorStationId = oldId;
  match.moveZoneUntil = now + travelWindowMs;
  return { ok: true, revealedOldAnchorStationId: oldId, moveZoneUntil: match.moveZoneUntil };
}

export function recordTurnScoreAdjustment(
  match: SeekEngineMatch,
  delta: { bonusMs?: number; trapBonusMs?: number; penaltyMs?: number },
) {
  if (delta.bonusMs) match.currentTurnBonusMs += delta.bonusMs;
  if (delta.trapBonusMs) match.currentTurnTrapBonusMs += delta.trapBonusMs;
  if (delta.penaltyMs) match.currentTurnPenaltyMs += delta.penaltyMs;
}
