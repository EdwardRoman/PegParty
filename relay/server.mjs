import { createServer } from "node:http";
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { performance } from "node:perf_hooks";

const demoPage = readFileSync(new URL("./demo.html", import.meta.url));
const demoVideo = readFileSync(new URL("./demo.webm", import.meta.url));
const setupPage = readFileSync(new URL("./setup.html", import.meta.url));
const rooms = new Map();
const timeout = 120_000;
const maxRooms = 128;
const maxMembers = 16;
const maxEvents = 100;
const maxAvatarLength = 14_000;

function reply(res, status, data) {
  res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" });
  res.end(JSON.stringify(data));
}

function fail(status, message) {
  throw Object.assign(new Error(message), { status });
}

async function payload(req) {
  let body = "";
  for await (const chunk of req) {
    body += chunk;
    if (body.length > 20_000) fail(413, "Request is too large.");
  }
  try {
    const data = JSON.parse(body);
    if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error();
    return data;
  } catch {
    fail(400, "Expected a JSON object.");
  }
}

function playbackState(value) {
  if (!value || typeof value.paused !== "boolean" ||
      !Number.isFinite(value.duration) || value.duration <= 0 || value.duration > 86_400 ||
      !Number.isFinite(value.position) || value.position < 0 || value.position > value.duration + 1 ||
      !Number.isFinite(value.rate) || value.rate < 0.25 || value.rate > 4) {
    fail(400, "The player returned an unsupported playback state.");
  }
  const { paused, duration, position, rate } = value;
  return { paused, duration, position: Math.min(duration, position), rate };
}

function clean(now) {
  for (const [code, room] of rooms) {
    for (const [token, member] of room.members) {
      if (now - member.seen > timeout) removeMember(room, token, "disconnect");
    }
    if (room.members.size === 0) rooms.delete(code);
  }
}

function currentPosition(room, now) {
  const { position, rate, duration, paused } = room.state;
  return paused ? position : Math.min(duration, position + (now - room.updated) * rate / 1000);
}

function snapshot(room, now, social) {
  const position = currentPosition(room, now);
  return {
    members: room.members.size,
    revision: room.revision,
    state: { ...room.state, position, paused: room.state.paused || position >= room.state.duration },
    ...(social && {
      social: {
        cursor: room.eventId,
        rosterVersion: room.rosterVersion,
        ...(social.rosterVersion !== room.rosterVersion && {
          roster: [...room.members.values()].map(({ id, profile }) => ({ id, ...profile }))
        }),
        events: room.events.filter(event => event.id > (social.after ?? 0))
      }
    })
  };
}

function profileOf(value, id) {
  const name = typeof value?.name === "string" ? value.name.trim().slice(0, 32) : "";
  const color = typeof value?.color === "string" && /^#[a-f0-9]{6}$/i.test(value.color) ?
    value.color : "#c3a6ff";
  let avatar = "";
  if (typeof value?.avatar === "string" && value.avatar.length <= maxAvatarLength &&
      /^data:image\/webp;base64,[A-Za-z0-9+/]+={0,2}$/.test(value.avatar)) {
    const bytes = Buffer.from(value.avatar.slice("data:image/webp;base64,".length), "base64");
    if (bytes.subarray(0, 4).toString() === "RIFF" && bytes.subarray(8, 12).toString() === "WEBP") {
      avatar = value.avatar;
    }
  }
  return { name: name || `Guest ${id.slice(0, 4)}`, color, avatar };
}

function logEvent(room, member, type, fields = {}) {
  room.events.push({
    id: ++room.eventId, at: Date.now(), type, memberId: member.id,
    name: member.profile.name, color: member.profile.color, ...fields
  });
  if (room.events.length > maxEvents) room.events.shift();
}

function addMember(room, token, now, profile) {
  const id = randomBytes(8).toString("hex");
  const member = { id, seen: now, lastCommand: 0, profile: profileOf(profile, id) };
  room.members.set(token, member);
  room.rosterVersion++;
  logEvent(room, member, "join");
}

function removeMember(room, token, reason) {
  const member = room.members.get(token);
  room.members.delete(token);
  room.rosterVersion++;
  logEvent(room, member, reason);
}

function applyCommand(room, member, command, now) {
  if (!Number.isSafeInteger(command.id) || command.id < 1) fail(400, "Invalid playback command.");
  if (command.id <= member.lastCommand) return;
  if (command.type === "chat") {
    const message = typeof command.value === "string" ? command.value.trim() : "";
    if (!message || message.length > 500) fail(400, "Messages must be 1–500 characters.");
    logEvent(room, member, "chat", { message });
    member.lastCommand = command.id;
    return;
  }
  if (command.type === "profile") {
    const profile = profileOf(command.value, member.id);
    if (JSON.stringify(profile) !== JSON.stringify(member.profile)) {
      member.profile = profile;
      room.rosterVersion++;
    }
    member.lastCommand = command.id;
    return;
  }
  const state = { ...room.state, position: currentPosition(room, now) };
  if (state.position >= state.duration) state.paused = true;
  if (command.type === "rate") {
    if (!Number.isFinite(command.value) || command.value < 0.25 || command.value > 4) {
      fail(400, "Unsupported playback speed.");
    }
    state.rate = command.value;
  } else if (["play", "pause", "seek"].includes(command.type)) {
    if (!Number.isFinite(command.value) || command.value < 0 || command.value > state.duration + 5) {
      fail(400, "Invalid playback position.");
    }
    state.position = Math.min(state.duration, command.value);
    if (command.type !== "seek") state.paused = command.type === "pause";
  } else {
    fail(400, "Unknown playback command.");
  }
  member.lastCommand = command.id;
  room.state = state;
  room.updated = now;
  room.revision++;
  logEvent(room, member, command.type, { value: command.type === "rate" ? state.rate : state.position });
}

function serveDemo(req, res) {
  if (req.url === "/demo") {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    return res.end(demoPage);
  }
  const headers = { "Content-Type": "video/webm", "Accept-Ranges": "bytes" };
  const match = /^bytes=(\d+)-(\d*)$/.exec(req.headers.range ?? "");
  if (match) {
    const start = Number(match[1]);
    const end = match[2] ? Math.min(Number(match[2]), demoVideo.length - 1) : demoVideo.length - 1;
    if (start > end || start >= demoVideo.length) {
      res.writeHead(416, { "Content-Range": `bytes */${demoVideo.length}` });
      return res.end();
    }
    res.writeHead(206, {
      ...headers, "Content-Length": end - start + 1,
      "Content-Range": `bytes ${start}-${end}/${demoVideo.length}`
    });
    return res.end(demoVideo.subarray(start, end + 1));
  }
  res.writeHead(200, { ...headers, "Content-Length": demoVideo.length });
  res.end(demoVideo);
}

const server = createServer({ requestTimeout: 10_000, headersTimeout: 8000 }, async (req, res) => {
  try {
    if (req.method === "GET" && req.url === "/health") {
      return reply(res, 200, { ok: true, service: "PegParty", protocol: 2, chat: true });
    }
    if (req.method === "GET" && req.url === "/pegparty/setup") {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
      return res.end(setupPage);
    }
    if (req.method === "GET" && ["/demo", "/demo.webm"].includes(req.url)) return serveDemo(req, res);
    if (req.method !== "POST" || !/^\/api\/pegparty\/(create|join|sync|leave)$/.test(req.url)) {
      return reply(res, 404, { error: "Unknown room server endpoint." });
    }
    const origin = req.headers.origin;
    if (origin && !/^chrome-extension:\/\/[a-p]{32}$/.test(origin)) {
      fail(403, "Only browser extension requests are accepted.");
    }
    if (!req.headers["content-type"]?.startsWith("application/json")) {
      fail(415, "Use application/json.");
    }
    const data = await payload(req);
    const now = performance.now();
    clean(now);
    if (req.url === "/api/pegparty/create") {
      if (rooms.size >= maxRooms) fail(503, "The room server is full.");
      if (!/^[a-f0-9]{64}$/.test(data.title)) fail(400, "Invalid watch page.");
      let code;
      do { code = randomBytes(6).toString("hex").toUpperCase(); } while (rooms.has(code));
      const token = randomBytes(24).toString("hex");
      const room = {
        title: data.title, members: new Map(), eventId: 0, rosterVersion: 0, events: [],
        state: playbackState(data.state), updated: now, revision: 0
      };
      addMember(room, token, now, data.profile);
      rooms.set(code, room);
      return reply(res, 201, { code, token, ...snapshot(room, now, data.social) });
    }

    const room = rooms.get(data.code);
    if (!room) fail(404, "This room ended or the code is incorrect.");
    if (req.url === "/api/pegparty/join") {
      if (data.title !== room.title) fail(409, "This invite belongs to a different watch page.");
      if (room.members.size >= maxMembers) fail(409, "This room is full.");
      const token = randomBytes(24).toString("hex");
      addMember(room, token, now, data.profile);
      return reply(res, 200, { code: data.code, token, ...snapshot(room, now, data.social) });
    }
    const member = room.members.get(data.token);
    if (!member) fail(403, "Your session expired. Open the invite again.");
    if (req.url === "/api/pegparty/leave") {
      removeMember(room, data.token, "leave");
      if (room.members.size === 0) rooms.delete(data.code);
      return reply(res, 200, { ok: true });
    }
    if (data.command) applyCommand(room, member, data.command, now);
    member.seen = now;
    reply(res, 200, snapshot(room, now, data.social));
  } catch (error) {
    if (!res.destroyed) reply(res, error.status ?? 500, { error: error.status ? error.message : "Room server error." });
  }
});

const port = Number(process.env.PORT ?? 8787);
const host = process.env.HOST ?? "127.0.0.1";
server.listen(port, host, () => console.log(`PegParty relay listening on http://${host}:${server.address().port}`));
