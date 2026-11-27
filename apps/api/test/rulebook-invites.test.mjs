import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { createSoloServer, loadOfficialClaimPacks, loadOfficialSeekPacks } from "../dist/index.js";
import { makeClient, signInWithSandboxOtp } from "./auth-client.mjs";

const rulebooks = "/api/rulebooks";
const claimEdition = loadOfficialClaimPacks().find(({ pack }) => pack.meta.packId === "official-jakarta-compact-claim").pack.meta;
const seekEdition = loadOfficialSeekPacks().find(({ pack }) => pack.meta.packId === "official-jakarta-compact-seek").pack.meta;

async function listen(t, databasePath = ":memory:") {
  const server = createSoloServer({ databasePath, allowSandboxAuthOtp: true });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  return () => makeClient(`http://127.0.0.1:${server.address().port}`);
}

async function openRoom(host, { packId, version }, mode = "group") {
  const result = await host.post(`${rulebooks}/catalog`, {
    type: "play", edition: packId, version, mode, requestId: "open-invite-test-room",
  });
  assert.equal(result.status, 200, JSON.stringify(result.body));
  return result.body;
}

function preview(client, roomCode) {
  return client.get(`${rulebooks}/rooms/${encodeURIComponent(roomCode)}/invite`);
}

test("Rulebook invitation previews show display metadata without taking a seat", async t => {
  const client = await listen(t);
  for (const edition of [claimEdition, seekEdition]) {
    const { format, title } = edition;
    const host = client();
    const guest = client();
    const { roomCode } = await openRoom(host, edition);
    const before = await host.get(`${rulebooks}/rooms/${roomCode}`);
    const previewCode = ` ${roomCode.toLowerCase().replace("-", " - ")} `;
    const invite = await preview(guest, previewCode);
    assert.equal(invite.status, 200);
    assert.deepEqual(invite.body, { status: "open", format, title });
    assert.equal(invite.headers.get("cache-control"), "no-store");
    assert.ok(guest.cookies.has("kelana_rulebook"));

    const after = await host.get(`${rulebooks}/rooms/${roomCode}`);
    assert.equal(after.body.stateRev, before.body.stateRev);
    assert.deepEqual(after.body.room.seats, before.body.room.seats);
    assert.equal(after.body.room.seats.length, 1);

    const joined = await guest.post(rulebooks, { type: "join-room", roomCode, name: "Guest" });
    assert.equal(joined.status, 200, JSON.stringify(joined.body));
    assert.equal(joined.body.seatId, "seat-2");
    assert.deepEqual(joined.setCookies, []);
    assert.deepEqual((await preview(guest, roomCode)).body, { status: "member", format, title });
  }
});

test("Rulebook invitation previews distinguish missing, full and closed rooms while restoring members", async t => {
  const client = await listen(t);
  const stranger = client();
  const missing = await preview(stranger, "not-a-room");
  assert.equal(missing.status, 404);
  assert.deepEqual(missing.body, { error: "room-not-found" });

  for (const edition of [claimEdition, seekEdition]) {
    const { format, title } = edition;
    const host = client();
    const { roomCode, pass } = await openRoom(host, edition);
    for (let seats = 1; seats < pass.maxPlayers; seats++) {
      const joined = await client().post(rulebooks, { type: "join-room", roomCode });
      assert.equal(joined.status, 200, JSON.stringify(joined.body));
    }

    assert.deepEqual((await preview(stranger, roomCode)).body, { status: "full", format, title });
    assert.deepEqual((await preview(host, roomCode)).body, { status: "member", format, title });

    const canceled = await host.post(rulebooks, {
      type: "room-action", roomCode, action: { type: "leave", actionId: "cancel-invite-test" },
    });
    assert.equal(canceled.body.room.phase, "canceled");
    assert.deepEqual((await preview(stranger, roomCode)).body, { status: "closed", format, title });
    assert.deepEqual((await preview(host, roomCode)).body, { status: "member", format, title });
  }

  const { roomCode } = await openRoom(client(), claimEdition, "solo");
  assert.deepEqual((await preview(stranger, roomCode)).body, {
    status: "full", format: "claim-the-city", title: claimEdition.title,
  });
});

test("Draft playtest invite previews withhold the title until the caller has a seat", async t => {
  const client = await listen(t);
  const creator = client();
  const guest = client();
  assert.equal((await signInWithSandboxOtp(creator, "draft-invite@kelana.test")).status, 200);
  const packId = "draft-invite-seek";
  const title = "Unpublished playtest title";
  const draft = await creator.post(rulebooks, {
    type: "clone-official", templatePackId: "official-jakarta-compact-seek", packId,
    title, byline: "Creator", priceIdr: 0,
  });
  assert.equal(draft.status, 200, JSON.stringify(draft.body));
  const playtest = await creator.post(rulebooks, { type: "start-draft-playtest", packId, version: 1 });
  assert.equal(playtest.status, 200, JSON.stringify(playtest.body));
  const { roomCode } = playtest.body;
  assert.deepEqual((await preview(guest, roomCode)).body, { status: "open", format: "hide-and-seek" });
  assert.deepEqual((await preview(creator, roomCode)).body, { status: "member", format: "hide-and-seek", title });
  assert.equal((await guest.post(rulebooks, { type: "join-room", roomCode })).status, 200);
  assert.deepEqual((await preview(guest, roomCode)).body, { status: "member", format: "hide-and-seek", title });
});

test("Stored passes identify closed rooms after restart while keeping draft titles private", async t => {
  const tempDir = mkdtempSync(join(tmpdir(), "kelana-rulebook-invites-"));
  t.after(() => rmSync(tempDir, { recursive: true, force: true }));
  const databasePath = join(tempDir, "db.sqlite");
  let roomCode;
  let playtestCode;
  await t.test("cancel the room", async previous => {
    const client = await listen(previous, databasePath);
    const host = client();
    ({ roomCode } = await openRoom(host, claimEdition));
    const canceled = await host.post(rulebooks, {
      type: "room-action", roomCode, action: { type: "leave", actionId: "cancel-room" },
    });
    assert.equal(canceled.body.room.phase, "canceled");

    const draft = await openRoom(host, seekEdition);
    playtestCode = draft.roomCode;
    await host.post(rulebooks, {
      type: "room-action", roomCode: playtestCode, action: { type: "leave", actionId: "cancel-playtest" },
    });
  });

  // Simulate a stored pass from a draft playtest. Current draft playtests skip pass persistence.
  const db = new DatabaseSync(databasePath);
  db.prepare("UPDATE rulebook_passes SET payload = json_set(payload, '$.draftPlaytest', json('true')) WHERE room_code = ?")
    .run(playtestCode);
  db.close();

  const client = await listen(t, databasePath);
  const invite = await preview(client(), roomCode);
  assert.equal(invite.status, 200);
  assert.deepEqual(invite.body, {
    status: "closed", format: "claim-the-city", title: claimEdition.title,
  });
  assert.deepEqual((await preview(client(), playtestCode)).body, { status: "closed", format: "hide-and-seek" });
});
