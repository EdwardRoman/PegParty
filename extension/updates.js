(() => {
  const field = document.querySelector("#release-repo");
  const check = document.querySelector("#check-release");
  const label = document.querySelector("#release-status");
  const link = document.querySelector("#release-link");
  const installed = chrome.runtime.getManifest().version;
  const defaultRepo = globalThis.PEGPARTY_RELEASE_REPO || "";
  const maxAge = 30 * 60 * 1000;

  function repository(value) {
    const trimmed = value.trim().replace(/^https:\/\/github\.com\//i, "").replace(/\/$/, "").replace(/\.git$/i, "");
    return /^[a-z0-9][a-z0-9-]*\/[a-z0-9_.-]+$/i.test(trimmed) &&
      ![".", ".."].includes(trimmed.split("/")[1]) ? trimmed : "";
  }

  function compare(left, right) {
    const parts = version => /^v?(\d+)(?:\.(\d+))?(?:\.(\d+))?(?:\.(\d+))?$/i
      .exec(version)?.slice(1).map(value => Number(value ?? 0));
    const a = parts(left);
    const b = parts(right);
    if (!a || !b) throw new Error("The release tag must be a version such as v0.4.0.");
    const different = a.findIndex((value, index) => value !== b[index]);
    return different < 0 ? 0 : a[different] - b[different];
  }

  function show(repo, tag) {
    const difference = compare(tag, installed);
    label.textContent = difference > 0 ? `Update available · ${tag} (installed ${installed})` :
      difference < 0 ? `Installed ${installed} is newer than the latest release (${tag}).` :
      `You're up to date · ${installed}`;
    link.href = `https://github.com/${repo}/releases/tag/${encodeURIComponent(tag)}`;
    link.hidden = false;
    link.textContent = difference > 0 ? "Open release downloads" : "View release";
  }

  async function run(repo, force) {
    link.hidden = true;
    if (!repo) {
      label.textContent = `Installed ${installed} · Enter a public GitHub repository to check releases.`;
      return;
    }
    check.disabled = true;
    try {
      const { releaseCache } = await chrome.storage.local.get("releaseCache");
      if (!force && releaseCache?.repo === repo && Date.now() - releaseCache.at < maxAge) {
        show(repo, releaseCache.tag);
        return;
      }
      label.textContent = "Checking GitHub Releases…";
      const response = await fetch(`https://api.github.com/repos/${repo}/releases/latest`, {
        headers: { Accept: "application/vnd.github+json" }, credentials: "omit",
        signal: AbortSignal.timeout(7000), redirect: "error"
      });
      if (response.status === 404) throw new Error("No published release found. Check that the repository is public and has a full release.");
      if (response.status === 403 || response.status === 429) throw new Error("GitHub rate-limited the check. Try again later.");
      if (!response.ok) throw new Error("GitHub could not complete the release check.");
      const { tag_name: tag } = await response.json();
      show(repo, tag);
      await chrome.storage.local.set({ releaseCache: { repo, tag, at: Date.now() } });
    } catch (error) {
      label.textContent = error.message;
    } finally {
      check.disabled = false;
    }
  }

  check.onclick = async () => {
    const repo = repository(field.value);
    if (field.value.trim() && !repo) {
      label.textContent = "Enter owner/repository or its GitHub URL.";
      return;
    }
    try {
      await chrome.storage.local.set({ releaseRepo: repo });
      await run(repo || defaultRepo, true);
    } catch (error) {
      label.textContent = error.message;
    }
  };
  chrome.storage.local.get("releaseRepo").then(({ releaseRepo }) => {
    const repo = repository(releaseRepo || defaultRepo);
    field.value = repo;
    return run(repo, false);
  }).catch(error => { label.textContent = error.message; });
})();
