import assert from "node:assert/strict";
import http from "node:http";
import { test } from "node:test";
import { gunzipSync } from "node:zlib";
import * as api from "../dist/index.js";

const T0 = 1_800_000_000_000;

async function startServer(clockRef) {
  const server = api.createSoloServer({
    databasePath: ":memory:",
    now: () => clockRef.now,
    midtrans: api.createRecordedMidtransAdapter(),
    allowRulebookSandboxCheckout: true,
    allowHideSeekQa: true,
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  return { server, port, baseUrl: `http://127.0.0.1:${port}` };
}

function rawGet(port, path, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: "127.0.0.1", port, path, method: "GET", headers },
      (res) => {
        const chunks = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => {
          resolve({
            status: res.statusCode,
            headers: res.headers,
            body: Buffer.concat(chunks),
          });
        });
      },
    );
    req.on("error", reject);
    req.end();
  });
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
        rawText: text,
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
      return { status: res.status, headers: res.headers, body: await res.json() };
    },
  };
}

test("GET /api/rulebooks/rooms/:code exposes monotonic stateRev, seat-scoped ETag 304 with X-Server-Now, and ?includeBoard=0 split", async (t) => {
  const clock = { now: T0 };
  const { server, port, baseUrl } = await startServer(clock);
  t.after(() => new Promise((resolve) => server.close(resolve)));

  const host = makeClient(baseUrl);
  const guest = makeClient(baseUrl);

  const seekListing = (await host.get("/api/rulebooks?format=hide-and-seek")).body.listings.find(
    (l) => l.packId === "official-jakarta-compact-seek",
  );
  assert.ok(seekListing);

  const created = await host.post("/api/rulebooks", {
    type: "create-free-room",
    packId: seekListing.packId,
    version: seekListing.version,
    hostName: "Hider Host",
    qa: true,
    requestId: "req-etag-seek-room-0001",
  });
  assert.equal(created.status, 200);
  const code = created.body.roomCode;

  // Initial read (default includeBoard=1) returns stateRev=1, publicBoard, Cache-Control: private, no-cache, ETag, X-Server-Now
  const r1 = await host.get(`/api/rulebooks/rooms/${code}`);
  assert.equal(r1.status, 200);
  assert.equal(r1.body.stateRev, 1);
  assert.ok(r1.body.publicBoard);
  assert.equal(r1.headers.get("cache-control"), "private, no-cache");
  assert.equal(r1.headers.get("x-server-now"), String(T0));
  const hostEtagFull = r1.headers.get("etag");
  assert.ok(hostEtagFull && hostEtagFull.startsWith('"rb-'));

  // Repeated unchanged read stays at stateRev=1 and returns 304 Not Modified with empty body and fresh X-Server-Now
  clock.now = T0 + 2500;
  const r304 = await host.get(`/api/rulebooks/rooms/${code}`, { "If-None-Match": hostEtagFull });
  assert.equal(r304.status, 304);
  assert.equal(r304.rawText, "");
  assert.equal(r304.headers.get("etag"), hostEtagFull);
  assert.equal(r304.headers.get("cache-control"), "private, no-cache");
  assert.equal(r304.headers.get("x-server-now"), String(T0 + 2500));

  // ?includeBoard=0 omits publicBoard, uses a distinct ETag, and cuts payload size by >= 50%
  const rawFull = await rawGet(port, `/api/rulebooks/rooms/${code}`, {
    cookie: host.cookie,
    "accept-encoding": "identity",
  });
  const rawSlim = await rawGet(port, `/api/rulebooks/rooms/${code}?includeBoard=0`, {
    cookie: host.cookie,
    "accept-encoding": "identity",
  });
  assert.equal(rawFull.status, 200);
  assert.equal(rawSlim.status, 200);
  const slimPayload = JSON.parse(rawSlim.body.toString("utf8"));
  assert.equal("publicBoard" in slimPayload, false);
  assert.equal(slimPayload.stateRev, 1);
  assert.notEqual(rawFull.headers.etag, rawSlim.headers.etag, "includeBoard=0 must use distinct ETag from includeBoard=1");
  const reduction = 1 - rawSlim.body.length / rawFull.body.length;
  assert.ok(reduction >= 0.5, `Expected >= 50% payload reduction on Compact Seek, got ${(reduction * 100).toFixed(1)}%`);

  // Sending slim ETag on ?includeBoard=0 returns 304 with 0 bytes
  const rawSlim304 = await rawGet(port, `/api/rulebooks/rooms/${code}?includeBoard=0`, {
    cookie: host.cookie,
    "if-none-match": rawSlim.headers.etag,
  });
  assert.equal(rawSlim304.status, 304);
  assert.equal(rawSlim304.body.length, 0);

  // Guest joins -> stateRev increments -> host's old ETag now returns 200 with a new ETag!
  assert.equal((await guest.post("/api/rulebooks", { type: "join-room", roomCode: code, name: "Seeker Guest" })).status, 200);
  const rAfterJoin = await host.get(`/api/rulebooks/rooms/${code}?includeBoard=0`, { "If-None-Match": rawSlim.headers.etag });
  assert.equal(rAfterJoin.status, 200);
  assert.equal(rAfterJoin.body.stateRev, 2);
  const hostEtagAfterJoin = rAfterJoin.headers.get("etag");
  assert.notEqual(hostEtagAfterJoin, rawSlim.headers.etag);

  // Seat isolation: guest sending host's ETag NEVER gets 304 and receives guest's own seat + distinct ETag
  const guestWithHostEtag = await guest.get(`/api/rulebooks/rooms/${code}?includeBoard=0`, { "If-None-Match": hostEtagAfterJoin });
  assert.equal(guestWithHostEtag.status, 200);
  assert.equal(guestWithHostEtag.body.room.seatId, "seat-2");
  assert.notEqual(guestWithHostEtag.headers.get("etag"), hostEtagAfterJoin);

  // Also verify official Wide Seek achieves >= 50% reduction with ?includeBoard=0
  const wideListing = (await host.get("/api/rulebooks?format=hide-and-seek")).body.listings.find(
    (l) => l.packId === "official-jakarta-wide-seek",
  );
  const wideRoom = await host.post("/api/rulebooks", {
    type: "create-free-room",
    packId: wideListing.packId,
    version: wideListing.version,
    hostName: "Wide Host",
  });
  const wideFull = await rawGet(port, `/api/rulebooks/rooms/${wideRoom.body.roomCode}`, {
    cookie: host.cookie,
    "accept-encoding": "identity",
  });
  const wideSlim = await rawGet(port, `/api/rulebooks/rooms/${wideRoom.body.roomCode}?includeBoard=0`, {
    cookie: host.cookie,
    "accept-encoding": "identity",
  });
  const wideReduction = 1 - wideSlim.body.length / wideFull.body.length;
  assert.ok(wideReduction >= 0.5, `Expected >= 50% payload reduction on Wide Seek, got ${(wideReduction * 100).toFixed(1)}%`);

  // Also verify Claim the City exposes monotonic stateRev and ETag 304 + mutation busting
  const claimListing = (await host.get("/api/rulebooks?format=claim-the-city")).body.listings.find(
    (l) => l.packId === "official-jakarta-compact-claim",
  );
  const claimRoom = await host.post("/api/rulebooks", {
    type: "create-free-room",
    packId: claimListing.packId,
    version: claimListing.version,
    hostName: "Claim Host",
    mode: "solo",
  });
  const claimCode = claimRoom.body.roomCode;
  const c1 = await host.get(`/api/rulebooks/rooms/${claimCode}`);
  assert.equal(c1.status, 200);
  assert.equal(c1.body.stateRev, 1);
  assert.ok(c1.body.publicBoard);
  const c304 = await host.get(`/api/rulebooks/rooms/${claimCode}`, { "If-None-Match": c1.headers.get("etag") });
  assert.equal(c304.status, 304);
  assert.equal(c304.rawText, "");

  // Valid check-in-start mutation bumps Claim stateRev -> stale ETag returns 200
  const startPoint = c1.body.publicBoard.startPoint;
  const checkInRes = await host.post("/api/rulebooks", {
    type: "room-action",
    roomCode: claimCode,
    action: {
      type: "check-in-start",
      actionId: "claim-checkin-etag-1",
      fix: { latitude: startPoint.latitude, longitude: startPoint.longitude, accuracy: 8, timestamp: clock.now },
    },
  });
  assert.equal(checkInRes.status, 200);
  assert.equal(checkInRes.body.error, undefined);
  const c2 = await host.get(`/api/rulebooks/rooms/${claimCode}?includeBoard=0`, { "If-None-Match": c1.headers.get("etag") });
  assert.equal(c2.status, 200);
  assert.equal(c2.body.stateRev, 2);
  assert.equal("publicBoard" in c2.body, false);
});

test("apps/api/src/http.ts gzips JSON responses > 1 KiB when Accept-Encoding includes gzip and skips <= 1 KiB or identity", async (t) => {
  const clock = { now: T0 };
  const { server, port, baseUrl } = await startServer(clock);
  t.after(() => new Promise((resolve) => server.close(resolve)));

  // 1. Small JSON response (<= 1 KiB): /api/health should NOT be gzipped even when Accept-Encoding: gzip
  const smallRes = await rawGet(port, "/api/health", { "accept-encoding": "gzip, deflate" });
  assert.equal(smallRes.status, 200);
  assert.equal(smallRes.headers["content-encoding"], undefined);
  assert.equal(JSON.parse(smallRes.body.toString("utf8")).ok, true);

  // 2. Large JSON response (> 1 KiB): /api/rulebooks/catalog with Accept-Encoding: gzip MUST be gzipped
  const largeGzip = await rawGet(port, "/api/rulebooks/catalog", { "accept-encoding": "br, gzip" });
  assert.equal(largeGzip.status, 200);
  assert.equal(largeGzip.headers["content-encoding"], "gzip");
  assert.match(String(largeGzip.headers.vary ?? ""), /Accept-Encoding/i);
  const decompressed = gunzipSync(largeGzip.body);
  assert.ok(decompressed.length > 1024);
  assert.ok(largeGzip.body.length < decompressed.length, "Gzipped payload should be smaller than uncompressed JSON");
  const catalogJson = JSON.parse(decompressed.toString("utf8"));
  assert.ok(Array.isArray(catalogJson.editions) && catalogJson.editions.length > 0);

  // 3. Large JSON response with Accept-Encoding: identity or gzip;q=0 stays uncompressed
  const largeIdentity = await rawGet(port, "/api/rulebooks/catalog", { "accept-encoding": "identity" });
  assert.equal(largeIdentity.status, 200);
  assert.equal(largeIdentity.headers["content-encoding"], undefined);
  assert.equal(largeIdentity.body.length, decompressed.length);

  const largeGzipRejected = await rawGet(port, "/api/rulebooks/catalog", { "accept-encoding": "gzip;q=0" });
  assert.equal(largeGzipRejected.status, 200);
  assert.equal(largeGzipRejected.headers["content-encoding"], undefined);

  // 4. Room GET response > 1 KiB with Accept-Encoding: gzip returns both ETag and Content-Encoding: gzip
  const host = makeClient(baseUrl);
  const seekListing = (await host.get("/api/rulebooks?format=hide-and-seek")).body.listings[0];
  const created = await host.post("/api/rulebooks", {
    type: "create-free-room",
    packId: seekListing.packId,
    version: seekListing.version,
    hostName: "Gzip Host",
  });
  const gzipRoom = await rawGet(port, `/api/rulebooks/rooms/${created.body.roomCode}`, {
    cookie: host.cookie,
    "accept-encoding": "gzip",
  });
  assert.equal(gzipRoom.status, 200);
  assert.equal(gzipRoom.headers["content-encoding"], "gzip");
  assert.match(String(gzipRoom.headers.vary ?? ""), /Accept-Encoding/i);
  assert.ok(gzipRoom.headers.etag);
  const roomJson = JSON.parse(gunzipSync(gzipRoom.body).toString("utf8"));
  assert.equal(roomJson.room.code, created.body.roomCode);
  assert.equal(roomJson.stateRev, 1);
});
