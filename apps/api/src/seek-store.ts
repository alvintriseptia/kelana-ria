import { createHash, randomBytes } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import type { SeekAction, SeekReply } from "@kelana-ria/contracts";
import type { LobbyAction } from "./http.js";
import { sanitizeSeekPhoto } from "./seek-photo.js";
import { applySeek, expireSeek, hydrateSeek, newSeekMember, newSeekRun, seekMemberSeat, validateSeekPhoto, viewSeek } from "./seek-rules.js";
import type { SeekActionOutcome, SeekRun } from "./seek-rules.js";

type Response = { status: number; body: SeekReply };
type LobbyReceipt = { code: string } | { failure: Response };

function failure(status: number, error: string): Response {
  return { status, body: { error } };
}

function success(body: SeekReply = {}): Response {
  return { status: 200, body };
}

function digest(credential: string) {
  return createHash("sha256").update(credential).digest("hex");
}

export function seekStore(databasePath: string, clock = Date.now) {
  const database = new DatabaseSync(databasePath, { timeout: 5000 });
  database.exec(`
    PRAGMA secure_delete = ON;
    CREATE TABLE IF NOT EXISTS seek_credentials (
      credential_hash TEXT PRIMARY KEY
    ) STRICT;
    CREATE TABLE IF NOT EXISTS seek_rooms (
      code TEXT PRIMARY KEY,
      snapshot TEXT NOT NULL
    ) STRICT;
    CREATE TABLE IF NOT EXISTS seek_actions (
      credential_hash TEXT NOT NULL REFERENCES seek_credentials(credential_hash),
      scope TEXT NOT NULL,
      action_id TEXT NOT NULL,
      receipt TEXT NOT NULL,
      PRIMARY KEY (credential_hash, scope, action_id)
    ) STRICT;
    CREATE TABLE IF NOT EXISTS seek_photos (
      code TEXT NOT NULL REFERENCES seek_rooms(code),
      question_id TEXT NOT NULL,
      jpeg BLOB NOT NULL,
      PRIMARY KEY (code, question_id)
    ) STRICT;
  `);

  const getCredential = database.prepare("SELECT 1 FROM seek_credentials WHERE credential_hash = ?");
  const addCredential = database.prepare("INSERT INTO seek_credentials (credential_hash) VALUES (?)");
  const getRoom = database.prepare("SELECT snapshot FROM seek_rooms WHERE code = ?");
  const addRoom = database.prepare("INSERT INTO seek_rooms (code, snapshot) VALUES (?, ?)");
  const updateRoom = database.prepare("UPDATE seek_rooms SET snapshot = ? WHERE code = ?");
  const getAction = database.prepare("SELECT receipt FROM seek_actions WHERE credential_hash = ? AND scope = ? AND action_id = ?");
  const addAction = database.prepare("INSERT INTO seek_actions (credential_hash, scope, action_id, receipt) VALUES (?, ?, ?, ?)");
  const getPhoto = database.prepare("SELECT jpeg FROM seek_photos WHERE code = ? AND question_id = ?");
  const addPhoto = database.prepare("INSERT INTO seek_photos (code, question_id, jpeg) VALUES (?, ?, ?)");
  const deletePhotos = database.prepare("DELETE FROM seek_photos WHERE code = ?");
  const duePhotoRooms = database.prepare(`
    SELECT DISTINCT code
    FROM seek_photos JOIN seek_rooms USING (code)
    WHERE json_extract(snapshot, '$.phaseEndsAt') <= ?
  `);

  // Read and update a room under the same write lock as its action receipt.
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

  function load(code: string): SeekRun | undefined {
    const snapshot = getRoom.get(code)?.snapshot;
    return typeof snapshot === "string" ? JSON.parse(snapshot) as SeekRun : undefined;
  }

  function save(run: SeekRun) {
    updateRoom.run(JSON.stringify(run), run.code);
    if (run.outcome) deletePhotos.run(run.code);
  }

  function priorAction<T>(key: string, scope: string, actionId: string): T | undefined {
    const receipt = getAction.get(key, scope, actionId)?.receipt;
    return typeof receipt === "string" ? JSON.parse(receipt) as T : undefined;
  }

  function roomForMember(code: string, key: string, now: number) {
    const run = load(code);
    const seat = run && seekMemberSeat(run, key);
    if (!run || !seat) return undefined;
    const hydrated = hydrateSeek(run);
    if (expireSeek(run, now) || hydrated) save(run);
    return { run, seat };
  }

  function lobbyAction(key: string, action: LobbyAction): LobbyReceipt {
    if (action.type === "create") {
      let code: string;
      do {
        code = randomBytes(4).toString("hex").toUpperCase();
      } while (getRoom.get(code));
      addRoom.run(code, JSON.stringify(newSeekRun(code, key)));
      return { code };
    }

    const { code } = action;
    const run = load(code);
    if (!run) return { failure: failure(404, "room-not-found") };
    if (seekMemberSeat(run, key)) return { code };
    if (run.guest) return { failure: failure(409, "room-full") };
    if (run.phase !== "lobby") return { failure: failure(409, "round-finished") };
    run.host.ready = false;
    run.guest = newSeekMember(key);
    save(run);
    return { code };
  }

  function commitAction(key: string, code: string, action: SeekAction, now: number, photo?: Buffer): Response {
    return transact(() => {
      const saved = priorAction<SeekActionOutcome>(key, code, action.actionId);
      if (saved?.releasedSeat) return success();
      const member = roomForMember(code, key, now);
      if (!member) return failure(403, "room-required");
      const { run, seat } = member;
      if (saved) return success(viewSeek(run, seat, now, saved));

      const result = applySeek(run, seat, action, now, photo !== undefined);
      if (result.acceptedPhotoId && photo) addPhoto.run(code, result.acceptedPhotoId, photo);
      save(run);
      addAction.run(key, code, action.actionId, JSON.stringify({
        error: result.error,
        investigation: result.investigation,
        releasedSeat: result.releasedSeat,
      }));
      return result.releasedSeat ? success() : success(viewSeek(run, seat, now, result));
    });
  }

  // Requests in one room keep their receipt order while a photo is decoded.
  // SQLite still commits each image, action receipt and room update together.
  const roomQueues = new Map<string, Promise<void>>();
  function ordered<T>(code: string, work: () => T | Promise<T>): Promise<T> {
    const result = (roomQueues.get(code) ?? Promise.resolve()).then(work);
    const settled = result.then(() => {}, () => {});
    roomQueues.set(code, settled);
    void settled.then(() => {
      if (roomQueues.get(code) === settled) roomQueues.delete(code);
    });
    return result;
  }

  let closed = false;
  function reportPhotoCleanupFailure() {
    console.error("Could not expire Hide & Seek photos");
  }
  function expirePhotoRooms() {
    const now = clock();
    try {
      for (const { code } of duePhotoRooms.all(now)) {
        if (typeof code !== "string") continue;
        void ordered(code, () => {
          if (closed) return;
          transact(() => {
            const run = load(code);
            if (run && expireSeek(run, now)) save(run);
          });
        }).catch(reportPhotoCleanupFailure);
      }
    } catch {
      reportPhotoCleanupFailure();
    }
  }
  // Materialize terminal expiry even if neither player reconnects to the room.
  const photoCleanup = setInterval(expirePhotoRooms, 1000).unref();
  expirePhotoRooms();

  return {
    close() {
      closed = true;
      clearInterval(photoCleanup);
      database.close();
    },
    ordered,
    lobbyRoom(credential: string, action: LobbyAction) {
      if (action.type === "join") return action.code;
      const saved = priorAction<LobbyReceipt>(digest(credential), "", action.actionId);
      return saved && "code" in saved ? saved.code : undefined;
    },
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
        return member ? success(viewSeek(member.run, member.seat, now)) : failure(403, "room-required");
      });
    },
    get(credential: string, code: string, now: number): Response {
      const key = authenticated(credential);
      if (!key) return failure(401, "session-required");
      return transact(() => {
        const member = roomForMember(code, key, now);
        return member ? success(viewSeek(member.run, member.seat, now)) : failure(403, "room-required");
      });
    },
    photo(credential: string, code: string, questionId: string, now: number): Response | { status: 200; photo: Uint8Array } {
      const key = authenticated(credential);
      if (!key) return failure(401, "session-required");
      return transact(() => {
        const member = roomForMember(code, key, now);
        if (!member) return failure(403, "room-required");
        const photo = !member.run.outcome && getPhoto.get(code, questionId)?.jpeg;
        return photo instanceof Uint8Array ? { status: 200, photo } : failure(404, "photo-not-found");
      });
    },
    async act(credential: string, code: string, action: SeekAction, now: number): Promise<Response> {
      const key = authenticated(credential);
      if (!key) return failure(401, "session-required");
      if (action.type !== "answer-question" || action.photo === undefined) return commitAction(key, code, action, now);

      const canDecode = transact(() => {
        if (priorAction<SeekActionOutcome>(key, code, action.actionId)) return false;
        const member = roomForMember(code, key, now);
        return member && validateSeekPhoto(member.run, member.seat, action) === undefined;
      });
      let photo: Buffer | undefined;
      if (canDecode) {
        try {
          photo = await sanitizeSeekPhoto(action.photo);
        } catch {
          // The invalid submission leaves the request open for a photo retry or substitute.
        }
      }
      return commitAction(key, code, action, now, photo);
    },
  };
}
