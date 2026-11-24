import type {
  ClaimCardDefinition,
  ClaimCardEffect,
  ClaimChallengeItem,
  ClaimChallengePrimitive,
  ClaimRulebookPack,
} from "@kelana-ria/contracts";
import { escapeText } from "./solo-view";
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
};

const CHALLENGE_PRIMITIVES: { id: ClaimChallengePrimitive["primitive"]; label: string }[] = [
  { id: "observation_mcq", label: "Pilihan Ganda (observation_mcq)" },
  { id: "observation_input", label: "Isian Teks/Angka (observation_input)" },
  { id: "photo_proof", label: "Bukti Foto (photo_proof)" },
  { id: "timed_micro_task", label: "Tugas Cepat Bertimer (timed_micro_task)" },
  { id: "call_your_shot", label: "Pilih Risiko Standar/Bold (call_your_shot)" },
  { id: "multi_step", label: "Tantangan 2 Langkah (multi_step)" },
];

const CLAIM_CARD_PRIMITIVES: { id: ClaimCardEffect["primitive"]; label: string }[] = [
  { id: "scout_challenge", label: "Intip Tantangan (scout_challenge)" },
  { id: "shield_claim", label: "Perisai Klaim (shield_claim)" },
  { id: "double_weight", label: "Bobot 2x (double_weight)" },
  { id: "swap_challenge", label: "Tukar Tantangan (swap_challenge)" },
  { id: "instant_lock", label: "Kunci Instan (instant_lock)" },
  { id: "sabotage_curse", label: "Kutukan Sabotase (sabotage_curse)" },
];

export function renderClaimStep3(
  pack: ClaimRulebookPack,
  state: ClaimStep3State,
  editable: boolean,
  status: string,
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
      ${editable && session ? `<button type="button" class="primary studio-save" data-action="save-draft">Simpan aturan sesi</button>` : ""}
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
      <label class="rb-field"><span>Min Pemain (1–6)</span><input id="ed-claim-minp" type="number" min="1" max="6" value="${pack.session.minPlayers}" ${dis}></label>
      <label class="rb-field"><span>Maks Pemain (1–6)</span><input id="ed-claim-maxp" type="number" min="1" max="6" value="${pack.session.maxPlayers}" ${dis}></label>
      <label class="rb-field"><span>Mode Tim</span>
        <select id="ed-claim-team" ${dis}>
          <option value="ffa" ${pack.session.teamMode === "ffa" ? "selected" : ""}>Free-for-All (FFA)</option>
          <option value="teams" ${pack.session.teamMode === "teams" ? "selected" : ""}>Tim (Teams)</option>
        </select>
      </label>
      <label class="rb-field"><span>Durasi Sesi (menit)</span><input id="ed-claim-duration" type="number" value="${Math.round(pack.session.durationMs / 60_000)}" ${dis}></label>
    </fieldset>
    <fieldset class="rb-grid-2 studio-field-group">
      <legend>Target dan penalti</legend>
      <label class="rb-field"><span>Target Kunci Solo</span><input id="ed-claim-solo-locks" type="number" value="${pack.session.soloTargets?.lockedLandmarks ?? 4}" ${dis}></label>
      <label class="rb-field"><span>Target Zona Solo</span><input id="ed-claim-solo-zones" type="number" value="${pack.session.soloTargets?.distinctZones ?? 2}" ${dis}></label>
      <label class="rb-field"><span>Kebijakan Gagal Multiplayer</span>
        <select id="ed-claim-fail-policy" ${dis}>
          <option value="cooldown_ms" ${pack.claiming.multiplayerFailPolicy === "cooldown_ms" ? "selected" : ""}>Jeda Cooldown</option>
          <option value="burned_for_player" ${pack.claiming.multiplayerFailPolicy === "burned_for_player" ? "selected" : ""}>Hangus untuk Pemain</option>
        </select>
      </label>
      <label class="rb-field"><span>Cooldown Gagal (menit)</span><input id="ed-claim-cooldown" type="number" min="0" max="30" value="${Math.round((pack.claiming.failCooldownMs ?? 300_000) / 60_000)}" ${dis}></label>
      <label class="rb-field"><span>Batas Kartu Taktis</span><input id="ed-claim-hand" type="number" min="1" max="4" value="${pack.tacticalDeck.maxHandSize}" ${dis}></label>
    </fieldset>
  </section>`;
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
  const estimates = items.flatMap(item => item.estimatedSeconds === undefined ? [] : [item.estimatedSeconds]);
  const compare = estimates.length > 1 && Math.max(...estimates) - Math.min(...estimates) > 20;

  return `<div data-testid="claim-challenges-panel">
    <label class="rb-field"><span>Target Tantangan</span>
      <select id="ed-chal-target">
        <option value="backup" ${isBackup ? "selected" : ""}>Backup Pool (${pack.challenges.backupPool.length} tantangan)</option>
        ${pack.geography.landmarks
          .map(
            (lm) =>
              `<option value="${escapeText(lm.id)}" ${state.challengeTarget === lm.id ? "selected" : ""}>${escapeText(lm.name)} (${(pack.challenges.landmarkChallenges[lm.id] ?? []).length})</option>`,
          )
          .join("")}
      </select>
    </label>

    <details class="rb-accordion">
      <summary>Varian tantangan (${items.length})</summary>
      ${compare ? '<p>Selisih perkiraan lebih dari 20 detik. Bandingkan usaha yang diperlukan sebelum menerbitkan.</p>' : ""}
      <ul class="rb-list">
        ${
          items.length === 0
            ? "<li>Belum ada tantangan pada target ini.</li>"
            : items
                .map(
                  (item, idx) => `<li>
                    <div><strong>${escapeText(item.title)}</strong> <span class="rb-badge">${escapeText(item.payload.primitive)}</span></div>
                    <small>${item.reviewed ? `Ditinjau ${escapeText(item.reviewedAt)}` : "Belum ditinjau"} · ${escapeText(item.verificationNotes)}</small>
                    ${item.estimatedSeconds ? `<small>Perkiraan ${item.estimatedSeconds} detik</small>` : ""}
                    <button type="button" class="secondary" data-c3-action="preview-challenge" data-index="${idx}">Pratinjau varian</button>
                    ${editable ? `<button type="button" class="secondary" data-c3-action="delete-challenge" data-index="${idx}">Hapus</button>` : ""}
                  </li>`,
                )
                .join("")
        }
      </ul>
    </details>

    ${
      editable
        ? `<div class="rb-card" data-testid="claim-challenge-composer">
            <h4>+ Tambah Tantangan Tersembunyi</h4>
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
              <label class="rb-field"><span>Primitif Tantangan</span>
                <select id="ed-chal-prim" ${dis}>
                  ${CHALLENGE_PRIMITIVES.map(
                    (p) => `<option value="${p.id}" ${prim === p.id ? "selected" : ""}>${p.label}</option>`,
                  ).join("")}
                </select>
              </label>
              <label class="rb-field"><span>Judul Tantangan</span><input id="ed-chal-title" placeholder="Mis. Mural Fasad M Bloc"></label>
            </div>

            ${
              prim === "observation_mcq"
                ? `<label class="rb-field"><span>Pertanyaan Pengamatan</span><input id="ed-chal-prompt" value="Apa warna dominan penanda utama lokasi ini?"></label>
                   <div class="rb-grid-2">
                     <label class="rb-field"><span>Opsi A</span><input id="ed-chal-opt-a" value="Hijau Tua"></label>
                     <label class="rb-field"><span>Opsi B</span><input id="ed-chal-opt-b" value="Merah Muda"></label>
                     <label class="rb-field"><span>Opsi C</span><input id="ed-chal-opt-c" value="Ungu Neon"></label>
                     <label class="rb-field"><span>Jawaban benar</span><select id="ed-chal-correct">
                       <option value="a">Opsi A</option><option value="b">Opsi B</option><option value="c">Opsi C</option>
                     </select></label>
                   </div>`
                : prim === "observation_input"
                  ? `<label class="rb-field"><span>Pertanyaan Isian</span><input id="ed-chal-prompt" value="Berapa jumlah tiang utama gerbang?"></label>
                     <div class="rb-grid-2">
                       <label class="rb-field"><span>Tipe Input</span>
                         <select id="ed-chal-inmode">
                           <option value="text">Teks</option>
                           <option value="number">Angka</option>
                         </select>
                       </label>
                       <label class="rb-field"><span>Jawaban Benar (koma u/ teks, atau angka)</span><input id="ed-chal-answer" value="jakarta, blok m"></label>
                     </div>`
                  : prim === "photo_proof"
                    ? `<label class="rb-field"><span>Instruksi Foto</span><input id="ed-chal-prompt" value="Ambil foto papan nama publik tanpa tiket masuk."></label>
                       <div class="rb-grid-2">
                         <label class="rb-field"><span>Mode Verifikasi</span>
                           <select id="ed-chal-pmode">
                             <option value="rival_or_timeout">Persetujuan Lawan / Timeout</option>
                             <option value="honor_submit">Honor Submit</option>
                           </select>
                         </label>
                         <label class="rb-field"><span>Auto-Approve (menit, maks 5)</span><input id="ed-chal-mins" type="number" min="1" max="5" value="2"></label>
                       </div>`
                    : prim === "timed_micro_task"
                      ? `<label class="rb-field"><span>Instruksi Tugas Cepat</span><input id="ed-chal-prompt" value="Kirim foto penanda ruang publik dalam 90 detik."></label>
                         <div class="rb-grid-2">
                           <label class="rb-field"><span>Batas Waktu (detik)</span><input id="ed-chal-secs" type="number" min="30" max="600" value="90"></label>
                           <label class="rb-field"><span>Tipe Tugas</span>
                             <select id="ed-chal-ttype">
                               <option value="photo_proof">Foto Bukti</option>
                               <option value="observation_input">Isian Cepat</option>
                             </select>
                           </label>
                           <label class="rb-field"><span>Jawaban isian cepat (pisahkan dengan koma)</span><input id="ed-chal-timed-answer" placeholder="pintu utara, utara"></label>
                         </div>`
                      : prim === "call_your_shot"
                        ? `<div class="rb-grid-2">
                            <label class="rb-field"><span>Tema Tantangan</span><input id="ed-chal-theme" value="Detail arsitektur ruang publik"></label>
                            <label class="rb-field"><span>Soal Standar (Foto)</span><input id="ed-chal-std" value="Foto papan nama depan lokasi."></label>
                            <label class="rb-field"><span>Soal Bold (Isian Teks)</span><input id="ed-chal-bold" value="Sebutkan kata pertama pada plakat taman."></label>
                            <label class="rb-field"><span>Jawaban Bold (koma)</span><input id="ed-chal-answer" value="taman, jakarta"></label>
                          </div>`
                        : `<div class="rb-grid-2">
                            <label class="rb-field"><span>Langkah 1 (Foto)</span><input id="ed-chal-std" value="Foto gerbang masuk publik."></label>
                            <label class="rb-field"><span>Langkah 2 (Isian Teks)</span><input id="ed-chal-bold" value="Tulis nama jalan utama di depan gerbang."></label>
                            <label class="rb-field"><span>Jawaban Langkah 2</span><input id="ed-chal-answer" value="sudirman, panglima polim"></label>
                          </div>`
            }
            <label class="rb-field"><span>Sumber atau kriteria bukti</span><textarea id="ed-chal-notes" rows="2" required placeholder="Catat sumber fakta atau ciri yang harus terlihat dalam bukti."></textarea></label>
            <label class="rb-field"><span>Petunjuk setelah check-in (opsional)</span><textarea id="ed-chal-hint" rows="2"></textarea></label>
            <label class="rb-field"><span>Penjelasan setelah berhasil (opsional)</span><textarea id="ed-chal-explanation" rows="2"></textarea></label>
            <label class="rb-field"><span>Perkiraan pengerjaan (detik)</span><input id="ed-chal-estimate" type="number" min="1" step="1"></label>
            <label><input id="ed-chal-reviewed" type="checkbox" required> Saya sudah meninjau tugas, kunci jawaban atau kriteria bukti, dan sumbernya.</label>
            <p class="rb-errors" role="alert" data-claim-composer-error hidden></p>
            <button type="button" class="primary" data-c3-action="add-challenge">+ Simpan Tantangan ke Target</button>
          </div>`
        : ""
    }
  </div>`;
}

function renderClaimDeck(
  pack: ClaimRulebookPack,
  state: ClaimStep3State,
  dis: string,
  editable: boolean,
): string {
  const prim = state.cardPrimitive;
  return `<section class="studio-rule-panel" data-testid="claim-deck-panel" aria-label="Kartu">
    <h4>Kartu</h4>
    <div class="rb-grid-2">
      <label class="rb-field"><span>Status Dek Taktis</span>
        <select id="ed-cdeck-enabled" ${dis}>
          <option value="true" ${pack.tacticalDeck.enabled ? "selected" : ""}>Aktif</option>
          <option value="false" ${!pack.tacticalDeck.enabled ? "selected" : ""}>Nonaktif</option>
        </select>
      </label>
      <label class="rb-field"><span>Maks Kutukan per Target</span><input id="ed-cdeck-maxc" type="number" min="1" max="3" value="${pack.tacticalDeck.maxActiveCursesPerTarget}" ${dis}></label>
    </div>
    ${editable ? `<button type="button" class="secondary" data-c3-action="save-deck-cfg">Simpan Pengaturan Dek</button>` : ""}

    <details class="rb-accordion">
      <summary>Daftar Kartu Taktis (${pack.tacticalDeck.cards.length} jenis)</summary>
      <div class="st-card-stack">
        ${pack.tacticalDeck.cards
          .map((card, idx) =>
            renderClaimCardTile(
              card,
              editable
                ? `<button type="button" class="secondary" data-c3-action="delete-claim-card" data-index="${idx}">Hapus</button>`
                : undefined,
            ),
          )
          .join("")}
      </div>
    </details>

    ${
      editable
        ? `<div class="rb-card" data-testid="claim-card-composer">
            <h4>+ Tambah Kartu Taktis</h4>
            <div data-testid="live-card-preview">${renderClaimCardTile(previewClaimCardFromState(state))}</div>
            <div class="rb-grid-2">
              <label class="rb-field"><span>Primitif Kartu</span>
                <select id="ed-ccard-prim">
                  ${CLAIM_CARD_PRIMITIVES.map(
                    (p) => `<option value="${p.id}" ${prim === p.id ? "selected" : ""}>${p.label}</option>`,
                  ).join("")}
                </select>
              </label>
              <label class="rb-field"><span>Salinan</span><input id="ed-ccard-copies" type="number" min="1" max="8" value="1"></label>
              <label class="rb-field"><span>Judul Kartu</span><input id="ed-ccard-title" placeholder="Mis. Sabotase Lampu Merah"></label>
              <label class="rb-field"><span>Deskripsi</span><input id="ed-ccard-desc" value="Kartu taktis kustom kreator."></label>
            </div>
            ${
              prim === "shield_claim"
                ? `<label class="rb-field"><span>Durasi Perisai (menit)</span><input id="ed-ccard-mins" type="number" min="1" max="30" value="10"></label>`
                : prim === "sabotage_curse"
                  ? `<div class="rb-grid-2">
                      <label class="rb-field"><span>Blokir</span>
                        <select id="ed-ccard-blocker">
                          <option value="block_steals">Blokir Rebut (block_steals)</option>
                          <option value="block_claims">Blokir Klaim (block_claims)</option>
                          <option value="block_both">Blokir Keduanya (block_both)</option>
                        </select>
                      </label>
                      <label class="rb-field"><span>Durasi Timer Hapus (menit, maks 10)</span><input id="ed-ccard-mins" type="number" min="1" max="10" value="5"></label>
                    </div>`
                  : ""
            }
            <button type="button" class="primary" data-c3-action="add-claim-card">+ Tambahkan Kartu Taktis</button>
          </div>`
        : ""
    }
  </section>`;
}

export function buildClaimChallengeFromForm(root: HTMLElement, state: ClaimStep3State): ClaimChallengeItem | null {
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
    id: `chal-${prim}-${Date.now().toString(36)}`,
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
        ? `Hapus: ${Math.round(ef.clearCondition.durationMs / 60_000)}m`
        : `Hapus: ${ef.clearCondition.type}`;
    return [
      { label: `Blokir: ${ef.blockerType}`, tone: "danger" },
      { label: clearLabel, tone: "warn" },
    ];
  }
  if (ef.primitive === "double_weight") return [{ label: "Bobot 2x", tone: "ok" }];
  if (ef.primitive === "instant_lock") return [{ label: "Kunci Instan", tone: "ok" }];
  return [{ label: ef.primitive }];
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

function previewClaimCardFromState(state: ClaimStep3State): ClaimCardDefinition {
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
    id: "preview",
    copies: 1,
    title: "Pratinjau Kartu Taktis",
    description: meta.label,
    effect,
  };
}

export function renderClaimLiveCardPreview(root: HTMLElement, state: ClaimStep3State): string {
  const built = buildClaimCardFromForm(root, state, "Pratinjau Kartu Taktis");
  return renderClaimCardTile(built ?? previewClaimCardFromState(state));
}

export function buildClaimCardFromForm(
  root: HTMLElement,
  state: ClaimStep3State,
  fallbackTitle?: string,
): ClaimCardDefinition | null {
  const title = root.querySelector<HTMLInputElement>("#ed-ccard-title")?.value.trim() || fallbackTitle;
  if (!title) return null;
  const description = root.querySelector<HTMLInputElement>("#ed-ccard-desc")?.value.trim() || "Kartu taktis kustom.";
  const copies = Math.max(1, Number(root.querySelector<HTMLInputElement>("#ed-ccard-copies")?.value ?? 1));
  const prim = state.cardPrimitive;
  let effect: ClaimCardEffect;
  if (prim === "scout_challenge") effect = { primitive: "scout_challenge" };
  else if (prim === "double_weight") effect = { primitive: "double_weight" };
  else if (prim === "swap_challenge") effect = { primitive: "swap_challenge" };
  else if (prim === "instant_lock") effect = { primitive: "instant_lock" };
  else if (prim === "shield_claim") {
    const mins = Math.max(1, Number(root.querySelector<HTMLInputElement>("#ed-ccard-mins")?.value ?? 10));
    effect = { primitive: "shield_claim", durationMs: mins * 60_000 };
  } else {
    const mins = Math.max(1, Math.min(10, Number(root.querySelector<HTMLInputElement>("#ed-ccard-mins")?.value ?? 5)));
    const blockerType = (root.querySelector<HTMLSelectElement>("#ed-ccard-blocker")?.value ?? "block_steals") as
      | "block_steals"
      | "block_claims"
      | "block_both";
    effect = {
      primitive: "sabotage_curse",
      blockerType,
      clearCondition: { type: "timer", durationMs: mins * 60_000 },
    };
  }
  return {
    id: `ccard-${prim}-${Date.now().toString(36)}`,
    copies,
    title,
    description,
    effect,
  };
}
