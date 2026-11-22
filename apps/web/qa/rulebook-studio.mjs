import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { createRecordedMidtransAdapter, createSoloServer } from "../../api/dist/index.js";

const root = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const distDir = path.join(root, "dist");
const results = path.join(root, "qa-results");
await mkdir(results, { recursive: true });

const server = createSoloServer({
  databasePath: ":memory:",
  staticDir: distDir,
  midtrans: createRecordedMidtransAdapter(),
  allowSimulatedLocation: true,
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
    page.waitForResponse((r) => r.url().includes("/api/rulebooks?role=reviewer") && r.request().method() === "GET"),
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

async function assertGuideFits(page, label) {
  const report = await page.evaluate(() => {
    const dialog = document.getElementById("guide");
    const dialogRect = dialog ? dialog.getBoundingClientRect() : null;
    const offenders = [];
    for (const el of document.querySelectorAll("#guide *")) {
      const rect = el.getBoundingClientRect();
      if (rect.width > 0 && rect.right > window.innerWidth + 1) {
        offenders.push({
          tag: el.tagName,
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
      dialogRight: dialogRect ? Math.round(dialogRect.right) : 0,
      offenders,
    };
  });
  assert.ok(
    report.scrollWidth <= report.innerWidth && report.dialogRight <= report.innerWidth + 1 && report.offenders.length === 0,
    `Panduan overflow on ${label} (${report.scrollWidth}/${report.dialogRight} > ${report.innerWidth}): ${JSON.stringify(report.offenders)}`,
  );
}

async function verifyInteractiveGuide(page) {
  await page.click("#guide-open");
  await page.waitForSelector('#guide[open] [data-testid="ig-slide"]');
  assert.match(await page.textContent('[data-testid="ig-step-label"]'), /Langkah 1\/4/);
  await page.click('button[data-ig-track="hide-and-seek"]');
  assert.match(await page.textContent('[data-testid="ig-step-label"]'), /Langkah 1\/6/);
  await assertGuideFits(page, "Hide & Seek 1/6");

  await page.click('button[data-ig-scale="medium"]');
  assert.match(await page.textContent('[data-testid="ig-slide"]'), /Medium \(M\)/);

  await page.click('button[data-ig-nav="next"]');
  await page.click('button[data-ig-phase="2"]');
  assert.match(await page.textContent('[data-testid="ig-slide"]'), /Endgame/);
  await assertGuideFits(page, "Hide & Seek 2/6");

  await page.click('button[data-ig-nav="next"]');
  await page.click('button[data-ig-quiz="no"]');
  const feedback = await page.textContent('[data-testid="ig-quiz-feedback"]');
  assert.match(feedback, /Benar!.*Lift/);
  await assertGuideFits(page, "Hide & Seek 3/6");

  await page.click('button[data-ig-nav="next"]');
  await page.click('button[data-ig-fam="tentacles"]');
  assert.match(await page.textContent('[data-testid="ig-slide"]'), /Draw 4, Keep 2/);
  await assertGuideFits(page, "Hide & Seek 4/6");

  await page.click('button[data-ig-nav="next"]');
  await assertGuideFits(page, "Hide & Seek 5/6");
  await page.click('button[data-ig-nav="next"]');
  assert.match(await page.textContent('[data-testid="ig-step-label"]'), /Langkah 6\/6/);
  await assertGuideFits(page, "Hide & Seek 6/6");

  await page.click('button[data-ig-track="claim-the-city"]');
  assert.match(await page.textContent('[data-testid="ig-step-label"]'), /Langkah 1\/4/);
  await assertGuideFits(page, "Claim 1/4");

  const states = [];
  for (let i = 0; i < 4; i += 1) {
    states.push(await page.getAttribute('[data-testid="ig-zone-cycle-btn"]', "data-state"));
    await page.click('[data-testid="ig-zone-cycle-btn"]');
  }
  assert.deepEqual(states, ["neutral", "unclaimed", "claimed", "locked"]);
  await page.click('button[data-ig-nav="next"]');
  await assertGuideFits(page, "Claim 2/4");
  await page.click('button[data-ig-nav="next"]');
  await assertGuideFits(page, "Claim 3/4");
  await page.click('button[data-ig-nav="next"]');
  await assertGuideFits(page, "Claim 4/4");

  await page.click('button[data-ig-track="safety"]');
  assert.match(await page.textContent('[data-testid="ig-step-label"]'), /Langkah 1\/2/);
  await assertGuideFits(page, "Safety 1/2");
  await page.click('button[data-ig-nav="next"]');
  await assertGuideFits(page, "Safety 2/2");

  const linksOk = await page.evaluate(
    () =>
      Boolean(document.querySelector('#guide a[href="https://nebula.tv/jetlag"]')) &&
      Boolean(document.querySelector('#guide a[href="https://jetlagoxford.co.uk/"]')),
  );
  assert.equal(linksOk, true, "Expected Jet Lag and jetlagoxford.co.uk attribution links in Panduan");

  await page.click("#guide .ig-close-x");
  await page.waitForFunction(() => !document.getElementById("guide")?.hasAttribute("open"));
}

try {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();

  // 0. Interactive Panduan tutorial modal on 390x844 mobile viewport
  await page.goto(baseUrl, { waitUntil: "networkidle" });
  await verifyInteractiveGuide(page);

  // 1. Hide & Seek Studio: multi-draft switcher, intentional validator error -> jump link -> fix -> interactive clue dry-run
  await page.click("#chooser-studio");
  await page.click('button[data-format="hide-and-seek"]');
  await page.waitForSelector('button[data-action="clone"]');
  assert.equal(await page.locator('button[data-format] svg').count(), 2, "Expected SVG art on format hero cards");
  assert.equal(await page.locator('button[data-step] svg').count(), 4, "Expected SVG icons on all 4 step buttons");
  await page.screenshot({ path: path.join(results, "studio-step1-format-cards.png") });
  await assertNoHorizontalOverflow(page, "Step 1 initial clone form");

  await page.fill("#st-pack-id", "pack-seek-alpha");
  await page.fill("#st-title", "Alpha Seek Draft Very Long Title For Mobile Select Wrapping Check");
  await clickAndWaitStudioSave(page, 'button[data-action="clone"]');
  await page.waitForSelector("#st-draft-select");
  await assertNoHorizontalOverflow(page, "Step 1 draft switcher");

  await page.click('button[data-action="toggle-json"]');
  await page.waitForSelector('[data-testid="json-tools-card"]');
  await assertNoHorizontalOverflow(page, "Step 1 JSON tools expanded");
  await page.click('button[data-action="toggle-json"]');

  await page.click('button[data-action="toggle-clone"]');
  await page.fill("#st-pack-id", "pack-seek-beta");
  await page.fill("#st-title", "Beta Seek Draft");
  await clickAndWaitStudioSave(page, 'button[data-action="clone"]');

  // Switch back to Alpha draft
  await page.selectOption("#st-draft-select", "pack-seek-alpha@1");
  await page.waitForFunction(() => document.body.textContent.includes("pack-seek-alpha v1"));

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

  // Verify Hide & Seek Step 2 sub-tabs have zero horizontal overflow on 390px and keep style fetch = 1
  await page.click('button[data-step="2"]');
  await page.waitForSelector('[data-testid="studio-map-host"]');
  await page.waitForFunction(() => Boolean(window.document.querySelector("#st-map-host .maplibregl-ctrl-zoom-in")));
  assert.equal(styleFetchCount, 1, "Expected 1 style.json fetch on first Step 2 entry");
  for (const mapTab of ["primary", "secondary", "start", "boundary"]) {
    await page.click(`button[data-map-tab="${mapTab}"]`);
    await assertNoHorizontalOverflow(page, `Hide & Seek Step 2 tab=${mapTab}`);
  }
  assert.equal(styleFetchCount, 1, "Hide & Seek Step 2 tab switches must not re-fetch style.json");

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
  await page.click('button[data-format="claim-the-city"]');
  await page.waitForSelector('button[data-action="clone"]');
  await page.fill("#st-pack-id", "pack-claim-studio-qa");
  await page.fill("#st-title", "Studio QA Claim Pack");
  await page.fill("#st-price", "25000");
  await clickAndWaitStudioSave(page, 'button[data-action="clone"]');

  // Step 2: add zone & landmark, asserting persistent MapLibre canvas & zero extra style.json fetch during interactions
  const countBeforeClaimStep2 = styleFetchCount;
  await page.click('button[data-step="2"]');
  const canvas = await page.locator("#st-map-host .maplibregl-canvas").elementHandle();
  assert.ok(canvas, "Expected MapLibre canvas on Studio Step 2");
  await page.waitForFunction(() => Boolean(window.document.querySelector("#st-map-host .maplibregl-ctrl-zoom-in")));
  const countOnClaimStep2 = styleFetchCount;
  assert.equal(countOnClaimStep2, countBeforeClaimStep2 + 1, "Expected exactly 1 style.json fetch when mounting Claim Step 2");

  // Zoom in once to verify camera scale is preserved across Studio interactions
  await page.click("#st-map-host .maplibregl-ctrl-zoom-in");
  await page.click('button[data-map-mode="add"]');
  await page.click('button[data-map-mode="move"]');
  await page.click('button[data-map-mode="select"]');
  await page.click('button[data-map-tab="secondary"]');
  await page.fill("#ed-new-zone-id", "kemang");
  await page.fill("#ed-new-zone-name", "Kemang");
  await page.fill("#ed-new-zone-label", "KM");
  await clickAndWaitStudioSave(page, 'button[data-map-action="add-zone"]');
  await page.click('button[data-map-tab="primary"]');
  await clickAndWaitStudioSave(page, 'button[data-map-action="add-landmark"]');
  await page.waitForSelector('[data-testid="step2-inspector"] input[data-field="name"]');
  await page.fill('[data-testid="step2-inspector"] input[data-field="name"]', "Landmark Kemang QA Persistent");
  await clickAndWaitStudioSave(page, 'button[data-map-action="apply-selected"]');
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
  await page.click('button[data-tab="reviewer"]');
  await assertNoHorizontalOverflow(page, "Reviewer queue tab");
  await clickAndWaitPost(page, 'button[data-action="publish"]');
  await page.waitForFunction(() => document.body.textContent.includes("publish-version"));

  await page.click('button[data-nav="catalog"]');
  await page.waitForSelector('article[data-pack-id="pack-claim-studio-qa"]');
  await clickAndWaitPost(
    page,
    'article[data-pack-id="pack-claim-studio-qa"] button[data-action="buy-pack"]',
  );
  await page.waitForSelector('button[data-action="settle-order"]');
  await clickAndWaitPost(page, 'button[data-action="settle-order"]');
  await page.waitForFunction(
    () => document.body.textContent.includes("Ruang Tunggu") && document.body.textContent.includes("Pass Berbayar"),
  );

  await ctx.close();
  console.log("qa:rulebook-studio passed (Full visual Studio lifecycle + validator jump + interactive dry-run + publish + Midtrans)");
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
