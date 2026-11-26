import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { createRecordedMidtransAdapter, createSoloServer } from "../../api/dist/index.js";
import { openEdition } from "./catalog.mjs";
import { assertCleanUiCopy } from "./copy-guard.mjs";
import { openReview, reviewerKey, signInQaContext, startDraft } from "./studio-navigation.mjs";

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
  await pageSolo.locator('[data-panel="cards"][data-game-motion^="update:"]').waitFor();
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
    await clickAndWaitPost(pageSolo, '[data-action="play-card"]');
    await pageSolo.locator(`[data-map-point="${target}"][data-game-motion^="role:"]`).waitFor();
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

  // App restart simulation: open a fresh tab at / in the same browser context -> Lanjutkan Permainan banner appears and resumes the active game
  const pageRestart = await ctxSolo.newPage();
  await pageRestart.goto(baseUrl, { waitUntil: "networkidle" });
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
  await pageRestart.goto(baseUrl, { waitUntil: "networkidle" });
  await resumeBanner.waitFor();
  await dismissBtn.click();
  assert.equal(await resumeBanner.count(), 0, "Dismissing resume banner should hide it on the catalog");
  await ctxSolo.close();

  // 2. 3-player Claim the City FFA launched directly from / + invite link join
  const ctxP1 = await browser.newContext({ viewport: { width: 390, height: 844 }, recordVideo });
  const pageP1 = await ctxP1.newPage();
  await pageP1.goto(baseUrl, { waitUntil: "networkidle" });
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

  // Top app bar brand logo links back to home catalog (/) from edition detail, recaps, game screens, and Creator Studio
  const brandLink = pageVisitor.locator('header.mast a.brand[href="/"]');
  const brandBox = await brandLink.boundingBox();
  assert.ok(brandBox && brandBox.width >= 44 && brandBox.height >= 44, "Brand logo link must meet 44x44 touch target");
  await brandLink.click();
  await pageVisitor.getByRole("heading", { name: "Pilih permainan", level: 1 }).waitFor();
  assert.equal(new URL(pageVisitor.url()).search, "");
  assert.ok(await pageVisitor.evaluate(() => document.documentElement.scrollWidth <= innerWidth));

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

  // Bare /?play normalizes cleanly to the home catalog (/)
  await pageVisitor.goto(`${baseUrl}/?play`, { waitUntil: "networkidle" });
  await pageVisitor.getByRole("heading", { name: "Pilih permainan", level: 1 }).waitFor();
  assert.equal(new URL(pageVisitor.url()).search, "", "Bare /?play should normalize to /");
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
    await pageVisitor.getByRole("heading", { name: "Pilih permainan", level: 1 }).waitFor();
    assert.equal(new URL(pageVisitor.url()).search, "", `Clicking brand logo from ${route} should navigate to /`);
    assert.equal(await pageVisitor.evaluate(() => document.getElementById("play")?.hidden), true);
    assert.ok(await pageVisitor.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  }

  await ctxVisitor.close();
  await ctxP2.close();

  // 3. Creator opens unified Studio directly from /, clones Official Claim pack, walks 4-step stepper, publishes, buys via Midtrans
  const ctxCreator = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await signInQaContext(ctxCreator, baseUrl, "claim-creator@kelana.test", "Kreator Claim");
  const pageCreator = await ctxCreator.newPage();
  await pageCreator.goto(baseUrl, { waitUntil: "networkidle" });
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

  // Step 4: dry-run & submit -> Reviewer publish
  await pageCreator.click('button[data-step="4"]');
  await pageCreator.click('button[data-action="dry-run"]');
  await pageCreator.waitForFunction(() => document.body.textContent.includes("Uji coba lolos"));
  await clickAndWaitPost(pageCreator, 'button[data-action="submit-draft"]');
  await pageCreator.waitForFunction(() => document.body.textContent.includes("diajukan ke peninjau"));
  await openReview(pageCreator);
  await clickAndWaitPost(pageCreator, 'button[data-action="publish"]');
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
    const reviewAction = data.type === "publish-version" || data.type === "pause-version";
    const res = await ctxCreator.request.post(`${baseUrl}/api/rulebooks`, {
      data,
      ...(reviewAction ? { headers: { authorization: `Bearer ${reviewerKey}` } } : {}),
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
      await shop.goto(baseUrl);
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
        await shop.goto(baseUrl);
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
    await phonePage.goto(baseUrl);
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
    await lHost.goto(baseUrl, { waitUntil: "networkidle" });
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

    // Guest 2 joins from Catalog Home Gabung Ruang modal on 320x640 with lowercase + spaces
    await lG2.goto(baseUrl, { waitUntil: "networkidle" });
    await lG2.getByTestId("home-join-room-btn").click();
    const joinModal = lG2.getByTestId("join-room-modal");
    await joinModal.waitFor();
    assert.ok(await lG2.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "Zero overflow on Home Gabung Ruang modal (320x640)");
    await lG2.fill("#cat-join-code", `  ${lobbyCode.toLowerCase()}  `);
    await lG2.fill("#cat-join-name", "Bela");
    await lG2.getByTestId("join-modal-submit").click();
    await lG2.getByTestId("claim-team-switcher").waitFor();
    assert.ok(await lG2.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "Zero overflow on Claim Group lobby (320x640)");

    // Guest 3 joins via Home Gabung Ruang modal as Ciko
    await lG3.goto(baseUrl, { waitUntil: "networkidle" });
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

  console.log("qa:rulebook-claim passed (Solo + 3-player Claim-Lock-Steal + Live Presence + Unified Studio + One-Time Pack Ownership + Lobby Teams/QR/Leave)");
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
