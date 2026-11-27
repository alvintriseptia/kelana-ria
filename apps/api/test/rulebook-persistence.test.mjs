import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import sharp from "sharp";
import * as api from "../dist/index.js";
import { TEST_ADMIN } from "./auth-client.mjs";

const T0 = 1_800_000_000_000;
let seq = 0;

const fixAt = (point, timestamp) => ({
  latitude: point.latitude,
  longitude: point.longitude,
  accuracy: 8,
  timestamp,
});

function act(store, roomCode, cred, at, action) {
  const reply = store.actInRoom(roomCode, cred, { actionId: `pers-${++seq}`, ...action }, at);
  assert.equal(reply.error, undefined, `Action failed: ${JSON.stringify(action)} -> ${JSON.stringify(reply)}`);
  return reply;
}

async function sampleJpegBase64() {
  const buf = await sharp({ create: { width: 16, height: 12, channels: 3, background: "#2b6cb0" } })
    .withExifMerge({ IFD3: { GPSLatitudeRef: "S", GPSLatitude: "6/1 12/1 0/1" } })
    .jpeg()
    .toBuffer();
  return buf.toString("base64");
}

test("rulebookStore configures SQLite WAL mode, busy_timeout=5000, secure_delete=ON, and foreign_keys=ON", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "kelana-rb-wal-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const dbPath = join(dir, "rulebooks.sqlite");

  const store = api.rulebookStore(dbPath, { now: () => T0 });
  try {
    const inspect = new DatabaseSync(dbPath, { timeout: 5000 });
    try {
      const mode = inspect.prepare("PRAGMA journal_mode").get();
      assert.equal(String(mode.journal_mode).toLowerCase(), "wal");
      // Concurrent writer/reader on a second connection succeeds cleanly under WAL + timeout.
      const count = inspect.prepare("SELECT count(*) AS count FROM rulebook_versions").get();
      assert.ok(count.count > 0);
    } finally {
      inspect.close();
    }
    // Verify busy_timeout and foreign_keys / secure_delete by checking behavior through a store room + photo cascade.
    const listing = store.listPublicListings("claim-the-city")[0];
    const created = store.createFreeRoomFromRulebook(listing.packId, listing.version, "host-wal", "Host", T0, false, "solo");
    assert.equal(created.ok, true);

    const inspect2 = new DatabaseSync(dbPath, { timeout: 5000 });
    try {
      const liveRow = inspect2.prepare("SELECT room_code, format, state_rev FROM rulebook_live_rooms WHERE room_code = ?").get(created.roomCode);
      assert.equal(liveRow.room_code, created.roomCode);
      assert.equal(liveRow.format, "claim-the-city");
      assert.equal(liveRow.state_rev, 1);
    } finally {
      inspect2.close();
    }
  } finally {
    store.close();
  }
});

test("Claim the City solo & group rooms, catalogRooms idempotency, photos, and activity survive restart and purge photos on expiry/completion", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "kelana-rb-claim-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const dbPath = join(dir, "rulebooks.sqlite");
  const photoBase64 = await sampleJpegBase64();

  const hostSolo = "solo-host-cred-0001";
  const hostGroup = "group-host-cred-0001";
  const guestGroup = "group-guest-cred-0002";
  const soloReqId = "req-solo-persist-0001";
  const groupReqId = "req-group-persist-0001";

  let soloCode;
  let groupCode;
  let photoId;
  let photoAutoApproveAt;
  let groupDeadline;
  let soloDeadline;
  let priorGuestActivitySeq;
  let priorStateRev;
  let photoLandmarkId;

  // Phase 1: Create and play solo + group Claim matches, submit rival-reviewed photo, then stop store
  {
    const store = api.rulebookStore(dbPath, { now: () => T0 });
    try {
      // Clone official Claim pack into a creator pack with a known photo challenge + quiz challenge for deterministic testing
      const officialClaim = store.listPublicListings("claim-the-city").find((l) => l.packId === "official-jakarta-compact-claim");
      assert.ok(officialClaim);

      // Start solo room using official free pack with requestId to verify catalogRooms persistence
      const soloCreated = store.createFreeRoomFromRulebook(
        officialClaim.packId, officialClaim.version, hostSolo, "Solo Host", T0, false, "solo", soloReqId,
      );
      assert.equal(soloCreated.ok, true);
      soloCode = soloCreated.roomCode;
      const soloStartPoint = store.viewRoom(soloCode, hostSolo, T0).publicBoard.startPoint;
      act(store, soloCode, hostSolo, T0 + 1000, { type: "check-in-start", fix: fixAt(soloStartPoint, T0 + 1000) });
      act(store, soloCode, hostSolo, T0 + 1500, { type: "ready", ready: true });
      const soloStarted = act(store, soloCode, hostSolo, T0 + 2000, { type: "start" });
      soloDeadline = soloStarted.room.deadline;
      assert.equal(soloStarted.room.phase, "active");

      // Start group room on official free pack
      const groupCreated = store.createFreeRoomFromRulebook(
        officialClaim.packId, officialClaim.version, hostGroup, "Host Tim A", T0, false, "group", groupReqId,
      );
      assert.equal(groupCreated.ok, true);
      groupCode = groupCreated.roomCode;
      assert.equal(store.joinRoom(groupCode, guestGroup, "Rival Tim B", T0 + 500).ok, true);
      const groupView0 = store.viewRoom(groupCode, hostGroup, T0 + 1000);
      const groupStartPoint = groupView0.publicBoard.startPoint;
      for (const cred of [hostGroup, guestGroup]) {
        act(store, groupCode, cred, T0 + 1000, { type: "check-in-start", fix: fixAt(groupStartPoint, T0 + 1000) });
        act(store, groupCode, cred, T0 + 1500, { type: "ready", ready: true });
      }
      const groupStarted = act(store, groupCode, hostGroup, T0 + 2000, { type: "start" });
      groupDeadline = groupStarted.room.deadline;
      assert.equal(groupStarted.room.phase, "active");

      // Find a landmark whose assigned challenge uses photo_proof (or create a custom free published pack if needed)
      // Check each landmark by checking in with hostGroup until we find one with photo_proof or inspect via pack record
      const record = store.listAllVersions().find((r) => r.packId === officialClaim.packId && r.version === officialClaim.version);
      const photoLm = record.pack.geography.landmarks.find((lm) =>
        (record.pack.challenges.landmarkChallenges[lm.id] ?? []).every((c) => c.payload.primitive === "photo_proof"),
      );
      assert.ok(photoLm, "Official Claim pack should have at least one photo_proof landmark");
      photoLandmarkId = photoLm.id;

      // Host checks in at the photo_proof landmark (using slightly offset coordinates to verify raw GPS isn't stored!)
      const checkInAt = T0 + 10_000;
      const rawHostFix = { latitude: photoLm.latitude + 0.0000123, longitude: photoLm.longitude - 0.0000123, accuracy: 7, timestamp: checkInAt };
      act(store, groupCode, hostGroup, checkInAt, { type: "check-in-landmark", landmarkId: photoLandmarkId, fix: rawHostFix });
      const photoSubmit = await store.submitClaimPhoto(
        groupCode, hostGroup, "claim-photo-action-1", photoBase64, { landmarkId: photoLandmarkId }, () => checkInAt + 1000,
      );
      assert.equal(photoSubmit.error, undefined);

      const rivalView = store.viewRoom(groupCode, guestGroup, checkInAt + 2000);
      assert.equal(rivalView.room.pendingRivalPhotoReviews.length, 1);
      photoId = rivalView.room.pendingRivalPhotoReviews[0].photoId;
      photoAutoApproveAt = rivalView.room.pendingRivalPhotoReviews[0].autoApproveAt;
      priorGuestActivitySeq = rivalView.activity.sequence;
      assert.ok(priorGuestActivitySeq >= 1);

      // Verify raw check-in coordinates are NOT persisted anywhere in rulebook_live_rooms!
      const inspect = new DatabaseSync(dbPath, { timeout: 5000 });
      try {
        const row = inspect.prepare("SELECT state_rev, payload FROM rulebook_live_rooms WHERE room_code = ?").get(groupCode);
        priorStateRev = row.state_rev;
        assert.ok(priorStateRev > 1);
        assert.equal(row.payload.includes(String(rawHostFix.latitude)), false);
        assert.equal(row.payload.includes(String(rawHostFix.longitude)), false);
        const photoCount = inspect.prepare("SELECT count(*) AS count FROM rulebook_room_photos WHERE room_code = ?").get(groupCode).count;
        assert.equal(photoCount, 1);
      } finally {
        inspect.close();
      }
    } finally {
      store.close();
    }
  }

  // Phase 2: Restart rulebookStore against the exact same SQLite file!
  {
    const restarted = api.rulebookStore(dbPath, { now: () => T0 + 15_000 });
    try {
      // 1. catalogRooms idempotency survives restart
      const officialClaim = restarted.listPublicListings("claim-the-city").find((l) => l.packId === "official-jakarta-compact-claim");
      const retrySolo = restarted.createFreeRoomFromRulebook(
        officialClaim.packId, officialClaim.version, hostSolo, "Solo Host", T0 + 15_000, false, "solo", soloReqId,
      );
      assert.equal(retrySolo.ok, true);
      assert.equal(retrySolo.roomCode, soloCode, "catalogRooms idempotency must survive restart");

      const retryGroup = restarted.createFreeRoomFromRulebook(
        officialClaim.packId, officialClaim.version, hostGroup, "Host Tim A", T0 + 15_000, false, "group", groupReqId,
      );
      assert.equal(retryGroup.ok, true);
      assert.equal(retryGroup.roomCode, groupCode);

      // 2. Solo room state & deadline survive restart
      const soloView = restarted.viewRoom(soloCode, hostSolo, T0 + 15_000);
      assert.ok(soloView);
      assert.equal(soloView.room.phase, "active");
      assert.equal(soloView.room.deadline, soloDeadline);
      assert.equal(soloView.room.isSolo, true);

      // 3. Group room seats, deadline, pending photo review, photo BLOB, and activity notices survive restart
      const rivalView = restarted.viewRoom(groupCode, guestGroup, T0 + 15_000);
      assert.ok(rivalView);
      assert.equal(rivalView.room.phase, "active");
      assert.equal(rivalView.room.deadline, groupDeadline);
      assert.equal(rivalView.room.seats.length, 2);
      assert.equal(rivalView.room.pendingRivalPhotoReviews.length, 1);
      assert.equal(rivalView.room.pendingRivalPhotoReviews[0].photoId, photoId);
      assert.equal(rivalView.activity.sequence, priorGuestActivitySeq);

      // Retrieve sanitized photo BLOB after restart (and verify EXIF GPS was stripped!)
      const photoBytes = restarted.viewRoomPhoto(groupCode, guestGroup, photoId, T0 + 15_000);
      assert.ok(Buffer.isBuffer(photoBytes) && photoBytes.length > 0);
      const meta = await sharp(photoBytes).metadata();
      assert.equal(meta.format, "jpeg");
      assert.equal(meta.exif, undefined);

      // 4. Advance clock past photo autoApproveAt -> photo expires/auto-approves and is purged from rulebook_room_photos!
      const afterAutoApprove = restarted.viewRoom(groupCode, hostGroup, photoAutoApproveAt + 1000);
      const updatedLandmark = afterAutoApprove.room.landmarks.find((lm) => lm.landmarkId === photoLandmarkId);
      assert.ok(updatedLandmark);
      assert.ok(updatedLandmark.status === "claimed" || updatedLandmark.status === "locked");
      assert.ok(updatedLandmark.ownerTeamId !== null);
      assert.equal(restarted.viewRoomPhoto(groupCode, guestGroup, photoId, photoAutoApproveAt + 1000), undefined);

      const inspectAfterExpiry = new DatabaseSync(dbPath, { timeout: 5000 });
      try {
        const photoCount = inspectAfterExpiry.prepare("SELECT count(*) AS count FROM rulebook_room_photos WHERE room_code = ?").get(groupCode).count;
        assert.equal(photoCount, 0, "Expired/auto-approved Claim photo must be purged from rulebook_room_photos");
        const row = inspectAfterExpiry.prepare("SELECT state_rev FROM rulebook_live_rooms WHERE room_code = ?").get(groupCode);
        assert.ok(row.state_rev > priorStateRev, "stateRev must increase on photo auto-approval expiry");
      } finally {
        inspectAfterExpiry.close();
      }

      // 5. Complete solo room -> removed from rulebook_live_rooms cleanly while recap persists
      const soloFinished = restarted.viewRoom(soloCode, hostSolo, soloDeadline + 1000);
      assert.equal(soloFinished.room.phase, "finished");
      assert.ok(restarted.readRecap(soloCode, hostSolo));

      const inspectAfterFinish = new DatabaseSync(dbPath, { timeout: 5000 });
      try {
        const liveSolo = inspectAfterFinish.prepare("SELECT 1 FROM rulebook_live_rooms WHERE room_code = ?").get(soloCode);
        assert.equal(liveSolo, undefined, "Finished room should be cleared from rulebook_live_rooms");
      } finally {
        inspectAfterFinish.close();
      }
    } finally {
      restarted.close();
    }
  }
});

test("Hide & Seek room survives restart mid-match with locked anchor, private hand/curses, clues, photo BLOB, QA clock offset, and purges photos on completion", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "kelana-rb-seek-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const dbPath = join(dir, "rulebooks.sqlite");
  const photoBase64 = await sampleJpegBase64();

  const hider = "seek-hider-cred-0001";
  const seeker = "seek-seeker-cred-0002";

  let roomCode;
  let anchorId;
  let photoQuestionId;
  let expectedDeadline;
  let expectedHandIds;
  let expectedQaOffset;
  let expectedHiderActSeq;
  let expectedSeekerActSeq;
  let savedCurseCardInstanceId;
  let expectedActiveCurseCount = 0;

  // Phase 1: Play Hide & Seek QA room into seeking with radar clue, photo clue, drawn hand, and curse/bonus if drawn
  {
    const store = api.rulebookStore(dbPath, { now: () => T0 });
    try {
      const seekListing = store.listPublicListings("hide-and-seek").find((l) => l.packId === "official-jakarta-compact-seek");
      assert.ok(seekListing);

      const created = store.createFreeRoomFromRulebook(
        seekListing.packId, seekListing.version, hider, "Hider A", T0, true, "group", "req-seek-persist-0001",
      );
      assert.equal(created.ok, true);
      roomCode = created.roomCode;
      assert.equal(store.joinRoom(roomCode, seeker, "Seeker B", T0 + 500).ok, true);

      const lobbyView = store.viewRoom(roomCode, hider, T0 + 1000);
      const startPt = lobbyView.publicBoard.startPoint;
      for (const cred of [hider, seeker]) {
        act(store, roomCode, cred, T0 + 1000, { type: "check-in-start", fix: fixAt(startPt, T0 + 1000) });
        act(store, roomCode, cred, T0 + 1500, { type: "ready", ready: true });
      }
      act(store, roomCode, hider, T0 + 2000, { type: "start" });

      const headStart = store.viewRoom(roomCode, hider, T0 + 2500);
      anchorId = headStart.publicBoard.stations[0].id;
      const anchor = headStart.publicBoard.stations[0];
      act(store, roomCode, hider, T0 + 3000, {
        type: "lock-anchor",
        stationId: anchorId,
        fix: fixAt({ latitude: anchor.latitude + 0.000008, longitude: anchor.longitude - 0.000008 }, T0 + 3000),
      });

      // Advance QA clock to end head_start and add +1 minute during seeking so qa.offsetMs is non-zero!
      const adv1 = store.advanceQaClock(roomCode, hider, "qa-adv-head-start", "phase-end", headStart.room.phaseEndsAt, T0 + 4000);
      assert.equal(adv1.ok, true);
      const adv2 = store.advanceQaClock(roomCode, hider, "qa-adv-one-min", "minute", null, T0 + 4500);
      assert.equal(adv2.ok, true);
      expectedQaOffset = store.roomTime(roomCode, T0 + 4500) - (T0 + 4500);
      assert.ok(expectedQaOffset > 60_000);

      // Seeker asks a radar question; hider answers & resolves draw batch into private hand
      const tSeek = store.roomTime(roomCode, T0 + 5000);
      const seekSeekerView = store.viewRoom(roomCode, seeker, tSeek);
      assert.equal(seekSeekerView.room.phase, "seeking");
      const radar = seekSeekerView.room.menu.find((m) => m.family === "radar" && !m.isCustomRadius);
      act(store, roomCode, seeker, tSeek, {
        type: "ask", family: "radar", itemId: radar.itemId, fix: fixAt(startPt, tSeek),
      });
      const hiderQ1 = store.viewRoom(roomCode, hider, tSeek + 500).room.questions.find((q) => q.status === "pending");
      act(store, roomCode, hider, tSeek + 1000, {
        type: "answer-question", questionId: hiderQ1.id, answerCode: hiderQ1.privateComputedAnswer.code,
      });

      // Resolve active draw if pending
      let hiderAfterQ1 = store.viewRoom(roomCode, hider, tSeek + 1500);
      if (hiderAfterQ1.deck.activeDraw) {
        const keepIds = hiderAfterQ1.deck.activeDraw.cards
          .slice(0, hiderAfterQ1.deck.activeDraw.keepCount)
          .map((c) => c.instanceId);
        const chose = store.deckActionInRoom(roomCode, hider, {
          kind: "choose-draw", actionId: "draw-persist-1", keepInstanceIds: keepIds,
        }, tSeek + 2000);
        assert.equal(chose.ok, true);
        hiderAfterQ1 = store.viewRoom(roomCode, hider, tSeek + 2500);
      }

      // Seeker asks a photo question; hider replies with a photo BLOB
      const photoItem = seekSeekerView.room.menu.find((m) => m.family === "photo");
      assert.ok(photoItem);
      const tPhoto = tSeek + 3000;
      act(store, roomCode, seeker, tPhoto, {
        type: "ask", family: "photo", itemId: photoItem.itemId, fix: fixAt(startPt, tPhoto),
      });
      const hiderPhotoQ = store.viewRoom(roomCode, hider, tPhoto + 500).room.questions.find((q) => q.status === "pending");
      photoQuestionId = hiderPhotoQ.id;
      const photoReply = await store.answerSeekPhoto(
        roomCode, hider, photoQuestionId, "seek-photo-persist-1", photoBase64, () => tPhoto + 1000,
      );
      assert.equal(photoReply.error, undefined);

      let hiderView = store.viewRoom(roomCode, hider, tPhoto + 1500);
      if (hiderView.deck.activeDraw) {
        const keepIds = hiderView.deck.activeDraw.cards
          .slice(0, hiderView.deck.activeDraw.keepCount)
          .map((c) => c.instanceId);
        store.deckActionInRoom(roomCode, hider, {
          kind: "choose-draw", actionId: "draw-persist-2", keepInstanceIds: keepIds,
        }, tPhoto + 2000);
        hiderView = store.viewRoom(roomCode, hider, tPhoto + 2500);
      }

      // If hider drew a curse with castingCost "none" or discard, try playing a curse so activeCurses persistence is tested too
      const freeCurse = hiderView.deck.hand.find((c) =>
        c.category === "curse" && c.effect.primitive === "curse" &&
        c.effect.curse.castingCosts.every((cost) => cost.type === "none"),
      );
      if (freeCurse) {
        const played = store.playCardInRoom(roomCode, hider, { cardInstanceId: freeCurse.instanceId }, tPhoto + 3000, "play-curse-1");
        if (played.ok) {
          savedCurseCardInstanceId = freeCurse.instanceId;
          hiderView = store.viewRoom(roomCode, hider, tPhoto + 3500);
          expectedActiveCurseCount = hiderView.deck.activeCurses.length;
        }
      }

      const seekerView = store.viewRoom(roomCode, seeker, tPhoto + 3500);
      expectedDeadline = hiderView.room.phaseEndsAt;
      expectedHandIds = hiderView.deck.hand.map((c) => c.instanceId);
      assert.ok(expectedHandIds.length >= 1, "Hider should hold drawn cards before restart");
      expectedHiderActSeq = hiderView.activity.sequence;
      expectedSeekerActSeq = seekerView.activity.sequence;
    } finally {
      store.close();
    }
  }

  // Phase 2: Restart store and verify everything survived with strict seeker secret isolation!
  {
    const restarted = api.rulebookStore(dbPath, { now: () => T0 + 10_000 });
    try {
      // QA clock offset & replay deduplication survive restart
      const offsetAfter = restarted.roomTime(roomCode, T0 + 10_000) - (T0 + 10_000);
      assert.equal(offsetAfter, expectedQaOffset);
      const dupQa = restarted.advanceQaClock(roomCode, hider, "qa-adv-one-min", "minute", null, T0 + 10_000);
      assert.equal(dupQa.ok, true);
      assert.equal(restarted.roomTime(roomCode, T0 + 10_000) - (T0 + 10_000), expectedQaOffset, "Replayed QA advance must be idempotent");

      const nowAfter = restarted.roomTime(roomCode, T0 + 10_000);
      const hiderView = restarted.viewRoom(roomCode, hider, nowAfter);
      const seekerView = restarted.viewRoom(roomCode, seeker, nowAfter);

      assert.equal(hiderView.room.phase, "seeking");
      assert.equal(hiderView.room.phaseEndsAt, expectedDeadline);
      assert.equal(hiderView.room.ownAnchorStationId, anchorId);
      assert.deepEqual(hiderView.deck.hand.map((c) => c.instanceId), expectedHandIds);
      assert.equal(hiderView.deck.activeCurses.length, expectedActiveCurseCount);
      assert.equal(hiderView.room.questions.length, 2);
      assert.equal(hiderView.activity.sequence, expectedHiderActSeq);

      // Strict secret isolation for seeker after restart
      assert.equal(seekerView.room.ownAnchorStationId, undefined);
      assert.equal(seekerView.room.foundCode, undefined);
      assert.equal("hand" in seekerView.deck, false);
      assert.equal(seekerView.room.questions.length, 2);
      assert.equal(seekerView.activity.sequence, expectedSeekerActSeq);
      if (savedCurseCardInstanceId) {
        const dupPlay = restarted.playCardInRoom(roomCode, hider, { cardInstanceId: savedCurseCardInstanceId }, nowAfter, "play-curse-1");
        assert.equal(dupPlay.ok, true);
      }

      // In-match photo BLOB survives restart and is readable by both seats
      const photoForSeeker = restarted.viewRoomPhoto(roomCode, seeker, photoQuestionId, nowAfter);
      assert.ok(Buffer.isBuffer(photoForSeeker) && photoForSeeker.length > 0);
      const meta = await sharp(photoForSeeker).metadata();
      assert.equal(meta.format, "jpeg");
      assert.equal(meta.exif, undefined);

      // End match via leave -> photo BLOB is purged from rulebook_room_photos and live room is deleted!
      act(restarted, roomCode, hider, nowAfter + 1000, { type: "leave" });
      assert.equal(restarted.viewRoomPhoto(roomCode, seeker, photoQuestionId, nowAfter + 1500), undefined);

      const inspect = new DatabaseSync(dbPath, { timeout: 5000 });
      try {
        const photoCount = inspect.prepare("SELECT count(*) AS count FROM rulebook_room_photos WHERE room_code = ?").get(roomCode).count;
        assert.equal(photoCount, 0, "Seek photos must be purged from rulebook_room_photos upon match completion");
        const liveRow = inspect.prepare("SELECT 1 FROM rulebook_live_rooms WHERE room_code = ?").get(roomCode);
        assert.equal(liveRow, undefined, "Completed Seek room must be removed from rulebook_live_rooms");
      } finally {
        inspect.close();
      }
    } finally {
      restarted.close();
    }
  }
});

test("Pending Midtrans orders and settled paid pass, room, and earnings persist atomically across restart", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "kelana-rb-midtrans-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const dbPath = join(dir, "rulebooks.sqlite");

  const creator = "creator-persist-0001";
  const buyer = "buyer-persist-0001";
  const packId = "comm-persist-paid-claim";
  const orderReqId = "req-paid-persist-0001";

  let orderId;
  let settledRoomCode;

  // Phase 1: Publish a paid pack and create a pending order, then restart BEFORE settlement
  {
    const midtrans = api.createRecordedMidtransAdapter();
    const store = api.rulebookStore(dbPath, { midtrans, now: () => T0 });
    try {
      const cloned = store.cloneOfficialTemplate(
        "official-jakarta-compact-claim",
        creator,
        { packId, title: "Paid Persistence Pack", byline: "Studio QA", priceIdr: 30_000 },
        T0,
      );
      assert.equal(cloned.ok, true);
      assert.equal(store.submitDraft(creator, packId, 1, T0 + 1000).ok, true);
      assert.equal(store.reviewVersion(packId, 1, { action: "publish" }, TEST_ADMIN, T0 + 2000).ok, true);

      const createdOrder = await store.createOrder(buyer, packId, 1, T0 + 3000, "group", orderReqId);
      assert.equal(createdOrder.ok, true);
      orderId = createdOrder.order.orderId;

      // Verify pending order row exists in SQLite
      const inspect = new DatabaseSync(dbPath, { timeout: 5000 });
      try {
        const pendingRow = inspect.prepare("SELECT order_id FROM rulebook_pending_orders WHERE order_id = ?").get(orderId);
        assert.equal(pendingRow.order_id, orderId);
      } finally {
        inspect.close();
      }
    } finally {
      store.close();
    }
  }

  // Phase 2: Restart with a brand-new RecordedMidtransAdapter -> pending order rehydrates and settles atomically!
  {
    const midtrans2 = api.createRecordedMidtransAdapter();
    const store2 = api.rulebookStore(dbPath, { midtrans: midtrans2, now: () => T0 + 5000 });
    try {
      // Retrying createOrder with same requestId returns exact same persisted order
      const retried = await store2.createOrder(buyer, packId, 1, T0 + 5000, "group", orderReqId);
      assert.equal(retried.ok, true);
      assert.equal(retried.order.orderId, orderId);

      // Concurrent webhook + check-payment settlement produces exactly 1 pass, 1 room, 1 earning!
      midtrans2.setOrderState(orderId, { transactionStatus: "settlement", statusCode: "200", grossAmountIdr: 30_000, currency: "IDR" });
      const webhookPayload = midtrans2.signNotification({ orderId, transactionStatus: "settlement", grossAmount: "30000.00" });

      const [res1, res2] = await Promise.all([
        store2.settleVerifiedOrder(orderId, undefined, "Host Paid", webhookPayload, T0 + 6000),
        store2.settleVerifiedOrder(orderId, buyer, "Host Paid", undefined, T0 + 6000),
      ]);
      assert.equal(res1.ok, true);
      assert.equal(res2.ok, true);
      assert.equal(res1.pass.roomCode, res2.pass.roomCode);
      assert.equal(res1.duplicate !== res2.duplicate, true, "Exactly one concurrent settlement must be primary and one duplicate");
      settledRoomCode = res1.pass.roomCode;

      assert.equal(store2.listEarnings().length, 1);
      assert.equal(store2.listEarnings()[0].orderId, orderId);
      assert.equal(store2.listEarnings()[0].grossAmountIdr, 30_000);

      // Pending order row is removed once settled
      const inspect = new DatabaseSync(dbPath, { timeout: 5000 });
      try {
        const pendingRow = inspect.prepare("SELECT order_id FROM rulebook_pending_orders WHERE order_id = ?").get(orderId);
        assert.equal(pendingRow, undefined);
      } finally {
        inspect.close();
      }
    } finally {
      store2.close();
    }
  }

  // Phase 3: Restart a third time -> settled room, pass, order, and earnings all persist cleanly!
  {
    const store3 = api.rulebookStore(dbPath, { now: () => T0 + 10_000 });
    try {
      const roomView = store3.viewRoom(settledRoomCode, buyer, T0 + 10_000);
      assert.ok(roomView, "Paid room unlocked by Midtrans settlement must survive restart");
      assert.equal(roomView.pass.paid, true);
      assert.equal(roomView.pass.orderId, orderId);
      assert.equal(store3.listEarnings().length, 1);
      assert.equal(store3.listOrders().find((o) => o.orderId === orderId)?.status, "settled");
      assert.equal(store3.getPassByRoomCode(settledRoomCode)?.orderId, orderId);
    } finally {
      store3.close();
    }
  }
});

for (const board of ["compact", "wide"]) {
  test(`official ${board} Seek questions lock for one turn and replay without another draw`, () => {
    const store = api.rulebookStore(":memory:", { now: () => T0 });
    try {
      const packId = `official-jakarta-${board}-seek`;
      const listing = store.listPublicListings("hide-and-seek").find(item => item.packId === packId);
      assert.equal(listing.repeatCostMode, "single_use_locked");
      const hider = "lock-test-host";
      const seeker = "lock-test-guest";
      const created = store.createFreeRoomFromRulebook(packId, listing.version, hider, "Hider", T0, true, "group");
      assert.equal(created.ok, true);
      const { roomCode } = created;
      assert.equal(store.joinRoom(roomCode, seeker, "Seeker", T0).ok, true);
      const { publicBoard } = store.viewRoom(roomCode, hider, T0);
      const anchor = publicBoard.stations[0];
      const start = publicBoard.startPoint;
      for (const seat of [hider, seeker]) {
        act(store, roomCode, seat, T0, { type: "check-in-start", fix: fixAt(start, T0) });
        act(store, roomCode, seat, T0, { type: "ready", ready: true });
      }
      const head = act(store, roomCode, hider, T0 + 1000, { type: "start" }).room;
      act(store, roomCode, hider, T0 + 2000, { type: "lock-anchor", stationId: anchor.id, fix: fixAt(anchor, T0 + 2000) });
      const seekAt = head.releaseAt + 1000;
      const before = store.viewRoom(roomCode, seeker, seekAt).room;
      const radarItems = before.menu.filter(item => item.family === "radar" && !item.isCustomRadius);
      assert.ok(radarItems.length > 1);
      const [radar, other] = radarItems;
      const ask = { type: "ask", actionId: "ask-once", family: radar.family, itemId: radar.itemId, fix: fixAt(start, seekAt) };
      const asked = act(store, roomCode, seeker, seekAt, ask).room.questions[0];
      const pending = store.viewRoom(roomCode, hider, seekAt).room.questions[0];
      const answer = {
        type: "answer-question", actionId: "answer-once", questionId: asked.id, answerCode: pending.privateComputedAnswer.code,
      };
      act(store, roomCode, hider, seekAt + 1000, answer);
      const draw = store.viewRoom(roomCode, hider, seekAt + 1000).deck.activeDraw;
      assert.ok(draw);

      const replay = act(store, roomCode, seeker, seekAt + 2000, ask).room;
      assert.equal(replay.questions.length, 1);
      assert.equal(replay.questions[0].id, asked.id);
      assert.equal(replay.questions[0].status, "answered");
      assert.equal(replay.menu.find(item => item.itemId === radar.itemId).lockedSingleUse, true);
      assert.equal(replay.menu.find(item => item.itemId === other.itemId).lockedSingleUse, false);
      const duplicate = store.actInRoom(roomCode, seeker, { ...ask, actionId: "new-ask", fix: fixAt(start, seekAt + 2000) }, seekAt + 2000);
      assert.equal(duplicate.error, "question-already-used");

      act(store, roomCode, hider, seekAt + 2000, answer);
      const chose = store.deckActionInRoom(roomCode, hider, {
        kind: "choose-draw", actionId: "draw-once", keepInstanceIds: draw.cards.slice(0, draw.keepCount).map(card => card.instanceId),
      }, seekAt + 2500);
      assert.equal(chose.ok, true);
      assert.equal(store.viewRoom(roomCode, hider, seekAt + 2600).deck.activeDraw, null, "Replays must not queue a second draw");

      const endAt = before.phaseEndsAt;
      const ended = store.viewRoom(roomCode, hider, endAt).room;
      assert.equal(ended.phase, "regroup");
      const checkInAt = endAt + 1000;
      for (const seat of [hider, seeker]) {
        act(store, roomCode, seat, checkInAt, { type: "regroup-check-in", fix: fixAt(ended.regroupPoint, checkInAt) });
      }
      const swapped = store.viewRoom(roomCode, seeker, checkInAt).room;
      assert.equal(swapped.turnNumber, 2);
      act(store, roomCode, seeker, checkInAt + 1000, { type: "lock-anchor", stationId: anchor.id, fix: fixAt(anchor, checkInAt + 1000) });
      const nextSeekAt = swapped.releaseAt + 1000;
      const next = store.viewRoom(roomCode, hider, nextSeekAt).room;
      assert.equal(next.menu.find(item => item.itemId === radar.itemId).lockedSingleUse, false);
      assert.equal(next.questions.length, 0);
      act(store, roomCode, hider, nextSeekAt, { ...ask, actionId: "turn-two-ask", fix: fixAt(next.turnStartPoint, nextSeekAt) });
    } finally {
      store.close();
    }
  });
}
