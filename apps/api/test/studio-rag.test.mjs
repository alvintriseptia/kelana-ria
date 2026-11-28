import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { deflateSync } from "node:zlib";
import { createSoloServer } from "../dist/index.js";
import { chunkStudioGuide, createStudioRagStore } from "../dist/studio-rag-store.js";
import { makeClient, signInWithSandboxOtp } from "./auth-client.mjs";

const now = Date.parse("2026-11-28T08:10:00Z");
const scope = { ownerHash: "creator-a", packId: "rute-uji", version: 1 };
const claim = {
  ...scope, query: "Café", format: "claim-the-city", primitive: "observation_mcq",
  pattern: "compare_features", category: "museum",
};
const seek = { ...scope, query: "taman", format: "hide-and-seek", primitive: "matching", category: "taman" };

test("FTS5 retrieves a single format schema card, the selected pattern and a category tip", t => {
  const db = new DatabaseSync(":memory:");
  t.after(() => db.close());
  const store = createStudioRagStore(db);
  const ids = context => context.snippets.map(item => item.id).sort();
  const context = store.retrieveStudioContext(claim);
  assert.deepEqual(ids(context), [
    "category-museums", "pattern-compare", "rules-claim", "rules-copy", "rules-observation", "schema-mcq",
  ]);
  assert.match(context.platformContext, /correctChoiceId/);
  assert.doesNotMatch(context.platformContext, /timeLimitMs|poiSamples/);
  assert.ok(context.ragMetrics.estimatedTokensSaved > 0);
  assert.equal(context.ragMetrics.injectedChars, context.platformContext.length);
  assert.equal(context.ragMetrics.docChunks, 0);
  assert.deepEqual(ids(store.retrieveStudioContext(seek)), [
    "category-parks", "rules-copy", "rules-observation", "rules-seek", "schema-matching",
  ]);
  const revision = db.prepare("SELECT hash FROM studio_platform_revision WHERE id = 1").get().hash;
  assert.equal(revision.length, 64);
  createStudioRagStore(db);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM studio_platform_fts WHERE id = 'schema-mcq'").get().count, 1);
});

test("guide chunks maintain heading breadcrumbs and word-aligned overlap under a hard retrieval budget", t => {
  const db = new DatabaseSync(":memory:");
  t.after(() => db.close());
  const store = createStudioRagStore(db);
  const paragraph = "Ventilasi teras memberi naungan bagi pengunjung yang berjalan dari jalan umum. ".repeat(20);
  const text = "# Rute Pusat\n## Café Timur\n" + paragraph + "\n\n## Pasar Lama\nLihat denah lorong umum di sisi barat.";
  const chunks = chunkStudioGuide(text, "Rute uji");
  assert.equal(chunks[0].title, "Rute Pusat");
  assert.equal(chunks[1].title, "Rute Pusat › Café Timur");
  assert.equal(chunks.at(-1).title, "Rute Pusat › Pasar Lama");
  assert.ok(chunks.every(chunk => chunk.body.length <= 400));
  assert.ok(chunks[2].body.includes(chunks[1].body.slice(-40)));
  assert.deepEqual(chunkStudioGuide("1. Teras Timur\n2. Pasar Lama", "Rute").map(chunk => chunk.title), ["Teras Timur", "Pasar Lama"]);
  const record = store.ingestStudioDoc(scope, { title: "Rute uji", text, now }).doc;
  assert.ok(record.previewHeadings.includes("Rute Pusat › Pasar Lama"));
  assert.deepEqual(store.ingestStudioDoc(scope, { title: "Nama kedua", text, now }).doc, record);

  const ranked = store.retrieveStudioContext({ ...claim, query: "cafe ventilasi OR \"^*" });
  assert.ok(ranked.snippets.some(item => item.docId === record.docId));
  assert.ok(ranked.snippets.filter(item => item.namespace === "creator_doc").every(item => item.title.endsWith("Café Timur")));
  const first = store.retrieveStudioContext({ ...claim, query: "zzqptv404" });
  assert.match(first.guideContext, /Rute Pusat/);
  const limited = store.retrieveStudioContext({ ...claim, maxChars: 650 });
  assert.equal(limited.ragMetrics.budgetCapped, true);
  assert.ok(limited.ragMetrics.injectedChars <= 650);
  assert.ok(limited.platformContext.length + limited.guideContext.length <= 650);
  assert.ok(limited.ragMetrics.estimatedTokensSaved > 0);

  const other = { ...scope, ownerHash: "creator-b" };
  assert.deepEqual(store.listStudioDocs(other), []);
  assert.equal(store.retrieveStudioContext({ ...claim, ...other, docIds: [record.docId] }).ragMetrics.docChunks, 0);
  assert.equal(store.retrieveStudioContext({ ...claim, version: 2 }).ragMetrics.docChunks, 0);
  assert.equal(store.retrieveStudioContext({ ...claim, docIds: [] }).ragMetrics.docChunks, 0);
  assert.equal(store.deleteStudioDoc(other.ownerHash, record.docId), false);
  assert.equal(store.ingestStudioDoc(scope, { title: "Terlalu panjang", text: "a".repeat(50_001), now }).error, "document-too-large");
  for (let index = 1; index < 5; index++) {
    assert.equal(store.ingestStudioDoc(scope, { title: "Panduan tambahan", text: `Langkah berbeda ${index}.`, now }).ok, true);
  }
  assert.equal(store.ingestStudioDoc(scope, { title: "Tambahan", text: "Bagian keenam.", now }).error, "document-limit");
  assert.deepEqual(store.ingestStudioDoc(scope, { title: "Ulang", text, now }).doc, record);
  store.clearStudioDocs(scope);
  assert.deepEqual(store.readStudioDocChunks(scope), []);
  assert.deepEqual(store.listStudioDocs(scope), []);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM studio_guide_fts WHERE studio_guide_fts MATCH 'ventilasi'").get().count, 0);
});

function pdfFixture(content) {
  const stream = deflateSync(Buffer.from(content));
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    Buffer.concat([Buffer.from(`<< /Length ${stream.length} /Filter /FlateDecode >>\nstream\n`), stream, Buffer.from("\nendstream")]),
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  const bytes = [Buffer.from("%PDF-1.4\n")];
  const offsets = [0];
  let offset = bytes[0].length;
  for (const [index, object] of objects.entries()) {
    offsets.push(offset);
    const entry = Buffer.concat([Buffer.from(`${index + 1} 0 obj\n`), Buffer.from(object), Buffer.from("\nendobj\n")]);
    bytes.push(entry);
    offset += entry.length;
  }
  const xref = ["0000000000 65535 f ", ...offsets.slice(1).map(off => `${String(off).padStart(10, "0")} 00000 n `)].join("\n");
  bytes.push(Buffer.from(`xref\n0 ${offsets.length}\n${xref}\ntrailer\n<< /Root 1 0 R /Size ${offsets.length} >>\nstartxref\n${offset}\n%%EOF\n`));
  return Buffer.concat(bytes);
}

async function start(t, studioAi, databasePath = ":memory:") {
  const server = createSoloServer({ databasePath, studioAi, allowSandboxAuthOtp: true, now: () => now });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  return `http://127.0.0.1:${server.address().port}`;
}

const knowledge = "/api/rulebooks/studio/knowledge";
const aiSuggest = "/api/rulebooks/studio/ai-suggest";
const ownerEmail = "guide-owner@kelana.test";
const providerAccount = "example-fixture-account";
const providerToken = "example-fixture-key";
const draft = { packId: "field-guide-qa", version: 1 };
const listPath = `${knowledge}?packId=${draft.packId}&version=1`;
const photoRequest = {
  ...draft, format: "hide-and-seek", cityLabel: "Kota Uji", theme: "Lorong",
  targetFamily: "photo", count: 1,
};

async function cloneDraft(client) {
  const response = await client.post("/api/rulebooks", {
    type: "clone-official", templatePackId: "official-jakarta-compact-seek",
    packId: draft.packId, title: "Rute Uji Panduan", byline: "Kreator Uji", priceIdr: 0,
  });
  assert.equal(response.status, 200, JSON.stringify(response.body));
}

function remove(base, client, docId) {
  return fetch(`${base}${knowledge}/${docId}`, {
    method: "DELETE", headers: { cookie: `kelana_session=${client.cookies.get("kelana_session") ?? ""}` },
  });
}

test("Studio guides require draft ownership, redact private text, support text/Markdown/PDF, and clean up on draft deletion", async t => {
  const prompts = [];
  const events = [];
  const base = await start(t, {
    accountId: providerAccount, apiToken: providerToken, mode: "recorded-rehearsal",
    onEvent: event => events.push(event),
    fetchImpl: async (_endpoint, init) => {
      prompts.push(JSON.parse(init.body));
      return new Response("unavailable", { status: 503 });
    },
  });
  const creator = makeClient(base);
  const other = makeClient(base);
  const guest = makeClient(base);
  const postGuide = (client, data) => client.post(knowledge + "/ingest", { ...draft, title: "Panduan berjalan", ...data });
  assert.equal((await guest.get(listPath)).status, 401);
  assert.equal((await postGuide(guest, { text: "Contoh rute." })).status, 401);
  assert.equal((await remove(base, guest, "guide-unknown")).status, 401);

  const auth = await signInWithSandboxOtp(creator, ownerEmail);
  await signInWithSandboxOtp(other, "guide-other@kelana.test");
  await cloneDraft(creator);
  const privateRoom = "RB-25D17D";
  const privateFix = "-6.193429, 106.821129";
  const session = creator.cookies.get("kelana_session");
  const markdown = `# Kota Uji\n## Lorong Azimutperak\nPerhatikan ventilasi di sisi pintu umum.\n\n${ownerEmail}\n${privateRoom}\n${privateFix}\n${session}\n${providerAccount}\n${providerToken}\n${auth.body.user.userId}\n\n## Halte Barat\nPapan arah halte berada dekat ramp.`;
  const response = await postGuide(creator, { text: markdown, title: "Jalan " + ownerEmail });
  assert.equal(response.status, 200, JSON.stringify(response.body));
  const { doc } = response.body;
  assert.equal(doc.title, "Jalan");
  assert.ok(doc.previewHeadings.includes("Kota Uji › Lorong Azimutperak"));
  assert.deepEqual((await postGuide(creator, { text: markdown, title: "Judul baru" })).body.doc, doc);

  const attach = (fileName, mimeType, buffer) => postGuide(creator, { fileName, mimeType, fileBase64: buffer.toString("base64") });
  assert.equal((await attach("contoh.txt", "text/plain", Buffer.from("Akses pengunjung melalui ramp utama."))).status, 200);
  assert.equal((await attach("contoh.md", "", Buffer.from("# Teras Utara\nCek penanda tetap di pintu."))).status, 200);
  const pdf = await attach("contoh.pdf", "application/pdf",
    pdfFixture("BT /F1 18 Tf 64 720 Td (Teras Sagara) Tj ET\nBT /F1 11 Tf 64 690 Td (Amati jalur utara dari trotoar.) Tj ET"));
  assert.equal(pdf.status, 200, JSON.stringify(pdf.body));
  assert.ok(pdf.body.doc.previewHeadings.includes("Teras Sagara"));
  const scanned = await attach("scan.pdf", "application/pdf",
    pdfFixture("q 100 0 0 100 60 700 cm BI /W 1 /H 1 /BPC 8 /CS /G /F /AHx ID FF> EI Q"));
  assert.equal(scanned.status, 422, JSON.stringify(scanned.body));
  assert.equal(scanned.body.error, "pdf-no-extractable-text");
  assert.match(scanned.body.message, /Salin-tempel/);
  assert.equal((await attach("terlalu-besar.pdf", "application/pdf", Buffer.alloc(2 * 1024 * 1024 + 1))).status, 413);
  assert.equal((await postGuide(creator, { text: "a".repeat(50_001) })).status, 413);
  assert.equal((await attach("contoh.doc", "text/plain", Buffer.from("Teks"))).status, 400);
  const list = await creator.get(listPath);
  assert.equal(list.headers.get("cache-control"), "private, no-store");
  assert.equal(list.body.docs.length, 4);
  assert.equal(JSON.stringify(list.body).includes("Perhatikan ventilasi"), false);

  const forbidden = { error: "owner-only" };
  assert.deepEqual((await other.get(listPath)).body, forbidden);
  assert.equal((await other.get(listPath)).status, 403);
  assert.deepEqual((await postGuide(other, { text: "Tidak diizinkan." })).body, forbidden);
  assert.equal((await other.post(aiSuggest, photoRequest)).status, 403);
  const otherDelete = await remove(base, other, doc.docId);
  assert.equal(otherDelete.status, 403);
  assert.deepEqual(await otherDelete.json(), forbidden);

  const suggested = await creator.post(aiSuggest, photoRequest);
  assert.equal(suggested.status, 200);
  assert.equal(suggested.body.mode, "template-fallback");
  assert.equal(suggested.body.fallbackReason, "http-error");
  assert.equal(suggested.body.ragMetrics.docChunks, 1);
  assert.ok(suggested.body.ragMetrics.estimatedTokensSaved > 0);
  assert.deepEqual(events[0].ragMetrics, suggested.body.ragMetrics);
  const payload = JSON.parse(prompts[0].messages[1].content);
  assert.match(payload.guideExcerpts, /Lorong Azimutperak/);
  assert.doesNotMatch(payload.guideExcerpts, /Halte Barat|Teras Sagara/);
  assert.equal("packId" in payload, false);
  for (const value of [privateRoom, privateFix, ownerEmail, session, providerAccount, providerToken, auth.body.user.userId]) {
    assert.ok(value);
    assert.equal(JSON.stringify({ prompts, events, list: list.body }).includes(value), false, "Private values stay out of guide output and evidence");
  }

  const deleted = await remove(base, creator, doc.docId);
  assert.equal(deleted.status, 200);
  assert.equal((await creator.get(listPath)).body.docs.length, 3);
  assert.equal((await creator.post("/api/rulebooks", { ...draft, type: "delete-draft" })).status, 200);
  assert.equal((await creator.get(listPath)).status, 403);
  await cloneDraft(creator);
  assert.deepEqual((await creator.get(listPath)).body.docs, []);
  assert.equal((await creator.post(aiSuggest, photoRequest)).body.ragMetrics.docChunks, 0);
});
