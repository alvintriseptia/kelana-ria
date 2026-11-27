// Data-driven Claim the City RulebookPack contracts (schema claim-city-rulebook-v1).
// Reuses GeoSnapshot and Curse clear-condition primitives from rulebook.ts (#35).

import type {
  CurseClearCondition,
  GeoCoordinate,
  GeoStartPoint,
  RulebookMeta,
  RulebookRoomPassSummary,
  RulebookValidationIssue,
  TransitMode,
} from "./rulebook.js";
import type { StudioAiProvenance, StudioPointProvenance } from "./studio-cocreator.js";
import type { RoomActivityFeed } from "./rulebook-activity.js";
import type { LocationFix } from "./index.js";

export type ClaimTeamMode = "ffa" | "teams";
export type ClaimFailPolicy = "cooldown_ms" | "burned_for_player";
export type ClaimChallengeMode = "per_landmark" | "challenge_hand";
export type ClaimOpponentTrackingMode = "off" | "last_checkin" | "periodic_gps";

export type ClaimOpponentTrackingRules = {
  mode: ClaimOpponentTrackingMode;
  intervalMs?: number;
};

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
  opponentTracking?: ClaimOpponentTrackingRules;
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

export type ClaimLandmarkDefinition = GeoCoordinate & StudioPointProvenance & {
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
  hint?: string;
  learningExplanation?: string;
  estimatedSeconds?: number;
  reviewed: boolean;
  reviewedAt: string;
  aiProvenance?: StudioAiProvenance;
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

// Runtime Claim the City Engine contracts (#41).

export type ClaimEnginePhase = "lobby" | "active" | "finished" | "abandoned" | "canceled";

export type ClaimEngineSeat = {
  seatId: string;
  name: string;
  teamId: string;
  isHost: boolean;
  startVerifiedUntil: number | null;
  ready: boolean;
  leftAt?: number | null;
};

export type ClaimLandmarkStatus = "unclaimed" | "claimed" | "locked";

export type ClaimLandmarkState = {
  landmarkId: string;
  zoneId: string;
  status: ClaimLandmarkStatus;
  ownerSeatId: string | null;
  ownerTeamId: string | null;
  claimedAt: number | null;
  lockedAt: number | null;
  shieldUntil: number | null;
  doubleWeighted: boolean;
  bonusWeight: number;
  vulnerableAlertAt: number | null;
};

export type ClaimSanitizedLeafChallenge =
  | { primitive: "observation_mcq"; prompt: string; choices: { id: string; label: string }[] }
  | { primitive: "observation_input"; prompt: string; inputMode: "text" | "number" }
  | { primitive: "photo_proof"; prompt: string; verificationMode: "rival_or_timeout" | "honor_submit"; autoApproveMs: number }
  | {
      primitive: "timed_micro_task";
      prompt: string;
      timeLimitMs: number;
      taskType: "sub_point_gps" | "observation_input" | "photo_proof";
      subPoint?: GeoCoordinate & { label: string; radiusMeters: number };
      autoApproveMs?: number;
    };

export type ClaimSanitizedChallengePayload =
  | ClaimSanitizedLeafChallenge
  | {
      primitive: "call_your_shot";
      theme: string;
      chosenTier?: "standard" | "bold";
      activeTask?: ClaimSanitizedLeafChallenge;
      boldReward: { drawTacticalCard?: boolean; bonusWeight?: number };
    }
  | {
      primitive: "multi_step";
      currentStep: 0 | 1;
      steps: [ClaimSanitizedLeafChallenge, ClaimSanitizedLeafChallenge];
    };

export type ClaimSanitizedChallenge = {
  id: string;
  title: string;
  payload: ClaimSanitizedChallengePayload;
};

export type ClaimActiveAttemptView = {
  landmarkId: string;
  challenge: ClaimSanitizedChallenge;
  hint?: string;
  isStealAttempt: boolean;
  chosenTier?: "standard" | "bold";
  currentStep: 0 | 1;
  timedStartedAt: number | null;
  timedDeadline: number | null;
  pendingPhoto?: {
    photoId: string;
    submittedAt: number;
    autoApproveAt: number;
  } | null;
};

export type ClaimPendingPhotoReview = {
  attemptOwnerSeatId: string;
  landmarkId: string;
  photoId: string;
  submittedAt: number;
  autoApproveAt: number;
};

export type ClaimCardInstance = {
  instanceId: string;
  cardId: string;
  title: string;
  description: string;
  effect: ClaimCardEffect;
};

export type ClaimActiveCurse = {
  curseInstanceId: string;
  cardId: string;
  title: string;
  description: string;
  casterSeatId: string;
  targetSeatId: string;
  castAt: number;
  blockerType: "block_steals" | "block_claims" | "block_both";
  clearCondition: CurseClearCondition;
  expiresAt: number | null;
  pendingPhoto?: {
    photoId: string;
    submittedAt: number;
    autoApproveAt: number;
  } | null;
};

export type ClaimZoneStanding = {
  zoneId: string;
  name: string;
  label: string;
  weightsByTeam: Record<string, number>;
  controllerTeamId: string | null;
};

export type ClaimTeamScore = {
  teamId: string;
  zonesControlled: number;
  lockedLandmarks: number;
  totalLandmarks: number;
};

export type ClaimEngineEvent = {
  type:
    | "started"
    | "claimed"
    | "locked"
    | "stolen"
    | "challenge_failed"
    | "card_played"
    | "curse_cast"
    | "curse_cleared"
    | "finished"
    | "abandoned"
    | "canceled";
  at: number;
  seatId?: string;
  teamId?: string;
  landmarkId?: string;
  detail?: string;
};

export type ClaimEngineOutcome = {
  winnerTeamId: string | null;
  soloWon?: boolean;
  reason: "time" | "all_locked" | "solo_target_met" | "solo_impossible" | "forfeit" | "abandoned" | "canceled";
  at: number;
};

export type ClaimSeatPosition = {
  seatId: string;
  name: string;
  teamId: string;
  latitude: number;
  longitude: number;
  at: number;
  source: "gps" | "checkin";
  zoneId?: string;
};

export type ClaimPresenceEvent = {
  positions: ClaimSeatPosition[];
  now: number;
};

export type ClaimEngineRoomView = {
  code: string;
  now: number;
  seatId: string;
  teamId: string;
  isSolo: boolean;
  packMeta: ClaimRulebookPack["meta"];
  phase: ClaimEnginePhase;
  startedAt: number | null;
  deadline: number | null;
  seats: ClaimEngineSeat[];
  landmarks: ClaimLandmarkState[];
  zones: ClaimZoneStanding[];
  standings: ClaimTeamScore[];
  soloProgress?: {
    lockedLandmarks: number;
    targetLandmarks: number;
    distinctZones: number;
    targetZones: number;
  };
  opponentTracking?: {
    mode: ClaimOpponentTrackingMode;
    intervalMs: number;
  };
  seatPositions?: ClaimSeatPosition[];
  ownActiveAttempt: ClaimActiveAttemptView | null;
  ownLearningExplanation?: { landmarkId: string; text: string };
  ownCooldowns: Record<string, number>;
  ownBurnedLandmarks: string[];
  ownHand: ClaimCardInstance[];
  ownChallengeHand?: ClaimSanitizedChallenge[];
  scoutedChallenges: Record<string, ClaimSanitizedChallenge>;
  pendingRivalPhotoReviews: ClaimPendingPhotoReview[];
  activeCurses: ClaimActiveCurse[];
  events: ClaimEngineEvent[];
  outcome: ClaimEngineOutcome | null;
};

export type ClaimEngineAction = { actionId: string } & (
  | { type: "rename-seat"; name: string }
  | { type: "set-team"; teamId: string; targetSeatId?: string }
  | { type: "check-in-start"; fix: LocationFix }
  | { type: "ready"; ready: boolean }
  | { type: "start" }
  | { type: "check-in-landmark"; landmarkId: string; fix: LocationFix; challengeHandId?: string }
  | { type: "choose-shot-tier"; landmarkId: string; tier: "standard" | "bold" }
  | { type: "start-timed-task"; landmarkId: string }
  | {
      type: "submit-challenge";
      landmarkId: string;
      choiceId?: string;
      inputValue?: string;
      photoId?: string;
      fix?: LocationFix;
    }
  | { type: "review-challenge-photo"; targetSeatId: string; landmarkId: string; approve: boolean }
  | { type: "bail-challenge"; landmarkId: string }
  | {
      type: "play-card";
      cardInstanceId: string;
      landmarkId?: string;
      targetSeatId?: string;
    }
  | { type: "clear-curse-gps"; curseInstanceId: string; fix: LocationFix }
  | { type: "submit-curse-photo"; curseInstanceId: string; photoId: string }
  | { type: "review-curse-photo"; curseInstanceId: string; approve: boolean }
  | { type: "clear-curse-honor"; curseInstanceId: string }
  | { type: "leave" }
);

export type ClaimEngineActionReply = {
  room: ClaimEngineRoomView;
  error?: string;
  distanceMeters?: number;
  purgedPhotoIds?: string[];
};

export type ClaimPublicBoard = {
  startPoint: GeoStartPoint;
  checkInRadiusMeters: number;
  maxGpsAccuracyMeters: number;
  landmarks: {
    id: string;
    name: string;
    zoneId: string;
    latitude: number;
    longitude: number;
    transitSummary: string;
    accessNotes: string;
  }[];
};

export type ClaimRoomPayloadResponse = {
  format: "claim-the-city";
  qa?: true;
  draftPlaytest?: true;
  stateRev: number;
  room: ClaimEngineRoomView;
  activity: RoomActivityFeed;
  publicBoard?: ClaimPublicBoard;
  pass: RulebookRoomPassSummary;
};

