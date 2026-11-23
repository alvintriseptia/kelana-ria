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
export type RulebookRecapSummary = RecapEdition & { format: RulebookMatchRecap["format"] };
