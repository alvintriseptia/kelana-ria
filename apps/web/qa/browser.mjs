import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { checkChooserTraffic, guardChooser } from './profile.mjs';

async function tabTo(page, locator) {
  for (let i = 0; i < 20; i++) {
    if (await locator.evaluate(el => el === document.activeElement)) return;
    await page.keyboard.press('Tab');
  }
  assert.fail(`Keyboard could not reach ${locator}`);
}

async function confirmGuide(page, results, format, label = 'Panduan') {
  const guide = page.getByRole('button', { name: label, exact: true });
  await tabTo(page, guide);
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog');
  await dialog.waitFor();
  const link = dialog.locator('a[href="https://nebula.tv/jetlag"]');
  assert.ok(await link.isVisible());
  const credit = await dialog.innerText();
  for (const creator of ['Adam Chase', 'Sam Denby', 'Ben Doyle']) assert.ok(credit.includes(creator));
  await tabTo(page, link);
  await writeFile(join(results, `guide-${format}.aria.txt`), await dialog.ariaSnapshot());
  if (format === 'claim') await page.screenshot({ path: join(results, 'guide.png') });
  await page.keyboard.press('Escape');
  await dialog.waitFor({ state: 'hidden' });
  assert.ok(await guide.evaluate(el => el === document.activeElement), 'Guide should restore keyboard focus');
}

async function checkPwa(page, cdp, origin) {
  assert.ok(await page.evaluate(() => matchMedia('(display-mode: browser)').matches), 'Ordinary browser launch');
  const info = await cdp.send('Page.getAppManifest');
  assert.deepEqual(info.errors, [], 'Chromium manifest errors');
  const manifest = JSON.parse(info.data);
  assert.ok(manifest.name || manifest.short_name);
  assert.equal(manifest.display, 'standalone');
  assert.equal(new URL(manifest.start_url, info.url).origin, origin);
  const icons = await page.evaluate(async ({ icons, url }) => {
    const dimensions = [];
    for (const icon of icons) {
      const image = new Image();
      image.src = new URL(icon.src, url).href;
      await image.decode();
      dimensions.push([image.naturalWidth, image.naturalHeight]);
    }
    return dimensions;
  }, { icons: manifest.icons, url: info.url });
  for (const size of [192, 512]) assert.ok(icons.some(([w, h]) => w === size && h === size), `Install icon ${size}`);
  await page.waitForFunction(async () => (await navigator.serviceWorker.getRegistration())?.active?.state === 'activated');
  const install = await cdp.send('Page.getInstallabilityErrors');
  assert.deepEqual(install.installabilityErrors, [], 'Chromium installability criteria');
  const worker = await page.evaluate(async () => (await navigator.serviceWorker.ready).active.scriptURL);
  assert.equal(new URL(worker).origin, origin);
  return { manifestUrl: info.url, startUrl: manifest.start_url, icons, worker, ...install };
}

export async function exerciseChooser(context, origin, dist, results) {
  try {
    await context.tracing.start({ screenshots: true, snapshots: true });
    const traffic = await guardChooser(context);
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    const cdp = await context.newCDPSession(page);
    await page.goto(origin);
    await page.getByRole('heading', { name: 'Pilih permainan', level: 1 }).waitFor();
    assert.equal(await page.locator('html').getAttribute('lang'), 'id');
    const noOverflow = () => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);
    assert.ok(await noOverflow(), 'Horizontal overflow');
    const soloEdition = page.locator('.cat-card[data-pack-id="official-jakarta-compact-claim"]').first();
    const seekEdition = page.locator('.cat-card[data-pack-id="official-jakarta-wide-seek"]').first();
    await soloEdition.waitFor();
    await seekEdition.waitFor();
    assert.match(await soloEdition.innerText(), /1–4 pemain/);
    const tree = (await cdp.send('Accessibility.getFullAXTree')).nodes.filter(node => !node.ignored);
    assert.ok(tree.some(node => node.role.value === 'link' && /Jakarta Selatan.*Gratis/.test(node.name.value)),
      'Edition links expose their title and price');
    assert.ok(await page.getByRole('button', { name: 'Studio Kreator', exact: true }).isVisible());
    await writeFile(join(results, 'chooser.aria.txt'), await page.locator('body').ariaSnapshot());
    await confirmGuide(page, results, 'claim');

    await tabTo(page, seekEdition);
    await page.keyboard.press('Enter');
    await page.waitForURL(url => url.searchParams.get('edition') === 'official-jakarta-wide-seek' && url.searchParams.has('version'));
    const detail = page.getByRole('article', { name: 'Detail edisi' });
    await detail.waitFor();
    assert.match(await detail.innerText(), /Hide\s*&\s*Seek/i);
    assert.ok(await noOverflow());
    assert.equal(await detail.getByRole('button', { name: 'Solo', exact: true }).count(), 0);
    await writeFile(join(results, 'edition.aria.txt'), await detail.ariaSnapshot());
    await confirmGuide(page, results, 'hide', 'Lihat panduan');
    await page.goBack();
    await soloEdition.waitFor();
    await soloEdition.click();
    const group = page.getByRole('button', { name: 'Grup', exact: true });
    const solo = page.getByRole('button', { name: 'Solo', exact: true });
    await tabTo(page, group);
    await page.keyboard.press('Enter');
    assert.equal(await group.getAttribute('aria-pressed'), 'true');
    assert.match(await detail.innerText(), /2–4 pemain/);
    await tabTo(page, solo);
    await page.keyboard.press('Enter');
    assert.equal(await solo.getAttribute('aria-pressed'), 'true');
    const pwa = await checkPwa(page, cdp, origin);
    await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller));
    await page.getByRole('link', { name: /Katalog/ }).click();
    await soloEdition.waitFor();
    await context.setOffline(true);
    const offline = await page.reload();
    assert.ok(offline.ok() && offline.fromServiceWorker(), 'Previously opened catalog relaunches offline');
    await soloEdition.waitFor();
    await soloEdition.click();
    await detail.waitFor();
    assert.match(await detail.innerText(), /Claim the City/);
    assert.ok(await detail.getByRole('button', { name: 'Main Solo', exact: true }).isDisabled());
    await checkChooserTraffic(traffic, origin, dist);
    assert.deepEqual(errors, [], 'Uncaught client errors');
    return pwa;
  } finally {
    try {
      await context.tracing.stop({ path: join(results, 'keyboard-trace.zip') });
    } finally {
      await context.close();
    }
  }
}
