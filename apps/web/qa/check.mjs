import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { preview } from 'vite';
import { exerciseChooser } from './browser.mjs';
import { budgets, measure, phoneOptions, profile } from './profile.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const dist = join(root, 'dist');
const results = join(root, 'qa-results');
const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
const launch = { channel: 'chromium', executablePath: process.env.CHROMIUM_PATH || undefined };

// A dirty working tree can share a HEAD with a different build. Identify exact build bytes too.
async function buildDigest() {
  const hash = createHash('sha256');
  const files = await readdir(dist, { recursive: true, withFileTypes: true });
  const paths = files.filter(file => file.isFile()).map(file => join(file.parentPath, file.name)).sort();
  for (const path of paths) {
    hash.update(path.slice(dist.length)).update('\0');
    hash.update(createHash('sha256').update(await readFile(path)).digest());
  }
  return hash.digest('hex');
}

await mkdir(results, { recursive: true });
const report = {
  timestamp: new Date().toISOString(),
  revision: git('rev-parse', 'HEAD'),
  workingTreeDirty: Boolean(git('status', '--porcelain')),
  buildSha256: await buildDigest(),
  profile, budgets, runs: [],
};
const server = await preview({ root, preview: { host: '127.0.0.1', port: 0, open: false } });
let browser;
try {
  const origin = `http://127.0.0.1:${server.httpServer.address().port}`;
  browser = await chromium.launch(launch);
  report.browser = 'Chromium ' + browser.version();
  for (let run = 1; run <= profile.runs; run++) {
    report.runs.push(await measure(browser, origin, dist, results, run, server.httpServer));
  }
  report.median = {};
  for (const metric of Object.keys(budgets)) {
    const sorted = report.runs.map(run => run[metric]).sort((a, b) => a - b);
    report.median[metric] = sorted[Math.floor(sorted.length / 2)];
  }
  console.table(report.runs.map(({ run, lcpMs, cls, transferredJsBytes }) => ({ run, lcpMs, cls, transferredJsBytes })));
  console.log('Median', report.median);
  // Chromium evaluates installability in a regular profile, not an incognito context.
  const regular = await chromium.launchPersistentContext('', {
    ...phoneOptions(browser), ...launch,
  });
  report.pwa = await exerciseChooser(regular, origin, dist, results);
  for (const [metric, limit] of Object.entries(budgets)) {
    assert.ok(report.median[metric] <= limit, `Median ${metric} ${report.median[metric]} exceeds ${limit}`);
  }
  console.log('Mobile browser, accessibility tree, keyboard, installability and budget checks passed.');
} finally {
  await writeFile(join(results, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  await browser?.close();
  await server.close();
}
