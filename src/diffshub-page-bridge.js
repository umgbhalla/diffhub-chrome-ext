(() => {
  const params = new URLSearchParams(window.location.search);
  const sessionId = params.get("diffshub_local_session");
  if (!sessionId || window.__diffshubLocalFetchPatched) return;
  window.__diffshubLocalFetchPatched = true;

  const nativeFetch = window.fetch.bind(window);
  const pending = new Map();

  window.addEventListener("message", (event) => {
    if (event.source !== window) return;
    const message = event.data;
    if (!message || message.source !== "diffshub-local-extension") return;
    const request = pending.get(message.requestId);
    if (!request) return;

    if (message.type === "diffshub-diff-chunk") {
      request.controller.enqueue(request.encoder.encode(message.chunk || ""));
      return;
    }

    pending.delete(message.requestId);
    if (message.type === "diffshub-diff-done") {
      request.controller.close();
      return;
    }

    if (message.type === "diffshub-diff-error") {
      request.controller.error(new Error(message.error || "DiffsHub local diff fetch failed"));
    }
  });

  function isDiffsHubDiffRequest(input) {
    const rawUrl = typeof input === "string" ? input : input && input.url;
    if (!rawUrl) return false;
    const url = new URL(rawUrl, window.location.href);
    return url.origin === window.location.origin && url.pathname === "/api/diff";
  }

  window.fetch = function patchedFetch(input, init) {
    if (!isDiffsHubDiffRequest(input)) return nativeFetch(input, init);

    const requestId = crypto.randomUUID();
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
        pending.set(requestId, { controller, encoder });
        const rawUrl = typeof input === "string" ? input : input.url;
        window.postMessage({
          source: "diffshub-local-page",
          type: "fetch-diff",
          sessionId,
          requestId,
          apiUrl: new URL(rawUrl, window.location.href).toString()
        }, window.location.origin);
      },
      cancel() {
        pending.delete(requestId);
      }
    });

    return Promise.resolve(new Response(stream, {
      status: 200,
      headers: {
        "content-type": "text/plain; charset=utf-8",
        "x-diffshub-local": "1"
      }
    }));
  };
})();
