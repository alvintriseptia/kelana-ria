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

export type SeekStep3State = {
  subTab: SeekStep3SubTab;
  family: HideSeekQuestionFamily;
  cardPrimitive: HideSeekCardEffect["primitive"];
  curseClearType: CurseClearCondition["type"];
};

const FAMILY_LIST: { id: HideSeekQuestionFamily; label: string }[] = [
  { id: "radar", label: "Radar" },
  { id: "thermometer", label: "Termometer" },
  { id: "matching", label: "Matching" },
  { id: "measuring", label: "Measuring" },
  { id: "tentacles", label: "Tentacles" },
  { id: "photo", label: "Foto" },
];

const CARD_PRIMITIVES: { id: HideSeekCardEffect["primitive"]; label: string; cat: HideSeekCardCategory }[] = [
  { id: "time_bonus", label: "Bonus Waktu (+menit)", cat: "time_bonus" },
  { id: "veto", label: "Veto (Batalkan Pertanyaan)", cat: "powerup" },
  { id: "randomize", label: "Randomize (Acak Pertanyaan)", cat: "powerup" },
  { id: "discard_draw", label: "Buang & Tarik Kartu", cat: "powerup" },
  { id: "expand_hand", label: "Perluas Batas Tangan (+1)", cat: "powerup" },
  { id: "duplicate", label: "Duplikasi Kartu", cat: "powerup" },
  { id: "time_trap", label: "Perangkap Waktu (Time Trap)", cat: "powerup" },
  { id: "move_zone", label: "Pindah Zona (Move)", cat: "powerup" },
  { id: "curse", label: "Kutukan (Curse)", cat: "curse" },
];

export function renderSeekStep3(
  pack: HideSeekRulebookPack,
  state: SeekStep3State,
  editable: boolean,
): string {
  const dis = editable ? "" : "disabled";
  const totalDeckCopies = pack.deck.cards.reduce((sum, c) => sum + c.copies, 0);

  return `<div class="rb-card" data-studio-slot="rules-builder">
    <h3>3. Aturan, Buku Petunjuk &amp; Dek Hide &amp; Seek</h3>
    <div class="rb-actions" aria-label="Sub-tab builder Hide & Seek">
      <button type="button" class="${state.subTab === "timers" ? "primary" : "secondary"}" data-s3-tab="timers">Timer &amp; Sesi</button>
      <button type="button" class="${state.subTab === "book" ? "primary" : "secondary"}" data-s3-tab="book">Buku Petunjuk (6)</button>
      <button type="button" class="${state.subTab === "deck" ? "primary" : "secondary"}" data-s3-tab="deck">Dek &amp; Kutukan (${totalDeckCopies})</button>
    </div>

    ${
      state.subTab === "timers"
        ? renderSeekTimers(pack, dis, editable)
        : state.subTab === "book"
          ? renderSeekBook(pack, state.family, dis, editable)
          : renderSeekDeck(pack, state, dis, editable)
    }

    <div class="rb-sticky-footer">
      <button type="button" class="secondary" data-step="2">← Peta</button>
      ${editable ? `<button type="button" class="secondary" data-action="save-draft">Simpan</button>` : "<span></span>"}
      <button type="button" class="primary" data-step="4">Validasi →</button>
    </div>
  </div>`;
}

function renderSeekTimers(pack: HideSeekRulebookPack, dis: string, editable: boolean): string {
  return `<div data-testid="seek-timers-panel">
    <div class="rb-grid-2">
      <label class="rb-field"><span>Min Pemain (2–6)</span><input id="ed-seek-minp" type="number" min="2" max="6" value="${pack.session.minPlayers}" ${dis}></label>
      <label class="rb-field"><span>Maks Pemain (2–6)</span><input id="ed-seek-maxp" type="number" min="2" max="6" value="${pack.session.maxPlayers}" ${dis}></label>
      <label class="rb-field"><span>Radius Zona Sembunyi (m)</span><input id="ed-zone" type="number" value="${pack.geography.hidingZoneRadiusMeters}" ${dis}></label>
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
      <label class="rb-field"><span>Mode Biaya Ulang Petunjuk</span>
        <select id="ed-repeat-mode" ${dis}>
          <option value="escalating_multiplier" ${pack.investigationBook.repeatCostMode === "escalating_multiplier" ? "selected" : ""}>Berlipat (1x, 2x, 3x)</option>
          <option value="single_use_locked" ${pack.investigationBook.repeatCostMode === "single_use_locked" ? "selected" : ""}>Sekali Pakai per Giliran</option>
          <option value="flat" ${pack.investigationBook.repeatCostMode === "flat" ? "selected" : ""}>Tetap (1x)</option>
        </select>
      </label>
      <label class="rb-field"><span>Batas Kartu Tangan</span><input id="ed-hand" type="number" min="3" max="8" value="${pack.deck.baseHandLimit}" ${dis}></label>
      <label class="rb-field"><span>Maks Kutukan Pemblokir Aktif</span><input id="ed-max-curses" type="number" min="1" max="2" value="${pack.deck.maxActiveBlockingCurses}" ${dis}></label>
    </div>
    ${
      editable
        ? `<div class="rb-badges"><span class="rb-badge">Tab Petunjuk: 6 Keluarga</span><span class="rb-badge">Tab Dek: Kartu &amp; Kutukan</span></div>`
        : ""
    }
  </div>`;
}

function renderSeekBook(
  pack: HideSeekRulebookPack,
  family: HideSeekQuestionFamily,
  dis: string,
  editable: boolean,
): string {
  const cfg = pack.investigationBook.families[family];
  const items = cfg?.items ?? [];
  return `<div data-testid="seek-book-panel">
    <div class="st-visual-grid" role="group" aria-label="Pilih keluarga pertanyaan">
      ${FAMILY_LIST.map((f) => {
        const famCfg = pack.investigationBook.families[f.id];
        const meta = questionFamilyTileMeta(f.id);
        const count = famCfg?.items.length ?? 0;
        const dk = `${famCfg?.drawCount ?? 2}/${famCfg?.keepCount ?? 1}`;
        return `<button type="button" class="st-visual-tile" data-s3-family="${f.id}" aria-pressed="${family === f.id}">
          ${meta.svg}
          <strong>${escapeText(f.label)}</strong>
          <span class="st-tile-meta">Tarik ${dk} · ${count} item</span>
        </button>`;
      }).join("")}
    </div>
    <div class="rb-grid-2">
      <label class="rb-field"><span>Status Keluarga (${escapeText(family)})</span>
        <select id="ed-fam-enabled" ${dis}>
          <option value="true" ${cfg?.enabled ? "selected" : ""}>Aktif</option>
          <option value="false" ${!cfg?.enabled ? "selected" : ""}>Nonaktif</option>
        </select>
      </label>
      <label class="rb-field"><span>Tarik Kartu</span><input id="ed-fam-draw" type="number" min="1" max="5" value="${cfg?.drawCount ?? 2}" ${dis}></label>
      <label class="rb-field"><span>Simpan Kartu</span><input id="ed-fam-keep" type="number" min="1" max="5" value="${cfg?.keepCount ?? 1}" ${dis}></label>
    </div>
    ${editable ? `<button type="button" class="secondary" data-s3-action="save-family-cfg">Simpan Pengaturan Keluarga</button>` : ""}

    <details class="rb-accordion">
      <summary>Daftar Item ${escapeText(family)} (${items.length})</summary>
      <ul class="rb-list">
        ${
          items.length === 0
            ? "<li>Belum ada item pada keluarga ini.</li>"
            : items
                .map(
                  (item, idx) => `<li>
                    <div><strong>${escapeText(item.label)}</strong> <code>${escapeText(item.id)}</code></div>
                    ${editable ? `<button type="button" class="secondary" data-s3-action="delete-book-item" data-index="${idx}">Hapus</button>` : ""}
                  </li>`,
                )
                .join("")
        }
      </ul>
    </details>

    ${
      editable
        ? `<div class="rb-card">
            <h4>+ Tambah Item ${escapeText(family)}</h4>
            <div class="rb-grid-2">
              <label class="rb-field"><span>Label Item</span><input id="ed-item-label" placeholder="Mis. Radar 750 m"></label>
              ${
                family === "radar"
                  ? `<label class="rb-field"><span>Radius (meter)</span><input id="ed-item-num" type="number" value="750" min="100"></label>`
                  : family === "thermometer"
                    ? `<label class="rb-field"><span>Jarak Tempuh Min (meter)</span><input id="ed-item-num" type="number" value="500" min="100"></label>`
                    : family === "matching"
                      ? `<label class="rb-field"><span>Atribut Stasiun</span><input id="ed-item-extra" value="kecamatan"></label>`
                      : family === "measuring"
                        ? `<label class="rb-field"><span>Kategori POI</span><input id="ed-item-extra" value="taman"></label>`
                        : family === "tentacles"
                          ? `<label class="rb-field"><span>Radius (meter)</span><input id="ed-item-num" type="number" value="1500" min="200"></label>
                             <label class="rb-field"><span>Kategori POI</span><input id="ed-item-extra" value="taman"></label>`
                          : `<label class="rb-field"><span>Instruksi Foto</span><input id="ed-item-extra" value="Foto papan nama jalan terdekat."></label>`
              }
            </div>
            <button type="button" class="primary" data-s3-action="add-book-item">+ Tambah Item Petunjuk</button>
          </div>`
        : ""
    }
  </div>`;
}

function renderSeekDeck(
  pack: HideSeekRulebookPack,
  state: SeekStep3State,
  dis: string,
  editable: boolean,
): string {
  const prim = state.cardPrimitive;
  return `<div data-testid="seek-deck-panel">
    <p><small>Total kartu: <strong>${pack.deck.cards.reduce((s, c) => s + c.copies, 0)}</strong> · Batas tangan: ${pack.deck.baseHandLimit} · Maks kutukan pemblokir aktif: ${pack.deck.maxActiveBlockingCurses}</small></p>
    <details class="rb-accordion">
      <summary>Daftar Kartu di Dek (${pack.deck.cards.length} jenis)</summary>
      <div class="st-card-stack">
        ${pack.deck.cards
          .map((card, idx) =>
            renderSeekCardTile(
              card,
              editable
                ? `<button type="button" class="secondary" data-s3-action="dup-seek-card" data-index="${idx}">Duplikat</button>
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
            <h4>+ Komposer Kartu &amp; Kutukan</h4>
            <div data-testid="live-card-preview">${renderSeekCardTile(previewSeekCardFromState(state))}</div>
            <div class="rb-grid-2">
              <label class="rb-field"><span>Tipe Kartu</span>
                <select id="ed-card-prim" ${dis}>
                  ${CARD_PRIMITIVES.map(
                    (p) => `<option value="${p.id}" ${prim === p.id ? "selected" : ""}>${p.label}</option>`,
                  ).join("")}
                </select>
              </label>
              <label class="rb-field"><span>Jumlah Salinan</span><input id="ed-card-copies" type="number" min="1" max="10" value="1"></label>
              <label class="rb-field"><span>Judul Kartu</span><input id="ed-card-title" placeholder="Mis. Kutukan Kopi Senopati"></label>
              <label class="rb-field"><span>Deskripsi Singkat</span><input id="ed-card-desc" value="Kartu kustom kreator."></label>
            </div>

            ${
              prim === "time_bonus"
                ? `<label class="rb-field"><span>Bonus Menit</span><input id="ed-card-val" type="number" min="1" max="30" value="5"></label>`
                : prim === "time_trap"
                  ? `<label class="rb-field"><span>Bonus Perangkap (menit)</span><input id="ed-card-val" type="number" min="1" max="15" value="5"></label>`
                  : prim === "expand_hand"
                    ? `<label class="rb-field"><span>Slot Tambahan</span><input id="ed-card-val" type="number" min="1" max="2" value="1"></label>`
                    : prim === "curse"
                      ? `<div class="rb-grid-2">
                          <label class="rb-field"><span>Biaya Kartu</span>
                            <select id="ed-curse-cost">
                              <option value="none">Gratis</option>
                              <option value="discard_cards">Buang 1 Kartu</option>
                              <option value="seeker_min_distance">Pencari min. 500 m</option>
                            </select>
                          </label>
                          <label class="rb-field"><span>Tipe Blokir</span>
                            <select id="ed-curse-blocker">
                              <option value="block_questions">Blokir Pertanyaan</option>
                              <option value="block_transit">Blokir Transit</option>
                              <option value="none">Tanpa Blokir</option>
                            </select>
                          </label>
                          <label class="rb-field"><span>Syarat Hapus</span>
                            <select id="ed-curse-clear">
                              <option value="photo_challenge" ${state.curseClearType === "photo_challenge" ? "selected" : ""}>Tantangan Foto</option>
                              <option value="timer" ${state.curseClearType === "timer" ? "selected" : ""}>Timer</option>
                              <option value="next_n_questions" ${state.curseClearType === "next_n_questions" ? "selected" : ""}>N Pertanyaan Berikutnya</option>
                              <option value="gps_detour" ${state.curseClearType === "gps_detour" ? "selected" : ""}>Detour GPS POI</option>
                              <option value="honor_task" ${state.curseClearType === "honor_task" ? "selected" : ""}>Tugas Lapangan</option>
                            </select>
                          </label>
                          <label class="rb-field"><span>Penalti Buyout (menit, 0 = tanpa buyout)</span><input id="ed-curse-buyout" type="number" min="0" max="20" value="5"></label>
                          <label class="rb-field"><span>Prompt / Instruksi / Kategori POI</span><input id="ed-curse-detail" value="Kirim foto ruang publik terdekat."></label>
                          <label class="rb-field"><span>Durasi / Auto-Approve (menit, maks 5)</span><input id="ed-curse-mins" type="number" min="1" max="10" value="3"></label>
                        </div>`
                      : ""
            }
            <button type="button" class="primary" data-s3-action="add-seek-card">+ Tambahkan Kartu ke Dek</button>
          </div>`
        : ""
    }
  </div>`;
}

const SEEK_EFFECT_CHIP_LABELS: Record<string, string> = {
  veto: "Veto",
  randomize: "Acak Pertanyaan",
  discard_draw: "Buang & Tarik",
  duplicate: "Duplikat Kartu",
  move_zone: "Pindah Zona",
};

const SEEK_CLEAR_CHIP_LABELS: Record<CurseClearCondition["type"], string> = {
  photo_challenge: "Hapus: Foto",
  timer: "Hapus: Timer",
  next_n_questions: "Hapus: Pertanyaan",
  gps_detour: "Hapus: Detour GPS",
  honor_task: "Hapus: Tugas",
};

function seekCardChips(card: HideSeekCardDefinition): CardPreviewChip[] {
  const ef = card.effect;
  if (ef.primitive === "time_bonus") return [{ label: `+${ef.minutes} menit`, tone: "ok" }];
  if (ef.primitive === "time_trap") return [{ label: `Perangkap +${ef.bonusMinutes}m`, tone: "warn" }];
  if (ef.primitive === "expand_hand") return [{ label: `+${ef.extraSlots} Slot`, tone: "ok" }];
  if (ef.primitive !== "curse") return [{ label: SEEK_EFFECT_CHIP_LABELS[ef.primitive] ?? "Powerup" }];
  const cost = ef.curse.castingCosts[0];
  const costLabel =
    cost?.type === "discard_cards"
      ? `Biaya: Buang ${cost.count}`
      : cost?.type === "seeker_min_distance"
        ? `Min ${cost.meters}m`
        : "Gratis";
  const blockerLabel =
    ef.curse.blockerType === "block_questions"
      ? "Blokir Tanya"
      : ef.curse.blockerType === "block_transit"
        ? "Blokir Transit"
        : "Tanpa Blokir";
  const clearLabel = SEEK_CLEAR_CHIP_LABELS[ef.curse.clearCondition.type];
  const mod = (ef.curse.effectModifiers ?? []).find((m) => m.type === "skip_penalty_minutes");
  const chips: CardPreviewChip[] = [
    { label: costLabel },
    { label: blockerLabel, tone: ef.curse.blockerType === "none" ? "neutral" : "danger" },
    { label: clearLabel, tone: "warn" },
  ];
  if (mod && mod.type === "skip_penalty_minutes") {
    chips.push({ label: `Buyout +${mod.penaltyMinutes}m` });
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

function previewSeekCardFromState(state: SeekStep3State): HideSeekCardDefinition {
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
    id: "preview",
    category: meta.cat,
    copies: 1,
    title: "Pratinjau Kartu Baru",
    description: meta.label,
    effect,
  };
}

export function renderSeekLiveCardPreview(root: HTMLElement, state: SeekStep3State): string {
  const built = buildSeekCardFromForm(root, state, "Pratinjau Kartu Baru");
  return renderSeekCardTile(built ?? previewSeekCardFromState(state));
}

export function buildSeekCardFromForm(
  root: HTMLElement,
  state: SeekStep3State,
  fallbackTitle?: string,
): HideSeekCardDefinition | null {
  const title = root.querySelector<HTMLInputElement>("#ed-card-title")?.value.trim() || fallbackTitle;
  if (!title) return null;
  const description = root.querySelector<HTMLInputElement>("#ed-card-desc")?.value.trim() || "Kartu kustom kreator.";
  const copies = Math.max(1, Number(root.querySelector<HTMLInputElement>("#ed-card-copies")?.value ?? 1));
  const prim = state.cardPrimitive;
  const meta = CARD_PRIMITIVES.find((p) => p.id === prim) ?? CARD_PRIMITIVES[0];
  const val = Number(root.querySelector<HTMLInputElement>("#ed-card-val")?.value ?? 5);

  let effect: HideSeekCardEffect;
  if (prim === "time_bonus") effect = { primitive: "time_bonus", minutes: val };
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
    id: `card-${prim}-${Date.now().toString(36)}`,
    category: meta.cat,
    copies,
    title,
    description,
    effect,
  };
}
