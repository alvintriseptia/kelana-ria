import type {
  HideSeekQuestionFamily,
  LocationFix,
  RoomActivityFeed,
  RulebookEntitlementSummary,
  SeekBoardPoint,
  SeekCardInstance,
  SeekDeckHiderView,
  SeekDeckPublicView,
  SeekDrawBatch,
  SeekEngineRoomView,
  SeekMapPreview,
  SeekMapPreviewRequest,
  SeekPublicBoard,
} from "@kelana-ria/contracts";
import type { PlayerErrorTone } from "../player-errors";

export type SeekPublicListing = {
  packId: string;
  version: number;
  format: "hide-and-seek";
  isOfficial: boolean;
  title: string;
  byline: string;
  summary: string;
  cityLabel: string;
  difficulty: string;
  priceIdr: number;
  minPlayers: number;
  maxPlayers: number;
  hidingZoneRadiusMeters: number;
  headStartMinutes: number;
  searchLimitMinutes: number;
  regroupMinutes: number;
  stationCount: number;
  startName: string;
  questionFamilies: { family: string; itemCount: number; drawCount: number; keepCount: number }[];
  deckSummary: {
    totalCards: number;
    timeBonuses: number;
    powerups: number;
    curses: number;
    baseHandLimit: number;
  };
};

export type SeekRoomPayload = {
  activity: RoomActivityFeed;
  stateRev?: number;
  room: SeekEngineRoomView;
  publicBoard: SeekPublicBoard;
  qa?: true;
  draftPlaytest?: true;
  deck: SeekDeckPublicView | SeekDeckHiderView;
  pass: {
    roomCode: string;
    packId: string;
    version: number;
    minPlayers?: number;
    maxPlayers: number;
    paid: boolean;
    mode?: "group";
    draftPlaytest?: boolean;
  };
};

export type CapturedLocation = LocationFix & { qaLocationId?: string };

export type QuestionDraft = {
  key: string;
  referenceKey: string;
  query: Omit<SeekMapPreviewRequest, "fix">;
};

export type DraftPreviewState = {
  key: string;
  data: SeekMapPreview;
  fix: CapturedLocation;
  validUntil?: number;
};

export type DraftFixState = {
  referenceKey: string;
  fix: CapturedLocation;
  validUntil?: number;
};

export type SeekInlineSlot =
  | "catalog"
  | "join"
  | "lobby"
  | "lobby-checkin"
  | "board-checkin"
  | "regroup-checkin"
  | "found-code"
  | "ask-field"
  | "answer-field"
  | "answer-photo"
  | "curse-action";

export type SeekInlineError = {
  slot: SeekInlineSlot;
  code: string;
  message: string;
  tone: PlayerErrorTone;
  targetId?: string;
} | null;

export type PendingSeekAction = {
  signature: string;
  id: string;
  kind: string;
  cardInstanceId?: string;
  stationId?: string;
  questionId?: string;
  family?: string;
  itemId?: string;
  drawKey?: string;
};

export type SeekPanel = "ask" | "hand" | "question" | "history" | "activity" | "board" | "qa";

export const phaseLabels: Record<SeekEngineRoomView["phase"], string> = {
  lobby: "Ruang Tunggu",
  head_start: "Waktu Sembunyi",
  seeking: "Fase Cari",
  regroup: "Berkumpul Kembali",
  finished: "Selesai",
  void: "Batal",
  incomplete: "Tidak Lengkap",
  canceled: "Dibatalkan",
};

export const familyLabels: Record<HideSeekQuestionFamily, string> = {
  radar: "Radar",
  thermometer: "Termometer",
  matching: "Cocokkan",
  measuring: "Bandingkan",
  tentacles: "Tempat Terdekat",
  photo: "Foto",
};

export const questionNames: Record<HideSeekQuestionFamily, string> = {
  radar: "Radar",
  matching: "Cocokkan",
  measuring: "Bandingkan",
  thermometer: "Termometer",
  tentacles: "Tempat terdekat",
  photo: "Foto",
};

export const questionDescriptions: Record<HideSeekQuestionFamily, string> = {
  radar: "Cari dalam radius",
  matching: "Cari ciri yang sama",
  measuring: "Siapa lebih dekat?",
  thermometer: "Mendekat atau menjauh?",
  tentacles: "Cari tempat di sekitar",
  photo: "Minta petunjuk visual",
};

const questionStatusLabels: Record<string, string> = {
  pending: "Menunggu jawaban",
  answered: "Dijawab",
  timeout: "Waktu habis",
  vetoed: "Dibatalkan (Veto)",
  closed: "Ditutup",
};

export function questionStatusLabel(status: string): string {
  return questionStatusLabels[status] ?? status;
}

const curseBlockerLabels: Record<string, string> = {
  block_questions: "Blokir pertanyaan",
  block_transit: "Blokir transit",
  block_both: "Blokir pertanyaan & transit",
  block_steals: "Blokir rebut",
  block_claims: "Blokir klaim",
  none: "Tanpa blokir",
};

export function curseBlockerLabel(blockerType: string): string {
  return curseBlockerLabels[blockerType] ?? blockerType;
}

const curseClearLabels: Record<string, string> = {
  timer: "Tunggu timer",
  next_n_questions: "Jawab beberapa pertanyaan",
  gps_detour: "Check-in lokasi",
  photo_challenge: "Bukti foto",
  honor_task: "Tugas langsung",
};

export function curseClearLabel(clearType: string): string {
  return curseClearLabels[clearType] ?? clearType;
}

const answers: Record<string, string> = {
  Yes: "Ya, di dalam radar",
  No: "Tidak, di luar radar",
  Same: "Sama",
  Different: "Berbeda",
  Hotter: "Lebih dekat",
  Colder: "Lebih jauh",
  Equal: "Sama jauh",
  "Seeker closer": "Pencari lebih dekat",
  "Hider closer": "Penyembunyi lebih dekat",
  "Photo delivered": "Foto diterima",
  "Outside radius": "Di luar radius",
};

export function answerText(label: string): string {
  return answers[label] ?? label;
}

export const objectiveChoices: Record<
  Exclude<HideSeekQuestionFamily, "photo" | "tentacles">,
  [string, string][]
> = {
  radar: [
    ["yes", "Di dalam"],
    ["no", "Di luar"],
  ],
  thermometer: [
    ["hotter", "Lebih dekat"],
    ["colder", "Lebih jauh"],
    ["equal", "Sama jauh"],
  ],
  matching: [
    ["same", "Sama"],
    ["different", "Berbeda"],
  ],
  measuring: [
    ["seeker_closer", "Pencari lebih dekat"],
    ["hider_closer", "Penyembunyi lebih dekat"],
    ["equal", "Sama jauh"],
  ],
};

export const cardCategoryLabels: Record<SeekCardInstance["category"], string> = {
  time_bonus: "Bonus waktu",
  powerup: "Powerup",
  curse: "Kutukan",
};

export function rewardLabel(batches: SeekDrawBatch[]): string {
  const draw = batches.reduce((sum, batch) => sum + batch.drawCount, 0);
  const keep = batches.reduce((sum, batch) => sum + batch.keepCount, 0);
  return draw > 0 ? `Ambil ${draw} · Simpan ${keep}` : "Tanpa kartu";
}

export function idr(amount: number): string {
  return amount === 0 ? "Gratis (Resmi)" : `Rp ${amount.toLocaleString("id-ID")} · Beli sekali`;
}

export function clockText(milliseconds: number): string {
  const seconds = Math.max(0, Math.ceil(milliseconds / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

export function isBoardPhase(room: SeekEngineRoomView): boolean {
  return room.phase === "head_start" || room.phase === "seeking";
}

export function isDraftPlaytest(payload: SeekRoomPayload | null): boolean {
  return Boolean(payload?.draftPlaytest || payload?.pass?.draftPlaytest);
}

export function roomPoints({ room, publicBoard }: SeekRoomPayload): SeekBoardPoint[] {
  const points = [room.turnStartPoint, publicBoard.startPoint, ...publicBoard.stations];
  if (room.regroupPoint) points.unshift(room.regroupPoint);
  return [...new Map(points.map((point) => [point.id, point])).values()];
}

export function qaPoint(payload: SeekRoomPayload, qaStationId: string): SeekBoardPoint {
  return (
    roomPoints(payload).find((point) => point.id === qaStationId) ??
    payload.room.regroupPoint ??
    payload.room.turnStartPoint
  );
}

export function orderedSeekSeats(room: SeekEngineRoomView): SeekEngineRoomView["seats"] {
  const byId = new Map(room.seats.map((s) => [s.seatId, s]));
  const ordered: SeekEngineRoomView["seats"] = [];
  for (const id of room.turnOrder) {
    const seat = byId.get(id);
    if (seat) {
      ordered.push(seat);
      byId.delete(id);
    }
  }
  for (const seat of byId.values()) ordered.push(seat);
  return ordered;
}

export function destructiveExitSpec(payload: SeekRoomPayload): {
  label: string;
  title: string;
  body: string;
  toastText: string;
} | null {
  const { room, pass } = payload;
  if (room.outcome) return null;
  const own = room.seats.find((s) => s.seatId === room.seatId);
  if (!own) return null;
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
  return {
    label: "Menyerah & Keluar",
    title: "Menyerah dan keluar dari permainan?",
    body: "Keluar di tengah pertandingan akan mengakhiri sesi Hide & Seek ini sebagai menyerah untuk seluruh ruang.",
    toastText: "Kamu keluar dari permainan.",
  };
}

export function readSessionId(key: string): string | undefined {
  try {
    return sessionStorage.getItem(key) ?? undefined;
  } catch {
    return undefined;
  }
}

export function writeSessionId(key: string, value?: string): void {
  try {
    if (value) sessionStorage.setItem(key, value);
    else sessionStorage.removeItem(key);
  } catch {
    // Storage may be unavailable in restricted contexts.
  }
}

export function inlineSlotForSeekAction(
  action: Record<string, unknown>,
  roomPhase?: SeekEngineRoomView["phase"],
): SeekInlineSlot {
  const type = String(action.type ?? "");
  if (type === "check-in-start") return "lobby-checkin";
  if (type === "regroup-check-in") return "regroup-checkin";
  if (type === "lock-anchor" || type === "seeker-check-in") {
    return "board-checkin";
  }
  if (type === "submit-found-code") return "found-code";
  if (type === "ask" || type === "start-thermometer") return "ask-field";
  if (type === "answer-question") return "answer-field";
  return roomPhase === "lobby" ? "lobby" : "board-checkin";
}

export type SeekEntitlementList = RulebookEntitlementSummary[];
