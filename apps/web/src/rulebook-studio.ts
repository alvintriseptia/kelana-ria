import type { GeoSnapshot, HideSeekRulebookPack, RulebookValidationIssue } from "@kelana-ria/contracts";
import { escapeText } from "./solo-view";
import "./rulebook-seek-play.css";

type VersionRecord = {
  packId: string;
  version: number;
  format: string;
  isOfficial: boolean;
  status: string;
  pack: HideSeekRulebookPack;
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

export function mountRulebookStudio(root: HTMLElement, onBack: () => void): () => void {
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
    versions = (data.versions ?? []).filter((v) => v.format === "hide-and-seek");
    earnings = data.earnings ?? [];
    if (!selectedKey) {
      const firstDraft = versions.find((v) => !v.isOfficial);
      if (firstDraft) selectedKey = `${firstDraft.packId}@${firstDraft.version}`;
    }
    render();
  }

  function currentDraft(): VersionRecord | undefined {
    return versions.find((v) => `${v.packId}@${v.version}` === selectedKey);
  }

  function render() {
    const officialTemplates = versions.filter((v) => v.isOfficial);
    const communityVersions = versions.filter((v) => !v.isOfficial);
    const active = currentDraft();

    root.innerHTML = `<section class="rb-shell" aria-label="Studio Kreator Rulebook Hide & Seek">
      <div class="rb-card">
        <h2>Studio Kreator · Hide &amp; Seek RulebookPack</h2>
        <p>Kloning templat resmi Jakarta, atur zona sembunyi, timer, dek kartu, dan kutukan kustom tanpa menulis kode. Semua draf melewati validator otomatis sebelum tinjauan editorial.</p>
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
                <label class="rb-field"><span>ID Paket Baru</span><input id="st-pack-id" value="pack-senopati-seek"></label>
                <label class="rb-field"><span>Judul Paket</span><input id="st-title" value="Senopati Coffee Hide & Seek"></label>
                <label class="rb-field"><span>Nama Kreator</span><input id="st-byline" value="Kolektif Selatan"></label>
                <label class="rb-field"><span>Harga Sesi (IDR)</span><input id="st-price" type="number" value="30000" min="0" step="1000"></label>
              </div>
              <button type="button" class="primary" data-action="clone">Kloning Templat Jadi Draf</button>
            </div>

            ${
              active
                ? `<div class="rb-card">
                    <h3>2. Sunting Draf · ${escapeText(active.pack.meta.title)} (v${active.version} · ${escapeText(active.status)})</h3>
                    <div class="rb-grid-2">
                      <label class="rb-field"><span>Radius Zona Sembunyi (m)</span><input id="ed-zone" type="number" value="${active.pack.geography.hidingZoneRadiusMeters}"></label>
                      <label class="rb-field"><span>Head Start (menit)</span><input id="ed-head" type="number" value="${Math.round(active.pack.timers.headStartMs / 60_000)}"></label>
                      <label class="rb-field"><span>Batas Cari (menit)</span><input id="ed-search" type="number" value="${Math.round(active.pack.timers.searchLimitMs / 60_000)}"></label>
                      <label class="rb-field"><span>Batas Kartu Tangan</span><input id="ed-hand" type="number" value="${active.pack.deck.baseHandLimit}"></label>
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
                  </div>`
                : ""
            }

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
                    ? "<li>Belum ada paket komunitas.</li>"
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
      url.searchParams.set("play", "rulebook-seek");
      history.pushState({ fromChooser: true }, "", url);
      window.dispatchEvent(new PopStateEvent("popstate"));
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
        const updated: HideSeekRulebookPack = structuredClone(active.pack);
        const updatedSnapshot: GeoSnapshot = structuredClone(active.snapshot);
        updated.geography.hidingZoneRadiusMeters = Number(root.querySelector<HTMLInputElement>("#ed-zone")?.value ?? 400);
        updated.timers.headStartMs = Number(root.querySelector<HTMLInputElement>("#ed-head")?.value ?? 25) * 60_000;
        updated.timers.searchLimitMs = Number(root.querySelector<HTMLInputElement>("#ed-search")?.value ?? 60) * 60_000;
        updated.deck.baseHandLimit = Number(root.querySelector<HTMLInputElement>("#ed-hand")?.value ?? 5);
        const stationName = root.querySelector<HTMLInputElement>("#ed-station-name")?.value.trim();
        if (stationName && updatedSnapshot.stations[0]) {
          updatedSnapshot.stations[0].name = stationName;
        }
        const curseTitle = root.querySelector<HTMLInputElement>("#ed-curse-title")?.value.trim();
        if (curseTitle) {
          updated.deck.cards.push({
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
        const res = await apiJson<{ ok?: boolean; validation?: { ok: boolean; errors: RulebookValidationIssue[] }; error?: string }>("/api/rulebooks", {
          type: "save-draft",
          pack: updated,
          snapshot: updatedSnapshot,
          rehashSnapshot: true,
        });
        if (res.ok) {
          validationErrors = res.validation?.errors ?? [];
          statusMsg = res.validation?.ok ? "Draf tersimpan dan lolos validator otomatis." : "Draf tersimpan dengan kesalahan validasi.";
          await refresh();
        } else {
          errorMsg = res.error ?? "Gagal menyimpan draf.";
          render();
        }
      } else if (action === "dry-run") {
        const active = currentDraft();
        if (!active) return;
        const firstStation = active.snapshot.stations[0];
        dryRunSummary = `Dry-Run OK: ${active.snapshot.stations.length} stasiun aktif, jangkar uji ${firstStation?.name ?? "-"} (radius ${active.pack.geography.hidingZoneRadiusMeters}m), ${active.pack.deck.cards.length} jenis kartu, siap diajukan.`;
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
          note: "Perjelas catatan akses stasiun.",
          reason: "Stasiun dalam perawatan.",
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
