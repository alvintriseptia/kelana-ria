import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { createRecordedMidtransAdapter, createSoloServer } from "../../api/dist/index.js";
import { assertCleanUiCopy } from "./copy-guard.mjs";
import {
  adminPack, buyPublishedDraft, moderateAdminPack, openAdminAction, openAdminPanel, openDraft, signInQaContext, startDraft,
} from "./studio-navigation.mjs";

const root = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const distDir = path.join(root, "dist");
const results = path.join(root, "qa-results");
await mkdir(results, { recursive: true });
const adminEmail = "studio-admin@kelana.test";
const creatorEmail = "studio-creator@kelana.test";
const studioUrl = "/?play=rulebook-studio";
const reviewUrl = `${studioUrl}&studio=review`;

const server = createSoloServer({
  databasePath: ":memory:",
  staticDir: distDir,
  midtrans: createRecordedMidtransAdapter(),
  allowSimulatedLocation: true,
  allowRulebookSandboxCheckout: true,
  allowSandboxAuthOtp: true,
  adminEmails: [adminEmail],
  osmPoi: { mode: "fixture" },
});

await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const baseUrl = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({
  channel: "chromium",
  executablePath: process.env.CHROMIUM_PATH || undefined,
  args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
});

async function clickAndWaitPost(page, selector) {
  await Promise.all([
    page.waitForResponse((r) => r.url().includes("/api/rulebooks") && r.request().method() === "POST"),
    page.click(selector),
  ]);
}

async function clickAndWaitStudioSave(page, selector) {
  await Promise.all([
    page.waitForResponse((r) => r.url().includes("/api/rulebooks") && r.request().method() === "POST"),
    page.waitForResponse((r) => r.url().includes("/api/rulebooks?role=writer") && r.request().method() === "GET"),
    page.click(selector),
  ]);
}

async function assertNoHorizontalOverflow(page, label) {
  const report = await page.evaluate(() => {
    const docOverflow = document.documentElement.scrollWidth - window.innerWidth;
    const offenders = [];
    for (const el of document.querySelectorAll(".rb-shell *")) {
      if (el.closest(".board-map-canvas")) continue;
      const rect = el.getBoundingClientRect();
      if (rect.width > 0 && rect.right > window.innerWidth + 1) {
        offenders.push({
          tag: el.tagName,
          id: el.id || "",
          cls: typeof el.className === "string" ? el.className : "",
          right: Math.round(rect.right),
          vw: window.innerWidth,
        });
        if (offenders.length >= 5) break;
      }
    }
    return {
      scrollWidth: document.documentElement.scrollWidth,
      innerWidth: window.innerWidth,
      docOverflow,
      offenders,
    };
  });
  assert.ok(
    report.scrollWidth <= report.innerWidth && report.offenders.length === 0,
    `Horizontal overflow on ${label} (${report.scrollWidth} > ${report.innerWidth}): ${JSON.stringify(report.offenders)}`,
  );
}

async function exercisePoiCurator(page, format, { fallback = false } = {}) {
  const mapCanvas = page.locator("#st-map-host .maplibregl-canvas");
  const canvas = fallback ? null : await mapCanvas.elementHandle();
  const drawer = page.getByRole("region", { name: "Kurasi POI" });
  await page.getByRole("button", { name: "Kurasi POI", exact: true }).press("Enter");
  await drawer.waitFor();
  assert.equal(await page.evaluate(() => document.activeElement.id), "st-osm-heading");
  const curateRoute = "**/api/rulebooks/studio/curate-pois";
  await page.route(curateRoute, route => route.fulfill({ status: 429, json: { error: "rate-limited" } }), { times: 1 });
  await drawer.getByRole("button", { name: "Cari POI di Area" }).click();
  await drawer.getByRole("alert").filter({ hasText: "Pencarian terlalu sering" }).waitFor();
  const [search] = await Promise.all([
    page.waitForResponse(response => response.url().endsWith("/studio/curate-pois")),
    drawer.getByRole("button", { name: "Coba Lagi" }).press("Enter"),
  ]);
  const { boundaryPolygon, zones, existingPoints } = search.request().postDataJSON();
  const { mode, candidates } = await search.json();
  assert.ok(search.ok(), JSON.stringify(await search.json()));
  assert.ok(boundaryPolygon.length >= 3 && existingPoints.length > 1);
  assert.ok(format === "claim" ? zones.length > 0 : zones === undefined);
  assert.equal(mode, "recorded-rehearsal");
  assert.ok(candidates.length > 5);
  const inside = ({ latitude, longitude }) => boundaryPolygon.reduce((inArea, vertex, index) => {
    const previous = boundaryPolygon.at(index - 1);
    const crosses = (vertex.latitude > latitude) !== (previous.latitude > latitude) &&
      longitude < vertex.longitude + (previous.longitude - vertex.longitude) *
        (latitude - vertex.latitude) / (previous.latitude - vertex.latitude);
    return crosses ? !inArea : inArea;
  }, false);
  assert.ok(candidates.every(inside), "All suggestions must be inside the submitted boundary");
  await drawer.getByText("Data Simulasi / Cadangan").waitFor();
  await drawer.getByText("© OpenStreetMap contributors (ODbL)").waitFor();

  const parks = drawer.getByRole("button", { name: "Taman", exact: true });
  await parks.press("Enter");
  assert.equal(await parks.getAttribute("aria-pressed"), "false");
  assert.equal(await drawer.locator("li").getByText("Taman", { exact: true }).count(), 0);
  await parks.press("Enter");
  await drawer.getByRole("button", { name: "Berikutnya" }).press("Enter");
  await drawer.locator("li:focus").waitFor();
  await drawer.getByRole("button", { name: "Sebelumnya" }).press("Enter");
  await drawer.locator("li:focus").waitFor();

  for (const viewport of [{ width: 390, height: 844 }, { width: 320, height: 640 }]) {
    await page.setViewportSize(viewport);
    const label = `OSM ${format}${fallback ? " tile failure" : ""} at ${viewport.width}×${viewport.height}`;
    await assertCleanUiCopy(page, label);
    await assertNoHorizontalOverflow(page, label);
    assert.ok(await drawer.locator("button:visible, select:visible").evaluateAll(controls =>
      controls.every(control => control.offsetWidth >= 44 && control.offsetHeight >= 44)));
  }
  await drawer.scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(results, `studio-kurasi-poi-${format}${fallback ? "-fallback" : ""}.png`) });
  await page.setViewportSize({ width: 390, height: 844 });

  const importActions = format === "claim" ? ["+ Jadikan Landmark", "+ Tambah sebagai POI"] : ["+ Tambah ke POI"];
  for (const action of importActions) {
    const actionButton = drawer.getByRole("button", { name: action, exact: true });
    const cardId = await actionButton.first().locator("..").getAttribute("data-osm-card");
    const card = drawer.locator(`[data-osm-card="${cardId}"]`);
    const candidate = candidates.find(point => point.osmId === cardId);
    const button = card.getByRole("button", { name: action, exact: true });
    const zone = action.includes("Landmark") ? await card.locator("select").inputValue() : undefined;
    if (zone && candidate.suggestedZoneId) assert.equal(zone, candidate.suggestedZoneId);
    const waitSave = () => page.waitForResponse(response => response.request().method() === "POST" &&
      response.url().endsWith("/api/rulebooks") && response.request().postDataJSON().type === "save-draft");
    if (format === "seek" && !fallback) {
      const undo = page.getByTestId("studio-map-undo");
      const undoBefore = await undo.getAttribute("aria-label");
      await page.route("**/api/rulebooks", route =>
        route.fulfill({ status: 503, json: { error: "Draf belum dapat disimpan." } }), { times: 1 });
      await button.press("Enter");
      await drawer.getByRole("alert").filter({ hasText: "POI belum tersimpan" }).waitFor();
      assert.equal(await undo.getAttribute("aria-label"), undoBefore, "Failed import must leave undo history intact");
      assert.equal(await card.getByText("Sudah di Draf ✓").count(), 0);
    }
    const [saved] = await Promise.all([waitSave(), button.press("Enter")]);
    const saveBody = await saved.json();
    assert.equal(saveBody.ok, true);
    const imported = zone ? saveBody.record.pack.geography.landmarks : saveBody.record.snapshot.pois;
    const point = imported.find(entry => entry.osmId === candidate.osmId);
    assert.equal(point.source, "osm-curated");
    assert.equal(point.fieldVerified, false);
    assert.equal(point.fieldVerificationNote, "");
    if (zone) assert.equal(point.zoneId, zone);
    else assert.equal(point.category, candidate.category);
    const attribution = saveBody.record.snapshot.attributions.filter(entry => entry.license === "ODbL 1.0");
    assert.ok(attribution.some(entry => entry.notice === "© OpenStreetMap contributors (ODbL)"));
    assert.equal(attribution.filter(entry => entry.source === "OpenStreetMap Overpass API").length, 1);

    await card.getByText("Sudah di Draf ✓").waitFor();
    await page.getByTestId("step2-inspector").locator("summary").getByText("Perlu Cek Lapangan").waitFor();
    const [undone] = await Promise.all([waitSave(), page.getByTestId("studio-map-undo").click()]);
    const undoBody = await undone.json();
    const remaining = zone ? undoBody.record.pack.geography.landmarks : undoBody.record.snapshot.pois;
    assert.ok(remaining.every(entry => entry.osmId !== candidate.osmId));
    assert.ok(undoBody.record.snapshot.attributions.every(entry => entry.source !== "OpenStreetMap Overpass API"));
    await button.waitFor();
  }

  if (canvas) assert.ok(await canvas.evaluate(element =>
    element === document.querySelector("#st-map-host .maplibregl-canvas")), "POI curation must retain the MapLibre canvas");
  await drawer.getByRole("button", { name: "Tutup", exact: true }).click();
  await drawer.waitFor({ state: "hidden" });
}

async function checkCompactForm(page, scope, label, saveSelector) {
  const originalViewport = page.viewportSize();
  try {
    await page.setViewportSize({ width: 320, height: 640 });
    await assertNoHorizontalOverflow(page, `${label} on a narrow phone`);
    const forms = await page.locator(`${scope} .rb-grid-2`).evaluateAll(grids => grids
      .filter(grid => grid.getClientRects().length)
      .map(grid => Array.from(grid.children)
        .filter(field => field.classList.contains("rb-field") && field.getClientRects().length)
        .map(field => field.getBoundingClientRect().top)));
    assert.ok(forms.some(rows => rows.length > 1) && forms.every(rows => rows.every(
      (top, index) => index === 0 || top > rows[index - 1],
    )), `${label} should show one field per row`);

    if (saveSelector) {
      // Leave the final field focused with the vertical space a phone keyboard would take.
      await page.setViewportSize({ width: 320, height: 360 });
      const finalField = page.locator(`${scope} .rb-field :is(input, select, textarea)`).filter({ visible: true }).last();
      await finalField.focus();
      await finalField.scrollIntoViewIfNeeded();
      assert.ok(await finalField.evaluate(field => document.activeElement === field &&
        field.getBoundingClientRect().bottom <= innerHeight), `${label} should reach its last field`);
      const save = page.locator(saveSelector);
      await save.scrollIntoViewIfNeeded();
      assert.ok(await save.evaluate(button => {
        const { x, y, width, height } = button.getBoundingClientRect();
        return button.contains(document.elementFromPoint(x + width / 2, y + height / 2));
      }), `${label} should reach Save in the reduced viewport`);
    }
  } finally {
    await page.setViewportSize(originalViewport);
  }
}

async function checkValidationSpacing(page, format) {
  const originalViewport = page.viewportSize();
  try {
    for (const viewport of [{ width: 320, height: 640 }, { width: 390, height: 844 }]) {
      await page.setViewportSize(viewport);
      const bounds = await page.locator("#st-body-slot > .rb-card").evaluateAll(cards =>
        cards.map(card => {
          const { top, bottom } = card.getBoundingClientRect();
          return { top, bottom };
        }));
      assert.equal(bounds.length, 2, `Expected two Validasi cards for ${format}`);
      assert.equal(await page.getByTestId("studio-home-earnings").count(), 0, `Creator earnings must not appear in Step 4 for ${format}`);
      assert.ok(bounds.slice(1).every((card, index) => card.top - bounds[index].bottom >= 16),
        `Validasi cards should have a 16px gap for ${format} at ${viewport.width}px`);
      await assertNoHorizontalOverflow(page, `Validasi for ${format} at ${viewport.width}px`);
    }
    await page.screenshot({ path: path.join(results, `studio-validasi-${format}.png`), fullPage: true });
  } finally {
    await page.setViewportSize(originalViewport);
  }
}

async function checkAdminPhoneLayout(page, scope, label) {
  const originalViewport = page.viewportSize();
  try {
    for (const viewport of [{ width: 390, height: 844 }, { width: 320, height: 640 }]) {
      await page.setViewportSize(viewport);
      const phoneLabel = `${label} at ${viewport.width}×${viewport.height}`;
      await assertNoHorizontalOverflow(page, phoneLabel);
      await assertCleanUiCopy(page, phoneLabel);
      const smallTargets = await scope.locator('button, summary, input, textarea, a[href]').evaluateAll(controls =>
        controls.filter(control => {
          const { width, height } = control.getBoundingClientRect();
          return width > 0 && height > 0 && (width < 44 || height < 44);
        }).map(control => control.getAttribute("aria-label") || control.innerText || control.outerHTML));
      assert.deepEqual(smallTargets, [], `Expected 44×44 touch targets on ${phoneLabel}`);
    }
  } finally {
    await page.setViewportSize(originalViewport);
  }
}

async function checkCreatorReviewAccess(page) {
  await page.goto(`${baseUrl}${studioUrl}`);
  await page.getByTestId("auth-chip-account").click();
  const account = page.getByRole("dialog", { name: "Akun Kelana Ria" });
  await account.getByText(creatorEmail, { exact: true }).waitFor();
  assert.equal(await account.getByTestId("auth-admin-badge").count(), 0);
  await page.keyboard.press("Escape");
  await account.waitFor({ state: "hidden" });
  assert.equal(await page.getByRole("button", { name: /^(Panel Admin|Peninjau)\b/ }).count(), 0);

  await page.goto(`${baseUrl}${reviewUrl}`);
  await page.getByText("Akses khusus admin peninjau", { exact: true }).waitFor();
  assert.equal(await page.locator("[data-admin-pack]").count(), 0);
  await checkAdminPhoneLayout(page, page.locator("#st-body-slot"), "Admin access denied");
  await page.locator("#st-body-slot").getByRole("button", { name: /Kembali ke Studio/ }).click();
  await page.getByRole("heading", { name: "Studio Kreator", exact: true }).waitFor();
}

async function exerciseAdminConsole(creator, creatorContext) {
  const claimId = "pack-claim-studio-qa";
  const seekId = "pack-seek-admin-qa";
  const revisionNote = "Perjelas jalur masuk untuk pengunjung.";
  const pauseReason = "Lokasi ditutup sementara untuk pemeliharaan.";
  await checkCreatorReviewAccess(creator);

  const clone = await creatorContext.request.post(`${baseUrl}/api/rulebooks`, {
    data: {
      type: "clone-official", templatePackId: "official-jakarta-compact-seek",
      packId: seekId, title: "Rute Stasiun untuk Tinjauan", byline: "Kreator Studio", priceIdr: 0,
    },
  });
  assert.equal(clone.status(), 200, await clone.text());
  const submit = await creatorContext.request.post(`${baseUrl}/api/rulebooks`, {
    data: { type: "submit-draft", packId: seekId, version: 1 },
  });
  assert.equal(submit.status(), 200, await submit.text());

  const adminContext = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  try {
    const admin = await adminContext.newPage();
    await admin.goto(`${baseUrl}${reviewUrl}`);
    await admin.getByText("Akses khusus admin peninjau", { exact: true }).waitFor();
    await admin.locator("#st-body-slot").getByRole("button", { name: "Masuk dengan Email", exact: true }).waitFor();
    const { user } = await signInQaContext(adminContext, baseUrl, adminEmail, "Admin Studio");
    assert.equal(user.role, "admin");
    await admin.goto(`${baseUrl}${studioUrl}`);
    const accountChip = admin.getByTestId("auth-chip-account");
    await accountChip.click();
    const account = admin.getByRole("dialog", { name: "Akun Kelana Ria" });
    assert.equal(await account.getByTestId("auth-admin-badge").innerText(), "Admin");
    await admin.keyboard.press("Escape");
    await account.waitFor({ state: "hidden" });
    await openAdminPanel(admin);
    assert.equal(await admin.locator('input[type="password"]').count(), 0);
    assert.equal(await admin.getByTestId("auth-modal").count(), 0);

    const console = admin.locator("#st-body-slot");
    const status = key => console.locator(`button[data-admin-status="${key}"]`);
    const format = key => console.locator(`button[data-admin-format="${key}"]`);
    const selectStatus = async key => {
      await status(key).tap();
      assert.equal(await status(key).getAttribute("aria-pressed"), "true");
      assert.equal(await console.locator('button[data-admin-status][aria-pressed="true"]').count(), 1);
    };
    const claim = adminPack(admin, claimId);
    const seek = adminPack(admin, seekId);
    await claim.waitFor();
    await seek.waitFor();
    assert.equal(await status("submitted").getAttribute("aria-pressed"), "true");
    assert.match(await status("submitted").innerText(), /Menunggu Tinjauan\D+2\b/s);
    assert.match(await status("published").innerText(), /Terbit\D+0\b/s);
    assert.match(await status("paused").innerText(), /Dijeda\D+0\b/s);
    assert.match(await status("all").innerText(), /Semua\D+2\b/s);
    const claimSummary = await claim.innerText();
    for (const pattern of [/Studio QA Claim Pack/, /Kreator Studio/, /Claim the City/, /Rp\s*25\.000/, /v1/, /Menunggu Tinjauan/, /\bValid\b/, /zona/i, /landmark/i, /tantangan/i]) {
      assert.match(claimSummary, pattern);
    }
    assert.match(await seek.innerText(), /Gratis/);
    await checkAdminPhoneLayout(admin, console, "Admin queue");
    await admin.setViewportSize({ width: 320, height: 640 });
    await admin.evaluate(() => window.scrollTo(0, 0));
    await admin.screenshot({ path: path.join(results, "studio-panel-admin-320.png") });
    await admin.setViewportSize({ width: 390, height: 844 });

    await format("hide-and-seek").tap();
    assert.equal(await format("hide-and-seek").getAttribute("aria-pressed"), "true");
    await claim.waitFor({ state: "hidden" });
    await seek.waitFor();
    const seekInspect = seek.locator("details[data-admin-inspect] > summary");
    await seekInspect.tap();
    await seek.getByRole("heading", { name: "Lokasi", exact: true }).waitFor();
    await checkAdminPhoneLayout(admin, console, "Hide & Seek inspection");
    await seek.getByRole("button", { name: "Uji Coba (Admin QA)", exact: true }).tap();
    assert.match(await admin.getByTestId("draft-playtest-badge").innerText(), /Uji Draf/);
    await admin.locator("#sg-qa-location").waitFor();
    await admin.getByRole("link", { name: "← Kembali ke Panel Admin", exact: true }).tap();
    await admin.getByRole("heading", { name: "Panel Admin", exact: true }).waitFor();

    await format("claim-the-city").tap();
    assert.equal(await format("claim-the-city").getAttribute("aria-pressed"), "true");
    await seek.waitFor({ state: "hidden" });
    const inspectionDrawer = claim.locator("details[data-admin-inspect]");
    const inspect = inspectionDrawer.locator("summary");
    const openClaimInspection = async () => {
      await inspect.waitFor();
      if (!(await inspectionDrawer.evaluate(details => details.open))) await inspect.tap();
    };
    await openClaimInspection();
    await claim.getByRole("heading", { name: "Lokasi", exact: true }).waitFor();
    const inspection = await claim.innerText();
    for (const pattern of [/Taman Literasi/, /Jam Buka Umum/, /Catatan Akses/, /Koordinat/, /Lihat dari sisi undakan/, /Posisi yang lebih tinggi membantu penonton/, /Sabotase Kemang/]) {
      assert.match(inspection, pattern);
    }
    await claim.locator('dt:text-is("Kunci Jawaban") + dd').filter({ hasText: /^baris belakang · belakang$/ }).waitFor();
    await claim.locator('dt:text-is("Catatan Verifikasi Kreator") + dd').filter({ hasText: /Sumber Plaza Kabaresi/ }).waitFor();
    await checkAdminPhoneLayout(admin, console, "Claim inspection");
    await admin.setViewportSize({ width: 320, height: 640 });
    await claim.getByRole("button", { name: "Uji Coba (Admin QA)", exact: true }).tap();
    assert.match(await admin.getByTestId("draft-playtest-badge").innerText(), /Uji Draf/);
    await admin.getByTestId("claim-qa-location").waitFor();
    await assertNoHorizontalOverflow(admin, "Claim admin playtest at 320×640");
    await admin.getByRole("link", { name: "← Kembali ke Panel Admin", exact: true }).tap();
    await admin.getByRole("heading", { name: "Panel Admin", exact: true }).waitFor();
    await openClaimInspection();

    const revise = claim.getByRole("button", { name: "Minta Revisi", exact: true });
    const reviseDialog = await openAdminAction(admin, revise);
    const note = reviseDialog.getByRole("textbox", { name: "Catatan Revisi" });
    await note.fill("   ");
    const confirmRevision = reviseDialog.getByRole("button", { name: "Minta Revisi", exact: true });
    await confirmRevision.tap();
    assert.equal(await note.evaluate(input => input.validity.valid), false, "Revision requires a nonblank note");
    await note.fill(revisionNote);
    await checkAdminPhoneLayout(admin, reviseDialog, "Revision dialog");
    await confirmRevision.tap();
    await admin.getByText("Permintaan revisi dikirim ke kreator.", { exact: true }).waitFor();
    await claim.waitFor({ state: "hidden" });
    await creator.goto(`${baseUrl}${studioUrl}`);
    await openDraft(creator, claimId);
    await creator.getByTestId("revision-note-banner").getByText(revisionNote, { exact: true }).waitFor();
    await creator.locator('button[data-step="4"]').click();
    await clickAndWaitPost(creator, 'button[data-action="submit-draft"]');
    await creator.getByText("Draf diajukan ke peninjau editorial.", { exact: true }).waitFor();

    await admin.reload();
    await openClaimInspection();
    const publish = claim.getByRole("button", { name: "Terbitkan ke Katalog", exact: true });
    const publishDialog = await openAdminAction(admin, publish);
    await admin.keyboard.press("Escape");
    await publishDialog.waitFor({ state: "hidden" });
    assert.ok(await publish.evaluate(button => button === document.activeElement), "Escape should restore focus to Publish");
    await checkAdminPhoneLayout(admin, console, "Resubmitted queue");
    await moderateAdminPack(admin, claimId, "Terbitkan ke Katalog");
    await admin.getByText("Paket diterbitkan ke katalog.", { exact: true }).waitFor();
    await selectStatus("published");
    await openClaimInspection();
    assert.match(await status("published").innerText(), /Terbit\D+1\b/s);

    const pause = claim.getByRole("button", { name: "Jeda Penjualan", exact: true });
    const pauseDialog = await openAdminAction(admin, pause);
    const confirmPause = pauseDialog.getByRole("button", { name: "Jeda Penjualan", exact: true });
    const reason = pauseDialog.getByRole("textbox", { name: "Alasan Jeda" });
    await confirmPause.tap();
    assert.equal(await reason.evaluate(input => input.validity.valueMissing), true, "Pause requires a reason");
    await reason.fill(pauseReason);
    await confirmPause.tap();
    await admin.getByText("Penjualan paket dijeda.", { exact: true }).waitFor();
    await selectStatus("paused");
    await openClaimInspection();
    assert.match(await status("paused").innerText(), /Dijeda\D+1\b/s);
    await moderateAdminPack(admin, claimId, "Aktifkan Kembali");
    await admin.getByText("Paket kembali tersedia di katalog.", { exact: true }).waitFor();
    await selectStatus("published");
    await openClaimInspection();

    const audit = claim.getByRole("region", { name: "Riwayat Tinjauan" });
    const rows = await audit.getByRole("listitem").allTextContents();
    assert.equal(rows.length, 4);
    for (const [index, label] of ["Minta Revisi", "Terbit", "Dijeda", "Aktifkan Kembali"].entries()) {
      assert.ok(rows[index].includes(label), `Expected audit entry ${index + 1} to record ${label}`);
      assert.ok(rows[index].includes("Admin Studio") && rows[index].includes(adminEmail));
    }
    assert.ok(rows[0].includes(revisionNote));
    assert.ok(rows[2].includes(pauseReason));
    const dates = await audit.locator("time").evaluateAll(times => times.map(time => Date.parse(time.dateTime)));
    assert.equal(dates.length, 4);
    assert.ok(dates.every((date, index) => Number.isFinite(date) && (index === 0 || date >= dates[index - 1])));
    await checkAdminPhoneLayout(admin, console, "Published audit trail");
    await admin.setViewportSize({ width: 390, height: 844 });
    await audit.screenshot({ path: path.join(results, "studio-admin-audit-390.png") });

    await console.getByRole("button", { name: "Kelola Admin", exact: true }).tap();
    const grantForm = console.locator("form[data-admin-grant]");
    const bootstrapped = console.locator(`li[data-admin-email="${adminEmail}"]`);
    await bootstrapped.getByText("Bawaan Server", { exact: true }).waitFor();
    assert.equal(await bootstrapped.getByRole("button", { name: "Cabut Akses", exact: true }).isDisabled(), true);
    await grantForm.getByRole("textbox", { name: "Email Akun" }).fill(creatorEmail);
    await grantForm.getByRole("button", { name: "Tambah Admin", exact: true }).tap();
    const promoted = console.locator(`li[data-admin-email="${creatorEmail}"]`);
    await promoted.getByText("Kreator Studio", { exact: true }).waitFor();
    await checkAdminPhoneLayout(admin, console, "Admin accounts");

    await creator.goto(`${baseUrl}${studioUrl}`);
    await openAdminPanel(creator);
    const revoke = promoted.getByRole("button", { name: "Cabut Akses", exact: true });
    const revokeDialog = await openAdminAction(admin, revoke);
    await checkAdminPhoneLayout(admin, revokeDialog, "Revoke admin dialog");
    await revokeDialog.getByRole("button", { name: "Cabut Akses", exact: true }).tap();
    await promoted.waitFor({ state: "hidden" });
    await checkCreatorReviewAccess(creator);
  } finally {
    await adminContext.close();
  }
}

try {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();

  // Direct Studio URL as guest shows studio-auth-gate inline without blocking navigation
  await page.goto(`${baseUrl}/?play=rulebook-studio`, { waitUntil: "networkidle" });
  const gate = page.getByTestId("studio-auth-gate");
  await gate.waitFor();
  await assertNoHorizontalOverflow(page, "Direct Studio auth gate");
  await gate.getByRole("button", { name: "Masuk dengan Email" }).click();
  const directModal = page.getByTestId("auth-modal");
  await directModal.waitFor();
  assert.match(await directModal.innerText(), /menyimpan draf, publikasi, dan pendapatan kreator/i);
  await assertNoHorizontalOverflow(page, "Studio auth modal");
  await page.keyboard.press("Escape");
  await directModal.waitFor({ state: "hidden" });

  // Return to catalog and tap Studio Kreator as guest -> opens 2-step Email OTP modal and signs in
  await page.goto(`${baseUrl}/catalog`, { waitUntil: "networkidle" });
  await page.click("#chooser-studio");
  const studioAuthModal = page.getByTestId("auth-modal");
  await studioAuthModal.waitFor();
  await page.fill("#auth-email-input", creatorEmail);
  await page.getByTestId("auth-send-otp").click();
  const studioOtpCode = (await page.getByTestId("auth-sandbox-code").innerText()).trim();
  await page.fill("#auth-otp-input", studioOtpCode);
  await page.fill("#auth-name-input", "Kreator Studio");
  await page.getByTestId("auth-verify-otp").click();
  await studioAuthModal.waitFor({ state: "hidden" });
  await page.getByTestId("auth-chip-account").waitFor();

  // #150: First-time creator with zero drafts sees visual 4-step Cara Buat Game onboarding & quick-start format buttons
  const emptyOnboarding = page.getByTestId("studio-empty-onboarding");
  await emptyOnboarding.waitFor();
  assert.equal(await page.locator('[data-testid="studio-empty-steps"] li').count(), 4, "Studio empty state must show 4 steps");
  assert.equal(await page.locator('[data-testid="studio-empty-steps"] svg').count(), 4, "Studio empty state steps must include step icons");
  await page.getByTestId("studio-quickstart-claim").waitFor();
  await page.getByTestId("studio-quickstart-seek").waitFor();
  await assertNoHorizontalOverflow(page, "Studio Home empty onboarding at 390x844");
  await page.setViewportSize({ width: 320, height: 640 });
  await assertNoHorizontalOverflow(page, "Studio Home empty onboarding at 320x640");
  await page.setViewportSize({ width: 390, height: 844 });
  await assertCleanUiCopy(page, "Studio Home empty onboarding");
  await page.getByTestId("studio-quickstart-seek").click();
  await page.waitForSelector('button[data-action="clone"]');
  await page.click('button[data-studio-view="format"]');
  await page.click('button[data-studio-view="home"]');
  await emptyOnboarding.waitFor();

  // 1. Hide & Seek Studio: multi-draft switcher, intentional validator error -> jump link -> fix -> interactive clue dry-run
  await page.getByRole("button", { name: "Buat Game", exact: true }).click();
  assert.equal(await page.locator('button[data-format] svg').count(), 2, "Expected SVG art on format hero cards");
  await page.screenshot({ path: path.join(results, "studio-step1-format-cards.png") });
  await assertNoHorizontalOverflow(page, "Format choices");
  await assertCleanUiCopy(page, "Studio format choices");
  await page.click('button[data-format="hide-and-seek"]');
  await page.waitForSelector('button[data-action="clone"]');
  await assertNoHorizontalOverflow(page, "Template setup");
  await checkCompactForm(page, '[data-testid="clone-template-card"]', "Hide & Seek template");
  await assertCleanUiCopy(page, "Studio template setup");

  // #148: Signed-in creator displayName prefill, auto-slug from Title, manual ID tucked under collapsed <details>
  assert.equal(await page.inputValue("#st-byline"), "Kreator Studio", "Byline must prefill signed-in displayName");
  assert.equal(await page.getByTestId("pack-id-advanced").getAttribute("open"), null, "ID Paket (Lanjutan) must be collapsed by default");
  await page.fill("#st-title", "Kopi Senopati Baru");
  assert.equal((await page.getByTestId("slug-preview").innerText()).trim(), "pack-kopi-senopati-baru", "Slug must auto-generate from Title");
  await page.locator('[data-testid="pack-id-advanced"] summary').click();
  await page.fill("#st-pack-id", "pack-seek-alpha");
  await page.fill("#st-title", "Alpha Seek Draft Very Long Title For Mobile Select Wrapping Check");
  await clickAndWaitPost(page, 'button[data-action="clone"]');
  await page.locator("#ed-meta-title").waitFor();
  assert.equal(await page.locator('button[data-step] svg').count(), 4, "Expected SVG icons on all 4 step buttons");
  assert.equal(await page.locator('button[data-format], #st-template, button[data-draft]').count(), 0);
  // #148: Step 1 live Catalog card preview updates immediately on input, Unduh JSON removed from Step 1 sticky footer & tucked into header overflow menu
  assert.equal(await page.locator('.rb-sticky-footer button[data-action="export-json"]').count(), 0, "Unduh JSON must not appear in Step 1 sticky footer");
  const moreMenu = page.getByTestId("studio-more-menu");
  await moreMenu.locator("summary").click();
  await moreMenu.locator('button[data-action="export-json"]').waitFor();
  await moreMenu.locator('button[data-studio-view="import"]').waitFor();
  await moreMenu.locator("summary").click();
  const preview = page.getByTestId("step1-catalog-preview");
  await preview.waitFor();
  const origAlphaTitle = await page.inputValue("#ed-meta-title");
  const origAlphaCity = await page.inputValue("#ed-meta-city");
  const origAlphaPrice = await page.inputValue("#ed-meta-price");
  await page.fill("#ed-meta-title", "Pratinjau Langsung Alpha");
  await page.fill("#ed-meta-city", "Jakarta Selatan · Blok M");
  await page.fill("#ed-meta-price", "45000");
  await page.fill("#ed-meta-summary", "Ringkasan uji pratinjau langsung");
  assert.equal((await preview.locator('[data-preview-field="title"]').innerText()).trim(), "Pratinjau Langsung Alpha");
  assert.equal((await preview.locator('[data-preview-field="city"]').innerText()).trim(), "Jakarta Selatan · Blok M");
  assert.match(await preview.locator('[data-preview-field="price"]').innerText(), /Rp\s*45\.000/);
  assert.equal((await preview.locator('[data-preview-field="summary"]').innerText()).trim(), "Ringkasan uji pratinjau langsung");
  await page.fill("#ed-meta-title", origAlphaTitle);
  await page.fill("#ed-meta-city", origAlphaCity);
  await page.fill("#ed-meta-price", origAlphaPrice);
  await clickAndWaitStudioSave(page, 'button[data-action="save-draft"]');

  await assertNoHorizontalOverflow(page, "Draft editor");
  await assertCleanUiCopy(page, "Studio Step 1 draft editor");
  await page.screenshot({ path: path.join(results, "studio-dedicated-editor.png") });
  // #146: Editing Step 1 summary sets status pill to Belum disimpan and auto-saves when tapping Peta -> without manual Simpan
  assert.equal(await page.getByTestId("studio-save-status").getAttribute("data-save-state"), "saved");
  await page.fill("#ed-meta-summary", "Catatan draf Alpha auto-simpan");
  assert.equal(await page.getByTestId("studio-save-status").getAttribute("data-save-state"), "dirty");
  assert.equal(await page.getByTestId("studio-save-status").innerText(), "Belum disimpan");
  await clickAndWaitStudioSave(page, 'button[data-step="2"]');
  await page.waitForSelector('[data-testid="studio-map-host"]');
  assert.equal(await page.getByTestId("studio-save-status").getAttribute("data-save-state"), "saved");
  await page.reload();
  await page.locator("#ed-meta-summary").waitFor();
  assert.equal(await page.inputValue("#ed-meta-summary"), "Catatan draf Alpha auto-simpan");
  await page.fill("#ed-meta-summary", "Catatan draf Alpha tersimpan");
  await clickAndWaitStudioSave(page, 'button[data-action="save-draft"]');
  await page.reload();
  await page.locator("#ed-meta-summary").waitFor();
  assert.equal(await page.inputValue("#ed-meta-summary"), "Catatan draf Alpha tersimpan");

  // #148: Studio Home shows Creator Earnings dashboard & supports safe draft deletion with accessible confirmation dialog
  await page.click('button[data-studio-view="home"]');
  await page.locator('button[data-draft="pack-seek-alpha@1"]').waitFor();
  await page.getByTestId("studio-home-earnings").waitFor();
  await assertNoHorizontalOverflow(page, "My drafts");
  await page.setViewportSize({ width: 320, height: 640 });
  await assertNoHorizontalOverflow(page, "Studio Home with earnings and delete button at 320x640");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: path.join(results, "studio-my-drafts.png") });

  await startDraft(page, "hide-and-seek");
  await page.fill("#st-title", "Draf Hapus QA");
  assert.equal((await page.getByTestId("slug-preview").innerText()).trim(), "pack-draf-hapus-qa");
  await clickAndWaitPost(page, 'button[data-action="clone"]');
  await page.locator("#ed-meta-title").waitFor();
  await page.click('button[data-studio-view="home"]');
  const deleteDraftRow = page.locator('button[data-draft="pack-draf-hapus-qa@1"]');
  await deleteDraftRow.waitFor();
  await page.locator('button[data-action="confirm-delete-draft"][data-pack="pack-draf-hapus-qa"]').click();
  const deleteDialog = page.getByTestId("delete-draft-dialog");
  await deleteDialog.waitFor();
  assert.equal(await deleteDialog.getAttribute("role"), "dialog");
  assert.equal(await deleteDialog.getAttribute("aria-modal"), "true");
  await page.keyboard.press("Escape");
  await deleteDialog.waitFor({ state: "hidden" });
  assert.equal(await deleteDraftRow.count(), 1, "Canceling delete dialog with Escape must preserve draft");
  await page.locator('button[data-action="confirm-delete-draft"][data-pack="pack-draf-hapus-qa"]').click();
  await deleteDialog.waitFor();
  await clickAndWaitStudioSave(page, 'button[data-action="execute-delete-draft"]');
  await deleteDialog.waitFor({ state: "hidden" });
  assert.equal(await deleteDraftRow.count(), 0, "Confirmed draft deletion must remove draft from Studio Home");

  await startDraft(page, "hide-and-seek");
  await page.selectOption("#st-template", "official-jakarta-wide-seek");
  await page.locator('[data-testid="pack-id-advanced"] summary').click();
  await page.fill("#st-pack-id", "pack-seek-beta");
  await page.fill("#st-title", "Beta Seek Draft");
  await clickAndWaitPost(page, 'button[data-action="clone"]');

  // Edit a specific Wide station by keyboard and preserve changes when filtering transit.
  await page.click('button[data-step="2"]');
  await page.locator('button[data-map-drawer="points"]').click();
  await page.fill("#st-point-search", "mrt-senayan");
  const wideStation = page.locator('button[data-select-kind="station"][data-select-id="mrt-senayan"]');
  await wideStation.press("Enter");
  const pointName = page.locator('[data-point-fields] input[data-field="name"]');
  await pointName.fill("Senayan Wide QA");
  assert.equal(await page.locator("[data-map-save-state]").innerText(), "Belum disimpan");
  await page.click('button[data-map-drawer="transit"]');
  await page.locator("#st-transit-search").waitFor();
  await page.selectOption("#st-transit-filter", "mrt");
  assert.equal(await pointName.inputValue(), "Senayan Wide QA");
  await clickAndWaitStudioSave(page, 'button[data-map-action="apply-selected"]');
  await page.locator("[data-map-save-state]").filter({ hasText: "Tersimpan" }).waitFor();

  await page.route("**/api/map/config", route => route.fulfill({ json: {
    mode: "geoapify-vector", styleUrl: "/qa-failed-studio-style", mapLibreLicenseUrl: "/licenses/maplibre-gl.txt",
  } }));
  let blockedStudioTiles = 0;
  await page.route("**/qa-studio-tiles/**", route => {
    blockedStudioTiles++;
    return route.abort();
  });
  await page.route("**/qa-failed-studio-style", route => route.fulfill({ json: {
    version: 8,
    sources: { qa: { type: "vector", tiles: [`${baseUrl}/qa-studio-tiles/{z}/{x}/{y}.pbf`] } },
    layers: [{ id: "qa-land", type: "fill", source: "qa", "source-layer": "land" }],
  } }));
  await page.reload();
  await page.click('button[data-step="2"]');
  await page.getByTestId("studio-map-fallback").waitFor();
  await page.fill("#st-point-search", "Senayan Wide QA");
  await wideStation.press("Enter");
  assert.equal(await pointName.inputValue(), "Senayan Wide QA");
  await pointName.fill("Senayan Wide QA fallback");
  await clickAndWaitStudioSave(page, 'button[data-map-action="apply-selected"]');
  assert.equal(await pointName.inputValue(), "Senayan Wide QA fallback");
  await assertNoHorizontalOverflow(page, "Wide fallback point editor");
  assert.ok(blockedStudioTiles > 0);
  await page.unroute("**/qa-studio-tiles/**");
  await page.unroute("**/api/map/config");
  await page.unroute("**/qa-failed-studio-style");
  await page.getByRole("button", { name: "Coba muat peta" }).click();
  await page.locator("#st-map-host .maplibregl-ctrl-zoom-in").waitFor();

  // Switch back to Alpha draft
  await openDraft(page, "pack-seek-alpha");
  await page.waitForFunction(() => document.body.textContent.includes("pack-seek-alpha v1"));
  assert.equal(await page.inputValue("#ed-meta-summary"), "Catatan draf Alpha tersimpan");

  // Intercept /api/map/config & /api/map/style.json before first Step 2 entry so both Hide & Seek and Claim verify zero style re-fetches
  let styleFetchCount = 0;
  await page.route("**/api/map/config", (route) =>
    route.fulfill({
      json: {
        mode: "geoapify-vector",
        styleUrl: "/api/map/style.json",
        attribution: "© Geoapify · © OpenStreetMap",
        mapLibreLicenseUrl: "/licenses/maplibre-gl.txt",
        tileCreditCost: 0.25,
        routingCreditCost: 1,
        freeDailyCredits: 3000,
      },
    }),
  );
  await page.route("**/api/map/style.json", (route) => {
    styleFetchCount += 1;
    return route.fulfill({
      json: {
        version: 8,
        sources: {},
        layers: [{ id: "bg", type: "background", paint: { "background-color": "#f3f4eb" } }],
      },
    });
  });

  // Verify Hide & Seek Step 2 sub-tabs, preloaded built-in Jakarta transit map pins/chips, zero overflow, and style fetch = 1
  await page.click('button[data-step="2"]');
  await page.waitForSelector('[data-testid="studio-map-host"]');
  await page.waitForFunction(() => Boolean(window.document.querySelector("#st-map-host .maplibregl-ctrl-zoom-in")));
  assert.equal(await page.getByTestId("jakarta-transit-panel").count(), 0);
  assert.equal(await page.locator(".studio-point-list").count(), 0);
  assert.ok((await page.locator("#st-map-host .board-map-canvas").boundingBox()).height > 420);
  await page.screenshot({ path: path.join(results, "studio-map-first.png") });
  await page.screenshot({ path: path.join(results, "studio-peta-mobile.png"), fullPage: true });
  await checkCompactForm(page, '[data-testid="step2-inspector"]', "Hide & Seek map inspector", '[data-map-action="apply-selected"]');
  assert.equal(await page.getAttribute('button[data-map-tab="primary"]', "aria-pressed"), "true");
  await page.click('button[data-map-drawer="transit"]');
  await page.waitForSelector('[data-testid="jakarta-transit-panel"] button[data-toggle-transit-id]');
  assert.equal(styleFetchCount, 1, "Expected 1 style.json fetch on first Step 2 entry");
  assert.equal(await page.locator('button[data-transit-mode]').count(), 4, "Expected 4 transit mode chips (MRT/LRT/KRL/TJ)");
  assert.match(await page.textContent('[data-testid="jakarta-transit-panel"]'), /OpenStreetMap.*Transjakarta/);

  const seekCanvas = await page.locator("#st-map-host .maplibregl-canvas").elementHandle();
  assert.ok(seekCanvas, "Expected MapLibre canvas on Hide & Seek Step 2");

  // Toggle TJ mode OFF then back ON + toggle a built-in transit station without re-creating the map
  await clickAndWaitStudioSave(page, 'button[data-transit-mode="transjakarta"]');
  await page.waitForFunction(
    () => document.querySelector('button[data-transit-mode="transjakarta"]')?.getAttribute("aria-pressed") === "false",
  );
  await clickAndWaitStudioSave(page, 'button[data-transit-mode="transjakarta"]');
  await page.waitForFunction(
    () => document.querySelector('button[data-transit-mode="transjakarta"]')?.getAttribute("aria-pressed") === "true",
  );

  const firstToggleBtn = page.locator('button[data-toggle-transit-id]').first();
  const targetTransitId = await firstToggleBtn.getAttribute("data-toggle-transit-id");
  const prevPressed = await firstToggleBtn.getAttribute("aria-pressed");
  const expectedPressed = prevPressed === "true" ? "false" : "true";
  await clickAndWaitStudioSave(page, `button[data-toggle-transit-id="${targetTransitId}"]`);
  await page.waitForFunction(
    ({ id, expected }) =>
      document.querySelector(`button[data-toggle-transit-id="${id}"]`)?.getAttribute("aria-pressed") === expected,
    { id: targetTransitId, expected: expectedPressed },
  );

  for (const mapTab of ["primary", "secondary", "start", "boundary"]) {
    await page.click(`button[data-map-tab="${mapTab}"]`);
    await assertNoHorizontalOverflow(page, `Hide & Seek Step 2 tab=${mapTab}`);
  }
  await assertCleanUiCopy(page, "Hide & Seek Step 2 map");
  await exercisePoiCurator(page, "seek");
  assert.equal(styleFetchCount, 1, "Hide & Seek Step 2 transit toggles & tabs must not re-fetch style.json");
  assert.equal(
    await seekCanvas.evaluate((el) => el.isConnected && document.querySelector("#st-map-host .maplibregl-canvas") === el),
    true,
    "Same MapLibre canvas DOM element must remain mounted across built-in transit toggles",
  );

  // Trigger intentional validation error (hidingZoneRadiusMeters = 10)
  await page.click('button[data-step="3"]');
  await page.waitForSelector("#ed-zone");
  await assertNoHorizontalOverflow(page, "Hide & Seek Step 3 timers");
  await page.screenshot({ path: path.join(results, "studio-aturan-mobile.png"), fullPage: true });
  await assertCleanUiCopy(page, "Hide & Seek Step 3 timers");
  await checkCompactForm(page, '[data-testid="seek-timers-panel"]', "Hide & Seek session rules", '.studio-save');
  await page.fill("#ed-zone", "10");
  await clickAndWaitStudioSave(page, 'button[data-action="save-draft"]');
  await page.waitForSelector('button[data-jump-path]');
  await assertNoHorizontalOverflow(page, "Validator errors banner on 390px");
  await assertCleanUiCopy(page, "Hide & Seek Step 3 validator banner");
  await checkCompactForm(page, '[data-testid="seek-timers-panel"]', "Hide & Seek rule validation");

  // #146: Edit Head Start timer without clicking Simpan -> switching to Pertanyaan sub-tab auto-saves without data loss
  const nextHeadStart = String(Number(await page.inputValue("#ed-head")) + 2);
  await page.fill("#ed-head", nextHeadStart);
  assert.equal(await page.getByTestId("studio-save-status").getAttribute("data-save-state"), "dirty");
  await Promise.all([
    page.waitForResponse((r) => r.url().includes("/api/rulebooks") && r.request().method() === "POST"),
    page.waitForResponse((r) => r.url().includes("/api/rulebooks?role=writer") && r.request().method() === "GET"),
    page.locator('button[data-s3-tab="book"]').press("Enter"),
  ]);
  await page.waitForSelector('button[data-s3-tab="book"][aria-pressed="true"]');
  assert.equal(await page.locator('button[data-s3-tab="book"]:focus').count(), 1);
  assert.equal(await page.locator('button[data-s3-family] svg').count(), 6, "Expected 6 Question Family SVG tiles");
  await assertNoHorizontalOverflow(page, "Hide & Seek Step 3 book");
  await assertCleanUiCopy(page, "Hide & Seek Step 3 book");
  await checkCompactForm(page, '[data-testid="seek-book-panel"]', "Hide & Seek questions");
  await page.fill("#ed-item-label", "Radar tambahan untuk uji Studio");
  await clickAndWaitStudioSave(page, '[data-s3-action="add-book-item"]');

  // #146: Sunting existing Radar question in-place (no duplicate created)
  await page.locator('details[data-studio-accordion="seek-book"] summary').click();
  const bookCountBefore = await page.locator('details[data-studio-accordion="seek-book"] li').count();
  const addedRadarRow = page.locator('details[data-studio-accordion="seek-book"] li').filter({ hasText: "Radar tambahan untuk uji Studio" });
  await addedRadarRow.locator('[data-s3-action="edit-book-item"]').click();
  assert.equal(await page.inputValue("#ed-item-label"), "Radar tambahan untuk uji Studio");
  await page.fill("#ed-item-label", "Radar Sunting Studio");
  await clickAndWaitStudioSave(page, '[data-s3-action="save-book-item"]');
  assert.equal(await page.locator('details[data-studio-accordion="seek-book"] li').count(), bookCountBefore, "Sunting question must update in-place without duplicating");
  await page.locator('details[data-studio-accordion="seek-book"] li').filter({ hasText: "Radar Sunting Studio" }).waitFor();

  await page.click('button[data-s3-tab="deck"]');
  // #146: Quick -/+ copy stepper and in-place Sunting on Hide & Seek deck cards
  await page.locator('details[data-studio-accordion="seek-deck"] summary').click();
  const seekCardCountBefore = await page.locator('details[data-studio-accordion="seek-deck"] .st-game-card').count();
  const seekCopiesBefore = Number((await page.getByTestId("seek-card-copies-0").innerText()).replace(/\D/g, ""));
  const seekMinusBtn = page.locator('[data-s3-action="step-seek-card-copies"][data-index="0"][data-delta="-1"]');
  const seekPlusBtn = page.locator('[data-s3-action="step-seek-card-copies"][data-index="0"][data-delta="1"]');
  const seekMinusBox = await seekMinusBtn.boundingBox();
  const seekPlusBox = await seekPlusBtn.boundingBox();
  assert.ok(seekMinusBox && seekMinusBox.width >= 44 && seekMinusBox.height >= 44, "Seek - copy stepper must meet 44x44 touch target");
  assert.ok(seekPlusBox && seekPlusBox.width >= 44 && seekPlusBox.height >= 44, "Seek + copy stepper must meet 44x44 touch target");
  if (seekCopiesBefore >= 10) {
    assert.equal(await seekPlusBtn.isDisabled(), true, "Seek + copy stepper must clamp at max copy limit");
    await clickAndWaitStudioSave(page, '[data-s3-action="step-seek-card-copies"][data-index="0"][data-delta="-1"]');
    await page.getByTestId("seek-card-copies-0").filter({ hasText: `${seekCopiesBefore - 1}×` }).waitFor();
    await clickAndWaitStudioSave(page, '[data-s3-action="step-seek-card-copies"][data-index="0"][data-delta="1"]');
    await page.getByTestId("seek-card-copies-0").filter({ hasText: `${seekCopiesBefore}×` }).waitFor();
  } else {
    await clickAndWaitStudioSave(page, '[data-s3-action="step-seek-card-copies"][data-index="0"][data-delta="1"]');
    await page.getByTestId("seek-card-copies-0").filter({ hasText: `${seekCopiesBefore + 1}×` }).waitFor();
    await clickAndWaitStudioSave(page, '[data-s3-action="step-seek-card-copies"][data-index="0"][data-delta="-1"]');
    await page.getByTestId("seek-card-copies-0").filter({ hasText: `${seekCopiesBefore}×` }).waitFor();
  }
  await page.locator('[data-s3-action="edit-seek-card"][data-index="0"]').click();
  const loadedSeekCardTitle = await page.inputValue("#ed-card-title");
  assert.ok(loadedSeekCardTitle.length > 0, "Sunting Seek card must prefill existing title");
  await page.fill("#ed-card-title", `${loadedSeekCardTitle} (Sunting)`);
  await clickAndWaitStudioSave(page, '[data-s3-action="save-seek-card"]');
  assert.equal(await page.locator('details[data-studio-accordion="seek-deck"] .st-game-card').count(), seekCardCountBefore, "Sunting Seek card must update in-place without duplicating");
  await page.locator('details[data-studio-accordion="seek-deck"] .st-game-card').filter({ hasText: `${loadedSeekCardTitle} (Sunting)` }).waitFor();

  await page.fill("#ed-card-title", "Kutukan Kopi Studio Live");
  assert.match(
    await page.textContent('[data-testid="live-card-preview"]'),
    /Kutukan Kopi Studio Live/,
    "Expected live game-card preview to update immediately as title is typed",
  );
  await page.screenshot({ path: path.join(results, "studio-step3-seek-cards.png") });
  await assertNoHorizontalOverflow(page, "Hide & Seek Step 3 deck composer");
  await assertCleanUiCopy(page, "Hide & Seek Step 3 deck composer");
  await checkCompactForm(page, '[data-testid="seek-card-composer"]', "Hide & Seek cards");

  // Navigate away to Step 1, then click Validator Jump Link -> returns to Step 3 #ed-zone and confirms auto-saved #ed-head persisted!
  await page.click('button[data-step="1"]');
  await page.click('button[data-jump-path]');
  await page.waitForSelector("#ed-zone");
  assert.equal(await page.inputValue("#ed-head"), nextHeadStart, "Auto-saved Head Start edit must persist across sub-tab & step navigation");
  await page.fill("#ed-zone", "400");
  await clickAndWaitStudioSave(page, 'button[data-action="save-draft"]');
  await page.waitForFunction(() => document.body.textContent.includes("lolos validator otomatis"));

  // Step 4: interactive Hide & Seek clue dry-run simulator
  await page.click('button[data-step="4"]');
  await page.waitForSelector('button[data-dry-action="run-seek-clue"]');
  await page.click('button[data-dry-action="run-seek-clue"]');
  await page.waitForSelector('[data-testid="dry-seek-result"]');
  await checkValidationSpacing(page, "hide-and-seek");
  await assertNoHorizontalOverflow(page, "Hide & Seek Step 4 dry-run");
  await assertCleanUiCopy(page, "Hide & Seek Step 4 dry-run");
  const seekDryText = await page.textContent('[data-testid="dry-seek-result"]');
  assert.match(seekDryText, /Hasil Uji Radar.*m\)/);

  // #148: Hide & Seek live private draft playtest room -> Uji Draf badge, simulated GPS, and 1-tap return to Studio
  await page.getByTestId("studio-playtest-btn").click();
  await page.getByTestId("draft-playtest-badge").waitFor();
  assert.match(await page.getByTestId("draft-playtest-badge").innerText(), /Uji Draf/);
  await page.locator("#sg-qa-location").waitFor();
  await assertNoHorizontalOverflow(page, "Hide & Seek draft playtest room at 390x844");
  await page.setViewportSize({ width: 320, height: 640 });
  await assertNoHorizontalOverflow(page, "Hide & Seek draft playtest room at 320x640");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByTestId("back-to-studio-btn").click();
  await page.locator("#ed-meta-title").waitFor();

  // 2. Claim the City Studio: Step 2 zone+landmark -> Step 3 challenge+card -> Step 4 interactive modal test -> Publish -> Midtrans
  await page.click('button[data-studio-view="home"]');
  await startDraft(page, "claim-the-city");
  await page.waitForSelector('button[data-action="clone"]');
  await checkCompactForm(page, '[data-testid="clone-template-card"]', "Claim template");
  assert.equal(await page.inputValue("#st-byline"), "Kreator Studio", "Claim template byline must prefill signed-in displayName");
  await page.locator('[data-testid="pack-id-advanced"] summary').click();
  await page.fill("#st-pack-id", "pack-claim-studio-qa");
  await page.fill("#st-title", "Studio QA Claim Pack");
  await page.fill("#st-price", "25000");
  await clickAndWaitPost(page, 'button[data-action="clone"]');
  await page.locator("#ed-meta-title").waitFor();
  await page.reload();
  await page.locator("#ed-meta-title").waitFor();
  assert.equal(await page.inputValue("#ed-meta-title"), "Studio QA Claim Pack");

  // Step 2: add zone & landmark, asserting persistent MapLibre canvas & zero extra style.json fetch during interactions
  const countBeforeClaimStep2 = styleFetchCount;
  await page.click('button[data-step="2"]');
  const canvas = await page.locator("#st-map-host .maplibregl-canvas").elementHandle();
  assert.ok(canvas, "Expected MapLibre canvas on Studio Step 2");
  await page.waitForFunction(() => Boolean(window.document.querySelector("#st-map-host .maplibregl-ctrl-zoom-in")));
  const countOnClaimStep2 = styleFetchCount;
  assert.equal(countOnClaimStep2, countBeforeClaimStep2 + 1, "Expected exactly 1 style.json fetch when mounting Claim Step 2");
  await checkCompactForm(page, '[data-testid="step2-inspector"]', "Claim map inspector", '[data-map-action="apply-selected"]');
  await exercisePoiCurator(page, "claim");

  // Zoom in once to verify camera scale is preserved across Studio interactions
  const fixedPin = page.locator('#st-map-host button[data-map-point="m-bloc"]');
  await fixedPin.waitFor({ state: "attached" });
  await page.click("#st-map-host .maplibregl-ctrl-zoom-in");
  const board = await page.locator("#st-map-host .board-map-canvas").boundingBox();
  await page.mouse.move(board.x + board.width / 2, board.y + board.height / 2);
  await page.mouse.down();
  await page.mouse.move(board.x + board.width / 2 + 24, board.y + board.height / 2 - 14, { steps: 5 });
  await page.mouse.up();
  await page.waitForTimeout(450);
  const pinTransform = await fixedPin.evaluate(pin => pin.style.transform);
  await page.click('button[data-map-mode="add"]');
  await page.click('button[data-map-mode="move"]');
  await page.click('button[data-map-mode="select"]');
  await page.click('button[data-map-tab="secondary"]');
  await page.fill("#ed-new-zone-id", "kemang");
  await page.fill("#ed-new-zone-name", "Kemang");
  await page.fill("#ed-new-zone-label", "KM");
  await clickAndWaitStudioSave(page, 'button[data-map-action="add-zone"]');
  await page.locator("[data-map-validation] summary").click();
  await page.locator('button[data-jump-zone="kemang"]').press("Enter");
  assert.equal(await page.inputValue("#ed-zone-name"), "Kemang");
  await page.click('button[data-map-tab="primary"]');
  await clickAndWaitStudioSave(page, 'button[data-map-action="add-landmark"]');
  await page.waitForSelector('[data-testid="step2-inspector"] input[data-field="name"]');
  await page.fill('[data-testid="step2-inspector"] input[data-field="name"]', "Landmark Kemang QA Persistent");
  await clickAndWaitStudioSave(page, 'button[data-map-action="apply-selected"]');
  assert.equal(await page.locator('button[data-jump-zone="kemang"]').count(), 0);
  assert.equal(await fixedPin.evaluate(pin => pin.style.transform), pinTransform, "Editing retains the map camera");

  assert.equal(await page.getByTestId("claim-challenge-composer").count(), 0);
  await page.click('button[data-map-action="edit-challenges"]');
  assert.equal(await page.getByTestId("step2-inspector").count(), 0);
  assert.equal(await page.locator('button[data-c3-prim] svg').count(), 6, "Expected 6 Challenge Primitive SVG tiles on Step 2 Peta");
  await page.click('button[data-c3-prim="call_your_shot"]');
  assert.equal(await page.getAttribute('button[data-c3-prim="call_your_shot"]', "aria-pressed"), "true");
  assert.equal(await page.inputValue("#ed-chal-prim"), "call_your_shot");
  await page.screenshot({ path: path.join(results, "studio-step3-claim-primitives.png") });
  await assertNoHorizontalOverflow(page, "Claim Step 2 challenges");
  await assertCleanUiCopy(page, "Claim Step 2 challenges");
  await checkCompactForm(page, '[data-testid="claim-challenge-composer"]', "Claim challenge editor");
  await page.fill("#ed-chal-title", "Uji Call Your Shot Kemang");
  await page.fill("#ed-chal-notes", "Contoh rubrik Studio QA. Foto papan nama dari trotoar.");
  await page.check("#ed-chal-reviewed");
  await clickAndWaitStudioSave(page, 'button[data-c3-action="add-challenge"]');

  // #146: Sunting existing Claim challenge in-place without duplicating
  await page.locator('details[data-studio-accordion="claim-challenges"] summary').click();
  const claimChalCountBefore = await page.locator('details[data-studio-accordion="claim-challenges"] li').count();
  const claimEditBtn = page
    .locator('details[data-studio-accordion="claim-challenges"] li')
    .filter({ hasText: "Uji Call Your Shot Kemang" })
    .locator('[data-c3-action="edit-challenge"]');
  const claimEditBox = await claimEditBtn.boundingBox();
  assert.ok(claimEditBox && claimEditBox.width >= 44 && claimEditBox.height >= 44, "Claim challenge Sunting button must meet 44x44 touch target");
  await claimEditBtn.click();
  assert.equal(await page.inputValue("#ed-chal-title"), "Uji Call Your Shot Kemang");
  assert.equal(await page.isChecked("#ed-chal-reviewed"), true);
  await page.fill("#ed-chal-title", "Uji Call Your Shot Kemang (Sunting)");
  await clickAndWaitStudioSave(page, 'button[data-c3-action="save-challenge"]');
  assert.equal(
    await page.locator('details[data-studio-accordion="claim-challenges"] li').count(),
    claimChalCountBefore,
    "Sunting Claim challenge must update in-place without duplicating",
  );
  await page.locator('details[data-studio-accordion="claim-challenges"] li').filter({ hasText: "Uji Call Your Shot Kemang (Sunting)" }).waitFor();

  await page.click('button[data-map-action="close-challenges"]');
  assert.equal(await page.locator('[data-map-action="edit-challenges"]:focus').count(), 1);

  await page.click('button[data-map-action="recenter"]');
  for (const mapTab of ["primary", "secondary", "start", "boundary"]) {
    await page.click(`button[data-map-tab="${mapTab}"]`);
    await assertNoHorizontalOverflow(page, `Claim Step 2 tab=${mapTab}`);
  }

  // #147: Clean human-first inspector (Koordinat & ID collapsed by default), draggable selected pin, GPS Pakai Lokasi Saya, and Urungkan undo
  await page.click('button[data-map-tab="primary"]');
  await page.click('button[data-map-action="recenter"]');
  await page.waitForTimeout(350);
  await page.locator('#st-map-host button[data-map-point="m-bloc"]').press("Enter");
  const coordAdvanced = page.getByTestId("coord-advanced");
  assert.equal(await coordAdvanced.getAttribute("open"), null, "Koordinat & ID (Lanjutan) must be collapsed by default");
  assert.equal(await page.locator("#ed-lm-lat").isVisible(), false, "Raw latitude input must be hidden when collapsed");
  await coordAdvanced.locator("summary").click();
  assert.equal(await page.locator("#ed-lm-lat").isVisible(), true, "Raw latitude input must be visible when expanded");
  const origLat = await page.inputValue("#ed-lm-lat");
  const origLng = await page.inputValue("#ed-lm-lng");

  // Verify selected pin is draggable while unselected pin is not, drag selected pin, then Urungkan to revert
  const selectedPin = page.locator('#st-map-host button[data-map-point="m-bloc"]');
  const otherPin = page.locator('#st-map-host button[data-map-point="taman-literasi"]');
  assert.equal(await selectedPin.getAttribute("data-draggable"), "true", "Selected pin must be draggable");
  assert.equal(await otherPin.getAttribute("data-draggable"), "false", "Unselected pin must not be draggable");
  await selectedPin.scrollIntoViewIfNeeded();
  const pinBox = await selectedPin.boundingBox();
  assert.ok(pinBox, "Expected bounding box for selected pin");
  await Promise.all([
    page.waitForResponse((r) => r.url().includes("/api/rulebooks") && r.request().method() === "POST"),
    page.waitForResponse((r) => r.url().includes("/api/rulebooks?role=writer") && r.request().method() === "GET"),
    (async () => {
      await page.mouse.move(pinBox.x + pinBox.width / 2, pinBox.y + pinBox.height / 2);
      await page.mouse.down();
      await page.mouse.move(pinBox.x + pinBox.width / 2 + 28, pinBox.y + pinBox.height / 2 - 22, { steps: 6 });
      await page.mouse.up();
    })(),
  ]);
  await page.waitForFunction(
    ({ lat, lng }) =>
      document.querySelector("#ed-lm-lat")?.value !== lat || document.querySelector("#ed-lm-lng")?.value !== lng,
    { lat: origLat, lng: origLng },
  );
  assert.equal(await page.getByTestId("studio-map-undo").isDisabled(), false, "Urungkan must enable after dragging pin");
  await clickAndWaitStudioSave(page, '[data-testid="studio-map-undo"]');
  await page.waitForFunction(
    ({ lat, lng }) =>
      document.querySelector("#ed-lm-lat")?.value === lat && document.querySelector("#ed-lm-lng")?.value === lng,
    { lat: origLat, lng: origLng },
  );

  // Boundary vertex add + Urungkan revert
  await page.click('button[data-map-tab="boundary"]');
  await page.click('button[data-map-drawer="points"]');
  const vertexCountBefore = await page.locator(".studio-point-list button[data-select-kind='vertex']").count();
  await page.click('button[data-map-drawer="points"]');
  await page.fill("#ed-v-lat", "-6.24501");
  await page.fill("#ed-v-lng", "106.79901");
  await clickAndWaitStudioSave(page, 'button[data-map-action="add-vertex"]');
  await clickAndWaitStudioSave(page, '[data-testid="studio-map-undo"]');
  await page.click('button[data-map-drawer="points"]');
  await page.waitForFunction(
    (expected) => document.querySelectorAll(".studio-point-list button[data-select-kind='vertex']").length === expected,
    vertexCountBefore,
  );
  await page.click('button[data-map-drawer="points"]');

  // Field-scouting Pakai Lokasi Saya (mocked GPS success + undo + permission denial handling)
  await page.click('button[data-map-tab="primary"]');
  await page.locator('#st-map-host button[data-map-point="m-bloc"]').press("Enter");
  await page.evaluate(() => {
    Object.defineProperty(navigator, "geolocation", {
      configurable: true,
      value: {
        getCurrentPosition(success) {
          success({ coords: { latitude: -6.24412, longitude: 106.79834, accuracy: 8 } });
        },
      },
    });
  });
  await clickAndWaitStudioSave(page, '[data-testid="studio-gps-move"]');
  await page.getByTestId("studio-gps-status").filter({ hasText: /Titik ditempatkan di posisimu/ }).waitFor();
  await page.waitForFunction(
    () => document.querySelector("#ed-lm-lat")?.value === "-6.24412" && document.querySelector("#ed-lm-lng")?.value === "106.79834",
  );
  await clickAndWaitStudioSave(page, '[data-testid="studio-map-undo"]');
  await page.waitForFunction(
    ({ lat, lng }) =>
      document.querySelector("#ed-lm-lat")?.value === lat && document.querySelector("#ed-lm-lng")?.value === lng,
    { lat: origLat, lng: origLng },
  );
  await page.evaluate(() => {
    Object.defineProperty(navigator, "geolocation", {
      configurable: true,
      value: {
        getCurrentPosition(_success, error) {
          error({ code: 1, message: "Permission denied" });
        },
      },
    });
  });
  await page.getByTestId("studio-gps-add").click();
  await page.getByTestId("studio-gps-status").filter({ hasText: /Izin lokasi ditolak/ }).waitFor();

  await page.setViewportSize({ width: 320, height: 640 });
  await assertNoHorizontalOverflow(page, "Claim Step 2 toolbar & inspector at 320x640");
  await page.setViewportSize({ width: 390, height: 844 });

  assert.equal(styleFetchCount, countOnClaimStep2, "Interactions on Claim Step 2 must not re-fetch /api/map/style.json");
  assert.equal(
    await canvas.evaluate((el) => el.isConnected && document.querySelector("#st-map-host .maplibregl-canvas") === el),
    true,
    "Same MapLibre canvas DOM element must remain mounted across Step 2 interactions",
  );

  // Step 3: Sesi & Skor and Sabotage Curse card in Dek Taktis
  await page.click('button[data-step="3"]');
  await assertNoHorizontalOverflow(page, "Claim Step 3 session");
  await assertCleanUiCopy(page, "Claim Step 3 session");
  await checkCompactForm(page, '[data-testid="claim-session-panel"]', "Claim session rules", '.studio-save');
  const sessionPanelText = await page.textContent('[data-testid="claim-session-panel"]');
  assert.match(sessionPanelText, /Susunan Awal Tim/, "Expected Susunan Awal Tim label in Claim Step 3");
  const duration = Number(await page.inputValue("#ed-claim-duration")) + 1;
  await page.fill("#ed-claim-duration", String(duration));
  await clickAndWaitStudioSave(page, '.studio-save');
  await page.locator(".studio-save-feedback", { hasText: /Draf tersimpan/ }).waitFor();

  // #146: Raise Claim maxPlayers to 12 without manual Simpan -> switching to Deck sub-tab auto-saves and persists across reload
  await page.fill("#ed-claim-maxp", "12");
  assert.equal(await page.getByTestId("studio-save-status").getAttribute("data-save-state"), "dirty");
  assert.equal(await page.locator('button[data-c3-tab="challenges"]').count(), 0, "Challenges tab should be on Step 2 Peta, not Step 3 Aturan");
  await clickAndWaitStudioSave(page, 'button[data-c3-tab="deck"]');
  await page.reload();
  await page.click('button[data-step="3"]');
  assert.equal(await page.inputValue("#ed-claim-duration"), String(duration));
  assert.equal(await page.inputValue("#ed-claim-maxp"), "12", "Auto-saved maxPlayers=12 must persist across reload");

  await page.click('button[data-c3-tab="deck"]');
  await assertNoHorizontalOverflow(page, "Claim Step 3 deck");
  await assertCleanUiCopy(page, "Claim Step 3 deck");
  await checkCompactForm(page, '[data-testid="claim-card-composer"]', "Claim cards");
  await page.fill("#ed-ccard-title", "Sabotase Kemang");
  assert.match(
    await page.textContent('[data-testid="live-card-preview"]'),
    /Sabotase Kemang/,
    "Expected live Claim tactical card preview to update on input",
  );
  await clickAndWaitStudioSave(page, 'button[data-c3-action="add-claim-card"]');

  // #146: Quick -/+ copy stepper and in-place Sunting on Claim deck cards + 320x640 mobile overflow check
  await page.locator('details[data-studio-accordion="claim-deck"] summary').click();
  const claimCardCountBefore = await page.locator('details[data-studio-accordion="claim-deck"] .st-game-card').count();
  const claimCopiesBefore = Number((await page.getByTestId("claim-card-copies-0").innerText()).replace(/\D/g, ""));
  const claimMinusBtn = page.locator('[data-c3-action="step-claim-card-copies"][data-index="0"][data-delta="-1"]');
  const claimPlusBtn = page.locator('[data-c3-action="step-claim-card-copies"][data-index="0"][data-delta="1"]');
  const claimMinusBox = await claimMinusBtn.boundingBox();
  const claimPlusBox = await claimPlusBtn.boundingBox();
  assert.ok(claimMinusBox && claimMinusBox.width >= 44 && claimMinusBox.height >= 44, "Claim - copy stepper must meet 44x44 touch target");
  assert.ok(claimPlusBox && claimPlusBox.width >= 44 && claimPlusBox.height >= 44, "Claim + copy stepper must meet 44x44 touch target");
  await clickAndWaitStudioSave(page, '[data-c3-action="step-claim-card-copies"][data-index="0"][data-delta="1"]');
  await page.getByTestId("claim-card-copies-0").filter({ hasText: `${claimCopiesBefore + 1}×` }).waitFor();
  await clickAndWaitStudioSave(page, '[data-c3-action="step-claim-card-copies"][data-index="0"][data-delta="-1"]');
  await page.getByTestId("claim-card-copies-0").filter({ hasText: `${claimCopiesBefore}×` }).waitFor();
  await page.locator('[data-c3-action="edit-claim-card"][data-index="0"]').click();
  const loadedClaimCardTitle = await page.inputValue("#ed-ccard-title");
  assert.ok(loadedClaimCardTitle.length > 0, "Sunting Claim card must prefill existing title");
  await page.fill("#ed-ccard-title", `${loadedClaimCardTitle} (Sunting)`);
  await clickAndWaitStudioSave(page, '[data-c3-action="save-claim-card"]');
  assert.equal(
    await page.locator('details[data-studio-accordion="claim-deck"] .st-game-card').count(),
    claimCardCountBefore,
    "Sunting Claim card must update in-place without duplicating",
  );
  await page.locator('details[data-studio-accordion="claim-deck"] .st-game-card').filter({ hasText: `${loadedClaimCardTitle} (Sunting)` }).waitFor();

  await page.setViewportSize({ width: 320, height: 640 });
  await assertNoHorizontalOverflow(page, "Claim Step 3 deck at 320x640");
  await page.click('button[data-c3-tab="session"]');
  await assertNoHorizontalOverflow(page, "Claim Step 3 session at 320x640");
  await page.setViewportSize({ width: 390, height: 844 });

  // Step 4: interactive Claim challenge test modal on m-bloc (observation_input answer = "2")
  await page.click('button[data-step="4"]');
  await clickAndWaitStudioSave(page, 'button[data-action="save-draft"]');
  await page.waitForFunction(() => document.body.textContent.includes("lolos validator otomatis"));
  await page.selectOption("#dry-claim-landmark", "m-bloc");
  await page.click('button[data-dry-action="open-claim-test"]');
  await page.waitForSelector("#dry-input-val");
  await page.fill("#dry-input-val", "2");
  await page.click('button[data-dry-action="submit-claim-test"]');
  await page.waitForSelector('[data-testid="dry-claim-result"]');
  await checkValidationSpacing(page, "claim-the-city");
  await assertNoHorizontalOverflow(page, "Claim Step 4 interactive modal");
  await assertCleanUiCopy(page, "Claim Step 4 interactive modal");
  const claimDryText = await page.textContent('[data-testid="dry-claim-result"]');
  assert.ok(claimDryText.includes("Jawaban Benar"), `Expected pass in dry-run modal, got: ${claimDryText}`);

  await page.locator('button[data-step="2"]').first().click();
  await page.click('button[data-map-tab="primary"]');
  await page.locator('#st-map-host button[data-map-point="taman-literasi"]').press("Enter");
  await page.click('button[data-map-action="edit-challenges"]');
  await page.unroute("**/api/map/config");
  await page.unroute("**/api/map/style.json");
  assert.equal(await page.inputValue("#ed-chal-target"), "taman-literasi");
  await page.click('button[data-c3-prim="observation_mcq"]');
  await page.fill("#ed-chal-title", "Undakan untuk menonton");
  await page.fill("#ed-chal-prompt", "Susunan mana yang membantu penonton melihat panggung dari belakang?");
  await page.fill("#ed-chal-opt-a", "Semua baris sejajar.");
  await page.fill("#ed-chal-opt-b", "Baris belakang lebih tinggi.");
  await page.fill("#ed-chal-opt-c", "Baris belakang lebih rendah.");
  await page.selectOption("#ed-chal-correct", "b");
  await page.fill("#ed-chal-notes", "Jakarta Smart City mendokumentasikan amfiteater di Plaza Kabaresi. Sampel desk review.");
  await page.fill("#ed-chal-hint", "Bandingkan tinggi baris depan dan belakang.");
  await page.fill("#ed-chal-explanation", "Undakan membuat penonton dapat melihat dari beberapa baris.");
  await page.fill("#ed-chal-estimate", "45");
  await page.click('button[data-c3-action="add-challenge"]');
  await page.locator("[data-claim-composer-error]").waitFor();
  assert.equal(await page.inputValue("#ed-chal-title"), "Undakan untuk menonton");
  await page.check("#ed-chal-reviewed");
  await clickAndWaitStudioSave(page, 'button[data-c3-action="add-challenge"]');
  await page.click('button[data-c3-prim="observation_input"]');
  await page.fill("#ed-chal-title", "Pandangan ke panggung");
  await page.fill("#ed-chal-prompt", "Baris mana yang lebih tinggi saat kamu melihat ke panggung?");
  await page.fill("#ed-chal-answer", "baris belakang, belakang");
  await page.fill("#ed-chal-notes", "Sumber Plaza Kabaresi. Bandingkan dua baris dari jalur tanpa tangga saat uji lapangan.");
  await page.fill("#ed-chal-hint", "Lihat dari sisi undakan.");
  await page.fill("#ed-chal-explanation", "Posisi yang lebih tinggi membantu penonton di belakang melihat panggung.");
  await page.fill("#ed-chal-estimate", "70");
  await page.check("#ed-chal-reviewed");
  await clickAndWaitStudioSave(page, 'button[data-c3-action="add-challenge"]');
  await page.getByText("Varian tantangan (3)", { exact: true }).click();
  await page.getByText(/Selisih perkiraan lebih dari 20 detik/).waitFor();
  await page.locator("li").filter({ hasText: "Undakan untuk menonton" }).getByRole("button", { name: "Pratinjau varian" }).click();

  const variantPreview = page.getByTestId("dry-claim-modal");
  assert.match(await variantPreview.innerText(), /Undakan untuk menonton/);
  assert.doesNotMatch(await variantPreview.innerText(), /Fakta lokasi|Jakarta Smart City/);
  await variantPreview.getByText("Petunjuk lokasi", { exact: true }).click();
  await variantPreview.getByText("Bandingkan tinggi baris depan dan belakang.").waitFor();
  await variantPreview.locator('input[name="dry-mcq"][value="b"]').check();
  await variantPreview.locator('button[data-dry-action="submit-claim-test"]').click();
  await variantPreview.getByText(/Undakan membuat penonton/).waitFor();
  await page.selectOption("#dry-claim-variant", { label: "Pandangan ke panggung" });
  await page.click('button[data-dry-action="open-claim-test"]');
  assert.doesNotMatch(await variantPreview.innerText(), /Fakta lokasi/);
  await page.fill("#dry-input-val", "  BARIS   BELAKANG  ");
  await variantPreview.locator('button[data-dry-action="submit-claim-test"]').click();
  await variantPreview.getByText(/Posisi yang lebih tinggi/).waitFor();
  await assertNoHorizontalOverflow(page, "Claim custom variant preview");
  await page.screenshot({ path: path.join(results, "studio-claim-variant-preview.png") });

  // #148: Claim live private draft playtest room -> Uji Draf badge, simulated GPS, solo start, and 1-tap return to Studio
  await page.getByTestId("studio-playtest-btn").click();
  await page.getByTestId("draft-playtest-badge").waitFor();
  assert.match(await page.getByTestId("draft-playtest-badge").innerText(), /Uji Draf/);
  await page.getByTestId("claim-qa-location").waitFor();
  await assertNoHorizontalOverflow(page, "Claim draft playtest lobby at 390x844");
  await page.setViewportSize({ width: 320, height: 640 });
  await assertNoHorizontalOverflow(page, "Claim draft playtest lobby at 320x640");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.click('button[data-action="sim-start-checkin"]');
  await page.click('button[data-action="mark-ready"]');
  await page.click('button[data-action="start-match"]');
  await page.locator('button[data-action="claim-qa-advance"][data-step="minute"]').waitFor();
  await page.getByTestId("draft-playtest-badge").waitFor();
  await assertNoHorizontalOverflow(page, "Claim draft playtest active board at 390x844");
  await page.setViewportSize({ width: 320, height: 640 });
  await assertNoHorizontalOverflow(page, "Claim draft playtest active board at 320x640");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByTestId("back-to-studio-btn").click();
  await page.locator("#ed-meta-title").waitFor();
  await page.click('button[data-step="4"]');

  // Submit -> full Admin review lifecycle -> Public Catalog -> Midtrans settlement -> Live Room
  await clickAndWaitPost(page, 'button[data-action="submit-draft"]');
  await page.waitForFunction(() => document.body.textContent.includes("diajukan ke peninjau"));
  await exerciseAdminConsole(page, ctx);

  await page.click('button[data-nav="back"]');
  await buyPublishedDraft(page, "pack-claim-studio-qa");
  await page.waitForFunction(
    () => document.body.textContent.includes("Ruang Tunggu") && document.body.textContent.includes("Pass Berbayar"),
  );

  // #148: Return to Studio Home and verify paid order appears in Creator Earnings dashboard
  await page.goto(`${baseUrl}/?play=rulebook-studio`, { waitUntil: "networkidle" });
  const homeEarnings = page.getByTestId("studio-home-earnings");
  await homeEarnings.waitFor();
  assert.match(await homeEarnings.innerText(), /Studio QA Claim Pack/);
  assert.match(await homeEarnings.innerText(), /Rp\s*25\.000/);

  // Compact has a searchable boundary within the curator's area limit.
  await openDraft(page, "pack-seek-alpha");
  const tilesBeforeFallback = blockedStudioTiles;
  await page.route("**/api/map/config", route => route.fulfill({ json: {
    mode: "geoapify-vector", styleUrl: "/qa-blocked-compact-style",
  } }));
  await page.route("**/qa-blocked-compact-style", route => route.fulfill({ json: {
    version: 8,
    sources: { qa: { type: "vector", tiles: [`${baseUrl}/qa-compact-tiles/{z}/{x}/{y}.pbf`] } },
    layers: [{ id: "qa-land", type: "fill", source: "qa", "source-layer": "land" }],
  } }));
  await page.route("**/qa-compact-tiles/**", route => {
    blockedStudioTiles++;
    return route.abort();
  });
  await page.click('button[data-step="2"]');
  await page.getByTestId("studio-map-fallback").waitFor();
  assert.ok(blockedStudioTiles > tilesBeforeFallback);
  await exercisePoiCurator(page, "seek", { fallback: true });

  await ctx.close();
  console.log("qa:rulebook-studio passed (Studio lifecycle, OpenStreetMap curation and tile fallback, private playtests, mobile Admin moderation and access, Midtrans)");
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
