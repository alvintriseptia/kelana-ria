import type {
  ClaimChallengeItem,
  ClaimLeafChallengePayload,
  ClaimRulebookPack,
  ClaimSanitizedChallenge,
  ClaimSanitizedLeafChallenge,
  LocationFix,
} from "@kelana-ria/contracts";
import { verifyGpsAtPoint } from "../seek-engine/geo-evaluator.js";

export function sanitizeLeafChallenge(payload: ClaimLeafChallengePayload): ClaimSanitizedLeafChallenge {
  switch (payload.primitive) {
    case "observation_mcq":
      return {
        primitive: "observation_mcq",
        prompt: payload.prompt,
        choices: payload.choices.map((c) => ({ id: c.id, label: c.label })),
      };
    case "observation_input":
      return {
        primitive: "observation_input",
        prompt: payload.prompt,
        inputMode: payload.inputMode,
      };
    case "photo_proof":
      return {
        primitive: "photo_proof",
        prompt: payload.prompt,
        verificationMode: payload.verificationMode,
        autoApproveMs: payload.autoApproveMs,
      };
    case "timed_micro_task":
      return {
        primitive: "timed_micro_task",
        prompt: payload.prompt,
        timeLimitMs: payload.timeLimitMs,
        taskType: payload.taskType,
        ...(payload.subPoint ? { subPoint: { ...payload.subPoint } } : {}),
        ...(payload.autoApproveMs !== undefined ? { autoApproveMs: payload.autoApproveMs } : {}),
      };
  }
}

export function sanitizeClaimChallenge(
  item: ClaimChallengeItem,
  options: { chosenTier?: "standard" | "bold"; currentStep?: 0 | 1 } = {},
): ClaimSanitizedChallenge {
  const payload = item.payload;
  if (payload.primitive === "call_your_shot") {
    const activeTask =
      options.chosenTier === "standard"
        ? sanitizeLeafChallenge(payload.standardTask)
        : options.chosenTier === "bold"
          ? sanitizeLeafChallenge(payload.boldTask)
          : undefined;
    return {
      id: item.id,
      title: item.title,
      payload: {
        primitive: "call_your_shot",
        theme: payload.theme,
        ...(options.chosenTier ? { chosenTier: options.chosenTier } : {}),
        ...(activeTask ? { activeTask } : {}),
        boldReward: { ...payload.boldReward },
      },
    };
  }
  if (payload.primitive === "multi_step") {
    return {
      id: item.id,
      title: item.title,
      payload: {
        primitive: "multi_step",
        currentStep: options.currentStep ?? 0,
        steps: [sanitizeLeafChallenge(payload.steps[0]), sanitizeLeafChallenge(payload.steps[1])],
      },
    };
  }
  return {
    id: item.id,
    title: item.title,
    payload: sanitizeLeafChallenge(payload),
  };
}

export function resolveActiveLeafChallenge(
  item: ClaimChallengeItem,
  state: { chosenTier?: "standard" | "bold"; currentStep: 0 | 1 },
): { ok: true; leaf: ClaimLeafChallengePayload } | { ok: false; error: string } {
  const payload = item.payload;
  if (payload.primitive === "call_your_shot") {
    if (!state.chosenTier) return { ok: false, error: "shot-tier-required" };
    return { ok: true, leaf: state.chosenTier === "bold" ? payload.boldTask : payload.standardTask };
  }
  if (payload.primitive === "multi_step") {
    return { ok: true, leaf: payload.steps[state.currentStep] };
  }
  return { ok: true, leaf: payload };
}

function normalizeText(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function matchesInputAnswer(
  rawValue: string,
  inputMode: "text" | "number",
  acceptedAnswers?: string[],
  numericRange?: { min: number; max: number },
): boolean {
  const trimmed = rawValue.trim();
  if (!trimmed) return false;
  if (inputMode === "number") {
    const parsed = Number(trimmed);
    if (!Number.isFinite(parsed)) return false;
    if (numericRange && parsed >= numericRange.min && parsed <= numericRange.max) return true;
    if (acceptedAnswers?.some((ans) => Number(ans.trim()) === parsed)) return true;
    return false;
  }
  const normalized = normalizeText(trimmed);
  return Boolean(acceptedAnswers?.some((ans) => normalizeText(ans) === normalized));
}

export type LeafEvaluationOutcome =
  | { status: "passed" }
  | { status: "pending_photo_review"; photoId: string; autoApproveMs: number }
  | { status: "wrong"; error: string };

export function evaluateLeafSubmission(params: {
  leaf: ClaimLeafChallengePayload;
  submission: { choiceId?: string; inputValue?: string; photoId?: string; fix?: LocationFix };
  isSolo: boolean;
  now: number;
  geography: ClaimRulebookPack["geography"];
  timedStartedAt: number | null;
  timedDeadline: number | null;
}): LeafEvaluationOutcome {
  const { leaf, submission, isSolo, now, geography, timedStartedAt, timedDeadline } = params;

  switch (leaf.primitive) {
    case "observation_mcq": {
      if (!submission.choiceId || !leaf.choices.some((c) => c.id === submission.choiceId)) {
        return { status: "wrong", error: "invalid-choice" };
      }
      return submission.choiceId === leaf.correctChoiceId
        ? { status: "passed" }
        : { status: "wrong", error: "wrong-answer" };
    }
    case "observation_input": {
      if (typeof submission.inputValue !== "string") {
        return { status: "wrong", error: "input-required" };
      }
      return matchesInputAnswer(submission.inputValue, leaf.inputMode, leaf.acceptedAnswers, leaf.numericRange)
        ? { status: "passed" }
        : { status: "wrong", error: "wrong-answer" };
    }
    case "photo_proof": {
      if (!submission.photoId || !submission.photoId.trim()) {
        return { status: "wrong", error: "photo-required" };
      }
      if (isSolo || leaf.verificationMode === "honor_submit") {
        return { status: "passed" };
      }
      return {
        status: "pending_photo_review",
        photoId: submission.photoId.trim(),
        autoApproveMs: leaf.autoApproveMs,
      };
    }
    case "timed_micro_task": {
      if (timedStartedAt === null || timedDeadline === null) {
        return { status: "wrong", error: "timed-task-not-started" };
      }
      if (now >= timedDeadline) {
        return { status: "wrong", error: "timed-task-expired" };
      }
      if (leaf.taskType === "sub_point_gps") {
        if (!leaf.subPoint || !submission.fix) return { status: "wrong", error: "location-required" };
        const check = verifyGpsAtPoint(leaf.subPoint, submission.fix, now, geography, leaf.subPoint.radiusMeters);
        return check.ok ? { status: "passed" } : { status: "wrong", error: check.error };
      }
      if (leaf.taskType === "observation_input") {
        if (typeof submission.inputValue !== "string") return { status: "wrong", error: "input-required" };
        const mode = leaf.numericRange ? "number" : "text";
        return matchesInputAnswer(submission.inputValue, mode, leaf.acceptedAnswers, leaf.numericRange)
          ? { status: "passed" }
          : { status: "wrong", error: "wrong-answer" };
      }
      if (!submission.photoId || !submission.photoId.trim()) {
        return { status: "wrong", error: "photo-required" };
      }
      if (isSolo) return { status: "passed" };
      return {
        status: "pending_photo_review",
        photoId: submission.photoId.trim(),
        autoApproveMs: leaf.autoApproveMs ?? 120_000,
      };
    }
  }
}
