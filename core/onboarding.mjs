/** Device-local first-run state. Never carries credentials or usage consent. */
export class FirstRun {
  constructor(client, loaded) {
    this.client = client;
    const saved = loaded?.onboarding;
    client.state.onboarding = {
      version: 1,
      status:
        saved?.version === 1 &&
        ["pending", "complete", "existing"].includes(saved.status)
          ? saved.status
          : Object.keys(loaded || {}).length
            ? "existing"
            : "pending",
    };
  }
  publicState() {
    return { required: this.client.state.onboarding.status === "pending" };
  }
  complete() {
    // A commit (sixth pass, V2): refused, on the web too, it is still due.
    this.client.transact(() => {
      const previous = this.client.state.onboarding;
      const done = { version: 1, status: "complete" };
      this.client.state.onboarding = done;
      return () => {
        if (this.client.state.onboarding === done)
          this.client.state.onboarding = previous;
      };
    });
    return this.client.publicState();
  }
}
