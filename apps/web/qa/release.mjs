import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { preview } from "vite";
import { createRecordedMidtransAdapter, createSoloServer } from "../../api/dist/index.js";
import { phoneOptions } from "./profile.mjs";
import { openEdition } from "./catalog.mjs";

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

  async function refreshSeekRoom(page) {
    await page.locator(".sg-room-menu summary").click();
    await page.locator('button[data-action="refresh"]').click();
    await page.waitForFunction(() => !document.querySelector('[aria-busy="true"]'));
  }

  async function launchFromRoot(page, { players, format, board }) {
    await page.goto(origin, { waitUntil: "networkidle" });
    await page.getByRole("heading", { name: "Pilih permainan", level: 1 }).waitFor();
    await openEdition(page, format, board);
    if (format === "claim-the-city" && players === 2) {
      await page.getByRole("button", { name: "Grup", exact: true }).click();
    }
    await page.getByRole("button", { name: players === 2 ? "Main Grup" : "Main Solo", exact: true }).click();
    await page.waitForFunction(() => document.body.textContent.includes("Ruang Tunggu"));
  }

  const configurations = [];

  // A18: Verify inspiration credit and official series link in mobile guide dialog.
  const creditCheck = await openDevice();
  try {
    await creditCheck.page.goto(origin);
    await creditCheck.page.getByRole("button", { name: "Tentang", exact: true }).click();
    const guide = creditCheck.page.getByRole("dialog", { name: "Tentang Kelana Ria" });
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
      await dev.page.locator("#rb-claim-map-host[data-map-ready=true]").waitFor();
      await dev.page.getByRole("button", { name: "Skor", exact: true }).click();
      assert.match(await dev.page.locator(".cg-score-grid").innerText(),
        board === "jakarta-wide" ? /0\/5.*0\/3/s : /0\/4.*0\/2/s);
      assert.ok(await dev.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));

      await dev.page.reload({ waitUntil: "networkidle" });
      await dev.page.waitForFunction(() => document.body.textContent.includes("Permainan Aktif"));

      if (board === "jakarta-wide") {
        now += 3 * 60 * 60 * 1000;
        await dev.page.getByTestId("claim-outcome").waitFor();
        assert.match(await dev.page.getByTestId("claim-outcome").innerText(), /Sesi Solo Berakhir.*Waktu ronde habis/s);
        await dev.page.screenshot({ path: join(results, "release-wide-solo-finish.png"), fullPage: true });
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
        now += 3 * 60 * 60 * 1000;
        await host.page.getByTestId("claim-outcome").waitFor();
        await guest.page.getByTestId("claim-outcome").waitFor();
        assert.match(await host.page.getByTestId("claim-outcome").innerText(), /Seri!.*Waktu ronde habis/s);
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

      await host.page.locator('button[data-map-point="mrt-blok-m"]').press("Enter");
      await clickAndWaitPost(host.page, 'button[data-action="lock-anchor"]');
      now += (board === "jakarta-wide" ? 46 : 26) * 60_000;
      await refreshSeekRoom(guest.page);
      await guest.page.waitForFunction(() => document.body.textContent.includes("Perburuan Makro"));

      await Promise.all([
        host.page.reload({ waitUntil: "networkidle" }),
        guest.page.reload({ waitUntil: "networkidle" }),
      ]);
      await guest.page.waitForFunction(() => document.body.textContent.includes("Perburuan Makro"));

      await guest.page.locator("[data-map-ready=true]").waitFor();
      await guest.page.screenshot({ path: join(results, `release-${board}-seek-map.png`) });
      await guest.page.locator('button[data-map-point="mrt-blok-m"]').press("Enter");
      await clickAndWaitPost(guest.page, 'button[data-action="trigger-endgame"]');
      await refreshSeekRoom(host.page);
      const code = (await host.page.locator('[data-testid="hider-found-code"]').textContent()).trim();
      await guest.page.locator("#rb-found-input").fill(code);
      await clickAndWaitPost(guest.page, 'button[data-action="submit-found-code"]');
      await refreshSeekRoom(host.page);
      for (const page of [host.page, guest.page]) {
        await clickAndWaitPost(page, 'button[data-action="regroup"]');
      }
      await guest.page.locator('.sg-game[data-role="hider"]').waitFor();
      const secondStart = guest.page.locator('.board-map-pin-start[data-map-point="mrt-blok-m"]');
      await secondStart.press("Enter");
      await clickAndWaitPost(guest.page, 'button[data-action="lock-anchor"]');
      now += 24 * 60 * 60_000;
      for (const page of [host.page, guest.page]) {
        await refreshSeekRoom(page);
        await page.getByRole("heading", { name: "Hasil permainan" }).waitFor();
      }
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
        verifiedRoleSwapAndResults: true,
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
