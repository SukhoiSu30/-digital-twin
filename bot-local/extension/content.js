/**
 * DT Audio Capture — Content Script
 *
 * Bridges audio data between the extension background page
 * and the Zoom web page context.
 *
 * Flow: background.js → content.js → page (window.postMessage) → Puppeteer exposeFunction → Node.js → Deepgram
 */

// Forward audio chunks from background → page
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === "DT_AUDIO_CHUNK") {
    window.postMessage({ type: "__DT_AUDIO__", data: msg.data }, "*");
  }

  if (msg.type === "DT_CAPTURE_STATUS") {
    window.postMessage(
      {
        type: "__DT_CAPTURE_STATUS__",
        success: msg.success,
        error: msg.error,
      },
      "*"
    );
    console.log(
      "[DT-Ext] Capture status:",
      msg.success ? "ACTIVE" : "FAILED",
      msg.error || ""
    );
  }
});

// Forward control messages from page → background
window.addEventListener("message", (event) => {
  if (event.source !== window) return;

  if (event.data?.type === "__DT_START_CAPTURE__") {
    console.log("[DT-Ext] Page requested capture start");
    chrome.runtime.sendMessage({ type: "START_CAPTURE" }, (response) => {
      console.log("[DT-Ext] Start capture response:", response);
    });
  }

  if (event.data?.type === "__DT_STOP_CAPTURE__") {
    chrome.runtime.sendMessage({ type: "STOP_CAPTURE" });
  }
});

console.log("[DT-Ext] Content script loaded on", location.href);
