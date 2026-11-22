import assert from "node:assert/strict";
import test from "node:test";
import * as api from "../dist/index.js";

const MINUTE = 60_000;
const T0 = 1_800_000_000_000;

function fixAt(point, timestamp, accuracy = 10) {
  return { latitude: point.latitude, longitude: point.longitude, accuracy, timestamp };
}

function buildDeckFixture() {
  const base = {
    id: "deck-city-v1",
    boundaryPolygon: [
      { latitude: 1.0, longitude: 100.0 },
      { latitude: 1.0, longitude: 100.08 },
      { latitude: 1.08, longitude: 100.08 },
      { latitude: 1.08, longitude: 100.0 },
    ],
    startPoint: { id: "hub", name: "Hub", latitude: 1.04, longitude: 100.04, accessNotes: "Public square." },
    stations: [
      { id: "s1", name: "North", latitude: 1.06, longitude: 100.04, transitLines: ["L1"], attributes: { d: "N" }, eligibleHidingAnchor: true, accessNotes: "Exit A.", publicHours: "05-23", estimatedTravelFromStartMs: 10 * MINUTE },
      { id: "s2", name: "NorthEast", latitude: 1.06, longitude: 100.06, transitLines: ["L1", "L2"], attributes: { d: "NE" }, eligibleHidingAnchor: true, accessNotes: "Exit B.", publicHours: "05-23", estimatedTravelFromStartMs: 12 * MINUTE },
      { id: "s3", name: "East", latitude: 1.04, longitude: 100.06, transitLines: ["L2"], attributes: { d: "E" }, eligibleHidingAnchor: true, accessNotes: "Exit C.", publicHours: "05-23", estimatedTravelFromStartMs: 10 * MINUTE },
      { id: "s4", name: "South", latitude: 1.02, longitude: 100.04, transitLines: ["L1"], attributes: { d: "S" }, eligibleHidingAnchor: true, accessNotes: "Exit D.", publicHours: "05-23", estimatedTravelFromStartMs: 10 * MINUTE },
      { id: "s5", name: "SouthWest", latitude: 1.02, longitude: 100.02, transitLines: ["L3"], attributes: { d: "SW" }, eligibleHidingAnchor: true, accessNotes: "Exit E.", publicHours: "05-23", estimatedTravelFromStartMs: 12 * MINUTE },
      { id: "s6", name: "West", latitude: 1.04, longitude: 100.02, transitLines: ["L3"], attributes: { d: "W" }, eligibleHidingAnchor: true, accessNotes: "Exit F.", publicHours: "05-23", estimatedTravelFromStartMs: 10 * MINUTE },
    ],
    pois: [
      { id: "park-1", name: "North Park", category: "park", latitude: 1.058, longitude: 100.041 },
      { id: "park-2", name: "South Park", category: "park", latitude: 1.021, longitude: 100.039 },
    ],
    attributions: [{ source: "DeckCity", retrievedAt: "2026-11-22T00:00:00Z", notice: "Synthetic test fixture." }],
  };
  const snapshot = { ...base, hash: api.computeGeoSnapshotHash(base) };
  const pack = {
    meta: {
      packId: "deck-city-seek",
      version: 1,
      schemaVersion: "hide-seek-rulebook-v1",
      format: "hide-and-seek",
      isOfficial: true,
      title: "Deck City Seek",
      byline: "Core",
      summary: "Exercises all 9 primitives and composable curses.",
      cityLabel: "DeckCity",
      difficulty: "standard",
      priceIdr: 0,
    },
    session: {
      minPlayers: 2,
      maxPlayers: 4,
      turnMode: "everyone_hides_once",
      requireStartCheckIn: false,
      regroupPolicy: "anywhere_ready",
      missedLockPolicy: "void_turn",
      endgameFreezeGraceSec: 30,
      maxPathOffsetMeters: 5,
    },
    timers: {
      headStartMs: 20 * MINUTE,
      searchLimitMs: 60 * MINUTE,
      regroupLimitMs: 15 * MINUTE,
      objectiveResponseMs: 3 * MINUTE,
      photoResponseMs: 6 * MINUTE,
      drawDecisionMs: 30_000,
    },
    geography: {
      hidingZoneRadiusMeters: 400,
      checkInRadiusMeters: 100,
      maxGpsAccuracyMeters: 50,
      maxGpsFixAgeMs: 30_000,
      allowedTransitModes: ["walk", "mrt"],
      geoSnapshotId: snapshot.id,
      geoSnapshotHash: snapshot.hash,
    },
    investigationBook: {
      repeatCostMode: "escalating_multiplier",
      tieToleranceMeters: 100,
      families: {
        radar: {
          enabled: true,
          drawCount: 2,
          keepCount: 1,
          availableInPhases: ["seeking", "endgame"],
          items: [
            { id: "r1", label: "1 km", radiusMeters: 1000 },
            { id: "r2", label: "2.5 km", radiusMeters: 2500 },
            { id: "r3", label: "4 km", radiusMeters: 4000 },
          ],
        },
        matching: {
          enabled: true,
          drawCount: 3,
          keepCount: 1,
          availableInPhases: ["seeking"],
          items: [{ id: "m-d", label: "District", matchType: "station_attribute", attributeKey: "d" }],
        },
      },
    },
    deck: {
      baseHandLimit: 3,
      maxActiveBlockingCurses: 1,
      cards: [
        { id: "b-2m", category: "time_bonus", copies: 2, title: "+2m", description: "+2 minutes.", effect: { primitive: "time_bonus", minutes: 2 } },
        { id: "b-10pct", category: "time_bonus", copies: 1, title: "+10%", description: "+10% raw time.", effect: { primitive: "time_bonus", percentOfRawTime: 10 } },
        { id: "p-veto", category: "powerup", copies: 1, title: "Veto", description: "Cancel question.", effect: { primitive: "veto" } },
        { id: "p-rand", category: "powerup", copies: 1, title: "Randomize", description: "Swap question.", effect: { primitive: "randomize" } },
        { id: "p-dup", category: "powerup", copies: 1, title: "Duplicate", description: "Copy held card.", effect: { primitive: "duplicate", allowDuplicateMove: false } },
        { id: "p-exp", category: "powerup", copies: 1, title: "Expand", description: "+1 hand slot.", effect: { primitive: "expand_hand", extraSlots: 1 } },
        { id: "p-cyc", category: "powerup", copies: 1, title: "Cycle", description: "Discard 1 draw 2 keep 1.", effect: { primitive: "discard_draw", discardCount: 1, drawCount: 2, keepCount: 1 } },
        { id: "p-trap", category: "powerup", copies: 1, title: "Trap", description: "Plant +5m trap.", effect: { primitive: "time_trap", bonusMinutes: 5 } },
        { id: "p-move", category: "powerup", copies: 1, title: "Move", description: "Relocate within 10m.", effect: { primitive: "move_zone", travelWindowMs: 10 * MINUTE, revealOldStation: true, discardHand: true } },
        {
          id: "c-chalice",
          category: "curse",
          copies: 1,
          title: "Chalice",
          description: "Next 2 questions draw +1.",
          effect: {
            primitive: "curse",
            curse: {
              castingCosts: [{ type: "none" }],
              blockerType: "none",
              effectModifiers: [{ type: "inflate_question_draws", extraDraws: 1 }],
              clearCondition: { type: "next_n_questions", count: 2 },
            },
          },
        },
        {
          id: "c-detour",
          category: "curse",
          copies: 1,
          title: "Park Detour",
          description: "Visit a park before boarding transit.",
          effect: {
            primitive: "curse",
            curse: {
              castingCosts: [{ type: "discard_cards", count: 1 }],
              blockerType: "block_transit",
              clearCondition: { type: "gps_detour", poiCategory: "park", radiusMeters: 100, fallbackTimerMs: 10 * MINUTE },
            },
          },
        },
        {
          id: "c-photo",
          category: "curse",
          copies: 1,
          title: "Snack Photo",
          description: "Send photo or buyout +4m.",
          effect: {
            primitive: "curse",
            curse: {
              castingCosts: [{ type: "seeker_min_distance", meters: 500 }],
              blockerType: "block_questions",
              effectModifiers: [{ type: "skip_penalty_minutes", penaltyMinutes: 4 }],
              clearCondition: { type: "photo_challenge", prompt: "Snap a food cart.", approvalMode: "opponent_or_timeout", autoApproveMs: 3 * MINUTE },
            },
          },
        },
      ],
    },
  };

  const match = api.createSeekEngineMatch({
    code: "DECK-1",
    pack,
    snapshot,
    hostSeatId: "p1",
    hostName: "Hider",
    hostCredentialHash: "c1",
    generateFoundCode: () => "7777",
  });
  api.joinSeekEngineMatch(match, { seatId: "p2", name: "Seeker", credentialHash: "c2" });
  api.applySeekEngineAction(match, "p1", { actionId: "r1", type: "ready", ready: true }, T0);
  api.applySeekEngineAction(match, "p2", { actionId: "r2", type: "ready", ready: true }, T0);
  api.applySeekEngineAction(match, "p1", { actionId: "st", type: "start" }, T0);
  const s1 = snapshot.stations.find((s) => s.id === "s1");
  api.applySeekEngineAction(match, "p1", { actionId: "lk", type: "lock-anchor", stationId: "s1", fix: fixAt(s1, T0 + 2 * MINUTE) }, T0 + 2 * MINUTE);
  const seekingStart = T0 + 20 * MINUTE;
  api.expireSeekEngineMatch(match, seekingStart);

  const deck = api.createSeekDeckState(pack, { rngInt: () => 0 });
  return { snapshot, pack, match, deck, seekingStart };
}

function giveHand(deck, cardIds) {
  const all = [...deck.drawPile, ...deck.discardPile, ...deck.hand];
  deck.hand = [];
  deck.drawPile = [];
  deck.discardPile = [];
  for (const id of cardIds) {
    const idx = all.findIndex((c) => c.cardId === id);
    assert.ok(idx !== -1, `Card ${id} missing from fixture`);
    deck.hand.push(all.splice(idx, 1)[0]);
  }
  deck.drawPile = all;
}

test("sequential 2x repeat draws, hand-limit overflow discard, auto-keep on timeout, and held Time Bonus scoring", () => {
  const { match, deck, seekingStart } = buildDeckFixture();
  let t = seekingStart + 1000;

  // Enqueue 2x draw (from a repeated question): each batch draws 2, keeps 1
  api.enqueueSeekDrawBatches(
    deck,
    match,
    [
      { drawCount: 2, keepCount: 1 },
      { drawCount: 2, keepCount: 1 },
    ],
    t,
  );
  assert.ok(deck.activeDraw);
  assert.equal(deck.queuedBatches.length, 1);

  // Resolve batch 1 manually -> batch 2 opens automatically
  const keep1 = deck.activeDraw.cards[0].instanceId;
  assert.equal(api.chooseSeekDrawCards(deck, match, { keepInstanceIds: [keep1] }, t + 1000).ok, true);
  assert.ok(deck.activeDraw, "Second sequential batch should now be active");
  assert.equal(deck.hand.length, 1);

  // Let batch 2 time out -> auto-keeps first eligible card
  const exp = api.expireSeekDeckAndCurses(deck, match, deck.activeDraw.deadline);
  assert.equal(exp.changed, true);
  assert.equal(deck.activeDraw, null);
  assert.equal(deck.hand.length, 2);

  // Fill hand to limit (3) and draw another -> requires discard to respect hand limit
  giveHand(deck, ["b-2m", "b-2m", "b-10pct"]);
  assert.equal(api.computeHeldTimeBonusMs(deck, 30 * MINUTE), 4 * MINUTE + 3 * MINUTE);

  api.enqueueSeekDrawBatches(deck, match, [{ drawCount: 2, keepCount: 1 }], t + 40_000);
  const nextKeep = deck.activeDraw.cards[0].instanceId;
  assert.equal(
    api.chooseSeekDrawCards(deck, match, { keepInstanceIds: [nextKeep] }, t + 41_000).error,
    "hand-limit-discard-required",
  );
  assert.equal(
    api.chooseSeekDrawCards(deck, match, { keepInstanceIds: [nextKeep], discardInstanceIds: [deck.hand[0].instanceId] }, t + 41_000).ok,
    true,
  );
  assert.equal(deck.hand.length, 3);
});

test("Veto cancels question while keeping 2x repeat cost, and Randomize swaps to unused sub-question", () => {
  const { snapshot, match, deck, seekingStart } = buildDeckFixture();
  giveHand(deck, ["p-veto", "p-rand", "b-2m"]);
  let t = seekingStart + 1000;

  // Seeker asks r1 -> Hider plays Veto -> no answer, r1 still marked used -> repeat r1 costs 2x!
  const ask1 = api.applySeekEngineAction(match, "p2", { actionId: "q1", type: "ask", family: "radar", itemId: "r1", fix: fixAt(snapshot.startPoint, t) }, t);
  assert.equal(ask1.error, undefined);
  const vetoCard = deck.hand.find((c) => c.cardId === "p-veto");
  const vetoRes = api.playSeekDeckCard(deck, match, { cardInstanceId: vetoCard.instanceId }, t + 1000);
  assert.equal(vetoRes.ok, true);
  assert.equal(match.questions[0].status, "vetoed");
  assert.equal(match.questionUseCounts["radar:r1"], 1);

  // Asking r1 again triggers 2x repeat cost!
  const askRepeat = api.applySeekEngineAction(match, "p2", { actionId: "q2", type: "ask", family: "radar", itemId: "r1", fix: fixAt(snapshot.startPoint, t + 5000) }, t + 5000);
  assert.equal(askRepeat.room.questions.at(-1).repeatMultiplier, 2);

  // Hider plays Randomize -> swaps r1 to unused r2 or r3
  const randCard = deck.hand.find((c) => c.cardId === "p-rand");
  const randRes = api.playSeekDeckCard(deck, match, { cardInstanceId: randCard.instanceId }, t + 6000);
  assert.equal(randRes.ok, true);
  assert.notEqual(randRes.randomizedItemId, "r1");
  assert.equal(match.questions.at(-1).itemId, randRes.randomizedItemId);
});

test("Duplicate, Expand Hand, Discard-Draw, Time Trap trigger, and Move Zone relocation + Endgame block", () => {
  const { snapshot, match, deck, seekingStart } = buildDeckFixture();
  giveHand(deck, ["p-dup", "b-2m", "p-exp"]);
  let t = seekingStart + 1000;

  // Expand Hand (+1 -> limit 4)
  const expCard = deck.hand.find((c) => c.cardId === "p-exp");
  assert.equal(api.playSeekDeckCard(deck, match, { cardInstanceId: expCard.instanceId }, t).ok, true);
  assert.equal(deck.currentHandLimit, 4);

  // Duplicate +2m bonus -> now holds two +2m bonuses
  const dupCard = deck.hand.find((c) => c.cardId === "p-dup");
  const bonusCard = deck.hand.find((c) => c.cardId === "b-2m");
  assert.equal(
    api.playSeekDeckCard(deck, match, { cardInstanceId: dupCard.instanceId, targetCardInstanceId: bonusCard.instanceId }, t + 1000).ok,
    true,
  );
  assert.equal(deck.hand.filter((c) => c.cardId === "b-2m").length, 2);

  // Discard 1 Draw 2
  giveHand(deck, ["p-cyc", "b-2m"]);
  const cycCard = deck.hand.find((c) => c.cardId === "p-cyc");
  const dropCard = deck.hand.find((c) => c.cardId === "b-2m");
  assert.equal(
    api.playSeekDeckCard(deck, match, { cardInstanceId: cycCard.instanceId, discardInstanceIds: [dropCard.instanceId] }, t + 2000).ok,
    true,
  );
  assert.ok(deck.activeDraw);
  api.autoResolveActiveDraw(deck, match, t + 3000);

  // Time Trap on s3 (cannot plant on own anchor s1)
  giveHand(deck, ["p-trap", "p-move", "b-2m"]);
  const trapCard = deck.hand.find((c) => c.cardId === "p-trap");
  assert.equal(
    api.playSeekDeckCard(deck, match, { cardInstanceId: trapCard.instanceId, trapStationId: "s1" }, t + 4000).error,
    "invalid-trap-station",
  );
  assert.equal(
    api.playSeekDeckCard(deck, match, { cardInstanceId: trapCard.instanceId, trapStationId: "s3" }, t + 4000).ok,
    true,
  );
  // Seeker checks in at s3 -> trap springs for +5 min!
  const s3 = snapshot.stations.find((s) => s.id === "s3");
  const trapCheck = api.checkSeekTimeTraps(deck, match, fixAt(s3, t + 5000), t + 5000);
  assert.equal(trapCheck.triggeredTraps.length, 1);
  assert.equal(match.currentTurnTrapBonusMs, 5 * MINUTE);

  // Move Zone during seeking -> reveals old station s1, discards hand, allows locking s4!
  const moveCard = deck.hand.find((c) => c.cardId === "p-move");
  const moveRes = api.playSeekDeckCard(deck, match, { cardInstanceId: moveCard.instanceId }, t + 6000);
  assert.equal(moveRes.ok, true);
  assert.equal(moveRes.revealedOldAnchorStationId, "s1");
  assert.equal(deck.hand.length, 0, "Move discarded entire hand");
  const s4 = snapshot.stations.find((s) => s.id === "s4");
  assert.equal(
    api.applySeekEngineAction(match, "p1", { actionId: "relock", type: "lock-anchor", stationId: "s4", fix: fixAt(s4, t + 2 * MINUTE) }, t + 2 * MINUTE).error,
    undefined,
  );
  assert.equal(match.anchorStationId, "s4");

  // Enter Endgame at s4 -> Move Zone must be rejected!
  api.applySeekEngineAction(match, "p2", { actionId: "eg", type: "seeker-check-in", fix: fixAt(s4, t + 3 * MINUTE), offTransit: true }, t + 3 * MINUTE);
  giveHand(deck, ["p-move"]);
  assert.equal(
    api.playSeekDeckCard(deck, match, { cardInstanceId: deck.hand[0].instanceId }, t + 3 * MINUTE + 1000).error,
    "move-disabled-in-endgame",
  );
});

test("Composable curses: stacking rules (1 active blocker cap), GPS detour, photo auto-approve, next_n_questions, and buyout penalty", () => {
  const { snapshot, match, deck, seekingStart } = buildDeckFixture();
  const s4 = snapshot.stations.find((s) => s.id === "s4");
  const park1 = snapshot.pois.find((p) => p.id === "park-1");
  let t = seekingStart + 1000;

  giveHand(deck, ["c-chalice", "c-detour", "c-photo", "b-2m"]);
  const chalice = deck.hand.find((c) => c.cardId === "c-chalice");
  const detour = deck.hand.find((c) => c.cardId === "c-detour");
  const photoCurse = deck.hand.find((c) => c.cardId === "c-photo");
  const bonus = deck.hand.find((c) => c.cardId === "b-2m");

  // Non-blocking Chalice stacks freely and inflates draws by +1 for 2 questions
  assert.equal(api.playSeekDeckCard(deck, match, { cardInstanceId: chalice.instanceId }, t).ok, true);
  assert.equal(match.extraDrawPerQuestion, 1);

  // Blocking Park Detour (requires discarding 1 card) succeeds alongside non-blocking Chalice
  assert.equal(
    api.playSeekDeckCard(deck, match, { cardInstanceId: detour.instanceId, discardInstanceIds: [bonus.instanceId] }, t + 1000).ok,
    true,
  );
  // Second blocking curse (c-photo) is rejected by anti-stunlock cap (maxActiveBlockingCurses = 1)!
  assert.equal(
    api.playSeekDeckCard(deck, match, { cardInstanceId: photoCurse.instanceId, seekerPosition: s4 }, t + 2000).error,
    "blocking-curse-limit-reached",
  );

  // Seeker clears Park Detour by checking in at North Park
  const detourCurseId = deck.activeCurses.find((c) => c.cardId === "c-detour").curseInstanceId;
  assert.equal(api.clearCurseByGpsDetour(deck, match, detourCurseId, fixAt(s4, t + 3000), t + 3000).error, "outside-detour-poi-radius");
  assert.equal(api.clearCurseByGpsDetour(deck, match, detourCurseId, fixAt(park1, t + 4000), t + 4000).ok, true);

  // Now c-photo can be cast (seeker > 500m away) -> blocks questions!
  const castPhoto = api.playSeekDeckCard(deck, match, { cardInstanceId: photoCurse.instanceId, seekerPosition: s4 }, t + 5000);
  assert.equal(castPhoto.ok, true);
  assert.equal(
    api.applySeekEngineAction(match, "p2", { actionId: "blk", type: "ask", family: "radar", itemId: "r1", fix: fixAt(s4, t + 6000) }, t + 6000).error,
    "questions-blocked",
  );

  // Seeker submits photo proof; Hider ignores it -> auto-approves at autoApproveAt (anti-grief)!
  const photoCurseId = castPhoto.curse.curseInstanceId;
  const sub = api.submitCursePhotoProof(deck, match, { curseInstanceId: photoCurseId, seatId: "p2", photoId: "cart-pic-1" }, t + 7000);
  assert.equal(sub.ok, true);
  const autoExp = api.expireSeekDeckAndCurses(deck, match, sub.autoApproveAt);
  assert.deepEqual(autoExp.autoApprovedCurseIds, [photoCurseId]);
  assert.equal(match.questionBlockedUntil, null);

  // Test next_n_questions clearing Chalice after 2 questions
  api.onSeekerQuestionAskedForCurses(deck, match, t + 4 * MINUTE);
  assert.equal(match.extraDrawPerQuestion, 1);
  api.onSeekerQuestionAskedForCurses(deck, match, t + 5 * MINUTE);
  assert.equal(match.extraDrawPerQuestion, 0);

  // Test Buyout Penalty on c-photo
  giveHand(deck, ["c-photo"]);
  const castAgain = api.playSeekDeckCard(deck, match, { cardInstanceId: deck.hand[0].instanceId, seekerPosition: s4 }, t + 6 * MINUTE);
  assert.equal(castAgain.ok, true);
  const buyout = api.buyoutSeekCurse(deck, match, castAgain.curse.curseInstanceId, t + 6 * MINUTE + 1000);
  assert.equal(buyout.ok, true);
  assert.equal(buyout.grantedBonusMs, 4 * MINUTE);
  assert.equal(match.currentTurnBonusMs, 4 * MINUTE);
});
