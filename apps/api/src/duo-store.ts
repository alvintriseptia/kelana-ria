import { createHash, randomBytes } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import type { DuoAction, DuoReply } from "@kelana-ria/contracts";
import { applyDuo, expireDuo, memberSeat, newDuoRun, newMember, openDuoChallenge, viewDuo } from "./duo-rules.js";
import type { DuoActionOutcome, DuoRun } from "./duo-rules.js";
import type { LobbyAction } from "./http.js";

type Response = { status: number; body: DuoReply };
type LobbyReceipt = { code: string } | { failure: Response };

function failure(status: number, error: string): Response {
  return { status, body: { error } };
}

function success(body: DuoReply = {}): Response {
  return { status: 200, body };
}

function digest(credential: string) {
  return createHash("sha256").update(credential).digest("hex");
}

export function duoStore(databasePath: string) {
  const database = new DatabaseSync(databasePath, { timeout: 5000 });
  database.exec(`
    CREATE TABLE IF NOT EXISTS duo_credentials (
      credential_hash TEXT PRIMARY KEY
    ) STRICT;
    CREATE TABLE IF NOT EXISTS duo_rooms (
      code TEXT PRIMARY KEY,
      snapshot TEXT NOT NULL
    ) STRICT;
    CREATE TABLE IF NOT EXISTS duo_actions (
      credential_hash TEXT NOT NULL REFERENCES duo_credentials(credential_hash),
      scope TEXT NOT NULL,
      action_id TEXT NOT NULL,
      receipt TEXT NOT NULL,
      PRIMARY KEY (credential_hash, scope, action_id)
    ) STRICT;
  `);

  const getCredential = database.prepare("SELECT 1 FROM duo_credentials WHERE credential_hash = ?");
  const addCredential = database.prepare("INSERT INTO duo_credentials (credential_hash) VALUES (?)");
  const getRoom = database.prepare("SELECT snapshot FROM duo_rooms WHERE code = ?");
  const addRoom = database.prepare("INSERT INTO duo_rooms (code, snapshot) VALUES (?, ?)");
  const updateRoom = database.prepare("UPDATE duo_rooms SET snapshot = ? WHERE code = ?");
  const getAction = database.prepare("SELECT receipt FROM duo_actions WHERE credential_hash = ? AND scope = ? AND action_id = ?");
  const addAction = database.prepare("INSERT INTO duo_actions (credential_hash, scope, action_id, receipt) VALUES (?, ?, ?, ?)");

  // Lock before reading ownership. The snapshot and corresponding action receipt commit together.
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

  function authenticated(credential: string) {
    const key = digest(credential);
    return getCredential.get(key) ? key : undefined;
  }

  function load(code: string): DuoRun | undefined {
    const snapshot = getRoom.get(code)?.snapshot;
    return typeof snapshot === "string" ? JSON.parse(snapshot) as DuoRun : undefined;
  }

  function save(run: DuoRun) {
    updateRoom.run(JSON.stringify(run), run.code);
  }

  function priorAction<T>(key: string, scope: string, actionId: string): T | undefined {
    const receipt = getAction.get(key, scope, actionId)?.receipt;
    return typeof receipt === "string" ? JSON.parse(receipt) as T : undefined;
  }

  function roomForMember(code: string, key: string, now: number) {
    const run = load(code);
    const seat = run && memberSeat(run, key);
    if (!run || !seat) return undefined;
    if (expireDuo(run, now)) save(run);
    return { run, seat };
  }

  function lobbyAction(key: string, action: LobbyAction): LobbyReceipt {
    if (action.type === "create") {
      let code: string;
      do {
        code = randomBytes(4).toString("hex").toUpperCase();
      } while (getRoom.get(code));
      addRoom.run(code, JSON.stringify(newDuoRun(code, key)));
      return { code };
    }

    const { code } = action;
    const run = load(code);
    if (!run) return { failure: failure(404, "room-not-found") };
    if (memberSeat(run, key)) return { code };
    if (run.guest) return { failure: failure(409, "room-full") };
    if (run.phase !== "lobby") return { failure: failure(409, "round-finished") };
    run.host.ready = false;
    run.guest = newMember(key);
    save(run);
    return { code };
  }

  return {
    close() { database.close(); },
    bootstrap(credential: string | undefined) {
      if (credential && authenticated(credential)) return undefined;
      const token = randomBytes(32).toString("base64url");
      addCredential.run(digest(token));
      return token;
    },
    lobby(credential: string, action: LobbyAction, now: number): Response {
      const key = authenticated(credential);
      if (!key) return failure(401, "session-required");
      return transact(() => {
        const saved = priorAction<LobbyReceipt>(key, "", action.actionId);
        const receipt = saved ?? lobbyAction(key, action);
        if (!saved) addAction.run(key, "", action.actionId, JSON.stringify(receipt));
        if ("failure" in receipt) return receipt.failure;
        const member = roomForMember(receipt.code, key, now);
        return member ? success(viewDuo(member.run, member.seat, now)) : failure(403, "room-required");
      });
    },
    get(credential: string, code: string, now: number, checkpointId?: string): Response {
      const key = authenticated(credential);
      if (!key) return failure(401, "session-required");
      return transact(() => {
        const member = roomForMember(code, key, now);
        if (!member) return failure(403, "room-required");
        const { run, seat } = member;
        return success(viewDuo(run, seat, now, checkpointId ? openDuoChallenge(run, seat, checkpointId) : undefined));
      });
    },
    act(credential: string, code: string, action: DuoAction, now: number): Response {
      const key = authenticated(credential);
      if (!key) return failure(401, "session-required");
      return transact(() => {
        const saved = priorAction<DuoActionOutcome>(key, code, action.actionId);
        if (saved?.releasedSeat) return success();
        const member = roomForMember(code, key, now);
        if (!member) return failure(403, "room-required");
        const { run, seat } = member;
        if (saved) return success(viewDuo(run, seat, now, saved));

        const result = applyDuo(run, seat, action, now);
        save(run);
        // Keep the gameplay receipt without the submitted fix, distance or choice.
        addAction.run(key, code, action.actionId, JSON.stringify({
          error: result.error,
          challengeCheckpointId: result.challengeCheckpointId,
          releasedSeat: result.releasedSeat,
        }));
        return result.releasedSeat ? success() : success(viewDuo(run, seat, now, result));
      });
    },
  };
}
