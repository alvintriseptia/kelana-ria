import { signal, type Signal } from "@preact/signals";
import type { StudioAiSuggestRequest, StudioAiSuggestResponse, StudioObservationPattern } from "@kelana-ria/contracts";
import { challengePrimitiveTileMeta, questionFamilyTileMeta } from "./studio-assets";

type Idea = StudioAiSuggestResponse["suggestions"][number];
type IdeaState = {
  open: Signal<boolean>;
  pattern: Signal<StudioObservationPattern>;
  theme: Signal<string>;
  response: Signal<{ mode: StudioAiSuggestResponse["mode"]; suggestions: Idea[] } | null>;
  busy: Signal<boolean>;
  message: Signal<string>;
  source: Signal<string>;
};

export function studioIdeaState(): IdeaState {
  return {
    open: signal(false), pattern: signal("see_and_explain"), theme: signal(""),
    response: signal(null), busy: signal(false), message: signal(""), source: signal(""),
  };
}

const patterns: [StudioObservationPattern, string][] = [
  ["see_and_explain", "Amati & Jelaskan"],
  ["compare_features", "Bandingkan Detail"],
  ["read_connection", "Baca Arah Transit"],
  ["record_detail", "Foto Cepat"],
];

function ideaDetails(idea: Idea) {
  if ("payload" in idea) {
    const payload = idea.payload;
    const prompt = "prompt" in payload ? payload.prompt
      : payload.primitive === "multi_step" ? payload.steps[0].prompt : payload.standardTask.prompt;
    return {
      name: idea.title, prompt, provenance: idea.aiProvenance,
      art: challengePrimitiveTileMeta(payload.primitive),
    };
  }
  const { item, family } = idea;
  const prompt = "prompt" in item ? item.prompt : "poiId" in item && item.poiId
    ? undefined : "poiCategory" in item ? item.poiCategory : undefined;
  return {
    name: item.label, prompt,
    provenance: "aiProvenance" in item ? item.aiProvenance : undefined,
    art: questionFamilyTileMeta(family),
  };
}

export function StudioAiPanel({ state, format, explainUnavailable, landmarks, generate, useIdea }: {
  state: IdeaState;
  format: StudioAiSuggestRequest["format"];
  explainUnavailable?: string;
  landmarks?: { id: string; name: string }[];
  generate: (pattern: StudioObservationPattern, theme: string, previous: Idea[], landmarkId?: string) => Promise<StudioAiSuggestResponse>;
  useIdea: (idea: Idea, edit: boolean) => Promise<boolean>;
}) {
  const current = state.response.value;
  const claim = format === "claim-the-city";
  async function run() {
    if (state.busy.value || explainUnavailable) return;
    state.busy.value = true;
    state.message.value = "";
    try {
      state.response.value = await generate(state.pattern.value, state.theme.value.trim(), current?.suggestions ?? [], state.source.value || landmarks?.[0]?.id);
    } catch (error) {
      state.message.value = error instanceof Error ? error.message : "Ide belum bisa dibuat. Coba lagi.";
    } finally {
      state.busy.value = false;
    }
  }

  async function pick(idea: Idea, edit: boolean) {
    if (state.busy.value) return;
    state.busy.value = true;
    state.message.value = "";
    try {
      if (await useIdea(idea, edit) && current) {
        state.response.value = { ...current, suggestions: current.suggestions.filter(item => item !== idea) };
        state.message.value = "Ide disimpan di draf.";
      }
    } catch {
      state.message.value = "Ide belum bisa disimpan. Coba lagi.";
    } finally {
      state.busy.value = false;
    }
  }

  return <details class="studio-evidence studio-ideas" open={state.open.value}
    onToggle={event => { state.open.value = event.currentTarget.open; }}>
    <summary>{claim ? "Racik Ide AI" : "Racik Ide Pertanyaan AI"}</summary>
    {claim && <div class="rb-actions" role="group" aria-label="Pola pengamatan">
      {patterns.map(([key, label]) => <button type="button" class="secondary" key={key}
        aria-pressed={state.pattern.value === key} disabled={state.busy.value}
        onClick={() => { state.pattern.value = key; }}>{label}</button>)}
    </div>}
    {landmarks?.length ? <label class="rb-field"><span>Lokasi acuan</span>
      <select value={state.source.value || landmarks[0].id} disabled={state.busy.value}
        onChange={event => { state.source.value = event.currentTarget.value; state.response.value = null; }}>
        {landmarks.map(point => <option value={point.id} key={point.id}>{point.name}</option>)}
      </select>
    </label> : null}
    <label class="rb-field"><span>Tema atau sudut pandang (opsional)</span>
      <input value={state.theme.value} maxLength={120} disabled={state.busy.value}
        onInput={event => { state.theme.value = event.currentTarget.value; }} />
    </label>
    {explainUnavailable && <p>{explainUnavailable}</p>}
    <button type="button" class="primary" disabled={state.busy.value || Boolean(explainUnavailable)}
      onClick={() => void run()}>{current ? "Racik Ulang" : claim ? "Buat Ide Tantangan" : "Buat Ide Pertanyaan"}</button>
    <p role="status">{state.busy.value ? "Memproses ide…" : state.message.value}</p>
    {current && <div class="st-card-stack" aria-label="Ide yang tersedia">
      {current.suggestions.map(idea => {
        const { name, prompt, provenance, art } = ideaDetails(idea);
        const needsVisit = Boolean(provenance);
        const key = "payload" in idea ? idea.id : idea.item.id;
        return <article key={key} class="st-game-card studio-idea">
          <div class="studio-idea-art" aria-hidden="true" dangerouslySetInnerHTML={{ __html: art.svg }} />
          <div class="rb-badges">
            <span class="rb-badge">{current.mode === "live" ? "AI Langsung" : current.mode === "recorded-rehearsal" ? "Simulasi AI" : "Templat Cerdas (Mode Simulasi)"}</span>
            <span class="rb-badge">{art.short}</span>
            {needsVisit && <span class="rb-badge rb-badge-warn">Perlu Cek Lapangan</span>}
          </div>
          <h4>{name}</h4>
          {prompt && <p>{prompt}</p>}
          {"payload" in idea && <>
            {idea.estimatedSeconds && <small>Perkiraan {idea.estimatedSeconds} detik</small>}
            {idea.hint && <p>Petunjuk · {idea.hint}</p>}
            {idea.learningExplanation && <p>Penjelasan · {idea.learningExplanation}</p>}
          </>}
          {Boolean(provenance?.verificationChecklist?.length) && <details>
            <summary>Daftar Cek Lapangan</summary>
            <ul>{provenance?.verificationChecklist?.map(item => <li key={item}>{item}</li>)}</ul>
          </details>}
          <div class="rb-actions">
            {needsVisit && <button type="button" class="secondary" disabled={state.busy.value}
              onClick={() => void pick(idea, true)}>Pakai &amp; Sunting</button>}
            <button type="button" class="primary" disabled={state.busy.value} onClick={() => void pick(idea, false)}>
              {needsVisit ? "Simpan Draf (Cek Nanti)" : "+ Tambah ke Pertanyaan"}
            </button>
          </div>
        </article>;
      })}
    </div>}
  </details>;
}

export function renderStudioAiPanel(props: Parameters<typeof StudioAiPanel>[0]) {
  return <StudioAiPanel {...props} />;
}
