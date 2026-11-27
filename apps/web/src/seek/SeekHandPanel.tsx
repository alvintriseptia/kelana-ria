import type { SeekDeckHiderView } from "@kelana-ria/contracts";
import type { Signal } from "@preact/signals";
import type { PreparedPhoto } from "../photo-capture";
import { SeekDrawOffer } from "./SeekDrawOffer";
import { SeekIncomingQuestion } from "./SeekIncomingQuestion";
import { SeekRewardCard } from "./SeekShared";
import type { SeekInlineError, SeekPanel, SeekRoomPayload } from "./types";

const PLAYABLE_HAND_PRIMITIVES = new Set([
  "expand_hand",
  "discard_draw",
  "duplicate",
  "time_trap",
  "move_zone",
  "curse",
]);

export function SeekHandPanel({
  payload,
  panel,
  deal,
  keepIds,
  selectedAnswer,
  photoDraft,
  inlineError,
  busy,
  clockNowSig,
  onToggleKeep,
  onConfirmDraw,
  onChooseAnswer,
  onSubmitAnswer,
  onSelectPhotoFile,
  onClearPhoto,
  onSubmitPhoto,
  onPlayCard,
}: {
  payload: SeekRoomPayload;
  panel: SeekPanel;
  deal: number | null;
  keepIds: Set<string>;
  selectedAnswer: string;
  photoDraft: { prepared: PreparedPhoto | null; processing: boolean; uploading: boolean } | null;
  inlineError: SeekInlineError;
  busy: boolean;
  clockNowSig: Signal<number>;
  onToggleKeep: (instanceId: string) => void;
  onConfirmDraw: () => void;
  onChooseAnswer: (answerCode: string) => void;
  onSubmitAnswer: (questionId: string) => void;
  onSelectPhotoFile: (file: File | undefined) => void;
  onClearPhoto: () => void;
  onSubmitPhoto: (questionId: string) => void;
  onPlayCard: (cardInstanceId: string, primitive: string) => void;
}) {
  const { room, deck, publicBoard } = payload;
  // Strictly enforce hidden-information boundary: never render hider hand/draw/private answers for non-hiders.
  if (room.role !== "hider") return null;

  const { activeDraw, hand, currentHandLimit } = deck as SeekDeckHiderView;
  const pending = room.questions.find((q) => q.status === "pending");

  if (activeDraw && (panel === "hand" || !pending)) {
    return (
      <SeekDrawOffer
        activeDraw={activeDraw}
        deal={deal}
        keepIds={keepIds}
        busy={busy}
        clockNowSig={clockNowSig}
        onToggleKeep={onToggleKeep}
        onConfirmDraw={onConfirmDraw}
      />
    );
  }

  if (pending) {
    const alternatives = hand.filter(
      (card) => card.effect.primitive === "veto" || card.effect.primitive === "randomize",
    );
    return (
      <SeekIncomingQuestion
        room={room}
        question={pending}
        selectedAnswer={selectedAnswer}
        pois={publicBoard.pois}
        alternatives={alternatives}
        photoDraft={photoDraft}
        inlineError={inlineError}
        busy={busy}
        clockNowSig={clockNowSig}
        onChooseAnswer={onChooseAnswer}
        onSubmitAnswer={onSubmitAnswer}
        onSelectPhotoFile={onSelectPhotoFile}
        onClearPhoto={onClearPhoto}
        onSubmitPhoto={onSubmitPhoto}
        onPlayAlternativeCard={onPlayCard}
      />
    );
  }

  return (
    <>
      <h2 id="sg-panel-title" tabIndex={-1}>
        Kartu di Tangan ({hand.length}/{currentHandLimit})
      </h2>
      {hand.length === 0 ? (
        <p>Jawab pertanyaan untuk mengambil kartu.</p>
      ) : (
        <div class="sg-reward-grid" data-count={hand.length}>
          {hand.map((card) => {
            const primitive = card.effect.primitive;
            const canPlay = PLAYABLE_HAND_PRIMITIVES.has(primitive);
            return (
              <SeekRewardCard
                key={card.instanceId}
                card={card}
                action={canPlay ? "play-card" : undefined}
                primitive={canPlay ? primitive : undefined}
                disabled={busy}
                onClick={canPlay ? () => onPlayCard(card.instanceId, primitive) : undefined}
              />
            );
          })}
        </div>
      )}
    </>
  );
}
