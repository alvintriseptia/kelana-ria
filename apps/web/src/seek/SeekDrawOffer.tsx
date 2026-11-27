import type { SeekDeckHiderView } from "@kelana-ria/contracts";
import type { Signal } from "@preact/signals";
import { useLayoutEffect, useRef } from "preact/hooks";
import { animatePop, motionAllowed } from "../game-motion";
import { animateSeekDraw } from "./seek-motion";
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
          <DrawCard key={card.instanceId} card={card} index={index} deal={deal}
            selected={keepIds.has(card.instanceId)} busy={busy}
            onToggleKeep={onToggleKeep} />
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

function DrawCard({ card, index, deal, selected, busy, onToggleKeep }: {
  card: NonNullable<SeekDeckHiderView["activeDraw"]>["cards"][number];
  index: number;
  deal: number | null;
  selected: boolean;
  busy: boolean;
  onToggleKeep: (id: string) => void;
}) {
  const offer = useRef<HTMLDivElement>(null);
  const face = useRef<HTMLDivElement>(null);
  const back = useRef<HTMLSpanElement>(null);
  const entered = useRef(false);
  const previousSelection = useRef(selected);

  useLayoutEffect(() => {
    const node = offer.current;
    if (entered.current || deal === null || !face.current || !back.current || !node || !motionAllowed()) return;
    entered.current = true;
    node.dataset.gameMotion = `draw:${deal}`;
    const source = node.closest(".sg-dock")?.querySelector<HTMLElement>('[data-panel="hand"]') ?? null;
    return animateSeekDraw(back.current, face.current, source, index);
  }, []);

  useLayoutEffect(() => {
    if (selected === previousSelection.current) return;
    previousSelection.current = selected;
    return animatePop(offer.current, { fromScale: selected ? 0.94 : 1.03, preset: "bouncy" });
  }, [selected]);

  return <div ref={offer} class="sg-offer">
    <div ref={face} class="sg-offer-face">
      <SeekRewardCard card={card} action="choose-draw" selected={selected} disabled={busy}
        onClick={() => onToggleKeep(card.instanceId)} />
    </div>
    <span ref={back} hidden={!entered.current && deal === null} class="sg-offer-back" aria-hidden="true">◆</span>
  </div>;
}
