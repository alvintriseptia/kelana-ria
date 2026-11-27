// Shared public contracts for Kelana Ria's unified Rulebook engine and PWA shell.
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

export type LocationFix = {
  latitude: number;
  longitude: number;
  accuracy: number;
  timestamp: number;
};

export type PackVersionStatus =
  | "draft"
  | "submitted"
  | "changes-requested"
  | "published"
  | "paused";

export type PackOrderStatus = "pending" | "settled" | "expired";
export type PackPaymentMode = "midtrans-sandbox" | "recorded-sandbox";

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
export type * from "./auth.js";
export type * from "./studio-cocreator.js";
