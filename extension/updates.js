(() => {
  const setup = document.querySelector("#set-release-source");
  const form = document.querySelector("#release-source");
  const field = document.querySelector("#release-repo");
  const check = document.querySelector("#check-release");
  const label = document.querySelector("#release-status");
  const link = document.querySelector("#release-link");
  const installed = chrome.runtime.getManifest().version;
  const defaultRepo = globalThis.PEGPARTY_RELEASE_REPO || "";
  const maxAge = 30 * 60 * 1000;
  const current = `PegParty ${installed}`;
  label.textContent = current;
  setup.onclick = () => { form.hidden = false; field.focus(); };

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
    label.textContent = difference > 0 ? `${current} · Update available (${tag})` :
      difference < 0 ? `${current} · Ahead of ${tag}` : `${current} · Up to date`;
    label.classList.toggle("outdated", difference > 0);
    link.href = `https://github.com/${repo}/releases/tag/${encodeURIComponent(tag)}`;
    link.hidden = difference <= 0;
  }

  async function run(repo, force) {
    link.hidden = true;
    label.classList.remove("outdated");
    setup.hidden = Boolean(repo);
    if (!repo) {
      label.textContent = current;
      return;
    }
    check.disabled = true;
    try {
      const { releaseCache } = await chrome.storage.local.get("releaseCache");
      if (!force && releaseCache?.repo === repo && Date.now() - releaseCache.at < maxAge) {
        show(repo, releaseCache.tag);
        return;
      }
      label.textContent = `${current} · Checking GitHub…`;
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
      label.textContent = `${current} · ${error.message}`;
      setup.hidden = Boolean(defaultRepo);
    } finally {
      check.disabled = false;
    }
  }

  form.onsubmit = async event => {
    event.preventDefault();
    const repo = repository(field.value);
    if (field.value.trim() && !repo) {
      label.textContent = "Enter owner/repository or its GitHub URL.";
      return;
    }
    try {
      await chrome.storage.local.set({ releaseRepo: repo });
      form.hidden = true;
      await run(repo || defaultRepo, true);
    } catch (error) {
      label.textContent = `${current} · ${error.message}`;
      setup.hidden = Boolean(defaultRepo);
    }
  };
  chrome.storage.local.get("releaseRepo").then(({ releaseRepo }) => {
    const repo = repository(defaultRepo || releaseRepo || "");
    field.value = repo;
    return run(repo, false);
  }).catch(error => { label.textContent = error.message; });
})();
