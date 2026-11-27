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
import { useSignal } from "@preact/signals";
import { useEffect, useRef } from "preact/hooks";
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
} from "./auth-modal";
import { readRememberedGuestName } from "./guest-name";
import { openJoinRoomModal } from "./join-room-modal";
import { fetchApiJson, resolvePlayerError, type PlayerErrorTone } from "./player-errors";
import { createPlayerToast } from "./player-toast";
import { mountPwaInstallPrompt } from "./pwa-install";
import { AccountChip } from "./ui/AccountChip";
import { InlineAlert } from "./ui/InlineAlert";
import { mountPreact } from "./ui/mount";
import jakartaCover from "./assets/jakarta.webp";
import "./rulebook-catalog.css";

const endpoint = "/api/rulebooks/catalog";
const cacheKey = "kelana-rulebook-catalog";
const formatNames = { "claim-the-city": "Claim the City", "hide-and-seek": "Hide & Seek" } as const;
const formatSubtitles: Record<RulebookFormat, string> = {
  "claim-the-city": "Rebut & kunci landmark nyata untuk kuasai zona kota.",
  "hide-and-seek": "Sembunyi di stasiun transit; pencari melacak lewat radar & petunjuk.",
};
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
  "claim-the-city":
    "Jelajahi landmark di peta. Check-in di lokasi, lalu selesaikan tantangan untuk mengunci landmark.",
  "hide-and-seek":
    "Bergantian jadi penyembunyi dan pencari. Ajukan pertanyaan untuk mempersempit area pencarian.",
} satisfies Record<RulebookFormat, string>;
export const clueNames: Record<HideSeekQuestionFamily, string> = {
  radar: "Radar",
  thermometer: "Termometer",
  matching: "Cocokkan",
  measuring: "Bandingkan",
  tentacles: "Tempat Terdekat",
  photo: "Foto",
};

export type PracticeCardExample = {
  title: string;
  description: string;
  kind: HideSeekCardCategory | "tactical";
};
export const cardKindNames: Record<PracticeCardExample["kind"], string> = {
  time_bonus: "Bonus Waktu",
  powerup: "Powerup",
  curse: "Kutukan",
  tactical: "Kartu",
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
} & (
  | {
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
    }
  | {
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
    }
);
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
    return value ? (JSON.parse(value) as T) : undefined;
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
  return `/catalog?${new URLSearchParams({ edition: item.packId, version: String(item.version) })}`;
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

function isJakartaCover(item: Edition) {
  return item.cityLabel.toLocaleLowerCase("id-ID").includes("jakarta");
}

function objective(item: Edition, mode: RulebookPlayMode) {
  if (item.format === "hide-and-seek") return "Waktu sembunyi akhir terlama menang.";
  if (mode === "solo" && item.soloTargets) {
    return `Kunci ${item.soloTargets.lockedLandmarks} landmark di setidaknya ${item.soloTargets.distinctZones} zona sebelum waktu habis.`;
  }
  return "Kuasai zona terbanyak.";
}

function buildFacts(item: Edition, mode: RulebookPlayMode, owned: boolean): [string, string][] {
  const players =
    mode === "solo"
      ? "1 pemain · Solo"
      : playerRange(Math.max(2, item.minPlayers), item.maxPlayers);
  const durations: [string, string][] =
    item.format === "claim-the-city"
      ? [["Durasi ronde", `${item.durationMinutes} menit`]]
      : [
          ["Waktu sembunyi", `${item.headStartMinutes} menit`],
          ["Batas mencari", `${item.searchLimitMinutes} menit`],
          ["Waktu berkumpul", `${item.regroupMinutes} menit`],
        ];
  const deck =
    item.format === "claim-the-city"
      ? item.tacticalDeckSummary?.enabled
        ? item.tacticalDeckSummary.totalCards
        : 0
      : item.deckSummary?.totalCards;
  const mechanics: [string, string][] = [];
  if (deck) mechanics.push(["Dek", `${deck} kartu`]);
  if (deck && item.cardExamples?.length) {
    mechanics.push([
      "Jenis kartu",
      item.cardExamples.map((card) => cardKindNames[card.kind]).join(", "),
    ]);
  }
  if (item.format === "hide-and-seek" && item.questionFamilies?.length) {
    mechanics.push([
      "Petunjuk",
      item.questionFamilies
        .map(({ family }) => clueNames[family])
        .filter(Boolean)
        .join(", "),
    ]);
  }
  const priceFact =
    item.priceIdr === 0
      ? "Gratis"
      : owned
        ? `${price(item)} · Dimiliki`
        : `${price(item)} · Beli sekali`;
  return [
    ["Titik awal", item.startName],
    ["Pemain", players],
    ...durations,
    ...mechanics,
    ["Harga paket", priceFact],
  ];
}

function OwnedBadge({ extraClass = "" }: { extraClass?: string }) {
  return (
    <span class={extraClass ? `cat-owned-badge ${extraClass}` : "cat-owned-badge"} data-testid="owned-badge">
      <span class="cat-owned-mark" aria-hidden="true">
        ✓
      </span>{" "}
      Dimiliki
    </span>
  );
}

function ResumeRoomBanner({
  room,
  onResume,
  onDismiss,
}: {
  room: ActiveRulebookRoomSummary;
  onResume: (format: RulebookFormat, code: string) => void;
  onDismiss: (code: string) => void;
}) {
  const title = cleanTitle(room.title, room.format);
  const meta = [
    `v${room.version}`,
    room.format === "claim-the-city"
      ? room.role === "solo"
        ? "Solo"
        : "Grup"
      : room.turnNumber && room.totalPlannedTurns
        ? `Giliran ${room.turnNumber}/${room.totalPlannedTurns}`
        : "",
    room.role === "hider" ? "Penyembunyi" : room.role === "seeker" ? "Pencari" : "",
    room.role !== "solo" && room.playerCount && room.maxPlayers
      ? `${room.playerCount}/${room.maxPlayers} pemain`
      : "",
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <section
      class="cat-resume"
      aria-label="Permainan sedang berlangsung"
      data-testid="resume-room-banner"
      data-room-code={room.roomCode}
      data-format={room.format}
    >
      <div class="cat-resume-head">
        <div class="cat-resume-badges">
          <span class={`cat-resume-format ${room.format}`}>
            <span aria-hidden="true">{room.format === "claim-the-city" ? "◆" : "◎"}</span>{" "}
            {formatNames[room.format]}
          </span>
          <span class="cat-resume-badge">Ruang {room.roomCode}</span>
          <span class="cat-resume-badge">{resumePhaseLabels[room.phase]}</span>
        </div>
        <button
          type="button"
          class="secondary cat-resume-dismiss"
          data-cat-action="dismiss-resume"
          data-room-code={room.roomCode}
          aria-label={`Tutup sesi ${room.roomCode}`}
          onClick={() => onDismiss(room.roomCode)}
        >
          Tutup
        </button>
      </div>
      <div class="cat-resume-body">
        <div class="cat-resume-copy">
          <h2>{title}</h2>
          <p>{meta}</p>
        </div>
        <button
          type="button"
          class="primary cat-resume-cta"
          data-cat-action="resume-room"
          data-room-code={room.roomCode}
          data-format={room.format}
          onClick={() => onResume(room.format, room.roomCode)}
        >
          Lanjutkan Permainan
        </button>
      </div>
    </section>
  );
}

function EditionCard({
  item,
  owned,
  onNavigate,
}: {
  item: Edition;
  owned: boolean;
  onNavigate: (href: string) => void;
}) {
  const footerPrice =
    item.priceIdr === 0 ? "Gratis" : owned ? "Dimiliki" : `${price(item)} · Beli sekali`;
  const href = detailHref(item);
  return (
    <a
      class="cat-card"
      href={href}
      data-catalog-link
      data-pack-id={item.packId}
      data-version={item.version}
      onClick={(event) => {
        if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        event.preventDefault();
        onNavigate(new URL(href, location.origin).href);
      }}
    >
      <div class={`cat-cover ${item.format}`}>
        {isJakartaCover(item) && <img src={jakartaCover} alt="" width={800} height={550} />}
        <div class="cat-cover-tags">
          <span class="cat-cover-city">{item.cityLabel}</span>
          {item.priceIdr > 0 && owned && <OwnedBadge />}
        </div>
      </div>
      <div class="cat-card-copy">
        <h3>{editionTitle(item)}</h3>
        <p>
          v{item.version} · {playerRange(item.minPlayers, item.maxPlayers)}
        </p>
        <div class="cat-card-footer">
          <span>{roundTime(item)}</span>
          <strong>
            {footerPrice} <span aria-hidden="true">›</span>
          </strong>
        </div>
      </div>
    </a>
  );
}

function CommunityResultsStrip({
  item,
  sharedRecaps,
  onNavigate,
}: {
  item: Edition;
  sharedRecaps: PublicMatchRecapSummary[] | undefined;
  onNavigate: (href: string) => void;
}) {
  const matches = (sharedRecaps ?? []).filter(
    (recap) => recap.packId === item.packId && recap.editionVersion === item.version,
  );
  return (
    <section class="cat-community" aria-label="Hasil komunitas">
      <div class="cat-community-head">
        <h2>Hasil komunitas</h2>
        <span>
          v{item.version} · {matches.length} dibagikan
        </span>
      </div>
      {matches.length ? (
        <ul class="cat-community-list">
          {matches.map((entry) => {
            const href = `/?shared=${encodeURIComponent(entry.shareId)}`;
            return (
              <li key={entry.shareId}>
                <a
                  class="cat-recap-card"
                  href={href}
                  data-catalog-link
                  data-share-id={entry.shareId}
                  onClick={(event) => {
                    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
                    event.preventDefault();
                    onNavigate(new URL(href, location.origin).href);
                  }}
                >
                  <div class="cat-recap-top">
                    <strong>{entry.outcomeLabel}</strong>
                    <span>
                      {formatNames[entry.format]} · v{entry.editionVersion}
                      {entry.simulated ? " · QA" : ""} · {recapDate.format(entry.completedAt)}
                    </span>
                  </div>
                  <p class="cat-recap-score">{entry.scoreSummary}</p>
                  {entry.topMoment && (
                    <p class="cat-recap-moment">
                      {entry.topMoment.label} · {entry.topMoment.detail}
                    </p>
                  )}
                </a>
              </li>
            );
          })}
        </ul>
      ) : (
        <p class="cat-community-empty">
          Belum ada hasil pertandingan yang dibagikan untuk edisi v{item.version}. Selesaikan ronde,
          lalu bagikan dari Riwayat.
        </p>
      )}
    </section>
  );
}

function PwaInstallHost({ signal }: { signal: AbortSignal }) {
  const slotRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const slot = slotRef.current;
    if (!slot || signal.aborted) return;
    const ac = new AbortController();
    const onParentAbort = () => ac.abort();
    signal.addEventListener("abort", onParentAbort, { once: true });
    mountPwaInstallPrompt(slot, ac.signal);
    return () => {
      signal.removeEventListener("abort", onParentAbort);
      ac.abort();
    };
  }, [signal]);
  return <div ref={slotRef} class="pwa-install-slot" data-pwa-install-slot hidden />;
}

function CatalogApp({
  root,
  options,
  focusHeadingInitial,
  signal,
}: {
  root: HTMLElement;
  options: Options;
  focusHeadingInitial: boolean;
  signal: AbortSignal;
}) {
  const params = new URLSearchParams(location.search);
  const pack = params.get("edition");
  const version = Number(params.get("version"));

  const initialCatalog = readStored<Catalog>(cacheKey);
  const catalogSig = useSignal<Catalog | undefined>(initialCatalog);
  const authSig = useSignal<AuthMeReply | null>(
    hydrateAuthFromCatalog(initialCatalog?.auth) ?? getCachedAuth(),
  );
  const activeRoomSig = useSignal<ActiveRulebookRoomSummary | undefined>(
    readStoredActiveRoom() ??
      (initialCatalog?.activeRooms
        ? reconcileActiveRoomsFromServer(initialCatalog.activeRooms)
        : undefined),
  );
  const modeSig = useSignal<RulebookPlayMode>(params.get("mode") === "group" ? "group" : "solo");
  const freshSig = useSignal(false);
  const loadingSig = useSignal(true);
  const busySig = useSignal(false);
  const failedSig = useSignal(false);
  const inlineErrorSig = useSignal<{
    message: string;
    tone: PlayerErrorTone;
    area: "payment" | "screen";
  } | null>(null);
  const attemptVersionSig = useSignal(0);

  const toastRef = useRef<ReturnType<typeof createPlayerToast> | null>(null);
  const attemptsRef = useRef(new Map<string, Attempt>());
  const loadSeqRef = useRef(0);
  const handlingSignInRef = useRef(false);
  const pendingFocusHeadingRef = useRef(focusHeadingInitial);
  const scrolledHashRef = useRef(false);

  const attemptKey = (m = modeSig.value) =>
    `kelana-catalog-attempt:${JSON.stringify([pack, version, m])}`;
  const getAttempt = (m = modeSig.value) =>
    attemptsRef.current.get(attemptKey(m)) ?? readStored<Attempt>(attemptKey(m));
  const setAttempt = (value?: Attempt, m = modeSig.value) => {
    const key = attemptKey(m);
    if (value) attemptsRef.current.set(key, value);
    else attemptsRef.current.delete(key);
    store(key, value);
    attemptVersionSig.value += 1;
  };

  const selectedEdition = () =>
    catalogSig.value?.editions.find((item) => item.packId === pack && item.version === version);
  const isOwned = (packId: string) => Boolean(catalogSig.value?.ownedPackIds?.includes(packId));
  const entitlementFor = (packId: string) =>
    catalogSig.value?.entitlements?.find((entry) => entry.packId === packId);

  async function load() {
    const sequence = ++loadSeqRef.current;
    try {
      const { ok, data } = await fetchApiJson<Catalog>(endpoint, { signal });
      if (!ok || !Array.isArray(data.editions)) throw new Error("catalog-invalid");
      if (signal.aborted || sequence !== loadSeqRef.current) return;
      catalogSig.value = data;
      if (data.auth) {
        authSig.value = hydrateAuthFromCatalog(data.auth);
      }
      if (Array.isArray(data.activeRooms)) {
        activeRoomSig.value = reconcileActiveRoomsFromServer(data.activeRooms);
      }
      freshSig.value = true;
      failedSig.value = false;
      store(cacheKey, data);
    } catch {
      if (signal.aborted || sequence !== loadSeqRef.current) return;
      failedSig.value = true;
      freshSig.value = false;
    }
    loadingSig.value = false;
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
      inlineErrorSig.value = null;
      toastRef.current?.show(resolved);
    } else {
      toastRef.current?.clear();
      const area = item.priceIdr > 0 && Boolean(getAttempt()?.order) ? "payment" : "screen";
      inlineErrorSig.value = { message: resolved.message, tone: resolved.tone, area };
    }
  }

  function promptCheckoutSignIn(item: Edition) {
    handlingSignInRef.current = true;
    openAuthModal({
      reason: "Masuk dengan email agar paket tersimpan permanen di akunmu.",
      ownedCount: catalogSig.value?.ownedPackIds?.length ?? 0,
      onSignedIn: async () => {
        if (signal.aborted) {
          handlingSignInRef.current = false;
          return;
        }
        try {
          setAttempt();
          await load();
          if (signal.aborted) return;
          const latest = selectedEdition();
          if (latest && latest.packId === item.packId && !isOwned(latest.packId)) {
            void submit("buy", latest);
          }
        } finally {
          handlingSignInRef.current = false;
        }
      },
      onClose: () => {
        if (!authSig.value?.authenticated) handlingSignInRef.current = false;
      },
    });
  }

  async function submit(type: string, item: Edition) {
    if (!freshSig.value || busySig.value) return;
    if (
      (type === "buy" || type === "check-payment" || type === "simulate-payment") &&
      !authSig.value?.authenticated
    ) {
      promptCheckoutSignIn(item);
      return;
    }
    let attempt = getAttempt();
    if (!attempt) {
      attempt = { id: crypto.randomUUID() };
      setAttempt(attempt);
    }
    busySig.value = true;
    inlineErrorSig.value = null;
    try {
      const preferredHostName =
        authSig.value?.user?.displayName?.trim() || readRememberedGuestName();
      const { ok, status, data: reply } = await fetchApiJson<CheckoutReply>(endpoint, {
        signal,
        body: {
          type,
          edition: item.packId,
          version: item.version,
          mode: modeSig.value,
          requestId: attempt.id,
          ...(preferredHostName ? { hostName: preferredHostName } : {}),
        },
      });
      if (signal.aborted) return;
      if (status === 401 || reply.error === "auth-required") {
        authSig.value = {
          authenticated: false,
          user: null,
          allowSandboxOtp: Boolean(authSig.value?.allowSandboxOtp),
        };
        promptCheckoutSignIn(item);
        return;
      }
      if (reply.error || !ok) {
        if (reply.error === "pack-already-owned") setAttempt();
        applyCatalogError({ error: reply.error, status }, item, type);
        if (
          reply.error === "pack-already-owned" ||
          reply.error === "entitlement-active-room-exists"
        ) {
          void load();
        }
        return;
      }
      toastRef.current?.clear();
      toastRef.current?.resetDedupe();
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
          role: item.format === "claim-the-city" ? modeSig.value : "none",
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
        busySig.value = false;
        queueMicrotask(() => {
          (
            root.querySelector<HTMLElement>(`[data-cat-action="${type}"]:not([disabled])`) ??
            root.querySelector<HTMLElement>('[data-cat-action="check-payment"]')
          )?.focus({ preventScroll: true });
        });
      }
    }
  }

  useEffect(() => {
    toastRef.current = createPlayerToast({ signal, layout: "page" });
    onAuthChange((next) => {
      authSig.value = next;
      if (handlingSignInRef.current) return;
      setAttempt();
      void load();
    }, signal);
    const onOnline = () => {
      if (!freshSig.value || failedSig.value) void load();
    };
    window.addEventListener("online", onOnline, { signal });
    void load();
    return () => {
      toastRef.current?.destroy();
      toastRef.current = null;
    };
  }, []);

  const item = selectedEdition();
  let effectiveMode: RulebookPlayMode = modeSig.value;
  if (item?.format === "hide-and-seek" || (item && item.minPlayers > 1)) effectiveMode = "group";
  if (item?.maxPlayers === 1) effectiveMode = "solo";
  if (effectiveMode !== modeSig.value) {
    modeSig.value = effectiveMode;
  }

  // Subscribe to attempt changes
  void attemptVersionSig.value;
  const currentAttempt = getAttempt(effectiveMode);
  const owned = item ? isOwned(item.packId) : false;

  useEffect(() => {
    document.title = pack
      ? item
        ? `${item.title} · Kelana Ria`
        : "Edisi · Kelana Ria"
      : "Pilih permainan · Kelana Ria";
  }, [pack, item?.title]);

  useEffect(() => {
    if (!pendingFocusHeadingRef.current) return;
    if (pack && !item && loadingSig.value) return;
    pendingFocusHeadingRef.current = false;
    const heading = root.querySelector<HTMLElement>("h1");
    if (heading) {
      heading.tabIndex = -1;
      heading.focus();
    }
  }, [pack, item?.packId, loadingSig.value]);

  useEffect(() => {
    if (pack || !catalogSig.value?.editions || !location.hash || scrolledHashRef.current) return;
    const targetId = location.hash.slice(1);
    const anchor = targetId ? document.getElementById(targetId) : null;
    if (anchor) {
      scrolledHashRef.current = true;
      const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
      anchor.scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "start" });
    }
  }, [pack, catalogSig.value?.editions?.length]);

  const openAccount = () =>
    openAuthModal({
      mode: "account",
      ownedCount: catalogSig.value?.ownedPackIds?.length ?? 0,
    });
  const openSignIn = () =>
    openAuthModal({
      ownedCount: catalogSig.value?.ownedPackIds?.length ?? 0,
    });

  const offlineNode = failedSig.value ? (
    <div class="cat-message" role="status">
      Katalog belum bisa diperbarui. Periksa koneksi.{" "}
      <button
        type="button"
        class="secondary"
        data-cat-action="retry"
        onClick={() => void load()}
      >
        Coba lagi
      </button>
    </div>
  ) : null;

  if (pack) {
    const hasPaymentOrder = Boolean(
      item &&
        item.priceIdr > 0 &&
        !owned &&
        catalogSig.value?.allowSandboxCheckout &&
        currentAttempt?.order,
    );
    const inlineErr = inlineErrorSig.value;
    const screenAlert =
      inlineErr && !(inlineErr.area === "payment" && hasPaymentOrder) ? (
        <InlineAlert message={inlineErr.message} tone={inlineErr.tone} />
      ) : null;

    const backLink = (
      <a
        class="cat-back"
        href="/catalog"
        data-catalog-link
        onClick={(event) => {
          if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
          event.preventDefault();
          options.navigate(new URL("/catalog", location.origin).href);
        }}
      >
        ‹ Katalog
      </a>
    );

    if (!item) {
      return (
        <article class="cat-detail">
          {backLink}
          <h1>Edisi permainan</h1>
          {loadingSig.value ? (
            <p role="status">Memuat edisi…</p>
          ) : (
            offlineNode ?? (
              <InlineAlert
                message="Edisi ini tidak tersedia. Pilih edisi lain dari katalog."
                tone="warn"
              />
            )
          )}
        </article>
      );
    }

    const entitlement = entitlementFor(item.packId);
    const order = currentAttempt?.order;
    const redirect = order?.snapRedirectUrl;
    const showPayLink =
      order?.paymentMode === "midtrans-sandbox" && Boolean(redirect?.startsWith("https://"));

    return (
      <article class="cat-detail" aria-label="Detail edisi">
        <div class="catalog-top">
          {backLink}
          <AccountChip auth={authSig.value} onOpenAccount={openAccount} onOpenAuth={openSignIn} />
        </div>
        <div class={`cat-cover cat-hero ${item.format}`}>
          {isJakartaCover(item) && <img src={jakartaCover} alt="" width={800} height={550} />}
          <div class="cat-hero-copy">
            <div class="cat-hero-badges">
              <span class="cat-hero-tag">
                {formatNames[item.format]} · v{item.version}
              </span>
              {item.priceIdr > 0 && owned && <OwnedBadge extraClass="cat-owned-badge--hero" />}
            </div>
            <h1>{editionTitle(item)}</h1>
            <p>{item.cityLabel}</p>
          </div>
        </div>

        {item.format === "claim-the-city" && item.minPlayers === 1 && item.maxPlayers > 1 && (
          <div class="cat-modes" role="group" aria-label="Mode permainan">
            {(["solo", "group"] as const).map((choice) => (
              <button
                key={choice}
                type="button"
                class="secondary"
                data-cat-action={choice}
                aria-pressed={effectiveMode === choice}
                disabled={busySig.value}
                onClick={() => {
                  modeSig.value = choice;
                  const url = new URL(location.href);
                  url.searchParams.set("mode", choice);
                  history.replaceState(history.state, "", url);
                  inlineErrorSig.value = null;
                  toastRef.current?.clear();
                }}
              >
                {choice === "solo" ? "Solo" : "Grup"}
              </button>
            ))}
          </div>
        )}

        <section class="cat-box">
          <h2>Cara bermain</h2>
          <p>{gameOverviews[item.format]}</p>
        </section>
        {item.summary && <p class="cat-description">{item.summary}</p>}
        {item.byline && <p class="cat-byline">Oleh {item.byline}</p>}
        <section class="cat-rules" aria-label="Aturan edisi">
          <h2>Aturan edisi</h2>
          <p>{objective(item, effectiveMode)}</p>
          <dl class="cat-facts">
            {buildFacts(item, effectiveMode, owned).map(([label, value]) => (
              <div key={label}>
                <dt>{label}</dt>
                <dd>{value}</dd>
              </div>
            ))}
          </dl>
        </section>

        {offlineNode}
        {screenAlert}

        <div class="cat-actions" aria-busy={busySig.value}>
          <button
            type="button"
            class="secondary"
            data-cat-action="practice"
            disabled={busySig.value}
            onClick={() => {
              void options.openPractice(item, effectiveMode).catch((error) => {
                if (signal.aborted) return;
                const resolved = resolvePlayerError(
                  {
                    code: "practice-load-failed",
                    detail: error instanceof Error ? error.message : undefined,
                  },
                  {
                    surface: "catalog",
                    action: "practice",
                    target: item.packId,
                  },
                );
                toastRef.current?.show(resolved);
              });
            }}
          >
            Coba Panduan
          </button>

          {item.priceIdr === 0 ? (
            <button
              type="button"
              class="primary"
              data-cat-action="play"
              disabled={busySig.value || !freshSig.value}
              onClick={() => void submit("play", item)}
            >
              {effectiveMode === "solo" ? "Main Solo" : "Main Grup"}
            </button>
          ) : owned ? (
            entitlement?.activeRoomCode ? (
              <button
                type="button"
                class="primary"
                data-cat-action="resume-room"
                data-room-code={entitlement.activeRoomCode}
                data-format={item.format}
                disabled={busySig.value || !freshSig.value}
                onClick={() => options.openRoom(item.format, entitlement.activeRoomCode!)}
              >
                Lanjutkan Ruang ({entitlement.activeRoomCode})
              </button>
            ) : (
              <button
                type="button"
                class="primary"
                data-cat-action="play"
                disabled={busySig.value || !freshSig.value}
                onClick={() => void submit("play", item)}
              >
                {effectiveMode === "solo" ? "Main Solo" : "Main Grup"}
              </button>
            )
          ) : !catalogSig.value?.allowSandboxCheckout ? (
            freshSig.value ? (
              <p class="cat-message" role="status">
                Edisi berbayar belum bisa dibeli pada uji publik ini.
              </p>
            ) : null
          ) : !order ? (
            <button
              type="button"
              class="primary"
              data-cat-action="buy"
              disabled={busySig.value || !freshSig.value}
              onClick={() => void submit("buy", item)}
            >
              Beli paket · Uji pembayaran
            </button>
          ) : (
            <section class="cat-box" aria-label="Pembayaran uji">
              <h2>Pembayaran uji</h2>
              <p role="status">{price(item)} · Beli sekali · Menunggu konfirmasi pembayaran</p>
              {inlineErr?.area === "payment" && (
                <InlineAlert
                  message={inlineErr.message}
                  tone={inlineErr.tone}
                  testId="payment-inline-alert"
                />
              )}
              {showPayLink && (
                <a class="cat-link" href={redirect} target="_blank" rel="noopener noreferrer">
                  Buka pembayaran uji
                </a>
              )}
              <button
                type="button"
                class="secondary"
                data-cat-action="check-payment"
                disabled={busySig.value || !freshSig.value}
                onClick={() => void submit("check-payment", item)}
              >
                Cek status pembayaran
              </button>
              {order.paymentMode === "recorded-sandbox" && (
                <button
                  type="button"
                  class="primary"
                  data-cat-action="simulate-payment"
                  disabled={busySig.value || !freshSig.value}
                  onClick={() => void submit("simulate-payment", item)}
                >
                  Simulasikan pembayaran berhasil
                </button>
              )}
            </section>
          )}
        </div>

        <CommunityResultsStrip
          item={item}
          sharedRecaps={catalogSig.value?.sharedRecaps}
          onNavigate={options.navigate}
        />
      </article>
    );
  }

  const editions = catalogSig.value?.editions;
  return (
    <>
      <div class="catalog-top">
        <div>
          <h1>Pilih permainan</h1>
          <p class="intro">Jelajahi kota lewat misi dan kartu.</p>
        </div>
        <div class="catalog-links">
          <button
            type="button"
            class="secondary"
            data-cat-action="open-join-modal"
            data-testid="home-join-room-btn"
            onClick={() =>
              openJoinRoomModal({
                signal,
                authState: authSig.value,
                onJoined: options.openRoom,
              })
            }
          >
            Gabung Ruang
          </button>
          <a class="cat-link" href="/?recaps=1">
            Riwayat pertandingan
          </a>
          <AccountChip auth={authSig.value} onOpenAccount={openAccount} onOpenAuth={openSignIn} />
          <button
            type="button"
            id="chooser-studio"
            class="secondary"
            data-cat-action="studio"
            onClick={() => {
              if (authSig.value && !authSig.value.authenticated) {
                openAuthModal({
                  reason: "Masuk dengan email untuk menyimpan draf, publikasi, dan pendapatan kreator.",
                  ownedCount: catalogSig.value?.ownedPackIds?.length ?? 0,
                  onSignedIn: () => {
                    if (!signal.aborted) options.openStudio();
                  },
                });
                return;
              }
              options.openStudio();
            }}
          >
            Studio Kreator
          </button>
        </div>
      </div>

      {activeRoomSig.value && (
        <ResumeRoomBanner
          room={activeRoomSig.value}
          onResume={(fmt, code) => options.openRoom(fmt, code)}
          onDismiss={(code) => {
            dismissActiveRoom(code);
            activeRoomSig.value = catalogSig.value?.activeRooms
              ? reconcileActiveRoomsFromServer(catalogSig.value.activeRooms)
              : readStoredActiveRoom();
            if (catalogSig.value) store(cacheKey, catalogSig.value);
          }}
        />
      )}

      <PwaInstallHost signal={signal} />
      {offlineNode}

      {editions ? (
        editions.length ? (
          (Object.keys(formatNames) as RulebookFormat[]).map((format) => {
            const cards = editions.filter((edition) => edition.format === format);
            if (!cards.length) return null;
            return (
              <section key={format} class="catalog-group" aria-labelledby={`catalog-${format}`}>
                <div class="catalog-group-head">
                  <h2 id={`catalog-${format}`}>
                    <span aria-hidden="true" class={`cat-mark ${format}`}>
                      {format === "claim-the-city" ? "◆" : "◎"}
                    </span>
                    {formatNames[format]}
                  </h2>
                  <p class="catalog-group-sub" data-testid={`catalog-subtitle-${format}`}>
                    {formatSubtitles[format]}
                  </p>
                </div>
                <div class="catalog-grid">
                  {cards.map((edition) => (
                    <EditionCard
                      key={`${edition.packId}@${edition.version}`}
                      item={edition}
                      owned={isOwned(edition.packId)}
                      onNavigate={options.navigate}
                    />
                  ))}
                </div>
              </section>
            );
          })
        ) : (
          <p role="status">Belum ada edisi yang bisa dimainkan.</p>
        )
      ) : loadingSig.value ? (
        <p class="catalog-loading" role="status">
          Memuat katalog…
        </p>
      ) : null}
    </>
  );
}

export function mountRulebookCatalog(root: HTMLElement, options: Options, focusHeading = false) {
  const lifetime = new AbortController();
  const unmount = mountPreact(root, () => (
    <CatalogApp
      root={root}
      options={options}
      focusHeadingInitial={focusHeading}
      signal={lifetime.signal}
    />
  ));
  return () => {
    lifetime.abort();
    unmount();
  };
}
