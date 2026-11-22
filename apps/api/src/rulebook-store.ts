import { createHash, randomBytes } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type {
  GeoSnapshot,
  HideSeekRulebookPack,
  HideSeekRulebookValidationResult,
  PackEarningsEntry,
  PackOrderSummary,
  PackVersionStatus,
  RulebookFormat,
  SeekEngineAction,
  SeekEngineActionReply,
  SeekEngineRoomView,
} from "@kelana-ria/contracts";
import {
  createMidtransAdapterFromEnv,
  parseMidtransIdrAmount,
  type MidtransAdapter,
  type MidtransNotificationPayload,
  type RecordedMidtransAdapter,
} from "./midtrans-adapter.js";
import { loadOfficialSeekPacks } from "./official-packs.js";
import {
  createSeekDeckState,
  enqueueSeekDrawBatches,
  expireSeekDeckAndCurses,
  onSeekerQuestionAskedForCurses,
  playSeekDeckCard,
  viewSeekDeck,
  type PlaySeekCardParams,
  type SeekDeckEngineState,
} from "./seek-engine/deck-engine.js";
import { createFixtureGeoSeedProvider, seedAndFreezeGeoSnapshot, type GeoSeedRequest } from "./seek-engine/geo-seeder.js";
import { validateHideSeekRulebook } from "./seek-engine/rulebook-validator.js";
import {
  activeHiderSeatId,
  applySeekEngineAction,
  createSeekEngineMatch,
  findSeekEngineSeat,
  joinSeekEngineMatch,
  viewSeekEngineMatch,
  type SeekEngineMatch,
} from "./seek-engine/seek-engine.js";

const PLATFORM_FEE_RATE = 0.15;
const ORDER_TTL_MS = 15 * 60_000;

function digest(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function isRecordedAdapter(adapter: MidtransAdapter): adapter is RecordedMidtransAdapter {
  return adapter.mode === "recorded-sandbox" && typeof (adapter as Partial<RecordedMidtransAdapter>).setOrderState === "function";
}

export type StoredRulebookRecord = {
  packId: string;
  version: number;
  format: RulebookFormat;
  isOfficial: boolean;
  status: PackVersionStatus;
  ownerHash: string;
  pack: HideSeekRulebookPack;
  snapshot: GeoSnapshot;
  updatedAt: number;
  publishedAt: number | null;
  reviewNote: string | null;
  pausedReason: string | null;
};

export type RulebookPublicListing = {
  packId: string;
  version: number;
  format: "hide-and-seek";
  isOfficial: boolean;
  status: "published";
  title: string;
  byline: string;
  summary: string;
  cityLabel: string;
  difficulty: HideSeekRulebookPack["meta"]["difficulty"];
  priceIdr: number;
  minPlayers: number;
  maxPlayers: number;
  hidingZoneRadiusMeters: number;
  headStartMinutes: number;
  searchLimitMinutes: number;
  regroupMinutes: number;
  regroupPolicy: HideSeekRulebookPack["session"]["regroupPolicy"];
  stationCount: number;
  startName: string;
  questionFamilies: { family: string; itemCount: number; drawCount: number; keepCount: number }[];
  deckSummary: { totalCards: number; timeBonuses: number; powerups: number; curses: number; baseHandLimit: number };
  publishedAt: number;
};

export type RulebookRoomPass = {
  passId: string;
  orderId: string | null;
  roomCode: string;
  packId: string;
  version: number;
  maxPlayers: number;
  paid: boolean;
  createdAt: number;
};

type LiveSeekSession = {
  pass: RulebookRoomPass;
  match: SeekEngineMatch;
  deck: SeekDeckEngineState;
};

export function toPublicSeekListing(record: StoredRulebookRecord): RulebookPublicListing {
  const { pack, snapshot } = record;
  const families = Object.entries(pack.investigationBook.families)
    .filter(([, cfg]) => cfg?.enabled)
    .map(([family, cfg]) => ({
      family,
      itemCount: cfg!.items.length,
      drawCount: cfg!.drawCount,
      keepCount: cfg!.keepCount,
    }));
  let timeBonuses = 0;
  let powerups = 0;
  let curses = 0;
  for (const card of pack.deck.cards) {
    if (card.category === "time_bonus") timeBonuses += card.copies;
    else if (card.category === "powerup") powerups += card.copies;
    else curses += card.copies;
  }
  return {
    packId: record.packId,
    version: record.version,
    format: "hide-and-seek",
    isOfficial: record.isOfficial,
    status: "published",
    title: pack.meta.title,
    byline: pack.meta.byline,
    summary: pack.meta.summary,
    cityLabel: pack.meta.cityLabel,
    difficulty: pack.meta.difficulty,
    priceIdr: pack.meta.priceIdr,
    minPlayers: pack.session.minPlayers,
    maxPlayers: pack.session.maxPlayers,
    hidingZoneRadiusMeters: pack.geography.hidingZoneRadiusMeters,
    headStartMinutes: Math.round(pack.timers.headStartMs / 60_000),
    searchLimitMinutes: Math.round(pack.timers.searchLimitMs / 60_000),
    regroupMinutes: Math.round(pack.timers.regroupLimitMs / 60_000),
    regroupPolicy: pack.session.regroupPolicy,
    stationCount: snapshot.stations.filter((s) => s.eligibleHidingAnchor).length,
    startName: snapshot.startPoint.name,
    questionFamilies: families,
    deckSummary: {
      totalCards: timeBonuses + powerups + curses,
      timeBonuses,
      powerups,
      curses,
      baseHandLimit: pack.deck.baseHandLimit,
    },
    publishedAt: record.publishedAt ?? record.updatedAt,
  };
}

export function rulebookStore(
  databasePath: string,
  options: { midtrans?: MidtransAdapter; officialPacksDir?: string } = {},
) {
  if (databasePath !== ":memory:") mkdirSync(dirname(databasePath), { recursive: true });
  const db = new DatabaseSync(databasePath);
  const midtrans = options.midtrans ?? createMidtransAdapterFromEnv();

  db.exec(`
    CREATE TABLE IF NOT EXISTS rulebook_versions (
      pack_id TEXT NOT NULL,
      version INTEGER NOT NULL,
      format TEXT NOT NULL,
      is_official INTEGER NOT NULL,
      status TEXT NOT NULL,
      owner_hash TEXT NOT NULL,
      payload TEXT NOT NULL,
      PRIMARY KEY (pack_id, version)
    );
    CREATE TABLE IF NOT EXISTS rulebook_orders (
      order_id TEXT PRIMARY KEY,
      buyer_hash TEXT NOT NULL,
      pack_id TEXT NOT NULL,
      version INTEGER NOT NULL,
      payload TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS rulebook_earnings (
      earnings_entry_id TEXT PRIMARY KEY,
      order_id TEXT UNIQUE NOT NULL,
      pack_id TEXT NOT NULL,
      version INTEGER NOT NULL,
      payload TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS rulebook_passes (
      pass_id TEXT PRIMARY KEY,
      order_id TEXT UNIQUE,
      room_code TEXT UNIQUE NOT NULL,
      payload TEXT NOT NULL
    );
  `);

  const officialLoaded = loadOfficialSeekPacks(options.officialPacksDir);
  const upsertVersionStmt = db.prepare(`
    INSERT OR REPLACE INTO rulebook_versions (pack_id, version, format, is_official, status, owner_hash, payload)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  const getVersionStmt = db.prepare("SELECT payload FROM rulebook_versions WHERE pack_id = ? AND version = ?");
  const listVersionsStmt = db.prepare("SELECT payload FROM rulebook_versions ORDER BY is_official DESC, pack_id ASC, version DESC");
  const maxVersionStmt = db.prepare("SELECT MAX(version) AS max_v FROM rulebook_versions WHERE pack_id = ?");
  const upsertOrderStmt = db.prepare("INSERT OR REPLACE INTO rulebook_orders (order_id, buyer_hash, pack_id, version, payload) VALUES (?, ?, ?, ?, ?)");
  const getOrderStmt = db.prepare("SELECT payload FROM rulebook_orders WHERE order_id = ?");
  const listOrdersStmt = db.prepare("SELECT payload FROM rulebook_orders ORDER BY order_id DESC");
  const getEarningByOrderStmt = db.prepare("SELECT payload FROM rulebook_earnings WHERE order_id = ?");
  const insertEarningStmt = db.prepare("INSERT OR IGNORE INTO rulebook_earnings (earnings_entry_id, order_id, pack_id, version, payload) VALUES (?, ?, ?, ?, ?)");
  const listEarningsStmt = db.prepare("SELECT payload FROM rulebook_earnings ORDER BY earnings_entry_id DESC");
  const getPassByOrderStmt = db.prepare("SELECT payload FROM rulebook_passes WHERE order_id = ?");
  const getPassByCodeStmt = db.prepare("SELECT payload FROM rulebook_passes WHERE room_code = ?");
  const insertPassStmt = db.prepare("INSERT OR IGNORE INTO rulebook_passes (pass_id, order_id, room_code, payload) VALUES (?, ?, ?, ?)");

  // Seed official free packs into the exact same table as community packs
  const nowSeed = Date.now();
  for (const { pack, snapshot } of officialLoaded) {
    const existing = getVersionStmt.get(pack.meta.packId, pack.meta.version) as { payload: string } | undefined;
    if (!existing) {
      const rec: StoredRulebookRecord = {
        packId: pack.meta.packId,
        version: pack.meta.version,
        format: "hide-and-seek",
        isOfficial: true,
        status: "published",
        ownerHash: "official",
        pack,
        snapshot,
        updatedAt: nowSeed,
        publishedAt: nowSeed,
        reviewNote: null,
        pausedReason: null,
      };
      upsertVersionStmt.run(rec.packId, rec.version, rec.format, 1, rec.status, rec.ownerHash, JSON.stringify(rec));
    }
  }

  const liveRooms = new Map<string, LiveSeekSession>();

  function getRecord(packId: string, version: number): StoredRulebookRecord | undefined {
    const row = getVersionStmt.get(packId, version) as { payload: string } | undefined;
    return row ? (JSON.parse(row.payload) as StoredRulebookRecord) : undefined;
  }

  function saveRecord(rec: StoredRulebookRecord) {
    upsertVersionStmt.run(
      rec.packId,
      rec.version,
      rec.format,
      rec.isOfficial ? 1 : 0,
      rec.status,
      rec.ownerHash,
      JSON.stringify(rec),
    );
  }

  function allRecords(): StoredRulebookRecord[] {
    return (listVersionsStmt.all() as { payload: string }[]).map((row) => JSON.parse(row.payload) as StoredRulebookRecord);
  }

  function listPublicListings(): RulebookPublicListing[] {
    return allRecords()
      .filter((r) => r.status === "published" && r.format === "hide-and-seek")
      .map(toPublicSeekListing);
  }

  function cloneOfficialTemplate(
    templatePackId: string,
    creatorCredential: string,
    overrides: { packId: string; title: string; byline: string; priceIdr: number },
    now: number,
  ): { ok: true; record: StoredRulebookRecord } | { ok: false; error: string } {
    const template = allRecords().find((r) => r.packId === templatePackId && r.isOfficial && r.status === "published");
    if (!template) return { ok: false, error: "template-not-found" };
    if (!overrides.packId.trim() || !overrides.title.trim() || !overrides.byline.trim()) {
      return { ok: false, error: "invalid-metadata" };
    }
    const maxRow = maxVersionStmt.get(overrides.packId) as { max_v: number | null } | undefined;
    const nextVersion = (maxRow?.max_v ?? 0) + 1;
    const clonedPack: HideSeekRulebookPack = {
      ...structuredClone(template.pack),
      meta: {
        ...template.pack.meta,
        packId: overrides.packId,
        version: nextVersion,
        isOfficial: false,
        title: overrides.title,
        byline: overrides.byline,
        priceIdr: overrides.priceIdr,
      },
    };
    const record: StoredRulebookRecord = {
      packId: overrides.packId,
      version: nextVersion,
      format: "hide-and-seek",
      isOfficial: false,
      status: "draft",
      ownerHash: digest(creatorCredential),
      pack: clonedPack,
      snapshot: structuredClone(template.snapshot),
      updatedAt: now,
      publishedAt: null,
      reviewNote: null,
      pausedReason: null,
    };
    saveRecord(record);
    return { ok: true, record };
  }

  function saveDraft(
    creatorCredential: string,
    pack: HideSeekRulebookPack,
    snapshot: GeoSnapshot,
    now: number,
  ): { ok: true; record: StoredRulebookRecord; validation: HideSeekRulebookValidationResult } | { ok: false; error: string } {
    if (!pack?.meta?.packId) return { ok: false, error: "invalid-metadata" };
    if (pack.meta.isOfficial) return { ok: false, error: "cannot-author-official-pack" };
    const ownerHash = digest(creatorCredential);
    const existing = getRecord(pack.meta.packId, pack.meta.version);
    if (existing && (existing.ownerHash !== ownerHash || (existing.status !== "draft" && existing.status !== "changes-requested"))) {
      return { ok: false, error: "version-immutable" };
    }
    const version = existing ? existing.version : ((maxVersionStmt.get(pack.meta.packId) as { max_v: number | null } | undefined)?.max_v ?? 0) + 1;
    const normalizedPack: HideSeekRulebookPack = {
      ...pack,
      meta: { ...pack.meta, version, isOfficial: false },
    };
    const validation = validateHideSeekRulebook(normalizedPack, snapshot);
    const record: StoredRulebookRecord = {
      packId: normalizedPack.meta.packId,
      version,
      format: "hide-and-seek",
      isOfficial: false,
      status: "draft",
      ownerHash,
      pack: normalizedPack,
      snapshot,
      updatedAt: now,
      publishedAt: null,
      reviewNote: null,
      pausedReason: null,
    };
    saveRecord(record);
    return { ok: true, record, validation };
  }

  function submitDraft(
    creatorCredential: string,
    packId: string,
    version: number,
    now: number,
  ): { ok: true; record: StoredRulebookRecord } | { ok: false; error: string; validation?: HideSeekRulebookValidationResult } {
    const rec = getRecord(packId, version);
    if (!rec || rec.isOfficial) return { ok: false, error: "not-found" };
    if (rec.ownerHash !== digest(creatorCredential)) return { ok: false, error: "owner-only" };
    if (rec.status !== "draft" && rec.status !== "changes-requested") return { ok: false, error: "invalid-status" };
    const validation = validateHideSeekRulebook(rec.pack, rec.snapshot);
    if (!validation.ok) return { ok: false, error: "validation-failed", validation };
    rec.status = "submitted";
    rec.updatedAt = now;
    saveRecord(rec);
    return { ok: true, record: rec };
  }

  function reviewVersion(
    packId: string,
    version: number,
    decision: { action: "request-changes"; note: string } | { action: "publish" } | { action: "pause"; reason: string },
    now: number,
  ): { ok: true; record: StoredRulebookRecord } | { ok: false; error: string; validation?: HideSeekRulebookValidationResult } {
    const rec = getRecord(packId, version);
    if (!rec || rec.isOfficial) return { ok: false, error: "not-found" };
    if (decision.action === "request-changes") {
      if (rec.status !== "submitted") return { ok: false, error: "invalid-status" };
      rec.status = "changes-requested";
      rec.reviewNote = decision.note;
      rec.updatedAt = now;
      saveRecord(rec);
      return { ok: true, record: rec };
    }
    if (decision.action === "publish") {
      if (rec.status !== "submitted") return { ok: false, error: "invalid-status" };
      const validation = validateHideSeekRulebook(rec.pack, rec.snapshot);
      if (!validation.ok) return { ok: false, error: "validation-failed", validation };
      rec.status = "published";
      rec.publishedAt = now;
      rec.reviewNote = null;
      rec.updatedAt = now;
      saveRecord(rec);
      return { ok: true, record: rec };
    }
    if (rec.status !== "published") return { ok: false, error: "invalid-status" };
    rec.status = "paused";
    rec.pausedReason = decision.reason;
    rec.updatedAt = now;
    saveRecord(rec);
    return { ok: true, record: rec };
  }

  function instantiateSeekRoom(
    rec: StoredRulebookRecord,
    hostCredential: string,
    hostName: string,
    now: number,
    orderId: string | null = null,
  ): LiveSeekSession {
    const roomCode = `RB-${randomBytes(3).toString("hex").toUpperCase()}`;
    const passId = `pass-${randomBytes(5).toString("hex")}`;
    const pass: RulebookRoomPass = {
      passId,
      orderId,
      roomCode,
      packId: rec.packId,
      version: rec.version,
      maxPlayers: rec.pack.session.maxPlayers,
      paid: orderId !== null,
      createdAt: now,
    };
    const match = createSeekEngineMatch({
      code: roomCode,
      pack: rec.pack,
      snapshot: rec.snapshot,
      hostSeatId: "seat-1",
      hostName,
      hostCredentialHash: digest(hostCredential),
    });
    const deck = createSeekDeckState(rec.pack);
    const session: LiveSeekSession = { pass, match, deck };
    liveRooms.set(roomCode, session);
    insertPassStmt.run(pass.passId, pass.orderId, pass.roomCode, JSON.stringify(pass));
    return session;
  }

  function createFreeRoomFromRulebook(
    packId: string,
    version: number,
    hostCredential: string,
    hostName: string,
    now: number,
  ): { ok: true; roomCode: string; pass: RulebookRoomPass; room: SeekEngineRoomView } | { ok: false; error: string } {
    const rec = getRecord(packId, version);
    if (!rec || rec.status !== "published") return { ok: false, error: "pack-unavailable" };
    if (rec.pack.meta.priceIdr > 0) return { ok: false, error: "payment-required" };
    const session = instantiateSeekRoom(rec, hostCredential, hostName, now, null);
    return {
      ok: true,
      roomCode: session.pass.roomCode,
      pass: session.pass,
      room: viewSeekEngineMatch(session.match, "seat-1", now),
    };
  }

  async function createOrder(
    buyerCredential: string,
    packId: string,
    version: number,
    now: number,
  ): Promise<{ ok: true; order: PackOrderSummary } | { ok: false; error: string }> {
    const rec = getRecord(packId, version);
    if (!rec || rec.status !== "published") return { ok: false, error: "pack-unavailable" };
    if (rec.pack.meta.priceIdr <= 0) return { ok: false, error: "pack-is-free" };

    const orderId = `KRB-${now}-${randomBytes(3).toString("hex").toUpperCase()}`;
    const gross = rec.pack.meta.priceIdr;
    const fee = Math.round(gross * PLATFORM_FEE_RATE);
    const share = gross - fee;
    let snap: { token: string; redirectUrl: string; mode: PackOrderSummary["paymentMode"] };
    try {
      snap = await midtrans.createSnapTransaction({
        orderId,
        grossAmountIdr: gross,
        packId: rec.packId,
        version: rec.version,
        title: `${rec.pack.meta.title} v${rec.version}`,
      });
    } catch {
      return { ok: false, error: "payment-provider-unavailable" };
    }

    const order: PackOrderSummary = {
      orderId,
      packId: rec.packId,
      version: rec.version,
      title: rec.pack.meta.title,
      byline: rec.pack.meta.byline,
      players: 2,
      currency: "IDR",
      grossAmountIdr: gross,
      platformFeeIdr: fee,
      creatorShareIdr: share,
      status: "pending",
      createdAt: now,
      expiresAt: now + ORDER_TTL_MS,
      checkoutReturnedAt: null,
      settledAt: null,
      passId: null,
      roomCode: null,
      earningsEntryId: null,
      paymentMode: midtrans.mode,
      snapRedirectUrl: snap.redirectUrl,
      sandbox: true,
    };
    upsertOrderStmt.run(orderId, digest(buyerCredential), rec.packId, rec.version, JSON.stringify(order));
    return { ok: true, order };
  }

  async function settleVerifiedOrder(
    orderId: string,
    hostCredential: string,
    hostName: string,
    notification: Partial<MidtransNotificationPayload> | undefined,
    now: number,
  ): Promise<{ ok: true; duplicate: boolean; order: PackOrderSummary; pass?: RulebookRoomPass } | { ok: false; error: string }> {
    const row = getOrderStmt.get(orderId) as { payload: string } | undefined;
    if (!row) return { ok: false, error: "order-not-found" };
    const order = JSON.parse(row.payload) as PackOrderSummary;

    if (order.status === "settled") {
      const passRow = getPassByOrderStmt.get(orderId) as { payload: string } | undefined;
      return {
        ok: true,
        duplicate: true,
        order,
        pass: passRow ? (JSON.parse(passRow.payload) as RulebookRoomPass) : undefined,
      };
    }
    if (now >= order.expiresAt) {
      order.status = "expired";
      upsertOrderStmt.run(orderId, digest(hostCredential), order.packId, order.version, JSON.stringify(order));
      return { ok: false, error: "order-expired" };
    }

    if (notification?.signature_key) {
      const verifiedSig = midtrans.verifySignature({
        order_id: orderId,
        status_code: notification.status_code ?? "200",
        gross_amount: notification.gross_amount ?? `${order.grossAmountIdr}.00`,
        signature_key: notification.signature_key,
      });
      if (!verifiedSig) return { ok: false, error: "invalid-signature" };
    } else if (isRecordedAdapter(midtrans) && notification?.transaction_status) {
      const parsedNotifAmount =
        notification.gross_amount !== undefined ? parseMidtransIdrAmount(notification.gross_amount) : undefined;
      midtrans.setOrderState(orderId, {
        transactionStatus: notification.transaction_status,
        statusCode: notification.status_code ?? "200",
        grossAmountIdr: parsedNotifAmount ?? order.grossAmountIdr,
        currency: notification.currency ?? "IDR",
      });
    }

    let status: Awaited<ReturnType<MidtransAdapter["fetchTransactionStatus"]>>;
    try {
      status = await midtrans.fetchTransactionStatus(orderId);
    } catch {
      return { ok: false, error: "payment-provider-unavailable" };
    }
    if (status.grossAmountIdr !== order.grossAmountIdr || status.currency !== "IDR") {
      return { ok: false, error: "amount-or-currency-mismatch" };
    }
    if (status.transactionStatus !== "settlement" && status.transactionStatus !== "capture") {
      return { ok: false, error: `payment-${status.transactionStatus}` };
    }

    const rec = getRecord(order.packId, order.version);
    if (!rec) return { ok: false, error: "pack-not-found" };

    // Idempotent 1:1 pass + earnings reconciliation
    const existingPassRow = getPassByOrderStmt.get(orderId) as { payload: string } | undefined;
    const pass = existingPassRow
      ? (JSON.parse(existingPassRow.payload) as RulebookRoomPass)
      : instantiateSeekRoom(rec, hostCredential, hostName, now, orderId).pass;

    const existingEarningRow = getEarningByOrderStmt.get(orderId) as { payload: string } | undefined;
    const earning: PackEarningsEntry = existingEarningRow
      ? (JSON.parse(existingEarningRow.payload) as PackEarningsEntry)
      : {
          earningsEntryId: `earn-${randomBytes(4).toString("hex")}`,
          orderId,
          packId: rec.packId,
          version: rec.version,
          title: rec.pack.meta.title,
          byline: rec.pack.meta.byline,
          currency: "IDR",
          grossAmountIdr: order.grossAmountIdr,
          platformFeeIdr: order.platformFeeIdr,
          creatorShareIdr: order.creatorShareIdr,
          settledAt: now,
          paymentMode: midtrans.mode,
          sandbox: true,
        };
    if (!existingEarningRow) {
      insertEarningStmt.run(earning.earningsEntryId, orderId, rec.packId, rec.version, JSON.stringify(earning));
    }

    order.status = "settled";
    order.settledAt = now;
    order.passId = pass.passId;
    order.roomCode = pass.roomCode;
    order.earningsEntryId = earning.earningsEntryId;
    upsertOrderStmt.run(orderId, digest(hostCredential), order.packId, order.version, JSON.stringify(order));
    return { ok: true, duplicate: false, order, pass };
  }

  function joinRoom(
    roomCode: string,
    credential: string,
    name: string,
    now: number,
  ): { ok: true; seatId: string; room: SeekEngineRoomView } | { ok: false; error: string } {
    const session = liveRooms.get(roomCode);
    if (!session) return { ok: false, error: "room-not-found" };
    const credHash = digest(credential);
    const existingSeat = findSeekEngineSeat(session.match, credHash);
    if (existingSeat) {
      return { ok: true, seatId: existingSeat, room: viewSeekEngineMatch(session.match, existingSeat, now) };
    }
    const nextSeatId = `seat-${session.match.seats.length + 1}`;
    const joined = joinSeekEngineMatch(session.match, { seatId: nextSeatId, name, credentialHash: credHash });
    if (!joined.ok) return joined;
    return { ok: true, seatId: nextSeatId, room: viewSeekEngineMatch(session.match, nextSeatId, now) };
  }

  function actInRoom(
    roomCode: string,
    credential: string,
    action: SeekEngineAction,
    now: number,
  ): SeekEngineActionReply | { error: string } {
    const session = liveRooms.get(roomCode);
    if (!session) return { error: "room-not-found" };
    const seatId = findSeekEngineSeat(session.match, digest(credential));
    if (!seatId) return { error: "not-a-member" };
    expireSeekDeckAndCurses(session.deck, session.match, now);
    const prevTurn = session.match.turnNumber;
    const reply = applySeekEngineAction(session.match, seatId, action, now);
    if (!reply.error && action.type === "ask") {
      onSeekerQuestionAskedForCurses(session.deck, session.match, now);
    }
    if (!reply.error && reply.earnedDrawBatches?.length) {
      enqueueSeekDrawBatches(session.deck, session.match, reply.earnedDrawBatches, now);
    }
    if (session.match.turnNumber !== prevTurn) {
      session.deck = createSeekDeckState(session.match.pack);
    }
    return reply;
  }

  function playCardInRoom(roomCode: string, credential: string, params: PlaySeekCardParams, now: number) {
    const session = liveRooms.get(roomCode);
    if (!session) return { ok: false as const, error: "room-not-found" };
    const seatId = findSeekEngineSeat(session.match, digest(credential));
    if (!seatId || seatId !== activeHiderSeatId(session.match)) {
      return { ok: false as const, error: "hider-only" };
    }
    return playSeekDeckCard(session.deck, session.match, params, now);
  }

  function viewRoom(roomCode: string, credential: string, now: number) {
    const session = liveRooms.get(roomCode);
    if (!session) return undefined;
    const seatId = findSeekEngineSeat(session.match, digest(credential));
    if (!seatId) return undefined;
    expireSeekDeckAndCurses(session.deck, session.match, now);
    const room = viewSeekEngineMatch(session.match, seatId, now);
    const deck = viewSeekDeck(session.deck, room.role === "hider");
    return { room, deck, pass: session.pass };
  }

  async function seedGeoFromOfficialFixture(request: GeoSeedRequest): Promise<GeoSnapshot> {
    const baseSnapshot = officialLoaded[officialLoaded.length - 1]?.snapshot;
    if (!baseSnapshot) throw new Error("No official geo fixture loaded");
    const provider = createFixtureGeoSeedProvider(baseSnapshot);
    return seedAndFreezeGeoSnapshot(request, provider);
  }

  return {
    listPublicListings,
    listAllVersions: allRecords,
    listOrders: () => (listOrdersStmt.all() as { payload: string }[]).map((r) => JSON.parse(r.payload) as PackOrderSummary),
    listEarnings: () => (listEarningsStmt.all() as { payload: string }[]).map((r) => JSON.parse(r.payload) as PackEarningsEntry),
    getPassByRoomCode: (roomCode: string) => {
      const row = getPassByCodeStmt.get(roomCode) as { payload: string } | undefined;
      return row ? (JSON.parse(row.payload) as RulebookRoomPass) : undefined;
    },
    cloneOfficialTemplate,
    saveDraft,
    submitDraft,
    reviewVersion,
    createFreeRoomFromRulebook,
    createOrder,
    settleVerifiedOrder,
    joinRoom,
    actInRoom,
    playCardInRoom,
    viewRoom,
    seedGeoFromOfficialFixture,
    close: () => db.close(),
  };
}
