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
