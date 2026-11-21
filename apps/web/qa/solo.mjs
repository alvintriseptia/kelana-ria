import assert from "node:assert/strict";
import { once } from "node:events";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { preview } from "vite";
import { createSoloServer } from "../../api/dist/index.js";
import { phoneOptions } from "./profile.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const results = join(root, "qa-results");
const fixtureAnswers = {
  "taman-literasi": "Setengah lingkaran",
  "blok-m-plaza": "Persegi",
  "m-bloc": "Dua",
  "taman-ayodya": "Burung",
  "stadion-madya": "Lari",
  "plaza-senayan": "03.00",
};
await mkdir(results, { recursive: true });
let clockOffset = 0;
const closed = new Set();
const now = () => Date.now() + clockOffset;
const api = createSoloServer({ databasePath: ":memory:", now, closedCheckpoints: () => closed });
api.listen(0, "127.0.0.1");
await once(api, "listening");

let browser;
let server;
try {
  server = await preview({
    root,
    preview: {
      host: "127.0.0.1",
      port: 0,
      proxy: { "/api": `http://127.0.0.1:${api.address().port}` },
    },
  });
  const origin = `http://127.0.0.1:${server.httpServer.address().port}`;
  browser = await chromium.launch({
    channel: "chromium", executablePath: process.env.CHROMIUM_PATH || undefined,
  });
  const context = await browser.newContext(phoneOptions(browser));
  const page = await context.newPage();
  const tileFailures = [];
  await context.route("**/assets/*solo-schematic*.webp", route => {
    tileFailures.push(route.request().url());
    return route.abort();
  });
  await page.addInitScript(() => {
    navigator.geolocation.getCurrentPosition = (success, failure) => {
      const fix = window.qaLocation;
      if (fix) {
        success({ coords: fix, timestamp: fix.timestamp });
      } else {
        failure({ code: 1, message: "Permission denied" });
      }
    };
  });

  async function state() {
    const response = await context.request.get(origin + "/api/solo");
    assert.ok(response.ok(), `State request returned ${response.status()}`);
    return (await response.json()).session;
  }

  async function command(action) {
    const response = await context.request.post(origin + "/api/solo", {
      data: { actionId: randomUUID(), sessionId: (await state()).id, ...action },
    });
    assert.ok(response.ok(), `Action returned ${response.status()}`);
    return (await response.json()).session;
  }

  async function click(name) {
    await page.getByRole("button", { name, exact: true }).click();
  }

  async function afterAction(button) {
    const [reply] = await Promise.all([
      page.waitForResponse(response => response.url().endsWith("/api/solo")
        && response.request().method() === "POST"),
      click(button),
    ]);
    return reply.json();
  }

  async function start() {
    await click("Check-in di titik awal");
    const check = await afterAction("Simulasikan lokasi di sini");
    assert.ok(check.session.startVerifiedUntil > now());
    const started = await afterAction("Mulai");
    assert.equal(started.session.phase, "active");
    return started.session;
  }

  async function prepareClaim(point) {
    await click(point.name);
    const { challenge } = await afterAction("Simulasikan lokasi di sini");
    assert.equal(challenge.checkpointId, point.id);
    await page.getByRole("radio", { name: fixtureAnswers[point.id], exact: true }).check();
  }

  async function claim(point) {
    await prepareClaim(point);
    return (await afterAction("Kirim jawaban")).session;
  }

  await page.goto(origin);
  await click("Lihat ringkasan");
  await page.getByRole("button", { name: "Coba simulasi", exact: true })
    .or(page.getByRole("link", { name: "Coba simulasi", exact: true })).click();
  await page.getByRole("button", { name: "Check-in di titik awal", exact: true }).waitFor();
  assert.match(await page.locator("main").innerText(), /Simulasi/i);
  const briefing = await state();
  assert.deepEqual(briefing.edition.targets, { landmarks: 4, zones: 2 });
  assert.equal(briefing.startedAt, null);
  await page.screenshot({ path: join(results, "solo-briefing.png"), fullPage: true });

  await click("Check-in di titik awal");
  await click("Check-in");
  await page.locator("#solo-action").getByText(/lokasi.*ditolak|izin.*ditolak/i).waitFor();
  assert.equal((await state()).startVerifiedUntil, null);
  await page.evaluate(fix => { window.qaLocation = fix; }, {
    latitude: briefing.edition.start.latitude,
    longitude: briefing.edition.start.longitude,
    timestamp: now() - 31_000,
    accuracy: 5,
  });
  const stale = await afterAction("Check-in");
  assert.ok(stale.error);
  assert.equal(stale.session.startVerifiedUntil, null);
  await page.clock.setFixedTime(new Date(now() + 45_000));
  await page.evaluate(point => {
    window.qaLocation = { latitude: point.latitude, longitude: point.longitude, timestamp: Date.now(), accuracy: 5 };
  }, briefing.edition.start);
  const skewedClock = await afterAction("Check-in");
  assert.equal(skewedClock.error, undefined);
  assert.ok(skewedClock.session.startVerifiedUntil > now());
  const checked = await afterAction("Simulasikan lokasi di sini");
  assert.ok(checked.session.startVerifiedUntil > now());
  const { session: active } = await afterAction("Mulai");
  assert.equal(active.phase, "active");
  assert.equal(active.deadline, active.startedAt + active.edition.durationMs);
  const duplicate = await command({ type: "start" });
  assert.equal(duplicate.deadline, active.deadline);
  assert.equal(duplicate.id, active.id);
  assert.equal(duplicate.events.filter(event => event.type === "started").length, 1);

  await page.getByRole("button", { name: "Lihat peta", exact: true }).press("Enter");
  await page.waitForFunction(() => /peta.*(gagal|tidak tersedia)/i.test(document.body.innerText));
  assert.equal(tileFailures.length, 1);
  await page.screenshot({ path: join(results, "solo-map-fallback.png"), fullPage: true });
  const zone = active.edition.checkpoints.find(p => active.edition.checkpoints
    .filter(q => q.zone === p.zone).length >= 4)?.zone;
  assert.ok(zone, "The first zone must offer four landmarks");
  const firstFour = active.edition.checkpoints.filter(point => point.zone === zone).slice(0, 4);
  const nextZone = active.edition.checkpoints.find(point => point.zone !== zone);
  await prepareClaim(firstFour[0]);
  const submittedIds = [];
  let dropAcknowledgment = true;
  const interceptAnswer = async route => {
    const request = route.request();
    if (request.method() !== "POST" || request.postDataJSON().type !== "answer") {
      return route.continue();
    }
    submittedIds.push(request.postDataJSON().actionId);
    if (!dropAcknowledgment) return route.continue();
    dropAcknowledgment = false;
    const committed = await route.fetch();
    assert.equal((await committed.json()).session.claimed.length, 1);
    return route.abort();
  };
  await context.route("**/api/solo", interceptAnswer);
  await click("Kirim jawaban");
  await page.getByRole("button", { name: "Coba lagi", exact: true }).waitFor();
  assert.match(await page.locator("main").innerText(), /Simulasi/i);
  const recovered = await afterAction("Coba lagi");
  assert.equal(recovered.session.claimed.length, 1);
  await page.getByRole("button", { name: firstFour[1].name, exact: true }).waitFor();
  await page.getByRole("button", { name: "Coba lagi", exact: true }).waitFor({ state: "hidden" });
  assert.equal(submittedIds.length, 2);
  assert.equal(submittedIds[0], submittedIds[1]);
  assert.equal((await state()).events.filter(event => event.type === "claimed").length, 1);
  await context.unroute("**/api/solo", interceptAnswer);

  let current;
  for (const point of firstFour.slice(1)) current = await claim(point);
  assert.equal(current.phase, "active");
  assert.equal(current.claimed.length, 4);
  assert.equal(current.zones.length, 1);
  await page.waitForFunction(() => document.querySelector('#solo-announcement[role="status"]')?.textContent
    === "4 landmark diklaim di 1 zona.");
  await page.reload();
  await page.getByRole("button", { name: nextZone.name, exact: true }).waitFor();
  assert.deepEqual((await state()).claimed, current.claimed);
  await page.screenshot({ path: join(results, "solo-four-claims.png"), fullPage: true });

  clockOffset = active.deadline - Date.now() - 15_000;
  await page.reload();
  const won = await claim(nextZone);
  assert.equal(won.phase, "won");
  assert.equal(won.claimed.length, 5);
  assert.equal(won.zones.length, 2);
  assert.equal(won.events.at(-1).type, "won");
  const resultHeading = page.getByRole("heading", { name: "Kamu menang", exact: true });
  await resultHeading.waitFor();
  assert.ok(await resultHeading.evaluate(el => el === document.activeElement), "Focus moves to the result");
  await page.screenshot({ path: join(results, "solo-win.png"), fullPage: true });
  await page.reload();
  await page.getByRole("heading", { name: "Kamu menang", exact: true }).waitFor();

  await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller));
  await context.setOffline(true);
  await page.reload();
  await page.getByRole("button", { name: "Coba lagi", exact: true }).waitFor();
  const offlineScreen = await page.locator("#play").innerText();
  assert.match(offlineScreen, /\bSimulasi\b/);
  assert.match(offlineScreen, /Edisi siap pakai/);
  await context.setOffline(false);
  await resultHeading.waitFor();
  assert.deepEqual((await state()).events, won.events);

  await click("Main lagi");
  const again = await start();
  assert.notEqual(again.id, active.id);
  clockOffset = again.deadline - Date.now();
  await page.reload();
  await page.getByRole("heading", { name: "Waktu habis", exact: true }).waitFor();
  const lost = await state();
  assert.equal(lost.phase, "lost");
  assert.equal(lost.events.at(-1).type, "expired");
  assert.equal(lost.events.at(-1).at, again.deadline);
  await page.screenshot({ path: join(results, "solo-expiry.png"), fullPage: true });

  // A20: Close Taman Literasi before replay starts; confirm old result stays readable and alternate open edition can be chosen.
  closed.add("taman-literasi");
  const blockedReplay = await afterAction("Main lagi");
  assert.equal(blockedReplay.error, "checkpoint-closed");
  assert.equal(blockedReplay.closedCheckpointId, "taman-literasi");
  await page.locator("#solo-view").getByText(/Taman Literasi ditutup sementara/i).waitFor();
  await page.getByRole("heading", { name: "Waktu habis", exact: true }).waitFor();
  assert.equal((await state()).id, lost.id);
  await page.screenshot({ path: join(results, "solo-closure-notice.png"), fullPage: true });

  const switched = await afterAction("Edisi lain");
  assert.equal(switched.error, undefined);
  assert.equal(switched.session.phase, "briefing");
  assert.equal(switched.session.edition.id, "compact-solo-kebayoran-v1");
  assert.ok(switched.session.edition.openings.length >= 2);
  await page.locator("#solo-view").getByText(/Geoapify/i).waitFor();
  closed.clear();
  // Delay the first cookie-bearing response while another tab opens the same fixture.
  const multiTab = await browser.newContext(phoneOptions(browser));
  try {
    let getCount = 0;
    await multiTab.route("**/api/solo", async route => {
      if (++getCount !== 1) return route.continue();
      const response = await fetch(route.request().url());
      const body = await response.text();
      await new Promise(resolve => setTimeout(resolve, 400));
      await route.fulfill({
        status: response.status,
        headers: Object.fromEntries(response.headers),
        body,
      });
    });
    const tabs = await Promise.all([multiTab.newPage(), multiTab.newPage()]);
    const ids = await Promise.all(tabs.map(async tab => {
      const [stateResponse] = await Promise.all([
        tab.waitForResponse(response => response.url().endsWith("/api/solo") && response.ok()),
        tab.goto(origin + "/?play=solo-claim"),
      ]);
      return (await stateResponse.json()).session.id;
    }));
    assert.equal(ids[0], ids[1], "Two tabs share the first session credential");
  } finally {
    await multiTab.close();
  }
  const publicEvents = ({ events }) => events.map(({ type, checkpointId }) => ({ type, checkpointId }));
  await writeFile(join(results, "solo-report.json"), JSON.stringify({
    browser: browser.version(), viewport: page.viewportSize(), simulated: true,
    tileFailures, duplicateStart: duplicate.startedAt === active.startedAt,
    recoveredDroppedAcknowledgment: true, recoveredOfflineReload: true, sharedFirstTabSession: true,
    evidence: {
      won: publicEvents(won), lost: publicEvents(lost),
      fixtureDigest: createHash("sha256").update(JSON.stringify(briefing.edition)).digest("hex"),
    },
  }, null, 2) + "\n");
  console.log("Mobile solo Claim passed permission recovery, tile fallback, refresh, win and expiry.");
} finally {
  await browser?.close();
  await server?.close();
  if (api.listening) await new Promise(resolve => api.close(resolve));
}
