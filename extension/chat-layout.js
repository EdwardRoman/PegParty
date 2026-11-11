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

  function hasGeometry(box) {
    return box && box.width > 0 && box.height > 0;
  }

  function intersectsViewport(box) {
    return hasGeometry(box) && box.bottom > 0 && box.top < window.innerHeight &&
      box.right > 0 && box.left < window.innerWidth;
  }

  function mount(host, panel, arrow, toast) {
    let target, locator, targetWindow, original, open = false, scheduled = 0;
    let fullscreenOnly = false, nativeTarget;
    let dockWidth = 0;
    let below = false;
    let targetVisible = false;
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
      if (target) observer.observe(target);
    }

    function position() {
      const box = target?.getBoundingClientRect();
      const full = document.fullscreenElement;
      const usable = Boolean(locator && (full
        ? !["IFRAME", "VIDEO"].includes(full.tagName)
        : !fullscreenOnly));
      const anchored = intersectsViewport(box) && (!full || full.contains(target));
      const belowPlayer = below && intersectsViewport(box);
      panel.hidden = !open || !usable;
      arrow.hidden = !usable;
      toast.style.visibility = usable ? "visible" : "hidden";
      if (!open || !usable || !belowPlayer) {
        spacer?.remove();
        spacer = undefined;
      }
      if (!usable) return;
      if (!anchored) {
        const width = Math.min(320, window.innerWidth * 0.84);
        Object.assign(panel.style, { position: "fixed", left: `${window.innerWidth - width}px`,
          top: "12px", width: `${width}px`, height: `${Math.max(140, window.innerHeight - 104)}px` });
        Object.assign(arrow.style, { right: `${open ? width : 0}px`, top: "72px" });
        Object.assign(toast.style, { right: "40px", top: "16px", maxWidth: `${width}px` });
        return;
      }
      const right = Math.min(window.innerWidth, box.right);
      const floating = full && open && !dockWidth;
      const railLeft = floating ? Math.max(0, right - Math.min(340, right * 0.4)) : Math.round(box.right);
      if (open && belowPlayer) {
        if (!spacer && document.body) {
          spacer = document.createElement("div");
          spacer.style.setProperty("height", "308px", "important");
          spacer.setAttribute("aria-hidden", "true");
          document.body.append(spacer);
        }
        Object.assign(panel.style, { position: "fixed", left: `${Math.max(0, box.left)}px`,
          top: `${box.bottom + 8}px`, width: `${Math.min(box.width, window.innerWidth)}px`, height: "300px" });
      } else if (open) {
        const panelTop = Math.max(0, box.top);
        const visibleHeight = Math.min(box.bottom, window.innerHeight) - panelTop;
        Object.assign(panel.style, { position: "fixed", left: `${railLeft}px`,
          top: `${panelTop}px`, width: `${floating ? right - railLeft : dockWidth}px`,
          height: `${floating ? Math.max(160, visibleHeight - 85) : visibleHeight}px` });
      }
      const edge = open && !belowPlayer ? railLeft : full ? right : window.innerWidth;
      const top = Math.max(8, box.top + 12);
      const arrowTop = Math.min(Math.max(8, window.innerHeight - 85),
        Math.max(top, box.top + Math.min(100, box.height * 0.3)));
      const arrowEdge = Math.min(window.innerWidth, Math.max(32, edge));
      const toastEdge = open && !belowPlayer ? railLeft : right;
      Object.assign(arrow.style, { right: `${window.innerWidth - arrowEdge}px`, top: `${arrowTop}px` });
      Object.assign(toast.style, { right: `${window.innerWidth - toastEdge + 38}px`, top: `${top}px`,
        maxWidth: `${Math.max(140, Math.min(box.width - 28, 340))}px` });
    }

    function layout() {
      const full = document.fullscreenElement;
      if (nativeTarget && nativeTarget !== full) {
        nativeTarget = null;
        attach(null);
      }
      if (target && !target.isConnected) attach(null);
      if (!target && locator && !locator.pending) attach(findTarget(locator, targetWindow));
      if (full && !["VIDEO", "IFRAME"].includes(full.tagName) && target?.contains(full) && target !== full) {
        nativeTarget = full;
        attach(full);
      }
      restore();
      targetVisible = Boolean(hasGeometry(target?.getBoundingClientRect()));
      dockWidth = 0;
      below = false;
      const mountPoint = full && !["VIDEO", "IFRAME"].includes(full.tagName) ? full : document.documentElement;
      if (host.parentElement !== mountPoint) {
        // Keep the composer's browsing context alive when entering or leaving fullscreen.
        if (host.isConnected && mountPoint.moveBefore) mountPoint.moveBefore(host, null);
        else mountPoint.append(host);
      }
      if (target && open && (!fullscreenOnly || full) && (!full || (full !== target && full.contains(target) &&
          !["VIDEO", "IFRAME"].includes(full.tagName)))) {
        const box = target.getBoundingClientRect();
        const available = Math.min(box.width, window.innerWidth - Math.max(0, box.left));
        if (intersectsViewport(box) && available >= 520) {
          dockWidth = Math.min(340, Math.max(208, Math.round(available * 0.27)));
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
            below = !full;
            dockWidth = 0;
          }
        } else {
          below = !full && intersectsViewport(box);
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
      configure(value, frameOnly) {
        fullscreenOnly = frameOnly;
        if (locator?.key !== value.key || locator?.url !== value.url || locator?.embedded !== value.embedded ||
            locator?.pending !== value.pending) {
          targetWindow = null;
          attach(null);
        }
        locator = value;
        layout();
      },
      show(value) {
        open = value;
        layout();
        if (open && below && panel.getBoundingClientRect().top > window.innerHeight - 100) {
          window.scrollBy(0, panel.getBoundingClientRect().bottom - window.innerHeight + 8);
        }
      },
      refresh() {
        if (!host.isConnected || !target?.isConnected ||
            targetVisible !== Boolean(hasGeometry(target.getBoundingClientRect()))) layout();
      },
      reset() { open = false; locator = targetWindow = null; attach(null); position(); }
    };
  }

  globalThis.pegPartyChatLayout = { mount };
})();
