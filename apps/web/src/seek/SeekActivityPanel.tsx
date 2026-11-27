import type { RoomActivityFeed } from "@kelana-ria/contracts";
import type { Signal } from "@preact/signals";
import { SeekRelativeAge } from "./SeekShared";

export function SeekActivityPanel({
  feed,
  clockNowSig,
}: {
  feed: RoomActivityFeed;
  clockNowSig: Signal<number>;
}) {
  const reversed = feed.events.slice().reverse();
  return (
    <section aria-label="Aktivitas terbaru">
      <h2 tabIndex={-1} data-activity-heading>
        Aktivitas terbaru
      </h2>
      {reversed.length > 0 ? (
        <ol class="room-activity-list">
          {reversed.map((event) => (
            <li key={event.sequence} data-activity-event={event.sequence}>
              <span class="room-activity-text">{event.text}</span>
              <SeekRelativeAge at={event.at} clockNowSig={clockNowSig} activityTime />
            </li>
          ))}
        </ol>
      ) : (
        <p>Belum ada aktivitas.</p>
      )}
    </section>
  );
}
