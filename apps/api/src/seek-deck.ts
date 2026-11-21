import { randomInt, randomUUID } from "node:crypto";
import type { SeekCard, SeekCardKind, SeekClueView } from "@kelana-ria/contracts";

const handLimit = 3;
const drawWindow = 30_000;
export const seekCardEffectMs = 120_000;
const kinds: SeekCardKind[] = ["time-bonus", "question-delay", "hand-swap"];

export type SeekDeck = {
  pile: SeekCard[];
  discard: SeekCard[];
  hand: SeekCard[];
  draw?: NonNullable<SeekClueView["draw"]>;
};

function shuffle(cards: SeekCard[]) {
  for (let index = cards.length - 1; index > 0; index--) {
    const other = randomInt(index + 1);
    [cards[index], cards[other]] = [cards[other], cards[index]];
  }
  return cards;
}

export function newSeekDeck(): SeekDeck {
  return {
    pile: shuffle(kinds.flatMap((kind) => Array.from({ length: 4 }, () => ({ id: randomUUID(), kind })))),
    discard: [],
    hand: [],
  };
}

function finishDraw(deck: SeekDeck, keep: ReadonlySet<string>, discard: string[] = []) {
  if (!deck.draw) return;
  discardHeldCards(deck, discard);
  for (const card of deck.draw.cards) {
    if (keep.has(card.id) && !discard.includes(card.id) && deck.hand.length < handLimit) {
      deck.hand.push(card);
    } else {
      deck.discard.push(card);
    }
  }
  delete deck.draw;
}

export function autoKeepSeekDraw(deck: SeekDeck) {
  if (!deck.draw) return false;
  finishDraw(deck, new Set(deck.draw.cards.slice(0, deck.draw.keepCount).map(({ id }) => id)));
  return true;
}

export function drawSeekCards(deck: SeekDeck, drawCount: number, keepCount: number, now: number, turnDeadline: number) {
  if (deck.draw) throw new Error("Seek draw already open");
  const cards: SeekCard[] = [];
  for (let index = 0; index < drawCount; index++) {
    if (!deck.pile.length) {
      deck.pile = shuffle(deck.discard);
      deck.discard = [];
    }
    const card = deck.pile.pop();
    if (!card) break;
    cards.push(card);
  }
  deck.draw = { cards, keepCount: Math.min(keepCount, cards.length), deadline: Math.min(turnDeadline, now + drawWindow) };
  if (deck.draw.keepCount === cards.length && deck.hand.length + cards.length <= handLimit) autoKeepSeekDraw(deck);
}

export function chooseSeekCards(deck: SeekDeck, cardIds: string[], discardIds?: string[]) {
  const { draw } = deck;
  const keep = new Set(cardIds);
  if (!draw || keep.size !== draw.keepCount || keep.size !== cardIds.length ||
      !cardIds.every((id) => draw.cards.some((card) => card.id === id))) return false;
  if (discardIds) {
    const excess = Math.max(0, deck.hand.length + keep.size - handLimit);
    if (discardIds.length !== excess || new Set(discardIds).size !== excess ||
        !discardIds.every((id) => keep.has(id) || deck.hand.some((card) => card.id === id))) return false;
  }
  finishDraw(deck, keep, discardIds);
  return true;
}

export function discardHeldCards(deck: SeekDeck, cardIds: string[]) {
  deck.discard.push(...deck.hand.filter(({ id }) => cardIds.includes(id)));
  deck.hand = deck.hand.filter(({ id }) => !cardIds.includes(id));
}
