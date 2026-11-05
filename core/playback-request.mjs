/** Ownership of work before Player.start: service probes and engine startup. */
export class PlaybackRequest {
  constructor() {
    this.current = null;
  }
  begin(resource = "") {
    this.cancel();
    const controller = new AbortController();
    return (this.current = { resource, controller, signal: controller.signal });
  }
  owns(request) {
    return this.current === request;
  }
  cancel() {
    this.current?.controller.abort();
    this.current = null;
  }
  mayRelease(resource, playing = "") {
    return (
      !!resource && resource !== playing && resource !== this.current?.resource
    );
  }
}

/**
 * What a play IPC answers once the player was asked to start: the player's
 * state, or `{ cancelled: true }` when Stop or a newer play took over while
 * MPV was still starting (an error marked `cancelled`, or this request no
 * longer owning playback). Any other failure is a real one and is thrown.
 */
export async function startOutcome(started, owns = () => true) {
  try {
    return await started;
  } catch (error) {
    if (error?.cancelled || !owns()) return { cancelled: true };
    throw error;
  }
}
