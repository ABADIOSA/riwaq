// Browser-safe audio transport, injected element/source resolver for testing.
export class MusicTransport {
  constructor({
    createAudio,
    resolve,
    changed,
    beforeResume = async () => {},
    random = Math.random,
  }) {
    Object.assign(this, {
      createAudio,
      resolve,
      changed,
      beforeResume,
      random,
    });
    this.resumeIntent = 0;
    this.generation = 0;
    this.bag = [];
    this.history = [];
    this.state = {
      id: "",
      queue: [],
      playing: false,
      loading: false,
      position: 0,
      duration: 0,
      volume: 0.7,
      shuffle: false,
      repeat: "off",
      error: "",
    };
  }
  publish(patch = {}) {
    this.state = { ...this.state, ...patch };
    this.changed(this.state);
  }
  queue(ids) {
    this.bag = [];
    this.history = [];
    this.publish({ queue: [...new Set(ids)].slice(0, 500) });
  }
  disposeAudio() {
    if (!this.audio) return;
    const audio = this.audio;
    this.audio = null;
    for (const event of [
      "ended",
      "error",
      "timeupdate",
      "loadedmetadata",
      "play",
      "pause",
      "waiting",
      "playing",
    ])
      audio[`on${event}`] = null;
    audio.pause();
    audio.removeAttribute("src");
    audio.load();
  }
  async play(id, { remember = true } = {}) {
    if (!this.state.queue.includes(id)) return;
    const token = ++this.generation;
    const previous = this.state.id;
    this.disposeAudio();
    if (remember && previous && previous !== id) this.history.push(previous);
    this.history = this.history.slice(-500);
    this.publish({
      id,
      playing: false,
      loading: true,
      error: "",
      position: 0,
      duration: 0,
    });
    try {
      const { url } = await this.resolve(id, () => token === this.generation);
      if (token !== this.generation) return;
      const audio = this.createAudio();
      this.audio = audio;
      const current = () => token === this.generation && this.audio === audio;
      audio.volume = this.state.volume;
      audio.preload = "metadata";
      audio.ontimeupdate = audio.onloadedmetadata = () => {
        if (current())
          this.publish({
            position: Number(audio.currentTime) || 0,
            duration: Number.isFinite(audio.duration) ? audio.duration : 0,
          });
      };
      audio.onplaying = () =>
        current() && this.publish({ playing: true, loading: false });
      audio.onpause = () => current() && this.publish({ playing: false });
      audio.onwaiting = () => current() && this.publish({ loading: true });
      audio.onerror = () => {
        if (current()) {
          this.disposeAudio();
          this.publish({
            playing: false,
            loading: false,
            error: "تعذّر قراءة الأغنية؛ تحقق من الملف أو جرّب التالي",
          });
        }
      };
      audio.onended = () => {
        if (current()) this.next(true);
      };
      audio.src = url;
      await audio.play();
      if (current()) this.publish({ playing: !audio.paused, loading: false });
    } catch (e) {
      if (token !== this.generation) return;
      this.disposeAudio();
      this.publish({
        playing: false,
        loading: false,
        error: e.message || "تعذّر تشغيل الأغنية",
      });
    }
  }
  async resume() {
    if (!this.audio) return this.play(this.state.id);
    const audio = this.audio,
      token = this.generation;
    const intent = ++this.resumeIntent;
    const current = () =>
      this.audio === audio &&
      token === this.generation &&
      intent === this.resumeIntent;
    try {
      await this.beforeResume(current);
      if (!current()) return;
      this.publish({ loading: true });
      await audio.play();
      if (current())
        this.publish({ playing: !audio.paused, loading: false, error: "" });
    } catch (error) {
      if (current())
        this.publish({
          playing: false,
          loading: false,
          error: error.message || "تعذّر استئناف الأغنية",
        });
    }
  }
  pause() {
    ++this.resumeIntent;
    if (this.state.loading && !this.audio) {
      ++this.generation;
      this.publish({ loading: false });
    }
    this.audio?.pause();
    this.publish({ playing: false, loading: false });
  }
  stop() {
    ++this.generation;
    this.disposeAudio();
    this.publish({
      id: "",
      playing: false,
      loading: false,
      position: 0,
      duration: 0,
      error: "",
    });
  }
  seek(seconds) {
    if (this.audio && Number.isFinite(seconds) && this.state.duration > 0)
      this.audio.currentTime = Math.max(
        0,
        Math.min(seconds, this.state.duration),
      );
  }
  option(key, value) {
    if (key === "volume" && Number.isFinite(value)) {
      value = Math.min(1, Math.max(0, value));
      if (this.audio) this.audio.volume = value;
    } else if (key === "shuffle") {
      value = !!value;
      this.bag = [];
    } else if (key !== "repeat" || !["off", "one", "all"].includes(value))
      return;
    this.publish({ [key]: value });
  }
  next(ended = false) {
    const { queue, id, repeat, shuffle } = this.state;
    if (ended && repeat === "one") return this.play(id, { remember: false });
    let next;
    if (shuffle) {
      if (!this.bag.length)
        this.bag = queue.filter((i) => i !== id && !this.history.includes(i));
      if (!this.bag.length && repeat === "all") {
        this.history = [];
        this.bag = queue.filter((i) => i !== id);
      }
      if (this.bag.length)
        next = this.bag.splice(
          Math.floor(this.random() * this.bag.length),
          1,
        )[0];
      else if (queue.length === 1 && repeat === "all") next = id;
    } else
      next = queue[queue.indexOf(id) + 1] || (repeat === "all" ? queue[0] : "");
    if (next) return this.play(next);
    this.pause();
    this.publish({ loading: false });
  }
  previous() {
    if (this.state.position > 3) return this.seek(0);
    const id =
      this.history.pop() ||
      this.state.queue[this.state.queue.indexOf(this.state.id) - 1];
    if (id) return this.play(id, { remember: false });
    this.seek(0);
  }
}
