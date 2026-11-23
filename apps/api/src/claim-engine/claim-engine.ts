import { randomInt, randomUUID } from "node:crypto";
import type {
  ClaimActiveAttemptView,
  ClaimChallengeItem,
  ClaimEngineAction,
  ClaimEngineActionReply,
  ClaimEngineEvent,
  ClaimEngineOutcome,
  ClaimEnginePhase,
  ClaimEngineRoomView,
  ClaimEngineSeat,
  ClaimLandmarkState,
  ClaimPendingPhotoReview,
  ClaimRulebookPack,
  ClaimTeamScore,
  ClaimZoneStanding,
  GeoSnapshot,
} from "@kelana-ria/contracts";
import { verifyGpsAtPoint } from "../seek-engine/geo-evaluator.js";
import {
  evaluateLeafSubmission,
  resolveActiveLeafChallenge,
  sanitizeClaimChallenge,
} from "./challenge-evaluator.js";
import { validateClaimRulebook } from "./claim-rulebook-validator.js";
import {
  clearClaimCurseByGps,
  clearClaimCurseByHonor,
  consumeClaimHandCard,
  createClaimTacticalDeck,
  drawClaimTacticalCard,
  expireClaimCurses,
  hasActiveClaimCurseBlocker,
  reviewClaimCursePhoto,
  submitClaimCursePhoto,
  type ClaimTacticalDeckState,
} from "./tactical-deck.js";

type InternalSeat = ClaimEngineSeat & {
  credentialHash: string;
  cooldowns: Record<string, number>;
  burnedLandmarks: Set<string>;
  scoutedLandmarkIds: Set<string>;
  challengeHand: ClaimChallengeItem[];
  learningExplanation?: NonNullable<ClaimEngineRoomView["ownLearningExplanation"]>;
};

type InternalAttempt = {
  seatId: string;
  landmarkId: string;
  challenge: ClaimChallengeItem;
  fromChallengeHandId?: string;
  isStealAttempt: boolean;
  chosenTier?: "standard" | "bold";
  currentStep: 0 | 1;
  timedStartedAt: number | null;
  timedDeadline: number | null;
  pendingPhoto: {
    photoId: string;
    submittedAt: number;
    autoApproveAt: number;
  } | null;
};

export type ClaimEngineMatch = {
  code: string;
  mode?: "solo" | "group";
  pack: ClaimRulebookPack;
  snapshot: GeoSnapshot;
  phase: ClaimEnginePhase;
  startedAt: number | null;
  deadline: number | null;
  seats: InternalSeat[];
  landmarks: Record<string, ClaimLandmarkState>;
  assignedLandmarkChallenges: Record<string, ClaimChallengeItem>;
  unusedBackupChallenges: ClaimChallengeItem[];
  unusedHandChallenges: ClaimChallengeItem[];
  activeAttemptsBySeat: Record<string, InternalAttempt | undefined>;
  deck: ClaimTacticalDeckState;
  archivedPhotoIds: string[];
  events: ClaimEngineEvent[];
  outcome: ClaimEngineOutcome | null;
  appliedActions: Map<string, Omit<ClaimEngineActionReply, "room">>;
  rngInt: (maxExclusive: number) => number;
};

function findSeat(match: ClaimEngineMatch, seatId: string): InternalSeat | undefined {
  return match.seats.find((s) => s.seatId === seatId);
}

export function findClaimEngineSeat(match: ClaimEngineMatch, credentialHash: string): string | undefined {
  return match.seats.find((s) => s.credentialHash === credentialHash)?.seatId;
}

function isSoloMatch(match: ClaimEngineMatch): boolean {
  return match.mode === undefined ? match.seats.length === 1 : match.mode === "solo";
}

function startVerified(seat: InternalSeat, now: number, requireStartCheckIn: boolean): boolean {
  if (!requireStartCheckIn) return true;
  return seat.startVerifiedUntil !== null && seat.startVerifiedUntil >= now;
}

function computeZoneStandings(match: ClaimEngineMatch): {
  zones: ClaimZoneStanding[];
  standings: ClaimTeamScore[];
} {
  const teamIds = [...new Set(match.seats.map((s) => s.teamId))];
  const { claimWeight, lockWeight } = match.pack.claiming;
  const zones: ClaimZoneStanding[] = [];
  const scoresByTeam = new Map<string, ClaimTeamScore>(
    teamIds.map((teamId) => [teamId, { teamId, zonesControlled: 0, lockedLandmarks: 0, totalLandmarks: 0 }]),
  );

  for (const zone of match.pack.geography.zones) {
    const weightsByTeam: Record<string, number> = Object.fromEntries(teamIds.map((t) => [t, 0]));
    for (const lm of Object.values(match.landmarks)) {
      if (lm.zoneId !== zone.id || !lm.ownerTeamId) continue;
      const baseWeight = lm.status === "locked" ? lockWeight : claimWeight;
      const multiplier = lm.status === "locked" && lm.doubleWeighted ? 2 : 1;
      const totalWeight = baseWeight * multiplier + lm.bonusWeight;
      weightsByTeam[lm.ownerTeamId] = (weightsByTeam[lm.ownerTeamId] ?? 0) + totalWeight;

      const score = scoresByTeam.get(lm.ownerTeamId);
      if (score) {
        score.totalLandmarks++;
        if (lm.status === "locked") score.lockedLandmarks++;
      }
    }

    const sorted = Object.entries(weightsByTeam).sort(([, a], [, b]) => b - a);
    let controllerTeamId: string | null = null;
    if (sorted.length > 0 && sorted[0][1] > 0) {
      if (sorted.length === 1 || sorted[0][1] > sorted[1][1]) {
        controllerTeamId = sorted[0][0];
        const score = scoresByTeam.get(controllerTeamId);
        if (score) score.zonesControlled++;
      }
    }

    zones.push({
      zoneId: zone.id,
      name: zone.name,
      label: zone.label,
      weightsByTeam,
      controllerTeamId,
    });
  }

  const standings = [...scoresByTeam.values()].sort((a, b) => {
    if (b.zonesControlled !== a.zonesControlled) return b.zonesControlled - a.zonesControlled;
    if (b.lockedLandmarks !== a.lockedLandmarks) return b.lockedLandmarks - a.lockedLandmarks;
    return b.totalLandmarks - a.totalLandmarks;
  });

  return { zones, standings };
}

function pickMultiplayerWinner(standings: ClaimTeamScore[]): string | null {
  if (standings.length === 0) return null;
  if (standings.length >= 2) {
    const [a, b] = standings;
    if (
      a.zonesControlled === b.zonesControlled &&
      a.lockedLandmarks === b.lockedLandmarks &&
      a.totalLandmarks === b.totalLandmarks
    ) {
      return null;
    }
  }
  return standings[0].teamId;
}

function soloProgress(match: ClaimEngineMatch): {
  lockedLandmarks: number;
  targetLandmarks: number;
  distinctZones: number;
  targetZones: number;
} | undefined {
  if (!isSoloMatch(match) || !match.pack.session.soloTargets) return undefined;
  const locked = Object.values(match.landmarks).filter((lm) => lm.status === "locked");
  const zones = new Set(locked.map((lm) => lm.zoneId));
  return {
    lockedLandmarks: locked.length,
    targetLandmarks: match.pack.session.soloTargets.lockedLandmarks,
    distinctZones: zones.size,
    targetZones: match.pack.session.soloTargets.distinctZones,
  };
}

function soloTargetImpossible(match: ClaimEngineMatch): boolean {
  const prog = soloProgress(match);
  if (!prog) return false;
  const seat = match.seats[0];
  const lockable = Object.values(match.landmarks).filter(
    (lm) => lm.status === "locked" || !seat.burnedLandmarks.has(lm.landmarkId),
  );
  const possibleZones = new Set(lockable.map((lm) => lm.zoneId));
  return lockable.length < prog.targetLandmarks || possibleZones.size < prog.targetZones;
}

function finishMatch(
  match: ClaimEngineMatch,
  phase: Extract<ClaimEnginePhase, "finished" | "abandoned" | "canceled">,
  outcome: ClaimEngineOutcome,
): string[] {
  match.phase = phase;
  match.outcome = outcome;
  match.activeAttemptsBySeat = {};
  const purged = [...match.archivedPhotoIds];
  for (const curse of match.deck.activeCurses) {
    if (curse.pendingPhoto) purged.push(curse.pendingPhoto.photoId);
  }
  match.deck.activeCurses = [];
  match.archivedPhotoIds = [];
  match.events.push({
    type: phase === "abandoned" ? "abandoned" : phase === "canceled" ? "canceled" : "finished",
    at: outcome.at,
    detail: outcome.reason,
  });
  return purged;
}

function failAttempt(match: ClaimEngineMatch, seat: InternalSeat, attempt: InternalAttempt, now: number, reason: string) {
  delete match.activeAttemptsBySeat[seat.seatId];
  const policy = isSoloMatch(match) ? match.pack.claiming.soloFailPolicy : match.pack.claiming.multiplayerFailPolicy;
  if (policy === "burned_for_player") {
    seat.burnedLandmarks.add(attempt.landmarkId);
  } else {
    seat.cooldowns[attempt.landmarkId] = now + match.pack.claiming.failCooldownMs;
  }

  const lm = match.landmarks[attempt.landmarkId];
  if (!isSoloMatch(match) && lm && lm.status === "claimed" && match.pack.claiming.broadcastFailAlert) {
    lm.vulnerableAlertAt = now;
  }
  match.events.push({
    type: "challenge_failed",
    at: now,
    seatId: seat.seatId,
    teamId: seat.teamId,
    landmarkId: attempt.landmarkId,
    detail: !isSoloMatch(match) && lm?.status === "claimed" ? `open-to-steal:${reason}` : reason,
  });

  if (isSoloMatch(match) && soloTargetImpossible(match)) {
    finishMatch(match, "finished", {
      winnerTeamId: null,
      soloWon: false,
      reason: "solo_impossible",
      at: now,
    });
  }
}

function completeAttemptSuccess(
  match: ClaimEngineMatch,
  seat: InternalSeat,
  attempt: InternalAttempt,
  now: number,
): string[] {
  delete match.activeAttemptsBySeat[seat.seatId];
  const lm = match.landmarks[attempt.landmarkId];
  if (!lm || lm.status === "locked") return [];
  if (attempt.challenge.learningExplanation) {
    seat.learningExplanation = { landmarkId: lm.landmarkId, text: attempt.challenge.learningExplanation };
  }

  // Consume challenge-hand card and replenish if in challenge_hand mode
  if (attempt.fromChallengeHandId) {
    seat.challengeHand = seat.challengeHand.filter((c) => c.id !== attempt.fromChallengeHandId);
    const replacement = match.unusedHandChallenges.shift();
    if (replacement) seat.challengeHand.push(replacement);
  }

  const wasSteal = attempt.isStealAttempt && lm.ownerTeamId !== null && lm.ownerTeamId !== seat.teamId;
  const locksNow = !wasSteal || match.pack.claiming.stealLocksImmediately;

  lm.ownerSeatId = seat.seatId;
  lm.ownerTeamId = seat.teamId;
  lm.shieldUntil = null;
  lm.vulnerableAlertAt = null;
  if (locksNow) {
    lm.status = "locked";
    lm.lockedAt = now;
  } else {
    lm.status = "claimed";
    lm.claimedAt = now;
  }

  // Cancel any competing attempts at the same landmark if it is now locked
  if (lm.status === "locked") {
    for (const [otherSeatId, otherAttempt] of Object.entries(match.activeAttemptsBySeat)) {
      if (otherAttempt && otherAttempt.landmarkId === lm.landmarkId) {
        delete match.activeAttemptsBySeat[otherSeatId];
      }
    }
  }

  // Apply Bold Call-Your-Shot rewards
  let boldDraw = false;
  if (attempt.challenge.payload.primitive === "call_your_shot" && attempt.chosenTier === "bold") {
    const reward = attempt.challenge.payload.boldReward;
    if (reward.bonusWeight) lm.bonusWeight += reward.bonusWeight;
    if (reward.drawTacticalCard && match.pack.tacticalDeck.drawTriggers.onBoldChallenge) {
      boldDraw = true;
    }
  }

  // Tactical card draws
  const triggers = match.pack.tacticalDeck.drawTriggers;
  if ((locksNow && triggers.onLock) || (wasSteal && triggers.onSteal)) {
    drawClaimTacticalCard(match.deck, seat.seatId);
  }
  if (boldDraw) {
    drawClaimTacticalCard(match.deck, seat.seatId);
  }

  match.events.push({
    type: wasSteal ? "stolen" : "locked",
    at: now,
    seatId: seat.seatId,
    teamId: seat.teamId,
    landmarkId: lm.landmarkId,
  });

  // Check immediate win conditions
  if (isSoloMatch(match)) {
    const prog = soloProgress(match);
    if (prog && prog.lockedLandmarks >= prog.targetLandmarks && prog.distinctZones >= prog.targetZones) {
      return finishMatch(match, "finished", {
        winnerTeamId: seat.teamId,
        soloWon: true,
        reason: "solo_target_met",
        at: now,
      });
    }
  } else if (Object.values(match.landmarks).every((entry) => entry.status === "locked")) {
    const { standings } = computeZoneStandings(match);
    return finishMatch(match, "finished", {
      winnerTeamId: pickMultiplayerWinner(standings),
      reason: "all_locked",
      at: now,
    });
  }

  return [];
}

export function createClaimEngineMatch(params: {
  code: string;
  mode?: ClaimEngineMatch["mode"];
  pack: ClaimRulebookPack;
  snapshot: GeoSnapshot;
  hostSeatId: string;
  hostName: string;
  hostTeamId?: string;
  hostCredentialHash: string;
  rngInt?: (maxExclusive: number) => number;
}): ClaimEngineMatch {
  const validation = validateClaimRulebook(params.pack, params.snapshot);
  if (!validation.ok) {
    throw new Error(
      `Invalid ClaimRulebookPack: ${validation.errors.map((e) => `${e.code}:${e.path}`).join(", ")}`,
    );
  }
  const rngInt = params.rngInt ?? ((max) => randomInt(0, max));

  const landmarks: Record<string, ClaimLandmarkState> = {};
  const assignedLandmarkChallenges: Record<string, ClaimChallengeItem> = {};
  for (const lm of params.pack.geography.landmarks) {
    landmarks[lm.id] = {
      landmarkId: lm.id,
      zoneId: lm.zoneId,
      status: "unclaimed",
      ownerSeatId: null,
      ownerTeamId: null,
      claimedAt: null,
      lockedAt: null,
      shieldUntil: null,
      doubleWeighted: false,
      bonusWeight: 0,
      vulnerableAlertAt: null,
    };
    if (params.pack.challenges.challengeMode === "per_landmark") {
      const variants = params.pack.challenges.landmarkChallenges[lm.id] ?? [];
      if (variants.length > 0) {
        assignedLandmarkChallenges[lm.id] = variants[Math.abs(rngInt(variants.length)) % variants.length];
      }
    }
  }

  const hostTeamId = params.hostTeamId ?? params.hostSeatId;
  return {
    code: params.code,
    mode: params.mode,
    pack: params.pack,
    snapshot: params.snapshot,
    phase: "lobby",
    startedAt: null,
    deadline: null,
    seats: [
      {
        seatId: params.hostSeatId,
        name: params.hostName,
        teamId: hostTeamId,
        isHost: true,
        startVerifiedUntil: null,
        ready: false,
        credentialHash: params.hostCredentialHash,
        cooldowns: {},
        burnedLandmarks: new Set(),
        scoutedLandmarkIds: new Set(),
        challengeHand: [],
      },
    ],
    landmarks,
    assignedLandmarkChallenges,
    unusedBackupChallenges: [...params.pack.challenges.backupPool],
    unusedHandChallenges: [...(params.pack.challenges.challengeHandPool ?? [])],
    activeAttemptsBySeat: {},
    deck: createClaimTacticalDeck(params.pack, true, { rngInt }),
    archivedPhotoIds: [],
    events: [],
    outcome: null,
    appliedActions: new Map(),
    rngInt,
  };
}

export function joinClaimEngineMatch(
  match: ClaimEngineMatch,
  params: { seatId: string; name: string; teamId?: string; credentialHash: string },
): { ok: true } | { ok: false; error: string } {
  if (match.phase !== "lobby") return { ok: false, error: "room-already-started" };
  if (match.seats.some((s) => s.credentialHash === params.credentialHash)) return { ok: true };
  const capacity = match.mode === "solo" ? 1 : match.pack.session.maxPlayers;
  if (match.seats.length >= capacity) return { ok: false, error: "room-full" };
  if (match.seats.some((s) => s.seatId === params.seatId)) return { ok: false, error: "seat-taken" };
  match.seats.push({
    seatId: params.seatId,
    name: params.name,
    teamId: params.teamId ?? params.seatId,
    isHost: false,
    startVerifiedUntil: null,
    ready: false,
    credentialHash: params.credentialHash,
    cooldowns: {},
    burnedLandmarks: new Set(),
    scoutedLandmarkIds: new Set(),
    challengeHand: [],
  });
  for (const s of match.seats) s.ready = false;
  return { ok: true };
}

export function expireClaimEngineMatch(match: ClaimEngineMatch, now: number): { changed: boolean; purgedPhotoIds: string[] } {
  let changed = false;
  const purgedPhotoIds: string[] = [];

  if (match.phase !== "active") return { changed, purgedPhotoIds };

  const through = match.deadline !== null ? Math.min(now, match.deadline - 1) : now;

  // Expire shields
  for (const lm of Object.values(match.landmarks)) {
    if (lm.shieldUntil !== null && lm.shieldUntil <= through) {
      lm.shieldUntil = null;
      changed = true;
    }
  }

  // Expire curses & photo auto-approvals
  const curseExp = expireClaimCurses(match.deck, through);
  if (curseExp.changed) changed = true;
  purgedPhotoIds.push(...curseExp.purgedPhotoIds);

  // Expire challenge photo auto-approvals and timed micro-task deadlines
  for (const seat of match.seats) {
    const attempt = match.activeAttemptsBySeat[seat.seatId];
    if (!attempt) continue;
    if (attempt.pendingPhoto && attempt.pendingPhoto.autoApproveAt <= through) {
      match.archivedPhotoIds.push(attempt.pendingPhoto.photoId);
      attempt.pendingPhoto = null;
      if (attempt.challenge.payload.primitive === "multi_step" && attempt.currentStep === 0) {
        attempt.currentStep = 1;
      } else {
        purgedPhotoIds.push(...completeAttemptSuccess(match, seat, attempt, through));
      }
      changed = true;
      continue;
    }
    if (attempt.timedDeadline !== null && attempt.timedDeadline <= through && !attempt.pendingPhoto) {
      failAttempt(match, seat, attempt, attempt.timedDeadline, "timed-task-expired");
      changed = true;
    }
  }

  // Check match deadline expiry
  if (match.phase === "active" && match.deadline !== null && now >= match.deadline) {
    if (isSoloMatch(match)) {
      const prog = soloProgress(match);
      const won = Boolean(prog && prog.lockedLandmarks >= prog.targetLandmarks && prog.distinctZones >= prog.targetZones);
      purgedPhotoIds.push(
        ...finishMatch(match, "finished", {
          winnerTeamId: won ? match.seats[0].teamId : null,
          soloWon: won,
          reason: "time",
          at: match.deadline,
        }),
      );
    } else {
      const { standings } = computeZoneStandings(match);
      purgedPhotoIds.push(
        ...finishMatch(match, "finished", {
          winnerTeamId: pickMultiplayerWinner(standings),
          reason: "time",
          at: match.deadline,
        }),
      );
    }
    changed = true;
  }

  return { changed, purgedPhotoIds };
}

export function viewClaimEngineMatch(match: ClaimEngineMatch, seatId: string, now: number): ClaimEngineRoomView {
  const seat = findSeat(match, seatId);
  const { zones, standings } = computeZoneStandings(match);
  const attempt = match.activeAttemptsBySeat[seatId];

  const ownActiveAttempt: ClaimActiveAttemptView | null = attempt
    ? {
        landmarkId: attempt.landmarkId,
        challenge: sanitizeClaimChallenge(attempt.challenge, {
          chosenTier: attempt.chosenTier,
          currentStep: attempt.currentStep,
        }),
        ...(attempt.challenge.hint ? { hint: attempt.challenge.hint } : {}),
        isStealAttempt: attempt.isStealAttempt,
        ...(attempt.chosenTier ? { chosenTier: attempt.chosenTier } : {}),
        currentStep: attempt.currentStep,
        timedStartedAt: attempt.timedStartedAt,
        timedDeadline: attempt.timedDeadline,
        pendingPhoto: attempt.pendingPhoto ? { ...attempt.pendingPhoto } : null,
      }
    : null;

  const scoutedChallenges: ClaimEngineRoomView["scoutedChallenges"] = {};
  if (seat) {
    for (const lmId of seat.scoutedLandmarkIds) {
      const ch = match.assignedLandmarkChallenges[lmId];
      if (ch) scoutedChallenges[lmId] = sanitizeClaimChallenge(ch);
    }
  }

  const pendingRivalPhotoReviews: ClaimPendingPhotoReview[] = [];
  if (seat && !isSoloMatch(match)) {
    for (const otherAttempt of Object.values(match.activeAttemptsBySeat)) {
      if (!otherAttempt?.pendingPhoto) continue;
      const otherSeat = findSeat(match, otherAttempt.seatId);
      if (otherSeat && otherSeat.teamId !== seat.teamId) {
        pendingRivalPhotoReviews.push({
          attemptOwnerSeatId: otherAttempt.seatId,
          landmarkId: otherAttempt.landmarkId,
          photoId: otherAttempt.pendingPhoto.photoId,
          submittedAt: otherAttempt.pendingPhoto.submittedAt,
          autoApproveAt: otherAttempt.pendingPhoto.autoApproveAt,
        });
      }
    }
  }

  const prog = soloProgress(match);

  return {
    code: match.code,
    now,
    seatId,
    teamId: seat?.teamId ?? seatId,
    isSolo: isSoloMatch(match),
    packMeta: match.pack.meta,
    phase: match.phase,
    startedAt: match.startedAt,
    deadline: match.deadline,
    seats: match.seats.map(({ seatId, name, teamId, isHost, startVerifiedUntil, ready }) => ({
      seatId, name, teamId, isHost, startVerifiedUntil, ready,
    })),
    landmarks: Object.values(match.landmarks).map((lm) => ({ ...lm })),
    zones,
    standings,
    ...(prog ? { soloProgress: prog } : {}),
    ownActiveAttempt,
    ...(seat?.learningExplanation ? { ownLearningExplanation: { ...seat.learningExplanation } } : {}),
    ownCooldowns: seat ? { ...seat.cooldowns } : {},
    ownBurnedLandmarks: seat ? [...seat.burnedLandmarks] : [],
    ownHand: [...(match.deck.handsBySeat[seatId] ?? [])],
    ...(match.pack.challenges.challengeMode === "challenge_hand" && seat
      ? { ownChallengeHand: seat.challengeHand.map((ch) => sanitizeClaimChallenge(ch)) }
      : {}),
    scoutedChallenges,
    pendingRivalPhotoReviews,
    activeCurses: match.deck.activeCurses.map((c) => ({ ...c })),
    events: match.events.map((e) => ({ ...e })),
    outcome: match.outcome,
  };
}

export function applyClaimEngineAction(
  match: ClaimEngineMatch,
  seatId: string,
  action: ClaimEngineAction,
  now: number,
): ClaimEngineActionReply {
  const { purgedPhotoIds } = expireClaimEngineMatch(match, now);
  const seat = findSeat(match, seatId);
  if (!seat) {
    return { room: viewClaimEngineMatch(match, seatId, now), error: "unknown-seat" };
  }

  const dedupeKey = `${seatId}:${action.actionId}`;
  const cached = match.appliedActions.get(dedupeKey);
  if (cached) {
    return { ...cached, room: viewClaimEngineMatch(match, seatId, now) };
  }

  const finish = (outcome: Omit<ClaimEngineActionReply, "room"> = {}): ClaimEngineActionReply => {
    const mergedPurged = [...purgedPhotoIds, ...(outcome.purgedPhotoIds ?? [])];
    const finalOutcome: Omit<ClaimEngineActionReply, "room"> = {
      ...outcome,
      ...(mergedPurged.length > 0 ? { purgedPhotoIds: mergedPurged } : {}),
    };
    match.appliedActions.set(dedupeKey, finalOutcome);
    return { ...finalOutcome, room: viewClaimEngineMatch(match, seatId, now) };
  };

  if (match.outcome) return finish({ error: "match-finished" });

  switch (action.type) {
    case "leave": {
      if (match.phase === "lobby") {
        if (seat.isHost) {
          const purged = finishMatch(match, "canceled", { winnerTeamId: null, reason: "canceled", at: now });
          return finish({ purgedPhotoIds: purged });
        }
        match.seats = match.seats.filter((s) => s.seatId !== seatId);
        for (const s of match.seats) s.ready = false;
        return finish();
      }
      if (isSoloMatch(match)) {
        const purged = finishMatch(match, "abandoned", { winnerTeamId: null, soloWon: false, reason: "abandoned", at: now });
        return finish({ purgedPhotoIds: purged });
      }
      const otherTeams = [...new Set(match.seats.filter((s) => s.teamId !== seat.teamId).map((s) => s.teamId))];
      const winner = otherTeams.length === 1 ? otherTeams[0] : null;
      const purged = finishMatch(match, "finished", { winnerTeamId: winner, reason: "forfeit", at: now });
      return finish({ purgedPhotoIds: purged });
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
      const minimum = match.mode === "group" ? Math.max(2, match.pack.session.minPlayers) : match.pack.session.minPlayers;
      if (match.seats.length < minimum) return finish({ error: "not-enough-players" });
      const allReady = match.seats.every(
        (s) => s.ready && startVerified(s, now, match.pack.session.requireStartCheckIn),
      );
      if (!allReady) return finish({ error: "players-not-ready" });

      // Rebuild deck respecting exact solo vs multiplayer mode
      match.deck = createClaimTacticalDeck(match.pack, isSoloMatch(match), { rngInt: match.rngInt });

      // Deal initial challenge hand if pack uses challenge_hand mode
      if (match.pack.challenges.challengeMode === "challenge_hand" && match.pack.challenges.challengeHandSize) {
        for (const member of match.seats) {
          for (let i = 0; i < match.pack.challenges.challengeHandSize; i++) {
            const next = match.unusedHandChallenges.shift();
            if (next) member.challengeHand.push(next);
          }
        }
      }

      match.phase = "active";
      match.startedAt = now;
      match.deadline = now + match.pack.session.durationMs;
      match.events.push({ type: "started", at: now });
      return finish();
    }

    case "check-in-landmark": {
      if (match.phase !== "active") return finish({ error: "room-phase-changed" });
      const lmDef = match.pack.geography.landmarks.find((l) => l.id === action.landmarkId);
      const lm = match.landmarks[action.landmarkId];
      if (!lmDef || !lm) return finish({ error: "unknown-landmark" });
      if (lm.status === "locked") return finish({ error: "already-locked" });

      const check = verifyGpsAtPoint(lmDef, action.fix, now, match.pack.geography);
      if (!check.ok) return finish({ error: check.error, distanceMeters: check.distanceMeters });

      const isStealAttempt = lm.status === "claimed" && lm.ownerTeamId !== seat.teamId;
      if (isStealAttempt) {
        if (lm.shieldUntil !== null && now < lm.shieldUntil) {
          return finish({ error: "landmark-shielded", distanceMeters: check.distanceMeters });
        }
        if (hasActiveClaimCurseBlocker(match.deck, seatId, "steal")) {
          return finish({ error: "steals-blocked-by-curse", distanceMeters: check.distanceMeters });
        }
      } else if (lm.status === "unclaimed") {
        if (hasActiveClaimCurseBlocker(match.deck, seatId, "claim")) {
          return finish({ error: "claims-blocked-by-curse", distanceMeters: check.distanceMeters });
        }
      }

      if (seat.burnedLandmarks.has(lm.landmarkId)) {
        return finish({ error: "landmark-burned", distanceMeters: check.distanceMeters });
      }
      if ((seat.cooldowns[lm.landmarkId] ?? 0) > now) {
        return finish({ error: "cooldown", distanceMeters: check.distanceMeters });
      }

      // Checking in on an unclaimed landmark claims it immediately (vulnerable!)
      if (lm.status === "unclaimed") {
        lm.status = "claimed";
        lm.ownerSeatId = seat.seatId;
        lm.ownerTeamId = seat.teamId;
        lm.claimedAt = now;
        match.events.push({
          type: "claimed",
          at: now,
          seatId: seat.seatId,
          teamId: seat.teamId,
          landmarkId: lm.landmarkId,
        });
      }

      // Resolve which hidden challenge opens for this lock/steal attempt
      let challenge: ClaimChallengeItem | undefined;
      let fromChallengeHandId: string | undefined;
      if (match.pack.challenges.challengeMode === "challenge_hand") {
        challenge = action.challengeHandId
          ? seat.challengeHand.find((c) => c.id === action.challengeHandId)
          : seat.challengeHand[0];
        if (!challenge) return finish({ error: "challenge-hand-empty", distanceMeters: check.distanceMeters });
        fromChallengeHandId = challenge.id;
      } else {
        challenge = match.assignedLandmarkChallenges[lm.landmarkId];
      }
      if (!challenge) return finish({ error: "challenge-unavailable", distanceMeters: check.distanceMeters });
      delete seat.learningExplanation;

      match.activeAttemptsBySeat[seatId] = {
        seatId,
        landmarkId: lm.landmarkId,
        challenge,
        fromChallengeHandId,
        isStealAttempt,
        currentStep: 0,
        timedStartedAt: null,
        timedDeadline: null,
        pendingPhoto: null,
      };
      return finish({ distanceMeters: check.distanceMeters });
    }

    case "choose-shot-tier": {
      if (match.phase !== "active") return finish({ error: "room-phase-changed" });
      const attempt = match.activeAttemptsBySeat[seatId];
      if (!attempt || attempt.landmarkId !== action.landmarkId) return finish({ error: "no-active-attempt" });
      if (attempt.challenge.payload.primitive !== "call_your_shot") return finish({ error: "not-call-your-shot" });
      if (attempt.chosenTier) return finish({ error: "shot-tier-already-chosen" });
      attempt.chosenTier = action.tier;
      return finish();
    }

    case "start-timed-task": {
      if (match.phase !== "active") return finish({ error: "room-phase-changed" });
      const attempt = match.activeAttemptsBySeat[seatId];
      if (!attempt || attempt.landmarkId !== action.landmarkId) return finish({ error: "no-active-attempt" });
      const leafRes = resolveActiveLeafChallenge(attempt.challenge, attempt);
      if (!leafRes.ok) return finish({ error: leafRes.error });
      if (leafRes.leaf.primitive !== "timed_micro_task") return finish({ error: "not-timed-task" });
      if (attempt.timedStartedAt !== null) return finish();
      attempt.timedStartedAt = now;
      attempt.timedDeadline = Math.min(match.deadline ?? now + leafRes.leaf.timeLimitMs, now + leafRes.leaf.timeLimitMs);
      return finish();
    }

    case "submit-challenge": {
      if (match.phase !== "active") return finish({ error: "room-phase-changed" });
      const attempt = match.activeAttemptsBySeat[seatId];
      if (!attempt || attempt.landmarkId !== action.landmarkId) return finish({ error: "no-active-attempt" });
      if (attempt.pendingPhoto) return finish({ error: "photo-review-pending" });

      const lm = match.landmarks[action.landmarkId];
      if (!lm || lm.status === "locked") {
        delete match.activeAttemptsBySeat[seatId];
        return finish({ error: "already-locked" });
      }

      const leafRes = resolveActiveLeafChallenge(attempt.challenge, attempt);
      if (!leafRes.ok) return finish({ error: leafRes.error });

      const evalOutcome = evaluateLeafSubmission({
        leaf: leafRes.leaf,
        submission: action,
        isSolo: isSoloMatch(match),
        now,
        geography: match.pack.geography,
        timedStartedAt: attempt.timedStartedAt,
        timedDeadline: attempt.timedDeadline,
      });

      if (evalOutcome.status === "wrong") {
        if (evalOutcome.error === "wrong-answer" || evalOutcome.error === "timed-task-expired") {
          failAttempt(match, seat, attempt, now, evalOutcome.error);
        }
        return finish({ error: evalOutcome.error });
      }

      if (evalOutcome.status === "pending_photo_review") {
        attempt.pendingPhoto = {
          photoId: evalOutcome.photoId,
          submittedAt: now,
          autoApproveAt: now + evalOutcome.autoApproveMs,
        };
        return finish();
      }

      // Passed! Track photo ID if solo photo_proof
      if (action.photoId) match.archivedPhotoIds.push(action.photoId);

      if (attempt.challenge.payload.primitive === "multi_step" && attempt.currentStep === 0) {
        attempt.currentStep = 1;
        attempt.timedStartedAt = null;
        attempt.timedDeadline = null;
        return finish();
      }

      const purged = completeAttemptSuccess(match, seat, attempt, now);
      return finish({ purgedPhotoIds: purged });
    }

    case "review-challenge-photo": {
      if (match.phase !== "active") return finish({ error: "room-phase-changed" });
      const targetSeat = findSeat(match, action.targetSeatId);
      const attempt = match.activeAttemptsBySeat[action.targetSeatId];
      if (!targetSeat || !attempt || attempt.landmarkId !== action.landmarkId || !attempt.pendingPhoto) {
        return finish({ error: "no-pending-photo" });
      }
      if (targetSeat.teamId === seat.teamId) return finish({ error: "rival-only" });
      const photoId = attempt.pendingPhoto.photoId;
      attempt.pendingPhoto = null;
      match.archivedPhotoIds.push(photoId);

      if (!action.approve) {
        failAttempt(match, targetSeat, attempt, now, "photo-rejected");
        return finish();
      }
      if (attempt.challenge.payload.primitive === "multi_step" && attempt.currentStep === 0) {
        attempt.currentStep = 1;
        return finish();
      }
      const purged = completeAttemptSuccess(match, targetSeat, attempt, now);
      return finish({ purgedPhotoIds: purged });
    }

    case "bail-challenge": {
      if (match.phase !== "active") return finish({ error: "room-phase-changed" });
      const attempt = match.activeAttemptsBySeat[seatId];
      if (!attempt || attempt.landmarkId !== action.landmarkId) return finish({ error: "no-active-attempt" });
      failAttempt(match, seat, attempt, now, "bailed");
      return finish();
    }

    case "play-card": {
      if (match.phase !== "active") return finish({ error: "room-phase-changed" });
      const hand = match.deck.handsBySeat[seatId] ?? [];
      const card = hand.find((c) => c.instanceId === action.cardInstanceId);
      if (!card) return finish({ error: "card-not-in-hand" });
      const effect = card.effect;

      switch (effect.primitive) {
        case "scout_challenge": {
          const lm = action.landmarkId ? match.landmarks[action.landmarkId] : undefined;
          if (!lm || lm.status === "locked") return finish({ error: "invalid-scout-target" });
          if (!match.assignedLandmarkChallenges[lm.landmarkId]) return finish({ error: "challenge-unavailable" });
          consumeClaimHandCard(match.deck, seatId, card.instanceId);
          seat.scoutedLandmarkIds.add(lm.landmarkId);
          match.events.push({ type: "card_played", at: now, seatId, landmarkId: lm.landmarkId, detail: "scout_challenge" });
          return finish();
        }
        case "shield_claim": {
          if (isSoloMatch(match)) return finish({ error: "multiplayer-only" });
          const lm = action.landmarkId ? match.landmarks[action.landmarkId] : undefined;
          if (!lm || lm.status !== "claimed" || lm.ownerTeamId !== seat.teamId) {
            return finish({ error: "invalid-shield-target" });
          }
          consumeClaimHandCard(match.deck, seatId, card.instanceId);
          lm.shieldUntil = now + effect.durationMs;
          match.events.push({ type: "card_played", at: now, seatId, landmarkId: lm.landmarkId, detail: "shield_claim" });
          return finish();
        }
        case "double_weight": {
          const lm = action.landmarkId ? match.landmarks[action.landmarkId] : undefined;
          if (!lm || lm.status !== "locked" || lm.ownerTeamId !== seat.teamId || lm.doubleWeighted) {
            return finish({ error: "invalid-double-target" });
          }
          consumeClaimHandCard(match.deck, seatId, card.instanceId);
          lm.doubleWeighted = true;
          match.events.push({ type: "card_played", at: now, seatId, landmarkId: lm.landmarkId, detail: "double_weight" });
          return finish();
        }
        case "swap_challenge": {
          const attempt = match.activeAttemptsBySeat[seatId];
          if (!attempt) return finish({ error: "no-active-attempt" });
          const nextBackup = match.unusedBackupChallenges.shift();
          if (!nextBackup) return finish({ error: "backup-pool-exhausted" });
          consumeClaimHandCard(match.deck, seatId, card.instanceId);
          attempt.challenge = nextBackup;
          attempt.chosenTier = undefined;
          attempt.currentStep = 0;
          attempt.timedStartedAt = null;
          attempt.timedDeadline = null;
          attempt.pendingPhoto = null;
          match.events.push({ type: "card_played", at: now, seatId, landmarkId: attempt.landmarkId, detail: "swap_challenge" });
          return finish();
        }
        case "instant_lock": {
          const lm = action.landmarkId ? match.landmarks[action.landmarkId] : undefined;
          if (!lm || lm.status !== "claimed" || lm.ownerTeamId !== seat.teamId) {
            return finish({ error: "invalid-instant-lock-target" });
          }
          consumeClaimHandCard(match.deck, seatId, card.instanceId);
          const attempt: InternalAttempt = match.activeAttemptsBySeat[seatId] ?? {
            seatId,
            landmarkId: lm.landmarkId,
            challenge: match.assignedLandmarkChallenges[lm.landmarkId],
            isStealAttempt: false,
            currentStep: 0,
            timedStartedAt: null,
            timedDeadline: null,
            pendingPhoto: null,
          };
          match.events.push({ type: "card_played", at: now, seatId, landmarkId: lm.landmarkId, detail: "instant_lock" });
          const purged = completeAttemptSuccess(match, seat, attempt, now);
          return finish({ purgedPhotoIds: purged });
        }
        case "sabotage_curse": {
          if (isSoloMatch(match)) return finish({ error: "multiplayer-only" });
          const target = action.targetSeatId ? findSeat(match, action.targetSeatId) : undefined;
          if (!target || target.teamId === seat.teamId) return finish({ error: "invalid-curse-target" });
          const targetActiveCount = match.deck.activeCurses.filter((c) => c.targetSeatId === target.seatId).length;
          if (targetActiveCount >= match.deck.maxActiveCursesPerTarget) {
            return finish({ error: "target-curse-limit-reached" });
          }
          consumeClaimHandCard(match.deck, seatId, card.instanceId);
          let expiresAt: number | null = null;
          if (effect.clearCondition.type === "timer") {
            expiresAt = now + effect.clearCondition.durationMs;
          } else if (effect.clearCondition.type === "gps_detour" && effect.clearCondition.fallbackTimerMs) {
            expiresAt = now + effect.clearCondition.fallbackTimerMs;
          }
          match.deck.activeCurses.push({
            curseInstanceId: randomUUID(),
            cardId: card.cardId,
            title: card.title,
            description: card.description,
            casterSeatId: seatId,
            targetSeatId: target.seatId,
            castAt: now,
            blockerType: effect.blockerType,
            clearCondition: effect.clearCondition,
            expiresAt,
            pendingPhoto: null,
          });
          match.events.push({ type: "curse_cast", at: now, seatId, detail: `${card.cardId}->${target.seatId}` });
          return finish();
        }
      }
    }

    case "clear-curse-gps": {
      if (match.phase !== "active") return finish({ error: "room-phase-changed" });
      const res = clearClaimCurseByGps(match.deck, match.snapshot, match.pack.geography, seatId, action.curseInstanceId, action.fix, now);
      if (!res.ok) return finish({ error: res.error });
      match.events.push({ type: "curse_cleared", at: now, seatId, detail: res.matchedPoiId });
      return finish();
    }

    case "submit-curse-photo": {
      if (match.phase !== "active") return finish({ error: "room-phase-changed" });
      const res = submitClaimCursePhoto(match.deck, seatId, action.curseInstanceId, action.photoId, now);
      if (!res.ok) return finish({ error: res.error });
      return finish();
    }

    case "review-curse-photo": {
      if (match.phase !== "active") return finish({ error: "room-phase-changed" });
      const res = reviewClaimCursePhoto(match.deck, seatId, action.curseInstanceId, action.approve);
      if (!res.ok) return finish({ error: res.error });
      if (res.cleared) match.events.push({ type: "curse_cleared", at: now, seatId });
      return finish({ ...(res.purgedPhotoId ? { purgedPhotoIds: [res.purgedPhotoId] } : {}) });
    }

    case "clear-curse-honor": {
      if (match.phase !== "active") return finish({ error: "room-phase-changed" });
      const res = clearClaimCurseByHonor(match.deck, seatId, action.curseInstanceId, now);
      if (!res.ok) return finish({ error: res.error });
      match.events.push({ type: "curse_cleared", at: now, seatId });
      return finish();
    }
  }
}
