import assert from "node:assert/strict";
import test from "node:test";
import * as api from "../dist/index.js";

const MINUTE = 60_000;

function buildSyntheticSnapshot(overrides = {}) {
  const base = {
    id: "testopolis-v1",
    boundaryPolygon: [
      { latitude: 1.0, longitude: 100.0 },
      { latitude: 1.0, longitude: 100.06 },
      { latitude: 1.06, longitude: 100.06 },
      { latitude: 1.06, longitude: 100.0 },
    ],
    startPoint: {
      id: "central-hub",
      name: "Central Hub",
      latitude: 1.03,
      longitude: 100.03,
      accessNotes: "Main north plaza steps, open 24h.",
    },
    stations: [
      {
        id: "st-north",
        name: "North Gate",
        latitude: 1.05,
        longitude: 100.03,
        transitLines: ["Red Line"],
        attributes: { district: "Northward", zoneTier: "outer" },
        eligibleHidingAnchor: true,
        accessNotes: "Public concourse exit A.",
        publicHours: "05:00-23:00",
        estimatedTravelFromStartMs: 12 * MINUTE,
      },
      {
        id: "st-northeast",
        name: "Harbor Point",
        latitude: 1.048,
        longitude: 100.048,
        transitLines: ["Red Line", "Blue Line"],
        attributes: { district: "Harbor", zoneTier: "outer" },
        eligibleHidingAnchor: true,
        accessNotes: "Street-level promenade exit.",
        publicHours: "05:00-23:00",
        estimatedTravelFromStartMs: 16 * MINUTE,
      },
      {
        id: "st-east",
        name: "East Market",
        latitude: 1.03,
        longitude: 100.05,
        transitLines: ["Blue Line"],
        attributes: { district: "Market", zoneTier: "inner" },
        eligibleHidingAnchor: true,
        accessNotes: "West pedestrian plaza.",
        publicHours: "05:00-23:00",
        estimatedTravelFromStartMs: 11 * MINUTE,
      },
      {
        id: "st-south",
        name: "South Park",
        latitude: 1.01,
        longitude: 100.03,
        transitLines: ["Red Line"],
        attributes: { district: "Gardens", zoneTier: "outer" },
        eligibleHidingAnchor: true,
        accessNotes: "Park avenue entrance.",
        publicHours: "05:00-23:00",
        estimatedTravelFromStartMs: 13 * MINUTE,
      },
      {
        id: "st-southwest",
        name: "Old Foundry",
        latitude: 1.014,
        longitude: 100.014,
        transitLines: ["Green Line"],
        attributes: { district: "Foundry", zoneTier: "outer" },
        eligibleHidingAnchor: true,
        accessNotes: "Clocktower courtyard entrance.",
        publicHours: "05:00-23:00",
        estimatedTravelFromStartMs: 18 * MINUTE,
      },
      {
        id: "st-west",
        name: "West Commons",
        latitude: 1.03,
        longitude: 100.01,
        transitLines: ["Green Line", "Blue Line"],
        attributes: { district: "Commons", zoneTier: "inner" },
        eligibleHidingAnchor: true,
        accessNotes: "Library side ramp.",
        publicHours: "05:00-23:00",
        estimatedTravelFromStartMs: 14 * MINUTE,
      },
    ],
    pois: [
      { id: "park-1", name: "Botanic Lawn", category: "park", latitude: 1.045, longitude: 100.025 },
      { id: "park-2", name: "Riverfront Green", category: "park", latitude: 1.015, longitude: 100.042 },
      { id: "mall-1", name: "Grand Arcade", category: "mall", latitude: 1.035, longitude: 100.045 },
      { id: "mall-2", name: "Foundry Square", category: "mall", latitude: 1.02, longitude: 100.018 },
      { id: "tower-1", name: "Civic Spire", category: "monument", latitude: 1.032, longitude: 100.031 },
    ],
    attributions: [
      {
        source: "Synthetic Testopolis Open Geo",
        license: "CC BY 4.0",
        retrievedAt: "2026-11-22T00:00:00Z",
        notice: "Synthetic test dataset with no real-world city constants.",
      },
    ],
    ...overrides,
  };
  const hash = overrides.hash ?? api.computeGeoSnapshotHash(base);
  return { ...base, hash };
}

function buildSyntheticPack(snapshot, overrides = {}) {
  return {
    meta: {
      packId: "testopolis-starter-seek",
      version: 1,
      schemaVersion: "hide-seek-rulebook-v1",
      format: "hide-and-seek",
      isOfficial: true,
      title: "Testopolis Transit Hide & Seek",
      byline: "Kelana Ria Core",
      summary: "Synthetic city starter rulebook exercising all primitives.",
      cityLabel: "Testopolis",
      difficulty: "starter",
      priceIdr: 0,
    },
    session: {
      minPlayers: 2,
      maxPlayers: 4,
      turnMode: "everyone_hides_once",
      requireStartCheckIn: true,
      regroupPolicy: "previous_hiding_station",
      missedLockPolicy: "void_turn",
      endgameFreezeGraceSec: 45,
      maxPathOffsetMeters: 5,
    },
    timers: {
      headStartMs: 25 * MINUTE,
      searchLimitMs: 60 * MINUTE,
      regroupLimitMs: 15 * MINUTE,
      objectiveResponseMs: 3 * MINUTE,
      photoResponseMs: 6 * MINUTE,
      drawDecisionMs: 45_000,
    },
    geography: {
      hidingZoneRadiusMeters: 400,
      checkInRadiusMeters: 100,
      maxGpsAccuracyMeters: 50,
      maxGpsFixAgeMs: 30_000,
      allowedTransitModes: ["walk", "mrt", "transjakarta"],
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
          allowCustomRadius: false,
          items: [
            { id: "rad-1km", label: "1 km", radiusMeters: 1000 },
            { id: "rad-2km", label: "2 km", radiusMeters: 2000 },
            { id: "rad-3km", label: "3 km", radiusMeters: 3000 },
          ],
        },
        thermometer: {
          enabled: true,
          drawCount: 2,
          keepCount: 1,
          availableInPhases: ["seeking"],
          items: [
            { id: "therm-500m", label: "500 m", minTravelMeters: 500 },
            { id: "therm-1500m", label: "1.5 km", minTravelMeters: 1500 },
          ],
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
            { id: "meas-spire", label: "Civic Spire", targetType: "named_poi", poiId: "tower-1" },
          ],
        },
        tentacles: {
          enabled: true,
          drawCount: 4,
          keepCount: 2,
          availableInPhases: ["seeking"],
          items: [
            { id: "tent-parks", label: "Parks within 3 km", radiusMeters: 3000, poiCategory: "park" },
          ],
        },
        photo: {
          enabled: true,
          drawCount: 1,
          keepCount: 1,
          availableInPhases: ["seeking", "endgame"],
          items: [
            { id: "photo-skyline", label: "Tallest building", prompt: "Photograph the tallest building visible from your station.", phase: "seeking" },
            { id: "photo-sky", label: "Sky straight up", prompt: "Photograph the sky straight above your hiding spot.", phase: "endgame" },
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
          copies: 6,
          title: "+2 Min Bonus",
          description: "Hold until turn end for +2 minutes.",
          effect: { primitive: "time_bonus", minutes: 2 },
        },
        {
          id: "bonus-5pct",
          category: "time_bonus",
          copies: 2,
          title: "+5% Bonus",
          description: "Hold until turn end for +5% raw hiding time.",
          effect: { primitive: "time_bonus", percentOfRawTime: 5 },
        },
        {
          id: "pow-veto",
          category: "powerup",
          copies: 1,
          title: "Veto",
          description: "Cancel a pending question without answering.",
          effect: { primitive: "veto" },
        },
        {
          id: "pow-randomize",
          category: "powerup",
          copies: 1,
          title: "Randomize",
          description: "Swap the pending question for a random unused one in the same family.",
          effect: { primitive: "randomize" },
        },
        {
          id: "pow-duplicate",
          category: "powerup",
          copies: 1,
          title: "Duplicate",
          description: "Copy another card currently in your hand.",
          effect: { primitive: "duplicate", allowDuplicateMove: false },
        },
        {
          id: "pow-expand",
          category: "powerup",
          copies: 1,
          title: "Expand Hand",
          description: "Increase hand limit by 1 slot for this turn.",
          effect: { primitive: "expand_hand", extraSlots: 1 },
        },
        {
          id: "pow-cycle",
          category: "powerup",
          copies: 1,
          title: "Discard 1 Draw 2",
          description: "Discard 1 card to draw 2 and keep 1.",
          effect: { primitive: "discard_draw", discardCount: 1, drawCount: 2, keepCount: 1 },
        },
        {
          id: "pow-trap",
          category: "powerup",
          copies: 1,
          title: "Time Trap",
          description: "Plant a +5 min trap on another transit station.",
          effect: { primitive: "time_trap", bonusMinutes: 5 },
        },
        {
          id: "pow-move",
          category: "powerup",
          copies: 1,
          title: "Move Zone",
          description: "Discard hand, reveal old station, and relocate within 10 minutes.",
          effect: { primitive: "move_zone", travelWindowMs: 10 * MINUTE, revealOldStation: true, discardHand: true },
        },
        {
          id: "curse-chalice",
          category: "curse",
          copies: 1,
          title: "Overflowing Cup",
          description: "Next 2 questions draw 1 extra card.",
          effect: {
            primitive: "curse",
            curse: {
              castingCosts: [{ type: "discard_cards", count: 1 }],
              blockerType: "none",
              effectModifiers: [{ type: "inflate_question_draws", extraDraws: 1 }],
              clearCondition: { type: "next_n_questions", count: 2 },
            },
          },
        },
        {
          id: "curse-park-detour",
          category: "curse",
          copies: 1,
          title: "Park Detour",
          description: "Seekers cannot board transit until visiting a park or waiting 10 minutes.",
          effect: {
            primitive: "curse",
            curse: {
              castingCosts: [{ type: "seeker_min_distance", meters: 500 }],
              blockerType: "block_transit",
              clearCondition: { type: "gps_detour", poiCategory: "park", radiusMeters: 100, fallbackTimerMs: 10 * MINUTE },
            },
          },
        },
        {
          id: "curse-photo-cart",
          category: "curse",
          copies: 1,
          title: "Street Snack Proof",
          description: "Seekers must photograph a street snack stand before asking questions.",
          effect: {
            primitive: "curse",
            curse: {
              castingCosts: [{ type: "none" }],
              blockerType: "block_questions",
              effectModifiers: [{ type: "skip_penalty_minutes", penaltyMinutes: 4 }],
              clearCondition: {
                type: "photo_challenge",
                prompt: "Send a photo of any public street snack stand.",
                approvalMode: "opponent_or_timeout",
                autoApproveMs: 3 * MINUTE,
              },
            },
          },
        },
      ],
    },
    ...overrides,
  };
}

test("valid synthetic RulebookPack + GeoSnapshot passes all validation gates with all 9 primitives", () => {
  const snapshot = buildSyntheticSnapshot();
  const pack = buildSyntheticPack(snapshot);
  const result = api.validateHideSeekRulebook(pack, snapshot);

  assert.equal(result.ok, true, `Unexpected errors: ${JSON.stringify(result.errors)}`);
  assert.equal(result.errors.length, 0);
  assert.equal(result.summary.eligibleAnchorCount, 6);
  assert.equal(result.summary.reachableAnchorCount, 6);
  assert.equal(result.summary.totalDeckCards, 18);
  assert.equal(result.summary.objectiveQuestionCount, 11);
  assert.equal(result.summary.photoQuestionCount, 2);
  assert.ok(
    result.warnings.some((w) => w.code === "low-anchor-station-count"),
    "6 anchors should trigger recommendation warning for 12+",
  );
});

test("computeGeoSnapshotHash is deterministic regardless of object key order and catches tampering", () => {
  const snapshot = buildSyntheticSnapshot();
  const reordered = {
    attributions: snapshot.attributions,
    pois: snapshot.pois,
    stations: snapshot.stations,
    startPoint: {
      accessNotes: snapshot.startPoint.accessNotes,
      longitude: snapshot.startPoint.longitude,
      latitude: snapshot.startPoint.latitude,
      name: snapshot.startPoint.name,
      id: snapshot.startPoint.id,
    },
    boundaryPolygon: snapshot.boundaryPolygon,
    id: snapshot.id,
  };
  assert.equal(api.computeGeoSnapshotHash(reordered), snapshot.hash);

  const tampered = { ...snapshot, hash: "0".repeat(64) };
  const pack = buildSyntheticPack(snapshot);
  const result = api.validateHideSeekRulebook(pack, tampered);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.code === "snapshot-hash-invalid"));
  assert.ok(result.errors.some((e) => e.code === "snapshot-hash-mismatch"));
});

test("rejects missing or under-populated POI categories referenced by questions and curses", () => {
  const snapshot = buildSyntheticSnapshot({
    pois: [{ id: "park-only-one", name: "Lonely Park", category: "park", latitude: 1.03, longitude: 100.03 }],
  });
  const pack = buildSyntheticPack(snapshot);
  const result = api.validateHideSeekRulebook(pack, snapshot);

  assert.equal(result.ok, false);
  const poiErrors = result.errors.filter((e) => e.code === "insufficient-pois-for-category");
  assert.ok(poiErrors.length >= 4, `Expected POI errors across matching, measuring, tentacles, and gps_detour; got ${poiErrors.length}`);
  assert.ok(result.errors.some((e) => e.code === "unknown-named-poi"));
});

test("rejects unseparable anchor pairs even when photo prompts are enabled", () => {
  const base = buildSyntheticSnapshot();
  const duplicateAnchor = {
    ...base.stations[0],
    id: "st-north-twin",
    name: "North Twin", // same length (10 chars) as "North Gate"
  };
  const snapshot = buildSyntheticSnapshot({
    stations: [...base.stations, duplicateAnchor],
  });
  const pack = buildSyntheticPack(snapshot);
  const result = api.validateHideSeekRulebook(pack, snapshot);

  assert.equal(result.ok, false);
  assert.ok(
    result.errors.some(
      (e) =>
        e.code === "unseparable-anchor-pair" &&
        e.message.includes("st-north") &&
        e.message.includes("st-north-twin"),
    ),
  );
});

test("rejects stations or startPoint outside boundaryPolygon and insufficient anchor stations", () => {
  const base = buildSyntheticSnapshot();
  const outsideStations = base.stations.slice(0, 5).map((s, idx) =>
    idx === 0 ? { ...s, latitude: 1.2, longitude: 100.2 } : s,
  );
  const snapshot = buildSyntheticSnapshot({
    startPoint: { ...base.startPoint, latitude: 0.9, longitude: 99.9 },
    stations: outsideStations,
  });
  const pack = buildSyntheticPack(snapshot);
  const result = api.validateHideSeekRulebook(pack, snapshot);

  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.code === "start-outside-boundary"));
  assert.ok(result.errors.some((e) => e.code === "station-outside-boundary"));
  assert.ok(result.errors.some((e) => e.code === "insufficient-anchor-stations"));
});

test("rejects anti-grief violations: unbounded photo autoApproveMs, excessive blocking curse timer, and invalid primitives", () => {
  const snapshot = buildSyntheticSnapshot();
  const basePack = buildSyntheticPack(snapshot);
  const pack = {
    ...basePack,
    investigationBook: {
      ...basePack.investigationBook,
      families: {
        ...basePack.investigationBook.families,
        tentacles: { ...basePack.investigationBook.families.tentacles, enabled: false },
      },
    },
    deck: {
      ...basePack.deck,
      baseHandLimit: 9,
      cards: [
        ...basePack.deck.cards,
        {
          id: "bad-photo-curse",
          category: "curse",
          copies: 1,
          title: "Forever Photo",
          description: "Auto approve set way too high.",
          effect: {
            primitive: "curse",
            curse: {
              castingCosts: [{ type: "none" }],
              blockerType: "block_questions",
              effectModifiers: [{ type: "ban_question_family", family: "tentacles" }],
              clearCondition: {
                type: "photo_challenge",
                prompt: "Take a photo of a fountain.",
                approvalMode: "opponent_or_timeout",
                autoApproveMs: 12 * MINUTE,
              },
            },
          },
        },
        {
          id: "bad-long-block",
          category: "curse",
          copies: 1,
          title: "Too Long Block",
          description: "Blocks seekers for 40 minutes of a 60 minute game.",
          effect: {
            primitive: "curse",
            curse: {
              castingCosts: [{ type: "none" }],
              blockerType: "block_both",
              clearCondition: { type: "timer", durationMs: 40 * MINUTE },
            },
          },
        },
        {
          id: "mismatched-category",
          category: "powerup",
          copies: 1,
          title: "Disguised Bonus",
          description: "Wrong category for primitive.",
          effect: { primitive: "time_bonus", minutes: 3 },
        },
      ],
    },
  };
  const result = api.validateHideSeekRulebook(pack, snapshot);

  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.code === "invalid-hand-limit"));
  assert.ok(result.errors.some((e) => e.code === "unbounded-photo-auto-approve"));
  assert.ok(result.errors.some((e) => e.code === "blocking-curse-duration-exceeded"));
  assert.ok(result.errors.some((e) => e.code === "invalid-curse-modifier"));
  assert.ok(result.errors.some((e) => e.code === "card-category-mismatch"));
});

test("rejects timing infeasibility, unreachable anchors, invalid player counts, and priced official packs", () => {
  const base = buildSyntheticSnapshot();
  const slowStations = base.stations.map((s) => ({ ...s, estimatedTravelFromStartMs: 40 * MINUTE }));
  const snapshot = buildSyntheticSnapshot({ stations: slowStations });
  const basePack = buildSyntheticPack(snapshot);
  const pack = {
    ...basePack,
    meta: { ...basePack.meta, isOfficial: true, priceIdr: 25_000 },
    session: { ...basePack.session, minPlayers: 5, maxPlayers: 3 },
    timers: { ...basePack.timers, headStartMs: 30 * MINUTE, searchLimitMs: 45 * MINUTE },
  };
  const result = api.validateHideSeekRulebook(pack, snapshot);

  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.code === "official-pack-must-be-free"));
  assert.ok(result.errors.some((e) => e.code === "invalid-player-range"));
  assert.ok(result.errors.some((e) => e.code === "search-limit-too-short"));
  assert.ok(result.errors.some((e) => e.code === "insufficient-reachable-anchors"));
});
