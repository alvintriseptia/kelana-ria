import assert from "node:assert/strict";
import test from "node:test";
import * as api from "../dist/index.js";

const MINUTE = 60_000;
const T0 = 1_800_000_000_000;

function fixAt(point, timestamp, accuracy = 12) {
  return { latitude: point.latitude, longitude: point.longitude, accuracy, timestamp };
}

function buildSnapshot() {
  const base = {
    id: "synth-metro-v1",
    boundaryPolygon: [
      { latitude: 1.0, longitude: 100.0 },
      { latitude: 1.0, longitude: 100.08 },
      { latitude: 1.08, longitude: 100.08 },
      { latitude: 1.08, longitude: 100.0 },
    ],
    startPoint: {
      id: "hub",
      name: "Central Hub",
      latitude: 1.04,
      longitude: 100.04,
      accessNotes: "Main plaza open 24h.",
    },
    stations: [
      {
        id: "st-n",
        name: "North Gate",
        latitude: 1.06,
        longitude: 100.04,
        transitLines: ["Red"],
        attributes: { district: "North" },
        eligibleHidingAnchor: true,
        accessNotes: "Exit A plaza.",
        publicHours: "05:00-23:00",
        estimatedTravelFromStartMs: 10 * MINUTE,
      },
      {
        id: "st-ne",
        name: "Harbor Point",
        latitude: 1.06,
        longitude: 100.06,
        transitLines: ["Red", "Blue"],
        attributes: { district: "Harbor" },
        eligibleHidingAnchor: true,
        accessNotes: "Promenade exit.",
        publicHours: "05:00-23:00",
        estimatedTravelFromStartMs: 14 * MINUTE,
      },
      {
        id: "st-e",
        name: "East Market",
        latitude: 1.04,
        longitude: 100.06,
        transitLines: ["Blue"],
        attributes: { district: "East" },
        eligibleHidingAnchor: true,
        accessNotes: "Market concourse.",
        publicHours: "05:00-23:00",
        estimatedTravelFromStartMs: 10 * MINUTE,
      },
      {
        id: "st-s",
        name: "South Park",
        latitude: 1.02,
        longitude: 100.04,
        transitLines: ["Red"],
        attributes: { district: "South" },
        eligibleHidingAnchor: true,
        accessNotes: "Park entrance.",
        publicHours: "05:00-23:00",
        estimatedTravelFromStartMs: 10 * MINUTE,
      },
      {
        id: "st-sw",
        name: "Old Foundry",
        latitude: 1.02,
        longitude: 100.02,
        transitLines: ["Green"],
        attributes: { district: "Foundry" },
        eligibleHidingAnchor: true,
        accessNotes: "Courtyard steps.",
        publicHours: "05:00-23:00",
        estimatedTravelFromStartMs: 14 * MINUTE,
      },
      {
        id: "st-w",
        name: "West Commons",
        latitude: 1.04,
        longitude: 100.02,
        transitLines: ["Green", "Blue"],
        attributes: { district: "West" },
        eligibleHidingAnchor: true,
        accessNotes: "Library plaza.",
        publicHours: "05:00-23:00",
        estimatedTravelFromStartMs: 10 * MINUTE,
      },
    ],
    pois: [
      { id: "park-n", name: "North Meadow", category: "park", latitude: 1.058, longitude: 100.042 },
      { id: "park-s", name: "South Gardens", category: "park", latitude: 1.022, longitude: 100.038 },
      { id: "mall-e", name: "East Arcade", category: "mall", latitude: 1.041, longitude: 100.058 },
      { id: "mall-w", name: "West Plaza", category: "mall", latitude: 1.039, longitude: 100.021 },
      { id: "spire", name: "Civic Spire", category: "monument", latitude: 1.042, longitude: 100.041 },
    ],
    attributions: [
      {
        source: "Synthetic Metro",
        retrievedAt: "2026-11-22T00:00:00Z",
        notice: "Synthetic test geo snapshot.",
      },
    ],
  };
  return { ...base, hash: api.computeGeoSnapshotHash(base) };
}

function buildPack(snapshot, overrides = {}) {
  return {
    meta: {
      packId: "synth-seek-v1",
      version: 1,
      schemaVersion: "hide-seek-rulebook-v1",
      format: "hide-and-seek",
      isOfficial: true,
      title: "Synthetic Metro Hide & Seek",
      byline: "Test Engine",
      summary: "City-agnostic engine test pack.",
      cityLabel: "SynthMetro",
      difficulty: "starter",
      priceIdr: 0,
    },
    session: {
      minPlayers: 2,
      maxPlayers: 6,
      turnMode: "everyone_hides_once",
      requireStartCheckIn: true,
      regroupPolicy: "previous_hiding_station",
      missedLockPolicy: "void_turn",
      endgameFreezeGraceSec: 60,
      maxPathOffsetMeters: 5,
      ...(overrides.session ?? {}),
    },
    timers: {
      headStartMs: 20 * MINUTE,
      searchLimitMs: 60 * MINUTE,
      regroupLimitMs: 15 * MINUTE,
      objectiveResponseMs: 3 * MINUTE,
      photoResponseMs: 6 * MINUTE,
      drawDecisionMs: 30_000,
      ...(overrides.timers ?? {}),
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
      repeatCostMode: overrides.repeatCostMode ?? "escalating_multiplier",
      tieToleranceMeters: 100,
      families: {
        radar: {
          enabled: true,
          drawCount: 2,
          keepCount: 1,
          availableInPhases: ["seeking", "endgame"],
          allowCustomRadius: true,
          items: [
            { id: "rad-1km", label: "1 km", radiusMeters: 1000 },
            { id: "rad-2500m", label: "2.5 km", radiusMeters: 2500 },
          ],
        },
        thermometer: {
          enabled: true,
          drawCount: 2,
          keepCount: 1,
          availableInPhases: ["seeking"],
          items: [{ id: "therm-1km", label: "1 km", minTravelMeters: 1000 }],
        },
        matching: {
          enabled: true,
          drawCount: 3,
          keepCount: 1,
          availableInPhases: ["seeking"],
          items: [
            { id: "match-line", label: "Transit line", matchType: "transit_line" },
            { id: "match-district", label: "District", matchType: "station_attribute", attributeKey: "district" },
            { id: "match-park", label: "Nearest park", matchType: "nearest_poi", poiCategory: "park" },
          ],
        },
        measuring: {
          enabled: true,
          drawCount: 3,
          keepCount: 1,
          availableInPhases: ["seeking"],
          items: [
            { id: "meas-mall", label: "Nearest mall", targetType: "poi_category", poiCategory: "mall" },
            { id: "meas-spire", label: "Civic Spire", targetType: "named_poi", poiId: "spire" },
          ],
        },
        tentacles: {
          enabled: true,
          drawCount: 4,
          keepCount: 2,
          availableInPhases: ["seeking"],
          items: [{ id: "tent-parks-3km", label: "Parks 3 km", radiusMeters: 3000, poiCategory: "park" }],
        },
        photo: {
          enabled: true,
          drawCount: 1,
          keepCount: 1,
          availableInPhases: ["seeking", "endgame"],
          items: [
            { id: "photo-station", label: "Station sign", prompt: "Snap the station entrance.", phase: "seeking" },
            { id: "photo-sky", label: "Sky", prompt: "Snap the sky straight up.", phase: "endgame" },
          ],
        },
      },
    },
    deck: {
      baseHandLimit: 5,
      maxActiveBlockingCurses: 1,
      cards: [
        {
          id: "bonus-2m",
          category: "time_bonus",
          copies: 12,
          title: "+2 min",
          description: "Hold until turn end for +2 minutes.",
          effect: { primitive: "time_bonus", minutes: 2 },
        },
      ],
    },
  };
}

function setupStartedMatch(playerCount = 2, packOverrides = {}) {
  const snapshot = buildSnapshot();
  const pack = buildPack(snapshot, packOverrides);
  let codeCounter = 4200;
  const match = api.createSeekEngineMatch({
    code: "ROOM-1",
    pack,
    snapshot,
    hostSeatId: "p1",
    hostName: "Player 1",
    hostCredentialHash: "cred-1",
    generateFoundCode: () => String(++codeCounter),
  });
  for (let i = 2; i <= playerCount; i++) {
    const joined = api.joinSeekEngineMatch(match, {
      seatId: `p${i}`,
      name: `Player ${i}`,
      credentialHash: `cred-${i}`,
    });
    assert.equal(joined.ok, true);
  }
  let seq = 0;
  const act = (seatId, action, now) =>
    api.applySeekEngineAction(match, seatId, { actionId: `act-${++seq}`, ...action }, now);

  for (let i = 1; i <= playerCount; i++) {
    assert.equal(act(`p${i}`, { type: "check-in-start", fix: fixAt(snapshot.startPoint, T0) }, T0).error, undefined);
    assert.equal(act(`p${i}`, { type: "ready", ready: true }, T0 + 1000).error, undefined);
  }
  assert.equal(act("p1", { type: "start" }, T0 + 2000).error, undefined);
  return { match, snapshot, pack, act, headStartStartedAt: T0 + 2000 };
}

test("2-player full match exercises all 6 evaluators, escalating 2x/3x repeat cost, Endgame, Found Code, secret isolation, and turn swap", () => {
  const { match, snapshot, act, headStartStartedAt } = setupStartedMatch(2);
  const north = snapshot.stations.find((s) => s.id === "st-n");
  const east = snapshot.stations.find((s) => s.id === "st-e");
  const south = snapshot.stations.find((s) => s.id === "st-s");

  // Hider (p1) locks North Gate during head start
  const lockRes = act("p1", { type: "lock-anchor", stationId: "st-n", fix: fixAt(north, headStartStartedAt + 5 * MINUTE) }, headStartStartedAt + 5 * MINUTE);
  assert.equal(lockRes.error, undefined);
  assert.equal(lockRes.room.ownAnchorStationId, "st-n");

  // Seeker (p2) must NEVER see hider's lock or foundCode
  const seekerPreRelease = api.viewSeekEngineMatch(match, "p2", headStartStartedAt + 10 * MINUTE);
  assert.equal(seekerPreRelease.ownAnchorStationId, undefined);
  assert.equal(seekerPreRelease.foundCode, undefined);
  assert.equal(seekerPreRelease.hiderOutOfZone, undefined);

  // Release at headStartStartedAt + 20 min
  const releaseAt = headStartStartedAt + 20 * MINUTE;
  let t = releaseAt + 1 * MINUTE;

  // Hider moves inside zone (no warning), then drifts outside (warning)
  const inZone = act("p1", { type: "report-hider-position", fix: fixAt({ latitude: 1.061, longitude: 100.04 }, t) }, t);
  assert.equal(inZone.room.hiderOutOfZone, false);
  const outZone = act("p1", { type: "report-hider-position", fix: fixAt(east, t + 5000) }, t + 5000);
  assert.equal(outZone.room.hiderOutOfZone, true);

  // 1. Radar (1st use -> 1x draw batch, computed answer hidden from Seeker until answered)
  t += 1 * MINUTE;
  const askRadar1 = act("p2", { type: "ask", family: "radar", itemId: "rad-2500m", fix: fixAt(snapshot.startPoint, t) }, t);
  assert.equal(askRadar1.error, undefined);
  assert.equal(askRadar1.room.questions[0].privateComputedAnswer, undefined, "Seeker must not see pending computed answer");
  const hiderViewPending = api.viewSeekEngineMatch(match, "p1", t);
  assert.equal(hiderViewPending.questions[0].privateComputedAnswer.code, "yes");

  const ansRadar1 = act("p1", { type: "answer-question", questionId: askRadar1.room.questions[0].id }, t + 10_000);
  assert.equal(ansRadar1.error, undefined);
  assert.deepEqual(ansRadar1.earnedDrawBatches, [{ drawCount: 2, keepCount: 1 }]);
  assert.equal(ansRadar1.room.questions[0].overlay.type, "circle");
  assert.equal(ansRadar1.room.questions[0].overlay.inside, true);

  // Repeat same Radar (2nd use -> 2x separate sequential draw batches!)
  t += 1 * MINUTE;
  const askRadar2 = act("p2", { type: "ask", family: "radar", itemId: "rad-2500m", fix: fixAt(east, t) }, t);
  assert.equal(askRadar2.error, undefined);
  const qRadar2 = askRadar2.room.questions.at(-1);
  assert.equal(qRadar2.repeatMultiplier, 2);
  assert.deepEqual(qRadar2.drawBatches, [
    { drawCount: 2, keepCount: 1 },
    { drawCount: 2, keepCount: 1 },
  ]);
  act("p1", { type: "answer-question", questionId: qRadar2.id }, t + 5000);

  // 2. Thermometer (requires start + minTravelMeters)
  t += 1 * MINUTE;
  assert.equal(act("p2", { type: "start-thermometer", fix: fixAt(south, t) }, t).error, undefined);
  const askTherm = act("p2", { type: "ask", family: "thermometer", itemId: "therm-1km", fix: fixAt(snapshot.startPoint, t + 10_000) }, t + 10_000);
  assert.equal(askTherm.error, undefined);
  const ansTherm = act("p1", { type: "answer-question", questionId: askTherm.room.questions.at(-1).id }, t + 15_000);
  assert.equal(ansTherm.room.questions.at(-1).answerCode, "hotter");
  assert.equal(ansTherm.room.questions.at(-1).overlay.type, "bisector");

  // 3. Matching (station_attribute: district)
  t += 1 * MINUTE;
  const askMatch = act("p2", { type: "ask", family: "matching", itemId: "match-district", fix: fixAt(east, t) }, t);
  assert.equal(askMatch.error, undefined);
  const ansMatch = act("p1", { type: "answer-question", questionId: askMatch.room.questions.at(-1).id }, t + 5000);
  assert.equal(ansMatch.room.questions.at(-1).answerCode, "different");
  assert.equal(ansMatch.room.questions.at(-1).overlay.type, "station_filter");
  assert.ok(ansMatch.room.questions.at(-1).overlay.eliminatedStationIds.includes("st-e"));

  // 4. Measuring (poi_category: mall)
  t += 1 * MINUTE;
  const askMeas = act("p2", { type: "ask", family: "measuring", itemId: "meas-mall", fix: fixAt(east, t) }, t);
  assert.equal(askMeas.error, undefined);
  const ansMeas = act("p1", { type: "answer-question", questionId: askMeas.room.questions.at(-1).id }, t + 5000);
  assert.equal(ansMeas.room.questions.at(-1).answerCode, "seeker_closer");
  assert.equal(ansMeas.room.questions.at(-1).overlay.type, "distance_compare");

  // 5. Tentacles (parks within 3 km of hub)
  t += 1 * MINUTE;
  const askTent = act("p2", { type: "ask", family: "tentacles", itemId: "tent-parks-3km", fix: fixAt(snapshot.startPoint, t) }, t);
  assert.equal(askTent.error, undefined);
  const ansTent = act("p1", { type: "answer-question", questionId: askTent.room.questions.at(-1).id }, t + 5000);
  assert.equal(ansTent.room.questions.at(-1).answerCode, "park-n");
  assert.equal(ansTent.room.questions.at(-1).overlay.type, "voronoi");

  // 6. Photo (seeking prompt allowed; endgame-only prompt blocked before Endgame)
  t += 1 * MINUTE;
  assert.equal(
    act("p2", { type: "ask", family: "photo", itemId: "photo-sky", fix: fixAt(snapshot.startPoint, t) }, t).error,
    "question-unavailable-in-phase",
  );
  const askPhoto = act("p2", { type: "ask", family: "photo", itemId: "photo-station", fix: fixAt(snapshot.startPoint, t) }, t);
  assert.equal(askPhoto.error, undefined);
  assert.equal(act("p1", { type: "answer-question", questionId: askPhoto.room.questions.at(-1).id, photoId: "photo-turn1-1" }, t + 5000).error, undefined);

  // Seeker checks in inside North Gate zone WHILE on transit -> Endgame does NOT trigger
  t += 2 * MINUTE;
  const transitCheck = act("p2", { type: "seeker-check-in", fix: fixAt(north, t), offTransit: false }, t);
  assert.equal(transitCheck.endgameTriggered, false);
  assert.equal(transitCheck.room.phase, "seeking");

  // Seeker checks in inside North Gate zone OFF transit -> triggers Endgame!
  t += 30_000;
  const endgameCheck = act("p2", { type: "seeker-check-in", fix: fixAt(north, t), offTransit: true }, t);
  assert.equal(endgameCheck.endgameTriggered, true);
  assert.equal(endgameCheck.room.phase, "endgame");
  assert.equal(endgameCheck.room.canMoveZone, false);
  assert.equal(endgameCheck.room.foundCode, undefined, "Seeker never sees Found Code");

  // Hider sees Found Code in Endgame, and Move is blocked in Endgame
  const hiderEndgame = api.viewSeekEngineMatch(match, "p1", t);
  assert.equal(hiderEndgame.foundCode, "4201");
  assert.equal(api.startMoveZoneRelocation(match, t, 5 * MINUTE, true).error, "move-disabled-in-endgame");

  // Endgame-only photo now unlocks; Hider responds "Cannot answer (Endgame)" and still earns draw!
  const askEndgamePhoto = act("p2", { type: "ask", family: "photo", itemId: "photo-sky", fix: fixAt(north, t + 5000) }, t + 5000);
  assert.equal(askEndgamePhoto.error, undefined);
  const cannotAns = act("p1", { type: "cannot-answer-endgame", questionId: askEndgamePhoto.room.questions.at(-1).id }, t + 10_000);
  assert.equal(cannotAns.error, undefined);
  assert.deepEqual(cannotAns.earnedDrawBatches, [{ drawCount: 1, keepCount: 1 }]);
  assert.equal(cannotAns.room.questions.at(-1).status, "cannot_answer_endgame");

  // Wrong Found Code fails; correct Found Code ends turn 1 and enters Regroup at previous_hiding_station (st-n)!
  t += 2 * MINUTE;
  assert.equal(act("p2", { type: "submit-found-code", code: "0000" }, t).error, "invalid-found-code");
  api.recordTurnScoreAdjustment(match, { bonusMs: 4 * MINUTE });
  const foundTurn1 = act("p2", { type: "submit-found-code", code: "4201" }, t + 5000);
  assert.equal(foundTurn1.error, undefined);
  assert.equal(foundTurn1.room.phase, "regroup");
  assert.equal(foundTurn1.room.regroupPoint.id, "st-n");
  assert.equal(foundTurn1.room.turns.length, 1);
  assert.equal(foundTurn1.room.turns[0].bonusMs, 4 * MINUTE);
  assert.equal(foundTurn1.room.turns[0].adjustedMs, foundTurn1.room.turns[0].rawHidingMs + 4 * MINUTE);

  // Both regroup at st-n -> Turn 2 starts with p2 as Hider and clean private state!
  const regroupAt = t + 2 * MINUTE;
  act("p1", { type: "regroup-check-in", fix: fixAt(north, regroupAt) }, regroupAt);
  const startTurn2 = act("p2", { type: "regroup-check-in", fix: fixAt(north, regroupAt + 1000) }, regroupAt + 1000);
  assert.equal(startTurn2.room.phase, "head_start");
  assert.equal(startTurn2.room.turnNumber, 2);
  assert.equal(startTurn2.room.hiderSeatId, "p2");
  assert.deepEqual(startTurn2.room.questionUseCounts, {});
  assert.equal(startTurn2.room.questions.length, 0);

  // Turn 2: p2 locks South Park, times out after full 60 min search -> p2 wins & photos purged!
  const t2Lock = regroupAt + 5 * MINUTE;
  assert.equal(act("p2", { type: "lock-anchor", stationId: "st-s", fix: fixAt(south, t2Lock) }, t2Lock).error, undefined);
  const t2End = regroupAt + 1000 + 20 * MINUTE + 60 * MINUTE;
  const expired = api.expireSeekEngineMatch(match, t2End);
  assert.equal(expired.changed, true);
  assert.deepEqual(expired.purgedPhotoIds, ["photo-turn1-1"]);
  const finalView = api.viewSeekEngineMatch(match, "p1", t2End);
  assert.equal(finalView.phase, "finished");
  assert.equal(finalView.outcome.winnerSeatId, "p2");
  assert.equal(finalView.turns[0].clues.some((c) => c.photoId), false, "Archived photos purged at match end");
});

test("4-player match enforces unified Seeker Team atomic question lock and 4-turn rotation", () => {
  const { match, snapshot, act, headStartStartedAt } = setupStartedMatch(4);
  const west = snapshot.stations.find((s) => s.id === "st-w");
  assert.equal(match.seats.length, 4);
  assert.equal(api.viewSeekEngineMatch(match, "p1", headStartStartedAt).totalPlannedTurns, 4);

  act("p1", { type: "lock-anchor", stationId: "st-w", fix: fixAt(west, headStartStartedAt + 3 * MINUTE) }, headStartStartedAt + 3 * MINUTE);
  const t = headStartStartedAt + 21 * MINUTE;

  // Seeker p2 asks a question; Seeker p3 concurrently trying to ask must be rejected atomically!
  const q1 = act("p2", { type: "ask", family: "radar", itemId: "rad-1km", fix: fixAt(snapshot.startPoint, t) }, t);
  assert.equal(q1.error, undefined);
  const q2 = act("p3", { type: "ask", family: "matching", itemId: "match-line", fix: fixAt(snapshot.startPoint, t + 1000) }, t + 1000);
  assert.equal(q2.error, "question-pending");

  // Seeker p4 enters Endgame and spots Hider via mutual confirm-found
  act("p4", { type: "seeker-check-in", fix: fixAt(west, t + 2 * MINUTE), offTransit: true }, t + 2 * MINUTE);
  act("p1", { type: "confirm-found" }, t + 3 * MINUTE);
  const found = act("p4", { type: "confirm-found" }, t + 3 * MINUTE + 1000);
  assert.equal(found.room.phase, "regroup");
  assert.equal(found.room.turns.length, 1);
});

test("objective question timeout delivers truthful reply with zero draw batches, and deadline wins over late action", () => {
  const { match, snapshot, act, headStartStartedAt } = setupStartedMatch(2);
  const north = snapshot.stations.find((s) => s.id === "st-n");
  act("p1", { type: "lock-anchor", stationId: "st-n", fix: fixAt(north, headStartStartedAt + 2 * MINUTE) }, headStartStartedAt + 2 * MINUTE);

  const askAt = headStartStartedAt + 21 * MINUTE;
  const asked = act("p2", { type: "ask", family: "radar", itemId: "rad-1km", fix: fixAt(snapshot.startPoint, askAt) }, askAt);
  const qId = asked.room.questions[0].id;
  const deadline = asked.room.questions[0].deadline;

  // Answering right at deadline loses to timeout -> truthful answer delivered, zero earned draws
  const lateAns = act("p1", { type: "answer-question", questionId: qId }, deadline);
  assert.equal(lateAns.error, "question-closed");
  assert.equal(lateAns.room.questions[0].status, "timeout");
  assert.equal(lateAns.room.questions[0].answerCode, "no");
  assert.deepEqual(lateAns.room.pendingDrawBatches, []);
});

test("missedLockPolicy supports void_turn and auto_lock_nearest_station, plus single_use_locked repeat mode", () => {
  // 1. void_turn
  const voidCase = setupStartedMatch(2, { session: { missedLockPolicy: "void_turn" } });
  api.expireSeekEngineMatch(voidCase.match, voidCase.headStartStartedAt + 20 * MINUTE);
  assert.equal(voidCase.match.phase, "void");
  assert.equal(voidCase.match.outcome.reason, "missed_lock");

  // 2. auto_lock_nearest_station + single_use_locked
  const autoCase = setupStartedMatch(2, {
    session: { missedLockPolicy: "auto_lock_nearest_station" },
    repeatCostMode: "single_use_locked",
  });
  const east = autoCase.snapshot.stations.find((s) => s.id === "st-e");
  autoCase.act("p1", { type: "report-hider-position", fix: fixAt(east, autoCase.headStartStartedAt + 5 * MINUTE) }, autoCase.headStartStartedAt + 5 * MINUTE);
  const releaseAt = autoCase.headStartStartedAt + 20 * MINUTE;
  api.expireSeekEngineMatch(autoCase.match, releaseAt);
  assert.equal(autoCase.match.phase, "seeking");
  assert.equal(autoCase.match.anchorStationId, "st-e");

  const q1 = autoCase.act("p2", { type: "ask", family: "radar", itemId: "rad-1km", fix: fixAt(autoCase.snapshot.startPoint, releaseAt + 1000) }, releaseAt + 1000);
  assert.equal(q1.error, undefined);
  autoCase.act("p1", { type: "answer-question", questionId: q1.room.questions[0].id }, releaseAt + 2000);

  const qRepeat = autoCase.act("p2", { type: "ask", family: "radar", itemId: "rad-1km", fix: fixAt(east, releaseAt + 3000) }, releaseAt + 3000);
  assert.equal(qRepeat.error, "question-already-used");
});

test("published clues narrow stations and a timed-out round resumes at the last verified checkpoint", () => {
  const { match, snapshot, act, headStartStartedAt } = setupStartedMatch(2, {
    session: { regroupPolicy: "last_play_checkpoint" },
  });
  const [north, harbor, east] = snapshot.stations;
  assert.equal(act("p1", { type: "lock-anchor", stationId: north.id, fix: fixAt(north, headStartStartedAt) }, headStartStartedAt).error, undefined);
  const released = match.releaseAt;

  const asked = act("p2", { type: "ask", family: "radar", itemId: "rad-2500m", fix: fixAt(snapshot.startPoint, released) }, released);
  const radar = asked.room.questions[0];
  assert.equal(radar.privateComputedAnswer, undefined);
  assert.equal(asked.room.candidateStationIds, undefined);
  assert.equal(asked.room.seekerPosition.stationId, snapshot.startPoint.id);
  const wrong = act("p1", { type: "answer-question", questionId: radar.id, answerCode: "no" }, released + 1000);
  assert.equal(wrong.error, "incorrect-clue-answer");
  assert.equal(wrong.room.questions[0].status, "pending");
  assert.equal(act("p1", { type: "answer-question", questionId: radar.id, answerCode: "yes" }, released + 2000).error, undefined);
  const afterRadar = api.viewSeekEngineMatch(match, "p2", released + 2000);
  assert.ok(afterRadar.candidateStationIds.includes(north.id));
  assert.ok(!afterRadar.candidateStationIds.includes(harbor.id));

  const atA = released + 3000;
  assert.equal(act("p2", { type: "start-thermometer", fix: fixAt(east, atA) }, atA).error, undefined);
  const atB = released + 4000;
  const thermal = act("p2", { type: "ask", family: "thermometer", itemId: "therm-1km", fix: fixAt(north, atB) }, atB);
  assert.equal(thermal.error, undefined);
  const question = thermal.room.questions.at(-1);
  assert.deepEqual(question.thermometerStart, { latitude: east.latitude, longitude: east.longitude });
  assert.equal(question.privateComputedAnswer, undefined);
  assert.equal(act("p1", { type: "answer-question", questionId: question.id, answerCode: "hotter" }, atB + 1000).error, undefined);
  const narrowed = api.viewSeekEngineMatch(match, "p2", atB + 1000);
  assert.ok(narrowed.candidateStationIds.length < afterRadar.candidateStationIds.length);
  assert.ok(narrowed.candidateStationIds.includes(north.id));
  assert.deepEqual(narrowed.questions[0].overlay.center, radar.referencePoint);

  const checkInAt = released + 6000;
  assert.equal(act("p2", { type: "seeker-check-in", offTransit: false, fix: fixAt(east, checkInAt) }, checkInAt).error, undefined);
  const betweenStations = { latitude: east.latitude + 0.01, longitude: east.longitude };
  const later = checkInAt + 1000;
  assert.equal(act("p2", { type: "seeker-check-in", offTransit: false, fix: fixAt(betweenStations, later) }, later).error, undefined);
  const deadline = match.phaseEndsAt;
  api.expireSeekEngineMatch(match, deadline);
  const regroup = api.viewSeekEngineMatch(match, "p2", deadline);
  assert.equal(regroup.phase, "regroup");
  assert.equal(regroup.regroupPoint.id, east.id);
  assert.equal(regroup.turns[0].anchorStationId, null);

  act("p1", { type: "regroup-check-in", fix: fixAt(east, deadline + 1000) }, deadline + 1000);
  const second = act("p2", { type: "regroup-check-in", fix: fixAt(east, deadline + 2000) }, deadline + 2000);
  assert.equal(second.room.phase, "head_start");
  assert.equal(second.room.role, "hider");
  assert.equal(second.room.turnStartPoint.id, east.id);
  assert.equal(second.room.releaseAt - second.room.now, match.pack.timers.headStartMs);
  assert.equal(second.room.seekerPosition, undefined);
  assert.equal(second.room.candidateStationIds, undefined);
});
