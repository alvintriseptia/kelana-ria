// Data-driven RulebookPack and GeoSnapshot contracts (schema hide-seek-rulebook-v1).
// Shared geo and curse primitives are designed to be reused across game formats.

import type { StudioAiProvenance, StudioPointProvenance } from "./studio-cocreator.js";

export type RulebookFormat = "hide-and-seek" | "claim-the-city";
export type RulebookDifficulty = "starter" | "standard" | "expert";
export type TransitMode = "walk" | "mrt" | "krl" | "transjakarta" | "lrt" | "other";

export type GeoCoordinate = {
  latitude: number;
  longitude: number;
};

export type GeoAttribution = {
  source: string;
  license?: string;
  retrievedAt: string;
  notice: string;
};

export type GeoStartPoint = GeoCoordinate & {
  id: string;
  name: string;
  accessNotes: string;
};

export type GeoStation = GeoCoordinate & StudioPointProvenance & {
  id: string;
  name: string;
  transitLines: string[];
  attributes: Record<string, string>;
  eligibleHidingAnchor: boolean;
  accessNotes: string;
  publicHours: string;
  estimatedTravelFromStartMs?: number;
};

export type GeoPoi = GeoCoordinate & StudioPointProvenance & {
  id: string;
  name: string;
  category: string;
  attributes?: Record<string, string>;
};

export type GeoSnapshot = {
  id: string;
  hash: string;
  boundaryPolygon: GeoCoordinate[];
  startPoint: GeoStartPoint;
  stations: GeoStation[];
  pois: GeoPoi[];
  attributions: GeoAttribution[];
};

export type RulebookMeta<
  SchemaVersion extends string = string,
  Format extends RulebookFormat = RulebookFormat,
> = {
  packId: string;
  version: number;
  schemaVersion: SchemaVersion;
  format: Format;
  isOfficial: boolean;
  title: string;
  byline: string;
  summary: string;
  cityLabel: string;
  difficulty: RulebookDifficulty;
  priceIdr: number;
};

export type HideSeekQuestionFamily =
  | "radar"
  | "thermometer"
  | "matching"
  | "measuring"
  | "tentacles"
  | "photo";

export type HideSeekPlayPhase = "seeking" | "endgame";

export type HideSeekTurnMode = "everyone_hides_once" | "fixed_turns";
export type HideSeekRegroupPolicy = "previous_hiding_station" | "last_play_checkpoint" | "shared_start" | "anywhere_ready";
export type HideSeekMissedLockPolicy = "void_turn" | "auto_lock_nearest_station" | "forfeit_turn";
export type HideSeekRepeatCostMode = "escalating_multiplier" | "single_use_locked" | "flat";

export type HideSeekSessionRules = {
  minPlayers: number;
  maxPlayers: number;
  turnMode: HideSeekTurnMode;
  fixedTurnCount?: number;
  requireStartCheckIn: boolean;
  regroupPolicy: HideSeekRegroupPolicy;
  missedLockPolicy: HideSeekMissedLockPolicy;
  endgameFreezeGraceSec: number;
  maxPathOffsetMeters: number;
};

export type HideSeekTimerRules = {
  headStartMs: number;
  searchLimitMs: number;
  regroupLimitMs: number;
  objectiveResponseMs: number;
  photoResponseMs: number;
  drawDecisionMs: number;
};

export type HideSeekGeographyRules = {
  hidingZoneRadiusMeters: number;
  checkInRadiusMeters: number;
  maxGpsAccuracyMeters: number;
  maxGpsFixAgeMs: number;
  allowedTransitModes: TransitMode[];
  geoSnapshotId: string;
  geoSnapshotHash: string;
};

export type HideSeekQuestionFamilyConfig<Item> = {
  enabled: boolean;
  drawCount: number;
  keepCount: number;
  responseMs?: number;
  availableInPhases: HideSeekPlayPhase[];
  items: Item[];
};

export type RadarQuestionItem = {
  id: string;
  label: string;
  radiusMeters: number;
};

export type ThermometerQuestionItem = {
  id: string;
  label: string;
  minTravelMeters: number;
};

export type MatchingQuestionItem = {
  id: string;
  label: string;
  matchType: "transit_line" | "station_name_length" | "station_attribute" | "nearest_poi";
  attributeKey?: string;
  poiCategory?: string;
};

export type MeasuringQuestionItem = {
  id: string;
  label: string;
  targetType: "poi_category" | "named_poi";
  poiCategory?: string;
  poiId?: string;
};

export type TentaclesQuestionItem = {
  id: string;
  label: string;
  radiusMeters: number;
  poiCategory: string;
};

export type PhotoQuestionItem = {
  id: string;
  label: string;
  prompt: string;
  phase: HideSeekPlayPhase | "both";
  verificationNotes?: string;
  fieldVerified?: boolean;
  fieldVerifiedAt?: string;
  aiProvenance?: StudioAiProvenance;
};

export type HideSeekInvestigationBook = {
  repeatCostMode: HideSeekRepeatCostMode;
  tieToleranceMeters: number;
  families: {
    radar?: HideSeekQuestionFamilyConfig<RadarQuestionItem> & { allowCustomRadius?: boolean };
    thermometer?: HideSeekQuestionFamilyConfig<ThermometerQuestionItem>;
    matching?: HideSeekQuestionFamilyConfig<MatchingQuestionItem>;
    measuring?: HideSeekQuestionFamilyConfig<MeasuringQuestionItem>;
    tentacles?: HideSeekQuestionFamilyConfig<TentaclesQuestionItem>;
    photo?: HideSeekQuestionFamilyConfig<PhotoQuestionItem>;
  };
};

// Shared composable Curse primitives (reused by Hide & Seek and Claim the City).
export type CurseCastingCost =
  | { type: "none" }
  | { type: "discard_cards"; count: number; category?: "any" | "time_bonus" | "powerup" | "curse" }
  | { type: "seeker_min_distance"; meters: number }
  | { type: "seeker_max_distance"; meters: number }
  | { type: "reveal_clue"; clueType: "photo_prompt" | "match_attribute"; detail: string };

export type CurseBlockerType =
  | "none"
  | "block_questions"
  | "block_transit"
  | "block_both"
  | "block_steals"
  | "block_claims";

export type CurseEffectModifier =
  | { type: "inflate_question_draws"; extraDraws: number }
  | { type: "ban_question_family"; family: HideSeekQuestionFamily }
  | { type: "skip_penalty_minutes"; penaltyMinutes: number };

export type CurseClearCondition =
  | { type: "timer"; durationMs: number }
  | { type: "next_n_questions"; count: number }
  | { type: "gps_detour"; poiCategory: string; radiusMeters: number; fallbackTimerMs?: number }
  | { type: "photo_challenge"; prompt: string; approvalMode: "opponent_or_timeout"; autoApproveMs: number }
  | { type: "honor_task"; instruction: string; minDurationMs?: number };

export type CurseEffectPayload = {
  castingCosts: CurseCastingCost[];
  blockerType: CurseBlockerType;
  effectModifiers?: CurseEffectModifier[];
  clearCondition: CurseClearCondition;
};

export type HideSeekCardCategory = "time_bonus" | "powerup" | "curse";

export type HideSeekCardEffect =
  | { primitive: "time_bonus"; minutes?: number; percentOfRawTime?: number }
  | { primitive: "veto" }
  | { primitive: "randomize" }
  | { primitive: "duplicate"; targetCategories?: HideSeekCardCategory[]; allowDuplicateMove?: boolean }
  | { primitive: "expand_hand"; extraSlots: number }
  | { primitive: "discard_draw"; discardCount: number; drawCount: number; keepCount: number }
  | { primitive: "time_trap"; bonusMinutes: number }
  | { primitive: "move_zone"; travelWindowMs: number; revealOldStation: boolean; discardHand: boolean }
  | { primitive: "curse"; curse: CurseEffectPayload };

export type HideSeekCardDefinition = {
  id: string;
  category: HideSeekCardCategory;
  copies: number;
  title: string;
  description: string;
  effect: HideSeekCardEffect;
};

export type HideSeekDeckRules = {
  baseHandLimit: number;
  maxActiveBlockingCurses: number;
  cards: HideSeekCardDefinition[];
};

export type HideSeekRulebookPack = {
  meta: RulebookMeta<"hide-seek-rulebook-v1", "hide-and-seek">;
  session: HideSeekSessionRules;
  timers: HideSeekTimerRules;
  geography: HideSeekGeographyRules;
  investigationBook: HideSeekInvestigationBook;
  deck: HideSeekDeckRules;
};

export type RulebookValidationIssue = {
  code: string;
  path: string;
  message: string;
  severity: "error" | "warning";
};

export type HideSeekRulebookValidationSummary = {
  eligibleAnchorCount: number;
  reachableAnchorCount: number;
  totalDeckCards: number;
  objectiveQuestionCount: number;
  photoQuestionCount: number;
};

export type HideSeekRulebookValidationResult = {
  ok: boolean;
  errors: RulebookValidationIssue[];
  warnings: RulebookValidationIssue[];
  summary: HideSeekRulebookValidationSummary;
};
export type RulebookPlayMode = "solo" | "group";

export type ActiveRulebookRoomPhase =
  | "lobby"
  | "active"
  | "head_start"
  | "seeking"
  | "endgame"
  | "regroup";

export type ActiveRulebookRoomSummary = {
  roomCode: string;
  format: RulebookFormat;
  packId: string;
  version: number;
  title: string;
  phase: ActiveRulebookRoomPhase;
  role?: "hider" | "seeker" | "lobby" | "none" | "solo" | "group";
  turnNumber?: number;
  totalPlannedTurns?: number;
  playerCount?: number;
  maxPlayers?: number;
};

export type RulebookRoomPassSummary = {
  passId: string;
  orderId: string | null;
  entitlementId?: string;
  roomCode: string;
  packId: string;
  version: number;
  format: RulebookFormat;
  maxPlayers: number;
  mode?: RulebookPlayMode;
  minPlayers?: number;
  paid: boolean;
  draftPlaytest?: boolean;
  createdAt: number;
};

export type RulebookEntitlementSummary = {
  packId: string;
  orderId: string;
  purchasedAt: number;
  activeRoomCode: string | null;
};

