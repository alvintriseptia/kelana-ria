import type { SeekEngineRoomView } from "@kelana-ria/contracts";
import { answerText, questionNames } from "./types";

export function SeekHistoryPanel({ room }: { room: SeekEngineRoomView }) {
  const reversed = [...room.questions].reverse();
  return (
    <>
      <h2 id="sg-panel-title" tabIndex={-1}>
        Riwayat petunjuk
      </h2>
      <ul class="rb-list">
        {reversed.length === 0 ? (
          <li>Belum ada petunjuk.</li>
        ) : (
          reversed.map((question) => (
            <li key={question.id}>
              <strong>
                {questionNames[question.family]} · {question.label}
              </strong>
              <small>
                {question.answerLabel
                  ? answerText(question.answerLabel)
                  : question.status === "pending"
                    ? "Menunggu jawaban"
                    : "Pertanyaan ditutup"}
              </small>
              {question.photoId && (
                <img
                  class="sg-clue-photo"
                  src={`/api/rulebooks/rooms/${encodeURIComponent(room.code)}/photos/${encodeURIComponent(question.photoId)}`}
                  alt="Foto petunjuk"
                  loading="lazy"
                />
              )}
            </li>
          ))
        )}
      </ul>
    </>
  );
}
