import { createHash, randomBytes } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import type {
  PackAction,
  PackClosureReport,
  PackDraftPayload,
  PackOrderSummary,
  PackPublicCheckpoint,
  PackPublicListing,
  PackRole,
  PackTaskInput,
  PackVersionDetail,
  PackWorkspaceReply,
} from "@kelana-ria/contracts";
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

type PackResponse = {
  status: number;
  body: PackWorkspaceReply;
};

const PLATFORM_FEE_RATE = 0.15;

function digest(credential: string) {
  return createHash("sha256").update(credential).digest("hex");
}

function isNonEmptyString(value: unknown, minLength = 1): value is string {
  return typeof value === "string" && value.trim().length >= minLength;
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
  }: {
    catalog?: CompactBoardCatalog;
    routes?: WalkingRouteSnapshot | null;
    closedCheckpoints?: Iterable<string> | (() => Iterable<string>);
  } = {},
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
  const putOrder = database.prepare(
    "INSERT INTO pack_orders (order_id, pack_id, version, buyer_hash, snapshot) VALUES (?, ?, ?, ?, ?) ON CONFLICT(order_id) DO UPDATE SET snapshot = excluded.snapshot",
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
      const closures = loadClosures().filter((c) => ownPackIds.has(c.packId));
      return {
        role: "writer",
        listings,
        versions: ownVersions,
        closures,
        orders: writerOrders,
        error,
      };
    }

    // Reviewer sees all versions, closure reports, and orders for support and earnings reconciliation.
    return {
      role: "reviewer",
      listings,
      versions: allVersions.map(toPublicVersion),
      closures: loadClosures(),
      orders: allOrders.map(toPublicOrder),
      error,
    };
  }

  return {
    close() {
      database.close();
    },

    bootstrap(
      credential: string | undefined,
      requestedRole: PackRole = "public",
    ): { token?: string; role: PackRole; body: PackWorkspaceReply } {
      return transact(() => {
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

    act(credential: string, action: PackAction, now: number): PackResponse {
      return transact(() => {
        const key = digest(credential);
        const actor = getActor.get(key) as { role?: PackRole } | undefined;
        if (!actor?.role) {
          return {
            status: 401,
            body: { role: "public", listings: [], orders: [], error: "session-required" },
          };
        }
        const { role } = actor;

        const prior = getAction.get(key, action.actionId) as
          | { receipt?: string }
          | undefined;
        if (typeof prior?.receipt === "string") {
          const cached = JSON.parse(prior.receipt) as {
            status: number;
            error?: string;
          };
          return {
            status: cached.status,
            body: buildWorkspace(key, role, cached.error),
          };
        }

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

          // Annotate existing orders on this version for support while preserving order & earnings history (A31).
          for (const order of loadOrders()) {
            if (
              order.packId === target.packId &&
              order.version === target.version
            ) {
              order.supportNote = `Penjualan v${target.version} dijeda (${target.pausedReason}). Pesanan yang sudah lunas tetap aktif untuk dukungan pemain dan rekonsiliasi pendapatan kreator.`;
              putOrder.run(
                order.orderId,
                order.packId,
                order.version,
                order.buyerHash,
                JSON.stringify(order),
              );
            }
          }
          return finish(200);
        }

        if (action.type === "create-order") {
          const target = loadVersion(action.packId, action.version);
          if (!target) return finish(404, "version-not-found");
          if (target.status === "paused") {
            return finish(409, "sales-paused");
          }
          const activeListing = buildListings(loadAllVersions()).find(
            (item) =>
              item.packId === action.packId && item.version === action.version,
          );
          if (target.status !== "published" || !activeListing) {
            return finish(409, "version-not-published");
          }
          if (!target.supportedPlayers.includes(action.players)) {
            return finish(400, "unsupported-players");
          }
          const allOrders = loadOrders();
          const grossAmountIdr = target.priceIdr;
          const platformFeeIdr = Math.round(grossAmountIdr * PLATFORM_FEE_RATE);
          const creatorShareIdr = grossAmountIdr - platformFeeIdr;
          const order: StoredOrder = {
            orderId: `ord-sandbox-${allOrders.length + 1}`,
            packId: target.packId,
            version: target.version,
            title: target.title,
            byline: target.byline,
            players: action.players,
            grossAmountIdr,
            platformFeeIdr,
            creatorShareIdr,
            status: "settled",
            settledAt: now,
            sandbox: true,
            buyerHash: key,
          };
          putOrder.run(
            order.orderId,
            order.packId,
            order.version,
            order.buyerHash,
            JSON.stringify(order),
          );
          return finish(200);
        }

        return finish(400, "invalid-request");
      });
    },
  };
}
