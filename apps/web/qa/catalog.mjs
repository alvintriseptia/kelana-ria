export function openEdition(page, format, board = "compact") {
  const area = board === "jakarta-wide" ? "wide" : "compact";
  const game = format === "hide-and-seek" ? "seek" : "claim";
  const packId = `official-jakarta-${area}-${game}`;
  return page.locator(`.cat-card[data-pack-id="${packId}"]`).first().click();
}
