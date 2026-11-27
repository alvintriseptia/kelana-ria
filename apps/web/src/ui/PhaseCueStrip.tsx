import {
  dismissPhaseCue,
  getPhaseCueSpec,
  isPhaseCueDismissed,
  type PhaseCueKey,
} from "../quick-guide";
import "../quick-guide.css";

export function PhaseCueStrip({
  cueKey,
  extraNote,
  cueRevision,
  onDismiss,
}: {
  cueKey: PhaseCueKey;
  extraNote?: string;
  cueRevision: number;
  onDismiss: () => void;
}) {
  // Re-evaluate localStorage when cueRevision increments (reset/dismiss).
  void cueRevision;
  if (isPhaseCueDismissed(cueKey)) return null;
  const spec = getPhaseCueSpec(cueKey);
  const fullText = extraNote ? `${spec.text} ${extraNote}` : spec.text;
  return (
    <div class="qg-cue-strip" role="note" data-testid="phase-cue-strip" data-cue-key={cueKey}>
      <span class="qg-cue-icon" aria-hidden="true">
        {spec.icon}
      </span>
      <span class="qg-cue-text">{fullText}</span>
      <button
        type="button"
        class="qg-cue-dismiss"
        data-action="dismiss-phase-cue"
        data-cue-key={cueKey}
        data-testid="phase-cue-dismiss"
        aria-label="Tutup petunjuk"
        onClick={() => {
          dismissPhaseCue(cueKey);
          onDismiss();
        }}
      >
        ×
      </button>
    </div>
  );
}
