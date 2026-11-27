import type {
  ClaimActiveAttemptView,
  ClaimCardInstance,
  ClaimEngineRoomView,
  ClaimLandmarkState,
  ClaimPublicBoard,
  ClaimSanitizedLeafChallenge,
  GeoCoordinate,
  RoomActivityFeed,
  RulebookPlayMode,
} from "@kelana-ria/contracts";
import type { PlayerErrorTone } from "../player-errors";

export type ClaimPublicListing = {
  packId: string;
  version: number;
  format: "claim-the-city";
  isOfficial: boolean;
  title: string;
  byline: string;
  summary: string;
  cityLabel: string;
  difficulty: string;
  priceIdr: number;
  minPlayers: number;
  maxPlayers: number;
  teamMode: string;
  durationMinutes: number;
  soloTargets: { lockedLandmarks: number; distinctZones: number } | null;
  startName: string;
  zones: { id: string; name: string; label: string; landmarkCount: number }[];
  landmarkCount: number;
  challengePrimitives: string[];
  tacticalDeckSummary: { enabled: boolean; totalCards: number; maxHandSize: number };
};

export type ClaimRoomPayload = {
  activity: RoomActivityFeed;
  format: "claim-the-city";
  qa?: true;
  draftPlaytest?: true;
  stateRev?: number;
  room: ClaimEngineRoomView;
  publicBoard: ClaimPublicBoard;
  pass: {
    roomCode: string;
    packId: string;
    version: number;
    maxPlayers: number;
    paid: boolean;
    minPlayers?: number;
    mode?: RulebookPlayMode;
    draftPlaytest?: boolean;
  };
};

export type ClaimInlineSlot =
  | "catalog"
  | "join"
  | "lobby"
  | "lobby-checkin"
  | "landmark-checkin"
  | "challenge-input"
  | "challenge-photo"
  | "challenge-gps"
  | "curse-action";

export type ClaimInlineError = {
  slot: ClaimInlineSlot;
  code: string;
  message: string;
  tone: PlayerErrorTone;
  targetId?: string;
} | null;

export type PendingClaimAction = {
  signature: string;
  id: string;
  kind: string;
  cardInstanceId?: string;
  landmarkId?: string;
};

export type ClaimPanel = "challenge" | "cards" | "score" | "activity";

export type DestructiveExitSpec = {
  label: string;
  title: string;
  body: string;
  toastText: string;
};

export const phaseLabels: Record<ClaimEngineRoomView["phase"], string> = {
  lobby: "Ruang Tunggu",
  active: "Permainan Aktif",
  finished: "Selesai",
  abandoned: "Ditinggalkan",
  canceled: "Dibatalkan",
};

const claimPrimitiveLabels: Record<string, string> = {
  observation_mcq: "Pilihan Ganda",
  observation_input: "Isian",
  photo_proof: "Bukti Foto",
  timed_micro_task: "Tugas Cepat",
  call_your_shot: "Standar / Ekstra",
  multi_step: "2 Langkah",
};

export function claimPrimitiveLabel(primitive: string): string {
  return claimPrimitiveLabels[primitive] ?? primitive;
}

export function idr(amount: number): string {
  return amount === 0 ? "Gratis (Resmi)" : `Rp ${amount.toLocaleString("id-ID")} · Beli sekali`;
}

export function getActiveLeaf(attempt: ClaimActiveAttemptView): ClaimSanitizedLeafChallenge | null {
  const payload = attempt.challenge.payload;
  if (payload.primitive === "call_your_shot") {
    return payload.activeTask ?? null;
  }
  if (payload.primitive === "multi_step") {
    return payload.steps[attempt.currentStep] ?? null;
  }
  return payload;
}

export const claimPanels: { id: ClaimPanel; icon: string; name: string }[] = [
  { id: "challenge", icon: "◆", name: "Tantangan" },
  { id: "cards", icon: "▣", name: "Kartu" },
  { id: "score", icon: "◈", name: "Skor" },
];

export const cardLabels: Record<ClaimCardInstance["effect"]["primitive"], [string, string]> = {
  scout_challenge: ["Intai", "scout"],
  shield_claim: ["Lindungi", "shield"],
  double_weight: ["Bobot Ganda", "double"],
  swap_challenge: ["Tukar", "swap"],
  instant_lock: ["Kunci Instan", "lock"],
  sabotage_curse: ["Sabotase", "curse"],
};

export function landmarkStatus(landmark: ClaimLandmarkState): string {
  if (landmark.status === "locked") return "Terkunci";
  if (landmark.status === "claimed") return "Rentan direbut";
  return "Belum diklaim";
}

export function teamName(room: ClaimEngineRoomView, teamId: string): string {
  const names = room.seats.filter((seat) => seat.teamId === teamId).map((seat) => seat.name);
  return names.length ? names.join(", ") : teamId;
}

export function seatInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
  return (parts[0] ?? "P").slice(0, 2).toUpperCase();
}

export function zoneLabelFor(room: ClaimEngineRoomView, zoneId?: string): string {
  if (!zoneId) return "";
  const zone = room.zones.find((z) => z.zoneId === zoneId);
  return zone?.name || zone?.label || "";
}

export function clockLabel(ms: number): string {
  const seconds = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

export function isDraftPlaytest(payload: ClaimRoomPayload | null): boolean {
  return Boolean(payload?.draftPlaytest || payload?.pass?.draftPlaytest);
}

export function isQaRoom(payload: ClaimRoomPayload | null): boolean {
  return Boolean(payload?.qa || isDraftPlaytest(payload));
}

export function resolveQaCoord(payload: ClaimRoomPayload, qaLocationId: string): GeoCoordinate | null {
  if (!qaLocationId) return null;
  if (payload.publicBoard.startPoint.id === qaLocationId) return payload.publicBoard.startPoint;
  return payload.publicBoard.landmarks.find((item) => item.id === qaLocationId) ?? null;
}

export function cardTargets(room: ClaimEngineRoomView, card?: ClaimCardInstance): string[] {
  return room.landmarks
    .filter((lm) => {
      const own = lm.ownerTeamId === room.teamId;
      switch (card?.effect.primitive) {
        case "scout_challenge":
          return (
            !room.ownChallengeHand &&
            lm.status !== "locked" &&
            !room.scoutedChallenges[lm.landmarkId] &&
            !room.ownBurnedLandmarks.includes(lm.landmarkId)
          );
        case "shield_claim":
          return !room.isSolo && own && lm.status === "claimed";
        case "instant_lock":
          return (
            own &&
            lm.status === "claimed" &&
            (!room.ownChallengeHand || room.ownActiveAttempt?.landmarkId === lm.landmarkId) &&
            (!room.ownActiveAttempt || room.ownActiveAttempt.landmarkId === lm.landmarkId)
          );
        case "double_weight":
          return own && lm.status === "locked" && !lm.doubleWeighted;
        case "swap_challenge":
          return room.ownActiveAttempt?.landmarkId === lm.landmarkId;
        default:
          return false;
      }
    })
    .map((lm) => lm.landmarkId);
}

export function nextFreshTeamId(seats: ClaimEngineRoomView["seats"]): string {
  const used = new Set(seats.map((s) => s.teamId));
  for (let i = 1; i <= seats.length + 20; i++) {
    const candidate = `team-${i}`;
    if (!used.has(candidate)) return candidate;
  }
  return `team-${Date.now()}`;
}

export function orderedTeamIds(seats: ClaimEngineRoomView["seats"]): string[] {
  const ids: string[] = [];
  for (const s of seats) {
    if (!ids.includes(s.teamId)) ids.push(s.teamId);
  }
  return ids;
}

export function destructiveExitSpec(payload: ClaimRoomPayload): DestructiveExitSpec | null {
  const { room, pass } = payload;
  if (room.outcome) return null;
  const own = room.seats.find((s) => s.seatId === room.seatId);
  if (!own || own.leftAt != null) return null;
  if (room.phase === "lobby") {
    if (own.isHost) {
      return {
        label: "Batalkan Ruang",
        title: "Batalkan ruang ini?",
        body: pass.paid
          ? "Semua pemain akan keluar dari lobi, dan slot ruang aktif paket berbayarmu langsung terbuka kembali."
          : "Semua pemain yang sudah bergabung akan keluar dari lobi ini.",
        toastText: "Ruang dibatalkan.",
      };
    }
    return {
      label: "Tinggalkan Lobi",
      title: "Tinggalkan lobi?",
      body: "Kursimu di lobi akan dilepas. Kamu tetap bisa gabung lagi selama Host belum memulai permainan.",
      toastText: "Kamu meninggalkan lobi.",
    };
  }
  if (room.phase === "active") {
    if (room.isSolo) {
      return {
        label: "Akhiri Permainan",
        title: "Akhiri permainan solo?",
        body: "Ronde solo ini akan berakhir sebagai ditinggalkan dan tidak bisa dilanjutkan lagi.",
        toastText: "Permainan solo diakhiri.",
      };
    }
    return {
      label: "Menyerah & Keluar",
      title: "Menyerah dan keluar dari pertandingan?",
      body: "Kamu akan keluar dari pertandingan aktif. Jika tinggal 1 tim aktif, pertandingan langsung selesai; jika masih ada minimal 2 tim aktif, pemain lain tetap melanjutkan.",
      toastText: "Kamu keluar dari pertandingan.",
    };
  }
  return null;
}

export function readSessionId(key: string): string | undefined {
  try {
    return sessionStorage.getItem(key) ?? undefined;
  } catch {
    return undefined;
  }
}

export function writeSessionId(key: string, value?: string) {
  try {
    if (value) sessionStorage.setItem(key, value);
    else sessionStorage.removeItem(key);
  } catch {
    // Storage may be unavailable in restricted contexts.
  }
}
