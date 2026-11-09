(() => {
  function captureInvite() {
    const invite = pegPartyLinks.parseInvite(location.href);
    if (!invite) return;
    try {
      history.replaceState(history.state, "", invite.movie);
    } catch {
      // The side panel can also read the invite from the address bar.
    }
    chrome.runtime.sendMessage({ type: "pegparty-invite", invite }).catch(() => {});
  }
  window.addEventListener("hashchange", captureInvite);
  captureInvite();
})();
