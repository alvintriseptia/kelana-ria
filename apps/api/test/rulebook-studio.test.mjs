import assert from "node:assert/strict";
import { test } from "node:test";
import { createSoloServer } from "../dist/index.js";

const adminEmail = "studio-admin@kelana.test";

async function studioServer(t, adminEmails = []) {
  const server = createSoloServer({
    databasePath: ":memory:",
    adminEmails,
    allowSandboxAuthOtp: true,
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const endpoint = `${baseUrl}/api/rulebooks`;
  const get = (query = "", headers) => fetch(endpoint + query, { headers });
  const post = (body, headers) => fetch(endpoint, {
    method: "POST",
    headers: { ...headers, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const signIn = async (email) => {
    const req = await fetch(`${baseUrl}/api/auth/request-otp`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email }),
    });
    assert.equal(req.status, 200);
    const { challengeId, sandboxCode } = await req.json();
    const ver = await fetch(`${baseUrl}/api/auth/verify-otp`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ challengeId, code: sandboxCode }),
    });
    assert.equal(ver.status, 200);
    return { cookie: ver.headers.get("set-cookie").split(";")[0] };
  };
  return { get, post, signIn };
}

test("rulebook Studio scopes draft ownership and independently authorizes editorial actions", async t => {
  const { get, post, signIn } = await studioServer(t, [adminEmail]);
  const reviewer = await signIn(adminEmail);
  assert.equal((await get("?role=writer")).status, 401);
  const owner = await signIn("studio-owner@kelana.test");
  const outsider = await signIn("studio-outsider@kelana.test");
  const clone = {
    type: "clone-official", templatePackId: "official-jakarta-compact-claim",
    packId: "test-creator-owned", title: "Studio private draft", byline: "Test Creator", priceIdr: 0,
  };
  const creation = await post(clone, owner);
  assert.equal(creation.status, 200);
  const { record } = await creation.json();
  assert.equal(record.ownerHash, undefined);
  assert.equal((await post(clone, outsider)).status, 400);
  assert.equal((await post({ ...clone, packId: clone.templatePackId }, owner)).status, 400);

  const ownerData = await (await get("?role=writer", owner)).json();
  assert.deepEqual(ownerData.versions.map(version => version.packId), [clone.packId]);
  assert.equal(ownerData.versions[0].ownerHash, undefined);
  assert.deepEqual((await (await get("?role=writer", outsider)).json()).versions, []);
  assert.equal((await get("?role=reviewer", owner)).status, 403);
  assert.equal((await get("?role=reviewer")).status, 401);
  assert.deepEqual((await (await get("?role=reviewer", reviewer)).json()).versions, []);

  const copy = structuredClone(record.pack);
  copy.meta.version = 0;
  assert.equal((await post({ type: "save-draft", pack: copy, snapshot: record.snapshot }, outsider)).status, 400);
  assert.equal((await post({ type: "submit-draft", packId: clone.packId, version: 1 }, outsider)).status, 400);
  assert.equal((await post({ type: "submit-draft", packId: clone.packId, version: 1 }, owner)).status, 200);
  assert.equal((await (await get("?role=reviewer", reviewer)).json()).versions[0].status, "submitted");
  for (const type of ["publish-version", "request-changes", "pause-version"]) {
    assert.equal((await post({ type, packId: clone.packId, version: 1 }, owner)).status, 403);
  }
  assert.equal((await post({ type: "publish-version", packId: clone.packId, version: 1 }, reviewer)).status, 200);
  const catalog = await (await get()).json();
  assert.ok(catalog.listings.some(listing => listing.packId === clone.packId));
  assert.equal(catalog.versions, undefined);
  assert.equal(catalog.orders, undefined);
  assert.equal(JSON.stringify(catalog).includes("correctChoiceId"), false);
});

test("rulebook editorial actions require an admin account", async t => {
  const { get, post, signIn } = await studioServer(t);
  const writer = await signIn("studio-noreview@kelana.test");
  assert.equal((await (await get("?role=writer", writer)).json()).isAdmin, false);
  assert.equal((await get("?role=reviewer", writer)).status, 403);
  assert.equal((await post({ type: "publish-version" }, writer)).status, 403);
});

test("delete-draft removes owner draft and changes-requested versions, closes draft playtests, and guards status/ownership", async t => {
  const { get, post, signIn } = await studioServer(t, [adminEmail]);
  const reviewer = await signIn(adminEmail);
  const owner = await signIn("delete-owner@kelana.test");
  const outsider = await signIn("delete-outsider@kelana.test");

  // Draft #1: draft status + open playtest room -> deleted cleanly & playtest room invalidated
  const draft1Res = await post({
    type: "clone-official",
    templatePackId: "official-jakarta-compact-claim",
    packId: "pack-delete-draft-1",
    title: "Draft Delete One",
    byline: "Owner",
    priceIdr: 0,
  }, owner);
  assert.equal(draft1Res.status, 200);
  const playtestRes = await post({
    type: "start-draft-playtest",
    packId: "pack-delete-draft-1",
    version: 1,
    mode: "solo",
  }, owner);
  assert.equal(playtestRes.status, 200);
  const playtestData = await playtestRes.json();
  assert.equal(playtestData.draftPlaytest, true);
  assert.equal((await get(`/rooms/${playtestData.roomCode}`, owner)).status, 200);

  // Outsider rejected with 403
  const outsiderDel = await post({ type: "delete-draft", packId: "pack-delete-draft-1", version: 1 }, outsider);
  assert.equal(outsiderDel.status, 403);
  assert.equal((await outsiderDel.json()).error, "forbidden");

  // Owner deletes draft -> 200 & playtest room closed
  const ownerDel = await post({ type: "delete-draft", packId: "pack-delete-draft-1", version: 1 }, owner);
  assert.equal(ownerDel.status, 200);
  const ownerDelBody = await ownerDel.json();
  assert.deepEqual(ownerDelBody.closedPlaytestRooms, [playtestData.roomCode]);
  assert.equal((await get(`/rooms/${playtestData.roomCode}`, owner)).status, 404);
  assert.equal((await (await get("?role=writer", owner)).json()).versions.some(v => v.packId === "pack-delete-draft-1"), false);

  // Draft #2: submitted -> reject delete (400), request-changes -> allow delete (200)
  assert.equal((await post({
    type: "clone-official",
    templatePackId: "official-jakarta-compact-seek",
    packId: "pack-delete-draft-2",
    title: "Draft Delete Two",
    byline: "Owner",
    priceIdr: 15000,
  }, owner)).status, 200);
  assert.equal((await post({ type: "submit-draft", packId: "pack-delete-draft-2", version: 1 }, owner)).status, 200);
  const delSubmitted = await post({ type: "delete-draft", packId: "pack-delete-draft-2", version: 1 }, owner);
  assert.equal(delSubmitted.status, 400);
  assert.equal((await delSubmitted.json()).error, "invalid-status");

  assert.equal((await post({ type: "request-changes", packId: "pack-delete-draft-2", version: 1, note: "Fix hours" }, reviewer)).status, 200);
  const delChanges = await post({ type: "delete-draft", packId: "pack-delete-draft-2", version: 1 }, owner);
  assert.equal(delChanges.status, 200);

  // Draft #3: published and paused -> reject delete (400 invalid-status)
  assert.equal((await post({
    type: "clone-official",
    templatePackId: "official-jakarta-compact-claim",
    packId: "pack-delete-draft-3",
    title: "Draft Published Three",
    byline: "Owner",
    priceIdr: 0,
  }, owner)).status, 200);
  assert.equal((await post({ type: "submit-draft", packId: "pack-delete-draft-3", version: 1 }, owner)).status, 200);
  assert.equal((await post({ type: "publish-version", packId: "pack-delete-draft-3", version: 1 }, reviewer)).status, 200);
  const delPublished = await post({ type: "delete-draft", packId: "pack-delete-draft-3", version: 1 }, owner);
  assert.equal(delPublished.status, 400);
  assert.equal((await delPublished.json()).error, "invalid-status");

  assert.equal((await post({ type: "pause-version", packId: "pack-delete-draft-3", version: 1, reason: "Seasonal" }, reviewer)).status, 200);
  const delPaused = await post({ type: "delete-draft", packId: "pack-delete-draft-3", version: 1 }, owner);
  assert.equal(delPaused.status, 400);
  assert.equal((await delPaused.json()).error, "invalid-status");
});

test("start-draft-playtest validates drafts, supports Claim & Hide & Seek QA playtests, and enforces strict public isolation", async t => {
  const server = createSoloServer({
    databasePath: ":memory:",
    allowSandboxAuthOtp: true,
    allowHideSeekQa: false,
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const endpoint = `${baseUrl}/api/rulebooks`;
  const get = (query = "", headers) => fetch(endpoint + query, { headers });
  const post = (body, headers) => fetch(endpoint, {
    method: "POST",
    headers: { ...headers, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const signIn = async (email) => {
    const req = await fetch(`${baseUrl}/api/auth/request-otp`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email }),
    });
    const { challengeId, sandboxCode } = await req.json();
    const ver = await fetch(`${baseUrl}/api/auth/verify-otp`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ challengeId, code: sandboxCode }),
    });
    return { cookie: ver.headers.get("set-cookie").split(";")[0] };
  };

  const owner = await signIn("playtest-owner@kelana.test");
  const outsider = await signIn("playtest-outsider@kelana.test");

  // Clone a paid Claim draft and make it invalid first
  const claimClone = await (await post({
    type: "clone-official",
    templatePackId: "official-jakarta-compact-claim",
    packId: "pack-playtest-claim",
    title: "Playtest Claim Draft",
    byline: "Kreator Uji",
    priceIdr: 25000,
  }, owner)).json();
  const brokenPack = structuredClone(claimClone.record.pack);
  brokenPack.session.maxPlayers = 99;
  await post({ type: "save-draft", pack: brokenPack, snapshot: claimClone.record.snapshot, rehashSnapshot: true }, owner);

  // Outsider cannot start playtest (403)
  const outsiderStart = await post({ type: "start-draft-playtest", packId: "pack-playtest-claim", version: 1 }, outsider);
  assert.equal(outsiderStart.status, 403);
  assert.equal((await outsiderStart.json()).error, "forbidden");

  // Invalid draft fails with validation-failed + errors
  const invalidStart = await post({ type: "start-draft-playtest", packId: "pack-playtest-claim", version: 1 }, owner);
  assert.equal(invalidStart.status, 400);
  const invalidBody = await invalidStart.json();
  assert.equal(invalidBody.error, "validation-failed");
  assert.ok(Array.isArray(invalidBody.validation?.errors) && invalidBody.validation.errors.length > 0);

  // Fix draft -> start Claim draft playtest (even though allowHideSeekQa=false and priceIdr=25000!)
  brokenPack.session.maxPlayers = 6;
  await post({ type: "save-draft", pack: brokenPack, snapshot: claimClone.record.snapshot, rehashSnapshot: true }, owner);
  const claimPlay = await post({ type: "start-draft-playtest", packId: "pack-playtest-claim", version: 1, mode: "solo" }, owner);
  assert.equal(claimPlay.status, 200);
  const claimPlayBody = await claimPlay.json();
  assert.equal(claimPlayBody.qa, true);
  assert.equal(claimPlayBody.draftPlaytest, true);
  assert.equal(claimPlayBody.pass.paid, false);
  assert.equal(claimPlayBody.pass.draftPlaytest, true);

  // Verify viewRoom exposes qa + draftPlaytest and simulated qaLocationId + QA clock advance work to finish the match
  const viewClaim = await (await get(`/rooms/${claimPlayBody.roomCode}`, owner)).json();
  assert.equal(viewClaim.qa, true);
  assert.equal(viewClaim.draftPlaytest, true);
  assert.equal((await post({
    type: "room-action",
    roomCode: claimPlayBody.roomCode,
    action: { type: "check-in-start", actionId: "a1", fix: { qaLocationId: viewClaim.publicBoard.startPoint.id } },
  }, owner)).status, 200);
  assert.equal((await post({
    type: "room-action",
    roomCode: claimPlayBody.roomCode,
    action: { type: "ready", actionId: "a2", ready: true },
  }, owner)).status, 200);
  assert.equal((await post({
    type: "room-action",
    roomCode: claimPlayBody.roomCode,
    action: { type: "start", actionId: "a3" },
  }, owner)).status, 200);
  const activeClaim = await (await get(`/rooms/${claimPlayBody.roomCode}`, owner)).json();
  assert.equal(activeClaim.room.phase, "active");
  assert.equal((await post({
    type: "qa-advance",
    roomCode: claimPlayBody.roomCode,
    step: "phase-end",
    actionId: "qa-end-1",
    expectedDeadline: activeClaim.room.deadline,
  }, owner)).status, 200);
  const finishedClaim = await (await get(`/rooms/${claimPlayBody.roomCode}`, owner)).json();
  assert.equal(finishedClaim.room.phase, "finished");

  // Strict isolation: excluded from public catalog listings, activeRooms, entitlements, personal recaps, and sharedRecaps
  const catalog = await (await get("/catalog", owner)).json();
  assert.equal(catalog.editions.some(l => l.packId === "pack-playtest-claim"), false);
  assert.equal(catalog.activeRooms.some(r => r.roomCode === claimPlayBody.roomCode), false);
  assert.equal(catalog.ownedPackIds.includes("pack-playtest-claim"), false);
  assert.equal(catalog.sharedRecaps.some(r => r.packId === "pack-playtest-claim"), false);
  const myRecaps = await (await get("/recaps", owner)).json();
  assert.equal((myRecaps.recaps ?? []).some(r => r.matchId === claimPlayBody.roomCode), false);

  // Also verify Hide & Seek unpublished draft playtest room works cleanly
  const seekClone = await post({
    type: "clone-official",
    templatePackId: "official-jakarta-compact-seek",
    packId: "pack-playtest-seek",
    title: "Playtest Seek Draft",
    byline: "Kreator Uji",
    priceIdr: 30000,
  }, owner);
  assert.equal(seekClone.status, 200);
  const seekPlay = await post({ type: "start-draft-playtest", packId: "pack-playtest-seek", version: 1 }, owner);
  assert.equal(seekPlay.status, 200);
  const seekPlayBody = await seekPlay.json();
  assert.equal(seekPlayBody.format, "hide-and-seek");
  assert.equal(seekPlayBody.qa, true);
  assert.equal(seekPlayBody.draftPlaytest, true);
  assert.equal(seekPlayBody.pass.paid, false);
  const viewSeek = await (await get(`/rooms/${seekPlayBody.roomCode}`, owner)).json();
  assert.equal(viewSeek.qa, true);
  assert.equal(viewSeek.draftPlaytest, true);
});

test("Studio saves unverified content and gates submission and publication on current field evidence", async t => {
  const { get, post, signIn } = await studioServer(t, [adminEmail]);
  const owner = await signIn("field-verification@kelana.test");
  const reviewer = await signIn(adminEmail);
  const packId = "field-verification-claim";
  const clone = await post({
    type: "clone-official", templatePackId: "official-jakarta-compact-claim", packId,
    title: "Field Verification Demo", byline: "Test creator", priceIdr: 0,
  }, owner);
  assert.equal(clone.status, 200);
  const { record: { pack, snapshot } } = await clone.json();
  const landmark = pack.geography.landmarks[0];
  Object.assign(landmark, { source: "osm-curated", osmId: "node/123456", fieldVerified: false });
  const save = () => post({ type: "save-draft", pack, snapshot }, owner);
  const submit = () => post({ type: "submit-draft", packId, version: 1 }, owner);
  const publish = () => post({ type: "publish-version", packId, version: 1 }, reviewer);

  const saved = await save();
  assert.equal(saved.status, 200);
  const body = await saved.json();
  assert.equal(body.record.pack.geography.landmarks[0].fieldVerified, false);
  assert.ok(body.validation.errors.some(issue => issue.code === "unverified-osm-landmark"));
  assert.equal((await submit()).status, 400);
  assert.equal((await publish()).status, 400);
  assert.equal((await (await get()).json()).listings.some(listing => listing.packId === packId), false);

  Object.assign(landmark, {
    fieldVerified: true, fieldVerifiedAt: "2026-11-27", fieldVerificationNote: "Checked the public entrance in person.",
  });
  assert.equal((await (await save()).json()).validation.ok, true);
  assert.equal((await submit()).status, 200);
  assert.equal((await publish()).status, 200);
  assert.ok((await (await get()).json()).listings.some(listing => listing.packId === packId));
});
