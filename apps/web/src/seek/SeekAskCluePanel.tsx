import { attachPress } from "../game-motion";
import { useLayoutEffect, useRef } from "preact/hooks";
import type { HideSeekQuestionFamily, SeekEngineMenuEntry } from "@kelana-ria/contracts";
import type { Signal } from "@preact/signals";
import { haversineMeters } from "../live-location";
import { SeekDeadline, SeekQuestionArt, SeekSlotAlert } from "./SeekShared";
import {
  questionDescriptions,
  questionNames,
  rewardLabel,
  roomPoints,
  type CapturedLocation,
  type DraftPreviewState,
  type QuestionDraft,
  type SeekInlineError,
  type SeekRoomPayload,
} from "./types";

/**
 * Leaf subscriber for map preview freshness and the submit button so 1-second clock
 * expiry checks never re-render #sg-radius or wipe the player's draft input.
 */
function SeekDraftPreviewAndSubmit({
  payload,
  family,
  selected,
  blocked,
  thermometer,
  busy,
  mapFailed,
  draft,
  activePreview,
  previewLoadingKey,
  previewError,
  clockNowSig,
  onFocusPreview,
  onRefreshPreview,
  onStartThermometer,
  onMarkThermometerEnd,
  onAskClue,
}: {
  payload: SeekRoomPayload;
  family: HideSeekQuestionFamily;
  selected: SeekEngineMenuEntry | undefined;
  blocked: boolean;
  thermometer: { started: boolean; distance?: number } | undefined;
  busy: boolean;
  mapFailed: boolean;
  draft: QuestionDraft | undefined;
  activePreview: DraftPreviewState | undefined;
  previewLoadingKey: string;
  previewError: { key: string; message: string } | undefined;
  clockNowSig: Signal<number>;
  onFocusPreview: () => void;
  onRefreshPreview: () => void;
  onStartThermometer: () => void;
  onMarkThermometerEnd: () => void;
  onAskClue: (family: HideSeekQuestionFamily, itemId: string) => void;
}) {
  const isMapQuestion = family !== "photo" && family !== "thermometer";
  const now = clockNowSig.value;
  const previewFresh =
    activePreview !== undefined &&
    (activePreview.validUntil === undefined || now <= activePreview.validUntil);
  const previewReady = isMapQuestion ? Boolean(draft && activePreview && previewFresh) : true;
  const startThermometer = Boolean(thermometer && !thermometer.started);
  const canSend =
    !blocked &&
    !busy &&
    Boolean(selected?.availableInCurrentPhase) &&
    (!thermometer || (thermometer.distance ?? 0) >= (selected?.minTravelMeters ?? Infinity)) &&
    previewReady;

  const meters = (value: number) => `${Math.round(value).toLocaleString("id-ID")} m`;
  const data = activePreview?.data;
  const nearby = data?.targets?.map((target) => target.name).join(" / ");
  const referenceName =
    data &&
    roomPoints(payload).find(
      (point) =>
        point.latitude === data.reference.latitude && point.longitude === data.reference.longitude,
    )?.name;

  const previewStatus = !draft
    ? ""
    : previewLoadingKey === draft.key
      ? "Menyiapkan pratinjau…"
      : previewError?.key === draft.key
        ? previewError.message
        : activePreview && !previewFresh
          ? "Lokasi pratinjau kedaluwarsa. Perbarui lokasi."
          : data
            ? [
                "Pratinjau",
                ...(data.radiusMeters !== undefined
                  ? [`Radius ${meters(data.radiusMeters)}`, referenceName ?? "Titik GPS"]
                  : []),
                ...(data.station ? [data.station.name] : []),
                ...(data.distanceMeters !== undefined && nearby
                  ? [`${nearby} · ${meters(data.distanceMeters)}`]
                  : data.targets
                    ? [`${data.targets.length} titik tujuan`]
                    : []),
              ].join(" · ")
            : "Siapkan lokasi untuk pratinjau.";

  return (
    <>
      {isMapQuestion && draft && (
        <div class="sg-preview">
          <p id="sg-preview-status" role="status">
            {previewStatus}
          </p>
          <div class="rb-actions">
            {data && !mapFailed && (
              <button
                type="button"
                class="sg-quiet"
                data-action="focus-preview"
                onClick={onFocusPreview}
              >
                Fokus peta
              </button>
            )}
            <button
              type="button"
              class="sg-quiet"
              data-action="refresh-preview"
              disabled={previewLoadingKey === draft.key || busy}
              onClick={onRefreshPreview}
            >
              Perbarui lokasi
            </button>
          </div>
        </div>
      )}

      {selected && (
        <p class="sg-reward-note">
          {rewardLabel(selected.drawBatches)}
          {selected.nextRepeatMultiplier > 1 ? ` · ${selected.nextRepeatMultiplier}× biaya` : ""}
        </p>
      )}

      {thermometer && (
        <button
          type="button"
          class={startThermometer ? "sg-main" : "sg-pick"}
          data-action={startThermometer ? "start-thermometer" : "mark-thermometer-end"}
          disabled={busy || blocked || !selected}
          onClick={startThermometer ? onStartThermometer : onMarkThermometerEnd}
        >
          {startThermometer ? "Tandai titik A" : "Tandai titik B"}
        </button>
      )}

      {!startThermometer && (
        <button
          type="button"
          class="sg-main"
          data-action="ask-clue"
          data-family={family}
          data-item={selected?.itemId ?? ""}
          data-preview-until={
            isMapQuestion && activePreview?.validUntil !== undefined
              ? String(activePreview.validUntil)
              : undefined
          }
          disabled={!canSend}
          onClick={() => onAskClue(family, selected?.itemId ?? "")}
        >
          Kirim pertanyaan
        </button>
      )}
    </>
  );
}

export function SeekAskCluePanel({
  payload,
  family,
  option,
  thermometerEnd,
  radiusDraftSig,
  draft,
  activePreview,
  previewLoadingKey,
  previewError,
  inlineError,
  busy,
  mapFailed,
  clockNowSig,
  onSelectFamily,
  onBackToDeck,
  onSelectOption,
  onRadiusInput,
  onFocusPreview,
  onRefreshPreview,
  onStartThermometer,
  onMarkThermometerEnd,
  onAskClue,
}: {
  payload: SeekRoomPayload;
  family: HideSeekQuestionFamily | null;
  option: string;
  thermometerEnd: CapturedLocation | undefined;
  radiusDraftSig: Signal<string>;
  draft: QuestionDraft | undefined;
  activePreview: DraftPreviewState | undefined;
  previewLoadingKey: string;
  previewError: { key: string; message: string } | undefined;
  inlineError: SeekInlineError;
  busy: boolean;
  mapFailed: boolean;
  clockNowSig: Signal<number>;
  onSelectFamily: (nextFamily: HideSeekQuestionFamily) => void;
  onBackToDeck: () => void;
  onSelectOption: (itemId: string) => void;
  onRadiusInput: (value: string) => void;
  onFocusPreview: () => void;
  onRefreshPreview: () => void;
  onStartThermometer: () => void;
  onMarkThermometerEnd: () => void;
  onAskClue: (family: HideSeekQuestionFamily, itemId: string) => void;
}) {
  const { room, deck } = payload;
  const pending = room.questions.find((q) => q.status === "pending");

  if (room.phase === "head_start") {
    return (
      <h2 id="sg-panel-title" tabIndex={-1}>
        Tunggu waktu sembunyi
      </h2>
    );
  }

  if (pending) {
    return (
      <>
        <h2 id="sg-panel-title" tabIndex={-1}>
          Menunggu jawaban
        </h2>
        <p>
          {pending.label} ·{" "}
          <SeekDeadline deadline={pending.deadline} clockNowSig={clockNowSig} />
        </p>
      </>
    );
  }

  if (!family) {
    const families = (Object.keys(questionNames) as HideSeekQuestionFamily[]).filter((f) =>
      room.menu.some((entry) => entry.family === f),
    );
    return (
      <>
        <h2 id="sg-panel-title" tabIndex={-1}>
          Pilih petunjuk
        </h2>
        <div class="sg-question-grid">
          {families.map((f) => {
            const options = room.menu.filter((entry) => entry.family === f);
            const available = options.find(
              (entry) => entry.availableInCurrentPhase && !entry.lockedSingleUse,
            );
            const allUsed = options.every((entry) => entry.lockedSingleUse);
            const detail = allUsed ? "Semua sudah dipakai" : "Lihat pilihan";
            return (
              <SeekFamilyCard
                key={f}
                family={f}
                busy={busy}
                detail={available ? rewardLabel(available.drawBatches) : detail}
                onSelect={() => onSelectFamily(f)}
              />
            );
          })}
        </div>
      </>
    );
  }

  const entries = room.menu.filter((entry) => entry.family === family);
  const selected = entries.find((entry) => entry.itemId === option && !entry.lockedSingleUse);
  const blocked = deck.questionsBlocked || deck.bannedFamilies.includes(family);
  const thermometer =
    family === "thermometer"
      ? {
          started: room.thermometerStart !== null,
          distance:
            room.thermometerStart && thermometerEnd
              ? haversineMeters(room.thermometerStart, thermometerEnd)
              : undefined,
        }
      : undefined;

  return (
    <>
      <div class="sg-detail-title">
        <SeekQuestionArt family={family} />
        <div>
          <h2 id="sg-panel-title" tabIndex={-1}>
            {questionNames[family]}
          </h2>
          <p>{questionDescriptions[family]}</p>
        </div>
        <button
          type="button"
          class="sg-quiet"
          data-action="question-deck"
          disabled={busy}
          onClick={onBackToDeck}
        >
          Semua kartu
        </button>
      </div>

      <div class="sg-picks" role="group" aria-label="Pilihan petunjuk">
        {entries.map((entry) => {
          const disabled = !entry.availableInCurrentPhase || entry.lockedSingleUse;
          return (
            <button
              key={entry.itemId}
              type="button"
              class={entry.lockedSingleUse ? "sg-pick sg-pick--used" : "sg-pick"}
              data-action="question-option"
              data-item={entry.itemId}
              aria-pressed={selected?.itemId === entry.itemId ? "true" : "false"}
              disabled={disabled || busy}
              onClick={() => onSelectOption(entry.itemId)}
            >
              <span>{entry.isCustomRadius ? "Radius sendiri" : entry.label}</span>
              {entry.lockedSingleUse && <small class="sg-pick-status">Sudah dipakai</small>}
            </button>
          );
        })}
      </div>

      {thermometer && (
        <p>
          {thermometer.started
            ? thermometer.distance === undefined
              ? "Titik A tersimpan. Berpindah, lalu tandai titik B."
              : `A → B · ${Math.round(thermometer.distance)} m garis lurus`
            : "Tandai titik A. Bergerak sesuai jarak minimum, lalu tandai titik B."}
          {selected?.minTravelMeters ? ` Minimum ${selected.minTravelMeters} m.` : ""}
        </p>
      )}

      {selected?.prompt && <p>{selected.prompt}</p>}

      {selected?.isCustomRadius && (
        <label class="rb-field">
          Radius (meter)
          <input
            id="sg-radius"
            type="number"
            min="1"
            inputMode="numeric"
            required
            value={radiusDraftSig.value}
            onInput={(event) => onRadiusInput(event.currentTarget.value)}
          />
        </label>
      )}

      <SeekDraftPreviewAndSubmit
        payload={payload}
        family={family}
        selected={selected}
        blocked={blocked}
        thermometer={thermometer}
        busy={busy}
        mapFailed={mapFailed}
        draft={draft}
        activePreview={activePreview}
        previewLoadingKey={previewLoadingKey}
        previewError={previewError}
        clockNowSig={clockNowSig}
        onFocusPreview={onFocusPreview}
        onRefreshPreview={onRefreshPreview}
        onStartThermometer={onStartThermometer}
        onMarkThermometerEnd={onMarkThermometerEnd}
        onAskClue={onAskClue}
      />

      <SeekSlotAlert error={inlineError} slot="ask-field" />
    </>
  );
}

function SeekFamilyCard({ family, busy, detail, onSelect }: {
  family: HideSeekQuestionFamily;
  busy: boolean;
  detail: string;
  onSelect: () => void;
}) {
  const button = useRef<HTMLButtonElement>(null);
  useLayoutEffect(() => attachPress(button.current), []);
  return (
    <button ref={button} type="button" class="sg-question-card" data-action="question-family"
      data-family={family} disabled={busy} onClick={onSelect}>
      <SeekQuestionArt family={family} />
      <span class="sg-question-text">
        <strong>{questionNames[family]}</strong>
        <small>{detail}</small>
      </span>
    </button>
  );
}
