/** A temporary speed gesture. Timers are injectable for deterministic tests. */
export function holdSpeed({
  speed,
  tap,
  change = () => {},
  later = setTimeout,
  clear = clearTimeout,
}) {
  let press = null;
  const finish = (restore = true, clicked = false) => {
    const previous = press;
    press = null;
    if (!previous) return;
    clear(previous.timer);
    if (previous.active && restore) speed(previous.speed);
    change(false);
    if (clicked && !previous.active) tap();
  };
  return {
    get busy() {
      return !!press;
    },
    down({ rate = 2, previous = 1 } = {}) {
      if (press) return;
      const current = { speed: previous, active: false, timer: null };
      press = current;
      if (rate > 0)
        current.timer = later(() => {
          if (press !== current) return;
          current.active = true;
          speed(rate);
          change(true);
        }, 350);
    },
    up: () => finish(true, true),
    cancel: (restore = true) => finish(restore),
  };
}
