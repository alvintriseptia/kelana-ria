import type { RulebookFormat } from "@kelana-ria/contracts";

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
