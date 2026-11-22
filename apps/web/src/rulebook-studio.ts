import type {
  ClaimRulebookPack,
  GeoSnapshot,
  HideSeekRulebookPack,
  RulebookFormat,
  RulebookValidationIssue,
} from "@kelana-ria/contracts";
import { escapeText } from "./solo-view";
import {
  parseStudioBundleJson,
  serializeStudioBundle,
  triggerStudioBundleDownload,
} from "./studio-json";
import {
  isClaimStudioPack,
  type StudioEarningsRecord,
  type StudioPack,
  type StudioStep,
  type StudioVersionRecord,
} from "./studio-types";
import "./rulebook-seek-play.css";

const STEP_META: { step: StudioStep; short: string; label: string }[] = [
  { step: 1, short: "1. Draf", label: "Draf & Info" },
  { step: 2, short: "2. Peta", label: "Peta & Lokasi" },
  { step: 3, short: "3. Aturan", label: "Aturan & Kartu" },
  { step: 4, short: "4. Validasi", label: "Validasi & Ajukan" },
];

const STATUS_LABELS: Record<string, string> = {
  draft: "Draf",
  "changes-requested": "Perlu Revisi",
  submitted: "Menunggu Tinjauan",
  published: "Terbit",
  paused: "Dijeda",
};

function statusLabel(status: string): string {
  return STATUS_LABELS[status] ?? status;
}

export function mountRulebookStudio(root: HTMLElement, onBack: () => void): () => void {
  const initialFormat =
    new URLSearchParams(location.search).get("format") === "claim-the-city" ? "claim-the-city" : "hide-and-seek";
  let format: RulebookFormat = initialFormat;
  let tab: "writer" | "reviewer" = "writer";
  let step: StudioStep = 1;
  let showCloneForm = false;
  let showJsonTools = false;
  let jsonBuffer = "";
  let versions: StudioVersionRecord[] = [];
  let earnings: StudioEarningsRecord[] = [];
  let selectedKey = "";
  let validationErrors: RulebookValidationIssue[] = [];
  let dryRunSummary = "";
  let statusMsg = "";
  let errorMsg = "";

  async function apiJson<T>(path: string, body?: unknown): Promise<T> {
    const res = await fetch(path, {
      method: body === undefined ? "GET" : "POST",
      headers: body === undefined ? undefined : { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return (await res.json()) as T;
  }

  async function refresh() {
    const data = await apiJson<{ versions?: StudioVersionRecord[]; earnings?: StudioEarningsRecord[] }>(
      "/api/rulebooks?role=reviewer",
    );
    versions = (data.versions ?? []).filter((v) => v.format === format);
    earnings = data.earnings ?? [];
    const community = versions.filter((v) => !v.isOfficial);
    if (!selectedKey || !community.some((v) => `${v.packId}@${v.version}` === selectedKey)) {
      const firstDraft = community[0];
      selectedKey = firstDraft ? `${firstDraft.packId}@${firstDraft.version}` : "";
    }
    if (community.length === 0) showCloneForm = true;
    render();
  }

  function currentDraft(): StudioVersionRecord | undefined {
    return versions.find((v) => !v.isOfficial && `${v.packId}@${v.version}` === selectedKey);
  }

  function isEditable(rec: StudioVersionRecord): boolean {
    return rec.status === "draft" || rec.status === "changes-requested";
  }

  function renderStepper(): string {
    return `<nav class="rb-stepper" aria-label="Tahap penyusunan paket">
      ${STEP_META.map(
        (item) => `<button type="button" class="rb-step-btn ${step === item.step ? "rb-step-active" : ""}" data-step="${item.step}" aria-current="${step === item.step ? "step" : "false"}">${escapeText(item.short)}</button>`,
      ).join("")}
    </nav>`;
  }

  function renderCloneCard(officialTemplates: StudioVersionRecord[]): string {
    const defaultPackId = format === "claim-the-city" ? "pack-senopati-claim" : "pack-senopati-seek";
    const defaultTitle =
      format === "claim-the-city" ? "Senopati Culinary Claim the City" : "Senopati Coffee Hide & Seek";
    return `<div class="rb-card" data-testid="clone-template-card">
      <h3>Kloning dari Templat Resmi</h3>
      <div class="rb-grid-2">
        <label class="rb-field"><span>Templat Resmi</span>
          <select id="st-template">
            ${officialTemplates.map((t) => `<option value="${escapeText(t.packId)}">${escapeText(t.pack.meta.title)}</option>`).join("")}
          </select>
        </label>
        <label class="rb-field"><span>ID Paket Baru</span><input id="st-pack-id" value="${defaultPackId}"></label>
        <label class="rb-field"><span>Judul Paket</span><input id="st-title" value="${defaultTitle}"></label>
        <label class="rb-field"><span>Nama Kreator</span><input id="st-byline" value="Kolektif Selatan"></label>
        <label class="rb-field"><span>Harga Sesi (IDR)</span><input id="st-price" type="number" value="30000" min="0" step="1000"></label>
      </div>
      <div class="rb-actions">
        <button type="button" class="primary" data-action="clone">Kloning Templat Jadi Draf</button>
      </div>
    </div>`;
  }

  function renderStep1(
    officialTemplates: StudioVersionRecord[],
    communityVersions: StudioVersionRecord[],
    active?: StudioVersionRecord,
  ): string {
    const nextVersionNum = active
      ? Math.max(...communityVersions.filter((v) => v.packId === active.packId).map((v) => v.version)) + 1
      : 2;

    return `
      ${
        active && active.status === "changes-requested" && active.reviewNote
          ? `<div class="rb-banner-warn" role="alert" data-testid="revision-note-banner">
              <strong>Catatan Peninjau (${escapeText(active.packId)} v${active.version}):</strong>
              <span>${escapeText(active.reviewNote)}</span>
            </div>`
          : ""
      }

      <div class="rb-card">
        <h3>Draf Saya (${communityVersions.length})</h3>
        ${
          communityVersions.length > 0
            ? `<label class="rb-field"><span>Pilih Draf / Versi Aktif</span>
                <select id="st-draft-select">
                  ${communityVersions
                    .map((v) => {
                      const key = `${v.packId}@${v.version}`;
                      return `<option value="${escapeText(key)}" ${key === selectedKey ? "selected" : ""}>${escapeText(v.pack.meta.title)} · ${escapeText(v.packId)} v${v.version} (${escapeText(statusLabel(v.status))})</option>`;
                    })
                    .join("")}
                </select>
              </label>`
            : `<p>Belum ada draf untuk format ini. Kloning templat resmi di bawah untuk memulai.</p>`
        }
        <div class="rb-actions">
          <button type="button" class="secondary" data-action="toggle-clone">${showCloneForm ? "Tutup Form Kloning" : "+ Kloning Templat Baru"}</button>
          ${
            active && !isEditable(active)
              ? `<button type="button" class="primary" data-action="clone-next-version">Buat Versi Berikutnya (v${nextVersionNum})</button>`
              : ""
          }
          <button type="button" class="secondary" data-action="toggle-json">${showJsonTools ? "Tutup JSON Tools" : "Ekspor / Impor JSON"}</button>
        </div>
      </div>

      ${showCloneForm ? renderCloneCard(officialTemplates) : ""}

      ${
        showJsonTools
          ? `<div class="rb-card" data-testid="json-tools-card">
              <h3>JSON Power Tools (<code>{ pack, snapshot }</code>)</h3>
              <p><small>Unduh draf sebagai JSON untuk disunting eksternal atau tempel/unggah berkas JSON untuk mengimpornya menjadi draf baru.</small></p>
              <div class="rb-actions">
                ${active ? `<button type="button" class="secondary" data-action="export-json">Unduh JSON Draf Aktif</button>` : ""}
                <label class="rb-field"><span>Pilih Berkas JSON</span><input id="st-json-file" type="file" accept="application/json,.json"></label>
              </div>
              <label class="rb-field">
                <span>JSON Bundel (<code>{ pack, snapshot }</code>)</span>
                <textarea id="st-json-text" class="rb-json-area" placeholder='{"pack": {...}, "snapshot": {...}}'>${escapeText(jsonBuffer)}</textarea>
              </label>
              <div class="rb-actions">
                <button type="button" class="primary" data-action="import-json">Impor &amp; Validasi JSON</button>
              </div>
            </div>`
          : ""
      }

      ${
        active
          ? `<div class="rb-card">
              <div class="rb-badges">
                <span class="rb-badge">${escapeText(active.packId)} v${active.version}</span>
                <span class="rb-badge">${escapeText(statusLabel(active.status))}</span>
              </div>
              <h3>Info Paket Aktif</h3>
              ${
                !isEditable(active)
                  ? `<p><small>Versi ini berstatus <strong>${escapeText(statusLabel(active.status))}</strong> dan terkunci. Klik <strong>Buat Versi Berikutnya</strong> untuk menyunting versi baru.</small></p>`
                  : ""
              }
              <div class="rb-grid-2">
                <label class="rb-field"><span>Judul Paket</span><input id="ed-meta-title" value="${escapeText(active.pack.meta.title)}" ${!isEditable(active) ? "disabled" : ""}></label>
                <label class="rb-field"><span>Nama Kreator</span><input id="ed-meta-byline" value="${escapeText(active.pack.meta.byline)}" ${!isEditable(active) ? "disabled" : ""}></label>
                <label class="rb-field"><span>Kota / Wilayah</span><input id="ed-meta-city" value="${escapeText(active.pack.meta.cityLabel)}" ${!isEditable(active) ? "disabled" : ""}></label>
                <label class="rb-field"><span>Harga Sesi (IDR)</span><input id="ed-meta-price" type="number" min="0" step="1000" value="${active.pack.meta.priceIdr}" ${!isEditable(active) ? "disabled" : ""}></label>
              </div>
              <label class="rb-field"><span>Ringkasan Paket</span><input id="ed-meta-summary" value="${escapeText(active.pack.meta.summary)}" ${!isEditable(active) ? "disabled" : ""}></label>
              <div class="rb-step-footer">
                ${isEditable(active) ? `<button type="button" class="secondary" data-action="save-draft">Simpan Info</button>` : "<span></span>"}
                <button type="button" class="primary" data-step="2">Lanjut: Peta &amp; Lokasi →</button>
              </div>
            </div>`
          : ""
      }
    `;
  }

  function renderStep2(active?: StudioVersionRecord): string {
    if (!active) {
      return `<div class="rb-card"><p>Pilih atau kloning draf di Tahap 1 terlebih dahulu.</p><button type="button" class="primary" data-step="1">← Kembali ke Tahap 1</button></div>`;
    }
    const editable = isEditable(active);
    if (isClaimStudioPack(active.pack)) {
      const claimPack = active.pack;
      const firstLm = claimPack.geography.landmarks[0];
      return `<div class="rb-card" data-studio-slot="map-editor">
        <h3>2. Peta &amp; Lokasi Claim · ${escapeText(claimPack.meta.title)}</h3>
        <div class="rb-badges">
          <span class="rb-badge">Titik Awal: ${escapeText(active.snapshot.startPoint.name)}</span>
          <span class="rb-badge">${claimPack.geography.zones.length} zona</span>
          <span class="rb-badge">${claimPack.geography.landmarks.length} landmark</span>
          <span class="rb-badge">Radius check-in ${claimPack.geography.checkInRadiusMeters} m</span>
        </div>
        <label class="rb-field">
          <span>Override Nama Landmark Pertama</span>
          <input id="ed-claim-landmark-name" value="${escapeText(firstLm?.name ?? "")}" ${!editable ? "disabled" : ""}>
        </label>
        <ul class="rb-list">
          ${claimPack.geography.zones
            .map((z) => {
              const count = claimPack.geography.landmarks.filter((l) => l.zoneId === z.id).length;
              return `<li><strong>${escapeText(z.label)} · ${escapeText(z.name)}</strong> <small>${count} landmark</small></li>`;
            })
            .join("")}
        </ul>
        <div class="rb-step-footer">
          <button type="button" class="secondary" data-step="1">← Draf &amp; Info</button>
          ${editable ? `<button type="button" class="secondary" data-action="save-draft">Simpan &amp; Validasi</button>` : ""}
          <button type="button" class="primary" data-step="3">Lanjut: Aturan &amp; Kartu →</button>
        </div>
      </div>`;
    }

    const firstStation = active.snapshot.stations[0];
    return `<div class="rb-card" data-studio-slot="map-editor">
      <h3>2. Peta &amp; Lokasi Hide &amp; Seek · ${escapeText(active.pack.meta.title)}</h3>
      <div class="rb-badges">
        <span class="rb-badge">Titik Awal: ${escapeText(active.snapshot.startPoint.name)}</span>
        <span class="rb-badge">${active.snapshot.stations.length} stasiun</span>
        <span class="rb-badge">${active.snapshot.pois.length} POI</span>
        <span class="rb-badge">Zona Sembunyi ${active.pack.geography.hidingZoneRadiusMeters} m</span>
      </div>
      <label class="rb-field">
        <span>Override Nama Stasiun Pertama</span>
        <input id="ed-station-name" value="${escapeText(firstStation?.name ?? "")}" ${!editable ? "disabled" : ""}>
      </label>
      <ul class="rb-list">
        ${active.snapshot.stations
          .slice(0, 6)
          .map((s) => `<li><strong>${escapeText(s.name)}</strong> <small>${s.latitude.toFixed(4)}, ${s.longitude.toFixed(4)} · ${escapeText(s.transitLines.join(", "))}</small></li>`)
          .join("")}
      </ul>
      <div class="rb-step-footer">
        <button type="button" class="secondary" data-step="1">← Draf &amp; Info</button>
        ${editable ? `<button type="button" class="secondary" data-action="save-draft">Simpan &amp; Validasi</button>` : ""}
        <button type="button" class="primary" data-step="3">Lanjut: Aturan &amp; Kartu →</button>
      </div>
    </div>`;
  }

  function renderStep3(active?: StudioVersionRecord): string {
    if (!active) {
      return `<div class="rb-card"><p>Pilih atau kloning draf di Tahap 1 terlebih dahulu.</p><button type="button" class="primary" data-step="1">← Kembali ke Tahap 1</button></div>`;
    }
    const editable = isEditable(active);
    if (isClaimStudioPack(active.pack)) {
      const pack = active.pack;
      return `<div class="rb-card" data-studio-slot="rules-builder">
        <h3>3. Aturan, Tantangan &amp; Dek Taktis · ${escapeText(pack.meta.title)}</h3>
        <div class="rb-grid-2">
          <label class="rb-field"><span>Durasi Sesi (menit)</span><input id="ed-claim-duration" type="number" value="${Math.round(pack.session.durationMs / 60_000)}" ${!editable ? "disabled" : ""}></label>
          <label class="rb-field"><span>Target Kunci Solo</span><input id="ed-claim-solo-locks" type="number" value="${pack.session.soloTargets?.lockedLandmarks ?? 4}" ${!editable ? "disabled" : ""}></label>
          <label class="rb-field"><span>Target Zona Solo</span><input id="ed-claim-solo-zones" type="number" value="${pack.session.soloTargets?.distinctZones ?? 2}" ${!editable ? "disabled" : ""}></label>
          <label class="rb-field"><span>Batas Kartu Taktis</span><input id="ed-claim-hand" type="number" value="${pack.tacticalDeck.maxHandSize}" ${!editable ? "disabled" : ""}></label>
        </div>
        <label class="rb-field">
          <span>Tambah Tantangan Foto Kustom ke Backup Pool (Judul)</span>
          <input id="ed-claim-photo-title" placeholder="Mis. Foto Mural Blok M" ${!editable ? "disabled" : ""}>
        </label>
        <div class="rb-step-footer">
          <button type="button" class="secondary" data-step="2">← Peta &amp; Lokasi</button>
          ${editable ? `<button type="button" class="secondary" data-action="save-draft">Simpan &amp; Validasi</button>` : ""}
          <button type="button" class="primary" data-step="4">Lanjut: Validasi &amp; Ajukan →</button>
        </div>
      </div>`;
    }

    const pack = active.pack;
    return `<div class="rb-card" data-studio-slot="rules-builder">
      <h3>3. Aturan, Buku Petunjuk &amp; Dek Kartu · ${escapeText(pack.meta.title)}</h3>
      <div class="rb-grid-2">
        <label class="rb-field"><span>Radius Zona Sembunyi (m)</span><input id="ed-zone" type="number" value="${pack.geography.hidingZoneRadiusMeters}" ${!editable ? "disabled" : ""}></label>
        <label class="rb-field"><span>Head Start (menit)</span><input id="ed-head" type="number" value="${Math.round(pack.timers.headStartMs / 60_000)}" ${!editable ? "disabled" : ""}></label>
        <label class="rb-field"><span>Batas Cari (menit)</span><input id="ed-search" type="number" value="${Math.round(pack.timers.searchLimitMs / 60_000)}" ${!editable ? "disabled" : ""}></label>
        <label class="rb-field"><span>Batas Kartu Tangan</span><input id="ed-hand" type="number" value="${pack.deck.baseHandLimit}" ${!editable ? "disabled" : ""}></label>
      </div>
      <label class="rb-field">
        <span>Tambah Kutukan Foto Kustom ke Dek (Judul)</span>
        <input id="ed-curse-title" placeholder="Mis. Kutukan Kopi Senopati" ${!editable ? "disabled" : ""}>
      </label>
      <div class="rb-step-footer">
        <button type="button" class="secondary" data-step="2">← Peta &amp; Lokasi</button>
        ${editable ? `<button type="button" class="secondary" data-action="save-draft">Simpan &amp; Validasi</button>` : ""}
        <button type="button" class="primary" data-step="4">Lanjut: Validasi &amp; Ajukan →</button>
      </div>
    </div>`;
  }

  function renderStep4(active?: StudioVersionRecord): string {
    if (!active) {
      return `<div class="rb-card"><p>Pilih atau kloning draf di Tahap 1 terlebih dahulu.</p><button type="button" class="primary" data-step="1">← Kembali ke Tahap 1</button></div>`;
    }
    const editable = isEditable(active);
    return `<div class="rb-card" data-studio-slot="dry-run-panel">
      <h3>4. Validasi, Simulasi Dry-Run &amp; Ajukan · ${escapeText(active.pack.meta.title)} (v${active.version})</h3>
      <div class="rb-badges">
        <span class="rb-badge">Status: ${escapeText(statusLabel(active.status))}</span>
        <span class="rb-badge">Hash Geo: ${escapeText(active.snapshot.hash.slice(0, 10))}…</span>
      </div>
      <div class="rb-actions">
        ${editable ? `<button type="button" class="secondary" data-action="save-draft">Jalankan Validator Otomatis</button>` : ""}
        <button type="button" class="secondary" data-action="dry-run">Simulasi Dry-Run GPS</button>
        ${editable ? `<button type="button" class="primary" data-action="submit-draft">Ajukan untuk Tinjauan</button>` : ""}
      </div>
      ${dryRunSummary ? `<p role="status" class="rb-badge">${escapeText(dryRunSummary)}</p>` : ""}
      <div class="rb-step-footer">
        <button type="button" class="secondary" data-step="3">← Aturan &amp; Kartu</button>
        <button type="button" class="secondary" data-tab="reviewer">Buka Antrean Peninjau →</button>
      </div>
    </div>

    <div class="rb-card">
      <h3>Pendapatan Kreator (${earnings.length})</h3>
      <ul class="rb-list">
        ${
          earnings.length === 0
            ? "<li>Belum ada pesanan terbayar.</li>"
            : earnings
                .map(
                  (e) => `<li><strong>${escapeText(e.title)}</strong> · Order <code>${escapeText(e.orderId)}</code> · Bruto Rp ${e.grossAmountIdr.toLocaleString("id-ID")} · Bagian Kreator Rp ${e.creatorShareIdr.toLocaleString("id-ID")}</li>`,
                )
                .join("")
        }
      </ul>
    </div>`;
  }

  function render() {
    const officialTemplates = versions.filter((v) => v.isOfficial);
    const communityVersions = versions.filter((v) => !v.isOfficial);
    const submittedCount = communityVersions.filter((v) => v.status === "submitted").length;
    const active = currentDraft();

    root.innerHTML = `<section class="rb-shell" aria-label="Studio Kreator Rulebook">
      <div class="rb-card">
        <h2>Studio Kreator · ${format === "claim-the-city" ? "Claim the City" : "Hide &amp; Seek"} RulebookPack</h2>
        <p>Buat paket permainan sendiri dalam 4 langkah: kloning templat, atur peta, sesuaikan aturan/kartu, lalu validasi dan ajukan untuk terbit di katalog.</p>
        <div class="rb-actions">
          <button type="button" class="${format === "hide-and-seek" ? "primary" : "secondary"}" data-format="hide-and-seek">Format Hide &amp; Seek</button>
          <button type="button" class="${format === "claim-the-city" ? "primary" : "secondary"}" data-format="claim-the-city">Format Claim the City</button>
        </div>
        <div class="rb-actions">
          <button type="button" class="${tab === "writer" ? "primary" : "secondary"}" data-tab="writer">Penulis (Creator)</button>
          <button type="button" class="${tab === "reviewer" ? "primary" : "secondary"}" data-tab="reviewer">Peninjau (${submittedCount})</button>
          <button type="button" class="secondary" data-nav="catalog">Katalog Publik</button>
          <button type="button" class="secondary" data-nav="back">Beranda</button>
        </div>
        ${statusMsg ? `<p role="status">${escapeText(statusMsg)}</p>` : ""}
        ${errorMsg ? `<p role="alert" class="rb-errors">${escapeText(errorMsg)}</p>` : ""}
        ${
          validationErrors.length > 0
            ? `<ul class="rb-errors" aria-label="Kesalahan validasi">${validationErrors
                .map((e) => `<li><code>${escapeText(e.code)}</code> (${escapeText(e.path)}): ${escapeText(e.message)}</li>`)
                .join("")}</ul>`
            : ""
        }
      </div>

      ${
        tab === "writer"
          ? `${renderStepper()}
             ${
               step === 1
                 ? renderStep1(officialTemplates, communityVersions, active)
                 : step === 2
                   ? renderStep2(active)
                   : step === 3
                     ? renderStep3(active)
                     : renderStep4(active)
             }`
          : `<div class="rb-card">
              <h3>Antrean Tinjauan Editorial (${communityVersions.length})</h3>
              <ul class="rb-list">
                ${
                  communityVersions.length === 0
                    ? "<li>Belum ada paket komunitas untuk format ini.</li>"
                    : communityVersions
                        .map(
                          (v) => `<li>
                            <div>
                              <strong>${escapeText(v.pack.meta.title)}</strong> (<code>${escapeText(v.packId)}</code> v${v.version})
                              <span class="rb-badge">${escapeText(statusLabel(v.status))}</span>
                            </div>
                            ${v.reviewNote ? `<small>Catatan terakhir: ${escapeText(v.reviewNote)}</small>` : ""}
                            ${
                              v.status === "submitted"
                                ? `<label class="rb-field"><span>Catatan Revisi (opsional)</span><input id="rev-note-${escapeText(v.packId)}-${v.version}" value="Perjelas catatan akses lokasi."></label>`
                                : ""
                            }
                            <div class="rb-actions">
                              ${v.status === "submitted" ? `<button type="button" class="primary" data-action="publish" data-pack="${escapeText(v.packId)}" data-version="${v.version}">Terbitkan ke Katalog</button>` : ""}
                              ${v.status === "submitted" ? `<button type="button" class="secondary" data-action="request-changes" data-pack="${escapeText(v.packId)}" data-version="${v.version}">Minta Revisi</button>` : ""}
                              ${v.status === "published" ? `<button type="button" class="secondary" data-action="pause" data-pack="${escapeText(v.packId)}" data-version="${v.version}">Jeda Penjualan</button>` : ""}
                            </div>
                          </li>`,
                        )
                        .join("")
                }
              </ul>
            </div>`
      }
    </section>`;
  }

  function applyFormEdits(active: StudioVersionRecord): { pack: StudioPack; snapshot: GeoSnapshot } {
    const updatedSnapshot: GeoSnapshot = structuredClone(active.snapshot);
    const updatedPack: StudioPack = structuredClone(active.pack);

    const metaTitle = root.querySelector<HTMLInputElement>("#ed-meta-title")?.value.trim();
    if (metaTitle) updatedPack.meta.title = metaTitle;
    const metaByline = root.querySelector<HTMLInputElement>("#ed-meta-byline")?.value.trim();
    if (metaByline) updatedPack.meta.byline = metaByline;
    const metaCity = root.querySelector<HTMLInputElement>("#ed-meta-city")?.value.trim();
    if (metaCity) updatedPack.meta.cityLabel = metaCity;
    const metaSummary = root.querySelector<HTMLInputElement>("#ed-meta-summary")?.value.trim();
    if (metaSummary) updatedPack.meta.summary = metaSummary;
    const metaPriceEl = root.querySelector<HTMLInputElement>("#ed-meta-price");
    if (metaPriceEl) updatedPack.meta.priceIdr = Number(metaPriceEl.value || 0);

    if (isClaimStudioPack(updatedPack)) {
      const durEl = root.querySelector<HTMLInputElement>("#ed-claim-duration");
      if (durEl) updatedPack.session.durationMs = Number(durEl.value || 90) * 60_000;
      const locksEl = root.querySelector<HTMLInputElement>("#ed-claim-solo-locks");
      const zonesEl = root.querySelector<HTMLInputElement>("#ed-claim-solo-zones");
      if (updatedPack.session.soloTargets) {
        if (locksEl) updatedPack.session.soloTargets.lockedLandmarks = Number(locksEl.value || 4);
        if (zonesEl) updatedPack.session.soloTargets.distinctZones = Number(zonesEl.value || 2);
      }
      const handEl = root.querySelector<HTMLInputElement>("#ed-claim-hand");
      if (handEl) updatedPack.tacticalDeck.maxHandSize = Number(handEl.value || 2);
      const lmName = root.querySelector<HTMLInputElement>("#ed-claim-landmark-name")?.value.trim();
      if (lmName && updatedPack.geography.landmarks[0]) {
        updatedPack.geography.landmarks[0].name = lmName;
      }
      const photoTitle = root.querySelector<HTMLInputElement>("#ed-claim-photo-title")?.value.trim();
      if (photoTitle) {
        updatedPack.challenges.backupPool.push({
          id: `custom-photo-${Date.now()}`,
          title: photoTitle,
          verificationNotes: "Terverifikasi dari ruang publik bebas tiket oleh kreator.",
          reviewed: true,
          reviewedAt: new Date().toISOString().slice(0, 10),
          payload: {
            primitive: "photo_proof",
            prompt: `Ambil foto publik untuk tantangan: ${photoTitle}`,
            verificationMode: "rival_or_timeout",
            autoApproveMs: 3 * 60_000,
          },
        });
      }
    } else {
      const zoneEl = root.querySelector<HTMLInputElement>("#ed-zone");
      if (zoneEl) updatedPack.geography.hidingZoneRadiusMeters = Number(zoneEl.value || 400);
      const headEl = root.querySelector<HTMLInputElement>("#ed-head");
      if (headEl) updatedPack.timers.headStartMs = Number(headEl.value || 25) * 60_000;
      const searchEl = root.querySelector<HTMLInputElement>("#ed-search");
      if (searchEl) updatedPack.timers.searchLimitMs = Number(searchEl.value || 60) * 60_000;
      const handEl = root.querySelector<HTMLInputElement>("#ed-hand");
      if (handEl) updatedPack.deck.baseHandLimit = Number(handEl.value || 5);
      const stationName = root.querySelector<HTMLInputElement>("#ed-station-name")?.value.trim();
      if (stationName && updatedSnapshot.stations[0]) {
        updatedSnapshot.stations[0].name = stationName;
      }
      const curseTitle = root.querySelector<HTMLInputElement>("#ed-curse-title")?.value.trim();
      if (curseTitle) {
        updatedPack.deck.cards.push({
          id: `custom-curse-${Date.now()}`,
          category: "curse",
          copies: 1,
          title: curseTitle,
          description: "Kutukan foto kustom kreator (batas auto-approve 3 menit).",
          effect: {
            primitive: "curse",
            curse: {
              castingCosts: [{ type: "none" }],
              blockerType: "block_questions",
              clearCondition: {
                type: "photo_challenge",
                prompt: `Kirim foto tantangan: ${curseTitle}`,
                approvalMode: "opponent_or_timeout",
                autoApproveMs: 3 * 60_000,
              },
            },
          },
        });
      }
    }

    return { pack: updatedPack, snapshot: updatedSnapshot };
  }

  root.addEventListener("change", (event) => {
    const target = event.target as HTMLElement | null;
    if (target instanceof HTMLSelectElement && target.id === "st-draft-select") {
      selectedKey = target.value;
      dryRunSummary = "";
      validationErrors = [];
      statusMsg = "";
      errorMsg = "";
      render();
      return;
    }
    if (target instanceof HTMLInputElement && target.id === "st-json-file") {
      const file = target.files?.[0];
      if (!file) return;
      void file.text().then((text) => {
        jsonBuffer = text;
        const area = root.querySelector<HTMLTextAreaElement>("#st-json-text");
        if (area) area.value = text;
        statusMsg = `Berkas ${file.name} dimuat. Klik Impor & Validasi JSON untuk menyimpan.`;
        render();
      });
    }
  });

  root.addEventListener("click", (event) => {
    const btn = (event.target as HTMLElement | null)?.closest<HTMLButtonElement>("button");
    if (!btn) return;
    if (btn.dataset.nav === "back") return onBack();
    if (btn.dataset.nav === "catalog") {
      const url = new URL(location.href);
      url.searchParams.set("play", format === "claim-the-city" ? "rulebook-claim" : "rulebook-seek");
      url.searchParams.delete("format");
      history.pushState({ fromChooser: true }, "", url);
      window.dispatchEvent(new PopStateEvent("popstate"));
      return;
    }
    if (btn.dataset.format === "hide-and-seek" || btn.dataset.format === "claim-the-city") {
      format = btn.dataset.format;
      selectedKey = "";
      step = 1;
      showCloneForm = false;
      showJsonTools = false;
      dryRunSummary = "";
      statusMsg = "";
      errorMsg = "";
      validationErrors = [];
      void refresh();
      return;
    }
    if (btn.dataset.tab === "writer" || btn.dataset.tab === "reviewer") {
      tab = btn.dataset.tab;
      render();
      return;
    }
    if (btn.dataset.step) {
      const nextStep = Number(btn.dataset.step) as StudioStep;
      if (nextStep >= 1 && nextStep <= 4) {
        step = nextStep;
        render();
      }
      return;
    }

    const action = btn.dataset.action;
    if (!action) return;

    void (async () => {
      errorMsg = "";
      validationErrors = [];

      if (action === "toggle-clone") {
        showCloneForm = !showCloneForm;
        render();
        return;
      }
      if (action === "toggle-json") {
        showJsonTools = !showJsonTools;
        const active = currentDraft();
        if (showJsonTools && active && !jsonBuffer) {
          jsonBuffer = serializeStudioBundle(active);
        }
        render();
        return;
      }
      if (action === "export-json") {
        const active = currentDraft();
        if (!active) return;
        jsonBuffer = serializeStudioBundle(active);
        triggerStudioBundleDownload(active);
        statusMsg = `Bundel JSON ${active.packId} v${active.version} diekspor.`;
        render();
        return;
      }
      if (action === "import-json") {
        const raw = root.querySelector<HTMLTextAreaElement>("#st-json-text")?.value ?? jsonBuffer;
        jsonBuffer = raw;
        const parsed = parseStudioBundleJson(raw, format);
        if (!parsed.ok) {
          errorMsg = parsed.error;
          render();
          return;
        }
        // Allocate next available version if matching version is immutable.
        const matching = versions.find(
          (v) => v.packId === parsed.bundle.pack.meta.packId && v.version === parsed.bundle.pack.meta.version,
        );
        if (matching && !isEditable(matching)) {
          parsed.bundle.pack.meta.version = 0;
        }
        const res = await apiJson<{
          ok?: boolean;
          record?: StudioVersionRecord;
          validation?: { ok: boolean; errors: RulebookValidationIssue[] };
          error?: string;
        }>("/api/rulebooks", {
          type: "save-draft",
          pack: parsed.bundle.pack,
          snapshot: parsed.bundle.snapshot,
          rehashSnapshot: true,
        });
        if (res.ok && res.record) {
          selectedKey = `${res.record.packId}@${res.record.version}`;
          validationErrors = res.validation?.errors ?? [];
          statusMsg = res.validation?.ok
            ? `JSON berhasil diimpor sebagai ${res.record.packId} v${res.record.version} dan lolos validator otomatis.`
            : `JSON diimpor sebagai ${res.record.packId} v${res.record.version} dengan kesalahan validasi.`;
          await refresh();
        } else {
          errorMsg = res.error ?? "Gagal mengimpor JSON.";
          render();
        }
        return;
      }
      if (action === "clone") {
        const res = await apiJson<{ ok?: boolean; record?: StudioVersionRecord; error?: string }>("/api/rulebooks", {
          type: "clone-official",
          templatePackId: root.querySelector<HTMLSelectElement>("#st-template")?.value,
          packId: root.querySelector<HTMLInputElement>("#st-pack-id")?.value.trim(),
          title: root.querySelector<HTMLInputElement>("#st-title")?.value.trim(),
          byline: root.querySelector<HTMLInputElement>("#st-byline")?.value.trim(),
          priceIdr: Number(root.querySelector<HTMLInputElement>("#st-price")?.value ?? 0),
        });
        if (res.ok && res.record) {
          selectedKey = `${res.record.packId}@${res.record.version}`;
          showCloneForm = false;
          statusMsg = `Draf ${res.record.packId} v${res.record.version} berhasil dikloning.`;
          await refresh();
        } else {
          errorMsg = res.error ?? "Gagal kloning templat.";
          render();
        }
        return;
      }
      if (action === "clone-next-version") {
        const active = currentDraft();
        if (!active) return;
        const nextPack = structuredClone(active.pack);
        nextPack.meta.version = 0; // Server allocates max_v + 1
        nextPack.meta.isOfficial = false;
        const res = await apiJson<{ ok?: boolean; record?: StudioVersionRecord; error?: string }>("/api/rulebooks", {
          type: "save-draft",
          pack: nextPack,
          snapshot: structuredClone(active.snapshot),
          rehashSnapshot: true,
        });
        if (res.ok && res.record) {
          selectedKey = `${res.record.packId}@${res.record.version}`;
          statusMsg = `Versi baru ${res.record.packId} v${res.record.version} siap disunting.`;
          await refresh();
        } else {
          errorMsg = res.error ?? "Gagal membuat versi baru.";
          render();
        }
        return;
      }
      if (action === "save-draft") {
        const active = currentDraft();
        if (!active) return;
        const { pack: updatedPack, snapshot: updatedSnapshot } = applyFormEdits(active);
        const res = await apiJson<{
          ok?: boolean;
          validation?: { ok: boolean; errors: RulebookValidationIssue[] };
          error?: string;
        }>("/api/rulebooks", {
          type: "save-draft",
          pack: updatedPack,
          snapshot: updatedSnapshot,
          rehashSnapshot: true,
        });
        if (res.ok) {
          validationErrors = res.validation?.errors ?? [];
          statusMsg = res.validation?.ok
            ? "Draf tersimpan dan lolos validator otomatis."
            : "Draf tersimpan dengan kesalahan validasi.";
          await refresh();
        } else {
          errorMsg = res.error ?? "Gagal menyimpan draf.";
          render();
        }
        return;
      }
      if (action === "dry-run") {
        const active = currentDraft();
        if (!active) return;
        if (isClaimStudioPack(active.pack)) {
          const lm = active.pack.geography.landmarks[0];
          dryRunSummary = `Dry-Run OK: ${active.pack.geography.zones.length} zona, ${active.pack.geography.landmarks.length} landmark (uji ${lm?.name ?? "-"}), ${active.pack.challenges.backupPool.length} tantangan cadangan, siap diajukan.`;
        } else {
          const st = active.snapshot.stations[0];
          dryRunSummary = `Dry-Run OK: ${active.snapshot.stations.length} stasiun aktif, jangkar uji ${st?.name ?? "-"} (radius ${active.pack.geography.hidingZoneRadiusMeters}m), ${active.pack.deck.cards.length} jenis kartu, siap diajukan.`;
        }
        render();
        return;
      }
      if (action === "submit-draft") {
        const active = currentDraft();
        if (!active) return;
        const res = await apiJson<{ ok?: boolean; validation?: { errors: RulebookValidationIssue[] }; error?: string }>(
          "/api/rulebooks",
          {
            type: "submit-draft",
            packId: active.packId,
            version: active.version,
          },
        );
        if (res.ok) {
          statusMsg = "Draf diajukan ke peninjau editorial.";
          await refresh();
        } else {
          validationErrors = res.validation?.errors ?? [];
          errorMsg = res.error ?? "Gagal mengajukan draf.";
          render();
        }
        return;
      }
      if (action === "publish" || action === "request-changes" || action === "pause") {
        const packId = btn.dataset.pack ?? "";
        const version = Number(btn.dataset.version ?? 1);
        const type =
          action === "publish" ? "publish-version" : action === "pause" ? "pause-version" : "request-changes";
        const noteInput = root.querySelector<HTMLInputElement>(`#rev-note-${packId}-${version}`)?.value.trim();
        const res = await apiJson<{ ok?: boolean; error?: string }>("/api/rulebooks", {
          type,
          packId,
          version,
          note: noteInput || "Perjelas catatan akses lokasi.",
          reason: "Lokasi sedang perawatan.",
        });
        if (res.ok) {
          statusMsg = `Status diperbarui (${type}).`;
          await refresh();
        } else {
          errorMsg = res.error ?? "Gagal memproses tinjauan.";
          render();
        }
      }
    })();
  });

  void refresh();
  return () => {};
}
