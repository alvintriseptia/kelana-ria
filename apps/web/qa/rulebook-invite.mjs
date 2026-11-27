import assert from "node:assert/strict";
import { renderQrSvg } from "../src/qr-svg.ts";

async function readLobby(page, code) {
  const response = await page.request.get(new URL(`/api/rulebooks/rooms/${code}`, page.url()).href);
  assert.equal(response.status(), 200);
  return (await response.json()).room;
}

export async function exerciseInviteConfirmation(host, guest, { name, screenshot }) {
  const sharedUrl = await host.getByTestId("invite-link").getAttribute("href");
  const roomCode = new URL(sharedUrl).searchParams.get("room");
  const before = await readLobby(host, roomCode);
  assert.equal(before.seats.length, 1, "The host starts alone");

  await host.getByTestId("show-qr-btn").click();
  const qr = host.getByTestId("qr-modal");
  const qrPath = qr.locator("svg.lobby-qr-svg path");
  await qrPath.waitFor();
  const expectedPath = renderQrSvg(sharedUrl, "").match(/<path d="([^"]+)"/)[1];
  assert.equal(await qrPath.getAttribute("d"), expectedPath, "The QR must encode the shared URL");
  await host.keyboard.press("Escape");
  await qr.waitFor({ state: "hidden" });

  await guest.addInitScript(() => {
    const trackedViews = {
      catalog: '.catalog-top, [aria-label="Katalog Claim the City"], [aria-label="Katalog Hide & Seek"]',
      confirmation: '[data-invite-state="ready"]',
    };
    window.inviteViewsSeen = [];
    const record = (node) => {
      if (!(node instanceof Element)) return;
      for (const [view, selector] of Object.entries(trackedViews)) {
        if ((node.matches(selector) || node.querySelector(selector)) && !window.inviteViewsSeen.includes(view)) {
          window.inviteViewsSeen.push(view);
        }
      }
    };
    new MutationObserver((records) => {
      for (const entry of records) {
        if (entry.type === "attributes") record(entry.target);
        entry.addedNodes.forEach(record);
      }
    }).observe(document, { childList: true, subtree: true, attributes: true, attributeFilter: ["data-invite-state"] });
  });
  const joinRequests = [];
  guest.on("request", (request) => {
    if (request.method() === "POST" && new URL(request.url()).pathname === "/api/rulebooks") {
      const body = request.postDataJSON();
      if (body?.type === "join-room") joinRequests.push(body);
    }
  });

  const invite = guest.getByTestId("rulebook-invite");
  const previewPath = `**/api/rulebooks/rooms/${roomCode}/invite`;
  const delay = Promise.withResolvers();
  await guest.route(previewPath, async (route) => {
    await delay.promise;
    await route.continue();
  }, { times: 1 });
  try {
    await Promise.all([guest.waitForRequest(previewPath), guest.goto(sharedUrl)]);
    await invite.and(guest.locator('[data-invite-state="loading"]')).waitFor();
    assert.deepEqual(await guest.evaluate(() => window.inviteViewsSeen), [], "Loading must not show the catalog or join form");
    assert.equal((await readLobby(host, roomCode)).seats.length, 1, "No seat is assigned while loading");
  } finally {
    delay.resolve();
  }

  const ready = invite.and(guest.locator('[data-invite-state="ready"]'));
  const cancel = invite.locator('button[data-action="cancel-invite"]');
  await ready.waitFor();
  const confirmation = await ready.innerText();
  assert.ok(confirmation.includes(before.packMeta.title), "The invite identifies the edition by title");
  assert.ok(confirmation.includes(roomCode), "The invite identifies the room by code");
  assert.ok(await guest.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "The invite fits the phone viewport");
  assert.deepEqual(await guest.evaluate(() => window.inviteViewsSeen), ["confirmation"]);
  await guest.screenshot({ path: screenshot });

  await cancel.click();
  await guest.getByRole("heading", { name: "Pilih permainan", level: 1 }).waitFor();
  assert.equal(new URL(guest.url()).searchParams.has("room"), false, "Cancel clears the invite URL");
  assert.equal((await readLobby(host, roomCode)).seats.length, 1, "Cancel leaves the guest unseated");
  assert.deepEqual(joinRequests, [], "Opening and canceling an invite sends no join request");

  // The QR encodes this same destination.
  await guest.goto(sharedUrl);
  await ready.locator("#rb-join-name").fill(name);
  assert.deepEqual(await guest.evaluate(() => window.inviteViewsSeen), ["confirmation"]);
  assert.equal((await readLobby(host, roomCode)).seats.length, 1, "The guest stays unseated until confirmation");
  assert.deepEqual(joinRequests, [], "Filling in a name sends no join request");
  await ready.locator('button[data-action="join-room"]').click();
  await guest.getByTestId("lobby-readiness-strip").waitFor();
  const joined = await readLobby(guest, roomCode);
  assert.equal(joined.phase, "lobby");
  assert.equal(joined.seats.length, 2);
  assert.equal(joined.seats.find((seat) => seat.seatId === joined.seatId)?.name, name);
  assert.equal(joinRequests.length, 1, "Explicit confirmation sends one join request");

  await guest.reload();
  await guest.getByTestId("lobby-readiness-strip").waitFor();
  assert.deepEqual(await guest.evaluate(() => window.inviteViewsSeen), [], "An existing member returns directly to the lobby");
  const restored = await readLobby(guest, roomCode);
  assert.equal(restored.seatId, joined.seatId);
  assert.equal(restored.seats.length, 2);
  assert.equal(joinRequests.length, 1, "Reload does not send another join request");
}

export async function exerciseUnavailableInvite(guest, url, status, message) {
  await guest.goto(url);
  const invite = guest.getByTestId("rulebook-invite");
  await invite.and(guest.locator(`[data-invite-state="${status}"]`)).waitFor();
  assert.match(await invite.getByRole("alert").innerText(), message);
  assert.equal(await invite.locator('button[data-action="join-room"]').count(), 0);
  assert.ok(await invite.getByRole("button", { name: "Coba Lagi" }).isEnabled());
  await invite.getByRole("button", { name: "Kembali ke Katalog" }).click();
  await guest.getByRole("heading", { name: "Pilih permainan", level: 1 }).waitFor();
  assert.equal(new URL(guest.url()).searchParams.has("room"), false);
}
