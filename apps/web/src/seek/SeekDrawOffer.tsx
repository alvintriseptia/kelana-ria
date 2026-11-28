import type { SeekDeckHiderView } from "@kelana-ria/contracts";
import type { Signal } from "@preact/signals";
import { motionAllowed } from "../game-motion";
import { RewardDrawCard } from "../ui/RewardDrawCard";
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
  deal: number | null;
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
        class={`sg-reward-grid${deal !== null && motionAllowed() ? " sg-deal" : ""}`}
        data-count={activeDraw.cards.length}
      >
        {activeDraw.cards.map((card, index) => (
          <RewardDrawCard key={card.instanceId} index={index} deal={deal}
            selected={keepIds.has(card.instanceId)} sourcePanel="hand">
            <SeekRewardCard card={card} action="choose-draw" selected={keepIds.has(card.instanceId)} disabled={busy}
              onClick={() => onToggleKeep(card.instanceId)} />
          </RewardDrawCard>
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
