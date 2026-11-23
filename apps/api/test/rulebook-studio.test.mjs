import assert from "node:assert/strict";
import { test } from "node:test";
import { createSoloServer } from "../dist/index.js";

async function studioServer(t, key) {
  const server = createSoloServer({ databasePath: ":memory:", rulebookReviewerKey: key });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const endpoint = `http://127.0.0.1:${server.address().port}/api/rulebooks`;
  const get = (query = "", headers) => fetch(endpoint + query, { headers });
  const post = (body, headers) => fetch(endpoint, {
    method: "POST",
    headers: { ...headers, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return { get, post };
}

test("rulebook Studio scopes draft ownership and independently authorizes editorial actions", async t => {
  const key = "rulebook-review-test-fixture";
  const { get, post } = await studioServer(t, key);
  const reviewer = { authorization: `Bearer ${key}` };
  const writer = async () => {
    const response = await get("?role=writer");
    assert.equal(response.status, 200);
    return { cookie: response.headers.get("set-cookie").split(";")[0] };
  };
  const owner = await writer();
  const outsider = await writer();
  const clone = {
    type: "clone-official", templatePackId: "official-jakarta-compact-claim",
    packId: "test-creator-owned", title: "Studio private draft", byline: "Test Creator", priceIdr: 0,
  };
  const creation = await post(clone, owner);
  assert.equal(creation.status, 200);
  const { record } = await creation.json();
  assert.equal(record.ownerHash, undefined);
  assert.equal((await post(clone, outsider)).status, 400);
  assert.equal((await post({ ...clone, packId: clone.templatePackId }, owner)).status, 400);

  const ownerData = await (await get("?role=writer", owner)).json();
  assert.deepEqual(ownerData.versions.map(version => version.packId), [clone.packId]);
  assert.equal(ownerData.versions[0].ownerHash, undefined);
  assert.deepEqual((await (await get("?role=writer", outsider)).json()).versions, []);
  assert.equal((await get("?role=reviewer", owner)).status, 403);
  assert.equal((await get("?role=reviewer", { authorization: "Bearer wrong-key" })).status, 403);
  assert.deepEqual((await (await get("?role=reviewer", reviewer)).json()).versions, []);

  const copy = structuredClone(record.pack);
  copy.meta.version = 0;
  assert.equal((await post({ type: "save-draft", pack: copy, snapshot: record.snapshot }, outsider)).status, 400);
  assert.equal((await post({ type: "submit-draft", packId: clone.packId, version: 1 }, outsider)).status, 400);
  assert.equal((await post({ type: "submit-draft", packId: clone.packId, version: 1 }, owner)).status, 200);
  assert.equal((await (await get("?role=reviewer", reviewer)).json()).versions[0].status, "submitted");
  for (const type of ["publish-version", "request-changes", "pause-version"]) {
    assert.equal((await post({ type, packId: clone.packId, version: 1 }, owner)).status, 403);
  }
  assert.equal((await post({ type: "publish-version", packId: clone.packId, version: 1 }, reviewer)).status, 200);
  const catalog = await (await get()).json();
  assert.ok(catalog.listings.some(listing => listing.packId === clone.packId));
  assert.equal(catalog.versions, undefined);
  assert.equal(catalog.orders, undefined);
  assert.equal(JSON.stringify(catalog).includes("correctChoiceId"), false);
});

test("rulebook editorial access is disabled when the server has no reviewer key", async t => {
  const { get, post } = await studioServer(t);
  assert.equal((await (await get("?role=writer")).json()).reviewEnabled, false);
  assert.equal((await get("?role=reviewer", { authorization: "Bearer test" })).status, 403);
  assert.equal((await post({ type: "publish-version" }, { authorization: "Bearer test" })).status, 403);
});
