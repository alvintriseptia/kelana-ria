import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import http from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import * as api from "../dist/index.js";

const T0 = 1_800_000_000_000;

async function startServer(clockRef, databasePath = ":memory:") {
  const server = api.createSoloServer({
    databasePath,
    now: () => clockRef.now,
    midtrans: api.createRecordedMidtransAdapter(),
    allowRulebookSandboxCheckout: true,
    allowHideSeekQa: true,
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  return { server, port, baseUrl: `http://127.0.0.1:${port}` };
}

function makeClient(baseUrl) {
  let cookie = "";
  return {
    get cookie() {
      return cookie;
    },
    async get(path, extraHeaders = {}) {
      const res = await fetch(`${baseUrl}${path}`, {
        headers: { ...(cookie ? { cookie } : {}), ...extraHeaders },
      });
      const setCookie = res.headers.get("set-cookie");
      if (setCookie) cookie = setCookie.split(";")[0];
      const text = await res.text();
      return {
        status: res.status,
        headers: res.headers,
        body: text ? JSON.parse(text) : null,
      };
    },
    async post(path, body) {
      const res = await fetch(`${baseUrl}${path}`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(cookie ? { cookie } : {}),
        },
        body: JSON.stringify(body),
      });
      const setCookie = res.headers.get("set-cookie");
      if (setCookie) cookie = setCookie.split(";")[0];
      const text = await res.text();
      return {
        status: res.status,
        headers: res.headers,
        body: text ? JSON.parse(text) : null,
      };
    },
  };
}

function openSseStream(port, path, cookie = "") {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: "127.0.0.1",
        port,
        path,
        method: "GET",
        headers: {
          Accept: "text/event-stream",
          ...(cookie ? { Cookie: cookie } : {}),
        },
      },
      (res) => {
        const events = [];
        const waiters = [];
        let buffer = "";

        const notifyWaiters = () => {
          for (let i = waiters.length - 1; i >= 0; i -= 1) {
            const waiter = waiters[i];
            const match = events.find(waiter.predicate);
            if (match) {
              waiters.splice(i, 1);
              clearTimeout(waiter.timer);
              waiter.resolve(match);
            }
          }
        };

        res.setEncoding("utf8");
        res.on("data", (chunk) => {
          buffer += chunk;
          let idx;
          while ((idx = buffer.indexOf("\n\n")) !== -1) {
            const frame = buffer.slice(0, idx);
            buffer = buffer.slice(idx + 2);
            let eventName = "message";
            const dataLines = [];
            for (const line of frame.split("\n")) {
              if (line.startsWith("event:")) eventName = line.slice(6).trim();
              else if (line.startsWith("data:")) dataLines.push(line.slice(5).trim());
            }
            if (dataLines.length > 0) {
              events.push({ event: eventName, data: JSON.parse(dataLines.join("\n")) });
              notifyWaiters();
            }
          }
        });

        resolve({
          status: res.statusCode,
          events,
          waitFor(predicate, timeoutMs = 2000) {
            const existing = events.find(predicate);
            if (existing) return Promise.resolve(existing);
            return new Promise((resWait, rejWait) => {
              const timer = setTimeout(() => {
                const pos = waiters.findIndex((w) => w.timer === timer);
                if (pos !== -1) waiters.splice(pos, 1);
                rejWait(new Error(`Timed out waiting for SSE event (${events.length} received)`));
              }, timeoutMs);
              waiters.push({ predicate, resolve: resWait, timer });
            });
          },
          close() {
            req.destroy();
            res.destroy();
          },
        });
      },
    );
    req.on("error", reject);
    req.end();
  });
}

async function setupActiveClaimGroupRoom(baseUrl, clock) {
  const host = makeClient(baseUrl);
  const guest = makeClient(baseUrl);
  const listingsRes = await host.get("/api/rulebooks?format=claim-the-city");
  const pack = listingsRes.body.listings.find((l) => l.isOfficial && l.priceIdr === 0);
  assert.ok(pack, "official free Claim pack must exist");

  const created = await host.post("/api/rulebooks", {
    type: "create-free-room",
    packId: pack.packId,
    version: pack.version,
    mode: "group",
    hostName: "Alvin",
  });
  assert.equal(created.status, 200);
  const roomCode = created.body.roomCode;

  const joined = await guest.post("/api/rulebooks", {
    type: "join-room",
    roomCode,
    name: "Budi",
  });
  assert.equal(joined.status, 200);

  const initialView = await host.get(`/api/rulebooks/rooms/${roomCode}`);
  assert.equal(initialView.status, 200);
  const startPoint = initialView.body.publicBoard.startPoint;
  const landmarks = initialView.body.publicBoard.landmarks;

  return { host, guest, roomCode, pack, startPoint, landmarks };
}

test("Claim presence rejects unauthenticated, non-member, lobby, solo, Hide & Seek, and invalid GPS pings", async () => {
  const clock = { now: T0 };
  const { server, baseUrl } = await startServer(clock);
  try {
    const { host, guest, roomCode, pack, startPoint } = await setupActiveClaimGroupRoom(baseUrl, clock);
    const outsider = makeClient(baseUrl);
    await outsider.get("/api/rulebooks?format=claim-the-city");

    const validFix = {
      latitude: startPoint.latitude,
      longitude: startPoint.longitude,
      accuracy: 12,
      timestamp: clock.now,
    };

    // Unauthenticated -> uniform 404
    const unauthRes = await fetch(`${baseUrl}/api/rulebooks/rooms/${roomCode}/presence`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ fix: validFix }),
    });
    assert.equal(unauthRes.status, 404);

    // Non-member -> uniform 404
    const outsiderRes = await outsider.post(`/api/rulebooks/rooms/${roomCode}/presence`, { fix: validFix });
    assert.equal(outsiderRes.status, 404);

    // Unknown room -> uniform 404
    const unknownRes = await host.post("/api/rulebooks/rooms/RC-000000/presence", { fix: validFix });
    assert.equal(unknownRes.status, 404);

    // Lobby phase -> 400 room-not-active
    const lobbyRes = await host.post(`/api/rulebooks/rooms/${roomCode}/presence`, { fix: validFix });
    assert.equal(lobbyRes.status, 400);
    assert.equal(lobbyRes.body.error, "room-not-active");

    // Start group match
    for (const [idx, client] of [host, guest].entries()) {
      const ci = await client.post("/api/rulebooks", {
        type: "room-action",
        roomCode,
        action: { type: "check-in-start", actionId: `ci-${idx}`, fix: validFix },
      });
      assert.equal(ci.status, 200);
      const rdy = await client.post("/api/rulebooks", {
        type: "room-action",
        roomCode,
        action: { type: "ready", actionId: `rdy-${idx}`, ready: true },
      });
      assert.equal(rdy.status, 200);
    }
    const started = await host.post("/api/rulebooks", {
      type: "room-action",
      roomCode,
      action: { type: "start", actionId: "start-1" },
    });
    assert.equal(started.status, 200);

    // Invalid coordinates / stale / inaccurate GPS rejected without mutation
    const badCoord = await host.post(`/api/rulebooks/rooms/${roomCode}/presence`, {
      fix: { latitude: 999, longitude: 106.8, accuracy: 10, timestamp: clock.now },
    });
    assert.equal(badCoord.status, 400);
    assert.equal(badCoord.body.error, "invalid-fix");

    const staleFix = await host.post(`/api/rulebooks/rooms/${roomCode}/presence`, {
      fix: { latitude: startPoint.latitude, longitude: startPoint.longitude, accuracy: 10, timestamp: clock.now - 120_000 },
    });
    assert.equal(staleFix.status, 400);
    assert.equal(staleFix.body.error, "stale-fix");

    const inaccurateFix = await host.post(`/api/rulebooks/rooms/${roomCode}/presence`, {
      fix: { latitude: startPoint.latitude, longitude: startPoint.longitude, accuracy: 500, timestamp: clock.now },
    });
    assert.equal(inaccurateFix.status, 400);
    assert.equal(inaccurateFix.body.error, "inaccurate-fix");

    const afterInvalid = await host.get(`/api/rulebooks/rooms/${roomCode}`);
    assert.deepEqual(afterInvalid.body.room.seatPositions, []);

    // Solo Claim match -> presence disabled
    const soloHost = makeClient(baseUrl);
    const soloCreate = await soloHost.post("/api/rulebooks", {
      type: "create-free-room",
      packId: pack.packId,
      version: pack.version,
      mode: "solo",
      hostName: "SoloPlayer",
    });
    const soloCode = soloCreate.body.roomCode;
    await soloHost.post("/api/rulebooks", {
      type: "room-action",
      roomCode: soloCode,
      action: { type: "check-in-start", actionId: "s-ci", fix: validFix },
    });
    await soloHost.post("/api/rulebooks", {
      type: "room-action",
      roomCode: soloCode,
      action: { type: "ready", actionId: "s-rdy", ready: true },
    });
    await soloHost.post("/api/rulebooks", {
      type: "room-action",
      roomCode: soloCode,
      action: { type: "start", actionId: "s-start" },
    });
    const soloView = await soloHost.get(`/api/rulebooks/rooms/${soloCode}`);
    assert.equal(soloView.body.room.opponentTracking.mode, "off");
    assert.equal(soloView.body.room.seatPositions, undefined);
    const soloPing = await soloHost.post(`/api/rulebooks/rooms/${soloCode}/presence`, { fix: validFix });
    assert.equal(soloPing.status, 400);
    assert.equal(soloPing.body.error, "presence-disabled");

    // Hide & Seek room -> uniform 404 (never broadcasts live coordinates)
    const seekListings = await host.get("/api/rulebooks?format=hide-and-seek");
    const seekPack = seekListings.body.listings.find((l) => l.isOfficial && l.priceIdr === 0);
    const seekCreate = await host.post("/api/rulebooks", {
      type: "create-free-room",
      packId: seekPack.packId,
      version: seekPack.version,
      hostName: "SeekerHost",
    });
    const seekPing = await host.post(`/api/rulebooks/rooms/${seekCreate.body.roomCode}/presence`, { fix: validFix });
    assert.equal(seekPing.status, 404);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("Claim presence streams live SSE pushes without bumping stateRev or writing SQLite, supports check-in fallback, throttles floods, and wipes on match end", async () => {
  const dir = mkdtempSync(join(tmpdir(), "kelana-presence-"));
  const dbPath = join(dir, "rulebook.sqlite");
  const clock = { now: T0 };
  const { server, port, baseUrl } = await startServer(clock, dbPath);
  const streams = [];
  try {
    const { host, guest, roomCode, startPoint, landmarks } = await setupActiveClaimGroupRoom(baseUrl, clock);
    const startFix = {
      latitude: startPoint.latitude,
      longitude: startPoint.longitude,
      accuracy: 10,
      timestamp: clock.now,
    };

    for (const [idx, client] of [host, guest].entries()) {
      await client.post("/api/rulebooks", {
        type: "room-action",
        roomCode,
        action: { type: "check-in-start", actionId: `ci-${idx}`, fix: startFix },
      });
      await client.post("/api/rulebooks", {
        type: "room-action",
        roomCode,
        action: { type: "ready", actionId: `rdy-${idx}`, ready: true },
      });
    }
    await host.post("/api/rulebooks", {
      type: "room-action",
      roomCode,
      action: { type: "start", actionId: "start-live" },
    });

    const beforeView = await host.get(`/api/rulebooks/rooms/${roomCode}`);
    const initialStateRev = beforeView.body.stateRev;
    const initialEtag = beforeView.headers.get("etag");
    assert.equal(beforeView.body.room.opponentTracking.mode, "periodic_gps");

    // Subscribe both seats via SSE
    const sHost = await openSseStream(port, `/api/rulebooks/rooms/${roomCode}/events`, host.cookie);
    const sGuest = await openSseStream(port, `/api/rulebooks/rooms/${roomCode}/events`, guest.cookie);
    streams.push(sHost, sGuest);

    // Initial connect delivers both rev and presence snapshots
    await sHost.waitFor((e) => e.event === "rev");
    const initPresence = await sGuest.waitFor((e) => e.event === "presence");
    assert.deepEqual(initPresence.data.positions, []);

    // Host sends a live GPS ping near landmark 0
    const lm0 = landmarks[0];
    const pingLat = Number((lm0.latitude + 0.00012).toFixed(6));
    const pingLng = Number((lm0.longitude - 0.00011).toFixed(6));
    const tPingStart = Date.now();
    const pingRes = await host.post(`/api/rulebooks/rooms/${roomCode}/presence`, {
      fix: { latitude: pingLat, longitude: pingLng, accuracy: 12, timestamp: clock.now },
    });
    assert.equal(pingRes.status, 200);
    assert.equal(pingRes.body.broadcast, true);
    assert.equal(pingRes.body.position.source, "gps");
    assert.equal(pingRes.body.position.zoneId, lm0.zoneId);

    // Both seats receive SSE presence event rapidly (< 500 ms)
    const guestEv = await sGuest.waitFor(
      (e) => e.event === "presence" && e.data.positions.some((p) => p.seatId === "seat-1" && p.source === "gps"),
      500,
    );
    assert.ok(Date.now() - tPingStart < 500, "presence SSE delivery must be < 500 ms");
    const hostPos = guestEv.data.positions.find((p) => p.seatId === "seat-1");
    assert.equal(hostPos.latitude, pingLat);
    assert.equal(hostPos.longitude, pingLng);
    assert.equal(hostPos.at, clock.now);

    // stateRev did NOT bump, while ETag reflects updated presence for polling fallback
    const afterPingView = await guest.get(`/api/rulebooks/rooms/${roomCode}`, { "If-None-Match": initialEtag });
    assert.equal(afterPingView.status, 200);
    assert.equal(afterPingView.body.stateRev, initialStateRev);
    assert.equal(afterPingView.body.room.seatPositions.length, 1);

    // Identical ETag returns 304 when nothing changed
    const secondEtag = afterPingView.headers.get("etag");
    const notModified = await guest.get(`/api/rulebooks/rooms/${roomCode}`, { "If-None-Match": secondEtag });
    assert.equal(notModified.status, 304);

    // Verify SQLite rulebook_live_rooms contains ZERO raw GPS presence coordinates
    const inspectDb = new DatabaseSync(dbPath, { readOnly: true });
    try {
      const liveRow = inspectDb.prepare("SELECT state_rev, payload FROM rulebook_live_rooms WHERE room_code = ?").get(roomCode);
      assert.equal(liveRow.state_rev, initialStateRev);
      assert.equal(liveRow.payload.includes("seatPositions"), false);
      assert.equal(liveRow.payload.includes(String(pingLat)), false);
      assert.equal(liveRow.payload.includes(String(pingLng)), false);
    } finally {
      inspectDb.close();
    }

    // Rapid ping flood (< 3s) is rate-limited (429) without breaking normal actions
    clock.now += 1_000;
    const flooded = await host.post(`/api/rulebooks/rooms/${roomCode}/presence`, {
      fix: { latitude: pingLat + 0.001, longitude: pingLng, accuracy: 12, timestamp: clock.now },
    });
    assert.equal(flooded.status, 429);
    assert.equal(flooded.body.error, "presence-rate-limited");
    assert.ok(Number(flooded.headers.get("retry-after")) >= 1);

    // Sub-10m movement after 3.5s (within 10s interval) updates freshness timestamp without redundant broadcast
    clock.now += 3_500;
    const microMove = await host.post(`/api/rulebooks/rooms/${roomCode}/presence`, {
      fix: { latitude: pingLat + 0.00001, longitude: pingLng, accuracy: 10, timestamp: clock.now },
    });
    assert.equal(microMove.status, 200);
    assert.equal(microMove.body.broadcast, false);

    // Once normal interval elapses (10s), broadcast fires even with < 10m movement to refresh staleness
    clock.now += 10_000;
    const intervalRefresh = await host.post(`/api/rulebooks/rooms/${roomCode}/presence`, {
      fix: { latitude: pingLat + 0.00001, longitude: pingLng, accuracy: 10, timestamp: clock.now },
    });
    assert.equal(intervalRefresh.status, 200);
    assert.equal(intervalRefresh.body.broadcast, true);

    // Guest never sent a GPS ping -> verified landmark check-in updates seatPositions with source: "checkin"
    const lm1 = landmarks[1] ?? landmarks[0];
    const checkInRes = await guest.post("/api/rulebooks", {
      type: "room-action",
      roomCode,
      action: {
        type: "check-in-landmark",
        actionId: "guest-lm-ci",
        landmarkId: lm1.id,
        fix: { latitude: lm1.latitude, longitude: lm1.longitude, accuracy: 12, timestamp: clock.now },
      },
    });
    assert.equal(checkInRes.status, 200);
    const checkinPresence = await sHost.waitFor(
      (e) => e.event === "presence" && e.data.positions.some((p) => p.seatId === "seat-2" && p.source === "checkin"),
      500,
    );
    const guestPos = checkinPresence.data.positions.find((p) => p.seatId === "seat-2");
    assert.equal(guestPos.latitude, lm1.latitude);
    assert.equal(guestPos.longitude, lm1.longitude);
    assert.equal(guestPos.zoneId, lm1.zoneId);

    // Match completion (forfeit via leave) wipes ephemeral seatPositions immediately
    clock.now += 5_000;
    const leaveRes = await guest.post("/api/rulebooks", {
      type: "room-action",
      roomCode,
      action: { type: "leave", actionId: "guest-leave" },
    });
    assert.equal(leaveRes.status, 200);

    const wipeEvent = await sHost.waitFor(
      (e) => e.event === "presence" && Array.isArray(e.data.positions) && e.data.positions.length === 0,
      500,
    );
    assert.deepEqual(wipeEvent.data.positions, []);

    // Finished room rejects further presence pings and returns no seatPositions
    const postEndPing = await host.post(`/api/rulebooks/rooms/${roomCode}/presence`, {
      fix: { latitude: pingLat, longitude: pingLng, accuracy: 10, timestamp: clock.now },
    });
    assert.equal(postEndPing.status, 400);
    assert.equal(postEndPing.body.error, "room-not-active");

    const finishedView = await host.get(`/api/rulebooks/rooms/${roomCode}`);
    assert.equal(finishedView.body.room.seatPositions, undefined);

    // Private recap, public shared recap, and SQLite rulebook_recaps contain ZERO raw presence coordinates
    const privateRecap = await host.get(`/api/rulebooks/recaps/${roomCode}`);
    assert.equal(privateRecap.status, 200);
    assert.equal(JSON.stringify(privateRecap.body).includes(String(pingLat)), false);
    assert.equal(JSON.stringify(privateRecap.body).includes("seatPositions"), false);

    const shared = await host.post(`/api/rulebooks/recaps/${roomCode}/share`, { useApprovedRoomNames: false });
    assert.equal(shared.status, 200);
    const publicRecap = await host.get(`/api/rulebooks/shared/${shared.body.share.shareId}`);
    assert.equal(publicRecap.status, 200);
    assert.equal(JSON.stringify(publicRecap.body).includes(String(pingLat)), false);

    const inspectEndDb = new DatabaseSync(dbPath, { readOnly: true });
    try {
      const recapsRows = inspectEndDb.prepare("SELECT payload FROM rulebook_recaps").all();
      assert.ok(recapsRows.length >= 1);
      for (const row of recapsRows) {
        assert.equal(row.payload.includes(String(pingLat)), false);
        assert.equal(row.payload.includes("seatPositions"), false);
      }
    } finally {
      inspectEndDb.close();
    }
  } finally {
    for (const s of streams) s.close();
    await new Promise((resolve) => server.close(resolve));
    rmSync(dir, { recursive: true, force: true });
  }
});

test("Claim rulebook validator accepts valid opponentTracking config and rejects invalid modes or intervals", () => {
  const loaded = api.loadOfficialClaimPacks();
  assert.ok(loaded.length > 0);
  const { pack, snapshot } = loaded[0];

  const validPack = structuredClone(pack);
  validPack.session.opponentTracking = { mode: "periodic_gps", intervalMs: 12_000 };
  const okRes = api.validateClaimRulebook(validPack, snapshot);
  assert.equal(okRes.ok, true);

  const badModePack = structuredClone(pack);
  badModePack.session.opponentTracking = { mode: "always_stalk" };
  const badModeRes = api.validateClaimRulebook(badModePack, snapshot);
  assert.equal(badModeRes.ok, false);
  assert.ok(badModeRes.errors.some((e) => e.code === "invalid-opponent-tracking"));

  const badIntervalPack = structuredClone(pack);
  badIntervalPack.session.opponentTracking = { mode: "periodic_gps", intervalMs: 500 };
  const badIntervalRes = api.validateClaimRulebook(badIntervalPack, snapshot);
  assert.equal(badIntervalRes.ok, false);
  assert.ok(badIntervalRes.errors.some((e) => e.code === "invalid-opponent-tracking"));
});
