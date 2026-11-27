import type { SeekDeckHiderView } from "@kelana-ria/contracts";
import type { Signal } from "@preact/signals";
import { SeekDeadline, SeekRewardCard } from "./SeekShared";

export function SeekDrawOffer({
  activeDraw,
  deal,
  keepIds,
  busy,
  clockNowSig,
  onToggleKeep,
  onConfirmDraw,
}: {
  activeDraw: NonNullable<SeekDeckHiderView["activeDraw"]>;
  deal: boolean;
  keepIds: Set<string>;
  busy: boolean;
  clockNowSig: Signal<number>;
  onToggleKeep: (instanceId: string) => void;
  onConfirmDraw: () => void;
}) {
  return (
    <>
      <h2 id="sg-panel-title" tabIndex={-1}>
        Pilih kartu untuk disimpan
      </h2>
      <p class="sg-reward-note">
        Simpan {activeDraw.keepCount} dari {activeDraw.cards.length} ·{" "}
        <SeekDeadline deadline={activeDraw.deadline} clockNowSig={clockNowSig} />
      </p>
      <div
        class={`sg-reward-grid${deal ? " sg-deal" : ""}`}
        data-count={activeDraw.cards.length}
      >
        {activeDraw.cards.map((card) => (
          <div key={card.instanceId} class="sg-offer">
            <SeekRewardCard
              card={card}
              action="choose-draw"
              selected={keepIds.has(card.instanceId)}
              disabled={busy}
              onClick={() => onToggleKeep(card.instanceId)}
            />
            <span class="sg-offer-back" aria-hidden="true">
              ◆
            </span>
          </div>
        ))}
      </div>
      <button
        type="button"
        class="sg-main"
        data-action="confirm-draw"
        disabled={busy || keepIds.size !== activeDraw.keepCount}
        onClick={onConfirmDraw}
      >
        Simpan {keepIds.size}/{activeDraw.keepCount} kartu
      </button>
    </>
  );
}
