import { randomBytes } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import type {
  ClaimEngineRoomView,
  ClaimMatchRecap,
  PublicClaimMatchRecap,
  PublicMatchRecap,
  PublicMatchRecapSummary,
  PublicRecapMoment,
  PublicSeekMatchRecap,
  RecapPublicShareState,
  RulebookMatchRecap,
  RulebookRecapSummary,
  SeekEngineRoomView,
  SeekMatchRecap,
} from "@kelana-ria/contracts";

const claimRankingMetrics = [
  ["zonesControlled", "Zona yang dikuasai"],
  ["lockedLandmarks", "Landmark yang terkunci"],
  ["totalLandmarks", "Total landmark"],
] as const;

const seekTurnReasons: Record<SeekMatchRecap["turns"][number]["reason"], string> = {
  found: "Ditemukan",
  timeout: "Waktu mencari habis",
  missed_lock: "Titik sembunyi belum dikunci",
  forfeit: "Giliran berakhir lebih awal",
};

function formatDuration(ms: number) {
  const seconds = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

function editionHref(packId: string, editionVersion: number) {
  return `/?${new URLSearchParams({ edition: packId, version: String(editionVersion) }).toString()}`;
}

export function sanitizePublicAlias(value: unknown, fallback: string): string {
  if (typeof value !== "string") return fallback;
  const cleaned = value
    .replace(/[\u0000-\u001F\u007F]/g, " ")
    .replace(/\b(?:RC|RB)-[\dA-F]{6}\b/gi, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 32);
  return cleaned || fallback;
}

export type ShareRecapOptions = {
  aliases?: Record<string, string>;
  useApprovedRoomNames?: boolean;
};

export function resolvePublicAliases(
  recap: RulebookMatchRecap,
  options: ShareRecapOptions = {},
): Record<string, string> {
  const resolved: Record<string, string> = {};
  recap.players.forEach((player, index) => {
    const fallback = `Pemain ${index + 1}`;
    const custom = options.aliases && typeof options.aliases[player.seatId] === "string"
      ? options.aliases[player.seatId]
      : undefined;
    const chosen = custom !== undefined && custom.trim().length > 0
      ? custom
      : options.useApprovedRoomNames
        ? player.name
        : fallback;
    resolved[player.seatId] = sanitizePublicAlias(chosen, fallback);
  });
  return resolved;
}

export function projectPublicRecap(
  recap: RulebookMatchRecap,
  shareId: string,
  publishedAt: number,
  aliases: Record<string, string>,
): PublicMatchRecap {
  const base = {
    shareId,
    packId: recap.packId,
    editionVersion: recap.editionVersion,
    title: recap.title,
    completedAt: recap.completedAt,
    publishedAt,
    simulated: recap.simulated,
    editionHref: editionHref(recap.packId, recap.editionVersion),
  };

  if (recap.format === "claim-the-city") {
    const teamIds: string[] = [];
    for (const player of recap.players) {
      if (!teamIds.includes(player.teamId)) teamIds.push(player.teamId);
    }
    const teamIndexById = new Map(teamIds.map((id, idx) => [id, idx]));
    const teamLabelById = new Map<string, string>();
    for (const [index, teamId] of teamIds.entries()) {
      const members = recap.players
        .filter(player => player.teamId === teamId)
        .map(player => aliases[player.seatId] ?? `Pemain ${index + 1}`);
      teamLabelById.set(teamId, members.join(", ") || `Tim ${index + 1}`);
    }
    const [leader, runnerUp] = recap.standings;
    const decidingMetric = !recap.isSolo && leader?.teamId === recap.outcome.winnerTeamId && runnerUp && recap.outcome.reason !== "forfeit"
      ? claimRankingMetrics.find(([key]) => leader[key] > runnerUp[key])?.[1]
      : undefined;
    const winnerLabel = recap.outcome.winnerTeamId && !recap.isSolo
      ? (teamLabelById.get(recap.outcome.winnerTeamId) ?? null)
      : null;
    const players = recap.players.map((player, index) => ({
      alias: aliases[player.seatId] ?? `Pemain ${index + 1}`,
      teamIndex: teamIndexById.get(player.teamId) ?? 0,
    }));
    const standings = recap.standings.map((score, index) => ({
      teamLabel: teamLabelById.get(score.teamId) ?? `Tim ${index + 1}`,
      zonesControlled: score.zonesControlled,
      lockedLandmarks: score.lockedLandmarks,
      totalLandmarks: score.totalLandmarks,
      isWinner: Boolean(recap.outcome.winnerTeamId && score.teamId === recap.outcome.winnerTeamId),
    }));
    const moments: PublicRecapMoment[] = recap.highlights.slice(-3).map(event => {
      const actor = event.seatId ? (aliases[event.seatId] ?? "Pemain") : "Pemain";
      return {
        label: event.landmark,
        detail: `${event.kind === "stolen" ? "Direbut" : "Dikunci"} · ${actor}`,
      };
    });
    const result: PublicClaimMatchRecap = {
      ...base,
      format: "claim-the-city",
      isSolo: recap.isSolo,
      outcome: {
        reason: recap.outcome.reason,
        ...(recap.outcome.soloWon !== undefined ? { soloWon: recap.outcome.soloWon } : {}),
        winnerLabel,
        ...(decidingMetric ? { decidingMetric } : {}),
      },
      ...(recap.soloProgress ? { soloProgress: { ...recap.soloProgress } } : {}),
      players,
      standings,
      moments,
    };
    return result;
  }

  const players = recap.players.map((player, index) => ({
    alias: aliases[player.seatId] ?? `Pemain ${index + 1}`,
  }));
  const winnerLabel = recap.outcome.winnerSeatId
    ? (aliases[recap.outcome.winnerSeatId] ?? "Pemain")
    : null;
  const turns = recap.turns.map(turn => ({
    turnNumber: turn.turnNumber,
    hiderAlias: aliases[turn.hiderSeatId] ?? "Pemain",
    rawHidingMs: turn.rawHidingMs,
    bonusMs: turn.bonusMs,
    trapBonusMs: turn.trapBonusMs,
    penaltyMs: turn.penaltyMs,
    adjustedMs: turn.adjustedMs,
    reason: turn.reason,
    answeredQuestions: turn.answeredQuestions,
  }));
  const moments: PublicRecapMoment[] = turns.slice(0, 3).map(turn => ({
    label: `Giliran ${turn.turnNumber} · ${turn.hiderAlias}`,
    detail: `${formatDuration(turn.adjustedMs)} · ${seekTurnReasons[turn.reason]} · ${turn.answeredQuestions} pertanyaan dijawab`,
  }));
  const result: PublicSeekMatchRecap = {
    ...base,
    format: "hide-and-seek",
    phase: recap.phase,
    outcome: {
      reason: recap.outcome.reason,
      winnerLabel,
    },
    players,
    turns,
    moments,
  };
  return result;
}

export function summarizePublicRecap(recap: PublicMatchRecap): PublicMatchRecapSummary {
  let outcomeLabel: string;
  let scoreSummary: string;
  if (recap.format === "claim-the-city") {
    outcomeLabel = recap.outcome.winnerLabel && !recap.isSolo
      ? `Pemenang · ${recap.outcome.winnerLabel}`
      : recap.outcome.soloWon
        ? "Menang Solo"
        : recap.outcome.reason === "abandoned"
          ? "Ditinggalkan"
          : recap.outcome.reason === "canceled"
            ? "Dibatalkan"
            : recap.isSolo
              ? "Sesi Solo Berakhir"
              : recap.outcome.reason === "forfeit"
                ? "Ronde berakhir"
                : "Seri";
    if (recap.soloProgress) {
      scoreSummary = `${recap.soloProgress.lockedLandmarks}/${recap.soloProgress.targetLandmarks} landmark terkunci · ${recap.soloProgress.distinctZones}/${recap.soloProgress.targetZones} zona`;
    } else if (recap.standings.length > 0) {
      const top = recap.standings[0]!;
      scoreSummary = `${top.zonesControlled} zona · ${top.lockedLandmarks} terkunci · ${top.totalLandmarks} landmark`;
    } else {
      scoreSummary = `${recap.players.length} pemain`;
    }
  } else {
    outcomeLabel = recap.outcome.winnerLabel
      ? `Pemenang · ${recap.outcome.winnerLabel}`
      : recap.outcome.reason === "scored"
        ? "Seri"
        : recap.phase === "canceled"
          ? "Dibatalkan"
          : "Permainan belum lengkap";
    if (recap.turns.length > 0) {
      const best = Math.max(...recap.turns.map(turn => turn.adjustedMs));
      const totalQuestions = recap.turns.reduce((sum, turn) => sum + turn.answeredQuestions, 0);
      scoreSummary = `${recap.turns.length} giliran · terbaik ${formatDuration(best)} · ${totalQuestions} pertanyaan`;
    } else {
      scoreSummary = `${recap.players.length} pemain`;
    }
  }
  return {
    shareId: recap.shareId,
    packId: recap.packId,
    editionVersion: recap.editionVersion,
    title: recap.title,
    format: recap.format,
    completedAt: recap.completedAt,
    publishedAt: recap.publishedAt,
    simulated: recap.simulated,
    editionHref: recap.editionHref,
    outcomeLabel,
    scoreSummary,
    ...(recap.moments[0] ? { topMoment: recap.moments[0] } : {}),
    playerAliases: recap.players.map(player => player.alias),
  };
}

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
    CREATE TABLE IF NOT EXISTS rulebook_shared_recaps (
      share_id TEXT PRIMARY KEY,
      match_id TEXT UNIQUE NOT NULL REFERENCES rulebook_recaps(match_id),
      pack_id TEXT NOT NULL,
      edition_version INTEGER NOT NULL,
      published_at INTEGER NOT NULL,
      aliases TEXT NOT NULL,
      payload TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_rulebook_shared_edition
      ON rulebook_shared_recaps (pack_id, edition_version, published_at DESC);
  `);
  const insert = db.prepare("INSERT OR IGNORE INTO rulebook_recaps (match_id, completed_at, payload) VALUES (?, ?, ?)");
  const addParticipant = db.prepare("INSERT OR IGNORE INTO rulebook_recap_participants (credential_hash, match_id) VALUES (?, ?)");
  const copyParticipants = db.prepare(
    "INSERT OR IGNORE INTO rulebook_recap_participants (credential_hash, match_id) SELECT ?, match_id FROM rulebook_recap_participants WHERE credential_hash = ?",
  );
  const deleteParticipants = db.prepare(
    "DELETE FROM rulebook_recap_participants WHERE credential_hash = ?",
  );
  const read = db.prepare(`SELECT payload FROM rulebook_recaps JOIN rulebook_recap_participants USING (match_id)
    WHERE match_id = ? AND credential_hash = ?`);
  const list = db.prepare(`SELECT r.payload, s.share_id, s.published_at
    FROM rulebook_recaps r
    JOIN rulebook_recap_participants p ON p.match_id = r.match_id
    LEFT JOIN rulebook_shared_recaps s ON s.match_id = r.match_id
    WHERE p.credential_hash = ?
    ORDER BY r.completed_at DESC, r.match_id`);
  const exists = db.prepare("SELECT 1 FROM rulebook_recaps WHERE match_id = ?");
  const shareExists = db.prepare("SELECT 1 FROM rulebook_shared_recaps WHERE share_id = ?");
  const readShareByMatch = db.prepare(`SELECT share_id, published_at, aliases, payload
    FROM rulebook_shared_recaps WHERE match_id = ?`);
  const insertShare = db.prepare(`INSERT INTO rulebook_shared_recaps
    (share_id, match_id, pack_id, edition_version, published_at, aliases, payload)
    VALUES (?, ?, ?, ?, ?, ?, ?)`);
  const updateShare = db.prepare(`UPDATE rulebook_shared_recaps
    SET published_at = ?, aliases = ?, payload = ?
    WHERE match_id = ?`);
  const deleteShare = db.prepare("DELETE FROM rulebook_shared_recaps WHERE match_id = ?");
  const readPublicById = db.prepare("SELECT payload FROM rulebook_shared_recaps WHERE share_id = ?");
  const listPublicAll = db.prepare("SELECT payload FROM rulebook_shared_recaps ORDER BY published_at DESC, share_id DESC LIMIT 100");
  const listPublicByPack = db.prepare(`SELECT payload FROM rulebook_shared_recaps
    WHERE pack_id = ? ORDER BY published_at DESC, share_id DESC LIMIT 50`);
  const listPublicByEdition = db.prepare(`SELECT payload FROM rulebook_shared_recaps
    WHERE pack_id = ? AND edition_version = ? ORDER BY published_at DESC, share_id DESC LIMIT 50`);

  function generateShareId(): string {
    let shareId: string;
    do {
      shareId = `SR-${randomBytes(6).toString("hex").toUpperCase()}`;
    } while (shareExists.get(shareId));
    return shareId;
  }

  function readShareRecord(matchId: string): { share: RecapPublicShareState; publicRecap: PublicMatchRecap } | null {
    const row = readShareByMatch.get(matchId) as
      | { share_id: string; published_at: number; aliases: string; payload: string }
      | undefined;
    if (!row) return null;
    return {
      share: {
        shareId: row.share_id,
        publishedAt: row.published_at,
        aliases: JSON.parse(row.aliases) as Record<string, string>,
      },
      publicRecap: JSON.parse(row.payload) as PublicMatchRecap,
    };
  }

  function runInTx<T>(fn: () => T): T {
    if (db.isTransaction) return fn();
    db.exec("BEGIN IMMEDIATE");
    try {
      const result = fn();
      db.exec("COMMIT");
      return result;
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }

  return {
    save(recap: RulebookMatchRecap, participants: string[]) {
      runInTx(() => {
        const inserted = insert.run(recap.matchId, recap.completedAt, JSON.stringify(recap));
        if (Number(inserted.changes) > 0) {
          for (const member of participants) addParticipant.run(member, recap.matchId);
        }
      });
    },
    get(matchId: string, participantHash: string): RulebookMatchRecap | undefined {
      const row = read.get(matchId, participantHash) as { payload: string } | undefined;
      return row ? JSON.parse(row.payload) as RulebookMatchRecap : undefined;
    },
    getWithShare(matchId: string, participantHash: string):
      | { recap: RulebookMatchRecap; share: RecapPublicShareState | null; publicRecap: PublicMatchRecap | null }
      | undefined {
      const row = read.get(matchId, participantHash) as { payload: string } | undefined;
      if (!row) return undefined;
      const recap = JSON.parse(row.payload) as RulebookMatchRecap;
      const shared = readShareRecord(matchId);
      return {
        recap,
        share: shared?.share ?? null,
        publicRecap: shared?.publicRecap ?? null,
      };
    },
    list(participantHash: string): RulebookRecapSummary[] {
      return (list.all(participantHash) as { payload: string; share_id: string | null; published_at: number | null }[]).map(row => {
        const { matchId, completedAt, packId, editionVersion, title, format, simulated } = JSON.parse(row.payload) as RulebookMatchRecap;
        return {
          matchId,
          completedAt,
          packId,
          editionVersion,
          title,
          format,
          simulated,
          ...(row.share_id && row.published_at !== null
            ? { shared: { shareId: row.share_id, publishedAt: row.published_at } }
            : {}),
        };
      });
    },
    share(
      matchId: string,
      participantHash: string,
      options: ShareRecapOptions,
      now: number,
    ): { recap: RulebookMatchRecap; share: RecapPublicShareState; publicRecap: PublicMatchRecap } | undefined {
      return runInTx(() => {
        const row = read.get(matchId, participantHash) as { payload: string } | undefined;
        if (!row) return undefined;
        const recap = JSON.parse(row.payload) as RulebookMatchRecap;
        const aliases = resolvePublicAliases(recap, options);
        const existing = readShareRecord(matchId);
        const shareId = existing?.share.shareId ?? generateShareId();
        const publishedAt = existing?.share.publishedAt ?? now;
        const publicRecap = projectPublicRecap(recap, shareId, publishedAt, aliases);
        if (existing) {
          updateShare.run(publishedAt, JSON.stringify(aliases), JSON.stringify(publicRecap), matchId);
        } else {
          insertShare.run(
            shareId,
            matchId,
            recap.packId,
            recap.editionVersion,
            publishedAt,
            JSON.stringify(aliases),
            JSON.stringify(publicRecap),
          );
        }
        return {
          recap,
          share: { shareId, publishedAt, aliases },
          publicRecap,
        };
      });
    },
    unshare(
      matchId: string,
      participantHash: string,
    ): { recap: RulebookMatchRecap; share: null; publicRecap: null } | undefined {
      return runInTx(() => {
        const row = read.get(matchId, participantHash) as { payload: string } | undefined;
        if (!row) return undefined;
        const recap = JSON.parse(row.payload) as RulebookMatchRecap;
        deleteShare.run(matchId);
        return { recap, share: null, publicRecap: null };
      });
    },
    getPublic(shareId: string): PublicMatchRecap | undefined {
      const row = readPublicById.get(shareId) as { payload: string } | undefined;
      return row ? (JSON.parse(row.payload) as PublicMatchRecap) : undefined;
    },
    listPublic(packId?: string, editionVersion?: number): PublicMatchRecapSummary[] {
      const rows = (
        packId && editionVersion !== undefined
          ? listPublicByEdition.all(packId, editionVersion)
          : packId
            ? listPublicByPack.all(packId)
            : listPublicAll.all()
      ) as { payload: string }[];
      return rows.map(({ payload }) => summarizePublicRecap(JSON.parse(payload) as PublicMatchRecap));
    },
    has(matchId: string) {
      return Boolean(exists.get(matchId));
    },
    migrateParticipant(fromHash: string, toHash: string): number {
      if (fromHash === toHash) return 0;
      return runInTx(() => {
        copyParticipants.run(toHash, fromHash);
        const deleted = deleteParticipants.run(fromHash);
        return Number(deleted.changes);
      });
    },
  };
}
