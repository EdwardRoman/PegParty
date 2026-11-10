importScripts("links.js", "relay-client.js", "player-access.js");

const rooms = new Map();
const starting = new Set();
const watchdog = "pegparty-watchdog";
const syncInterval = 325;
const roomKey = tabId => `party-${tabId}`;

const ready = chrome.storage.session.get(null).then(saved => {
  for (const [key, session] of Object.entries(saved)) {
    if (!key.startsWith("party-")) continue;
    const entry = track(session);
    schedule(entry, 0);
  }
  if (rooms.size) return ensureWatchdog();
});

function track(session) {
  const entry = { session, write: Promise.resolve(), active: true };
  rooms.set(session.tabId, entry);
  return entry;
}

function updateSocial(session, data) {
  if (!data || (session.social?.cursor === data.cursor &&
      session.social?.rosterVersion === data.rosterVersion)) return false;
  const previous = session.social;
  session.social = {
    cursor: data.cursor, rosterVersion: data.rosterVersion,
    roster: data.roster ?? previous?.roster ?? [],
    events: [...(previous?.events ?? []), ...data.events].slice(-100)
  };
  return true;
}

async function attachChat(entry) {
  const { session } = entry;
  if (!session.social || !entry.active) return;
  const selected = session.player?.documentId ?? null;
  if (entry.chatDocument === selected) return;
  if (entry.chatConnecting) return entry.chatConnecting;
  entry.chatConnecting = (async () => {
    const frames = await chrome.webNavigation.getAllFrames({ tabId: session.tabId });
    const frame = frames?.find(item => item.documentId === selected);
    let outer = frame;
    while (outer?.frameId && outer.parentFrameId > 0) {
      const parent = frames.find(item => item.frameId === outer.parentFrameId);
      if (!parent) break;
      outer = parent;
    }
    const locator = outer ? { embedded: Boolean(outer.frameId), url: outer.url, key: outer.documentId } :
      { pending: true };
    const top = frames?.find(item => item.frameId === 0);
    if (!top) return;
    const stillCurrent = () => entry.active && (session.player?.documentId ?? null) === selected;
    if (!stillCurrent()) return;
    async function mount(documentId, view, fullscreenOnly) {
      const target = { tabId: session.tabId, documentIds: [documentId] };
      await chrome.scripting.executeScript({ target, files: ["chat-layout.js", "chat.js"] });
      if (!stillCurrent()) return false;
      // Configure in the exact isolated world that was just injected.
      return execute(options => globalThis.pegPartyChat?.configure(options),
        [{ locator: view, fullscreenOnly, open: Boolean(session.chatOpen) }], { tabId: session.tabId, documentId });
    }
    if (!await mount(top.documentId, locator, false)) return;
    if (locator.embedded) {
      await mount(selected, { embedded: false, key: selected }, true).catch(() => {});
      await execute(key => window.parent.postMessage({ pegPartyDockKey: key }, "*"),
        [locator.key], { tabId: session.tabId, documentId: outer.documentId }).catch(() => {});
    }
    if (stillCurrent()) entry.chatDocument = frame ? selected : null;
  })();
  try {
    return await entry.chatConnecting;
  } finally {
    entry.chatConnecting = null;
  }
}

async function ensureWatchdog() {
  if (!await chrome.alarms.get(watchdog)) {
    await chrome.alarms.create(watchdog, { periodInMinutes: 1 });
  }
}

function save(entry) {
  const snapshot = structuredClone(entry.session);
  const key = roomKey(snapshot.tabId);
  entry.write = entry.write.catch(() => {}).then(() => chrome.storage.session.set({ [key]: snapshot }));
  return entry.write;
}

function schedule(entry, delay = syncInterval) {
  if (!entry.active || entry.ticking) return;
  clearTimeout(entry.timer);
  entry.timer = setTimeout(() => tick(entry).catch(console.error), delay);
}

function leaveRelay({ origin, code, token }) {
  return api(origin, "leave", { code, token }).catch(() => {});
}

async function stop(entry) {
  if (!entry?.active) return;
  entry.active = false;
  clearTimeout(entry.timer);
  const { session } = entry;
  if (session.player) execute(id => globalThis.pegPartyPlayer?.release(id), [session.session], session.player)
    .catch(() => {});
  const departure = leaveRelay(session);
  try {
    await entry.write.catch(() => {});
    await chrome.storage.session.remove(roomKey(session.tabId));
  } finally {
    rooms.delete(session.tabId);
    await departure;
  }
}

function movieUrl(url) {
  return pegPartyLinks.parseInvite(url)?.movie ?? new URL(url).href;
}

async function currentMovie(tabId) {
  const frame = await chrome.webNavigation.getFrame({ tabId, frameId: 0 }).catch(() => null);
  return frame ? movieUrl(frame.url) : null;
}

async function start({ tabId, movie, origin, action, code, player }) {
  if (rooms.has(tabId) || starting.has(tabId)) throw new Error("A party is already open in this tab.");
  if (!pegPartyLinks.relayOrigin(origin) || !pegPartyLinks.watchPage(new URL(movie)) ||
      !["create", "join"].includes(action) || player?.tabId !== tabId) {
    throw new Error("Open the movie tab and try again.");
  }
  starting.add(tabId);
  try {
    if (await currentMovie(tabId) !== movie) throw new Error("The watch page changed. Reopen PegParty.");
    const state = await execute(() => globalThis.pegPartyPlayer?.read(), [], player).catch(() => null);
    if (!state) throw new Error("Start the video and find its player again.");
    const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(movie));
    const title = Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, "0")).join("");
    const { profile } = await chrome.storage.local.get("profile");
    const data = await api(origin, action, {
      title, profile, social: {}, ...(action === "join" ? { code } : { state })
    });
    if (await currentMovie(tabId) !== movie || Math.abs(state.duration - data.state.duration) > 5) {
      await leaveRelay({ origin, code: data.code, token: data.token });
      throw new Error("The player changed or has a different video length. Check the playback server.");
    }
    const entry = track({
      tabId, movie, origin, code: data.code, token: data.token, player,
      session: crypto.randomUUID(), commands: [], nextId: 1, resync: 0, members: data.members,
      status: action === "join" ? "Joined the party." : "Party created. Copy the invite link to share it."
    });
    updateSocial(entry.session, data.social);
    entry.session.self = data.social?.roster?.at(-1)?.id;
    try {
      await save(entry);
      await ensureWatchdog();
    } catch (error) {
      await stop(entry);
      throw error;
    }
    if (action === "join") chrome.action.setBadgeText({ tabId, text: "" }).catch(() => {});
    schedule(entry, 0);
  } finally {
    starting.delete(tabId);
  }
}

async function tick(entry) {
  if (!entry.active || entry.ticking) return;
  entry.ticking = true;
  const session = entry.session;
  const command = session.commands[0];
  let dirty = false;
  let delay = syncInterval;
  function updateStatus(text) {
    if (session.status === text) return;
    session.status = text;
    dirty = true;
  }
  try {
    await entry.write;
    if (!entry.active) return;
    const sent = performance.now();
    const social = { after: session.social?.cursor, rosterVersion: session.social?.rosterVersion };
    const data = await api(session.origin, "sync", { code: session.code, token: session.token, command, social });
    if (!entry.active) return;
    if (updateSocial(session, data.social)) dirty = true;
    if (command) {
      session.commands.shift();
      dirty = true;
    }
    if (data.members !== session.members) {
      session.members = data.members;
      dirty = true;
    }
    if (session.commands.length) {
      delay = 0;
      return;
    }
    const { state, revision } = data;
    const roundTrip = performance.now() - sent;
    entry.roundTrips ??= [];
    entry.roundTrips.push(roundTrip);
    if (entry.roundTrips.length > 8) entry.roundTrips.shift();
    const latency = Math.min(Math.min(...entry.roundTrips) / 2000, 0.5);
    const position = state.position + (state.paused ? 0 : latency * state.rate);
    const sampledAt = Date.now();
    if (!session.player && performance.now() >= (entry.scanAfter ?? 0)) {
      entry.scanAfter = performance.now() + 2500;
      if (await currentMovie(session.tabId) !== session.movie) {
        await stop(entry);
        return;
      }
      const found = await findPlayer(session.tabId, session.movie);
      if (!entry.active) return;
      if (!session.player && found.player) {
        session.player = found.player;
        session.resync++;
        dirty = true;
      }
    }
    if (session.commands.length) {
      delay = 0;
      return;
    }
    const selected = session.player;
    attachChat(entry).catch(() => {});
    const outcome = selected && await execute(settings => globalThis.pegPartyPlayer?.apply(settings),
      [{ ...state, position, sampledAt, revision, session: session.session, resync: session.resync }], selected)
      .catch(() => "missing");
    if (!entry.active || selected !== session.player) return;
    switch (outcome) {
      case "blocked": updateStatus("Press Play once on the video itself to allow playback."); break;
      case "different-video": updateStatus("This video has a different length. Try the same playback server."); break;
      case "waiting": updateStatus("Waiting for the video to finish seeking."); break;
      case "missing":
      case undefined:
      case null:
        if (session.player) {
          session.player = null;
          dirty = true;
        }
        updateStatus("Still in the party. Waiting for the player to reconnect.");
        break;
      default: updateStatus("Synced. Anyone in the party can control playback.");
    }
  } catch (error) {
    if (!entry.active) return;
    if (error.status === 404 || error.status === 403) {
      await stop(entry);
    } else {
      if (error.status === 400 && command) {
        session.commands.shift();
        dirty = true;
      }
      updateStatus(error.message);
    }
  } finally {
    entry.ticking = false;
    if (entry.active) {
      if (dirty) save(entry).catch(console.error);
      schedule(entry, delay);
    }
  }
}

async function handlePopup(message) {
  await ready;
  if (message.type === "pegparty-start") return start(message);
  if (message.type === "pegparty-profile") {
    const { name, color, avatar } = message.profile;
    if (typeof name !== "string" || name.length > 32 || !/^#[a-f0-9]{6}$/i.test(color) ||
        typeof avatar !== "string" || avatar.length > 14_000 ||
        (avatar && !avatar.startsWith("data:image/webp;base64,"))) {
      throw new Error("Invalid profile.");
    }
    const profile = { name: name.trim(), color, avatar };
    await chrome.storage.local.set({ profile });
    await Promise.all([...rooms.values()].filter(entry => entry.active && entry.session.social)
      .map(entry => queue(entry, "profile", profile)));
    return;
  }
  const entry = rooms.get(message.tabId);
  if (!entry?.active) return;
  if (message.type === "pegparty-toggle-chat") {
    if (!entry.session.social) throw new Error("The relay needs the PegParty chat update.");
    entry.session.chatOpen = !entry.session.chatOpen;
    await save(entry);
    await attachChat(entry);
    if (entry.chatDocument === undefined) {
      throw new Error("Chat is still connecting. It will open when the page is ready.");
    }
  }
  if (message.type === "pegparty-leave") return stop(entry);
  if (message.type === "pegparty-resync") {
    entry.session.resync++;
    await save(entry);
    schedule(entry, 0);
  }
  if (message.type === "pegparty-player" && message.player?.tabId === message.tabId &&
      message.movie === entry.session.movie) {
    entry.session.player = message.player;
    entry.session.resync++;
    await save(entry);
    schedule(entry, 0);
  }
}

async function queue(entry, type, value) {
  if (entry.session.commands.length >= 100) throw new Error("The relay is behind. Try again in a moment.");
  const session = entry.session;
  session.commands.push({ id: session.nextId++, type, value });
  await save(entry);
  schedule(entry, 0);
}

async function handlePlayer({ command }, sender) {
  await ready;
  const entry = rooms.get(sender.tab?.id);
  if (!entry?.active || !entry.session.player || sender.documentId !== entry.session.player.documentId ||
      !["play", "pause", "seek", "rate"].includes(command?.type) || !Number.isFinite(command.value)) return;
  await queue(entry, command.type, command.value);
}

async function handleChat(message, sender) {
  await ready;
  const entry = rooms.get(sender.tab?.id);
  if (!sender.url || !entry?.active || !entry.session.social) return { ended: true };
  const sameMovie = sender.frameId === 0 ? movieUrl(sender.url) === entry.session.movie :
    sender.documentId === entry.session.player?.documentId;
  if (!sameMovie) return { ended: true };
  if (message.type === "pegparty-chat-visibility") {
    entry.session.chatOpen = Boolean(message.open);
    await save(entry);
    return { ok: true };
  }
  if (message.type === "pegparty-send-chat") {
    const value = typeof message.value === "string" ? message.value.trim() : "";
    if (!value || value.length > 500) throw new Error("Enter a message up to 500 characters.");
    await queue(entry, "chat", value);
    return { ok: true };
  }
  const { cursor, rosterVersion, roster, events } = entry.session.social;
  return {
    cursor, rosterVersion, room: entry.session.session, self: entry.session.self,
    open: Boolean(entry.session.chatOpen),
    ...(message.room !== entry.session.session || message.rosterVersion !== rosterVersion ? { roster } : {}),
    events: events.filter(event => message.room !== entry.session.session || event.id > (message.after ?? 0))
  };
}

async function handleInvite(invite, sender) {
  if (!invite || sender.frameId !== 0 || !sender.tab || !sender.url ||
      !pegPartyLinks.watchPage(new URL(sender.url)) || !pegPartyLinks.relayOrigin(invite.relay) ||
      !/^[A-F0-9]{12}$/.test(invite.code)) return;
  await chrome.storage.session.set({ [`invite-${sender.tab.id}`]: invite });
  await chrome.action.setBadgeBackgroundColor({ color: "#7554C9", tabId: sender.tab.id });
  await chrome.action.setBadgeText({ text: "JOIN", tabId: sender.tab.id });
}

chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (message.type === "pegparty-invite") {
    handleInvite(message.invite, sender).catch(() => {});
    return;
  }
  if (message.type === "pegparty-command") {
    handlePlayer(message, sender).catch(console.error);
    return;
  }
  if (["pegparty-chat-state", "pegparty-send-chat", "pegparty-chat-visibility"].includes(message.type)) {
    handleChat(message, sender).then(respond, error => respond({ error: error.message }));
    return true;
  }
  if (sender.url !== chrome.runtime.getURL("panel.html")) return;
  handlePopup(message).then(() => respond({ ok: true }), error => respond({ error: error.message }));
  return true;
});

chrome.tabs.onRemoved.addListener(tabId => {
  chrome.storage.session.remove(`invite-${tabId}`).catch(() => {});
  ready.then(() => stop(rooms.get(tabId))).catch(console.error);
});

function navigation(details) {
  if (details.frameId !== 0) return;
  ready.then(() => {
    const entry = rooms.get(details.tabId);
    if (entry?.active && movieUrl(details.url) !== entry.session.movie) return stop(entry);
  }).catch(console.error);
}
chrome.webNavigation.onCommitted.addListener(navigation);
chrome.webNavigation.onHistoryStateUpdated.addListener(navigation);
chrome.webNavigation.onReferenceFragmentUpdated.addListener(navigation);

chrome.alarms.onAlarm.addListener(alarm => {
  if (alarm.name !== watchdog) return;
  ready.then(() => {
    if (rooms.size === 0 && starting.size === 0) return chrome.alarms.clear(watchdog);
    for (const entry of rooms.values()) schedule(entry, 0);
  }).catch(console.error);
});
