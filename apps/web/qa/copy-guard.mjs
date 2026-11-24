import assert from "node:assert/strict";

const BANNED_UI_PATTERNS = [
  { name: "Kartu Taktis", regex: /Kartu Taktis/i },
  { name: "Dek Taktis", regex: /Dek Taktis/i },
  { name: "Tantangan Berani", regex: /Tantangan Berani/i },
  { name: "Berani / Bold", regex: /Berani\s*\/\s*Bold/i },
  { name: "Hadiah Taktis", regex: /Hadiah Taktis/i },
  { name: "Kutukan Komposabel", regex: /Kutukan Komposabel/i },
  { name: "Kutukan Sabotase", regex: /Kutukan Sabotase/i },
  { name: "Perburuan Makro", regex: /Perburuan Makro/i },
  { name: "Jangkar Sembunyi", regex: /Jangkar Sembunyi/i },
  { name: "Tuan Rumah", regex: /Tuan Rumah/i },
  { name: "observation_mcq", regex: /\bobservation_mcq\b/ },
  { name: "observation_input", regex: /\bobservation_input\b/ },
  { name: "photo_proof", regex: /\bphoto_proof\b/ },
  { name: "timed_micro_task", regex: /\btimed_micro_task\b/ },
  { name: "call_your_shot", regex: /\bcall_your_shot\b/ },
  { name: "multi_step", regex: /\bmulti_step\b/ },
  { name: "sabotage_curse", regex: /\bsabotage_curse\b/ },
  { name: "drawCount", regex: /\bdrawCount\b/ },
  { name: "keepCount", regex: /\bkeepCount\b/ },
  { name: "multi-primitif", regex: /multi-primitif/i },
];

export async function assertCleanUiCopy(page, label) {
  const rendered = await page.evaluate(() => {
    const bodyText = document.body?.innerText || "";
    const optionText = Array.from(document.querySelectorAll("option"))
      .map((option) => option.textContent || "")
      .join("\n");
    return `${bodyText}\n${optionText}`;
  });

  const hits = BANNED_UI_PATTERNS
    .filter(({ regex }) => regex.test(rendered))
    .map(({ name }) => name);

  assert.deepEqual(
    hits,
    [],
    `Banned or schema-leaked UI copy found at "${label}": ${hits.join(", ")}`,
  );
}
