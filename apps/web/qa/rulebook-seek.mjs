import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { createRecordedMidtransAdapter, createSoloServer } from "../../api/dist/index.js";

const root = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const distDir = path.join(root, "dist");

let now = 1_800_000_000_000;
const server = createSoloServer({
  databasePath: ":memory:",
  now: () => now,
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

try {
  // 0. Quick check: launching Hide & Seek directly from / opens Official Jakarta Compact Hide & Seek room + invite link
  const ctxRoot = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const pageRoot = await ctxRoot.newPage();
  await pageRoot.goto(baseUrl, { waitUntil: "networkidle" });
  await pageRoot.locator("#chooser").getByText("Grup (2–6)", { exact: true }).click();
  await pageRoot.locator("label").filter({ has: pageRoot.locator('input[value="hide-and-seek"]') }).click();
  await pageRoot.getByRole("button", { name: "Lihat ringkasan" }).click();
  await pageRoot.getByRole("button", { name: "Main Hide & Seek", exact: true }).click();
  await pageRoot.waitForFunction(() => document.body.textContent.includes("Ruang Tunggu"));
  const rootInvite = await pageRoot.getAttribute('[data-testid="invite-link"]', "href");
  assert.ok(rootInvite && rootInvite.includes("room=RB-"), "Root launch should create Hide & Seek room with invite link");
  await ctxRoot.close();

  // 1. Creator opens Studio from /, selects Hide & Seek, clones Official pack, exercises 4-step stepper + JSON export/import + revision note + publish
  const ctxCreator = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const pageCreator = await ctxCreator.newPage();
  await pageCreator.goto(baseUrl, { waitUntil: "networkidle" });
  await pageCreator.locator("#chooser").getByText("Grup (2–6)", { exact: true }).click();
  await pageCreator.locator("label").filter({ has: pageCreator.locator('input[value="hide-and-seek"]') }).click();
  await pageCreator.click("#chooser-studio");
  await pageCreator.waitForSelector('button[data-action="clone"]');
  await pageCreator.click('button[data-action="clone"]');
  await pageCreator.waitForSelector("#st-draft-select");

  // Step 2: interactive map editor — rename first station, add custom station & POI, verify validator passes
  await pageCreator.click('button[data-step="2"]');
  await pageCreator.waitForSelector('[data-testid="studio-map-host"]');
  await pageCreator.waitForSelector("#ed-station-name");
  await pageCreator.fill("#ed-station-name", "Stasiun Blok M BCA (Edisi Kopi)");
  await pageCreator.click('button[data-action="save-draft"]');
  await pageCreator.waitForFunction(() => document.body.textContent.includes("lolos validator otomatis"));
  await pageCreator.click('button[data-map-action="add-station"]');
  await pageCreator.waitForFunction(() => document.body.textContent.includes("Stasiun Baru"));
  await pageCreator.click('button[data-map-tab="secondary"]');
  await pageCreator.click('button[data-map-action="add-poi"]');
  await pageCreator.waitForFunction(() => document.body.textContent.includes("POI Publik"));

  // Step 3: add custom photo curse & save
  await pageCreator.click('button[data-step="3"]');
  await pageCreator.waitForSelector("#ed-curse-title");
  await pageCreator.fill("#ed-curse-title", "Kutukan Kopi Senopati");
  await pageCreator.click('button[data-action="save-draft"]');
  await pageCreator.waitForFunction(() => document.body.textContent.includes("lolos validator otomatis"));

  // Step 4: run dry-run, submit -> Reviewer requests changes -> verify revision banner -> re-submit -> publish
  await pageCreator.click('button[data-step="4"]');
  await pageCreator.click('button[data-action="dry-run"]');
  await pageCreator.waitForFunction(() => document.body.textContent.includes("Dry-Run OK"));
  await pageCreator.click('button[data-action="submit-draft"]');
  await pageCreator.waitForFunction(() => document.body.textContent.includes("diajukan ke peninjau"));

  await pageCreator.click('button[data-tab="reviewer"]');
  await pageCreator.click('button[data-action="request-changes"]');
  await pageCreator.waitForFunction(() => document.body.textContent.includes("request-changes"));

  await pageCreator.click('button[data-tab="writer"]');
  await pageCreator.click('button[data-step="1"]');
  await pageCreator.waitForSelector('[data-testid="revision-note-banner"]');

  // Verify JSON export + malformed JSON guard + valid JSON import round-trip
  await pageCreator.click('button[data-action="toggle-json"]');
  await pageCreator.waitForSelector("#st-json-text");
  const exportedJson = await pageCreator.inputValue("#st-json-text");
  assert.ok(exportedJson.includes("pack-senopati-seek"), "Exported JSON should contain active pack");
  await pageCreator.fill("#st-json-text", "{broken-json");
  await pageCreator.click('button[data-action="import-json"]');
  await pageCreator.waitForFunction(() => document.body.textContent.includes("JSON tidak valid"));
  await pageCreator.fill("#st-json-text", exportedJson);
  await pageCreator.click('button[data-action="import-json"]');
  await pageCreator.waitForFunction(() => document.body.textContent.includes("JSON berhasil diimpor"));

  await pageCreator.click('button[data-step="4"]');
  await pageCreator.click('button[data-action="submit-draft"]');
  await pageCreator.waitForFunction(() => document.body.textContent.includes("diajukan ke peninjau"));
  await pageCreator.click('button[data-tab="reviewer"]');
  await pageCreator.click('button[data-action="publish"]');
  await pageCreator.waitForFunction(() => document.body.textContent.includes("publish-version"));

  // Verify v2 clone from published pack works without mutating v1
  await pageCreator.click('button[data-tab="writer"]');
  await pageCreator.click('button[data-step="1"]');
  await pageCreator.waitForSelector('button[data-action="clone-next-version"]');
  await pageCreator.click('button[data-action="clone-next-version"]');
  await pageCreator.waitForFunction(() => document.body.textContent.includes("pack-senopati-seek v2"));

  // Navigate to catalog, purchase paid pack via recorded-sandbox Midtrans, and unlock room
  await pageCreator.click('button[data-nav="catalog"]');
  await pageCreator.waitForSelector('article[data-pack-id="pack-senopati-seek"]');
  await pageCreator.click('article[data-pack-id="pack-senopati-seek"] button[data-action="buy-pack"]');
  await pageCreator.waitForSelector('button[data-action="settle-order"]');
  await pageCreator.click('button[data-action="settle-order"]');
  await pageCreator.waitForFunction(() => document.body.textContent.includes("Ruang Tunggu"));

  const codeMatch = (await pageCreator.textContent("body")).match(/Kode:\s*(RB-[A-F0-9]+)/);
  assert.ok(codeMatch, "Paid room code should be displayed after Midtrans settlement");
  const roomCode = codeMatch[1];

  // 2. Two guests join the paid room in isolated browser contexts (3 players total under 1 pass!)
  const ctxG2 = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const pageG2 = await ctxG2.newPage();
  await pageG2.goto(`${baseUrl}/?play=rulebook-seek`, { waitUntil: "networkidle" });
  await pageG2.fill("#rb-join-code", roomCode);
  await pageG2.fill("#rb-join-name", "Pencari 1");
  await pageG2.click('button[data-action="join-room"]');
  await pageG2.waitForFunction(() => document.body.textContent.includes("Ruang Tunggu"));

  const ctxG3 = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const pageG3 = await ctxG3.newPage();
  await pageG3.goto(`${baseUrl}/?play=rulebook-seek`, { waitUntil: "networkidle" });
  await pageG3.fill("#rb-join-code", roomCode);
  await pageG3.fill("#rb-join-name", "Pencari 2");
  await pageG3.click('button[data-action="join-room"]');
  await pageG3.waitForFunction(() => document.body.textContent.includes("Kursi Pemain (3/4)"));

  async function clickAndWaitPost(page, selector) {
    await Promise.all([
      page.waitForResponse((r) => r.url().includes("/api/rulebooks") && r.request().method() === "POST"),
      page.click(selector),
    ]);
  }

  // All 3 check in and mark ready -> Host starts match
  for (const p of [pageCreator, pageG2, pageG3]) {
    await clickAndWaitPost(p, 'button[data-action="sim-start-checkin"]');
    await clickAndWaitPost(p, 'button[data-action="mark-ready"]');
  }
  await clickAndWaitPost(pageCreator, 'button[data-action="start-match"]');
  await pageCreator.waitForFunction(() => document.body.textContent.includes("Waktu Sembunyi"));

  // Hider locks mrt-blok-m; Seeker DOM must NOT contain Hider's private anchor or Found Code!
  await clickAndWaitPost(pageCreator, 'button[data-action="lock-anchor"]');
  now += 26 * 60_000;
  await pageG2.click('button[data-action="refresh"]');
  await pageG2.waitForFunction(() => document.body.textContent.includes("Perburuan Makro"));
  const seekerBodyBeforeEndgame = await pageG2.textContent("body");
  assert.equal(seekerBodyBeforeEndgame.includes("hider-found-code"), false);

  // Seeker asks a Radar clue, Hider answers & picks drawn card, Seeker triggers Endgame, enters Found Code -> Regroup!
  await clickAndWaitPost(pageG2, 'button[data-action="ask-clue"]');
  await pageCreator.click('button[data-action="refresh"]');
  await pageCreator.waitForSelector('button[data-action="answer-pending"]');
  await clickAndWaitPost(pageCreator, 'button[data-action="answer-pending"]');
  await pageCreator.waitForSelector('button[data-action="choose-draw"]');
  await clickAndWaitPost(pageCreator, 'button[data-action="choose-draw"]');
  await pageCreator.waitForFunction(() => document.body.textContent.includes("Tangan Penyembunyi (1/"));

  await clickAndWaitPost(pageG2, 'button[data-action="trigger-endgame"]');
  await pageG2.waitForFunction(() => document.body.textContent.includes("ENDGAME"));
  await pageCreator.click('button[data-action="refresh"]');
  const foundCode = (await pageCreator.textContent('[data-testid="hider-found-code"]')).trim();
  assert.match(foundCode, /^\d{4}$/);

  await pageG2.fill("#rb-found-input", foundCode);
  await clickAndWaitPost(pageG2, 'button[data-action="submit-found-code"]');
  await pageG2.waitForFunction(() => document.body.textContent.includes("Berkumpul Kembali"));

  console.log("qa:rulebook-seek passed (3-player paid Hide & Seek RulebookPack + Studio + Endgame Found Code)");
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
