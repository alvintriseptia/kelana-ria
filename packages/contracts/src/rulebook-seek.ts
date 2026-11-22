// Runtime contracts for the rulebook-driven 2-6 player Hide & Seek engine (#36).

import type {
  GeoCoordinate,
  HideSeekPlayPhase,
  HideSeekQuestionFamily,
  HideSeekRulebookPack,
} from "./rulebook.js";
import type { LocationFix } from "./index.js";

export type SeekEnginePhase =
  | "lobby"
  | "head_start"
  | "seeking"
  | "endgame"
  | "regroup"
  | "finished"
  | "void"
  | "incomplete"
  | "canceled";

export type SeekEngineSeat = {
  seatId: string;
  name: string;
  isHost: boolean;
  startVerifiedUntil: number | null;
  ready: boolean;
  regrouped: boolean;
  confirmedFound: boolean;
};

export type SeekDrawBatch = {
  drawCount: number;
  keepCount: number;
};

export type SeekDeductionOverlay =
  | {
      type: "circle";
      center: GeoCoordinate;
      radiusMeters: number;
      inside: boolean;
    }
  | {
      type: "bisector";
      start: GeoCoordinate;
      end: GeoCoordinate;
      result: "hotter" | "colder" | "equal";
      tieToleranceMeters: number;
    }
  | {
      type: "station_filter";
      matchedStationIds: string[];
      eliminatedStationIds: string[];
      same: boolean;
    }
  | {
      type: "distance_compare";
      seekerPoint: GeoCoordinate;
      seekerDistanceMeters: number;
      targetPoiIds: string[];
      result: "seeker_closer" | "hider_closer" | "equal";
      tieToleranceMeters: number;
    }
  | {
      type: "voronoi";
      center: GeoCoordinate;
      radiusMeters: number;
      candidatePoiIds: string[];
      nearestPoiIds: string[];
      outside: boolean;
    };

export type SeekObjectiveAnswer = {
  code: string;
  label: string;
  overlay: SeekDeductionOverlay;
};

export type SeekEngineQuestionStatus =
  | "pending"
  | "answered"
  | "cannot_answer_endgame"
  | "timeout"
  | "vetoed"
  | "closed";

export type SeekEngineQuestion = {
  id: string;
  family: HideSeekQuestionFamily;
  itemId: string;
  label: string;
  prompt?: string;
  referencePoint: GeoCoordinate;
  referenceStationId?: string;
  thermometerStart?: GeoCoordinate;
  customRadiusMeters?: number;
  askedBySeatId: string;
  askedAt: number;
  deadline: number;
  repeatMultiplier: number;
  drawBatches: SeekDrawBatch[];
  status: SeekEngineQuestionStatus;
  answerCode?: string;
  answerLabel?: string;
  overlay?: SeekDeductionOverlay;
  photoId?: string;
  // Visible ONLY to the active Hider while status === "pending"
  privateComputedAnswer?: SeekObjectiveAnswer;
};

export type SeekEngineTurnResult = {
  turnNumber: number;
  hiderSeatId: string;
  anchorStationId: string | null;
  rawHidingMs: number;
  bonusMs: number;
  trapBonusMs: number;
  penaltyMs: number;
  adjustedMs: number;
  reason: "found" | "timeout" | "missed_lock" | "forfeit";
  completedAt: number;
  clues: SeekEngineQuestion[];
};

export type SeekEngineOutcome = {
  winnerSeatId: string | null;
  reason: "scored" | "missed_lock" | "regroup_timeout" | "forfeit" | "canceled";
  at: number;
};

export type SeekEngineMenuEntry = {
  family: HideSeekQuestionFamily;
  itemId: string;
  label: string;
  prompt?: string;
  useCount: number;
  nextRepeatMultiplier: number;
  drawBatches: SeekDrawBatch[];
  lockedSingleUse: boolean;
  availableInCurrentPhase: boolean;
  responseMs: number;
  isCustomRadius?: boolean;
};

export type SeekEngineRoomView = {
  code: string;
  now: number;
  seatId: string;
  role: "hider" | "seeker" | "lobby";
  packMeta: HideSeekRulebookPack["meta"];
  phase: SeekEnginePhase;
  turnNumber: number;
  totalPlannedTurns: number;
  turnOrder: string[];
  hiderSeatId: string | null;
  startedAt: number | null;
  releaseAt: number | null;
  phaseEndsAt: number | null;
  endgameTriggeredAt: number | null;
  endgameFreezeAt: number | null;
  hiderFrozen: boolean;
  canMoveZone: boolean;
  regroupPoint: { id: string; name: string; latitude: number; longitude: number } | null;
  seats: SeekEngineSeat[];
  thermometerStart: GeoCoordinate | null;
  questionUseCounts: Record<string, number>;
  menu: SeekEngineMenuEntry[];
  questions: SeekEngineQuestion[];
  turns: SeekEngineTurnResult[];
  outcome: SeekEngineOutcome | null;
  // Hider-only private fields (strictly omitted for Seekers)
  ownAnchorStationId?: string;
  ownHidingZoneRadiusMeters?: number;
  hiderOutOfZone?: boolean;
  foundCode?: string;
  pendingDrawBatches?: SeekDrawBatch[];
  playPhase?: HideSeekPlayPhase;
};

export type SeekEngineAction = { actionId: string } & (
  | { type: "set-turn-order"; turnOrder: string[] }
  | { type: "check-in-start"; fix: LocationFix }
  | { type: "ready"; ready: boolean }
  | { type: "start" }
  | { type: "lock-anchor"; stationId: string; fix: LocationFix }
  | { type: "report-hider-position"; fix: LocationFix }
  | { type: "confirm-freeze" }
  | { type: "seeker-check-in"; fix: LocationFix; offTransit: boolean }
  | { type: "start-thermometer"; fix: LocationFix }
  | {
      type: "ask";
      family: HideSeekQuestionFamily;
      itemId: string;
      fix: LocationFix;
      customRadiusMeters?: number;
    }
  | { type: "answer-question"; questionId: string; photoId?: string }
  | { type: "cannot-answer-endgame"; questionId: string }
  | { type: "submit-found-code"; code: string }
  | { type: "confirm-found" }
  | { type: "regroup-check-in"; fix?: LocationFix }
  | { type: "leave" }
);

export type SeekEngineActionReply = {
  room: SeekEngineRoomView;
  error?: string;
  distanceMeters?: number;
  endgameTriggered?: boolean;
  earnedDrawBatches?: SeekDrawBatch[];
  purgedPhotoIds?: string[];
};
