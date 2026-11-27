import type {
  ClaimActiveAttemptView,
  ClaimEngineRoomView,
  ClaimSanitizedLeafChallenge,
  GeoCoordinate,
  LocationFix,
} from "@kelana-ria/contracts";
import type { Signal } from "@preact/signals";
import { useEffect, useRef, useState } from "preact/hooks";
import {
  evaluateCheckInProximity,
  formatDistanceShort,
  haversineMeters,
  type LiveLocationStatus,
} from "../live-location";
import type { PhotoDraftState } from "../photo-capture";
import { DirectionsLink, DistanceMeter } from "../ui/LocationWidgets";
import { PhotoCaptureWidget } from "../ui/PhotoCaptureWidget";
import {
  ClaimCountdown,
  ClaimRelativeAge,
  ClaimSlotAlert,
  LearningExplanation,
} from "./ClaimShared";
import {
  claimPrimitiveLabel,
  getActiveLeaf,
  landmarkStatus,
  teamName,
  zoneLabelFor,
  type ClaimInlineError,
  type ClaimRoomPayload,
} from "./types";

function ClaimProofImage({ roomCode, photoId }: { roomCode: string; photoId: string }) {
  return (
    <img
      class="cg-proof"
      alt="Foto bukti untuk ditinjau"
      src={`/api/rulebooks/rooms/${encodeURIComponent(roomCode)}/photos/${encodeURIComponent(photoId)}`}
    />
  );
}

export function ClaimLandmarkList({
  payload,
  selectedId,
  selfFix,
  liveLocationStatus,
  landmarkSort,
  targets = [],
  listLabel = "Pilih Landmark",
  busy,
  onSortChange,
  onEnableLocation,
  onSelectLandmark,
}: {
  payload: ClaimRoomPayload;
  selectedId: string;
  selfFix: LocationFix | null;
  liveLocationStatus: LiveLocationStatus;
  landmarkSort: "zone" | "nearest";
  targets?: string[];
  listLabel?: string;
  busy: boolean;
  onSortChange: (sort: "zone" | "nearest") => void;
  onEnableLocation: () => void;
  onSelectLandmark: (landmarkId: string) => void;
}) {
  const { room, publicBoard } = payload;
  const stateById = new Map(room.landmarks.map((item) => [item.landmarkId, item]));
  const zoneLabelById = new Map(room.zones.map((z) => [z.zoneId, z.label || z.name]));
  const distById = new Map<string, number>();
  if (selfFix) {
    for (const lm of publicBoard.landmarks) {
      distById.set(lm.id, Math.round(haversineMeters(selfFix, lm)));
    }
  }

  const renderRow = (lm: ClaimRoomPayload["publicBoard"]["landmarks"][number]) => {
    const state = stateById.get(lm.id);
    const dist = distById.get(lm.id);
    const zoneText = zoneLabelById.get(lm.zoneId) ?? lm.zoneId;
    return (
      <li key={lm.id} data-landmark-list-item={lm.id}>
        <button
          type="button"
          class="cg-landmark-row"
          data-action="select-landmark"
          data-landmark={lm.id}
          aria-pressed={lm.id === selectedId}
          disabled={busy}
          onClick={() => onSelectLandmark(lm.id)}
        >
          <span class="cg-landmark-row-main">
            <strong>{lm.name}</strong>
            <small>
              {targets.includes(lm.id) ? "Target · " : ""}
              {zoneText}
              {state ? ` · ${landmarkStatus(state)}` : ""}
            </small>
          </span>
          {dist !== undefined && (
            <span class="cg-landmark-dist-pill" data-landmark-distance={dist}>
              {formatDistanceShort(dist)}
            </span>
          )}
        </button>
      </li>
    );
  };

  const sortedNearest =
    landmarkSort === "nearest"
      ? [...publicBoard.landmarks].sort((a, b) => {
          const da = distById.get(a.id);
          const db = distById.get(b.id);
          if (da !== undefined && db !== undefined && da !== db) return da - db;
          return 0;
        })
      : [];

  return (
    <>
      <div class="cg-landmark-toolbar">
        <h2>{listLabel}</h2>
        <div class="cg-sort-pills" role="group" aria-label="Urutkan landmark">
          <button
            type="button"
            data-action="sort-landmarks"
            data-sort="zone"
            data-testid="claim-sort-zone"
            aria-pressed={landmarkSort === "zone"}
            disabled={busy}
            onClick={() => onSortChange("zone")}
          >
            Zona
          </button>
          <button
            type="button"
            data-action="sort-landmarks"
            data-sort="nearest"
            data-testid="claim-sort-nearest"
            aria-pressed={landmarkSort === "nearest"}
            disabled={busy}
            onClick={() => onSortChange("nearest")}
          >
            Terdekat
          </button>
        </div>
      </div>

      {landmarkSort === "nearest" ? (
        <>
          {!selfFix && liveLocationStatus !== "unavailable" && (
            <div class="cg-selected-meta-actions">
              {liveLocationStatus === "requesting" || liveLocationStatus === "watching" ? (
                <span class="loc-meter loc-meter--pending" role="status">
                  ◎ Mencari posisi GPS…
                </span>
              ) : (
                <button
                  type="button"
                  class="loc-enable-chip"
                  data-loc-action="enable-live-location"
                  data-testid="enable-live-location-btn"
                  onClick={onEnableLocation}
                >
                  ◎ Aktifkan Lokasi untuk urutkan Terdekat
                </button>
              )}
            </div>
          )}
          <ul
            class="cg-landmark-drawer-list"
            aria-label={listLabel}
            data-testid="claim-landmark-list"
            data-sort-mode="nearest"
          >
            {sortedNearest.map(renderRow)}
          </ul>
        </>
      ) : (
        <ul
          class="cg-landmark-drawer-list"
          aria-label={listLabel}
          data-testid="claim-landmark-list"
          data-sort-mode="zone"
        >
          {room.zones.flatMap((zone) => {
            const items = publicBoard.landmarks.filter((lm) => lm.zoneId === zone.zoneId);
            if (items.length === 0) return [];
            return [
              <li key={`zone-head-${zone.zoneId}`} class="cg-landmark-group-title" role="presentation">
                {zone.name || zone.label}
              </li>,
              ...items.map(renderRow),
            ];
          })}
        </ul>
      )}
    </>
  );
}

function ClaimLeafChallenge({
  leaf,
  attempt,
  clockNowSig,
  photoDraft,
  uploadingPhotoTarget,
  inlineError,
  busy,
  onSelectPhotoFile,
  onClearPhoto,
  onSubmitMcq,
  onSubmitInput,
  onSubmitPhoto,
  onStartTimed,
  onSubmitTimedGps,
}: {
  leaf: ClaimSanitizedLeafChallenge;
  attempt: ClaimActiveAttemptView;
  clockNowSig: Signal<number>;
  photoDraft?: PhotoDraftState;
  uploadingPhotoTarget: string;
  inlineError: ClaimInlineError;
  busy: boolean;
  onSelectPhotoFile: (targetId: string, file: File | undefined, isCurse: boolean) => void;
  onClearPhoto: (targetId: string) => void;
  onSubmitMcq: (landmarkId: string, choiceId: string) => void;
  onSubmitInput: (landmarkId: string, inputValue: string, inputEl: HTMLInputElement | null) => void;
  onSubmitPhoto: (landmarkId: string) => void;
  onStartTimed: (landmarkId: string) => void;
  onSubmitTimedGps: (landmarkId: string, target: GeoCoordinate) => void;
}) {
  const defaultChoice = leaf.primitive === "observation_mcq" ? (leaf.choices[0]?.id ?? "") : "";
  const [mcqChoice, setMcqChoice] = useState(defaultChoice);
  const [textDraft, setTextDraft] = useState("");
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (leaf.primitive === "observation_mcq") {
      setMcqChoice(leaf.choices[0]?.id ?? "");
    }
    setTextDraft("");
  }, [attempt.landmarkId, attempt.challenge.title, attempt.currentStep, leaf.primitive]);

  if (leaf.primitive === "observation_mcq") {
    const selectedChoice = leaf.choices.some((c) => c.id === mcqChoice)
      ? mcqChoice
      : (leaf.choices[0]?.id ?? "");
    return (
      <>
        <p>{leaf.prompt}</p>
        <div class="rb-list" role="radiogroup" aria-label="Pilihan jawaban">
          {leaf.choices.map((c) => (
            <label key={c.id}>
              <input
                type="radio"
                name="claim-mcq"
                value={c.id}
                checked={selectedChoice === c.id}
                onChange={() => setMcqChoice(c.id)}
              />{" "}
              {c.label}
            </label>
          ))}
        </div>
        <ClaimSlotAlert error={inlineError} slot="challenge-input" targetId={attempt.landmarkId} />
        <div class="rb-actions">
          <button
            type="button"
            class="primary"
            data-action="submit-mcq"
            data-landmark={attempt.landmarkId}
            disabled={busy}
            onClick={() => onSubmitMcq(attempt.landmarkId, selectedChoice)}
          >
            Kirim Jawaban
          </button>
        </div>
      </>
    );
  }

  if (leaf.primitive === "observation_input") {
    return (
      <>
        <p>{leaf.prompt}</p>
        <label class="rb-field">
          <span>Jawaban ({leaf.inputMode === "number" ? "Angka" : "Teks"})</span>
          <input
            ref={inputRef}
            id="claim-input-answer"
            inputMode={leaf.inputMode === "number" ? "numeric" : "text"}
            placeholder="Ketik jawaban pengamatan"
            value={textDraft}
            onInput={(event) => setTextDraft(event.currentTarget.value)}
          />
        </label>
        <ClaimSlotAlert error={inlineError} slot="challenge-input" targetId={attempt.landmarkId} />
        <div class="rb-actions">
          <button
            type="button"
            class="primary"
            data-action="submit-input"
            data-landmark={attempt.landmarkId}
            disabled={busy}
            onClick={() => onSubmitInput(attempt.landmarkId, textDraft, inputRef.current)}
          >
            Kirim Jawaban
          </button>
        </div>
      </>
    );
  }

  if (leaf.primitive === "photo_proof") {
    const isUploading = uploadingPhotoTarget === attempt.landmarkId;
    return (
      <>
        <p>{leaf.prompt}</p>
        {attempt.pendingPhoto ? (
          <p role="status">
            Foto bukti terkirim · Disetujui otomatis dalam{" "}
            <ClaimCountdown deadline={attempt.pendingPhoto.autoApproveAt} clockNowSig={clockNowSig} />.
          </p>
        ) : (
          <>
            <PhotoCaptureWidget
              targetAttrName="data-cg-photo"
              targetId={attempt.landmarkId}
              prepared={photoDraft?.prepared}
              processing={photoDraft?.processing}
              disabled={busy}
              hintText="Ambil foto bukti langsung di lokasi (otomatis diperkecil < 2 MB)."
              onSelectFile={(file) => onSelectPhotoFile(attempt.landmarkId, file, false)}
              onClear={() => onClearPhoto(attempt.landmarkId)}
            />
            <ClaimSlotAlert
              error={inlineError}
              slot="challenge-photo"
              targetId={attempt.landmarkId}
            />
            <div class="rb-actions">
              <button
                type="button"
                class="primary"
                data-action="submit-photo"
                data-landmark={attempt.landmarkId}
                disabled={busy}
                onClick={() => onSubmitPhoto(attempt.landmarkId)}
              >
                {isUploading ? "Mengunggah…" : "Unggah Foto Bukti"}
              </button>
            </div>
          </>
        )}
      </>
    );
  }

  const fallbackRemaining = Math.round(leaf.timeLimitMs / 1000);
  const fallbackLabel = `${Math.floor(fallbackRemaining / 60)}:${String(fallbackRemaining % 60).padStart(2, "0")}`;

  return (
    <>
      <p>{leaf.prompt}</p>
      <p>
        <span class="rb-badge rb-badge-warn">
          Batas waktu ·{" "}
          {attempt.timedDeadline ? (
            <ClaimCountdown deadline={attempt.timedDeadline} clockNowSig={clockNowSig} />
          ) : (
            <strong>{fallbackLabel}</strong>
          )}
        </span>
      </p>
      {attempt.timedStartedAt === null ? (
        <button
          type="button"
          class="primary"
          data-action="start-timed"
          data-landmark={attempt.landmarkId}
          disabled={busy}
          onClick={() => onStartTimed(attempt.landmarkId)}
        >
          Mulai Timer Tugas
        </button>
      ) : leaf.taskType === "sub_point_gps" ? (
        <>
          <ClaimSlotAlert error={inlineError} slot="challenge-gps" targetId={attempt.landmarkId} />
          <button
            type="button"
            class="primary"
            data-action="submit-timed-gps"
            data-landmark={attempt.landmarkId}
            data-lat={leaf.subPoint?.latitude ?? 0}
            data-lng={leaf.subPoint?.longitude ?? 0}
            disabled={busy}
            onClick={() =>
              onSubmitTimedGps(attempt.landmarkId, {
                latitude: leaf.subPoint?.latitude ?? 0,
                longitude: leaf.subPoint?.longitude ?? 0,
              })
            }
          >
            Check-in Sub-Titik ({leaf.subPoint?.label ?? "Target"})
          </button>
        </>
      ) : leaf.taskType === "photo_proof" ? (
        <>
          <PhotoCaptureWidget
            targetAttrName="data-cg-photo"
            targetId={attempt.landmarkId}
            prepared={photoDraft?.prepared}
            processing={photoDraft?.processing}
            disabled={busy}
            hintText="Ambil foto bukti langsung di lokasi (otomatis diperkecil < 2 MB)."
            onSelectFile={(file) => onSelectPhotoFile(attempt.landmarkId, file, false)}
            onClear={() => onClearPhoto(attempt.landmarkId)}
          />
          <ClaimSlotAlert
            error={inlineError}
            slot="challenge-photo"
            targetId={attempt.landmarkId}
          />
          <button
            type="button"
            class="primary"
            data-action="submit-photo"
            data-landmark={attempt.landmarkId}
            disabled={busy}
            onClick={() => onSubmitPhoto(attempt.landmarkId)}
          >
            {uploadingPhotoTarget === attempt.landmarkId ? "Mengunggah…" : "Kirim Foto"}
          </button>
        </>
      ) : (
        <>
          <label class="rb-field">
            <span>Jawaban Cepat</span>
            <input
              ref={inputRef}
              id="claim-input-answer"
              value={textDraft}
              onInput={(event) => setTextDraft(event.currentTarget.value)}
            />
          </label>
          <ClaimSlotAlert
            error={inlineError}
            slot="challenge-input"
            targetId={attempt.landmarkId}
          />
          <button
            type="button"
            class="primary"
            data-action="submit-input"
            data-landmark={attempt.landmarkId}
            disabled={busy}
            onClick={() => onSubmitInput(attempt.landmarkId, textDraft, inputRef.current)}
          >
            Kirim Jawaban Cepat
          </button>
        </>
      )}
    </>
  );
}

export function ClaimActiveAttempt({
  payload,
  attempt,
  clockNowSig,
  photoDrafts,
  uploadingPhotoTarget,
  inlineError,
  busy,
  onChooseShotTier,
  onSwapChallenge,
  onBailChallenge,
  onSelectPhotoFile,
  onClearPhoto,
  onSubmitMcq,
  onSubmitInput,
  onSubmitPhoto,
  onStartTimed,
  onSubmitTimedGps,
}: {
  payload: ClaimRoomPayload;
  attempt: ClaimActiveAttemptView;
  clockNowSig: Signal<number>;
  photoDrafts: Map<string, PhotoDraftState>;
  uploadingPhotoTarget: string;
  inlineError: ClaimInlineError;
  busy: boolean;
  onChooseShotTier: (landmarkId: string, tier: "standard" | "bold") => void;
  onSwapChallenge: (cardInstanceId: string, landmarkId: string) => void;
  onBailChallenge: (landmarkId: string) => void;
  onSelectPhotoFile: (targetId: string, file: File | undefined, isCurse: boolean) => void;
  onClearPhoto: (targetId: string) => void;
  onSubmitMcq: (landmarkId: string, choiceId: string) => void;
  onSubmitInput: (landmarkId: string, inputValue: string, inputEl: HTMLInputElement | null) => void;
  onSubmitPhoto: (landmarkId: string) => void;
  onStartTimed: (landmarkId: string) => void;
  onSubmitTimedGps: (landmarkId: string, target: GeoCoordinate) => void;
}) {
  const { room, publicBoard } = payload;
  const challengePayload = attempt.challenge.payload;
  const leaf = getActiveLeaf(attempt);
  const swapCard = room.ownHand.find((c) => c.effect.primitive === "swap_challenge");
  const lmName =
    publicBoard.landmarks.find((l) => l.id === attempt.landmarkId)?.name ?? attempt.landmarkId;

  return (
    <div class="rb-card" data-testid="active-challenge-modal">
      <div class="rb-badges">
        <span class="rb-badge">
          {attempt.isStealAttempt ? "⚡ Upaya Rebut & Kunci" : "🔓 Tantangan Kunci Landmark"}
        </span>
        <span class="rb-badge">{claimPrimitiveLabel(challengePayload.primitive)}</span>
        {challengePayload.primitive === "multi_step" && (
          <span class="rb-badge">Langkah {attempt.currentStep + 1}/2</span>
        )}
      </div>
      <h3>
        {attempt.challenge.title} · {lmName}
      </h3>
      {attempt.hint && (
        <details class="rb-accordion" data-claim-hint>
          <summary>Petunjuk lokasi</summary>
          <p>{attempt.hint}</p>
        </details>
      )}

      {challengePayload.primitive === "call_your_shot" && !challengePayload.chosenTier ? (
        <>
          <p>
            Tema: <strong>{challengePayload.theme}</strong>. Pilih tingkat tantangan:
          </p>
          <div class="rb-actions">
            <button
              type="button"
              class="secondary"
              data-action="choose-shot-tier"
              data-landmark={attempt.landmarkId}
              data-tier="standard"
              disabled={busy}
              onClick={() => onChooseShotTier(attempt.landmarkId, "standard")}
            >
              Standar
            </button>
            <button
              type="button"
              class="primary"
              data-action="choose-shot-tier"
              data-landmark={attempt.landmarkId}
              data-tier="bold"
              disabled={busy}
              onClick={() => onChooseShotTier(attempt.landmarkId, "bold")}
            >
              Ekstra (+1 Kartu)
            </button>
          </div>
        </>
      ) : leaf ? (
        <ClaimLeafChallenge
          leaf={leaf}
          attempt={attempt}
          clockNowSig={clockNowSig}
          photoDraft={photoDrafts.get(attempt.landmarkId)}
          uploadingPhotoTarget={uploadingPhotoTarget}
          inlineError={inlineError}
          busy={busy}
          onSelectPhotoFile={onSelectPhotoFile}
          onClearPhoto={onClearPhoto}
          onSubmitMcq={onSubmitMcq}
          onSubmitInput={onSubmitInput}
          onSubmitPhoto={onSubmitPhoto}
          onStartTimed={onStartTimed}
          onSubmitTimedGps={onSubmitTimedGps}
        />
      ) : null}

      <div class="rb-actions">
        {swapCard && (
          <button
            type="button"
            class="secondary"
            data-action="play-card"
            data-instance={swapCard.instanceId}
            data-primitive="swap_challenge"
            data-landmark={attempt.landmarkId}
            disabled={busy}
            onClick={() => onSwapChallenge(swapCard.instanceId, attempt.landmarkId)}
          >
            Ganti Tantangan
          </button>
        )}
        <button
          type="button"
          class="secondary"
          data-action="bail-challenge"
          data-landmark={attempt.landmarkId}
          disabled={busy}
          onClick={() => onBailChallenge(attempt.landmarkId)}
        >
          Menyerah ({room.isSolo ? "Hanguskan Landmark" : "Buka untuk Direbut"})
        </button>
      </div>
    </div>
  );
}

export function ClaimLandmarkDetail({
  payload,
  selectedId,
  selfFix,
  liveLocationStatus,
  landmarkSort,
  mapFailed,
  challengeHandId,
  clockNowSig,
  inlineError,
  busy,
  onSortChange,
  onEnableLocation,
  onSelectLandmark,
  onClearSelectedLandmark,
  onSelectChallengeHand,
  onCheckInLandmark,
}: {
  payload: ClaimRoomPayload;
  selectedId: string;
  selfFix: LocationFix | null;
  liveLocationStatus: LiveLocationStatus;
  landmarkSort: "zone" | "nearest";
  mapFailed: boolean;
  challengeHandId: string;
  clockNowSig: Signal<number>;
  inlineError: ClaimInlineError;
  busy: boolean;
  onSortChange: (sort: "zone" | "nearest") => void;
  onEnableLocation: () => void;
  onSelectLandmark: (landmarkId: string) => void;
  onClearSelectedLandmark: () => void;
  onSelectChallengeHand: (handId: string) => void;
  onCheckInLandmark: (landmarkId: string, chosenHandId?: string) => void;
}) {
  const { room, publicBoard } = payload;
  const meta = publicBoard.landmarks.find((lm) => lm.id === selectedId);
  const lm = room.landmarks.find((item) => item.landmarkId === selectedId);

  if (!lm || !meta) {
    if (mapFailed) {
      return (
        <>
          <div class="cg-section-title">
            <h2>Tantangan</h2>
          </div>
          <p>Pilih landmark di daftar untuk melihat status dan check-in.</p>
        </>
      );
    }
    return (
      <ClaimLandmarkList
        payload={payload}
        selectedId={selectedId}
        selfFix={selfFix}
        liveLocationStatus={liveLocationStatus}
        landmarkSort={landmarkSort}
        busy={busy}
        onSortChange={onSortChange}
        onEnableLocation={onEnableLocation}
        onSelectLandmark={onSelectLandmark}
      />
    );
  }

  const rival = Boolean(lm.ownerTeamId && lm.ownerTeamId !== room.teamId);
  const shielded = lm.shieldUntil !== null && lm.shieldUntil > room.now;
  const burned = room.ownBurnedLandmarks.includes(lm.landmarkId);
  const cooldown = room.ownCooldowns[lm.landmarkId] ?? 0;
  const scouted = room.scoutedChallenges[lm.landmarkId];
  const canAttempt = room.phase === "active" && lm.status !== "locked";
  const hand = room.ownChallengeHand;
  const effectiveHandId =
    hand && hand.length > 0
      ? hand.some((c) => c.id === challengeHandId)
        ? challengeHandId
        : hand[0].id
      : undefined;
  const proximity = evaluateCheckInProximity(
    selfFix,
    meta,
    publicBoard.checkInRadiusMeters,
    publicBoard.maxGpsAccuracyMeters,
  );

  let blockedNode = null;
  if (room.ownActiveAttempt) {
    blockedNode = <p>Selesaikan tantangan aktif untuk check-in di sini.</p>;
  } else if (burned) {
    blockedNode = <p>Landmark ini hangus untuk permainanmu.</p>;
  } else if (cooldown > room.now) {
    blockedNode = (
      <p>
        Coba lagi dalam <ClaimCountdown deadline={cooldown} clockNowSig={clockNowSig} />.
      </p>
    );
  } else if (rival && shielded && lm.shieldUntil !== null) {
    blockedNode = (
      <p>
        Perisai lawan aktif selama{" "}
        <ClaimCountdown deadline={lm.shieldUntil} clockNowSig={clockNowSig} />.
      </p>
    );
  }

  return (
    <div class="cg-selected" data-landmark-id={lm.landmarkId}>
      <div class="cg-section-title">
        <div class="rb-badges">
          <span class="rb-badge">
            {room.zones.find((zone) => zone.zoneId === lm.zoneId)?.label ?? lm.zoneId}
          </span>
          <span class="rb-badge">{landmarkStatus(lm)}</span>
          {lm.ownerTeamId && <span class="rb-badge">{teamName(room, lm.ownerTeamId)}</span>}
          {shielded && <span class="rb-badge rb-badge-warn">Perisai aktif</span>}
          {lm.doubleWeighted && <span class="rb-badge rb-badge-paid">2× Bobot</span>}
        </div>
        <button
          type="button"
          class="sg-quiet"
          data-action="clear-selected-landmark"
          data-testid="claim-back-to-list"
          disabled={busy}
          onClick={onClearSelectedLandmark}
        >
          ← Daftar
        </button>
      </div>
      <h2>{meta.name}</h2>
      {room.ownLearningExplanation?.landmarkId === lm.landmarkId && (
        <LearningExplanation text={room.ownLearningExplanation.text} />
      )}
      {meta.transitSummary && <p>{meta.transitSummary}</p>}
      {meta.accessNotes && <small>{meta.accessNotes}</small>}
      <div class="cg-selected-meta-actions">
        <DistanceMeter
          fix={selfFix}
          target={meta}
          checkInRadiusMeters={publicBoard.checkInRadiusMeters}
          maxGpsAccuracyMeters={publicBoard.maxGpsAccuracyMeters}
          status={liveLocationStatus}
          testId="claim-landmark-distance-meter"
          showEnableChip
          onEnableLocation={onEnableLocation}
        />
        <DirectionsLink coord={meta} testId="claim-landmark-directions" />
      </div>
      {scouted && (
        <p>
          Hasil Intai · <strong>{scouted.title}</strong>
        </p>
      )}
      {canAttempt && blockedNode}
      {canAttempt && !blockedNode && hand && hand.length > 0 && (
        <label class="rb-field">
          <span>Pilih tantangan</span>
          <select
            data-claim-hand
            value={effectiveHandId}
            onChange={(event) => onSelectChallengeHand(event.currentTarget.value)}
          >
            {hand.map((challenge) => (
              <option key={challenge.id} value={challenge.id}>
                {challenge.title}
              </option>
            ))}
          </select>
        </label>
      )}
      {canAttempt && !blockedNode && hand?.length === 0 && (
        <p>Belum ada kartu tantangan yang dapat digunakan.</p>
      )}
      <ClaimSlotAlert error={inlineError} slot="landmark-checkin" targetId={lm.landmarkId} />
      {canAttempt && !blockedNode && hand?.length !== 0 && (
        <button
          type="button"
          class={`sg-main${proximity.state === "ready" ? " loc-btn-ready" : ""}`}
          data-action="checkin-landmark"
          data-landmark={lm.landmarkId}
          disabled={busy}
          onClick={() => onCheckInLandmark(lm.landmarkId, effectiveHandId)}
        >
          {rival ? "Check-in & Rebut Landmark" : "Check-in Landmark"}
        </button>
      )}
    </div>
  );
}

export function ClaimActiveAlerts({
  payload,
  clockNowSig,
  photoDrafts,
  uploadingPhotoTarget,
  inlineError,
  busy,
  onReviewRivalPhoto,
  onSelectPhotoFile,
  onClearPhoto,
  onClearCurseGps,
  onSubmitCursePhoto,
  onClearCurseHonor,
  onReviewCursePhoto,
}: {
  payload: ClaimRoomPayload;
  clockNowSig: Signal<number>;
  photoDrafts: Map<string, PhotoDraftState>;
  uploadingPhotoTarget: string;
  inlineError: ClaimInlineError;
  busy: boolean;
  onReviewRivalPhoto: (seatId: string, landmarkId: string, approve: boolean) => void;
  onSelectPhotoFile: (targetId: string, file: File | undefined, isCurse: boolean) => void;
  onClearPhoto: (targetId: string) => void;
  onClearCurseGps: (curseInstanceId: string) => void;
  onSubmitCursePhoto: (curseInstanceId: string) => void;
  onClearCurseHonor: (curseInstanceId: string) => void;
  onReviewCursePhoto: (curseInstanceId: string, approve: boolean) => void;
}) {
  const { room, publicBoard } = payload;
  if (room.phase !== "active") return null;
  const lmMetaById = new Map(publicBoard.landmarks.map((lm) => [lm.id, lm]));
  const open = room.landmarks.filter(
    (lm) => lm.status === "claimed" && lm.vulnerableAlertAt !== null && lm.ownerTeamId !== room.teamId,
  );

  return (
    <>
      {open.length > 0 && (
        <div class="cg-notice" data-testid="open-to-steal-alert">
          <strong>Terbuka untuk direbut!</strong>
          <p>{open.map((lm) => lmMetaById.get(lm.landmarkId)?.name ?? lm.landmarkId).join(", ")}</p>
        </div>
      )}

      {room.pendingRivalPhotoReviews.length > 0 && (
        <div class="rb-card">
          <h3>Tinjauan Foto Tantangan Lawan ({room.pendingRivalPhotoReviews.length})</h3>
          <ul class="rb-list">
            {room.pendingRivalPhotoReviews.map((rev) => (
              <li key={`${rev.attemptOwnerSeatId}:${rev.landmarkId}`}>
                <strong>{lmMetaById.get(rev.landmarkId)?.name ?? rev.landmarkId}</strong>
                <small>
                  Disetujui otomatis dalam{" "}
                  <ClaimCountdown deadline={rev.autoApproveAt} clockNowSig={clockNowSig} as="span" />
                </small>
                <ClaimProofImage roomCode={room.code} photoId={rev.photoId} />
                <div class="rb-actions">
                  <button
                    type="button"
                    class="primary"
                    data-action="review-rival-photo"
                    data-seat={rev.attemptOwnerSeatId}
                    data-landmark={rev.landmarkId}
                    data-approve="true"
                    disabled={busy}
                    onClick={() => onReviewRivalPhoto(rev.attemptOwnerSeatId, rev.landmarkId, true)}
                  >
                    Setujui Foto
                  </button>
                  <button
                    type="button"
                    class="secondary"
                    data-action="review-rival-photo"
                    data-seat={rev.attemptOwnerSeatId}
                    data-landmark={rev.landmarkId}
                    data-approve="false"
                    disabled={busy}
                    onClick={() => onReviewRivalPhoto(rev.attemptOwnerSeatId, rev.landmarkId, false)}
                  >
                    Tolak Foto
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {room.activeCurses.length > 0 && (
        <div class="rb-card">
          <h3>Kutukan Aktif ({room.activeCurses.length})</h3>
          <ul class="rb-list">
            {room.activeCurses.map((c) => {
              const isTarget = c.targetSeatId === room.seatId;
              const isCaster = c.casterSeatId === room.seatId;
              const clear = c.clearCondition;
              const draft = photoDrafts.get(c.curseInstanceId);
              return (
                <li key={c.curseInstanceId}>
                  <span class="rb-badge rb-badge-danger">{c.title}</span>
                  <p>{c.description}</p>
                  {clear.type === "gps_detour" && (
                    <small>
                      Check-in dalam radius {clear.radiusMeters} m dari lokasi kategori{" "}
                      {clear.poiCategory}.
                    </small>
                  )}
                  {clear.type === "honor_task" && <small>{clear.instruction}</small>}
                  {clear.type === "photo_challenge" && <small>{clear.prompt}</small>}
                  {c.expiresAt && (
                    <small>
                      Berakhir dalam{" "}
                      <ClaimCountdown deadline={c.expiresAt} clockNowSig={clockNowSig} as="span" />
                    </small>
                  )}
                  {isTarget && clear.type === "photo_challenge" && !c.pendingPhoto && (
                    <PhotoCaptureWidget
                      targetAttrName="data-cg-photo"
                      targetId={c.curseInstanceId}
                      prepared={draft?.prepared}
                      processing={draft?.processing}
                      disabled={busy}
                      hintText="Ambil foto bukti langsung di lokasi (otomatis diperkecil < 2 MB)."
                      onSelectFile={(file) => onSelectPhotoFile(c.curseInstanceId, file, true)}
                      onClear={() => onClearPhoto(c.curseInstanceId)}
                    />
                  )}
                  {isCaster && c.pendingPhoto && (
                    <ClaimProofImage roomCode={room.code} photoId={c.pendingPhoto.photoId} />
                  )}
                  <ClaimSlotAlert
                    error={inlineError}
                    slot="curse-action"
                    targetId={c.curseInstanceId}
                  />
                  <div class="rb-actions">
                    {isTarget && clear.type === "gps_detour" && (
                      <button
                        type="button"
                        class="primary"
                        data-action="clear-curse-gps"
                        data-curse={c.curseInstanceId}
                        disabled={busy}
                        onClick={() => onClearCurseGps(c.curseInstanceId)}
                      >
                        Check-in Lokasi
                      </button>
                    )}
                    {isTarget && clear.type === "photo_challenge" && !c.pendingPhoto && (
                      <button
                        type="button"
                        class="primary"
                        data-action="submit-curse-photo"
                        data-curse={c.curseInstanceId}
                        disabled={busy}
                        onClick={() => onSubmitCursePhoto(c.curseInstanceId)}
                      >
                        {uploadingPhotoTarget === c.curseInstanceId
                          ? "Mengunggah…"
                          : "Kirim Foto Bukti"}
                      </button>
                    )}
                    {isTarget && clear.type === "honor_task" && (
                      <button
                        type="button"
                        class="primary"
                        data-action="clear-curse-honor"
                        data-curse={c.curseInstanceId}
                        disabled={busy}
                        onClick={() => onClearCurseHonor(c.curseInstanceId)}
                      >
                        Selesaikan Tugas
                      </button>
                    )}
                    {isCaster && c.pendingPhoto && (
                      <>
                        <button
                          type="button"
                          class="primary"
                          data-action="review-curse-photo"
                          data-curse={c.curseInstanceId}
                          data-approve="true"
                          disabled={busy}
                          onClick={() => onReviewCursePhoto(c.curseInstanceId, true)}
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
                          onClick={() => onReviewCursePhoto(c.curseInstanceId, false)}
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
      )}
    </>
  );
}

export function ClaimRivalCard({
  room,
  selectedRivalPinSeatId,
  clockNowSig,
  onClose,
}: {
  room: ClaimEngineRoomView;
  selectedRivalPinSeatId: string;
  clockNowSig: Signal<number>;
  onClose: () => void;
}) {
  if (!selectedRivalPinSeatId || room.phase !== "active" || room.isSolo || room.outcome) {
    return null;
  }
  const pos = (room.seatPositions ?? []).find((p) => p.seatId === selectedRivalPinSeatId);
  if (!pos) return null;
  const zoneName = zoneLabelFor(room, pos.zoneId);
  const sourceText = pos.source === "checkin" ? "Check-in landmark" : "GPS langsung";
  const meta = [zoneName, sourceText].filter(Boolean).join(" · ");

  return (
    <div class="cg-rival-card" data-testid="claim-rival-card" data-rival-seat={pos.seatId}>
      <div class="cg-rival-card-copy">
        <strong>▲ {pos.name}</strong>
        <small>
          {meta ? `${meta} · ` : ""}
          <ClaimRelativeAge at={pos.at} clockNowSig={clockNowSig} stalePrefix />
        </small>
      </div>
      <button
        type="button"
        class="cg-rival-close"
        data-action="close-rival-card"
        aria-label="Tutup info pemain"
        onClick={onClose}
      >
        ×
      </button>
    </div>
  );
}
