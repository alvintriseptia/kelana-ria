// Public setup choices from PRD section 2.
export type GameBoard = "compact" | "jakarta-wide";

export type GameConfiguration = {
  board: GameBoard;
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
  board?: GameBoard;
  boardVersion?: string;
  format?: "claim-the-city";
  players?: 1 | 2;
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
  paidPack?: {
    packId: string;
    version: number;
    title: string;
    byline: string;
    orderId: string;
    players: 1 | 2;
    sandbox: true;
  };
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

export type PackOrderStatus = "pending" | "settled" | "expired";
export type PackPaymentMode = "midtrans-sandbox" | "recorded-sandbox";

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
  currency: "IDR";
  grossAmountIdr: number;
  platformFeeIdr: number;
  creatorShareIdr: number;
  status: PackOrderStatus;
  createdAt: number;
  expiresAt: number;
  checkoutReturnedAt: number | null;
  settledAt: number | null;
  passId: string | null;
  roomCode: string | null;
  earningsEntryId: string | null;
  paymentMode: PackPaymentMode;
  snapRedirectUrl?: string;
  supportNote?: string;
  sandbox: true;
};

export type PackEarningsEntry = {
  earningsEntryId: string;
  orderId: string;
  packId: string;
  version: number;
  title: string;
  byline: string;
  currency: "IDR";
  grossAmountIdr: number;
  platformFeeIdr: number;
  creatorShareIdr: number;
  settledAt: number;
  paymentMode: PackPaymentMode;
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
  | { type: "checkout-return"; orderId: string }
  | {
      type: "verify-settlement";
      orderId: string;
      statusCode?: string;
      transactionStatus?: "pending" | "settlement" | "expire" | "cancel" | "deny";
      grossAmount?: string;
      currency?: string;
      signatureKey?: string;
    }
  | { type: "redeem-pass"; passId: string; roomCode: string }
);

export type PackWorkspaceReply = {
  role: PackRole;
  listings: PackPublicListing[];
  versions?: PackVersionDetail[];
  closures?: PackClosureReport[];
  orders: PackOrderSummary[];
  earnings?: PackEarningsEntry[];
  error?: string;
};

export type SeekTurn = 1 | 2;

export type SeekPhase = "lobby" | "head-start" | "seeking" | "regroup"
  | "finished" | "void" | "incomplete" | "canceled";

export type SeekQuestionFamily = "radar" | "photo" | "warmer" | "matching" | "measuring" | "nearest";
export type SeekCardKind = "time-bonus" | "question-delay" | "hand-swap";

export type SeekQuestionInput = { radiusMeters?: number; landmarkId?: string };
export type SeekClueChoice = { id: string; label: string };
export type SeekClueMenuItem = {
  family: SeekQuestionFamily;
  responseMs: number;
  drawCount: number;
  keepCount: number;
  options: (SeekQuestionInput & { label?: string; landmarkIds?: string[] })[];
};

export type SeekQuestion = SeekQuestionInput & {
  id: string;
  family: SeekQuestionFamily;
  referenceId: string;
  previousReferenceId?: string;
  landmarkIds?: string[];
  askedAt: number;
  deadline: number;
  drawCount: number;
  keepCount: number;
  status: "pending" | "answered" | "timeout" | "substituted" | "closed";
  choices?: SeekClueChoice[];
  walkingComparison?: { firstMeters: number; secondMeters: number };
  answer?: string;
  photoId?: string;
};

export type SeekCard = { id: string; kind: SeekCardKind };
export type SeekClueView = {
  landmarks: SoloPoint[];
  branches: Record<string, string>;
  distanceSource: string;
  equalToleranceMeters: number;
  referenceId?: string;
  previousReferenceId?: string;
  menu: SeekClueMenuItem[];
  questions: SeekQuestion[];
  delayUntil: number | null;
  hand?: SeekCard[];
  draw?: { cards: SeekCard[]; keepCount: number; deadline: number };
};

export type SeekTurnResult = {
  turn: SeekTurn;
  hider: DuoSeat;
  checkpointId: string;
  hidingMs: number;
  bonusMs?: number;
  adjustedMs?: number;
  clues?: SeekQuestion[];
  reason: "found" | "timeout";
  at: number;
};

export type SeekRoom = {
  code: string;
  seat: DuoSeat;
  edition: {
    id: string;
    board?: GameBoard;
    boardVersion?: string;
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
  clues?: SeekClueView;
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
  | { type: "reference"; turn: SeekTurn; checkpointId: string; fix: LocationFix }
  | ({ type: "ask"; turn: SeekTurn; family: SeekQuestionFamily; referenceId?: string; previousReferenceId?: string } & SeekQuestionInput)
  | { type: "answer-question"; turn: SeekTurn; questionId: string; choiceId?: string; photo?: string }
  | { type: "photo-unavailable"; turn: SeekTurn; questionId: string }
  | { type: "choose-cards"; turn: SeekTurn; cardIds: string[]; discardIds?: string[] }
  | { type: "play-card"; turn: SeekTurn; cardId: string; discardId?: string }
  | { type: "leave"; phase: "lobby" | "head-start" | "seeking" | "regroup"; turn: SeekTurn }
);

export type SeekReply = {
  room?: SeekRoom;
  error?: string;
  distanceMeters?: number;
  investigation?: "miss" | "found";
};

export type MapConfig = {
  mode: "geoapify-vector" | "offline-vector";
  styleUrl: string | null;
  attribution: string;
  mapLibreLicenseUrl: string;
  tileCreditCost: number;
  routingCreditCost: number;
  freeDailyCredits: number;
};

export type MapUsageSummary = {
  mode: "geoapify-vector" | "offline-vector";
  tileRequests: number;
  tileFailures: number;
  estimatedTileCredits: number;
  routingRequests: number;
  estimatedRoutingCredits: number;
  totalEstimatedCredits: number;
  freeDailyCredits: number;
};

export type * from "./rulebook.js";
export type * from "./rulebook-seek.js";
export type * from "./rulebook-claim.js";
export { matchesClaimInputAnswer } from "./claim-answer.js";
export type * from "./rulebook-recap.js";
export * from "./rulebook-activity.js";
