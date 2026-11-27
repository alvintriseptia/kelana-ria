import type { PlayerErrorTone } from "../player-errors";

const toneIcons: Record<PlayerErrorTone, string> = {
  warn: "▲",
  error: "◆",
  info: "●",
};

export function InlineAlert({
  message,
  tone = "warn",
  testId,
  errorSlot,
}: {
  message: string;
  tone?: PlayerErrorTone;
  testId?: string;
  errorSlot?: string;
}) {
  return (
    <p
      class={`pt-inline-alert pt-inline-alert--${tone}`}
      role="alert"
      aria-atomic="true"
      data-testid={testId}
      data-error-slot={errorSlot}
    >
      <span class="pt-inline-alert-mark" aria-hidden="true">
        {toneIcons[tone]}
      </span>
      <span>{message}</span>
    </p>
  );
}
