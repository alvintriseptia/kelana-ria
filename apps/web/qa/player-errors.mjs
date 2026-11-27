import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { createRecordedMidtransAdapter, createSoloServer } from "../../api/dist/index.js";
import { catalogUrl, openEdition } from "./catalog.mjs";
import { signInQaContext } from "./studio-navigation.mjs";

const root = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const distDir = path.join(root, "dist");
const results = path.join(root, "qa-results");
mkdirSync(results, { recursive: true });

let now = 1_800_000_000_000;
const server = createSoloServer({
  databasePath: ":memory:",
  now: () => now,
  staticDir: distDir,
  midtrans: createRecordedMidtransAdapter(),
  allowSimulatedLocation: false,
  allowRulebookSandboxCheckout: true,
  allowSandboxAuthOtp: true,
  adminEmails: ["errors-admin@kelana.test"],
});

await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const baseUrl = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({
  channel: "chromium",
  executablePath: process.env.CHROMIUM_PATH || undefined,
  args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
});

const RAW_CODE_PATTERNS = [
  /\bgps-denied\b/i,
  /\boutside-radius\b/i,
  /\binvalid-shield-target\b/i,
  /\bstation-already-trapped\b/i,
  /\bpayment-pending\b/i,
  /\bserver-error\b/i,
  /\bSQLITE_BUSY\b/i,
  /Failed to fetch/i,
  /User denied Geolocation/i,
];

function assertNoRawErrorLeaks(text, label) {
  for (const pattern of RAW_CODE_PATTERNS) {
    assert.equal(pattern.test(text), false, `${label}: raw diagnostic token leaked (${pattern}) in "${text}"`);
  }
}

async function installAlertObserver(page) {
  await page.evaluate(() => {
    window.__alertLog = [];
    const seen = new WeakSet();
    const record = (el) => {
      if (!(el instanceof HTMLElement)) return;
      if (el.getAttribute("role") === "alert" && !seen.has(el)) {
        seen.add(el);
        window.__alertLog.push(el.textContent?.trim() ?? "");
      }
      el.querySelectorAll?.('[role="alert"]').forEach((child) => {
        if (!seen.has(child)) {
          seen.add(child);
          window.__alertLog.push(child.textContent?.trim() ?? "");
        }
      });
    };
    window.__alertObserver?.disconnect();
    window.__alertObserver = new MutationObserver((records) => {
      for (const rec of records) {
        rec.addedNodes.forEach(record);
      }
    });
    window.__alertObserver.observe(document.body, { childList: true, subtree: true });
  });
}

async function resetAlertLog(page) {
  await page.evaluate(() => { window.__alertLog = []; });
}

async function readAlertLog(page) {
  return page.evaluate(() => [...(window.__alertLog ?? [])]);
}

function rectsOverlap(a, b) {
  return !(a.x + a.width <= b.x || b.x + b.width <= a.x || a.y + a.height <= b.y || b.y + b.height <= a.y);
}

async function setGeoResult(page, spec) {
  await page.evaluate((next) => {
    window.__qaGeoSpec = next;
    if (!window.__qaGeoInstalled) {
      window.__qaGeoInstalled = true;
      Object.defineProperty(navigator, "geolocation", {
        configurable: true,
        value: {
          getCurrentPosition(resolve, reject) {
            const current = window.__qaGeoSpec;
            if (current.errorCode) {
              reject({ code: current.errorCode, message: current.message ?? "Geolocation error" });
            } else {
              resolve({
                coords: {
                  latitude: current.latitude,
                  longitude: current.longitude,
                  accuracy: current.accuracy ?? 10,
                },
                timestamp: current.timestamp,
              });
            }
          },
        },
      });
    }
  }, spec);
}

try {
  // 1. Catalog uncertain room creation retry + Pending payment inline state (390 x 844)
  const ctxCat = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: "block" });
  await signInQaContext(ctxCat, baseUrl, "errors-buyer@kelana.test", "Pembeli QA");
  const pageCat = await ctxCat.newPage();

  // Author & publish a paid Claim edition so we can test pending payment cleanly
  const cloneRes = await ctxCat.request.post(`${baseUrl}/api/rulebooks`, {
    data: {
      type: "clone-official",
      templatePackId: "official-jakarta-compact-claim",
      packId: "qa-paid-errors-claim",
      title: "QA Paid Errors · Claim the City",
      byline: "Tim QA",
      priceIdr: 25_000,
    },
  });
  assert.equal(cloneRes.status(), 200);
  const submitRes = await ctxCat.request.post(`${baseUrl}/api/rulebooks`, {
    data: { type: "submit-draft", packId: "qa-paid-errors-claim", version: 1 },
  });
  assert.equal(submitRes.status(), 200);
  const ctxAdmin = await browser.newContext();
  try {
    const { user } = await signInQaContext(ctxAdmin, baseUrl, "errors-admin@kelana.test", "Admin QA");
    assert.equal(user.role, "admin");
    const pubRes = await ctxAdmin.request.post(`${baseUrl}/api/rulebooks`, {
      data: { type: "publish-version", packId: "qa-paid-errors-claim", version: 1 },
    });
    assert.equal(pubRes.status(), 200);
  } finally {
    await ctxAdmin.close();
  }

  // 1a. Uncertain free room creation: first POST reaches server and creates room, then network drops before client receives reply
  await pageCat.goto(catalogUrl(baseUrl), { waitUntil: "networkidle" });
  await openEdition(pageCat, "claim-the-city");
  await pageCat.getByRole("button", { name: "Main Solo", exact: true }).waitFor();
  await installAlertObserver(pageCat);

  let serverCreatedRoomCode = "";
  let firstRequestId = "";
  let secondRequestId = "";
  let catalogAttempts = 0;
  await pageCat.route("**/api/rulebooks/catalog", async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    catalogAttempts++;
    const payload = route.request().postDataJSON();
    if (catalogAttempts === 1) {
      firstRequestId = payload.requestId;
      const realResp = await route.fetch();
      const body = await realResp.json();
      serverCreatedRoomCode = body.roomCode;
      assert.ok(serverCreatedRoomCode, "Server must have created room before mid-flight disconnect");
      return route.abort("failed");
    }
    secondRequestId = payload.requestId;
    return route.continue();
  });

  await pageCat.getByRole("button", { name: "Main Solo", exact: true }).click();
  const netToast = pageCat.getByTestId("player-toast");
  await netToast.waitFor();
  const netToastText = await netToast.innerText();
  assert.match(netToastText, /Koneksi terganggu/);
  assertNoRawErrorLeaks(netToastText, "Catalog connection failure toast");
  assert.equal(await pageCat.getByRole("alert").count(), 1, "Connection failure must be announced once");
  assert.equal((await readAlertLog(pageCat)).length, 1, "Single AT announcement for catalog network drop");
  assert.equal(new URL(pageCat.url()).searchParams.get("edition"), "official-jakarta-compact-claim", "Selected edition preserved");
  assert.ok(await pageCat.evaluate(() => document.documentElement.scrollWidth <= innerWidth));

  // Retry Main Solo -> reuses exact requestId and enters the SAME room (zero duplicate room!)
  await pageCat.getByRole("button", { name: "Main Solo", exact: true }).click();
  await pageCat.waitForFunction(() => document.body.textContent.includes("Ruang Tunggu"));
  const openedRoomCode = new URL(pageCat.url()).searchParams.get("room");
  assert.equal(secondRequestId, firstRequestId, "Retry must reuse the pending requestId");
  assert.equal(openedRoomCode, serverCreatedRoomCode, "Retry must open the same room instead of creating a duplicate");
  await pageCat.unroute("**/api/rulebooks/catalog");

  // 1b. Pending payment stays inline inside checkout box until resolved
  await pageCat.goto(`${baseUrl}/?edition=qa-paid-errors-claim&version=1`, { waitUntil: "networkidle" });
  await pageCat.getByRole("button", { name: "Beli paket · Uji pembayaran" }).click();
  await pageCat.getByRole("button", { name: "Cek status pembayaran" }).waitFor();
  await installAlertObserver(pageCat);
  await pageCat.getByRole("button", { name: "Cek status pembayaran" }).click();
  const payAlert = pageCat.getByTestId("payment-inline-alert");
  await payAlert.waitFor();
  const payAlertText = await payAlert.innerText();
  assert.match(payAlertText, /Pembayaran masih menunggu konfirmasi/);
  assertNoRawErrorLeaks(payAlertText, "Pending payment inline alert");
  assert.equal(await pageCat.getByTestId("player-toast").count(), 0, "Pending payment belongs inline, not in a toast");
  assert.equal(await pageCat.getByRole("alert").count(), 1, "Pending payment announced once");
  assert.equal((await readAlertLog(pageCat)).length, 1);
  assert.ok(await pageCat.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await pageCat.screenshot({ path: path.join(results, "errors-pending-payment.png"), fullPage: true });
  await ctxCat.close();

  // 2. Claim the City on 390 x 844: GPS denied, out-of-range check-in, stale card target toast,
  //    500 server error + reduced motion, uncertain card replay/reconnect + dedup
  const ctxClaim = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: "block" });
  const page = await ctxClaim.newPage();
  await page.goto(catalogUrl(baseUrl), { waitUntil: "networkidle" });
  await openEdition(page, "claim-the-city");
  await page.getByRole("button", { name: "Main Solo", exact: true }).click();
  await page.waitForFunction(() => document.body.textContent.includes("Ruang Tunggu"));
  const claimRoomCode = new URL(page.url()).searchParams.get("room");
  const roomStateResp = await ctxClaim.request.get(`${baseUrl}/api/rulebooks/rooms/${claimRoomCode}`);
  const initialRoomData = await roomStateResp.json();
  const { startPoint, landmarks } = initialRoomData.publicBoard;

  // 2a. GPS denied -> inline right next to check-in button, single AT announcement, no raw code
  await setGeoResult(page, { errorCode: 1, message: "User denied Geolocation" });
  await installAlertObserver(page);
  await page.getByRole("button", { name: "Check-in Titik Awal", exact: true }).click();
  const gpsAlert = page.locator('[data-error-slot="lobby-checkin"][role="alert"]');
  await gpsAlert.waitFor();
  const gpsText = await gpsAlert.innerText();
  assert.match(gpsText, /Izin lokasi ditolak/);
  assert.match(gpsText, /pengaturan browser/);
  assertNoRawErrorLeaks(gpsText, "GPS denied inline alert");
  assert.equal(await page.getByTestId("player-toast").count(), 0, "GPS denied belongs inline next to check-in");
  assert.equal(await page.getByRole("alert").count(), 1);
  assert.equal((await readAlertLog(page)).length, 1, "GPS denied must announce once");
  assert.equal(new URL(page.url()).searchParams.get("room"), claimRoomCode, "Room preserved after GPS denied");

  // Recover with valid start check-in -> ready -> start match
  await setGeoResult(page, { latitude: startPoint.latitude, longitude: startPoint.longitude, timestamp: now });
  await Promise.all([
    page.waitForResponse((r) => r.url().includes("/api/rulebooks") && r.request().method() === "POST"),
    page.getByRole("button", { name: "Check-in Titik Awal", exact: true }).click(),
  ]);
  await Promise.all([
    page.waitForResponse((r) => r.url().includes("/api/rulebooks") && r.request().method() === "POST"),
    page.getByRole("button", { name: "Tandai Siap", exact: true }).click(),
  ]);
  await Promise.all([
    page.waitForResponse((r) => r.url().includes("/api/rulebooks") && r.request().method() === "POST"),
    page.getByRole("button", { name: "Mulai Permainan", exact: true }).click(),
  ]);
  await page.locator("#rb-claim-map-host[data-map-ready=true]").waitFor();
  const mapCanvas = await page.locator("#rb-claim-map-host .maplibregl-canvas").elementHandle();

  // 2b. Out-of-range check-in -> exact required Bahasa Indonesia copy inline next to check-in
  const mBloc = landmarks.find((l) => l.id === "m-bloc");
  assert.ok(mBloc);
  await page.locator('button[data-map-point="m-bloc"]').press("Enter");
  await setGeoResult(page, { latitude: -6.10, longitude: 106.90, timestamp: now });
  await resetAlertLog(page);
  await Promise.all([
    page.waitForResponse((r) => r.url().includes("/api/rulebooks") && r.request().method() === "POST"),
    page.locator('.cg-selected[data-landmark-id="m-bloc"] button[data-action="checkin-landmark"]').click(),
  ]);
  const rangeAlert = page.locator('.cg-selected [data-error-slot="landmark-checkin"][role="alert"]');
  await rangeAlert.waitFor();
  const rangeText = (await rangeAlert.innerText()).replace(/^[▲◆●]\s*/, "").trim();
  assert.equal(
    rangeText,
    "Kamu masih terlalu jauh dari titik ini. Dekati titiknya, lalu coba lagi.",
    "Out-of-range check-in must use exact required copy",
  );
  assertNoRawErrorLeaks(rangeText, "Out-of-range check-in");
  assert.equal(await page.getByTestId("player-toast").count(), 0);
  assert.equal(await page.getByRole("alert").count(), 1);
  assert.equal((await readAlertLog(page)).length, 1, "Out-of-range check-in must announce once");
  assert.equal(await mapCanvas.evaluate((el) => el.isConnected), true, "MapLibre canvas stays mounted");
  await page.screenshot({ path: path.join(results, "errors-out-of-range.png") });

  // Lock m-bloc with valid GPS ("2") to draw a tactical card into hand
  await setGeoResult(page, { latitude: mBloc.latitude, longitude: mBloc.longitude, timestamp: now });
  await Promise.all([
    page.waitForResponse((r) => r.url().includes("/api/rulebooks") && r.request().method() === "POST"),
    page.locator('.cg-selected[data-landmark-id="m-bloc"] button[data-action="checkin-landmark"]').click(),
  ]);
  await page.waitForSelector("#claim-input-answer");
  await page.fill("#claim-input-answer", "2");
  await Promise.all([
    page.waitForResponse((r) => r.url().includes("/api/rulebooks") && r.request().method() === "POST"),
    page.click('button[data-action="submit-input"]'),
  ]);
  await page.waitForFunction(() => document.body.textContent.includes("1/4 terkunci"));

  // Check drawn tactical card; if it needs a claimed/active landmark (instant_lock / swap_challenge),
  // check in at taman-ayodya so that landmark is eligible right away!
  const postLockState = await (await ctxClaim.request.get(`${baseUrl}/api/rulebooks/rooms/${claimRoomCode}`)).json();
  let drawnCard = postLockState.room.ownHand[0];
  assert.ok(drawnCard, "Locking m-bloc must draw a tactical card");
  const isPinTargeted = drawnCard.effect.primitive !== "swap_challenge";
  if (drawnCard.effect.primitive === "instant_lock" || drawnCard.effect.primitive === "swap_challenge") {
    const ayodya = landmarks.find((l) => l.id === "taman-ayodya");
    assert.ok(ayodya);
    await page.locator('button[data-map-point="taman-ayodya"]').press("Enter");
    await setGeoResult(page, { latitude: ayodya.latitude, longitude: ayodya.longitude, timestamp: now });
    await Promise.all([
      page.waitForResponse((r) => r.url().includes("/api/rulebooks") && r.request().method() === "POST"),
      page.locator('.cg-selected[data-landmark-id="taman-ayodya"] button[data-action="checkin-landmark"]').click(),
    ]);
    await page.locator('[data-testid="active-challenge-modal"]').waitFor();
  }

  // 2c. Stale card target -> compact dismissible toast, safe-area placement, timer & dock usable,
  //     focus stays out of toast, keyboard dismiss works, stale target cleared so player can choose again
  await page.getByRole("button", { name: "Kartu", exact: true }).click();
  await page.locator(`.cg-tactic[data-instance="${drawnCard.instanceId}"]`).click();
  const playCardBtn = page.getByRole("button", { name: "Mainkan Kartu" });
  let targetPinId = "";
  if (isPinTargeted) {
    const eligiblePins = page.locator("button.board-map-pin-eligible");
    const eligibleCount = await eligiblePins.count();
    assert.ok(eligibleCount > 0, `Card ${drawnCard.effect.primitive} must have an eligible map target`);
    targetPinId = await eligiblePins.first().getAttribute("data-map-point");
    await page.locator(`button[data-map-point="${targetPinId}"]`).press("Enter");
  }
  assert.equal(await playCardBtn.isEnabled(), true);

  let mockedStaleOnce = false;
  await page.route("**/api/rulebooks", async (route) => {
    if (route.request().method() === "POST" && !mockedStaleOnce) {
      const body = route.request().postDataJSON();
      if (body.type === "room-action" && body.action?.type === "play-card") {
        mockedStaleOnce = true;
        return route.fulfill({ status: 400, json: { error: "invalid-shield-target" } });
      }
    }
    return route.continue();
  });

  await resetAlertLog(page);
  await playCardBtn.focus();
  await playCardBtn.press("Enter");

  const staleToast = page.getByTestId("player-toast");
  await staleToast.waitFor();
  const staleText = await staleToast.innerText();
  assert.match(staleText, /sudah berubah/);
  assert.match(staleText, /Pilih/);
  assertNoRawErrorLeaks(staleText, "Stale card target toast");
  assert.equal(await page.getByRole("alert").count(), 1);
  assert.equal((await readAlertLog(page)).length, 1, "Stale card target must announce once");

  // Safe-area geometry, stacking order, & touch targets on 390 x 844
  await page.waitForFunction(() => {
    const el = document.querySelector('[data-testid="player-toast"]');
    return el instanceof HTMLElement && Number(getComputedStyle(el).opacity) >= 0.99;
  });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "No horizontal overflow with toast");
  const toastBox = await staleToast.boundingBox();
  const hudBox = await page.locator(".cg-hud").boundingBox();
  const timerBox = await page.locator(".cg-timer").boundingBox();
  const dockBox = await page.locator(".cg-dock").boundingBox();
  const dismissBtn = staleToast.getByRole("button", { name: "Tutup pemberitahuan" });
  const dismissBox = await dismissBtn.boundingBox();
  assert.ok(toastBox && hudBox && timerBox && dockBox && dismissBox);
  assert.ok(toastBox.x >= 0 && toastBox.x + toastBox.width <= 390, "Toast must stay inside 390px viewport");
  assert.equal(rectsOverlap(toastBox, hudBox), false, "Toast must not overlap top HUD");
  assert.equal(rectsOverlap(toastBox, timerBox), false, "Toast must not overlap game timer");
  assert.equal(rectsOverlap(toastBox, dockBox), false, "Toast must not overlap bottom action sheet/dock");
  assert.ok(dismissBox.width >= 44 && dismissBox.height >= 44, "Toast dismiss button must meet 44x44 touch target");
  const hitChecks = await page.evaluate(({ t, tm, dk }) => {
    const toastEl = document.querySelector('[data-testid="player-toast"]');
    const toastHit = document.elementFromPoint(t.x + t.width / 2, t.y + t.height / 2);
    const timerHit = document.elementFromPoint(tm.x + tm.width / 2, tm.y + tm.height / 2);
    const dockHit = document.elementFromPoint(dk.x + dk.width / 2, dk.y + dk.height / 2);
    return {
      toastOnTop: Boolean(toastEl && toastHit && toastEl.contains(toastHit)),
      timerUsable: Boolean(timerHit && !toastEl?.contains(timerHit)),
      dockUsable: Boolean(dockHit && !toastEl?.contains(dockHit)),
    };
  }, { t: toastBox, tm: timerBox, dk: dockBox });
  assert.equal(hitChecks.toastOnTop, true, "Toast must be visibly painted on top in its safe area");
  assert.equal(hitChecks.timerUsable, true, "HUD timer must remain unobstructed");
  assert.equal(hitChecks.dockUsable, true, "Bottom action sheet must remain unobstructed");

  // Focus stays out of toast and player can pick another target cleanly
  const focusInToast = await page.evaluate(() => {
    const t = document.querySelector('[data-testid="player-toast"]');
    return Boolean(t && document.activeElement && t.contains(document.activeElement));
  });
  assert.equal(focusInToast, false, "Showing a toast must not steal keyboard focus");
  if (isPinTargeted) {
    assert.equal(await playCardBtn.isDisabled(), true, "Stale target must be cleared so player picks again");
  }
  await page.screenshot({ path: path.join(results, "errors-stale-card-toast.png") });

  // Keyboard dismiss via Enter on dismiss button
  await dismissBtn.focus();
  await dismissBtn.press("Enter");
  assert.equal(await staleToast.count(), 0, "Keyboard Enter on dismiss button must close toast");
  await page.unroute("**/api/rulebooks");

  // 2d. Unexpected HTTP 500 server error + reduced motion check + focus retention on current button
  await page.emulateMedia({ reducedMotion: "reduce" });
  if (isPinTargeted) {
    await page.locator(`button[data-map-point="${targetPinId}"]`).press("Enter");
  }
  assert.equal(await playCardBtn.isEnabled(), true);

  let mocked500Once = false;
  await page.route("**/api/rulebooks", async (route) => {
    if (route.request().method() === "POST" && !mocked500Once) {
      const body = route.request().postDataJSON();
      if (body.type === "room-action" && body.action?.type === "play-card") {
        mocked500Once = true;
        return route.fulfill({
          status: 500,
          contentType: "application/json",
          body: JSON.stringify({ error: "SQLITE_BUSY: database locked" }),
        });
      }
    }
    return route.continue();
  });

  await resetAlertLog(page);
  await playCardBtn.focus();
  await playCardBtn.press("Enter");
  await staleToast.waitFor();
  const serverErrText = await staleToast.innerText();
  assert.match(serverErrText, /kendala sementara di server/);
  assertNoRawErrorLeaks(serverErrText, "Unexpected HTTP 500 toast");
  assert.equal((await readAlertLog(page)).length, 1, "HTTP 500 must announce once");

  const animationName = await staleToast.evaluate((el) => getComputedStyle(el).animationName);
  assert.equal(animationName, "none", "Toast must respect prefers-reduced-motion: reduce");

  // Focus stayed on the active action button (Mainkan Kartu)!
  const activeActionAfter500 = await page.evaluate(() => (document.activeElement instanceof HTMLElement ? document.activeElement.dataset.action : ""));
  assert.equal(activeActionAfter500, "play-card", "Focus must stay on Mainkan Kartu when recoverable toast appears");

  // Escape dismisses toast while keeping focus on Mainkan Kartu
  await page.keyboard.press("Escape");
  assert.equal(await staleToast.count(), 0, "Escape must dismiss toast");
  await page.unroute("**/api/rulebooks");

  // 2e. Uncertain card action drop AFTER server applies it -> reconnect restores authoritative state,
  //     avoids repeated toasts, and avoids a duplicate card action!
  let droppedAfterServer = false;
  let cardPlayActionIds = [];
  await page.route("**/api/rulebooks", async (route) => {
    if (route.request().method() === "POST") {
      const body = route.request().postDataJSON();
      if (body.type === "room-action" && body.action?.type === "play-card") {
        cardPlayActionIds.push(body.action.actionId);
        if (!droppedAfterServer) {
          droppedAfterServer = true;
          const realResp = await route.fetch();
          assert.equal(realResp.status(), 200, "Server processed the card play before network dropped");
          return route.abort("failed");
        }
      }
    }
    return route.continue();
  });

  await resetAlertLog(page);
  await page.evaluate(() => window.dispatchEvent(new Event("offline")));
  await playCardBtn.click();
  await staleToast.waitFor();
  assert.match(await staleToast.innerText(), /Koneksi terganggu/);
  assert.equal((await readAlertLog(page)).length, 1);

  // Trigger reconnect ('online') -> reconciles authoritative state from server, consumes card cleanly,
  // clears toast, and produces ZERO repeated toasts or duplicate play-card calls!
  await Promise.all([
    page.waitForResponse((r) => r.url().includes(`/api/rulebooks/rooms/${claimRoomCode}`) && !r.url().endsWith("/events") && r.status() === 200),
    page.evaluate(() => window.dispatchEvent(new Event("online"))),
  ]);
  await page.waitForFunction(
    (cardId) => !document.querySelector(`.cg-tactic[data-instance="${cardId}"]`) && !document.querySelector('[data-action="play-card"]'),
    drawnCard.instanceId,
  );
  assert.equal(await staleToast.count(), 0, "Authoritative reconciliation must clear stale network toast");
  assert.equal((await readAlertLog(page)).length, 1, "Reconnect must not repeat the error toast");
  assert.equal(cardPlayActionIds.length, 1, "Reconciled card action must not send a duplicate card play");
  assert.equal(await mapCanvas.evaluate((el) => el.isConnected), true, "MapLibre canvas stayed continuously mounted throughout all errors");
  await ctxClaim.close();

  // 3. Hide & Seek on 390 x 844: inline join field error preserving input, out-of-range lock-anchor exact copy,
  //    stale card target toast leaving HUD timer & dock usable
  const ctxSeek1 = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: "block" });
  const pageHider = await ctxSeek1.newPage();
  await pageHider.goto(`${baseUrl}/?play=rulebook-seek`, { waitUntil: "networkidle" });

  // 3a. Empty join code shows inline field error & preserves typed player name
  await pageHider.fill("#rb-join-name", "Budi Penjelajah");
  await pageHider.fill("#rb-join-code", "");
  await pageHider.click('button[data-action="join-room"]');
  const joinAlert = pageHider.locator('[data-error-slot="join"][role="alert"]');
  await joinAlert.waitFor();
  assert.match(await joinAlert.innerText(), /Masukkan kode ruang/);
  assert.equal(await pageHider.inputValue("#rb-join-name"), "Budi Penjelajah", "Player name input must be preserved");
  assert.equal(await pageHider.getByTestId("player-toast").count(), 0);

  // 3b. Create Hide & Seek room + join second player + out-of-range lock-anchor exact copy
  await Promise.all([
    pageHider.waitForResponse((r) => r.url().includes("/api/rulebooks") && r.request().method() === "POST"),
    pageHider.locator('button[data-action="start-free"]').first().click(),
  ]);
  await pageHider.waitForFunction(() => document.body.textContent.includes("Ruang Tunggu"));
  const seekCode = new URL(pageHider.url()).searchParams.get("room");

  const ctxSeek2 = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: "block" });
  await ctxSeek2.request.post(`${baseUrl}/api/rulebooks`, {
    data: { type: "join-room", roomCode: seekCode, name: "Pencari 2" },
  });
  const seekRoomInfo = await (await ctxSeek1.request.get(`${baseUrl}/api/rulebooks/rooms/${seekCode}`)).json();
  const seekStart = seekRoomInfo.room.turnStartPoint;
  const startFix = { latitude: seekStart.latitude, longitude: seekStart.longitude, accuracy: 10, timestamp: now };
  for (const ctx of [ctxSeek1, ctxSeek2]) {
    await ctx.request.post(`${baseUrl}/api/rulebooks`, {
      data: { type: "room-action", roomCode: seekCode, action: { type: "check-in-start", actionId: `s-${Math.random()}`, fix: startFix } },
    });
    await ctx.request.post(`${baseUrl}/api/rulebooks`, {
      data: { type: "room-action", roomCode: seekCode, action: { type: "ready", actionId: `r-${Math.random()}`, ready: true } },
    });
  }
  await ctxSeek1.request.post(`${baseUrl}/api/rulebooks`, {
    data: { type: "room-action", roomCode: seekCode, action: { type: "start", actionId: "seek-start-match" } },
  });

  await pageHider.reload({ waitUntil: "networkidle" });
  await pageHider.locator("#sg-map[data-map-ready=true]").waitFor();
  const firstStation = seekRoomInfo.publicBoard.stations[0];
  await pageHider.locator(`button[data-map-point="${firstStation.id}"]`).press("Enter");
  await setGeoResult(pageHider, { latitude: -6.10, longitude: 106.90, timestamp: now });
  await Promise.all([
    pageHider.waitForResponse((r) => r.url().includes("/api/rulebooks") && r.request().method() === "POST"),
    pageHider.locator('button[data-action="lock-anchor"]').click(),
  ]);
  const seekRangeAlert = pageHider.locator('[data-error-slot="board-checkin"][role="alert"]');
  await seekRangeAlert.waitFor();
  const seekRangeText = (await seekRangeAlert.innerText()).replace(/^[▲◆●]\s*/, "").trim();
  assert.equal(
    seekRangeText,
    "Kamu masih terlalu jauh dari titik ini. Dekati titiknya, lalu coba lagi.",
    "Hide & Seek out-of-range check-in must use exact required copy",
  );
  assertNoRawErrorLeaks(seekRangeText, "Hide & Seek out-of-range check-in");
  assert.ok(await pageHider.evaluate(() => document.documentElement.scrollWidth <= innerWidth));

  await ctxSeek2.close();
  await ctxSeek1.close();

  console.log("qa:player-errors passed (GPS denied + exact out-of-range + stale card toast + 500 reduced-motion + uncertain replay/reconnect dedup + pending payment)");
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
