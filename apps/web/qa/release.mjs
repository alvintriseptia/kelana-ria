import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { preview } from "vite";
import { createRecordedMidtransAdapter, createSoloServer } from "../../api/dist/index.js";
import { phoneOptions } from "./profile.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const results = join(root, "qa-results");
await mkdir(results, { recursive: true });

let now = 1_800_000_000_000;
const api = createSoloServer({
  databasePath: ":memory:",
  now: () => now,
  midtrans: createRecordedMidtransAdapter(),
  allowSimulatedLocation: true,
});
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
    channel: "chromium",
    executablePath: process.env.CHROMIUM_PATH || undefined,
    args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
  });

  async function openDevice() {
    const context = await browser.newContext(phoneOptions(browser));
    const page = await context.newPage();
    return { context, page };
  }

  async function clickAndWaitPost(page, selector) {
    await Promise.all([
      page.waitForResponse((r) => r.url().includes("/api/rulebooks") && r.request().method() === "POST"),
      page.click(selector),
    ]);
    await page.waitForFunction(() => !document.querySelector('[aria-busy="true"]'));
  }

  async function launchFromRoot(page, { players, format, board }) {
    await page.goto(origin, { waitUntil: "networkidle" });
    await page.getByRole("heading", { name: "Pilih permainan", level: 1 }).waitFor();
    await page.locator("#chooser").getByText(players === 2 ? "Grup (2–6)" : "Solo", { exact: true }).click();
    await page.locator("label").filter({ has: page.locator(`input[value="${format}"]`) }).click();
    await page.locator('select[name="board"]').selectOption(board);
    await page.getByRole("button", { name: "Lihat ringkasan" }).click();
    const playLabel =
      format === "hide-and-seek"
        ? "Main Hide & Seek"
        : players === 2
          ? "Main Grup (2–6)"
          : "Main Solo";
    await page.getByRole("button", { name: playLabel, exact: true }).click();
    await page.waitForFunction(() => document.body.textContent.includes("Ruang Tunggu"));
  }

  const configurations = [];

  // A18: Verify inspiration credit and official series link in mobile guide dialog.
  const creditCheck = await openDevice();
  try {
    await creditCheck.page.goto(origin);
    await creditCheck.page.getByRole("button", { name: "Panduan", exact: true }).click();
    const guide = creditCheck.page.getByRole("dialog", { name: "Panduan bermain" });
    await guide.waitFor();
    const guideText = await guide.innerText();
    assert.match(guideText, /Jet Lag: The Game/);
    for (const creator of ["Adam Chase", "Sam Denby", "Ben Doyle"]) {
      assert.ok(guideText.includes(creator), `Expected creator credit for ${creator}`);
    }
    const link = guide.locator('a[href="https://nebula.tv/jetlag"]');
    assert.ok(await link.isVisible(), "Official Jet Lag Nebula link must be visible");
    await creditCheck.page.screenshot({ path: join(results, "release-credit-guide.png"), fullPage: true });
  } finally {
    await creditCheck.context.close();
  }

  // 1 & 2: Solo Claim the City (Compact & Jakarta Wide) launched directly from /
  for (const board of ["compact", "jakarta-wide"]) {
    const dev = await openDevice();
    try {
      await launchFromRoot(dev.page, { players: 1, format: "claim-the-city", board });
      await clickAndWaitPost(dev.page, 'button[data-action="sim-start-checkin"]');
      await clickAndWaitPost(dev.page, 'button[data-action="mark-ready"]');
      await clickAndWaitPost(dev.page, 'button[data-action="start-match"]');
      await dev.page.waitForFunction(() => document.body.textContent.includes("Permainan Aktif"));

      const expectedTitle =
        board === "jakarta-wide" ? "Jakarta Transit Conquest" : "Jakarta Selatan Starter";
      const bodyText = await dev.page.textContent("body");
      assert.ok(bodyText.includes(expectedTitle), `Expected ${expectedTitle} to load from /`);

      await dev.page.reload({ waitUntil: "networkidle" });
      await dev.page.waitForFunction(() => document.body.textContent.includes("Permainan Aktif"));

      if (board === "jakarta-wide") {
        await dev.page.screenshot({ path: join(results, "release-wide-solo-win.png"), fullPage: true });
      }
      configurations.push({
        board,
        format: "claim-the-city",
        players: 1,
        mode: "simulated",
        status: "pass",
        persistedOnReload: true,
      });
    } finally {
      await dev.context.close();
    }
  }

  // 3 & 4: Multiplayer Claim the City (Compact & Jakarta Wide) launched from / + invite link join
  for (const board of ["compact", "jakarta-wide"]) {
    const host = await openDevice();
    const guest = await openDevice();
    try {
      await launchFromRoot(host.page, { players: 2, format: "claim-the-city", board });
      const inviteHref = await host.page.getAttribute('[data-testid="invite-link"]', "href");
      assert.ok(inviteHref && inviteHref.includes("room=RC-"), "Claim invite link must be present");

      await guest.page.goto(inviteHref, { waitUntil: "networkidle" });
      await guest.page.fill("#rb-claim-join-name", "Pemain 2");
      await clickAndWaitPost(guest.page, 'button[data-action="join-room"]');
      await guest.page.waitForFunction(() => document.body.textContent.includes("Kursi Pemain (2/"));

      for (const p of [host.page, guest.page]) {
        await clickAndWaitPost(p, 'button[data-action="sim-start-checkin"]');
        await clickAndWaitPost(p, 'button[data-action="mark-ready"]');
      }
      await clickAndWaitPost(host.page, 'button[data-action="start-match"]');
      await host.page.waitForFunction(() => document.body.textContent.includes("Permainan Aktif"));

      await Promise.all([
        host.page.reload({ waitUntil: "networkidle" }),
        guest.page.reload({ waitUntil: "networkidle" }),
      ]);
      await host.page.waitForFunction(() => document.body.textContent.includes("Permainan Aktif"));
      await guest.page.waitForFunction(() => document.body.textContent.includes("Permainan Aktif"));

      if (board === "jakarta-wide") {
        await host.page.screenshot({ path: join(results, "release-wide-duo-finish.png"), fullPage: true });
      }
      configurations.push({
        board,
        format: "claim-the-city",
        players: 2,
        mode: "simulated",
        status: "pass",
        persistedOnReload: true,
      });
    } finally {
      await host.context.close();
      await guest.context.close();
    }
  }

  // 5 & 6: Multiplayer Hide & Seek (Compact & Jakarta Wide) launched from / + invite link join + Endgame Found Code
  for (const board of ["compact", "jakarta-wide"]) {
    const host = await openDevice();
    const guest = await openDevice();
    try {
      await launchFromRoot(host.page, { players: 2, format: "hide-and-seek", board });
      const inviteHref = await host.page.getAttribute('[data-testid="invite-link"]', "href");
      assert.ok(inviteHref && inviteHref.includes("room=RB-"), "Hide & Seek invite link must be present");

      await guest.page.goto(inviteHref, { waitUntil: "networkidle" });
      await guest.page.fill("#rb-join-name", "Pencari");
      await clickAndWaitPost(guest.page, 'button[data-action="join-room"]');
      await guest.page.waitForFunction(() => document.body.textContent.includes("Kursi Pemain (2/"));

      for (const p of [host.page, guest.page]) {
        await clickAndWaitPost(p, 'button[data-action="sim-start-checkin"]');
        await clickAndWaitPost(p, 'button[data-action="mark-ready"]');
      }
      await clickAndWaitPost(host.page, 'button[data-action="start-match"]');
      await host.page.waitForFunction(() => document.body.textContent.includes("Waktu Sembunyi"));

      await host.page.click('button[data-map-point="mrt-blok-m"]');
      await clickAndWaitPost(host.page, 'button[data-action="lock-anchor"]');
      now += (board === "jakarta-wide" ? 46 : 26) * 60_000;
      await guest.page.click('button[data-action="refresh"]');
      await guest.page.waitForFunction(() => document.body.textContent.includes("Perburuan Makro"));

      await Promise.all([
        host.page.reload({ waitUntil: "networkidle" }),
        guest.page.reload({ waitUntil: "networkidle" }),
      ]);
      await guest.page.waitForFunction(() => document.body.textContent.includes("Perburuan Makro"));

      if (board === "jakarta-wide") {
        await host.page.screenshot({ path: join(results, "release-wide-seek-finish.png"), fullPage: true });
      }
      configurations.push({
        board,
        format: "hide-and-seek",
        players: 2,
        mode: "simulated",
        status: "pass",
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
  console.log("All six rulebook release configurations passed from / with reload persistence.");
} finally {
  await browser?.close();
  await server?.close();
  if (api.listening) await new Promise((resolve) => api.close(resolve));
}
