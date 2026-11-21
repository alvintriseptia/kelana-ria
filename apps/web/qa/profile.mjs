import assert from 'node:assert/strict';
import { once } from 'node:events';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export const profile = {
  runs: 3,
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 2,
  cpuSlowdown: 4,
  latencyMs: 150,
  downKbps: 1600,
  upKbps: 750,
  cache: 'Fresh browser context for each navigation (empty storage and SW), page HTTP cache disabled',
  throttling: 'Chromium DevTools page target',
};

export const budgets = { lcpMs: 2500, cls: 0.10, transferredJsBytes: 100 * 1024 };

export function phoneOptions(browser) {
  return {
    viewport: profile.viewport,
    deviceScaleFactor: profile.deviceScaleFactor,
    isMobile: true,
    hasTouch: true,
    locale: 'id-ID',
    // Keep the UA consistent with the actual executable, including local overrides.
    userAgent: `Mozilla/5.0 (Linux; Android 13; Mobile) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${browser.version()} Mobile Safari/537.36`,
  };
}

function observeVitals() {
  const vitals = { lcpMs: null, cls: 0 };
  window.chooserVitals = vitals;
  new PerformanceObserver(list => {
    vitals.lcpMs = list.getEntries().at(-1).startTime;
  }).observe({ type: 'largest-contentful-paint', buffered: true });

  // CLS is the largest session window, with <1s between shifts and a 5s limit.
  let start = 0;
  let last = 0;
  let score = 0;
  new PerformanceObserver(list => {
    for (const shift of list.getEntries()) {
      if (shift.hadRecentInput) continue;
      if (!score || shift.startTime - last >= 1000 || shift.startTime - start >= 5000) {
        score = 0;
        start = shift.startTime;
      }
      score += shift.value;
      last = shift.startTime;
      vitals.cls = Math.max(vitals.cls, score);
    }
  }).observe({ type: 'layout-shift', buffered: true });
}

export async function guardChooser(context) {
  const requests = [];
  const locationCalls = [];
  context.on('request', request => requests.push({ url: request.url(), type: request.resourceType(), method: request.method() }));
  await context.exposeBinding('recordChooserLocation', (_, method) => locationCalls.push(method));
  await context.addInitScript(() => {
    for (const method of ['getCurrentPosition', 'watchPosition']) {
      navigator.geolocation[method] = () => {
        window.recordChooserLocation(method);
        return 0;
      };
    }
  });
  return { requests, locationCalls };
}

export async function checkChooserTraffic(traffic, origin, dist) {
  assert.deepEqual(traffic.locationCalls, [], 'The chooser requested the player’s location');
  const checked = new Set();
  for (const request of traffic.requests) {
    const url = new URL(request.url);
    if (url.protocol === 'data:') continue;
    assert.equal(url.origin, origin, `Unexpected non-shell request: ${url}`);
    assert.equal(request.method, 'GET', `Unexpected action on chooser: ${url}`);
    assert.doesNotMatch(url.pathname, /(?:\/assets\/solo-|maplibre|mapbox|geoapify|\/tiles?\/|\/api\/|\.(?:pbf|mvt|pmtiles)$)/i);
    // Inspect modules inside fetched production chunks, including chunks with hashed names.
    if (/\/assets\/.*\.m?js$/.test(url.pathname) && !checked.has(url.pathname)) {
      const map = JSON.parse(await readFile(join(dist, url.pathname + '.map'), 'utf8'));
      assert.ok(map.sources.length, `Empty module list for ${url.pathname}`);
      for (const module of map.sources) assert.doesNotMatch(module, /maplibre|mapbox-gl/i, 'Map renderer bundled into chooser');
      checked.add(url.pathname);
    }
  }
  assert.ok(checked.size, 'Expected to inspect the source map for the production chooser');
}

async function saveChromeTrace(cdp, path) {
  const finished = once(cdp, 'Tracing.tracingComplete');
  await cdp.send('Tracing.end');
  const [{ stream }] = await finished;
  const chunks = [];
  let eof = false;
  while (!eof) {
    const part = await cdp.send('IO.read', { handle: stream });
    chunks.push(Buffer.from(part.data, part.base64Encoded ? 'base64' : 'utf8'));
    eof = part.eof;
  }
  await cdp.send('IO.close', { handle: stream });
  await writeFile(path, Buffer.concat(chunks));
}

export async function measure(browser, origin, dist, results, run, httpServer) {
  const context = await browser.newContext(phoneOptions(browser));
  const transfers = [];
  // Count actual HTTP/1 response bytes, including SW registration and its install fetches,
  // which are separate from the page target in Chromium's Network domain.
  const observeTransfer = (request, response) => {
    const { socket } = request;
    const start = socket.bytesWritten;
    response.once('finish', () => {
      if (/javascript|ecmascript/i.test(String(response.getHeader('content-type'))) || /\.m?js(?:\?|$)/.test(request.url)) {
        transfers.push({ path: request.url, status: response.statusCode, transferredBytes: socket.bytesWritten - start });
      }
    });
  };
  httpServer.prependListener('request', observeTransfer);
  try {
    const traffic = await guardChooser(context);
    await context.addInitScript(observeVitals);
    const page = await context.newPage();
    const cdp = await context.newCDPSession(page);
    await cdp.send('Network.enable');
    await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
    await cdp.send('Network.emulateNetworkConditions', {
      offline: false, latency: profile.latencyMs,
      downloadThroughput: profile.downKbps * 1000 / 8,
      uploadThroughput: profile.upKbps * 1000 / 8,
      connectionType: 'cellular4g',
    });
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: profile.cpuSlowdown });
    const scripts = new Map();
    cdp.on('Network.responseReceived', event => {
      if (event.type === 'Script' || /javascript|ecmascript/i.test(event.response.mimeType)) {
        scripts.set(event.requestId, { url: event.response.url, transferredBytes: null });
      }
    });
    cdp.on('Network.loadingFinished', ({ requestId, encodedDataLength }) => {
      if (scripts.has(requestId)) scripts.get(requestId).transferredBytes = encodedDataLength;
    });
    if (run === 1) {
      await cdp.send('Tracing.start', {
        categories: 'loading,devtools.timeline,blink.user_timing',
        transferMode: 'ReturnAsStream',
      });
    }
    const response = await page.goto(origin);
    assert.equal(response.status(), 200);
    await page.getByRole('heading', { name: 'Pilih permainan', level: 1 }).waitFor();
    await page.evaluate(() => document.fonts.ready);
    await page.waitForLoadState('networkidle');
    await page.waitForFunction(() => window.chooserVitals.lcpMs > 0);
    await page.waitForFunction(async () => (await navigator.serviceWorker.getRegistration())?.active?.state === 'activated');
    const vitals = await page.evaluate(() => ({ ...window.chooserVitals }));
    if (run === 1) {
      await saveChromeTrace(cdp, join(results, 'cold-trace.json'));
      await page.screenshot({ path: join(results, 'chooser.png') });
    }
    await writeFile(join(results, `requests-${run}.json`), JSON.stringify(traffic, null, 2));
    await checkChooserTraffic(traffic, origin, dist);
    assert.ok(scripts.size, 'No JavaScript response recorded');
    for (const script of scripts.values()) {
      assert.ok(script.transferredBytes > 0, `Missing cold transfer for ${script.url}`);
    }
    assert.ok(transfers.some(file => file.path === '/sw.js'), 'Missing service-worker transfer');
    const transferredJsBytes = transfers.reduce((sum, file) => sum + file.transferredBytes, 0);
    assert.ok(transferredJsBytes > 0, 'Missing server-side JavaScript bytes');
    return { run, ...vitals, transferredJsBytes, transfers, pageScripts: [...scripts.values()] };
  } finally {
    httpServer.off('request', observeTransfer);
    await context.close();
  }
}
