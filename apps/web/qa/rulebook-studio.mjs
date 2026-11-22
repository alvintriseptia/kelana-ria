import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { createRecordedMidtransAdapter, createSoloServer } from "../../api/dist/index.js";

const root = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const distDir = path.join(root, "dist");

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
});

async function clickAndWaitPost(page, selector) {
  await Promise.all([
    page.waitForResponse((r) => r.url().includes("/api/rulebooks") && r.request().method() === "POST"),
    page.click(selector),
  ]);
}

try {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();

  // 1. Hide & Seek Studio: multi-draft switcher, intentional validator error -> jump link -> fix -> interactive clue dry-run
  await page.goto(baseUrl, { waitUntil: "networkidle" });
  await page.click("#chooser-studio");
  await page.click('button[data-format="hide-and-seek"]');
  await page.waitForSelector('button[data-action="clone"]');

  await page.fill("#st-pack-id", "pack-seek-alpha");
  await page.fill("#st-title", "Alpha Seek Draft");
  await clickAndWaitPost(page, 'button[data-action="clone"]');
  await page.waitForSelector("#st-draft-select");

  await page.click('button[data-action="toggle-clone"]');
  await page.fill("#st-pack-id", "pack-seek-beta");
  await page.fill("#st-title", "Beta Seek Draft");
  await clickAndWaitPost(page, 'button[data-action="clone"]');

  // Switch back to Alpha draft
  await page.selectOption("#st-draft-select", "pack-seek-alpha@1");
  await page.waitForFunction(() => document.body.textContent.includes("pack-seek-alpha v1"));

  // Trigger intentional validation error (hidingZoneRadiusMeters = 10)
  await page.click('button[data-step="3"]');
  await page.waitForSelector("#ed-zone");
  await page.fill("#ed-zone", "10");
  await clickAndWaitPost(page, 'button[data-action="save-draft"]');
  await page.waitForSelector('button[data-jump-path]');

  // Navigate away to Step 1, then click Validator Jump Link -> returns to Step 3 #ed-zone!
  await page.click('button[data-step="1"]');
  await page.click('button[data-jump-path]');
  await page.waitForSelector("#ed-zone");
  await page.fill("#ed-zone", "400");
  await clickAndWaitPost(page, 'button[data-action="save-draft"]');
  await page.waitForFunction(() => document.body.textContent.includes("lolos validator otomatis"));

  // Step 4: interactive Hide & Seek clue dry-run simulator
  await page.click('button[data-step="4"]');
  await page.waitForSelector('button[data-dry-action="run-seek-clue"]');
  await page.click('button[data-dry-action="run-seek-clue"]');
  await page.waitForSelector('[data-testid="dry-seek-result"]');
  const seekDryText = await page.textContent('[data-testid="dry-seek-result"]');
  assert.match(seekDryText, /Hasil Uji Radar.*m\)/);

  // 2. Claim the City Studio: Step 2 zone+landmark -> Step 3 challenge+card -> Step 4 interactive modal test -> Publish -> Midtrans
  await page.click('button[data-format="claim-the-city"]');
  await page.waitForSelector('button[data-action="clone"]');
  await page.fill("#st-pack-id", "pack-claim-studio-qa");
  await page.fill("#st-title", "Studio QA Claim Pack");
  await page.fill("#st-price", "25000");
  await clickAndWaitPost(page, 'button[data-action="clone"]');

  // Step 2: add zone & landmark
  await page.click('button[data-step="2"]');
  await page.click('button[data-map-tab="secondary"]');
  await page.fill("#ed-new-zone-id", "kemang");
  await page.fill("#ed-new-zone-name", "Kemang");
  await page.fill("#ed-new-zone-label", "KM");
  await clickAndWaitPost(page, 'button[data-map-action="add-zone"]');
  await page.click('button[data-map-tab="primary"]');
  await clickAndWaitPost(page, 'button[data-map-action="add-landmark"]');

  // Step 3: add Call Your Shot challenge & Sabotage Curse card
  await page.click('button[data-step="3"]');
  await page.click('button[data-c3-tab="challenges"]');
  await page.fill("#ed-chal-title", "Uji Call Your Shot Kemang");
  await clickAndWaitPost(page, 'button[data-c3-action="add-challenge"]');
  await page.click('button[data-c3-tab="deck"]');
  await page.fill("#ed-ccard-title", "Sabotase Kemang");
  await clickAndWaitPost(page, 'button[data-c3-action="add-claim-card"]');

  // Step 4: interactive Claim challenge test modal on m-bloc (observation_input answer = "2")
  await page.click('button[data-step="4"]');
  await page.selectOption("#dry-claim-landmark", "m-bloc");
  await page.click('button[data-dry-action="open-claim-test"]');
  await page.waitForSelector("#dry-input-val");
  await page.fill("#dry-input-val", "2");
  await page.click('button[data-dry-action="submit-claim-test"]');
  await page.waitForSelector('[data-testid="dry-claim-result"]');
  const claimDryText = await page.textContent('[data-testid="dry-claim-result"]');
  assert.ok(claimDryText.includes("Jawaban Benar"), `Expected pass in dry-run modal, got: ${claimDryText}`);

  // Submit -> Reviewer Publish -> Public Catalog -> Midtrans settlement -> Live Room
  await clickAndWaitPost(page, 'button[data-action="submit-draft"]');
  await page.waitForFunction(() => document.body.textContent.includes("diajukan ke peninjau"));
  await page.click('button[data-tab="reviewer"]');
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
