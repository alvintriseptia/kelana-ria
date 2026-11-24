import type { HideSeekQuestionFamily, RulebookPlayMode } from "@kelana-ria/contracts";
import { cardKindNames, type CatalogEdition, type PracticeCardExample } from "./rulebook-catalog";
import { escapeText } from "./escape-text";

export function practiceDeck(edition: CatalogEdition, mode: RulebookPlayMode, family?: HideSeekQuestionFamily) {
  const examples = edition.cardExamples;
  if (!examples?.length) return;
  if (edition.format === "claim-the-city") {
    const rules = edition.tacticalDeckSummary;
    if (!rules?.enabled || !rules.totalCards) return;
    const triggers = rules.drawTriggers;
    const earns = triggers?.onLock || false;
    const triggerNames = [
      triggers?.onSteal && mode === "group" ? "merebut landmark" : "",
      triggers?.onBoldChallenge ? "menyelesaikan tantangan ekstra yang memberi kartu" : "",
    ].filter(Boolean);
    if (!earns && !triggerNames.length) return;
    const reason = earns ? "Kamu mengunci landmark dan dapat 1 kartu."
      : "Lihat contoh kartu yang bisa kamu dapat di edisi ini.";
    const extra = triggerNames.length ? ` Kamu ${earns ? "juga " : ""}bisa mendapat kartu saat ${triggerNames.join(" atau ")}.` : "";
    return {
      examples, draw: 1, keep: 1, handLimit: rules.maxHandSize, decisionMs: 0, earns,
      source: reason + extra,
    };
  }
  const price = edition.questionFamilies.find(item => item.family === family);
  if (!price?.drawCount || !price.keepCount || !edition.deckSummary?.totalCards) return;
  const draw = Math.min(price.drawCount, edition.deckSummary.totalCards);
  return {
    examples, draw, keep: Math.min(price.keepCount, draw), handLimit: edition.deckSummary.baseHandLimit,
    decisionMs: edition.drawDecisionMs ?? 0, earns: true,
    source: "Jawaban terkirim. Penyembunyi mendapat kartu sebagai hadiah.",
  };
}

export function practiceCardFace(card: PracticeCardExample) {
  return `<div class="ep-card-face ${card.kind}">
    <span class="ep-card-mark" aria-hidden="true">${card.kind === "time_bonus" ? "◷" : card.kind === "curse" ? "✦" : "◆"}</span>
    <small>${cardKindNames[card.kind]}</small>
    <strong>${escapeText(card.title)}</strong><p>${escapeText(card.description)}</p>
  </div>`;
}
