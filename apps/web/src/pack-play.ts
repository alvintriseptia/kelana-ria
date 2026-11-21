import type {
  PackAction,
  PackDraftPayload,
  PackEarningsEntry,
  PackOrderStatus,
  PackOrderSummary,
  PackRole,
  PackTaskInput,
  PackVersionDetail,
  PackVersionStatus,
  PackWorkspaceReply,
} from "@kelana-ria/contracts";
import { action, escapeText } from "./solo-view";
import "./pack-play.css";

const defaultTasks: PackTaskInput[] = [
  {
    checkpointId: "taman-literasi",
    question:
      "Amati balkon amfiteater Taman Literasi dari sisi utara. Bagaimana bentuk susunan undakan tempat duduknya?",
    choices: [
      { id: "c1", label: "Melengkung setengah lingkaran menghadap panggung" },
      { id: "c2", label: "Memanjang lurus sejajar jalan raya" },
      { id: "c3", label: "Menara bertingkat tiga dengan atap kubah" },
    ],
    correctChoiceId: "c1",
    verificationNotes:
      "Balkon utara dapat diakses publik tanpa tiket pukul 07.00–22.00 WIB dari pintu barat MRT Blok M.",
  },
  {
    checkpointId: "blok-m-plaza",
    question:
      "Di pelataran masuk utama Blok M Plaza dari arah koridor MRT, bentuk geometri apa yang tampak pada penanda fasad pintu masuk?",
    choices: [
      { id: "c1", label: "Bidang persegi empat simetris" },
      { id: "c2", label: "Segitiga lancip kembar" },
      { id: "c3", label: "Kubah bundar berjeruji" },
    ],
    correctChoiceId: "c1",
    verificationNotes:
      "Terlihat jelas dari trotoar publik Jalan Bulungan tanpa harus masuk ke area komersial dalam gedung.",
  },
  {
    checkpointId: "m-bloc",
    question:
      "Dari pelataran depan M Bloc Space di Jalan Panglima Polim, berapa gambar layang-layang pada mural fasad depan?",
    choices: [
      { id: "c1", label: "Satu layang-layang" },
      { id: "c2", label: "Dua layang-layang" },
      { id: "c3", label: "Empat layang-layang" },
    ],
    correctChoiceId: "c2",
    verificationNotes:
      "Mural menghadap trotoar pejalan kaki antara Stasiun MRT ASEAN dan Blok M.",
  },
  {
    checkpointId: "taman-ayodya",
    question:
      "Perhatikan papan penunjuk jalur di tepi kolam Taman Ayodya. Siluet satwa apa yang terpasang di atas papan arah?",
    choices: [
      { id: "c1", label: "Burung bersayap" },
      { id: "c2", label: "Kucing duduk" },
      { id: "c3", label: "Kura-kura air" },
    ],
    correctChoiceId: "c1",
    verificationNotes:
      "Taman kota terbuka setiap hari; papan berada di jalur pedestrian sisi timur kolam.",
  },
  {
    checkpointId: "stadion-madya",
    question:
      "Di gerbang barat Stadion Madya Senayan, relief atlet pada papan gerbang menggambarkan cabang olahraga apa?",
    choices: [
      { id: "c1", label: "Lari lintasan" },
      { id: "c2", label: "Renang indah" },
      { id: "c3", label: "Balap sepeda" },
    ],
    correctChoiceId: "c1",
    verificationNotes:
      "Dapat diamati dari jalur pedestrian luar gerbang barat tanpa memasuki tribun stadion.",
  },
  {
    checkpointId: "plaza-senayan",
    question:
      "Hadap jam besar di pelataran utama Plaza Senayan pada panel uji. Pukul berapa posisi jarum yang ditampilkan pada penanda?",
    choices: [
      { id: "c1", label: "03.00" },
      { id: "c2", label: "06.00" },
      { id: "c3", label: "09.00" },
    ],
    correctChoiceId: "c1",
    verificationNotes:
      "Terlihat dari pelataran pejalan kaki terbuka dari arah Halte dan Stasiun MRT Senayan.",
  },
];

const statusLabels: Record<PackVersionStatus, string> = {
  draft: "Draf pribadi",
  submitted: "Menunggu tinjauan",
  "changes-requested": "Perlu revisi penulis",
  published: "Terbit di katalog",
  paused: "Penjualan dijeda",
};

const orderStatusLabels: Record<PackOrderStatus, string> = {
  pending: "Menunggu pelunasan · Test payment",
  settled: "Lunas · Test payment",
  expired: "Kedaluwarsa (tanpa akses)",
};

const errorLabels: Record<string, string> = {
  "forbidden-role": "Peran ini tidak memiliki izin untuk tindakan tersebut.",
  "forbidden-pack-owner": "Hanya penulis pemilik paket yang dapat mengubah draf ini.",
  "forbidden-order": "Pesanan ini tidak dimiliki oleh sesi perangkat ini.",
  "review-pending": "Versi saat ini sedang ditinjau oleh peninjau editorial.",
  "sales-paused": "Penjualan versi ini sedang dijeda karena kendala titik pemeriksaan.",
  "version-not-published": "Hanya versi yang telah disetujui dan terbit yang dapat dipesan.",
  "verification-notes-required": "Lengkapi catatan verifikasi lokasi untuk setiap tantangan.",
  "insufficient-zones": "Paket harus mencakup minimal 2 zona berbeda di papan Compact.",
  "requires-all-landmarks": "Paket harus menyediakan landmark alternatif di luar target minimal.",
  "order-not-settled": "Pembayaran belum lunas. Akses ruang belum dibuka.",
  "order-expired": "Pesanan sudah kedaluwarsa dan tidak membuka akses ruang.",
  "payment-mismatch": "Nominal atau mata uang pembayaran tidak cocok dengan pesanan.",
  "payment-provider-unavailable":
    "Layanan pembayaran sandbox sedang tidak tersedia. Pesanan tetap tertunda tanpa akses.",
  "invalid-signature": "Tanda tangan notifikasi pembayaran tidak valid.",
  "pass-already-bound": "Pass sesi ini sudah terikat ke ruang lain.",
};

function formatIdr(amount: number) {
  return `Rp${amount.toLocaleString("id-ID")}`;
}

function paidRoomHref(roomCode: string, passId: string) {
  const url = new URL("/", location.origin);
  url.searchParams.set("play", "duo-claim");
  url.searchParams.set("room", roomCode);
  url.searchParams.set("pass", passId);
  return `${url.pathname}${url.search}`;
}

export function mountPackPlay(root: HTMLElement, returnToSetup: () => void) {
  const mount = new AbortController();
  const { signal } = mount;

  const urlRole = new URLSearchParams(location.search).get("role");
  let activeRole: PackRole =
    urlRole === "reviewer" || urlRole === "public" ? urlRole : "writer";
  let workspace: PackWorkspaceReply | undefined;
  let feedback = "";
  let feedbackError = false;
  let busy = false;

  let draftByline = "Raka Pratama · Kolektif Jelajah Selatan";
  let draftTitle = "Jejak Transit Kebayoran & Senayan";
  let draftPrice = 25_000;
  let draftNote = defaultTasks[0]!.verificationNotes;
  let reviewNoteText = "Perjelas patokan pengamatan di pintu timur dan cantumkan jam akses.";
  let pauseReasonText = "Penutupan terkonfirmasi di balkon amfiteater Taman Literasi.";

  root.innerHTML = `<div class="pack-shell">
    <nav class="pack-nav" aria-label="Navigasi paket kreator">
      ${action("Kembali ke pilihan", "back", "solo-back")}
      <div class="pack-roles" role="group" aria-label="Peran marketplace">
        <button type="button" class="secondary" data-role="writer" aria-pressed="true">Penulis</button>
        <button type="button" class="secondary" data-role="reviewer" aria-pressed="false">Peninjau</button>
        <button type="button" class="secondary" data-role="public" aria-pressed="false">Katalog Publik</button>
      </div>
    </nav>
    <header class="solo-header">
      <h1 id="pack-title" tabindex="-1">Paket Kreator Jakarta</h1>
      <p>Jakarta (Compact) · Claim the City · <span>Pembayaran uji coba (Test payment)</span></p>
    </header>
    <p class="sr-only" role="status" id="pack-announcement"></p>
    <div id="pack-feedback" class="pack-note" hidden></div>
    <div id="pack-view"><p role="status">Memuat ruang kerja paket kreator…</p></div>
  </div>`;

  const view = root.querySelector<HTMLElement>("#pack-view")!;
  const feedbackEl = root.querySelector<HTMLElement>("#pack-feedback")!;
  const announcement = root.querySelector<HTMLElement>("#pack-announcement")!;

  function renderOrders(
    orders: PackOrderSummary[],
    heading: string,
    allowCheckoutActions: boolean,
  ) {
    return `<section class="pack-card" aria-label="${escapeText(heading)}">
      <h2>${escapeText(heading)}</h2>
      ${
        orders.length === 0
          ? "<p>Belum ada pesanan tercatat.</p>"
          : `<ul class="pack-list">${orders
              .map((ord) => {
                const badgeClass =
                  ord.status === "settled"
                    ? "pack-badge-published"
                    : ord.status === "expired"
                      ? "pack-badge-paused"
                      : "";
                const modeLabel =
                  ord.paymentMode === "midtrans-sandbox"
                    ? "Midtrans Sandbox · Test payment"
                    : "Recorded Sandbox · Test payment";
                return `<li data-order-id="${escapeText(ord.orderId)}" data-order-status="${escapeText(ord.status)}">
                <div>
                  <span class="pack-badge ${badgeClass}">${escapeText(orderStatusLabels[ord.status])}</span>
                  <strong>${escapeText(ord.orderId)}</strong> · ${escapeText(ord.title)} (v${ord.version}) · ${ord.players} pemain
                </div>
                <div>${escapeText(modeLabel)} · Harga kotor ${formatIdr(ord.grossAmountIdr)} · Potongan ${formatIdr(ord.platformFeeIdr)} · Bagian kreator <strong>${formatIdr(ord.creatorShareIdr)}</strong></div>
                ${
                  ord.checkoutReturnedAt && ord.status === "pending"
                    ? `<div class="pack-note">Kembali dari checkout sebelum pelunasan diverifikasi. Ruang belum dibuka sampai status lunas terkonfirmasi.</div>`
                    : ""
                }
                ${
                  allowCheckoutActions && ord.status === "pending"
                    ? `<div class="pack-actions">
                        ${action(`Kembali dari checkout (${ord.orderId})`, `checkout-return:${ord.orderId}`, "secondary", busy)}
                        ${action(`Verifikasi pelunasan (${ord.orderId})`, `verify-settlement:${ord.orderId}`, "primary", busy)}
                      </div>`
                    : ""
                }
                ${
                  ord.status === "settled" && ord.roomCode && ord.passId
                    ? `<div class="pack-note">
                        Pass sesi: <code>${escapeText(ord.passId)}</code> · Ruang: <strong>${escapeText(ord.roomCode)}</strong> · Entri pendapatan: <code>${escapeText(ord.earningsEntryId ?? "-")}</code>
                        ${
                          allowCheckoutActions
                            ? `<div class="pack-actions"><a class="primary" href="${escapeText(paidRoomHref(ord.roomCode, ord.passId))}">Buka ruang berbayar (${escapeText(ord.roomCode)})</a></div>`
                            : ""
                        }
                      </div>`
                    : ""
                }
                ${ord.supportNote ? `<div class="pack-note">${escapeText(ord.supportNote)}</div>` : ""}
              </li>`;
              })
              .join("")}</ul>`
      }
    </section>`;
  }

  function renderEarnings(earnings: PackEarningsEntry[], heading: string) {
    return `<section class="pack-card" aria-label="${escapeText(heading)}">
      <h2>${escapeText(heading)}</h2>
      ${
        earnings.length === 0
          ? "<p>Belum ada entri pendapatan lunas.</p>"
          : `<ul class="pack-list">${earnings
              .map(
                (entry) => `<li data-earnings-id="${escapeText(entry.earningsEntryId)}">
                <strong>${escapeText(entry.earningsEntryId)}</strong> · Pesanan <code>${escapeText(entry.orderId)}</code> · ${escapeText(entry.title)} (v${entry.version}) · <span>Test payment · Sandbox</span>
                <div>Kotor ${formatIdr(entry.grossAmountIdr)} · Potongan ${formatIdr(entry.platformFeeIdr)} · Bagian kreator <strong>${formatIdr(entry.creatorShareIdr)}</strong></div>
              </li>`,
              )
              .join("")}</ul>`
      }
    </section>`;
  }

  function renderVersionList(versions: PackVersionDetail[], forReviewer: boolean) {
    if (versions.length === 0) {
      return "<p>Belum ada versi paket yang disimpan.</p>";
    }
    return `<div class="pack-shell">${versions
      .map((ver) => {
        const badgeClass =
          ver.status === "published"
            ? "pack-badge-published"
            : ver.status === "paused" || ver.status === "changes-requested"
              ? "pack-badge-paused"
              : "";
        return `<article class="pack-card" data-version="${ver.version}" data-status="${escapeText(ver.status)}">
          <div>
            <span class="pack-badge ${badgeClass}">v${ver.version} · ${escapeText(statusLabels[ver.status])}</span>
            <h3>${escapeText(ver.title)} (v${ver.version})</h3>
            <p>Oleh <strong>${escapeText(ver.byline)}</strong> · ${formatIdr(ver.priceIdr)} / sesi · Solo &amp; Berdua (1–2 pemain)</p>
          </div>
          ${ver.reviewNote ? `<p class="pack-note"><strong>Catatan peninjau:</strong> ${escapeText(ver.reviewNote)}</p>` : ""}
          ${ver.pausedReason ? `<p class="pack-note pack-error"><strong>Alasan jeda penjualan:</strong> ${escapeText(ver.pausedReason)}</p>` : ""}
          <details>
            <summary>Tantangan, catatan verifikasi &amp; kunci jawaban pribadi (${ver.tasks.length} titik)</summary>
            <ul class="pack-list">
              ${ver.tasks
                .map(
                  (task) => `<li>
                  <strong>${escapeText(task.checkpointId)}</strong>: ${escapeText(task.question)}
                  <div>Kunci jawaban pribadi: <code>${escapeText(task.correctChoiceId)}</code> · Verifikasi: ${escapeText(task.verificationNotes)}</div>
                </li>`,
                )
                .join("")}
            </ul>
          </details>
          ${
            !forReviewer && ver.status === "draft"
              ? `<div class="pack-actions">${action(`Ajukan v${ver.version} untuk tinjauan`, `submit-${ver.packId}-${ver.version}`, "primary", busy)}</div>`
              : ""
          }
          ${
            forReviewer && ver.status === "submitted"
              ? `<div class="pack-field">
                  <label for="review-note-${ver.version}">Catatan koreksi untuk penulis</label>
                  <input id="review-note-${ver.version}" type="text" data-review-note value="${escapeText(reviewNoteText)}">
                </div>
                <div class="pack-actions">
                  ${action(`Minta revisi v${ver.version}`, `changes-${ver.packId}-${ver.version}`, "secondary", busy)}
                  ${action(`Terbitkan v${ver.version}`, `publish-${ver.packId}-${ver.version}`, "primary", busy)}
                </div>`
              : ""
          }
          ${
            forReviewer && ver.status === "published"
              ? `<div class="pack-field">
                  <label for="pause-reason-${ver.version}">Alasan jeda penjualan</label>
                  <input id="pause-reason-${ver.version}" type="text" data-pause-reason value="${escapeText(pauseReasonText)}">
                </div>
                <div class="pack-actions">
                  ${action(`Jeda penjualan v${ver.version}`, `pause-${ver.packId}-${ver.version}`, "secondary", busy)}
                </div>`
              : ""
          }
        </article>`;
      })
      .join("")}</div>`;
  }

  function renderWriter(state: PackWorkspaceReply) {
    const versions = state.versions ?? [];
    return `<div class="pack-grid">
      <section class="pack-card" aria-labelledby="writer-form-heading">
        <h2 id="writer-form-heading">Tulis &amp; revisi draf paket</h2>
        <form id="pack-draft-form" class="pack-shell">
          <div class="pack-field">
            <label for="pack-byline">Nama penulis (byline)</label>
            <input id="pack-byline" name="byline" type="text" value="${escapeText(draftByline)}" required>
          </div>
          <div class="pack-field">
            <label for="pack-title-input">Judul paket</label>
            <input id="pack-title-input" name="title" type="text" value="${escapeText(draftTitle)}" required>
          </div>
          <div class="pack-field">
            <label for="pack-price-input">Harga satu sesi (IDR)</label>
            <input id="pack-price-input" name="priceIdr" type="number" min="1000" step="1000" value="${draftPrice}" required>
          </div>
          <div class="pack-field">
            <label for="pack-task-note">Catatan verifikasi lapangan (Taman Literasi)</label>
            <input id="pack-task-note" name="taskNote" type="text" value="${escapeText(draftNote)}" required>
          </div>
          <button class="primary" type="submit" ${busy ? "disabled" : ""}>Simpan draf</button>
        </form>
      </section>
      <div class="pack-shell">
        <section class="pack-card" aria-labelledby="writer-versions-heading">
          <h2 id="writer-versions-heading">Riwayat versi penulis</h2>
          ${renderVersionList(versions, false)}
        </section>
        ${renderEarnings(state.earnings ?? [], "Entri pendapatan kreator (Test payment)")}
        ${renderOrders(state.orders, "Pesanan paket kreator", false)}
      </div>
    </div>`;
  }

  function renderReviewer(state: PackWorkspaceReply) {
    const versions = state.versions ?? [];
    const closures = state.closures ?? [];
    return `<div class="pack-grid">
      <section class="pack-card" aria-labelledby="reviewer-queue-heading">
        <h2 id="reviewer-queue-heading">Antrean tinjauan editorial</h2>
        ${
          closures.length > 0
            ? `<div class="pack-note pack-error">
                <strong>Laporan penutupan titik (${closures.length}):</strong>
                <ul class="pack-list">
                  ${closures
                    .map(
                      (c) =>
                        `<li>${escapeText(c.checkpointId)} (v${c.version}): ${escapeText(c.reason)}</li>`,
                    )
                    .join("")}
                </ul>
              </div>`
            : ""
        }
        ${renderVersionList(versions, true)}
      </section>
      <div class="pack-shell">
        ${renderEarnings(state.earnings ?? [], "Rekonsiliasi pendapatan kreator (Test payment)")}
        ${renderOrders(state.orders, "Pesanan aktif & dukungan pemain", false)}
      </div>
    </div>`;
  }

  function renderPublic(state: PackWorkspaceReply) {
    return `<div class="pack-grid">
      <section class="pack-card" aria-labelledby="public-catalog-heading">
        <h2 id="public-catalog-heading">Katalog paket kreator</h2>
        ${
          state.listings.length === 0
            ? "<p>Belum ada versi paket kreator yang sedang dijual.</p>"
            : state.listings
                .map(
                  (item) => `<article class="pack-card" data-listed-version="${item.version}">
                  <span class="pack-badge pack-badge-published">Terbit · v${item.version}</span>
                  <h3>${escapeText(item.title)}</h3>
                  <p>Oleh <strong>${escapeText(item.byline)}</strong></p>
                  <dl>
                    <dt>Harga satu sesi</dt><dd>${formatIdr(item.priceIdr)} (Test payment)</dd>
                    <dt>Titik awal</dt><dd>${escapeText(item.startName)}</dd>
                    <dt>Area &amp; durasi</dt><dd>${escapeText(item.areaSummary)} · ${item.durationMinutes} menit</dd>
                    <dt>Ukuran grup</dt><dd>Solo atau Berdua (${item.supportedPlayers.join("–")} pemain)</dd>
                    <dt>Biaya perjalanan</dt><dd>${escapeText(item.transitFaresNote)}</dd>
                  </dl>
                  <ul class="pack-list">
                    ${item.checkpoints
                      .map(
                        (cp) =>
                          `<li><strong>${escapeText(cp.name)}</strong> (${escapeText(cp.zone)}) · ${escapeText(cp.transit)}</li>`,
                      )
                      .join("")}
                  </ul>
                  <div class="pack-actions">
                    ${action(`Beli sesi uji coba (v${item.version})`, `order-${item.packId}-${item.version}`, "primary", busy)}
                    ${action(`Laporkan penutupan titik (v${item.version})`, `closure-${item.packId}-${item.version}`, "secondary", busy)}
                  </div>
                </article>`,
                )
                .join("")
        }
      </section>
      ${renderOrders(state.orders, "Pesanan saya & dukungan ruang", true)}
    </div>`;
  }

  function paint() {
    if (signal.aborted) return;
    root.querySelectorAll<HTMLButtonElement>("button[data-role]").forEach((btn) => {
      btn.setAttribute("aria-pressed", String(btn.dataset.role === activeRole));
    });
    feedbackEl.hidden = !feedback;
    feedbackEl.className = `pack-note ${feedbackError ? "pack-error" : ""}`;
    feedbackEl.textContent = feedback;

    if (!workspace) {
      view.innerHTML = '<p role="status">Memuat ruang kerja paket kreator…</p>';
      return;
    }
    view.innerHTML =
      activeRole === "writer"
        ? renderWriter(workspace)
        : activeRole === "reviewer"
          ? renderReviewer(workspace)
          : renderPublic(workspace);
  }

  async function loadRole(role: PackRole) {
    busy = true;
    activeRole = role;
    paint();
    try {
      const response = await fetch(`/api/packs?role=${role}`, {
        cache: "no-store",
        credentials: "same-origin",
        signal,
      });
      workspace = (await response.json()) as PackWorkspaceReply;
    } finally {
      busy = false;
      paint();
    }
  }

  type ClientPackAction = PackAction extends infer A
    ? A extends PackAction
      ? Omit<A, "actionId">
      : never
    : never;

  async function sendPackAction(payload: ClientPackAction, successNotice: string) {
    if (busy || signal.aborted) return;
    busy = true;
    feedback = "";
    feedbackError = false;
    paint();
    try {
      const response = await fetch(`/api/packs?role=${activeRole}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...payload, actionId: crypto.randomUUID() }),
        cache: "no-store",
        credentials: "same-origin",
        signal,
      });
      const reply = (await response.json()) as PackWorkspaceReply;
      workspace = reply;
      if (!response.ok || reply.error) {
        feedbackError = true;
        feedback =
          (reply.error && errorLabels[reply.error]) ??
          `Permintaan ditolak (${reply.error ?? response.status}).`;
      } else {
        feedbackError = false;
        feedback = successNotice;
      }
      announcement.textContent = feedback;
    } finally {
      busy = false;
      paint();
    }
  }

  root.addEventListener(
    "click",
    (event) => {
      const roleButton = (event.target as HTMLElement).closest<HTMLButtonElement>(
        "button[data-role]",
      );
      if (roleButton) {
        feedback = "";
        void loadRole(roleButton.dataset.role as PackRole);
        return;
      }
      const btn = (event.target as HTMLElement).closest<HTMLButtonElement>(
        "button[data-action]",
      );
      if (!btn) return;
      const act = btn.dataset.action!;
      if (act === "back") {
        returnToSetup();
        return;
      }

      if (act.startsWith("checkout-return:")) {
        const orderId = act.slice("checkout-return:".length);
        void sendPackAction(
          { type: "checkout-return", orderId },
          `Kembali dari checkout (${orderId}). Pembayaran belum lunas sehingga ruang belum dibuka.`,
        );
        return;
      }

      if (act.startsWith("verify-settlement:")) {
        const orderId = act.slice("verify-settlement:".length);
        void sendPackAction(
          { type: "verify-settlement", orderId, transactionStatus: "settlement" },
          `Pelunasan uji coba (${orderId}) terverifikasi. Satu ruang dan satu entri pendapatan dibuka.`,
        );
        return;
      }

      const match = act.match(/^(submit|changes|publish|pause|order|closure)-(.+)-(\d+)$/);
      if (!match) return;
      const [, kind, packId, versionText] = match;
      const version = Number(versionText);

      if (kind === "submit") {
        void sendPackAction(
          { type: "submit-draft", packId: packId!, version },
          `Draf v${version} diajukan ke peninjau editorial.`,
        );
      } else if (kind === "changes") {
        const input = root.querySelector<HTMLInputElement>("[data-review-note]");
        reviewNoteText = input?.value.trim() || reviewNoteText;
        void sendPackAction(
          {
            type: "request-changes",
            packId: packId!,
            version,
            note: reviewNoteText,
          },
          `Permintaan revisi dikirim untuk v${version}.`,
        );
      } else if (kind === "publish") {
        void sendPackAction(
          { type: "publish-version", packId: packId!, version },
          `Versi v${version} disetujui dan diterbitkan ke katalog publik.`,
        );
      } else if (kind === "pause") {
        const input = root.querySelector<HTMLInputElement>("[data-pause-reason]");
        pauseReasonText = input?.value.trim() || pauseReasonText;
        void sendPackAction(
          {
            type: "pause-version",
            packId: packId!,
            version,
            reason: pauseReasonText,
          },
          `Penjualan v${version} dijeda. Pesanan sebelumnya tetap tersimpan.`,
        );
      } else if (kind === "order") {
        void sendPackAction(
          { type: "create-order", packId: packId!, version, players: 2 },
          `Pesanan uji coba (Test payment) untuk v${version} dibuat dalam status menunggu pelunasan.`,
        );
      } else if (kind === "closure") {
        void sendPackAction(
          {
            type: "report-closure",
            packId: packId!,
            version,
            checkpointId: "taman-literasi",
            reason: "Balkon amfiteater Taman Literasi ditutup sementara.",
          },
          `Laporan penutupan titik Taman Literasi dikirim ke peninjau.`,
        );
      }
    },
    { signal },
  );

  root.addEventListener(
    "submit",
    (event) => {
      if (
        !(event.target instanceof HTMLFormElement) ||
        event.target.id !== "pack-draft-form"
      ) {
        return;
      }
      event.preventDefault();
      const bylineInput = root.querySelector<HTMLInputElement>("#pack-byline");
      const titleInput = root.querySelector<HTMLInputElement>("#pack-title-input");
      const priceInput = root.querySelector<HTMLInputElement>("#pack-price-input");
      const noteInput = root.querySelector<HTMLInputElement>("#pack-task-note");

      draftByline = bylineInput?.value.trim() || draftByline;
      draftTitle = titleInput?.value.trim() || draftTitle;
      draftPrice = Number(priceInput?.value || draftPrice);
      draftNote = noteInput?.value.trim() || draftNote;

      const tasks = defaultTasks.map((t, index) =>
        index === 0 ? { ...t, verificationNotes: draftNote } : { ...t },
      );
      const draft: PackDraftPayload = {
        packId: "pack-selatan-compact",
        byline: draftByline,
        title: draftTitle,
        format: "claim-the-city",
        board: "compact",
        supportedPlayers: [1, 2],
        priceIdr: draftPrice,
        tasks,
      };
      void sendPackAction(
        { type: "save-draft", draft },
        "Draf paket kreator disimpan secara pribadi.",
      );
    },
    { signal },
  );

  void loadRole(activeRole);

  return () => {
    mount.abort();
  };
}
