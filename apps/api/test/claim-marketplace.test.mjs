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

test("Published custom variants keep review notes and solutions private and reveal learning after a successful check-in", () => {
  const store = api.rulebookStore(":memory:");
  try {
    const creator = "variant-creator";
    const packId = "variant-review-claim";
    const landmarkId = "taman-literasi";
    const draft = store.cloneOfficialTemplate("official-jakarta-compact-claim", creator, {
      packId, title: "Uji varian Taman Literasi", byline: "Uji Studio", priceIdr: 0,
    }, T0);
    assert.ok(draft.ok, draft.error);
    assert.ok(store.submitDraft(creator, packId, 1, T0).ok);
    assert.ok(store.reviewVersion(packId, 1, { action: "publish" }, T0).ok);
    const versionTwo = structuredClone(draft.record.pack);
    versionTwo.meta.version = 2;
    const common = {
      verificationNotes: "Review source fixture: Jakarta Smart City, Plaza Kabaresi archive",
      reviewed: true,
      reviewedAt: "2026-11-23",
      hint: "Bandingkan tinggi dua baris dari sisi panggung.",
      learningExplanation: "Undakan memberi penonton di belakang sudut pandang yang lebih tinggi.",
      estimatedSeconds: 45,
    };
    const variants = [
      {
        ...common,
        id: "undakan",
        title: "Undakan untuk menonton",
        payload: {
          primitive: "observation_mcq",
          prompt: "Susunan mana yang membantu penonton melihat panggung dari belakang?",
          choices: [
            { id: "a", label: "Semua baris sejajar." },
            { id: "b", label: "Baris belakang lebih tinggi." },
            { id: "c", label: "Baris belakang lebih rendah." },
          ],
          correctChoiceId: "b",
        },
      },
      {
        ...common,
        id: "pandangan",
        title: "Pandangan ke panggung",
        estimatedSeconds: 55,
        payload: {
          primitive: "observation_input",
          prompt: "Baris mana yang lebih tinggi saat kamu melihat ke panggung?",
          inputMode: "text",
          acceptedAnswers: ["baris belakang", "belakang"],
        },
      },
    ];
    versionTwo.challenges.landmarkChallenges[landmarkId] = variants;
    const saved = store.saveDraft(creator, versionTwo, draft.record.snapshot, T0 + 1000);
    assert.ok(saved.ok && saved.validation.ok, JSON.stringify(saved.validation?.errors));
    assert.equal(saved.record.version, 2);
    assert.ok(store.submitDraft(creator, packId, 2, T0 + 2000).ok);
    const release = store.reviewVersion(packId, 2, { action: "publish" }, T0 + 3000);
    assert.ok(release.ok, release.error);
    const safe = /correctChoiceId|acceptedAnswers|verificationNotes|Review source fixture/;
    const early = /Bandingkan tinggi dua baris|Undakan memberi penonton/;
    const publicEditions = store.listPublicListings("claim-the-city").filter(listing => listing.packId === packId);
    assert.ok(publicEditions.some(listing => listing.version === 2));
    assert.doesNotMatch(JSON.stringify(publicEditions), safe);
    assert.doesNotMatch(JSON.stringify(publicEditions), early);
    for (const version of [1, 2]) {
      const live = store.createFreeRoomFromRulebook(packId, version, "host", "Pemain A", T0 + 3000, false, "group");
      assert.ok(live.ok, live.error);
      assert.equal(live.pass.version, version);
      const lobby = store.viewRoom(live.roomCode, "host", T0 + 3000);
      assert.equal(lobby.room.ownActiveAttempt, null);
      assert.doesNotMatch(JSON.stringify(lobby), safe);
      assert.doesNotMatch(JSON.stringify(lobby), early);
    }

    const { pack, snapshot } = release.record;
    const landmark = pack.geography.landmarks.find(lm => lm.id === landmarkId);
    const fixAt = ({ latitude, longitude }, timestamp) => ({ latitude, longitude, timestamp, accuracy: 4 });
    for (const [index, variant] of variants.entries()) {
      const match = api.createClaimEngineMatch({
        code: `VARIANT-${index}`, mode: "group", pack, snapshot,
        hostSeatId: "p1", hostName: "Pemain A", hostCredentialHash: "hash-one",
        rngInt: max => index % max,
      });
      assert.ok(api.joinClaimEngineMatch(match, {
        seatId: "p2", name: "Pemain B", credentialHash: "hash-two",
      }).ok);
      let sequence = 0;
      const act = (seat, action, at = T0) =>
        api.applyClaimEngineAction(match, seat, { ...action, actionId: `variant-${++sequence}` }, at);
      for (const id of ["p1", "p2"]) {
        assert.equal(act(id, { type: "check-in-start", fix: fixAt(snapshot.startPoint, T0) }).error, undefined);
        assert.equal(act(id, { type: "ready", ready: true }).error, undefined);
      }
      const started = act("p1", { type: "start" }).room;
      assert.equal(started.phase, "active");
      assert.doesNotMatch(JSON.stringify(started), early);
      const at = T0 + 5000;
      const farAway = { ...landmark, latitude: landmark.latitude + 1 };
      const denied = act("p1", { type: "check-in-landmark", landmarkId, fix: fixAt(farAway, at) }, at);
      assert.ok(denied.error);
      assert.equal(denied.room.ownActiveAttempt, null);
      const opened = act("p1", { type: "check-in-landmark", landmarkId, fix: fixAt(landmark, at) }, at);
      assert.equal(opened.error, undefined);
      assert.equal(opened.room.ownActiveAttempt.challenge.id, variant.id);
      assert.equal(opened.room.ownActiveAttempt.hint, common.hint);
      assert.equal(opened.room.ownLearningExplanation, undefined);
      assert.doesNotMatch(JSON.stringify(opened.room), safe);
      assert.doesNotMatch(JSON.stringify(api.viewClaimEngineMatch(match, "p2", at)), early);
      const submitted = act("p1", {
        type: "submit-challenge", landmarkId,
        ...(index === 0 ? { choiceId: "b" } : { inputValue: "  BARIS   BELAKANG  " }),
      }, at + 1000);
      assert.equal(submitted.error, undefined);
      assert.deepEqual(submitted.room.ownLearningExplanation, { landmarkId, text: common.learningExplanation });
      assert.doesNotMatch(JSON.stringify(api.viewClaimEngineMatch(match, "p2", at + 1000)), early);
    }
  } finally {
    store.close();
  }
});
