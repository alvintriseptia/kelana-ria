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

async function confirmGuide(page, results, format) {
  const guide = page.getByRole('button', { name: 'Panduan' });
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
    await page.goto(origin + '/?players=1&format=hide-and-seek');
    await page.getByRole('heading', { name: 'Pilih permainan', level: 1 }).waitFor();
    assert.equal(await page.locator('html').getAttribute('lang'), 'id');
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'Horizontal overflow');

    const solo = page.locator('input[name="players"][value="1"]');
    const duo = page.locator('input[name="players"][value="2"]');
    const claim = page.locator('input[name="format"][value="claim-the-city"]');
    const hide = page.locator('input[name="format"][value="hide-and-seek"]');
    const board = page.getByRole('combobox', { name: /\S/ });
    const submit = page.getByRole('button', { name: 'Lihat ringkasan' });
    assert.equal(await page.getByRole('radio', { name: /\S/ }).count(), 4, 'Each radio must have an accessible name');
    assert.ok(await solo.isChecked() && await claim.isChecked() && await hide.isDisabled(), 'Solo Hide & Seek link resolves to solo Claim');
    const chooserTree = (await cdp.send('Accessibility.getFullAXTree')).nodes.filter(node => !node.ignored);
    const radios = chooserTree.filter(node => node.role.value === 'radio');
    const hideRadio = radios.find(node => node.name.value.includes('Hide & Seek'));
    assert.ok(hideRadio?.properties.some(prop => prop.name === 'disabled' && prop.value.value), 'Chromium exposes disabled Hide & Seek');
    assert.equal(radios.filter(node => node.properties.some(prop => prop.name === 'checked' && prop.value.value === 'true')).length, 2);
    const notice = page.getByRole('status');
    assert.match(await notice.textContent(), /Claim the City/);
    await writeFile(join(results, 'chooser.aria.txt'), await page.locator('body').ariaSnapshot());
    await confirmGuide(page, results, 'claim');

    await tabTo(page, solo);
    await page.keyboard.press('ArrowRight');
    assert.ok(await duo.isChecked() && await hide.isEnabled());
    await tabTo(page, claim);
    await page.keyboard.press('ArrowRight');
    assert.ok(await hide.isChecked());
    await confirmGuide(page, results, 'hide');
    await tabTo(page, board);
    await page.keyboard.press('End');
    assert.equal(await board.inputValue(), 'jakarta-wide');
    await tabTo(page, submit);
    await page.keyboard.press('Enter');
    const summary = page.getByRole('dialog', { name: 'Ringkasan permainan' });
    await summary.waitFor();
    assert.match(await summary.innerText(), /Hide\s*&\s*Seek/i);
    await writeFile(join(results, 'summary.aria.txt'), await summary.ariaSnapshot());
    await page.keyboard.press('Escape');
    await summary.waitFor({ state: 'hidden' });
    assert.ok(await submit.evaluate(el => el === document.activeElement), 'Summary should restore keyboard focus');
    await tabTo(page, duo);
    await page.keyboard.press('ArrowLeft');
    assert.ok(await solo.isChecked() && await claim.isChecked() && await hide.isDisabled());
    await tabTo(page, board);
    await page.keyboard.press('Home');
    assert.equal(await board.inputValue(), 'compact');
    const pwa = await checkPwa(page, cdp, origin);
    await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller));
    await context.setOffline(true);
    const offline = await page.reload();
    assert.ok(offline.ok() && offline.fromServiceWorker(), 'Previously opened chooser relaunches offline');
    await page.getByRole('heading', { name: 'Pilih permainan' }).waitFor();
    await submit.click();
    await summary.waitFor();
    assert.match(await summary.innerText(), /Claim the City/);
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
