import assert from "node:assert/strict";
import path from "node:path";
import { mkdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { createRecordedMidtransAdapter, createSoloServer } from "../../api/dist/index.js";
import { openEdition } from "./catalog.mjs";
import { buyPublishedDraft, openDraft, openReview, reviewerKey, startDraft } from "./studio-navigation.mjs";

const root = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const distDir = path.join(root, "dist");
const results = path.join(root, "qa-results");
await mkdir(results, { recursive: true });
const recordVideo = !process.env.CHROMIUM_PATH || process.env.RECORD_GAME_MOTION
  ? { dir: path.join(results, ".seek-recordings"), size: { width: 390, height: 844 } }
  : undefined;

let now = 1_800_000_000_000;
const server = createSoloServer({
  databasePath: ":memory:",
  now: () => now,
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

try {
  // 0. Quick check: launching Hide & Seek directly from / opens Official Jakarta Compact Hide & Seek room + invite link
  const ctxRoot = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const pageRoot = await ctxRoot.newPage();
  await pageRoot.goto(baseUrl, { waitUntil: "networkidle" });
  await openEdition(pageRoot, "hide-and-seek");
  await pageRoot.getByRole("button", { name: "Main Grup", exact: true }).click();
  await pageRoot.waitForFunction(() => document.body.textContent.includes("Ruang Tunggu"));
  const rootInvite = await pageRoot.getAttribute('[data-testid="invite-link"]', "href");
  assert.ok(rootInvite && rootInvite.includes("room=RB-"), "Root launch should create Hide & Seek room with invite link");
  await ctxRoot.close();

  // 1. Creator opens Studio from /, selects Hide & Seek, clones Official pack, exercises 4-step stepper + JSON export/import + revision note + publish
  const ctxCreator = await browser.newContext({ viewport: { width: 390, height: 844 }, recordVideo });
  const pageCreator = await ctxCreator.newPage();
  pageCreator.setDefaultTimeout(20_000);
  await pageCreator.goto(baseUrl, { waitUntil: "networkidle" });
  await pageCreator.click("#chooser-studio");
  await startDraft(pageCreator, "hide-and-seek");
  await pageCreator.waitForSelector('button[data-action="clone"]');
  await pageCreator.click('button[data-action="clone"]');
  await pageCreator.waitForSelector("#ed-meta-title");

  // Step 2: interactive map editor — rename first station, add custom station & POI, verify validator passes
  await pageCreator.click('button[data-step="2"]');
  await pageCreator.waitForSelector('[data-testid="studio-map-host"]');
  await pageCreator.waitForSelector("#ed-station-name");
  assert.equal(await pageCreator.locator("#ed-st-attrs").count(), 0, "Raw key=value station attribute field should be replaced");
  await pageCreator.fill("#ed-station-name", "Stasiun Blok M BCA (Edisi Kopi)");
  await pageCreator.fill("#ed-st-attr-kecamatan", "Kebayoran Baru");
  await pageCreator.fill("#ed-st-attr-corridor", "Selatan");
  await pageCreator.click('button[data-map-action="apply-selected"]');
  await pageCreator.waitForFunction(() => document.body.textContent.includes("lolos validator otomatis"));
  await pageCreator.click('button[data-map-action="add-station"]');
  await pageCreator.waitForFunction(() => document.body.textContent.includes("Stasiun Baru"));
  await pageCreator.click('button[data-map-tab="secondary"]');
  await pageCreator.click('button[data-map-action="add-poi"]');
  await pageCreator.waitForFunction(() => document.body.textContent.includes("POI Publik"));

  // Step 3: save timer rules + custom Radar item in Buku Petunjuk + composed Curse in Dek & Kutukan
  await pageCreator.click('button[data-step="3"]');
  await pageCreator.waitForSelector("#ed-head");
  assert.equal(await pageCreator.locator("#ed-curse-title").count(), 0, "Curse quick-add should not appear inside Timer & Sesi");
  await pageCreator.click('button[data-action="save-draft"]');
  await pageCreator.waitForFunction(() => document.body.textContent.includes("lolos validator otomatis"));

  await pageCreator.click('button[data-s3-tab="book"]');
  await pageCreator.fill("#ed-item-label", "Radar 750 m Kustom");
  await pageCreator.click('button[data-s3-action="add-book-item"]');
  await pageCreator.waitForFunction(() => document.body.textContent.includes("Radar 750 m Kustom"));

  await pageCreator.click('button[data-s3-tab="deck"]');
  await pageCreator.fill("#ed-card-title", "Kutukan Barista Buyout");
  await pageCreator.selectOption("#ed-curse-cost", "discard_cards");
  await pageCreator.click('button[data-s3-action="add-seek-card"]');
  await pageCreator.waitForFunction(() => document.body.textContent.includes("Kutukan Barista Buyout"));

  // Step 4: run dry-run, submit -> Reviewer requests changes -> verify revision banner -> re-submit -> publish
  await pageCreator.click('button[data-step="4"]');
  await pageCreator.click('button[data-action="dry-run"]');
  await pageCreator.waitForFunction(() => document.body.textContent.includes("Dry-Run OK"));
  await pageCreator.click('button[data-action="submit-draft"]');
  await pageCreator.waitForFunction(() => document.body.textContent.includes("diajukan ke peninjau"));

  await openReview(pageCreator);
  await pageCreator.click('button[data-action="request-changes"]');
  await pageCreator.waitForFunction(() => document.body.textContent.includes("request-changes"));

  await openDraft(pageCreator, "pack-senopati-seek");
  await pageCreator.waitForSelector('[data-testid="revision-note-banner"]');

  // Verify JSON export + malformed JSON guard + valid JSON import round-trip
  const [download] = await Promise.all([
    pageCreator.waitForEvent("download"),
    pageCreator.click('button[data-action="export-json"]'),
  ]);
  const exportedJson = await readFile(await download.path(), "utf8");
  assert.ok(exportedJson.includes("pack-senopati-seek"), "Exported JSON should contain active pack");
  await pageCreator.click('button[data-studio-view="home"]');
  await startDraft(pageCreator, "hide-and-seek");
  await pageCreator.click('button[data-studio-view="import"]');
  await pageCreator.fill("#st-json-text", "{broken-json");
  await pageCreator.click('button[data-action="import-json"]');
  await pageCreator.waitForFunction(() => document.body.textContent.includes("JSON tidak valid"));
  await pageCreator.fill("#st-json-text", exportedJson);
  await pageCreator.click('button[data-action="import-json"]');
  await pageCreator.waitForFunction(() => document.body.textContent.includes("JSON berhasil diimpor"));

  await pageCreator.click('button[data-step="4"]');
  await pageCreator.click('button[data-action="submit-draft"]');
  await pageCreator.waitForFunction(() => document.body.textContent.includes("diajukan ke peninjau"));
  await openReview(pageCreator);
  await pageCreator.click('button[data-action="publish"]');
  await pageCreator.waitForFunction(() => document.body.textContent.includes("publish-version"));

  // Verify v2 clone from published pack works without mutating v1
  await openDraft(pageCreator, "pack-senopati-seek");
  await pageCreator.click('button[data-step="1"]');
  await pageCreator.waitForSelector('button[data-action="clone-next-version"]');
  await pageCreator.click('button[data-action="clone-next-version"]');
  await pageCreator.waitForFunction(() => document.body.textContent.includes("pack-senopati-seek v2"));

  // Navigate to catalog, purchase paid pack via recorded-sandbox Midtrans, and unlock room
  await pageCreator.click('button[data-studio-view="home"]');
  await pageCreator.click('button[data-nav="back"]');
  await buyPublishedDraft(pageCreator, "pack-senopati-seek");
  await pageCreator.waitForFunction(() => document.body.textContent.includes("Ruang Tunggu"));

  const codeMatch = (await pageCreator.textContent("body")).match(/Kode:\s*(RB-[A-F0-9]+)/);
  assert.ok(codeMatch, "Paid room code should be displayed after Midtrans settlement");
  const roomCode = codeMatch[1];

  // 2. Two guests join the paid room in isolated browser contexts (3 players total under 1 pass!)
  const ctxG2 = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: "block", recordVideo });
  const pageG2 = await ctxG2.newPage();
  pageG2.setDefaultTimeout(20_000);
  await pageG2.goto(`${baseUrl}/?play=rulebook-seek`, { waitUntil: "networkidle" });
  await pageG2.fill("#rb-join-code", roomCode);
  await pageG2.fill("#rb-join-name", "Pencari 1");
  await pageG2.click('button[data-action="join-room"]');
  await pageG2.waitForFunction(() => document.body.textContent.includes("Ruang Tunggu"));

  const ctxG3 = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const pageG3 = await ctxG3.newPage();
  pageG3.setDefaultTimeout(20_000);
  await pageG3.goto(`${baseUrl}/?play=rulebook-seek`, { waitUntil: "networkidle" });
  await pageG3.fill("#rb-join-code", roomCode);
  await pageG3.fill("#rb-join-name", "Pencari 2");
  await pageG3.click('button[data-action="join-room"]');
  await pageG3.waitForFunction(() => document.body.textContent.includes("Kursi Pemain (3/4)"));

  async function refreshSeekRoom(page) {
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        const isOpen = await page
          .locator(".sg-room-menu")
          .evaluate((el) => el.hasAttribute("open"))
          .catch(() => false);
        if (!isOpen) {
          await page.locator(".sg-room-menu summary").click({ timeout: 3000 });
        }
        await page.locator('button[data-action="refresh"]').click({ timeout: 3000 });
        await page.waitForFunction(() => !document.querySelector('[aria-busy="true"]'));
        return;
      } catch (error) {
        if (attempt === 3) throw error;
      }
    }
  }

  async function clickAndWaitPost(page, selector) {
    await Promise.all([
      page.waitForResponse((r) => r.url().includes("/api/rulebooks") && !r.url().endsWith("/question-preview") && r.request().method() === "POST"),
      page.click(selector),
    ]);
    await page.waitForFunction(() => !document.querySelector('[aria-busy="true"]'));
  }

  // All 3 check in and mark ready -> Host starts match
  for (const p of [pageCreator, pageG2, pageG3]) {
    await clickAndWaitPost(p, 'button[data-action="sim-start-checkin"]');
    await clickAndWaitPost(p, 'button[data-action="mark-ready"]');
  }
  await clickAndWaitPost(pageCreator, 'button[data-action="start-match"]');
  await pageCreator.waitForFunction(() => document.body.textContent.includes("Waktu Sembunyi"));
  await pageCreator.locator("[data-map-ready=true]").waitFor();
  await pageCreator.screenshot({ path: path.join(results, "rulebook-seek-head-start.png") });

  // Hider locks mrt-blok-m; Seeker DOM must NOT contain Hider's private anchor or Found Code!
  const headStart = await pageCreator.request.get(`${baseUrl}/api/rulebooks/rooms/${roomCode}`).then(r => r.json());
  assert.equal(headStart.room.releaseAt - headStart.room.now, 25 * 60_000);
  assert.match(await pageCreator.locator(".sg-timer").innerText(), /^(25:00|24:[0-5]\d)$/);
  assert.equal(await pageCreator.locator('button[data-action="select-station"]').count(), 0);
  await pageCreator.click('button[data-map-point="mrt-blok-m"]');
  await clickAndWaitPost(pageCreator, 'button[data-action="lock-anchor"]');
  now += 26 * 60_000;
  await refreshSeekRoom(pageG2);
  await pageG2.waitForFunction(() => document.body.textContent.includes("Fase Cari"));
  const seekerBodyBeforeEndgame = await pageG2.textContent("body");
  assert.equal(seekerBodyBeforeEndgame.includes("hider-found-code"), false);

  // Seeker asks a Radar clue, Hider answers & picks drawn card, Seeker triggers Endgame, enters Found Code -> Regroup!
  const radarCard = pageG2.locator('button[data-action="question-family"][data-family="radar"]');
  await radarCard.waitFor();
  await pageG2.locator("[data-map-ready=true]").waitFor();
  await pageG2.screenshot({ path: path.join(results, "rulebook-seek-question-deck.png") });
  const canvas = await pageG2.locator(".sg-board .maplibregl-canvas").elementHandle();
  const choosePreview = async (selector) => {
    const [response] = await Promise.all([
      pageG2.waitForResponse(r => r.url().endsWith("/api/rulebooks/question-preview")),
      pageG2.locator(selector).first().click(),
    ]);
    assert.equal(response.status(), 200, await response.text());
    return response.json();
  };
  await radarCard.press("Enter");
  await choosePreview('button[data-item="rad-500m"]');
  await pageG2.locator('[data-question-preview="500"]').waitFor();
  for (const family of ["matching", "measuring", "tentacles"]) {
    await pageG2.click('button[data-action="question-deck"]');
    await pageG2.click(`button[data-action="question-family"][data-family="${family}"]`);
    const draft = (await choosePreview('button[data-action="question-option"]:not([disabled])')).preview;
    assert.ok(family === "matching" ? draft.station : Array.isArray(draft.targets));
    if (family === "tentacles") assert.ok(draft.radiusMeters > 0);
  }
  await pageG2.click('button[data-action="question-deck"]');
  await radarCard.click();
  const draft = (await choosePreview('button[data-item="rad-1km"]')).preview;
  const drawnPreview = pageG2.locator('[data-question-preview="1000"]');
  await drawnPreview.waitFor();
  assert.equal(await canvas.evaluate(element => element.isConnected), true);
  assert.equal(await pageCreator.locator("[data-question-preview]").count(), 0);
  const hiderBefore = await pageCreator.request.get(`${baseUrl}/api/rulebooks/rooms/${roomCode}`).then(r => r.json());
  assert.equal(hiderBefore.room.questions.length, 0);
  await pageG2.click('button[data-action="focus-preview"]');
  await pageG2.screenshot({ path: path.join(results, "rulebook-seek-radar-preview.png") });
  await pageG2.locator('[data-panel="ask"]').click();
  await drawnPreview.waitFor({ state: "detached" });
  await pageG2.locator('[data-panel="ask"]').click();
  await drawnPreview.waitFor();
  await clickAndWaitPost(pageG2, 'button[data-action="ask-clue"]');
  await drawnPreview.waitFor({ state: "detached" });
  const seekerAfter = await pageG2.request.get(`${baseUrl}/api/rulebooks/rooms/${roomCode}`).then(r => r.json());
  assert.deepEqual(seekerAfter.room.questions[0].referencePoint, draft.reference);
  assert.equal(seekerAfter.room.questions[0].radarRadiusMeters, draft.radiusMeters);
  assert.equal(seekerAfter.activity.events.some(event => event.kind === "question"), false);
  const pendingNotice = pageCreator.locator('[data-activity-message][data-notice-kind="question"]');
  await pendingNotice.waitFor();
  assert.match(await pendingNotice.innerText(), /Ada pertanyaan baru/);
  const hiderActivity = await pageCreator.request.get(`${baseUrl}/api/rulebooks/rooms/${roomCode}`).then(r => r.json()).then(data => data.activity);
  assert.equal(hiderActivity.prompt.kind, "question");
  assert.doesNotMatch(JSON.stringify(hiderActivity), /referencePoint|privateComputedAnswer|radarRadiusMeters|anchorStationId|foundCode|photoId/);
  assert.equal(await pageG3.locator('[data-activity-message][data-notice-kind="question"]:visible').count(), 0);
  await pageCreator.screenshot({ path: path.join(results, "rulebook-seek-question-notice.png") });
  await pageCreator.reload();
  await pendingNotice.waitFor();
  assert.equal(await pageCreator.locator("[data-activity-announcement]").textContent(), "");
  await refreshSeekRoom(pageCreator);
  await pendingNotice.getByRole("button", { name: "Buka", exact: true }).click();
  await pageCreator.click('button[data-answer="no"]');
  assert.equal(await pageCreator.locator('button[data-action="answer-pending"]').isDisabled(), true);
  assert.equal(await pageCreator.locator('[data-correct="false"]').isVisible(), true);
  await pageCreator.screenshot({ path: path.join(results, "rulebook-seek-private-answer.png") });
  await pageCreator.click('button[data-answer="yes"]');
  assert.equal(await pageCreator.locator('[data-correct="true"]').isVisible(), true);
  await clickAndWaitPost(pageCreator, 'button[data-action="answer-pending"]');
  const dealGrid = pageCreator.locator(".sg-deal");
  await dealGrid.locator(".sg-offer-back").first().waitFor({ state: "attached" });
  assert.equal(await pageCreator.locator('[data-action="confirm-draw"]').isDisabled(), true);
  const answerNotice = pageG2.locator('[data-activity-message][data-notice-kind="answer"]');
  await answerNotice.waitFor();
  const radarResult = pageG2.locator('.sg-map-result[data-game-motion^="update:"]');
  await radarResult.waitFor();
  assert.equal(await canvas.evaluate(element => element.isConnected), true);
  assert.match(await pageG2.locator('[data-activity-announcement][role="status"]').textContent(), /Jawaban sudah masuk/);
  await answerNotice.getByRole("button", { name: "Buka", exact: true }).click();
  await pageG2.getByRole("heading", { name: "Riwayat petunjuk" }).waitFor();
  await refreshSeekRoom(pageG2);
  assert.equal(await answerNotice.isVisible(), false);
  assert.equal(await pageG2.locator('.sg-map-result[data-game-motion]').count(), 0);
  const answerFeed = await pageG2.request.get(`${baseUrl}/api/rulebooks/rooms/${roomCode}`).then(r => r.json()).then(data => data.activity);
  assert.equal(answerFeed.events.filter(event => event.kind === "answer").length, 1);
  assert.doesNotMatch(JSON.stringify(answerFeed), /"overlay"|"answerCode"|"photoId"/);
  await pageG2.locator('button[data-panel="history"]').click();
  await pageCreator.waitForSelector('button[data-action="choose-draw"]');
  await pageCreator.screenshot({ path: path.join(results, "rulebook-seek-reward-draw.png"), animations: "disabled" });
  assert.equal(await pageG2.locator('button[data-action="choose-draw"]').count(), 0);
  // Reload keeps the same offer and deadline without replaying the deal.
  const activeOffer = async () => (await (await pageCreator.request.get(`${baseUrl}/api/rulebooks/rooms/${roomCode}`)).json()).deck.activeDraw;
  const offered = await activeOffer();
  await pageCreator.reload();
  const cardChoice = pageCreator.locator('button[data-action="choose-draw"]').first();
  await cardChoice.waitFor();
  assert.equal(await dealGrid.count(), 0);
  assert.deepEqual(await activeOffer(), offered);
  await cardChoice.press("Enter");
  assert.equal(await cardChoice.getAttribute("aria-pressed"), "true");
  assert.deepEqual(await activeOffer(), offered);
  await clickAndWaitPost(pageCreator, 'button[data-action="confirm-draw"]');
  await pageCreator.waitForFunction(() => document.body.textContent.includes("Tangan Penyembunyi (1/"));

  const snapshot = () => pageG2.request.get(`${baseUrl}/api/rulebooks/rooms/${roomCode}`).then(r => r.json());
  const initialRadar = (await snapshot()).room.questions[0].overlay;
  await refreshSeekRoom(pageG2);
  await pageG2.locator(".sg-map-result").filter({ hasText: "Radar" }).waitFor();
  await pageG2.click('button[data-panel="ask"]');
  await pageG2.click('button[data-family="thermometer"]');
  await pageG2.click('button[data-item="therm-500m"]');
  await clickAndWaitPost(pageG2, 'button[data-action="start-thermometer"]');
  await pageG2.locator('[data-map-point="thermometer-a"]').waitFor();
  assert.equal(await pageG2.locator('button[data-action="ask-clue"]').isDisabled(), true);
  await pageG2.click('button[data-map-point="mrt-blok-m"]');
  await clickAndWaitPost(pageG2, 'button[data-action="mark-thermometer-end"]');
  await pageG2.locator('[data-map-point="thermometer-b"]').waitFor();
  await pageG2.locator("[data-map-ready=true]").waitFor();
  const markerB = await pageG2.locator('[data-map-point="thermometer-b"]').boundingBox();
  const questionPanel = await pageG2.locator(".sg-dock").boundingBox();
  assert.ok(markerB.y + markerB.height < questionPanel.y);
  assert.equal(await canvas.evaluate(element => element.isConnected), true);
  await pageG2.screenshot({ path: path.join(results, "rulebook-seek-thermometer.png") });
  await clickAndWaitPost(pageG2, 'button[data-action="ask-clue"]');
  await refreshSeekRoom(pageCreator);
  await pageCreator.click('button[data-answer="hotter"]');
  await pageCreator.emulateMedia({ reducedMotion: "reduce" });
  await clickAndWaitPost(pageCreator, 'button[data-action="answer-pending"]');
  await cardChoice.waitFor();
  assert.equal(await dealGrid.count(), 0);
  await cardChoice.click();
  await clickAndWaitPost(pageCreator, 'button[data-action="confirm-draw"]');
  const afterThermometer = (await snapshot()).room;
  assert.equal(afterThermometer.questions.at(-1).answerCode, "hotter");
  assert.deepEqual(afterThermometer.questions[0].overlay, initialRadar);
  assert.ok(afterThermometer.candidateStationIds.includes("mrt-blok-m"));

  await refreshSeekRoom(pageG2);
  await pageG2.locator(".sg-map-result").filter({ hasText: "Termometer" }).waitFor();
  await pageG2.click('button[data-panel="ask"]');
  await pageG2.click('button[data-family="photo"]');
  await pageG2.click('button[data-item="photo-station"]');
  await clickAndWaitPost(pageG2, 'button[data-action="ask-clue"]');
  await refreshSeekRoom(pageCreator);
  await pageCreator.waitForFunction(() => !document.querySelector('[aria-busy="true"]'));
  await pageCreator.locator("#sg-clue-photo").setInputFiles({
    name: "test-public-station.png",
    mimeType: "image/png",
    buffer: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAABAAAAAKCAIAAAAy3EnLAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAFUlEQVQYlWNwyIogCTGMasgakqEEAE4woUHUV2UvAAAAAElFTkSuQmCC", "base64"),
  });
  await pageCreator.locator('img[alt="Pratinjau foto petunjuk"]').waitFor();
  await clickAndWaitPost(pageCreator, 'button[data-action="answer-photo"]');
  const photoId = (await snapshot()).room.questions.at(-1).photoId;
  assert.ok(photoId);
  const photoUrl = `${baseUrl}/api/rulebooks/rooms/${roomCode}/photos/${photoId}`;
  assert.equal((await ctxG2.request.get(photoUrl)).headers()["content-type"], "image/jpeg");
  assert.equal((await fetch(photoUrl)).status, 404);

  // Force a live style failure and use the map's fallback to select the same checkpoint.
  await pageG2.route("**/api/map/config", route => route.fulfill({ json: { mode: "geoapify-vector", styleUrl: "/qa-tiles/style.json" } }));
  await pageG2.route("**/qa-tiles/style.json", route => route.abort());
  await pageG2.reload();
  await pageG2.locator('[data-action="retry-map"]').waitFor();
  await pageG2.click('button[data-action="select-station"][data-station="mrt-blok-m"]');
  await clickAndWaitPost(pageG2, 'button[data-action="trigger-endgame"]');
  await pageG2.waitForFunction(() => document.body.textContent.includes("ENDGAME"));
  await refreshSeekRoom(pageCreator);
  const foundCode = (await pageCreator.textContent('[data-testid="hider-found-code"]')).trim();
  assert.match(foundCode, /^\d{4}$/);

  await pageG2.unroute("**/api/map/config");
  await pageG2.unroute("**/qa-tiles/style.json");
  await pageG2.click('button[data-action="retry-map"]');
  await pageG2.locator('[data-map-ready="true"]').waitFor();
  const cameraPin = pageG2.locator('[data-map-point="mrt-senayan"]');
  const pinPosition = () => cameraPin.evaluate(element => {
    const { x, y } = element.getBoundingClientRect();
    return { x, y };
  });
  const cameraBeforeZoom = await pinPosition();
  await pageG2.locator('.maplibregl-ctrl-zoom-in').click();
  const cameraBeforeRegroup = await cameraPin.evaluate((element, beforeZoom) => new Promise((resolve, reject) => {
    let frame;
    let previous = beforeZoom;
    let unchangedSince = performance.now();
    const deadline = setTimeout(() => {
      cancelAnimationFrame(frame);
      reject(new Error("The zoomed map pin did not settle"));
    }, 5000);
    function sample(now) {
      const { x, y } = element.getBoundingClientRect();
      if (x !== previous.x || y !== previous.y) unchangedSince = now;
      if (now - unchangedSince >= 150 && Math.hypot(x - beforeZoom.x, y - beforeZoom.y) > 3) {
        clearTimeout(deadline);
        resolve({ x, y });
        return;
      }
      previous = { x, y };
      frame = requestAnimationFrame(sample);
    }
    frame = requestAnimationFrame(sample);
  }), cameraBeforeZoom);
  await pageG2.fill("#rb-found-input", foundCode);
  await clickAndWaitPost(pageG2, 'button[data-action="submit-found-code"]');
  await pageG2.waitForFunction(() => document.body.textContent.includes("Berkumpul Kembali"));

  for (const page of [pageCreator, pageG3, pageG2]) {
    await refreshSeekRoom(page);
    await clickAndWaitPost(page, 'button[data-action="regroup"]');
  }
  await pageG2.locator('.sg-game[data-role="hider"]').waitFor();
  await pageG2.locator('.sg-role[data-game-motion^="role:"]').waitFor({ timeout: 5000 }).catch(async error => {
    const { activity, room } = await snapshot();
    throw new Error(`Role transition did not play on turn ${room.turnNumber}. Latest activity: ${JSON.stringify(activity.events.slice(-4))}`, { cause: error });
  });
  await pageG2.locator('[data-map-ready="true"]').waitFor();
  const cameraAfterRegroup = await pinPosition();
  assert.ok(Math.hypot(cameraAfterRegroup.x - cameraBeforeRegroup.x, cameraAfterRegroup.y - cameraBeforeRegroup.y) < 3,
    `Regroup changed the camera from ${JSON.stringify(cameraBeforeRegroup)} to ${JSON.stringify(cameraAfterRegroup)}`);
  const next = (await snapshot()).room;
  assert.equal(next.turnStartPoint.id, "mrt-blok-m");
  assert.equal(next.phase, "head_start");
  now = next.releaseAt + 24 * 60 * 60 * 1000;
  await refreshSeekRoom(pageG2);
  await pageG2.getByRole("link", { name: "Buka ringkasan" }).click();
  await pageG2.getByRole("heading", { name: "Giliran sembunyi" }).waitFor();
  assert.match(await pageG2.locator(".recap-shell").innerText(), /Giliran 1 · Ditemukan · 3 pertanyaan dijawab/);
  assert.ok(await pageG2.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await pageG2.screenshot({ path: path.join(results, "rulebook-seek-recap.png") });
  await pageG2.locator('header.mast a.brand[href="/"]').click();
  await pageG2.getByRole("heading", { name: "Pilih permainan", level: 1 }).waitFor();
  assert.equal(await pageG2.getByTestId("resume-room-banner").count(), 0, "Completed Hide & Seek room must not show resume banner");
  for (const [context, page, filename] of [
    [ctxCreator, pageCreator, "rulebook-seek-card-playback.webm"],
    [ctxG2, pageG2, "rulebook-seek-map-playback.webm"],
  ]) {
    const video = page.video();
    await context.close();
    if (video) {
      await video.saveAs(path.join(results, filename));
      await video.delete();
    }
  }
  console.log("qa:rulebook-seek passed (Studio, paid room, clue privacy, Thermometer, photos, map fallback, and role swap)");
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
