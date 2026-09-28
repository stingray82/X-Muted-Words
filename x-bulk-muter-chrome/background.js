
// Fetch optional remote word lists.
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.type === "FETCH_WORDS") {
    (async () => {
      try {
        const url = String(msg.url || "").trim();
        if (!url.startsWith("https://raw.githubusercontent.com/")) {
          throw new Error("Use a raw.githubusercontent.com URL.");
        }
        const res = await fetch(url, { cache: "no-store" });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        sendResponse({ ok: true, text: await res.text() });
      } catch (e) {
        sendResponse({ ok: false, error: e?.message || String(e) });
      }
    })();
    return true;
  }

  if (msg?.type === "GET_RATE_LIMIT_STATE") {
    chrome.storage.local.get([
      "networkRateLimitAt",
      "networkRateLimitStatus",
      "networkRateLimitUrl"
    ]).then(sendResponse);
    return true;
  }

  if (msg?.type === "CLEAR_RATE_LIMIT_STATE") {
    chrome.storage.local.remove([
      "networkRateLimitAt",
      "networkRateLimitStatus",
      "networkRateLimitUrl"
    ]).then(() => sendResponse({ ok: true }));
    return true;
  }
});

// Observe X network responses. This catches rate limits even when X's UI
// simply navigates back to the muted-words page without displaying an error.
chrome.webRequest.onCompleted.addListener(
  async (details) => {
    // 429 is the standard response. Some services also use 420-style throttling.
    if (details.statusCode === 429 || details.statusCode === 420) {
      await chrome.storage.local.set({
        networkRateLimitAt: Date.now(),
        networkRateLimitStatus: details.statusCode,
        networkRateLimitUrl: details.url
      });
      console.warn(
        `[X Bulk Muter] Network rate limit observed: HTTP ${details.statusCode} ${details.url}`
      );
    }
  },
  {
    urls: [
      "https://x.com/*",
      "https://twitter.com/*",
      "https://api.x.com/*"
    ]
  }
);
