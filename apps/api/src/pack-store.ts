import { createHash, randomBytes } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import type {
  DuoRoom,
  PackAction,
  PackClosureReport,
  PackDraftPayload,
  PackEarningsEntry,
  PackOrderSummary,
  PackPublicCheckpoint,
  PackPublicListing,
  PackRole,
  PackTaskInput,
  PackVersionDetail,
  PackWorkspaceReply,
} from "@kelana-ria/contracts";
import type { DuoFixture } from "./duo-rules.js";
import {
  createMidtransAdapterFromEnv,
  parseMidtransIdrAmount,
  type MidtransAdapter,
  type MidtransNotificationPayload,
  type RecordedMidtransAdapter,
  type RedactedMidtransLifecycleEvent,
} from "./midtrans-adapter.js";
import {
  COMPACT_BOARD_VERSION,
  compactCatalog,
  compactWalkingSnapshot,
  type CompactBoardCatalog,
  type ReviewedTask,
  type SoloFixture,
  type WalkingRouteSnapshot,
} from "./solo-fixture.js";
import { validateSoloFixture } from "./solo-validation.js";

type StoredVersion = PackVersionDetail & {
  ownerHash: string;
};

type StoredOrder = PackOrderSummary & {
  buyerHash: string;
};

type StoredPass = {
  passId: string;
  orderId: string;
  roomCode: string;
  packId: string;
  version: number;
  players: 1 | 2;
  createdAt: number;
};

type PackResponse = {
  status: number;
  body: PackWorkspaceReply;
};

export type MidtransWebhookResponse = {
  status: number;
  body: {
    ok?: boolean;
    duplicate?: boolean;
    order?: PackOrderSummary;
    passId?: string | null;
    roomCode?: string | null;
    earningsEntryId?: string | null;
    error?: string;
  };
};

export type PackStoreOptions = {
  catalog?: CompactBoardCatalog;
  routes?: WalkingRouteSnapshot | null;
  closedCheckpoints?: Iterable<string> | (() => Iterable<string>);
  midtrans?: MidtransAdapter;
  unlockPaidRoom?: (
    fixture: DuoFixture,
    passId: string,
    paidPack: NonNullable<DuoRoom["paidPack"]>,
  ) => string;
};

const PLATFORM_FEE_RATE = 0.15;
const ORDER_TTL_MS = 15 * 60_000;

function digest(credential: string) {
  return createHash("sha256").update(credential).digest("hex");
}

function isNonEmptyString(value: unknown, minLength = 1): value is string {
  return typeof value === "string" && value.trim().length >= minLength;
}

function isRecordedAdapter(adapter: MidtransAdapter): adapter is RecordedMidtransAdapter {
  return adapter.mode === "recorded-sandbox" && typeof (adapter as Partial<RecordedMidtransAdapter>).setOrderState === "function";
}

function validateTasksSyntax(
  tasks: PackTaskInput[],
  catalog: CompactBoardCatalog,
): { ok: true } | { ok: false; error: string } {
  if (!Array.isArray(tasks) || tasks.length === 0) {
    return { ok: false, error: "invalid-tasks" };
  }
  const seen = new Set<string>();
  for (const task of tasks) {
    if (!task || !isNonEmptyString(task.checkpointId)) {
      return { ok: false, error: "unknown-checkpoint" };
    }
    if (seen.has(task.checkpointId)) {
      return { ok: false, error: "duplicate-checkpoint" };
    }
    seen.add(task.checkpointId);
    if (!catalog.checkpoints[task.checkpointId]) {
      return { ok: false, error: "unknown-checkpoint" };
    }
    if (!isNonEmptyString(task.question, 8)) {
      return { ok: false, error: "unsupported-challenge" };
    }
    if (!isNonEmptyString(task.verificationNotes, 8)) {
      return { ok: false, error: "verification-notes-required" };
    }
    if (!Array.isArray(task.choices) || task.choices.length < 2) {
      return { ok: false, error: "unsupported-challenge" };
    }
    const choiceIds = new Set<string>();
    for (const choice of task.choices) {
      if (!choice || !isNonEmptyString(choice.id) || !isNonEmptyString(choice.label)) {
        return { ok: false, error: "unsupported-challenge" };
      }
      if (choiceIds.has(choice.id)) {
        return { ok: false, error: "unsupported-challenge" };
      }
      choiceIds.add(choice.id);
    }
    if (!isNonEmptyString(task.correctChoiceId) || !choiceIds.has(task.correctChoiceId)) {
      return { ok: false, error: "unreviewed-answer" };
    }
  }
  return { ok: true };
}

export function validatePackVersionForPublication(
  version: PackVersionDetail,
  {
    catalog = compactCatalog,
    routes = compactWalkingSnapshot,
    closedCheckpoints = [],
  }: {
    catalog?: CompactBoardCatalog;
    routes?: WalkingRouteSnapshot | null;
    closedCheckpoints?: Iterable<string>;
  } = {},
): { ok: true } | { ok: false; error: string } {
  if (!isNonEmptyString(version.byline, 2) || !isNonEmptyString(version.title, 3)) {
    return { ok: false, error: "invalid-metadata" };
  }
  if (version.board !== "compact" || version.format !== "claim-the-city") {
    return { ok: false, error: "invalid-configuration" };
  }
  if (
    !Array.isArray(version.supportedPlayers) ||
    version.supportedPlayers.length === 0 ||
    !version.supportedPlayers.every((p) => p === 1 || p === 2)
  ) {
    return { ok: false, error: "invalid-configuration" };
  }
  if (!Number.isFinite(version.priceIdr) || version.priceIdr < 1_000) {
    return { ok: false, error: "invalid-price" };
  }

  const syntax = validateTasksSyntax(version.tasks, catalog);
  if (!syntax.ok) return syntax;

  // Build a board catalog with the creator's reviewed tasks and validate through the official edition validator.
  const creatorTasksRecord: Record<string, ReviewedTask> = {};
  const fixtureTasks: SoloFixture["tasks"] = {};
  const checkpoints = [];

  for (const task of version.tasks) {
    const point = catalog.checkpoints[task.checkpointId];
    if (!point) return { ok: false, error: "unknown-checkpoint" };
    checkpoints.push({ ...point });
    const challenge = {
      checkpointId: task.checkpointId,
      prompt: task.question.trim(),
      choices: task.choices.map((c) => ({ id: c.id, label: c.label.trim() })),
    };
    creatorTasksRecord[task.checkpointId] = {
      siteId: task.checkpointId,
      reviewed: true,
      reviewedAt: new Date(version.updatedAt).toISOString().slice(0, 10),
      challenge,
      correctChoiceId: task.correctChoiceId,
    };
    fixtureTasks[task.checkpointId] = {
      siteId: task.checkpointId,
      reviewed: true,
      challenge,
      correctChoiceId: task.correctChoiceId,
    };
  }

  const packCatalog: CompactBoardCatalog = {
    ...catalog,
    tasks: {
      ...catalog.tasks,
      ...creatorTasksRecord,
    },
  };

  const candidateFixture: SoloFixture = {
    edition: {
      id: `${version.packId}-v${version.version}`,
      board: "compact",
      boardVersion: version.boardVersion,
      format: "claim-the-city",
      players: 1,
      origin: "prepared",
      durationMs: version.durationMinutes * 60_000,
      targets: { landmarks: 4, zones: 2 },
      start: catalog.start,
      checkpoints,
    },
    checkIn: { ...catalog.checkIn },
    cooldownMs: catalog.cooldownMs,
    tasks: fixtureTasks,
  };

  const validated = validateSoloFixture(candidateFixture, {
    catalog: packCatalog,
    routes,
    closedCheckpoints,
  });
  if (!validated.ok) {
    return { ok: false, error: validated.error };
  }
  return { ok: true };
}

export function packStore(
  databasePath: string,
  {
    catalog = compactCatalog,
    routes = compactWalkingSnapshot,
    closedCheckpoints = [],
    midtrans = createMidtransAdapterFromEnv(),
    unlockPaidRoom,
  }: PackStoreOptions = {},
) {
  const database = new DatabaseSync(databasePath, { timeout: 5000 });
  database.exec(`
    CREATE TABLE IF NOT EXISTS pack_actors (
      credential_hash TEXT PRIMARY KEY,
      role TEXT NOT NULL
    ) STRICT;
    CREATE TABLE IF NOT EXISTS pack_versions (
      pack_id TEXT NOT NULL,
      version INTEGER NOT NULL,
      owner_hash TEXT NOT NULL,
      snapshot TEXT NOT NULL,
      PRIMARY KEY (pack_id, version)
    ) STRICT;
    CREATE TABLE IF NOT EXISTS pack_closures (
      report_id TEXT PRIMARY KEY,
      pack_id TEXT NOT NULL,
      version INTEGER NOT NULL,
      snapshot TEXT NOT NULL
    ) STRICT;
    CREATE TABLE IF NOT EXISTS pack_orders (
      order_id TEXT PRIMARY KEY,
      pack_id TEXT NOT NULL,
      version INTEGER NOT NULL,
      buyer_hash TEXT NOT NULL,
      snapshot TEXT NOT NULL
    ) STRICT;
    CREATE TABLE IF NOT EXISTS pack_passes (
      pass_id TEXT PRIMARY KEY,
      order_id TEXT NOT NULL UNIQUE,
      room_code TEXT NOT NULL,
      snapshot TEXT NOT NULL
    ) STRICT;
    CREATE TABLE IF NOT EXISTS pack_earnings (
      earnings_entry_id TEXT PRIMARY KEY,
      order_id TEXT NOT NULL UNIQUE,
      pack_id TEXT NOT NULL,
      version INTEGER NOT NULL,
      snapshot TEXT NOT NULL
    ) STRICT;
    CREATE TABLE IF NOT EXISTS pack_payment_events (
      event_id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id TEXT NOT NULL,
      snapshot TEXT NOT NULL
    ) STRICT;
    CREATE TABLE IF NOT EXISTS pack_actions (
      credential_hash TEXT NOT NULL,
      action_id TEXT NOT NULL,
      receipt TEXT NOT NULL,
      PRIMARY KEY (credential_hash, action_id)
    ) STRICT;
  `);

  const getActor = database.prepare("SELECT role FROM pack_actors WHERE credential_hash = ?");
  const upsertActor = database.prepare(
    "INSERT INTO pack_actors (credential_hash, role) VALUES (?, ?) ON CONFLICT(credential_hash) DO UPDATE SET role = excluded.role",
  );
  const getAllVersions = database.prepare(
    "SELECT snapshot FROM pack_versions ORDER BY pack_id ASC, version ASC",
  );
  const getPackVersions = database.prepare(
    "SELECT snapshot FROM pack_versions WHERE pack_id = ? ORDER BY version ASC",
  );
  const getVersionRow = database.prepare(
    "SELECT snapshot FROM pack_versions WHERE pack_id = ? AND version = ?",
  );
  const putVersion = database.prepare(
    "INSERT INTO pack_versions (pack_id, version, owner_hash, snapshot) VALUES (?, ?, ?, ?) ON CONFLICT(pack_id, version) DO UPDATE SET snapshot = excluded.snapshot",
  );
  const getAllClosures = database.prepare(
    "SELECT snapshot FROM pack_closures ORDER BY report_id ASC",
  );
  const putClosure = database.prepare(
    "INSERT INTO pack_closures (report_id, pack_id, version, snapshot) VALUES (?, ?, ?, ?)",
  );
  const getAllOrders = database.prepare(
    "SELECT snapshot FROM pack_orders ORDER BY order_id ASC",
  );
  const getOrderRow = database.prepare(
    "SELECT snapshot FROM pack_orders WHERE order_id = ?",
  );
  const putOrder = database.prepare(
    "INSERT INTO pack_orders (order_id, pack_id, version, buyer_hash, snapshot) VALUES (?, ?, ?, ?, ?) ON CONFLICT(order_id) DO UPDATE SET snapshot = excluded.snapshot",
  );
  const getPassRow = database.prepare(
    "SELECT snapshot FROM pack_passes WHERE pass_id = ?",
  );
  const putPass = database.prepare(
    "INSERT INTO pack_passes (pass_id, order_id, room_code, snapshot) VALUES (?, ?, ?, ?)",
  );
  const getAllEarnings = database.prepare(
    "SELECT snapshot FROM pack_earnings ORDER BY earnings_entry_id ASC",
  );
  const putEarnings = database.prepare(
    "INSERT INTO pack_earnings (earnings_entry_id, order_id, pack_id, version, snapshot) VALUES (?, ?, ?, ?, ?)",
  );
  const addPaymentEvent = database.prepare(
    "INSERT INTO pack_payment_events (order_id, snapshot) VALUES (?, ?)",
  );
  const getPaymentEvents = database.prepare(
    "SELECT snapshot FROM pack_payment_events WHERE order_id = ? ORDER BY event_id ASC",
  );
  const getAction = database.prepare(
    "SELECT receipt FROM pack_actions WHERE credential_hash = ? AND action_id = ?",
  );
  const addAction = database.prepare(
    "INSERT INTO pack_actions (credential_hash, action_id, receipt) VALUES (?, ?, ?)",
  );

  function resolveClosed(): Set<string> {
    const base =
      typeof closedCheckpoints === "function"
        ? closedCheckpoints()
        : closedCheckpoints;
    return new Set(base);
  }

  function transact<T>(fn: () => T): T {
    database.exec("BEGIN IMMEDIATE");
    try {
      const result = fn();
      database.exec("COMMIT");
      return result;
    } catch (error) {
      database.exec("ROLLBACK");
      throw error;
    }
  }

  function loadAllVersions(): StoredVersion[] {
    return (getAllVersions.all() as { snapshot: string }[]).map((row) =>
      JSON.parse(row.snapshot) as StoredVersion,
    );
  }

  function loadPackVersions(packId: string): StoredVersion[] {
    return (getPackVersions.all(packId) as { snapshot: string }[]).map((row) =>
      JSON.parse(row.snapshot) as StoredVersion,
    );
  }

  function loadVersion(packId: string, version: number): StoredVersion | undefined {
    const row = getVersionRow.get(packId, version) as { snapshot?: string } | undefined;
    return typeof row?.snapshot === "string"
      ? (JSON.parse(row.snapshot) as StoredVersion)
      : undefined;
  }

  function saveVersion(record: StoredVersion) {
    putVersion.run(
      record.packId,
      record.version,
      record.ownerHash,
      JSON.stringify(record),
    );
  }

  function loadClosures(): PackClosureReport[] {
    return (getAllClosures.all() as { snapshot: string }[]).map((row) =>
      JSON.parse(row.snapshot) as PackClosureReport,
    );
  }

  function loadOrders(): StoredOrder[] {
    return (getAllOrders.all() as { snapshot: string }[]).map((row) =>
      JSON.parse(row.snapshot) as StoredOrder,
    );
  }

  function loadOrder(orderId: string): StoredOrder | undefined {
    const row = getOrderRow.get(orderId) as { snapshot?: string } | undefined;
    return typeof row?.snapshot === "string"
      ? (JSON.parse(row.snapshot) as StoredOrder)
      : undefined;
  }

  function saveOrder(order: StoredOrder) {
    putOrder.run(
      order.orderId,
      order.packId,
      order.version,
      order.buyerHash,
      JSON.stringify(order),
    );
  }

  function loadPass(passId: string): StoredPass | undefined {
    const row = getPassRow.get(passId) as { snapshot?: string } | undefined;
    return typeof row?.snapshot === "string"
      ? (JSON.parse(row.snapshot) as StoredPass)
      : undefined;
  }

  function loadEarnings(): PackEarningsEntry[] {
    return (getAllEarnings.all() as { snapshot: string }[]).map((row) =>
      JSON.parse(row.snapshot) as PackEarningsEntry,
    );
  }

  function recordLifecycle(event: RedactedMidtransLifecycleEvent) {
    addPaymentEvent.run(event.orderId, JSON.stringify(event));
  }

  function expirePendingOrders(now: number) {
    for (const order of loadOrders()) {
      if (order.status === "pending" && now >= order.expiresAt) {
        order.status = "expired";
        saveOrder(order);
      }
    }
  }

  function buildPaidDuoFixture(version: StoredVersion, players: 1 | 2): DuoFixture {
    const checkpoints = [];
    const tasks: DuoFixture["tasks"] = {};
    for (const task of version.tasks) {
      const point = catalog.checkpoints[task.checkpointId];
      if (!point) continue;
      checkpoints.push({ ...point });
      tasks[task.checkpointId] = {
        siteId: task.checkpointId,
        reviewed: true,
        challenge: {
          checkpointId: task.checkpointId,
          prompt: task.question,
          choices: task.choices.map((c) => ({ ...c })),
        },
        correctChoiceId: task.correctChoiceId,
      };
    }
    return {
      edition: {
        id: `${version.packId}-v${version.version}`,
        board: "compact",
        boardVersion: version.boardVersion,
        format: "claim-the-city",
        origin: "prepared",
        durationMs: version.durationMinutes * 60_000,
        start: catalog.start,
        checkpoints,
      },
      checkIn: { ...catalog.checkIn },
      cooldownMs: catalog.cooldownMs,
      tasks,
    };
  }

  function toPublicVersion(v: StoredVersion): PackVersionDetail {
    const { ownerHash: _ownerHash, ...detail } = v;
    return {
      ...detail,
      supportedPlayers: [...detail.supportedPlayers],
      tasks: detail.tasks.map((t) => ({
        ...t,
        choices: t.choices.map((c) => ({ ...c })),
      })),
    };
  }

  function toPublicOrder(order: StoredOrder): PackOrderSummary {
    const { buyerHash: _buyerHash, ...summary } = order;
    return { ...summary };
  }

  function buildListings(allVersions: StoredVersion[]): PackPublicListing[] {
    // Group by packId. Only the latest approved version is listed, and only while its status is "published".
    const byPack = new Map<string, StoredVersion[]>();
    for (const v of allVersions) {
      const list = byPack.get(v.packId) ?? [];
      list.push(v);
      byPack.set(v.packId, list);
    }

    const listings: PackPublicListing[] = [];
    for (const [, versions] of byPack) {
      const activeApproved = [...versions]
        .reverse()
        .find((v) => v.status === "published" || v.status === "paused");
      if (!activeApproved || activeApproved.status !== "published") {
        continue;
      }
      const publicCheckpoints: PackPublicCheckpoint[] = [];
      const zones = new Set<string>();
      for (const task of activeApproved.tasks) {
        const cp = catalog.checkpoints[task.checkpointId];
        if (cp) {
          zones.add(cp.zone);
          publicCheckpoints.push({
            id: cp.id,
            name: cp.name,
            zone: cp.zone,
            transit: cp.transit,
          });
        }
      }
      listings.push({
        packId: activeApproved.packId,
        version: activeApproved.version,
        status: "published",
        byline: activeApproved.byline,
        title: activeApproved.title,
        format: activeApproved.format,
        board: activeApproved.board,
        boardVersion: activeApproved.boardVersion,
        supportedPlayers: [...activeApproved.supportedPlayers],
        priceIdr: activeApproved.priceIdr,
        startName: catalog.start.name,
        areaSummary: `Zona ${[...zones].join(" & ")} (${publicCheckpoints.length} titik pemeriksaan)`,
        durationMinutes: activeApproved.durationMinutes,
        transitFaresNote:
          "Tarif MRT, KRL, dan Transjakarta dibayar terpisah oleh pemain.",
        publishedAt: activeApproved.publishedAt ?? activeApproved.updatedAt,
        checkpoints: publicCheckpoints,
      });
    }
    return listings;
  }

  function buildWorkspace(
    actorKey: string,
    role: PackRole,
    error?: string,
  ): PackWorkspaceReply {
    const allVersions = loadAllVersions();
    const listings = buildListings(allVersions);
    const allOrders = loadOrders();
    const allEarnings = loadEarnings();

    if (role === "public") {
      // Public players see only approved published listings and their own orders (including orders on paused versions).
      const ownOrders = allOrders
        .filter((o) => o.buyerHash === actorKey)
        .map(toPublicOrder);
      return {
        role: "public",
        listings,
        orders: ownOrders,
        error,
      };
    }

    if (role === "writer") {
      const ownVersions = allVersions
        .filter((v) => v.ownerHash === actorKey)
        .map(toPublicVersion);
      const ownPackIds = new Set(ownVersions.map((v) => v.packId));
      const writerOrders = allOrders
        .filter((o) => ownPackIds.has(o.packId))
        .map(toPublicOrder);
      const writerEarnings = allEarnings.filter((e) => ownPackIds.has(e.packId));
      const closures = loadClosures().filter((c) => ownPackIds.has(c.packId));
      return {
        role: "writer",
        listings,
        versions: ownVersions,
        closures,
        orders: writerOrders,
        earnings: writerEarnings,
        error,
      };
    }

    // Reviewer sees all versions, closure reports, orders, and reconciled creator earnings entries.
    return {
      role: "reviewer",
      listings,
      versions: allVersions.map(toPublicVersion),
      closures: loadClosures(),
      orders: allOrders.map(toPublicOrder),
      earnings: allEarnings,
      error,
    };
  }

  async function verifyAndSettleOrder(
    orderId: string,
    now: number,
    options: {
      expectedOwnerHash?: string;
      allowAnyOwner?: boolean;
      recordedTransition?: {
        transactionStatus?: "pending" | "settlement" | "expire" | "cancel" | "deny";
        grossAmount?: string;
        currency?: string;
        statusCode?: string;
      };
    } = {},
  ): Promise<{
    status: number;
    error?: string;
    duplicate?: boolean;
    order?: StoredOrder;
  }> {
    // 1. Pre-check order state inside a short read/write transaction.
    const initial = transact(() => {
      const order = loadOrder(orderId);
      if (!order) return { status: 404, error: "order-not-found" as const };
      if (
        !options.allowAnyOwner &&
        options.expectedOwnerHash &&
        order.buyerHash !== options.expectedOwnerHash
      ) {
        return { status: 403, error: "forbidden-order" as const };
      }
      if (order.status === "settled") {
        return { status: 200, duplicate: true, order };
      }
      if (order.status === "expired" || now >= order.expiresAt) {
        if (order.status !== "expired") {
          order.status = "expired";
          saveOrder(order);
        }
        return { status: 409, error: "order-expired" as const, order };
      }
      return { status: 0, order };
    });

    if (initial.status !== 0) {
      return initial;
    }

    const pendingOrder = initial.order!;

    // In recorded-sandbox mode (no live Midtrans server key), allow test/UI status transitions before status lookup.
    if (
      options.recordedTransition?.transactionStatus &&
      isRecordedAdapter(midtrans)
    ) {
      const parsedGross =
        options.recordedTransition.grossAmount !== undefined
          ? parseMidtransIdrAmount(options.recordedTransition.grossAmount)
          : undefined;
      midtrans.setOrderState(orderId, {
        transactionStatus: options.recordedTransition.transactionStatus,
        ...(parsedGross !== undefined ? { grossAmountIdr: parsedGross } : {}),
        ...(options.recordedTransition.currency
          ? { currency: options.recordedTransition.currency }
          : {}),
        ...(options.recordedTransition.statusCode
          ? { statusCode: options.recordedTransition.statusCode }
          : {}),
      });
    }

    // 2. Authoritative status lookup outside SQLite write lock so provider I/O never blocks SQLite.
    let lookup;
    try {
      lookup = await midtrans.fetchTransactionStatus(orderId);
    } catch {
      // Provider outage: retain pending order state without granting access (§8.1).
      return {
        status: 503,
        error: "payment-provider-unavailable",
        order: pendingOrder,
      };
    }

    transact(() => {
      recordLifecycle(
        midtrans.redactLifecycleEvent({
          stage: "status-lookup",
          orderId: pendingOrder.orderId,
          statusCode: lookup.statusCode,
          transactionStatus: lookup.transactionStatus,
          grossAmountIdr: lookup.grossAmountIdr,
          currency: lookup.currency,
          paymentType: lookup.paymentType,
          at: now,
        }),
      );
    });

    if (
      lookup.orderId !== pendingOrder.orderId ||
      lookup.grossAmountIdr !== pendingOrder.grossAmountIdr ||
      lookup.currency !== "IDR"
    ) {
      return { status: 409, error: "payment-mismatch", order: pendingOrder };
    }

    if (
      lookup.transactionStatus === "expire" ||
      lookup.transactionStatus === "cancel" ||
      lookup.transactionStatus === "deny"
    ) {
      const expiredOrder = transact(() => {
        const latest = loadOrder(orderId);
        if (!latest) return undefined;
        if (latest.status === "settled") return latest;
        latest.status = "expired";
        saveOrder(latest);
        return latest;
      });
      if (expiredOrder?.status === "settled") {
        return { status: 200, duplicate: true, order: expiredOrder };
      }
      return { status: 409, error: "order-expired", order: expiredOrder };
    }

    const isSettled =
      lookup.transactionStatus === "settlement" ||
      (lookup.transactionStatus === "capture" &&
        (lookup.fraudStatus === undefined || lookup.fraudStatus === "accept"));

    if (!isSettled) {
      return { status: 409, error: "order-not-settled", order: pendingOrder };
    }

    // 3. Allocate or retrieve the single paid room outside packStore's SQLite lock (idempotent by passId).
    const versionRecord = transact(() =>
      loadVersion(pendingOrder.packId, pendingOrder.version),
    );
    if (!versionRecord) {
      return { status: 404, error: "version-not-found" };
    }

    const passId = `pass-${pendingOrder.orderId}`;
    const earningsEntryId = `earn-${pendingOrder.orderId}`;
    const paidPack: NonNullable<DuoRoom["paidPack"]> = {
      packId: pendingOrder.packId,
      version: pendingOrder.version,
      title: pendingOrder.title,
      byline: pendingOrder.byline,
      orderId: pendingOrder.orderId,
      players: pendingOrder.players,
      sandbox: true,
    };
    const fixture = buildPaidDuoFixture(versionRecord, pendingOrder.players);
    const roomCode = unlockPaidRoom
      ? unlockPaidRoom(fixture, passId, paidPack)
      : randomBytes(4).toString("hex").toUpperCase();

    // 4. Atomically finalize settlement, pass, and single creator earnings entry (A29, A30).
    return transact(() => {
      const latest = loadOrder(orderId);
      if (!latest) return { status: 404, error: "order-not-found" };
      if (latest.status === "settled") {
        return { status: 200, duplicate: true, order: latest };
      }
      if (latest.status === "expired") {
        return { status: 409, error: "order-expired", order: latest };
      }

      const passRecord: StoredPass = {
        passId,
        orderId: latest.orderId,
        roomCode,
        packId: latest.packId,
        version: latest.version,
        players: latest.players,
        createdAt: now,
      };
      putPass.run(passId, latest.orderId, roomCode, JSON.stringify(passRecord));

      const earningsEntry: PackEarningsEntry = {
        earningsEntryId,
        orderId: latest.orderId,
        packId: latest.packId,
        version: latest.version,
        title: latest.title,
        byline: latest.byline,
        currency: "IDR",
        grossAmountIdr: latest.grossAmountIdr,
        platformFeeIdr: latest.platformFeeIdr,
        creatorShareIdr: latest.creatorShareIdr,
        settledAt: now,
        paymentMode: lookup.mode,
        sandbox: true,
      };
      putEarnings.run(
        earningsEntryId,
        latest.orderId,
        latest.packId,
        latest.version,
        JSON.stringify(earningsEntry),
      );

      latest.status = "settled";
      latest.settledAt = now;
      latest.passId = passId;
      latest.roomCode = roomCode;
      latest.earningsEntryId = earningsEntryId;
      latest.paymentMode = lookup.mode;
      saveOrder(latest);

      return { status: 200, duplicate: false, order: latest };
    });
  }

  return {
    close() {
      database.close();
    },

    redactedLifecycle(orderId: string): RedactedMidtransLifecycleEvent[] {
      return (getPaymentEvents.all(orderId) as { snapshot: string }[]).map((row) =>
        JSON.parse(row.snapshot) as RedactedMidtransLifecycleEvent,
      );
    },

    bootstrap(
      credential: string | undefined,
      requestedRole: PackRole = "public",
      now = Date.now(),
    ): { token?: string; role: PackRole; body: PackWorkspaceReply } {
      return transact(() => {
        expirePendingOrders(now);
        if (credential) {
          const key = digest(credential);
          const row = getActor.get(key) as { role?: PackRole } | undefined;
          if (row?.role === requestedRole) {
            return {
              role: row.role,
              body: buildWorkspace(key, row.role),
            };
          }
        }
        const token = randomBytes(32).toString("base64url");
        const key = digest(token);
        upsertActor.run(key, requestedRole);
        return {
          token,
          role: requestedRole,
          body: buildWorkspace(key, requestedRole),
        };
      });
    },

    async handleMidtransNotification(
      payload: MidtransNotificationPayload,
      now: number,
    ): Promise<MidtransWebhookResponse> {
      if (!midtrans.verifySignature(payload)) {
        return { status: 403, body: { error: "invalid-signature" } };
      }

      const parsedGross = parseMidtransIdrAmount(payload.gross_amount);
      const currency = payload.currency ?? "IDR";
      if (parsedGross === undefined || currency !== "IDR") {
        return { status: 409, body: { error: "payment-mismatch" } };
      }

      const orderCheck = transact(
        (): { ok: true; order: StoredOrder } | { ok: false; status: number; error: string } => {
          const order = loadOrder(payload.order_id);
          if (!order) return { ok: false, error: "order-not-found", status: 404 };
          if (order.grossAmountIdr !== parsedGross) {
            return { ok: false, error: "payment-mismatch", status: 409 };
          }
          recordLifecycle(
            midtrans.redactLifecycleEvent({
              stage: "notification",
              orderId: order.orderId,
              statusCode: payload.status_code,
              transactionStatus: payload.transaction_status,
              grossAmountIdr: parsedGross,
              currency,
              paymentType: payload.payment_type,
              signatureVerified: true,
              at: now,
            }),
          );
          return { ok: true, order };
        },
      );

      if (!orderCheck.ok) {
        return { status: orderCheck.status, body: { error: orderCheck.error } };
      }

      const settled = await verifyAndSettleOrder(payload.order_id, now, {
        allowAnyOwner: true,
      });

      if (settled.error) {
        return {
          status: settled.status,
          body: {
            error: settled.error,
            order: settled.order ? toPublicOrder(settled.order) : undefined,
          },
        };
      }

      return {
        status: 200,
        body: {
          ok: true,
          duplicate: settled.duplicate ?? false,
          order: settled.order ? toPublicOrder(settled.order) : undefined,
          passId: settled.order?.passId ?? null,
          roomCode: settled.order?.roomCode ?? null,
          earningsEntryId: settled.order?.earningsEntryId ?? null,
        },
      };
    },

    async act(credential: string, action: PackAction, now: number): Promise<PackResponse> {
      const authCheck = transact(
        ():
          | { kind: "response"; response: PackResponse }
          | { kind: "ready"; key: string; role: PackRole } => {
          expirePendingOrders(now);
          const key = digest(credential);
          const actor = getActor.get(key) as { role?: PackRole } | undefined;
          if (!actor?.role) {
            return {
              kind: "response",
              response: {
                status: 401,
                body: { role: "public", listings: [], orders: [], error: "session-required" },
              },
            };
          }
          const prior = getAction.get(key, action.actionId) as
            | { receipt?: string }
            | undefined;
          if (typeof prior?.receipt === "string") {
            const cached = JSON.parse(prior.receipt) as {
              status: number;
              error?: string;
            };
            return {
              kind: "response",
              response: {
                status: cached.status,
                body: buildWorkspace(key, actor.role, cached.error),
              },
            };
          }
          return { kind: "ready", key, role: actor.role };
        },
      );

      if (authCheck.kind === "response") return authCheck.response;

      const { key, role } = authCheck;

      // Async payment provider flows run outside the SQLite write lock.
      if (action.type === "create-order") {
        const preflight = transact(
          ():
            | { ok: true; target: StoredVersion; orderId: string }
            | { ok: false; status: number; error: string } => {
            const target = loadVersion(action.packId, action.version);
            if (!target) return { ok: false, error: "version-not-found", status: 404 };
            if (target.status === "paused") return { ok: false, error: "sales-paused", status: 409 };
            const activeListing = buildListings(loadAllVersions()).find(
              (item) => item.packId === action.packId && item.version === action.version,
            );
            if (target.status !== "published" || !activeListing) {
              return { ok: false, error: "version-not-published", status: 409 };
            }
            if (!target.supportedPlayers.includes(action.players)) {
              return { ok: false, error: "unsupported-players", status: 400 };
            }
            const orderId = `ord-sandbox-${loadOrders().length + 1}`;
            return { ok: true, target, orderId };
          },
        );

        if (!preflight.ok) {
          return transact(() => {
            addAction.run(
              key,
              action.actionId,
              JSON.stringify({ status: preflight.status, error: preflight.error }),
            );
            return {
              status: preflight.status,
              body: buildWorkspace(key, role, preflight.error),
            };
          });
        }

        const { target, orderId } = preflight;
        let snap;
        try {
          snap = await midtrans.createSnapTransaction({
            orderId,
            grossAmountIdr: target.priceIdr,
            packId: target.packId,
            version: target.version,
            title: target.title,
          });
        } catch {
          // Provider outage: do not grant access or create a broken order (§8.1).
          return {
            status: 503,
            body: transact(() =>
              buildWorkspace(key, role, "payment-provider-unavailable"),
            ),
          };
        }

        return transact(() => {
          const latest = loadVersion(action.packId, action.version);
          if (!latest || latest.status === "paused") {
            const err = latest ? "sales-paused" : "version-not-found";
            const status = latest ? 409 : 404;
            addAction.run(key, action.actionId, JSON.stringify({ status, error: err }));
            return { status, body: buildWorkspace(key, role, err) };
          }

          const grossAmountIdr = latest.priceIdr;
          const platformFeeIdr = Math.round(grossAmountIdr * PLATFORM_FEE_RATE);
          const creatorShareIdr = grossAmountIdr - platformFeeIdr;
          const order: StoredOrder = {
            orderId,
            packId: latest.packId,
            version: latest.version,
            title: latest.title,
            byline: latest.byline,
            players: action.players,
            currency: "IDR",
            grossAmountIdr,
            platformFeeIdr,
            creatorShareIdr,
            status: "pending",
            createdAt: now,
            expiresAt: now + ORDER_TTL_MS,
            checkoutReturnedAt: null,
            settledAt: null,
            passId: null,
            roomCode: null,
            earningsEntryId: null,
            paymentMode: snap.mode,
            snapRedirectUrl: snap.redirectUrl,
            sandbox: true,
            buyerHash: key,
          };
          saveOrder(order);
          recordLifecycle(
            midtrans.redactLifecycleEvent({
              stage: "create-snap",
              orderId: order.orderId,
              statusCode: "201",
              transactionStatus: "pending",
              grossAmountIdr: order.grossAmountIdr,
              currency: order.currency,
              at: now,
            }),
          );
          addAction.run(key, action.actionId, JSON.stringify({ status: 200 }));
          return {
            status: 200,
            body: buildWorkspace(key, role),
          };
        });
      }

      if (action.type === "verify-settlement") {
        if (action.signatureKey) {
          const orderForSig = transact(() => loadOrder(action.orderId));
          if (!orderForSig) {
            return transact(() => {
              addAction.run(key, action.actionId, JSON.stringify({ status: 404, error: "order-not-found" }));
              return { status: 404, body: buildWorkspace(key, role, "order-not-found") };
            });
          }
          const valid = midtrans.verifySignature({
            order_id: action.orderId,
            status_code: action.statusCode ?? "200",
            gross_amount: action.grossAmount ?? `${orderForSig.grossAmountIdr}.00`,
            signature_key: action.signatureKey,
          });
          if (!valid) {
            return transact(() => {
              addAction.run(key, action.actionId, JSON.stringify({ status: 403, error: "invalid-signature" }));
              return { status: 403, body: buildWorkspace(key, role, "invalid-signature") };
            });
          }
        }

        const result = await verifyAndSettleOrder(action.orderId, now, {
          expectedOwnerHash: key,
          allowAnyOwner: role === "reviewer",
          recordedTransition: action.transactionStatus
            ? {
                transactionStatus: action.transactionStatus,
                grossAmount: action.grossAmount,
                currency: action.currency,
                statusCode: action.statusCode,
              }
            : undefined,
        });

        // Do not lock out retries on transient 503 provider outage.
        if (result.status === 503) {
          return {
            status: 503,
            body: transact(() => buildWorkspace(key, role, result.error)),
          };
        }

        return transact(() => {
          addAction.run(
            key,
            action.actionId,
            JSON.stringify({ status: result.status, error: result.error }),
          );
          return {
            status: result.status,
            body: buildWorkspace(key, role, result.error),
          };
        });
      }

      // Synchronous transactional pack actions.
      return transact(() => {
        function finish(status: number, error?: string): PackResponse {
          addAction.run(
            key,
            action.actionId,
            JSON.stringify({ status, error }),
          );
          return {
            status,
            body: buildWorkspace(key, role, error),
          };
        }

        if (action.type === "checkout-return") {
          const order = loadOrder(action.orderId);
          if (!order) return finish(404, "order-not-found");
          if (order.buyerHash !== key && role !== "reviewer") {
            return finish(403, "forbidden-order");
          }
          if (order.status === "expired" || (order.status === "pending" && now >= order.expiresAt)) {
            order.status = "expired";
            saveOrder(order);
            recordLifecycle(
              midtrans.redactLifecycleEvent({
                stage: "checkout-return",
                orderId: order.orderId,
                transactionStatus: "expire",
                grossAmountIdr: order.grossAmountIdr,
                currency: order.currency,
                at: now,
              }),
            );
            return finish(409, "order-expired");
          }
          order.checkoutReturnedAt = now;
          saveOrder(order);
          recordLifecycle(
            midtrans.redactLifecycleEvent({
              stage: "checkout-return",
              orderId: order.orderId,
              transactionStatus: order.status,
              grossAmountIdr: order.grossAmountIdr,
              currency: order.currency,
              at: now,
            }),
          );
          return finish(200);
        }

        if (action.type === "redeem-pass") {
          const pass = loadPass(action.passId);
          if (!pass) return finish(404, "pass-not-found");
          if (pass.roomCode !== action.roomCode.trim().toUpperCase()) {
            return finish(409, "pass-already-bound");
          }
          return finish(200);
        }

        if (action.type === "save-draft") {
          if (role !== "writer") return finish(403, "forbidden-role");
          const { draft } = action;
          if (
            !isNonEmptyString(draft.byline, 2) ||
            !isNonEmptyString(draft.title, 3)
          ) {
            return finish(400, "invalid-metadata");
          }
          if (draft.board !== "compact" || draft.format !== "claim-the-city") {
            return finish(400, "invalid-configuration");
          }
          if (
            !Array.isArray(draft.supportedPlayers) ||
            draft.supportedPlayers.length === 0 ||
            !draft.supportedPlayers.every((p) => p === 1 || p === 2)
          ) {
            return finish(400, "invalid-configuration");
          }
          if (!Number.isFinite(draft.priceIdr) || draft.priceIdr < 1_000) {
            return finish(400, "invalid-price");
          }
          const syntax = validateTasksSyntax(draft.tasks, catalog);
          if (!syntax.ok) return finish(400, syntax.error);

          const packId =
            draft.packId && /^[a-z0-9-]{3,64}$/.test(draft.packId)
              ? draft.packId
              : "pack-selatan-compact";
          const existing = loadPackVersions(packId);
          if (existing.length > 0 && existing[0]!.ownerHash !== key) {
            return finish(403, "forbidden-pack-owner");
          }

          const latest = existing.at(-1);
          if (latest?.status === "submitted") {
            return finish(409, "review-pending");
          }

          const targetVersion =
            !latest
              ? 1
              : latest.status === "draft"
                ? latest.version
                : latest.version + 1;

          const record: StoredVersion = {
            packId,
            version: targetVersion,
            ownerHash: key,
            status: "draft",
            byline: draft.byline.trim(),
            title: draft.title.trim(),
            format: "claim-the-city",
            board: "compact",
            boardVersion: COMPACT_BOARD_VERSION,
            supportedPlayers: [...new Set(draft.supportedPlayers)].sort() as (1 | 2)[],
            priceIdr: Math.round(draft.priceIdr),
            durationMinutes: 60,
            updatedAt: now,
            publishedAt: null,
            reviewNote:
              latest?.status === "changes-requested" ? latest.reviewNote : null,
            pausedReason: null,
            tasks: draft.tasks.map((t) => ({
              checkpointId: t.checkpointId,
              question: t.question.trim(),
              choices: t.choices.map((c) => ({
                id: c.id,
                label: c.label.trim(),
              })),
              correctChoiceId: t.correctChoiceId,
              verificationNotes: t.verificationNotes.trim(),
            })),
          };
          saveVersion(record);
          return finish(200);
        }

        if (action.type === "submit-draft") {
          if (role !== "writer") return finish(403, "forbidden-role");
          const target = loadVersion(action.packId, action.version);
          if (!target) return finish(404, "version-not-found");
          if (target.ownerHash !== key) return finish(403, "forbidden-pack-owner");
          if (target.status !== "draft") return finish(409, "invalid-version-state");

          const syntax = validateTasksSyntax(target.tasks, catalog);
          if (!syntax.ok) return finish(400, syntax.error);

          target.status = "submitted";
          target.updatedAt = now;
          saveVersion(target);
          return finish(200);
        }

        if (action.type === "request-changes") {
          if (role !== "reviewer") return finish(403, "forbidden-role");
          if (!isNonEmptyString(action.note, 4)) {
            return finish(400, "review-note-required");
          }
          const target = loadVersion(action.packId, action.version);
          if (!target) return finish(404, "version-not-found");
          if (target.status !== "submitted") {
            return finish(409, "invalid-version-state");
          }
          target.status = "changes-requested";
          target.reviewNote = action.note.trim();
          target.updatedAt = now;
          saveVersion(target);
          return finish(200);
        }

        if (action.type === "publish-version") {
          if (role !== "reviewer") return finish(403, "forbidden-role");
          const target = loadVersion(action.packId, action.version);
          if (!target) return finish(404, "version-not-found");
          if (target.status !== "submitted") {
            return finish(409, "invalid-version-state");
          }

          const closureReportPointIds = loadClosures()
            .filter((c) => c.packId === target.packId && c.version === target.version)
            .map((c) => c.checkpointId);
          const closed = resolveClosed();
          for (const id of closureReportPointIds) closed.add(id);

          const check = validatePackVersionForPublication(target, {
            catalog,
            routes,
            closedCheckpoints: closed,
          });
          if (!check.ok) {
            return finish(409, check.error);
          }

          target.status = "published";
          target.publishedAt = now;
          target.updatedAt = now;
          target.pausedReason = null;
          saveVersion(target);
          return finish(200);
        }

        if (action.type === "report-closure") {
          if (!isNonEmptyString(action.reason, 4)) {
            return finish(400, "closure-reason-required");
          }
          const target = loadVersion(action.packId, action.version);
          if (!target) return finish(404, "version-not-found");
          if (!target.tasks.some((t) => t.checkpointId === action.checkpointId)) {
            return finish(400, "unknown-checkpoint");
          }
          const existingClosures = loadClosures();
          const report: PackClosureReport = {
            reportId: `closure-${existingClosures.length + 1}`,
            packId: action.packId,
            version: action.version,
            checkpointId: action.checkpointId,
            reason: action.reason.trim(),
            reportedAt: now,
          };
          putClosure.run(
            report.reportId,
            report.packId,
            report.version,
            JSON.stringify(report),
          );
          return finish(200);
        }

        if (action.type === "pause-version") {
          if (role !== "reviewer") return finish(403, "forbidden-role");
          if (!isNonEmptyString(action.reason, 4)) {
            return finish(400, "pause-reason-required");
          }
          const target = loadVersion(action.packId, action.version);
          if (!target) return finish(404, "version-not-found");
          if (target.status !== "published") {
            return finish(409, "invalid-version-state");
          }
          target.status = "paused";
          target.pausedReason = action.reason.trim();
          target.updatedAt = now;
          saveVersion(target);

          // Annotate existing orders on this version for support while preserving order, pass & earnings history (A31).
          for (const order of loadOrders()) {
            if (
              order.packId === target.packId &&
              order.version === target.version
            ) {
              order.supportNote = `Penjualan v${target.version} dijeda (${target.pausedReason}). Pesanan yang sudah lunas tetap aktif untuk dukungan pemain dan rekonsiliasi pendapatan kreator.`;
              saveOrder(order);
            }
          }
          return finish(200);
        }

        return finish(400, "invalid-request");
      });
    },
  };
}
