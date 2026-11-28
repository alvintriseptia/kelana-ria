import type { ClaimChallengeItem, ClaimChallengePrimitive, ClaimZoneDefinition } from "./rulebook-claim.js";
import type {
  GeoAttribution, GeoCoordinate, MatchingQuestionItem, MeasuringQuestionItem, PhotoQuestionItem, RulebookFormat, TentaclesQuestionItem,
} from "./rulebook.js";

export type StudioPointProvenance = {
  source?: "manual" | "osm-curated" | "built-in";
  osmId?: string;
  fieldVerified?: boolean;
  fieldVerifiedAt?: string;
  fieldVerificationNote?: string;
  gpsVerifiedProximityMeters?: number;
};

export type StudioAiProvenance = {
  source: "ai-co-creator" | "template-fallback";
  generatedAt: string;
  model?: string;
  mode: "live" | "recorded-rehearsal" | "template-fallback";
  verificationChecklist?: string[];
  draftNoteMarker?: string;
};

export type StudioPoiCategory =
  | "taman" | "monumen" | "museum" | "pasar" | "ruang_publik" | "ibadah" | "perpustakaan" | "kuliner_ikon";

export type StudioPoiCurateRequest = {
  boundaryPolygon: GeoCoordinate[];
  startPoint?: GeoCoordinate;
  categories?: StudioPoiCategory[];
  existingPoints?: GeoCoordinate[];
  zones?: { id: string; centroid?: GeoCoordinate; landmarks?: GeoCoordinate[] }[];
  limit?: number;
};

export type StudioPoiCandidate = GeoCoordinate & {
  osmId: string;
  name: string;
  category: StudioPoiCategory;
  source: "osm-curated";
  fieldVerified: false;
  alreadyInDraft: boolean;
  distanceFromStartMeters?: number;
  suggestedZoneId?: string;
  openingHours?: string;
  wheelchair?: string;
  publicAccessHint?: string;
  tags: Record<string, string>;
};

export type StudioPoiCurateResponse = {
  mode: "live" | "recorded-rehearsal" | "local-fallback";
  fallbackReason?: "fixture-mode" | "overpass-unavailable";
  attribution: GeoAttribution;
  candidates: StudioPoiCandidate[];
};

export type StudioObservationPattern = "see_and_explain" | "compare_features" | "read_connection" | "record_detail";

export type StudioRagMetrics = {
  retrievedChunks: number;
  platformChunks: number;
  docChunks: number;
  sourceChars: number;
  injectedChars: number;
  estimatedTokensSaved: number;
  budgetCapped: boolean;
};

export type StudioKnowledgeDocSummary = {
  docId: string;
  title: string;
  chunkCount: number;
  totalChars: number;
  previewHeadings: string[];
  createdAt: string;
};

export type StudioAiSuggestRequest = {
  cityLabel: string;
  theme?: string;
  count?: number;
} & ({ packId?: never; version?: never } | { packId: string; version: number }) & (
  | {
    format: "claim-the-city";
    landmark: {
      id: string; name: string; zoneName: string; transitSummary: string; accessNotes: string; publicHours: string;
      osmCategory?: StudioPoiCategory; osmTags?: Record<string, string>;
    };
    primitive: ClaimChallengePrimitive["primitive"];
    pattern: StudioObservationPattern;
    existingTitles?: string[];
  }
  | {
    format: "hide-and-seek";
    targetFamily: "photo" | "matching" | "measuring" | "tentacles";
    availablePoiCategories?: string[];
    stationNames?: string[];
    poiSamples?: { id: string; name: string; category: string }[];
    existingLabels?: string[];
  }
);

export type StudioAiClaimSuggestion = ClaimChallengeItem & { aiProvenance: StudioAiProvenance };

export type StudioAiSeekSuggestion =
  | { family: "photo"; item: PhotoQuestionItem & { aiProvenance: StudioAiProvenance } }
  | { family: "matching"; item: MatchingQuestionItem }
  | { family: "measuring"; item: MeasuringQuestionItem }
  | { family: "tentacles"; item: TentaclesQuestionItem };

export type StudioAiSuggestResponse = StudioAiSuggestionSet & {
  mode: StudioAiProvenance["mode"];
  fallbackReason?: string;
  ragMetrics: StudioRagMetrics;
};

export type StudioAiSuggestionSet =
  | { format: "claim-the-city"; suggestions: StudioAiClaimSuggestion[] }
  | { format: "hide-and-seek"; suggestions: StudioAiSeekSuggestion[] };

export type StudioChatTurn = { role: "user" | "assistant"; content: string };

export type StudioChatRequest = {
  packId: string;
  version: number;
  message: string;
  history?: StudioChatTurn[];
  docIds?: string[];
  inlineDocumentText?: string;
  inlineDocumentTitle?: string;
  format: RulebookFormat;
  targetLanguage?: "id";
};

export type StudioResolvedPinpoint = {
  clientKey: string;
  name: string;
  status: "resolved" | "outside_boundary" | "unresolved";
  latitude?: number;
  longitude?: number;
  osmId?: string;
  category?: StudioPoiCategory;
  suggestedZoneId?: string;
  accessHint?: string;
  publicHoursHint?: string;
  sourceExcerpt?: string;
  source?: "osm-curated";
  fieldVerified?: false;
};

type StudioChatSeekQuestions =
  | { family: "photo"; items: (PhotoQuestionItem & { reviewed: false; reviewedAt: "" })[] }
  | { family: "matching"; items: MatchingQuestionItem[] }
  | { family: "measuring"; items: MeasuringQuestionItem[] }
  | { family: "tentacles"; items: TentaclesQuestionItem[] };

export type StudioChatProposal = { id: string } & (
  | { kind: "update_meta"; title?: string; summary?: string; cityLabel?: string }
  | { kind: "add_zones"; zones: ClaimZoneDefinition[] }
  | { kind: "add_landmarks"; landmarks: StudioResolvedPinpoint[] }
  | { kind: "add_pois"; pois: StudioResolvedPinpoint[] }
  | { kind: "add_stations"; stations: StudioResolvedPinpoint[] }
  | { kind: "add_claim_challenges"; targetLandmarkNameOrId: string; challenges: ClaimChallengeItem[] }
  | ({ kind: "add_seek_questions" } & StudioChatSeekQuestions)
  | { kind: "expand_boundary"; suggestedPolygon: GeoCoordinate[]; reason: string }
);

export type StudioChatResponse = {
  ok: true;
  reply: string;
  proposals: StudioChatProposal[];
  unresolvedPlaces: StudioResolvedPinpoint[];
  ingestedDoc?: StudioKnowledgeDocSummary;
  mode: "live" | "template-fallback";
  fallbackReason?: string;
  attribution?: GeoAttribution;
  ragMetrics: StudioRagMetrics;
};
