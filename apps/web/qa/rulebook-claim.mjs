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
  args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
});

async function clickAndWaitPost(page, selector) {
  await Promise.all([
    page.waitForResponse((r) => r.url().includes("/api/rulebooks") && r.request().method() === "POST"),
    page.click(selector),
  ]);
  await page.waitForFunction(() => !document.querySelector('[aria-busy="true"]'));
}

async function selectLandmark(page, id) {
  await page.locator("#rb-claim-map-host[data-map-ready=true]").waitFor();
  await page.locator(`button[data-map-point="${id}"]`).press("Enter");
}

async function checkIn(page, id) {
  await selectLandmark(page, id);
  await clickAndWaitPost(page, `.cg-selected[data-landmark-id="${id}"] button[data-action="checkin-landmark"]`);
}

const proof = {
  name: "landmark.png",
  mimeType: "image/png",
  buffer: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAABAAAAAKCAIAAAAy3EnLAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAFUlEQVQYlWNwyIogCTGMasgakqEEAE4woUHUV2UvAAAAAElFTkSuQmCC", "base64"),
};

try {
  // 1. Solo Official Jakarta Compact Claim launched directly from /
  const ctxSolo = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: "block" });
  const pageSolo = await ctxSolo.newPage();
  await pageSolo.goto(baseUrl, { waitUntil: "networkidle" });
  await pageSolo.getByRole("button", { name: "Lihat ringkasan" }).click();
  await pageSolo.getByRole("button", { name: "Main Solo", exact: true }).click();
  await pageSolo.waitForFunction(() => document.body.textContent.includes("Ruang Tunggu"));

  await clickAndWaitPost(pageSolo, 'button[data-action="sim-start-checkin"]');
  await clickAndWaitPost(pageSolo, 'button[data-action="mark-ready"]');
  await clickAndWaitPost(pageSolo, 'button[data-action="start-match"]');
  await pageSolo.waitForFunction(() => document.body.textContent.includes("Permainan Aktif"));
  await pageSolo.locator("#rb-claim-map-host[data-map-ready=true]").waitFor();
  const claimCanvas = await pageSolo.locator("#rb-claim-map-host .maplibregl-canvas").elementHandle();
  assert.equal(await pageSolo.getByRole("list", { name: "Daftar Landmark" }).count(), 0);
  assert.ok(await pageSolo.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await pageSolo.getByRole("button", { name: "Skor", exact: true }).click();
  assert.match(await pageSolo.locator(".cg-score-grid").innerText(), /0\/4.*0\/2/s);
  await pageSolo.getByRole("button", { name: "Kartu", exact: true }).click();
  assert.equal(await pageSolo.locator('button[data-nav="catalog"]').filter({ visible: true }).count(), 0);

  // Zero hidden challenge prompt / answer key leakage before check-in
  const preCheckInText = await pageSolo.textContent("body");
  assert.equal(preCheckInText.includes("layang-layang"), false, "Hidden challenge prompt must not leak before check-in");
  assert.equal(preCheckInText.includes("correctChoiceId"), false, "Answer keys must never leak");

  // Lock m-bloc via observation_input ("2")
  await checkIn(pageSolo, "m-bloc");
  await pageSolo.waitForSelector("#claim-input-answer");
  await pageSolo.fill("#claim-input-answer", "2");
  await clickAndWaitPost(pageSolo, 'button[data-action="submit-input"]');
  await pageSolo.waitForFunction(() => document.body.textContent.includes("1/4 terkunci"));
  assert.equal(
    await claimCanvas.evaluate((el) => el.isConnected && document.querySelector("#rb-claim-map-host .maplibregl-canvas") === el),
    true,
    "Claim play MapLibre canvas must stay continuously mounted across check-in actions",
  );

  // The player must choose a target before a map-targeted card can be played.
  await pageSolo.getByRole("button", { name: "Kartu", exact: true }).click();
  await pageSolo.locator(".cg-tactic").first().click();
  const play = pageSolo.getByRole("button", { name: "Mainkan Kartu" });
  assert.equal(await play.isDisabled(), true);
  const eligible = pageSolo.locator("button.board-map-pin-eligible");
  if (await eligible.count()) {
    const target = await eligible.first().getAttribute("data-map-point");
    await selectLandmark(pageSolo, target);
    assert.equal(await play.getAttribute("data-landmark"), target);
    assert.equal(await play.isEnabled(), true);
  }
  await pageSolo.getByRole("button", { name: "Tantangan", exact: true }).click();

  // Lock taman-ayodya via photo_proof (2nd zone!)
  await checkIn(pageSolo, "taman-ayodya");
  await pageSolo.waitForSelector('button[data-action="submit-photo"]');
  await pageSolo.locator("input[data-cg-photo]").setInputFiles(proof);
  await clickAndWaitPost(pageSolo, 'button[data-action="submit-photo"]');
  await pageSolo.waitForFunction(() => document.body.textContent.includes("2/4 terkunci"));

  // Bail on blok-m-plaza -> Solo burn-on-fail marks landmark Hangus (Burned)
  await checkIn(pageSolo, "blok-m-plaza");
  await pageSolo.waitForSelector('button[data-action="bail-challenge"]');
  await clickAndWaitPost(pageSolo, 'button[data-action="bail-challenge"]');
  assert.match(await pageSolo.locator(".cg-selected").innerText(), /hangus/);

  // Reload persistence
  await pageSolo.reload({ waitUntil: "networkidle" });
  await pageSolo.waitForFunction(() => document.body.textContent.includes("2/4 terkunci"));
  await pageSolo.route("**/api/map/config", route => route.fulfill({ json: {
    mode: "geoapify-vector", styleUrl: "/qa-unavailable-claim-map", mapLibreLicenseUrl: "/licenses/maplibre-gl.txt",
  } }));
  await pageSolo.route("**/qa-unavailable-claim-map", route => route.abort());
  await pageSolo.reload();
  await pageSolo.getByRole("list", { name: "Daftar Landmark" }).getByRole("button", { name: /Blok M Plaza/i }).click();
  assert.match(await pageSolo.locator(".cg-selected").innerText(), /hangus/);
  await pageSolo.unroute("**/api/map/config");
  await pageSolo.getByRole("button", { name: "Coba Lagi" }).click();
  await pageSolo.locator("#rb-claim-map-host[data-map-ready=true]").waitFor();
  assert.equal(await pageSolo.getByRole("list", { name: "Daftar Landmark" }).count(), 0);
  await ctxSolo.close();

  // 2. 3-player Claim the City FFA launched directly from / + invite link join
  const ctxP1 = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const pageP1 = await ctxP1.newPage();
  await pageP1.goto(baseUrl, { waitUntil: "networkidle" });
  await pageP1.locator("#chooser").getByText("Grup (2–6)", { exact: true }).click();
  await pageP1.getByRole("button", { name: "Lihat ringkasan" }).click();
  await pageP1.getByRole("button", { name: "Main Grup (2–6)", exact: true }).click();
  await pageP1.waitForFunction(() => document.body.textContent.includes("Ruang Tunggu"));
  const inviteHref = await pageP1.getAttribute('[data-testid="invite-link"]', "href");
  assert.ok(inviteHref && inviteHref.includes("room=RC-"), "Shareable invite link should be visible in lobby");
  const codeMatch = (await pageP1.textContent("body")).match(/Kode:\s*(RC-[A-F0-9]+)/);
  assert.ok(codeMatch, "Claim room code should be visible");
  const roomCode = codeMatch[1];

  const ctxP2 = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const pageP2 = await ctxP2.newPage();
  await pageP2.goto(inviteHref, { waitUntil: "networkidle" });
  await pageP2.waitForSelector("#rb-claim-join-code");
  assert.equal(await pageP2.inputValue("#rb-claim-join-code"), roomCode, "Invite URL should prefill room code");
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
  await checkIn(pageP1, "taman-literasi");
  await pageP1.waitForSelector('button[data-action="bail-challenge"]');
  await clickAndWaitPost(pageP1, 'button[data-action="bail-challenge"]');

  // P2 refreshes -> sees "Open to steal!" alert -> steals & locks taman-literasi immediately
  await pageP2.waitForSelector('[data-testid="open-to-steal-alert"]');
  await pageP2.getByLabel("Lainnya").click();
  await pageP2.click('button[data-action="refresh"]');
  await pageP2.waitForFunction(() => !document.querySelector('[aria-busy="true"]'));
  await checkIn(pageP2, "taman-literasi");
  await pageP2.waitForSelector('button[data-action="submit-mcq"]');
  await clickAndWaitPost(pageP2, 'button[data-action="submit-mcq"]');
  await pageP2.waitForFunction(() =>
    document.querySelector('.cg-selected[data-landmark-id="taman-literasi"]')?.textContent?.includes("Terkunci"),
  );
  await checkIn(pageP1, "taman-ayodya");
  await pageP1.locator("input[data-cg-photo]").setInputFiles(proof);
  await clickAndWaitPost(pageP1, 'button[data-action="submit-photo"]');
  const rivalProof = pageP2.getByAltText("Foto bukti untuk ditinjau");
  await rivalProof.waitFor();
  await pageP2.waitForFunction(() => document.querySelector(".cg-proof")?.naturalWidth > 0);
  const proofPath = await rivalProof.getAttribute("src");
  assert.equal((await fetch(new URL(proofPath, baseUrl))).status, 404);
  await clickAndWaitPost(pageP2, 'button[data-action="review-rival-photo"][data-approve="false"]');
  assert.equal((await ctxP2.request.get(new URL(proofPath, baseUrl).href)).status(), 404);
  now += 3 * 60 * 60 * 1000;
  await pageP2.getByTestId("claim-outcome").waitFor();
  assert.match(await pageP2.getByTestId("claim-outcome").innerText(), /Pemenang · Penantang 2.*Landmark yang terkunci/s);
  await ctxP1.close();
  await ctxP2.close();
  await ctxP3.close();

  // 3. Creator opens unified Studio directly from /, clones Official Claim pack, walks 4-step stepper, publishes, buys via Midtrans
  const ctxCreator = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const pageCreator = await ctxCreator.newPage();
  await pageCreator.goto(baseUrl, { waitUntil: "networkidle" });
  await pageCreator.click("#chooser-studio");
  await pageCreator.waitForSelector('button[data-action="clone"]');
  await clickAndWaitPost(pageCreator, 'button[data-action="clone"]');
  await pageCreator.waitForSelector("#st-draft-select");

  // Step 2: interactive map editor — rename first landmark, add custom Zone & Landmark, verify orphan-zone guardrail
  await pageCreator.click('button[data-step="2"]');
  await pageCreator.waitForSelector('[data-testid="studio-map-host"]');
  await pageCreator.waitForSelector("#ed-claim-landmark-name");
  await pageCreator.fill("#ed-claim-landmark-name", "Taman Literasi Senopati");
  await clickAndWaitPost(pageCreator, 'button[data-action="save-draft"]');
  await pageCreator.waitForFunction(() => document.body.textContent.includes("lolos validator otomatis"));
  await pageCreator.click('button[data-map-tab="secondary"]');
  await pageCreator.fill("#ed-new-zone-id", "senopati-baru");
  await pageCreator.fill("#ed-new-zone-name", "Senopati Baru");
  await pageCreator.fill("#ed-new-zone-label", "SB");
  await clickAndWaitPost(pageCreator, 'button[data-map-action="add-zone"]');
  await pageCreator.waitForFunction(() => document.body.textContent.includes("Zona Senopati Baru ditambahkan"));
  await pageCreator.click('button[data-map-tab="primary"]');
  await clickAndWaitPost(pageCreator, 'button[data-map-action="add-landmark"]');
  await pageCreator.waitForFunction(() => document.body.textContent.includes("Landmark Baru"));

  // Step 3: add custom photo_proof + Call Your Shot challenge + Sabotage Curse tactical card
  await pageCreator.click('button[data-step="3"]');
  await pageCreator.waitForSelector("#ed-claim-photo-title");
  await pageCreator.fill("#ed-claim-photo-title", "Foto Mural Senopati");
  await clickAndWaitPost(pageCreator, 'button[data-action="save-draft"]');
  await pageCreator.waitForFunction(() => document.body.textContent.includes("lolos validator otomatis"));

  await pageCreator.click('button[data-c3-tab="challenges"]');
  await pageCreator.fill("#ed-chal-title", "Tantangan Call Your Shot Senopati");
  await pageCreator.fill("#ed-chal-answer", "rahasia-jawaban-senopati");
  await clickAndWaitPost(pageCreator, 'button[data-c3-action="add-challenge"]');
  await pageCreator.waitForFunction(() => document.body.textContent.includes("Tantangan Call Your Shot Senopati"));

  await pageCreator.click('button[data-c3-tab="deck"]');
  await pageCreator.fill("#ed-ccard-title", "Sabotase Macet Senopati");
  await clickAndWaitPost(pageCreator, 'button[data-c3-action="add-claim-card"]');
  await pageCreator.waitForFunction(() => document.body.textContent.includes("Sabotase Macet Senopati"));

  // Step 4: dry-run & submit -> Reviewer publish
  await pageCreator.click('button[data-step="4"]');
  await pageCreator.click('button[data-action="dry-run"]');
  await pageCreator.waitForFunction(() => document.body.textContent.includes("Dry-Run OK"));
  await clickAndWaitPost(pageCreator, 'button[data-action="submit-draft"]');
  await pageCreator.waitForFunction(() => document.body.textContent.includes("diajukan ke peninjau"));
  await pageCreator.click('button[data-tab="reviewer"]');
  await clickAndWaitPost(pageCreator, 'button[data-action="publish"]');
  await pageCreator.waitForFunction(() => document.body.textContent.includes("publish-version"));

  // Confirm private answer keys NEVER leak on public /api/rulebooks listing
  const publicListingText = await pageCreator.evaluate(() =>
    fetch("/api/rulebooks?format=claim-the-city").then((r) => r.text()),
  );
  assert.equal(
    publicListingText.includes("rahasia-jawaban-senopati"),
    false,
    "Private answer keys authored in Studio must never leak to public catalog",
  );

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
