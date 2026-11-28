import { createHash } from "node:crypto";
import type {
  ClaimZoneDefinition, RulebookFormat, StudioAiProvenance, StudioAiSuggestRequest, StudioChatProposal, StudioPoiCategory,
  StudioResolvedPinpoint,
} from "@kelana-ria/contracts";
import { isId, isObject } from "./http.js";
import { parseStudioAiSuggestions } from "./studio-ai-suggestions.js";
import { studioAiTemplates } from "./studio-ai-templates.js";
import { redactStudioKnowledge } from "./studio-knowledge-privacy.js";

export type StudioChatPlaceCandidate = {
  name: string;
  sourceExcerpt?: string;
  kind?: "landmarks" | "pois" | "stations";
};

export type StudioChatProposalContext = {
  format: RulebookFormat;
  cityLabel: string;
  now: number;
  secrets?: readonly string[];
  maxPlaces: number;
  model?: string;
  mode?: Exclude<StudioAiProvenance["mode"], "template-fallback">;
  places?: readonly StudioChatPlaceCandidate[];
  zones?: readonly { id: string; name: string }[];
  landmarks?: readonly { id: string; name: string; category?: StudioPoiCategory }[];
  pois?: readonly { id: string; name: string; category: string }[];
};

type SuggestionProvenance = Omit<StudioAiProvenance, "verificationChecklist" | "draftNoteMarker">;
type ClaimRequest = Extract<StudioAiSuggestRequest, { format: "claim-the-city" }>;
type SeekRequest = Extract<StudioAiSuggestRequest, { format: "hide-and-seek" }>;
type ObservationPrimitive = "observation_input" | "observation_mcq";

const disallowedCopy = /kartu taktis|dek taktis|tantangan berani|berani\s*\/\s*bold|hadiah taktis|kutukan komposabel|kutukan sabotase|perburuan makro|jangkar sembunyi|tuan rumah|multi-primitif|\b(?:observation_mcq|observation_input|photo_proof|timed_micro_task|call_your_shot|multi_step|sabotage_curse|drawCount|keepCount|correctChoiceId|autoApproveMs|reviewedAt|fieldVerified|aiProvenance|isOfficial|packId|CLOUDFLARE_ACCOUNT_ID|CLOUDFLARE_API_TOKEN)\b/i;
const draftInstruction = /\b(?:ignore|disregard|forget|override)\s+(?:all\s+|the\s+|any\s+|your\s+)*(?:previous|prior|system|developer|instructions?|verification)\b|\b(?:abaikan|lewati)\s+(?:semua\s+|arahan\s+)*(?:aturan|instruksi|cek lapangan|verifikasi)\b|\b(?:reviewed|version)\s*[:=]/i;
const englishCue = /\b(?:a|an|and|are|at|below|can|check|did|do|find|for|from|has|have|here|how|in|is|it|look|observe|of|on|or|please|read|review|should|take|that|the|their|these|this|to|was|were|what|where|which|will|with|would|you|your)\b/gi;
const indonesianCue = /\b(?:ada|agar|apa|apakah|atau|bisa|cari|catat|cek|dalam|dapat|dari|dan|di|gunakan|ini|itu|jika|kami|ke|lihat|pada|periksa|perlu|saat|saya|sebelum|sudah|tanpa|tentang|tidak|untuk|yang)\b/i;
const numberedStop = /^(?:(?:stop|titik|pemberhentian|stasiun\s+ke)\s*#?\d{1,3}\s*[:.)–—-]?\s+|\d{1,3}[.)]\s+)/i;
const listMarker = /^(?:[-*+•●▪◦–—]\s+|\[[ xX]\]\s+)/;
const sectionHeading = /^(?:(?:jakarta\s+)?(?:walking|city|field|tour|travel)\s+(?:guide|tour|walk|route)|(?:panduan|rute|peta|jelajah|catatan)\s|(?:daftar\s+)?(?:lokasi|tempat|titik|stops?|poi|stations?|landmarks?|zones?|zona|destinations?|attractions?)$|(?:table of contents|contents|overview|introduction|itinerary|appendix|notes|tips|summary|logistics|safety|directions|accessibility|pendahuluan|ringkasan|penutup)\b|(?:how|what|where|when|getting|recommended)\s)/i;
const instructionLine = /^(?:amati|catat|lihat|baca|cek|ambil|jalan|mulai|periksa|gunakan|walk|look|find|observe|read|take|start|follow|visit|check|turn|continue|bring|keep)\s/i;
const placeWords = /^(?:taman|alun[- ]alun|lapangan|museum|monumen|stasiun|station|perpustakaan|pasar|masjid|gereja|kelenteng|candi|gedung|jembatan|tugu|halte|terminal|park|square|library|market|bridge)\s/i;

class InvalidStudioChatOutput extends Error {}

function normalizedKey(value: string) {
  return value.normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase();
}

function stableId(kind: string, value: string) {
  const hash = createHash("sha256").update(JSON.stringify([kind, normalizedKey(value)])).digest("hex").slice(0, 16);
  return `studio-chat-${hash}`;
}

function cleanCopy(value: unknown, maxLength: number, secrets: readonly string[] = [], translate = false): string {
  if (typeof value !== "string" || /[<>\u0000-\u0008\u000b-\u001f\u007f]/.test(value)) throw new InvalidStudioChatOutput();
  const normalized = value.normalize("NFKC").trim();
  const copy = normalized.replace(/\s+/g, " ");
  if (!copy || copy.length > maxLength || /[<>]/.test(copy) || redactStudioKnowledge(normalized, secrets) !== normalized ||
      disallowedCopy.test(copy) || draftInstruction.test(copy) ||
      (translate && (copy.match(englishCue)?.length ?? 0) >= 2 && !indonesianCue.test(copy))) {
    throw new InvalidStudioChatOutput();
  }
  return copy;
}

function guideName(value: string, secrets: readonly string[]) {
  const plain = value.replace(/^#{1,6}\s+/, "").replace(listMarker, "").replace(numberedStop, "")
    .replace(/[*_`]/g, "").replace(/\[([^\]]+)\]\([^)]*\)/g, "$1").trim();
  const name = plain.split(/\s+[–—-]\s+|:\s+|[;!?]|(?<=\p{L}{3})\.\s/u, 1)[0].trim().replace(/[.,:]+$/, "");
  if (name.length < 3 || name.split(/\s+/).length > 12 || sectionHeading.test(name) || instructionLine.test(name) ||
      !/^[\p{L}\p{N}][\p{L}\p{N}\s'’&(),.\u2013\u2019-]*$/u.test(name)) return undefined;
  if (!placeWords.test(name) && !/^\p{Lu}[\p{L}\p{N}]*\b/u.test(name)) return undefined;
  try {
    return cleanCopy(name, 120, secrets);
  } catch (error) {
    if (!(error instanceof InvalidStudioChatOutput)) throw error;
    return undefined;
  }
}

export function extractStudioChatPlaces(
  chunks: readonly { title: string; body: string; document_title?: string }[], maxPlaces: number, secrets: readonly string[] = [],
): StudioChatPlaceCandidate[] {
  const candidates = new Map<string, StudioChatPlaceCandidate>();
  const add = (label: string, context: string) => {
    if (candidates.size >= maxPlaces) return;
    const name = guideName(label, secrets);
    if (!name || candidates.has(normalizedKey(name))) return;
    const excerpt = redactStudioKnowledge(context, secrets).replace(/\s+/g, " ").slice(0, 240).trim();
    const sourceExcerpt = excerpt && !/[<>]/.test(excerpt) && !draftInstruction.test(excerpt) && !disallowedCopy.test(excerpt)
      ? excerpt : undefined;
    candidates.set(normalizedKey(name), { name, ...(sourceExcerpt ? { sourceExcerpt } : {}) });
  };
  for (const chunk of chunks) {
    if (chunk.title !== chunk.document_title) add(chunk.title.split(" › ").at(-1)?.trim() ?? "", chunk.body);
    for (const rawLine of chunk.body.split("\n")) {
      const line = rawLine.trim();
      if (listMarker.test(line) || numberedStop.test(line) || /^#{1,6}\s+/.test(line)) add(line, line);
    }
    if (candidates.size >= maxPlaces) break;
  }
  return [...candidates.values()];
}

function record(value: unknown) {
  if (!isObject(value)) throw new InvalidStudioChatOutput();
  return value;
}

function list(value: unknown, limit: number): unknown[] {
  if (!Array.isArray(value) || value.length > limit) throw new InvalidStudioChatOutput();
  return value;
}

function provenance(context: StudioChatProposalContext, mode: "live" | "template-fallback"): SuggestionProvenance {
  const generatedAt = new Date(context.now).toISOString();
  return mode === "live"
    ? { generatedAt, mode: context.mode ?? mode, source: "ai-co-creator", ...(context.model ? { model: context.model } : {}) }
    : { generatedAt, mode, source: "template-fallback" };
}

function claimRequest(
  context: StudioChatProposalContext,
  { id, name, category }: { id: string; name: string; category?: StudioPoiCategory },
  primitive: ObservationPrimitive,
): ClaimRequest {
  return {
    format: "claim-the-city", cityLabel: context.cityLabel, count: 1,
    landmark: { id, name, osmCategory: category, zoneName: "", transitSummary: "", accessNotes: "", publicHours: "" },
    primitive, pattern: "record_detail",
  };
}

function seekRequest(context: StudioChatProposalContext, family: SeekRequest["targetFamily"], count: number): SeekRequest {
  const pois = context.pois ?? [];
  return {
    format: "hide-and-seek", cityLabel: context.cityLabel, count, targetFamily: family,
    availablePoiCategories: [...new Set(pois.map(poi => poi.category))], poiSamples: [...pois],
  };
}

const claimVerification = {
  verificationNotes: "Cocokkan tugas dan kunci jawaban dengan ciri yang terlihat di lokasi.",
  verificationChecklist: [
    "Pastikan ciri yang ditanyakan terlihat dari jalur umum.",
    "Uji jawaban dan waktu penyelesaian di lokasi sebelum menyetujui tugas.",
  ],
};
const photoVerification = {
  verificationNotes: "Pastikan petunjuk bisa diikuti dari area publik yang aman.",
  verificationChecklist: [
    "Pastikan ciri tetap mudah ditemukan dari area publik di setiap pilihan tempat bersembunyi.",
    "Ambil foto latihan dan periksa bahwa wajah, alamat, dan nama stasiun tidak terlihat.",
  ],
};

const observationCues = [
  { words: /\b(?:inscriptions?|prasasti)\b/i, feature: "prasasti" },
  { words: /\b(?:stairs?|staircases?|stairways?|count (?:the )?steps|anak tangga)\b/i, feature: "tangga" },
  { words: /\b(?:signs?|signage|signboards?|penanda|papan petunjuk)\b/i, feature: "papan petunjuk" },
  { words: /\b(?:entrances?|pintu masuk|gerbang masuk)\b/i, feature: "pintu masuk" },
];

function fallbackClaimTemplates(request: ClaimRequest, sourceExcerpt: string | undefined, secrets: readonly string[]) {
  const templates = studioAiTemplates(request);
  if (!sourceExcerpt) return templates;
  const source = redactStudioKnowledge(sourceExcerpt, secrets);
  if (draftInstruction.test(source) || disallowedCopy.test(source)) return templates;
  const cue = observationCues.find(({ words }) => words.test(source));
  const [template] = templates;
  if (!cue || !isObject(template) || !isObject(template.payload)) return templates;
  const { name } = request.landmark;
  const { feature } = cue;
  return [{
    ...template,
    ...claimVerification,
    title: `Amati ${feature} di ${name}`.slice(0, 120).trimEnd(),
    hint: "Amati dari area publik yang aman.",
    learningExplanation: "Ciri yang terlihat dari jalur umum membantu pengunjung mengenali lokasi.",
    payload: { ...template.payload, prompt: `Di ${name}, lihat sekeliling dari tempat umum. Jika terlihat dari jalur umum, amati ${feature} dan sebutkan salah satu cirinya.` },
  }];
}

function claimProposal(
  target: string,
  challenges: Extract<StudioChatProposal, { kind: "add_claim_challenges" }>["challenges"],
): StudioChatProposal {
  return { id: stableId("add_claim_challenges", target), kind: "add_claim_challenges", targetLandmarkNameOrId: target, challenges };
}

function seekProposal(
  request: SeekRequest, items: unknown[], source: SuggestionProvenance, secrets: readonly string[],
): StudioChatProposal {
  const result = parseStudioAiSuggestions(request, items, source, secrets);
  if (result?.format !== "hide-and-seek") throw new InvalidStudioChatOutput();
  const base = { id: stableId("add_seek_questions", request.targetFamily), kind: "add_seek_questions" as const };
  for (const entry of result.suggestions) {
    cleanCopy(entry.item.label, 120, secrets, true);
    if (entry.family === "photo") cleanCopy(entry.item.prompt, 500, secrets, true);
  }
  switch (request.targetFamily) {
    case "photo":
      return { ...base, family: "photo", items: result.suggestions.filter(entry => entry.family === "photo")
        .map(({ item }) => ({ ...item, reviewed: false, reviewedAt: "" })) };
    case "matching":
      return { ...base, family: "matching", items: result.suggestions.filter(entry => entry.family === "matching").map(entry => entry.item) };
    case "measuring":
      return { ...base, family: "measuring", items: result.suggestions.filter(entry => entry.family === "measuring").map(entry => entry.item) };
    case "tentacles":
      return { ...base, family: "tentacles", items: result.suggestions.filter(entry => entry.family === "tentacles").map(entry => entry.item) };
  }
}

export function parseStudioChatOutput(raw: unknown, context: StudioChatProposalContext): {
  reply: string;
  proposals: StudioChatProposal[];
  places: StudioChatPlaceCandidate[];
} | undefined {
  const secrets = context.secrets ?? [];
  const read = (value: unknown, max: number, translate = false) => cleanCopy(value, max, secrets, translate);
  try {
    const output = record(raw);
    const reply = read(output.reply, 1_200, true);
    const rawProposals = list(output.proposals, 24).map(record);
    const proposals = new Map<string, StudioChatProposal>();
    const places = new Map<string, StudioChatPlaceCandidate>();
    const zones = new Map<string, ClaimZoneDefinition>();
    const knownZones = new Set(context.zones?.map(zone => normalizedKey(zone.name)));
    const source = provenance(context, "live");
    function add(proposal: StudioChatProposal) {
      if (proposals.has(proposal.id)) throw new InvalidStudioChatOutput();
      proposals.set(proposal.id, proposal);
    }

    for (const proposal of rawProposals) {
      const kind = proposal.kind === "add_pois" ? "pois"
        : context.format === "claim-the-city" && proposal.kind === "add_landmarks" ? "landmarks"
          : context.format === "hide-and-seek" && proposal.kind === "add_stations" ? "stations" : undefined;
      if (!kind) continue;
      for (const entry of list(proposal[kind], 60)) {
        if (places.size >= context.maxPlaces) break;
        const name = read(typeof entry === "string" ? entry : record(entry).name, 120);
        const key = normalizedKey(name);
        if (!places.has(key)) places.set(key, { name, kind });
      }
    }

    for (const proposal of rawProposals) {
      switch (proposal.kind) {
        case "update_meta": {
          const title = proposal.title === undefined ? undefined : read(proposal.title, 120, true);
          const summary = proposal.summary === undefined ? undefined : read(proposal.summary, 500, true);
          const cityLabel = proposal.cityLabel === undefined ? undefined : read(proposal.cityLabel, 100);
          if (title || summary || cityLabel) add({ id: stableId("update_meta", "metadata"), kind: "update_meta",
            ...(title ? { title } : {}), ...(summary ? { summary } : {}), ...(cityLabel ? { cityLabel } : {}),
          });
          break;
        }
        case "add_zones": {
          if (context.format !== "claim-the-city") break;
          for (const rawZone of list(proposal.zones, 15)) {
            const zone = record(rawZone);
            const name = read(zone.name, 120);
            const key = normalizedKey(name);
            const id = stableId("zone", name);
            if (knownZones.has(key) || zones.has(key) || context.zones?.some(zone => zone.id === id)) continue;
            const label = zone.label === undefined ? name : read(zone.label, 120);
            zones.set(key, { id, name, label });
          }
          break;
        }
        case "add_claim_challenges": {
          if (context.format !== "claim-the-city") break;
          const target = read(proposal.targetLandmarkNameOrId, 120);
          const key = normalizedKey(target);
          const existing = context.landmarks?.find(item => item.id === target || normalizedKey(item.name) === key);
          const proposedPlace = places.get(key);
          const candidate = proposedPlace ?? context.places?.find(item => normalizedKey(item.name) === key);
          if (!existing && candidate?.kind && candidate.kind !== "landmarks") throw new InvalidStudioChatOutput();
          if (!existing && !candidate) throw new InvalidStudioChatOutput();
          const landmark = existing ?? { id: stableId("landmark", target), name: read(candidate?.name, 120) };
          const challenges = list(proposal.challenges, 3).map(rawChallenge => {
            const challenge = record(rawChallenge);
            const payload = record(challenge.payload);
            if (payload.primitive !== "observation_input" && payload.primitive !== "observation_mcq") throw new InvalidStudioChatOutput();
            read(challenge.title, 120, true);
            read(payload.prompt, 500, true);
            if (challenge.hint !== undefined) read(challenge.hint, 280, true);
            if (challenge.learningExplanation !== undefined) read(challenge.learningExplanation, 500, true);
            const result = parseStudioAiSuggestions(claimRequest(context, landmark, payload.primitive), [{
              hint: "Amati ciri yang terlihat dari jalur umum.",
              learningExplanation: "Ciri tetap membantu pengunjung mengenali lokasi.", estimatedSeconds: 90,
              ...challenge, ...claimVerification,
            }], source, secrets);
            if (result?.format !== "claim-the-city") throw new InvalidStudioChatOutput();
            const [item] = result.suggestions;
            if (item.payload.primitive === "observation_mcq") item.payload.choices.forEach(choice => read(choice.label, 120, true));
            if (item.payload.primitive === "observation_input") item.payload.acceptedAnswers?.forEach(answer => read(answer, 100));
            return item;
          });
          if (challenges.length && new Set(challenges.map(challenge => challenge.id)).size !== challenges.length) throw new InvalidStudioChatOutput();
          if (challenges.length) add(claimProposal(existing?.id ?? landmark.name, challenges));
          break;
        }
        case "add_seek_questions": {
          if (context.format !== "hide-and-seek") break;
          const family = proposal.family;
          if (family !== "photo" && family !== "matching" && family !== "measuring" && family !== "tentacles") throw new InvalidStudioChatOutput();
          const items = list(proposal.items, 3).map(item => family === "photo" ? { ...record(item), ...photoVerification } : item);
          if (items.length) add(seekProposal(seekRequest(context, family, items.length), items, source, secrets));
          break;
        }
        case "add_landmarks":
        case "add_pois":
        case "add_stations":
        case "expand_boundary":
          break;
        default:
          throw new InvalidStudioChatOutput();
      }
    }
    if (zones.size) add({ id: stableId("add_zones", "zones"), kind: "add_zones", zones: [...zones.values()] });
    return { reply, proposals: [...proposals.values()], places: [...places.values()] };
  } catch (error) {
    if (error instanceof InvalidStudioChatOutput) return undefined;
    throw error;
  }
}

export function fallbackStudioChatProposals(
  context: StudioChatProposalContext, places: readonly StudioResolvedPinpoint[],
): StudioChatProposal[] {
  const source = provenance(context, "template-fallback");
  const secrets = context.secrets ?? [];
  if (context.format === "hide-and-seek") {
    const request = seekRequest(context, "photo", 1);
    try {
      return [seekProposal(request, studioAiTemplates(request), source, secrets)];
    } catch (error) {
      if (!(error instanceof InvalidStudioChatOutput)) throw error;
      return [];
    }
  }
  const resolved = places.filter(place => place.status === "resolved").slice(0, context.maxPlaces);
  const proposals: StudioChatProposal[] = [];
  for (const place of resolved) {
    try {
      const existing = context.landmarks?.find(item => normalizedKey(item.name) === normalizedKey(place.name));
      const landmark = existing ?? { id: stableId("landmark", place.name), name: place.name, category: place.category };
      const name = cleanCopy(landmark.name, 120, secrets);
      if (!isId(landmark.id)) continue;
      const request = claimRequest(context, { ...landmark, name }, "observation_input");
      const result = parseStudioAiSuggestions(request, fallbackClaimTemplates(request, place.sourceExcerpt, secrets), source, secrets);
      if (result?.format === "claim-the-city") {
        proposals.push(claimProposal(existing?.id ?? name, result.suggestions));
      }
    } catch (error) {
      if (!(error instanceof InvalidStudioChatOutput)) throw error;
    }
  }
  return proposals;
}
