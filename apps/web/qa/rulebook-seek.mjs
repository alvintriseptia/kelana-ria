import assert from "node:assert/strict";
import path from "node:path";
import { mkdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { createRecordedMidtransAdapter, createSoloServer } from "../../api/dist/index.js";
import { catalogUrl, openEdition } from "./catalog.mjs";
import { assertCleanUiCopy } from "./copy-guard.mjs";
import { buildCorruptPhotoFile, buildLargeTestPhotoFile } from "./photo-fixtures.mjs";
import { buyPublishedDraft, moderateAdminPack, openAdminPanel, openDraft, signInQaContext, startDraft } from "./studio-navigation.mjs";

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
  allowSandboxAuthOtp: true,
  adminEmails: ["seek-creator@kelana.test"],
});

await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const baseUrl = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({
  channel: "chromium",
  executablePath: process.env.CHROMIUM_PATH || undefined,
    args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
});

try {
  // 0. Quick check: launching Hide & Seek from /catalog opens Official Jakarta Compact Hide & Seek room + invite link
  const ctxRoot = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const pageRoot = await ctxRoot.newPage();
  await pageRoot.goto(catalogUrl(baseUrl), { waitUntil: "networkidle" });
  await openEdition(pageRoot, "hide-and-seek");
  await pageRoot.getByRole("button", { name: "Main Grup", exact: true }).click();
  await pageRoot.waitForFunction(() => document.body.textContent.includes("Ruang Tunggu"));
  const rootInvite = await pageRoot.getAttribute('[data-testid="invite-link"]', "href");
  assert.ok(rootInvite && rootInvite.includes("room=RB-"), "Catalog launch should create Hide & Seek room with invite link");
  await ctxRoot.close();

  // 1. Creator opens Studio from /catalog, selects Hide & Seek, clones Official pack, exercises 4-step stepper + JSON export/import + revision note + publish
  const ctxCreator = await browser.newContext({ viewport: { width: 390, height: 844 }, recordVideo });
  await signInQaContext(ctxCreator, baseUrl, "seek-creator@kelana.test", "Kreator Seek");
  const pageCreator = await ctxCreator.newPage();
  pageCreator.setDefaultTimeout(20_000);
  await pageCreator.goto(catalogUrl(baseUrl), { waitUntil: "networkidle" });
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

  // Step 4: submit, request a revision in Panel Admin, then resubmit and publish
  await pageCreator.click('button[data-step="4"]');
  await pageCreator.click('button[data-action="dry-run"]');
  await pageCreator.waitForFunction(() => document.body.textContent.includes("Uji coba lolos"));
  await pageCreator.click('button[data-action="submit-draft"]');
  await pageCreator.waitForFunction(() => document.body.textContent.includes("diajukan ke peninjau"));

  await openAdminPanel(pageCreator);
  const revisionNote = "Perjelas catatan akses stasiun.";
  await moderateAdminPack(pageCreator, "pack-senopati-seek", "Minta Revisi", revisionNote);
  await pageCreator.waitForFunction(() => document.body.textContent.includes("Permintaan revisi dikirim"));

  await openDraft(pageCreator, "pack-senopati-seek");
  await pageCreator.getByTestId("revision-note-banner").getByText(revisionNote, { exact: true }).waitFor();

  // Verify JSON export + malformed JSON guard + valid JSON import round-trip via quiet header overflow menu
  await pageCreator.click('[data-testid="studio-more-menu"] summary');
  const [download] = await Promise.all([
    pageCreator.waitForEvent("download"),
    pageCreator.click('button[data-action="export-json"]'),
  ]);
  const exportedJson = await readFile(await download.path(), "utf8");
  assert.ok(exportedJson.includes("pack-senopati-seek"), "Exported JSON should contain active pack");
  await pageCreator.click('button[data-studio-view="home"]');
  await startDraft(pageCreator, "hide-and-seek");
  await pageCreator.click('[data-testid="studio-more-menu"] summary');
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
  await openAdminPanel(pageCreator);
  await moderateAdminPack(pageCreator, "pack-senopati-seek", "Terbitkan ke Katalog");
  await pageCreator.waitForFunction(() => document.body.textContent.includes("Paket diterbitkan ke katalog"));

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
  await assertCleanUiCopy(pageCreator, "seek paid lobby");

  const codeMatch = (await pageCreator.textContent("body")).match(/Kode:\s*(RB-[A-F0-9]+)/);
  assert.ok(codeMatch, "Paid room code should be displayed after Midtrans settlement");
  const roomCode = codeMatch[1];

  // 2. Two guests join the paid room in isolated browser contexts (3 players total under 1 pass!)
  const ctxG2 = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: "block", recordVideo });
  const pageG2 = await ctxG2.newPage();
  pageG2.setDefaultTimeout(20_000);
  await pageG2.goto(`${baseUrl}/?play=rulebook-seek`, { waitUntil: "networkidle" });
  await assertCleanUiCopy(pageG2, "seek catalog");
  await pageG2.fill("#rb-join-code", roomCode);
  await pageG2.fill("#rb-join-name", "Pencari 1");
  await pageG2.click('button[data-action="join-room"]');
  await pageG2.waitForFunction(() => document.body.textContent.includes("Ruang Tunggu"));

  // #150: Invited guest in Seek lobby sees first-match cue strip, Outdoor Readiness check, and ? Panduan without leaving room
  const seekLobbyCue = pageG2.locator('[data-testid="phase-cue-strip"][data-cue-key="seek-lobby"]');
  await seekLobbyCue.waitFor();
  assert.match(await seekLobbyCue.innerText(), /Check-in di Titik Awal/);
  await pageG2.getByTestId("lobby-readiness-strip").waitFor();
  await pageG2.getByTestId("lobby-quick-guide-btn").click();
  const seekLobbyGuide = pageG2.getByTestId("quick-guide-modal");
  await seekLobbyGuide.waitFor();
  assert.equal(await seekLobbyGuide.getAttribute("role"), "dialog");
  assert.equal(await seekLobbyGuide.getAttribute("aria-modal"), "true");
  assert.ok(await pageG2.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "Zero overflow on Seek lobby Quick Guide (390x844)");
  await pageG2.setViewportSize({ width: 320, height: 640 });
  assert.ok(await pageG2.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "Zero overflow on Seek lobby Quick Guide (320x640)");
  await pageG2.setViewportSize({ width: 390, height: 844 });
  await pageG2.keyboard.press("Escape");
  await seekLobbyGuide.waitFor({ state: "hidden" });
  await seekLobbyCue.getByTestId("phase-cue-dismiss").click();
  assert.equal(await seekLobbyCue.count(), 0);
  await pageG2.reload({ waitUntil: "networkidle" });
  await pageG2.waitForFunction(() => document.body.textContent.includes("Ruang Tunggu"));
  assert.equal(await seekLobbyCue.count(), 0, "Dismissed Seek lobby cue must persist across reload");

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
  // #150: Distinct Hider vs Seeker head_start cues
  const hiderHeadCue = pageCreator.locator('[data-testid="phase-cue-strip"][data-cue-key="seek-head-start-hider"]');
  await hiderHeadCue.waitFor();
  assert.match(await hiderHeadCue.innerText(), /Kamu Penyembunyi/);
  await refreshSeekRoom(pageG2);
  const seekerHeadCue = pageG2.locator('[data-testid="phase-cue-strip"][data-cue-key="seek-head-start-seeker"]');
  await seekerHeadCue.waitFor();
  assert.match(await seekerHeadCue.innerText(), /Kamu Pencari/);
  await assertCleanUiCopy(pageCreator, "seek head start hider");
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
  // #150: Distinct Seeker vs Hider seeking phase cues + in-game ? Panduan from room menu
  const seekerSeekCue = pageG2.locator('[data-testid="phase-cue-strip"][data-cue-key="seek-seeking-seeker"]');
  await seekerSeekCue.waitFor();
  assert.match(await seekerSeekCue.innerText(), /Ajukan petunjuk dari menu Tanya/);
  await pageG2.locator(".sg-room-menu summary").click();
  await pageG2.getByTestId("menu-quick-guide-btn").click();
  const seekerGuide = pageG2.getByTestId("quick-guide-modal");
  await seekerGuide.waitFor();
  assert.match(await seekerGuide.innerText(), /Pencari/);
  await pageG2.keyboard.press("Escape");
  await seekerGuide.waitFor({ state: "hidden" });
  await refreshSeekRoom(pageCreator);
  const hiderSeekCue = pageCreator.locator('[data-testid="phase-cue-strip"][data-cue-key="seek-seeking-hider"]');
  await hiderSeekCue.waitFor();
  assert.match(await hiderSeekCue.innerText(), /Jawab pertanyaan pencari/);
  await assertCleanUiCopy(pageG2, "seek seeking phase seeker");
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
  // #184: Custom Radar radius input keeps focus, value, and persistent MapLibre canvas across clock ticks + live SSE updates
  const customRadiusBtn = pageG2.locator('button[data-action="question-option"]', { hasText: "Radius sendiri" });
  if ((await customRadiusBtn.count()) > 0) {
    await customRadiusBtn.click();
    const radiusInput = pageG2.locator("#sg-radius");
    await radiusInput.waitFor();
    await radiusInput.focus();
    await radiusInput.fill("650");
    const spCoord = (await pageG2.request.get(`${baseUrl}/api/rulebooks/rooms/${roomCode}`).then(r => r.json())).publicBoard.startPoint;
    await ctxG3.request.post(`${baseUrl}/api/rulebooks`, {
      data: {
        type: "room-action",
        roomCode,
        action: { type: "seeker-check-in", actionId: "qa-sse-radius-tick", offTransit: false, fix: { latitude: spCoord.latitude, longitude: spCoord.longitude, accuracy: 10, timestamp: now } },
      },
    });
    await pageG2.waitForTimeout(1150);
    assert.equal(await pageG2.evaluate(() => document.activeElement?.id), "sg-radius", "#sg-radius must retain focus across SSE updates and clock ticks");
    assert.equal(await radiusInput.inputValue(), "650", "#sg-radius must retain typed value across SSE updates and clock ticks");
    assert.equal(await pageG2.locator(".sg-board .maplibregl-canvas").count(), 1, "MapLibre canvas count must stay 1");
    assert.equal(await canvas.evaluate(element => element.isConnected), true, "MapLibre canvas must remain mounted across SSE updates");
  }
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
  const hiderCanvas = await pageCreator.locator(".sg-board .maplibregl-canvas").elementHandle();
  const askSentAt = Date.now();
  await clickAndWaitPost(pageG2, 'button[data-action="ask-clue"]');
  await drawnPreview.waitFor({ state: "detached" });
  const seekerAfter = await pageG2.request.get(`${baseUrl}/api/rulebooks/rooms/${roomCode}`).then(r => r.json());
  assert.deepEqual(seekerAfter.room.questions[0].referencePoint, draft.reference);
  assert.equal(seekerAfter.room.questions[0].radarRadiusMeters, draft.radiusMeters);
  assert.equal(seekerAfter.activity.events.some(event => event.kind === "question"), false);
  const pendingNotice = pageCreator.locator('[data-activity-message][data-notice-kind="question"]');
  await pendingNotice.waitFor({ timeout: 1500 });
  assert.ok(Date.now() - askSentAt < 1500, "Hider must receive incoming Radar clue via SSE before a 3-second poll cycle");
  assert.equal(await hiderCanvas.evaluate(element => element.isConnected), true, "SSE push must keep Hider MapLibre canvas mounted");
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
  const answerSentAt = Date.now();
  const dealGrid = pageCreator.locator(".sg-deal");
  await dealGrid.locator('.sg-offer[data-game-motion^="draw:"]').first().waitFor({ state: "attached" });
  const drawMotion = await dealGrid.locator(".sg-offer").evaluateAll(elements =>
    elements.map(element => element.getAttribute("data-game-motion")));
  assert.ok(drawMotion.length > 0 && drawMotion.every(sequence => sequence === drawMotion[0]));
  assert.equal(await pageCreator.locator('[data-action="confirm-draw"]').isDisabled(), true);
  const answerNotice = pageG2.locator('[data-activity-message][data-notice-kind="answer"]');
  await answerNotice.waitFor({ timeout: 2200 });
  assert.ok(Date.now() - answerSentAt < 2400, "Seeker must receive Hider answer via SSE before a 3-second poll cycle");
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
  await assertCleanUiCopy(pageCreator, "seek reward card draw offer");
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
  // #184: Draw keep selection survives live SSE updates + clock ticks without re-dealing, and seeker DOM leaks zero private card IDs
  const spDraw = (await pageCreator.request.get(`${baseUrl}/api/rulebooks/rooms/${roomCode}`).then(r => r.json())).publicBoard.startPoint;
  await ctxG3.request.post(`${baseUrl}/api/rulebooks`, {
    data: {
      type: "room-action",
      roomCode,
      action: { type: "seeker-check-in", actionId: "qa-sse-draw-tick", offTransit: false, fix: { latitude: spDraw.latitude, longitude: spDraw.longitude, accuracy: 10, timestamp: now } },
    },
  });
  await pageCreator.waitForTimeout(1150);
  assert.equal(await cardChoice.getAttribute("aria-pressed"), "true", "Active draw selection must survive SSE update and clock tick");
  assert.equal(await dealGrid.count(), 0, "SSE update must not replay draw deal animation");
  assert.equal(await pageCreator.locator(".sg-board .maplibregl-canvas").count(), 1);
  const seekerHtml = await pageG2.content();
  for (const card of offered.cards) {
    assert.equal(seekerHtml.includes(card.instanceId), false, `Seeker DOM must never contain private hider card ${card.instanceId}`);
  }
  assert.deepEqual(await activeOffer(), offered);
  await clickAndWaitPost(pageCreator, 'button[data-action="confirm-draw"]');
  await pageCreator.locator('.sg-card-flight[aria-hidden="true"]').first().waitFor({ state: "attached" });
  await pageCreator.waitForFunction(() => document.body.textContent.includes("Kartu di Tangan (1/"));
  assert.equal(await pageG2.locator(".sg-card-flight").count(), 0);
  await assertCleanUiCopy(pageCreator, "seek hider hand");

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
  // Abort SSE /events on Hider to verify automatic 3-second polling fallback delivers incoming Thermometer clue without manual refresh
  await pageCreator.route(`**/api/rulebooks/rooms/${roomCode}/events`, route => route.abort());
  await pageCreator.reload();
  await pageCreator.locator(".sg-board").waitFor();
  await clickAndWaitPost(pageG2, 'button[data-action="ask-clue"]');
  await pageCreator.locator('[data-activity-message][data-notice-kind="question"]').waitFor({ timeout: 8000 });
  await pageCreator.unroute(`**/api/rulebooks/rooms/${roomCode}/events`);
  await pageCreator.click('button[data-answer="hotter"]');
  await pageCreator.emulateMedia({ reducedMotion: "reduce" });
  await clickAndWaitPost(pageCreator, 'button[data-action="answer-pending"]');
  await cardChoice.waitFor();
  assert.equal(await dealGrid.count(), 0);
  assert.equal(await pageCreator.locator(".sg-offer[data-game-motion], .sg-card-flight").count(), 0);
  await pageCreator.setViewportSize({ width: 320, height: 640 });
  assert.ok(await pageCreator.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await pageCreator.screenshot({ path: path.join(results, "rulebook-seek-reduced-motion-320.png") });
  await pageCreator.setViewportSize({ width: 390, height: 844 });
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
  const seekPhotoInput = pageCreator.locator("#sg-clue-photo");
  assert.equal(await seekPhotoInput.getAttribute("capture"), "environment", "Seek photo input must default to rear camera");
  assert.equal(await seekPhotoInput.getAttribute("accept"), "image/*");
  const seekCaptureBox = await pageCreator.getByTestId("photo-capture-btn").boundingBox();
  assert.ok(seekCaptureBox && seekCaptureBox.height >= 44, "Seek Ambil Foto button must meet 44px touch target");

  // Corrupt non-image file rejected cleanly without enabling submit
  await seekPhotoInput.setInputFiles(buildCorruptPhotoFile());
  await pageCreator.getByRole("alert").filter({ hasText: /foto|format|JPEG/i }).waitFor();
  assert.equal(await pageCreator.locator('button[data-action="answer-photo"]').isDisabled(), true);

  // Large > 2 MB (4.1 MB, 1600x640) image is automatically downscaled to <= 1280px JPEG < 2 MB client-side
  const largeSeekPhoto = buildLargeTestPhotoFile(1600, 640);
  assert.ok(largeSeekPhoto.buffer.byteLength > 2 * 1024 * 1024);
  await seekPhotoInput.setInputFiles(largeSeekPhoto);
  await pageCreator.locator('img[alt="Pratinjau foto petunjuk"]').waitFor();
  const seekPreviewWidth = await pageCreator.getByTestId("photo-preview-img").evaluate((img) => img.naturalWidth);
  assert.equal(seekPreviewWidth, 1280, "Seek photo must downscale 1600px image to 1280px");
  assert.match(await pageCreator.getByTestId("photo-size-badge").innerText(), /Siap unggah · \d+ KB/);
  await pageCreator.getByTestId("photo-retake-btn").waitFor();
  assert.ok(await pageCreator.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "Zero overflow on Seek photo preview (390x844)");

  // Hapus clears preview and disables Kirim foto; re-attaching large photo uploads cleanly
  await pageCreator.getByTestId("photo-clear-btn").click();
  assert.equal(await pageCreator.getByTestId("photo-preview-img").count(), 0);
  assert.equal(await pageCreator.locator('button[data-action="answer-photo"]').isDisabled(), true);
  await pageCreator.locator("#sg-clue-photo").setInputFiles(largeSeekPhoto);
  await pageCreator.locator('img[alt="Pratinjau foto petunjuk"]').waitFor();
  await clickAndWaitPost(pageCreator, 'button[data-action="answer-photo"]');
  const photoId = (await snapshot()).room.questions.at(-1).photoId;
  assert.ok(photoId);
  const photoUrl = `${baseUrl}/api/rulebooks/rooms/${roomCode}/photos/${photoId}`;
  const uploadedSeekPhoto = await ctxG2.request.get(photoUrl);
  assert.equal(uploadedSeekPhoto.headers()["content-type"], "image/jpeg");
  assert.ok((await uploadedSeekPhoto.body()).byteLength < 2 * 1024 * 1024, "Uploaded Seek JPEG must be well under 2 MB");
  assert.equal((await fetch(photoUrl)).status, 404);

  // Force a live style failure and use the map's fallback to select the same checkpoint.
  await pageG2.route("**/api/map/config", route => route.fulfill({ json: { mode: "geoapify-vector", styleUrl: "/qa-tiles/style.json" } }));
  await pageG2.route("**/qa-tiles/style.json", route => route.abort());
  await pageG2.reload();
  await pageG2.locator('[data-action="retry-map"]').waitFor();
  await pageG2.click('button[data-action="select-station"][data-station="mrt-blok-m"]');
  await clickAndWaitPost(pageG2, 'button[data-action="trigger-endgame"]');
  await pageG2.waitForFunction(() => document.body.textContent.includes("Endgame"));
  await pageG2.locator('.sg-role[data-game-motion^="role:"]').waitFor();
  const endgameBanner = pageG2.getByTestId("game-fx-overlay").locator('[data-fx-kind="banner"]');
  await endgameBanner.filter({ hasText: "Pencarian Tahap Akhir" }).waitFor({ state: "attached" });
  assert.equal(await endgameBanner.evaluate(element => getComputedStyle(element).pointerEvents), "none");
  await assertCleanUiCopy(pageG2, "seek endgame");
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
  // #144: Non-host paid guest sees Gabung Ruang Baru + Lihat Paket Ini + Buka ringkasan (NO Main Lagi)
  assert.equal(await pageG2.getByTestId("postmatch-play-again").count(), 0, "Non-host paid Seek guest must not see Main Lagi");
  await pageG2.getByTestId("postmatch-join-new-room").waitFor();
  assert.equal(await pageG2.getByTestId("postmatch-view-pack").getAttribute("href"), "/catalog?edition=pack-senopati-seek&version=1");
  assert.ok(await pageG2.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "Zero overflow on Seek finished screen for paid guest (390x844)");

  // Paid Host refreshes finished room -> sees Main Lagi + Buka ringkasan + Kembali ke Katalog -> taps Main Lagi -> brand-new paid Seek lobby!
  await refreshSeekRoom(pageCreator);
  const seekPlayAgainBtn = pageCreator.getByTestId("postmatch-play-again");
  await seekPlayAgainBtn.waitFor();
  const seekPlayAgainBox = await seekPlayAgainBtn.boundingBox();
  assert.ok(seekPlayAgainBox && seekPlayAgainBox.height >= 44, "Seek Main Lagi button must meet 44px touch target");
  await pageCreator.getByTestId("postmatch-back-catalog").waitFor();
  assert.ok(await pageCreator.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "Zero overflow on Seek finished screen for Host (390x844)");
  await seekPlayAgainBtn.click();
  await pageCreator.waitForFunction((oldCode) => {
    const code = new URL(location.href).searchParams.get("room");
    return Boolean(code && code !== oldCode && document.body.textContent.includes("Ruang Tunggu"));
  }, roomCode);
  const seekReplayCode = new URL(pageCreator.url()).searchParams.get("room");
  const seekReplayMeta = await (await ctxCreator.request.get(`${baseUrl}/api/rulebooks/rooms/${seekReplayCode}`)).json();
  assert.equal(seekReplayMeta.pass.packId, "pack-senopati-seek");
  assert.equal(seekReplayMeta.pass.version, 1);

  // Non-host paid guest on 320x640 taps Gabung Ruang Baru -> enters Host's new room code -> joins new lobby cleanly
  await pageG3.setViewportSize({ width: 320, height: 640 });
  await refreshSeekRoom(pageG3);
  assert.equal(await pageG3.getByTestId("postmatch-play-again").count(), 0);
  assert.ok(await pageG3.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "Zero overflow on Seek finished screen for paid guest (320x640)");
  await pageG3.getByTestId("postmatch-join-new-room").click();
  await pageG3.getByTestId("join-room-modal").waitFor();
  assert.ok(await pageG3.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "Zero overflow on Seek Gabung Ruang Baru modal (320x640)");
  await pageG3.fill("#cat-join-code", seekReplayCode);
  await pageG3.getByTestId("join-modal-submit").click();
  await pageG3.waitForFunction((targetCode) => {
    return new URL(location.href).searchParams.get("room") === targetCode && document.body.textContent.includes("Ruang Tunggu");
  }, seekReplayCode);
  await ctxG3.close();

  await pageG2.getByRole("link", { name: "Buka ringkasan" }).click();
  await pageG2.getByRole("heading", { name: "Giliran sembunyi" }).waitFor();
  assert.match(await pageG2.locator(".recap-shell").innerText(), /Giliran 1 · Ditemukan · 3 pertanyaan dijawab/);
  await assertCleanUiCopy(pageG2, "seek recap");
  assert.ok(await pageG2.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await pageG2.screenshot({ path: path.join(results, "rulebook-seek-recap.png") });
  await pageG2.locator('header.mast a.brand[href="/"]').click();
  await pageG2.getByRole("heading", { name: "Ubah Jakarta jadi papan permainan nyata", level: 1 }).waitFor();
  assert.equal(await pageG2.getByTestId("resume-room-banner").count(), 0, "Completed Hide & Seek room must not show resume banner on landing");
  await pageG2.getByTestId("landing-choose-game").click();
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
  // #142: Hide & Seek Home Gabung Ruang modal, offline SVG QR, Host start gate, turn-order reorder/shuffle, and Host cancel SSE
  const sHostCtx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const sGuestCtx = await browser.newContext({ viewport: { width: 320, height: 640 } });
  const sHost = await sHostCtx.newPage();
  const sGuest = await sGuestCtx.newPage();
  try {
    await sHost.goto(catalogUrl(baseUrl), { waitUntil: "networkidle" });
    await sHost.locator('.cat-card[data-pack-id="official-jakarta-compact-seek"]').click();
    await sHost.getByRole("button", { name: "Main Grup", exact: true }).click();
    await sHost.getByTestId("lobby-invite-card").waitFor();
    const sCode = (await sHost.getByTestId("lobby-room-code").innerText()).trim();
    assert.match(sCode, /^RB-/);
    assert.equal(await sHost.locator('button[data-action="start-match"]').isDisabled(), true, "Seek Host Start must be disabled with 1 player");

    // Offline QR modal with zero network requests
    let qrReqs = 0;
    const countReq = () => { qrReqs++; };
    sHost.on("request", countReq);
    await sHost.getByTestId("show-qr-btn").click();
    await sHost.getByTestId("qr-modal").locator("svg.lobby-qr-svg path").waitFor();
    assert.equal(qrReqs, 0, "Seek QR modal must make zero network requests");
    sHost.off("request", countReq);
    await sHost.keyboard.press("Escape");
    await sHost.getByTestId("qr-modal").waitFor({ state: "hidden" });

    // Guest joins Hide & Seek from Catalog Gabung Ruang modal on 320x640
    await sGuest.goto(catalogUrl(baseUrl), { waitUntil: "networkidle" });
    await sGuest.getByTestId("home-join-room-btn").click();
    await sGuest.fill("#cat-join-code", sCode.toLowerCase());
    await sGuest.fill("#cat-join-name", "Raka");
    await sGuest.getByTestId("join-modal-submit").click();
    await sGuest.getByTestId("seek-turn-list").waitFor();
    assert.equal(await sGuest.locator('button[data-action="start-match"]').count(), 0, "Non-host guest must not see Mulai Permainan in Seek lobby");
    await sGuest.getByTestId("seek-wait-host").waitFor();
    assert.ok(await sGuest.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "Zero overflow on Seek lobby (320x640)");

    // Host reorders and shuffles hider turn order
    await sHost.waitForFunction(() => document.body.textContent.includes("Kursi Pemain (2/4)"));
    const orderBefore = await sHost.locator('[data-testid="seek-turn-list"] > li').evaluateAll((els) => els.map((e) => e.getAttribute("data-seat-row")));
    assert.deepEqual(orderBefore, ["seat-1", "seat-2"]);
    await sHost.getByTestId("shuffle-turns-btn").click();
    await sHost.waitForFunction(() => document.querySelector('[data-testid="seek-turn-list"] > li')?.getAttribute("data-seat-row") === "seat-2");
    await sHost.locator('button[data-action="move-turn"][data-seat="seat-1"][data-dir="-1"]').click();
    await sHost.waitForFunction(() => document.querySelector('[data-testid="seek-turn-list"] > li')?.getAttribute("data-seat-row") === "seat-1");

    // Host cancels room -> Guest sees canceled-room-card live via SSE
    await sHost.getByTestId("lobby-leave-btn").click();
    await sHost.getByTestId("confirm-dialog-submit").click();
    await sHost.getByRole("heading", { name: "Pilih permainan", level: 1 }).waitFor();
    await sGuest.getByTestId("canceled-room-card").waitFor({ timeout: 5000 });
    assert.match(await sGuest.getByTestId("canceled-room-card").innerText(), /Host membatalkan ruang ini/);
  } finally {
    await sHostCtx.close();
    await sGuestCtx.close();
  }

  // #143: Hide & Seek strictly-local self-location dot (zero server transmission), distance meters, target ring, Google Maps links on Lobby/Station/Regroup (390x844 & 320x640)
  const locHiderCtx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const locSeekerCtx = await browser.newContext({ viewport: { width: 320, height: 640 } });
  const locHider = await locHiderCtx.newPage();
  const locSeeker = await locSeekerCtx.newPage();
  try {
    await locHider.addInitScript(() => {
      let cb = null;
      window.__pushSeekFix = (latitude, longitude, accuracy = 12) => {
        if (cb) cb({ coords: { latitude, longitude, accuracy }, timestamp: Date.now() });
      };
      Object.defineProperty(navigator, "permissions", {
        configurable: true,
        value: { query: async () => ({ state: "granted", addEventListener() {} }) },
      });
      Object.defineProperty(navigator, "geolocation", {
        configurable: true,
        value: {
          watchPosition(success) {
            cb = success;
            return 99;
          },
          clearWatch() {
            cb = null;
          },
          getCurrentPosition(success) {
            success({ coords: { latitude: -6.2442, longitude: 106.7991, accuracy: 12 }, timestamp: Date.now() });
          },
        },
      });
    });

    const createdSeek = await locHiderCtx.request.post(`${baseUrl}/api/rulebooks`, {
      data: { type: "create-free-room", packId: "official-jakarta-compact-seek", version: 2, hostName: "Sembunyi" },
    });
    const locCode = (await createdSeek.json()).roomCode;
    await locSeekerCtx.request.post(`${baseUrl}/api/rulebooks`, {
      data: { type: "join-room", roomCode: locCode, name: "Pencari" },
    });
    const seekMeta = await (await locHiderCtx.request.get(`${baseUrl}/api/rulebooks/rooms/${locCode}`)).json();
    const sp = seekMeta.publicBoard.startPoint;
    const st0 = seekMeta.publicBoard.stations[0];
    const checkRadius = seekMeta.publicBoard.checkInRadiusMeters;
    assert.ok(checkRadius > 0 && seekMeta.publicBoard.maxGpsAccuracyMeters > 0, "Seek publicBoard must expose GPS thresholds");

    await locHider.goto(`${baseUrl}/?play=rulebook-seek&room=${locCode}`, { waitUntil: "networkidle" });
    await locHider.getByTestId("lobby-start-card").waitFor();
    const lobbyDir = await locHider.getByTestId("lobby-directions-link").getAttribute("href");
    assert.ok(lobbyDir?.startsWith("https://www.google.com/maps/dir/?api=1&destination="), `Seek lobby directions invalid: ${lobbyDir}`);

    // Expand lobby Titik Awal mini-map and push live fix -> zero server POST calls!
    let leakedPostRequests = 0;
    const watchPrivacy = (req) => {
      if (req.method() === "POST" && req.url().includes("/api/")) leakedPostRequests++;
    };
    locHider.on("request", watchPrivacy);

    await locHider.getByTestId("lobby-start-map-toggle").click();
    await locHider.locator("#sg-start-minimap .maplibregl-canvas").waitFor();
    await locHider.evaluate(({ lat, lng }) => window.__pushSeekFix(lat + 0.0025, lng, 12), { lat: sp.latitude, lng: sp.longitude });
    await locHider.getByTestId("lobby-distance-meter").waitFor();
    assert.equal(await locHider.getByTestId("lobby-distance-meter").getAttribute("data-proximity-state"), "out-of-range");
    await locHider.locator('#sg-start-minimap [data-testid="map-self-dot"]').waitFor();
    await locHider.evaluate(({ lat, lng }) => window.__pushSeekFix(lat, lng, 10), { lat: sp.latitude, lng: sp.longitude });
    await locHider.waitForFunction(() => document.querySelector('[data-testid="lobby-distance-meter"]')?.getAttribute("data-proximity-state") === "ready");
    assert.equal(leakedPostRequests, 0, "Hide & Seek lobby watchPosition updates must NEVER transmit fixes to the server");

    // Start match via API -> active board shows self dot + station distance meter + Google Maps directions without transmitting fixes
    locHider.off("request", watchPrivacy);
    for (const [idx, ctx] of [locHiderCtx, locSeekerCtx].entries()) {
      await ctx.request.post(`${baseUrl}/api/rulebooks`, {
        data: { type: "room-action", roomCode: locCode, action: { type: "check-in-start", actionId: `sl-ci-${idx}`, fix: { latitude: sp.latitude, longitude: sp.longitude, accuracy: 10, timestamp: seekMeta.room.now } } },
      });
      await ctx.request.post(`${baseUrl}/api/rulebooks`, {
        data: { type: "room-action", roomCode: locCode, action: { type: "ready", actionId: `sl-rdy-${idx}`, ready: true } },
      });
    }
    await locHiderCtx.request.post(`${baseUrl}/api/rulebooks`, {
      data: { type: "room-action", roomCode: locCode, action: { type: "start", actionId: "sl-start" } },
    });
    await locHider.locator("#sg-map .maplibregl-canvas").waitFor();
    await locHider.locator('#sg-map [data-testid="map-self-dot"]').waitFor();
    await locHider.locator('#sg-map [data-testid="map-recenter-btn"]').waitFor();
    await locHider.evaluate(() => {
      window.__seekCanvas = document.querySelector("#sg-map .maplibregl-canvas");
      window.__seekSelfDot = document.querySelector('#sg-map [data-testid="map-self-dot"]');
    });

    locHider.on("request", watchPrivacy);
    await locHider.evaluate(({ lat, lng }) => window.__pushSeekFix(lat + 0.002, lng, 12), { lat: st0.latitude, lng: st0.longitude });
    await locHider.evaluate(({ lat, lng }) => window.__pushSeekFix(lat, lng, 10), { lat: st0.latitude, lng: st0.longitude });
    await locHider.waitForTimeout(400);
    assert.equal(leakedPostRequests, 0, "Hide & Seek active watchPosition updates must NEVER send any POST request to the server");
    locHider.off("request", watchPrivacy);

    const stDir = await locHider.getByTestId("seek-station-directions-link").getAttribute("href");
    assert.ok(stDir?.startsWith("https://www.google.com/maps/dir/?api=1&destination="), `Seek station directions invalid: ${stDir}`);
    assert.equal(
      await locHider.evaluate(() =>
        document.querySelector("#sg-map .maplibregl-canvas") === window.__seekCanvas &&
        document.querySelector('#sg-map [data-testid="map-self-dot"]') === window.__seekSelfDot,
      ),
      true,
      "Seek MapLibre canvas and self-location dot must update in-place without recreation",
    );
    assert.ok(await locHider.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "Zero overflow on Seek active board (390x844)");

    // Advance to regroup phase via API and verify Regroup card Google Maps directions + distance meter + 320x640 overflow
    const hsView = await (await locHiderCtx.request.get(`${baseUrl}/api/rulebooks/rooms/${locCode}`)).json();
    await locHiderCtx.request.post(`${baseUrl}/api/rulebooks`, {
      data: { type: "room-action", roomCode: locCode, action: { type: "lock-anchor", actionId: "sl-lock", stationId: st0.id, fix: { latitude: st0.latitude, longitude: st0.longitude, accuracy: 10, timestamp: hsView.room.now } } },
    });
    now = hsView.room.releaseAt + 1_000;
    const seekView = await (await locSeekerCtx.request.get(`${baseUrl}/api/rulebooks/rooms/${locCode}`)).json();
    await locSeekerCtx.request.post(`${baseUrl}/api/rulebooks`, {
      data: { type: "room-action", roomCode: locCode, action: { type: "seeker-check-in", actionId: "sl-endgame", fix: { latitude: st0.latitude, longitude: st0.longitude, accuracy: 10, timestamp: seekView.room.now }, offTransit: true } },
    });
    const endHider = await (await locHiderCtx.request.get(`${baseUrl}/api/rulebooks/rooms/${locCode}`)).json();
    await locSeekerCtx.request.post(`${baseUrl}/api/rulebooks`, {
      data: { type: "room-action", roomCode: locCode, action: { type: "submit-found-code", actionId: "sl-found", code: endHider.room.foundCode } },
    });
    await locSeeker.goto(`${baseUrl}/?play=rulebook-seek&room=${locCode}`, { waitUntil: "networkidle" });
    await locSeeker.getByTestId("seek-regroup-card").waitFor();
    const regroupDir = await locSeeker.getByTestId("regroup-directions-link").getAttribute("href");
    assert.ok(regroupDir?.startsWith("https://www.google.com/maps/dir/?api=1&destination="), `Seek regroup directions invalid: ${regroupDir}`);
    assert.ok(await locSeeker.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "Zero overflow on Seek regroup card (320x640)");
  } finally {
    await locHiderCtx.close();
    await locSeekerCtx.close();
  }

  console.log("qa:rulebook-seek passed (Studio, paid room, clue privacy, Thermometer, photos, map fallback, role swap, Lobby QR/TurnOrder/Leave, and Self-Location/Privacy/Directions)");
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
