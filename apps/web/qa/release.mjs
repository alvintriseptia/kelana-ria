import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { preview } from "vite";
import {
  compactCheckpointIdSet,
  compactReviewedTasks,
  createSoloServer,
  wideReviewedTasks,
} from "../../api/dist/index.js";
import { phoneOptions } from "./profile.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const results = join(root, "qa-results");
await mkdir(results, { recursive: true });

let clockOffset = 0;
const now = () => Date.now() + clockOffset;
const api = createSoloServer({ databasePath: ":memory:", now, allowSimulatedLocation: true });
api.listen(0, "127.0.0.1");
await once(api, "listening");

function answerLabel(tasks, checkpointId) {
  const task = tasks[checkpointId];
  assert.ok(task, `Missing fixture task for ${checkpointId}`);
  const choice = task.challenge.choices.find((c) => c.id === task.correctChoiceId);
  assert.ok(choice, `Missing correct choice for ${checkpointId}`);
  return choice.label;
}

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
    channel: "chromium",
    executablePath: process.env.CHROMIUM_PATH || undefined,
  });

  async function openDevice() {
    const context = await browser.newContext(phoneOptions(browser));
    const page = await context.newPage();
    return { context, page };
  }

  async function selectConfig(page, { players, format, board }) {
    await page.goto(origin);
    await page.getByRole("heading", { name: "Pilih permainan", level: 1 }).waitFor();
    await page.locator("#chooser").getByText(players === 2 ? "Berdua" : "Solo", { exact: true }).click();
    await page.locator("label").filter({ has: page.locator(`input[value="${format}"]`) }).click();
    await page.locator('select[name="board"]').selectOption(board);
    await page.getByRole("button", { name: "Lihat ringkasan", exact: true }).click();
    const playLabel =
      format === "hide-and-seek"
        ? "Main Hide & Seek"
        : players === 2
          ? "Main berdua"
          : "Main Solo";
    await page.getByRole("button", { name: playLabel, exact: true }).click();
  }

  async function postJson(page, buttonLabel, pathPart) {
    const [reply] = await Promise.all([
      page.waitForResponse(
        (response) =>
          response.url().includes(pathPart) &&
          response.request().method() === "POST" &&
          response.ok(),
      ),
      page.getByRole("button", { name: buttonLabel, exact: true }).click(),
    ]);
    return reply.json();
  }

  const configurations = [];

  // A18: Verify inspiration credit and official series link in mobile guide dialog.
  const creditCheck = await openDevice();
  try {
    await creditCheck.page.goto(origin);
    await creditCheck.page.getByRole("button", { name: "Panduan", exact: true }).click();
    const dialog = creditCheck.page.getByRole("dialog");
    await dialog.waitFor();
    const creditText = await dialog.innerText();
    for (const creator of ["Adam Chase", "Sam Denby", "Ben Doyle"]) {
      assert.ok(creditText.includes(creator), `Missing creator credit: ${creator}`);
    }
    assert.ok(await dialog.locator('a[href="https://nebula.tv/jetlag"]').isVisible());
  } finally {
    await creditCheck.context.close();
  }

  // --- Cells 1 & 4: Solo Claim on Compact and Jakarta-wide ---
  for (const board of ["compact", "jakarta-wide"]) {
    const device = await openDevice();
    try {
      await selectConfig(device.page, { players: 1, format: "claim-the-city", board });
      await device.page.getByRole("button", { name: "Check-in di titik awal", exact: true }).waitFor();
      const query = board === "jakarta-wide" ? "?board=jakarta-wide" : "";
      const stateRes = await device.context.request.get(`${origin}/api/solo${query}`);
      const briefing = (await stateRes.json()).session;
      assert.equal(briefing.edition.board, board);
      assert.equal(briefing.edition.durationMs, (board === "jakarta-wide" ? 120 : 60) * 60_000);
      const outsideCompact = briefing.edition.checkpoints.filter(
        (p) => !compactCheckpointIdSet.has(p.id),
      );
      if (board === "jakarta-wide") {
        assert.ok(outsideCompact.length >= 2, "Wide solo UI must activate >=2 points outside Compact");
        assert.match(await device.page.locator(".solo-header").innerText(), /Jakarta \(Wide\)/);
      }

      await device.page.getByRole("button", { name: "Check-in di titik awal", exact: true }).click();
      await postJson(device.page, "Simulasikan lokasi di sini", "/api/solo");
      await postJson(device.page, "Mulai", "/api/solo");

      const tasks = board === "jakarta-wide" ? wideReviewedTasks : compactReviewedTasks;
      // Pick 4 checkpoints spanning at least 2 zones.
      const byZone = new Map();
      for (const point of briefing.edition.checkpoints) {
        const list = byZone.get(point.zone) ?? [];
        list.push(point);
        byZone.set(point.zone, list);
      }
      const picks = [];
      for (const [, list] of byZone) {
        for (const p of list.slice(0, 2)) {
          if (picks.length < 4) picks.push(p);
        }
      }
      for (const point of picks) {
        await device.page.getByRole("button", { name: point.name, exact: true }).click();
        await postJson(device.page, "Simulasikan lokasi di sini", "/api/solo");
        await device.page
          .getByRole("radio", { name: answerLabel(tasks, point.id), exact: true })
          .check();
        await postJson(device.page, "Kirim jawaban", "/api/solo");
      }

      await device.page.getByRole("heading", { name: "Kamu menang", exact: true }).waitFor();
      if (board === "jakarta-wide") {
        await device.page.screenshot({
          path: join(results, "release-wide-solo-win.png"),
          fullPage: true,
        });
      }
      await device.page.reload();
      await device.page.getByRole("heading", { name: "Kamu menang", exact: true }).waitFor();
      configurations.push({
        board,
        format: "claim-the-city",
        players: 1,
        mode: "simulated",
        status: "pass",
        editionId: briefing.edition.id,
        outsideCompactPoints: outsideCompact.length,
        persistedOnReload: true,
      });
    } finally {
      await device.context.close();
    }
  }

  // --- Cells 2 & 5: Duo Claim on Compact and Jakarta-wide ---
  for (const board of ["compact", "jakarta-wide"]) {
    const host = await openDevice();
    const guest = await openDevice();
    try {
      await selectConfig(host.page, { players: 2, format: "claim-the-city", board });
      const created = (await postJson(host.page, "Buat ruang", "/api/duo")).room;
      assert.equal(created.edition.board, board);
      const outsideCompact = created.edition.checkpoints.filter(
        (p) => !compactCheckpointIdSet.has(p.id),
      );
      if (board === "jakarta-wide") {
        assert.ok(outsideCompact.length >= 2);
      }
      const inviteHref = await host.page
        .getByRole("link", { name: "Tautan undangan", exact: true })
        .getAttribute("href");
      assert.ok(inviteHref);
      if (board === "jakarta-wide") {
        assert.match(inviteHref, /board=jakarta-wide/);
      }

      await guest.page.goto(new URL(inviteHref, origin).href);
      await postJson(guest.page, "Gabung ruang", "/api/duo");
      if (board === "jakarta-wide") {
        assert.match(await guest.page.locator(".solo-header").innerText(), /Jakarta \(Wide\)/);
      }

      for (const d of [host, guest]) {
        await d.page.getByRole("button", { name: "Check-in di titik awal", exact: true }).click();
        await postJson(d.page, "Simulasikan lokasi di sini", `/api/duo/${created.code}`);
        await postJson(d.page, "Saya siap", `/api/duo/${created.code}`);
      }
      const started = (await postJson(host.page, "Mulai", `/api/duo/${created.code}`)).room;
      assert.equal(started.phase, "active");

      const tasks = board === "jakarta-wide" ? wideReviewedTasks : compactReviewedTasks;
      const target = started.edition.checkpoints[0];
      await host.page.getByRole("button", { name: target.name, exact: true }).click();
      await postJson(host.page, "Simulasikan lokasi di sini", `/api/duo/${created.code}`);
      await host.page
        .getByRole("radio", { name: answerLabel(tasks, target.id), exact: true })
        .check();
      await postJson(host.page, "Kirim jawaban", `/api/duo/${created.code}`);

      clockOffset = started.deadline - Date.now() + 2_000;
      await Promise.all([host.page.reload(), guest.page.reload()]);
      await host.page.getByRole("heading", { name: "Pemenang: Pemain 1", exact: true }).waitFor();
      await guest.page.getByRole("heading", { name: "Pemenang: Pemain 1", exact: true }).waitFor();
      if (board === "jakarta-wide") {
        await host.page.screenshot({
          path: join(results, "release-wide-duo-finish.png"),
          fullPage: true,
        });
      }
      configurations.push({
        board,
        format: "claim-the-city",
        players: 2,
        mode: "simulated",
        status: "pass",
        editionId: created.edition.id,
        outsideCompactPoints: outsideCompact.length,
        persistedOnReload: true,
      });
    } finally {
      await host.context.close();
      await guest.context.close();
    }
  }

  // --- Cells 3 & 6: Hide & Seek (two players) on Compact and Jakarta-wide ---
  for (const board of ["compact", "jakarta-wide"]) {
    const host = await openDevice();
    const guest = await openDevice();
    try {
      await selectConfig(host.page, { players: 2, format: "hide-and-seek", board });
      const created = (await postJson(host.page, "Buat ruang", "/api/seek")).room;
      assert.equal(created.edition.board, board);
      const outsideCompact = created.edition.checkpoints.filter(
        (p) => !compactCheckpointIdSet.has(p.id),
      );
      if (board === "jakarta-wide") {
        assert.ok(outsideCompact.length >= 2);
      }
      const inviteHref = await host.page
        .getByRole("link", { name: "Tautan undangan", exact: true })
        .getAttribute("href");
      assert.ok(inviteHref);
      await guest.page.goto(new URL(inviteHref, origin).href);
      await postJson(guest.page, "Gabung ruang", "/api/seek");
      if (board === "jakarta-wide") {
        assert.match(await guest.page.locator(".solo-header").innerText(), /Jakarta \(Wide\)/);
      }

      // Host assigns host as first hider, both check in at CSW-ASEAN and mark ready.
      await Promise.all([
        host.page.waitForResponse(
          (r) => r.url().includes(`/api/seek/${created.code}`) && r.request().method() === "POST",
        ),
        host.page.getByRole("radio", { name: "Pemain 1", exact: true }).check(),
      ]);
      for (const d of [host, guest]) {
        await d.page.getByRole("button", { name: "Check-in di titik awal", exact: true }).click();
        await postJson(d.page, "Simulasikan lokasi di sini", `/api/seek/${created.code}`);
        await postJson(d.page, "Saya siap", `/api/seek/${created.code}`);
      }
      const turn1 = (await postJson(host.page, "Mulai", `/api/seek/${created.code}`)).room;
      assert.equal(turn1.phase, "head-start");

      // Turn 1: host locks checkpoint 0, guest seeks after release and discovers host at +10 min.
      const lock1 = turn1.edition.checkpoints[0];
      await host.page.getByRole("button", { name: lock1.name, exact: true }).click();
      await postJson(host.page, "Simulasikan penguncian di sini", `/api/seek/${created.code}`);

      clockOffset = turn1.releaseAt - Date.now() + 2_000;
      await guest.page.reload();
      await guest.page.getByRole("button", { name: "Check-in di titik awal", exact: true }).click();
      await postJson(guest.page, "Simulasikan lokasi di sini", `/api/seek/${created.code}`);

      clockOffset = turn1.releaseAt - Date.now() + 10 * 60_000;
      await guest.page.getByRole("button", { name: lock1.name, exact: true }).click();
      await postJson(guest.page, "Simulasikan penyelidikan di sini", `/api/seek/${created.code}`);

      // Regroup at start to swap roles for Turn 2.
      await Promise.all([host.page.reload(), guest.page.reload()]);
      for (const d of [host, guest]) {
        await d.page.getByRole("button", { name: "Check-in di titik awal", exact: true }).click();
        await postJson(d.page, "Simulasikan lokasi di sini", `/api/seek/${created.code}`);
      }

      // Turn 2: guest hides at checkpoint 3, host discovers guest at +20 min -> guest wins.
      const state2 = (await (await guest.context.request.get(`${origin}/api/seek/${created.code}`)).json()).room;
      assert.equal(state2.turn, 2);
      assert.equal(state2.phase, "head-start");
      const lock2 = state2.edition.checkpoints[3];
      await guest.page.reload();
      await guest.page.getByRole("button", { name: lock2.name, exact: true }).click();
      await postJson(guest.page, "Simulasikan penguncian di sini", `/api/seek/${created.code}`);

      clockOffset = state2.releaseAt - Date.now() + 2_000;
      await host.page.reload();
      await host.page.getByRole("button", { name: "Check-in di titik awal", exact: true }).click();
      await postJson(host.page, "Simulasikan lokasi di sini", `/api/seek/${created.code}`);

      clockOffset = state2.releaseAt - Date.now() + 20 * 60_000;
      await host.page.getByRole("button", { name: lock2.name, exact: true }).click();
      await postJson(host.page, "Simulasikan penyelidikan di sini", `/api/seek/${created.code}`);

      await Promise.all([host.page.reload(), guest.page.reload()]);
      await host.page.getByRole("heading", { name: "Pemenang: Pemain 2", exact: true }).waitFor();
      await guest.page.getByRole("heading", { name: "Pemenang: Pemain 2", exact: true }).waitFor();
      if (board === "jakarta-wide") {
        await host.page.screenshot({
          path: join(results, "release-wide-seek-finish.png"),
          fullPage: true,
        });
      }
      configurations.push({
        board,
        format: "hide-and-seek",
        players: 2,
        mode: "simulated",
        status: "pass",
        editionId: created.edition.id,
        outsideCompactPoints: outsideCompact.length,
        persistedOnReload: true,
      });
    } finally {
      await host.context.close();
      await guest.context.close();
    }
  }

  await writeFile(
    join(results, "release-report.json"),
    JSON.stringify(
      {
        capturedAt: new Date().toISOString(),
        browser: browser.version(),
        viewport: { width: 390, height: 844 },
        simulated: true,
        creditVerifiedA18: true,
        configurations,
        pendingExternalGates: [
          { issue: 6, status: "untested-live", reason: "Requires live Cloudflare Workers AI and Geoapify credentials" },
          { issue: 7, status: "untested-field", reason: "Requires uncoached first-time player observation" },
          { issue: 13, status: "pending-decision", reason: "Requires product owner closure and trial timing sign-off" },
          { issue: 14, status: "untested-field", reason: "Requires on-site Jakarta field calibration playtests" },
        ],
      },
      null,
      2,
    ) + "\n",
  );
  console.log("All six release configurations passed mobile smoke journeys and reload persistence.");
} finally {
  await browser?.close();
  await server?.close();
  if (api.listening) await new Promise((resolve) => api.close(resolve));
}
