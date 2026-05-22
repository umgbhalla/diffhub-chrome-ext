(() => {
  const BUTTON_ID = "diffshub-local-open";
  const ROUTE_RE = /^\/([^/]+)\/([^/]+)\/pull\/(\d+)(?:\/.*)?$/;

  function getPullRequest() {
    const match = window.location.pathname.match(ROUTE_RE);
    if (!match) return null;
    const owner = match[1];
    const repo = match[2];
    const pull = match[3];
    return { owner, repo, pull };
  }

  function buildConfig(pr) {
    const diffUrl = new URL("/" + pr.owner + "/" + pr.repo + "/pull/" + pr.pull + ".diff", window.location.origin);
    return {
      diff: diffUrl.toString(),
      source: window.location.href,
      repo: pr.owner + "/" + pr.repo,
      pull: pr.pull
    };
  }

  function buildDiffsHubUrl(config, sessionId) {
    const url = new URL("https://diffshub.com/" + config.repo + "/pull/" + config.pull);
    url.searchParams.set("diffshub_local_session", sessionId);
    return url.toString();
  }

  function findMount() {
    return (
      document.querySelector(".gh-header-actions") ||
      document.querySelector("[data-testid='issue-header'] .d-flex.flex-items-center") ||
      document.querySelector(".js-issue-title")?.closest(".gh-header")?.querySelector(".gh-header-actions")
    );
  }

  function createButton(pr, fallback) {
    const button = document.createElement("button");
    button.id = BUTTON_ID;
    button.type = "button";
    button.className = "diffshub-local-button" + (fallback ? " diffshub-local-fallback" : "");
    button.textContent = "Open in DiffsHub";
    button.addEventListener("click", () => {
      const config = buildConfig(pr);
      chrome.runtime.sendMessage({ type: "open-viewer", ...config }, (response) => {
        if (chrome.runtime.lastError || !response || !response.ok || !response.sessionId) {
          return;
        }
        window.open(buildDiffsHubUrl(config, response.sessionId), "_blank", "noopener,noreferrer");
      });
    });
    return button;
  }

  function inject() {
    const pr = getPullRequest();
    const existing = document.getElementById(BUTTON_ID);

    if (!pr) {
      existing?.remove();
      return;
    }

    const mount = findMount();
    if (existing) {
      const shouldFallback = !mount;
      existing.classList.toggle("diffshub-local-fallback", shouldFallback);
      if (mount && existing.parentElement !== mount) mount.append(existing);
      if (!mount && existing.parentElement !== document.body) document.body.append(existing);
      return;
    }

    const button = createButton(pr, !mount);
    (mount || document.body).append(button);
  }

  let scheduled = false;
  function scheduleInject() {
    if (scheduled) return;
    scheduled = true;
    window.setTimeout(() => {
      scheduled = false;
      inject();
    }, 100);
  }

  inject();
  new MutationObserver(scheduleInject).observe(document.documentElement, {
    childList: true,
    subtree: true
  });
  window.addEventListener("popstate", scheduleInject);
})();
