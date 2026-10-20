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
    const previous = this.client.state.onboarding;
    this.client.state.onboarding = { version: 1, status: "complete" };
    try {
      this.client.persist();
    } catch (error) {
      this.client.state.onboarding = previous;
      throw error;
    }
    return this.client.publicState();
  }
}
