import type { ComponentChildren } from "preact";
import { useEffect } from "preact/hooks";

export type DialogProps = {
  titleId: string;
  title: ComponentChildren;
  onClose: () => void;
  closeDisabled?: boolean;
  closeLabel?: string;
  backdropClassName?: string;
  dialogClassName?: string;
  headClassName?: string;
  closeButtonClassName?: string;
  testId?: string;
  children: ComponentChildren;
};

/**
 * Accessible overlay dialog primitive supporting Escape dismissal, backdrop
 * click close, busy lockouts, and 44x44 minimum mobile touch targets.
 */
export function Dialog({
  titleId,
  title,
  onClose,
  closeDisabled = false,
  closeLabel = "Tutup dialog",
  backdropClassName = "cat-modal-backdrop",
  dialogClassName = "cat-modal",
  headClassName = "cat-modal-head",
  closeButtonClassName = "secondary cat-modal-close",
  testId,
  children,
}: DialogProps) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !closeDisabled) {
        event.preventDefault();
        onClose();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [closeDisabled, onClose]);

  return (
    <div
      class={backdropClassName}
      data-testid={testId}
      onClick={(event) => {
        if (event.target === event.currentTarget && !closeDisabled) {
          onClose();
        }
      }}
    >
      <section class={dialogClassName} role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <div class={headClassName}>
          <h2 id={titleId}>{title}</h2>
          <button
            type="button"
            class={closeButtonClassName}
            aria-label={closeLabel}
            disabled={closeDisabled}
            onClick={() => {
              if (!closeDisabled) onClose();
            }}
          >
            ×
          </button>
        </div>
        {children}
      </section>
    </div>
  );
}
