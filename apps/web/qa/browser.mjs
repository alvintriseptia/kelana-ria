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

async function confirmCredits(page, results) {
  const about = page.getByRole('button', { name: 'Tentang', exact: true });
  await tabTo(page, about);
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog', { name: 'Tentang Kelana Ria' });
  await dialog.waitFor();
  const link = dialog.locator('a[href="https://nebula.tv/jetlag"]');
  assert.ok(await link.isVisible());
  assert.ok(await dialog.locator('a[href="https://jetlagoxford.co.uk/"]').isVisible());
  const credit = await dialog.innerText();
  for (const creator of ['Adam Chase', 'Sam Denby', 'Ben Doyle']) assert.ok(credit.includes(creator));
  await tabTo(page, link);
  await writeFile(join(results, 'credits.aria.txt'), await dialog.ariaSnapshot());
  await page.keyboard.press('Escape');
  await dialog.waitFor({ state: 'hidden' });
  assert.ok(await about.evaluate(el => el === document.activeElement), 'Credits should restore keyboard focus');
}

async function verifySeekPractice(page, results, family, timing, responseTime) {
  const practice = page.getByRole('button', { name: 'Coba Panduan', exact: true });
  await tabTo(page, practice);
  await page.keyboard.press('Enter');
  const dialog = page.locator('#edition-practice[open]');
  await dialog.getByRole('heading', { name: 'Waktunya bersembunyi' }).waitFor();
  assert.match(await dialog.innerText(), timing);
  const noOverflow = () => dialog.evaluate(el => el.scrollWidth <= el.clientWidth && el.getBoundingClientRect().right <= innerWidth);
  assert.ok(await noOverflow());
  await dialog.getByRole('button', { name: 'Mulai pencarian latihan' }).click();
  const preview = dialog.getByRole('button', { name: 'Pratinjau ' + family });
  await preview.click();
  assert.ok(await dialog.locator('[data-practice-map="preview"]').isVisible());
  await dialog.getByRole('button', { name: 'Kirim pertanyaan' }).click();
  await dialog.getByRole('heading', { name: 'Menunggu jawaban' }).waitFor();
  assert.match(await dialog.innerText(), responseTime);
  assert.equal(await dialog.locator('[data-practice-map="deduced"]').count(), 0);
  await dialog.getByRole('button', { name: 'Mainkan sisi penyembunyi' }).click();
  const submit = dialog.getByRole('button', { name: 'Kirim jawaban' });
  assert.equal(await submit.isDisabled(), true);
  await dialog.getByRole('group', { name: 'Pilihan jawaban' }).getByRole('button').first().click();
  await submit.click();
  await dialog.getByRole('heading', { name: 'Area pencarian menyempit' }).waitFor();
  assert.ok(await dialog.locator('[data-practice-map="deduced"]').isVisible());
  assert.ok(await noOverflow());
  await page.screenshot({ path: join(results, 'practice-' + family.toLowerCase() + '.png') });
  const offer = dialog.getByRole('button', { name: 'Lihat kartu latihan' });
  await offer.click();
  if (family === 'Radar') {
    const confirm = dialog.getByRole('button', { name: 'Simpan 1 kartu' });
    const first = dialog.getByRole('button', { name: 'Balik kartu 1' });
    assert.match(await dialog.innerText(), /Penyembunyi mendapat kartu.*Tarik 2 kartu, simpan 1.*hingga 1 menit/s);
    assert.equal(await confirm.isDisabled(), true);
    await tabTo(page, first);
    await page.keyboard.press('Enter');
    await dialog.getByRole('button', { name: 'Balik kartu 2' }).click();
    const pick = dialog.getByRole('button', { name: /^Pilih / });
    await pick.first().click();
    assert.ok(await pick.first().isDisabled(), 'Selection cannot exceed the keep count');
    await dialog.getByRole('button', { name: /^Lepas / }).click();
    assert.equal(await confirm.isDisabled(), true);
    const title = await dialog.locator('.ep-card-slot strong').last().innerText();
    await pick.last().click();
    assert.match(await dialog.getByRole('status').innerText(), /1\/1 kartu dipilih/);
    assert.ok(await noOverflow());
    await page.screenshot({ path: join(results, 'practice-card-choice.png') });
    await confirm.click();
    const hand = dialog.getByRole('region', { name: 'Tangan latihan' });
    assert.deepEqual(await hand.locator('strong').allTextContents(), [title]);
  } else {
    const hand = dialog.getByRole('region', { name: 'Tangan latihan' });
    await hand.waitFor();
    assert.equal(await dialog.getByRole('button', { name: /Simpan.*kartu/ }).count(), 0);
    assert.equal(await hand.locator('strong').count(), 1);
    assert.equal(await hand.locator('.ep-card-face').evaluate(el => getComputedStyle(el).animationName), 'none');
  }
  await page.keyboard.press('Escape');
  await dialog.waitFor({ state: 'hidden' });
  assert.ok(await practice.evaluate(el => el === document.activeElement), 'Practice should restore keyboard focus');
  assert.equal(new URL(page.url()).searchParams.get('room'), null);
}

async function verifyClaimPractice(page, results, mode, hasDeck = true) {
  const practice = page.getByRole('button', { name: 'Coba Panduan', exact: true });
  await practice.click();
  const dialog = page.locator('#edition-practice[open]');
  assert.match(await dialog.innerText(), mode === 'solo' ? /1 pemain · Solo/ : /2–4 pemain/);
  assert.match(await dialog.innerText(), /90 menit/);
  await dialog.getByRole('button', { name: 'Pilih landmark latihan' }).click();
  assert.match(await dialog.innerText(), /radius 100 meter/);
  const check = dialog.getByRole('button', { name: 'Check-in latihan' });
  await check.click();
  const toast = dialog.getByRole('alert');
  assert.match(await toast.innerText(), /Kamu masih terlalu jauh dari titik ini/);
  assert.ok(await check.evaluate(el => el === document.activeElement));
  if (mode === 'solo' && hasDeck) await page.screenshot({ path: join(results, 'practice-claim-retry.png') });
  await dialog.getByRole('button', { name: 'Dekati titik latihan' }).click();
  await check.click();
  await dialog.getByRole('button', { name: 'Tiga arah' }).click();
  await dialog.getByRole('button', { name: 'Kirim jawaban' }).click();
  assert.match(await toast.innerText(), /Hitung kembali panah/);
  await dialog.getByRole('button', { name: 'Dua arah' }).click();
  await dialog.getByRole('button', { name: 'Kirim jawaban' }).click();
  await dialog.getByRole('heading', { name: 'Landmark terkunci!' }).waitFor();
  assert.match(await dialog.getByRole('status').innerText(), mode === 'solo'
    ? /1\/4 landmark terkunci · 1\/2 zona/ : /1 zona dikuasai · 1 landmark terkunci/);
  if (mode === 'group') assert.match(await dialog.innerText(), /Klaim berbobot 1 dan kunci berbobot 1/);
  const cardLesson = dialog.getByRole('button', { name: 'Lihat kartu latihan' });
  if (hasDeck) {
    await cardLesson.click();
    await dialog.getByRole('heading', { name: 'Kartu di tangan' }).waitFor();
    assert.match(await dialog.innerText(), /Kamu mengunci landmark dan mendapat satu kartu\./);
    assert.doesNotMatch(await dialog.innerText(), /Kartu Taktis|Dek Taktis|Tantangan Berani/i);
    const hand = dialog.getByRole('region', { name: 'Tangan latihan' });
    assert.deepEqual(await hand.locator('strong').allTextContents(), ['Intip Tantangan']);
    assert.ok(await dialog.evaluate(el => el.scrollWidth <= el.clientWidth));
    if (mode === 'solo') await page.screenshot({ path: join(results, 'practice-claim-card.png') });
  } else assert.equal(await cardLesson.count(), 0);
  await dialog.getByRole('button', { name: 'Ulangi latihan' }).click();
  await dialog.getByRole('heading', { name: 'Pilih landmark' }).waitFor();
  await dialog.getByRole('button', { name: 'Lewati latihan' }).click();
  await dialog.waitFor({ state: 'hidden' });
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
    await confirmCredits(page, results);

    await tabTo(page, seekEdition);
    await page.keyboard.press('Enter');
    await page.waitForURL(url => url.searchParams.get('edition') === 'official-jakarta-wide-seek' && url.searchParams.has('version'));
    const detail = page.getByRole('article', { name: 'Detail edisi' });
    await detail.waitFor();
    assert.match(await detail.innerText(), /Hide\s*&\s*Seek/i);
    assert.match(await detail.innerText(), /Cara bermain.*Bergantian jadi penyembunyi dan pencari/s);
    assert.match(await detail.getByRole('region', { name: 'Aturan edisi' }).innerText(), /Dek.*Petunjuk/s);
    assert.ok(await noOverflow());
    assert.equal(await detail.getByRole('button', { name: 'Solo', exact: true }).count(), 0);
    await writeFile(join(results, 'edition.aria.txt'), await detail.ariaSnapshot());
    await verifySeekPractice(page, results, 'Radar', /45 menit.*120 menit/, /hingga 4 menit/);
    const versionedUrl = new URL(page.url());
    versionedUrl.searchParams.set('version', '32');
    // Public catalog fixtures for a different clue reward and a disabled tactical deck.
    const alternate = '**/api/rulebooks/catalog';
    await page.route(alternate, async route => {
      const response = await route.fetch();
      const payload = await response.json();
      const original = payload.editions.find(edition => edition.packId === 'official-jakarta-wide-seek');
      payload.editions.push({
        ...original, version: 32, headStartMinutes: 15, searchLimitMinutes: 70,
        headStartMs: 930_000, searchLimitMs: 4_200_000, objectiveResponseMs: 75_000,
        title: 'Edisi Latihan Termometer', questionFamilies: [{ family: 'thermometer', drawCount: 1, keepCount: 1 }],
      });
      const claim = payload.editions.find(edition => edition.packId === 'official-jakarta-compact-claim');
      payload.editions.push({ ...claim, version: 33, title: 'Edisi Landmark Tanpa Dek',
        tacticalDeckSummary: { ...claim.tacticalDeckSummary, enabled: false }, cardExamples: [] });
      await route.fulfill({ response, json: payload });
    });
    await page.goto(versionedUrl.href);
    await page.getByRole('heading', { name: 'Edisi Latihan Termometer' }).waitFor();
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await verifySeekPractice(page, results, 'Termometer', /15 menit 30 detik.*70 menit/, /hingga 1 menit 15 detik/);
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.goto(new URL('/?edition=official-jakarta-compact-claim&version=33', origin).href);
    await page.getByRole('heading', { name: 'Edisi Landmark Tanpa Dek' }).waitFor();
    await verifyClaimPractice(page, results, 'solo', false);
    await page.unroute(alternate);
    await page.goto(origin);
    await soloEdition.waitFor();
    await soloEdition.click();
    assert.match(await detail.innerText(), /Cara bermain.*Jelajahi landmark di peta/s);
    const group = page.getByRole('button', { name: 'Grup', exact: true });
    const solo = page.getByRole('button', { name: 'Solo', exact: true });
    await tabTo(page, group);
    await page.keyboard.press('Enter');
    assert.equal(await group.getAttribute('aria-pressed'), 'true');
    assert.match(await detail.innerText(), /2–4 pemain/);
    await verifyClaimPractice(page, results, 'group');
    await tabTo(page, solo);
    await page.keyboard.press('Enter');
    assert.equal(await solo.getAttribute('aria-pressed'), 'true');
    await verifyClaimPractice(page, results, 'solo');
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
