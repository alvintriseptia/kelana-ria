import assert from "node:assert/strict";

export async function verifyCardInfo(page, title, checks, { keyboard = false, screenshot } = {}) {
  const trigger = page.getByRole("button", { name: `Info ${title}`, exact: true }).first();
  await trigger.waitFor();
  const triggerBounds = await trigger.boundingBox();
  assert.ok(triggerBounds.width >= 44 && triggerBounds.height >= 44);
  if (keyboard) await trigger.press("Enter");
  else await trigger.click();
  const dialog = page.getByRole("dialog", { name: title, exact: true });
  await dialog.waitFor();
  const copy = await dialog.innerText();
  for (const pattern of checks) assert.match(copy, pattern);
  assert.ok(await dialog.locator("dl").evaluate(el =>
    [...el.children].every(row => row.clientWidth === el.clientWidth),
  ), "Rule details should use the full available width");
  assert.ok(await dialog.evaluate(el => el.scrollWidth <= el.clientWidth && document.documentElement.scrollWidth <= innerWidth));
  if (screenshot) await page.screenshot({ path: screenshot });
  const close = dialog.getByRole("button", { name: "Tutup info kartu", exact: true });
  if (keyboard) await close.press("Escape");
  else await close.click();
  await dialog.waitFor({ state: "hidden" });
  await page.waitForFunction(el => document.activeElement === el, await trigger.elementHandle());
}
