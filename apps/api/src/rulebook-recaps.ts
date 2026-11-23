import type { DatabaseSync } from "node:sqlite";
import type {
  ClaimEngineRoomView,
  ClaimMatchRecap,
  RulebookMatchRecap,
  RulebookRecapSummary,
  SeekEngineRoomView,
  SeekMatchRecap,
} from "@kelana-ria/contracts";

function recapFields(room: ClaimEngineRoomView | SeekEngineRoomView, completedAt: number, simulated: boolean) {
  return {
    matchId: room.code,
    packId: room.packMeta.packId,
    editionVersion: room.packMeta.version,
    title: room.packMeta.title,
    completedAt,
    simulated,
  };
}

export function claimMatchRecap(room: ClaimEngineRoomView, names: Map<string, string>): ClaimMatchRecap | undefined {
  if (room.startedAt === null || !room.outcome) return undefined;
  const { at, ...outcome } = room.outcome;
  const highlights = room.events.flatMap(event => {
    const landmark = event.landmarkId && names.get(event.landmarkId);
    return landmark && (event.type === "locked" || event.type === "stolen")
      ? [{ kind: event.type, landmark, seatId: event.seatId }] : [];
  }).slice(-3);
  return {
    ...recapFields(room, at, false),
    format: "claim-the-city", isSolo: room.isSolo, outcome,
    players: room.seats.map(({ seatId, name, teamId }) => ({ seatId, name, teamId })),
    ...(room.soloProgress ? { soloProgress: room.soloProgress } : {}),
    standings: room.standings,
    highlights,
  };
}

export function seekMatchRecap(room: SeekEngineRoomView, simulated: boolean): SeekMatchRecap | undefined {
  const { phase } = room;
  if (room.startedAt === null || !room.outcome ||
      (phase !== "finished" && phase !== "void" && phase !== "incomplete" && phase !== "canceled")) return undefined;
  const { at, ...outcome } = room.outcome;
  return {
    ...recapFields(room, at, simulated),
    format: "hide-and-seek", phase, outcome,
    players: room.seats.map(({ seatId, name }) => ({ seatId, name })),
    turns: room.turns.map(({ turnNumber, hiderSeatId, rawHidingMs, bonusMs, trapBonusMs, penaltyMs, adjustedMs, reason, clues }) => ({
      turnNumber, hiderSeatId, rawHidingMs, bonusMs, trapBonusMs, penaltyMs, adjustedMs, reason,
      answeredQuestions: clues.filter(clue => clue.status === "answered").length,
    })),
  };
}

export function rulebookRecapStore(db: DatabaseSync) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS rulebook_recaps (
      match_id TEXT PRIMARY KEY,
      completed_at INTEGER NOT NULL,
      payload TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS rulebook_recap_participants (
      credential_hash TEXT NOT NULL,
      match_id TEXT NOT NULL REFERENCES rulebook_recaps(match_id),
      PRIMARY KEY (credential_hash, match_id)
    );
  `);
  const insert = db.prepare("INSERT OR IGNORE INTO rulebook_recaps (match_id, completed_at, payload) VALUES (?, ?, ?)");
  const addParticipant = db.prepare("INSERT OR IGNORE INTO rulebook_recap_participants (credential_hash, match_id) VALUES (?, ?)");
  const read = db.prepare(`SELECT payload FROM rulebook_recaps JOIN rulebook_recap_participants USING (match_id)
    WHERE match_id = ? AND credential_hash = ?`);
  const list = db.prepare(`SELECT payload FROM rulebook_recaps JOIN rulebook_recap_participants USING (match_id)
    WHERE credential_hash = ? ORDER BY completed_at DESC, match_id`);
  const exists = db.prepare("SELECT 1 FROM rulebook_recaps WHERE match_id = ?");
  return {
    save(recap: RulebookMatchRecap, participants: string[]) {
      db.exec("BEGIN IMMEDIATE");
      try {
        const inserted = insert.run(recap.matchId, recap.completedAt, JSON.stringify(recap));
        if (Number(inserted.changes) > 0) {
          for (const member of participants) addParticipant.run(member, recap.matchId);
        }
        db.exec("COMMIT");
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
    },
    get(matchId: string, participantHash: string): RulebookMatchRecap | undefined {
      const row = read.get(matchId, participantHash) as { payload: string } | undefined;
      return row ? JSON.parse(row.payload) as RulebookMatchRecap : undefined;
    },
    list(participantHash: string): RulebookRecapSummary[] {
      return (list.all(participantHash) as { payload: string }[]).map(({ payload }) => {
        const { matchId, completedAt, packId, editionVersion, title, format, simulated } = JSON.parse(payload) as RulebookMatchRecap;
        return { matchId, completedAt, packId, editionVersion, title, format, simulated };
      });
    },
    has(matchId: string) {
      return Boolean(exists.get(matchId));
    },
  };
}
