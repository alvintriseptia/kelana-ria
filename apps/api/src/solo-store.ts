import { createHash, randomBytes } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { SoloAction } from "@kelana-ria/contracts";
import { compactTrial } from "./solo-fixture.js";
import { apply, expire, newRun, openChallenge, view } from "./solo-rules.js";
import type { ActionOutcome, SoloRun } from "./solo-rules.js";

function digest(credential: string) {
  return createHash("sha256").update(credential).digest("hex");
}

export function soloStore(databasePath: string) {
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
  const updateRun = database.prepare("UPDATE solo_runs SET snapshot = ? WHERE id = ?");
  const movePlayer = database.prepare("UPDATE solo_players SET current_run_id = ? WHERE credential_hash = ?");
  const getAction = database.prepare("SELECT outcome, replayed_run_id FROM solo_actions WHERE run_id = ? AND action_id = ?");
  const addAction = database.prepare("INSERT INTO solo_actions (run_id, action_id, outcome, replayed_run_id) VALUES (?, ?, ?, ?)");

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

  return {
    close() { database.close(); },
    session(credential: string | undefined, now: number) {
      return transact(() => {
        const saved = credential ? currentRun(digest(credential), now) : undefined;
        if (saved) return { reply: view(saved, now) };

        const token = randomBytes(32).toString("base64url");
        const run = newRun(compactTrial);
        addRun.run(run.state.id, JSON.stringify(run));
        addPlayer.run(digest(token), run.state.id);
        return { reply: view(run, now), token };
      });
    },
    challenge(credential: string, checkpointId: string, now: number) {
      return transact(() => {
        const run = currentRun(digest(credential), now);
        if (run) return view(run, now, openChallenge(run, checkpointId));
        return undefined;
      });
    },
    act(credential: string, action: SoloAction, now: number) {
      return transact(() => {
        const key = digest(credential);
        const run = currentRun(key, now);
        if (!run) return undefined;

        const prior = getAction.get(action.sessionId, action.actionId);
        if (action.sessionId !== run.state.id) {
          const replayRetry = action.type === "replay" && prior?.replayed_run_id === run.state.id;
          return view(run, now, replayRetry ? undefined : { error: "stale-session" });
        }
        if (typeof prior?.outcome === "string") return view(run, now, JSON.parse(prior.outcome) as ActionOutcome);

        if (action.type === "replay" && run.state.phase !== "active" && run.state.phase !== "briefing") {
          const next = newRun(run.fixture);
          addRun.run(next.state.id, JSON.stringify(next));
          movePlayer.run(next.state.id, key);
          addAction.run(run.state.id, action.actionId, "{}", next.state.id);
          return view(next, now);
        }

        const outcome = action.type === "replay" ? { error: "run-in-progress" } : apply(run, action, now);
        updateRun.run(JSON.stringify(run), run.state.id);
        // Keep only the checkpoint/error receipt, without the derived distance or the raw fix.
        addAction.run(run.state.id, action.actionId, JSON.stringify({
          error: outcome.error,
          challengeCheckpointId: outcome.challengeCheckpointId,
        }), null);
        return view(run, now, outcome);
      });
    },
  };
}
