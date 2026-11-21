import assert from "node:assert/strict";
import { once } from "node:events";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { preview } from "vite";
import { createSoloServer } from "../../api/dist/index.js";
import { phoneOptions } from "./profile.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const results = join(root, "qa-results");
const api = createSoloServer({ databasePath: ":memory:" });
api.listen(0, "127.0.0.1");
await once(api, "listening");
await mkdir(results, { recursive: true });

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
  });

  async function device() {
    const context = await browser.newContext(phoneOptions(browser));
    return { context, page: await context.newPage() };
  }

  async function click(actor, name) {
    await actor.page.getByRole("button", { name, exact: true }).click();
  }

  async function postPack(actor, buttonName, expectedType) {
    const [response] = await Promise.all([
      actor.page.waitForResponse(
        (res) =>
          res.url().startsWith(origin + "/api/packs") &&
          res.request().method() === "POST" &&
          res.request().postDataJSON().type === expectedType,
      ),
      click(actor, buttonName),
    ]);
    return { status: response.status(), body: await response.json() };
  }

  async function switchRole(actor, buttonName, expectedRole) {
    const [response] = await Promise.all([
      actor.page.waitForResponse(
        (res) =>
          res.url().startsWith(origin + "/api/packs") &&
          res.url().includes(`role=${expectedRole}`) &&
          res.request().method() === "GET",
      ),
      click(actor, buttonName),
    ]);
    return response.json();
  }

  async function openPacksAs(actor, role) {
    const [response] = await Promise.all([
      actor.page.waitForResponse(
        (res) =>
          res.url().startsWith(origin + "/api/packs") &&
          res.url().includes(`role=${role}`) &&
          res.request().method() === "GET",
      ),
      actor.page.goto(`${origin}/?play=creator-packs&role=${role}`),
    ]);
    return response.json();
  }

  const writer = await device();
  const reviewer = await device();
  const buyer = await device();

  // 1. Writer opens Creator Pack studio from chooser summary, saves v1 draft, and submits v1.
  await writer.page.goto(origin);
  await click(writer, "Lihat ringkasan");
  await Promise.all([
    writer.page.waitForResponse(
      (res) =>
        res.url().startsWith(origin + "/api/packs") &&
        res.url().includes("role=writer") &&
        res.request().method() === "GET",
    ),
    click(writer, "Paket kreator Jakarta"),
  ]);
  await writer.page.getByRole("heading", { name: "Paket Kreator Jakarta", level: 1 }).waitFor();

  const savedV1 = await postPack(writer, "Simpan draf", "save-draft");
  assert.equal(savedV1.status, 200);
  assert.equal(savedV1.body.versions.length, 1);
  assert.equal(savedV1.body.versions[0].status, "draft");

  // Public buyer checks catalog while v1 is draft -> empty.
  const buyerInitial = await openPacksAs(buyer, "public");
  assert.deepEqual(buyerInitial.listings, []);
  await buyer.page.getByText("Belum ada versi paket kreator yang sedang dijual.").waitFor();

  const submittedV1 = await postPack(writer, "Ajukan v1 untuk tinjauan", "submit-draft");
  assert.equal(submittedV1.status, 200);
  assert.equal(submittedV1.body.versions[0].status, "submitted");

  // 2. Reviewer inspects submitted v1 and requests a correction (A28).
  const reviewQueueV1 = await openPacksAs(reviewer, "reviewer");
  assert.equal(reviewQueueV1.versions.length, 1);
  assert.equal(reviewQueueV1.versions[0].status, "submitted");

  const returnedV1 = await postPack(reviewer, "Minta revisi v1", "request-changes");
  assert.equal(returnedV1.status, 200);
  assert.equal(returnedV1.body.versions[0].status, "changes-requested");

  // 3. Writer sees the returned note, revises verification notes into v2, and resubmits v2.
  const writerReturned = await switchRole(writer, "Penulis", "writer");
  assert.equal(writerReturned.versions[0].status, "changes-requested");
  await writer.page.locator("#pack-view").getByText(/Perjelas patokan pengamatan/i).waitFor();

  await writer.page
    .locator("#pack-task-note")
    .fill("Diverifikasi ulang di lokasi: balkon utara amfiteater buka pukul 07.00–22.00 WIB.");
  const savedV2 = await postPack(writer, "Simpan draf", "save-draft");
  assert.equal(savedV2.status, 200);
  assert.equal(savedV2.body.versions.length, 2);
  assert.equal(savedV2.body.versions[1].version, 2);

  const submittedV2 = await postPack(writer, "Ajukan v2 untuk tinjauan", "submit-draft");
  assert.equal(submittedV2.status, 200);
  assert.equal(submittedV2.body.versions[1].status, "submitted");

  // 4. Reviewer publishes v2.
  await switchRole(reviewer, "Peninjau", "reviewer");
  const publishedV2 = await postPack(reviewer, "Terbitkan v2", "publish-version");
  assert.equal(publishedV2.status, 200);
  assert.equal(publishedV2.body.versions[1].status, "published");
  await reviewer.page.screenshot({ path: join(results, "pack-reviewer-published.png"), fullPage: true });

  // 5. Writer starts a new unapproved draft v3; public catalog still shows only approved v2 (A28).
  await switchRole(writer, "Penulis", "writer");
  await writer.page.locator("#pack-title-input").fill("Jejak Transit Kebayoran (Draf v3 Pribadi)");
  const savedV3 = await postPack(writer, "Simpan draf", "save-draft");
  assert.equal(savedV3.status, 200);
  assert.equal(savedV3.body.versions.length, 3);
  assert.equal(savedV3.body.versions[2].status, "draft");

  // 6. Buyer browses public catalog: sees ONLY v2 with byline and without answer keys.
  const publicCatalog = await switchRole(buyer, "Katalog Publik", "public");
  assert.equal(publicCatalog.listings.length, 1);
  assert.equal(publicCatalog.listings[0].version, 2);
  assert.equal(publicCatalog.listings[0].byline, "Raka Pratama · Kolektif Jelajah Selatan");
  const publicText = await buyer.page.locator("#pack-view").innerText();
  assert.match(publicText, /Raka Pratama · Kolektif Jelajah Selatan/);
  assert.match(publicText, /Jejak Transit Kebayoran & Senayan/);
  assert.doesNotMatch(publicText, /Draf v3 Pribadi/);
  assert.doesNotMatch(publicText, /Kunci jawaban pribadi/i);
  await buyer.page.screenshot({ path: join(results, "pack-public-catalog.png"), fullPage: true });

  // 7. Buyer creates a pending sandbox order on v2, returns before settlement (no access), then verifies settlement (A29, A30).
  const ordered = await postPack(buyer, "Beli sesi uji coba (v2)", "create-order");
  assert.equal(ordered.status, 200);
  assert.equal(ordered.body.orders.length, 1);
  assert.equal(ordered.body.orders[0].orderId, "ord-sandbox-1");
  assert.equal(ordered.body.orders[0].status, "pending");
  assert.equal(ordered.body.orders[0].passId, null);
  assert.equal(ordered.body.orders[0].roomCode, null);
  assert.equal(ordered.body.orders[0].creatorShareIdr, 21_250);

  const returned = await postPack(buyer, "Kembali dari checkout (ord-sandbox-1)", "checkout-return");
  assert.equal(returned.status, 200);
  assert.equal(returned.body.orders[0].status, "pending");
  assert.equal(returned.body.orders[0].passId, null);
  assert.equal(returned.body.orders[0].roomCode, null);

  const settled = await postPack(buyer, "Verifikasi pelunasan (ord-sandbox-1)", "verify-settlement");
  assert.equal(settled.status, 200);
  assert.equal(settled.body.orders[0].status, "settled");
  const { roomCode, passId, earningsEntryId } = settled.body.orders[0];
  assert.match(roomCode, /^[0-9A-F]{8}$/);
  assert.equal(passId, "pass-ord-sandbox-1");
  assert.equal(earningsEntryId, "earn-ord-sandbox-1");

  // 8. Host opens the unlocked paid room, refreshes, and invites a friend on the same pass; clock waits for readiness (A29).
  await buyer.page.getByRole("link", { name: `Buka ruang berbayar (${roomCode})` }).click();
  await buyer.page.getByRole("heading", { name: "Ruang tunggu" }).waitFor();
  await buyer.page.locator("#duo-view").getByText(/Paket kreator berbayar/i).waitFor();
  assert.equal(new URL(buyer.page.url()).searchParams.get("pass"), null, "Pass query param is stripped after host claims room");
  assert.equal(await buyer.page.locator("[data-timer]").count(), 0, "Clock stays stopped in lobby");

  // Host reloads and recovers seat 1 via cookie.
  await buyer.page.reload();
  await buyer.page.getByRole("heading", { name: "Ruang tunggu" }).waitFor();
  const inviteHref = await buyer.page.getByRole("link", { name: "Tautan undangan" }).getAttribute("href");
  assert.ok(inviteHref && inviteHref.includes(`room=${roomCode}`) && !inviteHref.includes("pass="));

  // Second device joins the same paid room using the invite link without paying again.
  const friend = await device();
  await friend.page.goto(inviteHref);
  await friend.page.getByRole("button", { name: "Gabung ruang", exact: true }).click();
  await friend.page.getByRole("heading", { name: "Ruang tunggu" }).waitFor();
  await friend.page.locator("#duo-view").getByText(/Paket kreator berbayar/i).waitFor();
  assert.equal(await friend.page.locator("[data-timer]").count(), 0, "Clock stays stopped until check-in and readiness");
  await friend.page.screenshot({ path: join(results, "pack-paid-room-guest.png"), fullPage: true });
  await friend.context.close();

  // 9. Buyer returns to catalog and reports a checkpoint closure on Taman Literasi; reviewer pauses v2 sales (A31).
  await openPacksAs(buyer, "public");
  const closureReported = await postPack(buyer, "Laporkan penutupan titik (v2)", "report-closure");
  assert.equal(closureReported.status, 200);

  const reviewerWithClosure = await switchRole(reviewer, "Peninjau", "reviewer");
  assert.equal(reviewerWithClosure.closures.length, 1);
  assert.equal(reviewerWithClosure.earnings.length, 1);
  const pausedV2 = await postPack(reviewer, "Jeda penjualan v2", "pause-version");
  assert.equal(pausedV2.status, 200);
  assert.equal(pausedV2.body.versions[1].status, "paused");
  assert.deepEqual(pausedV2.body.listings, []);
  assert.equal(pausedV2.body.orders.length, 1);
  assert.equal(pausedV2.body.earnings.length, 1);
  await reviewer.page.screenshot({ path: join(results, "pack-paused-orders.png"), fullPage: true });

  // 10. Public catalog stops new orders while existing orders & reconciled creator earnings remain visible.
  const buyerAfterPause = await switchRole(buyer, "Katalog Publik", "public");
  assert.deepEqual(buyerAfterPause.listings, []);
  assert.equal(buyerAfterPause.orders.length, 1);
  assert.match(buyerAfterPause.orders[0].supportNote, /Penjualan v2 dijeda/);
  await buyer.page.locator("#pack-view").getByText("ord-sandbox-1", { exact: true }).waitFor();

  const blockedOrderRes = await buyer.context.request.post(origin + "/api/packs?role=public", {
    data: {
      actionId: randomUUID(),
      type: "create-order",
      packId: "pack-selatan-compact",
      version: 2,
      players: 1,
    },
  });
  assert.equal(blockedOrderRes.status(), 409);
  assert.equal((await blockedOrderRes.json()).error, "sales-paused");

  const writerAfterPause = await switchRole(writer, "Penulis", "writer");
  assert.equal(writerAfterPause.orders.length, 1);
  assert.equal(writerAfterPause.orders[0].orderId, "ord-sandbox-1");
  assert.equal(writerAfterPause.orders[0].creatorShareIdr, 21_250);
  assert.equal(writerAfterPause.earnings.length, 1);
  assert.equal(writerAfterPause.earnings[0].earningsEntryId, "earn-ord-sandbox-1");
  await writer.page.locator('[data-earnings-id="earn-ord-sandbox-1"]').waitFor();

  const lifecycleRes = await reviewer.context.request.get(
    origin + "/api/packs/lifecycle?orderId=ord-sandbox-1",
  );
  assert.equal(lifecycleRes.status(), 200);
  const redactedLifecycle = await lifecycleRes.json();

  await writeFile(
    join(results, "pack-report.json"),
    JSON.stringify(
      {
        browser: browser.version(),
        viewport: writer.page.viewportSize(),
        packId: "pack-selatan-compact",
        versions: writerAfterPause.versions.map((v) => ({
          version: v.version,
          status: v.status,
        })),
        byline: "Raka Pratama · Kolektif Jelajah Selatan",
        privateAnswerKeysProtected: true,
        paidRoomCode: roomCode,
        pausedNewOrderStatus: 409,
        preservedOrdersAfterPause: writerAfterPause.orders,
        reconciledEarningsAfterPause: writerAfterPause.earnings,
        redactedMidtransLifecycle: redactedLifecycle.events,
      },
      null,
      2,
    ) + "\n",
  );

  await Promise.all([
    writer.context.close(),
    reviewer.context.close(),
    buyer.context.close(),
  ]);
  console.log("Creator pack review, publication, sandbox checkout, paid room unlock, earnings and pause checks passed.");
} finally {
  await browser?.close();
  await server?.close();
  if (api.listening) await new Promise((resolve) => api.close(resolve));
}
