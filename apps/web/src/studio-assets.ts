import type {
  ClaimChallengePrimitive,
  HideSeekQuestionFamily,
  RulebookFormat,
} from "@kelana-ria/contracts";
import { escapeText } from "./solo-view";
import type { StudioStep } from "./studio-types";

export type CardPreviewVariant = "time_bonus" | "powerup" | "curse" | "tactical";

export type CardPreviewChip = {
  label: string;
  tone?: "neutral" | "ok" | "warn" | "danger";
};

const VARIANT_META: Record<CardPreviewVariant, { tag: string }> = {
  time_bonus: { tag: "BONUS" },
  powerup: { tag: "POWERUP" },
  curse: { tag: "KUTUKAN" },
  tactical: { tag: "KARTU" },
};

const QUESTION_META: Record<
  HideSeekQuestionFamily,
  { short: string; svg: string }
> = {
  radar: {
    short: "Radar",
    svg: `<svg viewBox="0 0 64 40" aria-hidden="true"><rect width="64" height="40" rx="6" fill="#eef6f2"/><circle cx="32" cy="20" r="14" fill="#0f766e" fill-opacity=".14" stroke="#0f766e" stroke-width="1.6" stroke-dasharray="3 2"/><circle cx="32" cy="20" r="7" fill="none" stroke="#0f766e" stroke-width="1.4"/><circle cx="32" cy="20" r="3" fill="#153d34"/></svg>`,
  },
  thermometer: {
    short: "Termo",
    svg: `<svg viewBox="0 0 64 40" aria-hidden="true"><rect width="64" height="40" rx="6" fill="#fdf4f6"/><line x1="14" y1="22" x2="50" y2="22" stroke="#9f214b" stroke-width="2.5" stroke-dasharray="4 2"/><circle cx="14" cy="22" r="5" fill="#153d34"/><circle cx="50" cy="22" r="5" fill="#9f214b"/></svg>`,
  },
  matching: {
    short: "Cocokkan",
    svg: `<svg viewBox="0 0 64 40" aria-hidden="true"><rect width="64" height="40" rx="6" fill="#eef4fa"/><rect x="8" y="11" width="18" height="18" rx="4" fill="#fff" stroke="#255d9f" stroke-width="1.8"/><rect x="38" y="11" width="18" height="18" rx="4" fill="#fff" stroke="#0f766e" stroke-width="1.8"/><path d="M26 20h12" stroke="#153d34" stroke-width="2"/></svg>`,
  },
  measuring: {
    short: "Bandingkan",
    svg: `<svg viewBox="0 0 64 40" aria-hidden="true"><rect width="64" height="40" rx="6" fill="#fef9ed"/><rect x="10" y="23" width="44" height="8" rx="2" fill="#ffce55" stroke="#153d34" stroke-width="1.4"/><path d="M20 23v4M32 23v5M44 23v4" stroke="#153d34" stroke-width="1.4"/><circle cx="32" cy="12" r="5" fill="#153d34"/></svg>`,
  },
  tentacles: {
    short: "Tempat Terdekat",
    svg: `<svg viewBox="0 0 64 40" aria-hidden="true"><rect width="64" height="40" rx="6" fill="#f4f0fa"/><circle cx="32" cy="20" r="14" fill="#6745a8" fill-opacity=".12" stroke="#6745a8" stroke-dasharray="2 2"/><path d="M32 20L19 12M32 20L46 13M32 20L43 30" stroke="#6745a8" stroke-width="1.6"/><circle cx="32" cy="20" r="3.5" fill="#6745a8"/></svg>`,
  },
  photo: {
    short: "Foto",
    svg: `<svg viewBox="0 0 64 40" aria-hidden="true"><rect width="64" height="40" rx="6" fill="#eef4f0"/><rect x="17" y="12" width="30" height="19" rx="4" fill="#fff" stroke="#153d34" stroke-width="1.8"/><rect x="26" y="8" width="12" height="5" rx="2" fill="#ffce55" stroke="#153d34" stroke-width="1.2"/><circle cx="32" cy="21" r="5.5" fill="#bce7f0" stroke="#153d34" stroke-width="1.4"/></svg>`,
  },
};

const PRIMITIVE_META: Record<
  ClaimChallengePrimitive["primitive"],
  { short: string; badge: string; svg: string }
> = {
  observation_mcq: {
    short: "Pilihan Ganda",
    badge: "A / B / C",
    svg: `<svg viewBox="0 0 48 32" aria-hidden="true"><rect width="48" height="32" rx="6" fill="#eef6f2"/><rect x="6" y="7" width="10" height="7" rx="2" fill="#0f766e"/><rect x="19" y="7" width="23" height="7" rx="2" fill="#fff" stroke="#9dbab0"/><rect x="6" y="18" width="10" height="7" rx="2" fill="#fff" stroke="#9dbab0"/><rect x="19" y="18" width="23" height="7" rx="2" fill="#fff" stroke="#9dbab0"/></svg>`,
  },
  observation_input: {
    short: "Isian Teks",
    badge: "123 / Abc",
    svg: `<svg viewBox="0 0 48 32" aria-hidden="true"><rect width="48" height="32" rx="6" fill="#fef9ed"/><rect x="6" y="8" width="36" height="16" rx="4" fill="#fff" stroke="#153d34" stroke-width="1.5"/><text x="24" y="19" text-anchor="middle" font-size="9" font-weight="800" fill="#153d34">ABC · 123</text></svg>`,
  },
  photo_proof: {
    short: "Bukti Foto",
    badge: "Kamera",
    svg: `<svg viewBox="0 0 48 32" aria-hidden="true"><rect width="48" height="32" rx="6" fill="#eef4fa"/><rect x="12" y="9" width="24" height="16" rx="4" fill="#fff" stroke="#255d9f" stroke-width="1.6"/><circle cx="24" cy="17" r="4.5" fill="#bce7f0" stroke="#255d9f" stroke-width="1.4"/><rect x="20" y="6" width="8" height="3" rx="1" fill="#255d9f"/></svg>`,
  },
  timed_micro_task: {
    short: "Tugas Cepat",
    badge: "Timer",
    svg: `<svg viewBox="0 0 48 32" aria-hidden="true"><rect width="48" height="32" rx="6" fill="#fdf4f6"/><circle cx="24" cy="17" r="9.5" fill="#fff" stroke="#9f214b" stroke-width="1.8"/><path d="M24 12v5l3.5 2M20 5h8" stroke="#9f214b" stroke-width="1.8" stroke-linecap="round"/></svg>`,
  },
  call_your_shot: {
    short: "Standar / Ekstra",
    badge: "Ekstra +1",
    svg: `<svg viewBox="0 0 48 32" aria-hidden="true"><rect width="48" height="32" rx="6" fill="#fef4d6"/><path d="M26 5L14 18h8l-2 9 14-14h-8z" fill="#ffce55" stroke="#153d34" stroke-width="1.5" stroke-linejoin="round"/></svg>`,
  },
  multi_step: {
    short: "2 Langkah",
    badge: "1 → 2",
    svg: `<svg viewBox="0 0 48 32" aria-hidden="true"><rect width="48" height="32" rx="6" fill="#f4f0fa"/><circle cx="15" cy="16" r="6" fill="#6745a8"/><text x="15" y="19" text-anchor="middle" font-size="8" font-weight="800" fill="#fff">1</text><path d="M21 16h6" stroke="#153d34" stroke-width="1.8"/><circle cx="33" cy="16" r="6" fill="#0f766e"/><text x="33" y="19" text-anchor="middle" font-size="8" font-weight="800" fill="#fff">2</text></svg>`,
  },
};

export function formatHeroCardSvg(format: RulebookFormat): string {
  if (format === "hide-and-seek") {
    return `<svg class="st-hero-svg" viewBox="0 0 120 56" aria-hidden="true">
      <rect width="120" height="56" rx="10" fill="#eaf5ef"/>
      <circle cx="34" cy="28" r="19" fill="#0f766e" fill-opacity=".14" stroke="#0f766e" stroke-width="1.8" stroke-dasharray="4 3"/>
      <circle cx="34" cy="28" r="10" fill="#fff" stroke="#0f766e" stroke-width="1.6"/>
      <circle cx="34" cy="28" r="4" fill="#153d34"/>
      <rect x="64" y="12" width="42" height="32" rx="6" fill="#ffce55" stroke="#153d34" stroke-width="1.6"/>
      <path d="M72 24h26M72 32h18" stroke="#153d34" stroke-width="2" stroke-linecap="round"/>
    </svg>`;
  }
  return `<svg class="st-hero-svg" viewBox="0 0 120 56" aria-hidden="true">
    <rect width="120" height="56" rx="10" fill="#eef4fa"/>
    <rect x="12" y="12" width="28" height="32" rx="6" fill="#0f766e" stroke="#153d34" stroke-width="1.5"/>
    <rect x="46" y="12" width="28" height="32" rx="6" fill="#ffce55" stroke="#153d34" stroke-width="1.5"/>
    <rect x="80" y="12" width="28" height="32" rx="6" fill="#fff" stroke="#255d9f" stroke-width="1.5" stroke-dasharray="3 2"/>
    <path d="M26 20v16M26 20l10 4-10 4" stroke="#fff" stroke-width="1.8" fill="#fff" stroke-linecap="round" stroke-linejoin="round"/>
    <circle cx="60" cy="28" r="6" fill="#153d34"/>
  </svg>`;
}

export function stepIconSvg(step: StudioStep): string {
  const icons: Record<StudioStep, string> = {
    1: `<svg class="st-step-ico" viewBox="0 0 20 20" aria-hidden="true"><rect x="4" y="2.5" width="12" height="15" rx="2.5" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M7 7h6M7 11h6M7 14h4" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>`,
    2: `<svg class="st-step-ico" viewBox="0 0 20 20" aria-hidden="true"><path d="M10 17s5-5.1 5-9A5 5 0 1 0 5 8c0 3.9 5 9 5 9Z" fill="none" stroke="currentColor" stroke-width="1.8"/><circle cx="10" cy="8" r="1.8" fill="currentColor"/></svg>`,
    3: `<svg class="st-step-ico" viewBox="0 0 20 20" aria-hidden="true"><rect x="3" y="4" width="10" height="13" rx="2" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M13 6l4 1-2.5 10-1.5-.4" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>`,
    4: `<svg class="st-step-ico" viewBox="0 0 20 20" aria-hidden="true"><path d="M10 2.5 16.5 5v4.8c0 4-2.7 6.8-6.5 7.9C6.2 16.6 3.5 13.8 3.5 9.8V5L10 2.5Z" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="m7.2 10 2 2 3.8-4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  };
  return icons[step];
}

export function mapPinIconSvg(
  kind: "start" | "mrt" | "lrt" | "krl" | "transjakarta" | "poi" | "zone",
): string {
  const palette: Record<typeof kind, { bg: string; fg: string; text: string }> = {
    start: { bg: "#153d34", fg: "#ffffff", text: "A" },
    mrt: { bg: "#0f766e", fg: "#ffffff", text: "M" },
    lrt: { bg: "#9333ea", fg: "#ffffff", text: "L" },
    krl: { bg: "#dc2626", fg: "#ffffff", text: "K" },
    transjakarta: { bg: "#2563eb", fg: "#ffffff", text: "T" },
    poi: { bg: "#d97706", fg: "#ffffff", text: "P" },
    zone: { bg: "#ffce55", fg: "#153d34", text: "Z" },
  };
  const cfg = palette[kind];
  return `<svg class="st-pin-ico" viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="8.5" fill="${cfg.bg}"/><text x="10" y="13.5" text-anchor="middle" font-size="9.5" font-weight="800" fill="${cfg.fg}">${cfg.text}</text></svg>`;
}

export function questionFamilyTileMeta(family: HideSeekQuestionFamily) {
  return QUESTION_META[family];
}

export function challengePrimitiveTileMeta(primitive: ClaimChallengePrimitive["primitive"]) {
  return PRIMITIVE_META[primitive];
}

export function cardCategoryIconSvg(variant: CardPreviewVariant): string {
  if (variant === "time_bonus") {
    return `<svg class="st-card-ico" viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="11" r="6.5" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M10 8v3l2.2 1.4M8 2.8h4" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>`;
  }
  if (variant === "curse") {
    return `<svg class="st-card-ico" viewBox="0 0 20 20" aria-hidden="true"><path d="M11.5 2 5 11h4.5L8.5 18 15 9h-4.5z" fill="currentColor"/></svg>`;
  }
  if (variant === "tactical") {
    return `<svg class="st-card-ico" viewBox="0 0 20 20" aria-hidden="true"><path d="M10 2.5 16.5 5v4.8c0 4-2.7 6.8-6.5 7.9C6.2 16.6 3.5 13.8 3.5 9.8V5L10 2.5Z" fill="none" stroke="currentColor" stroke-width="1.8"/></svg>`;
  }
  return `<svg class="st-card-ico" viewBox="0 0 20 20" aria-hidden="true"><path d="m10 2.5 2.2 4.7 5.2.7-3.8 3.6.9 5.2L10 14.2 5.5 16.7l.9-5.2L2.6 7.9l5.2-.7z" fill="currentColor"/></svg>`;
}

export function renderGameCardPreviewHtml(opts: {
  variant: CardPreviewVariant;
  categoryLabel?: string;
  title: string;
  subtitle: string;
  copies: number;
  chips: CardPreviewChip[];
  testId?: string;
  actionsHtml?: string;
}): string {
  const tag = opts.categoryLabel ?? VARIANT_META[opts.variant].tag;
  const chipToneClass: Record<NonNullable<CardPreviewChip["tone"]>, string> = {
    neutral: "rb-badge",
    ok: "rb-badge st-chip-ok",
    warn: "rb-badge rb-badge-warn",
    danger: "rb-badge rb-badge-danger",
  };
  return `<div class="st-game-card" data-variant="${opts.variant}"${opts.testId ? ` data-testid="${escapeText(opts.testId)}"` : ""}>
    <div class="st-game-card-head">
      <span class="st-game-card-kind">${cardCategoryIconSvg(opts.variant)}<span>${escapeText(tag)}</span></span>
      <span class="st-copies-pill">${opts.copies}x</span>
    </div>
    <div class="st-game-card-body">
      <strong class="st-game-card-title">${escapeText(opts.title)}</strong>
      <small class="st-game-card-desc">${escapeText(opts.subtitle)}</small>
      ${
        opts.chips.length > 0
          ? `<div class="st-card-chips">${opts.chips
              .map((c) => `<span class="${chipToneClass[c.tone ?? "neutral"]}">${escapeText(c.label)}</span>`)
              .join("")}</div>`
          : ""
      }
      ${opts.actionsHtml ? `<div class="rb-actions">${opts.actionsHtml}</div>` : ""}
    </div>
  </div>`;
}
