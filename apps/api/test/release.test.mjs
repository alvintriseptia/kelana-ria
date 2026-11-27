import assert from "node:assert/strict";
import test from "node:test";
import * as api from "../dist/index.js";
import { TEST_ADMIN } from "./auth-client.mjs";

const initialTime = 1_800_000_000_000;

async function listen(context, options = {}) {
  const server = api.createSoloServer({
    databasePath: ":memory:",
    allowRulebookSandboxCheckout: true,
    allowSandboxAuthOtp: true,
    ...options,
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const close = () =>
    new Promise((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  context.after(() => (server.listening ? close() : undefined));
  return { url: `http://127.0.0.1:${server.address().port}`, close };
}

function makeClient(url) {
  let cookie = "";
  let seq = 0;
  return {
    async request(method, path, body, extraHeaders = {}) {
      const headers = { ...extraHeaders };
      if (cookie) headers.cookie = cookie;
      if (body !== undefined) headers["content-type"] = "application/json";
      const response = await fetch(`${url}${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const setCookie = response.headers.get("set-cookie");
      if (setCookie) {
        const pair = setCookie.split(";")[0];
        const [k] = pair.split("=");
        const map = new Map(
          cookie
            .split("; ")
            .filter(Boolean)
            .map((entry) => {
              const idx = entry.indexOf("=");
              return [entry.slice(0, idx), entry.slice(idx + 1)];
            }),
        );
        map.set(k, pair.slice(k.length + 1));
        cookie = [...map.entries()].map(([ck, cv]) => `${ck}=${cv}`).join("; ");
      }
      const data = await response.json().catch(() => ({}));
      return { status: response.status, data };
    },
    async signIn(email, displayName = "Pemain Uji") {
      const req = await this.request("POST", "/api/auth/request-otp", { email });
      assert.equal(req.status, 200);
      const ver = await this.request("POST", "/api/auth/verify-otp", {
        challengeId: req.data.challengeId,
        code: req.data.sandboxCode,
        displayName,
      });
      assert.equal(ver.status, 200);
      return ver.data;
    },
    actionId: () => `rel-${++seq}`,
  };
}

function fixAt(point, at) {
  return { latitude: point.latitude, longitude: point.longitude, accuracy: 5, timestamp: at };
}

test("official Compact and Jakarta-wide Rulebook packs validate cleanly and retired legacy endpoints return 404 (A01, A22, §2)", async (context) => {
  const officialClaims = api.loadOfficialClaimPacks();
  const officialSeeks = api.loadOfficialSeekPacks();

  const compactClaim = officialClaims.find((p) => p.pack.meta.packId === "official-jakarta-compact-claim");
  const wideClaim = officialClaims.find((p) => p.pack.meta.packId === "official-jakarta-wide-claim");
  const compactSeek = officialSeeks.find((p) => p.pack.meta.packId === "official-jakarta-compact-seek");
  const wideSeek = officialSeeks.find((p) => p.pack.meta.packId === "official-jakarta-wide-seek");

  assert.ok(compactClaim && wideClaim, "Official Compact and Wide Claim packs must exist");
  assert.ok(compactSeek && wideSeek, "Official Compact and Wide Hide & Seek packs must exist");

  const compactIds = new Set(compactClaim.pack.geography.landmarks.map((l) => l.id));
  const wideOutsideCompact = wideClaim.pack.geography.landmarks.filter((l) => !compactIds.has(l.id));
  assert.ok(wideOutsideCompact.length >= 2, "Wide Claim pack must activate >=2 landmarks outside Compact");
  assert.ok(
    wideClaim.pack.session.durationMs > compactClaim.pack.session.durationMs,
    "Wide Claim duration must exceed Compact duration",
  );
  assert.ok(
    wideSeek.snapshot.stations.length > compactSeek.snapshot.stations.length,
    "Wide Hide & Seek must have more stations than Compact Hide & Seek",
  );

  // Retired legacy prototype endpoints must return 404 not-found.
  const { url } = await listen(context, { now: () => initialTime });
  const probe = makeClient(url);
  for (const retiredPath of ["/api/solo", "/api/duo", "/api/seek", "/api/packs"]) {
    const res = await probe.request("GET", retiredPath);
    assert.equal(res.status, 404, `Retired endpoint ${retiredPath} must return 404`);
  }
});

test("all six section 2 release configurations run through /api/rulebooks to active/terminal state and persist on refresh (A01, A20)", async (context) => {
  let now = initialTime;
  const { url } = await listen(context, { now: () => now });

  // 1 & 4: Solo Claim on Compact AND Jakarta-wide
  for (const packId of ["official-jakarta-compact-claim", "official-jakarta-wide-claim"]) {
    const player = makeClient(url);
    const created = await player.request("POST", "/api/rulebooks", {
      type: "create-free-room",
      packId,
      version: 1,
      mode: "solo",
      hostName: "SoloHost",
    });
    assert.equal(created.status, 200, `Expected 200 creating ${packId} solo room`);
    const code = created.data.roomCode;
    const lobby = await player.request("GET", `/api/rulebooks/rooms/${code}`);
    assert.equal(lobby.status, 200);
    const sp = lobby.data.publicBoard.startPoint;

    await player.request("POST", "/api/rulebooks", {
      type: "room-action",
      roomCode: code,
      action: { type: "check-in-start", actionId: player.actionId(), fix: fixAt(sp, now) },
    });
    await player.request("POST", "/api/rulebooks", {
      type: "room-action",
      roomCode: code,
      action: { type: "ready", actionId: player.actionId(), ready: true },
    });
    const started = await player.request("POST", "/api/rulebooks", {
      type: "room-action",
      roomCode: code,
      action: { type: "start", actionId: player.actionId() },
    });
    assert.equal(started.status, 200);
    assert.equal(started.data.room.phase, "active");

    // Advance past round deadline -> transitions cleanly to terminal finished state & persists on GET
    now += 4 * 60 * 60_000;
    const finished = await player.request("GET", `/api/rulebooks/rooms/${code}`);
    assert.equal(finished.status, 200);
    assert.equal(finished.data.room.phase, "finished");
    assert.ok(finished.data.room.outcome, `Terminal outcome must persist for ${packId} solo`);
  }

  // 2 & 5: Group Claim (2 players) on Compact AND Jakarta-wide
  for (const packId of ["official-jakarta-compact-claim", "official-jakarta-wide-claim"]) {
    const host = makeClient(url);
    const guest = makeClient(url);
    const created = await host.request("POST", "/api/rulebooks", {
      type: "create-free-room",
      packId,
      version: 1,
      mode: "group",
      hostName: "GroupHost",
    });
    assert.equal(created.status, 200);
    const code = created.data.roomCode;
    const joined = await guest.request("POST", "/api/rulebooks", {
      type: "join-room",
      roomCode: code,
      name: "GroupGuest",
    });
    assert.equal(joined.status, 200);

    const lobby = await host.request("GET", `/api/rulebooks/rooms/${code}`);
    const sp = lobby.data.publicBoard.startPoint;
    for (const client of [host, guest]) {
      await client.request("POST", "/api/rulebooks", {
        type: "room-action",
        roomCode: code,
        action: { type: "check-in-start", actionId: client.actionId(), fix: fixAt(sp, now) },
      });
      await client.request("POST", "/api/rulebooks", {
        type: "room-action",
        roomCode: code,
        action: { type: "ready", actionId: client.actionId(), ready: true },
      });
    }
    const started = await host.request("POST", "/api/rulebooks", {
      type: "room-action",
      roomCode: code,
      action: { type: "start", actionId: host.actionId() },
    });
    assert.equal(started.status, 200);
    assert.equal(started.data.room.phase, "active");

    const refreshedGuest = await guest.request("GET", `/api/rulebooks/rooms/${code}`);
    assert.equal(refreshedGuest.status, 200);
    assert.equal(refreshedGuest.data.room.phase, "active");
    assert.equal(refreshedGuest.data.room.seats.length, 2);
  }

  // 3 & 6: Hide & Seek (2 players) on Compact AND Jakarta-wide
  for (const loaded of api.loadOfficialSeekPacks()) {
    const packId = loaded.pack.meta.packId;
    const version = loaded.pack.meta.version;
    const hider = makeClient(url);
    const seeker = makeClient(url);
    const created = await hider.request("POST", "/api/rulebooks", {
      type: "create-free-room",
      packId,
      version,
      hostName: "SeekHost",
    });
    assert.equal(created.status, 200, `Expected 200 creating ${packId}@v${version}: ${JSON.stringify(created.data)}`);
    const code = created.data.roomCode;
    const joined = await seeker.request("POST", "/api/rulebooks", {
      type: "join-room",
      roomCode: code,
      name: "SeekGuest",
    });
    assert.equal(joined.status, 200);

    const lobby = await hider.request("GET", `/api/rulebooks/rooms/${code}`);
    const sp = lobby.data.room.turnStartPoint;
    for (const client of [hider, seeker]) {
      await client.request("POST", "/api/rulebooks", {
        type: "room-action",
        roomCode: code,
        action: { type: "check-in-start", actionId: client.actionId(), fix: fixAt(sp, now) },
      });
      await client.request("POST", "/api/rulebooks", {
        type: "room-action",
        roomCode: code,
        action: { type: "ready", actionId: client.actionId(), ready: true },
      });
    }
    const started = await hider.request("POST", "/api/rulebooks", {
      type: "room-action",
      roomCode: code,
      action: { type: "start", actionId: hider.actionId() },
    });
    assert.equal(started.status, 200);
    assert.equal(started.data.room.phase, "head_start");

    const anchor = lobby.data.publicBoard.stations[0];
    const locked = await hider.request("POST", "/api/rulebooks", {
      type: "room-action",
      roomCode: code,
      action: { type: "lock-anchor", actionId: hider.actionId(), stationId: anchor.id, fix: fixAt(anchor, now) },
    });
    assert.equal(locked.status, 200);
    assert.equal(locked.data.room.ownAnchorStationId, anchor.id);

    // Seeker view must never leak Hider's private anchor station.
    const seekerView = await seeker.request("GET", `/api/rulebooks/rooms/${code}`);
    assert.equal(seekerView.status, 200);
    assert.equal(seekerView.data.room.ownAnchorStationId, undefined);
  }
});

test("Midtrans webhook signature, amount/currency mismatch, TTL expiry, and idempotent settlement on /api/rulebooks (A30, §8.1)", async (context) => {
  let now = initialTime;
  const midtrans = api.createRecordedMidtransAdapter();
  const { url } = await listen(context, { now: () => now, midtrans, adminEmails: [TEST_ADMIN.email] });

  // Creator submits a priced Claim pack (Rp 25.000) and an admin publishes it
  const creator = makeClient(url);
  await creator.signIn("creator-checkout@kelana.test", "Kreator Checkout");
  const cloned = await creator.request("POST", "/api/rulebooks", {
    type: "clone-official",
    templatePackId: "official-jakarta-compact-claim",
    packId: "pack-checkout-security",
    title: "Paket Uji Pembayaran",
    byline: "Kreator Checkout",
    priceIdr: 25_000,
  });
  assert.equal(cloned.status, 200);
  const submitted = await creator.request("POST", "/api/rulebooks", {
    type: "submit-draft",
    packId: "pack-checkout-security",
    version: 1,
  });
  assert.equal(submitted.status, 200);
  const admin = makeClient(url);
  await admin.signIn(TEST_ADMIN.email);
  const published = await admin.request(
    "POST",
    "/api/rulebooks",
    { type: "publish-version", packId: "pack-checkout-security", version: 1 },
  );
  assert.equal(published.status, 200);

  // Buyer signs in and creates pending order #1
  const buyer = makeClient(url);
  await buyer.signIn("buyer-checkout@kelana.test", "Pembeli Uji");
  const created1 = await buyer.request("POST", "/api/rulebooks", {
    type: "create-order",
    packId: "pack-checkout-security",
    version: 1,
    mode: "group",
  });
  assert.equal(created1.status, 200);
  const order1 = created1.data.order;
  assert.equal(order1.status, "pending");
  assert.equal(order1.grossAmountIdr, 25_000);
  assert.equal(order1.passId, null);

  // 1. Pending order grants zero entitlements or creator earnings
  const beforeCatalog = await buyer.request("GET", "/api/rulebooks/catalog");
  assert.equal(beforeCatalog.data.ownedPackIds.includes("pack-checkout-security"), false);
  const creatorBefore = await creator.request("GET", "/api/rulebooks?role=writer");
  assert.equal(creatorBefore.data.earnings.length, 0);

  // 2. Forged SHA-512 signature rejected
  const badSig = await fetch(`${url}/api/rulebooks/midtrans-notification`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      order_id: order1.orderId,
      status_code: "200",
      gross_amount: "25000.00",
      currency: "IDR",
      transaction_status: "settlement",
      signature_key: "0".repeat(128),
    }),
  });
  assert.equal(badSig.status, 400);
  assert.equal((await badSig.json()).error, "invalid-signature");

  // 3. Amount mismatch rejected even with valid signature for mismatched amount
  midtrans.setOrderState(order1.orderId, {
    transactionStatus: "settlement",
    statusCode: "200",
    grossAmountIdr: 1_000,
    currency: "IDR",
  });
  const wrongAmount = await fetch(`${url}/api/rulebooks/midtrans-notification`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(
      midtrans.signNotification({
        orderId: order1.orderId,
        transactionStatus: "settlement",
        grossAmount: "1000.00",
      }),
    ),
  });
  assert.equal(wrongAmount.status, 400);
  assert.equal((await wrongAmount.json()).error, "amount-or-currency-mismatch");

  // 4. Currency mismatch rejected
  midtrans.setOrderState(order1.orderId, {
    transactionStatus: "settlement",
    statusCode: "200",
    grossAmountIdr: 25_000,
    currency: "USD",
  });
  const wrongCurrency = await fetch(`${url}/api/rulebooks/midtrans-notification`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(
      midtrans.signNotification({
        orderId: order1.orderId,
        transactionStatus: "settlement",
        grossAmount: "25000.00",
        currency: "USD",
      }),
    ),
  });
  assert.equal(wrongCurrency.status, 400);
  assert.equal((await wrongCurrency.json()).error, "amount-or-currency-mismatch");

  // 5. Valid signed settlement webhook unlocks entitlement + 1 creator earning, duplicate replay is idempotent
  midtrans.setOrderState(order1.orderId, {
    transactionStatus: "settlement",
    statusCode: "200",
    grossAmountIdr: 25_000,
    currency: "IDR",
  });
  const validPayload = midtrans.signNotification({
    orderId: order1.orderId,
    transactionStatus: "settlement",
    grossAmount: "25000.00",
    currency: "IDR",
  });
  const settled = await fetch(`${url}/api/rulebooks/midtrans-notification`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(validPayload),
  });
  assert.equal(settled.status, 200);
  const settledBody = await settled.json();
  assert.equal(settledBody.ok, true);
  assert.equal(settledBody.duplicate, false);

  const dup = await fetch(`${url}/api/rulebooks/midtrans-notification`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(validPayload),
  });
  assert.equal(dup.status, 200);
  assert.equal((await dup.json()).duplicate, true);

  const afterCatalog = await buyer.request("GET", "/api/rulebooks/catalog");
  assert.equal(afterCatalog.data.ownedPackIds.includes("pack-checkout-security"), true);
  const creatorAfter = await creator.request("GET", "/api/rulebooks?role=writer");
  assert.equal(creatorAfter.data.earnings.length, 1, "Duplicate settlement webhook must never duplicate creator earnings");
  assert.equal(creatorAfter.data.earnings[0].grossAmountIdr, 25_000);

  // 6. Expired order by 15-minute clock TTL grants no access
  const buyer2 = makeClient(url);
  await buyer2.signIn("buyer2-checkout@kelana.test", "Pembeli Expired");
  const created2 = await buyer2.request("POST", "/api/rulebooks", {
    type: "create-order",
    packId: "pack-checkout-security",
    version: 1,
    mode: "group",
  });
  assert.equal(created2.status, 200);
  const order2 = created2.data.order;

  now += 15 * 60_000 + 1;
  midtrans.setOrderState(order2.orderId, {
    transactionStatus: "settlement",
    statusCode: "200",
    grossAmountIdr: 25_000,
    currency: "IDR",
  });
  const lateWebhook = await fetch(`${url}/api/rulebooks/midtrans-notification`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(
      midtrans.signNotification({
        orderId: order2.orderId,
        transactionStatus: "settlement",
        grossAmount: "25000.00",
      }),
    ),
  });
  assert.equal(lateWebhook.status, 400);
  assert.equal((await lateWebhook.json()).error, "order-expired");
  const buyer2Catalog = await buyer2.request("GET", "/api/rulebooks/catalog");
  assert.equal(buyer2Catalog.data.ownedPackIds.includes("pack-checkout-security"), false);
});
