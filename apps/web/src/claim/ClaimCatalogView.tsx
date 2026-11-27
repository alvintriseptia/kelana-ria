import type { RulebookEntitlementSummary } from "@kelana-ria/contracts";
import { ClaimSlotAlert } from "./ClaimShared";
import {
  claimPrimitiveLabel,
  idr,
  type ClaimInlineError,
  type ClaimPublicListing,
} from "./types";

export function ClaimCatalogView({
  listings,
  ownedPackIds,
  entitlements,
  allowSandboxCheckout,
  activeOrderId,
  joinCode,
  joinName,
  statusMsg,
  inlineError,
  busy,
  onJoinCodeInput,
  onJoinNameInput,
  onJoinRoom,
  onOpenStudio,
  onBack,
  onStartFree,
  onStartOwned,
  onResumeOwned,
  onBuyPack,
  onSettleOrder,
}: {
  listings: ClaimPublicListing[];
  ownedPackIds: string[];
  entitlements: RulebookEntitlementSummary[];
  allowSandboxCheckout: boolean;
  activeOrderId: string | null;
  joinCode: string;
  joinName: string;
  statusMsg: string;
  inlineError: ClaimInlineError;
  busy: boolean;
  onJoinCodeInput: (value: string) => void;
  onJoinNameInput: (value: string) => void;
  onJoinRoom: () => void;
  onOpenStudio: () => void;
  onBack: () => void;
  onStartFree: (packId: string, version: number) => void;
  onStartOwned: (packId: string, version: number) => void;
  onResumeOwned: (roomCode: string) => void;
  onBuyPack: (packId: string, version: number) => void;
  onSettleOrder: (orderId: string) => void;
}) {
  return (
    <section class="rb-shell" aria-label="Katalog Claim the City">
      <div class="rb-card">
        <h2>Claim the City (1–6 Pemain)</h2>
        <p>
          Rebut wilayah lewat Klaim, Kunci, dan Rebut landmark. Selesaikan tantangan di lokasi dan
          pakai kartu untuk balik keadaan.
        </p>
        <div class="rb-actions">
          <button type="button" class="secondary" data-nav="studio" onClick={onOpenStudio}>
            Buka Studio Kreator
          </button>
          <button type="button" class="secondary" data-nav="back" onClick={onBack}>
            Kembali ke Katalog
          </button>
        </div>
        {statusMsg && <p role="status">{statusMsg}</p>}
        <ClaimSlotAlert error={inlineError} slot="catalog" />
      </div>

      <div class="rb-card">
        <h3>Gabung Ruang dengan Kode Undangan</h3>
        <div class="rb-grid-2">
          <label class="rb-field">
            <span>Kode Ruang</span>
            <input
              id="rb-claim-join-code"
              placeholder="RC-XXXXXX"
              value={joinCode}
              onInput={(event) => onJoinCodeInput(event.currentTarget.value)}
            />
          </label>
          <label class="rb-field">
            <span>Nama Pemain</span>
            <input
              id="rb-claim-join-name"
              value={joinName}
              onInput={(event) => onJoinNameInput(event.currentTarget.value)}
            />
          </label>
        </div>
        <ClaimSlotAlert error={inlineError} slot="join" />
        <div class="rb-actions">
          <button
            type="button"
            class="primary"
            data-action="join-room"
            disabled={busy}
            onClick={onJoinRoom}
          >
            Gabung Ruang
          </button>
        </div>
      </div>

      {listings.map((item) => {
        const owned = item.priceIdr > 0 && ownedPackIds.includes(item.packId);
        const ent = owned ? entitlements.find((e) => e.packId === item.packId) : undefined;
        return (
          <article key={`${item.packId}@${item.version}`} class="rb-card" data-pack-id={item.packId}>
            <div class="rb-badges">
              {owned ? (
                <span class="rb-badge rb-badge-owned" data-testid="owned-badge">
                  <span aria-hidden="true">✓</span> Dimiliki
                </span>
              ) : (
                <span class={`rb-badge ${item.priceIdr > 0 ? "rb-badge-paid" : ""}`}>
                  {idr(item.priceIdr)}
                </span>
              )}
              <span class="rb-badge">{item.cityLabel}</span>
              <span class="rb-badge">
                {item.minPlayers}–{item.maxPlayers} pemain (
                {item.teamMode === "teams" ? "Tim" : "Individu"})
              </span>
              <span class="rb-badge">
                {item.zones.length} zona · {item.landmarkCount} landmark
              </span>
              <span class="rb-badge">{item.durationMinutes} menit</span>
            </div>
            <h3>
              {item.title} <small>v{item.version}</small>
            </h3>
            <p>{item.summary}</p>
            <p>
              <small>
                Oleh {item.byline} · Mulai: {item.startName}
                {item.soloTargets
                  ? ` · Target Solo: ${item.soloTargets.lockedLandmarks} kunci di ${item.soloTargets.distinctZones} zona`
                  : ""}
              </small>
            </p>
            <p>
              <small>
                Dek Kartu:{" "}
                {item.tacticalDeckSummary.enabled
                  ? `${item.tacticalDeckSummary.totalCards} kartu (maks. ${item.tacticalDeckSummary.maxHandSize} di tangan)`
                  : "Nonaktif"}{" "}
                · Tantangan: {item.challengePrimitives.map(claimPrimitiveLabel).join(", ")}
              </small>
            </p>
            <div class="rb-badges">
              {item.zones.map((z) => (
                <span key={z.id} class="rb-badge">
                  {z.label} · {z.name} ({z.landmarkCount})
                </span>
              ))}
            </div>
            <div class="rb-actions">
              {item.priceIdr === 0 ? (
                <button
                  type="button"
                  class="primary"
                  data-action="start-free"
                  data-pack={item.packId}
                  data-version={item.version}
                  disabled={busy}
                  onClick={() => onStartFree(item.packId, item.version)}
                >
                  Buat Ruang Gratis
                </button>
              ) : owned ? (
                ent?.activeRoomCode ? (
                  <button
                    type="button"
                    class="primary"
                    data-action="resume-owned"
                    data-room={ent.activeRoomCode}
                    disabled={busy}
                    onClick={() => onResumeOwned(ent.activeRoomCode!)}
                  >
                    Lanjutkan Ruang ({ent.activeRoomCode})
                  </button>
                ) : (
                  <button
                    type="button"
                    class="primary"
                    data-action="start-owned"
                    data-pack={item.packId}
                    data-version={item.version}
                    disabled={busy}
                    onClick={() => onStartOwned(item.packId, item.version)}
                  >
                    Buat Ruang (Dimiliki)
                  </button>
                )
              ) : allowSandboxCheckout ? (
                <button
                  type="button"
                  class="primary"
                  data-action="buy-pack"
                  data-pack={item.packId}
                  data-version={item.version}
                  disabled={busy}
                  onClick={() => onBuyPack(item.packId, item.version)}
                >
                  Beli Paket ({idr(item.priceIdr)} · Uji Pembayaran)
                </button>
              ) : (
                <p>Edisi berbayar belum tersedia pada uji publik ini.</p>
              )}
            </div>
          </article>
        );
      })}

      {activeOrderId && (
        <div class="rb-card">
          <h3>Pembayaran Uji Midtrans</h3>
          <p>
            Order <code>{activeOrderId}</code> menunggu verifikasi pelunasan.
          </p>
          <button
            type="button"
            class="primary"
            data-action="settle-order"
            data-order={activeOrderId}
            disabled={busy}
            onClick={() => onSettleOrder(activeOrderId)}
          >
            Simulasikan Pelunasan Midtrans
          </button>
        </div>
      )}
    </section>
  );
}
