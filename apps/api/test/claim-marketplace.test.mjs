import assert from "node:assert/strict";
import test from "node:test";
import * as api from "../dist/index.js";

const T0 = 1_800_000_000_000;

test("Official Jakarta Compact and Wide Claim the City RulebookPacks load from JSON and pass validator with 0 errors", () => {
  const loaded = api.loadOfficialClaimPacks();
  const ids = loaded.map(({ pack }) => pack.meta.packId);
  assert.ok(ids.includes("official-jakarta-compact-claim"));
  assert.ok(ids.includes("official-jakarta-wide-claim"));

  const compact = loaded.find(({ pack }) => pack.meta.packId === "official-jakarta-compact-claim");
  const wide = loaded.find(({ pack }) => pack.meta.packId === "official-jakarta-wide-claim");
  assert.ok(compact && wide);

  const vCompact = api.validateClaimRulebook(compact.pack, compact.snapshot);
  assert.equal(vCompact.ok, true);
  assert.equal(vCompact.summary.zoneCount, 4);
  assert.equal(vCompact.summary.landmarkCount, 10);
  assert.equal(vCompact.summary.totalDeckCards, 12);
  assert.equal(compact.pack.tacticalDeck.cards.some((c) => c.effect.primitive === "sabotage_curse"), false);

  const vWide = api.validateClaimRulebook(wide.pack, wide.snapshot);
  assert.equal(vWide.ok, true);
  assert.equal(vWide.summary.zoneCount, 6);
  assert.equal(vWide.summary.landmarkCount, 17);
  assert.equal(vWide.summary.totalDeckCards, 20);
  assert.equal(wide.pack.tacticalDeck.cards.some((c) => c.effect.primitive === "sabotage_curse"), true);
});

test("Unified Claim RulebookPack marketplace: clone official template, custom photo_proof challenge, validator gate, Midtrans settlement unlocking Solo & 3-player paid Claim rooms without leaking answers", async () => {
  const midtrans = api.createRecordedMidtransAdapter();
  const store = api.rulebookStore(":memory:", { midtrans });

  try {
    // Public Claim listings expose zones & primitive types, NEVER private answer keys
    const claimListings = store.listPublicListings("claim-the-city");
    assert.ok(claimListings.length >= 2);
    assert.equal(JSON.stringify(claimListings).includes("correctChoiceId"), false);
    assert.equal(JSON.stringify(claimListings).includes("acceptedAnswers"), false);

    // Clone official Jakarta Compact Claim into a paid creator pack
    const cloned = store.cloneOfficialTemplate(
      "official-jakarta-compact-claim",
      "claim-creator-1",
      {
        packId: "comm-blok-m-kuliner-claim",
        title: "Blok M & Senayan Culinary Claim",
        byline: "Jejak Rasa Jakarta",
        priceIdr: 25_000,
      },
      T0 + 1000,
    );
    assert.equal(cloned.ok, true);
    assert.equal(cloned.record.format, "claim-the-city");

    // Add a custom photo_proof challenge with invalid autoApproveMs > 3 min -> validator rejects submit
    const badPack = structuredClone(cloned.record.pack);
    badPack.challenges.landmarkChallenges["m-bloc"] = [
      {
        id: "cust-mbloc-photo",
        title: "Mural Kopi M Bloc",
        verificationNotes: "Terlihat dari trotoar depan Jl. Panglima Polim.",
        reviewed: true,
        reviewedAt: "2026-11-22",
        payload: {
          primitive: "photo_proof",
          prompt: "Foto papan nama M Bloc Space dari trotoar luar.",
          verificationMode: "rival_or_timeout",
          autoApproveMs: 8 * 60_000,
        },
      },
    ];
    const saveBad = store.saveDraft("claim-creator-1", badPack, cloned.record.snapshot, T0 + 2000);
    assert.equal(saveBad.ok, true);
    assert.equal(saveBad.validation.ok, false);
    assert.equal(store.submitDraft("claim-creator-1", badPack.meta.packId, 1, T0 + 3000).error, "validation-failed");

    // Fix autoApproveMs to 2 min -> submit & publish!
    const goodPack = structuredClone(badPack);
    goodPack.challenges.landmarkChallenges["m-bloc"][0].payload.autoApproveMs = 2 * 60_000;
    assert.equal(store.saveDraft("claim-creator-1", goodPack, cloned.record.snapshot, T0 + 4000).validation.ok, true);
    assert.equal(store.submitDraft("claim-creator-1", goodPack.meta.packId, 1, T0 + 5000).ok, true);
    assert.equal(store.reviewVersion(goodPack.meta.packId, 1, { action: "publish" }, T0 + 6000).ok, true);

    // Order 1: Solo paid Claim room
    const ordSolo = await store.createOrder("solo-buyer", goodPack.meta.packId, 1, T0 + 7000);
    assert.equal(ordSolo.ok, true);
    const setSolo = await store.settleVerifiedOrder(
      ordSolo.order.orderId,
      "solo-buyer",
      "Solo Host",
      { transaction_status: "settlement", status_code: "200", gross_amount: "25000.00", currency: "IDR" },
      T0 + 8000,
    );
    assert.equal(setSolo.ok, true);
    assert.equal(setSolo.pass.format, "claim-the-city");
    const soloView = store.viewRoom(setSolo.pass.roomCode, "solo-buyer", T0 + 9000);
    assert.equal(soloView.format, "claim-the-city");
    assert.equal(soloView.room.isSolo, true);

    // Order 2: 3-player paid Claim room under single host pass + idempotent webhook retry
    const ordGroup = await store.createOrder("group-host", goodPack.meta.packId, 1, T0 + 10_000);
    assert.equal(ordGroup.ok, true);
    const setGroup = await store.settleVerifiedOrder(
      ordGroup.order.orderId,
      "group-host",
      "Host",
      { transaction_status: "settlement", status_code: "200", gross_amount: "25000.00", currency: "IDR" },
      T0 + 11_000,
    );
    assert.equal(setGroup.ok, true);
    const dupGroup = await store.settleVerifiedOrder(ordGroup.order.orderId, "group-host", "Host", undefined, T0 + 12_000);
    assert.equal(dupGroup.duplicate, true);
    assert.equal(store.listEarnings().length, 2);

    assert.equal(store.joinRoom(setGroup.pass.roomCode, "p2", "Player 2", T0 + 13_000).ok, true);
    assert.equal(store.joinRoom(setGroup.pass.roomCode, "p3", "Player 3", T0 + 14_000).ok, true);
    const groupView = store.viewRoom(setGroup.pass.roomCode, "group-host", T0 + 15_000);
    assert.equal(groupView.room.seats.length, 3);
    assert.equal(groupView.room.isSolo, false);
  } finally {
    store.close();
  }
});
