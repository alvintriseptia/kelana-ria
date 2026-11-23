export const reviewerKey = "kelana-qa-reviewer-fixture";

export async function startDraft(page, format) {
  await page.getByRole("button", { name: "Buat Game", exact: true }).click();
  await page.locator(`button[data-format="${format}"]`).click();
}

export async function openDraft(page, packId, version = 1) {
  await page.locator('button[data-studio-view="home"]').click();
  await page.locator(`button[data-draft="${packId}@${version}"]`).click();
  await page.locator("#ed-meta-title").waitFor();
}

export async function openReview(page) {
  await page.locator('button[data-studio-view="home"]').click();
  await page.locator('button[data-studio-view="review"]').click();
  const auth = page.getByLabel("Kunci peninjau");
  if (await auth.count()) {
    await auth.fill(reviewerKey);
    await page.getByRole("button", { name: "Buka antrean tinjauan" }).click();
  }
}

export async function buyPublishedDraft(page, packId, version = 1) {
  await page.locator(`.cat-card[data-pack-id="${packId}"][data-version="${version}"]`).click();
  await page.getByRole("button", { name: "Beli sesi · Uji pembayaran" }).click();
  await page.getByRole("button", { name: "Simulasikan pembayaran berhasil" }).click();
}
