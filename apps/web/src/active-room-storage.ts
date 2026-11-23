import type { ActiveRulebookRoomPhase, ActiveRulebookRoomSummary } from "@kelana-ria/contracts";

const ACTIVE_ROOM_KEY = "kelana-active-room";
const DISMISSED_ROOMS_KEY = "kelana-dismissed-rooms";

const validPhases = new Set<ActiveRulebookRoomPhase>([
  "lobby",
  "active",
  "head_start",
  "seeking",
  "endgame",
  "regroup",
]);

function readDismissedSet(): Set<string> {
  try {
    const raw = localStorage.getItem(DISMISSED_ROOMS_KEY);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return new Set(parsed.filter((item): item is string => typeof item === "string"));
    }
  } catch {
    // Storage may be unavailable in private browsing.
  }
  return new Set();
}

function writeDismissedSet(codes: Set<string>) {
  try {
    const list = [...codes].slice(-32);
    if (list.length === 0) localStorage.removeItem(DISMISSED_ROOMS_KEY);
    else localStorage.setItem(DISMISSED_ROOMS_KEY, JSON.stringify(list));
  } catch {
    // Ignore storage write errors.
  }
}

export function isRoomDismissed(roomCode: string): boolean {
  return readDismissedSet().has(roomCode);
}

export function isUnfinishedRoomPhase(phase: string): phase is ActiveRulebookRoomPhase {
  return validPhases.has(phase as ActiveRulebookRoomPhase);
}

export function readStoredActiveRoom(): ActiveRulebookRoomSummary | undefined {
  try {
    const raw = localStorage.getItem(ACTIVE_ROOM_KEY);
    if (!raw) return undefined;
    const parsed = JSON.parse(raw) as Partial<ActiveRulebookRoomSummary>;
    if (
      typeof parsed.roomCode === "string" &&
      (parsed.format === "claim-the-city" || parsed.format === "hide-and-seek") &&
      typeof parsed.packId === "string" &&
      typeof parsed.version === "number" &&
      typeof parsed.title === "string" &&
      typeof parsed.phase === "string" &&
      isUnfinishedRoomPhase(parsed.phase) &&
      !isRoomDismissed(parsed.roomCode)
    ) {
      return parsed as ActiveRulebookRoomSummary;
    }
  } catch {
    // Ignore malformed storage entries.
  }
  return undefined;
}

export function saveActiveRoom(summary: ActiveRulebookRoomSummary) {
  try {
    const dismissed = readDismissedSet();
    if (dismissed.delete(summary.roomCode)) {
      writeDismissedSet(dismissed);
    }
    localStorage.setItem(ACTIVE_ROOM_KEY, JSON.stringify(summary));
  } catch {
    // Ignore storage write errors.
  }
}

export function clearActiveRoom(roomCode?: string) {
  try {
    if (roomCode) {
      const current = readStoredActiveRoom();
      if (current && current.roomCode !== roomCode) return;
    }
    localStorage.removeItem(ACTIVE_ROOM_KEY);
  } catch {
    // Ignore storage errors.
  }
}

export function dismissActiveRoom(roomCode: string) {
  const dismissed = readDismissedSet();
  dismissed.add(roomCode);
  writeDismissedSet(dismissed);
  clearActiveRoom(roomCode);
}

export function reconcileActiveRoomsFromServer(
  serverRooms: ActiveRulebookRoomSummary[],
): ActiveRulebookRoomSummary | undefined {
  const dismissed = readDismissedSet();
  const visible = serverRooms.filter(
    room => isUnfinishedRoomPhase(room.phase) && !dismissed.has(room.roomCode),
  );
  if (visible.length === 0) {
    clearActiveRoom();
    return undefined;
  }
  const current = readStoredActiveRoom();
  const matched = current ? visible.find(room => room.roomCode === current.roomCode) : undefined;
  const chosen = matched ?? visible[0];
  try {
    localStorage.setItem(ACTIVE_ROOM_KEY, JSON.stringify(chosen));
  } catch {
    // Ignore storage write errors.
  }
  return chosen;
}
