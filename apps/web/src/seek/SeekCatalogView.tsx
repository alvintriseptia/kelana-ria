import type { HideSeekQuestionFamily, RulebookEntitlementSummary } from "@kelana-ria/contracts";
import type { Signal } from "@preact/signals";
import { SeekSlotAlert } from "./SeekShared";
import { idr, questionNames, type SeekInlineError, type SeekPublicListing } from "./types";

export function SeekCatalogView({
  listings,
  ownedPackIds,
  entitlements,
  allowHideSeekQa,
  allowSandboxCheckout,
  activeOrderId,
  statusMsg,
  inlineError,
  busy,
  joinCodeSig,
  joinNameSig,
  onJoinNameEdited,
  onJoinRoom,
  onStartFree,
  onStartOwned,
  onStartQa,
  onResumeOwned,
  onBuyPack,
  onSettleOrder,
  onOpenStudio,
  onBack,
}: {
  listings: SeekPublicListing[];
  ownedPackIds: string[];
  entitlements: RulebookEntitlementSummary[];
  allowHideSeekQa: boolean;
  allowSandboxCheckout: boolean;
  activeOrderId: string | null;
  statusMsg: string;
  inlineError: SeekInlineError;
  busy: boolean;
  joinCodeSig: Signal<string>;
  joinNameSig: Signal<string>;
  onJoinNameEdited: () => void;
  onJoinRoom: () => void;
  onStartFree: (packId: string, version: number) => void;
  onStartOwned: (packId: string, version: number) => void;
  onStartQa: (packId: string, version: number) => void;
  onResumeOwned: (roomCode: string) => void;
  onBuyPack: (packId: string, version: number) => void;
  onSettleOrder: (orderId: string) => void;
  onOpenStudio: () => void;
  onBack: () => void;
}) {
  return (
    <section class="rb-shell" aria-label="Katalog Hide & Seek">
      <div class="rb-card">
        <h2>Hide &amp; Seek (2–6 Pemain)</h2>
        <p>
          Pilih edisi resmi gratis atau paket buatan komunitas. Sembunyi di stasiun, kumpulkan
          petunjuk, dan mainkan kartu.
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
        <SeekSlotAlert error={inlineError} slot="catalog" />
      </div>

      <div class="rb-card">
        <h3>Gabung Ruang dengan Kode Undangan</h3>
        <div class="rb-grid-2">
          <label class="rb-field">
            <span>Kode Ruang</span>
            <input
              id="rb-join-code"
              placeholder="RB-XXXXXX"
              value={joinCodeSig.value}
              onInput={(event) => {
                joinCodeSig.value = event.currentTarget.value;
              }}
            />
          </label>
          <label class="rb-field">
            <span>Nama Pemain</span>
            <input
              id="rb-join-name"
              value={joinNameSig.value}
              onInput={(event) => {
                joinNameSig.value = event.currentTarget.value;
                onJoinNameEdited();
              }}
            />
          </label>
        </div>
        <SeekSlotAlert error={inlineError} slot="join" />
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
                <span class={`rb-badge${item.priceIdr > 0 ? " rb-badge-paid" : ""}`}>
                  {idr(item.priceIdr)}
                </span>
              )}
              <span class="rb-badge">{item.cityLabel}</span>
              <span class="rb-badge">
                {item.minPlayers}–{item.maxPlayers} pemain
              </span>
              <span class="rb-badge">Zona {item.hidingZoneRadiusMeters} m</span>
              <span class="rb-badge">{item.stationCount} stasiun</span>
            </div>
            <h3>
              {item.title} <small>v{item.version}</small>
            </h3>
            <p>{item.summary}</p>
            <p>
              <small>
                Oleh {item.byline} · Mulai: {item.startName} · Sembunyi {item.headStartMinutes} mnt
                · Cari {item.searchLimitMinutes} mnt · Kumpul {item.regroupMinutes} mnt
              </small>
            </p>
            <p>
              <small>
                Dek: {item.deckSummary.totalCards} kartu ({item.deckSummary.timeBonuses} bonus,{" "}
                {item.deckSummary.powerups} powerup, {item.deckSummary.curses} kutukan · batas
                tangan {item.deckSummary.baseHandLimit})
              </small>
            </p>
            <div class="rb-badges">
              {item.questionFamilies.map((f) => (
                <span key={f.family} class="rb-badge">
                  {questionNames[f.family as HideSeekQuestionFamily] ?? f.family} ({f.itemCount} ·
                  Ambil {f.drawCount}/{f.keepCount})
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
            {allowHideSeekQa && item.priceIdr === 0 && (
              <button
                type="button"
                class="secondary"
                data-action="start-qa"
                data-pack={item.packId}
                data-version={item.version}
                disabled={busy}
                onClick={() => onStartQa(item.packId, item.version)}
              >
                Buat Ruang QA
              </button>
            )}
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
