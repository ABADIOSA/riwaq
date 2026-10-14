/** Ownership of work before Player.start: service probes and engine startup. */
export class PlaybackRequest {
  constructor() {
    this.current = null;
  }
  begin(resource = "") {
    return (this.current = { resource });
  }
  owns(request) {
    return this.current === request;
  }
  cancel() {
    this.current = null;
  }
  mayRelease(resource, playing = "") {
    return (
      !!resource && resource !== playing && resource !== this.current?.resource
    );
  }
}
