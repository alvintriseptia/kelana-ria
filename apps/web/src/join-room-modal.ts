import type { OpenJoinRoomModalOptions } from "./join-room-modal-view";

export type { OpenJoinRoomModalOptions };

/**
 * Lazily loads the Preact JoinRoomModal view when invoked so the vanilla
 * landing page (/) and cold-load shell do not eagerly download Preact.
 */
export function openJoinRoomModal(options: OpenJoinRoomModalOptions): void {
  if (options.signal.aborted) return;
  void import("./join-room-modal-view").then(({ openJoinRoomModalView }) => {
    if (options.signal.aborted) return;
    openJoinRoomModalView(options);
  });
}
