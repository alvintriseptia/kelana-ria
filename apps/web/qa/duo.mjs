import assert from "node:assert/strict";
import { once } from "node:events";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { preview } from "vite";
import { createSoloServer } from "../../api/dist/index.js";
import { phoneOptions } from "./profile.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const results = join(root, "qa-results");
const answers = {
  "taman-literasi": "Setengah lingkaran",
  "blok-m-plaza": "Persegi",
  "m-bloc": "Dua",
  "taman-ayodya": "Burung",
  "stadion-madya": "Lari",
  "plaza-senayan": "03.00",
};
let offset = 0;
const api = createSoloServer({ databasePath: ":memory:", now: () => Date.now() + offset });
api.listen(0, "127.0.0.1");
await once(api, "listening");
await mkdir(results, { recursive: true });

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

  async function device() {
    const context = await browser.newContext(phoneOptions(browser));
    return { context, page: await context.newPage() };
  }

  function button(device, name) {
    return device.page.getByRole("button", { name, exact: true });
  }

  async function click(device, name) {
    await button(device, name).click();
  }

  async function postThroughUi(device, name, type) {
    const [reply] = await Promise.all([
      device.page.waitForResponse(response => response.url().startsWith(origin + "/api/duo")
        && response.request().method() === "POST"
        && response.request().postDataJSON().type === type),
      click(device, name),
    ]);
    return reply.json();
  }

  const host = await device();
  const guest = await device();
  const third = await device();

  await host.page.goto(origin);
  await host.page.getByText("Berdua", { exact: true }).click();
  await click(host, "Lihat ringkasan");
  await click(host, "Coba simulasi berdua");
  const createIds = [];
  let createdCode;
  const interceptCreate = async route => {
    const request = route.request();
    if (request.method() !== "POST" || request.postDataJSON().type !== "create") {
      return route.continue();
    }
    createIds.push(request.postDataJSON().actionId);
    if (createIds.length > 1) return route.continue();
    const committed = await route.fetch();
    createdCode = (await committed.json()).room.code;
    return route.abort();
  };
  const entryEndpoint = origin + "/api/duo";
  await host.context.route(entryEndpoint, interceptCreate);
  await click(host, "Buat ruang");
  await button(host, "Coba lagi").waitFor();
  await host.page.reload();
  await button(host, "Coba lagi").waitFor({ timeout: 8_000 });
  const created = await postThroughUi(host, "Coba lagi", "create");
  assert.equal(created.room.code, createdCode);
  assert.equal(createIds.length, 2);
  assert.equal(createIds[0], createIds[1]);
  await host.context.unroute(entryEndpoint, interceptCreate);
  assert.equal(created.room.seat, "host");
  assert.equal(created.room.phase, "lobby");
  assert.equal(created.room.deadline, null);
  const code = created.room.code;
  const endpoint = origin + "/api/duo/" + encodeURIComponent(code);
  const share = await host.page.getByRole("link", { name: "Tautan undangan", exact: true }).getAttribute("href");
  assert.ok(share, "The host has a shareable link");
  const invite = new URL(share, origin);
  assert.equal(invite.origin, origin);
  assert.equal(invite.searchParams.get("room"), code);

  async function read(device) {
    const response = await device.context.request.get(endpoint);
    const reply = await response.json();
    assert.ok(reply.room, `Expected member room, received ${JSON.stringify(reply)}`);
    return reply.room;
  }

  async function joinRoom(device) {
    await device.page.goto(invite.href);
    return postThroughUi(device, "Gabung ruang", "join");
  }

  const joined = await joinRoom(guest);
  assert.equal(joined.room.seat, "guest");
  const rejected = await joinRoom(third);
  assert.equal(rejected.error, "room-full");
  assert.equal(rejected.room, undefined, "A third browser cannot read the room");
  assert.equal((await (await third.context.request.get(endpoint)).json()).room, undefined);
  await third.context.close();

  async function confirmStart(device) {
    await click(device, "Check-in di titik awal");
    const checked = await postThroughUi(device, "Simulasikan lokasi di sini", "check-in");
    assert.ok(checked.room.startVerifiedUntil);
    const ready = await postThroughUi(device, "Saya siap", "ready");
    assert.ok(ready.room.seats[ready.room.seat].ready);
  }

  await Promise.all([confirmStart(host), confirmStart(guest)]);
  assert.equal(await button(guest, "Mulai").count(), 0);
  await host.page.screenshot({ path: join(results, "duo-host-lobby.png"), fullPage: true });
  // The guest has confirmed a lobby-only action just as the host starts.
  await click(guest, "Keluar dari ruang");
  const staleLobby = await read(guest);
  const holdLobby = route => route.request().method() === "GET"
    ? route.fulfill({ json: { room: staleLobby } }) : route.continue();
  await guest.context.route(endpoint, holdLobby);
  const started = (await postThroughUi(host, "Mulai", "start")).room;
  const staleExit = await postThroughUi(guest, "Ya, keluar", "leave");
  assert.equal(staleExit.error, "room-phase-changed");
  assert.equal(staleExit.room.phase, "active");
  assert.equal(staleExit.room.outcome, null);
  await guest.context.unroute(endpoint, holdLobby);
  assert.equal(started.phase, "active");
  assert.equal(started.deadline, started.startedAt + started.edition.durationMs);
  const repeated = await host.context.request.post(endpoint, { data: { type: "start", actionId: randomUUID() } });
  const duplicate = (await repeated.json()).room;
  assert.equal(duplicate.deadline, started.deadline);
  assert.equal(duplicate.events.filter(event => event.type === "started").length, 1);

  async function prepare(device, point) {
    await click(device, point.name);
    const checked = await postThroughUi(device, "Simulasikan lokasi di sini", "check-in");
    assert.equal(checked.challenge.checkpointId, point.id);
    await device.page.getByRole("radio", { name: answers[point.id], exact: true }).check();
  }

  const points = started.edition.checkpoints.slice(0, 3);
  assert.ok(points.every(point => point.zone === points[0].zone));
  await Promise.all([prepare(host, points[0]), prepare(guest, points[0])]);
  const gate = Promise.withResolvers();
  let queued = 0;
  const race = async route => {
    const request = route.request();
    if (request.method() === "POST" && request.postDataJSON().type === "answer") {
      if (++queued === 2) gate.resolve();
      await gate.promise;
    }
    await route.continue();
  };
  await Promise.all([host.context.route(endpoint, race), guest.context.route(endpoint, race)]);
  const racers = await Promise.all([
    postThroughUi(host, "Kirim jawaban", "answer"),
    postThroughUi(guest, "Kirim jawaban", "answer"),
  ]);
  await Promise.all([host.context.unroute(endpoint, race), guest.context.unroute(endpoint, race)]);
  assert.equal(racers.filter(reply => !reply.error).length, 1, "Only one answer claims the landmark");
  const winner = racers[0].error ? guest : host;
  const rival = winner === host ? guest : host;
  const firstSeat = winner === host ? "host" : "guest";
  const rivalSeat = firstSeat === "host" ? "guest" : "host";
  const first = await read(winner);
  assert.equal(first.owners[points[0].id], firstSeat);
  assert.equal(first.zones.find(zone => zone.name === points[0].zone).owner, firstSeat);

  // Keep keyboard focus on a landmark pin while the other player claims it.
  await click(winner, "Lihat peta");
  const incomingPin = button(winner, `${points[1].name} di peta`);
  await incomingPin.focus();

  // Lose the second claim's acknowledgement after the real server commits it.
  await prepare(rival, points[1]);
  const actionIds = [];
  const loseFirstReply = async route => {
    const request = route.request();
    if (request.method() !== "POST" || request.postDataJSON().type !== "answer") {
      return route.continue();
    }
    actionIds.push(request.postDataJSON().actionId);
    if (actionIds.length > 1) return route.continue();
    const actual = await route.fetch();
    assert.equal((await actual.json()).room.owners[points[1].id], rivalSeat);
    return route.abort();
  };
  await rival.context.route(endpoint, loseFirstReply);
  await click(rival, "Kirim jawaban");
  const neutral = (await postThroughUi(rival, "Coba lagi", "answer")).room;
  assert.equal(actionIds.length, 2);
  assert.equal(actionIds[0], actionIds[1]);
  assert.equal(neutral.zones.find(zone => zone.name === points[0].zone).owner, null);
  assert.equal(neutral.events.filter(event => event.type === "claimed").length, 2);
  await rival.context.unroute(endpoint, loseFirstReply);
  const zone = winner.page.getByRole("region", { name: `Zona ${points[0].zone}`, exact: true });
  await zone.getByText("Netral", { exact: true }).waitFor();
  assert.ok(await button(winner, "Tutup peta").evaluate(el => document.activeElement === el),
    "Focus returns to the map toggle when the rival claims the focused pin");

  // An offline opponent keeps their seat and picks up the new owner when online.
  await winner.context.setOffline(true);
  await prepare(rival, points[2]);
  const flipped = (await postThroughUi(rival, "Kirim jawaban", "answer")).room;
  assert.equal(flipped.zones.find(zone => zone.name === points[0].zone).owner, rivalSeat);
  await winner.context.setOffline(false);
  const newOwner = rivalSeat === "host" ? "Pemain 1" : "Pemain 2";
  await zone.getByText(`Dikuasai ${newOwner}`, { exact: true }).waitFor();
  await winner.page.reload();
  await zone.getByText(`Dikuasai ${newOwner}`, { exact: true }).waitFor();
  const reloaded = await read(winner);
  assert.equal(reloaded.seat, firstSeat);
  assert.deepEqual(reloaded.owners, flipped.owners);
  assert.deepEqual(reloaded.events, flipped.events);
  // Open the lazy MapLibre vector map on the active Duo board and confirm non-color ownership + attribution.
  await click(winner, "Lihat peta");
  await click(winner, "Buka peta vektor (MapLibre)");
  await winner.page.locator('.board-map-shell, .solo-map-notice:has-text("Peta tidak tersedia")').first().waitFor({ timeout: 10_000 });
  if (await winner.page.locator(".board-map-shell").count() > 0) {
    const mapText = await winner.page.locator("#duo-map").innerText();
    assert.match(mapText, /Geoapify/i);
    assert.match(mapText, /OpenStreetMap/i);
    assert.match(mapText, /Diklaim Pemain [12]/);
    const licenseHref = await winner.page.locator('.board-map-attribution a[href*="maplibre-gl.txt"]').getAttribute("href");
    assert.equal(licenseHref, "/licenses/maplibre-gl.txt");
  }
  await click(winner, "Tutup peta");

  await Promise.all([
    host.page.screenshot({ path: join(results, "duo-host-board.png"), fullPage: true }),
    guest.page.screenshot({ path: join(results, "duo-guest-board.png"), fullPage: true }),
  ]);

  offset = started.deadline - Date.now();
  const resultLabel = `Pemenang: ${newOwner}`;
  for (const person of [host, guest]) {
    await person.page.reload();
    await person.page.getByRole("heading", { name: resultLabel, exact: true }).waitFor();
  }
  const [home, away] = await Promise.all([read(host), read(guest)]);
  assert.deepEqual(home.outcome, { winner: rivalSeat, reason: "time" });
  assert.deepEqual(away.outcome, home.outcome);
  assert.deepEqual(away.events, home.events);
  assert.equal(home.events.at(-1).at, started.deadline);
  await Promise.all([
    host.page.screenshot({ path: join(results, "duo-host-result.png"), fullPage: true }),
    guest.page.screenshot({ path: join(results, "duo-guest-result.png"), fullPage: true }),
  ]);
  await writeFile(join(results, "duo-report.json"), JSON.stringify({
    browser: browser.version(), viewport: host.page.viewportSize(), simulated: true,
    thirdDeviceRejected: true, duplicateStart: true, sameIdRetry: true, roomCreationRecoveredAfterReload: true,
    staleLobbyExitRejected: true, zoneControl: [firstSeat, null, rivalSeat],
    outcome: home.outcome, events: home.events,
  }, null, 2) + "\n");
  console.log("Compact duo Claim passed two-seat readiness, contested claims, retry, zone control, and convergence.");
} finally {
  await browser?.close();
  await server?.close();
  if (api.listening) await new Promise(resolve => api.close(resolve));
}
