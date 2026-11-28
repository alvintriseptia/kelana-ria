import { createHash } from "node:crypto";
import type {
  ClaimChallengePrimitive,
  ClaimLeafChallengePayload,
  StudioAiProvenance,
  StudioAiSuggestRequest,
  StudioAiSuggestResponse,
  StudioObservationPattern,
  StudioPoiCategory,
} from "@kelana-ria/contracts";
import { isId, isObject } from "./http.js";

type ClaimRequest = Extract<StudioAiSuggestRequest, { format: "claim-the-city" }>;
type SeekRequest = Extract<StudioAiSuggestRequest, { format: "hide-and-seek" }>;

const primitives = [
  "observation_mcq", "observation_input", "photo_proof", "timed_micro_task", "call_your_shot", "multi_step",
] as const;
const families = ["photo", "matching", "measuring", "tentacles"] as const;
const patterns: StudioObservationPattern[] = ["see_and_explain", "compare_features", "read_connection", "record_detail"];
const categories: StudioPoiCategory[] = ["taman", "monumen", "museum", "pasar", "ruang_publik", "ibadah", "perpustakaan", "kuliner_ikon"];
const publicTags = ["leisure", "historic", "tourism", "amenity", "place", "building", "opening_hours", "wheelchair", "access", "fee"];
const draftMarker = "[PERLU CEK LAPANGAN]";
const privateText = /[\w.+-]+@[\w.-]+\.[a-z]{2,}|\b(?:set-cookie|authorization|bearer|kelana_session|kelana_rulebook)\b|\b(?:RB|RC)-[a-f0-9]{6}\b|\b(?:latitude|longitude|lat|lng)\s*[:=]|[-+]?\d{1,3}\.\d{3,}(?:\s*[,;/]\s*|\s+)[-+]?\d{1,3}\.\d{3,}/i;
const bannedCopy = /\b(?:kartu taktis|dek taktis|tantangan berani|berani\s*\/\s*bold|hadiah taktis|kutukan komposabel|kutukan sabotase|perburuan makro|jangkar sembunyi|tuan rumah|multi-primitif|observation_mcq|observation_input|photo_proof|timed_micro_task|call_your_shot|multi_step|sabotage_curse|drawCount|keepCount|correctChoiceId|autoApproveMs|reviewedAt|fieldVerified|aiProvenance)\b/i;

class InvalidSuggestion extends Error {}

function object(value: unknown) {
  if (!isObject(value)) throw new InvalidSuggestion();
  return value;
}

function list<T>(value: unknown, min: number, max: number, parse: (entry: unknown) => T): T[] {
  if (!Array.isArray(value) || value.length < min || value.length > max) throw new InvalidSuggestion();
  return value.map(parse);
}

function choice<T extends string>(value: unknown, values: readonly T[]): T {
  const selected = values.find(item => item === value);
  if (selected === undefined) throw new InvalidSuggestion();
  return selected;
}

function number(value: unknown, min: number, max: number, whole = false): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max || (whole && !Number.isInteger(value))) {
    throw new InvalidSuggestion();
  }
  return value;
}

function id(value: unknown): string {
  if (!isId(value)) throw new InvalidSuggestion();
  return value;
}

function text(value: unknown, min: number, max: number, secrets: readonly string[]): string {
  if (typeof value !== "string" || /[\u0000-\u001f\u007f<>]/.test(value)) throw new InvalidSuggestion();
  const result = value.trim();
  if (result.length < min || result.length > max || privateText.test(result) ||
      secrets.some(secret => secret && result.toLowerCase().includes(secret.toLowerCase()))) {
    throw new InvalidSuggestion();
  }
  return result;
}

function optionalList<T>(value: unknown, max: number, parse: (entry: unknown) => T): T[] | undefined {
  return value === undefined ? undefined : list(value, 0, max, parse);
}

export function parseStudioAiRequest(raw: unknown, secrets: readonly string[]): StudioAiSuggestRequest | undefined {
  try {
    const input = object(raw);
    const read = (value: unknown, min: number, max: number) => text(value, min, max, secrets);
    const publicCopy = (value: unknown, min: number, max: number) => {
      const result = read(value, min, max);
      if (bannedCopy.test(result)) throw new InvalidSuggestion();
      return result;
    };
    const readId = (value: unknown) => id(read(value, 1, 100));
    const format = choice(input.format, ["claim-the-city", "hide-and-seek"]);
    const shared = {
      cityLabel: read(input.cityLabel, 1, 100),
      theme: input.theme === undefined ? undefined : read(input.theme, 0, 120),
      count: input.count === undefined ? 3 : number(input.count, 1, 3, true),
    };
    if (format === "claim-the-city") {
      const point = object(input.landmark);
      const tags = point.osmTags === undefined ? {} : object(point.osmTags);
      const osmTags: Record<string, string> = {};
      for (const key of publicTags) {
        if (tags[key] !== undefined) osmTags[key] = read(tags[key], 1, 160);
      }
      return {
        ...shared,
        format,
        landmark: {
          id: readId(point.id),
          name: publicCopy(point.name, 1, 120),
          zoneName: read(point.zoneName, 1, 120),
          transitSummary: read(point.transitSummary, 0, 240),
          accessNotes: read(point.accessNotes, 0, 240),
          publicHours: read(point.publicHours, 0, 160),
          osmCategory: point.osmCategory === undefined ? undefined : choice(point.osmCategory, categories),
          osmTags,
        },
        primitive: choice(input.primitive, primitives),
        pattern: choice(input.pattern, patterns),
        existingTitles: optionalList(input.existingTitles, 40, value => read(value, 1, 120)),
      };
    }
    const targetFamily = choice(input.targetFamily, families);
    const availablePoiCategories = optionalList(input.availablePoiCategories, 24, value => publicCopy(value, 1, 60));
    const poiSamples = optionalList(input.poiSamples, 24, value => {
      const poi = object(value);
      return { id: readId(poi.id), name: publicCopy(poi.name, 1, 120), category: publicCopy(poi.category, 1, 60) };
    });
    if (poiSamples && new Set(poiSamples.map(poi => poi.id)).size !== poiSamples.length) throw new InvalidSuggestion();
    if (targetFamily !== "photo" && !availablePoiCategories?.length && !(targetFamily === "measuring" && poiSamples?.length)) {
      throw new InvalidSuggestion();
    }
    return {
      ...shared, format, targetFamily, availablePoiCategories, poiSamples,
      stationNames: optionalList(input.stationNames, 20, value => read(value, 1, 120)),
      existingLabels: optionalList(input.existingLabels, 40, value => read(value, 1, 120)),
    };
  } catch (error) {
    if (error instanceof InvalidSuggestion) return undefined;
    throw error;
  }
}

type CopyReader = (value: unknown, min: number, max: number) => string;

function answers(raw: Record<string, unknown>, read: CopyReader) {
  return list(raw.acceptedAnswers, 1, 6, value => read(value, 1, 100));
}

function numericRange(value: unknown) {
  const raw = object(value);
  const min = number(raw.min, -1_000_000, 1_000_000);
  return { min, max: number(raw.max, min, 1_000_000) };
}

function observationAnswer(raw: Record<string, unknown>, read: CopyReader) {
  return raw.numericRange === undefined
    ? { acceptedAnswers: answers(raw, read) }
    : { numericRange: numericRange(raw.numericRange) };
}

function leaf(value: unknown, read: CopyReader): ClaimLeafChallengePayload {
  const raw = object(value);
  const prompt = read(raw.prompt, 6, 500);
  switch (raw.primitive) {
    case "observation_mcq": {
      const choices = list(raw.choices, 2, 6, value => {
        const item = object(value);
        return { id: id(read(item.id, 1, 100)), label: read(item.label, 1, 120) };
      });
      const ids = choices.map(item => item.id);
      if (new Set(ids).size !== choices.length || new Set(choices.map(item => key(item.label))).size !== choices.length) {
        throw new InvalidSuggestion();
      }
      return { primitive: raw.primitive, prompt, choices, correctChoiceId: choice(raw.correctChoiceId, ids) };
    }
    case "observation_input":
      return raw.inputMode === "number"
        ? { primitive: raw.primitive, prompt, inputMode: "number", ...observationAnswer(raw, read) }
        : { primitive: raw.primitive, prompt, inputMode: choice(raw.inputMode, ["text"]), acceptedAnswers: answers(raw, read) };
    case "photo_proof":
      return {
        primitive: raw.primitive, prompt,
        verificationMode: choice(raw.verificationMode, ["rival_or_timeout", "honor_submit"]),
        autoApproveMs: number(raw.autoApproveMs, 1, 180_000, true),
      };
    case "timed_micro_task": {
      const timeLimitMs = number(raw.timeLimitMs, 1, 900_000, true);
      return raw.taskType === "photo_proof"
        ? { primitive: raw.primitive, prompt, timeLimitMs, taskType: raw.taskType, autoApproveMs: number(raw.autoApproveMs, 1, 180_000, true) }
        : { primitive: raw.primitive, prompt, timeLimitMs, taskType: choice(raw.taskType, ["observation_input"]), ...observationAnswer(raw, read) };
    }
    default:
      throw new InvalidSuggestion();
  }
}

function claimPayload(value: unknown, primitive: ClaimRequest["primitive"], read: CopyReader): ClaimChallengePrimitive {
  const raw = object(value);
  if (raw.primitive !== primitive) throw new InvalidSuggestion();
  if (primitive === "multi_step") {
    const [first, second] = list(raw.steps, 2, 2, value => leaf(value, read));
    return { primitive, steps: [first, second] };
  }
  if (primitive === "call_your_shot") {
    const reward = object(raw.boldReward);
    if (reward.drawTacticalCard !== undefined && typeof reward.drawTacticalCard !== "boolean") throw new InvalidSuggestion();
    const bonusWeight = reward.bonusWeight === undefined ? undefined : number(reward.bonusWeight, 1, 3, true);
    if (!bonusWeight && reward.drawTacticalCard !== true) throw new InvalidSuggestion();
    return {
      primitive, theme: read(raw.theme, 3, 120),
      standardTask: leaf(raw.standardTask, read), boldTask: leaf(raw.boldTask, read),
      boldReward: { bonusWeight, drawTacticalCard: reward.drawTacticalCard },
    };
  }
  return leaf(raw, read);
}

function key(label: string) {
  return label.normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase();
}

function itemId(scope: string, label: string) {
  return "studio-" + createHash("sha256").update(JSON.stringify([scope, key(label)])).digest("hex").slice(0, 16);
}

type Provenance = Omit<StudioAiProvenance, "verificationChecklist" | "draftNoteMarker">;

export function parseStudioAiSuggestions(
  request: StudioAiSuggestRequest,
  raw: unknown,
  provenance: Provenance,
  secrets: readonly string[],
): StudioAiSuggestResponse | undefined {
  const labels = new Set((request.format === "claim-the-city" ? request.existingTitles : request.existingLabels)?.map(key));
  const read: CopyReader = (value, min, max) => {
    const result = text(value, min, max, secrets);
    if (bannedCopy.test(result)) throw new InvalidSuggestion();
    return result;
  };
  const name = (value: unknown) => {
    const result = read(value, 3, 120);
    if (labels.has(key(result))) throw new InvalidSuggestion();
    labels.add(key(result));
    return result;
  };
  function verification(item: Record<string, unknown>) {
    const verificationChecklist = list(item.verificationChecklist, 2, 3, value => read(value, 12, 240));
    if (new Set(verificationChecklist.map(key)).size !== verificationChecklist.length) throw new InvalidSuggestion();
    return {
      verificationNotes: `${draftMarker} ${read(item.verificationNotes, 6, 400)}`,
      aiProvenance: { ...provenance, verificationChecklist, draftNoteMarker: draftMarker },
    };
  }
  try {
    const count = request.count ?? 3;
    if (request.format === "claim-the-city") {
      const suggestions = list(raw, count, count, value => {
        const item = object(value);
        const title = name(item.title);
        return {
          id: itemId(request.landmark.id, title), title,
          ...verification(item),
          hint: read(item.hint, 6, 280), learningExplanation: read(item.learningExplanation, 6, 500),
          estimatedSeconds: number(item.estimatedSeconds, 15, 900, true),
          reviewed: false, reviewedAt: "",
          payload: claimPayload(item.payload, request.primitive, read),
        };
      });
      return { mode: provenance.mode, format: request.format, suggestions };
    }
    const suggestions = list<Extract<StudioAiSuggestResponse, { format: "hide-and-seek" }>["suggestions"][number]>(raw, count, count, value => {
      const item = object(value);
      const label = name(item.label);
      const base = { id: itemId(`${request.cityLabel}:${request.targetFamily}`, label), label };
      const family = request.targetFamily;
      const poiCategory = () => choice(item.poiCategory, request.availablePoiCategories ?? []);
      switch (family) {
        case "photo":
          return { family, item: {
            ...base, ...verification(item), prompt: read(item.prompt, 6, 500),
            phase: choice(item.phase, ["seeking", "both"]),
            fieldVerified: false, fieldVerifiedAt: "",
          } };
        case "matching":
          return { family, item: { ...base, matchType: choice(item.matchType, ["nearest_poi"]), poiCategory: poiCategory() } };
        case "measuring":
          return item.targetType === "named_poi"
            ? { family, item: { ...base, targetType: "named_poi", poiId: choice(item.poiId, request.poiSamples?.map(poi => poi.id) ?? []) } }
            : { family, item: { ...base, targetType: choice(item.targetType, ["poi_category"]), poiCategory: poiCategory() } };
        case "tentacles":
          return { family, item: { ...base, radiusMeters: number(item.radiusMeters, 50, 5_000, true), poiCategory: poiCategory() } };
      }
    });
    return { mode: provenance.mode, format: request.format, suggestions };
  } catch (error) {
    if (error instanceof InvalidSuggestion) return undefined;
    throw error;
  }
}
