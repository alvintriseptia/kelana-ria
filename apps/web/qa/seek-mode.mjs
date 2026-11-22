import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { createSoloServer } from "../../api/dist/index.js";

const root = fileURLToPath(new URL("..", import.meta.url));
const results = join(root, "qa-results");
await mkdir(results, { recursive: true });
const initialTime = 1_800_000_000_000;
const catalog = "/?play=rulebook-seek";
const packId = "official-jakarta-compact-seek";

async function startServer(allowHideSeekQa) {
  const server = createSoloServer({
    databasePath: ":memory:",
    now: () => initialTime,
    staticDir: join(root, "dist"),
    allowHideSeekQa,
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  return { server, origin: `http://127.0.0.1:${server.address().port}` };
}

const disabled = await startServer(false);
const enabled = await startServer(true);
let browser;
try {
  const listing = await fetch(`${disabled.origin}/api/rulebooks?format=hide-and-seek`).then(response => response.json());
  assert.equal(listing.allowHideSeekQa, false);
  const rejected = await fetch(`${disabled.origin}/api/rulebooks`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ type: "create-free-room", packId, version: listing.listings[0].version, qa: true }),
  });
  assert.equal(rejected.status, 403);
  assert.equal((await rejected.json()).error, "seek-qa-disabled");
  browser = await chromium.launch({
    channel: "chromium",
    executablePath: process.env.CHROMIUM_PATH || undefined,
    args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
  });
  const opts = { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true };
  const host = await browser.newPage(opts);
  const guest = await browser.newPage(opts);
  host.setDefaultTimeout(20_000);
  guest.setDefaultTimeout(20_000);

  async function clickAction(page, selector) {
    const [response] = await Promise.all([
      page.waitForResponse(r => r.url().endsWith("/api/rulebooks") && r.request().method() === "POST"),
      page.locator(selector).click(),
    ]);
    const data = await response.json();
    assert.equal(data.error, undefined, JSON.stringify(data));
    await page.waitForFunction(() => !document.querySelector('[aria-busy="true"]'));
    return response.request().postDataJSON();
  }

  function inviteCode(url) {
    return new URL(url).searchParams.get("room");
  }

  async function view(page, code) {
    const response = await page.request.get(`${enabled.origin}/api/rulebooks/rooms/${code}`);
    assert.equal(response.status(), 200);
    return response.json();
  }

  function advance(page, step) {
    return clickAction(page, `[data-action="qa-advance"][data-step="${step}"]`);
  }

  const invite = page => page.locator('[data-testid="invite-link"]').getAttribute("href");
  await host.goto(`${enabled.origin}${catalog}&pack=${packId}&launch=1`);
  const normalCode = inviteCode(await invite(host));
  assert.equal((await view(host, normalCode)).qa, undefined);
  await clickAction(host, '[data-action="start-qa"]');
  const qaInvite = await invite(host);
  const code = inviteCode(qaInvite);
  assert.notEqual(code, normalCode);
  assert.equal((await view(host, code)).qa, true);
  await guest.goto(qaInvite);
  await clickAction(guest, '[data-action="join-room"]');

  const falseStep = { type: "seek-qa-advance", step: "minute", actionId: "disallowed" };
  const post = (page, data) => page.request.post(`${enabled.origin}/api/rulebooks`, { data });
  assert.equal((await post(guest, { ...falseStep, roomCode: code })).status(), 403);
  assert.equal((await post(host, { ...falseStep, roomCode: normalCode })).status(), 400);
  const badFix = { type: "room-action", roomCode: normalCode, action: {
    type: "check-in-start", actionId: "invalid-fix", fix: { qaLocationId: "csw-asean" },
  } };
  assert.equal((await (await post(host, badFix)).json()).error, "invalid-qa-location");

  for (const page of [host, guest]) {
    await clickAction(page, '[data-action="sim-start-checkin"]');
    await clickAction(page, '[data-action="mark-ready"]');
  }
  await clickAction(host, '[data-action="start-match"]');
  await host.getByRole("button", { name: "Mode QA" }).click();
  await host.getByLabel("Lokasi simulasi kamu").selectOption("mrt-blok-m");
  await host.locator('[data-panel="board"]').click();
  await clickAction(host, '[data-action="lock-anchor"]');
  await host.getByRole("button", { name: "Mode QA" }).click();
  const jump = await advance(host, "minute");
  assert.equal((await view(guest, code)).room.now, initialTime + 60_000);
  assert.equal((await post(host, jump)).status(), 200);
  assert.equal((await view(host, code)).room.now, initialTime + 60_000);
  await advance(host, "five-minutes");
  assert.equal((await view(guest, code)).room.now, initialTime + 360_000);
  assert.equal((await view(host, normalCode)).room.now, initialTime);
  await host.screenshot({ path: join(results, "seek-qa-head-start.png") });

  const jumpToRelease = await advance(host, "phase-end");
  const seeking = (await view(guest, code)).room;
  assert.equal(seeking.phase, "seeking");
  assert.equal(seeking.now, seeking.releaseAt);
  const staleDeadline = await post(host, { ...jumpToRelease, actionId: "stale-phase" });
  assert.equal((await staleDeadline.json()).error, "qa-deadline-changed");
  await guest.getByText("Perburuan Makro", { exact: false }).first().waitFor();
  await guest.getByRole("button", { name: "Mode QA" }).click();
  assert.equal(await guest.locator('[data-action="qa-advance"]').count(), 0);
  assert.equal(await guest.getByLabel("Lokasi simulasi kamu").inputValue(), "csw-asean");
  await guest.locator('[data-panel="ask"]').click();
  await guest.locator('[data-family="thermometer"]').click();
  await guest.locator('[data-item="therm-500m"]').click();
  await clickAction(guest, '[data-action="start-thermometer"]');
  await guest.getByRole("button", { name: "Mode QA" }).click();
  await guest.getByLabel("Lokasi simulasi kamu").selectOption("mrt-blok-m");
  await guest.locator('[data-panel="ask"]').click();
  await clickAction(guest, '[data-action="mark-thermometer-end"]');
  await guest.locator('[data-map-point="thermometer-b"]').waitFor();
  await clickAction(guest, '[data-action="ask-clue"]');
  const thermo = (await view(guest, code)).room.questions[0];
  const points = (await view(guest, code)).publicBoard;
  const station = points.stations.find(value => value.id === "mrt-blok-m");
  assert.deepEqual(thermo.referencePoint, { latitude: station.latitude, longitude: station.longitude });
  assert.deepEqual(thermo.thermometerStart, { latitude: points.startPoint.latitude, longitude: points.startPoint.longitude });
  await host.locator('[data-answer="hotter"]').click();
  await clickAction(host, '[data-action="answer-pending"]');

  await guest.getByRole("button", { name: "Mode QA" }).click();
  await guest.getByLabel("Lokasi simulasi kamu").selectOption("mrt-blok-a");
  await guest.reload();
  await guest.getByRole("button", { name: "Mode QA" }).click();
  assert.equal(await guest.getByLabel("Lokasi simulasi kamu").inputValue(), "mrt-blok-a");
  await guest.locator('[data-panel="board"]').click();
  await clickAction(guest, '[data-action="seeker-check-in"]');
  assert.equal((await view(host, code)).room.seekerPosition.stationId, "mrt-blok-a");

  await host.getByRole("button", { name: "Mode QA" }).click();
  await advance(host, "phase-end");
  assert.equal((await view(guest, code)).room.regroupPoint.id, "mrt-blok-a");
  await host.getByLabel("Lokasi simulasi kamu").selectOption("mrt-blok-a");
  for (const page of [host, guest]) await clickAction(page, '[data-action="regroup"]');
  const next = (await view(guest, code)).room;
  assert.equal(next.role, "hider");
  assert.equal(next.turnStartPoint.id, "mrt-blok-a");
  assert.equal(next.releaseAt - next.now, 25 * 60_000);
  console.log("Hide & Seek QA passed location changes, host-only time jumps, clock isolation, Thermometer, and role swap.");
} finally {
  await browser?.close();
  await Promise.all([enabled, disabled].map(({ server }) => new Promise(resolve => server.close(resolve))));
}
