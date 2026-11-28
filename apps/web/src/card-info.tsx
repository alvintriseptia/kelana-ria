import { useId, useRef } from "preact/hooks";
import type { CardRules } from "./card-rules";
import "./card-info.css";

export function CardInfo({ title, description, rules }: {
  title: string;
  description: string;
  rules: CardRules;
}) {
  const titleId = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const rows = [
    ["Kapan", rules.timing],
    ["Target", rules.target],
    ["Efek", rules.effect],
    ["Biaya", rules.cost],
    ["Berakhir", rules.ends],
  ];
  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        class="sg-quiet card-info-button"
        aria-label={`Info ${title}`}
        aria-haspopup="dialog"
        onClick={() => dialogRef.current?.showModal()}
      >
        <span aria-hidden="true">ⓘ</span> Info
      </button>
      <dialog
        ref={dialogRef}
        class="card-info-dialog"
        aria-labelledby={titleId}
        onClose={() => triggerRef.current?.focus({ preventScroll: true })}
        onKeyDown={event => {
          if (event.key === "Escape") event.stopPropagation();
        }}
      >
        <div class="card-info-header">
          <h2 id={titleId}>{title}</h2>
          <button type="button" class="sg-quiet card-info-button" aria-label="Tutup info kartu" onClick={() => dialogRef.current?.close()}>
            ×
          </button>
        </div>
        <p>{description}</p>
        <dl>
          {rows.map(([label, value]) => value && (
            <div key={label}>
              <dt>{label}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
      </dialog>
    </>
  );
}
