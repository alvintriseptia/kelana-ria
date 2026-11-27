import type {
  SeekCardInstance,
  SeekEngineQuestion,
  SeekEngineRoomView,
  SeekPublicBoard,
} from "@kelana-ria/contracts";
import type { Signal } from "@preact/signals";
import type { PreparedPhoto } from "../photo-capture";
import { PhotoCaptureWidget } from "../ui/PhotoCaptureWidget";
import { SeekDeadline, SeekQuestionArt, SeekSlotAlert } from "./SeekShared";
import { objectiveChoices, rewardLabel, type SeekInlineError } from "./types";

export function SeekIncomingQuestion({
  room,
  question,
  selectedAnswer,
  pois,
  alternatives,
  photoDraft,
  inlineError,
  busy,
  clockNowSig,
  onChooseAnswer,
  onSubmitAnswer,
  onSelectPhotoFile,
  onClearPhoto,
  onSubmitPhoto,
  onPlayAlternativeCard,
}: {
  room: SeekEngineRoomView;
  question: SeekEngineQuestion;
  selectedAnswer: string;
  pois: SeekPublicBoard["pois"];
  alternatives: SeekCardInstance[];
  photoDraft: { prepared: PreparedPhoto | null; processing: boolean; uploading: boolean } | null;
  inlineError: SeekInlineError;
  busy: boolean;
  clockNowSig: Signal<number>;
  onChooseAnswer: (answerCode: string) => void;
  onSubmitAnswer: (questionId: string) => void;
  onSelectPhotoFile: (file: File | undefined) => void;
  onClearPhoto: () => void;
  onSubmitPhoto: (questionId: string) => void;
  onPlayAlternativeCard: (cardInstanceId: string, primitive: string) => void;
}) {
  const answer = question.privateComputedAnswer;
  const choices: [string, string][] =
    question.family === "photo"
      ? []
      : question.family === "tentacles"
        ? [
            ["outside", "Di luar radius"],
            ...(answer?.overlay.type === "voronoi"
              ? answer.overlay.candidatePoiIds.map((id): [string, string] => [
                  id,
                  pois.find((poi) => poi.id === id)?.name ?? id,
                ])
              : []),
            ...(answer?.code.includes("|") ? [[answer.code, answer.label] as [string, string]] : []),
          ]
        : objectiveChoices[question.family];

  return (
    <>
      <div class="sg-detail-title">
        <SeekQuestionArt family={question.family} />
        <div>
          <p class="sg-kicker">Pertanyaan masuk</p>
          <h2 id="sg-panel-title" tabIndex={-1}>
            {question.label}
          </h2>
        </div>
      </div>

      {question.prompt && question.prompt !== question.label && <p>{question.prompt}</p>}

      <p class="sg-reward-note">{rewardLabel(question.drawBatches)}</p>

      {question.family === "photo" ? (
        <>
          <PhotoCaptureWidget
            inputId="sg-clue-photo"
            targetAttrName="data-sg-photo"
            targetId={question.id}
            prepared={photoDraft?.prepared}
            processing={photoDraft?.processing}
            disabled={busy}
            hintText="Foto tempat umum. Hindari orang yang dapat dikenali (otomatis diperkecil < 2 MB)."
            previewAlt="Pratinjau foto petunjuk"
            onSelectFile={onSelectPhotoFile}
            onClear={onClearPhoto}
          />
          <button
            type="button"
            class="sg-main"
            data-action="answer-photo"
            data-qid={question.id}
            disabled={busy || photoDraft?.processing || !photoDraft?.prepared}
            onClick={() => onSubmitPhoto(question.id)}
          >
            {photoDraft?.uploading ? "Mengunggah…" : "Kirim foto"}
          </button>
        </>
      ) : (
        <>
          <div class="sg-picks" role="group" aria-label="Jawaban">
            {choices.map(([code, label]) => (
              <button
                key={code}
                type="button"
                class="sg-pick"
                data-action="choose-answer"
                data-answer={code}
                aria-pressed={selectedAnswer === code ? "true" : "false"}
                disabled={busy}
                onClick={() => onChooseAnswer(code)}
              >
                {label}
              </button>
            ))}
          </div>
          {selectedAnswer && answer && (
            <p
              class="sg-answer-check"
              data-correct={selectedAnswer === answer.code ? "true" : "false"}
              role="status"
            >
              {selectedAnswer === answer.code
                ? "✓ Jawaban cocok dengan peta"
                : "✕ Jawaban belum cocok dengan peta"}
            </p>
          )}
          <button
            type="button"
            class="sg-main"
            data-action="answer-pending"
            data-qid={question.id}
            disabled={busy || !answer || selectedAnswer !== answer.code}
            onClick={() => onSubmitAnswer(question.id)}
          >
            Kirim jawaban
          </button>
        </>
      )}

      <div class="sg-picks">
        {alternatives.map((card) => (
          <button
            key={card.instanceId}
            type="button"
            class="sg-pick"
            data-action="play-card"
            data-instance={card.instanceId}
            data-primitive={card.effect.primitive}
            disabled={busy}
            onClick={() => onPlayAlternativeCard(card.instanceId, card.effect.primitive)}
          >
            {card.title}
          </button>
        ))}
      </div>

      <SeekSlotAlert error={inlineError} slot="answer-photo" />
      <SeekSlotAlert error={inlineError} slot="answer-field" />

      <p>
        Jawab dalam <SeekDeadline deadline={question.deadline} clockNowSig={clockNowSig} />
      </p>
    </>
  );
}
