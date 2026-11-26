import type {
  ActiveRulebookRoomPhase,
  ActiveRulebookRoomSummary,
  AuthMeReply,
  HideSeekCardCategory,
  HideSeekQuestionFamily,
  PackOrderSummary,
  PublicMatchRecapSummary,
  RulebookEntitlementSummary,
  RulebookFormat,
  RulebookPlayMode,
} from "@kelana-ria/contracts";
import {
  dismissActiveRoom,
  readStoredActiveRoom,
  reconcileActiveRoomsFromServer,
  saveActiveRoom,
} from "./active-room-storage";
import {
  getCachedAuth,
  hydrateAuthFromCatalog,
  onAuthChange,
  openAuthModal,
  renderAccountChip,
} from "./auth-modal";
import { escapeText } from "./escape-text";
import { fetchApiJson, resolvePlayerError, type PlayerErrorTone } from "./player-errors";
import { createPlayerToast, renderInlineAlert } from "./player-toast";
import jakartaCover from "./assets/jakarta.webp";
import "./rulebook-catalog.css";

const endpoint = "/api/rulebooks/catalog";
const cacheKey = "kelana-rulebook-catalog";
const formatNames = { "claim-the-city": "Claim the City", "hide-and-seek": "Hide & Seek" } as const;
const resumePhaseLabels: Record<ActiveRulebookRoomPhase, string> = {
  lobby: "Ruang Tunggu",
  active: "Ronde Aktif",
  head_start: "Waktu Sembunyi",
  seeking: "Fase Cari",
  endgame: "Endgame",
  regroup: "Berkumpul Kembali",
};
const recapDate = new Intl.DateTimeFormat("id-ID", { dateStyle: "medium" });
const gameOverviews = {
  "claim-the-city": "Jelajahi landmark di peta. Check-in di lokasi, lalu selesaikan tantangan untuk mengunci landmark.",
  "hide-and-seek": "Bergantian jadi penyembunyi dan pencari. Ajukan pertanyaan untuk mempersempit area pencarian.",
} satisfies Record<RulebookFormat, string>;
export const clueNames: Record<HideSeekQuestionFamily, string> = {
  radar: "Radar", thermometer: "Termometer", matching: "Cocokkan", measuring: "Bandingkan", tentacles: "Tempat Terdekat", photo: "Foto",
};

export type PracticeCardExample = { title: string; description: string; kind: HideSeekCardCategory | "tactical" };
export const cardKindNames: Record<PracticeCardExample["kind"], string> = {
  time_bonus: "Bonus Waktu", powerup: "Powerup", curse: "Kutukan", tactical: "Kartu",
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

type Catalog = {
  editions: Edition[];
  sharedRecaps?: PublicMatchRecapSummary[];
  activeRooms?: ActiveRulebookRoomSummary[];
  ownedPackIds?: string[];
  entitlements?: RulebookEntitlementSummary[];
  allowSandboxCheckout: boolean;
  auth?: AuthMeReply;
};
type Attempt = { id: string; order?: PackOrderSummary };
type CheckoutReply = {
  error?: string;
  roomCode?: string;
  order?: PackOrderSummary;
  pass?: { roomCode: string; entitlementId?: string };
  entitlement?: RulebookEntitlementSummary;
};
type Options = {
  navigate: (href: string) => void;
  openRoom: (format: RulebookFormat, code: string) => void;
  openPractice: (edition: Edition, mode: RulebookPlayMode) => Promise<void>;
  openStudio: () => void;
};

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

function cleanTitle(title: string, format: RulebookFormat) {
  const separator = ` · ${formatNames[format]}`;
  const index = title.lastIndexOf(separator);
  const suffix = title.slice(index + separator.length);
  return index > 0 && (suffix === "" || /^ \([^)]+\)$/.test(suffix))
    ? title.slice(0, index) + suffix
    : title;
}

function editionTitle(item: Edition) {
  return cleanTitle(item.title, item.format);
}

function renderResumeBanner(room: ActiveRulebookRoomSummary) {
  const title = cleanTitle(room.title, room.format);
  const meta = [
    `v${room.version}`,
    room.format === "claim-the-city"
      ? (room.role === "solo" ? "Solo" : "Grup")
      : (room.turnNumber && room.totalPlannedTurns ? `Giliran ${room.turnNumber}/${room.totalPlannedTurns}` : ""),
    room.role === "hider" ? "Penyembunyi" : room.role === "seeker" ? "Pencari" : "",
    room.role !== "solo" && room.playerCount && room.maxPlayers ? `${room.playerCount}/${room.maxPlayers} pemain` : "",
  ].filter(Boolean).join(" · ");
  return `<section class="cat-resume" aria-label="Permainan sedang berlangsung" data-testid="resume-room-banner" data-room-code="${escapeText(room.roomCode)}" data-format="${room.format}">
    <div class="cat-resume-head">
      <div class="cat-resume-badges">
        <span class="cat-resume-format ${room.format}"><span aria-hidden="true">${room.format === "claim-the-city" ? "◆" : "◎"}</span> ${escapeText(formatNames[room.format])}</span>
        <span class="cat-resume-badge">Ruang ${escapeText(room.roomCode)}</span>
        <span class="cat-resume-badge">${escapeText(resumePhaseLabels[room.phase])}</span>
      </div>
      <button type="button" class="secondary cat-resume-dismiss" data-cat-action="dismiss-resume" data-room-code="${escapeText(room.roomCode)}" aria-label="Tutup sesi ${escapeText(room.roomCode)}">Tutup</button>
    </div>
    <div class="cat-resume-body">
      <div class="cat-resume-copy">
        <h2>${escapeText(title)}</h2>
        <p>${escapeText(meta)}</p>
      </div>
      <button type="button" class="primary cat-resume-cta" data-cat-action="resume-room" data-room-code="${escapeText(room.roomCode)}" data-format="${room.format}">Lanjutkan Permainan</button>
    </div>
  </section>`;
}

function cover(item: Edition) {
  return item.cityLabel.toLocaleLowerCase("id-ID").includes("jakarta")
    ? `<img src="${jakartaCover}" alt="" width="800" height="550">`
    : "";
}

function ownedBadge(extraClass = "") {
  const cls = extraClass ? `cat-owned-badge ${extraClass}` : "cat-owned-badge";
  return `<span class="${cls}" data-testid="owned-badge"><span class="cat-owned-mark" aria-hidden="true">✓</span> Dimiliki</span>`;
}

function catalogCard(item: Edition, owned: boolean) {
  const footerPrice = item.priceIdr === 0
    ? "Gratis"
    : owned
      ? "Dimiliki"
      : `${price(item)} · Beli sekali`;
  return `<a class="cat-card" href="${escapeText(detailHref(item))}" data-catalog-link
      data-pack-id="${escapeText(item.packId)}" data-version="${item.version}">
    <div class="cat-cover ${item.format}">${cover(item)}<div class="cat-cover-tags"><span class="cat-cover-city">${escapeText(item.cityLabel)}</span>${item.priceIdr > 0 && owned ? ownedBadge() : ""}</div></div>
    <div class="cat-card-copy">
      <h3>${escapeText(editionTitle(item))}</h3>
      <p>v${item.version} · ${playerRange(item.minPlayers, item.maxPlayers)}</p>
      <div class="cat-card-footer"><span>${roundTime(item)}</span><strong>${escapeText(footerPrice)} <span aria-hidden="true">›</span></strong></div>
    </div>
  </a>`;
}

function facts(item: Edition, mode: RulebookPlayMode, owned: boolean) {
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
  const priceFact = item.priceIdr === 0
    ? "Gratis"
    : owned
      ? `${price(item)} · Dimiliki`
      : `${price(item)} · Beli sekali`;
  return [["Titik awal", item.startName], ["Pemain", players], ...durations, ...mechanics, ["Harga paket", priceFact]]
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

function communityResults(item: Edition, sharedRecaps: PublicMatchRecapSummary[] | undefined) {
  const matches = (sharedRecaps ?? []).filter(
    recap => recap.packId === item.packId && recap.editionVersion === item.version,
  );
  return `<section class="cat-community" aria-label="Hasil komunitas">
    <div class="cat-community-head">
      <h2>Hasil komunitas</h2>
      <span>v${item.version} · ${matches.length} dibagikan</span>
    </div>
    ${matches.length
      ? `<ul class="cat-community-list">${matches.map(entry => `<li>
          <a class="cat-recap-card" href="/?shared=${encodeURIComponent(entry.shareId)}" data-catalog-link data-share-id="${escapeText(entry.shareId)}">
            <div class="cat-recap-top">
              <strong>${escapeText(entry.outcomeLabel)}</strong>
              <span>${escapeText(formatNames[entry.format])} · v${entry.editionVersion}${entry.simulated ? " · QA" : ""} · ${recapDate.format(entry.completedAt)}</span>
            </div>
            <p class="cat-recap-score">${escapeText(entry.scoreSummary)}</p>
            ${entry.topMoment ? `<p class="cat-recap-moment">${escapeText(entry.topMoment.label)} · ${escapeText(entry.topMoment.detail)}</p>` : ""}
          </a>
        </li>`).join("")}</ul>`
      : `<p class="cat-community-empty">Belum ada hasil pertandingan yang dibagikan untuk edisi v${item.version}. Selesaikan ronde, lalu bagikan dari Riwayat.</p>`}
  </section>`;
}

export function mountRulebookCatalog(root: HTMLElement, options: Options, focusHeading = false) {
  const lifetime = new AbortController();
  const { signal } = lifetime;
  const toast = createPlayerToast({ signal, layout: "page" });
  const params = new URLSearchParams(location.search);
  const pack = params.get("edition");
  const version = Number(params.get("version"));
  let mode: RulebookPlayMode = params.get("mode") === "group" ? "group" : "solo";
  let catalog = readStored<Catalog>(cacheKey);
  let authState: AuthMeReply | null = hydrateAuthFromCatalog(catalog?.auth) ?? getCachedAuth();
  let activeRoom = readStoredActiveRoom() ?? (catalog?.activeRooms ? reconcileActiveRoomsFromServer(catalog.activeRooms) : undefined);
  let fresh = false;
  let loading = true;
  let busy = false;
  let failed = false;
  let inlineError: { message: string; tone: PlayerErrorTone; area: "payment" | "screen" } | null = null;
  let loadSequence = 0;

  const selected = () => catalog?.editions.find(item => item.packId === pack && item.version === version);
  const isOwned = (packId: string) => Boolean(catalog?.ownedPackIds?.includes(packId));
  const entitlementFor = (packId: string) => catalog?.entitlements?.find(entry => entry.packId === packId);

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
    if (!order) {
      return action("buy", "Beli paket · Uji pembayaran", "primary", busy || !fresh);
    }
    const redirect = order.snapRedirectUrl;
    const payLink = order.paymentMode === "midtrans-sandbox" && redirect?.startsWith("https://")
      ? `<a class="cat-link" href="${escapeText(redirect)}" target="_blank" rel="noopener noreferrer">Buka pembayaran uji</a>`
      : "";
    const paymentAlert = inlineError?.area === "payment"
      ? renderInlineAlert(inlineError.message, inlineError.tone, 'data-testid="payment-inline-alert"')
      : "";
    return `<section class="cat-box" aria-label="Pembayaran uji">
      <h2>Pembayaran uji</h2>
      <p role="status">${escapeText(price(item))} · Beli sekali · Menunggu konfirmasi pembayaran</p>
      ${paymentAlert}
      ${payLink}
      ${action("check-payment", "Cek status pembayaran", "secondary", busy || !fresh)}
      ${order.paymentMode === "recorded-sandbox" ? action("simulate-payment", "Simulasikan pembayaran berhasil", "primary", busy || !fresh) : ""}
    </section>`;
  }

  function renderDetailActions(item: Edition, owned: boolean) {
    if (item.priceIdr === 0) {
      return `${action("practice", "Coba Panduan")}${action("play", mode === "solo" ? "Main Solo" : "Main Grup", "primary", busy || !fresh)}`;
    }
    if (owned) {
      const ent = entitlementFor(item.packId);
      const launchCta = ent?.activeRoomCode
        ? `<button type="button" class="primary" data-cat-action="resume-room" data-room-code="${escapeText(ent.activeRoomCode)}" data-format="${item.format}" ${busy || !fresh ? "disabled" : ""}>Lanjutkan Ruang (${escapeText(ent.activeRoomCode)})</button>`
        : action("play", mode === "solo" ? "Main Solo" : "Main Grup", "primary", busy || !fresh);
      return `${action("practice", "Coba Panduan")}${launchCta}`;
    }
    return `${action("practice", "Coba Panduan")}${payment(item)}`;
  }

  function render() {
    if (signal.aborted) return;
    const item = selected();
    if (item?.format === "hide-and-seek" || (item && item.minPlayers > 1)) mode = "group";
    if (item?.maxPlayers === 1) mode = "solo";
    const owned = item ? isOwned(item.packId) : false;
    const offline = failed
      ? `<div class="cat-message" role="status">Katalog belum bisa diperbarui. Periksa koneksi. ${action("retry", "Coba lagi")}</div>`
      : "";
    const hasPaymentOrder = Boolean(item && item.priceIdr > 0 && !owned && catalog?.allowSandboxCheckout && getAttempt()?.order);
    const screenAlert = inlineError && !(inlineError.area === "payment" && hasPaymentOrder)
      ? renderInlineAlert(inlineError.message, inlineError.tone)
      : "";
    if (pack) {
      const back = '<a class="cat-back" href="/" data-catalog-link>‹ Katalog</a>';
      document.title = item ? `${item.title} · Kelana Ria` : "Edisi · Kelana Ria";
      root.innerHTML = item ? `<article class="cat-detail" aria-label="Detail edisi">
        <div class="catalog-top">${back}${renderAccountChip(authState)}</div>
        <div class="cat-cover cat-hero ${item.format}">${cover(item)}
          <div class="cat-hero-copy"><div class="cat-hero-badges"><span class="cat-hero-tag">${escapeText(formatNames[item.format])} · v${item.version}</span>${item.priceIdr > 0 && owned ? ownedBadge("cat-owned-badge--hero") : ""}</div>
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
          <dl class="cat-facts">${facts(item, mode, owned)}</dl>
        </section>
        ${offline}${screenAlert}
        <div class="cat-actions" aria-busy="${busy}">
          ${renderDetailActions(item, owned)}
        </div>
        ${communityResults(item, catalog?.sharedRecaps)}
      </article>` : `<article class="cat-detail">${back}<h1>Edisi permainan</h1>
        ${loading ? '<p role="status">Memuat edisi…</p>' : offline || renderInlineAlert("Edisi ini tidak tersedia. Pilih edisi lain dari katalog.", "warn")}</article>`;
      focusTitle();
      return;
    }
    document.title = "Pilih permainan · Kelana Ria";
    const editions = catalog?.editions;
    root.innerHTML = `<div class="catalog-top"><div><h1>Pilih permainan</h1>
      <p class="intro">Jelajahi kota lewat misi dan kartu.</p></div>
      <div class="catalog-links"><a class="cat-link" href="/?recaps=1">Riwayat pertandingan</a>
      ${renderAccountChip(authState)}
      <button type="button" id="chooser-studio" class="secondary" data-cat-action="studio">Studio Kreator</button></div></div>
      ${activeRoom ? renderResumeBanner(activeRoom) : ""}
      ${offline}
      ${editions ? (Object.keys(formatNames) as RulebookFormat[]).map(format => {
        const cards = editions.filter(edition => edition.format === format);
        return cards.length ? `<section class="catalog-group" aria-labelledby="catalog-${format}">
          <h2 id="catalog-${format}"><span aria-hidden="true" class="cat-mark ${format}">${format === "claim-the-city" ? "◆" : "◎"}</span>${escapeText(formatNames[format])}</h2>
          <div class="catalog-grid">${cards.map(edition => catalogCard(edition, isOwned(edition.packId))).join("")}</div>
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
      const { ok, data } = await fetchApiJson<Catalog>(endpoint, { signal });
      if (!ok || !Array.isArray(data.editions)) throw new Error("catalog-invalid");
      if (signal.aborted || sequence !== loadSequence) return;
      catalog = data;
      if (data.auth) {
        authState = hydrateAuthFromCatalog(data.auth);
      }
      if (Array.isArray(data.activeRooms)) {
        activeRoom = reconcileActiveRoomsFromServer(data.activeRooms);
      }
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

  function applyCatalogError(input: unknown, item: Edition, type: string) {
    const surface = item.priceIdr > 0 ? "checkout" : "catalog";
    const resolved = resolvePlayerError(input, {
      surface,
      action: type,
      target: `${item.packId}@${item.version}`,
    });
    if (resolved.endedPayment) setAttempt();
    if (resolved.placement === "toast") {
      inlineError = null;
      toast.show(resolved);
    } else {
      toast.clear();
      const area = item.priceIdr > 0 && Boolean(getAttempt()?.order) ? "payment" : "screen";
      inlineError = { message: resolved.message, tone: resolved.tone, area };
    }
  }

  let handlingSignInAction = false;

  function promptCheckoutSignIn(item: Edition) {
    handlingSignInAction = true;
    openAuthModal({
      reason: "Masuk dengan email agar paket tersimpan permanen di akunmu.",
      ownedCount: catalog?.ownedPackIds?.length ?? 0,
      onSignedIn: async () => {
        if (signal.aborted) {
          handlingSignInAction = false;
          return;
        }
        try {
          setAttempt();
          await load();
          if (signal.aborted) return;
          const latest = selected();
          if (latest && latest.packId === item.packId && !isOwned(latest.packId)) {
            void submit("buy", latest);
          }
        } finally {
          handlingSignInAction = false;
        }
      },
      onClose: () => {
        if (!authState?.authenticated) handlingSignInAction = false;
      },
    });
  }

  async function submit(type: string, item: Edition) {
    if (!fresh || busy) return;
    if ((type === "buy" || type === "check-payment" || type === "simulate-payment") && !authState?.authenticated) {
      promptCheckoutSignIn(item);
      return;
    }
    let attempt = getAttempt();
    if (!attempt) {
      attempt = { id: crypto.randomUUID() };
      setAttempt(attempt);
    }
    busy = true;
    inlineError = null;
    render();
    try {
      const { ok, status, data: reply } = await fetchApiJson<CheckoutReply>(endpoint, {
        signal,
        body: { type, edition: item.packId, version: item.version, mode, requestId: attempt.id },
      });
      if (signal.aborted) return;
      if (status === 401 || reply.error === "auth-required") {
        authState = { authenticated: false, user: null, allowSandboxOtp: Boolean(authState?.allowSandboxOtp) };
        promptCheckoutSignIn(item);
        return;
      }
      if (reply.error || !ok) {
        if (reply.error === "pack-already-owned") setAttempt();
        applyCatalogError({ error: reply.error, status }, item, type);
        if (reply.error === "pack-already-owned" || reply.error === "entitlement-active-room-exists") {
          void load();
        }
        return;
      }
      toast.clear();
      toast.resetDedupe();
      const code = reply.roomCode ?? reply.pass?.roomCode ?? reply.order?.roomCode;
      if (code) {
        setAttempt();
        saveActiveRoom({
          roomCode: code,
          format: item.format,
          packId: item.packId,
          version: item.version,
          title: item.title,
          phase: "lobby",
          role: item.format === "claim-the-city" ? mode : "none",
        });
        options.openRoom(item.format, code);
      } else if (reply.order) {
        setAttempt({ ...attempt, order: reply.order });
      }
    } catch (error) {
      if (!signal.aborted) {
        applyCatalogError(error, item, type);
      }
    } finally {
      if (!signal.aborted) {
        busy = false;
        render();
        (root.querySelector<HTMLElement>(`[data-cat-action="${type}"]:not([disabled])`) ??
          root.querySelector<HTMLElement>('[data-cat-action="check-payment"]'))?.focus({ preventScroll: true });
      }
    }
  }

  onAuthChange((next) => {
    authState = next;
    if (handlingSignInAction) return;
    setAttempt();
    void load();
  }, signal);

  root.addEventListener("click", event => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const authBtn = target.closest<HTMLButtonElement>("[data-auth-action]");
    if (authBtn) {
      const authAction = authBtn.dataset.authAction;
      if (authAction === "open-account" && authState?.authenticated) {
        openAuthModal({
          mode: "account",
          ownedCount: catalog?.ownedPackIds?.length ?? 0,
        });
      } else {
        openAuthModal({
          ownedCount: catalog?.ownedPackIds?.length ?? 0,
        });
      }
      return;
    }
    const link = target.closest<HTMLAnchorElement>("[data-catalog-link]");
    if (link && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey) {
      event.preventDefault();
      options.navigate(link.href);
      return;
    }
    const control = target.closest<HTMLButtonElement>("[data-cat-action]");
    const type = control?.dataset.catAction;
    if (type === "studio") {
      if (authState && !authState.authenticated) {
        openAuthModal({
          reason: "Masuk dengan email untuk menyimpan draf, publikasi, dan pendapatan kreator.",
          ownedCount: catalog?.ownedPackIds?.length ?? 0,
          onSignedIn: () => {
            if (!signal.aborted) options.openStudio();
          },
        });
        return;
      }
      return options.openStudio();
    }
    if (type === "retry") return void load();
    if (type === "resume-room") {
      const code = control?.dataset.roomCode ?? activeRoom?.roomCode;
      const fmt = (control?.dataset.format as RulebookFormat | undefined) ?? activeRoom?.format;
      if (code && (fmt === "claim-the-city" || fmt === "hide-and-seek")) {
        options.openRoom(fmt, code);
      }
      return;
    }
    if (type === "dismiss-resume") {
      const code = control?.dataset.roomCode ?? activeRoom?.roomCode;
      if (code) {
        dismissActiveRoom(code);
        activeRoom = catalog?.activeRooms ? reconcileActiveRoomsFromServer(catalog.activeRooms) : readStoredActiveRoom();
        if (catalog) store(cacheKey, catalog);
        render();
      }
      return;
    }
    const item = selected();
    if (!item || !type || control.disabled || busy) return;
    if (type === "practice") {
      void options.openPractice(item, mode).catch((error) => {
        if (signal.aborted) return;
        const resolved = resolvePlayerError({ code: "practice-load-failed", detail: error instanceof Error ? error.message : undefined }, {
          surface: "catalog",
          action: "practice",
          target: item.packId,
        });
        toast.show(resolved);
      });
      return;
    }
    if (type === "solo" || type === "group") {
      mode = type;
      const url = new URL(location.href);
      url.searchParams.set("mode", mode);
      history.replaceState(history.state, "", url);
      inlineError = null;
      toast.clear();
      render();
      root.querySelector<HTMLElement>(`[data-cat-action="${type}"]`)?.focus({ preventScroll: true });
      return;
    }
    void submit(type, item);
  }, { signal });
  window.addEventListener("online", () => {
    if (!fresh || failed) void load();
  }, { signal });
  render();
  void load();
  return () => lifetime.abort();
}
