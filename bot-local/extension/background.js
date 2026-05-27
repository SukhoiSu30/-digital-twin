/**
 * DT Audio Capture — Background Page
 *
 * Uses chrome.tabCapture.capture() to capture ALL audio from the Zoom tab.
 * Processes to 16kHz PCM16 (linear16) and sends base64 chunks to the
 * content script, which forwards them to the page for Deepgram streaming.
 */

let capturing = false;
let audioCtx = null;
let captureStream = null;
let targetTabId = null;
let chunkCount = 0;

// Trigger capture when extension icon is clicked (or Alt+Shift+R)
chrome.browserAction.onClicked.addListener((tab) => {
  if (capturing) {
    stopCapture();
  } else {
    startCapture(tab.id);
  }
});

// Also accept programmatic requests from the content script
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === "START_CAPTURE") {
    const tabId = sender.tab ? sender.tab.id : msg.tabId;
    if (!capturing && tabId) {
      startCapture(tabId);
      sendResponse({ success: true });
    } else {
      sendResponse({ success: false, reason: capturing ? "already_capturing" : "no_tab" });
    }
    return true;
  }

  if (msg.type === "STOP_CAPTURE") {
    stopCapture();
    sendResponse({ success: true });
  }

  if (msg.type === "PING") {
    sendResponse({ alive: true, capturing });
  }
});

function startCapture(tabId) {
  targetTabId = tabId;
  chunkCount = 0;

  chrome.tabCapture.capture({ audio: true, video: false }, (stream) => {
    if (chrome.runtime.lastError || !stream) {
      const err = chrome.runtime.lastError?.message || "No stream returned";
      console.error("[DT-Ext] Capture failed:", err);
      notifyTab(tabId, false, err);
      return;
    }

    capturing = true;
    captureStream = stream;
    console.log("[DT-Ext] Tab audio capture STARTED for tab", tabId);

    // Create AudioContext at 16kHz for Deepgram
    audioCtx = new AudioContext({ sampleRate: 16000 });
    const source = audioCtx.createMediaStreamSource(stream);
    const processor = audioCtx.createScriptProcessor(4096, 1, 1);

    processor.onaudioprocess = (e) => {
      if (!capturing) return;

      const float32 = e.inputBuffer.getChannelData(0);

      // Convert Float32 [-1,1] → Int16 [-32768,32767] for Deepgram linear16
      const int16 = new Int16Array(float32.length);
      for (let i = 0; i < float32.length; i++) {
        const s = Math.max(-1, Math.min(1, float32[i]));
        int16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
      }

      // Base64 encode the raw bytes
      const bytes = new Uint8Array(int16.buffer);
      let binary = "";
      for (let i = 0; i < bytes.length; i++) {
        binary += String.fromCharCode(bytes[i]);
      }
      const b64 = btoa(binary);

      chunkCount++;
      if (chunkCount <= 3 || chunkCount % 200 === 0) {
        console.log(`[DT-Ext] Audio chunk #${chunkCount} (${b64.length} bytes b64)`);
      }

      // Send to content script in the Zoom tab
      try {
        chrome.tabs.sendMessage(targetTabId, { type: "DT_AUDIO_CHUNK", data: b64 });
      } catch (e) {
        // Tab might have closed
      }
    };

    source.connect(processor);
    processor.connect(audioCtx.destination);

    // Tell the page capture is running
    notifyTab(tabId, true);

    // Monitor if the stream ends (meeting closed, tab navigated)
    stream.getAudioTracks()[0].onended = () => {
      console.log("[DT-Ext] Audio track ended — stream closed");
      stopCapture();
    };
  });
}

function stopCapture() {
  if (captureStream) {
    captureStream.getTracks().forEach((t) => t.stop());
    captureStream = null;
  }
  if (audioCtx) {
    audioCtx.close().catch(() => {});
    audioCtx = null;
  }
  capturing = false;
  console.log(`[DT-Ext] Capture stopped after ${chunkCount} chunks`);
}

function notifyTab(tabId, success, error) {
  try {
    chrome.tabs.sendMessage(tabId, {
      type: "DT_CAPTURE_STATUS",
      success,
      error: error || null,
    });
  } catch (e) {}
}

console.log("[DT-Ext] Background page ready");
