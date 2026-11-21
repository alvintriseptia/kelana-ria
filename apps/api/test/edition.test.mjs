import assert from "node:assert/strict";
import test from "node:test";
import * as api from "../dist/index.js";

const initialTime = 1_800_000_000_000;
const correctIndexes = [1, 0, 2, 1, 2, 0];

async function listen(context, options) {
  const server = api.createSoloServer(options);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const close = () =>
    new Promise((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  context.after(() => (server.listening ? close() : undefined));
  return { url: `http://127.0.0.1:${server.address().port}`, close };
}

function client(url, initialCookie) {
  let cookie = initialCookie;
  let session;
  let nextAction = 0;
  async function request(path, body) {
    const headers = {};
    if (cookie) headers.cookie = cookie;
    if (body !== undefined) headers["content-type"] = "application/json";
    const response = await fetch(`${url}${path}`, {
      method: body === undefined ? "GET" : "POST",
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const setCookie = response.headers.get("set-cookie");
    if (setCookie) cookie = setCookie.split(";")[0];
    const data = await response.json();
    if (data.session && !path.includes("sessionId=")) session = data.session;
    return { ...data, status: response.status, setCookie };
  }
  return {
    get: (query = "") => request(`/api/solo${query}`),
    challenge: (point) => request(`/api/solo/challenge?checkpointId=${point.id}`),
    post: (type, fields = {}) =>
      request("/api/solo", {
        type,
        actionId: `action-${++nextAction}`,
        sessionId: session?.id,
        ...fields,
      }),
    get session() {
      return session;
    },
    get cookie() {
      return cookie;
    },
  };
}

test("two distinct Compact editions pass validation with different viable openings and attributed route snapshot (A22, §7)", () => {
  const first = api.validateSoloFixture(api.compactTrial);
  const second = api.validateSoloFixture(api.compactAlternate);
  assert.equal(first.ok, true);
  assert.equal(second.ok, true);

  assert.equal(first.fixture.edition.board, "compact");
  assert.equal(first.fixture.edition.boardVersion, api.COMPACT_BOARD_VERSION);
  assert.equal(first.fixture.edition.format, "claim-the-city");
  assert.equal(first.fixture.edition.players, 1);

  assert.ok(first.openings.length >= 2, "First edition supports at least two distinct opening checkpoints");
  assert.ok(second.openings.length >= 2, "Second edition supports at least two distinct opening checkpoints");
  assert.notEqual(first.openings[0].firstCheckpointId, first.openings[1].firstCheckpointId);
  assert.notEqual(second.openings[0].firstCheckpointId, second.openings[1].firstCheckpointId);

  for (const plan of [...first.openings, ...second.openings]) {
    assert.ok(plan.stops.length >= 4);
    assert.ok(plan.zones.length >= 2);
    assert.ok(plan.unvisitedCount >= 1, "Winning route leaves at least one active landmark unvisited");
    assert.ok(
      plan.withMissedConnectionMs <= first.fixture.edition.durationMs,
      "Winning route remains feasible after adding one missed connection",
    );
  }

  assert.equal(api.isFreshSoloEdition(second.fixture.edition, first.fixture.edition), true);
  const wordingRepeat = {
    ...first.fixture.edition,
    id: "compact-solo-reworded",
    checkpoints: [...first.fixture.edition.checkpoints].reverse(),
  };
  assert.equal(
    api.isFreshSoloEdition(wordingRepeat, first.fixture.edition),
    false,
    "Same active landmark set is treated as a repeat even if reordered or renamed",
  );

  assert.equal(first.routes.source, "snapshot");
  assert.equal(first.routes.provider, "Geoapify Routing API");
  assert.match(first.routes.attribution, /Geoapify/);
  assert.match(first.routes.attribution, /OpenStreetMap/);
  assert.match(first.routes.attribution, /Transjakarta GTFS/);
});

test("validator rejects wrong-site tasks, unreviewed answers, invalid zones, nonexistent routes and A22 violations (A13, A17, A22)", () => {
  // A17: Assign a reviewed Blok M task (taman-literasi) to another site (plaza-senayan).
  const wrongSite = structuredClone(api.compactTrial);
  wrongSite.tasks["plaza-senayan"] = structuredClone(api.compactTrial.tasks["taman-literasi"]);
  assert.deepEqual(api.validateSoloFixture(wrongSite), {
    ok: false,
    error: "wrong-site-task",
    checkpointId: "plaza-senayan",
  });

  // A17: Landmark lacks a field-reviewed answer key.
  const unreviewed = structuredClone(api.compactTrial);
  unreviewed.tasks["taman-literasi"].reviewed = false;
  assert.deepEqual(api.validateSoloFixture(unreviewed), {
    ok: false,
    error: "unreviewed-answer",
    checkpointId: "taman-literasi",
  });

  const missingAnswerKey = structuredClone(api.compactTrial);
  missingAnswerKey.tasks["taman-literasi"].correctChoiceId = "nonexistent-choice";
  assert.deepEqual(api.validateSoloFixture(missingAnswerKey), {
    ok: false,
    error: "unreviewed-answer",
    checkpointId: "taman-literasi",
  });

  // A13: Invalid zone membership, unknown checkpoint, unsupported challenge, stale board.
  const wrongZone = structuredClone(api.compactTrial);
  wrongZone.edition.checkpoints[0].zone = "Senayan";
  assert.deepEqual(api.validateSoloFixture(wrongZone), {
    ok: false,
    error: "invalid-zone-membership",
    checkpointId: "taman-literasi",
  });

  assert.deepEqual(
    api.validateSoloFixture({
      checkpoints: ["invented-landmark", "m-bloc", "taman-literasi", "plaza-senayan", "stadion-madya"],
    }),
    {
      ok: false,
      error: "unknown-checkpoint",
      checkpointId: "invented-landmark",
    },
  );

  const unsupportedChallenge = structuredClone(api.compactTrial);
  unsupportedChallenge.tasks["taman-literasi"].challenge.choices = [{ id: "only-one", label: "Tunggal" }];
  assert.deepEqual(api.validateSoloFixture(unsupportedChallenge), {
    ok: false,
    error: "unsupported-challenge",
    checkpointId: "taman-literasi",
  });

  const staleBoard = structuredClone(api.compactTrial);
  staleBoard.edition.boardVersion = "compact-board-v0-stale";
  assert.deepEqual(api.validateSoloFixture(staleBoard), {
    ok: false,
    error: "stale-board",
  });

  // A22: Single landmark target, requiring every active landmark, or only one viable opening.
  const singleLandmarkWin = structuredClone(api.compactTrial);
  singleLandmarkWin.edition.targets = { landmarks: 1, zones: 2 };
  assert.deepEqual(api.validateSoloFixture(singleLandmarkWin), {
    ok: false,
    error: "single-landmark-target",
  });

  const requiresAllLandmarks = structuredClone(api.compactTrial);
  requiresAllLandmarks.edition.checkpoints = [
    requiresAllLandmarks.edition.checkpoints[0],
    requiresAllLandmarks.edition.checkpoints[1],
    requiresAllLandmarks.edition.checkpoints[4],
    requiresAllLandmarks.edition.checkpoints[5],
  ];
  assert.deepEqual(api.validateSoloFixture(requiresAllLandmarks), {
    ok: false,
    error: "requires-all-landmarks",
  });

  const oneOpeningRoutes = {
    ...api.compactWalkingSnapshot,
    legs: api.compactWalkingSnapshot.legs.filter(
      (leg) => leg.fromId !== "csw-asean" || leg.toId === "m-bloc",
    ),
  };
  assert.deepEqual(
    api.validateSoloFixture(api.compactTrial, { routes: oneOpeningRoutes }),
    {
      ok: false,
      error: "single-viable-opening",
    },
  );

  // A13: Nonexistent route and unreachable target.
  const brokenRoutes = {
    ...api.compactWalkingSnapshot,
    legs: api.compactWalkingSnapshot.legs.filter((leg) => leg.fromId !== "csw-asean"),
  };
  assert.deepEqual(
    api.validateSoloFixture(api.compactTrial, { routes: brokenRoutes }),
    {
      ok: false,
      error: "nonexistent-route",
    },
  );

  const unreachableDuration = structuredClone(api.compactTrial);
  unreachableDuration.edition.durationMs = 20 * 60_000;
  assert.deepEqual(api.validateSoloFixture(unreachableDuration), {
    ok: false,
    error: "unreachable-target",
  });
});

test("fake AI provider retries once on invalid output and falls back to same-configuration prepared edition on double failure or outage (A13, A14)", async (context) => {
  const seenRequests = [];
  // 1. First attempt returns invalid zone, second attempt returns valid compactAlternate.
  const retryServer = await listen(context, {
    databasePath: ":memory:",
    now: () => initialTime,
    aiProvider(request) {
      seenRequests.push(request);
      if (request.attempt === 1) {
        return {
          id: "bad-ai-attempt-1",
          checkpoints: [
            { id: "taman-literasi", zone: "WrongZone" },
            "blok-m-plaza",
            "m-bloc",
            "taman-ayodya",
            "stadion-madya",
            "plaza-senayan",
          ],
        };
      }
      return {
        id: "live-ai-kebayoran-v1",
        checkpoints: [
          "pasar-mayestik",
          "velbak-kebayoran",
          "taman-daksa",
          "taman-ayodya",
          "plaza-senayan",
          "stasiun-palmerah",
        ],
      };
    },
  });

  const firstPlayer = client(retryServer.url);
  const liveReply = await firstPlayer.get();
  assert.equal(liveReply.status, 200);
  assert.equal(liveReply.session.edition.id, "live-ai-kebayoran-v1");
  assert.equal(liveReply.session.edition.origin, "live");
  assert.equal(seenRequests.length, 2);
  assert.deepEqual(
    Object.keys(seenRequests[0]).sort(),
    ["attempt", "board", "boardVersion", "format", "players", "previousEditionId", "remainingBudgetMs"],
    "AI prompt request contains no player coordinates or private credentials",
  );

  // 2. Both AI attempts return invalid output (wrong-site prompt & single opening) -> same-configuration prepared fallback.
  let doubleFailCalls = 0;
  const fallbackServer = await listen(context, {
    databasePath: ":memory:",
    now: () => initialTime,
    aiProvider(request) {
      doubleFailCalls += 1;
      if (request.attempt === 1) {
        return {
          id: "wrong-site-ai",
          checkpoints: [
            { id: "plaza-senayan", taskId: "taman-literasi" },
            "blok-m-plaza",
            "m-bloc",
            "taman-ayodya",
            "stadion-madya",
            "taman-literasi",
          ],
        };
      }
      return {
        id: "single-target-ai",
        targets: { landmarks: 1, zones: 2 },
        checkpoints: ["taman-literasi", "blok-m-plaza", "m-bloc", "taman-ayodya", "stadion-madya", "plaza-senayan"],
      };
    },
  });

  const fallbackPlayer = client(fallbackServer.url);
  const fallbackReply = await fallbackPlayer.get();
  assert.equal(fallbackReply.status, 200);
  assert.equal(doubleFailCalls, 2);
  assert.equal(fallbackReply.session.edition.origin, "prepared");
  assert.equal(fallbackReply.session.edition.board, "compact");
  assert.equal(fallbackReply.session.edition.format, "claim-the-city");
  assert.equal(fallbackReply.session.edition.players, 1);
  assert.equal(fallbackReply.session.edition.fallbackReason, "single-landmark-target");

  // 3. AI timeout (>15s budget) and walking route API outage -> uses approved route snapshot & prepared fallback without a second AI attempt.
  let clock = initialTime;
  let timeoutAiCalls = 0;
  let routeCalls = 0;
  const outageServer = await listen(context, {
    databasePath: ":memory:",
    now: () => clock,
    routeProvider() {
      routeCalls += 1;
      throw new Error("Geoapify walking API unavailable");
    },
    aiProvider() {
      timeoutAiCalls += 1;
      clock += 16_000; // Exceed 15-second generation budget
      return api.compactAlternate;
    },
  });

  const outagePlayer = client(outageServer.url);
  const outageReply = await outagePlayer.get();
  assert.equal(outageReply.status, 200);
  assert.equal(routeCalls, 1);
  assert.equal(timeoutAiCalls, 1, "Timeout over 15s budget does not trigger a second AI attempt");
  assert.equal(outageReply.session.edition.origin, "prepared");
  assert.equal(outageReply.session.edition.fallbackReason, "ai-timeout");
  assert.equal(outageReply.session.edition.routes.source, "snapshot");
});

test("no AI or routing provider calls occur during an active session even when providers fail mid-session (A14)", async (context) => {
  let now = initialTime;
  let aiCalls = 0;
  let routeCalls = 0;
  let failProviders = false;

  const { url } = await listen(context, {
    databasePath: ":memory:",
    now: () => now,
    aiProvider() {
      aiCalls += 1;
      if (failProviders) throw new Error("AI outage mid-session");
      return api.compactTrial;
    },
    routeProvider() {
      routeCalls += 1;
      if (failProviders) throw new Error("Routing outage mid-session");
      return api.compactWalkingSnapshot;
    },
  });

  const player = client(url);
  const briefing = await player.get();
  assert.equal(briefing.status, 200);
  assert.equal(aiCalls, 1);
  assert.equal(routeCalls, 1);

  // Freeze providers in a failing state before check-in, start, challenges, and claims.
  failProviders = true;
  const fix = (point) => ({
    latitude: point.latitude,
    longitude: point.longitude,
    accuracy: 8,
    timestamp: now,
  });

  assert.equal(
    (await player.post("check-in", { checkpointId: player.session.edition.start.id, fix: fix(player.session.edition.start) })).error,
    undefined,
  );
  assert.equal((await player.post("start")).session.phase, "active");

  for (const index of [0, 1, 4, 2]) {
    now += 60_000;
    const point = player.session.edition.checkpoints[index];
    const visit = await player.post("check-in", { checkpointId: point.id, fix: fix(point) });
    assert.equal(visit.error, undefined);
    const reloaded = await player.challenge(point);
    assert.equal(reloaded.challenge.checkpointId, point.id);
    const choiceId = visit.challenge.choices[correctIndexes[index]].id;
    await player.post("answer", { checkpointId: point.id, choiceId });
  }

  assert.equal(player.session.phase, "won");
  assert.equal((await player.get()).session.phase, "won");
  assert.equal(aiCalls, 1, "Zero AI calls made after briefing preparation");
  assert.equal(routeCalls, 1, "Zero routing calls made after briefing preparation");
});

test("checkpoint closure stops new starts and same-edition replays while preserving completed results and original edition (A20)", async (context) => {
  let now = initialTime;
  const closed = new Set();
  const { url } = await listen(context, {
    databasePath: ":memory:",
    now: () => now,
    closedCheckpoints: () => closed,
  });

  const player = client(url);
  await player.get();
  const originalEdition = structuredClone(player.session.edition);
  const fix = (point) => ({
    latitude: point.latitude,
    longitude: point.longitude,
    accuracy: 8,
    timestamp: now,
  });

  // Play first session to a win.
  await player.post("check-in", {
    checkpointId: player.session.edition.start.id,
    fix: fix(player.session.edition.start),
  });
  await player.post("start");
  for (const index of [0, 1, 4, 2]) {
    const point = player.session.edition.checkpoints[index];
    const visit = await player.post("check-in", { checkpointId: point.id, fix: fix(point) });
    const choiceId = visit.challenge.choices[correctIndexes[index]].id;
    await player.post("answer", { checkpointId: point.id, choiceId });
  }
  assert.equal(player.session.phase, "won");
  const completedSessionId = player.session.id;
  const completedEvents = structuredClone(player.session.events);

  // Close Taman Literasi before replay starts.
  closed.add("taman-literasi");

  // Previous results remain readable and original edition is preserved.
  const currentView = await player.get();
  assert.equal(currentView.session.id, completedSessionId);
  assert.equal(currentView.session.phase, "won");
  assert.deepEqual(currentView.session.events, completedEvents);
  assert.deepEqual(currentView.session.edition, originalEdition);

  // Attempting to replay the closed edition is blocked and explains which checkpoint closed.
  const blockedReplay = await player.post("replay", { actionId: "replay-closed" });
  assert.equal(blockedReplay.error, "checkpoint-closed");
  assert.equal(blockedReplay.closedCheckpointId, "taman-literasi");
  assert.equal(blockedReplay.session.id, completedSessionId);
  assert.equal(blockedReplay.session.phase, "won");
  assert.deepEqual(blockedReplay.session.edition, originalEdition);

  // Player can switch to the open alternate prepared edition for the same configuration,
  // while the previous completed session and its original edition remain preserved by ID.
  const freshReplay = await player.post("replay", {
    actionId: "replay-fresh-open",
    freshEdition: true,
  });
  assert.equal(freshReplay.error, undefined);
  assert.notEqual(freshReplay.session.id, completedSessionId);
  assert.equal(freshReplay.session.phase, "briefing");
  assert.equal(freshReplay.session.edition.id, "compact-solo-kebayoran-v1");

  const archived = await player.get(`?sessionId=${completedSessionId}`);
  assert.equal(archived.status, 200);
  assert.equal(archived.session.id, completedSessionId);
  assert.equal(archived.session.phase, "won");
  assert.deepEqual(archived.session.events, completedEvents);
  assert.deepEqual(archived.session.edition, originalEdition);

  // Now close Pasar Mayestik while the new session is in briefing before Start.
  closed.add("pasar-mayestik");
  const blockedStartCheckIn = await player.post("check-in", {
    checkpointId: player.session.edition.start.id,
    fix: fix(player.session.edition.start),
  });
  assert.equal(blockedStartCheckIn.error, "checkpoint-closed");
  assert.equal(blockedStartCheckIn.closedCheckpointId, "pasar-mayestik");
  assert.equal(blockedStartCheckIn.session.startedAt, null);
  assert.equal(blockedStartCheckIn.session.deadline, null);
});
