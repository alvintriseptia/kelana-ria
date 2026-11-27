import type { Signal } from "@preact/signals";
import { useRef } from "preact/hooks";
import { formatRelativeAge, freshnessBucket } from "../room-activity";
import { DraftStudioLink } from "../ui/DraftStudioLink";
import { InlineAlert } from "../ui/InlineAlert";
import {
  clockLabel,
  destructiveExitSpec,
  isDraftPlaytest,
  isQaRoom,
  type ClaimInlineError,
  type ClaimInlineSlot,
  type ClaimRoomPayload,
} from "./types";

export function ClaimSlotAlert({
  error,
  slot,
  targetId,
}: {
  error: ClaimInlineError;
  slot: ClaimInlineSlot;
  targetId?: string;
}) {
  if (!error || error.slot !== slot) return null;
  if (targetId !== undefined && error.targetId !== undefined && error.targetId !== targetId) {
    return null;
  }
  return <InlineAlert message={error.message} tone={error.tone} errorSlot={slot} />;
}

/**
 * Leaf signal subscriber for live countdown clocks so 250ms ticks never re-render
 * parent challenge forms or sheets.
 */
export function ClaimCountdown({
  deadline,
  clockNowSig,
  as = "strong",
}: {
  deadline: number;
  clockNowSig: Signal<number>;
  as?: "strong" | "span";
}) {
  const label = clockLabel(deadline - clockNowSig.value);
  if (as === "span") {
    return <span data-cg-countdown={String(deadline)}>{label}</span>;
  }
  return <strong data-cg-countdown={String(deadline)}>{label}</strong>;
}

/**
 * Leaf signal subscriber for live relative age timestamps & rival freshness buckets.
 */
export function ClaimRelativeAge({
  at,
  clockNowSig,
  stalePrefix = false,
  className,
  activityTime = false,
}: {
  at: number;
  clockNowSig: Signal<number>;
  stalePrefix?: boolean;
  className?: string;
  activityTime?: boolean;
}) {
  const now = clockNowSig.value;
  if (activityTime) {
    return (
      <time class={className ?? "room-activity-age"} data-activity-at={String(at)}>
        {formatRelativeAge(at, now)}
      </time>
    );
  }
  const bucket = freshnessBucket(at, now);
  return (
    <span
      class={className}
      data-cg-age-at={String(at)}
      data-cg-age-stale={stalePrefix ? "1" : undefined}
      data-freshness={bucket}
    >
      {formatRelativeAge(at, now, stalePrefix)}
    </span>
  );
}

export function LearningExplanation({ text }: { text: string }) {
  return (
    <aside class="rb-card" aria-label="Fakta lokasi">
      <strong>Fakta lokasi</strong>
      <p>{text}</p>
    </aside>
  );
}

export function ClaimDraftBar({
  payload,
  qaLocationId,
  busy,
  onSelectQaLocation,
  onAdvanceQaClock,
}: {
  payload: ClaimRoomPayload;
  qaLocationId: string;
  busy: boolean;
  onSelectQaLocation: (nextId: string) => void;
  onAdvanceQaClock: (step: "minute" | "five-minutes" | "phase-end") => void;
}) {
  if (!isQaRoom(payload)) return null;
  const isDraft = isDraftPlaytest(payload);
  const isActive = payload.room.phase === "active" && !payload.room.outcome;
  const ownSeat = payload.room.seats.find((s) => s.seatId === payload.room.seatId);
  const isHost = Boolean(ownSeat?.isHost);

  return (
    <section class="cg-draft-bar" data-testid="draft-playtest-bar" aria-label="Kontrol Uji Draf">
      <div class="cg-draft-bar-head">
        {isDraft ? (
          <span class="rb-badge sg-qa-badge" data-testid="draft-playtest-badge">
            Uji Draf
          </span>
        ) : (
          <span class="rb-badge sg-qa-badge">Mode QA</span>
        )}
        {isDraft && <DraftStudioLink format={payload.format} pass={payload.pass} />}
      </div>
      <label class="cg-qa-loc-field">
        <span>Simulasi GPS</span>
        <select
          id="claim-qa-location"
          data-testid="claim-qa-location"
          value={qaLocationId}
          onChange={(event) => onSelectQaLocation(event.currentTarget.value)}
        >
          <option value="">Otomatis di target check-in</option>
          <option value={payload.publicBoard.startPoint.id}>
            Titik Awal · {payload.publicBoard.startPoint.name}
          </option>
          {payload.publicBoard.landmarks.map((lm) => (
            <option key={lm.id} value={lm.id}>
              Landmark · {lm.name}
            </option>
          ))}
        </select>
      </label>
      {isActive && isHost && (
        <div class="cg-qa-clock-row">
          <button
            type="button"
            class="secondary"
            data-action="claim-qa-advance"
            data-step="minute"
            disabled={busy}
            onClick={() => onAdvanceQaClock("minute")}
          >
            +1 menit
          </button>
          <button
            type="button"
            class="secondary"
            data-action="claim-qa-advance"
            data-step="five-minutes"
            disabled={busy}
            onClick={() => onAdvanceQaClock("five-minutes")}
          >
            +5 menit
          </button>
          <button
            type="button"
            class="secondary"
            data-action="claim-qa-advance"
            data-step="phase-end"
            disabled={busy}
            onClick={() => onAdvanceQaClock("phase-end")}
          >
            Akhiri Ronde
          </button>
        </div>
      )}
    </section>
  );
}

export function ClaimMoreMenu({
  payload,
  wakeLockSupported,
  wakeLockWanted,
  busy,
  onOpenQuickGuide,
  onOpenActivity,
  onToggleWakeLock,
  onRefresh,
  onNavigateCatalog,
  onConfirmLeave,
}: {
  payload: ClaimRoomPayload;
  wakeLockSupported: boolean;
  wakeLockWanted: boolean;
  busy: boolean;
  onOpenQuickGuide: () => void;
  onOpenActivity: () => void;
  onToggleWakeLock: () => void;
  onRefresh: () => void;
  onNavigateCatalog: () => void;
  onConfirmLeave: () => void;
}) {
  const detailsRef = useRef<HTMLDetailsElement | null>(null);
  const exitSpec = destructiveExitSpec(payload);
  const closeMenu = () => {
    detailsRef.current?.removeAttribute("open");
  };

  return (
    <details ref={detailsRef} class="sg-room-menu">
      <summary class="sg-quiet" aria-label="Lainnya">
        ⋯
      </summary>
      <div class="sg-room-menu-actions">
        {isDraftPlaytest(payload) && (
          <DraftStudioLink format={payload.format} pass={payload.pass} menu />
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
        <button
          type="button"
          data-action="panel"
          data-panel="activity"
          disabled={busy}
          onClick={() => {
            closeMenu();
            onOpenActivity();
          }}
        >
          Aktivitas terbaru
        </button>
        {wakeLockSupported && (
          <button
            type="button"
            data-action="toggle-wakelock"
            aria-pressed={wakeLockWanted}
            disabled={busy}
            onClick={() => {
              closeMenu();
              onToggleWakeLock();
            }}
          >
            Layar tetap menyala: {wakeLockWanted ? "Aktif" : "Nonaktif"}
          </button>
        )}
        <button
          type="button"
          data-action="refresh"
          disabled={busy}
          onClick={() => {
            closeMenu();
            onRefresh();
          }}
        >
          Muat Ulang Ruang
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
