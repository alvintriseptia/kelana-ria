import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { createSoloServer } from "../dist/index.js";
import { makeClient, signInWithSandboxOtp } from "./auth-client.mjs";

const adminEmail = "admin-review@kelana.test";
const creatorEmail = "creator-review@kelana.test";
const reviewQueue = "/api/rulebooks?role=reviewer";
const adminAccounts = "/api/auth/admins";
const rulebooks = "/api/rulebooks";

async function listen(options) {
  const server = createSoloServer({ databasePath: ":memory:", allowSandboxAuthOtp: true, ...options });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  return {
    client: () => makeClient(`http://127.0.0.1:${server.address().port}`),
    close: () => new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())),
  };
}

test("admin role migration preserves accounts and protects bootstrap and last admin", async t => {
  const dir = mkdtempSync(join(tmpdir(), "kelana-admin-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const databasePath = join(dir, "test.sqlite");
  let now = Date.now();
  const settings = { databasePath, now: () => now };
  const initial = await listen(settings);
  try {
    assert.equal((await signInWithSandboxOtp(initial.client(), adminEmail)).body.user.role, "user");
  } finally {
    await initial.close();
  }
  const db = new DatabaseSync(databasePath);
  db.exec("ALTER TABLE users DROP COLUMN role");
  db.close();

  now += 61_000;
  let app = await listen({ ...settings, adminEmails: [` ${adminEmail.toUpperCase()} `] });
  try {
    const admin = app.client();
    await signInWithSandboxOtp(admin, adminEmail, "Admin QA");
    const creator = app.client();
    await signInWithSandboxOtp(creator, creatorEmail, "Kreator QA");
    const admins = await admin.get(adminAccounts);
    assert.deepEqual(admins.body.admins.map(user => [user.email, user.role, user.isEnvBootstrapped]), [[adminEmail, "admin", true]]);
    assert.equal((await admin.post(adminAccounts, { action: "revoke", email: adminEmail })).body.error, "env-bootstrapped-admin");
    assert.equal((await admin.post(adminAccounts, { action: "grant", email: "missing@kelana.test" })).status, 404);
    assert.equal((await admin.post(adminAccounts, { action: "grant", email: creatorEmail })).status, 200);
    assert.equal((await creator.get("/api/auth/me")).body.user.role, "admin");
    assert.equal((await admin.post(adminAccounts, { action: "revoke", email: creatorEmail })).status, 200);
    assert.equal((await creator.get(adminAccounts)).status, 403);
  } finally {
    await app.close();
  }
  now += 61_000;
  app = await listen(settings);
  try {
    const admin = app.client();
    await signInWithSandboxOtp(admin, adminEmail, "Admin QA");
    const last = await admin.post(adminAccounts, { action: "revoke", email: adminEmail });
    assert.equal(last.status, 400);
    assert.equal(last.body.error, "cannot-remove-last-admin");
  } finally {
    await app.close();
  }
});

test("moderation requires OTP admin and keeps the review trail and playtest private", async t => {
  let now = 1_790_000_000_000;
  const app = await listen({ adminEmails: [adminEmail], now: () => now });
  t.after(app.close);
  const guest = app.client();
  const admin = app.client();
  const creator = app.client();
  const identity = (await signInWithSandboxOtp(admin, adminEmail, "Admin QA")).body.user;
  assert.equal(identity.role, "admin");
  const ordinary = (await signInWithSandboxOtp(creator, creatorEmail, "Kreator QA")).body.user;
  assert.equal(ordinary.role, "user");
  assert.equal((await admin.get(rulebooks + "?role=writer")).body.isAdmin, true);
  assert.equal((await creator.get(rulebooks + "?role=writer")).body.isAdmin, false);
  for (const [client, status, error] of [[guest, 401, "auth-required"], [creator, 403, "admin-only"]]) {
    for (const path of [reviewQueue, adminAccounts]) {
      const response = await client.get(path);
      assert.equal(response.status, status);
      assert.equal(response.body.error, error);
    }
    const responses = await Promise.all([
      client.post(adminAccounts, { action: "grant", email: creatorEmail }),
      ...["publish-version", "request-changes", "pause-version", "resume-version", "start-admin-playtest"]
        .map(type => client.post(rulebooks, { type, packId: "example", version: 1 })),
    ]);
    for (const reply of responses) {
      assert.equal(reply.status, status);
      assert.equal(reply.body.error, error);
    }
  }

  const packId = "qa-admin-review";
  const target = { packId, version: 1 };
  const draft = await creator.post(rulebooks, {
    type: "clone-official", templatePackId: "official-jakarta-compact-claim", packId,
    title: "QA Admin Review", byline: "Kreator QA", priceIdr: 30_000,
  });
  assert.equal(draft.status, 200);
  assert.equal((await admin.post(rulebooks, { type: "start-admin-playtest", ...target })).body.error, "invalid-status");

  const submit = () => creator.post(rulebooks, { type: "submit-draft", ...target });
  assert.equal((await submit()).status, 200);
  const listed = (await admin.get(reviewQueue + "&status=submitted&format=claim-the-city")).body.versions;
  assert.equal(listed.length, 1);
  assert.equal(listed[0].pack.meta.packId, packId);
  assert.ok(listed[0].snapshot.boundaryPolygon.length > 0);
  assert.equal(listed[0].validation.ok, true);
  assert.deepEqual(listed[0].auditLog, []);
  assert.equal(listed[0].ownerHash, undefined);
  assert.deepEqual((await admin.get(reviewQueue + "&format=hide-and-seek")).body.versions, []);

  const playtest = await admin.post(rulebooks, { type: "start-admin-playtest", ...target });
  assert.equal(playtest.status, 200);
  assert.equal(playtest.body.pass.paid, false);
  assert.equal(playtest.body.draftPlaytest, true);
  assert.equal(playtest.body.qa, true);
  assert.equal((await admin.get(`${rulebooks}/rooms/${playtest.body.roomCode}`)).body.draftPlaytest, true);
  const publicBefore = (await guest.get(rulebooks + "/catalog")).body;
  assert.ok(!publicBefore.editions.some(edition => edition.packId === packId));
  assert.ok(!publicBefore.activeRooms.some(room => room.roomCode === playtest.body.roomCode));
  assert.ok(!publicBefore.sharedRecaps.some(recap => recap.packId === packId));

  const decisions = [
    { type: "request-changes", action: "request-changes", note: "Perjelas catatan akses." },
    { type: "publish-version", action: "publish", note: "Disetujui." },
    { type: "pause-version", action: "pause", note: "Perawatan lokasi." },
    { type: "resume-version", action: "resume", note: "Lokasi dibuka lagi." },
  ];
  const times = [];
  for (const { type, note } of decisions) {
    now += 500;
    times.push(now);
    assert.equal((await admin.post(rulebooks, { type, ...target, note, reason: note })).status, 200);
    if (type === "request-changes") {
      assert.equal((await submit()).status, 200);
    }
    if (type === "pause-version") {
      const paused = (await admin.get(reviewQueue + "&status=paused")).body.versions[0];
      assert.equal(paused.packId, packId);
      assert.equal(paused.pausedReason, note);
      const catalog = (await guest.get(rulebooks + "/catalog")).body;
      assert.ok(!catalog.editions.some(edition => edition.packId === packId));
    }
  }
  const published = (await admin.get(reviewQueue + "&status=published")).body.versions[0];
  assert.equal(published.pausedReason, null);
  assert.deepEqual(published.auditLog.map(entry => ({ action: entry.action, note: entry.note })),
    decisions.map(({ action, note }) => ({ action, note })));
  assert.deepEqual(published.auditLog.map(entry => entry.createdAt), times);
  for (const entry of published.auditLog) {
    assert.equal(entry.adminUserId, identity.userId);
    assert.equal(entry.adminEmail, identity.email);
    assert.equal(entry.adminDisplayName, identity.displayName);
  }
  const publicAfter = (await guest.get(rulebooks + "/catalog")).body;
  assert.ok(publicAfter.editions.some(edition => edition.packId === packId));
  assert.doesNotMatch(JSON.stringify(publicAfter), /auditLog|admin-review@kelana.test/);
});
