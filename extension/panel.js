const get = id => document.getElementById(id);
const { LOCAL_RELAY, watchPage, relayOrigin, parseInvite, inviteLink } = pegPartyLinks;
const defaultRelay = relayOrigin(globalThis.PEGPARTY_DEFAULT_RELAY);
let tab, context, player, room;
let refreshId = 0;
let scanning = false;
let busy = false;

function status(message) { get("room-status").textContent = message; }
function playerStatus(message) { get("player-status").textContent = message; }

function render() {
  const movie = Boolean(context?.movie);
  get("player-section").hidden = !movie;
  get("setup").hidden = Boolean(room);
  get("session").hidden = !room;
  get("pair").hidden = !context?.setup;
  get("create").hidden = !movie || Boolean(context.invite);
  get("join").hidden = !context?.invite;
  get("create").disabled = get("join").disabled = !player || busy || scanning;
  get("scan").disabled = get("allow").disabled = busy || scanning;
  get("pair").disabled = busy;
  get("leave").disabled = get("resync").disabled = busy;
  if (room) get("members").textContent = room.social ?
    `${room.members} connected · Shared controls` : `${room.members} connected · Chat requires the relay update`;
}

async function refresh(nextTab = tab) {
  if (!nextTab) return;
  const id = ++refreshId;
  if (tab?.id !== nextTab.id) {
    player = null;
    context = null;
    tab = nextTab;
    render();
  }
  const inviteKey = `invite-${tab.id}`;
  const roomKey = `party-${tab.id}`;
  const [frame, invites, settings] = await Promise.all([
    chrome.webNavigation.getFrame({ tabId: tab.id, frameId: 0 }).catch(() => null),
    chrome.storage.session.get([inviteKey, roomKey]),
    chrome.storage.local.get("relay")
  ]);
  if (id !== refreshId || !frame) return;
  const url = new URL(frame.url);
  const embeddedInvite = parseInvite(url.href);
  const movie = watchPage(url) ? embeddedInvite?.movie ?? url.href : null;
  const storedInvite = invites[inviteKey];
  const invite = embeddedInvite ?? (storedInvite?.movie === movie ? storedInvite : null);
  const setup = url.pathname === "/pegparty/setup" ? relayOrigin(url.origin) : null;
  const relay = url.origin === LOCAL_RELAY ? LOCAL_RELAY : defaultRelay || relayOrigin(settings.relay) || LOCAL_RELAY;

  room = invites[roomKey]?.movie === movie ? invites[roomKey] : null;
  if (movie !== context?.movie) player = null;
  context = { movie, invite, setup, relay };
  if (room) {
    status(room.status);
  } else {
    status(setup ? "Connect this browser to the relay to create parties." :
      invite ? "This invite is ready. Start the movie and join the party." :
      movie ? "Create a party and share the invite link." :
      "Open a 67movies watch page or a PegParty invite.");
  }
  render();
  if (room?.player) {
    player = room.player;
    playerStatus(`Connected to ${new URL(player.url).hostname || "embedded player"}.`);
  } else if (movie && !player) await scan();
}

async function scan() {
  if (busy || scanning || !context?.movie) return;
  const movie = context.movie;
  const tabId = tab.id;
  scanning = true;
  render();
  playerStatus("Looking for the video…");
  get("permission-row").hidden = true;
  try {
    const found = await findPlayer(tabId, movie);
    if (movie !== context?.movie || tabId !== tab?.id) return;
    const { denied } = found;
    player = found.player;
    if (room && player) await message("pegparty-player", { movie, player });
    get("origins").replaceChildren(...denied.map(value =>
      new Option(new URL(value.replace("/*", "/")).hostname, value)
    ));
    get("permission-row").hidden = denied.length === 0;
    playerStatus(player ? `Connected to ${new URL(player.url).hostname || "embedded player"}.` :
      denied.length ? "Start the video, then allow the domain hosting your player." :
      "Start the video, then click Find player. If needed, try another playback server.");
  } catch (error) {
    if (movie === context?.movie && tabId === tab?.id) playerStatus(error.message);
  } finally {
    scanning = false;
    render();
    if (movie !== context?.movie || tabId !== tab?.id) scan();
  }
}

async function allowRelay(origin) {
  const host = pattern(new URL(origin));
  const builtIn = chrome.runtime.getManifest().host_permissions.includes(host);
  if (!builtIn && !await chrome.permissions.request({ origins: [host] })) {
    throw new Error("Allow access to the party connection to continue.");
  }
  const health = await request(origin, "/health");
  if (health.service !== "PegParty" || health.protocol !== 2) {
    throw new Error("Start the PegParty relay from the new ZIP before creating or joining a party.");
  }
}

async function pair() {
  const origin = context?.setup;
  if (!origin || busy) return;
  busy = true;
  render();
  try {
    await allowRelay(origin);
    await chrome.storage.local.set({ relay: origin });
    status("Connected. Open a movie and click Create party.");
  } catch (error) {
    status(error.message);
  } finally {
    busy = false;
    render();
  }
}

async function message(type, data = {}) {
  const response = await chrome.runtime.sendMessage({ type, tabId: tab.id, ...data });
  if (!response?.ok) throw new Error(response?.error || "PegParty could not complete that action.");
}

async function start(action) {
  if (!player || busy || scanning || room) return;
  const selected = player;
  const { movie, invite, relay } = context;
  const origin = action === "join" ? invite.relay : relay;
  busy = true;
  render();
  try {
    await allowRelay(origin);
    if (selected !== player || movie !== context?.movie) throw new Error("The watch page changed. Try again.");
    await message("pegparty-start", { action, movie, origin, code: invite?.code, player: selected });
  } catch (error) {
    status(origin === LOCAL_RELAY && movie !== `${LOCAL_RELAY}/demo` ?
      `${error.message} For remote parties, open your public relay’s /pegparty/setup page first.` : error.message);
  } finally {
    busy = false;
    render();
  }
}

get("scan").onclick = scan;
get("allow").onclick = async () => {
  const origin = get("origins").value;
  if (!origin) return;
  try {
    if (await chrome.permissions.request({ origins: [origin] })) await scan();
    else playerStatus("Player access was declined.");
  } catch (error) { playerStatus(error.message); }
};
get("pair").onclick = pair;
get("create").onclick = () => start("create");
get("join").onclick = () => start("join");
get("leave").onclick = () => {
  message("pegparty-leave").catch(error => status(error.message));
};
get("resync").onclick = () => {
  message("pegparty-resync").catch(error => status(error.message));
};
get("copy").onclick = async () => {
  if (!room) return;
  const link = inviteLink(room.movie, room.origin, room.code);
  try {
    await navigator.clipboard.writeText(link);
    status("Invite link copied.");
  } catch {
    const input = get("invite-link");
    input.value = link;
    input.hidden = false;
    input.select();
  }
};

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "session" || !tab) return;
  const partyChange = changes[`party-${tab.id}`];
  if (partyChange) {
    const wasInParty = Boolean(room);
    room = partyChange.newValue;
    if (room) {
      if (room.player) player = room.player;
      status(room.status);
    } else if (wasInParty) {
      get("invite-link").hidden = true;
      status("The party ended in this tab.");
    }
    render();
  }
  if (changes[`invite-${tab.id}`]) refresh().catch(error => status(error.message));
});
function onNavigation(details) {
  if (details.tabId === tab?.id && details.frameId === 0) refresh().catch(error => status(error.message));
}
chrome.webNavigation.onCompleted.addListener(onNavigation);
chrome.webNavigation.onHistoryStateUpdated.addListener(onNavigation);
chrome.webNavigation.onReferenceFragmentUpdated.addListener(onNavigation);

async function findActiveTab() {
  const [active] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (active) await refresh(active);
}
findActiveTab().catch(error => status(error.message));
