(() => {
  if (globalThis.pegPartyChat) return;

  const host = document.createElement("pegparty-chat");
  host.hidden = true;
  const root = host.attachShadow({ mode: "closed" });
  const styles = new CSSStyleSheet();
  styles.replaceSync(`
    :host { all: initial; color-scheme: dark; position: fixed; z-index: 2147483647; inset: 0 auto auto 0; width: 0; height: 0; color: #f2effa; font: 14px/1.45 system-ui, sans-serif; }
    :host([hidden]), [hidden] { display: none !important; }
    * { box-sizing: border-box; }
    section { position: fixed; display: flex; flex-direction: column; background: #171824; border: 1px solid #48405b; border-radius: 15px; overflow: hidden;
      box-shadow: 0 10px 40px #0008; }
    header, form { flex: 0 0 auto; display: flex; align-items: center; gap: 8px; padding: 10px; }
    header { background: #242032; border-bottom: 1px solid #48405b; }
    header strong { flex: 1; }
    button, input { font: inherit; color: inherit; border: 1px solid #5a506c; border-radius: 7px; padding: 6px 8px; }
    button { background: #332d44; cursor: pointer; font-weight: 600; }
    button:disabled { opacity: .55; cursor: default; }
    button:focus-visible, input:focus-visible { outline: 2px solid #c3a6ff; outline-offset: 2px; }
    .feed { overflow: auto; flex: 1; min-height: 0; padding: 8px 12px; }
    .feed p { margin: 5px 0; white-space: pre-wrap; overflow-wrap: anywhere; }
    .activity { color: #b8b3c9; font-size: 12px; }
    .time { color: #aea8bd; margin-right: 7px; font-variant-numeric: tabular-nums; }
    .name { font-weight: 700; }
    .roster { padding: 6px 12px; max-height: min(156px, 24vh); overflow: auto; border-bottom: 1px solid #48405b; }
    .member { display: flex; gap: 8px; align-items: center; margin: 5px 0; overflow-wrap: anywhere; }
    .avatar { width: 28px; height: 28px; display: grid; place-items: center; background: #3d3450;
      border-radius: 50%; overflow: hidden; flex: 0 0 auto; font-weight: 700; }
    .avatar canvas { width: 100%; height: 100%; object-fit: cover; }
    form { border-top: 1px solid #48405b; }
    input { background: #11121b; flex: 1; min-width: 0; }
    form button { background: #bc9df8; color: #20122e; }
    .show, .toast { position: fixed; background: #171824ed; border: 1px solid #5a506c; box-shadow: 0 3px 14px #0007; }
    .show, .fullscreen { border-radius: 6px 0 0 6px; width: 32px; height: 36px;
      padding: 0; text-align: center; font-size: 21px; }
    .fullscreen { position: fixed; background: #171824ed; font-size: 16px; }
    .toast { pointer-events: none; padding: 9px 12px; border-radius: 9px; overflow-wrap: anywhere; }
    .status { padding: 0 10px 8px; margin: 0; color: #b8b3c9; font-size: 12px; }
  `);
  root.adoptedStyleSheets = [styles];

  function make(parent, tag, text, className) {
    const element = document.createElement(tag);
    if (text) element.textContent = text;
    if (className) element.className = className;
    parent.append(element);
    return element;
  }

  const panel = make(root, "section");
  panel.hidden = true;
  const reveal = make(root, "button", "‹", "show");
  reveal.hidden = true;
  const toast = make(root, "div", "", "toast");
  toast.hidden = true;
  const fullscreen = make(root, "button", "⛶", "fullscreen");
  fullscreen.hidden = true;
  const layout = globalThis.pegPartyChatLayout.mount(host, panel, reveal, toast, fullscreen);
  panel.setAttribute("aria-label", "PegParty chat");
  const header = make(panel, "header");
  make(header, "strong", "PegParty chat");
  const members = make(header, "button", "Members");
  members.setAttribute("aria-expanded", "false");
  const hide = make(header, "button", "Hide chat");
  const roster = make(panel, "div", "", "roster");
  roster.hidden = true;
  const feed = make(panel, "div", "", "feed");
  feed.setAttribute("role", "log");
  feed.setAttribute("aria-label", "Chat and party activity");
  const form = make(panel, "form");
  const input = make(form, "input");
  input.maxLength = 500;
  input.placeholder = "Write a message…";
  input.setAttribute("aria-label", "Chat message");
  const send = make(form, "button", "Send");
  send.type = "submit";
  const status = make(panel, "p", "", "status");
  status.setAttribute("role", "status");
  status.hidden = true;

  let timer, toastTimer;
  let open = false;
  let visibilityChange = 0;
  let savingVisibility = false;
  let reading = false;
  let room, cursor, rosterVersion;
  document.documentElement.append(host);

  function toggle(show) {
    open = show;
    reveal.textContent = show ? "›" : "‹";
    reveal.title = show ? "Hide chat" : "Show chat";
    reveal.setAttribute("aria-label", reveal.title);
    reveal.setAttribute("aria-expanded", String(show));
    layout.show(show);
    if (show) feed.scrollTop = feed.scrollHeight;
  }

  async function changeVisibility(show) {
    const change = ++visibilityChange;
    savingVisibility = true;
    toggle(show);
    try {
      await chrome.runtime.sendMessage({ type: "pegparty-chat-visibility", open: show });
    } finally {
      if (change === visibilityChange) savingVisibility = false;
    }
  }

  reveal.onclick = () => changeVisibility(!open).catch(error => showStatus(error.message));
  hide.onclick = () => changeVisibility(false).catch(error => showStatus(error.message));
  fullscreen.onclick = () => layout.fullscreen().catch(error => showStatus(error.message));
  members.onclick = () => {
    roster.hidden = !roster.hidden;
    members.setAttribute("aria-expanded", String(!roster.hidden));
  };
  panel.addEventListener("keydown", event => {
    event.stopPropagation();
    if (event.key === "Escape" && !document.fullscreenElement) hide.onclick();
  });

  function colored(parent, text, color) {
    const label = make(parent, "span", text, "name");
    if (/^#[a-f0-9]{6}$/i.test(color)) label.style.color = color;
  }

  function renderRoster(list) {
    roster.replaceChildren();
    members.textContent = `Members (${list.length})`;
    for (const member of list) {
      const row = make(roster, "div", "", "member");
      const avatar = make(row, "span", "", "avatar");
      avatar.textContent = [...member.name][0]?.toUpperCase() || "?";
      if (/^data:image\/webp;base64,[A-Za-z0-9+/]+={0,2}$/.test(member.avatar)) {
        const bytes = Uint8Array.from(atob(member.avatar.slice("data:image/webp;base64,".length)),
          character => character.charCodeAt(0));
        createImageBitmap(new Blob([bytes], { type: "image/webp" })).then(bitmap => {
          try {
            const canvas = document.createElement("canvas");
            canvas.width = canvas.height = 56;
            canvas.getContext("2d").drawImage(bitmap, 0, 0, 56, 56);
            avatar.replaceChildren(canvas);
          } finally {
            bitmap.close();
          }
        }).catch(() => {});
      }
      colored(row, member.name, member.color);
    }
  }

  function timestamp(seconds) {
    const whole = Math.max(0, Math.floor(seconds));
    const hrs = Math.floor(whole / 3600);
    const mins = Math.floor(whole % 3600 / 60);
    const secs = String(whole % 60).padStart(2, "0");
    return hrs ? `${hrs}:${String(mins).padStart(2, "0")}:${secs}` : `${mins}:${secs}`;
  }

  function appendEvent(event) {
    const row = make(feed, "p", "", event.type === "chat" ? "" : "activity");
    make(row, "span", new Date(event.at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }), "time");
    colored(row, event.name, event.color);
    const labels = {
      join: " joined the party", leave: " left the party", disconnect: " disconnected",
      play: " resumed playback", pause: " paused playback",
      seek: ` skipped to ${timestamp(event.value)}`, rate: ` changed speed to ${event.value}×`
    };
    row.append(document.createTextNode(event.type === "chat" ? `: ${event.message}` : labels[event.type] || ""));
  }

  function showStatus(text) {
    status.textContent = text;
    status.hidden = !text;
  }

  async function refresh() {
    if (reading || host.hidden) return;
    reading = true;
    const visibilityAtRequest = visibilityChange;
    const mayApplyVisibility = !savingVisibility;
    try {
      const response = await chrome.runtime.sendMessage({
        type: "pegparty-chat-state", after: cursor, rosterVersion, room
      });
      if (host.hidden) return;
      if (response?.ended) {
        room = cursor = rosterVersion = undefined;
        feed.replaceChildren();
        renderRoster([]);
        showStatus("This party has ended.");
        input.disabled = send.disabled = true;
        clearInterval(timer);
        clearTimeout(toastTimer);
        toast.hidden = true;
        host.hidden = true;
        layout.reset();
        return;
      }
      if (!response || response.error) throw new Error(response?.error || "Could not load chat.");
      const changed = room !== response.room;
      if (changed) {
        feed.replaceChildren();
        showStatus("");
      }
      if (mayApplyVisibility && visibilityAtRequest === visibilityChange && typeof response.open === "boolean" &&
          response.open !== open) toggle(response.open);
      layout.refresh();
      room = response.room;
      cursor = response.cursor;
      rosterVersion = response.rosterVersion;
      if (response.roster) renderRoster(response.roster);
      const following = changed || feed.scrollHeight - feed.scrollTop - feed.clientHeight < 40;
      for (const event of response.events) appendEvent(event);
      const incoming = changed ? null : response.events.findLast(event =>
        event.type === "chat" && event.memberId !== response.self);
      if (incoming) {
        toast.replaceChildren();
        colored(toast, incoming.name, incoming.color);
        const preview = incoming.message.length > 110 ? incoming.message.slice(0, 110) + "…" : incoming.message;
        toast.append(document.createTextNode(`: ${preview}`));
        toast.hidden = false;
        clearTimeout(toastTimer);
        toastTimer = setTimeout(() => { toast.hidden = true; }, 4500);
      }
      while (feed.childElementCount > 100) feed.firstElementChild.remove();
      if (following) feed.scrollTop = feed.scrollHeight;
      input.disabled = false;
      if (!submitting) send.disabled = false;
    } catch (error) {
      showStatus(error.message);
    } finally {
      reading = false;
    }
  }

  let submitting = false;
  form.onsubmit = async event => {
    event.preventDefault();
    const value = input.value.trim();
    if (!value || submitting) return;
    submitting = true;
    send.disabled = true;
    try {
      const response = await chrome.runtime.sendMessage({ type: "pegparty-send-chat", value });
      if (!response?.ok) throw new Error(response?.error || "This party has ended.");
      if (input.value.trim() === value) input.value = "";
      showStatus("");
      refresh();
    } catch (error) {
      showStatus(error.message);
    } finally {
      submitting = false;
      send.disabled = input.disabled;
    }
  };

  globalThis.pegPartyChat = {
    configure({ locator, fullscreenOnly, open }) {
      layout.configure(locator, fullscreenOnly);
      if (host.hidden) {
        host.hidden = false;
        toggle(open);
        refresh();
        timer = setInterval(refresh, 650);
      }
      return true;
    }
  };
})();
