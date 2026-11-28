import assert from "node:assert/strict";
import test from "node:test";
import * as api from "../dist/index.js";

const MINUTE = 60_000;
const T0 = 1_800_000_000_000;

function fixAt(point, timestamp, accuracy = 10) {
  return { latitude: point.latitude, longitude: point.longitude, accuracy, timestamp };
}

function challenge(id, payload) {
  return {
    id,
    title: `Task ${id}`,
    verificationNotes: "Public street observation.",
    reviewed: true,
    reviewedAt: "2026-11-22",
    payload,
  };
}

function buildClaimFixture() {
  const base = {
    id: "claim-harbor-v1",
    boundaryPolygon: [
      { latitude: 2.0, longitude: 101.0 },
      { latitude: 2.0, longitude: 101.05 },
      { latitude: 2.05, longitude: 101.05 },
      { latitude: 2.05, longitude: 101.0 },
    ],
    startPoint: { id: "start", name: "Start Gate", latitude: 2.025, longitude: 101.025, accessNotes: "Public steps." },
    stations: [],
    pois: [
      { id: "park-1", name: "East Park", category: "park", latitude: 2.03, longitude: 101.03 },
      { id: "park-2", name: "West Park", category: "park", latitude: 2.02, longitude: 101.02 },
    ],
    attributions: [{ source: "ClaimHarbor", retrievedAt: "2026-11-22T00:00:00Z", notice: "Synthetic." }],
  };
  const snapshot = { ...base, hash: api.computeGeoSnapshotHash(base) };
  const landmarks = [
    { id: "lm-1", name: "Pier Clock", zoneId: "z-n", latitude: 2.03, longitude: 101.025, transitSummary: "Tram 1", accessNotes: "Public", publicHours: "06-22", estimatedTravelFromStartMs: 5 * MINUTE },
    { id: "lm-2", name: "Boat Arch", zoneId: "z-n", latitude: 2.032, longitude: 101.028, transitSummary: "Tram 1", accessNotes: "Public", publicHours: "06-22", estimatedTravelFromStartMs: 6 * MINUTE },
    { id: "lm-3", name: "Bell Plaza", zoneId: "z-n", latitude: 2.028, longitude: 101.022, transitSummary: "Tram 2", accessNotes: "Public", publicHours: "06-22", estimatedTravelFromStartMs: 6 * MINUTE },
    { id: "lm-4", name: "Fountain", zoneId: "z-s", latitude: 2.02, longitude: 101.025, transitSummary: "Bus 3", accessNotes: "Public", publicHours: "06-22", estimatedTravelFromStartMs: 6 * MINUTE },
    { id: "lm-5", name: "Iron Bridge", zoneId: "z-s", latitude: 2.018, longitude: 101.028, transitSummary: "Bus 3", accessNotes: "Public", publicHours: "06-22", estimatedTravelFromStartMs: 7 * MINUTE },
    { id: "lm-6", name: "Market Mural", zoneId: "z-s", latitude: 2.021, longitude: 101.021, transitSummary: "Bus 4", accessNotes: "Public", publicHours: "06-22", estimatedTravelFromStartMs: 7 * MINUTE },
  ];
  const pack = {
    meta: {
      packId: "claim-harbor-pack",
      version: 1,
      schemaVersion: "claim-city-rulebook-v1",
      format: "claim-the-city",
      isOfficial: true,
      title: "Claim Harbor",
      byline: "Core",
      summary: "Synthetic Claim engine test pack.",
      cityLabel: "ClaimHarbor",
      difficulty: "starter",
      priceIdr: 0,
    },
    session: {
      minPlayers: 1,
      maxPlayers: 6,
      teamMode: "ffa",
      requireStartCheckIn: false,
      durationMs: 90 * MINUTE,
      soloTargets: { lockedLandmarks: 4, distinctZones: 2 },
    },
    claiming: {
      claimWeight: 1,
      lockWeight: 1,
      stealLocksImmediately: true,
      multiplayerFailPolicy: "cooldown_ms",
      soloFailPolicy: "burned_for_player",
      failCooldownMs: 5 * MINUTE,
      broadcastFailAlert: true,
    },
    geography: {
      checkInRadiusMeters: 100,
      maxGpsAccuracyMeters: 50,
      maxGpsFixAgeMs: 30_000,
      allowedTransitModes: ["walk", "mrt"],
      geoSnapshotId: snapshot.id,
      geoSnapshotHash: snapshot.hash,
      zones: [
        { id: "z-n", name: "North Pier", label: "N" },
        { id: "z-s", name: "South Market", label: "S" },
      ],
      landmarks,
    },
    challenges: {
      challengeMode: "per_landmark",
      landmarkChallenges: {
        "lm-1": [challenge("c1", { primitive: "observation_mcq", prompt: "Shape of clock?", choices: [{ id: "a", label: "Octagon" }, { id: "b", label: "Square" }], correctChoiceId: "a" })],
        "lm-2": [challenge("c2", { primitive: "observation_input", prompt: "How many arches?", inputMode: "number", numericRange: { min: 4, max: 4 } })],
        "lm-3": [challenge("c3", { primitive: "photo_proof", prompt: "Snap the bell.", verificationMode: "rival_or_timeout", autoApproveMs: 2 * MINUTE })],
        "lm-4": [challenge("c4", { primitive: "timed_micro_task", prompt: "Reach north rim in 3m.", timeLimitMs: 3 * MINUTE, taskType: "sub_point_gps", subPoint: { latitude: 2.0203, longitude: 101.0251, label: "Rim", radiusMeters: 35 } })],
        "lm-5": [
          challenge("c5", {
            primitive: "call_your_shot",
            theme: "Bridge",
            standardTask: { primitive: "observation_input", prompt: "What year is engraved?", inputMode: "text", acceptedAnswers: ["1928"] },
            boldTask: { primitive: "observation_input", prompt: "Builder name?", inputMode: "text", acceptedAnswers: ["Vanguard"] },
            boldReward: { drawTacticalCard: true, bonusWeight: 1 },
          }),
        ],
        "lm-6": [
          challenge("c6", {
            primitive: "multi_step",
            steps: [
              { primitive: "observation_input", prompt: "Count boats.", inputMode: "number", acceptedAnswers: ["3"] },
              { primitive: "observation_mcq", prompt: "Sky color?", choices: [{ id: "x", label: "Gold" }, { id: "y", label: "Teal" }], correctChoiceId: "y" },
            ],
          }),
        ],
      },
      backupPool: [
        challenge("bak-1", { primitive: "observation_input", prompt: "Backup code?", inputMode: "text", acceptedAnswers: ["OK"] }),
        challenge("bak-2", { primitive: "observation_mcq", prompt: "Backup pick?", choices: [{ id: "1", label: "One" }, { id: "2", label: "Two" }], correctChoiceId: "1" }),
      ],
    },
    tacticalDeck: {
      enabled: true,
      maxHandSize: 3,
      drawTriggers: { onLock: true, onSteal: true, onBoldChallenge: true },
      maxActiveCursesPerTarget: 1,
      cards: [
        { id: "scout", copies: 2, title: "Scout", description: "Peek hidden challenge.", effect: { primitive: "scout_challenge" } },
        { id: "shield", copies: 2, title: "Shield", description: "Protect 15m.", effect: { primitive: "shield_claim", durationMs: 15 * MINUTE } },
        { id: "double", copies: 2, title: "Double", description: "2x locked weight.", effect: { primitive: "double_weight" } },
        { id: "swap", copies: 2, title: "Swap", description: "Swap challenge.", effect: { primitive: "swap_challenge" } },
        { id: "instant", copies: 1, title: "Instant Lock", description: "Lock instantly.", effect: { primitive: "instant_lock" } },
        { id: "curse", copies: 1, title: "Park Detour", description: "Block steals until park visit.", effect: { primitive: "sabotage_curse", blockerType: "block_steals", clearCondition: { type: "gps_detour", poiCategory: "park", radiusMeters: 100 } } },
      ],
    },
  };
  return { snapshot, pack, landmarks };
}

test("claim rewards reserve hand slots, keep one card per offer, and discard unresolved offers at the deadline", () => {
  const { pack, snapshot, landmarks } = buildClaimFixture();
  pack.tacticalDeck.claimRewardDrawCount = 3;
  pack.tacticalDeck.maxHandSize = 2;
  pack.tacticalDeck.cards = pack.tacticalDeck.cards.slice(0, 3).map((card, i) => ({
    ...card, copies: i === 2 ? 1 : 2,
  }));
  const match = api.createClaimEngineMatch({
    code: "REWARD-1", pack, snapshot, hostSeatId: "p1", hostName: "A", hostCredentialHash: "c1",
    rngInt: () => 0,
  });
  api.joinClaimEngineMatch(match, { seatId: "p2", name: "B", credentialHash: "c2" });
  let seq = 0;
  const act = (seatId, action, now) => api.applyClaimEngineAction(match, seatId, { actionId: `reward-${++seq}`, ...action }, now);
  for (const seatId of ["p1", "p2"]) assert.equal(act(seatId, { type: "ready", ready: true }, T0).error, undefined);
  const { room: { deadline } } = act("p1", { type: "start" }, T0);
  act("p1", { type: "check-in-landmark", landmarkId: "lm-1", fix: fixAt(landmarks[0], T0 + 1) }, T0 + 1);
  const firstClaim = { actionId: "first-claim", type: "submit-challenge", landmarkId: "lm-1", choiceId: "a" };
  const first = act("p1", firstClaim, T0 + 2).room;
  const offer = first.ownClaimReward;
  assert.equal(offer.cards.length, 3);
  assert.equal(first.ownHand.length, 0);
  const rival = api.viewClaimEngineMatch(match, "p2", T0 + 2);
  assert.equal(rival.landmarks.find((landmark) => landmark.landmarkId === "lm-1").status, "locked");
  assert.equal(rival.zones[0].controllerTeamId, first.teamId);
  assert.equal(rival.ownClaimReward, undefined);
  assert.ok(offer.cards.every(({ instanceId }) => !JSON.stringify(rival).includes(instanceId)));
  assert.deepEqual(act("p1", firstClaim, T0 + 3).room.ownClaimReward, offer);

  act("p1", { type: "check-in-landmark", landmarkId: "lm-2", fix: fixAt(landmarks[1], T0 + 4) }, T0 + 4);
  const second = act("p1", { type: "submit-challenge", landmarkId: "lm-2", inputValue: "4" }, T0 + 5);
  assert.equal(second.error, undefined);
  assert.deepEqual(second.room.ownClaimReward, offer);
  assert.equal(match.deck.drawPile.length, 0);
  assert.equal(api.drawClaimTacticalCard(match.deck, "p1"), null);
  assert.equal(api.drawClaimTacticalCard(match.deck, "p2"), null);
  const keep = {
    actionId: "keep-retry", type: "choose-claim-reward", offerId: offer.offerId,
    cardInstanceId: offer.cards[1].instanceId,
  };
  assert.equal(act("p2", keep, T0 + 6).error, "claim-reward-unavailable");
  assert.equal(act("p1", { ...keep, actionId: "invalid-keep", cardInstanceId: "missing" }, T0 + 7).error, "claim-reward-unavailable");
  const picked = act("p1", keep, deadline - 2);
  assert.deepEqual(picked.room.ownHand, [offer.cards[1]]);
  assert.deepEqual(match.deck.discardPile, [offer.cards[0], offer.cards[2]]);
  assert.equal(picked.room.ownClaimReward.cards.length, 2);
  assert.deepEqual(act("p1", keep, deadline - 1).room.ownHand, [offer.cards[1]]);
  assert.equal(act("p1", { ...keep, actionId: "stale-offer" }, deadline - 1).error, "claim-reward-unavailable");
  const queued = picked.room.ownClaimReward;
  const late = act("p1", { ...keep, actionId: "late-keep", offerId: queued.offerId, cardInstanceId: queued.cards[0].instanceId }, deadline);
  assert.equal(late.error, "match-finished");
  assert.equal(late.room.ownClaimReward, undefined);
  assert.deepEqual(late.room.ownHand, [offer.cards[1]]);
  assert.deepEqual(match.deck.discardPile, [offer.cards[0], offer.cards[2], ...queued.cards]);
});

test("Solo Claim enforces locked targets across zones, burn-on-fail, solo card filtering, and all challenge primitives without leaking answer keys", () => {
  const { snapshot, pack, landmarks } = buildClaimFixture();
  const match = api.createClaimEngineMatch({
    code: "SOLO-1",
    pack,
    snapshot,
    hostSeatId: "p1",
    hostName: "Soloist",
    hostCredentialHash: "c1",
    rngInt: () => 0,
  });
  let seq = 0;
  const act = (action, now) => api.applyClaimEngineAction(match, "p1", { actionId: `s-${++seq}`, ...action }, now);
  act({ type: "ready", ready: true }, T0);
  act({ type: "start" }, T0);

  // Multiplayer-only cards (shield, sabotage_curse) must be excluded from Solo draw pile!
  assert.equal(match.deck.drawPile.some((c) => c.effect.primitive === "shield_claim" || c.effect.primitive === "sabotage_curse"), false);

  let t = T0 + 2 * MINUTE;
  // lm-1: MCQ check-in claims vulnerably; answer key must NEVER appear in view!
  const ck1 = act({ type: "check-in-landmark", landmarkId: "lm-1", fix: fixAt(landmarks[0], t) }, t);
  assert.equal(ck1.room.ownActiveAttempt.challenge.payload.correctChoiceId, undefined);
  // Wrong answer burns lm-1 for Solo
  assert.equal(act({ type: "submit-challenge", landmarkId: "lm-1", choiceId: "b" }, t + 1000).error, "wrong-answer");
  assert.ok(api.viewClaimEngineMatch(match, "p1", t + 2000).ownBurnedLandmarks.includes("lm-1"));
  assert.equal(act({ type: "check-in-landmark", landmarkId: "lm-1", fix: fixAt(landmarks[0], t + 3000) }, t + 3000).error, "landmark-burned");

  // Lock 4 landmarks across 2 zones: lm-2 (input), lm-3 (photo), lm-4 (timed gps), lm-6 (multi-step)
  t += 2 * MINUTE;
  act({ type: "check-in-landmark", landmarkId: "lm-2", fix: fixAt(landmarks[1], t) }, t);
  assert.equal(act({ type: "submit-challenge", landmarkId: "lm-2", inputValue: "4" }, t + 1000).error, undefined);

  t += 2 * MINUTE;
  act({ type: "check-in-landmark", landmarkId: "lm-3", fix: fixAt(landmarks[2], t) }, t);
  assert.equal(act({ type: "submit-challenge", landmarkId: "lm-3", photoId: "solo-bell-1" }, t + 1000).error, undefined);

  t += 2 * MINUTE;
  act({ type: "check-in-landmark", landmarkId: "lm-4", fix: fixAt(landmarks[3], t) }, t);
  act({ type: "start-timed-task", landmarkId: "lm-4" }, t + 1000);
  assert.equal(
    act({ type: "submit-challenge", landmarkId: "lm-4", fix: fixAt({ latitude: 2.0203, longitude: 101.0251 }, t + 30_000) }, t + 30_000).error,
    undefined,
  );

  // lm-6: multi_step (2 steps) -> locks 4th landmark across 2nd zone -> instant Solo win & photo purged!
  t += 2 * MINUTE;
  act({ type: "check-in-landmark", landmarkId: "lm-6", fix: fixAt(landmarks[5], t) }, t);
  assert.equal(act({ type: "submit-challenge", landmarkId: "lm-6", inputValue: "3" }, t + 1000).room.ownActiveAttempt.currentStep, 1);
  const win = act({ type: "submit-challenge", landmarkId: "lm-6", choiceId: "y" }, t + 2000);
  assert.equal(win.room.phase, "finished");
  assert.equal(win.room.outcome.soloWon, true);
  assert.equal(win.room.outcome.reason, "solo_target_met");
  assert.deepEqual(win.purgedPhotoIds, ["solo-bell-1"]);
});

test("3-player FFA exercises vulnerable claim, Bail open-to-steal alert, Shield blocking steal, Double Weight flipping tie, Call Your Shot Bold, Photo auto-approve, and Sabotage Curse", () => {
  const { snapshot, pack, landmarks } = buildClaimFixture();
  const match = api.createClaimEngineMatch({
    code: "FFA-3",
    pack,
    snapshot,
    hostSeatId: "p1",
    hostName: "A",
    hostCredentialHash: "c1",
    rngInt: () => 0,
  });
  api.joinClaimEngineMatch(match, { seatId: "p2", name: "B", credentialHash: "c2" });
  api.joinClaimEngineMatch(match, { seatId: "p3", name: "C", credentialHash: "c3" });

  let seq = 0;
  const act = (seatId, action, now) => api.applyClaimEngineAction(match, seatId, { actionId: `m-${++seq}`, ...action }, now);
  for (const p of ["p1", "p2", "p3"]) act(p, { type: "ready", ready: true }, T0);
  act("p1", { type: "start" }, T0);

  let t = T0 + 2 * MINUTE;
  // p1 claims lm-1 (vulnerable) and BAILS -> public "open-to-steal:bailed" alert fires!
  act("p1", { type: "check-in-landmark", landmarkId: "lm-1", fix: fixAt(landmarks[0], t) }, t);
  const bail = act("p1", { type: "bail-challenge", landmarkId: "lm-1" }, t + 5000);
  assert.ok(bail.room.events.some((e) => e.type === "challenge_failed" && e.detail === "open-to-steal:bailed"));

  // p2 sweeps in and STEALS lm-1 (locks immediately!)
  t += 1 * MINUTE;
  act("p2", { type: "check-in-landmark", landmarkId: "lm-1", fix: fixAt(landmarks[0], t) }, t);
  const steal = act("p2", { type: "submit-challenge", landmarkId: "lm-1", choiceId: "a" }, t + 2000);
  assert.equal(steal.room.landmarks.find((l) => l.landmarkId === "lm-1").ownerSeatId, "p2");
  assert.equal(steal.room.landmarks.find((l) => l.landmarkId === "lm-1").status, "locked");

  // p1 claims lm-2 (vulnerable) and plays Shield -> p3 trying to steal lm-2 is blocked!
  t += 1 * MINUTE;
  act("p1", { type: "check-in-landmark", landmarkId: "lm-2", fix: fixAt(landmarks[1], t) }, t);
  const shieldCard = { instanceId: "inst-shield", cardId: "shield", title: "Shield", description: "15m", effect: { primitive: "shield_claim", durationMs: 15 * MINUTE } };
  match.deck.handsBySeat["p1"] = [shieldCard];
  assert.equal(act("p1", { type: "play-card", cardInstanceId: "inst-shield", landmarkId: "lm-2" }, t + 1000).error, undefined);
  assert.equal(act("p3", { type: "check-in-landmark", landmarkId: "lm-2", fix: fixAt(landmarks[1], t + 2000) }, t + 2000).error, "landmark-shielded");

  // Zone z-n is tied 1-1 (p2 locked lm-1, p1 claimed lm-2) -> p2 plays Double Weight on lm-1 -> p2 controls z-n (2 vs 1)!
  const doubleCard = { instanceId: "inst-double", cardId: "double", title: "Double", description: "2x", effect: { primitive: "double_weight" } };
  match.deck.handsBySeat["p2"] = [doubleCard];
  const dbl = act("p2", { type: "play-card", cardInstanceId: "inst-double", landmarkId: "lm-1" }, t + 3000);
  assert.equal(dbl.room.zones.find((z) => z.zoneId === "z-n").controllerTeamId, "p2");

  // p3 visits lm-3 (photo_proof) -> submits photo -> rival ignores -> auto-approves at autoApproveAt!
  t += 1 * MINUTE;
  act("p3", { type: "check-in-landmark", landmarkId: "lm-3", fix: fixAt(landmarks[2], t) }, t);
  const subPhoto = act("p3", { type: "submit-challenge", landmarkId: "lm-3", photoId: "bell-photo" }, t + 1000);
  assert.equal(subPhoto.room.landmarks.find((l) => l.landmarkId === "lm-3").status, "claimed");
  api.expireClaimEngineMatch(match, t + 1000 + 2 * MINUTE);
  assert.equal(match.landmarks["lm-3"].status, "locked");

  // p1 visits lm-5 (call_your_shot), picks Bold, wins bonusWeight +1!
  t += 3 * MINUTE;
  act("p1", { type: "check-in-landmark", landmarkId: "lm-5", fix: fixAt(landmarks[4], t) }, t);
  act("p1", { type: "choose-shot-tier", landmarkId: "lm-5", tier: "bold" }, t + 1000);
  assert.equal(act("p1", { type: "submit-challenge", landmarkId: "lm-5", inputValue: "vanguard" }, t + 2000).error, undefined);
  assert.equal(match.landmarks["lm-5"].bonusWeight, 1);

  // Sabotage Curse: p1 curses p3 (block_steals until park visit) -> p3 clears at East Park!
  const curseCard = { instanceId: "inst-curse", cardId: "curse", title: "Park Detour", description: "Visit park", effect: { primitive: "sabotage_curse", blockerType: "block_steals", clearCondition: { type: "gps_detour", poiCategory: "park", radiusMeters: 100 } } };
  match.deck.handsBySeat["p1"] = [curseCard];
  act("p1", { type: "play-card", cardInstanceId: "inst-curse", targetSeatId: "p3" }, t + 3000);
  const activeCurse = match.deck.activeCurses[0];
  assert.ok(activeCurse);
  const park1 = snapshot.pois[0];
  assert.equal(act("p3", { type: "clear-curse-gps", curseInstanceId: activeCurse.curseInstanceId, fix: fixAt(park1, t + 4000) }, t + 4000).error, undefined);
  assert.equal(match.deck.activeCurses.length, 0);
});
