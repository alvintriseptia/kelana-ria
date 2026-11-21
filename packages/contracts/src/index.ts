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

export type SoloRouteAttribution = {
  source: "live" | "snapshot";
  provider: string;
  retrievedAt: string;
  attribution: string;
};

export type SoloOpeningSummary = {
  firstCheckpointId: string;
  stops: string[];
  zones: string[];
  estimatedDurationMs: number;
  withMissedConnectionMs: number;
  unvisitedCount: number;
};

export type SoloEditionOrigin = "prepared" | "live";

export type SoloEdition = {
  id: string;
  board?: "compact";
  boardVersion?: string;
  format?: "claim-the-city";
  players?: 1;
  origin?: SoloEditionOrigin;
  fallbackReason?: string;
  durationMs: number;
  targets: { landmarks: number; zones: number };
  start: SoloPoint;
  checkpoints: SoloCheckpoint[];
  routes?: SoloRouteAttribution;
  openings?: SoloOpeningSummary[];
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
  | { type: "replay"; freshEdition?: boolean }
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
  closedCheckpointId?: string;
};
