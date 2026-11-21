// Public setup choices from PRD section 2.
export type GameConfiguration = {
  board: "compact" | "jakarta-wide";
} & (
  | { format: "hide-and-seek"; players: 2 }
  | { format: "claim-the-city"; players: 1 | 2 }
);

export type SoloPoint = {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  x: number;
  y: number;
};

export type SoloCheckpoint = SoloPoint & { zone: string; transit: string };

export type SoloEdition = {
  id: string;
  durationMs: number;
  targets: { landmarks: number; zones: number };
  start: SoloPoint;
  checkpoints: SoloCheckpoint[];
};

export type LocationFix = {
  latitude: number;
  longitude: number;
  accuracy: number;
  timestamp: number;
};

export type SoloEvent = {
  type: "started" | "claimed" | "won" | "expired" | "abandoned";
  at: number;
  checkpointId?: string;
};

export type SoloSession = {
  id: string;
  edition: SoloEdition;
  phase: "briefing" | "active" | "won" | "lost" | "abandoned";
  now: number;
  startVerifiedUntil: number | null;
  startedAt: number | null;
  deadline: number | null;
  claimed: string[];
  zones: string[];
  events: SoloEvent[];
  visits: Record<string, number>;
  cooldowns: Record<string, number>;
};

export type SoloAction = { actionId: string; sessionId: string } & (
  | { type: "check-in"; checkpointId: string; fix: LocationFix }
  | { type: "start" }
  | { type: "answer"; checkpointId: string; choiceId: string; fix?: LocationFix }
  | { type: "abandon" }
  | { type: "replay" }
);

export type SoloChallenge = {
  checkpointId: string;
  prompt: string;
  choices: { id: string; label: string }[];
};

export type SoloReply = {
  session: SoloSession;
  error?: string;
  challenge?: SoloChallenge;
  distanceMeters?: number;
};

export type DuoSeat = "host" | "guest";

export type DuoZone = {
  name: string;
  host: number;
  guest: number;
  owner: DuoSeat | null;
};

export type DuoEvent = {
  type: "started" | "claimed" | "finished" | "canceled";
  at: number;
  seat?: DuoSeat;
  checkpointId?: string;
};

export type DuoRoom = {
  code: string;
  seat: DuoSeat;
  edition: Omit<SoloEdition, "targets">;
  phase: "lobby" | "active" | "finished" | "canceled";
  now: number;
  startedAt: number | null;
  deadline: number | null;
  startVerifiedUntil: number | null;
  seats: Record<DuoSeat, { joined: boolean; ready: boolean }>;
  owners: Partial<Record<string, DuoSeat>>;
  landmarks: Record<DuoSeat, number>;
  zones: DuoZone[];
  outcome: { winner: DuoSeat | null; reason: "time" | "all-claimed" | "forfeit" | "canceled" } | null;
  events: DuoEvent[];
  visits: Record<string, number>;
  cooldowns: Record<string, number>;
};

export type DuoAction = { actionId: string } & (
  | { type: "check-in"; checkpointId: string; fix: LocationFix }
  | { type: "ready"; ready: boolean }
  | { type: "start" }
  | { type: "answer"; checkpointId: string; choiceId: string; fix?: LocationFix }
  | { type: "leave"; phase: "lobby" | "active" }
);

export type DuoReply = {
  room?: DuoRoom;
  error?: string;
  challenge?: SoloChallenge;
  distanceMeters?: number;
};

export type SeekTurn = 1 | 2;

export type SeekPhase = "lobby" | "head-start" | "seeking" | "regroup"
  | "finished" | "void" | "incomplete" | "canceled";

export type SeekTurnResult = {
  turn: SeekTurn;
  hider: DuoSeat;
  checkpointId: string;
  hidingMs: number;
  reason: "found" | "timeout";
  at: number;
};

export type SeekRoom = {
  code: string;
  seat: DuoSeat;
  edition: {
    id: string;
    start: SoloPoint;
    checkpoints: SoloPoint[];
    headStartMs: number;
    searchMs: number;
    regroupMs: number;
  };
  phase: SeekPhase;
  now: number;
  turn: SeekTurn;
  firstHider: DuoSeat | null;
  roleRevision: number;
  hider: DuoSeat | null;
  startedAt: number | null;
  releaseAt: number | null;
  phaseEndsAt: number | null;
  startVerifiedUntil: number | null;
  seats: Record<DuoSeat, { joined: boolean; ready: boolean; regrouped: boolean }>;
  canInvestigate: boolean;
  ruledOut: string[];
  ownLock?: string;
  turns: SeekTurnResult[];
  outcome: {
    winner: DuoSeat | null;
    reason: "scored" | "missed-lock" | "regroup-timeout" | "forfeit" | "canceled";
    at: number;
  } | null;
};

export type SeekAction = { actionId: string } & (
  | { type: "assign"; hider: DuoSeat }
  | { type: "check-in"; phase: "lobby" | "seeking" | "regroup"; turn: SeekTurn; fix: LocationFix }
  | { type: "ready"; ready: boolean; roleRevision: number }
  | { type: "start" }
  | { type: "lock" | "investigate"; turn: SeekTurn; checkpointId: string; fix: LocationFix }
  | { type: "leave"; phase: "lobby" | "head-start" | "seeking" | "regroup"; turn: SeekTurn }
);

export type SeekReply = {
  room?: SeekRoom;
  error?: string;
  distanceMeters?: number;
  investigation?: "miss" | "found";
};
