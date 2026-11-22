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

async function clickAndWaitPost(page, selector) {
  await Promise.all([
    page.waitForResponse((r) => r.url().includes("/api/rulebooks") && r.request().method() === "POST"),
    page.click(selector),
  ]);
}

try {
  // 1. Solo Official Jakarta Compact Claim run (observation_input, photo_proof, burn-on-fail, reload persistence, zero answer leak)
  const ctxSolo = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const pageSolo = await ctxSolo.newPage();
  await pageSolo.goto(`${baseUrl}/?play=rulebook-claim`, { waitUntil: "networkidle" });
  await pageSolo.waitForSelector('article[data-pack-id="official-jakarta-compact-claim"]');
  await clickAndWaitPost(
    pageSolo,
    'article[data-pack-id="official-jakarta-compact-claim"] button[data-action="start-free"]',
  );
  await pageSolo.waitForFunction(() => document.body.textContent.includes("Ruang Tunggu"));

  await clickAndWaitPost(pageSolo, 'button[data-action="sim-start-checkin"]');
  await clickAndWaitPost(pageSolo, 'button[data-action="mark-ready"]');
  await clickAndWaitPost(pageSolo, 'button[data-action="start-match"]');
  await pageSolo.waitForFunction(() => document.body.textContent.includes("Permainan Aktif"));

  // Zero hidden challenge prompt / answer key leakage before check-in
  const preCheckInText = await pageSolo.textContent("body");
  assert.equal(preCheckInText.includes("layang-layang"), false, "Hidden challenge prompt must not leak before check-in");
  assert.equal(preCheckInText.includes("correctChoiceId"), false, "Answer keys must never leak");

  // Lock m-bloc via observation_input ("2")
  await clickAndWaitPost(pageSolo, 'li[data-landmark-id="m-bloc"] button[data-action="checkin-landmark"]');
  await pageSolo.waitForSelector("#claim-input-answer");
  await pageSolo.fill("#claim-input-answer", "2");
  await clickAndWaitPost(pageSolo, 'button[data-action="submit-input"]');
  await pageSolo.waitForFunction(() => document.body.textContent.includes("1/4 landmark terkunci"));

  // Lock taman-ayodya via photo_proof (2nd zone!)
  await clickAndWaitPost(pageSolo, 'li[data-landmark-id="taman-ayodya"] button[data-action="checkin-landmark"]');
  await pageSolo.waitForSelector('button[data-action="submit-photo"]');
  await clickAndWaitPost(pageSolo, 'button[data-action="submit-photo"]');
  await pageSolo.waitForFunction(() => document.body.textContent.includes("2/4 landmark terkunci"));

  // Bail on blok-m-plaza -> Solo burn-on-fail marks landmark Hangus (Burned)
  await clickAndWaitPost(pageSolo, 'li[data-landmark-id="blok-m-plaza"] button[data-action="checkin-landmark"]');
  await pageSolo.waitForSelector('button[data-action="bail-challenge"]');
  await clickAndWaitPost(pageSolo, 'button[data-action="bail-challenge"]');
  await pageSolo.waitForFunction(() => document.body.textContent.includes("Hangus (Burned)"));

  // Reload persistence
  await pageSolo.reload({ waitUntil: "networkidle" });
  await pageSolo.waitForFunction(() => document.body.textContent.includes("2/4 landmark terkunci"));
  await ctxSolo.close();

  // 2. 3-player Claim the City FFA: vulnerable claim -> Bail -> "Open to steal!" -> rival steal-lock
  const ctxP1 = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const pageP1 = await ctxP1.newPage();
  await pageP1.goto(`${baseUrl}/?play=rulebook-claim`, { waitUntil: "networkidle" });
  await pageP1.waitForSelector('article[data-pack-id="official-jakarta-compact-claim"]');
  await clickAndWaitPost(
    pageP1,
    'article[data-pack-id="official-jakarta-compact-claim"] button[data-action="start-free"]',
  );
  await pageP1.waitForFunction(() => document.body.textContent.includes("Ruang Tunggu"));
  const codeMatch = (await pageP1.textContent("body")).match(/Kode:\s*(RC-[A-F0-9]+)/);
  assert.ok(codeMatch, "Claim room code should be visible");
  const roomCode = codeMatch[1];

  const ctxP2 = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const pageP2 = await ctxP2.newPage();
  await pageP2.goto(`${baseUrl}/?play=rulebook-claim`, { waitUntil: "networkidle" });
  await pageP2.fill("#rb-claim-join-code", roomCode);
  await pageP2.fill("#rb-claim-join-name", "Penantang 2");
  await clickAndWaitPost(pageP2, 'button[data-action="join-room"]');
  await pageP2.waitForFunction(() => document.body.textContent.includes("Ruang Tunggu"));

  const ctxP3 = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const pageP3 = await ctxP3.newPage();
  await pageP3.goto(`${baseUrl}/?play=rulebook-claim`, { waitUntil: "networkidle" });
  await pageP3.fill("#rb-claim-join-code", roomCode);
  await pageP3.fill("#rb-claim-join-name", "Penantang 3");
  await clickAndWaitPost(pageP3, 'button[data-action="join-room"]');
  await pageP3.waitForFunction(() => document.body.textContent.includes("Kursi Pemain (3/4)"));

  for (const p of [pageP1, pageP2, pageP3]) {
    await clickAndWaitPost(p, 'button[data-action="sim-start-checkin"]');
    await clickAndWaitPost(p, 'button[data-action="mark-ready"]');
  }
  await clickAndWaitPost(pageP1, 'button[data-action="start-match"]');
  await pageP1.waitForFunction(() => document.body.textContent.includes("Permainan Aktif"));

  // P1 checks in taman-literasi (vulnerable claim) then Bails -> broadcasts "Terbuka untuk direbut!"
  await clickAndWaitPost(pageP1, 'li[data-landmark-id="taman-literasi"] button[data-action="checkin-landmark"]');
  await pageP1.waitForSelector('button[data-action="bail-challenge"]');
  await clickAndWaitPost(pageP1, 'button[data-action="bail-challenge"]');

  // P2 refreshes -> sees "Open to steal!" alert -> steals & locks taman-literasi immediately
  await pageP2.click('button[data-action="refresh"]');
  await pageP2.waitForSelector('[data-testid="open-to-steal-alert"]');
  await clickAndWaitPost(pageP2, 'li[data-landmark-id="taman-literasi"] button[data-action="checkin-landmark"]');
  await pageP2.waitForSelector('button[data-action="submit-mcq"]');
  await clickAndWaitPost(pageP2, 'button[data-action="submit-mcq"]');
  await pageP2.waitForFunction(() =>
    document.querySelector('li[data-landmark-id="taman-literasi"]')?.textContent?.includes("Terkunci"),
  );
  await ctxP1.close();
  await ctxP2.close();
  await ctxP3.close();

  // 3. Creator clones Official Claim pack in unified Studio, adds custom photo_proof, publishes, buys via Midtrans
  const ctxCreator = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const pageCreator = await ctxCreator.newPage();
  await pageCreator.goto(`${baseUrl}/?play=rulebook-studio&format=claim-the-city`, { waitUntil: "networkidle" });
  await pageCreator.waitForSelector('button[data-action="clone"]');
  await clickAndWaitPost(pageCreator, 'button[data-action="clone"]');
  await pageCreator.waitForSelector("#ed-claim-photo-title");
  await pageCreator.fill("#ed-claim-photo-title", "Foto Mural Senopati");
  await pageCreator.fill("#ed-claim-landmark-name", "Taman Literasi Senopati");
  await clickAndWaitPost(pageCreator, 'button[data-action="save-draft"]');
  await pageCreator.waitForFunction(() => document.body.textContent.includes("lolos validator otomatis"));
  await pageCreator.click('button[data-action="dry-run"]');
  await pageCreator.waitForFunction(() => document.body.textContent.includes("Dry-Run OK"));
  await clickAndWaitPost(pageCreator, 'button[data-action="submit-draft"]');
  await pageCreator.waitForFunction(() => document.body.textContent.includes("diajukan ke peninjau"));
  await pageCreator.click('button[data-tab="reviewer"]');
  await clickAndWaitPost(pageCreator, 'button[data-action="publish"]');
  await pageCreator.waitForFunction(() => document.body.textContent.includes("publish-version"));

  await pageCreator.click('button[data-nav="catalog"]');
  await pageCreator.waitForSelector('article[data-pack-id="pack-senopati-claim"]');
  await clickAndWaitPost(
    pageCreator,
    'article[data-pack-id="pack-senopati-claim"] button[data-action="buy-pack"]',
  );
  await pageCreator.waitForSelector('button[data-action="settle-order"]');
  await clickAndWaitPost(pageCreator, 'button[data-action="settle-order"]');
  await pageCreator.waitForFunction(
    () => document.body.textContent.includes("Ruang Tunggu") && document.body.textContent.includes("Pass Berbayar"),
  );
  await ctxCreator.close();

  console.log("qa:rulebook-claim passed (Solo + 3-player Claim-Lock-Steal + Unified Studio + Midtrans Pass)");
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
