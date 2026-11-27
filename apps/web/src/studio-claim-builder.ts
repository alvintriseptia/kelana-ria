import type {
  ClaimCardDefinition,
  ClaimCardEffect,
  ClaimChallengeItem,
  ClaimChallengePrimitive,
  ClaimRulebookPack,
} from "@kelana-ria/contracts";
import { escapeText } from "./escape-text";
import {
  challengePrimitiveTileMeta,
  renderGameCardPreviewHtml,
  type CardPreviewChip,
} from "./studio-assets";

export type ClaimStep3SubTab = "session" | "deck";

export type ClaimStep3State = {
  subTab: ClaimStep3SubTab;
  challengeTarget: string; // "backup" or landmarkId
  challengePrimitive: ClaimChallengePrimitive["primitive"];
  cardPrimitive: ClaimCardEffect["primitive"];
  editingChallengeIndex: number | null;
  editingChallengeDraft: ClaimChallengeItem | null;
  editingCardIndex: number | null;
  editingCardDraft: ClaimCardDefinition | null;
};

export const CLAIM_CARD_MIN_COPIES = 1;
export const CLAIM_CARD_MAX_COPIES = 8;

const CHALLENGE_PRIMITIVES: { id: ClaimChallengePrimitive["primitive"]; label: string }[] = [
  { id: "observation_mcq", label: "Pilihan Ganda" },
  { id: "observation_input", label: "Isian Teks/Angka" },
  { id: "photo_proof", label: "Bukti Foto" },
  { id: "timed_micro_task", label: "Tugas Cepat (Timer)" },
  { id: "call_your_shot", label: "Standar / Ekstra" },
  { id: "multi_step", label: "Tantangan 2 Langkah" },
];

const CLAIM_CARD_PRIMITIVES: { id: ClaimCardEffect["primitive"]; label: string }[] = [
  { id: "scout_challenge", label: "Intip Tantangan" },
  { id: "shield_claim", label: "Perisai Klaim" },
  { id: "double_weight", label: "Poin Ganda (2×)" },
  { id: "swap_challenge", label: "Ganti Tantangan" },
  { id: "instant_lock", label: "Kunci Instan" },
  { id: "sabotage_curse", label: "Kutukan (Curse)" },
];

export function renderClaimStep3(
  pack: ClaimRulebookPack,
  state: ClaimStep3State,
  editable: boolean,
  status: string,
  saving = false,
): string {
  const dis = editable ? "" : "disabled";
  const session = state.subTab === "session";

  return `<div class="rb-card" data-studio-slot="rules-builder">
    <h3>Aturan</h3>
    <div class="studio-section-tabs" role="group" aria-label="Bagian aturan">
      <button type="button" data-c3-tab="session" aria-pressed="${state.subTab === "session"}">Sesi &amp; Skor</button>
      <button type="button" data-c3-tab="deck" aria-pressed="${state.subTab === "deck"}">Kartu</button>
    </div>

    ${
      state.subTab === "session"
        ? renderClaimSession(pack, dis)
        : renderClaimDeck(pack, state, dis, editable)
    }

    <p class="studio-rule-note">Untuk menyunting tantangan, pilih landmark di Peta.</p>
    ${status ? `<p class="studio-save-feedback" role="status">${escapeText(status)}</p>` : ""}
    <div class="rb-sticky-footer studio-step-actions">
      ${editable && session ? `<button type="button" class="primary studio-save" data-action="save-draft" ${saving ? "disabled" : ""}>Simpan aturan sesi</button>` : ""}
      <button type="button" class="studio-tool" data-step="2">← Peta</button>
      <button type="button" class="studio-tool" data-step="4">Validasi →</button>
    </div>
  </div>`;
}

function renderClaimSession(pack: ClaimRulebookPack, dis: string): string {
  return `<section class="studio-rule-panel" data-testid="claim-session-panel" aria-label="Sesi &amp; Skor">
    <h4>Sesi &amp; Skor</h4>
    <fieldset class="rb-grid-2 studio-field-group">
      <legend>Pemain dan ronde</legend>
      <label class="rb-field"><span>Min Pemain (1–12)</span><input id="ed-claim-minp" type="number" min="1" max="12" value="${pack.session.minPlayers}" ${dis}></label>
      <label class="rb-field"><span>Maks Pemain (1–12)</span><input id="ed-claim-maxp" type="number" min="1" max="12" value="${pack.session.maxPlayers}" ${dis}></label>
      <label class="rb-field"><span>Susunan Awal Tim</span>
        <select id="ed-claim-team" ${dis}>
          <option value="ffa" ${pack.session.teamMode === "ffa" ? "selected" : ""}>Individu (FFA)</option>
          <option value="teams" ${pack.session.teamMode === "teams" ? "selected" : ""}>Tim</option>
        </select>
        <small>Pemain tetap bisa membuat, bergabung, atau memisahkan tim secara dinamis di ruang tunggu grup.</small>
      </label>
      <label class="rb-field"><span>Durasi Sesi (menit)</span><input id="ed-claim-duration" type="number" value="${Math.round(pack.session.durationMs / 60_000)}" ${dis}></label>
    </fieldset>
    <fieldset class="rb-grid-2 studio-field-group">
      <legend>Target dan penalti</legend>
      <label class="rb-field"><span>Target Kunci Solo</span><input id="ed-claim-solo-locks" type="number" value="${pack.session.soloTargets?.lockedLandmarks ?? 4}" ${dis}></label>
      <label class="rb-field"><span>Target Zona Solo</span><input id="ed-claim-solo-zones" type="number" value="${pack.session.soloTargets?.distinctZones ?? 2}" ${dis}></label>
      <label class="rb-field"><span>Aturan Gagal (Grup)</span>
        <select id="ed-claim-fail-policy" ${dis}>
          <option value="cooldown_ms" ${pack.claiming.multiplayerFailPolicy === "cooldown_ms" ? "selected" : ""}>Jeda Waktu</option>
          <option value="burned_for_player" ${pack.claiming.multiplayerFailPolicy === "burned_for_player" ? "selected" : ""}>Hangus</option>
        </select>
      </label>
      <label class="rb-field"><span>Jeda Gagal (menit)</span><input id="ed-claim-cooldown" type="number" min="0" max="30" value="${Math.round((pack.claiming.failCooldownMs ?? 300_000) / 60_000)}" ${dis}></label>
      <label class="rb-field"><span>Batas Kartu di Tangan</span><input id="ed-claim-hand" type="number" min="1" max="4" value="${pack.tacticalDeck.maxHandSize}" ${dis}></label>
    </fieldset>
  </section>`;
}

function challengeEditorValues(prim: ClaimChallengePrimitive["primitive"], editing: ClaimChallengeItem | null) {
  const payload = editing && editing.payload.primitive === prim ? editing.payload : null;

  let prompt = "";
  let optA = "Hijau Tua";
  let optB = "Merah Muda";
  let optC = "Ungu Neon";
  let correct: "a" | "b" | "c" = "a";
  let inmode: "text" | "number" = "text";
  let answer = "";
  let pmode: "rival_or_timeout" | "honor_submit" = "rival_or_timeout";
  let mins = 2;
  let secs = 90;
  let ttype: "photo_proof" | "observation_input" = "photo_proof";
  let timedAnswer = "";
  let theme = "Detail arsitektur ruang publik";
  let stdPrompt = "";
  let boldPrompt = "";

  if (prim === "observation_mcq") {
    if (payload && payload.primitive === "observation_mcq") {
      prompt = payload.prompt;
      optA = payload.choices[0]?.label ?? "Pilihan A";
      optB = payload.choices[1]?.label ?? "Pilihan B";
      optC = payload.choices[2]?.label ?? "Pilihan C";
      const matchIdx = payload.choices.findIndex((c) => c.id === payload.correctChoiceId);
      correct = matchIdx === 1 ? "b" : matchIdx === 2 ? "c" : "a";
    } else {
      prompt = "Apa warna dominan penanda utama lokasi ini?";
    }
  } else if (prim === "observation_input") {
    if (payload && payload.primitive === "observation_input") {
      prompt = payload.prompt;
      inmode = payload.inputMode;
      answer =
        payload.inputMode === "number"
          ? String(payload.numericRange?.min ?? "")
          : (payload.acceptedAnswers ?? []).join(", ");
    } else {
      prompt = "Berapa jumlah tiang utama gerbang?";
      answer = "jakarta, blok m";
    }
  } else if (prim === "photo_proof") {
    if (payload && payload.primitive === "photo_proof") {
      prompt = payload.prompt;
      pmode = payload.verificationMode;
      mins = Math.max(1, Math.min(5, Math.round(payload.autoApproveMs / 60_000)));
    } else {
      prompt = "Ambil foto papan nama publik tanpa tiket masuk.";
    }
  } else if (prim === "timed_micro_task") {
    if (payload && payload.primitive === "timed_micro_task") {
      prompt = payload.prompt;
      secs = Math.max(30, Math.round(payload.timeLimitMs / 1000));
      ttype = payload.taskType === "observation_input" ? "observation_input" : "photo_proof";
      timedAnswer = (payload.acceptedAnswers ?? []).join(", ");
    } else {
      prompt = "Kirim foto penanda ruang publik dalam 90 detik.";
    }
  } else if (prim === "call_your_shot") {
    if (payload && payload.primitive === "call_your_shot") {
      theme = payload.theme;
      stdPrompt = payload.standardTask.prompt;
      boldPrompt = payload.boldTask.prompt;
      answer =
        payload.boldTask.primitive === "observation_input"
          ? (payload.boldTask.acceptedAnswers ?? []).join(", ")
          : "taman, jakarta";
    } else {
      stdPrompt = "Foto papan nama depan lokasi.";
      boldPrompt = "Sebutkan kata pertama pada plakat taman.";
      answer = "taman, jakarta";
    }
  } else {
    if (payload && payload.primitive === "multi_step") {
      stdPrompt = payload.steps[0]?.prompt ?? "Foto gerbang masuk publik.";
      const step2 = payload.steps[1];
      boldPrompt = step2?.prompt ?? "Tulis nama jalan utama di depan gerbang.";
      answer =
        step2 && step2.primitive === "observation_input"
          ? (step2.acceptedAnswers ?? []).join(", ")
          : "sudirman, panglima polim";
    } else {
      stdPrompt = "Foto gerbang masuk publik.";
      boldPrompt = "Tulis nama jalan utama di depan gerbang.";
      answer = "sudirman, panglima polim";
    }
  }

  return {
    title: editing?.title ?? "",
    notes: editing?.verificationNotes ?? "",
    hint: editing?.hint ?? "",
    explanation: editing?.learningExplanation ?? "",
    estimate: editing?.estimatedSeconds !== undefined ? String(editing.estimatedSeconds) : "",
    reviewed: Boolean(editing?.reviewed),
    prompt,
    optA,
    optB,
    optC,
    correct,
    inmode,
    answer,
    pmode,
    mins,
    secs,
    ttype,
    timedAnswer,
    theme,
    stdPrompt,
    boldPrompt,
  };
}

export function renderClaimChallenges(
  pack: ClaimRulebookPack,
  state: ClaimStep3State,
  dis: string,
  editable: boolean,
): string {
  const isBackup = state.challengeTarget === "backup";
  const items = isBackup
    ? pack.challenges.backupPool
    : (pack.challenges.landmarkChallenges[state.challengeTarget] ?? []);
  const prim = state.challengePrimitive;
  const editing = state.editingChallengeIndex !== null ? state.editingChallengeDraft : null;
  const vals = challengeEditorValues(prim, editing);
  const estimates = items.flatMap(item => item.estimatedSeconds === undefined ? [] : [item.estimatedSeconds]);
  const compare = estimates.length > 1 && Math.max(...estimates) - Math.min(...estimates) > 20;

  return `<div data-testid="claim-challenges-panel">
    <label class="rb-field"><span>Target Tantangan</span>
      <select id="ed-chal-target">
        <option value="backup" ${isBackup ? "selected" : ""}>Tantangan Cadangan (${pack.challenges.backupPool.length} tantangan)</option>
        ${pack.geography.landmarks
          .map(
            (lm) =>
              `<option value="${escapeText(lm.id)}" ${state.challengeTarget === lm.id ? "selected" : ""}>${escapeText(lm.name)} (${(pack.challenges.landmarkChallenges[lm.id] ?? []).length})</option>`,
          )
          .join("")}
      </select>
    </label>

    <details class="rb-accordion" data-studio-accordion="claim-challenges">
      <summary>Varian tantangan (${items.length})</summary>
      ${compare ? '<p>Selisih perkiraan lebih dari 20 detik. Bandingkan usaha yang diperlukan sebelum menerbitkan.</p>' : ""}
      <ul class="rb-list">
        ${
          items.length === 0
            ? "<li>Belum ada tantangan pada target ini.</li>"
            : items
                .map(
                  (item, idx) => `<li${state.editingChallengeIndex === idx ? ' class="st-editing-row"' : ""}>
                    <div><strong>${escapeText(item.title)}</strong> <span class="rb-badge">${escapeText(challengePrimitiveTileMeta(item.payload.primitive).short)}</span></div>
                    <small>${item.reviewed ? `Ditinjau ${escapeText(item.reviewedAt)}` : "Belum ditinjau"} · ${escapeText(item.verificationNotes)}</small>
                    ${item.estimatedSeconds ? `<small>Perkiraan ${item.estimatedSeconds} detik</small>` : ""}
                    <div class="rb-actions">
                      <button type="button" class="secondary" data-c3-action="preview-challenge" data-index="${idx}">Pratinjau varian</button>
                      ${editable ? `<button type="button" class="secondary" data-c3-action="edit-challenge" data-index="${idx}">Sunting</button>` : ""}
                      ${editable ? `<button type="button" class="secondary" data-c3-action="delete-challenge" data-index="${idx}">Hapus</button>` : ""}
                    </div>
                  </li>`,
                )
                .join("")
        }
      </ul>
    </details>

    ${
      editable
        ? `<div class="rb-card" data-testid="claim-challenge-composer">
            <h4>${editing ? "Sunting Tantangan" : "+ Tambah Tantangan"}</h4>
            <div class="st-visual-grid" role="group" aria-label="Pilih tipe tantangan">
              ${CHALLENGE_PRIMITIVES.map((p) => {
                const meta = challengePrimitiveTileMeta(p.id);
                return `<button type="button" class="st-visual-tile" data-c3-prim="${p.id}" aria-pressed="${prim === p.id}">
                  ${meta.svg}
                  <strong>${escapeText(meta.short)}</strong>
                  <span class="st-tile-meta">${escapeText(meta.badge)}</span>
                </button>`;
              }).join("")}
            </div>
            <div class="rb-grid-2">
              <label class="rb-field"><span>Jenis Tantangan</span>
                <select id="ed-chal-prim" ${dis}>
                  ${CHALLENGE_PRIMITIVES.map(
                    (p) => `<option value="${p.id}" ${prim === p.id ? "selected" : ""}>${p.label}</option>`,
                  ).join("")}
                </select>
              </label>
              <label class="rb-field"><span>Judul Tantangan</span><input id="ed-chal-title" placeholder="Mis. Mural Fasad M Bloc" value="${escapeText(vals.title)}"></label>
            </div>

            ${
              prim === "observation_mcq"
                ? `<label class="rb-field"><span>Pertanyaan Pengamatan</span><input id="ed-chal-prompt" value="${escapeText(vals.prompt)}"></label>
                   <div class="rb-grid-2">
                     <label class="rb-field"><span>Opsi A</span><input id="ed-chal-opt-a" value="${escapeText(vals.optA)}"></label>
                     <label class="rb-field"><span>Opsi B</span><input id="ed-chal-opt-b" value="${escapeText(vals.optB)}"></label>
                     <label class="rb-field"><span>Opsi C</span><input id="ed-chal-opt-c" value="${escapeText(vals.optC)}"></label>
                     <label class="rb-field"><span>Jawaban benar</span><select id="ed-chal-correct">
                       <option value="a" ${vals.correct === "a" ? "selected" : ""}>Opsi A</option>
                       <option value="b" ${vals.correct === "b" ? "selected" : ""}>Opsi B</option>
                       <option value="c" ${vals.correct === "c" ? "selected" : ""}>Opsi C</option>
                     </select></label>
                   </div>`
                : prim === "observation_input"
                  ? `<label class="rb-field"><span>Pertanyaan Isian</span><input id="ed-chal-prompt" value="${escapeText(vals.prompt)}"></label>
                     <div class="rb-grid-2">
                       <label class="rb-field"><span>Tipe Input</span>
                         <select id="ed-chal-inmode">
                           <option value="text" ${vals.inmode === "text" ? "selected" : ""}>Teks</option>
                           <option value="number" ${vals.inmode === "number" ? "selected" : ""}>Angka</option>
                         </select>
                       </label>
                       <label class="rb-field"><span>Jawaban Benar (koma u/ teks, atau angka)</span><input id="ed-chal-answer" value="${escapeText(vals.answer)}"></label>
                     </div>`
                  : prim === "photo_proof"
                    ? `<label class="rb-field"><span>Instruksi Foto</span><input id="ed-chal-prompt" value="${escapeText(vals.prompt)}"></label>
                       <div class="rb-grid-2">
                         <label class="rb-field"><span>Mode Verifikasi</span>
                           <select id="ed-chal-pmode">
                             <option value="rival_or_timeout" ${vals.pmode === "rival_or_timeout" ? "selected" : ""}>Cek Lawan / Otomatis</option>
                             <option value="honor_submit" ${vals.pmode === "honor_submit" ? "selected" : ""}>Langsung Selesai</option>
                           </select>
                         </label>
                         <label class="rb-field"><span>Setuju Otomatis (menit, maks. 5)</span><input id="ed-chal-mins" type="number" min="1" max="5" value="${vals.mins}"></label>
                       </div>`
                    : prim === "timed_micro_task"
                      ? `<label class="rb-field"><span>Instruksi Tugas Cepat</span><input id="ed-chal-prompt" value="${escapeText(vals.prompt)}"></label>
                         <div class="rb-grid-2">
                           <label class="rb-field"><span>Batas Waktu (detik)</span><input id="ed-chal-secs" type="number" min="30" max="600" value="${vals.secs}"></label>
                           <label class="rb-field"><span>Tipe Tugas</span>
                             <select id="ed-chal-ttype">
                               <option value="photo_proof" ${vals.ttype === "photo_proof" ? "selected" : ""}>Foto Bukti</option>
                               <option value="observation_input" ${vals.ttype === "observation_input" ? "selected" : ""}>Isian Cepat</option>
                             </select>
                           </label>
                           <label class="rb-field"><span>Jawaban isian cepat (pisahkan dengan koma)</span><input id="ed-chal-timed-answer" placeholder="pintu utara, utara" value="${escapeText(vals.timedAnswer)}"></label>
                         </div>`
                      : prim === "call_your_shot"
                        ? `<div class="rb-grid-2">
                            <label class="rb-field"><span>Tema Tantangan</span><input id="ed-chal-theme" value="${escapeText(vals.theme)}"></label>
                            <label class="rb-field"><span>Soal Standar (Foto)</span><input id="ed-chal-std" value="${escapeText(vals.stdPrompt)}"></label>
                            <label class="rb-field"><span>Soal Ekstra (Isian Teks)</span><input id="ed-chal-bold" value="${escapeText(vals.boldPrompt)}"></label>
                            <label class="rb-field"><span>Jawaban Ekstra (pisahkan koma)</span><input id="ed-chal-answer" value="${escapeText(vals.answer)}"></label>
                          </div>`
                        : `<div class="rb-grid-2">
                            <label class="rb-field"><span>Langkah 1 (Foto)</span><input id="ed-chal-std" value="${escapeText(vals.stdPrompt)}"></label>
                            <label class="rb-field"><span>Langkah 2 (Isian Teks)</span><input id="ed-chal-bold" value="${escapeText(vals.boldPrompt)}"></label>
                            <label class="rb-field"><span>Jawaban Langkah 2</span><input id="ed-chal-answer" value="${escapeText(vals.answer)}"></label>
                          </div>`
            }
            <label class="rb-field"><span>Sumber atau kriteria bukti</span><textarea id="ed-chal-notes" rows="2" required placeholder="Catat sumber fakta atau ciri yang harus terlihat dalam bukti.">${escapeText(vals.notes)}</textarea></label>
            <label class="rb-field"><span>Petunjuk setelah check-in (opsional)</span><textarea id="ed-chal-hint" rows="2">${escapeText(vals.hint)}</textarea></label>
            <label class="rb-field"><span>Penjelasan setelah berhasil (opsional)</span><textarea id="ed-chal-explanation" rows="2">${escapeText(vals.explanation)}</textarea></label>
            <label class="rb-field"><span>Perkiraan pengerjaan (detik)</span><input id="ed-chal-estimate" type="number" min="1" step="1" value="${escapeText(vals.estimate)}"></label>
            <label><input id="ed-chal-reviewed" type="checkbox" required ${vals.reviewed ? "checked" : ""}> Saya sudah meninjau tugas, kunci jawaban atau kriteria bukti, dan sumbernya.</label>
            <p class="rb-errors" role="alert" data-claim-composer-error hidden></p>
            ${
              editing
                ? `<div class="rb-actions">
                    <button type="button" class="primary" data-c3-action="save-challenge">Simpan Perubahan</button>
                    <button type="button" class="secondary" data-c3-action="cancel-edit-challenge">Batal</button>
                  </div>`
                : `<button type="button" class="primary" data-c3-action="add-challenge">+ Simpan Tantangan ke Target</button>`
            }
          </div>`
        : ""
    }
  </div>`;
}

function claimCardEditorValues(prim: ClaimCardEffect["primitive"], editing: ClaimCardDefinition | null) {
  const sameEffect = editing && editing.effect.primitive === prim ? editing.effect : null;
  let shieldMins = 10;
  let curseMins = 5;
  let blocker: "block_steals" | "block_claims" | "block_both" = "block_steals";

  if (sameEffect && sameEffect.primitive === "shield_claim") {
    shieldMins = Math.max(1, Math.min(30, Math.round(sameEffect.durationMs / 60_000)));
  } else if (sameEffect && sameEffect.primitive === "sabotage_curse") {
    blocker = sameEffect.blockerType;
    if (sameEffect.clearCondition.type === "timer") {
      curseMins = Math.max(1, Math.min(10, Math.round(sameEffect.clearCondition.durationMs / 60_000)));
    }
  }

  return {
    title: editing?.title ?? "",
    description: editing?.description ?? "Kartu buatan kreator.",
    copies: editing?.copies ?? 1,
    shieldMins,
    curseMins,
    blocker,
  };
}

function renderClaimDeck(
  pack: ClaimRulebookPack,
  state: ClaimStep3State,
  dis: string,
  editable: boolean,
): string {
  const prim = state.cardPrimitive;
  const editing = state.editingCardIndex !== null ? state.editingCardDraft : null;
  const vals = claimCardEditorValues(prim, editing);
  const initialPreview = editing && editing.effect.primitive === prim ? editing : previewClaimCardFromState(state, editing);

  return `<section class="studio-rule-panel" data-testid="claim-deck-panel" aria-label="Kartu">
    <h4>Kartu</h4>
    <div class="rb-grid-2">
      <label class="rb-field"><span>Status Dek Kartu</span>
        <select id="ed-cdeck-enabled" ${dis}>
          <option value="true" ${pack.tacticalDeck.enabled ? "selected" : ""}>Aktif</option>
          <option value="false" ${!pack.tacticalDeck.enabled ? "selected" : ""}>Nonaktif</option>
        </select>
      </label>
      <label class="rb-field"><span>Maks. Kutukan per Pemain</span><input id="ed-cdeck-maxc" type="number" min="1" max="3" value="${pack.tacticalDeck.maxActiveCursesPerTarget}" ${dis}></label>
    </div>
    ${editable ? `<button type="button" class="secondary" data-c3-action="save-deck-cfg">Simpan Pengaturan Dek</button>` : ""}

    <details class="rb-accordion" data-studio-accordion="claim-deck">
      <summary>Daftar Kartu (${pack.tacticalDeck.cards.length} jenis)</summary>
      <div class="st-card-stack">
        ${pack.tacticalDeck.cards
          .map((card, idx) =>
            renderClaimCardTile(
              card,
              editable
                ? `<div class="st-copy-stepper" role="group" aria-label="Jumlah salinan ${escapeText(card.title)}">
                     <button type="button" class="secondary st-step-btn" data-c3-action="step-claim-card-copies" data-index="${idx}" data-delta="-1" aria-label="Kurangi salinan ${escapeText(card.title)}" ${card.copies <= CLAIM_CARD_MIN_COPIES ? "disabled" : ""}>−</button>
                     <span class="st-step-count" data-testid="claim-card-copies-${idx}">${card.copies}×</span>
                     <button type="button" class="secondary st-step-btn" data-c3-action="step-claim-card-copies" data-index="${idx}" data-delta="1" aria-label="Tambah salinan ${escapeText(card.title)}" ${card.copies >= CLAIM_CARD_MAX_COPIES ? "disabled" : ""}>+</button>
                   </div>
                   <button type="button" class="secondary" data-c3-action="edit-claim-card" data-index="${idx}">Sunting</button>
                   <button type="button" class="secondary" data-c3-action="delete-claim-card" data-index="${idx}">Hapus</button>`
                : undefined,
            ),
          )
          .join("")}
      </div>
    </details>

    ${
      editable
        ? `<div class="rb-card" data-testid="claim-card-composer">
            <h4>${editing ? "Sunting Kartu" : "+ Tambah Kartu"}</h4>
            <div data-testid="live-card-preview">${renderClaimCardTile(initialPreview)}</div>
            <div class="rb-grid-2">
              <label class="rb-field"><span>Jenis Kartu</span>
                <select id="ed-ccard-prim">
                  ${CLAIM_CARD_PRIMITIVES.map(
                    (p) => `<option value="${p.id}" ${prim === p.id ? "selected" : ""}>${p.label}</option>`,
                  ).join("")}
                </select>
              </label>
              <label class="rb-field"><span>Salinan</span><input id="ed-ccard-copies" type="number" min="${CLAIM_CARD_MIN_COPIES}" max="${CLAIM_CARD_MAX_COPIES}" value="${vals.copies}"></label>
              <label class="rb-field"><span>Judul Kartu</span><input id="ed-ccard-title" placeholder="Mis. Kutukan Lampu Merah" value="${escapeText(vals.title)}"></label>
              <label class="rb-field"><span>Deskripsi</span><input id="ed-ccard-desc" value="${escapeText(vals.description)}"></label>
            </div>
            ${
              prim === "shield_claim"
                ? `<label class="rb-field"><span>Durasi Perisai (menit)</span><input id="ed-ccard-mins" type="number" min="1" max="30" value="${vals.shieldMins}"></label>`
                : prim === "sabotage_curse"
                  ? `<div class="rb-grid-2">
                      <label class="rb-field"><span>Blokir</span>
                        <select id="ed-ccard-blocker">
                          <option value="block_steals" ${vals.blocker === "block_steals" ? "selected" : ""}>Blokir Rebut</option>
                          <option value="block_claims" ${vals.blocker === "block_claims" ? "selected" : ""}>Blokir Klaim</option>
                          <option value="block_both" ${vals.blocker === "block_both" ? "selected" : ""}>Blokir Klaim &amp; Rebut</option>
                        </select>
                      </label>
                      <label class="rb-field"><span>Durasi Kutukan (menit, maks. 10)</span><input id="ed-ccard-mins" type="number" min="1" max="10" value="${vals.curseMins}"></label>
                    </div>`
                  : ""
            }
            ${
              editing
                ? `<div class="rb-actions">
                    <button type="button" class="primary" data-c3-action="save-claim-card">Simpan Perubahan</button>
                    <button type="button" class="secondary" data-c3-action="cancel-edit-claim-card">Batal</button>
                  </div>`
                : `<button type="button" class="primary" data-c3-action="add-claim-card">+ Tambah Kartu</button>`
            }
          </div>`
        : ""
    }
  </section>`;
}

export function buildClaimChallengeFromForm(
  root: HTMLElement,
  state: ClaimStep3State,
  existingId?: string,
): ClaimChallengeItem | null {
  const title = root.querySelector<HTMLInputElement>("#ed-chal-title")?.value.trim();
  const verificationNotes = root.querySelector<HTMLTextAreaElement>("#ed-chal-notes")?.value.trim();
  const reviewed = root.querySelector<HTMLInputElement>("#ed-chal-reviewed")?.checked;
  if (!title || !verificationNotes || verificationNotes.length < 6 || !reviewed) return null;
  const reviewedAt = new Date().toISOString().slice(0, 10);
  const prim = state.challengePrimitive;
  let payload: ClaimChallengePrimitive;

  if (prim === "observation_mcq") {
    payload = {
      primitive: "observation_mcq",
      prompt: root.querySelector<HTMLInputElement>("#ed-chal-prompt")?.value.trim() || "Pilih jawaban tepat.",
      choices: [
        { id: "a", label: root.querySelector<HTMLInputElement>("#ed-chal-opt-a")?.value.trim() || "Pilihan A" },
        { id: "b", label: root.querySelector<HTMLInputElement>("#ed-chal-opt-b")?.value.trim() || "Pilihan B" },
        { id: "c", label: root.querySelector<HTMLInputElement>("#ed-chal-opt-c")?.value.trim() || "Pilihan C" },
      ],
      correctChoiceId: root.querySelector<HTMLSelectElement>("#ed-chal-correct")?.value ?? "a",
    };
  } else if (prim === "observation_input") {
    const mode = (root.querySelector<HTMLSelectElement>("#ed-chal-inmode")?.value ?? "text") as "text" | "number";
    const ans = root.querySelector<HTMLInputElement>("#ed-chal-answer")?.value.trim() || "jakarta";
    if (mode === "number") {
      const n = Number(ans);
      if (!Number.isFinite(n)) return null;
      payload = {
        primitive: "observation_input",
        prompt: root.querySelector<HTMLInputElement>("#ed-chal-prompt")?.value.trim() || "Masukkan angka.",
        inputMode: "number",
        numericRange: { min: n, max: n },
      };
    } else {
      payload = {
        primitive: "observation_input",
        prompt: root.querySelector<HTMLInputElement>("#ed-chal-prompt")?.value.trim() || "Masukkan jawaban.",
        inputMode: "text",
        acceptedAnswers: ans.split(",").map((s) => s.trim()).filter(Boolean),
      };
    }
  } else if (prim === "photo_proof") {
    const mins = Math.max(1, Math.min(5, Number(root.querySelector<HTMLInputElement>("#ed-chal-mins")?.value ?? 2)));
    payload = {
      primitive: "photo_proof",
      prompt: root.querySelector<HTMLInputElement>("#ed-chal-prompt")?.value.trim() || "Ambil foto bukti publik.",
      verificationMode: (root.querySelector<HTMLSelectElement>("#ed-chal-pmode")?.value ??
        "rival_or_timeout") as "rival_or_timeout" | "honor_submit",
      autoApproveMs: mins * 60_000,
    };
  } else if (prim === "timed_micro_task") {
    const secs = Math.max(30, Number(root.querySelector<HTMLInputElement>("#ed-chal-secs")?.value ?? 90));
    const taskType = (root.querySelector<HTMLSelectElement>("#ed-chal-ttype")?.value ?? "photo_proof") as
      | "photo_proof"
      | "observation_input";
    const answers = (root.querySelector<HTMLInputElement>("#ed-chal-timed-answer")?.value ?? "")
      .split(",").map(answer => answer.trim()).filter(Boolean);
    if (taskType === "observation_input" && !answers.length) return null;
    payload =
      taskType === "observation_input"
        ? {
            primitive: "timed_micro_task",
            prompt: root.querySelector<HTMLInputElement>("#ed-chal-prompt")?.value.trim() || "Jawab cepat.",
            timeLimitMs: secs * 1000,
            taskType: "observation_input",
            acceptedAnswers: answers,
          }
        : {
            primitive: "timed_micro_task",
            prompt: root.querySelector<HTMLInputElement>("#ed-chal-prompt")?.value.trim() || "Kirim foto cepat.",
            timeLimitMs: secs * 1000,
            taskType: "photo_proof",
            autoApproveMs: 120_000,
          };
  } else if (prim === "call_your_shot") {
    const ans = (root.querySelector<HTMLInputElement>("#ed-chal-answer")?.value ?? "taman")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    payload = {
      primitive: "call_your_shot",
      theme: root.querySelector<HTMLInputElement>("#ed-chal-theme")?.value.trim() || "Pengamatan cepat",
      standardTask: {
        primitive: "photo_proof",
        prompt: root.querySelector<HTMLInputElement>("#ed-chal-std")?.value.trim() || "Foto penanda lokasi.",
        verificationMode: "rival_or_timeout",
        autoApproveMs: 120_000,
      },
      boldTask: {
        primitive: "observation_input",
        prompt: root.querySelector<HTMLInputElement>("#ed-chal-bold")?.value.trim() || "Tulis nama plakat.",
        inputMode: "text",
        acceptedAnswers: ans.length ? ans : ["taman"],
      },
      boldReward: { drawTacticalCard: true, bonusWeight: 1 },
    };
  } else {
    const ans = (root.querySelector<HTMLInputElement>("#ed-chal-answer")?.value ?? "sudirman")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    payload = {
      primitive: "multi_step",
      steps: [
        {
          primitive: "photo_proof",
          prompt: root.querySelector<HTMLInputElement>("#ed-chal-std")?.value.trim() || "Foto pintu masuk.",
          verificationMode: "rival_or_timeout",
          autoApproveMs: 120_000,
        },
        {
          primitive: "observation_input",
          prompt: root.querySelector<HTMLInputElement>("#ed-chal-bold")?.value.trim() || "Tulis nama jalan utama.",
          inputMode: "text",
          acceptedAnswers: ans.length ? ans : ["sudirman"],
        },
      ],
    };
  }

  const hint = root.querySelector<HTMLTextAreaElement>("#ed-chal-hint")?.value.trim();
  const learningExplanation = root.querySelector<HTMLTextAreaElement>("#ed-chal-explanation")?.value.trim();
  const estimatedSeconds = root.querySelector<HTMLInputElement>("#ed-chal-estimate")?.valueAsNumber;
  return {
    id: existingId || `chal-${prim}-${Date.now().toString(36)}`,
    title,
    verificationNotes,
    ...(hint ? { hint } : {}),
    ...(learningExplanation ? { learningExplanation } : {}),
    ...(Number.isFinite(estimatedSeconds) ? { estimatedSeconds } : {}),
    reviewed: true,
    reviewedAt,
    payload,
  };
}

const CLAIM_BLOCKER_LABELS: Record<string, string> = {
  block_steals: "Blokir Rebut",
  block_claims: "Blokir Klaim",
  block_both: "Blokir Klaim & Rebut",
};

const CLAIM_CLEAR_LABELS: Record<string, string> = {
  gps_detour: "Check-in Lokasi",
  photo_challenge: "Bukti Foto",
  honor_task: "Tugas Langsung",
  next_n_questions: "Jawab Pertanyaan",
};

const CLAIM_CARD_LABELS: Record<string, string> = {
  scout_challenge: "Intip Tantangan",
  swap_challenge: "Ganti Tantangan",
};

function claimCardChips(card: ClaimCardDefinition): CardPreviewChip[] {
  const ef = card.effect;
  if (ef.primitive === "shield_claim") {
    return [
      { label: "Perisai", tone: "ok" },
      { label: `${Math.round(ef.durationMs / 60_000)} menit`, tone: "neutral" },
    ];
  }
  if (ef.primitive === "sabotage_curse") {
    const clearLabel =
      ef.clearCondition.type === "timer"
        ? `Durasi: ${Math.round(ef.clearCondition.durationMs / 60_000)} mnt`
        : `Cara lepas: ${CLAIM_CLEAR_LABELS[ef.clearCondition.type] ?? ef.clearCondition.type}`;
    return [
      { label: CLAIM_BLOCKER_LABELS[ef.blockerType] ?? ef.blockerType, tone: "danger" },
      { label: clearLabel, tone: "warn" },
    ];
  }
  if (ef.primitive === "double_weight") return [{ label: "Poin 2×", tone: "ok" }];
  if (ef.primitive === "instant_lock") return [{ label: "Kunci Instan", tone: "ok" }];
  return [{ label: CLAIM_CARD_LABELS[ef.primitive] ?? ef.primitive }];
}

function renderClaimCardTile(card: ClaimCardDefinition, actionsHtml?: string): string {
  return renderGameCardPreviewHtml({
    variant: card.effect.primitive === "sabotage_curse" ? "curse" : "tactical",
    title: card.title,
    subtitle: card.description,
    copies: card.copies,
    chips: claimCardChips(card),
    actionsHtml,
  });
}

function previewClaimCardFromState(state: ClaimStep3State, editing?: ClaimCardDefinition | null): ClaimCardDefinition {
  const meta = CLAIM_CARD_PRIMITIVES.find((p) => p.id === state.cardPrimitive) ?? CLAIM_CARD_PRIMITIVES[0];
  const effect: ClaimCardEffect =
    state.cardPrimitive === "shield_claim"
      ? { primitive: "shield_claim", durationMs: 600_000 }
      : state.cardPrimitive === "sabotage_curse"
        ? {
            primitive: "sabotage_curse",
            blockerType: "block_steals",
            clearCondition: { type: "timer", durationMs: 300_000 },
          }
        : { primitive: state.cardPrimitive };
  return {
    id: editing?.id ?? "preview",
    copies: editing?.copies ?? 1,
    title: editing?.title || "Pratinjau Kartu",
    description: editing?.description || meta.label,
    effect,
  };
}

export function renderClaimLiveCardPreview(root: HTMLElement, state: ClaimStep3State): string {
  const built = buildClaimCardFromForm(root, state, "Pratinjau Kartu", state.editingCardDraft ?? undefined);
  return renderClaimCardTile(built ?? previewClaimCardFromState(state, state.editingCardDraft));
}

export function buildClaimCardFromForm(
  root: HTMLElement,
  state: ClaimStep3State,
  fallbackTitle?: string,
  existingCard?: ClaimCardDefinition,
): ClaimCardDefinition | null {
  const title = root.querySelector<HTMLInputElement>("#ed-ccard-title")?.value.trim() || fallbackTitle;
  if (!title) return null;
  const description = root.querySelector<HTMLInputElement>("#ed-ccard-desc")?.value.trim() || "Kartu buatan kreator.";
  const rawCopies = Number(root.querySelector<HTMLInputElement>("#ed-ccard-copies")?.value ?? 1);
  const copies = Math.max(CLAIM_CARD_MIN_COPIES, Math.min(CLAIM_CARD_MAX_COPIES, Number.isFinite(rawCopies) ? Math.round(rawCopies) : 1));
  const prim = state.cardPrimitive;
  let effect: ClaimCardEffect;
  if (prim === "scout_challenge") effect = { primitive: "scout_challenge" };
  else if (prim === "double_weight") effect = { primitive: "double_weight" };
  else if (prim === "swap_challenge") effect = { primitive: "swap_challenge" };
  else if (prim === "instant_lock") effect = { primitive: "instant_lock" };
  else if (prim === "shield_claim") {
    const mins = Math.max(1, Math.min(30, Number(root.querySelector<HTMLInputElement>("#ed-ccard-mins")?.value ?? 10)));
    effect = { primitive: "shield_claim", durationMs: mins * 60_000 };
  } else {
    const mins = Math.max(1, Math.min(10, Number(root.querySelector<HTMLInputElement>("#ed-ccard-mins")?.value ?? 5)));
    const blockerType = (root.querySelector<HTMLSelectElement>("#ed-ccard-blocker")?.value ?? "block_steals") as
      | "block_steals"
      | "block_claims"
      | "block_both";
    const existingClear =
      existingCard?.effect.primitive === "sabotage_curse" && existingCard.effect.clearCondition.type !== "timer"
        ? existingCard.effect.clearCondition
        : null;
    effect = {
      primitive: "sabotage_curse",
      blockerType,
      clearCondition: existingClear ?? { type: "timer", durationMs: mins * 60_000 },
    };
  }
  return {
    id: existingCard?.id || `ccard-${prim}-${Date.now().toString(36)}`,
    copies,
    title,
    description,
    effect,
  };
}
