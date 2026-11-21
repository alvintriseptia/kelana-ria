import assert from "node:assert/strict";
import test from "node:test";
import * as api from "../dist/index.js";

const initialTime = 1_800_000_000_000;

async function listen(context, options = {}) {
  const server = api.createSoloServer({
    databasePath: ":memory:",
    now: () => initialTime,
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
    post: (type, fields = {}, queryRole = role) =>
      request(`/api/packs?role=${queryRole}`, {
        type,
        actionId: `pack-action-${role}-${++nextAction}`,
        ...fields,
      }),
    get cookie() {
      return cookie;
    },
  };
}

test("writer draft revision, reviewer correction request, and publication list only the approved version with byline and hidden answer keys (A28, §8.1)", async (context) => {
  const { url } = await listen(context);
  const writer = packClient(url, "writer");
  const reviewer = packClient(url, "reviewer");
  const publicHost = packClient(url, "public");

  await writer.get();
  await reviewer.get();
  const initialPublic = await publicHost.get();
  assert.deepEqual(initialPublic.listings, []);
  assert.equal(initialPublic.versions, undefined);

  // 1. Writer saves draft v1 and submits it.
  const savedV1 = await writer.post("save-draft", {
    draft: api.defaultCreatorDraft,
  });
  assert.equal(savedV1.status, 200);
  assert.equal(savedV1.versions.length, 1);
  assert.equal(savedV1.versions[0].version, 1);
  assert.equal(savedV1.versions[0].status, "draft");
  assert.deepEqual((await publicHost.get()).listings, [], "Draft v1 must stay private");

  const submittedV1 = await writer.post("submit-draft", {
    packId: "pack-selatan-compact",
    version: 1,
  });
  assert.equal(submittedV1.status, 200);
  assert.equal(submittedV1.versions[0].status, "submitted");
  assert.deepEqual((await publicHost.get()).listings, [], "Submitted v1 must not be listed before approval");

  // 2. Reviewer requests a correction on v1.
  const returnedV1 = await reviewer.post("request-changes", {
    packId: "pack-selatan-compact",
    version: 1,
    note: "Perjelas patokan pengamatan di pintu timur dan cantumkan jam akses.",
  });
  assert.equal(returnedV1.status, 200);
  assert.equal(returnedV1.versions[0].status, "changes-requested");
  assert.match(returnedV1.versions[0].reviewNote, /Perjelas patokan/);
  assert.deepEqual((await publicHost.get()).listings, [], "Returned v1 must not be listed");

  // 3. Writer revises the returned submission (creating v2) and resubmits.
  const revisedDraft = structuredClone(api.defaultCreatorDraft);
  revisedDraft.tasks[0].verificationNotes =
    "Diverifikasi ulang di lokasi: balkon utara amfiteater buka pukul 07.00–22.00 WIB dari pintu barat MRT Blok M.";
  const savedV2 = await writer.post("save-draft", { draft: revisedDraft });
  assert.equal(savedV2.status, 200);
  assert.equal(savedV2.versions.length, 2);
  assert.equal(savedV2.versions[0].version, 1);
  assert.equal(savedV2.versions[0].status, "changes-requested");
  assert.equal(savedV2.versions[1].version, 2);
  assert.equal(savedV2.versions[1].status, "draft");

  const submittedV2 = await writer.post("submit-draft", {
    packId: "pack-selatan-compact",
    version: 2,
  });
  assert.equal(submittedV2.status, 200);
  assert.equal(submittedV2.versions[1].status, "submitted");

  // 4. Reviewer publishes v2 after validation passes.
  const publishedV2 = await reviewer.post("publish-version", {
    packId: "pack-selatan-compact",
    version: 2,
  });
  assert.equal(publishedV2.status, 200);
  assert.equal(publishedV2.versions[1].status, "published");

  // 5. Public view lists ONLY v2, credits the writer, and hides private answer keys and prompts.
  const listedPublic = await publicHost.get();
  assert.equal(listedPublic.listings.length, 1);
  const listing = listedPublic.listings[0];
  assert.equal(listing.packId, "pack-selatan-compact");
  assert.equal(listing.version, 2);
  assert.equal(listing.byline, "Raka Pratama · Kolektif Jelajah Selatan");
  assert.equal(listing.title, "Jejak Transit Kebayoran & Senayan");
  assert.equal(listing.priceIdr, 25_000);
  assert.equal(listing.startName, "CSW–ASEAN");
  assert.deepEqual(listing.supportedPlayers, [1, 2]);
  assert.equal(listing.checkpoints.length, 6);
  assert.equal(listedPublic.versions, undefined);
  assert.doesNotMatch(
    JSON.stringify(listedPublic),
    /correctChoice|answerKey|verificationNotes|question|choices/i,
  );

  // 6. Writer starts an unapproved draft v3; public listing still shows ONLY approved v2.
  const draftV3 = structuredClone(revisedDraft);
  draftV3.title = "Jejak Transit Kebayoran & Senayan (Edisi Sore Draft)";
  const savedV3 = await writer.post("save-draft", { draft: draftV3 });
  assert.equal(savedV3.status, 200);
  assert.equal(savedV3.versions.length, 3);
  assert.equal(savedV3.versions[2].version, 3);
  assert.equal(savedV3.versions[2].status, "draft");

  const publicAfterV3Draft = await publicHost.get();
  assert.equal(publicAfterV3Draft.listings.length, 1);
  assert.equal(publicAfterV3Draft.listings[0].version, 2);
  assert.equal(publicAfterV3Draft.listings[0].title, "Jejak Transit Kebayoran & Senayan");
});

test("roles and edition checks are strictly enforced across writer, reviewer, and public actors (§8.1, A28)", async (context) => {
  const { url } = await listen(context);
  const writer = packClient(url, "writer");
  const secondWriter = packClient(url, "writer");
  const reviewer = packClient(url, "reviewer");
  const publicHost = packClient(url, "public");

  await writer.get();
  await secondWriter.get();
  await reviewer.get();
  await publicHost.get();

  // Public cannot save drafts or review.
  assert.equal(
    (await publicHost.post("save-draft", { draft: api.defaultCreatorDraft })).status,
    403,
  );
  assert.equal(
    (await publicHost.post("publish-version", { packId: "pack-selatan-compact", version: 1 })).status,
    403,
  );

  // Reviewer cannot author or submit writer drafts.
  assert.equal(
    (await reviewer.post("save-draft", { draft: api.defaultCreatorDraft })).status,
    403,
  );

  // Writer saves and submits v1, then attempts to self-publish or request changes (even with ?role=reviewer query).
  await writer.post("save-draft", { draft: api.defaultCreatorDraft });
  await writer.post("submit-draft", { packId: "pack-selatan-compact", version: 1 });
  const selfPublish = await writer.post(
    "publish-version",
    { packId: "pack-selatan-compact", version: 1 },
    "reviewer",
  );
  assert.equal(selfPublish.status, 403);
  assert.equal(selfPublish.error, "forbidden-role");

  // Another writer cannot hijack pack-selatan-compact.
  const hijack = await secondWriter.post("save-draft", {
    draft: api.defaultCreatorDraft,
  });
  assert.equal(hijack.status, 403);
  assert.equal(hijack.error, "forbidden-pack-owner");

  // Pack failing official board/edition checks (e.g. only 1 zone or only 4 checkpoints with 0 unvisited alternatives) cannot be published.
  const oneZoneDraft = {
    ...api.defaultCreatorDraft,
    packId: "pack-one-zone",
    tasks: api.defaultCreatorTasks.slice(0, 4),
  };
  await secondWriter.post("save-draft", { draft: oneZoneDraft });
  await secondWriter.post("submit-draft", { packId: "pack-one-zone", version: 1 });
  const rejectedOneZone = await reviewer.post("publish-version", {
    packId: "pack-one-zone",
    version: 1,
  });
  assert.equal(rejectedOneZone.status, 409);
  assert.equal(rejectedOneZone.error, "insufficient-zones");

  const fourTotalDraft = {
    ...api.defaultCreatorDraft,
    packId: "pack-too-small",
    tasks: [
      api.defaultCreatorTasks[0],
      api.defaultCreatorTasks[1],
      api.defaultCreatorTasks[4],
      api.defaultCreatorTasks[5],
    ],
  };
  await secondWriter.post("save-draft", { draft: fourTotalDraft });
  await secondWriter.post("submit-draft", { packId: "pack-too-small", version: 1 });
  const rejectedPublish = await reviewer.post("publish-version", {
    packId: "pack-too-small",
    version: 1,
  });
  assert.equal(rejectedPublish.status, 409);
  assert.equal(rejectedPublish.error, "requires-all-landmarks");
  assert.deepEqual((await publicHost.get()).listings, []);
});

test("reviewer can pause sales after a confirmed closure while existing orders remain visible for support and creator earnings (A31)", async (context) => {
  const { url } = await listen(context);
  const writer = packClient(url, "writer");
  const reviewer = packClient(url, "reviewer");
  const buyer = packClient(url, "public");

  await writer.get();
  await reviewer.get();
  await buyer.get();

  await writer.post("save-draft", { draft: api.defaultCreatorDraft });
  await writer.post("submit-draft", { packId: "pack-selatan-compact", version: 1 });
  await reviewer.post("publish-version", { packId: "pack-selatan-compact", version: 1 });

  // 1. Buyer completes one sandbox order on published v1.
  const ordered = await buyer.post("create-order", {
    packId: "pack-selatan-compact",
    version: 1,
    players: 2,
  });
  assert.equal(ordered.status, 200);
  assert.equal(ordered.orders.length, 1);
  assert.equal(ordered.orders[0].orderId, "ord-sandbox-1");
  assert.equal(ordered.orders[0].grossAmountIdr, 25_000);
  assert.equal(ordered.orders[0].platformFeeIdr, 3_750);
  assert.equal(ordered.orders[0].creatorShareIdr, 21_250);
  assert.equal(ordered.orders[0].sandbox, true);

  // 2. Player reports a closure on Taman Literasi; reviewer sees the closure report and pauses v1 sales.
  const reported = await buyer.post("report-closure", {
    packId: "pack-selatan-compact",
    version: 1,
    checkpointId: "taman-literasi",
    reason: "Balkon amfiteater Taman Literasi ditutup karena pekerjaan panggung.",
  });
  assert.equal(reported.status, 200);

  const reviewerBeforePause = await reviewer.get();
  assert.equal(reviewerBeforePause.closures.length, 1);
  assert.equal(reviewerBeforePause.closures[0].checkpointId, "taman-literasi");

  const paused = await reviewer.post("pause-version", {
    packId: "pack-selatan-compact",
    version: 1,
    reason: "Penutupan terkonfirmasi di balkon amfiteater Taman Literasi.",
  });
  assert.equal(paused.status, 200);
  assert.equal(paused.versions[0].status, "paused");
  assert.deepEqual(paused.listings, [], "Paused version is removed from active sales listings");

  // 3. New orders on the paused version are stopped.
  const newOrderBlocked = await buyer.post("create-order", {
    packId: "pack-selatan-compact",
    version: 1,
    players: 1,
  });
  assert.equal(newOrderBlocked.status, 409);
  assert.equal(newOrderBlocked.error, "sales-paused");

  // 4. Existing orders remain visible for buyer support, reviewer support, and writer earnings reconciliation.
  const buyerAfterPause = await buyer.get();
  assert.equal(buyerAfterPause.orders.length, 1);
  assert.equal(buyerAfterPause.orders[0].orderId, "ord-sandbox-1");
  assert.match(buyerAfterPause.orders[0].supportNote, /Penjualan v1 dijeda/);

  const writerAfterPause = await writer.get();
  assert.equal(writerAfterPause.orders.length, 1);
  assert.equal(writerAfterPause.orders[0].orderId, "ord-sandbox-1");
  assert.equal(writerAfterPause.orders[0].creatorShareIdr, 21_250);

  const reviewerAfterPause = await reviewer.get();
  assert.equal(reviewerAfterPause.orders.length, 1);
  assert.equal(reviewerAfterPause.orders[0].orderId, "ord-sandbox-1");
});
