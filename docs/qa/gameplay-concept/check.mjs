import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";
import { assertCleanUiCopy } from "../../../apps/web/qa/copy-guard.mjs";
import { contrastRatio } from "../../../apps/web/qa/contrast.mjs";

const origin = process.argv[2] ?? "http://localhost:8080";
const screenshotDir = path.resolve(process.argv[3] ?? "apps/web/qa-results/gameplay-concept");
await mkdir(screenshotDir, { recursive: true });
const browser = await chromium.launch({ channel: "chromium", executablePath: process.env.CHROMIUM_PATH });
console.log(`Chromium ${browser.version()}`);

async function menu(page, action) {
  await page.getByLabel("Menu lainnya").press("Enter");
  await page.locator(`.menu button[data-action="${action}"]`).click();
}

async function verifyScreen(page, label) {
  await assertCleanUiCopy(page, label);
  const checks = await page.evaluate(() => ({
    fits: document.documentElement.scrollWidth <= innerWidth && document.documentElement.scrollHeight <= innerHeight,
    usableBoard: document.querySelector(".board").getBoundingClientRect().height >= 130,
    smallTargets: [...document.querySelectorAll("button, summary, .motion-toggle")]
      .filter(el => el.getClientRects().length && !el.closest("details:not([open]) .menu"))
      .filter(el => {
        const box = el.getBoundingClientRect();
        return box.width < 44 || box.height < 44;
      }).map(el => el.textContent.trim()),
  }));
  assert.equal(checks.fits, true, label + " fits viewport");
  assert.equal(checks.usableBoard, true, label + " preserves board space");
  assert.deepEqual(checks.smallTargets, [], label + " touch targets");
  await page.screenshot({ path: path.join(screenshotDir, label + ".png"), animations: "disabled" });
}

function assertMotionWorks(page) {
  return page.evaluate(() =>
    matchMedia("(prefers-reduced-motion: reduce)").matches || getComputedStyle(document.querySelector(".offer-card"), "::before").pointerEvents === "none");
}

try {
  for (const viewport of [{ width: 390, height: 844 }, { width: 320, height: 640 }]) {
    const suffix = viewport.width;
    const reducedMotion = suffix === 320 ? "reduce" : "no-preference";
    const page = await browser.newPage({ viewport, reducedMotion, isMobile: true, hasTouch: true });
    const responseStatuses = [];
    page.on("response", res => { if (res.status() >= 400) responseStatuses.push(res.status()); });
    const app = `${origin}/docs/qa/gameplay-concept/`;
    const action = (name, value) => page.locator(`#sheet button[data-action="${name}"]${value ? `[data-value="${value}"]` : ""}`);
    const check = (state, mode) => verifyScreen(page, `${mode}-${state}-${suffix}`);
    const status = page.getByRole("status");
    const nav = value => page.locator(`#tabs button[data-value="${value}"]`);

    await page.goto(app);
    await page.evaluate(() => document.fonts.ready);
    for (const selector of [".hud", ".clock", ".board-chip", ".action", ".tabs button[aria-pressed=true]"]) {
      assert.ok(await contrastRatio(page.locator(selector)) >= 4.5, `Readable contrast on ${selector}`);
    }
    const map = await page.locator(".map-art").elementHandle();
    assert.match(await page.locator("#sheet h2").innerText(), /Anjungan Sungai Sagara/);
    await check("landmark", "claim");
    await page.getByRole("button", { name: "Lipat panel permainan" }).press("Escape");
    assert.equal(await nav("landmark").evaluate(el => el === document.activeElement), true);
    await check("board", "claim");
    await page.getByRole("button", { name: /Anjungan Sungai Sagara/ }).press("Enter");
    assert.equal(await page.locator("#sheet h2").evaluate(el => el === document.activeElement), true);

    await menu(page, "reject");
    await action("check").press("Enter");
    await status.getByText("Menunggu konfirmasi check-in…").waitFor();
    assert.equal(await page.locator(".board-delta").count(), 0);
    assert.equal(await action("check").isDisabled(), true);
    await check("pending", "claim");
    await status.getByText(/Aksi ditolak dalam simulasi/).waitFor();
    assert.ok(await contrastRatio(status) >= 4.5, "Readable contrast on retry notice");
    assert.equal(await action("check").evaluate(el => el === document.activeElement), true);
    await check("retry", "claim");
    await action("check").click();
    await page.getByRole("heading", { name: "Amati anjungan" }).waitFor();
    await check("challenge", "claim");
    await action("challenge-choice", "roof").click();
    await action("challenge").click();
    await status.getByText(/Anjungan Sagara terkunci/).waitFor();
    await check("locked", "claim");
    assert.equal(await map.evaluate(node => node === document.querySelector(".map-art")), true);

    await action("tab-cards").click();
    assert.equal(await assertMotionWorks(page), true);
    if (suffix === 320) assert.equal(await page.locator(".offer-card.deal").count(), 0);
    await action("choose-card", "weight").press("Space");
    assert.equal(await action("choose-card", "weight").getAttribute("aria-pressed"), "true");
    await check("offer", "claim");
    await menu(page, "connection");
    assert.equal(await action("keep").isDisabled(), true);
    await check("offline", "claim");
    await menu(page, "connection");
    assert.equal(await action("choose-card", "weight").getAttribute("aria-pressed"), "true");
    assert.equal(await page.locator(".offer-card.deal").count(), 0);
    await action("keep").click();
    await status.getByText(/Kartu disimpan di tangan/).waitFor();
    await action("inspect-card").click();
    const target = page.getByRole("button", { name: /Anjungan Sungai Sagara .*Terkunci/ });
    await target.press("Enter");
    await check("card-target", "claim");
    await action("cast").click();
    await status.getByText(/Bobot landmark dikonfirmasi/).waitFor();
    await nav("score").click();
    assert.match(await page.locator(".score-row").first().innerText(), /3/);
    await check("score", "claim");

    await menu(page, "map-error");
    await page.locator("#board-list button").first().click();
    assert.match(await page.locator("#map-status").innerText(), /pilih dari daftar/);
    assert.match(await page.locator("#sheet h2").innerText(), /Anjungan/);
    await check("list", "claim");
    await menu(page, "map-error");
    assert.equal(await map.evaluate(node => node === document.querySelector(".map-art")), true);
    await menu(page, "start-seek");

    assert.equal(await page.getByRole("button", { name: "Kode", exact: true }).count(), 0);
    await action("radius", "1500").click();
    assert.equal(await page.locator("#radar").getAttribute("data-state"), "preview");
    await check("radar", "seek");
    await action("ask").click();
    await status.getByText(/Memeriksa pengiriman Radar/).waitFor();
    assert.equal(await action("radius", "1500").isDisabled(), true);
    await status.getByText(/Pertanyaan dikirim/).waitFor();
    assert.equal(await page.locator("#radar").getAttribute("data-state"), "pending");
    await check("sent", "seek");

    await menu(page, "switch-role");
    assert.equal(await page.locator("#radar").isHidden(), true);
    assert.equal(await page.locator(".you").isHidden(), true);
    assert.equal(await page.getByRole("button", { name: "Kode", exact: true }).count(), 1);
    await action("answer-choice", "inside").click();
    assert.equal(await action("answer").isDisabled(), true);
    await action("answer-choice", "outside").click();
    await check("hider-answer", "seek");
    await action("answer").click();
    await status.getByText(/Jawaban dikirim/).waitFor();
    await action("choose-card", "bonus").click();
    await check("draw", "seek");
    await action("keep").click();
    await status.getByText(/Kartu disimpan di tangan/).waitFor();
    await check("kept", "seek");

    await nav("code").click();
    await action("show-code").click();
    assert.equal(await page.locator(".secret").innerText(), "2641");
    await menu(page, "switch-role");
    assert.equal(await page.locator(".secret").count(), 0);
    assert.equal(await page.getByRole("button", { name: "Kode", exact: true }).count(), 0);
    assert.equal(await page.getByText("Tambah Waktu", { exact: true }).count(), 0);
    assert.equal(await page.locator("#radar").getAttribute("data-state"), "confirmed");
    await check("deduction", "seek");
    assert.equal(await map.evaluate(node => node === document.querySelector(".map-art")), true);

    await page.goto(app + "?mode=seek&role=hider");
    await action("answer-choice", "outside").click();
    await action("answer").click();
    await status.getByText(/Jawaban dikirim/).waitFor();
    await menu(page, "expire");
    assert.equal(await action("keep").count(), 0);
    await check("expired", "seek");
    assert.deepEqual(responseStatuses, []);
    await page.close();
  }
  const safePage = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true });
  await safePage.goto(`${origin}/docs/qa/gameplay-concept/`);
  await safePage.addStyleTag({ content: ":root { --safe-top: 44px; --safe-bottom: 34px }" });
  await safePage.getByRole("button", { name: /Check-in/ }).waitFor();
  const areas = await safePage.evaluate(() => ({
    top: document.querySelector(".hud-title").getBoundingClientRect().top,
    bottom: document.querySelector(".tabs").getBoundingClientRect().bottom,
  }));
  assert.ok(areas.top >= 44 && areas.bottom <= 844 - 34);
  await verifyScreen(safePage, "claim-safe-area-390");
  await safePage.close();
  console.log("Gameplay concept passed · both phone sizes, safe-area insets, reduced motion, privacy, retry, reconnect, expiry and list fallback");
} finally {
  await browser.close();
}
