import assert from "node:assert/strict";
import test from "node:test";
import * as api from "../dist/index.js";

const initialTime = 1_800_000_000_000;

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

function makeClient(url) {
  let cookie;
  let seq = 0;
  return {
    async request(method, path, body) {
      const headers = {};
      if (cookie) headers.cookie = cookie;
      if (body !== undefined) headers["content-type"] = "application/json";
      const response = await fetch(`${url}${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const setCookie = response.headers.get("set-cookie");
      if (setCookie) cookie = setCookie.split(";")[0];
      const data = await response.json();
      return { status: response.status, data };
    },
    actionId: () => `rel-${++seq}`,
  };
}

function fixAt(point, at) {
  return { latitude: point.latitude, longitude: point.longitude, accuracy: 5, timestamp: at };
}

test("Jakarta-wide editions validate with >=2 checkpoints outside Compact and reject zoomed-out Compact boards (A01, A22, §2)", async () => {
  const first = api.validateSoloFixture(api.wideTrial, {
    catalog: api.wideCatalog,
    routes: api.wideWalkingSnapshot,
  });
  const second = api.validateSoloFixture(api.wideAlternate, {
    catalog: api.wideCatalog,
    routes: api.wideWalkingSnapshot,
  });
  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  assert.equal(first.fixture.edition.board, "jakarta-wide");
  assert.equal(first.fixture.edition.boardVersion, api.JAKARTA_WIDE_BOARD_VERSION);
  assert.equal(first.fixture.edition.durationMs, 120 * 60_000);
  assert.ok(first.openings.length >= 2);
  assert.ok(second.openings.length >= 2);
  assert.equal(api.isFreshSoloEdition(second.fixture.edition, first.fixture.edition), true);

  for (const fixture of [first.fixture, second.fixture]) {
    const outsideCompact = fixture.edition.checkpoints.filter(
      (point) => !api.compactCheckpointIdSet.has(point.id),
    );
    assert.ok(outsideCompact.length >= 2, "Wide edition must activate at least two points outside Compact");
  }

  // Reject a zoomed-out Compact edition proposed on Jakarta-wide (0 points outside Compact).
  const zoomedCompact = api.validateSoloFixture(
    {
      id: "zoomed-out-compact",
      board: "jakarta-wide",
      boardVersion: api.JAKARTA_WIDE_BOARD_VERSION,
      checkpoints: [
        "taman-literasi",
        "blok-m-plaza",
        "m-bloc",
        "taman-ayodya",
        "stadion-madya",
        "plaza-senayan",
      ],
    },
    { catalog: api.wideCatalog, routes: api.wideWalkingSnapshot },
  );
  assert.deepEqual(zoomedCompact, { ok: false, error: "insufficient-wide-checkpoints" });

  // Reject wide edition with only 1 point outside Compact.
  const onlyOneWide = api.validateSoloFixture(
    {
      id: "only-one-wide",
      board: "jakarta-wide",
      boardVersion: api.JAKARTA_WIDE_BOARD_VERSION,
      checkpoints: [
        "dukuh-atas",
        "taman-literasi",
        "blok-m-plaza",
        "m-bloc",
        "stadion-madya",
        "plaza-senayan",
      ],
    },
    { catalog: api.wideCatalog, routes: api.wideWalkingSnapshot },
  );
  assert.deepEqual(onlyOneWide, { ok: false, error: "insufficient-wide-checkpoints" });

  // Same-configuration prepared fallback on Jakarta-wide outage never switches to Compact.
  const fallback = await api.prepareSoloFixture({
    catalog: api.wideCatalog,
    snapshotRoutes: api.wideWalkingSnapshot,
    fallbacks: api.preparedWideFixtures,
    aiProvider() {
      throw new Error("ai-outage");
    },
  });
  assert.equal(fallback.ok, true);
  assert.equal(fallback.origin, "prepared");
  assert.equal(fallback.fixture.edition.board, "jakarta-wide");
  assert.equal(fallback.fixture.edition.format, "claim-the-city");
  assert.equal(fallback.fixture.edition.players, 1);

  // Every Duo and Hide & Seek board fixture has matching board metadata and >=2 wide outer checkpoints.
  assert.equal(api.wideDuoTrial.edition.board, "jakarta-wide");
  assert.equal(api.wideDuoTrial.edition.durationMs, 120 * 60_000);
  assert.ok(
    api.wideDuoTrial.edition.checkpoints.filter((p) => !api.compactCheckpointIdSet.has(p.id)).length >= 2,
  );
  assert.equal(api.wideSeekTrial.edition.board, "jakarta-wide");
  assert.equal(api.wideSeekTrial.edition.headStartMs, 60 * 60_000);
  assert.equal(api.wideSeekTrial.edition.searchMs, 120 * 60_000);
  assert.equal(api.wideSeekTrial.edition.regroupMs, 60 * 60_000);
  assert.ok(
    api.wideSeekTrial.edition.checkpoints.filter((p) => !api.compactCheckpointIdSet.has(p.id)).length >= 2,
  );
});

test("all six section 2 configurations run from start to terminal state and persist on refresh (A01, A20)", async (context) => {
  let now = initialTime;
  const closed = new Set();
  const { url } = await listen(context, {
    databasePath: ":memory:",
    now: () => now,
    closedCheckpoints: () => closed,
  });

  // Invalid board parameters are rejected with 400 across all APIs.
  const probe = makeClient(url);
  assert.equal((await probe.request("GET", "/api/solo?board=bandung")).status, 400);
  await probe.request("GET", "/api/duo");
  assert.equal(
    (await probe.request("POST", "/api/duo", { type: "create", actionId: probe.actionId(), board: "bandung" })).status,
    400,
  );
  await probe.request("GET", "/api/seek");
  assert.equal(
    (await probe.request("POST", "/api/seek", { type: "create", actionId: probe.actionId(), board: "bandung" })).status,
    400,
  );

  // --- Cells 1 & 4: Solo Claim on Compact AND Jakarta-wide (sharing one browser cookie, isolated per board) ---
  const soloClient = makeClient(url);
  for (const board of ["compact", "jakarta-wide"]) {
    const query = board === "jakarta-wide" ? "?board=jakarta-wide" : "";
    const boot = await soloClient.request("GET", `/api/solo${query}`);
    assert.equal(boot.status, 200);
    const { session: briefing } = boot.data;
    assert.equal(briefing.edition.board, board);
    assert.equal(briefing.edition.durationMs, (board === "jakarta-wide" ? 120 : 60) * 60_000);
    if (board === "jakarta-wide") {
      const outside = briefing.edition.checkpoints.filter((p) => !api.compactCheckpointIdSet.has(p.id));
      assert.ok(outside.length >= 2, "Wide solo session activates >=2 points outside Compact");
    }

    await soloClient.request("POST", `/api/solo${query}`, {
      type: "check-in",
      actionId: soloClient.actionId(),
      sessionId: briefing.id,
      checkpointId: briefing.edition.start.id,
      fix: fixAt(briefing.edition.start, now),
    });
    const started = await soloClient.request("POST", `/api/solo${query}`, {
      type: "start",
      actionId: soloClient.actionId(),
      sessionId: briefing.id,
    });
    assert.equal(started.data.session.phase, "active");

    const tasks = board === "jakarta-wide" ? api.wideReviewedTasks : api.compactReviewedTasks;
    const byZone = new Map();
    for (const point of briefing.edition.checkpoints) {
      const list = byZone.get(point.zone) ?? [];
      list.push(point);
      byZone.set(point.zone, list);
    }
    const picks = [];
    for (const [, list] of byZone) {
      for (const p of list.slice(0, 2)) {
        if (picks.length < 4) picks.push(p);
      }
    }
    let latest;
    for (const point of picks) {
      now += 60_000;
      await soloClient.request("POST", `/api/solo${query}`, {
        type: "check-in",
        actionId: soloClient.actionId(),
        sessionId: briefing.id,
        checkpointId: point.id,
        fix: fixAt(point, now),
      });
      latest = (
        await soloClient.request("POST", `/api/solo${query}`, {
          type: "answer",
          actionId: soloClient.actionId(),
          sessionId: briefing.id,
          checkpointId: point.id,
          choiceId: tasks[point.id].correctChoiceId,
        })
      ).data.session;
    }
    assert.equal(latest.phase, "won");
    assert.ok(latest.claimed.length >= 4 && latest.zones.length >= 2);
    // Refresh persists terminal result for this board.
    const refreshed = (await soloClient.request("GET", `/api/solo${query}`)).data.session;
    assert.equal(refreshed.id, latest.id);
    assert.equal(refreshed.phase, "won");
    assert.equal(refreshed.edition.board, board);
  }

  // A20 on Jakarta-wide: closing Taman Fatahillah blocks same-edition replay while preserving completed result.
  closed.add("taman-fatahillah");
  const wideWon = (await soloClient.request("GET", "/api/solo?board=jakarta-wide")).data.session;
  const blockedReplay = await soloClient.request("POST", "/api/solo?board=jakarta-wide", {
    type: "replay",
    actionId: soloClient.actionId(),
    sessionId: wideWon.id,
  });
  assert.equal(blockedReplay.data.error, "checkpoint-closed");
  assert.equal(blockedReplay.data.closedCheckpointId, "taman-fatahillah");
  assert.equal(blockedReplay.data.session.phase, "won");
  closed.clear();

  // --- Cells 2 & 5: Duo Claim on Compact AND Jakarta-wide ---
  for (const board of ["compact", "jakarta-wide"]) {
    const host = makeClient(url);
    const guest = makeClient(url);
    await host.request("GET", "/api/duo");
    await guest.request("GET", "/api/duo");
    const created = await host.request("POST", "/api/duo", {
      type: "create",
      actionId: host.actionId(),
      board,
    });
    assert.equal(created.status, 200);
    const room = created.data.room;
    assert.equal(room.edition.board, board);
    assert.equal(room.edition.durationMs, (board === "jakarta-wide" ? 120 : 60) * 60_000);
    if (board === "jakarta-wide") {
      assert.ok(
        room.edition.checkpoints.filter((p) => !api.compactCheckpointIdSet.has(p.id)).length >= 2,
      );
    }

    await guest.request("POST", "/api/duo", {
      type: "join",
      actionId: guest.actionId(),
      code: room.code,
    });
    for (const player of [host, guest]) {
      await player.request("POST", `/api/duo/${room.code}`, {
        type: "check-in",
        actionId: player.actionId(),
        checkpointId: room.edition.start.id,
        fix: fixAt(room.edition.start, now),
      });
      await player.request("POST", `/api/duo/${room.code}`, {
        type: "ready",
        actionId: player.actionId(),
        ready: true,
      });
    }
    const started = (
      await host.request("POST", `/api/duo/${room.code}`, {
        type: "start",
        actionId: host.actionId(),
      })
    ).data.room;
    assert.equal(started.phase, "active");

    const tasks = board === "jakarta-wide" ? api.wideReviewedTasks : api.compactReviewedTasks;
    const firstPoint = started.edition.checkpoints[0];
    now += 60_000;
    await host.request("POST", `/api/duo/${room.code}`, {
      type: "check-in",
      actionId: host.actionId(),
      checkpointId: firstPoint.id,
      fix: fixAt(firstPoint, now),
    });
    await host.request("POST", `/api/duo/${room.code}`, {
      type: "answer",
      actionId: host.actionId(),
      checkpointId: firstPoint.id,
      choiceId: tasks[firstPoint.id].correctChoiceId,
    });

    // Advance clock to expiry; both devices persist the finished outcome on refresh.
    now = started.deadline + 1;
    const hostFinal = (await host.request("GET", `/api/duo/${room.code}`)).data.room;
    const guestFinal = (await guest.request("GET", `/api/duo/${room.code}`)).data.room;
    assert.equal(hostFinal.phase, "finished");
    assert.equal(hostFinal.outcome?.winner, "host");
    assert.equal(guestFinal.phase, "finished");
    assert.equal(guestFinal.outcome?.winner, "host");
    assert.equal(guestFinal.edition.board, board);
  }

  // --- Cells 3 & 6: Hide & Seek (two players) on Compact AND Jakarta-wide ---
  for (const board of ["compact", "jakarta-wide"]) {
    const host = makeClient(url);
    const guest = makeClient(url);
    await host.request("GET", "/api/seek");
    await guest.request("GET", "/api/seek");
    const created = await host.request("POST", "/api/seek", {
      type: "create",
      actionId: host.actionId(),
      board,
    });
    assert.equal(created.status, 200);
    const room = created.data.room;
    assert.equal(room.edition.board, board);
    assert.equal(room.edition.headStartMs, (board === "jakarta-wide" ? 60 : 30) * 60_000);
    assert.equal(room.edition.searchMs, (board === "jakarta-wide" ? 120 : 60) * 60_000);
    if (board === "jakarta-wide") {
      assert.ok(
        room.edition.checkpoints.filter((p) => !api.compactCheckpointIdSet.has(p.id)).length >= 2,
      );
    }

    await guest.request("POST", "/api/seek", {
      type: "join",
      actionId: guest.actionId(),
      code: room.code,
    });
    const assigned = (
      await host.request("POST", `/api/seek/${room.code}`, {
        type: "assign",
        actionId: host.actionId(),
        hider: "host",
      })
    ).data.room;
    for (const player of [host, guest]) {
      await player.request("POST", `/api/seek/${room.code}`, {
        type: "check-in",
        actionId: player.actionId(),
        phase: "lobby",
        turn: 1,
        fix: fixAt(room.edition.start, now),
      });
      await player.request("POST", `/api/seek/${room.code}`, {
        type: "ready",
        actionId: player.actionId(),
        ready: true,
        roleRevision: assigned.roleRevision,
      });
    }
    const turn1 = (
      await host.request("POST", `/api/seek/${room.code}`, {
        type: "start",
        actionId: host.actionId(),
      })
    ).data.room;
    assert.equal(turn1.phase, "head-start");

    // Turn 1: host locks a checkpoint (outside Compact on wide board), guest seeks + asks radar + finds host.
    const lock1 = room.edition.checkpoints[0];
    now += 60_000;
    await host.request("POST", `/api/seek/${room.code}`, {
      type: "lock",
      actionId: host.actionId(),
      turn: 1,
      checkpointId: lock1.id,
      fix: fixAt(lock1, now),
    });
    now = turn1.releaseAt + 1_000;
    await guest.request("POST", `/api/seek/${room.code}`, {
      type: "check-in",
      actionId: guest.actionId(),
      phase: "seeking",
      turn: 1,
      fix: fixAt(room.edition.start, now),
    });
    // Ask a radar clue (4000 m on Compact, 12000 m on Jakarta-wide).
    const radarRadius = board === "jakarta-wide" ? 12000 : 4000;
    const asked = await guest.request("POST", `/api/seek/${room.code}`, {
      type: "ask",
      actionId: guest.actionId(),
      turn: 1,
      family: "radar",
      radiusMeters: radarRadius,
      referenceId: room.edition.start.id,
    });
    assert.equal(asked.status, 200);
    assert.equal(asked.data.error, undefined);
    // Find host at 10 minutes into search.
    now = turn1.releaseAt + 10 * 60_000;
    const found1 = (
      await guest.request("POST", `/api/seek/${room.code}`, {
        type: "investigate",
        actionId: guest.actionId(),
        turn: 1,
        checkpointId: lock1.id,
        fix: fixAt(lock1, now),
      })
    ).data.room;
    assert.equal(found1.phase, "regroup");

    // Regroup and swap roles for turn 2.
    now += 60_000;
    for (const player of [host, guest]) {
      await player.request("POST", `/api/seek/${room.code}`, {
        type: "check-in",
        actionId: player.actionId(),
        phase: "regroup",
        turn: 1,
        fix: fixAt(room.edition.start, now),
      });
    }
    const turn2 = (await host.request("GET", `/api/seek/${room.code}`)).data.room;
    assert.equal(turn2.phase, "head-start");
    assert.equal(turn2.turn, 2);
    assert.equal(turn2.hider, "guest");

    // Turn 2: guest locks a second checkpoint, host finds guest at 20 minutes -> guest wins.
    const lock2 = room.edition.checkpoints[3];
    now += 60_000;
    await guest.request("POST", `/api/seek/${room.code}`, {
      type: "lock",
      actionId: guest.actionId(),
      turn: 2,
      checkpointId: lock2.id,
      fix: fixAt(lock2, now),
    });
    now = turn2.releaseAt + 1_000;
    await host.request("POST", `/api/seek/${room.code}`, {
      type: "check-in",
      actionId: host.actionId(),
      phase: "seeking",
      turn: 2,
      fix: fixAt(room.edition.start, now),
    });
    now = turn2.releaseAt + 20 * 60_000;
    await host.request("POST", `/api/seek/${room.code}`, {
      type: "investigate",
      actionId: host.actionId(),
      turn: 2,
      checkpointId: lock2.id,
      fix: fixAt(lock2, now),
    });

    const hostEnd = (await host.request("GET", `/api/seek/${room.code}`)).data.room;
    const guestEnd = (await guest.request("GET", `/api/seek/${room.code}`)).data.room;
    assert.equal(hostEnd.phase, "finished");
    assert.equal(hostEnd.outcome?.winner, "guest");
    assert.equal(guestEnd.phase, "finished");
    assert.equal(guestEnd.outcome?.winner, "guest");
    assert.equal(guestEnd.edition.board, board);
  }
});
