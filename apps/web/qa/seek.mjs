import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { preview } from "vite";
import { createSoloServer } from "../../api/dist/index.js";
import { phoneOptions } from "./profile.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const results = join(root, "qa-results");
await mkdir(results, { recursive: true });
let clockOffset = 0;
const api = createSoloServer({ databasePath: ":memory:", now: () => Date.now() + clockOffset });
api.listen(0, "127.0.0.1");
await once(api, "listening");

let browser;
let server;
try {
  server = await preview({
    root,
    preview: {
      host: "127.0.0.1", port: 0,
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

  function heading(device, name) {
    return device.page.getByRole("heading", { name, exact: true });
  }

  async function click(device, name) {
    await button(device, name).click();
  }

  async function action(device, type, submit) {
    const [response] = await Promise.all([
      device.page.waitForResponse(reply => reply.url().startsWith(origin + "/api/seek")
        && reply.request().method() === "POST"
        && reply.request().postDataJSON().type === type),
      submit(),
    ]);
    return response.json();
  }

  function post(device, name, type) {
    return action(device, type, () => click(device, name));
  }

  function advanceTo(timestamp) {
    clockOffset = timestamp - Date.now();
  }

  function secretFree(room) {
    assert.equal(Object.hasOwn(room, "ownLock"), false, "The seeker must not receive a lock field");
    assert.doesNotMatch(JSON.stringify(room), /lock(ed)?At|targetId|answerKey|correctChoice|privateCheckIn/i);
  }

  const host = await device();
  const guest = await device();
  const explicitSolo = "/?play=hide-and-seek&players=1&format=hide-and-seek&board=compact";
  await host.page.goto(origin + explicitSolo);
  await host.page.waitForFunction(() => !new URLSearchParams(location.search).has("play"));
  await heading(host, "Pilih permainan").waitFor();
  assert.equal(await host.page.locator('input[value="claim-the-city"]').isChecked(), true);
  const explicitWide = "/?play=hide-and-seek&players=2&format=hide-and-seek&board=jakarta-wide";
  await host.page.goto(origin + explicitWide);
  await host.page.waitForFunction(() => !new URLSearchParams(location.search).has("play"));
  assert.equal(await host.page.locator('select[name="board"]').inputValue(), "jakarta-wide");
  await host.page.goto(origin);
  await host.page.getByText("Berdua", { exact: true }).click();
  await host.page.locator('label').filter({ has: host.page.locator('input[value="hide-and-seek"]') }).click();
  await click(host, "Lihat ringkasan");
  await click(host, "Coba simulasi Hide & Seek");
  const created = (await post(host, "Buat ruang", "create")).room;
  assert.equal(created.phase, "lobby");
  const endpoint = origin + "/api/seek/" + encodeURIComponent(created.code);
  const invite = await host.page.getByRole("link", { name: "Tautan undangan", exact: true }).getAttribute("href");
  assert.ok(invite);
  await guest.page.goto(new URL(invite, origin).href);
  assert.equal((await post(guest, "Gabung ruang", "join")).room.seat, "guest");

  async function read(device) {
    const response = await device.context.request.get(endpoint);
    const reply = await response.json();
    assert.ok(reply.room, `Expected private room snapshot, received ${JSON.stringify(reply)}`);
    return reply.room;
  }

  async function atStart(device) {
    await click(device, "Check-in di titik awal");
    return post(device, "Simulasikan lokasi di sini", "check-in");
  }

  const assigned = await action(host, "assign",
    () => host.page.getByRole("radio", { name: "Pemain 1", exact: true }).click());
  assert.equal(assigned.room.firstHider, "host");
  await Promise.all([host, guest].map(async person => {
    const checked = await atStart(person);
    assert.ok(checked.room.startVerifiedUntil > checked.room.now);
    const ready = await post(person, "Saya siap", "ready");
    assert.equal(ready.room.seats[ready.room.seat].ready, true);
  }));
  assert.equal(await button(guest, "Mulai").count(), 0);
  const started = (await post(host, "Mulai", "start")).room;
  assert.equal(started.phase, "head-start");
  assert.equal(started.releaseAt - started.startedAt, started.edition.headStartMs);
  const [first, other] = started.edition.checkpoints;

  await heading(guest, "Waktu sembunyi").waitFor();
  const beforeLock = await read(guest);
  secretFree(beforeLock);
  assert.equal(beforeLock.canInvestigate, false);
  assert.equal(await button(guest, first.name).count(), 0);
  await click(host, first.name);
  assert.equal((await post(host, "Simulasikan penguncian di sini", "lock")).room.ownLock, first.id);
  await host.page.getByText("Titik sembunyi terkunci", { exact: true }).waitFor();
  await guest.page.reload();
  await heading(guest, "Waktu sembunyi").waitFor();
  const afterLock = await read(guest);
  secretFree(afterLock);
  assert.deepEqual({ ...afterLock, now: 0 }, { ...beforeLock, now: 0 });
  await Promise.all([
    host.page.screenshot({ path: join(results, "seek-hider-locked.png"), fullPage: true }),
    guest.page.screenshot({ path: join(results, "seek-seeker-waiting.png"), fullPage: true }),
  ]);

  advanceTo(started.releaseAt);
  await guest.page.reload();
  await heading(guest, "Pencarian").waitFor();
  const released = await read(guest);
  secretFree(released);
  assert.equal(released.canInvestigate, false);
  assert.equal((await atStart(guest)).room.canInvestigate, true);
  await click(guest, other.name);
  const missed = await post(guest, "Simulasikan penyelidikan di sini", "investigate");
  assert.equal(missed.investigation, "miss");
  assert.deepEqual(missed.room.ruledOut, [other.id]);
  assert.deepEqual((await read(host)).ruledOut, []);
  secretFree(missed.room);

  // Move close to the deadline without tying CI to a millisecond browser tap.
  advanceTo(released.phaseEndsAt - 20_000);
  await guest.page.reload();
  await heading(guest, "Pencarian").waitFor();
  await click(guest, first.name);
  const investigateIds = [];
  let found;
  const loseFindReply = async route => {
    const request = route.request();
    if (request.method() !== "POST" || request.postDataJSON().type !== "investigate") return route.continue();
    investigateIds.push(request.postDataJSON().actionId);
    if (investigateIds.length > 1) return route.continue();
    found = await (await route.fetch()).json();
    return route.abort();
  };
  await guest.context.route(endpoint, loseFindReply);
  await click(guest, "Simulasikan penyelidikan di sini");
  await button(guest, "Coba lagi").waitFor();
  assert.equal(found.investigation, "found");
  assert.equal(found.room.phase, "regroup");
  assert.equal(found.room.turns[0].checkpointId, first.id);
  assert.ok(found.room.turns[0].hidingMs < started.edition.searchMs);
  advanceTo(released.phaseEndsAt + 1);
  const retried = await post(guest, "Coba lagi", "investigate");
  assert.equal(investigateIds.length, 2);
  assert.equal(investigateIds[0], investigateIds[1]);
  assert.equal(retried.investigation, "found");
  assert.deepEqual(retried.room.turns, found.room.turns);
  await guest.context.unroute(endpoint, loseFindReply);

  await Promise.all([host, guest].map(person => heading(person, "Berkumpul kembali").waitFor()));
  await guest.page.screenshot({ path: join(results, "seek-regroup.png"), fullPage: true });
  await Promise.all([host, guest].map(atStart));
  await Promise.all([host, guest].map(person => heading(person, "Waktu sembunyi").waitFor()));
  const swapped = await read(host);
  assert.equal(swapped.turn, 2);
  assert.equal(swapped.hider, "guest");
  assert.deepEqual(swapped.turns, found.room.turns);
  assert.deepEqual(swapped.ruledOut, []);
  secretFree(swapped);
  const nextHider = await read(guest);
  assert.deepEqual(nextHider.ruledOut, []);
  assert.equal(nextHider.ownLock, undefined);
  assert.equal(nextHider.canInvestigate, false);

  await click(guest, other.name);
  const secondLock = (await post(guest, "Simulasikan penguncian di sini", "lock")).room;
  assert.equal(secondLock.ownLock, other.id);
  advanceTo(swapped.releaseAt + started.edition.searchMs);
  for (const person of [host, guest]) {
    await person.page.reload();
    await heading(person, "Pemenang: Pemain 2").waitFor();
  }
  const [home, away] = await Promise.all([read(host), read(guest)]);
  assert.equal(home.phase, "finished");
  assert.deepEqual(home.outcome, away.outcome);
  assert.equal(home.outcome.winner, "guest");
  assert.deepEqual(home.turns, away.turns);
  assert.deepEqual(home.turns.map(({ hider, reason, checkpointId }) => ({ hider, reason, checkpointId })), [
    { hider: "host", reason: "found", checkpointId: first.id },
    { hider: "guest", reason: "timeout", checkpointId: other.id },
  ]);
  assert.equal(home.turns[1].hidingMs, started.edition.searchMs);
  await Promise.all([
    host.page.screenshot({ path: join(results, "seek-host-result.png"), fullPage: true }),
    guest.page.screenshot({ path: join(results, "seek-guest-result.png"), fullPage: true }),
  ]);
  await writeFile(join(results, "seek-report.json"), JSON.stringify({
    browser: browser.version(), viewport: host.page.viewportSize(), simulated: true,
    identicalSeekerSnapshotAfterLock: true, sameIdFindRetry: true, rolesSwapped: true,
    outcome: home.outcome, turns: home.turns,
  }, null, 2) + "\n");
  console.log("Hide & Seek passed role privacy, discovery retry, regroup, role swap and matching results.");
} finally {
  await browser?.close();
  await server?.close();
  if (api.listening) await new Promise(resolve => api.close(resolve));
}
