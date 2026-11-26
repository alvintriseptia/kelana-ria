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
  const queue = page.getByRole("region", { name: "Paket untuk tinjauan" });
  await auth.or(queue).waitFor();
  if (await auth.isVisible()) {
    await auth.fill(reviewerKey);
    await page.getByRole("button", { name: "Buka antrean tinjauan" }).click();
  }
  await queue.waitFor();
}

export async function buyPublishedDraft(page, packId, version = 1) {
  await page.locator(`.cat-card[data-pack-id="${packId}"][data-version="${version}"]`).click();
  await page.getByRole("button", { name: "Beli paket · Uji pembayaran" }).click();
  await page.getByRole("button", { name: "Simulasikan pembayaran berhasil" }).click();
  const restoreCard = page.getByTestId("restore-code-card");
  await restoreCard.waitFor();
  const restoreCode = (await page.getByTestId("restore-code-value").innerText()).trim();
  if (!/^KLR-[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(restoreCode)) {
    throw new Error(`Unexpected restore code format: ${restoreCode}`);
  }
  await page.getByRole("button", { name: "Salin kode" }).click();
  await page.getByRole("button", { name: "Masuk Ruang" }).click();
  return restoreCode;
}
