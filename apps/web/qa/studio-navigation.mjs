export const reviewerKey = "kelana-qa-reviewer-fixture";

export async function signInQaContext(context, baseUrl, email, displayName = "Pemain QA") {
  const req = await context.request.post(`${baseUrl}/api/auth/request-otp`, {
    data: { email },
  });
  if (req.status() !== 200) {
    throw new Error(`request-otp failed (${req.status()}): ${await req.text()}`);
  }
  const { challengeId, sandboxCode } = await req.json();
  const ver = await context.request.post(`${baseUrl}/api/auth/verify-otp`, {
    data: { challengeId, code: sandboxCode, displayName },
  });
  if (ver.status() !== 200) {
    throw new Error(`verify-otp failed (${ver.status()}): ${await ver.text()}`);
  }
  return ver.json();
}

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
}
