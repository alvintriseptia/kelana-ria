import type {
  ClaimRulebookPack,
  GeoSnapshot,
  HideSeekRulebookPack,
  RulebookFormat,
  RulebookValidationIssue,
} from "@kelana-ria/contracts";
import { escapeText } from "./solo-view";
import "./rulebook-seek-play.css";

type AnyPack = HideSeekRulebookPack | ClaimRulebookPack;

type VersionRecord = {
  packId: string;
  version: number;
  format: RulebookFormat;
  isOfficial: boolean;
  status: string;
  pack: AnyPack;
  snapshot: GeoSnapshot;
  reviewNote: string | null;
};

type EarningsRecord = {
  earningsEntryId: string;
  orderId: string;
  packId: string;
  version: number;
  title: string;
  grossAmountIdr: number;
  creatorShareIdr: number;
};

function isClaimPack(pack: AnyPack): pack is ClaimRulebookPack {
  return pack.meta.format === "claim-the-city";
}

export function mountRulebookStudio(root: HTMLElement, onBack: () => void): () => void {
  const initialFormat =
    new URLSearchParams(location.search).get("format") === "claim-the-city" ? "claim-the-city" : "hide-and-seek";
  let format: RulebookFormat = initialFormat;
  let tab: "writer" | "reviewer" = "writer";
  let versions: VersionRecord[] = [];
  let earnings: EarningsRecord[] = [];
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
    const data = await apiJson<{ versions?: VersionRecord[]; earnings?: EarningsRecord[] }>("/api/rulebooks?role=reviewer");
    versions = (data.versions ?? []).filter((v) => v.format === format);
    earnings = data.earnings ?? [];
    if (!selectedKey || !versions.some((v) => `${v.packId}@${v.version}` === selectedKey)) {
      const firstDraft = versions.find((v) => !v.isOfficial);
      selectedKey = firstDraft ? `${firstDraft.packId}@${firstDraft.version}` : "";
    }
    render();
  }

  function currentDraft(): VersionRecord | undefined {
    return versions.find((v) => `${v.packId}@${v.version}` === selectedKey);
  }

  function renderDraftEditor(active: VersionRecord): string {
    if (isClaimPack(active.pack)) {
      const pack = active.pack;
      const firstLandmark = pack.geography.landmarks[0];
      return `<div class="rb-card">
        <h3>2. Sunting Draf Claim · ${escapeText(pack.meta.title)} (v${active.version} · ${escapeText(active.status)})</h3>
        <div class="rb-grid-2">
          <label class="rb-field"><span>Durasi Sesi (menit)</span><input id="ed-claim-duration" type="number" value="${Math.round(pack.session.durationMs / 60_000)}"></label>
          <label class="rb-field"><span>Target Kunci Solo</span><input id="ed-claim-solo-locks" type="number" value="${pack.session.soloTargets?.lockedLandmarks ?? 4}"></label>
          <label class="rb-field"><span>Target Zona Solo</span><input id="ed-claim-solo-zones" type="number" value="${pack.session.soloTargets?.distinctZones ?? 2}"></label>
          <label class="rb-field"><span>Batas Kartu Taktis</span><input id="ed-claim-hand" type="number" value="${pack.tacticalDeck.maxHandSize}"></label>
        </div>
        <div class="rb-grid-2">
          <label class="rb-field"><span>Tambah Tantangan Foto Kustom (Judul)</span><input id="ed-claim-photo-title" placeholder="Mis. Foto Mural Blok M"></label>
          <label class="rb-field"><span>Override Nama Landmark Pertama</span><input id="ed-claim-landmark-name" value="${escapeText(firstLandmark?.name ?? "")}"></label>
        </div>
        <div class="rb-actions">
          <button type="button" class="secondary" data-action="save-draft">Simpan &amp; Validasi Draf</button>
          <button type="button" class="secondary" data-action="dry-run">Simulasi Dry-Run GPS</button>
          <button type="button" class="primary" data-action="submit-draft">Ajukan untuk Tinjauan</button>
        </div>
        ${dryRunSummary ? `<p role="status" class="rb-badge">${escapeText(dryRunSummary)}</p>` : ""}
      </div>`;
    }

    const pack = active.pack;
    return `<div class="rb-card">
      <h3>2. Sunting Draf Hide &amp; Seek · ${escapeText(pack.meta.title)} (v${active.version} · ${escapeText(active.status)})</h3>
      <div class="rb-grid-2">
        <label class="rb-field"><span>Radius Zona Sembunyi (m)</span><input id="ed-zone" type="number" value="${pack.geography.hidingZoneRadiusMeters}"></label>
        <label class="rb-field"><span>Head Start (menit)</span><input id="ed-head" type="number" value="${Math.round(pack.timers.headStartMs / 60_000)}"></label>
        <label class="rb-field"><span>Batas Cari (menit)</span><input id="ed-search" type="number" value="${Math.round(pack.timers.searchLimitMs / 60_000)}"></label>
        <label class="rb-field"><span>Batas Kartu Tangan</span><input id="ed-hand" type="number" value="${pack.deck.baseHandLimit}"></label>
      </div>
      <div class="rb-grid-2">
        <label class="rb-field"><span>Tambah Kutukan Foto Kustom (Judul)</span><input id="ed-curse-title" placeholder="Mis. Kutukan Kopi Senopati"></label>
        <label class="rb-field"><span>Override Nama Stasiun Pertama</span><input id="ed-station-name" value="${escapeText(active.snapshot.stations[0]?.name ?? "")}"></label>
      </div>
      <div class="rb-actions">
        <button type="button" class="secondary" data-action="save-draft">Simpan &amp; Validasi Draf</button>
        <button type="button" class="secondary" data-action="dry-run">Simulasi Dry-Run GPS</button>
        <button type="button" class="primary" data-action="submit-draft">Ajukan untuk Tinjauan</button>
      </div>
      ${dryRunSummary ? `<p role="status" class="rb-badge">${escapeText(dryRunSummary)}</p>` : ""}
    </div>`;
  }

  function render() {
    const officialTemplates = versions.filter((v) => v.isOfficial);
    const communityVersions = versions.filter((v) => !v.isOfficial);
    const active = currentDraft();
    const defaultPackId = format === "claim-the-city" ? "pack-senopati-claim" : "pack-senopati-seek";
    const defaultTitle =
      format === "claim-the-city" ? "Senopati Culinary Claim the City" : "Senopati Coffee Hide & Seek";

    root.innerHTML = `<section class="rb-shell" aria-label="Studio Kreator Rulebook">
      <div class="rb-card">
        <h2>Studio Kreator · ${format === "claim-the-city" ? "Claim the City" : "Hide &amp; Seek"} RulebookPack</h2>
        <p>Kloning templat resmi Jakarta, sunting aturan, tantangan, atau kutukan kustom tanpa menulis kode. Semua draf melewati validator otomatis sebelum tinjauan editorial.</p>
        <div class="rb-actions">
          <button type="button" class="${format === "hide-and-seek" ? "primary" : "secondary"}" data-format="hide-and-seek">Format Hide &amp; Seek</button>
          <button type="button" class="${format === "claim-the-city" ? "primary" : "secondary"}" data-format="claim-the-city">Format Claim the City</button>
        </div>
        <div class="rb-actions">
          <button type="button" class="${tab === "writer" ? "primary" : "secondary"}" data-tab="writer">Penulis (Creator)</button>
          <button type="button" class="${tab === "reviewer" ? "primary" : "secondary"}" data-tab="reviewer">Peninjau (Reviewer)</button>
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
          ? `<div class="rb-card">
              <h3>1. Kloning dari Templat Resmi</h3>
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
              <button type="button" class="primary" data-action="clone">Kloning Templat Jadi Draf</button>
            </div>

            ${active ? renderDraftEditor(active) : ""}

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
            </div>`
          : `<div class="rb-card">
              <h3>Antrean Tinjauan Editorial (${communityVersions.length})</h3>
              <ul class="rb-list">
                ${
                  communityVersions.length === 0
                    ? "<li>Belum ada paket komunitas untuk format ini.</li>"
                    : communityVersions
                        .map(
                          (v) => `<li>
                            <strong>${escapeText(v.pack.meta.title)}</strong> (<code>${escapeText(v.packId)}</code> v${v.version})
                            <span class="rb-badge">${escapeText(v.status)}</span>
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

    const action = btn.dataset.action;
    if (!action) return;

    void (async () => {
      errorMsg = "";
      validationErrors = [];
      if (action === "clone") {
        const res = await apiJson<{ ok?: boolean; record?: VersionRecord; error?: string }>("/api/rulebooks", {
          type: "clone-official",
          templatePackId: root.querySelector<HTMLSelectElement>("#st-template")?.value,
          packId: root.querySelector<HTMLInputElement>("#st-pack-id")?.value.trim(),
          title: root.querySelector<HTMLInputElement>("#st-title")?.value.trim(),
          byline: root.querySelector<HTMLInputElement>("#st-byline")?.value.trim(),
          priceIdr: Number(root.querySelector<HTMLInputElement>("#st-price")?.value ?? 0),
        });
        if (res.ok && res.record) {
          selectedKey = `${res.record.packId}@${res.record.version}`;
          statusMsg = `Draf ${res.record.packId} v${res.record.version} berhasil dikloning.`;
          await refresh();
        } else {
          errorMsg = res.error ?? "Gagal kloning templat.";
          render();
        }
      } else if (action === "save-draft") {
        const active = currentDraft();
        if (!active) return;
        const updatedSnapshot: GeoSnapshot = structuredClone(active.snapshot);
        let updatedPack: AnyPack;

        if (isClaimPack(active.pack)) {
          const pack: ClaimRulebookPack = structuredClone(active.pack);
          pack.session.durationMs = Number(root.querySelector<HTMLInputElement>("#ed-claim-duration")?.value ?? 90) * 60_000;
          if (pack.session.soloTargets) {
            pack.session.soloTargets.lockedLandmarks = Number(
              root.querySelector<HTMLInputElement>("#ed-claim-solo-locks")?.value ?? 4,
            );
            pack.session.soloTargets.distinctZones = Number(
              root.querySelector<HTMLInputElement>("#ed-claim-solo-zones")?.value ?? 2,
            );
          }
          pack.tacticalDeck.maxHandSize = Number(root.querySelector<HTMLInputElement>("#ed-claim-hand")?.value ?? 2);
          const lmName = root.querySelector<HTMLInputElement>("#ed-claim-landmark-name")?.value.trim();
          if (lmName && pack.geography.landmarks[0]) {
            pack.geography.landmarks[0].name = lmName;
          }
          const photoTitle = root.querySelector<HTMLInputElement>("#ed-claim-photo-title")?.value.trim();
          if (photoTitle) {
            pack.challenges.backupPool.push({
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
          updatedPack = pack;
        } else {
          const pack: HideSeekRulebookPack = structuredClone(active.pack);
          pack.geography.hidingZoneRadiusMeters = Number(root.querySelector<HTMLInputElement>("#ed-zone")?.value ?? 400);
          pack.timers.headStartMs = Number(root.querySelector<HTMLInputElement>("#ed-head")?.value ?? 25) * 60_000;
          pack.timers.searchLimitMs = Number(root.querySelector<HTMLInputElement>("#ed-search")?.value ?? 60) * 60_000;
          pack.deck.baseHandLimit = Number(root.querySelector<HTMLInputElement>("#ed-hand")?.value ?? 5);
          const stationName = root.querySelector<HTMLInputElement>("#ed-station-name")?.value.trim();
          if (stationName && updatedSnapshot.stations[0]) {
            updatedSnapshot.stations[0].name = stationName;
          }
          const curseTitle = root.querySelector<HTMLInputElement>("#ed-curse-title")?.value.trim();
          if (curseTitle) {
            pack.deck.cards.push({
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
          updatedPack = pack;
        }

        const res = await apiJson<{ ok?: boolean; validation?: { ok: boolean; errors: RulebookValidationIssue[] }; error?: string }>("/api/rulebooks", {
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
      } else if (action === "dry-run") {
        const active = currentDraft();
        if (!active) return;
        if (isClaimPack(active.pack)) {
          const lm = active.pack.geography.landmarks[0];
          dryRunSummary = `Dry-Run OK: ${active.pack.geography.zones.length} zona, ${active.pack.geography.landmarks.length} landmark (uji ${lm?.name ?? "-"}), ${active.pack.challenges.backupPool.length} tantangan cadangan, siap diajukan.`;
        } else {
          const st = active.snapshot.stations[0];
          dryRunSummary = `Dry-Run OK: ${active.snapshot.stations.length} stasiun aktif, jangkar uji ${st?.name ?? "-"} (radius ${active.pack.geography.hidingZoneRadiusMeters}m), ${active.pack.deck.cards.length} jenis kartu, siap diajukan.`;
        }
        render();
      } else if (action === "submit-draft") {
        const active = currentDraft();
        if (!active) return;
        const res = await apiJson<{ ok?: boolean; validation?: { errors: RulebookValidationIssue[] }; error?: string }>("/api/rulebooks", {
          type: "submit-draft",
          packId: active.packId,
          version: active.version,
        });
        if (res.ok) {
          statusMsg = "Draf diajukan ke peninjau editorial.";
          await refresh();
        } else {
          validationErrors = res.validation?.errors ?? [];
          errorMsg = res.error ?? "Gagal mengajukan draf.";
          render();
        }
      } else if (action === "publish" || action === "request-changes" || action === "pause") {
        const type =
          action === "publish" ? "publish-version" : action === "pause" ? "pause-version" : "request-changes";
        const res = await apiJson<{ ok?: boolean; error?: string }>("/api/rulebooks", {
          type,
          packId: btn.dataset.pack,
          version: Number(btn.dataset.version ?? 1),
          note: "Perjelas catatan akses lokasi.",
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
