import { createHash, randomBytes } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { SoloAction } from "@kelana-ria/contracts";
import {
  compactCatalog,
  compactWalkingSnapshot,
  preparedCompactFixtures,
  type CompactBoardCatalog,
  type SoloFixture,
  type WalkingRouteSnapshot,
} from "./solo-fixture.js";
import { apply, expire, newRun, openChallenge, view } from "./solo-rules.js";
import type { ActionOutcome, SoloRun } from "./solo-rules.js";
import {
  prepareSoloFixture,
  validateSoloFixture,
  type EditionGenerator,
  type RouteSnapshotProvider,
} from "./solo-validation.js";

function digest(credential: string) {
  return createHash("sha256").update(credential).digest("hex");
}

export type SoloStoreOptions = {
  now?: () => number;
  catalog?: CompactBoardCatalog;
  snapshotRoutes?: WalkingRouteSnapshot | null;
  fallbacks?: SoloFixture[];
  closedCheckpoints?: Iterable<string> | (() => Iterable<string>);
  aiProvider?: EditionGenerator;
  routeProvider?: RouteSnapshotProvider;
  budgetMs?: number;
};

export function soloStore(databasePath: string, options: SoloStoreOptions = {}) {
  if (databasePath !== ":memory:") mkdirSync(dirname(databasePath), { recursive: true, mode: 0o700 });
  const database = new DatabaseSync(databasePath, { timeout: 5000 });
  database.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS solo_runs (
      id TEXT PRIMARY KEY,
      snapshot TEXT NOT NULL
    ) STRICT;
    CREATE TABLE IF NOT EXISTS solo_players (
      credential_hash TEXT PRIMARY KEY,
      current_run_id TEXT NOT NULL REFERENCES solo_runs(id)
    ) STRICT;
    CREATE TABLE IF NOT EXISTS solo_actions (
      run_id TEXT NOT NULL REFERENCES solo_runs(id),
      action_id TEXT NOT NULL,
      outcome TEXT NOT NULL,
      replayed_run_id TEXT REFERENCES solo_runs(id),
      PRIMARY KEY (run_id, action_id)
    ) STRICT;
  `);

  const addRun = database.prepare("INSERT INTO solo_runs (id, snapshot) VALUES (?, ?)");
  const addPlayer = database.prepare("INSERT INTO solo_players (credential_hash, current_run_id) VALUES (?, ?)");
  const getRun = database.prepare(`
    SELECT snapshot FROM solo_players JOIN solo_runs ON current_run_id = id WHERE credential_hash = ?
  `);
  const getRunById = database.prepare("SELECT snapshot FROM solo_runs WHERE id = ?");
  const updateRun = database.prepare("UPDATE solo_runs SET snapshot = ? WHERE id = ?");
  const movePlayer = database.prepare("UPDATE solo_players SET current_run_id = ? WHERE credential_hash = ?");
  const getAction = database.prepare("SELECT outcome, replayed_run_id FROM solo_actions WHERE run_id = ? AND action_id = ?");
  const addAction = database.prepare("INSERT INTO solo_actions (run_id, action_id, outcome, replayed_run_id) VALUES (?, ?, ?, ?)");

  function resolveClosed(): ReadonlySet<string> {
    const raw =
      typeof options.closedCheckpoints === "function"
        ? options.closedCheckpoints()
        : (options.closedCheckpoints ?? []);
    return new Set(raw);
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

  function currentRun(key: string, now: number) {
    const snapshot = getRun.get(key)?.snapshot;
    if (typeof snapshot !== "string") return undefined;
    const run = JSON.parse(snapshot) as SoloRun;
    if (expire(run, now)) updateRun.run(JSON.stringify(run), run.state.id);
    return run;
  }

  function archivedRun(runId: string, now: number) {
    const snapshot = getRunById.get(runId)?.snapshot;
    if (typeof snapshot !== "string") return undefined;
    const run = JSON.parse(snapshot) as SoloRun;
    if (expire(run, now)) updateRun.run(JSON.stringify(run), run.state.id);
    return run;
  }

  return {
    close() { database.close(); },
    runById(runId: string, now: number) {
      return transact(() => {
        const run = archivedRun(runId, now);
        return run ? view(run, now) : undefined;
      });
    },
    async session(credential: string | undefined, now: number) {
      const key = credential ? digest(credential) : undefined;
      const saved = key ? transact(() => currentRun(key, now)) : undefined;
      if (saved) return { reply: view(saved, now) };

      const clock = options.now ?? (() => now);
      const prepared = await prepareSoloFixture({
        catalog: options.catalog ?? compactCatalog,
        snapshotRoutes:
          options.snapshotRoutes === undefined
            ? compactWalkingSnapshot
            : options.snapshotRoutes,
        fallbacks: options.fallbacks ?? preparedCompactFixtures,
        closedCheckpoints: resolveClosed(),
        aiProvider: options.aiProvider,
        routeProvider: options.routeProvider,
        budgetMs: options.budgetMs,
        now: clock,
      });
      if (!prepared.ok) {
        return {
          error: prepared.error,
          closedCheckpointId: prepared.closedCheckpointId,
        };
      }

      const currentNow = clock();
      return transact(() => {
        const existing = key ? currentRun(key, currentNow) : undefined;
        if (existing) return { reply: view(existing, currentNow) };

        const token = randomBytes(32).toString("base64url");
        const run = newRun(prepared.fixture);
        addRun.run(run.state.id, JSON.stringify(run));
        addPlayer.run(digest(token), run.state.id);
        return { reply: view(run, currentNow), token };
      });
    },
    challenge(credential: string, checkpointId: string, now: number) {
      return transact(() => {
        const run = currentRun(digest(credential), now);
        if (run) return view(run, now, openChallenge(run, checkpointId));
        return undefined;
      });
    },
    async act(credential: string, action: SoloAction, now: number) {
      const key = digest(credential);
      const closed = resolveClosed();
      const precheck = transact(() => {
        const run = currentRun(key, now);
        if (!run) return undefined;
        const prior = getAction.get(action.sessionId, action.actionId);
        if (action.sessionId !== run.state.id) {
          const replayRetry = action.type === "replay" && prior?.replayed_run_id === run.state.id;
          return { done: view(run, now, replayRetry ? undefined : { error: "stale-session" }) };
        }
        if (typeof prior?.outcome === "string") {
          return { done: view(run, now, JSON.parse(prior.outcome) as ActionOutcome) };
        }
        return { run };
      });
      if (!precheck) return undefined;
      if ("done" in precheck) return precheck.done;

      const { run } = precheck;
      const canReplaySame =
        action.type === "replay" &&
        !action.freshEdition &&
        run.state.phase !== "active" &&
        run.state.phase !== "briefing";
      const canPrepareFresh =
        action.type === "replay" &&
        action.freshEdition === true &&
        run.state.phase !== "active";

      if (canReplaySame) {
        const rechecked = validateSoloFixture(run.fixture, {
          catalog: options.catalog ?? compactCatalog,
          routes:
            options.snapshotRoutes === undefined
              ? compactWalkingSnapshot
              : options.snapshotRoutes,
          closedCheckpoints: closed,
        });
        if (!rechecked.ok) {
          return view(run, now, {
            error: rechecked.error,
            closedCheckpointId: rechecked.closedCheckpointId,
          });
        }
        return transact(() => {
          const current = currentRun(key, now);
          if (!current || current.state.id !== run.state.id) return undefined;
          const next = newRun(current.fixture);
          addRun.run(next.state.id, JSON.stringify(next));
          movePlayer.run(next.state.id, key);
          addAction.run(current.state.id, action.actionId, "{}", next.state.id);
          return view(next, now);
        });
      }

      if (canPrepareFresh) {
        const prepared = await prepareSoloFixture({
          catalog: options.catalog ?? compactCatalog,
          snapshotRoutes:
            options.snapshotRoutes === undefined
              ? compactWalkingSnapshot
              : options.snapshotRoutes,
          fallbacks: options.fallbacks ?? preparedCompactFixtures,
          closedCheckpoints: closed,
          previousEdition: run.fixture.edition,
          aiProvider: options.aiProvider,
          routeProvider: options.routeProvider,
          budgetMs: options.budgetMs,
          now: () => now,
        });
        if (!prepared.ok) {
          return view(run, now, {
            error: prepared.error,
            closedCheckpointId: prepared.closedCheckpointId,
          });
        }
        return transact(() => {
          const current = currentRun(key, now);
          if (!current || current.state.id !== run.state.id) return undefined;
          const next = newRun(prepared.fixture);
          addRun.run(next.state.id, JSON.stringify(next));
          movePlayer.run(next.state.id, key);
          addAction.run(current.state.id, action.actionId, "{}", next.state.id);
          return view(next, now);
        });
      }

      return transact(() => {
        const current = currentRun(key, now);
        if (!current) return undefined;
        const prior = getAction.get(action.sessionId, action.actionId);
        if (action.sessionId !== current.state.id) {
          const replayRetry = action.type === "replay" && prior?.replayed_run_id === current.state.id;
          return view(current, now, replayRetry ? undefined : { error: "stale-session" });
        }
        if (typeof prior?.outcome === "string") {
          return view(current, now, JSON.parse(prior.outcome) as ActionOutcome);
        }

        const outcome =
          action.type === "replay"
            ? { error: "run-in-progress" }
            : apply(current, action, now, closed);
        updateRun.run(JSON.stringify(current), current.state.id);
        // Keep only the checkpoint/error receipt, without the derived distance or the raw fix.
        addAction.run(
          current.state.id,
          action.actionId,
          JSON.stringify({
            error: outcome.error,
            challengeCheckpointId: outcome.challengeCheckpointId,
            closedCheckpointId: outcome.closedCheckpointId,
          }),
          null,
        );
        return view(current, now, outcome);
      });
    },
  };
}
