(() => {
  if (globalThis.pegPartyPlayer) return;

  let controller;
  let lastInput = -Infinity;

  function video() {
    return [...document.querySelectorAll("video")]
      .filter(item => item.readyState > 0 && Number.isFinite(item.duration) && item.duration > 0)
      .map(item => {
        const box = item.getBoundingClientRect();
        const style = getComputedStyle(item);
        const area = style.display !== "none" && style.visibility === "visible" ? box.width * box.height : 0;
        return { item, area };
      })
      .filter(candidate => candidate.area > 0)
      .sort((left, right) => right.area - left.area)[0];
  }

  function read() {
    const candidate = video();
    if (!candidate) return null;
    const { item, area } = candidate;
    return {
      area, duration: item.duration, position: item.currentTime, rate: item.playbackRate,
      paused: item.paused || item.ended
    };
  }

  function buffered(item, target) {
    for (let i = 0; i < item.buffered.length; i++) {
      if (target >= item.buffered.start(i) && target + 0.5 <= item.buffered.end(i)) return true;
    }
    return false;
  }

  function apply({ session, revision, position, duration, rate, paused, resync }) {
    const item = video()?.item;
    if (!item) return "missing";
    if (Math.abs(item.duration - duration) > 5) return "different-video";
    if (!controller || controller.item !== item || controller.session !== session) {
      controller = { item, session, revision: -1, lastSeek: -Infinity, expected: {} };
    }
    const control = controller;
    const { expected } = control;
    if (paused) {
      control.playAttempt = null;
      control.playRequested = false;
      control.blocked = false;
      if (!item.paused) {
        expected.pause = true;
        item.pause();
      }
    }
    if (item.seeking) return "waiting";
    if (!paused) {
      if (control.playAttempt) return "starting";
      if (item.paused && control.playRequested) control.blocked = true;
      if (control.blocked) return "blocked";
      if (!item.paused && performance.now() - control.playStartedAt >= 900) {
        control.playRequested = false;
      }
    }

    const target = Math.min(item.duration, Math.max(0, position));
    const drift = Math.abs(item.currentTime - target);
    const newPosition = revision !== control.revision || resync !== control.resync;
    const now = performance.now();
    const inSync = paused ? 0.25 : 0.75;
    // Periodic corrections stay within already-buffered media and never interrupt a stalled player.
    const periodicSeek = !paused && !item.paused && drift > 3 && now - control.lastSeek >= 8000 &&
      item.readyState >= HTMLMediaElement.HAVE_FUTURE_DATA && buffered(item, target);
    control.revision = revision;
    control.resync = resync;
    if ((newPosition && drift > inSync) || periodicSeek) {
      expected.seek = target;
      control.lastSeek = now;
      item.currentTime = target;
    }
    if (item.playbackRate !== rate) {
      expected.ratechange = rate;
      item.playbackRate = rate;
    }
    if (!paused && item.paused && !item.ended && !item.seeking) {
      const attempt = {};
      control.playAttempt = attempt;
      control.playRequested = true;
      control.playStartedAt = now;
      expected.play = true;
      item.play().then(
        () => { if (control.playAttempt === attempt) control.playAttempt = null; },
        () => {
          if (control.playAttempt !== attempt) return;
          control.playAttempt = null;
          expected.play = false;
          control.blocked = true;
        }
      );
      return "starting";
    }
    return "ready";
  }

  function consumeRemoteEvent(control, type, item) {
    const { expected } = control;
    if (type === "seeked") {
      const target = expected.seek;
      expected.seek = undefined;
      return target !== undefined && Math.abs(item.currentTime - target) <= 0.5;
    }
    if (type === "ratechange") {
      const rate = expected.ratechange;
      expected.ratechange = undefined;
      return item.playbackRate === rate;
    }
    if (type === "play" && control.blocked) {
      // A click on the player's own Play button clears the browser's autoplay block.
      control.blocked = false;
      control.playRequested = false;
      expected.play = false;
      return true;
    }
    const remote = expected[type];
    expected[type] = false;
    // Some embedded players briefly pause themselves while a remote Play takes effect.
    return remote || (type === "pause" && lastInput < control.playStartedAt &&
      performance.now() - control.playStartedAt < 900);
  }

  for (const event of ["pointerdown", "keydown"]) {
    document.addEventListener(event, event => {
      if (event.isTrusted) lastInput = performance.now();
    }, true);
  }

  for (const event of ["play", "pause", "seeked", "ratechange"]) {
    document.addEventListener(event, ({ target }) => {
      if (!(target instanceof HTMLVideoElement) || video()?.item !== target) return;
      if (controller?.item === target && consumeRemoteEvent(controller, event, target)) return;
      const type = event === "seeked" ? "seek" : event === "ratechange" ? "rate" : event;
      const value = type === "rate" ? target.playbackRate : target.currentTime;
      chrome.runtime.sendMessage({ type: "pegparty-command", command: { type, value } }).catch(() => {});
    }, true);
  }

  globalThis.pegPartyPlayer = { read, apply };
})();
