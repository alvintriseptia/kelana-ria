import type { ClaimRewardOffer } from "@kelana-ria/contracts";
import { useState } from "preact/hooks";
import { motionAllowed } from "../game-motion";
import { RewardDrawCard } from "../ui/RewardDrawCard";
import { CardInfo } from "../card-info";
import { claimCardRules } from "../card-rules";
import { cardLabels, cardTargets, type ClaimRoomPayload } from "./types";

function ClaimRewardChoices({ offer, busy, canDeal, onPresented, onChoose }: {
  offer: ClaimRewardOffer;
  busy: boolean;
  canDeal: boolean;
  onPresented: () => void;
  onChoose: (offerId: string, cardInstanceId: string) => void;
}) {
  const [selected, select] = useState("");
  const [deal] = useState(() => canDeal && motionAllowed() ? offer.offerId : null);
  return (
    <section aria-labelledby="cg-reward-title" class="cg-reward-draw">
      <h3 id="cg-reward-title">Pilih satu kartu hadiah</h3>
      <p class="sg-reward-note">Pilih 1 dari {offer.cards.length} kartu</p>
      <div class={`sg-reward-grid${deal !== null ? " sg-deal" : ""}`} data-count={offer.cards.length}>
        {offer.cards.map((item, index) => {
          const [label, art] = cardLabels[item.effect.primitive];
          return (
            <RewardDrawCard key={item.instanceId} index={index} deal={deal} sourcePanel="cards"
              selected={selected === item.instanceId} onPresented={onPresented}>
              <div class="sg-reward-entry">
                <button type="button" class="sg-reward-card" data-action="select-claim-reward"
                  data-instance={item.instanceId} aria-pressed={selected === item.instanceId}
                  disabled={busy} onClick={() => select(selected === item.instanceId ? "" : item.instanceId)}>
                  <span class={`sg-reward-art cg-art-${art}`} aria-hidden="true" />
                  <span class="sg-reward-copy"><small>{label}</small><strong>{item.title}</strong></span>
                </button>
                <CardInfo title={item.title} description={item.description} rules={claimCardRules(item.effect)} />
              </div>
            </RewardDrawCard>
          );
        })}
      </div>
      <button type="button" class="sg-main" data-action="choose-claim-reward"
        disabled={busy || !selected} onClick={() => onChoose(offer.offerId, selected)}>
        Simpan {selected ? 1 : 0}/1 kartu
      </button>
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
  dealOfferId,
  onRewardPresented,
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
  dealOfferId: string;
  onRewardPresented: (offerId: string) => void;
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

  const offer = room.ownClaimReward;
  if (offer) return <ClaimRewardChoices key={offer.offerId} offer={offer} busy={busy}
    canDeal={dealOfferId === offer.offerId} onPresented={() => onRewardPresented(offer.offerId)}
    onChoose={onChooseReward} />;
  const card = room.ownHand.find((item) => item.instanceId === selectedCardId);
  if (!card) {
    return (
      <>
        <div class="cg-section-title">
          <h2>Kartu</h2>
          <span class="rb-badge">{room.ownHand.length}</span>
        </div>
        {room.ownHand.length === 0 ? (
          <p>Kunci atau rebut landmark untuk menarik kartu.</p>
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
      <CardInfo title={card.title} description={card.description} rules={claimCardRules(card.effect)} />
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
