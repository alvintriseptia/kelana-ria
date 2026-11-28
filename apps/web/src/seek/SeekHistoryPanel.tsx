import { useRef } from "preact/hooks";
import { animateSheetIn } from "../game-motion";
import type { SeekEngineRoomView } from "@kelana-ria/contracts";
import { answerText, questionNames } from "./types";

export function SeekHistoryPanel({ room }: { room: SeekEngineRoomView }) {
  const reversed = room.questions.map((question, index) => ({ question, index })).reverse();
  return (
    <>
      <h2 id="sg-panel-title" tabIndex={-1}>
        Riwayat petunjuk
      </h2>
      <ul class="rb-list">
        {reversed.length === 0 ? (
          <li>Belum ada petunjuk.</li>
        ) : (
          reversed.map(({ question, index }) => (
            <li key={question.id} data-photo-clue-index={question.photoId ? index : undefined}
              tabIndex={question.photoId ? -1 : undefined}>
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
                <SeekCluePhoto src={`/api/rulebooks/rooms/${encodeURIComponent(room.code)}/photos/${encodeURIComponent(question.photoId)}`} />
              )}
            </li>
          ))
        )}
      </ul>
    </>
  );
}

function SeekCluePhoto({ src }: { src: string }) {
  const sourceAnimated = useRef("");
  return <img class="sg-clue-photo" src={src} alt="Foto petunjuk" loading="lazy"
    onLoad={event => {
      if (sourceAnimated.current === src) return;
      sourceAnimated.current = src;
      animateSheetIn(event.currentTarget, { offsetY: 4, fromScale: 1 });
    }} />;
}
