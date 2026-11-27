import type { HideSeekQuestionFamily, SeekCardInstance } from "@kelana-ria/contracts";
import type { Signal } from "@preact/signals";
import { useEffect, useRef } from "preact/hooks";
import { formatRelativeAge, freshnessBucket } from "../room-activity";
import { InlineAlert } from "../ui/InlineAlert";
import {
  cardCategoryLabels,
  clockText,
  curseBlockerLabel,
  curseClearLabel,
  destructiveExitSpec,
  draftStudioUrl,
  isBoardPhase,
  isDraftPlaytest,
  qaPoint,
  roomPoints,
  type SeekInlineError,
  type SeekInlineSlot,
  type SeekRoomPayload,
} from "./types";

export function SeekSlotAlert({
  error,
  slot,
  targetId,
}: {
  error: SeekInlineError;
  slot: SeekInlineSlot;
  targetId?: string;
}) {
  if (!error || error.slot !== slot) return null;
  if (targetId !== undefined && error.targetId !== undefined && error.targetId !== targetId) {
    return null;
  }
  return <InlineAlert message={error.message} tone={error.tone} errorSlot={slot} />;
}

/**
 * Leaf signal subscriber for live countdown clocks so 1-second ticks never
 * re-render parent clue forms, sheets, or keyed cards.
 */
export function SeekDeadline({
  deadline,
  clockNowSig,
  className,
  ariaLabel,
}: {
  deadline: number;
  clockNowSig: Signal<number>;
  className?: string;
  ariaLabel?: string;
}) {
  return (
    <span
      class={className}
      aria-label={ariaLabel}
      data-deadline={String(deadline)}
    >
      {clockText(deadline - clockNowSig.value)}
    </span>
  );
}

/**
 * Leaf signal subscriber for relative activity timestamps and seeker position freshness.
 */
export function SeekRelativeAge({
  at,
  clockNowSig,
  activityTime = false,
  id,
  stalePrefix = false,
}: {
  at: number;
  clockNowSig: Signal<number>;
  activityTime?: boolean;
  id?: string;
  stalePrefix?: boolean;
}) {
  const now = clockNowSig.value;
  if (activityTime) {
    return (
      <time class="room-activity-age" data-activity-at={String(at)}>
        {formatRelativeAge(at, now)}
      </time>
    );
  }
  const bucket = freshnessBucket(at, now);
  return (
    <span id={id} data-freshness={bucket}>
      {formatRelativeAge(at, now, stalePrefix)}
    </span>
  );
}

export function SeekQuestionArt({ family }: { family: HideSeekQuestionFamily }) {
  return <span aria-hidden="true" class={`sg-art sg-art-${family}`} />;
}

export function SeekRewardCard({
  card,
  action,
  selected = false,
  disabled = false,
  primitive,
  onClick,
}: {
  card: SeekCardInstance;
  action?: "choose-draw" | "play-card";
  selected?: boolean;
  disabled?: boolean;
  primitive?: string;
  onClick?: () => void;
}) {
  const kind =
    card.effect.primitive === "discard_draw" || card.effect.primitive === "duplicate"
      ? "swap"
      : card.category;

  const content = (
    <>
      <span class={`sg-reward-art sg-reward-${kind}`} aria-hidden="true" />
      <span class="sg-reward-copy">
        <small>{cardCategoryLabels[card.category]}</small>
        <strong>{card.title}</strong>
        <span>{card.description}</span>
      </span>
    </>
  );

  if (action) {
    return (
      <button
        type="button"
        class="sg-reward-card"
        data-action={action}
        data-instance={card.instanceId}
        data-primitive={primitive}
        aria-pressed={selected ? "true" : "false"}
        disabled={disabled}
        onClick={onClick}
      >
        {content}
      </button>
    );
  }

  return <article class="sg-reward-card">{content}</article>;
}

export function SeekRoomMenu({
  payload,
  busy,
  onOpenQuickGuide,
  onOpenActivity,
  onRefresh,
  onNavigateCatalog,
  onConfirmLeave,
}: {
  payload: SeekRoomPayload;
  busy: boolean;
  onOpenQuickGuide: () => void;
  onOpenActivity: () => void;
  onRefresh: () => void;
  onNavigateCatalog: () => void;
  onConfirmLeave: () => void;
}) {
  const detailsRef = useRef<HTMLDetailsElement | null>(null);
  const exitSpec = destructiveExitSpec(payload);
  const isDraft = isDraftPlaytest(payload);
  const board = isBoardPhase(payload.room);

  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      const menu = detailsRef.current;
      if (menu?.open && event.target instanceof Node && !menu.contains(event.target)) {
        menu.open = false;
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      const menu = detailsRef.current;
      if (!menu?.open) return;
      menu.open = false;
      menu.querySelector("summary")?.focus({ preventScroll: true });
      event.preventDefault();
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, []);

  const closeMenu = (focusSummary = false) => {
    const menu = detailsRef.current;
    if (!menu) return;
    menu.open = false;
    if (focusSummary) {
      menu.querySelector("summary")?.focus({ preventScroll: true });
    }
  };

  return (
    <details ref={detailsRef} class="sg-room-menu">
      <summary class="sg-quiet" aria-label="Menu permainan" title="Menu permainan">
        <span aria-hidden="true">⋯</span>
      </summary>
      <div class="sg-room-menu-actions">
        {isDraft && (
          <a
            class="cg-menu-link"
            data-testid="menu-back-to-studio"
            href={draftStudioUrl(payload.pass)}
          >
            ← Kembali ke Studio
          </a>
        )}
        <button
          type="button"
          data-action="open-quick-guide"
          data-testid="menu-quick-guide-btn"
          disabled={busy}
          onClick={() => {
            closeMenu();
            onOpenQuickGuide();
          }}
        >
          ? Panduan
        </button>
        {board && (
          <button
            type="button"
            data-action="game-panel"
            data-panel="activity"
            disabled={busy}
            onClick={() => {
              closeMenu();
              onOpenActivity();
            }}
          >
            Aktivitas terbaru
          </button>
        )}
        <button
          type="button"
          data-action="refresh"
          disabled={busy}
          onClick={() => {
            closeMenu(true);
            onRefresh();
          }}
        >
          Muat ulang
        </button>
        <button
          type="button"
          data-nav="catalog"
          disabled={busy}
          onClick={() => {
            closeMenu();
            onNavigateCatalog();
          }}
        >
          Kembali ke Katalog
        </button>
        {exitSpec && (
          <button
            type="button"
            class="lobby-danger-btn"
            data-action="confirm-leave"
            data-testid="menu-leave-btn"
            disabled={busy}
            onClick={() => {
              closeMenu();
              onConfirmLeave();
            }}
          >
            {exitSpec.label}
          </button>
        )}
      </div>
    </details>
  );
}

export function SeekQaPanel({
  payload,
  qaStationId,
  busy,
  onSelectQaLocation,
  onAdvanceClock,
}: {
  payload: SeekRoomPayload;
  qaStationId: string;
  busy: boolean;
  onSelectQaLocation: (stationId: string) => void;
  onAdvanceClock: (step: "minute" | "five-minutes" | "phase-end") => void;
}) {
  const { room } = payload;
  const host = room.seats.some((seat) => seat.seatId === room.seatId && seat.isHost);
  const point = qaPoint(payload, qaStationId);
  const points = roomPoints(payload);

  return (
    <>
      <h2 id="sg-panel-title" tabIndex={-1}>
        Mode QA
      </h2>
      <label class="rb-field">
        Lokasi simulasi kamu
        <select
          id="sg-qa-location"
          value={point.id}
          disabled={busy}
          onChange={(event) => onSelectQaLocation(event.currentTarget.value)}
        >
          {points.map((location) => (
            <option key={location.id} value={location.id}>
              {location.name}
            </option>
          ))}
        </select>
      </label>
      <p class="sg-qa-note">
        Aksi berbasis GPS memakai lokasi ini sampai kamu memilih titik lain.
      </p>
      {host && room.phaseEndsAt !== null ? (
        <div class="sg-qa-clock">
          <p>Majukan waktu untuk semua pemain di ruang ini</p>
          <div class="rb-actions">
            <button
              type="button"
              class="sg-pick"
              data-action="qa-advance"
              data-step="minute"
              disabled={busy}
              onClick={() => onAdvanceClock("minute")}
            >
              +1 menit
            </button>
            <button
              type="button"
              class="sg-pick"
              data-action="qa-advance"
              data-step="five-minutes"
              disabled={busy}
              onClick={() => onAdvanceClock("five-minutes")}
            >
              +5 menit
            </button>
            <button
              type="button"
              class="sg-pick"
              data-action="qa-advance"
              data-step="phase-end"
              disabled={busy}
              onClick={() => onAdvanceClock("phase-end")}
            >
              Akhir fase
            </button>
          </div>
        </div>
      ) : !host ? (
        <p class="sg-qa-note">Host mengatur waktu ruang.</p>
      ) : null}
    </>
  );
}

export function SeekCursesCard({
  payload,
  inlineError,
  busy,
  onClearGps,
  onSubmitPhoto,
  onClearHonor,
  onBuyout,
  onReviewPhoto,
}: {
  payload: SeekRoomPayload;
  inlineError: SeekInlineError;
  busy: boolean;
  onClearGps: (curseId: string) => void;
  onSubmitPhoto: (curseId: string) => void;
  onClearHonor: (curseId: string) => void;
  onBuyout: (curseId: string) => void;
  onReviewPhoto: (curseId: string, approve: boolean) => void;
}) {
  const { room, deck } = payload;
  if (deck.activeCurses.length === 0) return null;
  const isHider = room.role === "hider";

  return (
    <div class="rb-card">
      <h3>Kutukan Aktif ({deck.activeCurses.length})</h3>
      <ul class="rb-list">
        {deck.activeCurses.map((c) => {
          const penalty = c.effectModifiers.find((m) => m.type === "skip_penalty_minutes");
          const autoApproveSec = c.pendingPhoto
            ? Math.max(0, Math.ceil((c.pendingPhoto.autoApproveAt - room.now) / 1000))
            : null;
          return (
            <li key={c.curseInstanceId}>
              <span class="rb-badge rb-badge-danger">{c.title}</span>
              <p>{c.description}</p>
              <small>
                {curseBlockerLabel(c.blockerType)} · Cara lepas:{" "}
                {curseClearLabel(c.clearCondition.type)}
              </small>
              {c.pendingPhoto && (
                <p>
                  <small>
                    Foto bukti terkirim · Otomatis disetujui dalam {autoApproveSec} dtk
                  </small>
                </p>
              )}
              <SeekSlotAlert
                error={inlineError}
                slot="curse-action"
                targetId={c.curseInstanceId}
              />
              <div class="rb-actions">
                {!isHider && c.clearCondition.type === "gps_detour" && (
                  <button
                    type="button"
                    class="primary"
                    data-action="clear-curse-gps"
                    data-curse={c.curseInstanceId}
                    disabled={busy}
                    onClick={() => onClearGps(c.curseInstanceId)}
                  >
                    Check-in Lokasi
                  </button>
                )}
                {!isHider && c.clearCondition.type === "photo_challenge" && !c.pendingPhoto && (
                  <button
                    type="button"
                    class="primary"
                    data-action="submit-curse-photo"
                    data-curse={c.curseInstanceId}
                    disabled={busy}
                    onClick={() => onSubmitPhoto(c.curseInstanceId)}
                  >
                    Kirim Foto Bukti
                  </button>
                )}
                {!isHider && c.clearCondition.type === "honor_task" && (
                  <button
                    type="button"
                    class="primary"
                    data-action="clear-curse-honor"
                    data-curse={c.curseInstanceId}
                    disabled={busy}
                    onClick={() => onClearHonor(c.curseInstanceId)}
                  >
                    Selesaikan Tugas
                  </button>
                )}
                {!isHider && penalty && penalty.type === "skip_penalty_minutes" && (
                  <button
                    type="button"
                    class="secondary"
                    data-action="buyout-curse"
                    data-curse={c.curseInstanceId}
                    disabled={busy}
                    onClick={() => onBuyout(c.curseInstanceId)}
                  >
                    Lewati (+{penalty.penaltyMinutes} mnt)
                  </button>
                )}
                {isHider && c.pendingPhoto && (
                  <>
                    <button
                      type="button"
                      class="primary"
                      data-action="review-curse-photo"
                      data-curse={c.curseInstanceId}
                      data-approve="true"
                      disabled={busy}
                      onClick={() => onReviewPhoto(c.curseInstanceId, true)}
                    >
                      Setujui Foto
                    </button>
                    <button
                      type="button"
                      class="secondary"
                      data-action="review-curse-photo"
                      data-curse={c.curseInstanceId}
                      data-approve="false"
                      disabled={busy}
                      onClick={() => onReviewPhoto(c.curseInstanceId, false)}
                    >
                      Tolak Foto
                    </button>
                  </>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
