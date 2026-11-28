import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { createRecordedMidtransAdapter, createSoloServer } from "../../api/dist/index.js";
import { catalogUrl, openEdition } from "./catalog.mjs";
import { assertCleanUiCopy } from "./copy-guard.mjs";
import { buildCorruptPhotoFile, buildLargeTestPhotoFile } from "./photo-fixtures.mjs";
import { moderateAdminPack, openAdminPanel, signInQaContext, startDraft } from "./studio-navigation.mjs";

const root = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const distDir = path.join(root, "dist");
const results = path.join(root, "qa-results");
mkdirSync(results, { recursive: true });
const recordVideo = !process.env.CHROMIUM_PATH || process.env.RECORD_GAME_MOTION
  ? { dir: path.join(results, ".claim-recordings"), size: { width: 390, height: 844 } }
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
  adminEmails: ["claim-creator@kelana.test"],
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
  // 1. Solo Official Jakarta Compact Claim launched from /catalog
  const ctxSolo = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: "block" });
  const pageSolo = await ctxSolo.newPage();
  await pageSolo.goto(catalogUrl(baseUrl), { waitUntil: "networkidle" });
  await openEdition(pageSolo, "claim-the-city");
  await pageSolo.getByRole("button", { name: "Main Solo", exact: true }).click();
  await pageSolo.waitForFunction(() => document.body.textContent.includes("Ruang Tunggu"));
  await assertCleanUiCopy(pageSolo, "claim solo lobby");

  const soloRoomCode = new URL(pageSolo.url()).searchParams.get("room");
  assert.equal(await pageSolo.getByTestId("invite-link").count(), 0);
  const outsider = await browser.newContext();
  const soloJoin = await outsider.request.post(`${baseUrl}/api/rulebooks`, {
    data: { type: "join-room", roomCode: soloRoomCode, name: "Raka" },
  });
  assert.equal((await soloJoin.json()).error, "room-full");
  await outsider.close();

  await clickAndWaitPost(pageSolo, 'button[data-action="sim-start-checkin"]');
  await clickAndWaitPost(pageSolo, 'button[data-action="mark-ready"]');
  await clickAndWaitPost(pageSolo, 'button[data-action="start-match"]');
  await pageSolo.waitForFunction(() => document.body.textContent.includes("Permainan Aktif"));
  await pageSolo.locator("#rb-claim-map-host[data-map-ready=true]").waitFor();
  const claimCanvas = await pageSolo.locator("#rb-claim-map-host .maplibregl-canvas").elementHandle();
  assert.equal(await pageSolo.getByRole("list", { name: "Daftar Landmark" }).count(), 0);
  assert.ok(await pageSolo.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  // #150: Claim active first-match phase cue strip + in-game ? Panduan menu without disconnecting
  const activeCue = pageSolo.locator('[data-testid="phase-cue-strip"][data-cue-key="claim-active"]');
  await activeCue.waitFor();
  assert.match(await activeCue.innerText(), /Pilih landmark di peta/);
  await pageSolo.locator('.cg-hud .sg-room-menu summary').click();
  await pageSolo.getByTestId("menu-quick-guide-btn").click();
  const soloGuide = pageSolo.getByTestId("quick-guide-modal");
  await soloGuide.waitFor();
  assert.equal(await soloGuide.getAttribute("role"), "dialog");
  assert.equal(await soloGuide.getAttribute("aria-modal"), "true");
  assert.match(await soloGuide.innerText(), /Claim Solo/);
  assert.ok(await pageSolo.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "Zero overflow on Claim active Quick Guide (390x844)");
  await pageSolo.keyboard.press("Escape");
  await soloGuide.waitFor({ state: "hidden" });
  await activeCue.getByTestId("phase-cue-dismiss").click();
  assert.equal(await activeCue.count(), 0, "Dismissing active Claim cue must hide it");

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
  await assertCleanUiCopy(pageSolo, "claim active challenge modal (m-bloc)");
  await pageSolo.fill("#claim-input-answer", "2");
  await clickAndWaitPost(pageSolo, 'button[data-action="submit-input"]');
  await pageSolo.waitForFunction(() => document.body.textContent.includes("1/4 terkunci"));
  await assertCleanUiCopy(pageSolo, "claim active board after lock");
  await pageSolo.locator('[data-map-point="m-bloc"][data-game-motion^="lock:"]').waitFor();
  assert.equal(
    await claimCanvas.evaluate((el) => el.isConnected && document.querySelector("#rb-claim-map-host .maplibregl-canvas") === el),
    true,
    "Claim play MapLibre canvas must stay continuously mounted across check-in actions",
  );

  // The player must choose a target before a map-targeted card can be played.
  await pageSolo.getByRole("button", { name: "Kartu", exact: true }).click();
  const soloOffers = pageSolo.locator('[data-action="choose-claim-reward"]');
  assert.equal(await soloOffers.count(), 3);
  await pageSolo.setViewportSize({ width: 320, height: 640 });
  assert.ok(await pageSolo.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  assert.ok((await soloOffers.first().boundingBox()).height >= 44);
  await pageSolo.screenshot({ path: path.join(results, "rulebook-claim-reward-320.png") });
  await pageSolo.setViewportSize({ width: 390, height: 844 });
  await clickAndWaitPost(pageSolo, '[data-action="choose-claim-reward"]');
  await pageSolo.locator('[data-panel="cards"][data-game-motion^="update:"]').waitFor();
  assert.equal(await soloOffers.count(), 0);
  assert.equal(await pageSolo.locator(".cg-tactic").count(), 1);
  await pageSolo.locator(".cg-tactic").click();
  const play = pageSolo.getByRole("button", { name: "Mainkan Kartu" });
  assert.equal(await play.isDisabled(), true);
  const eligible = pageSolo.locator("button.board-map-pin-eligible");
  if (await eligible.count()) {
    const target = await eligible.first().getAttribute("data-map-point");
    await selectLandmark(pageSolo, target);
    assert.equal(await play.getAttribute("data-landmark"), target);
    assert.equal(await play.isEnabled(), true);
    await clickAndWaitPost(pageSolo, '[data-action="play-card"]');
    await pageSolo.locator(`[data-map-point="${target}"][data-game-motion^="role:"]`).waitFor();
  }
  await pageSolo.getByRole("button", { name: "Tantangan", exact: true }).click();

  // Lock taman-ayodya via photo_proof (2nd zone!) — verify #144 rear-camera capture, corrupt rejection, >2MB auto-compression & preview
  await checkIn(pageSolo, "taman-ayodya");
  await pageSolo.waitForSelector('button[data-action="submit-photo"]');
  const claimPhotoInput = pageSolo.locator("input[data-cg-photo]");
  assert.equal(await claimPhotoInput.getAttribute("capture"), "environment", "Claim photo input must default to rear camera");
  assert.equal(await claimPhotoInput.getAttribute("accept"), "image/*");
  const captureBtnBox = await pageSolo.getByTestId("photo-capture-btn").boundingBox();
  assert.ok(captureBtnBox && captureBtnBox.height >= 44, "Ambil Foto button must meet 44px touch target");

  // Corrupt non-image upload shows clean Indonesian inline error without crashing
  await claimPhotoInput.setInputFiles(buildCorruptPhotoFile());
  await pageSolo.getByRole("alert").filter({ hasText: /foto|format|JPEG/i }).waitFor();
  assert.equal(await pageSolo.getByTestId("photo-preview-img").count(), 0, "Corrupt file must not render preview");

  // Large > 2 MB (4.1 MB, 1600x640) image is automatically downscaled to <=1280px JPEG < 2 MB client-side
  const largeClaimPhoto = buildLargeTestPhotoFile(1600, 640);
  assert.ok(largeClaimPhoto.buffer.byteLength > 2 * 1024 * 1024, "Test fixture must exceed 2 MB raw cap");
  await claimPhotoInput.setInputFiles(largeClaimPhoto);
  await pageSolo.getByTestId("photo-preview-img").waitFor();
  const claimPreviewWidth = await pageSolo.getByTestId("photo-preview-img").evaluate((img) => img.naturalWidth);
  assert.equal(claimPreviewWidth, 1280, "Large 1600px image must be downscaled to 1280px longest edge");
  const claimBadgeText = await pageSolo.getByTestId("photo-size-badge").innerText();
  assert.match(claimBadgeText, /Siap unggah · \d+ KB/);
  await pageSolo.getByTestId("photo-retake-btn").waitFor();
  await pageSolo.getByTestId("photo-clear-btn").waitFor();
  assert.ok(await pageSolo.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "Zero horizontal overflow on Claim photo preview (390x844)");

  // Hapus clears the preview; re-attaching large photo uploads cleanly to /api/rulebooks/claim-photo
  await pageSolo.getByTestId("photo-clear-btn").click();
  assert.equal(await pageSolo.getByTestId("photo-preview-img").count(), 0, "Hapus must clear photo preview");
  await pageSolo.locator("input[data-cg-photo]").setInputFiles(largeClaimPhoto);
  await pageSolo.getByTestId("photo-preview-img").waitFor();
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
  await pageSolo.getByRole("button", { name: "Coba Lagi", exact: true }).click();
  await pageSolo.locator("#rb-claim-map-host[data-map-ready=true]").waitFor();
  assert.equal(await pageSolo.getByRole("list", { name: "Daftar Landmark" }).count(), 0);

  // App restart simulation: open a fresh tab at /catalog in the same browser context -> Lanjutkan Permainan banner appears and resumes the active game
  const pageRestart = await ctxSolo.newPage();
  await pageRestart.goto(catalogUrl(baseUrl), { waitUntil: "networkidle" });
  const resumeBanner = pageRestart.getByTestId("resume-room-banner");
  await resumeBanner.waitFor();
  const resumeText = await resumeBanner.innerText();
  assert.match(resumeText, /Claim the City/);
  assert.ok(resumeText.includes(`Ruang ${soloRoomCode}`));
  assert.match(resumeText, /Ronde Aktif/);
  const resumeBtn = resumeBanner.getByRole("button", { name: "Lanjutkan Permainan", exact: true });
  const dismissBtn = resumeBanner.locator('[data-cat-action="dismiss-resume"]');
  const resumeBox = await resumeBtn.boundingBox();
  const dismissBox = await dismissBtn.boundingBox();
  assert.ok(resumeBox && resumeBox.width >= 44 && resumeBox.height >= 44, "Resume CTA must meet 44x44 touch target");
  assert.ok(dismissBox && dismissBox.width >= 44 && dismissBox.height >= 44, "Dismiss button must meet 44x44 touch target");
  assert.ok(await pageRestart.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await pageRestart.screenshot({ path: path.join(results, "catalog-resume-claim.png") });
  await resumeBtn.click();
  await pageRestart.waitForFunction(() => document.body.textContent.includes("2/4 terkunci"));
  assert.equal(new URL(pageRestart.url()).searchParams.get("room"), soloRoomCode);

  // Return to catalog and test dismissing the resume banner
  await pageRestart.goto(catalogUrl(baseUrl), { waitUntil: "networkidle" });
  await resumeBanner.waitFor();
  await dismissBtn.click();
  assert.equal(await resumeBanner.count(), 0, "Dismissing resume banner should hide it on the catalog");
  await ctxSolo.close();

  // 2. 3-player Claim the City FFA launched from /catalog + invite link join
  const ctxP1 = await browser.newContext({ viewport: { width: 390, height: 844 }, recordVideo });
  const pageP1 = await ctxP1.newPage();
  await pageP1.goto(catalogUrl(baseUrl), { waitUntil: "networkidle" });
  await openEdition(pageP1, "claim-the-city");
  await pageP1.getByRole("button", { name: "Grup", exact: true }).click();
  await pageP1.getByRole("button", { name: "Main Grup", exact: true }).click();
  await pageP1.waitForFunction(() => document.body.textContent.includes("Ruang Tunggu"));
  const groupRoom = new URL(pageP1.url()).searchParams.get("room");
  assert.equal(await pageP1.locator('[data-action="start-match"]').isDisabled(), true);
  const earlyStart = await ctxP1.request.post(`${baseUrl}/api/rulebooks`, {
    data: { type: "room-action", roomCode: groupRoom, action: { type: "start", actionId: "group-too-small" } },
  });
  assert.equal((await earlyStart.json()).error, "not-enough-players");
  const invite = pageP1.getByTestId("invite-link");
  const inviteHref = await invite.getAttribute("href");
  assert.ok(inviteHref && inviteHref.includes("room=RC-"), "Shareable invite link should be visible in lobby");
  assert.equal(await invite.innerText(), inviteHref, "The lobby should display the full invitation URL");
  for (const width of [320, 390]) {
    await pageP1.setViewportSize({ width, height: 844 });
    assert.ok(await invite.evaluate(link => link.scrollWidth <= link.clientWidth && document.documentElement.scrollWidth <= innerWidth));
  }
  await pageP1.screenshot({ path: path.join(results, "rulebook-claim-invite.png") });
  const codeMatch = (await pageP1.textContent("body")).match(/Kode:\s*(RC-[A-F0-9]+)/);
  assert.ok(codeMatch, "Claim room code should be visible");
  const roomCode = codeMatch[1];

  const ctxP2 = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const pageP2 = await ctxP2.newPage();
  await pageP2.goto(inviteHref, { waitUntil: "networkidle" });
  await pageP2.waitForSelector("#rb-claim-join-code");
  assert.equal(await pageP2.inputValue("#rb-claim-join-code"), roomCode, "Invite URL should prefill room code");
  await pageP2.fill("#rb-claim-join-name", "Dina");
  await clickAndWaitPost(pageP2, 'button[data-action="join-room"]');
  await pageP2.waitForFunction(() => document.body.textContent.includes("Ruang Tunggu"));

  const ctxP3 = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const pageP3 = await ctxP3.newPage();
  await pageP3.goto(`${baseUrl}/?play=rulebook-claim`, { waitUntil: "networkidle" });
  await pageP3.fill("#rb-claim-join-code", roomCode);
  await pageP3.fill("#rb-claim-join-name", "Sari");
  await clickAndWaitPost(pageP3, 'button[data-action="join-room"]');
  await pageP3.waitForFunction(() => document.body.textContent.includes("Kursi Pemain (3/4)"));

  for (const p of [pageP1, pageP2, pageP3]) {
    await clickAndWaitPost(p, 'button[data-action="sim-start-checkin"]');
    await clickAndWaitPost(p, 'button[data-action="mark-ready"]');
  }
  await clickAndWaitPost(pageP1, 'button[data-action="start-match"]');
  await pageP1.waitForFunction(() => document.body.textContent.includes("Permainan Aktif"));
  await pageP3.locator(".cg-game").waitFor();
  await ctxP3.setOffline(true);

  // Ensure P2's map & SSE stream are active, then P1 claims & bails taman-literasi -> P2 receives update via SSE (< 1.5s) while MapLibre stays connected
  await pageP2.locator("#rb-claim-map-host[data-map-ready=true]").waitFor();
  const p2MapCanvas = await pageP2.locator("#rb-claim-map-host .maplibregl-canvas").elementHandle();
  await checkIn(pageP1, "taman-literasi");
  await pageP1.waitForSelector('button[data-action="bail-challenge"]');
  const bailSentAt = Date.now();
  await clickAndWaitPost(pageP1, 'button[data-action="bail-challenge"]');

  // P2 receives "Open to steal!" alert via SSE well before 3s poll without tearing down MapLibre
  await pageP2.waitForSelector('[data-testid="open-to-steal-alert"]', { timeout: 1500 });
  assert.ok(Date.now() - bailSentAt < 1500, "P2 must receive bail mutation via SSE before a 3-second poll cycle");
  assert.equal(await p2MapCanvas.evaluate(el => el.isConnected), true, "SSE push must keep MapLibre instance mounted in-place");
  assert.ok(await pageP2.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "Zero horizontal overflow on P2 after SSE push");
  await pageP2.getByLabel("Lainnya").click();
  await pageP2.click('button[data-action="refresh"]');
  await pageP2.waitForFunction(() => !document.querySelector('[aria-busy="true"]'));
  await checkIn(pageP2, "taman-literasi");
  await pageP2.waitForSelector('button[data-action="submit-mcq"]');
  await pageP2.emulateMedia({ reducedMotion: "reduce" });
  const stealSentAt = Date.now();
  await clickAndWaitPost(pageP2, 'button[data-action="submit-mcq"]');
  await pageP2.waitForFunction(() =>
    document.querySelector('.cg-selected[data-landmark-id="taman-literasi"]')?.textContent?.includes("Terkunci"),
  );
  const stealNotice = pageP1.locator('[data-activity-message][data-notice-kind="steal"]');
  await stealNotice.waitFor({ timeout: 1500 });
  assert.ok(Date.now() - stealSentAt < 1500, "P1 must receive steal notice via SSE before a 3-second poll cycle");
  const animatedSteal = pageP1.locator('[data-map-point="taman-literasi"][data-game-motion^="steal:"]');
  await animatedSteal.waitFor({ state: "attached" });
  await pageP1.locator('[data-map-point="zone:blok-m"][data-game-motion^="role:"]').waitFor({ state: "attached" });
  assert.equal(await pageP2.locator('[data-map-point="taman-literasi"][data-game-motion^="steal:"]').count(), 0);
  assert.match(await stealNotice.innerText(), /berpindah tim.*Penguasaan zona berubah/);
  assert.equal(await pageP2.locator('[data-activity-message][data-notice-kind="steal"]:visible').count(), 0);
  await ctxP3.setOffline(false);
  assert.equal(await pageP3.locator('[data-activity-message][data-notice-kind="steal"]:visible').count(), 0);
  const readActivity = async page => (await (await page.request.get(`${baseUrl}/api/rulebooks/rooms/${roomCode}`)).json()).activity;
  const lostClaimFeed = await readActivity(pageP1);
  const activityForRival = await readActivity(pageP3);
  const stealEvents = lostClaimFeed.events.filter(event => event.kind === "steal");
  assert.equal(stealEvents.length, 1);
  assert.equal(stealEvents[0].alert, true);
  assert.equal(activityForRival.events.find(event => event.kind === "steal").alert, undefined);
  assert.doesNotMatch(JSON.stringify(lostClaimFeed), /"latitude"|"longitude"|"photoId"|"correctChoiceId"|"acceptedAnswers"|"verificationNotes"/);
  const readRoom = async page => (await (await page.request.get(`${baseUrl}/api/rulebooks/rooms/${roomCode}`)).json()).room;
  const stealOffer = (await readRoom(pageP2)).ownClaimReward;
  assert.equal(stealOffer.cards.length, 3);
  for (const rival of [pageP1, pageP3]) {
    const rivalRoom = await readRoom(rival);
    assert.equal(rivalRoom.ownClaimReward, undefined);
    assert.ok(stealOffer.cards.every(card => !JSON.stringify(rivalRoom).includes(card.instanceId)));
    await rival.getByRole("button", { name: "Kartu", exact: true }).click();
    assert.equal(await rival.getByRole("region", { name: "Pilih satu kartu hadiah" }).count(), 0);
  }
  await pageP2.reload();
  await pageP2.getByRole("button", { name: "Kartu", exact: true }).click();
  const rewardOptions = pageP2.locator('[data-action="choose-claim-reward"]');
  assert.equal(await rewardOptions.count(), 3);
  assert.deepEqual((await readRoom(pageP2)).ownClaimReward, stealOffer);
  const keepRequestPromise = pageP2.waitForRequest(request =>
    request.method() === "POST" && request.url().endsWith("/api/rulebooks")
    && request.postDataJSON()?.action?.type === "choose-claim-reward",
  );
  await clickAndWaitPost(pageP2, '[data-action="choose-claim-reward"]');
  const keepRequest = (await keepRequestPromise).postDataJSON();
  const keepRetry = await pageP2.request.post(`${baseUrl}/api/rulebooks`, { data: keepRequest });
  assert.ok(keepRetry.ok());
  const keptRoom = (await keepRetry.json()).room;
  assert.equal(keptRoom.ownClaimReward, undefined);
  assert.deepEqual(keptRoom.ownHand.map(card => card.instanceId), [stealOffer.cards[0].instanceId]);
  await stealNotice.getByRole("button", { name: "Buka", exact: true }).click();
  assert.equal(await pageP1.locator(".cg-selected").getAttribute("data-landmark-id"), "taman-literasi");
  await pageP1.reload();
  await pageP1.locator(".cg-game").waitFor();
  assert.equal(await stealNotice.isVisible(), false);
  assert.equal(await animatedSteal.count(), 0);
  await pageP3.reload();
  await pageP3.getByLabel("Lainnya").click();
  await pageP3.getByRole("button", { name: "Aktivitas terbaru" }).click();
  const activityPanel = pageP3.getByRole("region", { name: "Aktivitas terbaru" });
  await activityPanel.getByText(/berpindah tim/).waitFor();
  await activityPanel.getByText(/Taman Literasi.*diklaim/).waitFor();
  await activityPanel.getByText(/Taman Literasi.*bisa direbut/).waitFor();
  assert.ok(await pageP3.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await pageP3.screenshot({ path: path.join(results, "rulebook-claim-recent-activity.png") });

  // Abort SSE /events on P2 -> verify automatic 3s polling fallback delivers rival photo review cleanly
  await pageP2.route(`**/api/rulebooks/rooms/${roomCode}/events`, route => route.abort());
  await pageP2.reload();
  await pageP2.locator(".cg-game").waitFor();
  await checkIn(pageP1, "taman-ayodya");
  await pageP1.locator("input[data-cg-photo]").setInputFiles(proof);
  await clickAndWaitPost(pageP1, 'button[data-action="submit-photo"]');
  const rivalProof = pageP2.getByAltText("Foto bukti untuk ditinjau");
  await rivalProof.waitFor({ timeout: 8000 });
  await pageP2.waitForFunction(() => document.querySelector(".cg-proof")?.naturalWidth > 0);
  const proofPath = await rivalProof.getAttribute("src");
  assert.equal((await fetch(new URL(proofPath, baseUrl))).status, 404);
  await clickAndWaitPost(pageP2, 'button[data-action="review-rival-photo"][data-approve="false"]');
  assert.equal((await ctxP2.request.get(new URL(proofPath, baseUrl).href)).status(), 404);
  now += 3 * 60 * 60 * 1000;
  await pageP2.getByTestId("claim-outcome").waitFor({ timeout: 8000 });
  await pageP2.unroute(`**/api/rulebooks/rooms/${roomCode}/events`);
  assert.match(await pageP2.getByTestId("claim-outcome").innerText(), /Pemenang · Dina.*Landmark yang terkunci/s);
  await pageP2.getByRole("link", { name: "Buka ringkasan" }).click();
  await pageP2.getByRole("heading", { name: "Pemenang · Dina" }).waitFor();
  assert.match(await pageP2.locator(".recap-shell").innerText(), /Penentu kemenangan · Landmark yang terkunci/);
  assert.ok(await pageP2.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await pageP2.getByRole("link", { name: "‹ Riwayat" }).click();
  await pageP2.getByRole("heading", { name: "Riwayat pertandingan" }).waitFor();
  const recapLink = pageP2.locator(".recap-history a");
  await recapLink.first().waitFor();
  assert.equal(await recapLink.count(), 1);
  await pageP2.getByRole("link", { name: "‹ Katalog" }).click();
  await pageP2.getByRole("heading", { name: "Pilih permainan", level: 1 }).waitFor();
  assert.equal(await pageP2.getByTestId("resume-room-banner").count(), 0, "Completed room must not appear in resume banner");
  await pageP2.getByRole("link", { name: "Riwayat pertandingan" }).click();
  await recapLink.click();
  await pageP2.getByRole("heading", { name: "Pemenang · Dina" }).waitFor();

  // 2b. Community recap sharing: private by default -> visitor denied -> preview & publish with alias -> visitor views public recap & edition list -> unshare keeps private recap intact
  const claimVideo = pageP1.video();
  await ctxP1.close();
  if (claimVideo) {
    await claimVideo.saveAs(path.join(results, "rulebook-claim-map-playback.webm"));
    await claimVideo.delete();
  }
  await ctxP3.close();
  const ctxVisitor = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const pageVisitor = await ctxVisitor.newPage();
  await pageVisitor.goto(`${baseUrl}/?recap=${encodeURIComponent(roomCode)}`);
  await pageVisitor.locator(".recap-shell").getByText(/privat|belum tersedia/i).waitFor();
  await pageVisitor.goto(`${baseUrl}/?edition=official-jakarta-compact-claim&version=1`);
  const communitySection = pageVisitor.getByRole("region", { name: "Hasil komunitas" });
  await communitySection.waitFor();
  await communitySection.getByText(/Belum ada hasil pertandingan yang dibagikan/).waitFor();

  assert.match(await pageP2.getByTestId("recap-visibility-badge").innerText(), /Privat/);
  await assertCleanUiCopy(pageP2, "claim private recap");
  const previewBefore = await pageP2.getByTestId("public-recap-preview").innerText();
  assert.match(previewBefore, /Pemain 2/);
  assert.doesNotMatch(previewBefore, /Dina/);
  await pageP2.locator('input[data-alias-seat]').nth(1).fill("Juara Blok M");
  assert.match(await pageP2.getByTestId("public-recap-preview").innerText(), /Pemenang · Juara Blok M/);
  await pageP2.screenshot({ path: path.join(results, "recap-share-composer.png"), fullPage: true });
  await Promise.all([
    pageP2.waitForResponse(r => r.url().includes(`/api/rulebooks/recaps/${roomCode}/share`) && r.status() === 200),
    pageP2.getByRole("button", { name: "Bagikan ke komunitas", exact: true }).click(),
  ]);
  assert.match(await pageP2.getByTestId("recap-visibility-badge").innerText(), /Publik/);
  const publicHref = await pageP2.getByTestId("public-recap-link").getAttribute("href");
  assert.match(publicHref, /^\/\?shared=SR-[\dA-F]{12}$/);
  assert.ok(await pageP2.evaluate(() => document.documentElement.scrollWidth <= innerWidth));

  // Separate visitor session opens the public link and navigates to the exact edition & rules version page.
  await pageVisitor.goto(new URL(publicHref, baseUrl).href);
  await pageVisitor.getByRole("heading", { name: "Pemenang · Juara Blok M" }).waitFor();
  await assertCleanUiCopy(pageVisitor, "claim public recap");
  const publicBody = await pageVisitor.locator(".recap-shell").innerText();
  assert.doesNotMatch(publicBody, /Dina/);
  assert.equal(publicBody.includes(roomCode), false, "Public recap view must not expose room code");
  assert.ok(await pageVisitor.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await pageVisitor.screenshot({ path: path.join(results, "recap-public-shared.png"), fullPage: true });
  const sharedEditionLink = pageVisitor.getByTestId("shared-edition-link");
  assert.equal(await sharedEditionLink.getAttribute("href"), "/?edition=official-jakarta-compact-claim&version=1");
  await sharedEditionLink.click();
  await communitySection.waitFor();
  await communitySection.getByText(/Pemenang · Juara Blok M/).waitFor();
  assert.ok(await pageVisitor.evaluate(() => document.documentElement.scrollWidth <= innerWidth));

  // Unshare from participant session -> disappears from public link & edition list while private recap survives.
  await Promise.all([
    pageP2.waitForResponse(r => r.url().includes(`/api/rulebooks/recaps/${roomCode}/unshare`) && r.status() === 200),
    pageP2.getByRole("button", { name: "Tarik dari komunitas", exact: true }).click(),
  ]);
  assert.match(await pageP2.getByTestId("recap-visibility-badge").innerText(), /Privat/);
  await pageP2.getByRole("heading", { name: "Pemenang · Dina" }).waitFor();
  await pageVisitor.goto(new URL(publicHref, baseUrl).href);
  await pageVisitor.locator(".recap-shell").getByText(/tidak tersedia|ditarik/i).waitFor();
  await pageVisitor.goto(`${baseUrl}/?edition=official-jakarta-compact-claim&version=1`);
  await communitySection.waitFor();
  await communitySection.getByText(/Belum ada hasil pertandingan yang dibagikan/).waitFor();

  // Top app bar brand logo links back to Landing Page (/) from edition detail, recaps, game screens, and Creator Studio
  const brandLink = pageVisitor.locator('header.mast a.brand[href="/"]');
  const brandBox = await brandLink.boundingBox();
  assert.ok(brandBox && brandBox.width >= 44 && brandBox.height >= 44, "Brand logo link must meet 44x44 touch target");
  await brandLink.click();
  await pageVisitor.getByRole("heading", { name: "Ubah Jakarta jadi papan permainan nyata", level: 1 }).waitFor();
  assert.equal(new URL(pageVisitor.url()).pathname, "/");
  assert.equal(new URL(pageVisitor.url()).search, "");
  assert.ok(await pageVisitor.evaluate(() => document.documentElement.scrollWidth <= innerWidth));

  await pageVisitor.getByTestId("landing-choose-game").click();
  await pageVisitor.getByRole("heading", { name: "Pilih permainan", level: 1 }).waitFor();
  await pageVisitor.waitForLoadState("networkidle");
  await pageVisitor.waitForFunction(() => {
    const el = document.querySelector(".cat-card");
    return Boolean(el && el.isConnected && getComputedStyle(el).backgroundColor);
  });
  const catalogCardTheme = await pageVisitor.evaluate(() => {
    const el = document.querySelector(".cat-card");
    const s = el ? getComputedStyle(el) : null;
    return { bg: s?.backgroundColor ?? "", border: s?.borderTopColor ?? "" };
  });
  assert.ok(catalogCardTheme.bg, "Catalog card theme background should be resolved");

  // Bare /?play normalizes cleanly to /catalog
  await pageVisitor.goto(`${baseUrl}/?play`, { waitUntil: "networkidle" });
  await pageVisitor.getByRole("heading", { name: "Pilih permainan", level: 1 }).waitFor();
  assert.equal(new URL(pageVisitor.url()).pathname, "/catalog", "Bare /?play should normalize to /catalog");
  assert.equal(new URL(pageVisitor.url()).search, "", "Bare /?play should clear query string");
  assert.ok(await pageVisitor.evaluate(() => document.documentElement.scrollWidth <= innerWidth));

  for (const route of ["/?recaps=1", "/?play=rulebook-claim", "/?play=rulebook-seek", "/?play=rulebook-studio"]) {
    await pageVisitor.goto(`${baseUrl}${route}`, { waitUntil: "networkidle" });
    await pageVisitor.waitForFunction(() => !document.getElementById("play")?.hidden);
    await assertCleanUiCopy(pageVisitor, `route ${route}`);
    if (route.startsWith("/?play=rulebook-")) {
      await pageVisitor.locator(".rb-card").first().waitFor();
      assert.equal(await pageVisitor.locator("#play > h1").count(), 0, `${route} should not render a redundant outer h1 wrapper`);
      const rbTheme = await pageVisitor.locator(".rb-card").first().evaluate((el) => {
        const s = getComputedStyle(el);
        const h2 = el.querySelector("h2");
        return {
          bg: s.backgroundColor,
          border: s.borderTopColor,
          font: h2 ? getComputedStyle(h2).fontFamily : "",
        };
      });
      assert.equal(rbTheme.bg, catalogCardTheme.bg, `${route} .rb-card background must match catalog theme`);
      assert.equal(rbTheme.border, catalogCardTheme.border, `${route} .rb-card border must match catalog theme`);
      assert.match(rbTheme.font, /Barlow Condensed/i, `${route} .rb-card heading must use Barlow Condensed`);
    }
    assert.ok(await pageVisitor.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await brandLink.click();
    await pageVisitor.getByRole("heading", { name: "Ubah Jakarta jadi papan permainan nyata", level: 1 }).waitFor();
    assert.equal(new URL(pageVisitor.url()).pathname, "/", `Clicking brand logo from ${route} should navigate to /`);
    assert.equal(new URL(pageVisitor.url()).search, "", `Clicking brand logo from ${route} should clear query params`);
    assert.equal(await pageVisitor.evaluate(() => document.getElementById("play")?.hidden), true);
    assert.ok(await pageVisitor.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  }

  await ctxVisitor.close();
  await ctxP2.close();

  // 3. Creator opens unified Studio from /catalog, clones Official Claim pack, walks 4-step stepper, publishes, buys via Midtrans
  const ctxCreator = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await signInQaContext(ctxCreator, baseUrl, "claim-creator@kelana.test", "Kreator Claim");
  const pageCreator = await ctxCreator.newPage();
  await pageCreator.goto(catalogUrl(baseUrl), { waitUntil: "networkidle" });
  await pageCreator.click("#chooser-studio");
  await startDraft(pageCreator, "claim-the-city");
  await pageCreator.waitForSelector('button[data-action="clone"]');
  await clickAndWaitPost(pageCreator, 'button[data-action="clone"]');
  await pageCreator.waitForSelector("#ed-meta-title");

  // Step 2: interactive map editor — rename first landmark, add custom Zone & Landmark, verify orphan-zone guardrail
  await pageCreator.click('button[data-step="2"]');
  await pageCreator.waitForSelector('[data-testid="studio-map-host"]');
  await pageCreator.waitForSelector("#ed-claim-landmark-name");
  await pageCreator.fill("#ed-claim-landmark-name", "Taman Literasi Senopati");
  await clickAndWaitPost(pageCreator, 'button[data-map-action="apply-selected"]');
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
  await pageCreator.click('button[data-map-action="edit-challenges"]');
  await pageCreator.fill("#ed-chal-title", "Tantangan Call Your Shot Senopati");
  await pageCreator.fill("#ed-chal-answer", "rahasia-jawaban-senopati");
  await pageCreator.fill("#ed-chal-notes", "Contoh rubrik Studio QA. Foto papan nama dari trotoar.");
  await pageCreator.check("#ed-chal-reviewed");
  await clickAndWaitPost(pageCreator, 'button[data-c3-action="add-challenge"]');
  await pageCreator.waitForFunction(() => document.body.textContent.includes("Tantangan Call Your Shot Senopati"));

  // Step 3: save session rules + add Sabotage Curse tactical card
  await pageCreator.click('button[data-step="3"]');
  await pageCreator.waitForSelector("#ed-claim-duration");
  await clickAndWaitPost(pageCreator, 'button[data-action="save-draft"]');
  await pageCreator.waitForFunction(() => document.body.textContent.includes("lolos validator otomatis"));

  await pageCreator.click('button[data-c3-tab="deck"]');
  await pageCreator.fill("#ed-ccard-title", "Sabotase Macet Senopati");
  await clickAndWaitPost(pageCreator, 'button[data-c3-action="add-claim-card"]');
  await pageCreator.waitForFunction(() => document.body.textContent.includes("Sabotase Macet Senopati"));

  // Step 4: dry-run & submit, then confirm publication in Panel Admin
  await pageCreator.click('button[data-step="4"]');
  await pageCreator.click('button[data-action="dry-run"]');
  await pageCreator.waitForFunction(() => document.body.textContent.includes("Uji coba lolos"));
  await clickAndWaitPost(pageCreator, 'button[data-action="submit-draft"]');
  await pageCreator.waitForFunction(() => document.body.textContent.includes("diajukan ke peninjau"));
  await openAdminPanel(pageCreator);
  await moderateAdminPack(pageCreator, "pack-senopati-claim", "Terbitkan ke Katalog");
  await pageCreator.waitForFunction(() => document.body.textContent.includes("Paket diterbitkan ke katalog"));

  // Confirm private answer keys NEVER leak on public /api/rulebooks listing
  const publicListingText = await pageCreator.evaluate(() =>
    fetch("/api/rulebooks?format=claim-the-city").then((r) => r.text()),
  );
  assert.equal(
    publicListingText.includes("rahasia-jawaban-senopati"),
    false,
    "Private answer keys authored in Studio must never leak to public catalog",
  );

  const packs = await ctxCreator.request.get(`${baseUrl}/api/rulebooks?role=writer&format=claim-the-city`);
  const { versions } = await packs.json();
  const versionOne = versions.find(record => record.packId === "pack-senopati-claim" && record.version === 1);
  const fixture = structuredClone(versionOne.pack);
  fixture.meta.version = 2;
  fixture.meta.cityLabel = "Kota Contoh (Simulasi)";
  fixture.meta.title = "Kota Contoh · Claim the City";
  fixture.meta.priceIdr = 42_000;
  fixture.session.maxPlayers = 3;
  fixture.session.durationMs = 105 * 60_000;
  const author = async data => {
    const res = await ctxCreator.request.post(`${baseUrl}/api/rulebooks`, {
      data,
    });
    const reply = await res.json();
    assert.ok(reply.ok, JSON.stringify(reply.error ?? reply.validation?.errors));
    return reply;
  };
  await author({ type: "save-draft", pack: fixture, snapshot: versionOne.snapshot });
  await author({ type: "submit-draft", packId: fixture.meta.packId, version: 2 });
  await author({ type: "publish-version", packId: fixture.meta.packId, version: 2 });

  const catalog = await ctxCreator.request.get(`${baseUrl}/api/rulebooks/catalog`);
  const catalogData = await catalog.json();
  assert.equal(catalogData.editions.filter(item => item.packId === fixture.meta.packId).length, 2);
  assert.equal(JSON.stringify(catalogData).includes("rahasia-jawaban-senopati"), false);

  for (const version of [1, 2]) {
    const buyer = await browser.newContext({ viewport: { width: 390, height: 844 } });
    if (version === 2) {
      await signInQaContext(buyer, baseUrl, `buyer-v${version}@kelana.test`, `Pembeli ${version}`);
    }
    const shop = await buyer.newPage();
    try {
      await shop.goto(catalogUrl(baseUrl));
      const group = shop.getByRole("region", { name: "Claim the City" });
      await group.locator('.cat-card[data-pack-id="official-jakarta-compact-claim"]').waitFor();
      assert.equal(await shop.getByRole("button", { name: /Pulihkan paket/i }).count(), 0, "Superseded Pulihkan paket button must be deleted");
      if (version === 1) {
        await shop.getByTestId("auth-chip-signin").waitFor();
      }
      const paid = group.locator(`.cat-card[data-pack-id="${fixture.meta.packId}"][data-version="${version}"]`);
      const paidCardText = await paid.innerText();
      assert.match(paidCardText, /Beli sekali/, "Paid catalog card must show one-time pricing");
      assert.ok(await shop.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "Zero horizontal overflow on catalog home");
      await paid.click();
      const editionUrl = shop.url();
      const detail = shop.getByRole("article", { name: "Detail edisi" });
      await detail.waitFor();
      assert.equal(new URL(editionUrl).searchParams.get("version"), String(version));
      const detailText = await detail.innerText();
      assert.match(detailText, /Harga paket/);
      assert.match(detailText, /Beli sekali/);
      assert.doesNotMatch(detailText, /Harga per sesi/i);
      assert.ok(await shop.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "Zero horizontal overflow on paid edition detail");
      if (version === 2) {
        assert.match(detailText, /105 menit/);
        assert.match(detailText, /Kota Contoh/);
      }
      let checkout;
      if (version === 1) {
        // Guest tapping Beli paket opens the 2-step Email OTP modal with contextual copy
        await shop.getByRole("button", { name: "Beli paket · Uji pembayaran" }).click();
        const authModal = shop.getByTestId("auth-modal");
        await authModal.waitFor();
        assert.match(await authModal.innerText(), /tersimpan permanen di akunmu/i);
        assert.ok(await shop.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "Zero horizontal overflow on auth modal (390x844)");
        await shop.fill("#auth-email-input", "buyer-v1@kelana.test");
        await shop.getByTestId("auth-send-otp").click();
        const sandboxCodeEl = shop.getByTestId("auth-sandbox-code");
        await sandboxCodeEl.waitFor();
        const validOtp = (await sandboxCodeEl.innerText()).trim();
        assert.match(validOtp, /^\d{6}$/, "Sandbox OTP helper must show 6-digit code");
        assert.equal(await shop.locator("#auth-otp-input").getAttribute("inputmode"), "numeric");
        assert.equal(await shop.locator("#auth-otp-input").getAttribute("autocomplete"), "one-time-code");
        // Wrong OTP triggers Indonesian error toast without leaking raw error code
        const wrongOtp = validOtp === "000000" ? "999999" : "000000";
        await shop.fill("#auth-otp-input", wrongOtp);
        await shop.getByTestId("auth-verify-otp").click();
        const otpToast = shop.getByTestId("player-toast");
        await otpToast.waitFor();
        const otpToastText = await otpToast.innerText();
        assert.match(otpToastText, /Kode 6 digit tidak cocok/);
        assert.doesNotMatch(otpToastText, /otp-invalid|401/i);
        // Valid OTP signs in and proceeds directly into checkout order creation
        const orderRequest = shop.waitForRequest(req => req.url().endsWith("/api/rulebooks/catalog") && req.method() === "POST");
        await shop.fill("#auth-otp-input", validOtp);
        await shop.fill("#auth-name-input", "Pembeli 1");
        await shop.getByTestId("auth-verify-otp").click();
        await authModal.waitFor({ state: "hidden" });
        checkout = (await orderRequest).postDataJSON();
        await shop.getByTestId("auth-chip-account").waitFor();
        assert.match(await shop.getByTestId("auth-chip-account").innerText(), /Pembeli 1/);
      } else {
        const orderRequest = shop.waitForRequest(req => req.url().endsWith("/api/rulebooks/catalog") && req.method() === "POST");
        await shop.getByRole("button", { name: "Beli paket · Uji pembayaran" }).click();
        checkout = (await orderRequest).postDataJSON();
      }
      await shop.getByRole("button", { name: "Cek status pembayaran" }).waitFor();
      await shop.reload();
      await shop.getByRole("button", { name: "Cek status pembayaran" }).click();
      await shop.getByRole("alert").filter({ hasText: "masih menunggu" }).waitFor();
      assert.equal(new URL(shop.url()).searchParams.get("room"), null);
      await shop.getByRole("button", { name: "Simulasikan pembayaran berhasil" }).click();

      // Settlement binds pack permanently to the signed-in account and enters room #1 directly (no restore-code card)
      await shop.getByText("Pass Berbayar").waitFor();
      assert.equal(await shop.getByTestId("restore-code-card").count(), 0, "Superseded restore-code-card must not render");
      const roomCode = new URL(shop.url()).searchParams.get("room");
      const roomResponse = await buyer.request.get(`${baseUrl}/api/rulebooks/rooms/${roomCode}`);
      const { pass } = await roomResponse.json();
      assert.equal(pass.version, version);
      assert.equal(pass.maxPlayers, 1);
      assert.equal(pass.mode, "solo");
      const verify = await buyer.request.post(`${baseUrl}/api/rulebooks/catalog`, {
        data: { ...checkout, type: "check-payment" },
      });
      assert.equal((await verify.json()).pass.roomCode, roomCode);
      if (version === 2) {
        await shop.route("**/api/health", route => route.fulfill({ json: { allowSimulatedLocation: false } }));
      }
      await shop.reload();
      await shop.getByText("Pass Berbayar").waitFor();
      if (version === 1) {
        // Return to catalog while room #1 is still active -> shows Dimiliki badge and resume CTA
        await shop.goto(catalogUrl(baseUrl));
        const ownedCard = shop.locator(`.cat-card[data-pack-id="${fixture.meta.packId}"][data-version="1"]`);
        await ownedCard.waitFor();
        await ownedCard.getByTestId("owned-badge").waitFor();
        assert.match(await ownedCard.innerText(), /Dimiliki/);
        assert.ok(await shop.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "Zero overflow on owned catalog card");
        await ownedCard.click();
        await shop.getByRole("button", { name: `Lanjutkan Ruang (${roomCode})` }).waitFor();

        // Close room #1 (leave lobby) -> returning to catalog lets owner launch room #2 without paying again
        const leaveResp = await buyer.request.post(`${baseUrl}/api/rulebooks`, {
          data: { type: "room-action", roomCode, action: { type: "leave", actionId: "leave-paid-room-1" } },
        });
        assert.equal(leaveResp.status(), 200);
        await shop.goto(`${baseUrl}/?edition=${fixture.meta.packId}&version=1`);
        await shop.getByTestId("owned-badge").waitFor();
        await shop.getByRole("button", { name: "Main Solo", exact: true }).click();
        await shop.getByText("Pass Berbayar").waitFor();
        const replayRoomCode = new URL(shop.url()).searchParams.get("room");
        assert.ok(replayRoomCode && replayRoomCode !== roomCode, "Owner must launch a brand new room #2 without re-paying");
        // Close room #2 so second device signed into same account can launch room #3 cleanly
        await buyer.request.post(`${baseUrl}/api/rulebooks`, {
          data: { type: "room-action", roomCode: replayRoomCode, action: { type: "leave", actionId: "leave-paid-room-2" } },
        });
      }
      if (version === 2) {
        const { publicBoard: { startPoint }, room } = await roomResponse.json();
        await shop.evaluate(({ latitude, longitude, timestamp }) => {
          let retry = false;
          Object.defineProperty(navigator, "geolocation", { configurable: true, value: {
            getCurrentPosition(resolve, reject) {
              if (retry) resolve({ coords: { latitude, longitude, accuracy: 10 }, timestamp });
              else { retry = true; reject({ code: 1 }); }
            },
          } });
        }, { ...startPoint, timestamp: room.now });
        const check = shop.getByRole("button", { name: "Check-in Titik Awal", exact: true });
        await check.click();
        await shop.getByRole("alert").filter({ hasText: "Izin lokasi ditolak" }).waitFor();
        assert.equal(new URL(shop.url()).searchParams.get("room"), roomCode);
        const accepted = shop.waitForResponse(res => res.url().endsWith("/api/rulebooks") && res.request().method() === "POST");
        await check.click();
        const verifiedStart = await (await accepted).json();
        assert.equal(verifiedStart.error, undefined);
        assert.ok(verifiedStart.room.seats[0].startVerifiedUntil);
      }
    } finally {
      await buyer.close();
    }
  }

  // Fresh isolated browser profile (new cookie jar): signing in through the 2-step Email OTP UI unlocks owned pack immediately!
  now += 61_000;
  const newPhone = await browser.newContext({ viewport: { width: 320, height: 640 } });
  const phonePage = await newPhone.newPage();
  try {
    await phonePage.goto(catalogUrl(baseUrl));
    const ownedCardOnNewPhone = phonePage.locator(`.cat-card[data-pack-id="${fixture.meta.packId}"][data-version="1"]`);
    await ownedCardOnNewPhone.waitFor();
    assert.equal(await ownedCardOnNewPhone.getByTestId("owned-badge").count(), 0, "Guest on fresh device must not see Dimiliki before sign-in");
    await phonePage.getByTestId("auth-chip-signin").click();
    const phoneAuthModal = phonePage.getByTestId("auth-modal");
    await phoneAuthModal.waitFor();
    assert.ok(await phonePage.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "Zero horizontal overflow on auth modal at 320x640");
    await phonePage.fill("#auth-email-input", "buyer-v1@kelana.test");
    await phonePage.getByTestId("auth-send-otp").click();
    const phoneOtpCode = (await phonePage.getByTestId("auth-sandbox-code").innerText()).trim();
    assert.ok(await phonePage.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "Zero horizontal overflow on OTP step at 320x640");
    await phonePage.fill("#auth-otp-input", phoneOtpCode);
    await phonePage.getByTestId("auth-verify-otp").click();
    await phoneAuthModal.waitFor({ state: "hidden" });
    await ownedCardOnNewPhone.getByTestId("owned-badge").waitFor();
    await phonePage.getByTestId("auth-chip-account").click();
    await phonePage.getByTestId("auth-owned-count").waitFor();
    assert.match(await phonePage.getByTestId("auth-owned-count").innerText(), /1 paket dimiliki/);
    assert.ok(await phonePage.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "Zero horizontal overflow on account sheet at 320x640");
    await phonePage.keyboard.press("Escape");
    await phoneAuthModal.waitFor({ state: "hidden" });
    assert.ok(await phonePage.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "Zero horizontal overflow on signed-in catalog at 320x640");
    await ownedCardOnNewPhone.click();
    await phonePage.getByRole("button", { name: "Main Solo", exact: true }).click();
    await phonePage.getByText("Pass Berbayar").waitFor();
    const restoredRoomCode = new URL(phonePage.url()).searchParams.get("room");
    assert.ok(restoredRoomCode && restoredRoomCode.startsWith("RC-"), "Signed-in second device must launch paid room cleanly");
    await newPhone.request.post(`${baseUrl}/api/rulebooks`, {
      data: { type: "room-action", roomCode: restoredRoomCode, action: { type: "leave", actionId: "leave-restored-room" } },
    });
  } finally {
    await newPhone.close();
  }

  await author({ type: "pause-version", packId: fixture.meta.packId, version: 2, reason: "Edisi latihan selesai" });
  await pageCreator.goto(`${baseUrl}/?edition=${fixture.meta.packId}&version=2`);
  await pageCreator.getByRole("alert").filter({ hasText: "Edisi ini tidak tersedia" }).waitFor();
  await ctxCreator.close();

  // Live multiplayer Claim rival presence (SSE event: presence, freshness/stale cues, check-in fallback, polling fallback, activity timestamps, 390x844 & 320x640)
  const presHostCtx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const presGuestCtx = await browser.newContext({ viewport: { width: 320, height: 640 } });
  const presHostPage = await presHostCtx.newPage();
  const presGuestPage = await presGuestCtx.newPage();
  try {
    // Allow Host to push simulated watchPosition updates and Guest to deny GPS + shift clock for staleness verification
    await presHostPage.addInitScript(() => {
      let cb = null;
      window.__pushWatchFix = (latitude, longitude, accuracy = 10) => {
        if (cb) cb({ coords: { latitude, longitude, accuracy }, timestamp: Date.now() });
      };
      Object.defineProperty(navigator, "geolocation", {
        configurable: true,
        value: {
          watchPosition(success) {
            cb = success;
            return 1;
          },
          clearWatch() {
            cb = null;
          },
          getCurrentPosition(success) {
            success({ coords: { latitude: -6.2442, longitude: 106.7991, accuracy: 10 }, timestamp: Date.now() });
          },
        },
      });
    });
    await presGuestPage.addInitScript(() => {
      window.__clockSkewMs = 0;
      const RealDateNow = Date.now.bind(Date);
      Date.now = () => RealDateNow() + window.__clockSkewMs;
      Object.defineProperty(navigator, "geolocation", {
        configurable: true,
        value: {
          watchPosition(_success, error) {
            error?.({ code: 1 });
            return 1;
          },
          clearWatch() {},
          getCurrentPosition(_success, error) {
            error?.({ code: 1 });
          },
        },
      });
    });

    const listingsRes = await presHostCtx.request.get(`${baseUrl}/api/rulebooks?format=claim-the-city`);
    const officialClaim = (await listingsRes.json()).listings.find((l) => l.isOfficial && l.priceIdr === 0);
    const createdPres = await presHostCtx.request.post(`${baseUrl}/api/rulebooks`, {
      data: { type: "create-free-room", packId: officialClaim.packId, version: officialClaim.version, mode: "group", hostName: "Alvin" },
    });
    const presCode = (await createdPres.json()).roomCode;
    await presGuestCtx.request.post(`${baseUrl}/api/rulebooks`, {
      data: { type: "join-room", roomCode: presCode, name: "Dina" },
    });

    await presHostPage.goto(`${baseUrl}/?play=rulebook-claim&room=${presCode}`);
    await presGuestPage.goto(`${baseUrl}/?play=rulebook-claim&room=${presCode}`);
    await presHostPage.getByText("Lokasi dibagikan ke pemain di ruang selama ronde aktif.").waitFor();
    assert.ok(await presGuestPage.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "Zero horizontal overflow in 320x640 Claim lobby");

    // Start match via API for speed, then verify live active board
    const roomMetaRes = await presHostCtx.request.get(`${baseUrl}/api/rulebooks/rooms/${presCode}`);
    const roomMeta = await roomMetaRes.json();
    const sp = roomMeta.publicBoard.startPoint;
    const lm0 = roomMeta.publicBoard.landmarks[0];
    const lm1 = roomMeta.publicBoard.landmarks[1] ?? lm0;
    const nowStart = roomMeta.room.now;
    for (const [idx, ctx] of [presHostCtx, presGuestCtx].entries()) {
      await ctx.request.post(`${baseUrl}/api/rulebooks`, {
        data: { type: "room-action", roomCode: presCode, action: { type: "check-in-start", actionId: `p-ci-${idx}`, fix: { latitude: sp.latitude, longitude: sp.longitude, accuracy: 10, timestamp: nowStart } } },
      });
      await ctx.request.post(`${baseUrl}/api/rulebooks`, {
        data: { type: "room-action", roomCode: presCode, action: { type: "ready", actionId: `p-rdy-${idx}`, ready: true } },
      });
    }
    await presHostCtx.request.post(`${baseUrl}/api/rulebooks`, {
      data: { type: "room-action", roomCode: presCode, action: { type: "start", actionId: "p-start" } },
    });

    await presHostPage.locator("#rb-claim-map-host .maplibregl-canvas").waitFor();
    await presGuestPage.locator("#rb-claim-map-host .maplibregl-canvas").waitFor();
    await presGuestPage.evaluate(() => {
      window.__guestCanvasRef = document.querySelector("#rb-claim-map-host .maplibregl-canvas");
    });

    // Track GET /api/rulebooks/rooms/${presCode} count on Guest while receiving live SSE presence
    let guestRoomGetsDuringPresence = 0;
    presGuestPage.on("request", (req) => {
      if (req.method() === "GET" && req.url().includes(`/api/rulebooks/rooms/${presCode}`) && !req.url().endsWith("/events")) {
        guestRoomGetsDuringPresence += 1;
      }
    });

    // Host emits live GPS fix via watchPosition -> Guest receives rival pin in < 1.5s without GET refetch or canvas remount
    const pingSentAt = Date.now();
    await presHostPage.evaluate(({ lat, lng }) => window.__pushWatchFix(lat, lng, 12), {
      lat: lm0.latitude + 0.00015,
      lng: lm0.longitude - 0.00012,
    });
    const hostPinOnGuest = presGuestPage.locator('[data-rival-seat="seat-1"]');
    await hostPinOnGuest.waitFor({ timeout: 2500 });
    assert.ok(Date.now() - pingSentAt < 2500, "Rival pin must render quickly via SSE presence");
    assert.equal(await hostPinOnGuest.getAttribute("data-freshness"), "fresh");
    assert.equal(await hostPinOnGuest.getAttribute("data-source"), "gps");
    assert.equal(guestRoomGetsDuringPresence, 0, "SSE presence update must not trigger redundant room GET refetch");
    assert.equal(
      await presGuestPage.evaluate(() => document.querySelector("#rb-claim-map-host .maplibregl-canvas") === window.__guestCanvasRef),
      true,
      "MapLibre canvas must update in-place without teardown on presence updates",
    );

    // Fold the bottom sheet on 320x640 so the map pin is unobstructed, then tap the rival pin -> opens rival card
    await presGuestPage.locator('button[data-action="fold"]').click();
    await hostPinOnGuest.click();
    const rivalCard = presGuestPage.getByTestId("claim-rival-card");
    await rivalCard.waitFor();
    assert.match(await rivalCard.innerText(), /Alvin/);
    assert.match(await rivalCard.innerText(), /Baru saja|dtk lalu/);
    assert.ok(await presGuestPage.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "Zero overflow on 320x640 with rival card open");

    // Advance Guest's local clock by 3 minutes -> pin and rival card transition smoothly to stale ("Terakhir dilihat ...")
    await presGuestPage.evaluate(() => {
      window.__clockSkewMs = 185_000;
    });
    await presGuestPage.waitForFunction(() => {
      const pin = document.querySelector('[data-rival-seat="seat-1"]');
      return pin?.getAttribute("data-freshness") === "stale" && pin.classList.contains("board-map-pin-stale");
    });
    assert.match(await rivalCard.innerText(), /Terakhir dilihat 3 mnt lalu/);

    // Guest has GPS denied -> verified landmark check-in populates source="checkin" pin on Host
    const guestCiRes = await presGuestCtx.request.post(`${baseUrl}/api/rulebooks`, {
      data: {
        type: "room-action",
        roomCode: presCode,
        action: {
          type: "check-in-landmark",
          actionId: "guest-fallback-ci",
          landmarkId: lm1.id,
          fix: { latitude: lm1.latitude, longitude: lm1.longitude, accuracy: 10, timestamp: now },
        },
      },
    });
    assert.equal(guestCiRes.status(), 200);
    const guestPinOnHost = presHostPage.locator('[data-rival-seat="seat-2"]');
    await guestPinOnHost.waitFor({ timeout: 2500 });
    assert.equal(await guestPinOnHost.getAttribute("data-source"), "checkin");

    // Check Aktivitas terbaru relative timestamps and Skor player positions on both 390x844 and 320x640
    await presHostPage.locator('.sg-nav button[data-panel="score"]').click();
    await presHostPage.getByRole("list", { name: "Posisi Pemain" }).waitFor();
    assert.match(await presHostPage.getByRole("list", { name: "Posisi Pemain" }).innerText(), /Dina/);
    await presHostPage.locator(".sg-room-menu summary").click();
    await presHostPage.locator('.sg-room-menu-actions button[data-panel="activity"]').click();
    await presHostPage.locator("[data-activity-at]").first().waitFor();
    assert.match(await presHostPage.locator("[data-activity-at]").first().innerText(), /Baru saja|dtk lalu|mnt lalu/);
    assert.ok(await presHostPage.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "Zero overflow on 390x844 Claim activity panel");

    // Abort /events on Guest -> polling fallback still picks up updated Host position
    await presGuestPage.evaluate(() => {
      window.__clockSkewMs = 0;
    });
    await presGuestCtx.route("**/events", (route) => route.abort("failed"));
    await presGuestPage.reload();
    await presGuestPage.locator("#rb-claim-map-host .maplibregl-canvas").waitFor();
    now += 12_000;
    const pollPing = await presHostCtx.request.post(`${baseUrl}/api/rulebooks/rooms/${presCode}/presence`, {
      data: { fix: { latitude: lm1.latitude + 0.0002, longitude: lm1.longitude + 0.0002, accuracy: 10, timestamp: now } },
    });
    assert.equal(pollPing.status(), 200);
    await presGuestPage.waitForFunction(
      () => document.querySelector('[data-rival-seat="seat-1"]')?.getAttribute("data-source") === "gps",
      undefined,
      { timeout: 6000 },
    );
  } finally {
    await presHostCtx.close();
    await presGuestCtx.close();
  }

  // #142: Home Gabung Ruang modal, Lobby Invite Card + offline SVG QR, inline rename, ready toggle, dynamic Claim teams, leave/cancel confirmations & SSE canceled screen
  const lHostCtx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const lG2Ctx = await browser.newContext({ viewport: { width: 320, height: 640 } });
  const lG3Ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const lHost = await lHostCtx.newPage();
  const lG2 = await lG2Ctx.newPage();
  const lG3 = await lG3Ctx.newPage();
  try {
    await lHost.goto(catalogUrl(baseUrl), { waitUntil: "networkidle" });
    await lHost.locator('.cat-card[data-pack-id="official-jakarta-compact-claim"]').click();
    await lHost.getByRole("button", { name: "Grup", exact: true }).click();
    await lHost.getByRole("button", { name: "Main Grup", exact: true }).click();
    await lHost.getByTestId("lobby-invite-card").waitFor();
    const lobbyCode = (await lHost.getByTestId("lobby-room-code").innerText()).trim();
    assert.match(lobbyCode, /^RC-/);
    assert.ok(await lHost.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "Zero overflow on Claim lobby with Invite Card (390x844)");

    // Offline inline-SVG QR modal fires zero network requests
    let qrNetworkCount = 0;
    const onQrReq = () => { qrNetworkCount++; };
    lHost.on("request", onQrReq);
    await lHost.getByTestId("show-qr-btn").click();
    const qrModal = lHost.getByTestId("qr-modal");
    await qrModal.waitFor();
    assert.equal(await qrModal.locator("svg.lobby-qr-svg path").count(), 1, "QR modal must render inline SVG");
    assert.equal(qrNetworkCount, 0, "Offline SVG QR modal must make zero network requests");
    assert.ok(await lHost.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "Zero overflow on QR modal (390x844)");
    lHost.off("request", onQrReq);
    await lHost.keyboard.press("Escape");
    await qrModal.waitFor({ state: "hidden" });

    // Host inline nickname edit (rename-seat)
    await lHost.getByTestId("edit-own-name").click();
    await lHost.fill("#cg-rename-input", "Kapten Andi");
    await lHost.getByTestId("save-own-name").click();
    await lHost.waitForFunction(() => document.body.textContent.includes("Kapten Andi"));

    // Guest 2 joins from Catalog Gabung Ruang modal on 320x640 with lowercase + spaces
    await lG2.goto(catalogUrl(baseUrl), { waitUntil: "networkidle" });
    await lG2.getByTestId("home-join-room-btn").click();
    const joinModal = lG2.getByTestId("join-room-modal");
    await joinModal.waitFor();
    assert.ok(await lG2.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "Zero overflow on Home Gabung Ruang modal (320x640)");
    await lG2.fill("#cat-join-code", `  ${lobbyCode.toLowerCase()}  `);
    await lG2.fill("#cat-join-name", "Bela");
    await lG2.getByTestId("join-modal-submit").click();
    await lG2.getByTestId("claim-team-switcher").waitFor();
    assert.ok(await lG2.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "Zero overflow on Claim Group lobby (320x640)");

    // #150: Claim lobby onboarding on 320x640 guest: cue strip, outdoor readiness, ? Panduan -> Coba Panduan without disconnecting, cue dismissal persistence
    const claimLobbyCue = lG2.locator('[data-testid="phase-cue-strip"][data-cue-key="claim-lobby"]');
    await claimLobbyCue.waitFor();
    assert.match(await claimLobbyCue.innerText(), /Check-in di Titik Awal/);
    await lG2.getByTestId("lobby-readiness-strip").waitFor();
    await lG2.getByTestId("lobby-quick-guide-btn").click();
    const g2Guide = lG2.getByTestId("quick-guide-modal");
    await g2Guide.waitFor();
    assert.equal(await g2Guide.getAttribute("role"), "dialog");
    assert.equal(await g2Guide.getAttribute("aria-modal"), "true");
    assert.match(await g2Guide.innerText(), /Claim Grup/);
    assert.ok(await lG2.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "Zero overflow on Claim lobby Quick Guide (320x640)");
    await lG2.getByTestId("quick-guide-practice-btn").click();
    const g2Practice = lG2.locator("#edition-practice[open]");
    await g2Practice.waitFor();
    assert.match(await g2Practice.getByTestId("practice-progress").innerText(), /Langkah 1\//);
    await lG2.keyboard.press("Escape");
    await g2Practice.waitFor({ state: "hidden" });
    await lG2.getByTestId("claim-team-switcher").waitFor();
    await claimLobbyCue.getByTestId("phase-cue-dismiss").click();
    assert.equal(await claimLobbyCue.count(), 0);
    await lG2.reload({ waitUntil: "networkidle" });
    await lG2.getByTestId("claim-team-switcher").waitFor();
    assert.equal(await claimLobbyCue.count(), 0, "Dismissed Claim lobby cue must persist across reload");

    // Guest 3 joins via Catalog Gabung Ruang modal as Ciko
    await lG3.goto(catalogUrl(baseUrl), { waitUntil: "networkidle" });
    await lG3.getByTestId("home-join-room-btn").click();
    await lG3.fill("#cat-join-code", lobbyCode);
    await lG3.fill("#cat-join-name", "Ciko");
    await lG3.getByTestId("join-modal-submit").click();
    await lG3.getByTestId("claim-team-switcher").waitFor();
    await lHost.waitForFunction(() => document.body.textContent.includes("Kursi Pemain (3/4)"));

    // Dynamic Claim teams: G2 & G3 join Tim 1 -> all 3 on 1 team -> Host Mulai Permainan disabled + hint visible
    await lG2.locator('button[data-action="join-team"]').first().click();
    await lG3.locator('button[data-action="join-team"]').first().click();
    await lHost.getByTestId("not-enough-teams-hint").waitFor();
    assert.equal(await lHost.locator('button[data-action="start-match"]').isDisabled(), true, "Start must be disabled with <2 teams");

    // G3 clicks + Tim Baru -> forms 2v1 layout (Andi+Bela vs Ciko) -> Mulai Permainan enabled again
    await lG3.getByTestId("new-team-btn").click();
    await lHost.waitForFunction(() => !document.querySelector('[data-testid="not-enough-teams-hint"]'));
    assert.equal(await lHost.locator('button[data-action="start-match"]').isDisabled(), false, "Start must enable with >=2 teams");

    // G2 check-in start + toggle Tandai Siap <-> Batal Siap
    await lG2.locator('button[data-action="sim-start-checkin"]').click();
    await lG2.locator('button[data-action="mark-ready"]').click();
    await lG2.locator('button[data-action="unmark-ready"]').waitFor();
    await lG2.locator('button[data-action="unmark-ready"]').click();
    await lG2.locator('button[data-action="mark-ready"]').waitFor();

    // G3 leaves lobby cleanly via Tinggalkan Lobi confirmation dialog -> Host sees 2/4
    await lG3.getByTestId("lobby-leave-btn").click();
    await lG3.getByTestId("confirm-dialog").waitFor();
    await lG3.getByTestId("confirm-dialog-submit").click();
    await lG3.getByRole("heading", { name: "Pilih permainan", level: 1 }).waitFor();
    await lHost.waitForFunction(() => document.body.textContent.includes("Kursi Pemain (2/4)"));

    // Host cancels room via Batalkan Ruang -> G2 immediately sees SSE canceled-room-card
    await lHost.getByTestId("lobby-leave-btn").click();
    await lHost.getByTestId("confirm-dialog").waitFor();
    await lHost.getByTestId("confirm-dialog-submit").click();
    await lHost.getByRole("heading", { name: "Pilih permainan", level: 1 }).waitFor();
    await lG2.getByTestId("canceled-room-card").waitFor({ timeout: 5000 });
    assert.match(await lG2.getByTestId("canceled-room-card").innerText(), /Host membatalkan ruang ini/);
    await lG2.getByRole("button", { name: "Kembali ke Katalog" }).click();
    await lG2.getByRole("heading", { name: "Pilih permainan", level: 1 }).waitFor();
  } finally {
    await lHostCtx.close();
    await lG2Ctx.close();
    await lG3Ctx.close();
  }

  // #143: Self-location blue dot, accuracy halo, target ring, ◎ re-center, live distance meter, Terdekat sort, Google Maps directions, and Lobby Titik Awal mini-map (390x844 & 320x640)
  const navCtx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const navNarrowCtx = await browser.newContext({ viewport: { width: 320, height: 640 } });
  const navPage = await navCtx.newPage();
  const navNarrow = await navNarrowCtx.newPage();
  try {
    await navPage.addInitScript(() => {
      let cb = null;
      window.__pushNavFix = (latitude, longitude, accuracy = 12) => {
        if (cb) cb({ coords: { latitude, longitude, accuracy }, timestamp: Date.now() });
      };
      Object.defineProperty(navigator, "permissions", {
        configurable: true,
        value: {
          query: async () => ({ state: "prompt", addEventListener() {} }),
        },
      });
      Object.defineProperty(navigator, "geolocation", {
        configurable: true,
        value: {
          watchPosition(success) {
            cb = success;
            return 42;
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

    const listingsRes = await navCtx.request.get(`${baseUrl}/api/rulebooks?format=claim-the-city`);
    const officialClaim = (await listingsRes.json()).listings.find((l) => l.isOfficial && l.priceIdr === 0);
    const createdNav = await navCtx.request.post(`${baseUrl}/api/rulebooks`, {
      data: { type: "create-free-room", packId: officialClaim.packId, version: officialClaim.version, mode: "solo", hostName: "NavSolo" },
    });
    const navCode = (await createdNav.json()).roomCode;
    const navRoomData = await (await navCtx.request.get(`${baseUrl}/api/rulebooks/rooms/${navCode}`)).json();
    const sp = navRoomData.publicBoard.startPoint;
    const lmList = navRoomData.publicBoard.landmarks;
    const targetLm = lmList[lmList.length - 1];
    const checkRadius = navRoomData.publicBoard.checkInRadiusMeters;
    const maxAcc = navRoomData.publicBoard.maxGpsAccuracyMeters;
    assert.ok(checkRadius > 0 && maxAcc > 0, "Claim publicBoard must expose data-driven GPS thresholds");

    await navPage.goto(`${baseUrl}/?play=rulebook-claim&room=${navCode}`, { waitUntil: "networkidle" });
    await navPage.getByTestId("lobby-start-card").waitFor();
    const lobbyDirHref = await navPage.getByTestId("lobby-directions-link").getAttribute("href");
    assert.ok(lobbyDirHref?.startsWith("https://www.google.com/maps/dir/?api=1&destination="), `Expected valid Google Maps URL, got ${lobbyDirHref}`);
    assert.ok(!lobbyDirHref.includes("travelmode="), "Google Maps directions link must omit fixed travelmode");

    // Permission-friendly startup: shows 1-tap Aktifkan Lokasi chip when permission is "prompt"
    await navPage.getByTestId("readiness-gps-btn").waitFor();
    await navPage.getByTestId("enable-live-location-btn").click();
    await navPage.getByTestId("lobby-start-map-toggle").click();
    await navPage.locator('#cg-start-minimap [data-map-ready="true"], #cg-start-minimap .maplibregl-canvas').first().waitFor();
    await navPage.evaluate(({ lat, lng }) => window.__pushNavFix(lat + 0.002, lng, 12), { lat: sp.latitude, lng: sp.longitude });
    await navPage.getByTestId("lobby-distance-meter").waitFor();
    assert.equal(await navPage.getByTestId("readiness-gps-status").getAttribute("data-gps-ready"), "true", "Outdoor readiness GPS chip must show ready once GPS fix arrives");
    assert.match(await navPage.getByTestId("readiness-gps-status").innerText(), /Siap ✓/);
    assert.equal(await navPage.getByTestId("lobby-distance-meter").getAttribute("data-proximity-state"), "out-of-range");
    assert.match(await navPage.getByTestId("lobby-distance-meter").innerText(), new RegExp(`m lagi · butuh ≤ ${checkRadius} m`));
    await navPage.locator('#cg-start-minimap [data-testid="map-self-dot"]').waitFor();
    assert.ok(await navPage.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "Zero overflow on Claim lobby with Titik Awal mini-map (390x844)");

    // Move inside start radius -> lobby distance meter turns ready
    await navPage.evaluate(({ lat, lng }) => window.__pushNavFix(lat, lng, 10), { lat: sp.latitude, lng: sp.longitude });
    await navPage.waitForFunction(() => document.querySelector('[data-testid="lobby-distance-meter"]')?.getAttribute("data-proximity-state") === "ready");
    assert.match(await navPage.getByTestId("lobby-distance-meter").innerText(), /Dalam jangkauan/);

    // Start solo match -> active map shows self-dot, recenter button, and landmark list with live distances + Terdekat sort
    await navPage.locator('button[data-action="sim-start-checkin"]').click();
    await navPage.locator('button[data-action="mark-ready"]').click();
    await navPage.locator('button[data-action="start-match"]').click();
    await navPage.locator("#rb-claim-map-host .maplibregl-canvas").waitFor();
    await navPage.locator('#rb-claim-map-host [data-testid="map-self-dot"]').waitFor();
    await navPage.locator('#rb-claim-map-host [data-testid="map-recenter-btn"]').waitFor();
    await navPage.evaluate(() => {
      window.__navCanvas = document.querySelector("#rb-claim-map-host .maplibregl-canvas");
      window.__navSelfDot = document.querySelector('#rb-claim-map-host [data-testid="map-self-dot"]');
    });

    // Position player right next to the LAST landmark, toggle Terdekat -> targetLm sorts first!
    await navPage.evaluate(({ lat, lng }) => window.__pushNavFix(lat + 0.0001, lng, 12), {
      lat: targetLm.latitude,
      lng: targetLm.longitude,
    });
    await navPage.getByTestId("claim-sort-nearest").click();
    await navPage.waitForFunction(
      (expectedId) => document.querySelector('[data-testid="claim-landmark-list"] [data-landmark-list-item]')?.getAttribute("data-landmark-list-item") === expectedId,
      targetLm.id,
    );
    const firstDistText = await navPage.locator('[data-testid="claim-landmark-list"] .cg-landmark-dist-pill').first().innerText();
    assert.match(firstDistText, /^~\d+/);

    // Select targetLm -> shows dashed check-in ring on map, Google Maps directions, and live distance transitions: out-of-range -> noisy GPS -> ready
    await navPage.locator(`[data-action="select-landmark"][data-landmark="${targetLm.id}"]`).click();
    await navPage.getByTestId("claim-landmark-directions").waitFor();
    const lmDirHref = await navPage.getByTestId("claim-landmark-directions").getAttribute("href");
    assert.ok(lmDirHref?.includes(`${targetLm.latitude}`), `Expected landmark coordinates in Google Maps URL, got ${lmDirHref}`);
    assert.equal(await navPage.locator("#rb-claim-map-host").getAttribute("data-check-in-target"), String(checkRadius));

    // Out of range
    await navPage.evaluate(({ lat, lng }) => window.__pushNavFix(lat + 0.003, lng, 15), { lat: targetLm.latitude, lng: targetLm.longitude });
    await navPage.waitForFunction(() => document.querySelector('[data-testid="claim-landmark-distance-meter"]')?.getAttribute("data-proximity-state") === "out-of-range");
    assert.match(await navPage.getByTestId("claim-landmark-distance-meter").innerText(), /m lagi/);

    // Noisy GPS accuracy (> maxGpsAccuracyMeters)
    await navPage.evaluate(({ lat, lng, badAcc }) => window.__pushNavFix(lat, lng, badAcc), {
      lat: targetLm.latitude,
      lng: targetLm.longitude,
      badAcc: maxAcc + 50,
    });
    await navPage.waitForFunction(() => document.querySelector('[data-testid="claim-landmark-distance-meter"]')?.getAttribute("data-proximity-state") === "low-accuracy");
    assert.match(await navPage.getByTestId("claim-landmark-distance-meter").innerText(), /Akurasi GPS/);

    // Inside radius with clean accuracy -> ready + Check-in button emphasized
    await navPage.evaluate(({ lat, lng }) => window.__pushNavFix(lat, lng, 12), { lat: targetLm.latitude, lng: targetLm.longitude });
    await navPage.waitForFunction(() => document.querySelector('[data-testid="claim-landmark-distance-meter"]')?.getAttribute("data-proximity-state") === "ready");
    assert.match(await navPage.getByTestId("claim-landmark-distance-meter").innerText(), /Dalam jangkauan/);
    await navPage.locator('#rb-claim-map-host [data-testid="map-recenter-btn"]').click();

    // Persistent map & self-dot updated strictly in-place (zero canvas or self-dot teardown)
    assert.equal(
      await navPage.evaluate(() =>
        document.querySelector("#rb-claim-map-host .maplibregl-canvas") === window.__navCanvas &&
        document.querySelector('#rb-claim-map-host [data-testid="map-self-dot"]') === window.__navSelfDot,
      ),
      true,
      "Claim MapLibre canvas and self-location dot must update in-place without recreation",
    );
    assert.ok(await navPage.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "Zero overflow on Claim active board with distance meter (390x844)");

    // Verify 320x640 narrow mobile overflow on Claim active landmark sheet
    await navNarrow.goto(`${baseUrl}/?play=rulebook-claim&room=${navCode}`, { waitUntil: "networkidle" });
    await navNarrow.waitForTimeout(400);
    assert.ok(await navNarrow.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "Zero overflow on 320x640 Claim");
  } finally {
    await navCtx.close();
    await navNarrowCtx.close();
  }

  // #144: Post-match Main Lagi (free Solo & paid Group Host) + non-host paid-guest Gabung Ruang Baru & Lihat Paket Ini
  now += 61_000;
  const pmHostCtx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const pmGuestCtx = await browser.newContext({ viewport: { width: 320, height: 640 } });
  const pmHost = await pmHostCtx.newPage();
  const pmGuest = await pmGuestCtx.newPage();
  try {
    // 1) Free Solo match finishes -> Main Lagi creates a fresh Solo lobby for the exact same pack/version/mode
    const freeCreated = await (await pmHostCtx.request.post(`${baseUrl}/api/rulebooks`, {
      data: { type: "create-free-room", packId: "official-jakarta-compact-claim", version: 1, mode: "solo", hostName: "SoloReplay" },
    })).json();
    const freeCode = freeCreated.roomCode;
    const freeMeta = await (await pmHostCtx.request.get(`${baseUrl}/api/rulebooks/rooms/${freeCode}`)).json();
    const freeSp = freeMeta.publicBoard.startPoint;
    await pmHostCtx.request.post(`${baseUrl}/api/rulebooks`, {
      data: { type: "room-action", roomCode: freeCode, action: { type: "check-in-start", actionId: "pm-free-ci", fix: { latitude: freeSp.latitude, longitude: freeSp.longitude, accuracy: 10, timestamp: freeMeta.room.now } } },
    });
    await pmHostCtx.request.post(`${baseUrl}/api/rulebooks`, {
      data: { type: "room-action", roomCode: freeCode, action: { type: "ready", actionId: "pm-free-rdy", ready: true } },
    });
    await pmHostCtx.request.post(`${baseUrl}/api/rulebooks`, {
      data: { type: "room-action", roomCode: freeCode, action: { type: "start", actionId: "pm-free-start" } },
    });
    now += 3 * 60 * 60 * 1000;
    await pmHost.goto(`${baseUrl}/?play=rulebook-claim&room=${freeCode}`, { waitUntil: "networkidle" });
    await pmHost.getByTestId("claim-outcome").waitFor();
    const soloPlayAgainBtn = pmHost.getByTestId("postmatch-play-again");
    await soloPlayAgainBtn.waitFor();
    const soloBtnBox = await soloPlayAgainBtn.boundingBox();
    assert.ok(soloBtnBox && soloBtnBox.height >= 44, "Main Lagi button must meet 44px touch target");
    assert.ok(await pmHost.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "Zero overflow on Claim finished screen (390x844)");
    await soloPlayAgainBtn.click();
    await pmHost.waitForFunction((oldCode) => {
      const code = new URL(location.href).searchParams.get("room");
      return Boolean(code && code !== oldCode && document.body.textContent.includes("Ruang Tunggu"));
    }, freeCode);
    const freeReplayCode = new URL(pmHost.url()).searchParams.get("room");
    const freeReplayMeta = await (await pmHostCtx.request.get(`${baseUrl}/api/rulebooks/rooms/${freeReplayCode}`)).json();
    assert.equal(freeReplayMeta.pass.packId, "official-jakarta-compact-claim");
    assert.equal(freeReplayMeta.pass.version, 1);
    assert.equal(freeReplayMeta.pass.mode, "solo");

    // 2) Paid Group match finishes -> Host taps Main Lagi; non-host Guest sees Gabung Ruang Baru + Lihat Paket Ini (NO Main Lagi) and joins Host's new room
    now += 61_000;
    await signInQaContext(pmHostCtx, baseUrl, "buyer-v1@kelana.test", "Pembeli 1");
    const paidCreated = await (await pmHostCtx.request.post(`${baseUrl}/api/rulebooks`, {
      data: { type: "create-owned-room", packId: "pack-senopati-claim", version: 1, mode: "group", hostName: "Pembeli 1" },
    })).json();
    assert.equal(paidCreated.ok, true, `Expected paid group room creation to succeed: ${JSON.stringify(paidCreated)}`);
    const paidCode = paidCreated.roomCode;
    await pmGuestCtx.request.post(`${baseUrl}/api/rulebooks`, {
      data: { type: "join-room", roomCode: paidCode, name: "Tamu Berbayar" },
    });
    const paidMeta = await (await pmHostCtx.request.get(`${baseUrl}/api/rulebooks/rooms/${paidCode}`)).json();
    const paidSp = paidMeta.publicBoard.startPoint;
    for (const [idx, ctx] of [pmHostCtx, pmGuestCtx].entries()) {
      await ctx.request.post(`${baseUrl}/api/rulebooks`, {
        data: { type: "room-action", roomCode: paidCode, action: { type: "check-in-start", actionId: `pm-paid-ci-${idx}`, fix: { latitude: paidSp.latitude, longitude: paidSp.longitude, accuracy: 10, timestamp: paidMeta.room.now } } },
      });
      await ctx.request.post(`${baseUrl}/api/rulebooks`, {
        data: { type: "room-action", roomCode: paidCode, action: { type: "ready", actionId: `pm-paid-rdy-${idx}`, ready: true } },
      });
    }
    await pmHostCtx.request.post(`${baseUrl}/api/rulebooks`, {
      data: { type: "room-action", roomCode: paidCode, action: { type: "start", actionId: "pm-paid-start" } },
    });
    now += 3 * 60 * 60 * 1000;

    await pmHost.goto(`${baseUrl}/?play=rulebook-claim&room=${paidCode}`, { waitUntil: "networkidle" });
    await pmGuest.goto(`${baseUrl}/?play=rulebook-claim&room=${paidCode}`, { waitUntil: "networkidle" });
    await pmHost.getByTestId("claim-outcome").waitFor();
    await pmGuest.getByTestId("claim-outcome").waitFor();

    // Paid non-host guest must NOT see Main Lagi; sees Gabung Ruang Baru + Lihat Paket Ini + Buka ringkasan with zero 320x640 overflow
    assert.equal(await pmGuest.getByTestId("postmatch-play-again").count(), 0, "Non-host paid guest must not see Main Lagi");
    const guestJoinNewBtn = pmGuest.getByTestId("postmatch-join-new-room");
    const guestViewPackLink = pmGuest.getByTestId("postmatch-view-pack");
    await guestJoinNewBtn.waitFor();
    await guestViewPackLink.waitFor();
    const guestJoinBox = await guestJoinNewBtn.boundingBox();
    assert.ok(guestJoinBox && guestJoinBox.height >= 44, "Gabung Ruang Baru CTA must meet 44px touch target");
    assert.equal(await guestViewPackLink.getAttribute("href"), "/catalog?edition=pack-senopati-claim&version=1");
    assert.ok(await pmGuest.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "Zero overflow on paid guest Claim finished screen (320x640)");

    // Host taps Main Lagi -> opens brand-new paid Group lobby for pack-senopati-claim v1
    await pmHost.getByTestId("postmatch-play-again").click();
    await pmHost.waitForFunction((oldCode) => {
      const code = new URL(location.href).searchParams.get("room");
      return Boolean(code && code !== oldCode && document.body.textContent.includes("Ruang Tunggu"));
    }, paidCode);
    const paidReplayCode = new URL(pmHost.url()).searchParams.get("room");
    const paidReplayMeta = await (await pmHostCtx.request.get(`${baseUrl}/api/rulebooks/rooms/${paidReplayCode}`)).json();
    assert.equal(paidReplayMeta.pass.packId, "pack-senopati-claim");
    assert.equal(paidReplayMeta.pass.version, 1);
    assert.equal(paidReplayMeta.pass.mode, "group");

    // Non-host guest taps Gabung Ruang Baru -> enters Host's brand-new room code -> lands directly in Host's new lobby
    await guestJoinNewBtn.click();
    const qjDialog = pmGuest.getByTestId("join-room-modal");
    await qjDialog.waitFor();
    assert.ok(await pmGuest.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "Zero overflow on Gabung Ruang Baru modal (320x640)");
    await pmGuest.fill("#cat-join-code", paidReplayCode);
    await pmGuest.getByTestId("join-modal-submit").click();
    await pmGuest.waitForFunction((targetCode) => {
      return new URL(location.href).searchParams.get("room") === targetCode && document.body.textContent.includes("Ruang Tunggu");
    }, paidReplayCode);
    assert.ok(await pmGuest.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "Zero overflow after guest joins Host's new Claim lobby (320x640)");
  } finally {
    await pmHostCtx.close();
    await pmGuestCtx.close();
  }

  console.log("qa:rulebook-claim passed (Solo + 3-player Claim-Lock-Steal + Live Presence + Unified Studio + One-Time Pack Ownership + Lobby Teams/QR/Leave + Self-Location/Distance/Directions + Photo Compression/Post-Match Main Lagi)");
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
