import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import * as api from "../dist/index.js";
import { makeClient, signInWithSandboxOtp, TEST_ADMIN } from "./auth-client.mjs";

const T0 = 1_800_000_000_000;

test("Email 6-digit OTP lifecycle: HttpOnly session, single-use, 5-attempt lockout, 10m expiry, rate limits, profile update, and logout", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "kelana-auth-otp-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const dbPath = join(dir, "auth.sqlite");
  const clock = { now: T0 };
  const emailAdapter = api.createRecordedEmailOtpAdapter();
  const server = api.createSoloServer({
    databasePath: dbPath,
    now: () => clock.now,
    emailAdapter,
    allowSandboxAuthOtp: true,
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  // GET /api/auth/me never creates a session on read
  const client = makeClient(baseUrl);
  const meAnon = await client.get("/api/auth/me");
  assert.equal(meAnon.status, 200);
  assert.deepEqual(meAnon.body, { authenticated: false, user: null, allowSandboxOtp: true });
  assert.equal(meAnon.setCookies.length, 0);

  // Invalid email rejected cleanly
  const badEmail = await client.post("/api/auth/request-otp", { email: "not-an-email" });
  assert.equal(badEmail.status, 400);
  assert.equal(badEmail.body.error, "invalid-email");

  // Request OTP -> salted hash only stored in SQLite (no plaintext OTP!)
  const req1 = await client.post("/api/auth/request-otp", { email: "  Alvin.Test@Example.COM " });
  assert.equal(req1.status, 200);
  assert.equal(req1.body.ok, true);
  assert.match(req1.body.sandboxCode, /^\d{6}$/);
  assert.equal(req1.body.expiresAt, T0 + 10 * 60_000);
  assert.equal(req1.body.resendAvailableAt, T0 + 60_000);
  assert.equal(emailAdapter.lastCodeFor("alvin.test@example.com"), req1.body.sandboxCode);

  const inspect = new DatabaseSync(dbPath, { timeout: 5000 });
  try {
    const row = inspect.prepare("SELECT * FROM auth_otp_challenges WHERE challenge_id = ?").get(req1.body.challengeId);
    assert.ok(row);
    assert.equal(row.email_normalized, "alvin.test@example.com");
    assert.equal(JSON.stringify(row).includes(req1.body.sandboxCode), false, "SQLite must never store raw OTP code");
  } finally {
    inspect.close();
  }

  // Rapid resend before 60s cooldown returns 429 otp-rate-limited
  const fastResend = await client.post("/api/auth/request-otp", { email: "alvin.test@example.com" });
  assert.equal(fastResend.status, 429);
  assert.equal(fastResend.body.error, "otp-rate-limited");
  assert.ok(Number(fastResend.headers.get("retry-after")) >= 1);

  // 5 invalid verification attempts lock out the challenge
  const wrongCode = req1.body.sandboxCode === "000000" ? "111111" : "000000";
  for (let i = 1; i <= 4; i++) {
    const attempt = await client.post("/api/auth/verify-otp", {
      challengeId: req1.body.challengeId,
      code: wrongCode,
    });
    assert.equal(attempt.status, 400);
    assert.equal(attempt.body.error, "otp-invalid");
    assert.equal(attempt.body.remainingAttempts, 5 - i);
  }
  const locked = await client.post("/api/auth/verify-otp", {
    challengeId: req1.body.challengeId,
    code: wrongCode,
  });
  assert.equal(locked.status, 400);
  assert.equal(locked.body.error, "otp-attempts-exceeded");
  const afterLockValid = await client.post("/api/auth/verify-otp", {
    challengeId: req1.body.challengeId,
    code: req1.body.sandboxCode,
  });
  assert.equal(afterLockValid.status, 400);
  assert.equal(afterLockValid.body.error, "otp-attempts-exceeded");

  // Expired OTP returns 400 otp-expired
  clock.now += 61_000;
  const req2 = await client.post("/api/auth/request-otp", { email: "alvin.test@example.com" });
  assert.equal(req2.status, 200);
  clock.now += 10 * 60_000;
  const expired = await client.post("/api/auth/verify-otp", {
    challengeId: req2.body.challengeId,
    code: req2.body.sandboxCode,
  });
  assert.equal(expired.status, 400);
  assert.equal(expired.body.error, "otp-expired");

  // Valid OTP verifies, sets HttpOnly SameSite=Lax Path=/api cookie, and is strictly single-use
  const req3 = await client.post("/api/auth/request-otp", { email: "alvin.test@example.com" });
  assert.equal(req3.status, 200);
  const verified = await client.post("/api/auth/verify-otp", {
    challengeId: req3.body.challengeId,
    code: req3.body.sandboxCode,
    displayName: "Alvin Jakarta",
  });
  assert.equal(verified.status, 200);
  assert.equal(verified.body.ok, true);
  assert.equal(verified.body.user.email, "alvin.test@example.com");
  assert.equal(verified.body.user.displayName, "Alvin Jakarta");
  const sessionCookieHeader = verified.setCookies.find((c) => c.startsWith("kelana_session="));
  assert.ok(sessionCookieHeader, "Must issue kelana_session cookie");
  assert.match(sessionCookieHeader, /HttpOnly/i);
  assert.match(sessionCookieHeader, /SameSite=Lax/i);
  assert.match(sessionCookieHeader, /Path=\/api/i);

  // Single-use reuse rejected
  const reuse = await makeClient(baseUrl).post("/api/auth/verify-otp", {
    challengeId: req3.body.challengeId,
    code: req3.body.sandboxCode,
  });
  assert.equal(reuse.status, 400);
  assert.equal(reuse.body.error, "otp-invalid");

  // Authenticated profile update works
  const prof = await client.post("/api/auth/profile", { displayName: "Alvin Explorer" });
  assert.equal(prof.status, 200);
  assert.equal(prof.body.user.displayName, "Alvin Explorer");
  const meAfter = await client.get("/api/auth/me");
  assert.equal(meAfter.body.authenticated, true);
  assert.equal(meAfter.body.user.displayName, "Alvin Explorer");

  // Logout revokes session server-side even if an old token is replayed
  const savedSessionCookie = `kelana_session=${client.cookies.get("kelana_session")}`;
  const loggedOut = await client.post("/api/auth/logout", {});
  assert.equal(loggedOut.status, 200);
  assert.equal(loggedOut.body.ok, true);
  const replayedAfterLogout = await fetch(`${baseUrl}/api/auth/me`, {
    headers: { cookie: savedSessionCookie },
  });
  assert.equal((await replayedAfterLogout.json()).authenticated, false);

  // Per-email / per-IP 15-minute window caps at 5 sends -> 6th returns 429
  clock.now += 20 * 60_000;
  for (let i = 0; i < 5; i++) {
    const r = await client.post("/api/auth/request-otp", { email: `flood${i}@example.com` });
    assert.equal(r.status, 200, `Expected send ${i + 1} to succeed`);
    clock.now += 61_000;
  }
  const flooded = await client.post("/api/auth/request-otp", { email: "flood5@example.com" });
  assert.equal(flooded.status, 429);
  assert.equal(flooded.body.error, "otp-rate-limited");
});

test("Production HTTP email adapter hides sandboxCode, redacts secrets/OTP in evidence, and recovers after outage", async (t) => {
  const clock = { now: T0 };
  const secretApiKey = "re_live_super_secret_key_999";
  let failOnce = true;
  let capturedOtp = "";
  let seenAuthHeader = "";
  const emailAdapter = api.createHttpEmailOtpAdapter({
    apiKey: secretApiKey,
    fromEmail: "noreply@kelanaria.id",
    apiBaseUrl: "https://mail.sandbox.test",
    fetchImpl: async (_url, init) => {
      seenAuthHeader = String(init?.headers?.Authorization ?? "");
      const payload = JSON.parse(String(init?.body ?? "{}"));
      const match = String(payload.text ?? "").match(/\b(\d{6})\b/);
      if (match) capturedOtp = match[1];
      if (failOnce) {
        failOnce = false;
        return new Response("upstream down", { status: 503 });
      }
      return new Response(JSON.stringify({ id: "msg_123" }), { status: 200 });
    },
  });

  const server = api.createSoloServer({
    databasePath: ":memory:",
    now: () => clock.now,
    emailAdapter,
    allowSandboxAuthOtp: false,
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const client = makeClient(baseUrl);

  const me = await client.get("/api/auth/me");
  assert.equal(me.body.allowSandboxOtp, false);

  // First send hits simulated provider outage -> 503 and rolls back cooldown so immediate retry works
  const failed = await client.post("/api/auth/request-otp", { email: "prod@example.com" });
  assert.equal(failed.status, 503);
  assert.equal(failed.body.error, "email-delivery-failed");
  assert.equal(failed.body.sandboxCode, undefined);

  const retry = await client.post("/api/auth/request-otp", { email: "prod@example.com" });
  assert.equal(retry.status, 200);
  assert.equal(retry.body.sandboxCode, undefined, "Production mode must never expose sandboxCode");
  assert.equal(seenAuthHeader, `Bearer ${secretApiKey}`);
  assert.match(capturedOtp, /^\d{6}$/);

  // Redacted provider events must never contain raw OTP, raw email, or API key
  const serializedEvents = JSON.stringify(emailAdapter.events);
  assert.equal(serializedEvents.includes(capturedOtp), false);
  assert.equal(serializedEvents.includes(secretApiKey), false);
  assert.equal(serializedEvents.includes("prod@example.com"), false);
  assert.equal(emailAdapter.events.length, 2);
  assert.equal(emailAdapter.events[0].status, "failed");
  assert.equal(emailAdapter.events[1].status, "sent");

  const verified = await client.post("/api/auth/verify-otp", {
    challengeId: retry.body.challengeId,
    code: capturedOtp,
  });
  assert.equal(verified.status, 200);
  assert.equal(verified.body.user.email, "prod@example.com");
});

test("Guest-first play, auth-required checkout/Studio gates, atomic guest recap migration, and cross-device ownership across restarts", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "kelana-auth-e2e-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const dbPath = join(dir, "e2e.sqlite");
  const clock = { now: T0 };
  const packId = "comm-account-bound-claim";
  let migratedMatchId = "";
  let creatorUserId = "";
  let buyerUserId = "";

  // Phase 1: Auth gates, guest free play + recap migration, creator publish, buyer purchase, guest join paid room
  {
    const server = api.createSoloServer({
      databasePath: dbPath,
      now: () => clock.now,
      midtrans: api.createRecordedMidtransAdapter(),
      emailAdapter: api.createRecordedEmailOtpAdapter(),
      allowRulebookSandboxCheckout: true,
      allowSandboxAuthOtp: true,
      adminEmails: [TEST_ADMIN.email],
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    try {
      const guest = makeClient(baseUrl);

      // Deleted restore endpoint returns 404
      const deletedRestore = await guest.post("/api/rulebooks/entitlements/restore", { restoreCode: "KLR-AAAA-BBBB" });
      assert.equal(deletedRestore.status, 404);

      // Unauthenticated Studio writer routes return 401 auth-required
      assert.equal((await guest.get("/api/rulebooks?role=writer")).status, 401);
      assert.equal((await guest.get("/api/rulebooks?role=writer")).body.error, "auth-required");
      assert.equal(
        (await guest.post("/api/rulebooks", {
          type: "clone-official",
          templatePackId: "official-jakarta-compact-claim",
          packId,
          title: "Unauth",
          byline: "Anon",
          priceIdr: 20_000,
        })).status,
        401,
      );

      // Guest can launch & finish a free official solo room without signing in
      const freeRoom = await guest.post("/api/rulebooks/catalog", {
        type: "play",
        edition: "official-jakarta-compact-claim",
        version: 1,
        mode: "solo",
        requestId: "req-guest-free-solo-0001",
      });
      assert.equal(freeRoom.status, 200);
      migratedMatchId = freeRoom.body.roomCode;
      const roomView = await guest.get(`/api/rulebooks/rooms/${migratedMatchId}`);
      const sp = roomView.body.publicBoard.startPoint;
      await guest.post("/api/rulebooks", {
        type: "room-action",
        roomCode: migratedMatchId,
        action: { type: "check-in-start", actionId: "ci-1", fix: { latitude: sp.latitude, longitude: sp.longitude, accuracy: 10, timestamp: clock.now } },
      });
      await guest.post("/api/rulebooks", {
        type: "room-action",
        roomCode: migratedMatchId,
        action: { type: "ready", actionId: "r-1", ready: true },
      });
      await guest.post("/api/rulebooks", {
        type: "room-action",
        roomCode: migratedMatchId,
        action: { type: "start", actionId: "s-1" },
      });
      await guest.post("/api/rulebooks", {
        type: "room-action",
        roomCode: migratedMatchId,
        action: { type: "leave", actionId: "l-1" },
      });
      const guestRecaps = await guest.get("/api/rulebooks/recaps");
      assert.equal(guestRecaps.body.recaps.length, 1);
      assert.equal(guestRecaps.body.recaps[0].matchId, migratedMatchId);

      // Creator submits a paid Claim pack for an admin to publish
      const creator = makeClient(baseUrl);
      const creatorVer = await signInWithSandboxOtp(creator, "creator@kelana.test", "Studio Selatan");
      creatorUserId = creatorVer.body.user.userId;
      const cloned = await creator.post("/api/rulebooks", {
        type: "clone-official",
        templatePackId: "official-jakarta-compact-claim",
        packId,
        title: "Tur Akun Premium",
        byline: "Studio Selatan",
        priceIdr: 30_000,
      });
      assert.equal(cloned.status, 200);
      assert.equal((await creator.post("/api/rulebooks", { type: "submit-draft", packId, version: 1 })).status, 200);
      const admin = makeClient(baseUrl);
      await signInWithSandboxOtp(admin, TEST_ADMIN.email);
      assert.equal((await admin.post("/api/rulebooks", { type: "publish-version", packId, version: 1 })).status, 200);

      // Unauthenticated paid checkout returns 401 auth-required
      const unauthBuy = await guest.post("/api/rulebooks/catalog", {
        type: "buy",
        edition: packId,
        version: 1,
        mode: "group",
        requestId: "req-unauth-buy-0001",
      });
      assert.equal(unauthBuy.status, 401);
      assert.equal(unauthBuy.body.error, "auth-required");
      const unauthOrder = await guest.post("/api/rulebooks", {
        type: "create-order",
        packId,
        version: 1,
        mode: "group",
      });
      assert.equal(unauthOrder.status, 401);
      assert.equal(unauthOrder.body.error, "auth-required");

      // Guest signs in -> atomically migrates their guest recap into the account!
      const buyerVer = await signInWithSandboxOtp(guest, "buyer@kelana.test", "Dina");
      assert.equal(buyerVer.body.migrated, true);
      buyerUserId = buyerVer.body.user.userId;
      const postSignInRecaps = await guest.get("/api/rulebooks/recaps");
      assert.equal(postSignInRecaps.body.recaps.length, 1);
      assert.equal(postSignInRecaps.body.recaps[0].matchId, migratedMatchId);

      // Signed-in buyer purchases the paid pack and settles it (no restoreCode returned)
      const buyRes = await guest.post("/api/rulebooks/catalog", {
        type: "buy",
        edition: packId,
        version: 1,
        mode: "group",
        requestId: "req-auth-buy-0001",
      });
      assert.equal(buyRes.status, 200);
      const settleRes = await guest.post("/api/rulebooks/catalog", {
        type: "simulate-payment",
        edition: packId,
        version: 1,
        mode: "group",
        requestId: "req-auth-buy-0001",
      });
      assert.equal(settleRes.status, 200);
      assert.equal(settleRes.body.restoreCode, undefined, "Restore codes must not be emitted");
      const paidRoomCode = settleRes.body.pass.roomCode;
      assert.ok(paidRoomCode);

      // An unauthenticated friend can still join the paid room via room code without signing in!
      const friend = makeClient(baseUrl);
      const friendJoin = await friend.post("/api/rulebooks", {
        type: "join-room",
        roomCode: paidRoomCode,
        name: "Teman Tamu",
      });
      assert.equal(friendJoin.status, 200);
      assert.equal(friendJoin.body.ok, true);
      assert.equal(friendJoin.body.room.seats.length, 2);

      // Close paid room #1 so Device B can launch room #2 after restart
      const leavePaid = await guest.post("/api/rulebooks", {
        type: "room-action",
        roomCode: paidRoomCode,
        action: { type: "leave", actionId: "cancel-paid-1" },
      });
      assert.equal(leavePaid.status, 200);
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  }

  // Phase 2: Restart server and sign in on brand-new isolated devices -> identical accounts, packs, drafts, earnings & recaps!
  clock.now += 120_000;
  {
    const server = api.createSoloServer({
      databasePath: dbPath,
      now: () => clock.now,
      midtrans: api.createRecordedMidtransAdapter(),
      emailAdapter: api.createRecordedEmailOtpAdapter(),
      allowRulebookSandboxCheckout: true,
      allowSandboxAuthOtp: true,
      adminEmails: [TEST_ADMIN.email],
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    try {
      const buyerPhoneB = makeClient(baseUrl);
      const verB = await signInWithSandboxOtp(buyerPhoneB, "BUYER@KELANA.TEST");
      assert.equal(verB.body.user.userId, buyerUserId);

      // Owned pack and migrated recap are immediately unlocked on Phone B!
      const catB = await buyerPhoneB.get("/api/rulebooks/catalog");
      assert.deepEqual(catB.body.ownedPackIds, [packId]);
      assert.equal(catB.body.entitlements.length, 1);

      const recapsB = await buyerPhoneB.get("/api/rulebooks/recaps");
      assert.equal(recapsB.body.recaps.length, 1);
      assert.equal(recapsB.body.recaps[0].matchId, migratedMatchId);

      // Phone B launches a fresh room on the owned paid pack without paying again
      const replay = await buyerPhoneB.post("/api/rulebooks/catalog", {
        type: "play",
        edition: packId,
        version: 1,
        mode: "solo",
        requestId: "req-phone-b-replay-0001",
      });
      assert.equal(replay.status, 200);
      assert.ok(replay.body.roomCode);

      // Creator signs in on Laptop B -> Studio drafts & earnings intact!
      const creatorLaptopB = makeClient(baseUrl);
      const verCreatorB = await signInWithSandboxOtp(creatorLaptopB, "creator@kelana.test");
      assert.equal(verCreatorB.body.user.userId, creatorUserId);
      const studioB = await creatorLaptopB.get("/api/rulebooks?role=writer");
      assert.equal(studioB.status, 200);
      assert.equal(studioB.body.versions.length, 1);
      assert.equal(studioB.body.versions[0].packId, packId);
      assert.equal(studioB.body.earnings.length, 1);
      assert.equal(studioB.body.earnings[0].grossAmountIdr, 30_000);
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  }
});
