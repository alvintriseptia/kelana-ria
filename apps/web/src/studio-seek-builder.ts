import type {
  CurseBlockerType,
  CurseCastingCost,
  CurseClearCondition,
  CurseEffectModifier,
  HideSeekCardCategory,
  HideSeekCardDefinition,
  HideSeekCardEffect,
  HideSeekQuestionFamily,
  HideSeekRulebookPack,
} from "@kelana-ria/contracts";
import { escapeText } from "./solo-view";
import {
  questionFamilyTileMeta,
  renderGameCardPreviewHtml,
  type CardPreviewChip,
  type CardPreviewVariant,
} from "./studio-assets";

export type SeekStep3SubTab = "timers" | "book" | "deck";

export type SeekQuestionDraft = {
  id: string;
  label: string;
  radiusMeters?: number;
  minTravelMeters?: number;
  attributeKey?: string;
  poiCategory?: string;
  prompt?: string;
};

export type SeekStep3State = {
  subTab: SeekStep3SubTab;
  family: HideSeekQuestionFamily;
  cardPrimitive: HideSeekCardEffect["primitive"];
  curseClearType: CurseClearCondition["type"];
  editingQuestionIndex: number | null;
  editingQuestionDraft: SeekQuestionDraft | null;
  editingCardIndex: number | null;
  editingCardDraft: HideSeekCardDefinition | null;
};

export const SEEK_CARD_MIN_COPIES = 1;
export const SEEK_CARD_MAX_COPIES = 10;

const FAMILY_LIST: { id: HideSeekQuestionFamily; label: string }[] = [
  { id: "radar", label: "Radar" },
  { id: "thermometer", label: "Termometer" },
  { id: "matching", label: "Cocokkan" },
  { id: "measuring", label: "Bandingkan" },
  { id: "tentacles", label: "Tempat Terdekat" },
  { id: "photo", label: "Foto" },
];

const CARD_PRIMITIVES: { id: HideSeekCardEffect["primitive"]; label: string; cat: HideSeekCardCategory }[] = [
  { id: "time_bonus", label: "Bonus Waktu (+menit)", cat: "time_bonus" },
  { id: "veto", label: "Veto (Batalkan Pertanyaan)", cat: "powerup" },
  { id: "randomize", label: "Acak Pertanyaan", cat: "powerup" },
  { id: "discard_draw", label: "Buang & Ambil Kartu", cat: "powerup" },
  { id: "expand_hand", label: "Tambah Slot Kartu (+1)", cat: "powerup" },
  { id: "duplicate", label: "Duplikasi Kartu", cat: "powerup" },
  { id: "time_trap", label: "Perangkap Waktu", cat: "powerup" },
  { id: "move_zone", label: "Pindah Zona", cat: "powerup" },
  { id: "curse", label: "Kutukan (Curse)", cat: "curse" },
];

export function renderSeekStep3(
  pack: HideSeekRulebookPack,
  state: SeekStep3State,
  editable: boolean,
  status: string,
  saving = false,
): string {
  const dis = editable ? "" : "disabled";
  const session = state.subTab === "timers";

  return `<div class="rb-card" data-studio-slot="rules-builder">
    <h3>Aturan</h3>
    <div class="studio-section-tabs" role="group" aria-label="Bagian aturan">
      <button type="button" data-s3-tab="timers" aria-pressed="${state.subTab === "timers"}">Sesi &amp; Waktu</button>
      <button type="button" data-s3-tab="book" aria-pressed="${state.subTab === "book"}">Pertanyaan</button>
      <button type="button" data-s3-tab="deck" aria-pressed="${state.subTab === "deck"}">Kartu</button>
    </div>

    ${
      state.subTab === "timers"
        ? renderSeekTimers(pack, dis)
        : state.subTab === "book"
          ? renderSeekBook(pack, state, dis, editable)
          : renderSeekDeck(pack, state, dis, editable)
    }

    ${status ? `<p class="studio-save-feedback" role="status">${escapeText(status)}</p>` : ""}
    <div class="rb-sticky-footer studio-step-actions">
      ${editable && session ? `<button type="button" class="primary studio-save" data-action="save-draft" ${saving ? "disabled" : ""}>Simpan aturan sesi</button>` : ""}
      <button type="button" class="studio-tool" data-step="2">← Peta</button>
      <button type="button" class="studio-tool" data-step="4">Validasi →</button>
    </div>
  </div>`;
}

function renderSeekTimers(pack: HideSeekRulebookPack, dis: string): string {
  return `<section class="studio-rule-panel" data-testid="seek-timers-panel" aria-label="Sesi &amp; Waktu">
    <h4>Sesi &amp; Waktu</h4>
    <fieldset class="rb-grid-2 studio-field-group">
      <legend>Pemain dan area</legend>
      <label class="rb-field"><span>Min Pemain (2–6)</span><input id="ed-seek-minp" type="number" min="2" max="6" value="${pack.session.minPlayers}" ${dis}></label>
      <label class="rb-field"><span>Maks Pemain (2–6)</span><input id="ed-seek-maxp" type="number" min="2" max="6" value="${pack.session.maxPlayers}" ${dis}></label>
      <label class="rb-field"><span>Radius Zona Sembunyi (m)</span><input id="ed-zone" type="number" value="${pack.geography.hidingZoneRadiusMeters}" ${dis}></label>
    </fieldset>
    <fieldset class="rb-grid-2 studio-field-group">
      <legend>Waktu dan giliran</legend>
      <label class="rb-field"><span>Head Start (menit)</span><input id="ed-head" type="number" value="${Math.round(pack.timers.headStartMs / 60_000)}" ${dis}></label>
      <label class="rb-field"><span>Batas Cari (menit)</span><input id="ed-search" type="number" value="${Math.round(pack.timers.searchLimitMs / 60_000)}" ${dis}></label>
      <label class="rb-field"><span>Batas Regroup (menit)</span><input id="ed-regroup" type="number" value="${Math.round(pack.timers.regroupLimitMs / 60_000)}" ${dis}></label>
      <label class="rb-field"><span>Kebijakan Regroup</span>
        <select id="ed-regroup-policy" ${dis}>
          <option value="previous_hiding_station" ${pack.session.regroupPolicy === "previous_hiding_station" ? "selected" : ""}>Stasiun Sembunyi Terakhir</option>
          <option value="shared_start" ${pack.session.regroupPolicy === "shared_start" ? "selected" : ""}>Titik Awal Bersama</option>
          <option value="anywhere_ready" ${pack.session.regroupPolicy === "anywhere_ready" ? "selected" : ""}>Siap di Mana Saja</option>
        </select>
      </label>
    </fieldset>
    <fieldset class="rb-grid-2 studio-field-group">
      <legend>Petunjuk dan kartu</legend>
      <label class="rb-field"><span>Mode Biaya Ulang Petunjuk</span>
        <select id="ed-repeat-mode" ${dis}>
          <option value="escalating_multiplier" ${pack.investigationBook.repeatCostMode === "escalating_multiplier" ? "selected" : ""}>Berlipat (1x, 2x, 3x)</option>
          <option value="single_use_locked" ${pack.investigationBook.repeatCostMode === "single_use_locked" ? "selected" : ""}>Sekali Pakai per Giliran</option>
          <option value="flat" ${pack.investigationBook.repeatCostMode === "flat" ? "selected" : ""}>Tetap (1x)</option>
        </select>
      </label>
      <label class="rb-field"><span>Batas Kartu di Tangan</span><input id="ed-hand" type="number" min="3" max="8" value="${pack.deck.baseHandLimit}" ${dis}></label>
      <label class="rb-field"><span>Maks. Kutukan Pemblokir Aktif</span><input id="ed-max-curses" type="number" min="1" max="2" value="${pack.deck.maxActiveBlockingCurses}" ${dis}></label>
    </fieldset>
  </section>`;
}

function renderSeekBook(
  pack: HideSeekRulebookPack,
  state: SeekStep3State,
  dis: string,
  editable: boolean,
): string {
  const family = state.family;
  const cfg = pack.investigationBook.families[family];
  const items = cfg?.items ?? [];
  const familyLabel = FAMILY_LIST.find((f) => f.id === family)?.label ?? family;
  const editing = state.editingQuestionIndex !== null ? state.editingQuestionDraft : null;

  const labelVal = editing?.label ?? "";
  const radarNum = editing?.radiusMeters ?? 750;
  const thermoNum = editing?.minTravelMeters ?? 500;
  const matchingAttr = editing?.attributeKey ?? "kecamatan";
  const measuringCat = editing?.poiCategory ?? "taman";
  const tentaclesNum = editing?.radiusMeters ?? 1500;
  const tentaclesCat = editing?.poiCategory ?? "taman";
  const photoPrompt = editing?.prompt ?? "Foto papan nama jalan terdekat.";

  return `<section class="studio-rule-panel" data-testid="seek-book-panel" aria-label="Pertanyaan">
    <h4>Pertanyaan</h4>
    <div class="st-visual-grid" role="group" aria-label="Pilih kategori pertanyaan">
      ${FAMILY_LIST.map((f) => {
        const famCfg = pack.investigationBook.families[f.id];
        const meta = questionFamilyTileMeta(f.id);
        const count = famCfg?.items.length ?? 0;
        const dk = `${famCfg?.drawCount ?? 2}/${famCfg?.keepCount ?? 1}`;
        return `<button type="button" class="st-visual-tile" data-s3-family="${f.id}" aria-pressed="${family === f.id}">
          ${meta.svg}
          <strong>${escapeText(f.label)}</strong>
          <span class="st-tile-meta">Ambil ${dk} · ${count} soal</span>
        </button>`;
      }).join("")}
    </div>
    <div class="rb-grid-2">
      <label class="rb-field"><span>Status Kategori (${escapeText(familyLabel)})</span>
        <select id="ed-fam-enabled" ${dis}>
          <option value="true" ${cfg?.enabled ? "selected" : ""}>Aktif</option>
          <option value="false" ${!cfg?.enabled ? "selected" : ""}>Nonaktif</option>
        </select>
      </label>
      <label class="rb-field"><span>Ambil Kartu</span><input id="ed-fam-draw" type="number" min="1" max="5" value="${cfg?.drawCount ?? 2}" ${dis}></label>
      <label class="rb-field"><span>Simpan Kartu</span><input id="ed-fam-keep" type="number" min="1" max="5" value="${cfg?.keepCount ?? 1}" ${dis}></label>
    </div>
    ${editable ? `<button type="button" class="secondary" data-s3-action="save-family-cfg">Simpan Pengaturan Kategori</button>` : ""}

    <details class="rb-accordion" data-studio-accordion="seek-book">
      <summary>Daftar Pertanyaan ${escapeText(familyLabel)} (${items.length})</summary>
      <ul class="rb-list">
        ${
          items.length === 0
            ? "<li>Belum ada pertanyaan di kategori ini.</li>"
            : items
                .map(
                  (item, idx) => `<li${state.editingQuestionIndex === idx ? ' class="st-editing-row"' : ""}>
                    <div><strong>${escapeText(item.label)}</strong></div>
                    ${
                      editable
                        ? `<div class="rb-actions">
                            <button type="button" class="secondary" data-s3-action="edit-book-item" data-index="${idx}">Sunting</button>
                            <button type="button" class="secondary" data-s3-action="delete-book-item" data-index="${idx}">Hapus</button>
                          </div>`
                        : ""
                    }
                  </li>`,
                )
                .join("")
        }
      </ul>
    </details>

    ${
      editable
        ? `<div class="rb-card" data-testid="seek-question-composer">
            <h4>${editing ? `Sunting Pertanyaan ${escapeText(familyLabel)}` : `+ Tambah Pertanyaan ${escapeText(familyLabel)}`}</h4>
            <div class="rb-grid-2">
              <label class="rb-field"><span>Nama Pertanyaan</span><input id="ed-item-label" placeholder="Mis. Radar 750 m" value="${escapeText(labelVal)}"></label>
              ${
                family === "radar"
                  ? `<label class="rb-field"><span>Radius (meter)</span><input id="ed-item-num" type="number" value="${radarNum}" min="100"></label>`
                  : family === "thermometer"
                    ? `<label class="rb-field"><span>Jarak Tempuh Min (meter)</span><input id="ed-item-num" type="number" value="${thermoNum}" min="100"></label>`
                    : family === "matching"
                      ? `<label class="rb-field"><span>Atribut Stasiun</span><input id="ed-item-extra" value="${escapeText(matchingAttr)}"></label>`
                      : family === "measuring"
                        ? `<label class="rb-field"><span>Kategori Lokasi</span><input id="ed-item-extra" value="${escapeText(measuringCat)}"></label>`
                        : family === "tentacles"
                          ? `<label class="rb-field"><span>Radius (meter)</span><input id="ed-item-num" type="number" value="${tentaclesNum}" min="200"></label>
                             <label class="rb-field"><span>Kategori Lokasi</span><input id="ed-item-extra" value="${escapeText(tentaclesCat)}"></label>`
                          : `<label class="rb-field"><span>Instruksi Foto</span><input id="ed-item-extra" value="${escapeText(photoPrompt)}"></label>`
              }
            </div>
            ${
              editing
                ? `<div class="rb-actions">
                    <button type="button" class="primary" data-s3-action="save-book-item">Simpan Perubahan</button>
                    <button type="button" class="secondary" data-s3-action="cancel-edit-book-item">Batal</button>
                  </div>`
                : `<button type="button" class="primary" data-s3-action="add-book-item">+ Tambah Pertanyaan</button>`
            }
          </div>`
        : ""
    }
  </section>`;
}

function seekCardEditorValues(state: SeekStep3State) {
  const editing = state.editingCardIndex !== null ? state.editingCardDraft : null;
  const prim = state.cardPrimitive;
  const sameEffect = editing && editing.effect.primitive === prim ? editing.effect : null;

  let val = prim === "expand_hand" ? 1 : 5;
  let curseCost: "none" | "discard_cards" | "seeker_min_distance" = "none";
  let curseBlocker: CurseBlockerType = "block_questions";
  let curseBuyout = 5;
  let curseDetail = "Kirim foto ruang publik terdekat.";
  let curseMins = 3;

  if (sameEffect) {
    if (sameEffect.primitive === "time_bonus") val = sameEffect.minutes ?? sameEffect.percentOfRawTime ?? 5;
    else if (sameEffect.primitive === "time_trap") val = sameEffect.bonusMinutes;
    else if (sameEffect.primitive === "expand_hand") val = sameEffect.extraSlots;
    else if (sameEffect.primitive === "curse") {
      const firstCost = sameEffect.curse.castingCosts[0];
      if (firstCost?.type === "discard_cards") curseCost = "discard_cards";
      else if (firstCost?.type === "seeker_min_distance") curseCost = "seeker_min_distance";
      else curseCost = "none";

      curseBlocker = sameEffect.curse.blockerType;
      const buyoutMod = (sameEffect.curse.effectModifiers ?? []).find((m) => m.type === "skip_penalty_minutes");
      curseBuyout = buyoutMod && buyoutMod.type === "skip_penalty_minutes" ? buyoutMod.penaltyMinutes : 0;

      const clear = sameEffect.curse.clearCondition;
      if (clear.type === "timer") {
        curseMins = Math.max(1, Math.min(10, Math.round(clear.durationMs / 60_000)));
      } else if (clear.type === "next_n_questions") {
        curseMins = Math.max(1, Math.min(3, clear.count));
      } else if (clear.type === "gps_detour") {
        curseDetail = clear.poiCategory;
        curseMins = Math.max(1, Math.min(10, Math.round((clear.fallbackTimerMs ?? 600_000) / 60_000)));
      } else if (clear.type === "honor_task") {
        curseDetail = clear.instruction;
        curseMins = Math.max(1, Math.min(10, Math.round((clear.minDurationMs ?? 60_000) / 60_000)));
      } else if (clear.type === "photo_challenge") {
        curseDetail = clear.prompt;
        curseMins = Math.max(1, Math.min(5, Math.round(clear.autoApproveMs / 60_000)));
      }
    }
  }

  return {
    editing,
    title: editing?.title ?? "",
    description: editing?.description ?? "Kartu buatan kreator.",
    copies: editing?.copies ?? 1,
    val,
    curseCost,
    curseBlocker,
    curseBuyout,
    curseDetail,
    curseMins,
  };
}

function renderSeekDeck(
  pack: HideSeekRulebookPack,
  state: SeekStep3State,
  dis: string,
  editable: boolean,
): string {
  const prim = state.cardPrimitive;
  const vals = seekCardEditorValues(state);
  const editing = vals.editing;
  const initialPreview =
    editing && editing.effect.primitive === prim ? editing : previewSeekCardFromState(state, editing);

  return `<section class="studio-rule-panel" data-testid="seek-deck-panel" aria-label="Kartu">
    <h4>Kartu</h4>
    <p><small>Total kartu: <strong>${pack.deck.cards.reduce((s, c) => s + c.copies, 0)}</strong> · Batas di tangan: ${pack.deck.baseHandLimit} · Maks. kutukan pemblokir aktif: ${pack.deck.maxActiveBlockingCurses}</small></p>
    <details class="rb-accordion" data-studio-accordion="seek-deck">
      <summary>Daftar Kartu di Dek (${pack.deck.cards.length} jenis)</summary>
      <div class="st-card-stack">
        ${pack.deck.cards
          .map((card, idx) =>
            renderSeekCardTile(
              card,
              editable
                ? `<div class="st-copy-stepper" role="group" aria-label="Jumlah salinan ${escapeText(card.title)}">
                     <button type="button" class="secondary st-step-btn" data-s3-action="step-seek-card-copies" data-index="${idx}" data-delta="-1" aria-label="Kurangi salinan ${escapeText(card.title)}" ${card.copies <= SEEK_CARD_MIN_COPIES ? "disabled" : ""}>−</button>
                     <span class="st-step-count" data-testid="seek-card-copies-${idx}">${card.copies}×</span>
                     <button type="button" class="secondary st-step-btn" data-s3-action="step-seek-card-copies" data-index="${idx}" data-delta="1" aria-label="Tambah salinan ${escapeText(card.title)}" ${card.copies >= SEEK_CARD_MAX_COPIES ? "disabled" : ""}>+</button>
                   </div>
                   <button type="button" class="secondary" data-s3-action="edit-seek-card" data-index="${idx}">Sunting</button>
                   <button type="button" class="secondary" data-s3-action="dup-seek-card" data-index="${idx}">Duplikat</button>
                   <button type="button" class="secondary" data-s3-action="delete-seek-card" data-index="${idx}">Hapus</button>`
                : undefined,
            ),
          )
          .join("")}
      </div>
    </details>

    ${
      editable
        ? `<div class="rb-card" data-testid="seek-card-composer">
            <h4>${editing ? "Sunting Kartu" : "+ Buat Kartu Baru"}</h4>
            <div data-testid="live-card-preview">${renderSeekCardTile(initialPreview)}</div>
            <div class="rb-grid-2">
              <label class="rb-field"><span>Jenis Kartu</span>
                <select id="ed-card-prim" ${dis}>
                  ${CARD_PRIMITIVES.map(
                    (p) => `<option value="${p.id}" ${prim === p.id ? "selected" : ""}>${p.label}</option>`,
                  ).join("")}
                </select>
              </label>
              <label class="rb-field"><span>Jumlah Salinan</span><input id="ed-card-copies" type="number" min="${SEEK_CARD_MIN_COPIES}" max="${SEEK_CARD_MAX_COPIES}" value="${vals.copies}"></label>
              <label class="rb-field"><span>Judul Kartu</span><input id="ed-card-title" placeholder="Mis. Kutukan Kopi Senopati" value="${escapeText(vals.title)}"></label>
              <label class="rb-field"><span>Deskripsi Singkat</span><input id="ed-card-desc" value="${escapeText(vals.description)}"></label>
            </div>

            ${
              prim === "time_bonus"
                ? `<label class="rb-field"><span>Bonus Menit</span><input id="ed-card-val" type="number" min="1" max="30" value="${vals.val}"></label>`
                : prim === "time_trap"
                  ? `<label class="rb-field"><span>Bonus Perangkap (menit)</span><input id="ed-card-val" type="number" min="1" max="15" value="${vals.val}"></label>`
                  : prim === "expand_hand"
                    ? `<label class="rb-field"><span>Slot Tambahan</span><input id="ed-card-val" type="number" min="1" max="2" value="${vals.val}"></label>`
                    : prim === "curse"
                      ? `<div class="rb-grid-2">
                          <label class="rb-field"><span>Syarat Main</span>
                            <select id="ed-curse-cost">
                              <option value="none" ${vals.curseCost === "none" ? "selected" : ""}>Gratis</option>
                              <option value="discard_cards" ${vals.curseCost === "discard_cards" ? "selected" : ""}>Buang 1 Kartu</option>
                              <option value="seeker_min_distance" ${vals.curseCost === "seeker_min_distance" ? "selected" : ""}>Pencari min. 500 m</option>
                            </select>
                          </label>
                          <label class="rb-field"><span>Efek Blokir</span>
                            <select id="ed-curse-blocker">
                              <option value="block_questions" ${vals.curseBlocker === "block_questions" ? "selected" : ""}>Blokir Pertanyaan</option>
                              <option value="block_transit" ${vals.curseBlocker === "block_transit" ? "selected" : ""}>Blokir Transit</option>
                              <option value="none" ${vals.curseBlocker === "none" ? "selected" : ""}>Tanpa Blokir</option>
                            </select>
                          </label>
                          <label class="rb-field"><span>Cara Lepas Kutukan</span>
                            <select id="ed-curse-clear">
                              <option value="photo_challenge" ${state.curseClearType === "photo_challenge" ? "selected" : ""}>Bukti Foto</option>
                              <option value="timer" ${state.curseClearType === "timer" ? "selected" : ""}>Tunggu Timer</option>
                              <option value="next_n_questions" ${state.curseClearType === "next_n_questions" ? "selected" : ""}>Jawab Beberapa Pertanyaan</option>
                              <option value="gps_detour" ${state.curseClearType === "gps_detour" ? "selected" : ""}>Check-in Lokasi (GPS)</option>
                              <option value="honor_task" ${state.curseClearType === "honor_task" ? "selected" : ""}>Tugas Langsung</option>
                            </select>
                          </label>
                          <label class="rb-field"><span>Penalti Lewati (menit, 0 = tidak bisa dilewati)</span><input id="ed-curse-buyout" type="number" min="0" max="20" value="${vals.curseBuyout}"></label>
                          <label class="rb-field"><span>Instruksi / Kategori Lokasi</span><input id="ed-curse-detail" value="${escapeText(vals.curseDetail)}"></label>
                          <label class="rb-field"><span>Durasi / Setuju Otomatis (menit, maks. 5)</span><input id="ed-curse-mins" type="number" min="1" max="10" value="${vals.curseMins}"></label>
                        </div>`
                      : ""
            }
            ${
              editing
                ? `<div class="rb-actions">
                    <button type="button" class="primary" data-s3-action="save-seek-card">Simpan Perubahan</button>
                    <button type="button" class="secondary" data-s3-action="cancel-edit-seek-card">Batal</button>
                  </div>`
                : `<button type="button" class="primary" data-s3-action="add-seek-card">+ Tambahkan Kartu ke Dek</button>`
            }
          </div>`
        : ""
    }
  </section>`;
}

const SEEK_CLEAR_LABELS: Record<string, string> = {
  timer: "Tunggu Timer",
  next_n_questions: "Jawab Pertanyaan",
  gps_detour: "Check-in Lokasi",
  photo_challenge: "Bukti Foto",
  honor_task: "Tugas Langsung",
};

const SEEK_CARD_LABELS: Record<string, string> = {
  veto: "Veto",
  randomize: "Acak",
  discard_draw: "Tukar Kartu",
  duplicate: "Duplikasi",
  move_zone: "Pindah Zona",
};

function seekCardChips(card: HideSeekCardDefinition): CardPreviewChip[] {
  const ef = card.effect;
  if (ef.primitive === "time_bonus") return [{ label: `+${ef.minutes} menit`, tone: "ok" }];
  if (ef.primitive === "time_trap") return [{ label: `Perangkap +${ef.bonusMinutes} mnt`, tone: "warn" }];
  if (ef.primitive === "expand_hand") return [{ label: `+${ef.extraSlots} Slot`, tone: "ok" }];
  if (ef.primitive !== "curse") return [{ label: SEEK_CARD_LABELS[ef.primitive] ?? ef.primitive }];
  const cost = ef.curse.castingCosts[0];
  const costLabel =
    cost?.type === "discard_cards"
      ? `Syarat: Buang ${cost.count}`
      : cost?.type === "seeker_min_distance"
        ? `Min. ${cost.meters} m`
        : "Gratis";
  const blockerLabel =
    ef.curse.blockerType === "block_questions"
      ? "Blokir Tanya"
      : ef.curse.blockerType === "block_transit"
        ? "Blokir Transit"
        : "Tanpa Blokir";
  const clearLabel = `Lepas: ${SEEK_CLEAR_LABELS[ef.curse.clearCondition.type] ?? ef.curse.clearCondition.type}`;
  const mod = (ef.curse.effectModifiers ?? []).find((m) => m.type === "skip_penalty_minutes");
  const chips: CardPreviewChip[] = [
    { label: costLabel },
    { label: blockerLabel, tone: ef.curse.blockerType === "none" ? "neutral" : "danger" },
    { label: clearLabel, tone: "warn" },
  ];
  if (mod && mod.type === "skip_penalty_minutes") {
    chips.push({ label: `Lewati +${mod.penaltyMinutes} mnt` });
  }
  return chips;
}

function renderSeekCardTile(card: HideSeekCardDefinition, actionsHtml?: string): string {
  const variant: CardPreviewVariant =
    card.category === "time_bonus" ? "time_bonus" : card.category === "curse" ? "curse" : "powerup";
  return renderGameCardPreviewHtml({
    variant,
    title: card.title,
    subtitle: card.description,
    copies: card.copies,
    chips: seekCardChips(card),
    actionsHtml,
  });
}

function previewSeekCardFromState(state: SeekStep3State, editing?: HideSeekCardDefinition | null): HideSeekCardDefinition {
  const meta = CARD_PRIMITIVES.find((p) => p.id === state.cardPrimitive) ?? CARD_PRIMITIVES[0];
  const effect: HideSeekCardEffect =
    state.cardPrimitive === "curse"
      ? {
          primitive: "curse",
          curse: {
            castingCosts: [{ type: "none" }],
            blockerType: "block_questions",
            effectModifiers: [{ type: "skip_penalty_minutes", penaltyMinutes: 5 }],
            clearCondition: {
              type: "photo_challenge",
              prompt: "Kirim foto ruang publik terdekat.",
              approvalMode: "opponent_or_timeout",
              autoApproveMs: 180_000,
            },
          },
        }
      : state.cardPrimitive === "time_bonus"
        ? { primitive: "time_bonus", minutes: 5 }
        : state.cardPrimitive === "time_trap"
          ? { primitive: "time_trap", bonusMinutes: 5 }
          : state.cardPrimitive === "expand_hand"
            ? { primitive: "expand_hand", extraSlots: 1 }
            : state.cardPrimitive === "discard_draw"
              ? { primitive: "discard_draw", discardCount: 1, drawCount: 2, keepCount: 1 }
              : state.cardPrimitive === "move_zone"
                ? { primitive: "move_zone", travelWindowMs: 600_000, revealOldStation: true, discardHand: true }
                : { primitive: state.cardPrimitive };
  return {
    id: editing?.id ?? "preview",
    category: meta.cat,
    copies: editing?.copies ?? 1,
    title: editing?.title || "Pratinjau Kartu Baru",
    description: editing?.description || meta.label,
    effect,
  };
}

export function renderSeekLiveCardPreview(root: HTMLElement, state: SeekStep3State): string {
  const built = buildSeekCardFromForm(root, state, "Pratinjau Kartu Baru", state.editingCardDraft?.id);
  return renderSeekCardTile(built ?? previewSeekCardFromState(state, state.editingCardDraft));
}

export function buildSeekCardFromForm(
  root: HTMLElement,
  state: SeekStep3State,
  fallbackTitle?: string,
  existingId?: string,
): HideSeekCardDefinition | null {
  const title = root.querySelector<HTMLInputElement>("#ed-card-title")?.value.trim() || fallbackTitle;
  if (!title) return null;
  const description = root.querySelector<HTMLInputElement>("#ed-card-desc")?.value.trim() || "Kartu buatan kreator.";
  const rawCopies = Number(root.querySelector<HTMLInputElement>("#ed-card-copies")?.value ?? 1);
  const copies = Math.max(SEEK_CARD_MIN_COPIES, Math.min(SEEK_CARD_MAX_COPIES, Number.isFinite(rawCopies) ? Math.round(rawCopies) : 1));
  const prim = state.cardPrimitive;
  const meta = CARD_PRIMITIVES.find((p) => p.id === prim) ?? CARD_PRIMITIVES[0];
  const val = Number(root.querySelector<HTMLInputElement>("#ed-card-val")?.value ?? 5);

  let effect: HideSeekCardEffect;
  if (prim === "time_bonus") {
    const editingPct =
      state.editingCardDraft?.effect.primitive === "time_bonus" &&
      state.editingCardDraft.effect.minutes === undefined &&
      state.editingCardDraft.effect.percentOfRawTime !== undefined;
    effect = editingPct ? { primitive: "time_bonus", percentOfRawTime: val } : { primitive: "time_bonus", minutes: val };
  }
  else if (prim === "veto") effect = { primitive: "veto" };
  else if (prim === "randomize") effect = { primitive: "randomize" };
  else if (prim === "duplicate") effect = { primitive: "duplicate" };
  else if (prim === "expand_hand") effect = { primitive: "expand_hand", extraSlots: Math.max(1, val) };
  else if (prim === "discard_draw") effect = { primitive: "discard_draw", discardCount: 1, drawCount: 2, keepCount: 1 };
  else if (prim === "time_trap") effect = { primitive: "time_trap", bonusMinutes: val };
  else if (prim === "move_zone") {
    effect = { primitive: "move_zone", travelWindowMs: 10 * 60_000, revealOldStation: true, discardHand: true };
  } else {
    const costKind = root.querySelector<HTMLSelectElement>("#ed-curse-cost")?.value ?? "none";
    const castingCosts: CurseCastingCost[] =
      costKind === "discard_cards"
        ? [{ type: "discard_cards", count: 1 }]
        : costKind === "seeker_min_distance"
          ? [{ type: "seeker_min_distance", meters: 500 }]
          : [{ type: "none" }];
    const blockerType = (root.querySelector<HTMLSelectElement>("#ed-curse-blocker")?.value ??
      "block_questions") as CurseBlockerType;
    const buyoutMins = Number(root.querySelector<HTMLInputElement>("#ed-curse-buyout")?.value ?? 0);
    const effectModifiers: CurseEffectModifier[] =
      buyoutMins > 0 ? [{ type: "skip_penalty_minutes", penaltyMinutes: buyoutMins }] : [];
    const detail = root.querySelector<HTMLInputElement>("#ed-curse-detail")?.value.trim() || "Tantangan kutukan publik.";
    const mins = Math.max(1, Number(root.querySelector<HTMLInputElement>("#ed-curse-mins")?.value ?? 3));
    const clearType = (root.querySelector<HTMLSelectElement>("#ed-curse-clear")?.value ??
      "photo_challenge") as CurseClearCondition["type"];
    let clearCondition: CurseClearCondition;
    if (clearType === "timer") clearCondition = { type: "timer", durationMs: Math.min(mins, 10) * 60_000 };
    else if (clearType === "next_n_questions") clearCondition = { type: "next_n_questions", count: Math.min(mins, 3) };
    else if (clearType === "gps_detour") {
      clearCondition = { type: "gps_detour", poiCategory: detail, radiusMeters: 100, fallbackTimerMs: 10 * 60_000 };
    } else if (clearType === "honor_task") {
      clearCondition = { type: "honor_task", instruction: detail, minDurationMs: 60_000 };
    } else {
      clearCondition = {
        type: "photo_challenge",
        prompt: detail,
        approvalMode: "opponent_or_timeout",
        autoApproveMs: Math.min(mins, 5) * 60_000,
      };
    }
    effect = {
      primitive: "curse",
      curse: { castingCosts, blockerType, effectModifiers, clearCondition },
    };
  }

  return {
    id: existingId || `card-${prim}-${Date.now().toString(36)}`,
    category: meta.cat,
    copies,
    title,
    description,
    effect,
  };
}
