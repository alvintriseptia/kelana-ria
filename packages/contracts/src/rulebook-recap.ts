import type { ClaimEngineOutcome, ClaimEngineRoomView, ClaimTeamScore } from "./rulebook-claim.js";
import type { SeekEngineOutcome, SeekEngineTurnResult } from "./rulebook-seek.js";

type RecapEdition = {
  matchId: string;
  packId: string;
  editionVersion: number;
  title: string;
  completedAt: number;
  simulated: boolean;
};

type RecapPlayer = { seatId: string; name: string };

export type ClaimMatchRecap = RecapEdition & {
  format: "claim-the-city";
  isSolo: boolean;
  outcome: Omit<ClaimEngineOutcome, "at">;
  players: (RecapPlayer & { teamId: string })[];
  soloProgress?: NonNullable<ClaimEngineRoomView["soloProgress"]>;
  standings: ClaimTeamScore[];
  highlights: { kind: "locked" | "stolen"; landmark: string; seatId?: string }[];
};

export type SeekMatchRecap = RecapEdition & {
  format: "hide-and-seek";
  phase: "finished" | "void" | "incomplete" | "canceled";
  outcome: Omit<SeekEngineOutcome, "at">;
  players: RecapPlayer[];
  turns: (Pick<SeekEngineTurnResult,
    "turnNumber" | "hiderSeatId" | "rawHidingMs" | "bonusMs" | "trapBonusMs" | "penaltyMs" | "adjustedMs" | "reason"
  > & { answeredQuestions: number })[];
};

export type RulebookMatchRecap = ClaimMatchRecap | SeekMatchRecap;

export type RecapPublicShareState = {
  shareId: string;
  publishedAt: number;
  aliases: Record<string, string>;
};

export type RulebookRecapSummary = RecapEdition & {
  format: RulebookMatchRecap["format"];
  shared?: { shareId: string; publishedAt: number };
};

export type PublicRecapPlayer = {
  alias: string;
  teamIndex?: number;
};

export type PublicClaimStanding = {
  teamLabel: string;
  zonesControlled: number;
  lockedLandmarks: number;
  totalLandmarks: number;
  isWinner: boolean;
};

export type PublicRecapMoment = {
  label: string;
  detail: string;
};

type PublicRecapBase = {
  shareId: string;
  packId: string;
  editionVersion: number;
  title: string;
  completedAt: number;
  publishedAt: number;
  simulated: boolean;
  editionHref: string;
  players: PublicRecapPlayer[];
  moments: PublicRecapMoment[];
};

export type PublicClaimMatchRecap = PublicRecapBase & {
  format: "claim-the-city";
  isSolo: boolean;
  outcome: {
    reason: ClaimEngineOutcome["reason"];
    soloWon?: boolean;
    winnerLabel: string | null;
    decidingMetric?: string;
  };
  soloProgress?: NonNullable<ClaimEngineRoomView["soloProgress"]>;
  standings: PublicClaimStanding[];
};

export type PublicSeekMatchRecap = PublicRecapBase & {
  format: "hide-and-seek";
  phase: "finished" | "void" | "incomplete" | "canceled";
  outcome: {
    reason: SeekEngineOutcome["reason"];
    winnerLabel: string | null;
  };
  turns: {
    turnNumber: number;
    hiderAlias: string;
    rawHidingMs: number;
    bonusMs: number;
    trapBonusMs: number;
    penaltyMs: number;
    adjustedMs: number;
    reason: SeekEngineTurnResult["reason"];
    answeredQuestions: number;
  }[];
};

export type PublicMatchRecap = PublicClaimMatchRecap | PublicSeekMatchRecap;

export type PublicMatchRecapSummary = {
  shareId: string;
  packId: string;
  editionVersion: number;
  title: string;
  format: RulebookMatchRecap["format"];
  completedAt: number;
  publishedAt: number;
  simulated: boolean;
  editionHref: string;
  outcomeLabel: string;
  scoreSummary: string;
  topMoment?: PublicRecapMoment;
  playerAliases: string[];
};
