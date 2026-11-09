(() => {
  if (globalThis.pegPartyChatLayout) return;

  // Resize the existing player in place. Moving a streaming iframe can reload it.
  function findTarget({ embedded, url }, source) {
    if (embedded) {
      const frames = [...document.querySelectorAll("iframe")];
      if (source) return frames.find(frame => frame.contentWindow === source);
      const exact = frames.filter(frame => frame.src === url);
      if (exact.length === 1) return exact[0];
      // An iframe's current URL can differ from its src after a redirect.
      const visible = frames.map(frame => ({ frame, box: frame.getBoundingClientRect() }))
        .filter(({ box }) => box.width >= 300 && box.height >= 160)
        .map(({ frame, box }) => ({ frame, area: box.width * box.height }))
        .sort((a, b) => b.area - a.area);
      return visible[0]?.area > (visible[1]?.area ?? 0) * 2 ? visible[0].frame : null;
    }
    const videos = [...document.querySelectorAll("video")]
      .filter(video => video.readyState > 0 && Number.isFinite(video.duration))
      .map(video => ({ video, box: video.getBoundingClientRect() }))
      .sort((a, b) => b.box.width * b.box.height - a.box.width * a.box.height);
    if (!videos.length) return null;
    const { video, box } = videos[0];
    let target = video;
    for (let parent = video.parentElement; parent && parent !== document.body; parent = parent.parentElement) {
      const outer = parent.getBoundingClientRect();
      if (Math.abs(outer.width - box.width) > 25 || Math.abs(outer.height - box.height) > 32) break;
      target = parent;
    }
    return target;
  }

  function mount(panel, showButton, toast) {
    let target, locator, targetWindow, original, open = false, scheduled = 0;
    let dockWidth = 0;
    let below = false;
    let spacer;
    const properties = ["width", "max-width", "min-width", "translate"];
    const observer = new ResizeObserver(() => schedule());

    function restore() {
      if (!original) return;
      for (const [key, value, priority] of original) {
        if (value) target.style.setProperty(key, value, priority);
        else target.style.removeProperty(key);
      }
      original = undefined;
    }

    function attach(next) {
      if (next === target) return;
      restore();
      observer.disconnect();
      target = next;
      if (target?.parentElement) observer.observe(target.parentElement);
    }

    function position() {
      const box = target?.getBoundingClientRect();
      const usable = box && !document.fullscreenElement && box.width > 0 && box.height > 0;
      panel.hidden = !open || !usable;
      showButton.hidden = open || !usable;
      toast.style.visibility = usable ? "visible" : "hidden";
      if (!open || !usable || !below) {
        spacer?.remove();
        spacer = undefined;
      }
      if (!usable) return;
      const railLeft = Math.round(box.right);
      if (open && below) {
        if (!spacer && document.body) {
          spacer = document.createElement("div");
          spacer.style.setProperty("height", "308px", "important");
          spacer.setAttribute("aria-hidden", "true");
          document.body.append(spacer);
        }
        Object.assign(panel.style, { position: "fixed", left: `${Math.max(0, box.left)}px`,
          top: `${box.bottom + 8}px`, width: `${Math.min(box.width, window.innerWidth)}px`, height: "300px" });
      } else if (open) {
        Object.assign(panel.style, { position: "fixed", left: `${railLeft}px`,
          top: `${box.top}px`, width: `${dockWidth}px`, height: `${box.height}px` });
      }
      const right = Math.min(window.innerWidth, box.right);
      const top = Math.max(8, box.top + 12);
      const middle = (Math.max(0, box.left) + right) / 2;
      Object.assign(showButton.style, { left: `${middle}px`, top: `${top}px` });
      Object.assign(toast.style, { right: `${window.innerWidth - right + 14}px`, top: `${top + 44}px`,
        maxWidth: `${Math.max(140, Math.min(box.width - 28, 340))}px` });
    }

    function layout() {
      if (target && !target.isConnected) attach(null);
      if (!target && locator) attach(findTarget(locator, targetWindow));
      restore();
      dockWidth = 0;
      below = false;
      if (target && open && !document.fullscreenElement) {
        const box = target.getBoundingClientRect();
        const available = Math.min(box.width, window.innerWidth - Math.max(0, box.left));
        if (available >= 690) {
          dockWidth = Math.min(340, Math.max(250, Math.round(available * 0.27)));
          const css = getComputedStyle(target);
          const border = css.boxSizing === "border-box" ? 0 :
            ["paddingLeft", "paddingRight", "borderLeftWidth", "borderRightWidth"]
              .reduce((sum, key) => sum + (parseFloat(css[key]) || 0), 0);
          original = properties.map(key => [key, target.style.getPropertyValue(key), target.style.getPropertyPriority(key)]);
          const width = `${Math.max(0, Math.floor(available - dockWidth - border))}px`;
          target.style.setProperty("width", width, "important");
          target.style.setProperty("max-width", width, "important");
          target.style.setProperty("min-width", "0", "important");
          const resized = target.getBoundingClientRect();
          const shift = Math.max(0, resized.right + dockWidth - Math.min(box.right, window.innerWidth));
          if (shift) target.style.setProperty("translate", `${-Math.ceil(shift)}px 0`, "important");
          const fitted = target.getBoundingClientRect();
          if (fitted.width > available - dockWidth + 4 || fitted.left < -4 ||
              fitted.right + dockWidth > window.innerWidth + 4) {
            restore();
            below = true;
          }
        } else {
          below = true;
        }
      }
      position();
    }

    function schedule() {
      if (scheduled) return;
      scheduled = requestAnimationFrame(() => {
        scheduled = 0;
        layout();
      });
    }

    window.addEventListener("resize", schedule);
    window.addEventListener("scroll", position, { capture: true, passive: true });
    document.addEventListener("fullscreenchange", layout);
    window.addEventListener("message", event => {
      if (!locator?.embedded || !locator.key || event.data?.pegPartyDockKey !== locator.key) return;
      const frame = findTarget(locator, event.source);
      if (!frame) return;
      targetWindow = event.source;
      attach(frame);
      layout();
    });

    return {
      configure(value) {
        if (locator?.key !== value.key || locator?.url !== value.url || locator?.embedded !== value.embedded) {
          targetWindow = null;
          attach(null);
        }
        locator = value;
        layout();
      },
      show(value) { open = value; layout(); },
      reset() { open = false; locator = targetWindow = null; attach(null); position(); }
    };
  }

  globalThis.pegPartyChatLayout = { mount };
})();
