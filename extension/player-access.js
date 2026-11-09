function pattern(url) {
  return `${url.protocol}//${url.hostname}/*`;
}

async function execute(func, args, target) {
  const [result] = await chrome.scripting.executeScript({
    target: { tabId: target.tabId, documentIds: [target.documentId] }, func, args
  });
  return result?.result;
}

async function findPlayer(tabId, movie) {
  const frames = await chrome.webNavigation.getAllFrames({ tabId });
  const origin = new URL(movie).origin;
  const candidates = [];
  const denied = new Set();
  for (const frame of frames ?? []) {
    if (frame.errorOccurred || frame.documentLifecycle !== "active") continue;
    const url = new URL(frame.url);
    if (frame.frameId && url.origin !== origin && url.protocol === "https:") {
      const host = pattern(url);
      if (!await chrome.permissions.contains({ origins: [host] })) {
        denied.add(host);
        continue;
      }
    }
    try {
      const target = { tabId, documentId: frame.documentId, url: frame.url };
      await chrome.scripting.executeScript({
        target: { tabId, documentIds: [frame.documentId] }, files: ["player.js"]
      });
      const sample = await execute(() => globalThis.pegPartyPlayer?.read(), [], target);
      if (sample) candidates.push({ target, area: sample.area });
    } catch {
      // Embedded frames can navigate during discovery.
    }
  }
  candidates.sort((left, right) => right.area - left.area);
  return { player: candidates[0]?.target, denied: [...denied] };
}
