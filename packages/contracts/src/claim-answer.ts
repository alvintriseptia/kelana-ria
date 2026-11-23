export function matchesClaimInputAnswer(
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
    return Boolean(acceptedAnswers?.some(answer => Number(answer.trim()) === parsed));
  }
  const normalize = (value: string) => value.trim().toLowerCase().replace(/\s+/g, " ");
  const normalized = normalize(trimmed);
  return Boolean(acceptedAnswers?.some(answer => normalize(answer) === normalized));
}
