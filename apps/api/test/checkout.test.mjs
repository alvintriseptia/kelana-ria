import assert from "node:assert/strict";
import test from "node:test";
import * as api from "../dist/index.js";

const initialTime = 1_800_000_000_000;

async function listen(context, options = {}) {
  let current = options.startTime ?? initialTime;
  const server = api.createSoloServer({
    databasePath: ":memory:",
    now: () => current,
    ...options,
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const close = () =>
    new Promise((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  context.after(() => (server.listening ? close() : undefined));
  return {
    url: `http://127.0.0.1:${server.address().port}`,
    now: () => current,
    advance(ms) {
      current += ms;
    },
    close,
  };
}

function packClient(url, role = "public") {
  let cookie;
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
    return { ...data, status: response.status, setCookie };
  }
  return {
    get: () => request(`/api/packs?role=${role}`),
    lifecycle: (orderId) =>
      request(`/api/packs/lifecycle?orderId=${encodeURIComponent(orderId)}`),
    post: (type, fields = {}, queryRole = role) =>
      request(`/api/packs?role=${queryRole}`, {
        type,
        actionId: `checkout-pack-${role}-${++nextAction}`,
        ...fields,
      }),
  };
}

function duoClient(url) {
  let cookie;
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
    return { ...data, status: response.status };
  }
  return {
    bootstrap: () => request("/api/duo"),
    create: () =>
      request("/api/duo", {
        type: "create",
        actionId: `duo-action-${++nextAction}`,
      }),
    join: (code, passId) =>
      request("/api/duo", {
        type: "join",
        actionId: `duo-action-${++nextAction}`,
        code,
        ...(passId ? { passId } : {}),
      }),
    getRoom: (code) => request(`/api/duo/${code}`),
    act: (code, action) =>
      request(`/api/duo/${code}`, {
        actionId: `duo-action-${++nextAction}`,
        ...action,
      }),
  };
}

async function publishDefaultPack(url) {
  const writer = packClient(url, "writer");
  const reviewer = packClient(url, "reviewer");
  await writer.get();
  await reviewer.get();
  assert.equal(
    (await writer.post("save-draft", { draft: api.defaultCreatorDraft })).status,
    200,
  );
  assert.equal(
    (await writer.post("submit-draft", { packId: "pack-selatan-compact", version: 1 })).status,
    200,
  );
  assert.equal(
    (await reviewer.post("publish-version", { packId: "pack-selatan-compact", version: 1 })).status,
    200,
  );
  return { writer, reviewer };
}

async function postWebhook(url, payload) {
  const response = await fetch(`${url}/api/packs/midtrans-notification`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  return { status: response.status, body: await response.json() };
}

test("pending checkout return and expired orders grant no pass, room, or earnings (A30, §8.1)", async (context) => {
  const midtrans = api.createRecordedMidtransAdapter();
  const { url, advance } = await listen(context, { midtrans });
  const { writer } = await publishDefaultPack(url);
  const buyer = packClient(url, "public");
  await buyer.get();

  // 1. Create pending order #1 and return from checkout before settlement.
  const created = await buyer.post("create-order", {
    packId: "pack-selatan-compact",
    version: 1,
    players: 2,
  });
  assert.equal(created.status, 200);
  const order1 = created.orders[0];
  assert.equal(order1.orderId, "ord-sandbox-1");
  assert.equal(order1.status, "pending");
  assert.equal(order1.currency, "IDR");
  assert.equal(order1.passId, null);
  assert.equal(order1.roomCode, null);
  assert.equal(order1.earningsEntryId, null);
  assert.match(order1.snapRedirectUrl, /^https:\/\/app\.sandbox\.midtrans\.com\//);

  const returned = await buyer.post("checkout-return", { orderId: "ord-sandbox-1" });
  assert.equal(returned.status, 200);
  assert.equal(returned.orders[0].status, "pending");
  assert.notEqual(returned.orders[0].checkoutReturnedAt, null);
  assert.equal(returned.orders[0].passId, null);
  assert.equal(returned.orders[0].roomCode, null);
  assert.equal(returned.orders[0].earningsEntryId, null);

  // Verifying while still pending gives no access.
  const stillPending = await buyer.post("verify-settlement", {
    orderId: "ord-sandbox-1",
  });
  assert.equal(stillPending.status, 409);
  assert.equal(stillPending.error, "order-not-settled");
  assert.equal(stillPending.orders[0].status, "pending");
  assert.equal(stillPending.orders[0].roomCode, null);
  assert.deepEqual((await writer.get()).earnings, []);

  // 2. Midtrans reports expire -> order marked expired, zero pass/room/earnings.
  midtrans.setOrderState("ord-sandbox-1", {
    transactionStatus: "expire",
    statusCode: "407",
  });
  const expiredWebhook = await postWebhook(
    url,
    midtrans.signNotification({
      orderId: "ord-sandbox-1",
      transactionStatus: "expire",
    }),
  );
  assert.equal(expiredWebhook.status, 409);
  assert.equal(expiredWebhook.body.error, "order-expired");
  assert.equal(expiredWebhook.body.order.status, "expired");
  assert.equal(expiredWebhook.body.order.passId, null);
  assert.equal(expiredWebhook.body.order.roomCode, null);
  assert.deepEqual((await writer.get()).earnings, []);

  // 3. Order #2 expires by clock TTL -> no access even if settlement is attempted afterwards.
  const created2 = await buyer.post("create-order", {
    packId: "pack-selatan-compact",
    version: 1,
    players: 2,
  });
  assert.equal(created2.status, 200);
  const order2 = created2.orders.find((o) => o.orderId === "ord-sandbox-2");
  assert.equal(order2.status, "pending");

  advance(15 * 60_000 + 1);
  midtrans.setOrderState("ord-sandbox-2", {
    transactionStatus: "settlement",
    statusCode: "200",
  });
  const lateVerify = await buyer.post("verify-settlement", {
    orderId: "ord-sandbox-2",
  });
  assert.equal(lateVerify.status, 409);
  assert.equal(lateVerify.error, "order-expired");
  const expiredOrder2 = lateVerify.orders.find((o) => o.orderId === "ord-sandbox-2");
  assert.equal(expiredOrder2.status, "expired");
  assert.equal(expiredOrder2.passId, null);
  assert.equal(expiredOrder2.roomCode, null);
  assert.deepEqual((await writer.get()).earnings, []);
});

test("invalid signature, amount/currency mismatch, and provider outage never grant access (§8.1, A30)", async (context) => {
  const midtrans = api.createRecordedMidtransAdapter();
  const { url } = await listen(context, { midtrans });
  const { writer } = await publishDefaultPack(url);
  const buyer = packClient(url, "public");
  await buyer.get();

  const created = await buyer.post("create-order", {
    packId: "pack-selatan-compact",
    version: 1,
    players: 2,
  });
  assert.equal(created.status, 200);

  // 1. Forged signature rejected.
  const badSig = await postWebhook(url, {
    order_id: "ord-sandbox-1",
    status_code: "200",
    gross_amount: "25000.00",
    currency: "IDR",
    transaction_status: "settlement",
    signature_key: "0".repeat(128),
  });
  assert.equal(badSig.status, 403);
  assert.equal(badSig.body.error, "invalid-signature");

  // 2. Amount mismatch rejected (even with valid signature for the wrong amount).
  const wrongAmount = await postWebhook(
    url,
    midtrans.signNotification({
      orderId: "ord-sandbox-1",
      transactionStatus: "settlement",
      grossAmount: "1000.00",
    }),
  );
  assert.equal(wrongAmount.status, 409);
  assert.equal(wrongAmount.body.error, "payment-mismatch");

  // 3. Currency mismatch rejected.
  const wrongCurrency = await postWebhook(
    url,
    midtrans.signNotification({
      orderId: "ord-sandbox-1",
      transactionStatus: "settlement",
      currency: "USD",
    }),
  );
  assert.equal(wrongCurrency.status, 409);
  assert.equal(wrongCurrency.body.error, "payment-mismatch");

  // 4. Provider outage retains pending order state without granting access; recovers once provider is back.
  midtrans.setOrderState("ord-sandbox-1", {
    transactionStatus: "settlement",
    statusCode: "200",
  });
  midtrans.setOutage(true);
  const outageReply = await buyer.post("verify-settlement", {
    orderId: "ord-sandbox-1",
  });
  assert.equal(outageReply.status, 503);
  assert.equal(outageReply.error, "payment-provider-unavailable");
  assert.equal(outageReply.orders[0].status, "pending");
  assert.equal(outageReply.orders[0].roomCode, null);
  assert.deepEqual((await writer.get()).earnings, []);

  midtrans.setOutage(false);
  const recovered = await buyer.post("verify-settlement", {
    orderId: "ord-sandbox-1",
  });
  assert.equal(recovered.status, 200);
  assert.equal(recovered.orders[0].status, "settled");
  assert.equal((await writer.get()).earnings.length, 1);
});

test("duplicate verified settlement creates one pass, one room, one earnings entry, unlocks host+guest without starting clock, and blocks cross-room pass reuse (A29, A30, A31)", async (context) => {
  const midtrans = api.createRecordedMidtransAdapter();
  const { url, now } = await listen(context, { midtrans });
  const { writer, reviewer } = await publishDefaultPack(url);
  const buyer = packClient(url, "public");
  await buyer.get();

  // 1. Create pending order and return from checkout before settlement.
  const created = await buyer.post("create-order", {
    packId: "pack-selatan-compact",
    version: 1,
    players: 2,
  });
  assert.equal(created.status, 200);
  await buyer.post("checkout-return", { orderId: "ord-sandbox-1" });

  // 2. Verified Midtrans settlement notification arrives TWICE (duplicate delivery).
  midtrans.setOrderState("ord-sandbox-1", {
    transactionStatus: "settlement",
    statusCode: "200",
    paymentType: "qris",
  });
  const notification = midtrans.signNotification({
    orderId: "ord-sandbox-1",
    transactionStatus: "settlement",
    paymentType: "qris",
  });

  const firstHook = await postWebhook(url, notification);
  assert.equal(firstHook.status, 200);
  assert.equal(firstHook.body.ok, true);
  assert.equal(firstHook.body.duplicate, false);
  const { passId, roomCode, earningsEntryId } = firstHook.body;
  assert.equal(passId, "pass-ord-sandbox-1");
  assert.match(roomCode, /^[0-9A-F]{8}$/);
  assert.equal(earningsEntryId, "earn-ord-sandbox-1");

  const secondHook = await postWebhook(url, notification);
  assert.equal(secondHook.status, 200);
  assert.equal(secondHook.body.ok, true);
  assert.equal(secondHook.body.duplicate, true);
  assert.equal(secondHook.body.passId, passId);
  assert.equal(secondHook.body.roomCode, roomCode);
  assert.equal(secondHook.body.earningsEntryId, earningsEntryId);

  // Confirm exactly ONE creator earnings entry exists.
  const writerState = await writer.get();
  assert.equal(writerState.earnings.length, 1);
  assert.equal(writerState.earnings[0].earningsEntryId, earningsEntryId);
  assert.equal(writerState.earnings[0].grossAmountIdr, 25_000);
  assert.equal(writerState.earnings[0].platformFeeIdr, 3_750);
  assert.equal(writerState.earnings[0].creatorShareIdr, 21_250);
  assert.equal(writerState.earnings[0].sandbox, true);

  // Confirm redacted lifecycle contains all stages and zero server keys or PII.
  const lifecycle = await reviewer.lifecycle("ord-sandbox-1");
  assert.equal(lifecycle.status, 200);
  assert.deepEqual(
    lifecycle.events.map((e) => e.stage),
    ["create-snap", "checkout-return", "notification", "status-lookup", "notification"],
  );
  const lifecycleJson = JSON.stringify(lifecycle.events);
  assert.doesNotMatch(lifecycleJson, /SB-Mid-server|Authorization|email|phone/i);

  // 3. Paid room cannot be claimed without passId before host unlocks it.
  const intruder = duoClient(url);
  await intruder.bootstrap();
  const prematureJoin = await intruder.join(roomCode);
  assert.equal(prematureJoin.status, 403);
  assert.equal(prematureJoin.error, "pass-required");

  // 4. Host enters paid room with passId, refreshes (without passId), and invites guest on same pass (A29).
  const host = duoClient(url);
  await host.bootstrap();
  const hostEntered = await host.join(roomCode, passId);
  assert.equal(hostEntered.status, 200);
  assert.equal(hostEntered.room.seat, "host");
  assert.equal(hostEntered.room.phase, "lobby");
  assert.equal(hostEntered.room.startedAt, null);
  assert.equal(hostEntered.room.deadline, null);
  assert.equal(hostEntered.room.paidPack.title, api.defaultCreatorDraft.title);
  assert.equal(hostEntered.room.paidPack.byline, api.defaultCreatorDraft.byline);
  assert.equal(hostEntered.room.paidPack.orderId, "ord-sandbox-1");
  assert.equal(hostEntered.room.paidPack.sandbox, true);

  // Host refreshes (GET without passId) and recovers seat 1.
  const hostRefreshed = await host.getRoom(roomCode);
  assert.equal(hostRefreshed.status, 200);
  assert.equal(hostRefreshed.room.seat, "host");
  assert.equal(hostRefreshed.room.phase, "lobby");

  // Invited friend joins the same paid room on the same pass without paying again.
  const guest = duoClient(url);
  await guest.bootstrap();
  const guestJoined = await guest.join(roomCode);
  assert.equal(guestJoined.status, 200);
  assert.equal(guestJoined.room.seat, "guest");
  assert.equal(guestJoined.room.code, roomCode);
  assert.equal(guestJoined.room.phase, "lobby");
  assert.equal(guestJoined.room.startedAt, null, "Clock stays stopped until check-in and readiness");
  assert.equal(guestJoined.room.deadline, null);

  // A third device cannot enter the paid 2-player room.
  const thirdDevice = await intruder.join(roomCode);
  assert.equal(thirdDevice.status, 409);
  assert.equal(thirdDevice.error, "room-full");

  // 5. Cross-room reuse of passId fails (A30).
  const otherRoom = await intruder.create();
  assert.equal(otherRoom.status, 200);
  const crossRoomDuo = await host.join(otherRoom.room.code, passId);
  assert.equal(crossRoomDuo.status, 409);
  assert.equal(crossRoomDuo.error, "pass-already-bound");

  const crossRoomPack = await buyer.post("redeem-pass", {
    passId,
    roomCode: otherRoom.room.code,
  });
  assert.equal(crossRoomPack.status, 409);
  assert.equal(crossRoomPack.error, "pass-already-bound");

  // Same room redeem succeeds.
  const sameRoomPack = await buyer.post("redeem-pass", { passId, roomCode });
  assert.equal(sameRoomPack.status, 200);

  // 6. Clock starts ONLY after both players check in at start, ready up, and host presses Start.
  const startPoint = hostEntered.room.edition.start;
  const startFix = {
    latitude: startPoint.latitude,
    longitude: startPoint.longitude,
    accuracy: 5,
    timestamp: now(),
  };
  assert.equal((await host.act(roomCode, { type: "start" })).room.startedAt, null);
  await host.act(roomCode, { type: "check-in", checkpointId: startPoint.id, fix: startFix });
  await host.act(roomCode, { type: "ready", ready: true });
  await guest.act(roomCode, { type: "check-in", checkpointId: startPoint.id, fix: startFix });
  await guest.act(roomCode, { type: "ready", ready: true });
  const started = await host.act(roomCode, { type: "start" });
  assert.equal(started.status, 200);
  assert.equal(started.room.phase, "active");
  assert.equal(started.room.startedAt, now());
  assert.equal(started.room.deadline, now() + 60 * 60_000);

  // Verify the paid room serves the creator pack's reviewed challenge prompt!
  const cp = started.room.edition.checkpoints[0];
  const checkedIn = await host.act(roomCode, {
    type: "check-in",
    checkpointId: cp.id,
    fix: { latitude: cp.latitude, longitude: cp.longitude, accuracy: 5, timestamp: now() },
  });
  assert.equal(checkedIn.challenge.prompt, api.defaultCreatorTasks[0].question);
});

test("solo paid pass unlocks a single-seat room and blocks a second player (A29)", async (context) => {
  const midtrans = api.createRecordedMidtransAdapter();
  const { url, now } = await listen(context, { midtrans });
  await publishDefaultPack(url);
  const buyer = packClient(url, "public");
  await buyer.get();

  await buyer.post("create-order", {
    packId: "pack-selatan-compact",
    version: 1,
    players: 1,
  });
  const settled = await buyer.post("verify-settlement", {
    orderId: "ord-sandbox-1",
    transactionStatus: "settlement",
  });
  assert.equal(settled.status, 200);
  const { roomCode, passId } = settled.orders[0];

  const host = duoClient(url);
  await host.bootstrap();
  const hostRoom = await host.join(roomCode, passId);
  assert.equal(hostRoom.status, 200);
  assert.equal(hostRoom.room.paidPack.players, 1);

  const secondPlayer = duoClient(url);
  await secondPlayer.bootstrap();
  const blocked = await secondPlayer.join(roomCode);
  assert.equal(blocked.status, 409);
  assert.equal(blocked.error, "room-full");

  // Solo host can check in, ready up, and start without a guest.
  const start = hostRoom.room.edition.start;
  await host.act(roomCode, {
    type: "check-in",
    checkpointId: start.id,
    fix: { latitude: start.latitude, longitude: start.longitude, accuracy: 5, timestamp: now() },
  });
  await host.act(roomCode, { type: "ready", ready: true });
  const started = await host.act(roomCode, { type: "start" });
  assert.equal(started.status, 200);
  assert.equal(started.room.phase, "active");
  assert.equal(started.room.startedAt, now());
});

test("live Midtrans sandbox HTTP adapter verifies Snap create, SHA-512 webhook, status lookup, and redaction (§8.1)", async (context) => {
  const fakeServerKey = "SB-Mid-server-TEST-SECRET-KEY-DO-NOT-LEAK";
  const requests = [];
  const mockFetch = async (targetUrl, init = {}) => {
    requests.push({ url: String(targetUrl), method: init.method ?? "GET", headers: init.headers });
    if (String(targetUrl).endsWith("/snap/v1/transactions")) {
      return new Response(
        JSON.stringify({
          token: "snap-token-123",
          redirect_url: "https://app.sandbox.midtrans.com/snap/v4/redirection/snap-token-123",
        }),
        { status: 201, headers: { "content-type": "application/json" } },
      );
    }
    if (String(targetUrl).endsWith("/v2/ord-sandbox-1/status")) {
      return new Response(
        JSON.stringify({
          order_id: "ord-sandbox-1",
          status_code: "200",
          transaction_status: "settlement",
          gross_amount: "25000.00",
          currency: "IDR",
          payment_type: "qris",
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }
    return new Response("not found", { status: 404 });
  };

  const midtrans = api.createMidtransSandboxAdapter({
    serverKey: fakeServerKey,
    fetchImpl: mockFetch,
  });
  const { url } = await listen(context, { midtrans });
  const { reviewer } = await publishDefaultPack(url);
  const buyer = packClient(url, "public");
  await buyer.get();

  const created = await buyer.post("create-order", {
    packId: "pack-selatan-compact",
    version: 1,
    players: 2,
  });
  assert.equal(created.status, 200);
  assert.equal(created.orders[0].paymentMode, "midtrans-sandbox");
  assert.equal(
    created.orders[0].snapRedirectUrl,
    "https://app.sandbox.midtrans.com/snap/v4/redirection/snap-token-123",
  );

  // Send signed Midtrans webhook.
  const sig = api.signMidtransNotification({
    orderId: "ord-sandbox-1",
    statusCode: "200",
    grossAmount: "25000.00",
    serverKey: fakeServerKey,
  });
  const hook = await postWebhook(url, {
    order_id: "ord-sandbox-1",
    status_code: "200",
    gross_amount: "25000.00",
    currency: "IDR",
    transaction_status: "settlement",
    payment_type: "qris",
    signature_key: sig,
  });
  assert.equal(hook.status, 200);
  assert.equal(hook.body.order.status, "settled");
  assert.equal(hook.body.order.paymentMode, "midtrans-sandbox");
  assert.equal(requests.length, 2);
  assert.equal(requests[0].method, "POST");
  assert.equal(requests[1].method, "GET");

  const lifecycle = await reviewer.lifecycle("ord-sandbox-1");
  assert.equal(lifecycle.status, 200);
  assert.doesNotMatch(JSON.stringify(lifecycle), new RegExp(fakeServerKey));
});
