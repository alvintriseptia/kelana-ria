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

async function goToStudioHome(page) {
  const backToStudio = page.locator('#st-header-slot button[data-studio-view="home"]');
  if (await backToStudio.isVisible()) await backToStudio.click();
}

export async function openDraft(page, packId, version = 1) {
  await goToStudioHome(page);
  await page.locator(`button[data-draft="${packId}@${version}"]`).click();
  await page.locator("#ed-meta-title").waitFor();
}

export async function openAdminPanel(page) {
  await goToStudioHome(page);
  await page.getByRole("button", { name: /^Panel Admin/ }).click();
  await page.getByRole("heading", { name: "Panel Admin", exact: true }).waitFor();
  await page.locator('button[data-admin-status="submitted"]').waitFor();
}

export function adminPack(page, packId, version = 1) {
  return page.locator(`article[data-admin-pack="${packId}"][data-version="${version}"]`);
}

export async function openAdminAction(page, trigger) {
  await trigger.click();
  const dialog = page.locator("dialog[data-admin-dialog][open]");
  await dialog.waitFor();
  return dialog;
}

export async function moderateAdminPack(page, packId, action, note) {
  const trigger = adminPack(page, packId).getByRole("button", { name: action, exact: true });
  const dialog = await openAdminAction(page, trigger);
  if (note) await dialog.getByRole("textbox").fill(note);
  await dialog.getByRole("button", { name: action, exact: true }).click();
  await dialog.waitFor({ state: "hidden" });
}

export async function buyPublishedDraft(page, packId, version = 1) {
  await page.locator(`.cat-card[data-pack-id="${packId}"][data-version="${version}"]`).click();
  await page.getByRole("button", { name: "Beli paket · Uji pembayaran" }).click();
  await page.getByRole("button", { name: "Simulasikan pembayaran berhasil" }).click();
}
