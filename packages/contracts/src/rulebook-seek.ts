// Runtime contracts for the rulebook-driven 2-6 player Hide & Seek engine (#36).

import type {
  CurseBlockerType,
  CurseClearCondition,
  CurseEffectModifier,
  GeoCoordinate,
  HideSeekCardCategory,
  HideSeekCardEffect,
  HideSeekPlayPhase,
  HideSeekQuestionFamily,
  HideSeekRulebookPack,
  RulebookRoomPassSummary,
} from "./rulebook.js";
import type { RoomActivityFeed } from "./rulebook-activity.js";
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
  radarRadiusMeters?: number;
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
  minTravelMeters?: number;
  radiusMeters?: number;
};

export type SeekBoardPoint = GeoCoordinate & { id: string; name: string };

export type SeekMapPreviewRequest = {
  family: Exclude<HideSeekQuestionFamily, "photo" | "thermometer">;
  itemId: string;
  fix: LocationFix;
  customRadiusMeters?: number;
};

export type SeekMapPreview = {
  reference: GeoCoordinate;
  radiusMeters?: number;
  station?: SeekBoardPoint;
  targets?: SeekBoardPoint[];
  distanceMeters?: number;
};

export type SeekPublicBoard = {
  startPoint: SeekBoardPoint;
  checkInRadiusMeters: number;
  maxGpsAccuracyMeters: number;
  stations: (SeekBoardPoint & { transitLines: string[] })[];
  boundaryPolygon: GeoCoordinate[];
  pois: { id: string; name: string }[];
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
  turnStartPoint: SeekBoardPoint;
  seekerPosition?: GeoCoordinate & { at: number; seatId: string; stationId?: string };
  candidateStationIds?: string[];
  deductionResetAt?: number;
  moveZoneUntil?: number;
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
  | { type: "rename-seat"; name: string }
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
  | { type: "answer-question"; questionId: string; photoId?: string; answerCode?: string }
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

// Runtime Hider Deck & Composable Curse contracts (#37).

export type SeekCardInstance = {
  instanceId: string;
  cardId: string;
  category: HideSeekCardCategory;
  title: string;
  description: string;
  effect: HideSeekCardEffect;
};

export type SeekActiveDrawBatch = {
  cards: SeekCardInstance[];
  keepCount: number;
  deadline: number;
};

export type SeekPlantedTrap = {
  trapId: string;
  stationId: string;
  stationName: string;
  bonusMinutes: number;
  plantedAt: number;
  triggeredAt: number | null;
};

export type SeekActiveCurse = {
  curseInstanceId: string;
  cardId: string;
  title: string;
  description: string;
  castAt: number;
  blockerType: CurseBlockerType;
  effectModifiers: CurseEffectModifier[];
  clearCondition: CurseClearCondition;
  expiresAt: number | null;
  remainingQuestions: number | null;
  revealedClue?: { clueType: "photo_prompt" | "match_attribute"; detail: string; value: string };
  pendingPhoto?: {
    photoId: string;
    submittedBySeatId: string;
    submittedAt: number;
    autoApproveAt: number;
  } | null;
};

export type SeekDeckPublicView = {
  drawPileCount: number;
  discardPileCount: number;
  hiderHandCount: number;
  currentHandLimit: number;
  activeCurses: SeekActiveCurse[];
  triggeredTraps: SeekPlantedTrap[];
  questionsBlocked: boolean;
  transitBlocked: boolean;
  bannedFamilies: HideSeekQuestionFamily[];
  extraDrawPerQuestion: number;
};

export type SeekDeckHiderView = SeekDeckPublicView & {
  hand: SeekCardInstance[];
  activeDraw: SeekActiveDrawBatch | null;
  queuedBatchCount: number;
  plantedTraps: SeekPlantedTrap[];
};

export type SeekRoomPayloadResponse = {
  format: "hide-and-seek";
  qa?: true;
  draftPlaytest?: true;
  stateRev: number;
  room: SeekEngineRoomView;
  deck: SeekDeckPublicView | SeekDeckHiderView;
  activity: RoomActivityFeed;
  publicBoard?: SeekPublicBoard;
  pass: RulebookRoomPassSummary;
};

