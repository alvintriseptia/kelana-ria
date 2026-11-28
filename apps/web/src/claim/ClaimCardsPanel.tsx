import type { ClaimRewardOffer } from "@kelana-ria/contracts";
import { cardLabels, cardTargets, type ClaimRoomPayload } from "./types";

function ClaimRewardChoices({ offer, busy, onChoose }: {
  offer: ClaimRewardOffer;
  busy: boolean;
  onChoose: (offerId: string, cardInstanceId: string) => void;
}) {
  return (
    <section aria-labelledby="cg-reward-title">
      <h3 id="cg-reward-title">Pilih satu kartu hadiah</h3>
      <div class="cg-reward-options">
        {offer.cards.map((item) => (
          <button
            key={item.instanceId}
            type="button"
            class="sg-pick"
            data-action="choose-claim-reward"
            aria-label={`Simpan ${item.title}`}
            aria-describedby={`cg-reward-${item.instanceId}`}
            disabled={busy}
            onClick={() => onChoose(offer.offerId, item.instanceId)}
          >
            <strong>{item.title}</strong>
            <span id={`cg-reward-${item.instanceId}`}>{item.description}</span>
          </button>
        ))}
      </div>
    </section>
  );
}

export function ClaimCardsPanel({
  payload,
  selectedCardId,
  selectedId,
  selectedRivalId,
  mapFailed,
  busy,
  onSelectCard,
  onCloseCard,
  onSelectRival,
  onChooseReward,
  onPlayCard,
}: {
  payload: ClaimRoomPayload;
  selectedCardId: string;
  selectedId: string;
  selectedRivalId: string;
  mapFailed: boolean;
  busy: boolean;
  onSelectCard: (instanceId: string) => void;
  onCloseCard: () => void;
  onSelectRival: (seatId: string) => void;
  onChooseReward: (offerId: string, cardInstanceId: string) => void;
  onPlayCard: (cardInstanceId: string, landmarkId?: string, targetSeatId?: string) => void;
}) {
  const { room, publicBoard } = payload;
  if (room.phase !== "active") {
    return (
      <>
        <h2>Kartu</h2>
        <p>Permainan sudah berakhir.</p>
      </>
    );
  }

  const rewardChoices = room.ownClaimReward
    ? <ClaimRewardChoices offer={room.ownClaimReward} busy={busy} onChoose={onChooseReward} />
    : null;
  const card = room.ownHand.find((item) => item.instanceId === selectedCardId);
  if (!card) {
    return (
      <>
        <div class="cg-section-title">
          <h2>Kartu</h2>
          <span class="rb-badge">{room.ownHand.length}</span>
        </div>
        {rewardChoices}
        {room.ownHand.length === 0 ? (
          !rewardChoices && <p>Kunci atau rebut landmark untuk menarik kartu.</p>
        ) : (
          <div class="cg-card-stack">
            {room.ownHand.map((item) => {
              const [label, art] = cardLabels[item.effect.primitive];
              return (
                <button
                  key={item.instanceId}
                  type="button"
                  class="cg-tactic"
                  data-action="select-card"
                  data-instance={item.instanceId}
                  disabled={busy}
                  onClick={() => onSelectCard(item.instanceId)}
                >
                  <span class={`cg-card-art sg-reward-art cg-art-${art}`} aria-hidden="true" />
                  <span class="cg-card-copy">
                    <small>{label}</small>
                    <strong>{item.title}</strong>
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </>
    );
  }

  const primitive = card.effect.primitive;
  const rivals =
    primitive === "sabotage_curse" ? room.seats.filter((seat) => seat.teamId !== room.teamId) : [];
  const targets = cardTargets(room, card);
  const targetId = primitive === "swap_challenge" ? room.ownActiveAttempt?.landmarkId : selectedId;
  const chosen = Boolean(targetId && targets.includes(targetId));
  const chosenName = chosen ? publicBoard.landmarks.find((lm) => lm.id === targetId)?.name : "";
  const rivalChosen = rivals.some((seat) => seat.seatId === selectedRivalId);

  return (
    <>
      <div class="cg-section-title">
        <h2>{card.title}</h2>
        <button
          type="button"
          class="sg-quiet"
          data-action="close-card"
          disabled={busy}
          onClick={onCloseCard}
        >
          Semua kartu
        </button>
      </div>
      <p>{card.description}</p>
      {rewardChoices}
      {rivals.length > 0 && (
        <div class="sg-picks" aria-label="Pilih lawan">
          {rivals.map((seat) => (
            <button
              key={seat.seatId}
              type="button"
              class="sg-pick"
              data-action="select-rival"
              data-seat={seat.seatId}
              aria-pressed={seat.seatId === selectedRivalId}
              disabled={busy}
              onClick={() => onSelectRival(seat.seatId)}
            >
              {seat.name}
            </button>
          ))}
        </div>
      )}
      {chosenName && (
        <p>
          Target <strong>{chosenName}</strong>
        </p>
      )}
      {!chosen && !rivals.length && (
        <p>
          {targets.length
            ? `Pilih pin yang disorot di ${mapFailed ? "daftar" : "peta"}.`
            : "Belum ada target yang memenuhi syarat."}
        </p>
      )}
      <button
        type="button"
        class="sg-main"
        data-action="play-card"
        data-instance={card.instanceId}
        data-landmark={chosen && targetId ? targetId : ""}
        data-seat={rivalChosen ? selectedRivalId : ""}
        disabled={busy || !(chosen || rivalChosen)}
        onClick={() =>
          onPlayCard(
            card.instanceId,
            chosen && targetId ? targetId : undefined,
            rivalChosen ? selectedRivalId : undefined,
          )
        }
      >
        Mainkan Kartu
      </button>
    </>
  );
}
