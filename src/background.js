const sessions = new Map();
const SESSION_PREFIX = "diffshub-session:";

function createSessionId() {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function sessionKey(sessionId) {
  return SESSION_PREFIX + sessionId;
}

function persistSession(sessionId, session) {
  const record = {
    sourceTabId: session.sourceTabId,
    config: session.config,
    diffshubTabId: session.diffshubTabId || null,
    createdAt: Date.now()
  };
  chrome.storage.session.set({ [sessionKey(sessionId)]: record });
}

function loadSession(sessionId, callback) {
  const existing = sessions.get(sessionId);
  if (existing) {
    callback(existing);
    return;
  }

  chrome.storage.session.get(sessionKey(sessionId), (items) => {
    const record = items[sessionKey(sessionId)];
    if (!record) {
      callback(null);
      return;
    }

    const session = {
      sourceTabId: record.sourceTabId,
      config: record.config,
      diffshubTabId: record.diffshubTabId || null
    };
    sessions.set(sessionId, session);
    callback(session);
  });
}

function forgetSession(sessionId) {
  sessions.delete(sessionId);
  chrome.storage.session.remove(sessionKey(sessionId));
}

function sendDiffsHubMessage(tabId, message) {
  chrome.tabs.sendMessage(tabId, message, () => {
    chrome.runtime.lastError;
  });
}

async function streamDiffFromNavigation(sessionId, requestId, diffshubTabId, diffUrl) {
  function send(message) {
    sendDiffsHubMessage(diffshubTabId, {
      requestId,
      ...message
    });
  }

  let tabId = null;
  try {
    console.info("[DiffsHub Local] opening authenticated diff tab", diffUrl);
    const tab = await chrome.tabs.create({
      url: diffUrl,
      active: false
    });
    tabId = tab.id;
    if (tabId == null) throw new Error("Chrome did not return a diff tab id");

    await waitForTabComplete(tabId);
    await chrome.scripting.executeScript({
      target: { tabId },
      args: [sessionId, requestId],
      func: async (activeSessionId, activeRequestId) => {
        const text = document.body?.innerText || document.documentElement?.innerText || "";
        const chunkSize = 256 * 1024;
        if (!text.startsWith("diff --git ") && !text.startsWith("From ")) {
          const preview = text.trim().slice(0, 500);
          await chrome.runtime.sendMessage({
            type: "diffshub-diff-error",
            sessionId: activeSessionId,
            requestId: activeRequestId,
            error: preview || "Authenticated diff tab did not return patch text"
          });
          return;
        }

        for (let offset = 0; offset < text.length; offset += chunkSize) {
          await chrome.runtime.sendMessage({
            type: "diffshub-diff-chunk",
            sessionId: activeSessionId,
            requestId: activeRequestId,
            chunk: text.slice(offset, offset + chunkSize)
          });
        }
        await chrome.runtime.sendMessage({
          type: "diffshub-diff-done",
          sessionId: activeSessionId,
          requestId: activeRequestId
        });
      }
    });
    console.info("[DiffsHub Local] finished authenticated diff tab", diffUrl);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn("[DiffsHub Local] authenticated diff tab failed", error);
    send({ type: "diffshub-diff-error", error: "Authenticated diff tab failed: " + message });
  } finally {
    if (tabId != null) {
      chrome.tabs.remove(tabId, () => {
        chrome.runtime.lastError;
      });
    }
  }
}

function waitForTabComplete(tabId) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error("Timed out loading authenticated diff tab"));
    }, 60000);

    function cleanup() {
      clearTimeout(timeout);
      chrome.tabs.onUpdated.removeListener(onUpdated);
      chrome.tabs.onRemoved.removeListener(onRemoved);
    }

    function onUpdated(updatedTabId, changeInfo) {
      if (updatedTabId !== tabId || changeInfo.status !== "complete") return;
      cleanup();
      resolve();
    }

    function onRemoved(removedTabId) {
      if (removedTabId !== tabId) return;
      cleanup();
      reject(new Error("Authenticated diff tab was closed before it loaded"));
    }

    chrome.tabs.onUpdated.addListener(onUpdated);
    chrome.tabs.onRemoved.addListener(onRemoved);
    chrome.tabs.get(tabId, (tab) => {
      const error = chrome.runtime.lastError;
      if (error) {
        cleanup();
        reject(new Error(error.message));
        return;
      }
      if (tab.status === "complete") {
        cleanup();
        resolve();
      }
    });
  });
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || message.type !== "open-viewer") return false;
  if (!sender.tab || sender.tab.id == null) {
    sendResponse({ ok: false, error: "Missing source tab" });
    return false;
  }

  const sessionId = createSessionId();
  const session = {
    sourceTabId: sender.tab.id,
    config: {
      diff: message.diff,
      source: message.source,
      repo: message.repo,
      pull: message.pull
    },
    diffshubTabId: null
  };
  sessions.set(sessionId, session);
  persistSession(sessionId, session);

  sendResponse({ ok: true, sessionId });
  return true;
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || message.type !== "diffshub-fetch-diff") return false;
  const diffshubTabId = sender.tab && sender.tab.id;
  if (diffshubTabId == null) {
    sendResponse({ ok: false, error: "Missing DiffsHub tab" });
    return false;
  }

  loadSession(message.sessionId, (session) => {
    if (!session) {
      sendDiffsHubMessage(diffshubTabId, {
        type: "diffshub-diff-error",
        requestId: message.requestId,
        error: "DiffsHub local session expired. Reopen from the GitHub PR button."
      });
      sendResponse({ ok: false, error: "Missing session" });
      return;
    }

    session.diffshubTabId = diffshubTabId;
    persistSession(message.sessionId, session);
    streamDiffFromNavigation(message.sessionId, message.requestId, diffshubTabId, session.config.diff)
      .finally(() => sendResponse({ ok: true }));
  });
  return true;
});

chrome.runtime.onMessage.addListener((message) => {
  if (!message || !message.type || !message.type.startsWith("diffshub-diff-")) return false;
  loadSession(message.sessionId, (session) => {
    if (!session || session.diffshubTabId == null) return;
    chrome.tabs.sendMessage(session.diffshubTabId, {
      type: message.type,
      requestId: message.requestId,
      chunk: message.chunk,
      error: message.error
    });
  });
  return false;
});
