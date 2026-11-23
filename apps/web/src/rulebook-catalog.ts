import type { HideSeekCardCategory, HideSeekQuestionFamily, PackOrderSummary, RulebookFormat, RulebookPlayMode } from "@kelana-ria/contracts";
import { escapeText } from "./escape-text";
import jakartaCover from "./assets/jakarta.webp";
import "./rulebook-catalog.css";

const endpoint = "/api/rulebooks/catalog";
const cacheKey = "kelana-rulebook-catalog";
const formatNames = { "claim-the-city": "Claim the City", "hide-and-seek": "Hide & Seek" } as const;
const gameOverviews = {
  "claim-the-city": "Jelajahi landmark di peta. Check-in di lokasi, lalu selesaikan tantangan untuk mengunci landmark.",
  "hide-and-seek": "Bergantian jadi penyembunyi dan pencari. Ajukan pertanyaan untuk mempersempit area pencarian.",
} satisfies Record<RulebookFormat, string>;
export const clueNames: Record<HideSeekQuestionFamily, string> = {
  radar: "Radar", thermometer: "Termometer", matching: "Pencocokan", measuring: "Pengukuran", tentacles: "Tentakel", photo: "Foto",
};

export type PracticeCardExample = { title: string; description: string; kind: HideSeekCardCategory | "tactical" };
export const cardKindNames: Record<PracticeCardExample["kind"], string> = {
  time_bonus: "Bonus Waktu", powerup: "Powerup", curse: "Kutukan", tactical: "Kartu Taktis",
};

export type CatalogEdition = {
  packId: string;
  version: number;
  title: string;
  byline: string;
  summary: string;
  cityLabel: string;
  priceIdr: number;
  minPlayers: number;
  maxPlayers: number;
  startName: string;
  cardExamples?: PracticeCardExample[];
} & ({
  format: "claim-the-city";
  durationMinutes: number;
  durationMs?: number;
  checkInRadiusMeters: number;
  claimWeight?: number;
  lockWeight?: number;
  soloTargets: { lockedLandmarks: number; distinctZones: number } | null;
  tacticalDeckSummary?: {
    enabled: boolean;
    totalCards: number;
    maxHandSize: number;
    drawTriggers?: { onLock: boolean; onSteal: boolean; onBoldChallenge: boolean };
  };
} | {
  format: "hide-and-seek";
  headStartMinutes: number;
  searchLimitMinutes: number;
  regroupMinutes: number;
  headStartMs?: number;
  searchLimitMs?: number;
  objectiveResponseMs: number;
  photoResponseMs: number;
  drawDecisionMs?: number;
  questionFamilies: { family: HideSeekQuestionFamily; drawCount: number; keepCount: number }[];
  deckSummary?: { totalCards: number; baseHandLimit: number };
});
type Edition = CatalogEdition;

type Catalog = { editions: Edition[]; allowSandboxCheckout: boolean };
type Attempt = { id: string; order?: PackOrderSummary };
type CheckoutReply = { error?: string; roomCode?: string; order?: PackOrderSummary; pass?: { roomCode: string } };
type Options = {
  navigate: (href: string) => void;
  openRoom: (format: RulebookFormat, code: string) => void;
  openPractice: (edition: Edition, mode: RulebookPlayMode) => Promise<void>;
  openStudio: () => void;
};

const messages: Record<string, string> = {
  "pack-unavailable": "Edisi ini sudah tidak tersedia. Pilih edisi lain dari katalog.",
  "mode-unavailable": "Mode ini tidak tersedia untuk edisi ini. Pilih mode lain.",
  "payment-provider-unavailable": "Pembayaran belum bisa diperiksa. Coba lagi sebentar.",
  "payment-pending": "Pembayaran masih menunggu konfirmasi. Cek kembali setelah selesai.",
  "payment-review": "Pembayaran sedang diperiksa. Cek statusnya lagi sebentar.",
  "checkout-unavailable": "Edisi berbayar belum bisa dibeli pada uji publik ini.",
  "order-expired": "Waktu pembayaran habis. Kamu bisa membuat pesanan baru.",
  "payment-expire": "Waktu pembayaran habis. Kamu bisa membuat pesanan baru.",
  "payment-cancel": "Pembayaran dibatalkan. Kamu bisa membuat pesanan baru.",
  "payment-deny": "Pembayaran ditolak. Coba dengan pesanan baru.",
  "order-not-found": "Pesanan belum bisa ditemukan. Coba periksa kembali.",
};
const endedPayments = new Set(["order-expired", "payment-expire", "payment-cancel", "payment-deny", "payment-failure"]);

function readStored<T>(key: string): T | undefined {
  try {
    const value = sessionStorage.getItem(key);
    return value ? JSON.parse(value) as T : undefined;
  } catch {
    return undefined;
  }
}

function store(key: string, value: unknown) {
  try {
    if (value === undefined) sessionStorage.removeItem(key);
    else sessionStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Browsing still works if the browser blocks storage.
  }
}

function detailHref(item: Edition) {
  return `/?${new URLSearchParams({ edition: item.packId, version: String(item.version) })}`;
}

function price(item: Edition) {
  return item.priceIdr === 0 ? "Gratis" : `Rp${item.priceIdr.toLocaleString("id-ID")}`;
}

export function playerRange(minimum: number, maximum: number) {
  return `${minimum === maximum ? minimum : `${minimum}–${maximum}`} pemain`;
}

function roundTime(item: Edition) {
  return item.format === "claim-the-city"
    ? `${item.durationMinutes} mnt`
    : `${item.searchLimitMinutes} mnt/pencarian`;
}

function editionTitle(item: Edition) {
  const separator = ` · ${formatNames[item.format]}`;
  const index = item.title.lastIndexOf(separator);
  const suffix = item.title.slice(index + separator.length);
  return index > 0 && (suffix === "" || /^ \([^)]+\)$/.test(suffix))
    ? item.title.slice(0, index) + suffix
    : item.title;
}

function cover(item: Edition) {
  return item.cityLabel.toLocaleLowerCase("id-ID").includes("jakarta")
    ? `<img src="${jakartaCover}" alt="" width="800" height="550">`
    : "";
}

function catalogCard(item: Edition) {
  return `<a class="cat-card" href="${escapeText(detailHref(item))}" data-catalog-link
      data-pack-id="${escapeText(item.packId)}" data-version="${item.version}">
    <div class="cat-cover ${item.format}">${cover(item)}<span>${escapeText(item.cityLabel)}</span></div>
    <div class="cat-card-copy">
      <h3>${escapeText(editionTitle(item))}</h3>
      <p>v${item.version} · ${playerRange(item.minPlayers, item.maxPlayers)}</p>
      <div class="cat-card-footer"><span>${roundTime(item)}</span><strong>${price(item)} <span aria-hidden="true">›</span></strong></div>
    </div>
  </a>`;
}

function facts(item: Edition, mode: RulebookPlayMode) {
  const players = mode === "solo" ? "1 pemain · Solo" : playerRange(Math.max(2, item.minPlayers), item.maxPlayers);
  const durations = item.format === "claim-the-city"
    ? [["Durasi ronde", `${item.durationMinutes} menit`]]
    : [
        ["Waktu sembunyi", `${item.headStartMinutes} menit`],
        ["Batas mencari", `${item.searchLimitMinutes} menit`],
        ["Waktu berkumpul", `${item.regroupMinutes} menit`],
      ];
  const deck = item.format === "claim-the-city"
    ? (item.tacticalDeckSummary?.enabled ? item.tacticalDeckSummary.totalCards : 0)
    : item.deckSummary?.totalCards;
  const mechanics: string[][] = [];
  if (deck) mechanics.push(["Dek", `${deck} kartu`]);
  if (deck && item.cardExamples?.length) {
    mechanics.push(["Jenis kartu", item.cardExamples.map(card => cardKindNames[card.kind]).join(", ")]);
  }
  if (item.format === "hide-and-seek" && item.questionFamilies?.length) {
    mechanics.push(["Petunjuk", item.questionFamilies.map(({ family }) => clueNames[family]).filter(Boolean).join(", ")]);
  }
  return [["Titik awal", item.startName], ["Pemain", players], ...durations, ...mechanics, ["Harga per sesi", price(item)]]
    .map(([label, value]) => `<div><dt>${label}</dt><dd>${escapeText(value)}</dd></div>`).join("");
}

function objective(item: Edition, mode: RulebookPlayMode) {
  if (item.format === "hide-and-seek") return "Waktu sembunyi akhir terlama menang.";
  if (mode === "solo" && item.soloTargets) {
    return `Kunci ${item.soloTargets.lockedLandmarks} landmark di setidaknya ${item.soloTargets.distinctZones} zona sebelum waktu habis.`;
  }
  return "Kuasai zona terbanyak.";
}

function action(type: string, label: string, style = "secondary", disabled = false) {
  return `<button type="button" class="${style}" data-cat-action="${type}" ${disabled ? "disabled" : ""}>${label}</button>`;
}

export function mountRulebookCatalog(root: HTMLElement, options: Options, focusHeading = false) {
  const lifetime = new AbortController();
  const { signal } = lifetime;
  const params = new URLSearchParams(location.search);
  const pack = params.get("edition");
  const version = Number(params.get("version"));
  let mode: RulebookPlayMode = params.get("mode") === "group" ? "group" : "solo";
  let catalog = readStored<Catalog>(cacheKey);
  let fresh = false;
  let loading = true;
  let busy = false;
  let failed = false;
  let message = "";
  let toast = false;
  let loadSequence = 0;

  const selected = () => catalog?.editions.find(item => item.packId === pack && item.version === version);
  const attemptKey = () => `kelana-catalog-attempt:${JSON.stringify([pack, version, mode])}`;
  const attempts = new Map<string, Attempt>();
  const getAttempt = () => attempts.get(attemptKey()) ?? readStored<Attempt>(attemptKey());
  function setAttempt(value?: Attempt) {
    const key = attemptKey();
    if (value) attempts.set(key, value);
    else attempts.delete(key);
    store(key, value);
  }

  function payment(item: Edition) {
    if (!catalog?.allowSandboxCheckout) {
      return fresh ? '<p class="cat-message" role="status">Edisi berbayar belum bisa dibeli pada uji publik ini.</p>' : "";
    }
    const order = getAttempt()?.order;
    if (!order) return action("buy", "Beli sesi · Uji pembayaran", "primary", busy || !fresh);
    const redirect = order.snapRedirectUrl;
    const payLink = order.paymentMode === "midtrans-sandbox" && redirect?.startsWith("https://")
      ? `<a class="cat-link" href="${escapeText(redirect)}" target="_blank" rel="noopener noreferrer">Buka pembayaran uji</a>`
      : "";
    return `<section class="cat-box" aria-label="Pembayaran uji">
      <h2>Pembayaran uji</h2>
      <p role="status">${price(item)} · Menunggu konfirmasi pembayaran</p>
      ${payLink}
      ${action("check-payment", "Cek status pembayaran", "secondary", busy || !fresh)}
      ${order.paymentMode === "recorded-sandbox" ? action("simulate-payment", "Simulasikan pembayaran berhasil", "primary", busy || !fresh) : ""}
    </section>`;
  }

  function render() {
    if (signal.aborted) return;
    const item = selected();
    if (item?.format === "hide-and-seek" || (item && item.minPlayers > 1)) mode = "group";
    if (item?.maxPlayers === 1) mode = "solo";
    const offline = failed
      ? `<div class="cat-message" role="status">Katalog belum bisa diperbarui. Periksa koneksi. ${action("retry", "Coba lagi")}</div>`
      : "";
    const status = message ? toast
      ? `<div class="cat-toast"><span role="alert">${escapeText(message)}</span>
          <button type="button" data-cat-action="dismiss" aria-label="Tutup pemberitahuan">×</button></div>`
      : `<p class="cat-message" role="alert">${escapeText(message)}</p>` : "";
    if (pack) {
      const back = '<a class="cat-back" href="/" data-catalog-link>‹ Katalog</a>';
      document.title = item ? `${item.title} · Kelana Ria` : "Edisi · Kelana Ria";
      root.innerHTML = item ? `<article class="cat-detail" aria-label="Detail edisi">
        ${back}
        <div class="cat-cover cat-hero ${item.format}">${cover(item)}
          <div class="cat-hero-copy"><span>${escapeText(formatNames[item.format])} · v${item.version}</span>
          <h1>${escapeText(editionTitle(item))}</h1><p>${escapeText(item.cityLabel)}</p></div>
        </div>
        ${item.format === "claim-the-city" && item.minPlayers === 1 && item.maxPlayers > 1 ? `<div class="cat-modes" role="group" aria-label="Mode permainan">
          ${(["solo", "group"] as const).map(choice => `<button type="button" class="secondary" data-cat-action="${choice}"
            aria-pressed="${mode === choice}" ${busy ? "disabled" : ""}>${choice === "solo" ? "Solo" : "Grup"}</button>`).join("")}
        </div>` : ""}
        <section class="cat-box"><h2>Cara bermain</h2><p>${gameOverviews[item.format]}</p></section>
        ${item.summary ? `<p class="cat-description">${escapeText(item.summary)}</p>` : ""}
        ${item.byline ? `<p class="cat-byline">Oleh ${escapeText(item.byline)}</p>` : ""}
        <section class="cat-rules" aria-label="Aturan edisi">
          <h2>Aturan edisi</h2><p>${objective(item, mode)}</p>
          <dl class="cat-facts">${facts(item, mode)}</dl>
        </section>
        ${offline}${status}
        <div class="cat-actions" aria-busy="${busy}">
          ${action("practice", "Coba Panduan")}
          ${item.priceIdr === 0
            ? action("play", mode === "solo" ? "Main Solo" : "Main Grup", "primary", busy || !fresh)
            : payment(item)}
        </div>
      </article>` : `<article class="cat-detail">${back}<h1>Edisi permainan</h1>
        ${loading ? '<p role="status">Memuat edisi…</p>' : offline || '<p role="alert">Edisi ini tidak tersedia. Pilih edisi lain dari katalog.</p>'}</article>`;
      focusTitle();
      return;
    }
    document.title = "Pilih permainan · Kelana Ria";
    const editions = catalog?.editions;
    root.innerHTML = `<div class="catalog-top"><div><h1>Pilih permainan</h1>
      <p class="intro">Jelajahi kota lewat misi dan kartu.</p></div>
      <div class="catalog-links"><a class="cat-link" href="/?recaps=1">Riwayat pertandingan</a>
      <button type="button" id="chooser-studio" class="secondary" data-cat-action="studio">Studio Kreator</button></div></div>
      ${offline}
      ${editions ? (Object.keys(formatNames) as RulebookFormat[]).map(format => {
        const cards = editions.filter(edition => edition.format === format);
        return cards.length ? `<section class="catalog-group" aria-labelledby="catalog-${format}">
          <h2 id="catalog-${format}"><span aria-hidden="true" class="cat-mark ${format}">${format === "claim-the-city" ? "◆" : "◎"}</span>${escapeText(formatNames[format])}</h2>
          <div class="catalog-grid">${cards.map(catalogCard).join("")}</div>
        </section>` : "";
      }).join("") + (editions.length ? "" : '<p role="status">Belum ada edisi yang bisa dimainkan.</p>')
        : loading ? '<p class="catalog-loading" role="status">Memuat katalog…</p>' : ""}`;
    focusTitle();
  }

  function focusTitle() {
    if (!focusHeading || (pack && !selected() && loading)) return;
    focusHeading = false;
    const heading = root.querySelector<HTMLElement>("h1");
    if (heading) {
      heading.tabIndex = -1;
      heading.focus();
    }
  }

  async function load() {
    const sequence = ++loadSequence;
    try {
      const res = await fetch(endpoint, { signal, headers: { Accept: "application/json" } });
      if (!res.ok) throw new Error();
      const data = await res.json() as Catalog;
      if (!Array.isArray(data.editions)) throw new Error();
      if (signal.aborted || sequence !== loadSequence) return;
      catalog = data;
      fresh = true;
      failed = false;
      store(cacheKey, data);
    } catch {
      if (signal.aborted || sequence !== loadSequence) return;
      failed = true;
      fresh = false;
    }
    loading = false;
    render();
  }

  async function submit(type: string, item: Edition) {
    if (!fresh || busy) return;
    let attempt = getAttempt();
    if (!attempt) {
      attempt = { id: crypto.randomUUID() };
      setAttempt(attempt);
    }
    busy = true;
    message = "";
    toast = false;
    render();
    try {
      const res = await fetch(endpoint, {
        method: "POST", headers: { "content-type": "application/json" }, signal,
        body: JSON.stringify({ type, edition: item.packId, version: item.version, mode, requestId: attempt.id }),
      });
      const reply = await res.json() as CheckoutReply;
      if (signal.aborted) return;
      if (reply.error || !res.ok) {
        if (reply.error && endedPayments.has(reply.error)) setAttempt();
        message = messages[reply.error ?? ""] ?? "Aksi belum berhasil. Coba lagi.";
        return;
      }
      const code = reply.roomCode ?? reply.pass?.roomCode ?? reply.order?.roomCode;
      if (code) {
        setAttempt();
        options.openRoom(item.format, code);
      } else if (reply.order) {
        setAttempt({ ...attempt, order: reply.order });
      }
    } catch {
      if (!signal.aborted) {
        message = "Koneksi terputus. Periksa koneksi lalu coba lagi.";
        toast = true;
      }
    } finally {
      if (!signal.aborted) {
        busy = false;
        render();
        (root.querySelector<HTMLElement>(`[data-cat-action="${type}"]:not([disabled])`) ??
          root.querySelector<HTMLElement>('[data-cat-action="check-payment"]'))?.focus();
      }
    }
  }

  root.addEventListener("click", event => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const link = target.closest<HTMLAnchorElement>("[data-catalog-link]");
    if (link && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey) {
      event.preventDefault();
      options.navigate(link.href);
      return;
    }
    const control = target.closest<HTMLButtonElement>("[data-cat-action]");
    const type = control?.dataset.catAction;
    if (type === "studio") return options.openStudio();
    if (type === "retry") return void load();
    if (type === "dismiss") {
      message = "";
      render();
      root.querySelector<HTMLElement>('[data-cat-action="play"], [data-cat-action="buy"], [data-cat-action="check-payment"]')?.focus();
      return;
    }
    const item = selected();
    if (!item || !type || control.disabled || busy) return;
    if (type === "practice") {
      void options.openPractice(item, mode).catch(() => {
        if (signal.aborted) return;
        message = "Panduan belum bisa dibuka. Periksa koneksi lalu coba lagi.";
        toast = true;
        render();
        root.querySelector<HTMLElement>('[data-cat-action="practice"]')?.focus();
      });
      return;
    }
    if (type === "solo" || type === "group") {
      mode = type;
      const url = new URL(location.href);
      url.searchParams.set("mode", mode);
      history.replaceState(history.state, "", url);
      message = "";
      render();
      root.querySelector<HTMLElement>(`[data-cat-action="${type}"]`)?.focus();
      return;
    }
    void submit(type, item);
  }, { signal });
  window.addEventListener("online", () => void load(), { signal });
  render();
  void load();
  return () => lifetime.abort();
}
