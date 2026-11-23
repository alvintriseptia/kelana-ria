import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { createRecordedMidtransAdapter, createSoloServer } from "../../api/dist/index.js";
import { buyPublishedDraft, openDraft, openReview, reviewerKey, startDraft } from "./studio-navigation.mjs";

const root = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const distDir = path.join(root, "dist");
const results = path.join(root, "qa-results");
await mkdir(results, { recursive: true });

const server = createSoloServer({
  databasePath: ":memory:",
  staticDir: distDir,
  midtrans: createRecordedMidtransAdapter(),
  allowSimulatedLocation: true,
  allowRulebookSandboxCheckout: true,
  rulebookReviewerKey: reviewerKey,
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

try {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();

  await page.goto(baseUrl, { waitUntil: "networkidle" });

  // 1. Hide & Seek Studio: multi-draft switcher, intentional validator error -> jump link -> fix -> interactive clue dry-run
  await page.click("#chooser-studio");
  await page.getByRole("button", { name: "Buat Game", exact: true }).click();
  assert.equal(await page.locator('button[data-format] svg').count(), 2, "Expected SVG art on format hero cards");
  await page.screenshot({ path: path.join(results, "studio-step1-format-cards.png") });
  await assertNoHorizontalOverflow(page, "Format choices");
  await page.click('button[data-format="hide-and-seek"]');
  await page.waitForSelector('button[data-action="clone"]');
  await assertNoHorizontalOverflow(page, "Template setup");

  await page.fill("#st-pack-id", "pack-seek-alpha");
  await page.fill("#st-title", "Alpha Seek Draft Very Long Title For Mobile Select Wrapping Check");
  await clickAndWaitPost(page, 'button[data-action="clone"]');
  await page.locator("#ed-meta-title").waitFor();
  assert.equal(await page.locator('button[data-step] svg').count(), 4, "Expected SVG icons on all 4 step buttons");
  assert.equal(await page.locator('button[data-format], #st-template, button[data-draft]').count(), 0);
  await assertNoHorizontalOverflow(page, "Draft editor");
  await page.screenshot({ path: path.join(results, "studio-dedicated-editor.png") });
  await page.fill("#ed-meta-summary", "Catatan draf Alpha tersimpan");
  await clickAndWaitStudioSave(page, 'button[data-action="save-draft"]');
  await page.reload();
  await page.locator("#ed-meta-summary").waitFor();
  assert.equal(await page.inputValue("#ed-meta-summary"), "Catatan draf Alpha tersimpan");

  await page.click('button[data-studio-view="home"]');
  await page.locator('button[data-draft="pack-seek-alpha@1"]').waitFor();
  await assertNoHorizontalOverflow(page, "My drafts");
  await page.screenshot({ path: path.join(results, "studio-my-drafts.png") });
  await startDraft(page, "hide-and-seek");
  await page.selectOption("#st-template", "official-jakarta-wide-seek");
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
  await page.route("**/qa-failed-studio-style", route => route.abort());
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
  await page.fill("#ed-zone", "10");
  await clickAndWaitStudioSave(page, 'button[data-action="save-draft"]');
  await page.waitForSelector('button[data-jump-path]');
  await assertNoHorizontalOverflow(page, "Validator errors banner on 390px");

  await page.click('button[data-s3-tab="book"]');
  assert.equal(await page.locator('button[data-s3-family] svg').count(), 6, "Expected 6 Question Family SVG tiles");
  await assertNoHorizontalOverflow(page, "Hide & Seek Step 3 book");
  await page.click('button[data-s3-tab="deck"]');
  await page.fill("#ed-card-title", "Kutukan Kopi Studio Live");
  assert.match(
    await page.textContent('[data-testid="live-card-preview"]'),
    /Kutukan Kopi Studio Live/,
    "Expected live game-card preview to update immediately as title is typed",
  );
  await page.screenshot({ path: path.join(results, "studio-step3-seek-cards.png") });
  await assertNoHorizontalOverflow(page, "Hide & Seek Step 3 deck composer");

  // Navigate away to Step 1, then click Validator Jump Link -> returns to Step 3 #ed-zone!
  await page.click('button[data-step="1"]');
  await page.click('button[data-jump-path]');
  await page.waitForSelector("#ed-zone");
  await page.fill("#ed-zone", "400");
  await clickAndWaitStudioSave(page, 'button[data-action="save-draft"]');
  await page.waitForFunction(() => document.body.textContent.includes("lolos validator otomatis"));

  // Step 4: interactive Hide & Seek clue dry-run simulator
  await page.click('button[data-step="4"]');
  await page.waitForSelector('button[data-dry-action="run-seek-clue"]');
  await page.click('button[data-dry-action="run-seek-clue"]');
  await page.waitForSelector('[data-testid="dry-seek-result"]');
  await assertNoHorizontalOverflow(page, "Hide & Seek Step 4 dry-run");
  const seekDryText = await page.textContent('[data-testid="dry-seek-result"]');
  assert.match(seekDryText, /Hasil Uji Radar.*m\)/);

  // 2. Claim the City Studio: Step 2 zone+landmark -> Step 3 challenge+card -> Step 4 interactive modal test -> Publish -> Midtrans
  await page.click('button[data-studio-view="home"]');
  await startDraft(page, "claim-the-city");
  await page.waitForSelector('button[data-action="clone"]');
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
  await page.click('button[data-map-action="recenter"]');
  for (const mapTab of ["primary", "secondary", "start", "boundary"]) {
    await page.click(`button[data-map-tab="${mapTab}"]`);
    await assertNoHorizontalOverflow(page, `Claim Step 2 tab=${mapTab}`);
  }

  assert.equal(styleFetchCount, countOnClaimStep2, "Interactions on Claim Step 2 must not re-fetch /api/map/style.json");
  assert.equal(
    await canvas.evaluate((el) => el.isConnected && document.querySelector("#st-map-host .maplibregl-canvas") === el),
    true,
    "Same MapLibre canvas DOM element must remain mounted across Step 2 interactions",
  );
  await page.unroute("**/api/map/config");
  await page.unroute("**/api/map/style.json");

  // Step 3: add Call Your Shot challenge & Sabotage Curse card
  await page.click('button[data-step="3"]');
  await assertNoHorizontalOverflow(page, "Claim Step 3 session");
  await page.click('button[data-c3-tab="challenges"]');
  assert.equal(await page.locator('button[data-c3-prim] svg').count(), 6, "Expected 6 Challenge Primitive SVG tiles");
  await page.click('button[data-c3-prim="call_your_shot"]');
  assert.equal(await page.getAttribute('button[data-c3-prim="call_your_shot"]', "aria-pressed"), "true");
  assert.equal(await page.inputValue("#ed-chal-prim"), "call_your_shot");
  await page.screenshot({ path: path.join(results, "studio-step3-claim-primitives.png") });
  await assertNoHorizontalOverflow(page, "Claim Step 3 challenges");
  await page.fill("#ed-chal-title", "Uji Call Your Shot Kemang");
  await clickAndWaitStudioSave(page, 'button[data-c3-action="add-challenge"]');
  await page.click('button[data-c3-tab="deck"]');
  await assertNoHorizontalOverflow(page, "Claim Step 3 deck");
  await page.fill("#ed-ccard-title", "Sabotase Kemang");
  assert.match(
    await page.textContent('[data-testid="live-card-preview"]'),
    /Sabotase Kemang/,
    "Expected live Claim tactical card preview to update on input",
  );
  await clickAndWaitStudioSave(page, 'button[data-c3-action="add-claim-card"]');

  // Step 4: interactive Claim challenge test modal on m-bloc (observation_input answer = "2")
  await page.click('button[data-step="4"]');
  await page.selectOption("#dry-claim-landmark", "m-bloc");
  await page.click('button[data-dry-action="open-claim-test"]');
  await page.waitForSelector("#dry-input-val");
  await page.fill("#dry-input-val", "2");
  await page.click('button[data-dry-action="submit-claim-test"]');
  await page.waitForSelector('[data-testid="dry-claim-result"]');
  await assertNoHorizontalOverflow(page, "Claim Step 4 interactive modal");
  const claimDryText = await page.textContent('[data-testid="dry-claim-result"]');
  assert.ok(claimDryText.includes("Jawaban Benar"), `Expected pass in dry-run modal, got: ${claimDryText}`);

  // Submit -> Reviewer Publish -> Public Catalog -> Midtrans settlement -> Live Room
  await clickAndWaitPost(page, 'button[data-action="submit-draft"]');
  await page.waitForFunction(() => document.body.textContent.includes("diajukan ke peninjau"));
  await openReview(page);
  await assertNoHorizontalOverflow(page, "Reviewer queue tab");
  await clickAndWaitPost(page, 'button[data-action="publish"]');
  await page.waitForFunction(() => document.body.textContent.includes("publish-version"));

  await page.click('button[data-nav="catalog"]');
  await buyPublishedDraft(page, "pack-claim-studio-qa");
  await page.waitForFunction(
    () => document.body.textContent.includes("Ruang Tunggu") && document.body.textContent.includes("Pass Berbayar"),
  );

  await ctx.close();
  console.log("qa:rulebook-studio passed (Full visual Studio lifecycle + validator jump + interactive dry-run + publish + Midtrans)");
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
