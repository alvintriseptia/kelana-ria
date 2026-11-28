import assert from "node:assert/strict";
import test from "node:test";
import { createSoloServer, createStudioAiCoCreator, studioAiOptionsFromEnv } from "../dist/index.js";
import { makeClient, signInWithSandboxOtp } from "./auth-client.mjs";

const time = Date.parse("2026-11-28T12:00:00Z");
const provider = {
  accountId: "fixture-provider-account-id",
  apiToken: "fixture-provider-bearer-token",
  mode: "recorded-rehearsal",
};
const landmark = {
  id: "serambi-pelabuhan", name: "Serambi Pelabuhan", zoneName: "Dermaga Timur",
  accessNotes: "Amati dari trotoar umum.", publicHours: "07.00–17.00", transitSummary: "Jalan kaki dari halte.",
  osmCategory: "museum", osmTags: { tourism: "museum" },
};
const claim = {
  format: "claim-the-city", cityLabel: "Kota Pesisir Uji", landmark,
  primitive: "observation_mcq", pattern: "compare_features", count: 1,
};
const seek = {
  format: "hide-and-seek", cityLabel: claim.cityLabel, count: 1,
  availablePoiCategories: ["taman"], stationNames: ["Halte Timur"],
  poiSamples: [
    { id: "taman-timur", name: "Taman Timur", category: "taman" },
    { id: "taman-barat", name: "Taman Barat", category: "taman" },
  ],
};
const review = {
  verificationNotes: "Cocokkan bahan penanda dari trotoar umum.",
  verificationChecklist: [
    "Pastikan penanda ada dan bisa diamati dari trotoar.",
    "Bandingkan bahan kedua permukaan saat terang.",
  ],
};
const mcq = {
  primitive: "observation_mcq", prompt: "Bahan apa yang terlihat di penanda pintu timur?",
  choices: [{ id: "a", label: "Batu" }, { id: "b", label: "Kayu" }], correctChoiceId: "a",
};
const input = {
  primitive: "observation_input", prompt: "Hitung lubang tetap pada kedua sisi kisi.",
  inputMode: "number", numericRange: { min: 5, max: 5 },
};
const photo = {
  primitive: "photo_proof", prompt: "Foto kedua bahan pada bagian luar pintu.",
  verificationMode: "rival_or_timeout", autoApproveMs: 120_000,
};
const payloads = {
  observation_mcq: mcq,
  observation_input: input,
  photo_proof: photo,
  timed_micro_task: {
    primitive: "timed_micro_task", prompt: "Catat jumlah lubang tetap pada kisi.",
    timeLimitMs: 60_000, taskType: "observation_input", numericRange: { min: 5, max: 5 },
  },
  call_your_shot: {
    primitive: "call_your_shot", theme: "Bahan penanda", standardTask: mcq, boldTask: photo, boldReward: { bonusWeight: 1 },
  },
  multi_step: { primitive: "multi_step", steps: [input, photo] },
};
const claimDraft = {
  ...review, id: "untrusted-id", title: "Permukaan pintu timur", payload: mcq,
  reviewed: true, reviewedAt: "2026-11-27", estimatedSeconds: 75,
  hint: "Perhatikan permukaan penanda yang menghadap jalan.",
  learningExplanation: "Perbedaan bahan membantu mengenali pintu saat dari trotoar.",
  aiProvenance: { source: "untrusted", verificationChecklist: [] },
};
const seekDrafts = {
  photo: {
    ...review, label: "Foto penanda jalur", prompt: "Foto bagian penanda tetap yang memperlihatkan simbol arah.",
    phase: "seeking", fieldVerified: true, fieldVerifiedAt: "2026-11-27",
  },
  matching: { label: "Taman yang sama", matchType: "nearest_poi", poiCategory: "taman" },
  measuring: { label: "Jarak ke taman timur", targetType: "named_poi", poiId: "taman-timur" },
  tentacles: { label: "Taman dalam jangkauan", radiusMeters: 450, poiCategory: "taman" },
};

function workersAi(suggestions) {
  return Response.json({
    success: true,
    result: { response: "```json\n" + JSON.stringify({ suggestions }) + "\n```" },
  });
}
function openAi(suggestions) {
  return Response.json({ choices: [{ message: { content: JSON.stringify({ suggestions }) } }] });
}

function assertUnverified(item, source, mode) {
  const { aiProvenance } = item;
  assert.equal(aiProvenance.source, source);
  assert.equal(aiProvenance.mode, mode);
  assert.equal(aiProvenance.generatedAt, new Date(time).toISOString());
  assert.ok(aiProvenance.model);
  assert.equal(aiProvenance.draftNoteMarker, "[PERLU CEK LAPANGAN]");
  assert.match(item.verificationNotes, /^\[PERLU CEK LAPANGAN\] /);
  assert.ok(aiProvenance.verificationChecklist.length >= 2);
  if ("payload" in item) {
    assert.equal(item.reviewed, false);
    assert.equal(item.reviewedAt, "");
  } else {
    assert.equal(item.fieldVerified, false);
    assert.equal(item.fieldVerifiedAt, "");
  }
}

test("Workers AI fenced JSON produces sanitized Claim drafts for all six primitives", async () => {
  for (const [primitive, payload] of Object.entries(payloads)) {
    let sent;
    const coCreator = createStudioAiCoCreator({
      ...provider, now: () => time,
      fetchImpl: async (_url, init) => {
        sent = JSON.parse(init.body);
        return workersAi([{ ...claimDraft, payload }]);
      },
    });
    const result = await coCreator.suggest("fixture-creator-principal", { ...claim, primitive });
    assert.equal(result.ok, true);
    const [item] = result.data.suggestions;
    assert.equal(result.data.mode, "recorded-rehearsal");
    assert.equal(item.payload.primitive, primitive);
    assert.notEqual(item.id, claimDraft.id);
    assertUnverified(item, "ai-co-creator", "recorded-rehearsal");
    assert.equal(JSON.parse(sent.messages[1].content).primitive, primitive);
    assert.match(sent.messages[0].content, /physical observation/);
  }
});

test("OpenAI-style envelopes produce an unverified photo clue and grounded objective clues", async () => {
  for (const [targetFamily, draft] of Object.entries(seekDrafts)) {
    const coCreator = createStudioAiCoCreator({
      ...provider, now: () => time,
      fetchImpl: async () => openAi([draft]),
    });
    const result = await coCreator.suggest("fixture-creator-principal", { ...seek, targetFamily });
    assert.equal(result.ok, true);
    assert.equal(result.data.mode, "recorded-rehearsal");
    const [{ item, family }] = result.data.suggestions;
    assert.equal(family, targetFamily);
    assert.equal(item.label, draft.label);
    if (family === "photo") assertUnverified(item, "ai-co-creator", "recorded-rehearsal");
    else if (family === "measuring") assert.equal(item.poiId, draft.poiId);
    else assert.equal(item.poiCategory, "taman");
  }
});

test("malformed JSON, invalid shape, duplicate labels, copy leaks and invented references each retry once", async () => {
  const matching = { ...seek, targetFamily: "matching" };
  const measuring = { ...seek, targetFamily: "measuring" };
  const cases = [
    [claim, () => new Response("{"), claimDraft],
    [claim, () => workersAi([{ ...claimDraft, payload: { ...mcq, correctChoiceId: "unknown" } }]), claimDraft],
    [claim, () => workersAi([{ ...claimDraft, payload: { ...mcq, choices: [{ id: "a", label: "Batu" }] } }]), claimDraft],
    [claim, () => workersAi([{ ...claimDraft, hint: "Gunakan Kartu Taktis." }]), claimDraft],
    [claim, () => workersAi([{ ...claimDraft, learningExplanation: "Cek observation_mcq di papan." }]), claimDraft],
    [{ ...claim, existingTitles: [claimDraft.title] }, () => workersAi([claimDraft]), { ...claimDraft, title: "Ciri permukaan penanda" }],
    [matching, () => workersAi([{ ...seekDrafts.matching, poiCategory: "stadion" }]), seekDrafts.matching],
    [measuring, () => workersAi([{ ...seekDrafts.measuring, poiId: "tidak-ada" }]), seekDrafts.measuring],
  ];
  for (const [request, bad, good] of cases) {
    let now = time;
    const signals = [];
    const events = [];
    const coCreator = createStudioAiCoCreator({
      ...provider, now: () => now, onEvent: event => events.push(event),
      fetchImpl: async (_url, init) => {
        signals.push(init.signal);
        now += 3_000;
        return signals.length === 1 ? bad() : workersAi([good]);
      },
    });
    const result = await coCreator.suggest("fixture-creator-principal", request);
    assert.equal(result.data.mode, "recorded-rehearsal");
    assert.deepEqual(events.map(event => event.outcome), ["invalid-output", "accepted"]);
    assert.equal(signals[0], signals[1]);
    assert.equal(now - time, 6_000);
  }
});

test("outages return visibly labeled templates and share a single deadline across fetch and body parsing", async () => {
  const outageCases = [
    ["http-error", async () => new Response("", { status: 503 })],
    ["http-error", async () => new Response("", { status: 429 })],
    ["network-error", async () => { throw new Error("opaque provider failure"); }],
    ["timeout", async () => new Promise(() => {})],
    ["timeout", async () => new Response(new ReadableStream({}))],
    ["invalid-output", async () => workersAi([])],
  ];
  for (const [reason, fetchImpl] of outageCases) {
    let attempts = 0;
    const coCreator = createStudioAiCoCreator({
      ...provider, budgetMs: 25, now: () => time,
      fetchImpl: (...args) => { attempts++; return fetchImpl(...args); },
    });
    const start = performance.now();
    const result = await coCreator.suggest("fixture-creator-principal", claim);
    assert.equal(result.data.mode, "template-fallback");
    assert.equal(result.data.fallbackReason, reason);
    assert.equal(attempts, reason === "invalid-output" ? 2 : 1);
    assert.ok(performance.now() - start < 1_000);
    assertUnverified(result.data.suggestions[0], "template-fallback", "template-fallback");
  }

  let now = time;
  let attempts = 0;
  const deadline = createStudioAiCoCreator({
    ...provider, now: () => now,
    fetchImpl: async () => {
      now += ++attempts === 1 ? 10_000 : 5_000;
      return workersAi(attempts === 1 ? [] : [claimDraft]);
    },
  });
  assert.equal((await deadline.suggest("fixture-creator-principal", claim)).data.fallbackReason, "timeout");
  assert.equal(attempts, 2);
});

test("unconfigured fallback covers every requested shape using the supplied place and permitted references", async () => {
  const coCreator = createStudioAiCoCreator({ now: () => time, fetchImpl: async () => assert.fail("unconfigured fetch") });
  assert.equal(coCreator.mode, "template-fallback");
  for (const primitive of Object.keys(payloads)) {
    const request = { ...claim, primitive, count: undefined };
    const first = (await coCreator.suggest("fixture-creator-principal", request)).data;
    assert.equal(first.fallbackReason, "unconfigured");
    assert.equal(first.suggestions.length, 3);
    assert.deepEqual((await coCreator.suggest("fixture-creator-principal", request)).data, first);
    assert.equal(new Set(first.suggestions.map(item => item.title)).size, 3);
    for (const item of first.suggestions) {
      assert.equal(item.payload.primitive, primitive);
      assert.match(JSON.stringify(item.payload), /Serambi Pelabuhan/);
      assert.match(item.hint, /museum/);
      assertUnverified(item, "template-fallback", "template-fallback");
    }
  }
  for (const targetFamily of Object.keys(seekDrafts)) {
    const response = await coCreator.suggest("fixture-seek-creator-principal", { ...seek, targetFamily, count: 3 });
    assert.equal(response.data.suggestions.length, 3);
    for (const { item, family } of response.data.suggestions) {
      assert.equal(family, targetFamily);
      if (family === "photo") assertUnverified(item, "template-fallback", "template-fallback");
      else if (family === "measuring") assert.ok(seek.poiSamples.some(poi => poi.id === item.poiId));
      else assert.equal(item.poiCategory, "taman");
    }
  }
  assert.equal((await coCreator.suggest("fixture-seek-creator-principal", { ...seek, targetFamily: "tentacles", availablePoiCategories: [] })).status, 400);
});

async function startServer(t, options = {}) {
  const server = createSoloServer({ databasePath: ":memory:", allowSandboxAuthOtp: true, ...options });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  return `http://127.0.0.1:${server.address().port}`;
}

test("HTTP requires sign-in, projects public fields, redacts telemetry and limits each creator independently", async t => {
  let now = time;
  const events = [];
  const prompts = [];
  const env = {
    CLOUDFLARE_ACCOUNT_ID: provider.accountId,
    CLOUDFLARE_API_TOKEN: provider.apiToken,
    CLOUDFLARE_AI_MODEL: "@cf/test-model",
    CLOUDFLARE_AI_BASE_URL: "https://provider.example.test/client/v4",
  };
  const origin = await startServer(t, {
    now: () => now,
    studioAi: {
      ...studioAiOptionsFromEnv(env), onEvent: event => events.push(event),
      fetchImpl: async (url, init) => {
        assert.equal(url, `https://provider.example.test/client/v4/accounts/${provider.accountId}/ai/run/%40cf/test-model`);
        assert.equal(init.headers.Authorization, `Bearer ${provider.apiToken}`);
        prompts.push(init.body);
        return workersAi([claimDraft]);
      },
    },
  });
  const endpoint = "/api/rulebooks/studio/ai-suggest";
  const guest = makeClient(origin);
  assert.deepEqual((await guest.post(endpoint, claim)).body, { error: "auth-required" });
  assert.equal((await guest.post(endpoint, claim)).status, 401);
  const health = await guest.get("/api/health");
  assert.equal(health.body.studioAiMode, "live");
  const creator = makeClient(origin);
  const email = "studio-creator@kelana.test";
  const auth = await signInWithSandboxOtp(creator, email);
  const { userId } = auth.body.user;
  const cookie = creator.cookies.get("kelana_session");
  assert.ok(cookie);
  assert.equal((await creator.post(endpoint, { ...claim, count: 4 })).status, 400);
  assert.equal((await creator.post(endpoint, { ...claim, theme: userId })).status, 400);
  const metadata = {
    ...claim, userId, email, cookie, accountId: provider.accountId, fix: { latitude: -6.193429, longitude: 106.821129 },
    landmark: { ...landmark, latitude: -6.193429, osmTags: { ...landmark.osmTags, "contact:email": email } },
  };
  for (let index = 0; index < 10; index++) {
    const response = await creator.post(endpoint, metadata);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "private, no-store");
    assert.equal(response.body.mode, "live");
    assertUnverified(response.body.suggestions[0], "ai-co-creator", "live");
  }
  assert.equal(prompts.length, 10);
  const projected = JSON.parse(JSON.parse(prompts[0]).messages[1].content);
  assert.deepEqual(projected.landmark, landmark);
  for (const secret of [email, userId, cookie, provider.accountId, provider.apiToken, "-6.193429", "106.821129"]) {
    assert.ok(!prompts.join(" ").includes(secret));
    assert.ok(!JSON.stringify(events).includes(secret));
    assert.ok(!JSON.stringify(health.body).includes(secret));
  }
  assert.deepEqual(events.map(event => event.outcome), Array(10).fill("accepted"));
  assert.ok(events.every(event => event.endpoint.includes("[REDACTED_ACCOUNT]") && event.redacted));
  const blocked = await creator.post(endpoint, claim);
  assert.equal(blocked.status, 429);
  assert.equal(blocked.headers.get("retry-after"), "60");
  assert.deepEqual(blocked.body, { error: "rate-limited" });
  const other = makeClient(origin);
  await signInWithSandboxOtp(other, "other-creator@kelana.test");
  assert.equal((await other.post(endpoint, claim)).status, 200);
  now += 60_000;
  assert.equal((await creator.post(endpoint, claim)).status, 200);
});

test("fallback health and actual Studio submission keep generated Claim and photo drafts in field review", async t => {
  const origin = await startServer(t, { now: () => time });
  const creator = makeClient(origin);
  await signInWithSandboxOtp(creator, "field-review@kelana.test");
  assert.equal((await creator.get("/api/health")).body.studioAiMode, "template-fallback");
  const endpoint = "/api/rulebooks/studio/ai-suggest";
  const studio = "/api/rulebooks";
  for (const board of ["claim", "seek"]) {
    const packId = `pack-ai-draft-${board}`;
    const cloned = await creator.post(studio, {
      type: "clone-official", templatePackId: `official-jakarta-compact-${board}`,
      packId, title: `Edisi Uji ${board}`, byline: "Kreator Uji",
    });
    assert.equal(cloned.status, 200, JSON.stringify(cloned.body));
    const { pack, snapshot } = cloned.body.record;
    let issueCode;
    if (board === "claim") {
      const point = pack.geography.landmarks[0];
      const response = await creator.post(endpoint, {
        ...claim, cityLabel: pack.meta.cityLabel,
        landmark: { ...landmark, id: point.id, name: point.name, accessNotes: point.accessNotes },
      });
      assert.equal(response.body.mode, "template-fallback");
      pack.challenges.landmarkChallenges[point.id].push(response.body.suggestions[0]);
      issueCode = "unverified-ai-challenge";
    } else {
      const response = await creator.post(endpoint, { ...seek, cityLabel: pack.meta.cityLabel, targetFamily: "photo" });
      assert.equal(response.body.mode, "template-fallback");
      pack.investigationBook.families.photo.items.push(response.body.suggestions[0].item);
      issueCode = "unverified-ai-photo-prompt";
    }
    const saved = await creator.post(studio, { type: "save-draft", pack, snapshot });
    assert.equal(saved.status, 200, JSON.stringify(saved.body));
    const rejected = await creator.post(studio, { type: "submit-draft", packId, version: 1 });
    assert.equal(rejected.status, 400, JSON.stringify(rejected.body));
    assert.ok(rejected.body.validation.errors.some(issue => issue.code === issueCode));
    assert.ok(rejected.body.validation.errors.some(issue => issue.code === "unedited-ai-verification-notes"));
  }
});
