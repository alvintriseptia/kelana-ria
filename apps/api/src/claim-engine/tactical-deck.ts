import { randomInt, randomUUID } from "node:crypto";
import type {
  ClaimActiveCurse,
  ClaimCardInstance,
  ClaimRulebookPack,
  GeoSnapshot,
  LocationFix,
} from "@kelana-ria/contracts";
import { verifyGpsAtPoint, verifyGpsFreshAndAccurate } from "../seek-engine/geo-evaluator.js";

const MULTIPLAYER_ONLY_PRIMITIVES = new Set(["shield_claim", "sabotage_curse"]);

export type ClaimTacticalDeckState = {
  enabled: boolean;
  maxHandSize: number;
  maxActiveCursesPerTarget: number;
  drawPile: ClaimCardInstance[];
  discardPile: ClaimCardInstance[];
  handsBySeat: Record<string, ClaimCardInstance[]>;
  activeCurses: ClaimActiveCurse[];
  rngInt: (maxExclusive: number) => number;
};

function shuffleCards(cards: ClaimCardInstance[], rngInt: (maxExclusive: number) => number): ClaimCardInstance[] {
  const copy = [...cards];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.abs(rngInt(i + 1)) % (i + 1);
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

export function createClaimTacticalDeck(
  pack: ClaimRulebookPack,
  isSolo: boolean,
  options: { rngInt?: (maxExclusive: number) => number } = {},
): ClaimTacticalDeckState {
  const rngInt = options.rngInt ?? ((max) => randomInt(0, max));
  const instances: ClaimCardInstance[] = [];
  if (pack.tacticalDeck.enabled) {
    for (const def of pack.tacticalDeck.cards) {
      if (isSolo && MULTIPLAYER_ONLY_PRIMITIVES.has(def.effect.primitive)) continue;
      for (let i = 0; i < def.copies; i++) {
        instances.push({
          instanceId: randomUUID(),
          cardId: def.id,
          title: def.title,
          description: def.description,
          effect: def.effect,
        });
      }
    }
  }
  return {
    enabled: pack.tacticalDeck.enabled,
    maxHandSize: pack.tacticalDeck.maxHandSize,
    maxActiveCursesPerTarget: pack.tacticalDeck.maxActiveCursesPerTarget,
    drawPile: shuffleCards(instances, rngInt),
    discardPile: [],
    handsBySeat: {},
    activeCurses: [],
    rngInt,
  };
}

export function drawClaimTacticalCard(state: ClaimTacticalDeckState, seatId: string): ClaimCardInstance | null {
  if (!state.enabled) return null;
  const hand = (state.handsBySeat[seatId] ??= []);
  if (hand.length >= state.maxHandSize) return null;
  if (state.drawPile.length === 0) {
    if (state.discardPile.length === 0) return null;
    state.drawPile = shuffleCards(state.discardPile, state.rngInt);
    state.discardPile = [];
  }
  const next = state.drawPile.pop();
  if (!next) return null;
  hand.push(next);
  return next;
}

export function consumeClaimHandCard(
  state: ClaimTacticalDeckState,
  seatId: string,
  cardInstanceId: string,
): ClaimCardInstance | null {
  const hand = state.handsBySeat[seatId] ?? [];
  const idx = hand.findIndex((c) => c.instanceId === cardInstanceId);
  if (idx === -1) return null;
  const [card] = hand.splice(idx, 1);
  state.discardPile.push(card);
  return card;
}

export function hasActiveClaimCurseBlocker(
  state: ClaimTacticalDeckState,
  seatId: string,
  action: "claim" | "steal",
): boolean {
  return state.activeCurses.some((curse) => {
    if (curse.targetSeatId !== seatId) return false;
    if (curse.blockerType === "block_both") return true;
    return action === "claim" ? curse.blockerType === "block_claims" : curse.blockerType === "block_steals";
  });
}

export function expireClaimCurses(state: ClaimTacticalDeckState, now: number): { changed: boolean; purgedPhotoIds: string[] } {
  let changed = false;
  const purgedPhotoIds: string[] = [];
  const remaining: ClaimActiveCurse[] = [];

  for (const curse of state.activeCurses) {
    if (curse.pendingPhoto && curse.pendingPhoto.autoApproveAt <= now) {
      purgedPhotoIds.push(curse.pendingPhoto.photoId);
      changed = true;
      continue;
    }
    if (curse.expiresAt !== null && curse.expiresAt <= now) {
      if (curse.pendingPhoto) purgedPhotoIds.push(curse.pendingPhoto.photoId);
      changed = true;
      continue;
    }
    remaining.push(curse);
  }
  state.activeCurses = remaining;
  return { changed, purgedPhotoIds };
}

export function clearClaimCurseByGps(
  state: ClaimTacticalDeckState,
  snapshot: GeoSnapshot,
  geography: ClaimRulebookPack["geography"],
  seatId: string,
  curseInstanceId: string,
  fix: LocationFix,
  now: number,
): { ok: true; matchedPoiId: string } | { ok: false; error: string } {
  const idx = state.activeCurses.findIndex((c) => c.curseInstanceId === curseInstanceId && c.targetSeatId === seatId);
  if (idx === -1) return { ok: false, error: "curse-not-active" };
  const curse = state.activeCurses[idx];
  const clear = curse.clearCondition;
  if (clear.type !== "gps_detour") return { ok: false, error: "wrong-clear-method" };
  const fresh = verifyGpsFreshAndAccurate(fix, now, geography);
  if (!fresh.ok) return fresh;
  const pois = snapshot.pois.filter((p) => p.category === clear.poiCategory);
  for (const poi of pois) {
    const check = verifyGpsAtPoint(poi, fix, now, geography, clear.radiusMeters);
    if (check.ok) {
      state.activeCurses.splice(idx, 1);
      return { ok: true, matchedPoiId: poi.id };
    }
  }
  return { ok: false, error: "outside-detour-poi-radius" };
}

export function submitClaimCursePhoto(
  state: ClaimTacticalDeckState,
  seatId: string,
  curseInstanceId: string,
  photoId: string,
  now: number,
): { ok: true; autoApproveAt: number } | { ok: false; error: string } {
  const curse = state.activeCurses.find((c) => c.curseInstanceId === curseInstanceId && c.targetSeatId === seatId);
  if (!curse) return { ok: false, error: "curse-not-active" };
  if (curse.clearCondition.type !== "photo_challenge") return { ok: false, error: "wrong-clear-method" };
  if (!photoId.trim()) return { ok: false, error: "photo-required" };
  const autoApproveAt = now + curse.clearCondition.autoApproveMs;
  curse.pendingPhoto = { photoId: photoId.trim(), submittedAt: now, autoApproveAt };
  return { ok: true, autoApproveAt };
}

export function reviewClaimCursePhoto(
  state: ClaimTacticalDeckState,
  reviewerSeatId: string,
  curseInstanceId: string,
  approve: boolean,
): { ok: true; cleared: boolean; purgedPhotoId?: string } | { ok: false; error: string } {
  const idx = state.activeCurses.findIndex((c) => c.curseInstanceId === curseInstanceId);
  if (idx === -1) return { ok: false, error: "curse-not-active" };
  const curse = state.activeCurses[idx];
  if (curse.targetSeatId === reviewerSeatId) return { ok: false, error: "rival-only" };
  if (!curse.pendingPhoto) return { ok: false, error: "no-pending-curse-photo" };
  const photoId = curse.pendingPhoto.photoId;
  if (approve) {
    state.activeCurses.splice(idx, 1);
    return { ok: true, cleared: true, purgedPhotoId: photoId };
  }
  curse.pendingPhoto = null;
  return { ok: true, cleared: false, purgedPhotoId: photoId };
}

export function clearClaimCurseByHonor(
  state: ClaimTacticalDeckState,
  seatId: string,
  curseInstanceId: string,
  now: number,
): { ok: true } | { ok: false; error: string } {
  const idx = state.activeCurses.findIndex((c) => c.curseInstanceId === curseInstanceId && c.targetSeatId === seatId);
  if (idx === -1) return { ok: false, error: "curse-not-active" };
  const curse = state.activeCurses[idx];
  if (curse.clearCondition.type !== "honor_task") return { ok: false, error: "wrong-clear-method" };
  const minDuration = curse.clearCondition.minDurationMs ?? 0;
  if (now - curse.castAt < minDuration) return { ok: false, error: "honor-task-min-duration-unmet" };
  state.activeCurses.splice(idx, 1);
  return { ok: true };
}
