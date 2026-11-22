import { randomInt, randomUUID } from "node:crypto";
import type {
  GeoCoordinate,
  HideSeekQuestionFamily,
  HideSeekRulebookPack,
  LocationFix,
  SeekActiveCurse,
  SeekActiveDrawBatch,
  SeekCardInstance,
  SeekDeckHiderView,
  SeekDeckPublicView,
  SeekDrawBatch,
  SeekPlantedTrap,
} from "@kelana-ria/contracts";
import { verifyGpsAtPoint, verifyGpsFreshAndAccurate } from "./geo-evaluator.js";
import { haversineMeters } from "./rulebook-validator.js";
import {
  cancelPendingQuestionForVeto,
  randomizePendingQuestion,
  recordTurnScoreAdjustment,
  startMoveZoneRelocation,
  type SeekEngineMatch,
} from "./seek-engine.js";

export type SeekDeckEngineState = {
  drawPile: SeekCardInstance[];
  discardPile: SeekCardInstance[];
  hand: SeekCardInstance[];
  currentHandLimit: number;
  maxActiveBlockingCurses: number;
  queuedBatches: SeekDrawBatch[];
  activeDraw: SeekActiveDrawBatch | null;
  plantedTraps: SeekPlantedTrap[];
  activeCurses: SeekActiveCurse[];
  rngInt: (maxExclusive: number) => number;
};

function shuffleCards(cards: SeekCardInstance[], rngInt: (maxExclusive: number) => number): SeekCardInstance[] {
  const copy = [...cards];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.abs(rngInt(i + 1)) % (i + 1);
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

export function createSeekDeckState(
  pack: HideSeekRulebookPack,
  options: { rngInt?: (maxExclusive: number) => number } = {},
): SeekDeckEngineState {
  const rngInt = options.rngInt ?? ((max) => randomInt(0, max));
  const instances: SeekCardInstance[] = [];
  for (const def of pack.deck.cards) {
    for (let i = 0; i < def.copies; i++) {
      instances.push({
        instanceId: randomUUID(),
        cardId: def.id,
        category: def.category,
        title: def.title,
        description: def.description,
        effect: def.effect,
      });
    }
  }
  return {
    drawPile: shuffleCards(instances, rngInt),
    discardPile: [],
    hand: [],
    currentHandLimit: pack.deck.baseHandLimit,
    maxActiveBlockingCurses: pack.deck.maxActiveBlockingCurses,
    queuedBatches: [],
    activeDraw: null,
    plantedTraps: [],
    activeCurses: [],
    rngInt,
  };
}

function drawFromPile(state: SeekDeckEngineState, count: number): SeekCardInstance[] {
  const drawn: SeekCardInstance[] = [];
  for (let i = 0; i < count; i++) {
    if (state.drawPile.length === 0) {
      if (state.discardPile.length === 0) break;
      state.drawPile = shuffleCards(state.discardPile, state.rngInt);
      state.discardPile = [];
    }
    const next = state.drawPile.pop();
    if (!next) break;
    drawn.push(next);
  }
  return drawn;
}

function discardFromHand(state: SeekDeckEngineState, instanceIds: string[]) {
  const dropSet = new Set(instanceIds);
  const removed = state.hand.filter((c) => dropSet.has(c.instanceId));
  state.discardPile.push(...removed);
  state.hand = state.hand.filter((c) => !dropSet.has(c.instanceId));
}

function openNextDrawBatch(state: SeekDeckEngineState, match: SeekEngineMatch, now: number) {
  while (!state.activeDraw && state.queuedBatches.length > 0) {
    const batch = state.queuedBatches.shift()!;
    const cards = drawFromPile(state, batch.drawCount);
    if (cards.length === 0) continue;
    const keepCount = Math.min(batch.keepCount, cards.length);
    const deadline = Math.min(
      match.phaseEndsAt ?? now + match.pack.timers.drawDecisionMs,
      now + match.pack.timers.drawDecisionMs,
    );
    state.activeDraw = { cards, keepCount, deadline };
    // Auto-complete immediately if keeping all drawn cards fits cleanly inside hand limit
    if (keepCount === cards.length && state.hand.length + cards.length <= state.currentHandLimit) {
      state.hand.push(...cards);
      state.activeDraw = null;
    }
  }
}

export function enqueueSeekDrawBatches(
  state: SeekDeckEngineState,
  match: SeekEngineMatch,
  batches: SeekDrawBatch[],
  now: number,
) {
  if (batches.length === 0) return;
  state.queuedBatches.push(...batches);
  openNextDrawBatch(state, match, now);
}

export function autoResolveActiveDraw(state: SeekDeckEngineState, match: SeekEngineMatch, now: number): boolean {
  if (!state.activeDraw) return false;
  const keepIds = state.activeDraw.cards.slice(0, state.activeDraw.keepCount).map((c) => c.instanceId);
  const keepSet = new Set(keepIds);
  for (const card of state.activeDraw.cards) {
    if (keepSet.has(card.instanceId) && state.hand.length < state.currentHandLimit) {
      state.hand.push(card);
    } else {
      state.discardPile.push(card);
    }
  }
  state.activeDraw = null;
  openNextDrawBatch(state, match, now);
  return true;
}

export function resolveAllPendingDrawsOnTurnEnd(state: SeekDeckEngineState, match: SeekEngineMatch, now: number) {
  openNextDrawBatch(state, match, now);
  while (state.activeDraw) {
    autoResolveActiveDraw(state, match, now);
  }
}

export function chooseSeekDrawCards(
  state: SeekDeckEngineState,
  match: SeekEngineMatch,
  params: { keepInstanceIds: string[]; discardInstanceIds?: string[] },
  now: number,
): { ok: true } | { ok: false; error: string } {
  const draw = state.activeDraw;
  if (!draw) return { ok: false, error: "no-active-draw" };
  const keepSet = new Set(params.keepInstanceIds);
  if (
    keepSet.size !== draw.keepCount ||
    keepSet.size !== params.keepInstanceIds.length ||
    !params.keepInstanceIds.every((id) => draw.cards.some((c) => c.instanceId === id))
  ) {
    return { ok: false, error: "invalid-draw-selection" };
  }

  const excess = Math.max(0, state.hand.length + keepSet.size - state.currentHandLimit);
  const discardIds = params.discardInstanceIds ?? [];
  const discardSet = new Set(discardIds);
  if (discardIds.length !== excess || discardSet.size !== excess) {
    return { ok: false, error: "hand-limit-discard-required" };
  }
  const eligibleDiscardIds = new Set([...state.hand.map((c) => c.instanceId), ...keepSet]);
  if (!discardIds.every((id) => eligibleDiscardIds.has(id))) {
    return { ok: false, error: "invalid-discard-selection" };
  }

  discardFromHand(state, discardIds.filter((id) => !keepSet.has(id)));
  for (const card of draw.cards) {
    if (keepSet.has(card.instanceId) && !discardSet.has(card.instanceId)) {
      state.hand.push(card);
    } else {
      state.discardPile.push(card);
    }
  }
  state.activeDraw = null;
  openNextDrawBatch(state, match, now);
  return { ok: true };
}

export function syncCursesToMatch(state: SeekDeckEngineState, match: SeekEngineMatch, now: number) {
  let maxQuestionBlockUntil: number | null = null;
  let extraDraw = 0;
  const bannedFamilies: Partial<Record<HideSeekQuestionFamily, number>> = {};

  for (const curse of state.activeCurses) {
    const effectiveUntil = curse.expiresAt ?? Number.MAX_SAFE_INTEGER;
    if (curse.blockerType === "block_questions" || curse.blockerType === "block_both") {
      maxQuestionBlockUntil =
        maxQuestionBlockUntil === null ? effectiveUntil : Math.max(maxQuestionBlockUntil, effectiveUntil);
    }
    for (const mod of curse.effectModifiers) {
      if (mod.type === "inflate_question_draws") {
        extraDraw += mod.extraDraws;
      } else if (mod.type === "ban_question_family") {
        const prev = bannedFamilies[mod.family] ?? 0;
        bannedFamilies[mod.family] = Math.max(prev, effectiveUntil);
      }
    }
  }

  match.questionBlockedUntil = maxQuestionBlockUntil && maxQuestionBlockUntil > now ? maxQuestionBlockUntil : null;
  match.bannedFamilies = bannedFamilies;
  match.extraDrawPerQuestion = extraDraw;
}

export function expireSeekDeckAndCurses(
  state: SeekDeckEngineState,
  match: SeekEngineMatch,
  now: number,
): { changed: boolean; autoApprovedCurseIds: string[]; expiredCurseIds: string[] } {
  let changed = false;
  const autoApprovedCurseIds: string[] = [];
  const expiredCurseIds: string[] = [];

  if (state.activeDraw && state.activeDraw.deadline <= now) {
    autoResolveActiveDraw(state, match, now);
    changed = true;
  }

  const remainingCurses: SeekActiveCurse[] = [];
  for (const curse of state.activeCurses) {
    if (curse.pendingPhoto && curse.pendingPhoto.autoApproveAt <= now) {
      autoApprovedCurseIds.push(curse.curseInstanceId);
      changed = true;
      continue;
    }
    if (curse.expiresAt !== null && curse.expiresAt <= now) {
      expiredCurseIds.push(curse.curseInstanceId);
      changed = true;
      continue;
    }
    remainingCurses.push(curse);
  }
  state.activeCurses = remainingCurses;
  syncCursesToMatch(state, match, now);

  return { changed, autoApprovedCurseIds, expiredCurseIds };
}

export function onSeekerQuestionAskedForCurses(
  state: SeekDeckEngineState,
  match: SeekEngineMatch,
  now: number,
): { clearedCurseIds: string[] } {
  const clearedCurseIds: string[] = [];
  const remaining: SeekActiveCurse[] = [];
  for (const curse of state.activeCurses) {
    if (curse.clearCondition.type === "next_n_questions" && curse.remainingQuestions !== null) {
      curse.remainingQuestions -= 1;
      if (curse.remainingQuestions <= 0) {
        clearedCurseIds.push(curse.curseInstanceId);
        continue;
      }
    }
    remaining.push(curse);
  }
  state.activeCurses = remaining;
  syncCursesToMatch(state, match, now);
  return { clearedCurseIds };
}

export function checkSeekTimeTraps(
  state: SeekDeckEngineState,
  match: SeekEngineMatch,
  seekerFix: LocationFix,
  now: number,
): { triggeredTraps: SeekPlantedTrap[] } {
  const fresh = verifyGpsFreshAndAccurate(seekerFix, now, match.pack.geography);
  if (!fresh.ok) return { triggeredTraps: [] };

  const triggeredTraps: SeekPlantedTrap[] = [];
  for (const trap of state.plantedTraps) {
    if (trap.triggeredAt !== null) continue;
    const station = match.snapshot.stations.find((s) => s.id === trap.stationId);
    if (!station) continue;
    const check = verifyGpsAtPoint(station, seekerFix, now, match.pack.geography);
    if (check.ok) {
      trap.triggeredAt = now;
      recordTurnScoreAdjustment(match, { trapBonusMs: trap.bonusMinutes * 60_000 });
      triggeredTraps.push(trap);
    }
  }
  return { triggeredTraps };
}

export type PlaySeekCardParams = {
  cardInstanceId: string;
  targetCardInstanceId?: string;
  discardInstanceIds?: string[];
  trapStationId?: string;
  seekerPosition?: GeoCoordinate;
  revealedClueValue?: string;
};

export function playSeekDeckCard(
  state: SeekDeckEngineState,
  match: SeekEngineMatch,
  params: PlaySeekCardParams,
  now: number,
):
  | {
      ok: true;
      primitive: SeekCardInstance["effect"]["primitive"];
      curse?: SeekActiveCurse;
      trap?: SeekPlantedTrap;
      revealedOldAnchorStationId?: string | null;
      randomizedItemId?: string;
    }
  | { ok: false; error: string } {
  expireSeekDeckAndCurses(state, match, now);

  if (match.phase !== "seeking" && match.phase !== "endgame") {
    return { ok: false, error: "room-phase-changed" };
  }
  if (state.activeDraw) {
    return { ok: false, error: "draw-pending" };
  }

  const card = state.hand.find((c) => c.instanceId === params.cardInstanceId);
  if (!card) return { ok: false, error: "card-not-in-hand" };

  const effect = card.effect;
  const hasPendingQuestion = match.questions.some((q) => q.status === "pending");

  switch (effect.primitive) {
    case "time_bonus":
      return { ok: false, error: "time-bonus-not-playable" };

    case "veto": {
      if (!hasPendingQuestion) return { ok: false, error: "no-pending-question" };
      const res = cancelPendingQuestionForVeto(match, now);
      if (!res.ok) return res;
      discardFromHand(state, [card.instanceId]);
      return { ok: true, primitive: "veto" };
    }

    case "randomize": {
      if (!hasPendingQuestion) return { ok: false, error: "no-pending-question" };
      const res = randomizePendingQuestion(match, now, state.rngInt);
      if (!res.ok) return res;
      discardFromHand(state, [card.instanceId]);
      return { ok: true, primitive: "randomize", randomizedItemId: res.question.itemId };
    }

    case "duplicate": {
      if (hasPendingQuestion) return { ok: false, error: "question-pending" };
      const target = state.hand.find(
        (c) => c.instanceId === params.targetCardInstanceId && c.instanceId !== card.instanceId,
      );
      if (!target) return { ok: false, error: "invalid-duplicate-target" };
      if (effect.targetCategories && !effect.targetCategories.includes(target.category)) {
        return { ok: false, error: "duplicate-category-disallowed" };
      }
      if (target.effect.primitive === "move_zone" && !effect.allowDuplicateMove) {
        return { ok: false, error: "duplicate-move-disallowed" };
      }
      discardFromHand(state, [card.instanceId]);
      state.hand.push({
        ...target,
        instanceId: randomUUID(),
      });
      return { ok: true, primitive: "duplicate" };
    }

    case "expand_hand": {
      discardFromHand(state, [card.instanceId]);
      state.currentHandLimit += effect.extraSlots;
      return { ok: true, primitive: "expand_hand" };
    }

    case "discard_draw": {
      if (hasPendingQuestion) return { ok: false, error: "question-pending" };
      const discardIds = params.discardInstanceIds ?? [];
      const unique = new Set(discardIds);
      if (
        discardIds.length !== effect.discardCount ||
        unique.size !== effect.discardCount ||
        unique.has(card.instanceId) ||
        !discardIds.every((id) => state.hand.some((c) => c.instanceId === id))
      ) {
        return { ok: false, error: "invalid-discard-selection" };
      }
      discardFromHand(state, [card.instanceId, ...discardIds]);
      enqueueSeekDrawBatches(state, match, [{ drawCount: effect.drawCount, keepCount: effect.keepCount }], now);
      return { ok: true, primitive: "discard_draw" };
    }

    case "time_trap": {
      if (match.phase !== "seeking") return { ok: false, error: "seeking-only" };
      if (!params.trapStationId || params.trapStationId === match.anchorStationId) {
        return { ok: false, error: "invalid-trap-station" };
      }
      const station = match.snapshot.stations.find((s) => s.id === params.trapStationId);
      if (!station) return { ok: false, error: "invalid-trap-station" };
      if (state.plantedTraps.some((t) => t.stationId === station.id && t.triggeredAt === null)) {
        return { ok: false, error: "station-already-trapped" };
      }
      discardFromHand(state, [card.instanceId]);
      const trap: SeekPlantedTrap = {
        trapId: randomUUID(),
        stationId: station.id,
        stationName: station.name,
        bonusMinutes: effect.bonusMinutes,
        plantedAt: now,
        triggeredAt: null,
      };
      state.plantedTraps.push(trap);
      return { ok: true, primitive: "time_trap", trap };
    }

    case "move_zone": {
      const moveRes = startMoveZoneRelocation(match, now, effect.travelWindowMs, effect.revealOldStation);
      if (!moveRes.ok) return moveRes;
      if (effect.discardHand) {
        discardFromHand(
          state,
          state.hand.map((c) => c.instanceId),
        );
      } else {
        discardFromHand(state, [card.instanceId]);
      }
      return {
        ok: true,
        primitive: "move_zone",
        revealedOldAnchorStationId: moveRes.revealedOldAnchorStationId,
      };
    }

    case "curse": {
      const curseDef = effect.curse;
      const isBlocking = curseDef.blockerType !== "none";
      const activeBlockingCount = state.activeCurses.filter((c) => c.blockerType !== "none").length;
      if (isBlocking && activeBlockingCount >= state.maxActiveBlockingCurses) {
        return { ok: false, error: "blocking-curse-limit-reached" };
      }

      const anchor = match.snapshot.stations.find((s) => s.id === match.anchorStationId);
      const discardsToConsume: string[] = [];
      let revealedClue: SeekActiveCurse["revealedClue"];

      for (const cost of curseDef.castingCosts) {
        switch (cost.type) {
          case "none":
            break;
          case "discard_cards": {
            const ids = params.discardInstanceIds ?? [];
            const unique = new Set(ids);
            if (
              ids.length !== cost.count ||
              unique.size !== cost.count ||
              unique.has(card.instanceId)
            ) {
              return { ok: false, error: "casting-cost-discard-unmet" };
            }
            for (const id of ids) {
              const held = state.hand.find((c) => c.instanceId === id);
              if (!held) return { ok: false, error: "casting-cost-discard-unmet" };
              if (cost.category && cost.category !== "any" && held.category !== cost.category) {
                return { ok: false, error: "casting-cost-category-unmet" };
              }
            }
            discardsToConsume.push(...ids);
            break;
          }
          case "seeker_min_distance": {
            if (!anchor || !params.seekerPosition) return { ok: false, error: "casting-cost-distance-unmet" };
            if (haversineMeters(anchor, params.seekerPosition) < cost.meters) {
              return { ok: false, error: "casting-cost-distance-unmet" };
            }
            break;
          }
          case "seeker_max_distance": {
            if (!anchor || !params.seekerPosition) return { ok: false, error: "casting-cost-distance-unmet" };
            if (haversineMeters(anchor, params.seekerPosition) > cost.meters) {
              return { ok: false, error: "casting-cost-distance-unmet" };
            }
            break;
          }
          case "reveal_clue": {
            if (!params.revealedClueValue || !params.revealedClueValue.trim()) {
              return { ok: false, error: "casting-cost-clue-required" };
            }
            revealedClue = {
              clueType: cost.clueType,
              detail: cost.detail,
              value: params.revealedClueValue.trim(),
            };
            break;
          }
        }
      }

      discardFromHand(state, [card.instanceId, ...discardsToConsume]);

      let expiresAt: number | null = null;
      let remainingQuestions: number | null = null;
      if (curseDef.clearCondition.type === "timer") {
        expiresAt = now + curseDef.clearCondition.durationMs;
      } else if (curseDef.clearCondition.type === "gps_detour" && curseDef.clearCondition.fallbackTimerMs) {
        expiresAt = now + curseDef.clearCondition.fallbackTimerMs;
      } else if (curseDef.clearCondition.type === "next_n_questions") {
        remainingQuestions = curseDef.clearCondition.count;
      }

      const activeCurse: SeekActiveCurse = {
        curseInstanceId: randomUUID(),
        cardId: card.cardId,
        title: card.title,
        description: card.description,
        castAt: now,
        blockerType: curseDef.blockerType,
        effectModifiers: [...(curseDef.effectModifiers ?? [])],
        clearCondition: curseDef.clearCondition,
        expiresAt,
        remainingQuestions,
        ...(revealedClue ? { revealedClue } : {}),
        pendingPhoto: null,
      };
      state.activeCurses.push(activeCurse);
      syncCursesToMatch(state, match, now);
      return { ok: true, primitive: "curse", curse: activeCurse };
    }
  }
}

export function clearCurseByGpsDetour(
  state: SeekDeckEngineState,
  match: SeekEngineMatch,
  curseInstanceId: string,
  fix: LocationFix,
  now: number,
): { ok: true; matchedPoiId: string } | { ok: false; error: string } {
  expireSeekDeckAndCurses(state, match, now);
  const idx = state.activeCurses.findIndex((c) => c.curseInstanceId === curseInstanceId);
  if (idx === -1) return { ok: false, error: "curse-not-active" };
  const curse = state.activeCurses[idx];
  if (curse.clearCondition.type !== "gps_detour") return { ok: false, error: "wrong-clear-method" };
  const fresh = verifyGpsFreshAndAccurate(fix, now, match.pack.geography);
  if (!fresh.ok) return fresh;

  const { poiCategory, radiusMeters } = curse.clearCondition;
  const matchingPois = match.snapshot.pois.filter((p) => p.category === poiCategory);
  for (const poi of matchingPois) {
    const check = verifyGpsAtPoint(poi, fix, now, match.pack.geography, radiusMeters);
    if (check.ok) {
      state.activeCurses.splice(idx, 1);
      syncCursesToMatch(state, match, now);
      return { ok: true, matchedPoiId: poi.id };
    }
  }
  return { ok: false, error: "outside-detour-poi-radius" };
}

export function submitCursePhotoProof(
  state: SeekDeckEngineState,
  match: SeekEngineMatch,
  params: { curseInstanceId: string; seatId: string; photoId: string },
  now: number,
): { ok: true; autoApproveAt: number } | { ok: false; error: string } {
  expireSeekDeckAndCurses(state, match, now);
  const curse = state.activeCurses.find((c) => c.curseInstanceId === params.curseInstanceId);
  if (!curse) return { ok: false, error: "curse-not-active" };
  if (curse.clearCondition.type !== "photo_challenge") return { ok: false, error: "wrong-clear-method" };
  if (!params.photoId.trim()) return { ok: false, error: "photo-required" };
  const autoApproveAt = now + curse.clearCondition.autoApproveMs;
  curse.pendingPhoto = {
    photoId: params.photoId,
    submittedBySeatId: params.seatId,
    submittedAt: now,
    autoApproveAt,
  };
  return { ok: true, autoApproveAt };
}

export function reviewCursePhotoProof(
  state: SeekDeckEngineState,
  match: SeekEngineMatch,
  params: { curseInstanceId: string; approve: boolean },
  now: number,
): { ok: true; cleared: boolean } | { ok: false; error: string } {
  expireSeekDeckAndCurses(state, match, now);
  const idx = state.activeCurses.findIndex((c) => c.curseInstanceId === params.curseInstanceId);
  if (idx === -1) return { ok: false, error: "curse-not-active" };
  const curse = state.activeCurses[idx];
  if (!curse.pendingPhoto) return { ok: false, error: "no-pending-curse-photo" };
  if (params.approve) {
    state.activeCurses.splice(idx, 1);
    syncCursesToMatch(state, match, now);
    return { ok: true, cleared: true };
  }
  curse.pendingPhoto = null;
  return { ok: true, cleared: false };
}

export function clearCurseByHonorTask(
  state: SeekDeckEngineState,
  match: SeekEngineMatch,
  curseInstanceId: string,
  now: number,
): { ok: true } | { ok: false; error: string } {
  expireSeekDeckAndCurses(state, match, now);
  const idx = state.activeCurses.findIndex((c) => c.curseInstanceId === curseInstanceId);
  if (idx === -1) return { ok: false, error: "curse-not-active" };
  const curse = state.activeCurses[idx];
  if (curse.clearCondition.type !== "honor_task") return { ok: false, error: "wrong-clear-method" };
  const minDuration = curse.clearCondition.minDurationMs ?? 0;
  if (now - curse.castAt < minDuration) return { ok: false, error: "honor-task-min-duration-unmet" };
  state.activeCurses.splice(idx, 1);
  syncCursesToMatch(state, match, now);
  return { ok: true };
}

export function buyoutSeekCurse(
  state: SeekDeckEngineState,
  match: SeekEngineMatch,
  curseInstanceId: string,
  now: number,
): { ok: true; grantedBonusMs: number } | { ok: false; error: string } {
  expireSeekDeckAndCurses(state, match, now);
  const idx = state.activeCurses.findIndex((c) => c.curseInstanceId === curseInstanceId);
  if (idx === -1) return { ok: false, error: "curse-not-active" };
  const curse = state.activeCurses[idx];
  const penaltyMod = curse.effectModifiers.find((m) => m.type === "skip_penalty_minutes");
  if (!penaltyMod || penaltyMod.type !== "skip_penalty_minutes") {
    return { ok: false, error: "curse-not-buyable" };
  }
  const grantedBonusMs = Math.round(penaltyMod.penaltyMinutes * 60_000);
  state.activeCurses.splice(idx, 1);
  syncCursesToMatch(state, match, now);
  recordTurnScoreAdjustment(match, { bonusMs: grantedBonusMs });
  return { ok: true, grantedBonusMs };
}

export function computeHeldTimeBonusMs(state: SeekDeckEngineState, rawHidingMs: number): number {
  let totalMs = 0;
  for (const card of state.hand) {
    if (card.effect.primitive !== "time_bonus") continue;
    if (card.effect.minutes !== undefined) {
      totalMs += Math.round(card.effect.minutes * 60_000);
    } else if (card.effect.percentOfRawTime !== undefined) {
      totalMs += Math.round((rawHidingMs * card.effect.percentOfRawTime) / 100);
    }
  }
  return totalMs;
}

export function viewSeekDeck(state: SeekDeckEngineState, isHider: boolean): SeekDeckPublicView | SeekDeckHiderView {
  const questionsBlocked = state.activeCurses.some(
    (c) => c.blockerType === "block_questions" || c.blockerType === "block_both",
  );
  const transitBlocked = state.activeCurses.some(
    (c) => c.blockerType === "block_transit" || c.blockerType === "block_both",
  );
  const bannedFamilies = [
    ...new Set(
      state.activeCurses.flatMap((c) =>
        c.effectModifiers.filter((m) => m.type === "ban_question_family").map((m) => m.family),
      ),
    ),
  ];
  const extraDrawPerQuestion = state.activeCurses.reduce(
    (sum, c) =>
      sum +
      c.effectModifiers
        .filter((m) => m.type === "inflate_question_draws")
        .reduce((acc, m) => acc + m.extraDraws, 0),
    0,
  );
  const base: SeekDeckPublicView = {
    drawPileCount: state.drawPile.length,
    discardPileCount: state.discardPile.length,
    hiderHandCount: state.hand.length,
    currentHandLimit: state.currentHandLimit,
    activeCurses: state.activeCurses.map((c) => ({ ...c })),
    triggeredTraps: state.plantedTraps.filter((t) => t.triggeredAt !== null).map((t) => ({ ...t })),
    questionsBlocked,
    transitBlocked,
    bannedFamilies,
    extraDrawPerQuestion,
  };
  if (!isHider) return base;
  return {
    ...base,
    hand: state.hand.map((c) => ({ ...c })),
    activeDraw: state.activeDraw ? { ...state.activeDraw, cards: [...state.activeDraw.cards] } : null,
    queuedBatchCount: state.queuedBatches.length,
    plantedTraps: state.plantedTraps.map((t) => ({ ...t })),
  };
}
