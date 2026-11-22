import assert from "node:assert/strict";
import test from "node:test";
import * as api from "../dist/index.js";

const T0 = 1_800_000_000_000;

test("Official Jakarta Compact and Wide Hide & Seek RulebookPacks load from JSON and pass validator with 0 errors", () => {
  const loaded = api.loadOfficialSeekPacks();
  const ids = loaded.map(({ pack }) => pack.meta.packId);
  assert.ok(ids.includes("official-jakarta-compact-seek"));
  assert.ok(ids.includes("official-jakarta-wide-seek"));

  const compact = loaded.find(({ pack }) => pack.meta.packId === "official-jakarta-compact-seek");
  const wide = loaded.find(({ pack }) => pack.meta.packId === "official-jakarta-wide-seek");
  assert.ok(compact && wide);

  const vCompact = api.validateHideSeekRulebook(compact.pack, compact.snapshot);
  assert.equal(vCompact.ok, true);
  assert.equal(vCompact.summary.eligibleAnchorCount, 16);
  assert.equal(vCompact.summary.totalDeckCards, 40);
  assert.equal(vCompact.summary.objectiveQuestionCount + vCompact.summary.photoQuestionCount, 21);
  assert.equal(compact.pack.deck.cards.some((c) => c.effect.primitive === "move_zone"), false);

  const vWide = api.validateHideSeekRulebook(wide.pack, wide.snapshot);
  assert.equal(vWide.ok, true);
  assert.equal(vWide.summary.eligibleAnchorCount, 40);
  assert.equal(vWide.summary.totalDeckCards, 65);
  assert.equal(wide.pack.deck.cards.some((c) => c.effect.primitive === "move_zone"), true);
});

test("Community Hide & Seek pack authoring: clone template, seed GeoSnapshot with overrides, validator gate, publish, Midtrans settlement unlocking 3-player room, idempotent earnings, and pause", async () => {
  const midtrans = api.createRecordedMidtransAdapter();
  const store = api.rulebookStore(":memory:", { midtrans });

  try {
    // 1. Official free packs are listed and launchable immediately without checkout
    const initialListings = store.listPublicListings();
    assert.ok(initialListings.some((l) => l.packId === "official-jakarta-compact-seek" && l.priceIdr === 0));
    const freeRoom = store.createFreeRoomFromRulebook("official-jakarta-compact-seek", 1, "host-free", "Raka", T0);
    assert.equal(freeRoom.ok, true);
    assert.equal(freeRoom.pass.paid, false);

    // 2. Creator clones official Jakarta Compact starter into a paid community pack
    const cloned = store.cloneOfficialTemplate(
      "official-jakarta-compact-seek",
      "creator-1",
      {
        packId: "comm-senopati-night-seek",
        title: "Senopati & Blok M Coffee Seek",
        byline: "Kolektif Selatan",
        priceIdr: 35_000,
      },
      T0 + 1000,
    );
    assert.equal(cloned.ok, true);

    // 3. Creator seeds a frozen GeoSnapshot with a custom station override
    const seededGeo = await store.seedGeoFromOfficialFixture({
      id: "comm-senopati-geo-v1",
      boundaryPolygon: cloned.record.snapshot.boundaryPolygon,
      startPoint: cloned.record.snapshot.startPoint,
      transitModes: ["walk", "mrt", "transjakarta"],
      poiCategories: ["mall", "park", "mrt_station", "monument"],
      overrides: {
        stationPatches: {
          "mrt-blok-m": { accessNotes: "Pintu timur Blok M dekat Taman Literasi (verified creator note)." },
        },
      },
    });
    assert.equal(seededGeo.hash, api.computeGeoSnapshotHash(seededGeo));

    // 4. Automated validator rejects an invalid edit (unbounded photo autoApproveMs > 5 min)
    const badPack = structuredClone(cloned.record.pack);
    badPack.geography.geoSnapshotId = seededGeo.id;
    badPack.geography.geoSnapshotHash = seededGeo.hash;
    badPack.deck.cards.push({
      id: "curse-bad-photo",
      category: "curse",
      copies: 1,
      title: "Bad Photo Curse",
      description: "Exceeds 5 minute anti-grief cap.",
      effect: {
        primitive: "curse",
        curse: {
          castingCosts: [{ type: "none" }],
          blockerType: "block_questions",
          clearCondition: { type: "photo_challenge", prompt: "Snap anything", approvalMode: "opponent_or_timeout", autoApproveMs: 9 * 60_000 },
        },
      },
    });
    const savedBad = store.saveDraft("creator-1", badPack, seededGeo, T0 + 2000);
    assert.equal(savedBad.ok, true);
    assert.equal(savedBad.validation.ok, false);
    const submitBad = store.submitDraft("creator-1", badPack.meta.packId, 1, T0 + 3000);
    assert.equal(submitBad.ok, false);
    assert.equal(submitBad.error, "validation-failed");

    // 5. Fix curse cap, submit, request changes, revise, submit & publish
    const goodPack = structuredClone(badPack);
    goodPack.deck.cards.at(-1).effect.curse.clearCondition.autoApproveMs = 3 * 60_000;
    const savedGood = store.saveDraft("creator-1", goodPack, seededGeo, T0 + 4000);
    assert.equal(savedGood.ok, true);
    assert.equal(savedGood.validation.ok, true);
    assert.equal(store.submitDraft("creator-1", goodPack.meta.packId, 1, T0 + 5000).ok, true);
    assert.equal(store.reviewVersion(goodPack.meta.packId, 1, { action: "request-changes", note: "Clarify station note" }, T0 + 6000).ok, true);
    assert.equal(store.submitDraft("creator-1", goodPack.meta.packId, 1, T0 + 7000).ok, true);
    assert.equal(store.reviewVersion(goodPack.meta.packId, 1, { action: "publish" }, T0 + 8000).ok, true);

    // 6. Paid pack rejects free room launch; host purchases via Midtrans and settles
    assert.equal(store.createFreeRoomFromRulebook(goodPack.meta.packId, 1, "buyer-1", "Host", T0 + 9000).error, "payment-required");
    const orderRes = await store.createOrder("buyer-1", goodPack.meta.packId, 1, T0 + 10_000);
    assert.equal(orderRes.ok, true);

    const settled1 = await store.settleVerifiedOrder(
      orderRes.order.orderId,
      "buyer-1",
      "Host",
      { transaction_status: "settlement", status_code: "200", gross_amount: "35000.00", currency: "IDR" },
      T0 + 15_000,
    );
    assert.equal(settled1.ok, true);
    assert.equal(settled1.duplicate, false);
    assert.ok(settled1.pass?.roomCode);

    // Duplicate webhook / retry is idempotent: 1 pass, 1 room, 1 earnings entry!
    const settled2 = await store.settleVerifiedOrder(orderRes.order.orderId, "buyer-1", "Host", undefined, T0 + 16_000);
    assert.equal(settled2.ok, true);
    assert.equal(settled2.duplicate, true);
    assert.equal(store.listEarnings().length, 1);
    assert.equal(store.listEarnings()[0].grossAmountIdr, 35_000);
    assert.equal(store.listEarnings()[0].creatorShareIdr, 29_750);

    // 7. 3 players join the paid room under the single host pass!
    const roomCode = settled1.pass.roomCode;
    assert.equal(store.joinRoom(roomCode, "guest-2", "Player 2", T0 + 17_000).ok, true);
    assert.equal(store.joinRoom(roomCode, "guest-3", "Player 3", T0 + 18_000).ok, true);
    const roomView = store.viewRoom(roomCode, "buyer-1", T0 + 19_000);
    assert.equal(roomView.room.seats.length, 3);

    // 8. Pausing the pack stops new orders while keeping active room & earnings intact
    assert.equal(store.reviewVersion(goodPack.meta.packId, 1, { action: "pause", reason: "Station renovation" }, T0 + 20_000).ok, true);
    assert.equal((await store.createOrder("buyer-2", goodPack.meta.packId, 1, T0 + 21_000)).error, "pack-unavailable");
    assert.equal(store.viewRoom(roomCode, "buyer-1", T0 + 22_000).room.seats.length, 3);
    assert.equal(store.listEarnings().length, 1);
  } finally {
    store.close();
  }
});
