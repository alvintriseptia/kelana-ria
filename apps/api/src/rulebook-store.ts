import { createHash, randomBytes, randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type {
  ActiveRulebookRoomSummary,
  ClaimEngineAction,
  ClaimEngineActionReply,
  ClaimEngineRoomView,
  ClaimOpponentTrackingMode,
  ClaimPresenceEvent,
  ClaimRulebookPack,
  ClaimRulebookValidationResult,
  ClaimSeatPosition,
  GeoCoordinate,
  GeoSnapshot,
  HideSeekCardCategory,
  HideSeekRulebookPack,
  HideSeekRulebookValidationResult,
  LocationFix,
  PackEarningsEntry,
  PackOrderSummary,
  PackVersionStatus,
  RulebookEntitlementSummary,
  RulebookFormat,
  RulebookPlayMode,
  SeekEngineAction,
  SeekEngineActionReply,
  SeekEngineRoomView,
  SeekMapPreviewRequest,
} from "@kelana-ria/contracts";
import {
  applyClaimEngineAction,
  createClaimEngineMatch,
  expireClaimEngineMatch,
  findClaimEngineSeat,
  joinClaimEngineMatch,
  viewClaimEngineMatch,
  type ClaimEngineMatch,
} from "./claim-engine/claim-engine.js";
import { validateClaimRulebook } from "./claim-engine/claim-rulebook-validator.js";
import {
  createMidtransAdapterFromEnv,
  parseMidtransIdrAmount,
  type MidtransAdapter,
  type MidtransNotificationPayload,
  type RecordedMidtransAdapter,
} from "./midtrans-adapter.js";
import { sanitizeSeekPhoto } from "./seek-photo.js";
import { loadOfficialClaimPacks, loadOfficialSeekPacks } from "./official-packs.js";
import { createRoomActivity } from "./rulebook-activity.js";
import { claimMatchRecap, rulebookRecapStore, seekMatchRecap, type ShareRecapOptions } from "./rulebook-recaps.js";
import {
  deserializeLiveSession,
  serializeLiveSession,
  type LiveClaimSession,
  type LiveSeekSession,
  type LiveSession,
  type SerializedLiveSession,
} from "./rulebook-session-codec.js";
import {
  buyoutSeekCurse,
  chooseSeekDrawCards,
  clearCurseByGpsDetour,
  clearCurseByHonorTask,
  createSeekDeckState,
  enqueueSeekDrawBatches,
  expireSeekDeckAndCurses,
  onSeekerQuestionAskedForCurses,
  playSeekDeckCard,
  reviewCursePhotoProof,
  submitCursePhotoProof,
  viewSeekDeck,
  type PlaySeekCardParams,
  type SeekDeckEngineState,
} from "./seek-engine/deck-engine.js";
import { verifyGpsFreshAndAccurate } from "./seek-engine/geo-evaluator.js";
import { createFixtureGeoSeedProvider, seedAndFreezeGeoSnapshot, type GeoSeedRequest } from "./seek-engine/geo-seeder.js";
import { computeGeoSnapshotHash, haversineMeters, validateHideSeekRulebook } from "./seek-engine/rulebook-validator.js";
import {
  activeHiderSeatId,
  applySeekEngineAction,
  createSeekEngineMatch,
  expireSeekEngineMatch,
  findSeekEngineSeat,
  joinSeekEngineMatch,
  previewSeekEngineQuestion,
  viewSeekEngineMatch,
  type SeekEngineMatch,
} from "./seek-engine/seek-engine.js";

const PLATFORM_FEE_RATE = 0.15;
const ORDER_TTL_MS = 15 * 60_000;
const PRESENCE_MIN_PING_MS = 3_000;
const PRESENCE_DEFAULT_INTERVAL_MS = 10_000;
const PRESENCE_MIN_MOVE_METERS = 10;

function digest(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function isRecordedAdapter(adapter: MidtransAdapter): adapter is RecordedMidtransAdapter {
  return adapter.mode === "recorded-sandbox" && typeof (adapter as Partial<RecordedMidtransAdapter>).setOrderState === "function";
}

export type AnyRulebookPack = HideSeekRulebookPack | ClaimRulebookPack;
export type AnyRulebookValidationResult = HideSeekRulebookValidationResult | ClaimRulebookValidationResult;

export type StoredRulebookRecord = {
  packId: string;
  version: number;
  format: RulebookFormat;
  isOfficial: boolean;
  status: PackVersionStatus;
  ownerHash: string;
  pack: AnyRulebookPack;
  snapshot: GeoSnapshot;
  updatedAt: number;
  publishedAt: number | null;
  reviewNote: string | null;
  pausedReason: string | null;
};

type PublicCardExample = { title: string; description: string; kind: HideSeekCardCategory | "tactical" };

export type HideSeekPublicListing = {
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
  headStartMs: number;
  searchLimitMs: number;
  objectiveResponseMs: number;
  photoResponseMs: number;
  drawDecisionMs: number;
  regroupPolicy: HideSeekRulebookPack["session"]["regroupPolicy"];
  stationCount: number;
  startName: string;
  questionFamilies: { family: string; itemCount: number; drawCount: number; keepCount: number }[];
  deckSummary: { totalCards: number; timeBonuses: number; powerups: number; curses: number; baseHandLimit: number };
  cardExamples: PublicCardExample[];
  publishedAt: number;
};

export type ClaimPublicListing = {
  packId: string;
  version: number;
  format: "claim-the-city";
  isOfficial: boolean;
  status: "published";
  title: string;
  byline: string;
  summary: string;
  cityLabel: string;
  difficulty: ClaimRulebookPack["meta"]["difficulty"];
  priceIdr: number;
  minPlayers: number;
  maxPlayers: number;
  teamMode: string;
  durationMinutes: number;
  durationMs: number;
  checkInRadiusMeters: number;
  claimWeight: number;
  lockWeight: number;
  soloTargets: ClaimRulebookPack["session"]["soloTargets"] | null;
  startName: string;
  zones: { id: string; name: string; label: string; landmarkCount: number }[];
  landmarkCount: number;
  challengePrimitives: string[];
  tacticalDeckSummary: { enabled: boolean; totalCards: number; maxHandSize: number; drawTriggers: ClaimRulebookPack["tacticalDeck"]["drawTriggers"] };
  cardExamples: PublicCardExample[];
  publishedAt: number;
};

export type RulebookPublicListing = HideSeekPublicListing | ClaimPublicListing;

export type RoomStreamEvent =
  | { type: "rev"; stateRev: number; now: number }
  | ({ type: "presence" } & ClaimPresenceEvent);

function isClaimSoloSession(match: ClaimEngineMatch): boolean {
  return match.mode === undefined ? match.seats.length === 1 : match.mode === "solo";
}

function effectiveOpponentTracking(match: ClaimEngineMatch): {
  mode: ClaimOpponentTrackingMode;
  intervalMs: number;
} {
  if (isClaimSoloSession(match)) {
    return { mode: "off", intervalMs: PRESENCE_DEFAULT_INTERVAL_MS };
  }
  const configured = match.pack.session.opponentTracking;
  const mode: ClaimOpponentTrackingMode = configured?.mode ?? "periodic_gps";
  const intervalMs = Math.max(PRESENCE_MIN_PING_MS, configured?.intervalMs ?? PRESENCE_DEFAULT_INTERVAL_MS);
  return { mode, intervalMs };
}

function deriveNearestZoneId(match: ClaimEngineMatch, coord: GeoCoordinate): string | undefined {
  const landmarks = match.pack.geography.landmarks;
  if (landmarks.length === 0) return undefined;
  let best = landmarks[0];
  let bestDist = haversineMeters(coord, best);
  for (let i = 1; i < landmarks.length; i++) {
    const d = haversineMeters(coord, landmarks[i]);
    if (d < bestDist) {
      best = landmarks[i];
      bestDist = d;
    }
  }
  return best.zoneId;
}

export type RulebookRoomPass = {
  passId: string;
  orderId: string | null;
  entitlementId?: string;
  roomCode: string;
  packId: string;
  version: number;
  format: RulebookFormat;
  maxPlayers: number;
  mode?: RulebookPlayMode;
  minPlayers?: number;
  paid: boolean;
  createdAt: number;
};

type RulebookOrder = PackOrderSummary & { mode?: RulebookPlayMode };

function catalogOrderId(buyerHash: string, packId: string, version: number, mode: RulebookPlayMode | undefined, requestId: string) {
  return `KRB-${digest(JSON.stringify([buyerHash, packId, version, mode, requestId])).slice(0, 30)}`;
}

function supportsMode(pack: AnyRulebookPack, mode?: RulebookPlayMode): boolean {
  if (!mode) return true;
  return mode === "solo"
    ? pack.meta.format === "claim-the-city" && pack.session.minPlayers === 1
    : pack.session.maxPlayers >= 2;
}

function isClaimPack(pack: AnyRulebookPack): pack is ClaimRulebookPack {
  return pack.meta.format === "claim-the-city";
}

function validateAnyPack(pack: AnyRulebookPack, snapshot: GeoSnapshot): AnyRulebookValidationResult {
  return isClaimPack(pack)
    ? validateClaimRulebook(pack, snapshot)
    : validateHideSeekRulebook(pack, snapshot);
}

export function toPublicSeekListing(record: StoredRulebookRecord): HideSeekPublicListing {
  const pack = record.pack as HideSeekRulebookPack;
  const { snapshot } = record;
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
  const cardExamples = new Map<HideSeekCardCategory, PublicCardExample>();
  for (const card of pack.deck.cards) {
    if (card.category === "time_bonus") timeBonuses += card.copies;
    else if (card.category === "powerup") powerups += card.copies;
    else curses += card.copies;
    if (card.copies > 0 && !cardExamples.has(card.category)) {
      cardExamples.set(card.category, { title: card.title, description: card.description, kind: card.category });
    }
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
    headStartMs: pack.timers.headStartMs,
    searchLimitMs: pack.timers.searchLimitMs,
    objectiveResponseMs: pack.timers.objectiveResponseMs,
    photoResponseMs: pack.timers.photoResponseMs,
    drawDecisionMs: pack.timers.drawDecisionMs,
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
    cardExamples: [...cardExamples.values()],
    publishedAt: record.publishedAt ?? record.updatedAt,
  };
}

export function toPublicClaimListing(record: StoredRulebookRecord): ClaimPublicListing {
  const pack = record.pack as ClaimRulebookPack;
  const { snapshot } = record;
  const primitives = new Set<string>();
  for (const list of Object.values(pack.challenges.landmarkChallenges)) {
    for (const item of list) primitives.add(item.payload.primitive);
  }
  for (const item of pack.challenges.challengeHandPool ?? []) {
    primitives.add(item.payload.primitive);
  }
  const zones = pack.geography.zones.map((z) => ({
    id: z.id,
    name: z.name,
    label: z.label,
    landmarkCount: pack.geography.landmarks.filter((lm) => lm.zoneId === z.id).length,
  }));
  const totalCards = pack.tacticalDeck.cards.reduce((sum, c) => sum + c.copies, 0);
  const example = pack.tacticalDeck.enabled ? pack.tacticalDeck.cards.find(card => card.copies > 0) : undefined;
  return {
    packId: record.packId,
    version: record.version,
    format: "claim-the-city",
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
    teamMode: pack.session.teamMode,
    durationMinutes: Math.round(pack.session.durationMs / 60_000),
    durationMs: pack.session.durationMs,
    checkInRadiusMeters: pack.geography.checkInRadiusMeters,
    claimWeight: pack.claiming.claimWeight,
    lockWeight: pack.claiming.lockWeight,
    soloTargets: pack.session.soloTargets ?? null,
    startName: snapshot.startPoint.name,
    zones,
    landmarkCount: pack.geography.landmarks.length,
    challengePrimitives: [...primitives].sort(),
    tacticalDeckSummary: {
      enabled: pack.tacticalDeck.enabled,
      totalCards,
      maxHandSize: pack.tacticalDeck.maxHandSize,
      drawTriggers: pack.tacticalDeck.drawTriggers,
    },
    cardExamples: example ? [{ title: example.title, description: example.description, kind: "tactical" }] : [],
    publishedAt: record.publishedAt ?? record.updatedAt,
  };
}

export function rulebookStore(
  databasePath: string,
  options: { midtrans?: MidtransAdapter; officialPacksDir?: string; now?: () => number } = {},
) {
  if (databasePath !== ":memory:") mkdirSync(dirname(databasePath), { recursive: true });
  const db = new DatabaseSync(databasePath, { timeout: 5000 });
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = FULL;
    PRAGMA secure_delete = ON;
    PRAGMA foreign_keys = ON;
  `);
  const recaps = rulebookRecapStore(db);
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
    CREATE TABLE IF NOT EXISTS rulebook_entitlements (
      entitlement_id TEXT PRIMARY KEY,
      pack_id TEXT NOT NULL,
      order_id TEXT UNIQUE NOT NULL,
      owner_hash TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      UNIQUE (owner_hash, pack_id)
    );
    CREATE INDEX IF NOT EXISTS idx_rulebook_entitlements_owner_pack
      ON rulebook_entitlements (owner_hash, pack_id);
    CREATE TABLE IF NOT EXISTS rulebook_live_rooms (
      room_code TEXT PRIMARY KEY,
      format TEXT NOT NULL,
      state_rev INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      touch_seq INTEGER NOT NULL,
      payload TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS rulebook_room_photos (
      room_code TEXT NOT NULL REFERENCES rulebook_live_rooms(room_code) ON DELETE CASCADE,
      photo_id TEXT NOT NULL,
      bytes BLOB NOT NULL,
      created_at INTEGER NOT NULL,
      PRIMARY KEY (room_code, photo_id)
    );
    CREATE TABLE IF NOT EXISTS rulebook_catalog_rooms (
      request_key TEXT PRIMARY KEY,
      room_code TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS rulebook_pending_orders (
      order_id TEXT PRIMARY KEY,
      buyer_hash TEXT NOT NULL,
      expires_at INTEGER NOT NULL,
      payload TEXT NOT NULL
    );
  `);

  const officialSeekLoaded = loadOfficialSeekPacks(options.officialPacksDir);
  const officialClaimLoaded = loadOfficialClaimPacks(options.officialPacksDir);
  const upsertVersionStmt = db.prepare(`
    INSERT INTO rulebook_versions (pack_id, version, format, is_official, status, owner_hash, payload)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(pack_id, version) DO UPDATE SET
      format = excluded.format,
      is_official = excluded.is_official,
      status = excluded.status,
      owner_hash = excluded.owner_hash,
      payload = excluded.payload
  `);
  const getVersionStmt = db.prepare("SELECT payload FROM rulebook_versions WHERE pack_id = ? AND version = ?");
  const listVersionsStmt = db.prepare("SELECT payload FROM rulebook_versions ORDER BY is_official DESC, pack_id ASC, version DESC");
  const listVersionsByOwnerStmt = db.prepare("SELECT payload FROM rulebook_versions WHERE owner_hash = ? AND is_official = 0");
  const latestVersionStmt = db.prepare("SELECT payload FROM rulebook_versions WHERE pack_id = ? ORDER BY version DESC LIMIT 1");
  const upsertOrderStmt = db.prepare(`
    INSERT INTO rulebook_orders (order_id, buyer_hash, pack_id, version, payload)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(order_id) DO UPDATE SET
      buyer_hash = excluded.buyer_hash,
      pack_id = excluded.pack_id,
      version = excluded.version,
      payload = excluded.payload
  `);
  const getOrderStmt = db.prepare("SELECT payload, buyer_hash FROM rulebook_orders WHERE order_id = ?");
  const listOrdersStmt = db.prepare("SELECT payload FROM rulebook_orders ORDER BY order_id DESC");
  const migrateOrdersStmt = db.prepare("UPDATE rulebook_orders SET buyer_hash = ? WHERE buyer_hash = ?");
  const migratePendingOrdersStmt = db.prepare("UPDATE rulebook_pending_orders SET buyer_hash = ? WHERE buyer_hash = ?");
  const getEarningByOrderStmt = db.prepare("SELECT payload FROM rulebook_earnings WHERE order_id = ?");
  const insertEarningStmt = db.prepare("INSERT OR IGNORE INTO rulebook_earnings (earnings_entry_id, order_id, pack_id, version, payload) VALUES (?, ?, ?, ?, ?)");
  const listEarningsStmt = db.prepare("SELECT payload FROM rulebook_earnings ORDER BY earnings_entry_id DESC");
  const getPassByOrderStmt = db.prepare("SELECT payload FROM rulebook_passes WHERE order_id = ?");
  const getPassByCodeStmt = db.prepare("SELECT payload FROM rulebook_passes WHERE room_code = ?");
  const insertPassStmt = db.prepare("INSERT OR IGNORE INTO rulebook_passes (pass_id, order_id, room_code, payload) VALUES (?, ?, ?, ?)");

  const insertEntitlementStmt = db.prepare(`
    INSERT INTO rulebook_entitlements (entitlement_id, pack_id, order_id, owner_hash, created_at)
    VALUES (?, ?, ?, ?, ?)
  `);
  const getEntitlementByOrderStmt = db.prepare(
    "SELECT entitlement_id, pack_id, order_id, owner_hash, created_at FROM rulebook_entitlements WHERE order_id = ?",
  );
  const getEntitlementByOwnerPackStmt = db.prepare(
    "SELECT entitlement_id, pack_id, order_id, owner_hash, created_at FROM rulebook_entitlements WHERE owner_hash = ? AND pack_id = ? ORDER BY created_at DESC LIMIT 1",
  );
  const listEntitlementsByOwnerStmt = db.prepare(
    "SELECT entitlement_id, pack_id, order_id, created_at FROM rulebook_entitlements WHERE owner_hash = ? ORDER BY created_at DESC",
  );
  const transferEntitlementOwnerStmt = db.prepare(
    "UPDATE rulebook_entitlements SET owner_hash = ? WHERE entitlement_id = ?",
  );
  const deleteEntitlementByIdStmt = db.prepare(
    "DELETE FROM rulebook_entitlements WHERE entitlement_id = ?",
  );

  const getLiveRoomStmt = db.prepare("SELECT 1 FROM rulebook_live_rooms WHERE room_code = ?");
  const deleteLiveRoomStmt = db.prepare("DELETE FROM rulebook_live_rooms WHERE room_code = ?");
  const upsertLiveRoomStmt = db.prepare(`
    INSERT INTO rulebook_live_rooms (room_code, format, state_rev, updated_at, touch_seq, payload)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(room_code) DO UPDATE SET
      format = excluded.format,
      state_rev = excluded.state_rev,
      updated_at = excluded.updated_at,
      touch_seq = excluded.touch_seq,
      payload = excluded.payload
  `);
  const listLiveRoomsStmt = db.prepare("SELECT room_code, state_rev, touch_seq, payload FROM rulebook_live_rooms ORDER BY touch_seq ASC, updated_at ASC");
  const listRoomPhotosStmt = db.prepare("SELECT room_code, photo_id, bytes FROM rulebook_room_photos");
  const upsertRoomPhotoStmt = db.prepare(`
    INSERT INTO rulebook_room_photos (room_code, photo_id, bytes, created_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(room_code, photo_id) DO UPDATE SET
      bytes = excluded.bytes,
      created_at = excluded.created_at
  `);
  const deleteRoomPhotoStmt = db.prepare("DELETE FROM rulebook_room_photos WHERE room_code = ? AND photo_id = ?");
  const deleteAllRoomPhotosStmt = db.prepare("DELETE FROM rulebook_room_photos WHERE room_code = ?");
  const upsertCatalogRoomStmt = db.prepare(`
    INSERT INTO rulebook_catalog_rooms (request_key, room_code, created_at)
    VALUES (?, ?, ?)
    ON CONFLICT(request_key) DO UPDATE SET
      room_code = excluded.room_code,
      created_at = excluded.created_at
  `);
  const listCatalogRoomsStmt = db.prepare("SELECT request_key, room_code FROM rulebook_catalog_rooms");
  const upsertPendingOrderStmt = db.prepare(`
    INSERT INTO rulebook_pending_orders (order_id, buyer_hash, expires_at, payload)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(order_id) DO UPDATE SET
      buyer_hash = excluded.buyer_hash,
      expires_at = excluded.expires_at,
      payload = excluded.payload
  `);
  const deletePendingOrderStmt = db.prepare("DELETE FROM rulebook_pending_orders WHERE order_id = ?");
  const deleteExpiredPendingOrdersStmt = db.prepare("DELETE FROM rulebook_pending_orders WHERE expires_at <= ?");
  const listPendingOrdersStmt = db.prepare("SELECT order_id, buyer_hash, expires_at, payload FROM rulebook_pending_orders WHERE expires_at > ?");

  let txDepth = 0;
  let commitCallbacks: (() => void)[] = [];

  function onCommit(callback: () => void) {
    if (txDepth > 0) commitCallbacks.push(callback);
    else callback();
  }

  function transact<T>(fn: () => T): T {
    if (txDepth > 0) return fn();
    db.exec("BEGIN IMMEDIATE");
    txDepth++;
    commitCallbacks = [];
    let result: T;
    let callbacks: (() => void)[];
    try {
      result = fn();
      db.exec("COMMIT");
      callbacks = commitCallbacks;
      commitCallbacks = [];
    } catch (error) {
      commitCallbacks = [];
      db.exec("ROLLBACK");
      throw error;
    } finally {
      txDepth--;
    }
    for (const callback of callbacks) callback();
    return result;
  }

  const initNow = (options.now ?? Date.now)();
  const seedOfficial = (pack: AnyRulebookPack, snapshot: GeoSnapshot) => {
    const existing = getVersionStmt.get(pack.meta.packId, pack.meta.version) as { payload: string } | undefined;
    if (!existing) {
      const rec: StoredRulebookRecord = {
        packId: pack.meta.packId,
        version: pack.meta.version,
        format: pack.meta.format,
        isOfficial: true,
        status: "published",
        ownerHash: "official",
        pack,
        snapshot,
        updatedAt: initNow,
        publishedAt: initNow,
        reviewNote: null,
        pausedReason: null,
      };
      upsertVersionStmt.run(rec.packId, rec.version, rec.format, 1, rec.status, rec.ownerHash, JSON.stringify(rec));
    }
  };
  transact(() => {
    for (const { pack, snapshot } of officialSeekLoaded) seedOfficial(pack, snapshot);
    for (const { pack, snapshot } of officialClaimLoaded) seedOfficial(pack, snapshot);
  });

  function getRecord(packId: string, version: number): StoredRulebookRecord | undefined {
    const row = getVersionStmt.get(packId, version) as { payload: string } | undefined;
    return row ? (JSON.parse(row.payload) as StoredRulebookRecord) : undefined;
  }

  const liveRooms = new Map<string, LiveSession>();
  const roomSubscribers = new Map<string, Set<{ onEvent: (event: RoomStreamEvent) => void; onClose?: () => void }>>();
  const presenceMetaByRoom = new Map<string, Map<string, { lastPingAt: number; lastBroadcastAt: number }>>();
  const catalogRooms = new Map<string, string>();
  const pendingOrders = new Map<string, ReturnType<typeof createOrder>>();
  const pendingOrderRecords = new Map<string, { buyerHash: string; order: RulebookOrder }>();
  let touchSeq = 0;

  function emitRoomEvent(roomCode: string, event: RoomStreamEvent) {
    const subs = roomSubscribers.get(roomCode);
    if (!subs || subs.size === 0) return;
    for (const sub of [...subs]) {
      try {
        sub.onEvent(event);
      } catch {
        // Broken client streams must never disrupt committed room mutations.
      }
    }
  }

  function wipeClaimPresence(session: LiveClaimSession, now: number) {
    const roomCode = session.pass.roomCode;
    const hadPositions = session.seatPositions.size > 0;
    session.seatPositions.clear();
    presenceMetaByRoom.delete(roomCode);
    if (hadPositions) {
      onCommit(() => emitRoomEvent(roomCode, { type: "presence", positions: [], now }));
    }
  }

  // Rehydrate photos, active rooms, catalog room idempotency mappings, and unexpired pending orders.
  const photosByRoom = new Map<string, Map<string, Buffer>>();
  for (const row of listRoomPhotosStmt.all() as { room_code: string; photo_id: string; bytes: Uint8Array }[]) {
    let bucket = photosByRoom.get(row.room_code);
    if (!bucket) {
      bucket = new Map();
      photosByRoom.set(row.room_code, bucket);
    }
    bucket.set(row.photo_id, Buffer.from(row.bytes));
  }
  for (const row of listLiveRoomsStmt.all() as { room_code: string; state_rev: number; touch_seq: number; payload: string }[]) {
    if (row.touch_seq > touchSeq) touchSeq = row.touch_seq;
    const parsed = JSON.parse(row.payload) as SerializedLiveSession;
    const rec = getRecord(parsed.pass.packId, parsed.pass.version);
    if (!rec) continue;
    const roomPhotos = photosByRoom.get(row.room_code) ?? new Map<string, Buffer>();
    const session = deserializeLiveSession(parsed, rec.pack, rec.snapshot, roomPhotos);
    session.stateRev = Math.max(session.stateRev, row.state_rev);
    liveRooms.set(row.room_code, session);
  }
  for (const row of listCatalogRoomsStmt.all() as { request_key: string; room_code: string }[]) {
    if (liveRooms.has(row.room_code)) catalogRooms.set(row.request_key, row.room_code);
  }
  deleteExpiredPendingOrdersStmt.run(initNow);
  for (const row of listPendingOrdersStmt.all(initNow) as { order_id: string; buyer_hash: string; expires_at: number; payload: string }[]) {
    const order = JSON.parse(row.payload) as RulebookOrder;
    pendingOrderRecords.set(row.order_id, { buyerHash: row.buyer_hash, order });
    if (isRecordedAdapter(midtrans)) {
      midtrans.setOrderState(order.orderId, {
        grossAmountIdr: order.grossAmountIdr,
        currency: order.currency,
        transactionStatus: "pending",
        statusCode: "201",
        paymentType: "qris",
      });
    }
  }

  function persistLiveSession(session: LiveSession, now: number, bumpRev: boolean) {
    if (bumpRev) {
      session.stateRev += 1;
      const roomCode = session.pass.roomCode;
      const event: RoomStreamEvent = { type: "rev", stateRev: session.stateRev, now };
      onCommit(() => emitRoomEvent(roomCode, event));
    }
    if (session.match.outcome) {
      if (session.format === "claim-the-city") wipeClaimPresence(session, now);
      deleteAllRoomPhotos(session);
      deleteLiveRoomStmt.run(session.pass.roomCode);
      return;
    }
    const seq = ++touchSeq;
    upsertLiveRoomStmt.run(
      session.pass.roomCode,
      session.format,
      session.stateRev,
      now,
      seq,
      JSON.stringify(serializeLiveSession(session)),
    );
  }

  function saveRoomPhoto(session: LiveSession, photoId: string, bytes: Buffer, now: number) {
    upsertRoomPhotoStmt.run(session.pass.roomCode, photoId, bytes, now);
    session.photos.set(photoId, bytes);
  }

  function deleteRoomPhoto(session: LiveSession, photoId: string): boolean {
    const existed = session.photos.delete(photoId);
    deleteRoomPhotoStmt.run(session.pass.roomCode, photoId);
    return existed;
  }

  function deleteAllRoomPhotos(session: LiveSession): boolean {
    const existed = session.photos.size > 0;
    session.photos.clear();
    deleteAllRoomPhotosStmt.run(session.pass.roomCode);
    return existed;
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

  function latestRecord(packId: string): StoredRulebookRecord | undefined {
    const row = latestVersionStmt.get(packId) as { payload: string } | undefined;
    return row ? JSON.parse(row.payload) as StoredRulebookRecord : undefined;
  }

  function creatorStudio(creatorCredential: string) {
    const ownerHash = digest(creatorCredential);
    const versions = allRecords().filter(record => record.ownerHash === ownerHash && !record.isOfficial);
    const owned = new Set(versions.map(record => `${record.packId}@${record.version}`));
    const earnings = listEarnings().filter(entry => owned.has(`${entry.packId}@${entry.version}`));
    return { versions, earnings };
  }

  function listEarnings() {
    return (listEarningsStmt.all() as { payload: string }[]).map(row => JSON.parse(row.payload) as PackEarningsEntry);
  }

  function listPublicListings(format?: RulebookFormat, everyVersion = false): RulebookPublicListing[] {
    const officialSeekIds = new Set<string>();
    const published = allRecords().filter((r) => r.status === "published" && (!format || r.format === format));
    if (everyVersion) published.sort((a, b) => (b.publishedAt ?? b.updatedAt) - (a.publishedAt ?? a.updatedAt)
      || a.packId.localeCompare(b.packId) || b.version - a.version);
    return published
      .filter((r) => {
        if (everyVersion || !r.isOfficial || r.format !== "hide-and-seek") return true;
        if (officialSeekIds.has(r.packId)) return false;
        officialSeekIds.add(r.packId);
        return true;
      })
      .map((r) => (r.format === "claim-the-city" ? toPublicClaimListing(r) : toPublicSeekListing(r)));
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
    const ownerHash = digest(creatorCredential);
    const previous = latestRecord(overrides.packId);
    if (previous && (previous.isOfficial || previous.ownerHash !== ownerHash || previous.format !== template.format)) {
      return { ok: false, error: "pack-unavailable" };
    }
    const nextVersion = (previous?.version ?? 0) + 1;
    const clonedPack: AnyRulebookPack = {
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
    } as AnyRulebookPack;
    const record: StoredRulebookRecord = {
      packId: overrides.packId,
      version: nextVersion,
      format: template.format,
      isOfficial: false,
      status: "draft",
      ownerHash,
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
    pack: AnyRulebookPack,
    snapshot: GeoSnapshot,
    now: number,
    options?: { rehashSnapshot?: boolean },
  ): { ok: true; record: StoredRulebookRecord; validation: AnyRulebookValidationResult } | { ok: false; error: string } {
    if (!pack?.meta?.packId) return { ok: false, error: "invalid-metadata" };
    if (pack.meta.isOfficial) return { ok: false, error: "cannot-author-official-pack" };
    const ownerHash = digest(creatorCredential);
    const existing = getRecord(pack.meta.packId, pack.meta.version);
    if (existing && (existing.ownerHash !== ownerHash || (existing.status !== "draft" && existing.status !== "changes-requested"))) {
      return { ok: false, error: "version-immutable" };
    }
    const previous = existing ?? latestRecord(pack.meta.packId);
    if (previous && (previous.isOfficial || previous.ownerHash !== ownerHash || previous.format !== pack.meta.format)) {
      return { ok: false, error: "pack-unavailable" };
    }
    const version = existing?.version ?? (previous?.version ?? 0) + 1;
    const normalizedSnapshot: GeoSnapshot = options?.rehashSnapshot
      ? { ...snapshot, hash: computeGeoSnapshotHash(snapshot) }
      : snapshot;
    const normalizedPack = {
      ...pack,
      meta: { ...pack.meta, version, isOfficial: false },
      geography: options?.rehashSnapshot
        ? { ...pack.geography, geoSnapshotHash: normalizedSnapshot.hash }
        : pack.geography,
    } as AnyRulebookPack;
    const validation = validateAnyPack(normalizedPack, normalizedSnapshot);
    const record: StoredRulebookRecord = {
      packId: normalizedPack.meta.packId,
      version,
      format: normalizedPack.meta.format,
      isOfficial: false,
      status: "draft",
      ownerHash,
      pack: normalizedPack,
      snapshot: normalizedSnapshot,
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
  ): { ok: true; record: StoredRulebookRecord } | { ok: false; error: string; validation?: AnyRulebookValidationResult } {
    const rec = getRecord(packId, version);
    if (!rec || rec.isOfficial) return { ok: false, error: "not-found" };
    if (rec.ownerHash !== digest(creatorCredential)) return { ok: false, error: "owner-only" };
    if (rec.status !== "draft" && rec.status !== "changes-requested") return { ok: false, error: "invalid-status" };
    const validation = validateAnyPack(rec.pack, rec.snapshot);
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
  ): { ok: true; record: StoredRulebookRecord } | { ok: false; error: string; validation?: AnyRulebookValidationResult } {
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
      const validation = validateAnyPack(rec.pack, rec.snapshot);
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

  type EntitlementRow = {
    entitlement_id: string;
    pack_id: string;
    order_id: string;
    owner_hash?: string;
    created_at: number;
  };

  function findActiveRoomForEntitlement(entitlementId: string, orderId: string, currentNow: number): string | null {
    for (const session of [...liveRooms.values()].reverse()) {
      const matchesEntitlement =
        session.pass.entitlementId === entitlementId ||
        (session.pass.orderId !== null && session.pass.orderId === orderId);
      if (!matchesEntitlement) continue;
      const ts = roomTime(session.pass.roomCode, currentNow);
      if (session.format === "claim-the-city") {
        syncClaimReadState(session, ts);
      } else {
        syncSeekReadState(session, ts);
      }
      if (!session.match.outcome) return session.pass.roomCode;
    }
    return null;
  }

  function listEntitlements(credential: string, currentNow: number): RulebookEntitlementSummary[] {
    const ownerHash = digest(credential);
    const rows = listEntitlementsByOwnerStmt.all(ownerHash) as EntitlementRow[];
    return rows.map((row) => ({
      packId: row.pack_id,
      orderId: row.order_id,
      purchasedAt: row.created_at,
      activeRoomCode: findActiveRoomForEntitlement(row.entitlement_id, row.order_id, currentNow),
    }));
  }

  function getCallerOwnership(credential: string, currentNow: number): {
    ownedPackIds: string[];
    entitlements: RulebookEntitlementSummary[];
  } {
    const entitlements = listEntitlements(credential, currentNow);
    const ownedPackIds = [...new Set(entitlements.map((entry) => entry.packId))];
    return { ownedPackIds, entitlements };
  }

  function instantiateRoom(
    rec: StoredRulebookRecord,
    hostCredentialHash: string,
    hostName: string,
    now: number,
    orderId: string | null = null,
    qa = false,
    mode?: RulebookPlayMode,
    entitlementId: string | null = null,
  ): LiveSession {
    return transact(() => {
      const prefix = rec.format === "claim-the-city" ? "RC" : "RB";
      let roomCode: string;
      do {
        roomCode = `${prefix}-${randomBytes(3).toString("hex").toUpperCase()}`;
      } while (
        liveRooms.has(roomCode) ||
        getPassByCodeStmt.get(roomCode) ||
        getLiveRoomStmt.get(roomCode) ||
        recaps.has(roomCode)
      );
      const passId = `pass-${randomBytes(5).toString("hex")}`;
      const pass: RulebookRoomPass = {
        passId,
        orderId,
        ...(entitlementId ? { entitlementId } : {}),
        roomCode,
        packId: rec.packId,
        version: rec.version,
        format: rec.format,
        maxPlayers: mode === "solo" ? 1 : rec.pack.session.maxPlayers,
        ...(mode ? { mode, minPlayers: mode === "group" ? Math.max(2, rec.pack.session.minPlayers) : 1 } : {}),
        paid: orderId !== null || entitlementId !== null,
        createdAt: now,
      };

      let session: LiveSession;
      if (rec.format === "claim-the-city") {
        const claimPack = rec.pack as ClaimRulebookPack;
        const match = createClaimEngineMatch({
          code: roomCode,
          mode,
          pack: claimPack,
          snapshot: rec.snapshot,
          hostSeatId: "seat-1",
          hostName,
          hostCredentialHash,
        });
        session = {
          format: "claim-the-city",
          pass,
          match,
          photos: new Map(),
          seatPositions: new Map(),
          activity: createRoomActivity(),
          stateRev: 1,
        };
      } else {
        const seekPack = rec.pack as HideSeekRulebookPack;
        const match = createSeekEngineMatch({
          code: roomCode,
          pack: seekPack,
          snapshot: rec.snapshot,
          hostSeatId: "seat-1",
          hostName,
          hostCredentialHash,
        });
        const deck = createSeekDeckState(seekPack);
        session = {
          format: "hide-and-seek",
          pass,
          match,
          deck,
          photos: new Map(),
          appliedDeckActions: new Map(),
          activity: createRoomActivity(),
          ...(qa ? { qa: { offsetMs: 0, advances: new Set<string>() } } : {}),
          stateRev: 1,
        };
      }

      if (!qa) insertPassStmt.run(pass.passId, pass.orderId, pass.roomCode, JSON.stringify(pass));
      persistLiveSession(session, now, false);
      onCommit(() => liveRooms.set(roomCode, session));
      return session;
    });
  }

  function createOwnedRoomFromRulebook(
    packId: string,
    version: number,
    hostCredential: string,
    hostName: string,
    now: number,
    mode?: RulebookPlayMode,
    requestId?: string,
    qa = false,
  ):
    | { ok: true; roomCode: string; pass: RulebookRoomPass; room: SeekEngineRoomView | ClaimEngineRoomView }
    | { ok: false; error: string; roomCode?: string } {
    const rec = getRecord(packId, version);
    if (!rec || rec.status !== "published") return { ok: false, error: "pack-unavailable" };
    if (qa && rec.format !== "hide-and-seek") return { ok: false, error: "seek-qa-only" };
    if (!supportsMode(rec.pack, mode)) return { ok: false, error: "mode-unavailable" };
    const hostHash = digest(hostCredential);
    const entitlement = getEntitlementByOwnerPackStmt.get(hostHash, packId) as EntitlementRow | undefined;
    if (!entitlement) return { ok: false, error: "payment-required" };
    const requestKey = requestId ? JSON.stringify([hostHash, packId, version, mode, qa, requestId]) : undefined;
    const previousCode = requestKey && catalogRooms.get(requestKey);
    const previous = previousCode ? liveRooms.get(previousCode) : undefined;
    if (previous) {
      const room =
        previous.format === "claim-the-city"
          ? viewClaimEngineMatch(previous.match, "seat-1", now)
          : viewSeekEngineMatch(previous.match, "seat-1", now);
      return { ok: true, roomCode: previous.pass.roomCode, pass: previous.pass, room };
    }
    const activeRoomCode = findActiveRoomForEntitlement(entitlement.entitlement_id, entitlement.order_id, now);
    if (activeRoomCode) {
      return { ok: false, error: "entitlement-active-room-exists", roomCode: activeRoomCode };
    }
    const session = transact(() => {
      const created = instantiateRoom(rec, hostHash, hostName, now, null, qa, mode, entitlement.entitlement_id);
      if (requestKey) {
        upsertCatalogRoomStmt.run(requestKey, created.pass.roomCode, now);
        onCommit(() => catalogRooms.set(requestKey, created.pass.roomCode));
      }
      return created;
    });
    const room =
      session.format === "claim-the-city"
        ? viewClaimEngineMatch(session.match, "seat-1", now)
        : viewSeekEngineMatch(session.match, "seat-1", now);
    return { ok: true, roomCode: session.pass.roomCode, pass: session.pass, room };
  }

  function createFreeRoomFromRulebook(
    packId: string,
    version: number,
    hostCredential: string,
    hostName: string,
    now: number,
    qa = false,
    mode?: RulebookPlayMode,
    requestId?: string,
  ):
    | { ok: true; roomCode: string; pass: RulebookRoomPass; room: SeekEngineRoomView | ClaimEngineRoomView }
    | { ok: false; error: string; roomCode?: string } {
    const rec = getRecord(packId, version);
    if (!rec || rec.status !== "published") return { ok: false, error: "pack-unavailable" };
    if (rec.pack.meta.priceIdr > 0) {
      const hostHash = digest(hostCredential);
      if (getEntitlementByOwnerPackStmt.get(hostHash, packId)) {
        return createOwnedRoomFromRulebook(packId, version, hostCredential, hostName, now, mode, requestId, qa);
      }
      return { ok: false, error: "payment-required" };
    }
    if (qa && rec.format !== "hide-and-seek") return { ok: false, error: "seek-qa-only" };
    if (!supportsMode(rec.pack, mode)) return { ok: false, error: "mode-unavailable" };
    const hostHash = digest(hostCredential);
    const requestKey = requestId ? JSON.stringify([hostHash, packId, version, mode, qa, requestId]) : undefined;
    const previousCode = requestKey && catalogRooms.get(requestKey);
    const previous = previousCode ? liveRooms.get(previousCode) : undefined;
    const session = previous ?? transact(() => {
      const created = instantiateRoom(rec, hostHash, hostName, now, null, qa, mode);
      if (requestKey) {
        upsertCatalogRoomStmt.run(requestKey, created.pass.roomCode, now);
        onCommit(() => catalogRooms.set(requestKey, created.pass.roomCode));
      }
      return created;
    });
    const room =
      session.format === "claim-the-city"
        ? viewClaimEngineMatch(session.match, "seat-1", now)
        : viewSeekEngineMatch(session.match, "seat-1", now);
    return { ok: true, roomCode: session.pass.roomCode, pass: session.pass, room };
  }

  async function createOrder(
    buyerCredential: string,
    packId: string,
    version: number,
    now: number,
    mode?: RulebookPlayMode,
    requestId?: string,
  ): Promise<{ ok: true; order: RulebookOrder } | { ok: false; error: string }> {
    const buyerHash = digest(buyerCredential);
    const orderId = requestId
      ? catalogOrderId(buyerHash, packId, version, mode, requestId)
      : `KRB-${now}-${randomBytes(3).toString("hex").toUpperCase()}`;
    const cachedPending = pendingOrderRecords.get(orderId);
    if (cachedPending && cachedPending.buyerHash === buyerHash && cachedPending.order.expiresAt > now) {
      return { ok: true, order: cachedPending.order };
    }
    const existing = getOrderStmt.get(orderId) as { payload: string; buyer_hash: string } | undefined;
    if (existing?.buyer_hash === buyerHash) return { ok: true, order: JSON.parse(existing.payload) as RulebookOrder };
    const pending = pendingOrders.get(orderId);
    if (pending) return pending;
    const rec = getRecord(packId, version);
    if (!rec || rec.status !== "published") return { ok: false, error: "pack-unavailable" };
    if (rec.pack.meta.priceIdr <= 0) return { ok: false, error: "pack-is-free" };
    if (!supportsMode(rec.pack, mode)) return { ok: false, error: "mode-unavailable" };
    if (getEntitlementByOwnerPackStmt.get(buyerHash, packId)) {
      return { ok: false, error: "pack-already-owned" };
    }
    const task = createProviderOrder(rec, orderId, buyerHash, now, mode);
    pendingOrders.set(orderId, task);
    try {
      return await task;
    } finally {
      pendingOrders.delete(orderId);
    }
  }

  function viewCatalogOrder(credential: string, packId: string, version: number, mode: RulebookPlayMode, requestId: string) {
    const buyerHash = digest(credential);
    const orderId = catalogOrderId(buyerHash, packId, version, mode, requestId);
    const row = getOrderStmt.get(orderId) as { payload: string; buyer_hash: string } | undefined;
    return row?.buyer_hash === buyerHash ? JSON.parse(row.payload) as RulebookOrder : undefined;
  }

  async function createProviderOrder(
    rec: StoredRulebookRecord, orderId: string, buyerHash: string, now: number, mode?: RulebookPlayMode,
  ): Promise<{ ok: true; order: RulebookOrder } | { ok: false; error: string }> {
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

    const order: RulebookOrder = {
      orderId,
      packId: rec.packId,
      version: rec.version,
      title: rec.pack.meta.title,
      byline: rec.pack.meta.byline,
      players: mode === "solo" || (rec.pack.session.minPlayers === 1 && rec.pack.session.maxPlayers === 1) ? 1 : 2,
      ...(mode ? { mode } : {}),
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
    const encoded = JSON.stringify(order);
    transact(() => {
      upsertOrderStmt.run(orderId, buyerHash, rec.packId, rec.version, encoded);
      upsertPendingOrderStmt.run(orderId, buyerHash, order.expiresAt, encoded);
      onCommit(() => pendingOrderRecords.set(orderId, { buyerHash, order }));
    });
    return { ok: true, order };
  }

  async function settleVerifiedOrder(
    orderId: string,
    hostCredential: string | undefined,
    hostName: string,
    notification: Partial<MidtransNotificationPayload> | undefined,
    now: number,
  ): Promise<
    | {
        ok: true;
        duplicate: boolean;
        order: PackOrderSummary;
        pass?: RulebookRoomPass;
        entitlement?: RulebookEntitlementSummary;
      }
    | { ok: false; error: string }
  > {
    const row = getOrderStmt.get(orderId) as { payload: string; buyer_hash: string } | undefined;
    if (!row || (hostCredential !== undefined && digest(hostCredential) !== row.buyer_hash)) {
      return { ok: false, error: "order-not-found" };
    }
    const order = JSON.parse(row.payload) as RulebookOrder;
    if (hostCredential === undefined || notification?.signature_key) {
      if (!notification?.signature_key || !midtrans.verifySignature({
        order_id: orderId,
        status_code: notification.status_code ?? "200",
        gross_amount: notification.gross_amount ?? `${order.grossAmountIdr}.00`,
        signature_key: notification.signature_key,
      })) return { ok: false, error: "invalid-signature" };
    }

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
      transact(() => {
        order.status = "expired";
        upsertOrderStmt.run(orderId, row.buyer_hash, order.packId, order.version, JSON.stringify(order));
        deletePendingOrderStmt.run(orderId);
        onCommit(() => pendingOrderRecords.delete(orderId));
      });
      return { ok: false, error: "order-expired" };
    }

    if (!notification?.signature_key && isRecordedAdapter(midtrans) && notification?.transaction_status) {
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
    const isSettled = status.transactionStatus === "settlement" ||
      (status.transactionStatus === "capture" && (status.fraudStatus === undefined || status.fraudStatus === "accept"));
    if (!isSettled) return {
      ok: false,
      error: status.transactionStatus === "capture" ? "payment-review" : `payment-${status.transactionStatus}`,
    };

    return transact(() => {
      const freshRow = getOrderStmt.get(orderId) as { payload: string; buyer_hash: string } | undefined;
      if (!freshRow) return { ok: false as const, error: "order-not-found" };
      const freshOrder = JSON.parse(freshRow.payload) as RulebookOrder;
      if (freshOrder.status === "settled") {
        const passRow = getPassByOrderStmt.get(orderId) as { payload: string } | undefined;
        return {
          ok: true as const,
          duplicate: true,
          order: freshOrder,
          pass: passRow ? (JSON.parse(passRow.payload) as RulebookRoomPass) : undefined,
        };
      }
      const rec = getRecord(freshOrder.packId, freshOrder.version);
      if (!rec) return { ok: false as const, error: "pack-not-found" };

      const existingEntitlement = (getEntitlementByOrderStmt.get(orderId) ??
        getEntitlementByOwnerPackStmt.get(freshRow.buyer_hash, rec.packId)) as EntitlementRow | undefined;
      let entitlementId = existingEntitlement?.entitlement_id;
      if (!entitlementId) {
        entitlementId = `ent-${randomBytes(6).toString("hex")}`;
        insertEntitlementStmt.run(
          entitlementId,
          rec.packId,
          orderId,
          freshRow.buyer_hash,
          now,
        );
      }

      const existingPassRow = getPassByOrderStmt.get(orderId) as { payload: string } | undefined;
      const pass = existingPassRow
        ? (JSON.parse(existingPassRow.payload) as RulebookRoomPass)
        : instantiateRoom(rec, freshRow.buyer_hash, hostName, now, orderId, false, freshOrder.mode, entitlementId).pass;

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
            grossAmountIdr: freshOrder.grossAmountIdr,
            platformFeeIdr: freshOrder.platformFeeIdr,
            creatorShareIdr: freshOrder.creatorShareIdr,
            settledAt: now,
            paymentMode: midtrans.mode,
            sandbox: true,
          };
      if (!existingEarningRow) {
        insertEarningStmt.run(earning.earningsEntryId, orderId, rec.packId, rec.version, JSON.stringify(earning));
      }

      freshOrder.status = "settled";
      freshOrder.settledAt = now;
      freshOrder.passId = pass.passId;
      freshOrder.roomCode = pass.roomCode;
      freshOrder.earningsEntryId = earning.earningsEntryId;
      upsertOrderStmt.run(orderId, freshRow.buyer_hash, freshOrder.packId, freshOrder.version, JSON.stringify(freshOrder));
      deletePendingOrderStmt.run(orderId);
      onCommit(() => pendingOrderRecords.delete(orderId));
      const entitlement: RulebookEntitlementSummary = {
        packId: rec.packId,
        orderId,
        purchasedAt: existingEntitlement?.created_at ?? now,
        activeRoomCode: pass.roomCode,
      };
      return {
        ok: true as const,
        duplicate: false,
        order: freshOrder,
        pass,
        entitlement,
      };
    });
  }

  function migrateOwner(
    fromCredential: string,
    toCredential: string,
    now: number,
  ): { migrated: boolean; entitlements: number; drafts: number; recaps: number; rooms: number } {
    const fromHash = digest(fromCredential);
    const toHash = digest(toCredential);
    if (fromHash === toHash) {
      return { migrated: false, entitlements: 0, drafts: 0, recaps: 0, rooms: 0 };
    }
    return transact(() => {
      let entitlements = 0;
      const guestEntitlements = listEntitlementsByOwnerStmt.all(fromHash) as EntitlementRow[];
      for (const row of guestEntitlements) {
        const alreadyOwned = getEntitlementByOwnerPackStmt.get(toHash, row.pack_id) as EntitlementRow | undefined;
        if (alreadyOwned) {
          deleteEntitlementByIdStmt.run(row.entitlement_id);
        } else {
          transferEntitlementOwnerStmt.run(toHash, row.entitlement_id);
          entitlements += 1;
        }
      }

      let drafts = 0;
      const guestVersions = (listVersionsByOwnerStmt.all(fromHash) as { payload: string }[]).map(
        (row) => JSON.parse(row.payload) as StoredRulebookRecord,
      );
      for (const rec of guestVersions) {
        rec.ownerHash = toHash;
        saveRecord(rec);
        drafts += 1;
      }

      const migratedOrders = Number(migrateOrdersStmt.run(toHash, fromHash).changes);
      migratePendingOrdersStmt.run(toHash, fromHash);
      onCommit(() => {
        for (const [id, entry] of pendingOrderRecords) {
          if (entry.buyerHash === fromHash) {
            pendingOrderRecords.set(id, { ...entry, buyerHash: toHash });
          }
        }
      });

      const migratedRecaps = recaps.migrateParticipant(fromHash, toHash);

      let rooms = 0;
      for (const session of liveRooms.values()) {
        const seats = session.match.seats;
        const alreadyInRoom = seats.some((s) => s.credentialHash === toHash);
        let roomChanged = false;
        for (const seat of seats) {
          if (seat.credentialHash === fromHash && !alreadyInRoom) {
            seat.credentialHash = toHash;
            roomChanged = true;
          }
        }
        if (roomChanged) {
          persistLiveSession(session, now, false);
          rooms += 1;
        }
      }

      const migrated = entitlements > 0 || drafts > 0 || migratedOrders > 0 || migratedRecaps > 0 || rooms > 0;
      return { migrated, entitlements, drafts, recaps: migratedRecaps, rooms };
    });
  }

  function joinRoom(
    roomCode: string,
    credential: string,
    name: string,
    now: number,
  ): { ok: true; seatId: string; room: SeekEngineRoomView | ClaimEngineRoomView } | { ok: false; error: string } {
    const session = liveRooms.get(roomCode);
    if (!session) return { ok: false, error: "room-not-found" };
    const credHash = digest(credential);
    if (session.format === "claim-the-city") {
      const existingSeat = findClaimEngineSeat(session.match, credHash);
      if (existingSeat) {
        touchLiveRoom(roomCode, session);
        return { ok: true, seatId: existingSeat, room: viewClaimEngineMatch(session.match, existingSeat, now) };
      }
      const nextSeatId = `seat-${session.match.seats.length + 1}`;
      const joined = joinClaimEngineMatch(session.match, { seatId: nextSeatId, name, credentialHash: credHash });
      if (!joined.ok) return joined;
      transact(() => persistLiveSession(session, now, true));
      touchLiveRoom(roomCode, session);
      return { ok: true, seatId: nextSeatId, room: viewClaimEngineMatch(session.match, nextSeatId, now) };
    }
    const existingSeat = findSeekEngineSeat(session.match, credHash);
    if (existingSeat) {
      touchLiveRoom(roomCode, session);
      return { ok: true, seatId: existingSeat, room: viewSeekEngineMatch(session.match, existingSeat, now) };
    }
    const nextSeatId = `seat-${session.match.seats.length + 1}`;
    const joined = joinSeekEngineMatch(session.match, { seatId: nextSeatId, name, credentialHash: credHash });
    if (!joined.ok) return joined;
    transact(() => persistLiveSession(session, now, true));
    touchLiveRoom(roomCode, session);
    return { ok: true, seatId: nextSeatId, room: viewSeekEngineMatch(session.match, nextSeatId, now) };
  }

  function actInRoom(
    roomCode: string,
    credential: string,
    action: SeekEngineAction | ClaimEngineAction,
    now: number,
    photo?: { id: string; bytes: Buffer },
  ): SeekEngineActionReply | ClaimEngineActionReply | { error: string } {
    const session = liveRooms.get(roomCode);
    if (!session) return { error: "room-not-found" };
    const credHash = digest(credential);
    if (session.format === "claim-the-city") {
      const seatId = findClaimEngineSeat(session.match, credHash);
      if (!seatId) return { error: "not-a-member" };
      const claimAction = action as ClaimEngineAction;
      const photoId = claimAction.type === "submit-challenge" || claimAction.type === "submit-curse-photo"
        ? claimAction.photoId : undefined;
      const replay = session.match.appliedActions.has(`${seatId}:${claimAction.actionId}`);
      if (!replay && photoId !== undefined && photoId !== photo?.id) return { error: "photo-required" };
      return transact(() => {
        const exp = expireClaimEngineMatch(session.match, now);
        const reply = applyClaimEngineAction(session.match, seatId, claimAction, now);
        const actChanged = session.activity.observeClaim(session.match, now);
        const pending = pendingClaimPhotos(session);
        let photoChanged = false;
        if (!replay && !reply.error && photo && pending.has(photo.id)) {
          saveRoomPhoto(session, photo.id, photo.bytes, now);
          photoChanged = true;
        }
        if (pruneClaimPhotos(session, pending)) photoChanged = true;
        const recapChanged = captureCompletedMatch(session);
        if (
          !replay &&
          !reply.error &&
          claimAction.type === "check-in-landmark" &&
          !session.match.outcome &&
          session.match.phase === "active" &&
          effectiveOpponentTracking(session.match).mode !== "off"
        ) {
          const seat = session.match.seats.find((s) => s.seatId === seatId);
          const lmDef = session.match.pack.geography.landmarks.find((l) => l.id === claimAction.landmarkId);
          if (seat && lmDef) {
            session.seatPositions.set(seatId, {
              seatId: seat.seatId,
              name: seat.name,
              teamId: seat.teamId,
              latitude: lmDef.latitude,
              longitude: lmDef.longitude,
              at: now,
              source: "checkin",
              zoneId: lmDef.zoneId,
            });
            const snapshotPositions = [...session.seatPositions.values()];
            onCommit(() => emitRoomEvent(roomCode, { type: "presence", positions: snapshotPositions, now }));
          }
        }
        if ((!replay && !reply.error) || exp.changed || actChanged || photoChanged || recapChanged) {
          persistLiveSession(session, now, true);
        }
        if (session.match.outcome) {
          wipeClaimPresence(session, now);
        }
        const tracking = effectiveOpponentTracking(session.match);
        reply.room.opponentTracking = tracking;
        if (session.match.phase === "active" && !session.match.outcome && tracking.mode !== "off") {
          reply.room.seatPositions = [...session.seatPositions.values()];
        }
        return reply;
      });
    }
    const seatId = findSeekEngineSeat(session.match, credHash);
    if (!seatId) return { error: "not-a-member" };
    const seekAction = action as SeekEngineAction;
    const replay = session.match.appliedActions.has(`${seatId}:${seekAction.actionId}`);
    if (!replay && seekAction.type === "answer-question" && seekAction.photoId && seekAction.photoId !== photo?.id) {
      return { error: "photo-required" };
    }
    return transact(() => {
      const deckExp = expireSeekDeckAndCurses(session.deck, session.match, now);
      const prevTurn = session.match.turnNumber;
      const roomExp = expireRoomPhotos(session, now);
      const reply = applySeekEngineAction(session.match, seatId, seekAction, now);
      if (replay) {
        if (deckExp.changed || roomExp.changed || roomExp.photoChanged || roomExp.recapChanged) {
          persistLiveSession(session, now, true);
        }
        return reply;
      }
      let photoChanged = roomExp.photoChanged;
      for (const id of reply.purgedPhotoIds ?? []) {
        if (deleteRoomPhoto(session, id)) photoChanged = true;
      }
      if (!reply.error && photo) {
        saveRoomPhoto(session, photo.id, photo.bytes, now);
        photoChanged = true;
      }
      if (session.match.outcome && deleteAllRoomPhotos(session)) photoChanged = true;
      if (!reply.error && seekAction.type === "ask") {
        onSeekerQuestionAskedForCurses(session.deck, session.match, now);
      }
      if (!reply.error && reply.earnedDrawBatches?.length) {
        enqueueSeekDrawBatches(session.deck, session.match, reply.earnedDrawBatches, now);
      }
      if (session.match.turnNumber !== prevTurn) {
        session.deck = createSeekDeckState(session.match.pack);
      }
      const actChanged = session.activity.observeSeek(session.match, session.deck, now);
      const recapChanged = captureCompletedMatch(session);
      if (!reply.error || deckExp.changed || roomExp.changed || photoChanged || actChanged || roomExp.recapChanged || recapChanged) {
        persistLiveSession(session, now, true);
      }
      return reply;
    });
  }

  function previewSeekQuestion(roomCode: string, credential: string, request: SeekMapPreviewRequest, now: number) {
    const session = liveRooms.get(roomCode);
    if (session?.format !== "hide-and-seek") return { error: "room-not-found" };
    const seatId = findSeekEngineSeat(session.match, digest(credential));
    if (!seatId) return { error: "not-a-member" };
    return previewSeekEngineQuestion(session.match, seatId, request, now);
  }

  function roomTime(roomCode: string, now: number): number {
    const session = liveRooms.get(roomCode);
    return now + (session?.format === "hide-and-seek" ? session.qa?.offsetMs ?? 0 : 0);
  }

  function qaLocation(roomCode: string, credential: string, locationId: string, now: number): LocationFix | undefined {
    const session = liveRooms.get(roomCode);
    if (session?.format !== "hide-and-seek" || !session.qa || !findSeekEngineSeat(session.match, digest(credential))) {
      return undefined;
    }
    const { match } = session;
    const point = [match.regroupPoint, match.turnStartPoint, match.snapshot.startPoint, ...match.snapshot.stations]
      .find(checkpoint => checkpoint?.id === locationId);
    return point ? { latitude: point.latitude, longitude: point.longitude, accuracy: 10, timestamp: now } : undefined;
  }

  function advanceQaClock(
    roomCode: string,
    credential: string,
    actionId: string,
    step: "minute" | "five-minutes" | "phase-end",
    expectedDeadline: unknown,
    now: number,
  ) {
    const session = liveRooms.get(roomCode);
    if (session?.format !== "hide-and-seek" || !session.qa) return { error: "qa-room-required" };
    const { match, qa } = session;
    const seatId = findSeekEngineSeat(match, digest(credential));
    if (!match.seats.some(seat => seat.isHost && seat.seatId === seatId)) return { error: "qa-host-only" };
    if (qa.advances.has(actionId)) return { ok: true };

    return transact(() => {
      const current = now + qa.offsetMs;
      const beforeRoom = expireRoomPhotos(session, current);
      const beforeDeck = expireSeekDeckAndCurses(session.deck, match, current);
      if (match.phaseEndsAt === null) {
        if (beforeRoom.changed || beforeRoom.photoChanged || beforeRoom.recapChanged || beforeDeck.changed) {
          persistLiveSession(session, current, true);
        }
        return { error: "qa-no-active-clock" };
      }
      if (step === "phase-end" && expectedDeadline !== match.phaseEndsAt) {
        if (beforeRoom.changed || beforeRoom.photoChanged || beforeRoom.recapChanged || beforeDeck.changed) {
          persistLiveSession(session, current, true);
        }
        return { error: "qa-deadline-changed" };
      }
      const delta = step === "phase-end" ? match.phaseEndsAt - current : step === "minute" ? 60_000 : 300_000;
      qa.offsetMs += delta;
      qa.advances.add(actionId);
      const advanced = now + qa.offsetMs;
      expireRoomPhotos(session, advanced);
      expireSeekDeckAndCurses(session.deck, match, advanced);
      session.activity.observeSeek(match, session.deck, advanced);
      captureCompletedMatch(session);
      persistLiveSession(session, advanced, true);
      return { ok: true };
    });
  }

  function captureCompletedMatch(session: LiveSession): boolean {
    const { match } = session;
    if (session.recapSaved || !match.outcome || match.startedAt === null) return false;
    const first = match.seats[0];
    if (!first) return false;
    const recap = session.format === "claim-the-city"
      ? claimMatchRecap(viewClaimEngineMatch(session.match, first.seatId, match.outcome.at),
          new Map(session.match.pack.geography.landmarks.map(landmark => [landmark.id, landmark.name])))
      : seekMatchRecap(viewSeekEngineMatch(session.match, first.seatId, match.outcome.at), Boolean(session.qa));
    if (!recap) return false;
    recaps.save(recap, match.seats.map(seat => seat.credentialHash));
    session.recapSaved = true;
    return true;
  }

  function expireRoomPhotos(
    session: LiveSeekSession,
    now: number,
  ): { changed: boolean; photoChanged: boolean; recapChanged: boolean } {
    const { changed, purgedPhotoIds } = expireSeekEngineMatch(session.match, now);
    let photoChanged = false;
    for (const id of purgedPhotoIds) {
      if (deleteRoomPhoto(session, id)) photoChanged = true;
    }
    if (session.match.outcome && deleteAllRoomPhotos(session)) photoChanged = true;
    const actChanged = session.activity.observeSeek(session.match, session.deck, now);
    const recapChanged = captureCompletedMatch(session);
    return { changed: changed || actChanged, photoChanged, recapChanged };
  }

  function syncClaimReadState(session: LiveClaimSession, now: number): boolean {
    const exp = expireClaimEngineMatch(session.match, now);
    const pending = pendingClaimPhotos(session);
    const stalePhotos = [...session.photos.keys()].filter((id) => !pending.has(id));
    const needsRecap = !session.recapSaved && Boolean(session.match.outcome) && session.match.startedAt !== null;
    const actChanged = session.activity.observeClaim(session.match, now);
    if (!exp.changed && stalePhotos.length === 0 && !needsRecap && !actChanged) return false;
    transact(() => {
      for (const id of stalePhotos) deleteRoomPhoto(session, id);
      captureCompletedMatch(session);
      persistLiveSession(session, now, true);
    });
    return true;
  }

  function syncSeekReadState(session: LiveSeekSession, now: number): boolean {
    const matchExp = expireSeekEngineMatch(session.match, now);
    const deckExp = expireSeekDeckAndCurses(session.deck, session.match, now);
    const actChanged = session.activity.observeSeek(session.match, session.deck, now);
    const shouldPurgeAll = Boolean(session.match.outcome) && session.photos.size > 0;
    const needsRecap = !session.recapSaved && Boolean(session.match.outcome) && session.match.startedAt !== null;
    if (!matchExp.changed && matchExp.purgedPhotoIds.length === 0 && !deckExp.changed && !actChanged && !shouldPurgeAll && !needsRecap) {
      return false;
    }
    transact(() => {
      for (const id of matchExp.purgedPhotoIds) deleteRoomPhoto(session, id);
      if (shouldPurgeAll) deleteAllRoomPhotos(session);
      captureCompletedMatch(session);
      persistLiveSession(session, now, true);
    });
    return true;
  }

  async function answerSeekPhoto(
    roomCode: string, credential: string, questionId: string, actionId: string, encoded: string, now: () => number,
  ) {
    const session = liveRooms.get(roomCode);
    if (!session || session.format !== "hide-and-seek") return { error: "room-not-found" };
    const seatId = findSeekEngineSeat(session.match, digest(credential));
    if (!seatId || seatId !== activeHiderSeatId(session.match)) return { error: "hider-only" };
    const question = session.match.questions.find(q => q.id === questionId && q.family === "photo");
    if (!question) return { error: "question-closed" };
    const action: SeekEngineAction = { type: "answer-question", actionId, questionId, photoId: questionId };
    if (session.match.appliedActions.has(`${seatId}:${actionId}`)) return actInRoom(roomCode, credential, action, now());
    if (question.status !== "pending" || question.deadline <= now()) return { error: "question-closed" };
    let bytes: Buffer;
    try {
      bytes = await sanitizeSeekPhoto(encoded);
    } catch {
      return { error: "invalid-photo" };
    }
    if (session.match.questions.find(q => q.id === questionId) !== question || question.status !== "pending") {
      if (session.match.appliedActions.has(`${seatId}:${actionId}`)) return actInRoom(roomCode, credential, action, now());
      return { error: "question-closed" };
    }
    return actInRoom(roomCode, credential, action, now(), { id: questionId, bytes });
  }

  function pendingClaimPhotos(session: LiveClaimSession) {
    const { match } = session;
    if (match.phase !== "active") return new Set<string>();
    return new Set([
      ...Object.values(match.activeAttemptsBySeat).flatMap(attempt => attempt?.pendingPhoto ? [attempt.pendingPhoto.photoId] : []),
      ...match.deck.activeCurses.flatMap(curse => curse.pendingPhoto ? [curse.pendingPhoto.photoId] : []),
    ]);
  }

  function pruneClaimPhotos(session: LiveClaimSession, pending = pendingClaimPhotos(session)): boolean {
    let changed = false;
    for (const id of [...session.photos.keys()]) {
      if (!pending.has(id) && deleteRoomPhoto(session, id)) changed = true;
    }
    return changed;
  }

  async function submitClaimPhoto(
    roomCode: string, credential: string, actionId: string, encoded: string,
    target: { landmarkId: string } | { curseInstanceId: string }, now: () => number,
  ) {
    const session = liveRooms.get(roomCode);
    if (!session || session.format !== "claim-the-city") return { error: "room-not-found" };
    const seatId = findClaimEngineSeat(session.match, digest(credential));
    if (!seatId) return { error: "not-a-member" };
    const photoId = randomUUID();
    const action: ClaimEngineAction = "landmarkId" in target
      ? { type: "submit-challenge", actionId, photoId, landmarkId: target.landmarkId }
      : { type: "submit-curse-photo", actionId, photoId, curseInstanceId: target.curseInstanceId };
    if (session.match.appliedActions.has(`${seatId}:${actionId}`)) return actInRoom(roomCode, credential, action, now());
    let bytes: Buffer;
    try {
      bytes = await sanitizeSeekPhoto(encoded);
    } catch {
      return { error: "invalid-photo" };
    }
    return actInRoom(roomCode, credential, action, now(), { id: photoId, bytes });
  }

  function viewRoomPhoto(roomCode: string, credential: string, photoId: string, now: number) {
    const session = liveRooms.get(roomCode);
    if (!session) return undefined;
    if (session.format === "claim-the-city") {
      const seatId = findClaimEngineSeat(session.match, digest(credential));
      if (!seatId) return undefined;
      syncClaimReadState(session, now);
      if (!session.photos.has(photoId)) return undefined;
      const room = viewClaimEngineMatch(session.match, seatId, now);
      const eligible = room.pendingRivalPhotoReviews.some(review => review.photoId === photoId) ||
        room.activeCurses.some(curse => curse.casterSeatId === seatId && curse.pendingPhoto?.photoId === photoId);
      return eligible ? session.photos.get(photoId) : undefined;
    }
    if (!findSeekEngineSeat(session.match, digest(credential))) return undefined;
    syncSeekReadState(session, now);
    return session.photos.get(photoId);
  }

  function playCardInRoom(
    roomCode: string,
    credential: string,
    params: PlaySeekCardParams,
    now: number,
    actionId?: string,
  ): { ok: boolean; error?: string; [key: string]: unknown } {
    const session = liveRooms.get(roomCode);
    if (!session || session.format !== "hide-and-seek") return { ok: false, error: "room-not-found" };
    const seatId = findSeekEngineSeat(session.match, digest(credential));
    if (!seatId || seatId !== activeHiderSeatId(session.match)) {
      return { ok: false, error: "hider-only" };
    }
    const dedupKey = actionId && actionId.length > 0 && actionId.length <= 100
      ? `${seatId}:${session.match.turnNumber}:play-card:${actionId}`
      : undefined;
    if (dedupKey) {
      const cached = session.appliedDeckActions.get(dedupKey);
      if (cached) return cached;
    }
    return transact(() => {
      const roomExp = expireRoomPhotos(session, now);
      const deckExp = expireSeekDeckAndCurses(session.deck, session.match, now);
      const result = playSeekDeckCard(session.deck, session.match, params, now);
      const actChanged = session.activity.observeSeek(session.match, session.deck, now);
      if (dedupKey && result.ok) session.appliedDeckActions.set(dedupKey, result);
      if (result.ok || roomExp.changed || roomExp.photoChanged || roomExp.recapChanged || deckExp.changed || actChanged) {
        persistLiveSession(session, now, true);
      }
      return result;
    });
  }

  function deckActionInRoom(
    roomCode: string,
    credential: string,
    action: Record<string, unknown>,
    now: number,
  ): { ok: boolean; error?: string; [key: string]: unknown } {
    const session = liveRooms.get(roomCode);
    if (!session || session.format !== "hide-and-seek") return { ok: false, error: "room-not-found" };
    const seatId = findSeekEngineSeat(session.match, digest(credential));
    if (!seatId) return { ok: false, error: "not-a-member" };
    const isHider = seatId === activeHiderSeatId(session.match);
    const kind = String(action.kind ?? "");
    const actionId = typeof action.actionId === "string" && action.actionId.length > 0 && action.actionId.length <= 100
      ? action.actionId : undefined;
    const dedupKey = actionId ? `${seatId}:${session.match.turnNumber}:deck:${kind}:${actionId}` : undefined;
    if (dedupKey) {
      const cached = session.appliedDeckActions.get(dedupKey);
      if (cached) return cached;
    }
    const runDeckAction = (fn: () => { ok: boolean; error?: string; [key: string]: unknown }) => transact(() => {
      const roomExp = expireRoomPhotos(session, now);
      const deckExp = expireSeekDeckAndCurses(session.deck, session.match, now);
      const res = fn();
      const actChanged = session.activity.observeSeek(session.match, session.deck, now);
      if (dedupKey && res.ok) session.appliedDeckActions.set(dedupKey, res);
      if (res.ok || roomExp.changed || roomExp.photoChanged || roomExp.recapChanged || deckExp.changed || actChanged) {
        persistLiveSession(session, now, true);
      }
      return res;
    });
    if (kind === "choose-draw") {
      if (!isHider) return { ok: false, error: "hider-only" };
      const keepInstanceIds = Array.isArray(action.keepInstanceIds) ? action.keepInstanceIds.map(String) : [];
      const discardInstanceIds = Array.isArray(action.discardInstanceIds) ? action.discardInstanceIds.map(String) : undefined;
      return runDeckAction(() => chooseSeekDrawCards(session.deck, session.match, { keepInstanceIds, discardInstanceIds }, now));
    }
    if (kind === "review-curse-photo") {
      if (!isHider) return { ok: false, error: "hider-only" };
      return runDeckAction(() => reviewCursePhotoProof(
        session.deck,
        session.match,
        { curseInstanceId: String(action.curseInstanceId ?? ""), approve: Boolean(action.approve) },
        now,
      ));
    }
    if (kind === "clear-curse-gps") {
      if (isHider) return { ok: false, error: "seeker-only" };
      return runDeckAction(() => clearCurseByGpsDetour(
        session.deck,
        session.match,
        String(action.curseInstanceId ?? ""),
        action.fix as LocationFix,
        now,
      ));
    }
    if (kind === "submit-curse-photo") {
      if (isHider) return { ok: false, error: "seeker-only" };
      return runDeckAction(() => submitCursePhotoProof(
        session.deck,
        session.match,
        { curseInstanceId: String(action.curseInstanceId ?? ""), seatId, photoId: String(action.photoId ?? "") },
        now,
      ));
    }
    if (kind === "clear-curse-honor") {
      if (isHider) return { ok: false, error: "seeker-only" };
      return runDeckAction(() => clearCurseByHonorTask(session.deck, session.match, String(action.curseInstanceId ?? ""), now));
    }
    if (kind === "buyout-curse") {
      if (isHider) return { ok: false, error: "seeker-only" };
      return runDeckAction(() => buyoutSeekCurse(session.deck, session.match, String(action.curseInstanceId ?? ""), now));
    }
    return { ok: false, error: "unknown-deck-action" };
  }

  function touchLiveRoom(roomCode: string, session: LiveSession) {
    liveRooms.delete(roomCode);
    liveRooms.set(roomCode, session);
  }

  function viewRoom(
    roomCode: string,
    credential: string,
    now: number,
    options: { includeBoard?: boolean } = {},
  ) {
    const includeBoard = options.includeBoard !== false;
    const session = liveRooms.get(roomCode);
    if (!session) return undefined;
    const credHash = digest(credential);
    if (session.format === "claim-the-city") {
      const seatId = findClaimEngineSeat(session.match, credHash);
      if (!seatId) return undefined;
      touchLiveRoom(roomCode, session);
      syncClaimReadState(session, now);
      if (session.match.outcome) wipeClaimPresence(session, now);
      const room = viewClaimEngineMatch(session.match, seatId, now);
      const tracking = effectiveOpponentTracking(session.match);
      room.opponentTracking = tracking;
      if (session.match.phase === "active" && !session.match.outcome && tracking.mode !== "off") {
        room.seatPositions = [...session.seatPositions.values()];
      }
      return {
        format: "claim-the-city" as const,
        stateRev: session.stateRev,
        room,
        activity: session.activity.viewClaim(room),
        ...(includeBoard
          ? {
              publicBoard: {
                startPoint: session.match.snapshot.startPoint,
                landmarks: session.match.pack.geography.landmarks.map((l) => ({
                  id: l.id,
                  name: l.name,
                  zoneId: l.zoneId,
                  latitude: l.latitude,
                  longitude: l.longitude,
                  transitSummary: l.transitSummary,
                  accessNotes: l.accessNotes,
                })),
              },
            }
          : {}),
        pass: session.pass,
      };
    }
    const seatId = findSeekEngineSeat(session.match, credHash);
    if (!seatId) return undefined;
    touchLiveRoom(roomCode, session);
    syncSeekReadState(session, now);
    const room = viewSeekEngineMatch(session.match, seatId, now);
    const deck = viewSeekDeck(session.deck, room.role === "hider");
    return {
      format: "hide-and-seek" as const,
      ...(session.qa ? { qa: true as const } : {}),
      stateRev: session.stateRev,
      room,
      deck,
      activity: session.activity.viewSeek(room, deck),
      ...(includeBoard
        ? {
            publicBoard: {
              startPoint: session.match.snapshot.startPoint,
              boundaryPolygon: session.match.snapshot.boundaryPolygon,
              pois: session.match.snapshot.pois.map(({ id, name }) => ({ id, name })),
              stations: session.match.snapshot.stations
                .filter((s) => s.eligibleHidingAnchor)
                .map((s) => ({
                  id: s.id,
                  name: s.name,
                  latitude: s.latitude,
                  longitude: s.longitude,
                  transitLines: s.transitLines,
                })),
            },
          }
        : {}),
      pass: session.pass,
    };
  }

  function updateClaimPresence(
    roomCode: string,
    credential: string,
    fix: LocationFix,
    now: number,
  ):
    | { ok: true; position: ClaimSeatPosition; broadcast: boolean; now: number }
    | { ok: false; status: 400 | 404 | 429; error: string; retryAfterMs?: number } {
    const session = liveRooms.get(roomCode);
    if (!session || session.format !== "claim-the-city") {
      return { ok: false, status: 404, error: "room-not-found" };
    }
    const credHash = digest(credential);
    const seatId = findClaimEngineSeat(session.match, credHash);
    if (!seatId) {
      return { ok: false, status: 404, error: "room-not-found" };
    }
    syncClaimReadState(session, now);
    if (session.match.outcome || session.match.phase !== "active") {
      if (session.match.outcome) wipeClaimPresence(session, now);
      return { ok: false, status: 400, error: "room-not-active" };
    }
    const tracking = effectiveOpponentTracking(session.match);
    if (tracking.mode !== "periodic_gps") {
      return { ok: false, status: 400, error: "presence-disabled" };
    }
    const valid = verifyGpsFreshAndAccurate(fix, now, session.match.pack.geography);
    if (!valid.ok) {
      return { ok: false, status: 400, error: valid.error };
    }
    const seat = session.match.seats.find((s) => s.seatId === seatId);
    if (!seat) {
      return { ok: false, status: 404, error: "room-not-found" };
    }
    let roomMeta = presenceMetaByRoom.get(roomCode);
    if (!roomMeta) {
      roomMeta = new Map();
      presenceMetaByRoom.set(roomCode, roomMeta);
    }
    const prevMeta = roomMeta.get(seatId);
    if (prevMeta && now - prevMeta.lastPingAt < PRESENCE_MIN_PING_MS) {
      return {
        ok: false,
        status: 429,
        error: "presence-rate-limited",
        retryAfterMs: PRESENCE_MIN_PING_MS - (now - prevMeta.lastPingAt),
      };
    }

    const existing = session.seatPositions.get(seatId);
    const movedMeters = existing ? haversineMeters(existing, fix) : Infinity;
    const position: ClaimSeatPosition = {
      seatId: seat.seatId,
      name: seat.name,
      teamId: seat.teamId,
      latitude: fix.latitude,
      longitude: fix.longitude,
      at: now,
      source: "gps",
      zoneId: deriveNearestZoneId(session.match, fix),
    };
    session.seatPositions.set(seatId, position);

    const elapsedSinceBroadcast = prevMeta ? now - prevMeta.lastBroadcastAt : Infinity;
    const shouldBroadcast =
      !existing ||
      existing.source !== "gps" ||
      movedMeters >= PRESENCE_MIN_MOVE_METERS ||
      elapsedSinceBroadcast >= tracking.intervalMs;

    roomMeta.set(seatId, {
      lastPingAt: now,
      lastBroadcastAt: shouldBroadcast ? now : (prevMeta?.lastBroadcastAt ?? now),
    });

    if (shouldBroadcast) {
      emitRoomEvent(roomCode, {
        type: "presence",
        positions: [...session.seatPositions.values()],
        now,
      });
    }

    return { ok: true, position, broadcast: shouldBroadcast, now };
  }

  function listActiveRooms(credential: string, currentNow: number): ActiveRulebookRoomSummary[] {
    const credHash = digest(credential);
    const active: ActiveRulebookRoomSummary[] = [];
    for (const session of [...liveRooms.values()].reverse()) {
      const code = session.pass.roomCode;
      const ts = roomTime(code, currentNow);
      if (session.format === "claim-the-city") {
        const seatId = findClaimEngineSeat(session.match, credHash);
        if (!seatId) continue;
        syncClaimReadState(session, ts);
        const room = viewClaimEngineMatch(session.match, seatId, ts);
        if ((room.phase !== "lobby" && room.phase !== "active") || room.outcome) continue;
        active.push({
          roomCode: room.code,
          format: "claim-the-city",
          packId: room.packMeta.packId,
          version: room.packMeta.version,
          title: room.packMeta.title,
          phase: room.phase,
          role: room.isSolo ? "solo" : "group",
          playerCount: room.seats.length,
          maxPlayers: session.pass.maxPlayers,
        });
      } else {
        const seatId = findSeekEngineSeat(session.match, credHash);
        if (!seatId) continue;
        syncSeekReadState(session, ts);
        const room = viewSeekEngineMatch(session.match, seatId, ts);
        if (
          (room.phase !== "lobby" &&
            room.phase !== "head_start" &&
            room.phase !== "seeking" &&
            room.phase !== "endgame" &&
            room.phase !== "regroup") ||
          room.outcome
        ) {
          continue;
        }
        active.push({
          roomCode: room.code,
          format: "hide-and-seek",
          packId: room.packMeta.packId,
          version: room.packMeta.version,
          title: room.packMeta.title,
          phase: room.phase,
          role: room.role,
          turnNumber: room.turnNumber,
          totalPlannedTurns: room.totalPlannedTurns,
          playerCount: room.seats.length,
          maxPlayers: session.pass.maxPlayers,
        });
      }
    }
    return active;
  }

  function subscribeRoom(
    roomCode: string,
    credential: string,
    now: number,
    onEvent: (event: RoomStreamEvent) => void,
    onClose?: () => void,
  ):
    | { ok: true; stateRev: number; now: number; presence?: ClaimPresenceEvent; unsubscribe: () => void }
    | { ok: false; error: "room-not-found" | "not-a-member" } {
    const session = liveRooms.get(roomCode);
    if (!session) return { ok: false, error: "room-not-found" };
    const credHash = digest(credential);
    const seatId = session.format === "claim-the-city"
      ? findClaimEngineSeat(session.match, credHash)
      : findSeekEngineSeat(session.match, credHash);
    if (!seatId) return { ok: false, error: "not-a-member" };
    const roomNow = roomTime(roomCode, now);
    if (session.format === "claim-the-city") syncClaimReadState(session, roomNow);
    else syncSeekReadState(session, roomNow);
    let subs = roomSubscribers.get(roomCode);
    if (!subs) {
      subs = new Set();
      roomSubscribers.set(roomCode, subs);
    }
    const entry = { onEvent, onClose };
    subs.add(entry);
    let removed = false;
    const unsubscribe = () => {
      if (removed) return;
      removed = true;
      const bucket = roomSubscribers.get(roomCode);
      if (!bucket) return;
      bucket.delete(entry);
      if (bucket.size === 0) roomSubscribers.delete(roomCode);
    };
    const presence: ClaimPresenceEvent | undefined =
      session.format === "claim-the-city" &&
      session.match.phase === "active" &&
      !session.match.outcome &&
      effectiveOpponentTracking(session.match).mode !== "off"
        ? { positions: [...session.seatPositions.values()], now: roomNow }
        : undefined;
    return { ok: true, stateRev: session.stateRev, now: roomNow, ...(presence ? { presence } : {}), unsubscribe };
  }

  async function seedGeoFromOfficialFixture(request: GeoSeedRequest): Promise<GeoSnapshot> {
    const baseSnapshot = officialSeekLoaded[officialSeekLoaded.length - 1]?.snapshot;
    if (!baseSnapshot) throw new Error("No official geo fixture loaded");
    const provider = createFixtureGeoSeedProvider(baseSnapshot);
    return seedAndFreezeGeoSnapshot(request, provider);
  }

  return {
    listPublicListings,
    listActiveRooms,
    listEntitlements,
    getCallerOwnership,
    listAllVersions: allRecords,
    listRecaps: (participant: string) => recaps.list(digest(participant)),
    readRecap: (matchId: string, participant: string) => recaps.get(matchId, digest(participant)),
    readRecapDetail: (matchId: string, participant: string) => recaps.getWithShare(matchId, digest(participant)),
    shareRecap: (matchId: string, participant: string, options: ShareRecapOptions, at: number) =>
      recaps.share(matchId, digest(participant), options, at),
    unshareRecap: (matchId: string, participant: string) => recaps.unshare(matchId, digest(participant)),
    readPublicRecap: (shareId: string) => recaps.getPublic(shareId),
    listPublicRecaps: (packId?: string, editionVersion?: number) => recaps.listPublic(packId, editionVersion),
    creatorStudio,
    listOrders: () => (listOrdersStmt.all() as { payload: string }[]).map((r) => JSON.parse(r.payload) as PackOrderSummary),
    listEarnings,
    getPassByRoomCode: (roomCode: string) => {
      const row = getPassByCodeStmt.get(roomCode) as { payload: string } | undefined;
      return row ? (JSON.parse(row.payload) as RulebookRoomPass) : undefined;
    },
    cloneOfficialTemplate,
    saveDraft,
    submitDraft,
    reviewVersion,
    createFreeRoomFromRulebook,
    createOwnedRoomFromRulebook,
    migrateOwner,
    createOrder,
    viewCatalogOrder,
    settleVerifiedOrder,
    joinRoom,
    actInRoom,
    updateClaimPresence,
    answerSeekPhoto,
    submitClaimPhoto,
    viewRoomPhoto,
    playCardInRoom,
    deckActionInRoom,
    viewRoom,
    subscribeRoom,
    roomTime,
    previewSeekQuestion,
    qaLocation,
    advanceQaClock,
    seedGeoFromOfficialFixture,
    close: () => {
      for (const subs of [...roomSubscribers.values()]) {
        for (const sub of [...subs]) {
          try {
            sub.onClose?.();
          } catch {
            // Ignore stream close errors during shutdown.
          }
        }
      }
      roomSubscribers.clear();
      presenceMetaByRoom.clear();
      db.close();
    },
  };
}
