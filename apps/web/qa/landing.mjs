import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { createSoloServer } from "../../api/dist/index.js";
import { assertCleanUiCopy } from "./copy-guard.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const distDir = join(root, "dist");
const defaultResultsDir = join(root, "qa-results");

const YOUTUBE_HOST_RE = /(?:youtube\.com|youtube-nocookie\.com|ytimg\.com|googlevideo\.com)/i;

async function assertNoOverflow(page, label) {
  const { scrollWidth, innerWidth } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    innerWidth: window.innerWidth,
  }));
  assert.ok(
    scrollWidth <= innerWidth,
    `Horizontal overflow on ${label}: scrollWidth=${scrollWidth} > innerWidth=${innerWidth}`,
  );
}

async function assertMinTouchTarget(locator, label) {
  const box = await locator.boundingBox();
  assert.ok(
    box && box.width >= 44 && box.height >= 44,
    `Touch target below 44x44 for ${label}: ${JSON.stringify(box)}`,
  );
}

export async function exerciseLandingPage({ browser, results = defaultResultsDir }) {
  await mkdir(results, { recursive: true });

  // 1. Server WITHOUT DEMO_VIDEO_YOUTUBE_ID: facade is cleanly omitted, /catalog direct reload works
  const unconfiguredServer = createSoloServer({
    databasePath: ":memory:",
    staticDir: distDir,
    allowSimulatedLocation: true,
    allowSandboxAuthOtp: true,
  });
  unconfiguredServer.listen(0, "127.0.0.1");
  await once(unconfiguredServer, "listening");
  const unconfiguredBase = `http://127.0.0.1:${unconfiguredServer.address().port}`;

  // 2. Server WITH DEMO_VIDEO_YOUTUBE_ID configured via youtu.be URL
  const demoVideoId = "K3lAnA_R1a0";
  const configuredServer = createSoloServer({
    databasePath: ":memory:",
    staticDir: distDir,
    allowSimulatedLocation: true,
    allowSandboxAuthOtp: true,
    demoVideoYoutubeId: `https://youtu.be/${demoVideoId}?si=kelana-qa`,
  });
  configuredServer.listen(0, "127.0.0.1");
  await once(configuredServer, "listening");
  const configuredBase = `http://127.0.0.1:${configuredServer.address().port}`;

  try {
    // 1a. Verify unconfigured Landing Page omits dead video player cleanly across 390x844 and 320x640
    for (const viewport of [
      { width: 390, height: 844 },
      { width: 320, height: 640 },
    ]) {
      const ctx = await browser.newContext({ viewport, serviceWorkers: "block" });
      const page = await ctx.newPage();
      const ytReqs = [];
      page.on("request", (req) => {
        if (YOUTUBE_HOST_RE.test(req.url())) ytReqs.push(req.url());
      });
      try {
        await page.goto(unconfiguredBase, { waitUntil: "networkidle" });
        await page.getByRole("heading", { name: "Ubah Jakarta jadi papan permainan nyata", level: 1 }).waitFor();
        assert.equal(await page.getByTestId("landing-demo-video").count(), 0, "Unconfigured demo video must be omitted cleanly");
        assert.equal(ytReqs.length, 0, "Zero YouTube requests when unconfigured");
        assert.equal(await page.locator(".lp-step-card").count(), 3, "Expected 3 visual Cara Bermain step cards");
        assert.equal(await page.locator(".lp-format-card").count(), 2, "Expected 2 format comparison cards");
        await page.getByTestId("landing-open-studio").waitFor();
        await assertMinTouchTarget(page.getByTestId("landing-choose-game"), `Pilih Permainan (${viewport.width}px)`);
        await assertMinTouchTarget(page.getByTestId("landing-join-code"), `Gabung dengan Kode (${viewport.width}px)`);
        await assertMinTouchTarget(page.getByTestId("landing-top-catalog"), `Top Katalog (${viewport.width}px)`);
        await assertMinTouchTarget(page.getByTestId("landing-open-studio"), `Studio CTA (${viewport.width}px)`);
        await assertNoOverflow(page, `Landing unconfigured ${viewport.width}x${viewport.height}`);
        await assertCleanUiCopy(page, `Landing unconfigured ${viewport.width}x${viewport.height}`);
      } finally {
        await ctx.close();
      }
    }

    // 2a. Configured DEMO_VIDEO_YOUTUBE_ID: 16:9 poster facade below Hero CTAs, ZERO YouTube requests prior to click,
    //     clicking Play swaps in youtube-nocookie.com iframe, and offline state displays calm notice without broken iframe.
    for (const viewport of [
      { width: 390, height: 844 },
      { width: 320, height: 640 },
    ]) {
      const ctx = await browser.newContext({ viewport, serviceWorkers: "block" });
      const page = await ctx.newPage();
      const ytReqsBeforeClick = [];
      const ytReqsAfterClick = [];
      let clickedPlay = false;

      // Intercept external YouTube embed cleanly so QA stays deterministic offline/in sandbox
      await ctx.route("**/*youtube-nocookie.com/**", (route) => {
        if (clickedPlay) ytReqsAfterClick.push(route.request().url());
        else ytReqsBeforeClick.push(route.request().url());
        return route.fulfill({
          status: 200,
          contentType: "text/html; charset=utf-8",
          body: "<!doctype html><title>YouTube Mock</title><p>Mock YouTube Embed</p>",
        });
      });
      page.on("request", (req) => {
        if (YOUTUBE_HOST_RE.test(req.url())) {
          if (clickedPlay) ytReqsAfterClick.push(req.url());
          else ytReqsBeforeClick.push(req.url());
        }
      });

      try {
        await page.goto(configuredBase, { waitUntil: "networkidle" });
        await page.getByRole("heading", { name: "Ubah Jakarta jadi papan permainan nyata", level: 1 }).waitFor();
        const demoSection = page.getByTestId("landing-demo-video");
        await demoSection.waitFor();
        assert.equal(await demoSection.getAttribute("data-demo-state"), "poster");

        // Verify 16:9 poster image loaded locally right below Hero CTAs
        const posterImg = demoSection.locator("img.lp-demo-poster");
        const posterMetrics = await posterImg.evaluate((img) => ({
          complete: img.complete,
          naturalWidth: img.naturalWidth,
          naturalHeight: img.naturalHeight,
          rect: img.getBoundingClientRect().toJSON(),
        }));
        assert.ok(posterMetrics.complete && posterMetrics.naturalWidth > 0, "Local WebP poster must load");
        const aspect = posterMetrics.rect.width / posterMetrics.rect.height;
        assert.ok(Math.abs(aspect - 16 / 9) < 0.08, `Expected ~16:9 demo poster, got ratio ${aspect.toFixed(2)}`);

        const heroCtaBox = await page.getByTestId("landing-choose-game").boundingBox();
        assert.ok(heroCtaBox && posterMetrics.rect.top >= heroCtaBox.y, "Demo facade must sit below Hero CTAs");
        assert.equal(await demoSection.locator("iframe").count(), 0, "No iframe before tapping Play");
        assert.deepEqual(ytReqsBeforeClick, [], "Zero YouTube requests before clicking Play");
        await assertNoOverflow(page, `Landing with demo poster ${viewport.width}x${viewport.height}`);
        await assertCleanUiCopy(page, `Landing with demo poster ${viewport.width}x${viewport.height}`);
        if (viewport.width === 390) {
          await page.screenshot({ path: join(results, "landing-mobile-390.png"), fullPage: true });
        } else {
          await page.screenshot({ path: join(results, "landing-mobile-320.png"), fullPage: true });
        }

        // Tap Play while online -> swaps in privacy-enhanced youtube-nocookie.com embed + Buka di YouTube link
        clickedPlay = true;
        await page.getByTestId("landing-demo-play").click();
        const iframe = demoSection.locator("iframe.lp-demo-iframe");
        await iframe.waitFor();
        assert.equal(
          await iframe.getAttribute("src"),
          `https://www.youtube-nocookie.com/embed/${demoVideoId}?autoplay=1&rel=0&playsinline=1`,
        );
        const ytLink = page.getByTestId("landing-demo-youtube-link");
        await ytLink.waitFor();
        assert.equal(await ytLink.getAttribute("href"), `https://www.youtube.com/watch?v=${demoVideoId}`);
        assert.ok(ytReqsAfterClick.length >= 1, "Expected youtube-nocookie embed request after tapping Play");
        await assertNoOverflow(page, `Landing playing demo ${viewport.width}x${viewport.height}`);

        // Offline state: poster remains visible with calm Indonesian offline message and zero broken iframe
        await ctx.setOffline(true);
        await page.evaluate(() => window.dispatchEvent(new Event("offline")));
        await page.getByTestId("landing-demo-offline").waitFor();
        assert.match(await page.getByTestId("landing-demo-offline").innerText(), /Video demo membutuhkan koneksi internet/);
        assert.equal(await demoSection.locator("iframe").count(), 0, "Offline state must not render broken iframe");
        assert.equal(await demoSection.locator("img.lp-demo-poster").count(), 1, "Offline state keeps local poster");
        await assertNoOverflow(page, `Landing demo offline ${viewport.width}x${viewport.height}`);
        if (viewport.width === 390) {
          await page.screenshot({ path: join(results, "landing-demo-offline.png") });
        }
        await ctx.setOffline(false);
        await page.evaluate(() => window.dispatchEvent(new Event("online")));
        await page.getByTestId("landing-demo-play").waitFor();
      } finally {
        await ctx.close();
      }
    }

    // 3. Navigation flow: / -> Pilih Permainan -> /catalog (direct reload) -> brand link -> / -> Format anchor -> Studio -> back to /catalog
    //    Also verify lazy GSAP bootstrap, zero orphaned .pin-spacer nodes on SPA round-trip, and prefers-reduced-motion visibility.
    {
      const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: "block" });
      const page = await ctx.newPage();
      const pageErrors = [];
      page.on("pageerror", (error) => pageErrors.push(error.message));
      try {
        await page.goto(configuredBase, { waitUntil: "networkidle" });
        await page.locator('[data-testid="landing-page"][data-landing-gsap="active"]').waitFor();
        assert.equal(await page.locator(".pin-spacer").count(), 0, "Baseline GSAP mount should not leave stray pin spacers");

        await page.getByTestId("landing-choose-game").click();
        await page.getByRole("heading", { name: "Pilih permainan", level: 1 }).waitFor();
        assert.equal(new URL(page.url()).pathname, "/catalog");
        assert.equal(await page.locator(".pin-spacer").count(), 0, "Navigating / -> /catalog must leave zero orphaned pin spacers");
        assert.match(
          await page.getByTestId("catalog-subtitle-claim-the-city").innerText(),
          /Rebut & kunci landmark nyata untuk kuasai zona kota\./,
        );
        assert.match(
          await page.getByTestId("catalog-subtitle-hide-and-seek").innerText(),
          /Sembunyi di stasiun transit; pencari melacak lewat radar & petunjuk\./,
        );
        await assertNoOverflow(page, "Catalog mobile 390x844");
        await page.screenshot({ path: join(results, "catalog-mobile-390.png"), fullPage: true });

        // Direct reload on /catalog under SERVE_WEB static handler
        const reloadRes = await page.reload({ waitUntil: "networkidle" });
        assert.equal(reloadRes.status(), 200);
        await page.getByRole("heading", { name: "Pilih permainan", level: 1 }).waitFor();

        // Compact top-left Kelana Ria brand link navigates back to /
        await page.locator('header.mast a.brand[href="/"]').click();
        await page.getByRole("heading", { name: "Ubah Jakarta jadi papan permainan nyata", level: 1 }).waitFor();
        await page.locator('[data-testid="landing-page"][data-landing-gsap="active"]').waitFor();
        assert.equal(new URL(page.url()).pathname, "/");

        // Verify prefers-reduced-motion: reduce keeps all landing sections visible with zero pin spacers
        await page.emulateMedia({ reducedMotion: "reduce" });
        await page.locator('[data-testid="landing-page"][data-landing-gsap="reduced"]').waitFor();
        assert.equal(await page.locator(".pin-spacer").count(), 0, "Reduced motion must not create pin spacers");
        const hiddenSections = await page.evaluate(() => {
          return Array.from(document.querySelectorAll(".lp-hero, .lp-section, .lp-studio, .lp-footer"))
            .filter((el) => parseFloat(getComputedStyle(el).opacity) < 0.99).length;
        });
        assert.equal(hiddenSections, 0, "Reduced motion must keep every landing section fully visible");
        await assertNoOverflow(page, "Landing reduced-motion 390x844");
        await page.emulateMedia({ reducedMotion: "no-preference" });
        await page.locator('[data-testid="landing-page"][data-landing-gsap="active"]').waitFor();

        // Format comparison 1-tap link goes to /catalog#catalog-hide-and-seek
        await page.getByTestId("landing-format-seek").click();
        await page.getByRole("heading", { name: "Pilih permainan", level: 1 }).waitFor();
        assert.equal(new URL(page.url()).pathname, "/catalog");
        assert.equal(new URL(page.url()).hash, "#catalog-hide-and-seek");
        assert.equal(await page.locator(".pin-spacer").count(), 0, "Leaving / via format CTA must leave zero pin spacers");

        // Studio teaser CTA from / opens Studio, and returning to catalog lands on /catalog (NOT /)
        await page.goto(configuredBase, { waitUntil: "networkidle" });
        await page.getByTestId("landing-open-studio").click();
        await page.getByTestId("studio-auth-gate").waitFor();
        await page.getByRole("button", { name: /Kembali ke Katalog/ }).click();
        await page.getByRole("heading", { name: "Pilih permainan", level: 1 }).waitFor();
        assert.equal(new URL(page.url()).pathname, "/catalog", "Returning from Studio must land on /catalog");
        assert.deepEqual(pageErrors, [], "Zero uncaught client errors across landing <-> catalog round-trip");
      } finally {
        await ctx.close();
      }
    }

    // 4. Gabung dengan Kode directly from / + active room top shortcut on / + exit to /catalog
    {
      const hostCtx = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: "block" });
      const guestCtx = await browser.newContext({ viewport: { width: 320, height: 640 }, serviceWorkers: "block" });
      const hostPage = await hostCtx.newPage();
      const guestPage = await guestCtx.newPage();
      try {
        await hostPage.goto(`${configuredBase}/catalog`, { waitUntil: "networkidle" });
        await hostPage.locator('.cat-card[data-pack-id="official-jakarta-compact-claim"]').click();
        await hostPage.getByRole("button", { name: "Grup", exact: true }).click();
        await hostPage.getByRole("button", { name: "Main Grup", exact: true }).click();
        await hostPage.getByTestId("lobby-invite-card").waitFor();
        const roomCode = (await hostPage.getByTestId("lobby-room-code").innerText()).trim();
        assert.match(roomCode, /^RC-/);

        // Returning Host opening / sees top Lanjutkan Permainan shortcut immediately above Hero
        await hostPage.goto(configuredBase, { waitUntil: "networkidle" });
        const resumeBanner = hostPage.getByTestId("resume-room-banner");
        await resumeBanner.waitFor();
        assert.ok((await resumeBanner.innerText()).includes(`Ruang ${roomCode}`));
        const bannerBox = await resumeBanner.boundingBox();
        const heroBox = await hostPage.locator(".lp-hero").boundingBox();
        assert.ok(bannerBox && heroBox && bannerBox.y < heroBox.y, "Resume banner must appear above the Hero on /");
        await assertNoOverflow(hostPage, "Landing with active resume banner 390x844");
        await resumeBanner.getByRole("button", { name: "Lanjutkan Permainan", exact: true }).click();
        await hostPage.getByTestId("lobby-invite-card").waitFor();
        assert.equal(new URL(hostPage.url()).searchParams.get("room"), roomCode);

        // Guest joins directly from / using Gabung dengan Kode on 320x640
        await guestPage.goto(configuredBase, { waitUntil: "networkidle" });
        await guestPage.getByTestId("landing-join-code").click();
        await guestPage.getByTestId("join-room-modal").waitFor();
        await assertNoOverflow(guestPage, "Landing Join-by-Code modal 320x640");
        await guestPage.fill("#cat-join-code", roomCode.toLowerCase());
        await guestPage.fill("#cat-join-name", "Sari");
        await guestPage.getByTestId("join-modal-submit").click();
        await guestPage.getByTestId("claim-team-switcher").waitFor();
        assert.equal(new URL(guestPage.url()).searchParams.get("room"), roomCode);

        // Guest leaves room -> lands cleanly on /catalog (NOT /)
        await guestPage.getByTestId("lobby-leave-btn").click();
        await guestPage.getByTestId("confirm-dialog-submit").click();
        await guestPage.getByRole("heading", { name: "Pilih permainan", level: 1 }).waitFor();
        assert.equal(new URL(guestPage.url()).pathname, "/catalog", "Leaving room must return to /catalog");
      } finally {
        await hostCtx.close();
        await guestCtx.close();
      }
    }

    // 5. PWA Install Prompt: simulated beforeinstallprompt (Android/Chrome) + iOS Safari fallback + dismissal + standalone suppression
    {
      // 5a. Simulated beforeinstallprompt on Android Chrome
      const androidCtx = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: "block" });
      const androidPage = await androidCtx.newPage();
      try {
        await androidPage.goto(configuredBase, { waitUntil: "networkidle" });
        assert.equal(await androidPage.getByTestId("pwa-install-banner").count(), 0, "Banner hidden until beforeinstallprompt fires");

        await androidPage.evaluate(() => {
          window.__pwaPromptCalled = 0;
          const ev = new Event("beforeinstallprompt", { cancelable: true });
          ev.prompt = async () => { window.__pwaPromptCalled += 1; };
          ev.userChoice = Promise.resolve({ outcome: "accepted", platform: "web" });
          window.dispatchEvent(ev);
        });
        await androidPage.getByTestId("pwa-install-trigger").waitFor();
        assert.match(await androidPage.getByTestId("pwa-install-trigger").innerText(), /Pasang Aplikasi/);
        await assertNoOverflow(androidPage, "Landing with Android PWA banner");
        await androidPage.getByTestId("pwa-install-trigger").click();
        await androidPage.waitForFunction(() => window.__pwaPromptCalled === 1);
        assert.equal(await androidPage.getByTestId("pwa-install-banner").count(), 0, "Banner hides after prompt resolves");

        // Re-fire on /catalog and verify persistent dismissal in localStorage
        await androidPage.goto(`${configuredBase}/catalog`, { waitUntil: "networkidle" });
        await androidPage.evaluate(() => {
          const ev = new Event("beforeinstallprompt", { cancelable: true });
          ev.prompt = async () => {};
          ev.userChoice = Promise.resolve({ outcome: "dismissed", platform: "web" });
          window.dispatchEvent(ev);
        });
        await androidPage.getByTestId("pwa-install-trigger").waitFor();
        await androidPage.getByTestId("pwa-install-dismiss").click();
        assert.equal(await androidPage.getByTestId("pwa-install-banner").count(), 0);

        await androidPage.reload({ waitUntil: "networkidle" });
        await androidPage.evaluate(() => {
          const ev = new Event("beforeinstallprompt", { cancelable: true });
          ev.prompt = async () => {};
          ev.userChoice = Promise.resolve({ outcome: "dismissed", platform: "web" });
          window.dispatchEvent(ev);
        });
        assert.equal(await androidPage.getByTestId("pwa-install-banner").count(), 0, "Dismissed PWA banner must remain hidden after reload");
      } finally {
        await androidCtx.close();
      }

      // 5b. iOS Safari fallback (non-standalone) on 320x640 -> opens 2-step guide dialog, persistent dismiss works
      const iosCtx = await browser.newContext({
        viewport: { width: 320, height: 640 },
        serviceWorkers: "block",
        userAgent:
          "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1",
      });
      const iosPage = await iosCtx.newPage();
      try {
        await iosPage.goto(configuredBase, { waitUntil: "networkidle" });
        await iosPage.getByTestId("pwa-ios-trigger").waitFor();
        assert.match(await iosPage.getByTestId("pwa-ios-trigger").innerText(), /Pasang di iPhone/);
        await assertNoOverflow(iosPage, "Landing iOS Safari PWA banner 320x640");
        await iosPage.getByTestId("pwa-ios-trigger").click();
        const iosDialog = iosPage.getByTestId("pwa-ios-dialog");
        await iosDialog.waitFor();
        const dialogText = await iosDialog.innerText();
        assert.match(dialogText, /1\. Ketuk ikon Bagikan/);
        assert.match(dialogText, /2\. Pilih Tambah ke Layar Utama/);
        await assertNoOverflow(iosPage, "iOS Safari install guide dialog 320x640");
        await iosPage.screenshot({ path: join(results, "pwa-ios-install-guide.png") });
        await iosPage.getByTestId("pwa-ios-dismiss").click();
        await iosDialog.waitFor({ state: "hidden" });
        assert.equal(await iosPage.getByTestId("pwa-install-banner").count(), 0);
        await iosPage.goto(`${configuredBase}/catalog`, { waitUntil: "networkidle" });
        assert.equal(await iosPage.getByTestId("pwa-install-banner").count(), 0, "Dismissed iOS prompt stays hidden on /catalog");
      } finally {
        await iosCtx.close();
      }

      // 5c. Standalone display-mode hides install prompt completely
      const standaloneCtx = await browser.newContext({
        viewport: { width: 390, height: 844 },
        serviceWorkers: "block",
        userAgent:
          "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1",
      });
      await standaloneCtx.addInitScript(() => {
        Object.defineProperty(navigator, "standalone", { configurable: true, value: true });
      });
      const standalonePage = await standaloneCtx.newPage();
      try {
        await standalonePage.goto(`${configuredBase}/catalog`, { waitUntil: "networkidle" });
        assert.equal(await standalonePage.getByTestId("pwa-install-banner").count(), 0, "Standalone mode hides PWA install prompt");
      } finally {
        await standaloneCtx.close();
      }
    }

    console.log("Landing page, YouTube Lite facade, /catalog route split, Join-by-Code, Resume banner, and PWA install checks passed.");
  } finally {
    await new Promise((resolve) => unconfiguredServer.close(resolve));
    await new Promise((resolve) => configuredServer.close(resolve));
  }
}

if (import.meta.main) {
  const launch = { channel: "chromium", executablePath: process.env.CHROMIUM_PATH || undefined };
  const browser = await chromium.launch(launch);
  try {
    await exerciseLandingPage({ browser, results: defaultResultsDir });
  } finally {
    await browser.close();
  }
}
