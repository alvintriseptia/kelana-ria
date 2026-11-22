// Data-driven Claim the City RulebookPack contracts (schema claim-city-rulebook-v1).
// Reuses GeoSnapshot and Curse clear-condition primitives from rulebook.ts (#35).

import type {
  CurseClearCondition,
  GeoCoordinate,
  RulebookMeta,
  RulebookValidationIssue,
  TransitMode,
} from "./rulebook.js";

export type ClaimTeamMode = "ffa" | "teams";
export type ClaimFailPolicy = "cooldown_ms" | "burned_for_player";
export type ClaimChallengeMode = "per_landmark" | "challenge_hand";

export type ClaimSoloTargets = {
  lockedLandmarks: number;
  distinctZones: number;
};

export type ClaimSessionRules = {
  minPlayers: number;
  maxPlayers: number;
  teamMode: ClaimTeamMode;
  requireStartCheckIn: boolean;
  durationMs: number;
  soloTargets?: ClaimSoloTargets;
};

export type ClaimOwnershipRules = {
  claimWeight: number;
  lockWeight: number;
  stealLocksImmediately: boolean;
  multiplayerFailPolicy: ClaimFailPolicy;
  soloFailPolicy: ClaimFailPolicy;
  failCooldownMs: number;
  broadcastFailAlert: boolean;
};

export type ClaimZoneDefinition = {
  id: string;
  name: string;
  label: string;
  icon?: string;
};

export type ClaimLandmarkDefinition = GeoCoordinate & {
  id: string;
  name: string;
  zoneId: string;
  transitSummary: string;
  accessNotes: string;
  publicHours: string;
  estimatedTravelFromStartMs?: number;
  estimatedChallengeMs?: number;
};

export type ClaimGeographyRules = {
  checkInRadiusMeters: number;
  maxGpsAccuracyMeters: number;
  maxGpsFixAgeMs: number;
  allowedTransitModes: TransitMode[];
  geoSnapshotId: string;
  geoSnapshotHash: string;
  zones: ClaimZoneDefinition[];
  landmarks: ClaimLandmarkDefinition[];
};

export type ClaimObservationMcqPayload = {
  primitive: "observation_mcq";
  prompt: string;
  choices: { id: string; label: string }[];
  correctChoiceId: string;
};

export type ClaimObservationInputPayload = {
  primitive: "observation_input";
  prompt: string;
  inputMode: "text" | "number";
  acceptedAnswers?: string[];
  numericRange?: { min: number; max: number };
};

export type ClaimPhotoProofPayload = {
  primitive: "photo_proof";
  prompt: string;
  verificationMode: "rival_or_timeout" | "honor_submit";
  autoApproveMs: number;
};

export type ClaimTimedMicroTaskPayload = {
  primitive: "timed_micro_task";
  prompt: string;
  timeLimitMs: number;
  taskType: "sub_point_gps" | "observation_input" | "photo_proof";
  subPoint?: GeoCoordinate & { label: string; radiusMeters: number };
  acceptedAnswers?: string[];
  numericRange?: { min: number; max: number };
  autoApproveMs?: number;
};

export type ClaimLeafChallengePayload =
  | ClaimObservationMcqPayload
  | ClaimObservationInputPayload
  | ClaimPhotoProofPayload
  | ClaimTimedMicroTaskPayload;

export type ClaimCallYourShotPayload = {
  primitive: "call_your_shot";
  theme: string;
  standardTask: ClaimLeafChallengePayload;
  boldTask: ClaimLeafChallengePayload;
  boldReward: {
    drawTacticalCard?: boolean;
    bonusWeight?: number;
  };
};

export type ClaimMultiStepPayload = {
  primitive: "multi_step";
  steps: [ClaimLeafChallengePayload, ClaimLeafChallengePayload];
};

export type ClaimChallengePrimitive =
  | ClaimLeafChallengePayload
  | ClaimCallYourShotPayload
  | ClaimMultiStepPayload;

export type ClaimChallengeItem = {
  id: string;
  title: string;
  verificationNotes: string;
  reviewed: boolean;
  reviewedAt: string;
  payload: ClaimChallengePrimitive;
};

export type ClaimChallengesConfig = {
  challengeMode: ClaimChallengeMode;
  landmarkChallenges: Record<string, ClaimChallengeItem[]>;
  backupPool: ClaimChallengeItem[];
  challengeHandPool?: ClaimChallengeItem[];
  challengeHandSize?: number;
};

export type ClaimCardEffect =
  | { primitive: "scout_challenge" }
  | { primitive: "shield_claim"; durationMs: number }
  | { primitive: "double_weight" }
  | { primitive: "swap_challenge" }
  | { primitive: "instant_lock" }
  | {
      primitive: "sabotage_curse";
      blockerType: "block_steals" | "block_claims" | "block_both";
      clearCondition: CurseClearCondition;
    };

export type ClaimCardDefinition = {
  id: string;
  copies: number;
  title: string;
  description: string;
  effect: ClaimCardEffect;
};

export type ClaimTacticalDeckRules = {
  enabled: boolean;
  maxHandSize: number;
  drawTriggers: {
    onLock: boolean;
    onSteal: boolean;
    onBoldChallenge: boolean;
  };
  maxActiveCursesPerTarget: number;
  cards: ClaimCardDefinition[];
};

export type ClaimRulebookPack = {
  meta: RulebookMeta<"claim-city-rulebook-v1", "claim-the-city">;
  session: ClaimSessionRules;
  claiming: ClaimOwnershipRules;
  geography: ClaimGeographyRules;
  challenges: ClaimChallengesConfig;
  tacticalDeck: ClaimTacticalDeckRules;
};

export type ClaimRulebookValidationSummary = {
  zoneCount: number;
  landmarkCount: number;
  totalDeckCards: number;
  feasibleSoloOpenings: number;
};

export type ClaimRulebookValidationResult = {
  ok: boolean;
  errors: RulebookValidationIssue[];
  warnings: RulebookValidationIssue[];
  summary: ClaimRulebookValidationSummary;
};
