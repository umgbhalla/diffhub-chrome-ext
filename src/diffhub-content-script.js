(() => {
  window.addEventListener("message", (event) => {
    if (event.source !== window) return;
    const message = event.data;
    if (!message || message.source !== "diffhub-local-page" || message.type !== "fetch-diff") return;

    console.info("[DiffHub Local] DiffHub requested local diff", message.apiUrl);
    chrome.runtime.sendMessage({
      type: "diffhub-fetch-diff",
      sessionId: message.sessionId,
      requestId: message.requestId,
      apiUrl: message.apiUrl
    });
  });

  chrome.runtime.onMessage.addListener((message) => {
    if (!message || !message.type || !message.type.startsWith("diffhub-diff-")) return false;
    if (message.type === "diffhub-diff-error") console.warn("[DiffHub Local] forwarding diff error", message.error);
    window.postMessage({
      source: "diffhub-local-extension",
      ...message
    }, window.location.origin);
    return false;
  });
})();
