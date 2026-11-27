import type { ClaimChallengeItem, ClaimChallengePrimitive } from "./rulebook-claim.js";
import type {
  GeoAttribution, GeoCoordinate, MatchingQuestionItem, MeasuringQuestionItem, PhotoQuestionItem, TentaclesQuestionItem,
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

export type StudioAiSuggestRequest = {
  cityLabel: string;
  theme?: string;
  count?: number;
} & (
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

export type StudioAiSuggestResponse = {
  mode: StudioAiProvenance["mode"];
  fallbackReason?: string;
} & (
  | { format: "claim-the-city"; suggestions: StudioAiClaimSuggestion[] }
  | { format: "hide-and-seek"; suggestions: StudioAiSeekSuggestion[] }
);
