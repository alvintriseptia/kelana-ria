import type { ClaimChallengePrimitive, ClaimLeafChallengePayload } from "@kelana-ria/contracts";
import { escapeText } from "./escape-text";

function field(label: string, id: string, value: string | number, kind = "text") {
  return `<label class="rb-field"><span>${escapeText(label)}</span><input id="${id}" type="${kind}" value="${escapeText(String(value))}"></label>`;
}

function leafFields(task: ClaimLeafChallengePayload, key: string) {
  const prompt = field("Instruksi pengamatan", `${key}-prompt`, task.prompt);
  if (task.primitive === "observation_mcq") {
    return prompt + task.choices.map((choice, index) => field(`Pilihan ${index + 1}`, `${key}-choice-${index}`, choice.label)).join("") +
      `<label class="rb-field"><span>Jawaban benar</span><select id="${key}-correct" data-ai-answer>${task.choices.map((choice, index) =>
        `<option value="${escapeText(choice.id)}" ${choice.id === task.correctChoiceId ? "selected" : ""}>Pilihan ${index + 1}</option>`).join("")}</select></label>`;
  }
  if (task.primitive === "photo_proof") {
    return prompt + field("Setuju otomatis (detik)", `${key}-auto`, task.autoApproveMs / 1_000, "number");
  }
  const timer = task.primitive === "timed_micro_task" ? field("Batas waktu (detik)", `${key}-time`, task.timeLimitMs / 1_000, "number") : "";
  if (task.primitive === "timed_micro_task" && task.taskType === "photo_proof") {
    return prompt + timer + field("Setuju otomatis (detik)", `${key}-auto`, (task.autoApproveMs ?? 120_000) / 1_000, "number");
  }
  if (task.primitive === "timed_micro_task" && task.taskType === "sub_point_gps") return prompt + timer;
  const answer = task.numericRange
    ? field("Jawaban minimum", `${key}-min`, task.numericRange.min, "number") +
      field("Jawaban maksimum", `${key}-max`, task.numericRange.max, "number")
    : field("Jawaban benar (pisahkan koma)", `${key}-answers`, (task.acceptedAnswers ?? []).join(", "));
  return prompt + timer + answer;
}

export function renderStudioSuggestionFields(payload: ClaimChallengePrimitive) {
  const group = (label: string, task: ClaimLeafChallengePayload, key: string) =>
    `<fieldset class="studio-field-group"><legend>${label}</legend>${leafFields(task, key)}</fieldset>`;
  if (payload.primitive === "call_your_shot") {
    return field("Tema tantangan", "ed-ai-theme", payload.theme) +
      group("Soal standar", payload.standardTask, "ed-ai-first") + group("Soal ekstra", payload.boldTask, "ed-ai-second");
  }
  if (payload.primitive === "multi_step") {
    return group("Langkah 1", payload.steps[0], "ed-ai-first") + group("Langkah 2", payload.steps[1], "ed-ai-second");
  }
  return leafFields(payload, "ed-ai-leaf");
}

export function readStudioSuggestionFields(root: HTMLElement, original: ClaimChallengePrimitive): ClaimChallengePrimitive | null {
  const text = (key: string) => root.querySelector<HTMLInputElement | HTMLSelectElement>(`#${key}`)?.value.trim() ?? "";
  const number = (key: string) => root.querySelector<HTMLInputElement>(`#${key}`)?.valueAsNumber ?? Number.NaN;
  function leaf(task: ClaimLeafChallengePayload, key: string): ClaimLeafChallengePayload | null {
    const prompt = text(`${key}-prompt`);
    if (!prompt) return null;
    if (task.primitive === "observation_mcq") {
      const choices = task.choices.map((choice, index) => ({ ...choice, label: text(`${key}-choice-${index}`) }));
      const correctChoiceId = text(`${key}-correct`);
      if (choices.some(choice => !choice.label) || !choices.some(choice => choice.id === correctChoiceId)) return null;
      return { ...task, prompt, choices, correctChoiceId };
    }
    const autoApproveMs = number(`${key}-auto`) * 1_000;
    if (task.primitive === "photo_proof") {
      return autoApproveMs > 0 && autoApproveMs <= 180_000 ? { ...task, prompt, autoApproveMs } : null;
    }
    const timeLimitMs = number(`${key}-time`) * 1_000;
    if (task.primitive === "timed_micro_task") {
      if (!(timeLimitMs > 0 && timeLimitMs <= 900_000)) return null;
      task = { ...task, timeLimitMs };
      if (task.taskType === "photo_proof") {
        return autoApproveMs > 0 && autoApproveMs <= 180_000 ? { ...task, prompt, autoApproveMs } : null;
      }
      if (task.taskType === "sub_point_gps") return { ...task, prompt };
    }
    if (task.numericRange) {
      const min = number(`${key}-min`);
      const max = number(`${key}-max`);
      return Number.isFinite(min) && Number.isFinite(max) && min <= max ? { ...task, prompt, numericRange: { min, max } } : null;
    }
    const acceptedAnswers = text(`${key}-answers`).split(",").map(answer => answer.trim()).filter(Boolean);
    return acceptedAnswers.length ? { ...task, prompt, acceptedAnswers } : null;
  }
  if (original.primitive === "call_your_shot") {
    const standardTask = leaf(original.standardTask, "ed-ai-first");
    const boldTask = leaf(original.boldTask, "ed-ai-second");
    const theme = text("ed-ai-theme");
    return standardTask && boldTask && theme ? { ...original, standardTask, boldTask, theme } : null;
  }
  if (original.primitive === "multi_step") {
    const first = leaf(original.steps[0], "ed-ai-first");
    const second = leaf(original.steps[1], "ed-ai-second");
    return first && second ? { ...original, steps: [first, second] } : null;
  }
  return leaf(original, "ed-ai-leaf");
}
