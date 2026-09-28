
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.type !== "FETCH_WORDS") return;
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
});
