import assert from "node:assert/strict";
import test from "node:test";
import * as api from "../dist/index.js";

const MINUTE = 60_000;

function buildSnapshot(overrides = {}) {
  const base = {
    id: "testharbor-v1",
    boundaryPolygon: [
      { latitude: 2.0, longitude: 101.0 },
      { latitude: 2.0, longitude: 101.05 },
      { latitude: 2.05, longitude: 101.05 },
      { latitude: 2.05, longitude: 101.0 },
    ],
    startPoint: {
      id: "harbor-gate",
      name: "Harbor Gate",
      latitude: 2.025,
      longitude: 101.025,
      accessNotes: "Public waterfront steps.",
    },
    stations: [],
    pois: [
      { id: "park-a", name: "East Pier Park", category: "park", latitude: 2.03, longitude: 101.03 },
      { id: "park-b", name: "West Grove", category: "park", latitude: 2.02, longitude: 101.02 },
    ],
    attributions: [
      { source: "TestHarbor Synthetic", retrievedAt: "2026-11-22T00:00:00Z", notice: "Synthetic test geo data." },
    ],
    ...overrides,
  };
  return { ...base, hash: overrides.hash ?? api.computeGeoSnapshotHash(base) };
}

function challenge(id, payload) {
  return {
    id,
    title: `Challenge ${id}`,
    verificationNotes: "Verified from public street sidewalk without paid entry.",
    reviewed: true,
    reviewedAt: "2026-11-22",
    payload,
  };
}

function buildClaimPack(snapshot, overrides = {}) {
  const landmarks = [
    { id: "lm-1", name: "Pier Clock", zoneId: "z-north", latitude: 2.03, longitude: 101.025, transitSummary: "Tram 1", accessNotes: "Public square", publicHours: "06:00-22:00", estimatedTravelFromStartMs: 6 * MINUTE, estimatedChallengeMs: 4 * MINUTE },
    { id: "lm-2", name: "Boat Arch", zoneId: "z-north", latitude: 2.032, longitude: 101.028, transitSummary: "Tram 1", accessNotes: "Harbor walk", publicHours: "06:00-22:00", estimatedTravelFromStartMs: 8 * MINUTE, estimatedChallengeMs: 4 * MINUTE },
    { id: "lm-3", name: "Bell Plaza", zoneId: "z-north", latitude: 2.028, longitude: 101.022, transitSummary: "Tram 2", accessNotes: "Open plaza", publicHours: "06:00-22:00", estimatedTravelFromStartMs: 7 * MINUTE, estimatedChallengeMs: 4 * MINUTE },
    { id: "lm-4", name: "South Fountain", zoneId: "z-south", latitude: 2.02, longitude: 101.025, transitSummary: "Bus 3", accessNotes: "Park entrance", publicHours: "06:00-22:00", estimatedTravelFromStartMs: 7 * MINUTE, estimatedChallengeMs: 4 * MINUTE },
    { id: "lm-5", name: "Iron Bridge", zoneId: "z-south", latitude: 2.018, longitude: 101.028, transitSummary: "Bus 3", accessNotes: "Footbridge deck", publicHours: "06:00-22:00", estimatedTravelFromStartMs: 9 * MINUTE, estimatedChallengeMs: 4 * MINUTE },
    { id: "lm-6", name: "Market Mural", zoneId: "z-south", latitude: 2.021, longitude: 101.021, transitSummary: "Bus 4", accessNotes: "Market alley", publicHours: "06:00-22:00", estimatedTravelFromStartMs: 8 * MINUTE, estimatedChallengeMs: 4 * MINUTE },
  ];

  return {
    meta: {
      packId: "testharbor-claim-v1",
      version: 1,
      schemaVersion: "claim-city-rulebook-v1",
      format: "claim-the-city",
      isOfficial: true,
      title: "TestHarbor Claim the City",
      byline: "Kelana Ria Core",
      summary: "Synthetic city Claim pack covering all 6 challenge and 6 card primitives.",
      cityLabel: "TestHarbor",
      difficulty: "starter",
      priceIdr: 0,
    },
    session: {
      minPlayers: 1,
      maxPlayers: 6,
      teamMode: "ffa",
      requireStartCheckIn: true,
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
      allowedTransitModes: ["walk", "mrt", "transjakarta"],
      geoSnapshotId: snapshot.id,
      geoSnapshotHash: snapshot.hash,
      zones: [
        { id: "z-north", name: "North Pier", label: "N", icon: "anchor" },
        { id: "z-south", name: "South Market", label: "S", icon: "market" },
      ],
      landmarks,
    },
    challenges: {
      challengeMode: "per_landmark",
      landmarkChallenges: {
        "lm-1": [
          challenge("ch-1", {
            primitive: "observation_mcq",
            prompt: "What shape frames the harbor clock face?",
            choices: [
              { id: "a", label: "Octagon" },
              { id: "b", label: "Triangle" },
            ],
            correctChoiceId: "a",
          }),
        ],
        "lm-2": [
          challenge("ch-2", {
            primitive: "observation_input",
            prompt: "How many lantern posts line the Boat Arch?",
            inputMode: "number",
            numericRange: { min: 4, max: 4 },
          }),
        ],
        "lm-3": [
          challenge("ch-3", {
            primitive: "photo_proof",
            prompt: "Snap the bronze bell inscription from the plaza steps.",
            verificationMode: "rival_or_timeout",
            autoApproveMs: 2 * MINUTE,
          }),
        ],
        "lm-4": [
          challenge("ch-4", {
            primitive: "timed_micro_task",
            prompt: "Walk to the fountain north rim within 4 minutes.",
            timeLimitMs: 4 * MINUTE,
            taskType: "sub_point_gps",
            subPoint: { latitude: 2.0205, longitude: 101.0252, label: "North Rim", radiusMeters: 30 },
          }),
        ],
        "lm-5": [
          challenge("ch-5", {
            primitive: "call_your_shot",
            theme: "Iron Bridge observation",
            standardTask: {
              primitive: "observation_input",
              prompt: "Read the bridge year plaque.",
              inputMode: "text",
              acceptedAnswers: ["1928"],
            },
            boldTask: {
              primitive: "photo_proof",
              prompt: "Snap a passing tram crossing the bridge arch.",
              verificationMode: "rival_or_timeout",
              autoApproveMs: 2 * MINUTE,
            },
            boldReward: { drawTacticalCard: true },
          }),
        ],
        "lm-6": [
          challenge("ch-6", {
            primitive: "multi_step",
            steps: [
              {
                primitive: "observation_input",
                prompt: "Count the painted boats on the Market Mural.",
                inputMode: "number",
                acceptedAnswers: ["3"],
              },
              {
                primitive: "photo_proof",
                prompt: "Snap the market entrance signboard.",
                verificationMode: "rival_or_timeout",
                autoApproveMs: 2 * MINUTE,
              },
            ],
          }),
        ],
      },
      backupPool: [
        challenge("bak-1", {
          primitive: "observation_input",
          prompt: "Name the nearest street sign visible from your landmark.",
          inputMode: "text",
          acceptedAnswers: ["harbor", "pier", "market"],
        }),
        challenge("bak-2", {
          primitive: "photo_proof",
          prompt: "Snap a public transit timetable or stop sign.",
          verificationMode: "rival_or_timeout",
          autoApproveMs: 2 * MINUTE,
        }),
      ],
    },
    tacticalDeck: {
      enabled: true,
      maxHandSize: 3,
      drawTriggers: { onLock: true, onSteal: true, onBoldChallenge: true },
      maxActiveCursesPerTarget: 1,
      cards: [
        { id: "c-scout", copies: 2, title: "Scout", description: "Peek any hidden challenge.", effect: { primitive: "scout_challenge" } },
        { id: "c-shield", copies: 2, title: "Shield", description: "Protect a claim for 15 minutes.", effect: { primitive: "shield_claim", durationMs: 15 * MINUTE } },
        { id: "c-double", copies: 2, title: "Double", description: "Locked landmark counts 2x.", effect: { primitive: "double_weight" } },
        { id: "c-swap", copies: 2, title: "Swap", description: "Swap an active challenge from backup pool.", effect: { primitive: "swap_challenge" } },
        { id: "c-instant", copies: 1, title: "Instant Lock", description: "Lock a claimed landmark instantly.", effect: { primitive: "instant_lock" } },
        {
          id: "c-curse",
          copies: 1,
          title: "Park Detour",
          description: "Block rival steals until they check in at a park.",
          effect: {
            primitive: "sabotage_curse",
            blockerType: "block_steals",
            clearCondition: { type: "gps_detour", poiCategory: "park", radiusMeters: 100 },
          },
        },
      ],
    },
    ...overrides,
  };
}

test("valid synthetic ClaimRulebookPack passes all gates with all 6 challenge and 6 tactical card primitives", () => {
  const snapshot = buildSnapshot();
  const pack = buildClaimPack(snapshot);
  const result = api.validateClaimRulebook(pack, snapshot);

  assert.equal(result.ok, true, `Unexpected errors: ${JSON.stringify(result.errors)}`);
  assert.equal(result.summary.zoneCount, 2);
  assert.equal(result.summary.landmarkCount, 6);
  assert.equal(result.summary.totalDeckCards, 10);
  assert.ok(result.summary.feasibleSoloOpenings >= 2);
});

test("validates an optional whole-number draw count from one to six", () => {
  const snapshot = buildSnapshot();
  const pack = buildClaimPack(snapshot);
  for (const drawCount of [undefined, 1, 3, 6]) {
    pack.tacticalDeck.claimRewardDrawCount = drawCount;
    assert.equal(api.validateClaimRulebook(pack, snapshot).ok, true);
  }
  for (const drawCount of [0, 1.5, 7, "3", null]) {
    pack.tacticalDeck.claimRewardDrawCount = drawCount;
    assert.ok(api.validateClaimRulebook(pack, snapshot).errors.some((error) => error.code === "invalid-claim-reward-draw"));
  }
});

test("rejects unknown zone assignment, unreviewed challenge, missing backupPool, and unbounded photo autoApproveMs", () => {
  const snapshot = buildSnapshot();
  const base = buildClaimPack(snapshot);
  const pack = {
    ...base,
    geography: {
      ...base.geography,
      landmarks: base.geography.landmarks.map((lm, idx) =>
        idx === 0 ? { ...lm, zoneId: "z-missing" } : lm,
      ),
    },
    challenges: {
      ...base.challenges,
      backupPool: [],
      landmarkChallenges: {
        ...base.challenges.landmarkChallenges,
        "lm-3": [
          {
            ...base.challenges.landmarkChallenges["lm-3"][0],
            reviewed: false,
            payload: {
              primitive: "photo_proof",
              prompt: "Snap the bronze bell inscription.",
              verificationMode: "rival_or_timeout",
              autoApproveMs: 10 * MINUTE,
            },
          },
        ],
      },
    },
  };
  const result = api.validateClaimRulebook(pack, snapshot);

  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.code === "unknown-landmark-zone"));
  assert.ok(result.errors.some((e) => e.code === "unreviewed-challenge"));
  assert.ok(result.errors.some((e) => e.code === "unbounded-photo-auto-approve"));
  assert.ok(result.errors.some((e) => e.code === "insufficient-backup-pool"));
});

test("rejects infeasible solo routes, subPoint outside boundary, and invalid deck curse caps", () => {
  const snapshot = buildSnapshot({ pois: [] });
  const base = buildClaimPack(snapshot);
  const pack = {
    ...base,
    session: {
      ...base.session,
      durationMs: 15 * MINUTE,
      soloTargets: { lockedLandmarks: 5, distinctZones: 2 },
    },
    challenges: {
      ...base.challenges,
      landmarkChallenges: {
        ...base.challenges.landmarkChallenges,
        "lm-4": [
          challenge("ch-4-out", {
            primitive: "timed_micro_task",
            prompt: "Walk outside the boundary.",
            timeLimitMs: 4 * MINUTE,
            taskType: "sub_point_gps",
            subPoint: { latitude: 2.5, longitude: 101.5, label: "Far", radiusMeters: 30 },
          }),
        ],
      },
    },
    tacticalDeck: {
      ...base.tacticalDeck,
      maxHandSize: 6,
      maxActiveCursesPerTarget: 2,
    },
  };
  const result = api.validateClaimRulebook(pack, snapshot);

  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.code === "infeasible-solo-routes"));
  assert.ok(result.errors.some((e) => e.code === "subpoint-outside-boundary"));
  assert.ok(result.errors.some((e) => e.code === "invalid-hand-limit"));
  assert.ok(result.errors.some((e) => e.code === "invalid-curse-cap"));
  assert.ok(result.errors.some((e) => e.code === "insufficient-pois-for-category"));
});

test("accepts Claim session maxPlayers up to 12 and rejects > 12 or minPlayers > maxPlayers (#146)", () => {
  const snapshot = buildSnapshot();
  const base = buildClaimPack(snapshot);

  const validTwelve = api.validateClaimRulebook(
    { ...base, session: { ...base.session, minPlayers: 1, maxPlayers: 12 } },
    snapshot,
  );
  assert.equal(validTwelve.ok, true, `Expected maxPlayers=12 to pass: ${JSON.stringify(validTwelve.errors)}`);

  const validLargeGroup = api.validateClaimRulebook(
    { ...base, session: { ...base.session, minPlayers: 8, maxPlayers: 12 } },
    snapshot,
  );
  assert.equal(validLargeGroup.ok, true, `Expected 8..12 players to pass: ${JSON.stringify(validLargeGroup.errors)}`);

  const tooMany = api.validateClaimRulebook(
    { ...base, session: { ...base.session, minPlayers: 2, maxPlayers: 13 } },
    snapshot,
  );
  assert.equal(tooMany.ok, false);
  assert.ok(tooMany.errors.some((e) => e.code === "invalid-player-range" && e.path === "session.maxPlayers"));

  const inverted = api.validateClaimRulebook(
    { ...base, session: { ...base.session, minPlayers: 10, maxPlayers: 6 } },
    snapshot,
  );
  assert.equal(inverted.ok, false);
  assert.ok(inverted.errors.some((e) => e.code === "invalid-player-range" && e.path === "session.minPlayers"));
});


test("Claim verifies imported landmarks and POIs and requires edited AI challenge field notes", () => {
  for (const { pack, snapshot } of api.loadOfficialClaimPacks()) assert.equal(api.validateClaimRulebook(pack, snapshot).ok, true);
  const { pack, snapshot } = structuredClone(api.loadOfficialClaimPacks()[0]);
  const landmark = pack.geography.landmarks[0];
  const poi = snapshot.pois[0];
  const challenge = pack.challenges.landmarkChallenges[landmark.id][0];
  Object.assign(landmark, { source: "osm-curated", osmId: "node/12345", fieldVerified: false });
  Object.assign(poi, { source: "osm-curated", fieldVerified: true, fieldVerifiedAt: "2026-02-31", gpsVerifiedProximityMeters: -1 });
  Object.assign(challenge, {
    aiProvenance: { source: "ai-co-creator", mode: "recorded-rehearsal", generatedAt: "2026-11-27T01:00:00Z", draftNoteMarker: "[DRAFT]" },
    reviewed: false, reviewedAt: "", verificationNotes: "[DRAFT] Proposed observation.",
  });
  const verify = () => {
    snapshot.hash = api.computeGeoSnapshotHash(snapshot);
    pack.geography.geoSnapshotHash = snapshot.hash;
    return api.validateClaimRulebook(pack, snapshot);
  };
  const errors = verify().errors;
  for (const code of ["unverified-osm-landmark", "unverified-osm-poi", "osm-verification-note-required",
    "invalid-verification-proximity", "unverified-ai-challenge", "unedited-ai-verification-notes"]) {
    assert.ok(errors.some(issue => issue.code === code), code);
  }
  for (const point of [poi, landmark]) Object.assign(point, {
    fieldVerified: true, fieldVerifiedAt: "2026-11-27", fieldVerificationNote: "Checked public access on site.",
    gpsVerifiedProximityMeters: 0,
  });
  Object.assign(challenge, {
    reviewed: true, reviewedAt: "2026-11-27", verificationNotes: "Confirmed the observation from the public entrance.",
  });
  const result = verify();
  assert.equal(result.ok, true, JSON.stringify(result.errors));
});
