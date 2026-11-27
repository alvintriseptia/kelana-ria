import type { RulebookFormat, RulebookPlayMode } from "@kelana-ria/contracts";
import { escapeText } from "./escape-text";
import type { CatalogEdition } from "./rulebook-catalog";
import "./quick-guide.css";

export type PhaseCueKey =
  | "claim-lobby"
  | "claim-active"
  | "seek-lobby"
  | "seek-head-start-hider"
  | "seek-head-start-seeker"
  | "seek-seeking-seeker"
  | "seek-seeking-hider";

const ALL_PHASE_CUE_KEYS: PhaseCueKey[] = [
  "claim-lobby",
  "claim-active",
  "seek-lobby",
  "seek-head-start-hider",
  "seek-head-start-seeker",
  "seek-seeking-seeker",
  "seek-seeking-hider",
];

const CUE_STORAGE_PREFIX = "kelana-cue-dismissed:";

const CUE_META: Record<PhaseCueKey, { icon: string; text: string }> = {
  "claim-lobby": {
    icon: "◆",
    text: "Langkah 1: Check-in di Titik Awal → Langkah 2: Tandai Siap.",
  },
  "claim-active": {
    icon: "◆",
    text: "Pilih landmark di peta → Masuk radius & Check-in → Selesaikan tantangan untuk kuasai zona.",
  },
  "seek-lobby": {
    icon: "◎",
    text: "Langkah 1: Check-in di Titik Awal → Langkah 2: Tandai Siap · Host mengatur urutan giliran.",
  },
  "seek-head-start-hider": {
    icon: "◆",
    text: "Kamu Penyembunyi! Pergi ke stasiun target & ketuk Kunci Stasiun sebelum waktu habis.",
  },
  "seek-head-start-seeker": {
    icon: "◎",
    text: "Kamu Pencari! Tunggu penyembunyi mengunci stasiun, lalu ajukan petunjuk di peta.",
  },
  "seek-seeking-seeker": {
    icon: "◎",
    text: "Ajukan petunjuk dari menu Tanya untuk menyempitkan area sembunyi di peta.",
  },
  "seek-seeking-hider": {
    icon: "◆",
    text: "Jawab pertanyaan pencari tepat waktu untuk menarik kartu bonus & kutukan.",
  },
};

export function getPhaseCueSpec(key: PhaseCueKey): { icon: string; text: string } {
  return CUE_META[key];
}

export function isPhaseCueDismissed(key: PhaseCueKey): boolean {
  try {
    return localStorage.getItem(`${CUE_STORAGE_PREFIX}${key}`) === "1";
  } catch {
    return false;
  }
}

export function dismissPhaseCue(key: PhaseCueKey): void {
  try {
    localStorage.setItem(`${CUE_STORAGE_PREFIX}${key}`, "1");
  } catch {
    // Ignore storage errors in private browsing.
  }
}

export function hasAnyDismissedPhaseCue(): boolean {
  return ALL_PHASE_CUE_KEYS.some((key) => isPhaseCueDismissed(key));
}

export function resetAllPhaseCues(): void {
  try {
    for (const key of ALL_PHASE_CUE_KEYS) {
      localStorage.removeItem(`${CUE_STORAGE_PREFIX}${key}`);
    }
  } catch {
    // Ignore storage errors in private browsing.
  }
}

export type QuickGuideContext = {
  format: RulebookFormat;
  mode?: RulebookPlayMode;
  role?: "hider" | "seeker" | "lobby" | "player";
  packId: string;
  version: number;
  title: string;
  inLobby?: boolean;
  onResetCues?: () => void;
};

type GuideStep = { title: string; body: string };

function guideSpec(ctx: QuickGuideContext): {
  formatBadge: string;
  roleBadge: string;
  heading: string;
  steps: GuideStep[];
} {
  if (ctx.format === "claim-the-city") {
    const isSolo = ctx.mode === "solo";
    return {
      formatBadge: "◆ Claim the City",
      roleBadge: isSolo ? "Solo" : "Grup",
      heading: isSolo ? "Panduan Cepat · Claim Solo" : "Panduan Cepat · Claim Grup",
      steps: isSolo
        ? [
            {
              title: "Datangi & Check-in Landmark",
              body: "Ketuk landmark di peta, jalan hingga masuk radius GPS, lalu ketuk Check-in Landmark.",
            },
            {
              title: "Kunci Target Zona",
              body: "Selesaikan tantangan lapangan untuk mengunci landmark sebelum waktu habis.",
            },
            {
              title: "Gunakan Kartu Taktis",
              body: "Buka tab Kartu untuk memakai kartu bonus yang kamu tarik saat mengunci titik.",
            },
          ]
        : [
            {
              title: "Check-in & Rebut Landmark",
              body: "Datangi titik di peta dan selesaikan tantangan untuk klaim atau merebutnya dari tim lawan.",
            },
            {
              title: "Kuasai Zona Terbanyak",
              body: "Tim dengan bobot landmark tertinggi di tiap zona unggul saat ronde berakhir.",
            },
            {
              title: "Mainkan Kartu Taktis",
              body: "Pasang perisai, gandakan bobot landmark, atau kirim kutukan ke tim lawan lewat tab Kartu.",
            },
          ],
    };
  }

  if (ctx.role === "hider") {
    return {
      formatBadge: "◎ Hide & Seek",
      roleBadge: "◆ Penyembunyi",
      heading: "Panduan Cepat · Penyembunyi",
      steps: [
        {
          title: "Kunci Stasiun Sembunyi",
          body: "Saat fase Persiapan, pergi ke stasiun pilihanmu dan ketuk Kunci Stasiun sebelum waktu habis.",
        },
        {
          title: "Jawab Pertanyaan Tepat Waktu",
          body: "Tiap jawaban petunjuk yang terkirim memberimu kartu bonus waktu, perisai, atau kutukan.",
        },
        {
          title: "Bertahan Selama Mungkin",
          body: "Buka panel Kode dan berikan kode temuan saat pencari menemukanmu. Waktu sembunyi dan bonus kartu menentukan hasil setelah bertukar peran.",
        },
      ],
    };
  }

  if (ctx.role === "seeker") {
    return {
      formatBadge: "◎ Hide & Seek",
      roleBadge: "◎ Pencari",
      heading: "Panduan Cepat · Pencari",
      steps: [
        {
          title: "Ajukan Petunjuk di Menu Tanya",
          body: "Gunakan Radar, Termometer, Foto, atau petunjuk lain untuk mempersempit wilayah penyembunyi.",
        },
        {
          title: "Baca Deduksi di Peta",
          body: "Peta menandai area yang masih mungkin dan menyisihkan stasiun yang tidak cocok.",
        },
        {
          title: "Selidiki & Temukan Penyembunyi",
          body: "Check-in untuk memperbarui posisimu. Saat menemukan penyembunyi, minta kode 4 digit dan masukkan di panel Titik untuk mengakhiri giliran.",
        },
      ],
    };
  }

  return {
    formatBadge: "◎ Hide & Seek",
    roleBadge: "Lobi",
    heading: "Panduan Cepat · Hide & Seek",
    steps: [
      {
        title: "Check-in & Tandai Siap",
        body: "Berkumpul di Titik Awal, ketuk Check-in Titik Awal, lalu Tandai Siap sebelum Host memulai.",
      },
      {
        title: "Sembunyi lalu Lacak di Peta",
        body: "Penyembunyi mengunci satu stasiun saat Persiapan; pencari mengajukan petunjuk untuk melacaknya.",
      },
      {
        title: "Tukar Peran & Bandingkan Waktu",
        body: "Semua giliran berganti peran—waktu sembunyi akhir terlama ditambah bonus kartu menang.",
      },
    ],
  };
}

let cachedCatalogEditions: CatalogEdition[] | null = null;

async function resolvePracticeEdition(ctx: QuickGuideContext): Promise<CatalogEdition> {
  if (!cachedCatalogEditions) {
    try {
      const res = await fetch("/api/rulebooks/catalog");
      if (res.ok) {
        const data = (await res.json()) as { editions?: CatalogEdition[] };
        if (Array.isArray(data.editions)) cachedCatalogEditions = data.editions;
      }
    } catch {
      // Fall back cleanly if offline.
    }
  }
  const exact = cachedCatalogEditions?.find(
    (e) => e.packId === ctx.packId && e.version === ctx.version,
  );
  if (exact) return exact;
  const sameFormat = cachedCatalogEditions?.find((e) => e.format === ctx.format);
  if (sameFormat) {
    return { ...sameFormat, title: ctx.title || sameFormat.title };
  }
  if (ctx.format === "claim-the-city") {
    return {
      format: "claim-the-city",
      packId: ctx.packId,
      version: ctx.version,
      title: ctx.title || "Claim the City",
      cityLabel: "",
      summary: "",
      byline: "",
      priceIdr: 0,
      startName: "",
      minPlayers: ctx.mode === "solo" ? 1 : 2,
      maxPlayers: 4,
      durationMinutes: 90,
      checkInRadiusMeters: 100,
      soloTargets: ctx.mode === "solo" ? { lockedLandmarks: 4, distinctZones: 2 } : null,
    };
  }
  return {
    format: "hide-and-seek",
    packId: ctx.packId,
    version: ctx.version,
    title: ctx.title || "Hide & Seek",
    cityLabel: "",
    summary: "",
    byline: "",
    priceIdr: 0,
    startName: "",
    minPlayers: 2,
    maxPlayers: 4,
    headStartMinutes: 10,
    searchLimitMinutes: 30,
    regroupMinutes: 10,
    objectiveResponseMs: 300_000,
    photoResponseMs: 300_000,
    questionFamilies: [
      { family: "radar", drawCount: 2, keepCount: 1 },
      { family: "thermometer", drawCount: 2, keepCount: 1 },
      { family: "photo", drawCount: 1, keepCount: 1 },
    ],
  };
}

let activeModalCleanup: (() => void) | null = null;

export function openQuickGuideModal(ctx: QuickGuideContext): void {
  activeModalCleanup?.();
  const focusReturn = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const spec = guideSpec(ctx);
  const dismissedAny = hasAnyDismissedPhaseCue();

  const backdrop = document.createElement("div");
  backdrop.className = "qg-backdrop";
  backdrop.setAttribute("role", "presentation");
  backdrop.innerHTML = `<div class="qg-modal" role="dialog" aria-modal="true" aria-labelledby="qg-modal-title" data-testid="quick-guide-modal">
    <div class="qg-modal-head">
      <div class="qg-modal-title-wrap">
        <div class="qg-modal-badges">
          <span class="qg-badge">${spec.formatBadge}</span>
          <span class="qg-badge">${escapeText(spec.roleBadge)}</span>
        </div>
        <h2 id="qg-modal-title" class="qg-modal-title" tabindex="-1">${escapeText(spec.heading)}</h2>
      </div>
      <button type="button" class="qg-modal-close" data-qg-action="close" aria-label="Tutup panduan">×</button>
    </div>
    <ol class="qg-steps">
      ${spec.steps
        .map(
          (step, idx) => `<li class="qg-step">
            <span class="qg-step-num" aria-hidden="true">${idx + 1}</span>
            <div class="qg-step-copy">
              <strong>${escapeText(step.title)}</strong>
              <p>${escapeText(step.body)}</p>
            </div>
          </li>`,
        )
        .join("")}
    </ol>
    <p class="qg-modal-note">Ruang permainanmu tetap terhubung di latar belakang selama membuka panduan ini.</p>
    <div class="qg-modal-actions">
      <button type="button" class="qg-btn-primary" data-qg-action="open-practice" data-testid="quick-guide-practice-btn">Coba Panduan Interaktif</button>
      ${dismissedAny ? '<button type="button" class="qg-btn-secondary" data-qg-action="reset-cues" data-testid="quick-guide-reset-cues">Tampilkan Lagi Petunjuk Fase</button>' : ""}
      <button type="button" class="qg-btn-secondary" data-qg-action="close">Tutup</button>
    </div>
  </div>`;

  const ac = new AbortController();

  const close = (restoreFocus = true) => {
    ac.abort();
    backdrop.remove();
    if (activeModalCleanup === cleanup) activeModalCleanup = null;
    if (restoreFocus && focusReturn?.isConnected) {
      focusReturn.focus({ preventScroll: true });
    }
  };

  const cleanup = () => close(false);
  activeModalCleanup = cleanup;

  document.addEventListener(
    "keydown",
    (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        close(true);
      }
    },
    { signal: ac.signal },
  );

  backdrop.addEventListener(
    "click",
    (event) => {
      if (event.target === backdrop) {
        close(true);
        return;
      }
      if (!(event.target instanceof Element)) return;
      const btn = event.target.closest<HTMLButtonElement>("[data-qg-action]");
      if (!btn || btn.disabled) return;
      const action = btn.dataset.qgAction;
      if (action === "close") {
        close(true);
        return;
      }
      if (action === "reset-cues") {
        resetAllPhaseCues();
        ctx.onResetCues?.();
        close(true);
        return;
      }
      if (action === "open-practice") {
        btn.disabled = true;
        btn.textContent = "Membuka latihan…";
        void (async () => {
          const [edition, { mountEditionPractice }] = await Promise.all([
            resolvePracticeEdition(ctx),
            import("./edition-practice"),
          ]);
          close(false);
          const practiceDialog = document.querySelector<HTMLDialogElement>("#edition-practice");
          if (practiceDialog && !practiceDialog.open) {
            mountEditionPractice(
              practiceDialog,
              edition,
              ctx.mode === "solo" ? "solo" : "group",
              {
                fromRoom: true,
                onReady: () => {
                  if (focusReturn?.isConnected) focusReturn.focus({ preventScroll: true });
                },
              },
            );
          }
        })();
      }
    },
    { signal: ac.signal },
  );

  document.body.appendChild(backdrop);
  backdrop.querySelector<HTMLElement>("#qg-modal-title")?.focus({ preventScroll: true });
}
