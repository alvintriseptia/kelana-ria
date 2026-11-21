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

export type PackRole = "public" | "writer" | "reviewer";

export type PackVersionStatus =
  | "draft"
  | "submitted"
  | "changes-requested"
  | "published"
  | "paused";

export type PackTaskInput = {
  checkpointId: string;
  question: string;
  choices: { id: string; label: string }[];
  correctChoiceId: string;
  verificationNotes: string;
};

export type PackPublicCheckpoint = {
  id: string;
  name: string;
  zone: string;
  transit: string;
};

export type PackOrderSummary = {
  orderId: string;
  packId: string;
  version: number;
  title: string;
  byline: string;
  players: 1 | 2;
  grossAmountIdr: number;
  platformFeeIdr: number;
  creatorShareIdr: number;
  status: "settled";
  settledAt: number;
  supportNote?: string;
  sandbox: true;
};

export type PackPublicListing = {
  packId: string;
  version: number;
  status: "published";
  byline: string;
  title: string;
  format: "claim-the-city";
  board: "compact";
  boardVersion: string;
  supportedPlayers: (1 | 2)[];
  priceIdr: number;
  startName: string;
  areaSummary: string;
  durationMinutes: number;
  transitFaresNote: string;
  publishedAt: number;
  checkpoints: PackPublicCheckpoint[];
};

export type PackVersionDetail = {
  packId: string;
  version: number;
  status: PackVersionStatus;
  byline: string;
  title: string;
  format: "claim-the-city";
  board: "compact";
  boardVersion: string;
  supportedPlayers: (1 | 2)[];
  priceIdr: number;
  durationMinutes: number;
  updatedAt: number;
  publishedAt: number | null;
  reviewNote: string | null;
  pausedReason: string | null;
  tasks: PackTaskInput[];
};

export type PackClosureReport = {
  reportId: string;
  packId: string;
  version: number;
  checkpointId: string;
  reason: string;
  reportedAt: number;
};

export type PackDraftPayload = {
  packId?: string;
  byline: string;
  title: string;
  format: "claim-the-city";
  board: "compact";
  supportedPlayers: (1 | 2)[];
  priceIdr: number;
  tasks: PackTaskInput[];
};

export type PackAction = { actionId: string } & (
  | { type: "save-draft"; draft: PackDraftPayload }
  | { type: "submit-draft"; packId: string; version: number }
  | { type: "request-changes"; packId: string; version: number; note: string }
  | { type: "publish-version"; packId: string; version: number }
  | { type: "report-closure"; packId: string; version: number; checkpointId: string; reason: string }
  | { type: "pause-version"; packId: string; version: number; reason: string }
  | { type: "create-order"; packId: string; version: number; players: 1 | 2 }
);

export type PackWorkspaceReply = {
  role: PackRole;
  listings: PackPublicListing[];
  versions?: PackVersionDetail[];
  closures?: PackClosureReport[];
  orders: PackOrderSummary[];
  error?: string;
};
