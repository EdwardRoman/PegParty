(() => {
  const LOCAL_RELAY = "http://127.0.0.1:8787";

  function watchPage(url) {
    return url.protocol === "https:" && /(^|\.)67movies\.(gd|app|st|net|org|to)$/.test(url.hostname) ||
      url.origin === LOCAL_RELAY && url.pathname === "/demo";
  }

  function relayOrigin(value) {
    try {
      const url = new URL(value);
      if (url.origin !== value || url.username || url.password) return null;
      return url.protocol === "https:" || value === LOCAL_RELAY ? value : null;
    } catch {
      return null;
    }
  }

  function parseInvite(value) {
    const url = new URL(value);
    if (!watchPage(url) || !url.hash.startsWith("#pegparty=")) return null;
    try {
      const { relay, code, hash } = JSON.parse(decodeURIComponent(url.hash.slice(10)));
      if (!relayOrigin(relay) || !/^[A-F0-9]{12}$/.test(code) ||
          typeof hash !== "string" || (hash && !hash.startsWith("#"))) return null;
      url.hash = hash;
      return { relay, code, movie: url.href };
    } catch {
      return null;
    }
  }

  function inviteLink(movie, relay, code) {
    const url = new URL(movie);
    url.hash = "pegparty=" + encodeURIComponent(JSON.stringify({ relay, code, hash: url.hash }));
    return url.href;
  }

  globalThis.pegPartyLinks = { LOCAL_RELAY, watchPage, relayOrigin, parseInvite, inviteLink };
})();
