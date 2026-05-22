(() => {
  window.addEventListener("message", (event) => {
    if (event.source !== window) return;
    const message = event.data;
    if (!message || message.source !== "diffshub-local-page" || message.type !== "fetch-diff") return;

    console.info("[DiffsHub Local] DiffsHub requested local diff", message.apiUrl);
    chrome.runtime.sendMessage({
      type: "diffshub-fetch-diff",
      sessionId: message.sessionId,
      requestId: message.requestId,
      apiUrl: message.apiUrl
    });
  });

  chrome.runtime.onMessage.addListener((message) => {
    if (!message || !message.type || !message.type.startsWith("diffshub-diff-")) return false;
    if (message.type === "diffshub-diff-error") console.warn("[DiffsHub Local] forwarding diff error", message.error);
    window.postMessage({
      source: "diffshub-local-extension",
      ...message
    }, window.location.origin);
    return false;
  });
})();
