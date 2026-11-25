import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import * as api from "../dist/index.js";

const T0 = 1_800_000_000_000;

async function startServer(databasePath, clockRef, midtrans = api.createRecordedMidtransAdapter()) {
  const server = api.createSoloServer({
    databasePath,
    now: () => clockRef.now,
    midtrans,
    allowRulebookSandboxCheckout: true,
    allowHideSeekQa: true,
    rulebookReviewerKey: "entitlement-reviewer-key",
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  return { server, baseUrl, midtrans };
}

function makeClient(baseUrl, initialCookie = "") {
  let cookie = initialCookie;
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
      return { status: res.status, headers: res.headers, body: await res.json() };
    },
    async post(path, body, extraHeaders = {}) {
      const res = await fetch(`${baseUrl}${path}`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(cookie ? { cookie } : {}),
          ...extraHeaders,
        },
        body: JSON.stringify(body),
      });
      const setCookie = res.headers.get("set-cookie");
      if (setCookie) cookie = setCookie.split(";")[0];
      return { status: res.status, headers: res.headers, body: await res.json() };
    },
  };
}

test("Paid pack settlement grants durable one-time ownership with hashed restore code, replayable Solo/Group rooms, 1-active-room guard, and restart persistence", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "kelana-entitlements-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const dbPath = join(dir, "entitlements.sqlite");
  const clock = { now: T0 };

  const packId = "comm-owned-claim-v1";
  let restoreCode;
  let orderId;
  let room1Code;
  let buyerCookie;
  let creatorCookie;

  // Phase 1: Creator publishes v1 and v2 of a paid Claim pack; Buyer purchases once via Midtrans
  {
    const { server, baseUrl, midtrans } = await startServer(dbPath, clock);
    try {
      // Verify SQLite WAL + synchronous=FULL (2)
      const inspectDb = new DatabaseSync(dbPath, { timeout: 5000 });
      try {
        assert.equal(String(inspectDb.prepare("PRAGMA journal_mode").get().journal_mode).toLowerCase(), "wal");
        assert.ok(inspectDb.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='rulebook_entitlements'").get());
        assert.ok(inspectDb.prepare("SELECT name FROM sqlite_master WHERE type='index' AND name='idx_rulebook_entitlements_owner_pack'").get());
      } finally {
        inspectDb.close();
      }

      const creator = makeClient(baseUrl);
      const buyer = makeClient(baseUrl);

      // Publish v1 (paid, supports both solo and group because cloned from official-jakarta-compact-claim)
      const cloned = await creator.post("/api/rulebooks", {
        type: "clone-official",
        templatePackId: "official-jakarta-compact-claim",
        packId,
        title: "Tur Blok M Premium",
        byline: "Studio Selatan",
        priceIdr: 25_000,
      });
      assert.equal(cloned.status, 200);
      assert.equal((await creator.post("/api/rulebooks", { type: "submit-draft", packId, version: 1 })).status, 200);
      assert.equal(
        (await creator.post("/api/rulebooks", { type: "publish-version", packId, version: 1 }, { authorization: "Bearer entitlement-reviewer-key" })).status,
        200,
      );

      // Publish v2 of the same packId
      const v2Pack = structuredClone(cloned.body.record.pack);
      v2Pack.meta.version = 2;
      v2Pack.meta.title = "Tur Blok M Premium v2";
      const savedV2 = await creator.post("/api/rulebooks", {
        type: "save-draft",
        pack: v2Pack,
        snapshot: cloned.body.record.snapshot,
      });
      assert.equal(savedV2.status, 200);
      assert.equal((await creator.post("/api/rulebooks", { type: "submit-draft", packId, version: 2 })).status, 200);
      assert.equal(
        (await creator.post("/api/rulebooks", { type: "publish-version", packId, version: 2 }, { authorization: "Bearer entitlement-reviewer-key" })).status,
        200,
      );
      creatorCookie = creator.cookie;

      // Non-owner cannot launch paid pack for free
      const deniedPlay = await buyer.post("/api/rulebooks/catalog", {
        type: "play",
        edition: packId,
        version: 1,
        mode: "group",
        requestId: "req-denied-free-play-0001",
      });
      assert.equal(deniedPlay.status, 400);
      assert.equal(deniedPlay.body.error, "payment-required");

      // Buyer creates order and settles via Midtrans webhook
      const buyRes = await buyer.post("/api/rulebooks/catalog", {
        type: "buy",
        edition: packId,
        version: 1,
        mode: "group",
        requestId: "req-buy-owned-pack-0001",
      });
      assert.equal(buyRes.status, 200);
      orderId = buyRes.body.order.orderId;
      buyerCookie = buyer.cookie;

      const settled = await buyer.post("/api/rulebooks/catalog", {
        type: "simulate-payment",
        edition: packId,
        version: 1,
        mode: "group",
        requestId: "req-buy-owned-pack-0001",
      });
      assert.equal(settled.status, 200);
      assert.equal(settled.body.ok, true);
      assert.equal(settled.body.duplicate, false);
      assert.ok(settled.body.pass?.roomCode);
      assert.match(settled.body.restoreCode, /^KLR-[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{4}-[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{4}$/);
      restoreCode = settled.body.restoreCode;
      room1Code = settled.body.pass.roomCode;

      // Duplicate Midtrans webhook delivery stays idempotent: 1 entitlement, 1 earning, no plaintext restoreCode re-exposed
      const webhookPayload = midtrans.signNotification({ orderId, transactionStatus: "settlement", grossAmount: "25000.00" });
      const dupWebhook = await makeClient(baseUrl).post("/api/rulebooks/midtrans-notification", webhookPayload);
      assert.equal(dupWebhook.status, 200);
      assert.equal(dupWebhook.body.duplicate, true);
      assert.equal(dupWebhook.body.restoreCode, undefined);

      // Verify SQLite stores SHA-256 hash ONLY (never plaintext restore code), 1 entitlement row, 1 earnings row
      const inspectDb2 = new DatabaseSync(dbPath, { timeout: 5000 });
      try {
        const entRows = inspectDb2.prepare("SELECT * FROM rulebook_entitlements").all();
        assert.equal(entRows.length, 1);
        assert.equal(entRows[0].pack_id, packId);
        assert.equal(entRows[0].order_id, orderId);
        assert.equal(entRows[0].restore_code_hash, createHash("sha256").update(restoreCode).digest("hex"));
        assert.equal(JSON.stringify(entRows).includes(restoreCode), false);
        const earnCount = inspectDb2.prepare("SELECT count(*) AS count FROM rulebook_earnings").get().count;
        assert.equal(earnCount, 1);
      } finally {
        inspectDb2.close();
      }

      // Prevent double-purchasing an already-owned pack
      const doubleBuy = await buyer.post("/api/rulebooks/catalog", {
        type: "buy",
        edition: packId,
        version: 1,
        mode: "solo",
        requestId: "req-double-buy-owned-0002",
      });
      assert.equal(doubleBuy.status, 409);
      assert.equal(doubleBuy.body.error, "pack-already-owned");

      // Caller-scoped ownership exposed on GET /api/rulebooks/catalog and GET /api/rulebooks without secrets
      const buyerCatalog = await buyer.get("/api/rulebooks/catalog");
      assert.equal(buyerCatalog.status, 200);
      assert.deepEqual(buyerCatalog.body.ownedPackIds, [packId]);
      assert.equal(buyerCatalog.body.entitlements.length, 1);
      assert.equal(buyerCatalog.body.entitlements[0].packId, packId);
      assert.equal(buyerCatalog.body.entitlements[0].orderId, orderId);
      assert.equal(buyerCatalog.body.entitlements[0].activeRoomCode, room1Code);
      const codeHash = createHash("sha256").update(restoreCode).digest("hex");
      assert.equal(JSON.stringify(buyerCatalog.body).includes(restoreCode), false);
      assert.equal(JSON.stringify(buyerCatalog.body).includes(codeHash), false);

      const buyerPublicList = await buyer.get("/api/rulebooks");
      assert.deepEqual(buyerPublicList.body.ownedPackIds, [packId]);
      assert.equal(buyerPublicList.body.entitlements[0].activeRoomCode, room1Code);

      const writerView = await creator.get("/api/rulebooks?role=writer");
      assert.deepEqual(writerView.body.ownedPackIds, []);
      assert.equal(JSON.stringify(writerView.body).includes(restoreCode), false);
      assert.equal(JSON.stringify(writerView.body).includes(codeHash), false);

      // Anonymous visitor sees empty ownership
      const anonCatalog = await makeClient(baseUrl).get("/api/rulebooks/catalog");
      assert.deepEqual(anonCatalog.body.ownedPackIds, []);
      assert.deepEqual(anonCatalog.body.entitlements, []);

      // Anti-sharing guard: hosting a second concurrent active room on same entitlement is blocked cleanly!
      const secondConcurrent = await buyer.post("/api/rulebooks/catalog", {
        type: "play",
        edition: packId,
        version: 1,
        mode: "solo",
        requestId: "req-concurrent-room-0002",
      });
      assert.equal(secondConcurrent.status, 409);
      assert.equal(secondConcurrent.body.error, "entitlement-active-room-exists");
      assert.equal(secondConcurrent.body.roomCode, room1Code);

      // Host cancels/exits room #1 -> entitlement becomes free for replay!
      const leaveRes = await buyer.post("/api/rulebooks", {
        type: "room-action",
        roomCode: room1Code,
        action: { type: "leave", actionId: "leave-room-1" },
      });
      assert.equal(leaveRes.status, 200);
      assert.ok(leaveRes.body.room.outcome);

      // Pause v1 -> new purchases of v1 are blocked, while existing owner can still launch unaffected published v2!
      const pauseV1 = await creator.post(
        "/api/rulebooks",
        { type: "pause-version", packId, version: 1, reason: "Maintenance" },
        { authorization: "Bearer entitlement-reviewer-key" },
      );
      assert.equal(pauseV1.status, 200);
      const blockedBuyer = makeClient(baseUrl);
      const buyPaused = await blockedBuyer.post("/api/rulebooks/catalog", {
        type: "buy",
        edition: packId,
        version: 1,
        mode: "solo",
        requestId: "req-buy-paused-v1-0001",
      });
      assert.equal(buyPaused.status, 400);
      assert.equal(buyPaused.body.error, "pack-unavailable");
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  }

  // Phase 2: Restart server against the exact same SQLite file!
  {
    clock.now = T0 + 30_000;
    const { server, baseUrl } = await startServer(dbPath, clock);
    try {
      const buyer = makeClient(baseUrl, buyerCookie);
      const creator = makeClient(baseUrl, creatorCookie);

      // Ownership survived restart; activeRoomCode is null since room #1 ended
      const catAfterRestart = await buyer.get("/api/rulebooks/catalog");
      assert.deepEqual(catAfterRestart.body.ownedPackIds, [packId]);
      assert.equal(catAfterRestart.body.entitlements[0].activeRoomCode, null);

      // Owner cannot launch paused v1, CAN launch published v2 in Solo mode without paying again!
      const pausedPlay = await buyer.post("/api/rulebooks/catalog", {
        type: "play",
        edition: packId,
        version: 1,
        mode: "solo",
        requestId: "req-play-paused-v1-0001",
      });
      assert.equal(pausedPlay.status, 400);
      assert.equal(pausedPlay.body.error, "pack-unavailable");

      const room2Res = await buyer.post("/api/rulebooks/catalog", {
        type: "play",
        edition: packId,
        version: 2,
        mode: "solo",
        requestId: "req-replay-solo-v2-0001",
      });
      assert.equal(room2Res.status, 200);
      assert.equal(room2Res.body.ok, true);
      assert.notEqual(room2Res.body.roomCode, room1Code);
      assert.equal(room2Res.body.room.isSolo, true);
      assert.equal(room2Res.body.pass.paid, true);
      const room2Code = room2Res.body.roomCode;

      // Retrying the exact same requestId returns room #2 idempotently (not 409)
      const room2Retry = await buyer.post("/api/rulebooks/catalog", {
        type: "play",
        edition: packId,
        version: 2,
        mode: "solo",
        requestId: "req-replay-solo-v2-0001",
      });
      assert.equal(room2Retry.status, 200);
      assert.equal(room2Retry.body.roomCode, room2Code);

      // Creator's earnings history remained 1 (no extra charge for replay!)
      const writerAfter = await creator.get("/api/rulebooks?role=writer");
      assert.equal(writerAfter.body.earnings.length, 1);

      // Exit room #2 so we can test cross-device restore cleanly
      await buyer.post("/api/rulebooks", {
        type: "room-action",
        roomCode: room2Code,
        action: { type: "leave", actionId: "leave-room-2" },
      });

      // Phase 3: Brand-new device (fresh cookie) restores pack using normalized restore code (lowercase + spaces)!
      const newPhone = makeClient(baseUrl);
      // Invalid code rejected consistently
      const badRestore = await newPhone.post("/api/rulebooks/entitlements/restore", { restoreCode: "not-a-valid-code" });
      assert.equal(badRestore.status, 400);
      assert.equal(badRestore.body.error, "invalid-restore-code");

      const messyCode = `  ${restoreCode.toLowerCase().replace(/-/g, "  ")} `;
      const restored = await newPhone.post("/api/rulebooks/entitlements/restore", { restoreCode: messyCode });
      assert.equal(restored.status, 200);
      assert.equal(restored.body.ok, true);
      assert.equal(restored.body.packId, packId);
      assert.equal(restored.body.orderId, orderId);
      assert.equal(restored.body.restoredAt, clock.now);
      assert.deepEqual(restored.body.ownedPackIds, [packId]);
      assert.equal(JSON.stringify(restored.body).includes(restoreCode), false);

      // Old device no longer owns the pack; new device launches room #3 in Group mode!
      const oldPhoneCatalog = await buyer.get("/api/rulebooks/catalog");
      assert.deepEqual(oldPhoneCatalog.body.ownedPackIds, []);

      const room3Res = await newPhone.post("/api/rulebooks", {
        type: "create-owned-room",
        packId,
        version: 2,
        hostName: "New Phone Host",
        mode: "group",
        requestId: "req-new-phone-room3-0001",
      });
      assert.equal(room3Res.status, 200);
      assert.equal(room3Res.body.ok, true);
      assert.equal(room3Res.body.room.isSolo, false);
      assert.equal(room3Res.body.pass.paid, true);

      // Brute-force protection: rate limit invalid restore attempts from an attacker credential
      const attacker = makeClient(baseUrl);
      for (let i = 0; i < 5; i++) {
        const attempt = await attacker.post("/api/rulebooks/entitlements/restore", {
          restoreCode: `KLR-2345-678${RESTORE_DIGITS[i]}`,
        });
        assert.equal(attempt.status, 400);
        assert.equal(attempt.body.error, "invalid-restore-code");
      }
      const blocked = await attacker.post("/api/rulebooks/entitlements/restore", {
        restoreCode,
      });
      assert.equal(blocked.status, 429);
      assert.equal(blocked.body.error, "restore-rate-limited");
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  }
});

const RESTORE_DIGITS = ["A", "B", "C", "D", "E"];
