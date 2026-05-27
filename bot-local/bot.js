/**
 * Digital Twin — Local Zoom Bot v3.0
 *
 * Architecture (matches colleague's approach):
 *   Bot:         Puppeteer (Chromium browser automation)
 *   Audio:       WebRTC interception — captures meeting audio directly from browser
 *   Transcript:  Deepgram Nova-2 streaming (free $200 credit) OR Web Speech API fallback
 *   Summary:     Claude Sonnet 4.6 via server API
 *
 * Usage:
 *   cd bot-local && npm install && node bot.js
 */

require("dotenv").config();
const puppeteer = require("puppeteer");
const path = require("path");

// ─── Configuration ──────────────────────────────────────
const API_URL = process.env.API_URL || "https://digital-twin-api-13y1.onrender.com/api";
const BOT_SECRET = process.env.BOT_SECRET || "dt-bot-secret-2024";
const DEEPGRAM_API_KEY = process.env.DEEPGRAM_API_KEY || "";
const BOT_NAME = "Vaibhav Mujage";
const POLL_INTERVAL = 8000;
const activeBots = new Map();
const deepgramConnections = new Map();
const deepgramBuffers = new Map();
const useDeepgram = DEEPGRAM_API_KEY && DEEPGRAM_API_KEY.length > 10;

console.log(`
╔══════════════════════════════════════════════╗
║      Digital Twin — Local Zoom Bot v3.0      ║
║                                              ║
║  Bot Name:  ${BOT_NAME.padEnd(33)}║
║  API:       ${API_URL.substring(0, 33).padEnd(33)}║
║  Polling:   Every ${POLL_INTERVAL / 1000}s                        ║
║  Auth:      BOT_SECRET                       ║
║  Transcribe: ${(useDeepgram ? "Deepgram Nova-2 (WebRTC capture)" : "Web Speech API (fallback)").padEnd(32)}║
║                                              ║
║  Press Ctrl+C to stop                        ║
╚══════════════════════════════════════════════╝
`);

if (!useDeepgram) {
  console.log(`[Bot] WARNING: No Deepgram API key found.`);
  console.log(`[Bot] Get free $200 credit at https://console.deepgram.com`);
  console.log(`[Bot] Add DEEPGRAM_API_KEY to bot-local/.env for best transcription.\n`);
}

// ─── API Helpers ────────────────────────────────────────

async function botApi(path, method = "GET", body = null) {
  const url = `${API_URL}/bot-agent${path}`;
  const options = {
    method,
    headers: {
      "Content-Type": "application/json",
      "x-bot-secret": BOT_SECRET,
    },
  };
  if (body) options.body = JSON.stringify(body);

  try {
    const res = await fetch(url, options);
    return await res.json();
  } catch (err) {
    return { success: false, error: err.message };
  }
}

async function reportJoined(meetingId) {
  return botApi(`/joined/${meetingId}`, "POST");
}

async function reportFailed(meetingId, error) {
  return botApi(`/failed/${meetingId}`, "POST", { error });
}

async function reportEnded(meetingId) {
  return botApi(`/ended/${meetingId}`, "POST");
}

async function reportWaiting(meetingId) {
  return botApi(`/waiting/${meetingId}`, "POST");
}

async function checkStillActive(meetingId) {
  const res = await botApi(`/check/${meetingId}`);
  return res.success && res.active;
}

// ─── Main Polling Loop ──────────────────────────────────

async function startPolling() {
  console.log("[Bot] Started polling for meetings...\n");

  setInterval(async () => {
    try {
      const response = await botApi("/poll");

      if (!response.success || !response.data) return;

      for (const meeting of response.data) {
        if (activeBots.has(meeting.id)) continue;
        if (!meeting.zoomJoinUrl) continue;

        console.log(`[Bot] Found meeting to join: "${meeting.title}"`);
        console.log(`[Bot] Zoom URL: ${meeting.zoomJoinUrl}`);

        activeBots.set(meeting.id, { status: "starting" });

        joinMeeting(meeting).catch(async (err) => {
          console.error(`[Bot] Error joining "${meeting.title}":`, err.message);
          await reportFailed(meeting.id, err.message);
          activeBots.delete(meeting.id);
        });
      }
    } catch (err) {
      // Silent — server might be waking up
    }
  }, POLL_INTERVAL);
}

// ─── Join Meeting via Puppeteer ─────────────────────────

async function joinMeeting(meeting) {
  const { id, title, zoomMeetingId, zoomJoinUrl, zoomPasscode } = meeting;

  console.log(`\n${"=".repeat(50)}`);
  console.log(`[Bot] JOINING: ${title}`);
  console.log(`[Bot] As: ${BOT_NAME}`);
  console.log(`${"=".repeat(50)}\n`);

  let browser = null;

  try {
    // ── Launch Chrome ──
    const extensionPath = path.resolve(__dirname, "extension");

    browser = await puppeteer.launch({
      headless: false,
      defaultViewport: { width: 1280, height: 720 },
      args: [
        "--disable-notifications",
        "--use-fake-ui-for-media-stream",
        "--autoplay-policy=no-user-gesture-required",
        "--no-first-run",
        "--no-default-browser-check",
        "--disable-popup-blocking",
        `--disable-extensions-except=${extensionPath}`,
        `--load-extension=${extensionPath}`,
        "--auto-select-desktop-capture-source=Zoom",
      ],
    });

    const page = await browser.newPage();

    await page.setUserAgent(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36"
    );

    const context = browser.defaultBrowserContext();
    await context.overridePermissions("https://zoom.us", [
      "microphone", "camera", "notifications",
    ]);
    await context.overridePermissions("https://app.zoom.us", [
      "microphone", "camera", "notifications",
    ]);

    // ── Set up audio capture bridge BEFORE navigating to Zoom ──
    if (useDeepgram) {
      await setupAudioCapture(page, id);
    }

    // ── Build Zoom Web Client URL ──
    let joinUrl = `https://app.zoom.us/wc/join/${zoomMeetingId}`;
    if (zoomPasscode) {
      joinUrl += `?pwd=${encodeURIComponent(zoomPasscode)}`;
    }

    console.log(`[Bot] Navigating to Zoom web client...`);
    await page.goto(joinUrl, { waitUntil: "networkidle2", timeout: 60000 });

    console.log(`[Bot] Waiting for page to load...`);
    await delay(6000);

    await page.screenshot({ path: "debug-step1-loaded.png" });
    console.log(`[Bot] Page loaded. Title: ${await page.title()}`);

    // ── Handle "Join from Your Browser" link ──
    const clickedBrowserLink = await page.evaluate(() => {
      const links = document.querySelectorAll("a");
      for (const a of links) {
        const text = (a.textContent || "").toLowerCase();
        if (text.includes("join from your browser") || text.includes("join from browser")) {
          a.click();
          return true;
        }
      }
      return false;
    });

    if (clickedBrowserLink) {
      console.log(`[Bot] Clicked "Join from Your Browser" link`);
      await delay(5000);
    }

    // ── Handle Cookies / GDPR banners ──
    await page.evaluate(() => {
      const buttons = document.querySelectorAll("button, a");
      for (const btn of buttons) {
        const text = (btn.textContent || "").toLowerCase();
        if (text.includes("accept") && (text.includes("cookie") || text.includes("consent"))) {
          btn.click();
          break;
        }
      }
    });

    // ── Enter Name ──
    console.log(`[Bot] Setting name to "${BOT_NAME}"...`);
    let nameSet = false;

    const nameSelectors = [
      "#inputname",
      'input[name="inputname"]',
      'input[placeholder*="name" i]',
      'input[aria-label*="name" i]',
      'input[type="text"]',
    ];

    for (const selector of nameSelectors) {
      try {
        const input = await page.$(selector);
        if (input) {
          await input.click({ clickCount: 3 });
          await delay(200);
          await page.keyboard.press("Backspace");
          await delay(100);
          await input.type(BOT_NAME, { delay: 40 });
          nameSet = true;
          console.log(`[Bot] Name entered via selector: ${selector}`);
          break;
        }
      } catch (e) { /* try next */ }
    }

    if (!nameSet) {
      nameSet = await page.evaluate((name) => {
        const inputs = document.querySelectorAll('input[type="text"], input:not([type])');
        for (const input of inputs) {
          const ph = (input.placeholder || "").toLowerCase();
          const ariaLabel = (input.getAttribute("aria-label") || "").toLowerCase();
          const id = (input.id || "").toLowerCase();
          if (ph.includes("name") || ariaLabel.includes("name") || id.includes("name") || inputs.length === 1) {
            const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
              window.HTMLInputElement.prototype, "value"
            ).set;
            nativeInputValueSetter.call(input, name);
            input.dispatchEvent(new Event("input", { bubbles: true }));
            input.dispatchEvent(new Event("change", { bubbles: true }));
            return true;
          }
        }
        return false;
      }, BOT_NAME);
      if (nameSet) console.log(`[Bot] Name set via React setter`);
    }

    if (!nameSet) console.log(`[Bot] WARNING: Could not find name input`);

    await delay(1000);

    // ── Accept checkboxes ──
    await page.evaluate(() => {
      const checkboxes = document.querySelectorAll('input[type="checkbox"]');
      checkboxes.forEach(cb => { if (!cb.checked) cb.click(); });
    });

    await delay(500);

    // ── Click Join Button ──
    console.log(`[Bot] Looking for Join button...`);
    let joinClicked = await page.evaluate(() => {
      const clickable = document.querySelectorAll(
        'button, input[type="button"], input[type="submit"], a.btn, [role="button"]'
      );
      for (const el of clickable) {
        const text = (el.textContent || el.value || "").trim().toLowerCase();
        if (text === "join" || text === "join meeting" || text.startsWith("join")) {
          el.click();
          return true;
        }
      }
      return false;
    });

    if (!joinClicked) {
      const joinSelectors = ["#joinBtn", 'button[id*="join" i]', 'button.zm-btn--primary', 'button.preview-join-button'];
      for (const sel of joinSelectors) {
        try {
          const btn = await page.$(sel);
          if (btn) { await btn.click(); joinClicked = true; break; }
        } catch (e) {}
      }
    }

    if (!joinClicked) {
      await page.keyboard.press("Enter");
      joinClicked = true;
    }

    console.log(`[Bot] Join button clicked: ${joinClicked}`);
    await delay(4000);
    await page.screenshot({ path: "debug-step2-join-clicked.png" });

    // ── Handle Passcode ──
    if (zoomPasscode) {
      const passcodeInput = await page.$(
        '#inputpasscode, input[type="password"], input[placeholder*="passcode" i]'
      );
      if (passcodeInput) {
        await passcodeInput.click({ clickCount: 3 });
        await passcodeInput.type(zoomPasscode, { delay: 50 });
        console.log(`[Bot] Entered passcode`);
        await delay(1000);
        await page.evaluate(() => {
          const buttons = document.querySelectorAll("button");
          for (const btn of buttons) {
            if ((btn.textContent || "").toLowerCase().includes("join")) { btn.click(); break; }
          }
        });
        await delay(3000);
      }
    }

    // ── Handle "Join Audio by Computer" ──
    await delay(2000);
    await page.evaluate(() => {
      const buttons = document.querySelectorAll("button");
      for (const btn of buttons) {
        const text = (btn.textContent || "").toLowerCase();
        if (text.includes("join audio") || text.includes("computer audio") || text.includes("join with computer")) {
          btn.click(); break;
        }
      }
    });

    // Report waiting
    await reportWaiting(id);
    console.log(`\n[Bot] Waiting for host to admit "${BOT_NAME}"...\n`);

    // ── Wait for Meeting Join ──
    activeBots.set(id, { status: "waiting", browser, page });
    let inMeeting = false;
    let attempts = 0;
    const MAX_WAIT = 120;

    while (!inMeeting && attempts < MAX_WAIT) {
      attempts++;
      await delay(5000);

      const stillActive = await checkStillActive(id);
      if (!stillActive) {
        console.log(`[Bot] Meeting cancelled from dashboard`);
        await browser.close().catch(() => {});
        activeBots.delete(id);
        return;
      }

      try {
        inMeeting = await page.evaluate(() => {
          const indicators = [
            document.querySelector('[class*="meeting-app"]'),
            document.querySelector('[class*="meeting-client"]'),
            document.querySelector('#wc-container-left'),
            document.querySelector('[class*="participants"]'),
            document.querySelector('button[aria-label*="Mute"]'),
            document.querySelector('button[aria-label*="mute"]'),
            document.querySelector('[class*="footer"]'),
            document.querySelector('[class*="video-avatar"]'),
          ];
          return indicators.some(el => el !== null);
        });

        if (inMeeting) break;

        const pageText = await page.evaluate(() => document.body.innerText || "");
        if (
          pageText.includes("meeting has ended") ||
          pageText.includes("host has ended") ||
          pageText.includes("removed from the meeting")
        ) {
          await reportFailed(id, "Meeting ended or access denied");
          await browser.close().catch(() => {});
          activeBots.delete(id);
          return;
        }

        // Retry "Join Audio" popup
        await page.evaluate(() => {
          const buttons = document.querySelectorAll("button");
          for (const btn of buttons) {
            const text = (btn.textContent || "").toLowerCase();
            if (text.includes("join audio") || text.includes("computer audio")) { btn.click(); break; }
          }
        });
      } catch (e) {}

      if (attempts % 12 === 0) {
        console.log(`[Bot] Still waiting... (${attempts * 5}s)`);
        await page.screenshot({ path: `debug-waiting-${attempts}.png` }).catch(() => {});
      }
    }

    // ── In Meeting ──
    if (inMeeting) {
      console.log(`\n${"=".repeat(50)}`);
      console.log(`[Bot] JOINED: ${title}`);
      console.log(`[Bot] Meeting is LIVE`);
      console.log(`${"=".repeat(50)}\n`);

      await reportJoined(id);
      activeBots.set(id, { status: "active", browser, page });
      await page.screenshot({ path: "debug-step3-in-meeting.png" });

      // ── Mute mic & turn off camera (since we removed fake devices) ──
      await page.evaluate(() => {
        // Try muting mic
        const muteSelectors = [
          'button[aria-label*="Mute"]',
          'button[aria-label*="mute"]',
          'button[aria-label*="Unmute"]',
          'button[class*="mute"]',
        ];
        for (const sel of muteSelectors) {
          const btn = document.querySelector(sel);
          if (btn) {
            const label = (btn.getAttribute("aria-label") || "").toLowerCase();
            // Only click if currently unmuted (label says "Mute" = currently unmuted)
            if (label.includes("mute") && !label.includes("unmute")) {
              btn.click();
              console.log("[DT-Bot] Mic muted");
            }
            break;
          }
        }

        // Try stopping video
        const videoSelectors = [
          'button[aria-label*="Stop Video"]',
          'button[aria-label*="stop video"]',
          'button[aria-label*="Stop video"]',
        ];
        for (const sel of videoSelectors) {
          const btn = document.querySelector(sel);
          if (btn) {
            btn.click();
            console.log("[DT-Bot] Camera stopped");
            break;
          }
        }
      });
      await delay(1000);

      // ── Start Transcription ──
      await startTranscription(browser, page, id);

      // ── Periodic transcript flush ──
      const transcriptFlush = setInterval(async () => {
        try { await flushTranscripts(page, id); } catch (e) {}
      }, 10000);

      // ── Page navigation / crash detection ──
      let meetingEndedByNav = false;
      page.on("framenavigated", (frame) => {
        if (frame === page.mainFrame()) {
          const newUrl = frame.url().toLowerCase();
          if (
            newUrl.includes("/wc/leave") ||
            newUrl.includes("/postattendee") ||
            newUrl.includes("meeting-ended") ||
            (!newUrl.includes("zoom.us/wc/") && !newUrl.includes("app.zoom.us/wc/"))
          ) {
            console.log(`[Bot] Page navigated away from meeting: ${newUrl}`);
            meetingEndedByNav = true;
          }
        }
      });

      // ── Monitor for meeting end ──
      const endCheck = setInterval(async () => {
        try {
          const stillActive = await checkStillActive(id);
          if (!stillActive) {
            clearInterval(endCheck);
            clearInterval(transcriptFlush);
            await flushTranscripts(page, id).catch(() => {});
            closeDeepgram(id);
            await browser.close().catch(() => {});
            activeBots.delete(id);
            return;
          }

          const ended = await page.evaluate(() => {
            const text = (document.body.innerText || "").toLowerCase();
            const url = window.location.href.toLowerCase();

            // 1. Check page text for end indicators
            const endPhrases = [
              "meeting has ended",
              "host has ended",
              "host ended this meeting",
              "this meeting has been ended",
              "meeting ended",
              "you have been removed",
              "removed from the meeting",
              "meeting has been terminated",
              "the meeting is over",
              "thank you for attending",
              "return to home",
              "this meeting is not available",
              "meeting is no longer available",
              "invalid meeting id",
              "this meeting id is not valid",
              "meeting does not exist",
              "leave meeting",  // Zoom sometimes shows this after ending
            ];
            const textMatch = endPhrases.some((phrase) => text.includes(phrase));

            // 2. Check if URL changed away from the meeting (redirected to post-meeting page)
            const urlMatch =
              url.includes("/wc/leave") ||
              url.includes("/postattendee") ||
              url.includes("/meeting-ended") ||
              url.includes("reason=") ||
              (!url.includes("/wc/") && !url.includes("zoom.us/wc"));

            // 3. Check if the Zoom meeting UI elements are gone (meeting container disappeared)
            const meetingUI = document.querySelector(
              '[class*="meeting-app"], [class*="meeting-client"], #wc-container-left, ' +
              'button[aria-label*="Mute"], button[aria-label*="mute"], [class*="footer__inner"]'
            );
            // If we previously had meeting UI but now it's gone, meeting ended
            const uiGone = !meetingUI && window.__dtWasInMeeting;

            // Mark that we were in a meeting (for uiGone detection)
            if (meetingUI) window.__dtWasInMeeting = true;

            return textMatch || urlMatch || uiGone;
          });

          if (ended || meetingEndedByNav) {
            clearInterval(endCheck);
            clearInterval(transcriptFlush);
            console.log(`\n[Bot] Meeting ended: "${title}" (detected by: ${ended ? "page content" : "navigation"})`);

            await page.screenshot({ path: "debug-meeting-ended.png" }).catch(() => {});
            await flushTranscripts(page, id).catch(() => {});
            closeDeepgram(id);
            await reportEnded(id);

            console.log(`[Bot] Triggering summary generation...`);
            const summaryResult = await botApi(`/generate-summary/${id}`, "POST");
            console.log(`[Bot] Summary: ${summaryResult.success ? "Generated!" : (summaryResult.error || "pending")}`);

            await browser.close().catch(() => {});
            activeBots.delete(id);
          }
        } catch (e) {
          clearInterval(endCheck);
          clearInterval(transcriptFlush);
          await flushTranscripts(page, id).catch(() => {});
          closeDeepgram(id);
          await reportEnded(id).catch(() => {});
          await botApi(`/generate-summary/${id}`, "POST").catch(() => {});
          activeBots.delete(id);
        }
      }, 8000);

    } else {
      console.log(`[Bot] Timed out waiting to join`);
      await reportFailed(id, "Timed out waiting for host");
      await browser.close().catch(() => {});
      activeBots.delete(id);
    }

  } catch (error) {
    console.error(`[Bot] Error:`, error.message);
    await reportFailed(id, error.message).catch(() => {});
    if (browser) await browser.close().catch(() => {});
    activeBots.delete(id);
  }
}

// ═══════════════════════════════════════════════════════════
// ─── TRANSCRIPTION ENGINE ─────────────────────────────────
// ═══════════════════════════════════════════════════════════

/**
 * Set up audio capture bridge BEFORE Zoom loads.
 *
 * Uses a Chrome extension (loaded via --load-extension) that captures
 * ALL audio from the tab using chrome.tabCapture.capture().
 * The extension sends base64 PCM chunks via content script → postMessage.
 * This function sets up the page-side listener to receive those chunks
 * and forward them to Node.js via exposeFunction.
 */
async function setupAudioCapture(page, meetingId) {
  // Expose function so the page can send audio data to Node.js → Deepgram
  await page.exposeFunction("__dtSendAudioChunk", (base64PCM) => {
    const ws = deepgramConnections.get(meetingId);
    if (ws && ws.readyState === 1) { // WebSocket.OPEN
      const buffer = Buffer.from(base64PCM, "base64");
      ws.send(buffer);
    }
  });

  // Expose a logging function so we can see extension messages in Node.js terminal
  await page.exposeFunction("__dtLog", (msg) => {
    console.log(`[Page] ${msg}`);
  });

  // Set up page-level listener to receive audio from the extension's content script
  await page.evaluateOnNewDocument(() => {
    let chunkCount = 0;

    window.addEventListener("message", (event) => {
      // Audio chunks from the extension
      if (event.data?.type === "__DT_AUDIO__" && window.__dtSendAudioChunk) {
        try {
          window.__dtSendAudioChunk(event.data.data);
          chunkCount++;
          if (chunkCount <= 3 || chunkCount % 500 === 0) {
            window.__dtLog && window.__dtLog(`Audio chunk #${chunkCount} forwarded to Deepgram`);
          }
        } catch (e) {}
      }

      // Capture status updates
      if (event.data?.type === "__DT_CAPTURE_STATUS__") {
        const status = event.data.success ? "ACTIVE" : "FAILED";
        const err = event.data.error || "";
        window.__dtLog && window.__dtLog(`Tab audio capture: ${status} ${err}`);
      }
    });
  });

  console.log(`[Bot] Audio capture bridge configured for meeting ${meetingId}`);
}

/**
 * Start transcription after joining the meeting.
 * Tries multiple audio capture methods in order:
 *   1. Chrome extension tabCapture via CDP (most reliable)
 *   2. getDisplayMedia in page via CDP (no extension needed)
 *   3. Web Speech API (basic fallback)
 */
async function startTranscription(browser, page, meetingId) {
  // Initialize transcript storage on the page
  await page.evaluate(() => {
    window.__dtTranscripts = window.__dtTranscripts || [];
    window.__dtSeenTexts = new Set();
    window.__dtRecording = true;
    window.__dtStartTime = window.__dtStartTime || Date.now();
  });

  if (useDeepgram) {
    console.log(`[Bot] Starting Deepgram Nova-2 streaming transcription...`);

    // Connect to Deepgram WebSocket
    await startDeepgramStream(meetingId);

    let captureSuccess = false;

    // ── Method A: Chrome extension tabCapture via CDP ──
    try {
      captureSuccess = await triggerExtensionCapture(browser);
    } catch (err) {
      console.log(`[Bot] Extension capture error: ${err.message}`);
    }

    // ── Method B: getDisplayMedia via CDP (fallback) ──
    if (!captureSuccess) {
      console.log(`[Bot] Trying getDisplayMedia capture...`);
      try {
        captureSuccess = await triggerDisplayMediaCapture(page);
      } catch (err) {
        console.log(`[Bot] getDisplayMedia error: ${err.message}`);
      }
    }

    if (captureSuccess) {
      console.log(`[Bot] Tab audio capture ACTIVE — streaming to Deepgram`);
    } else {
      console.log(`[Bot] Audio capture failed. Falling back to Web Speech API.`);
      closeDeepgram(meetingId);
      await startWebSpeechFallback(page, meetingId);
    }
  } else {
    console.log(`[Bot] Starting Web Speech API transcription (fallback)...`);
    await startWebSpeechFallback(page, meetingId);
  }
}

/**
 * Method A: Trigger tab audio capture via the Chrome extension's background page.
 * Uses CDP Runtime.evaluate with userGesture=true to satisfy the invocation requirement.
 */
async function triggerExtensionCapture(browser) {
  const targets = await browser.targets();
  const bgTarget = targets.find((t) => t.type() === "background_page");

  if (!bgTarget) {
    console.log("[Bot] Extension background page not found");
    return false;
  }

  const client = await bgTarget.createCDPSession();

  // Get the active Zoom tab ID
  const { result: tabResult } = await client.send("Runtime.evaluate", {
    expression: `new Promise(r => chrome.tabs.query({active:true,currentWindow:true}, t => r(t[0]?.id || null)))`,
    awaitPromise: true,
    returnByValue: true,
    userGesture: true,
  });

  const tabId = tabResult.value;
  if (!tabId) {
    console.log("[Bot] Could not find active tab ID");
    return false;
  }

  console.log(`[Bot] Zoom tab ID: ${tabId} — triggering tabCapture via CDP...`);

  // Trigger capture with userGesture flag (bypasses invocation requirement)
  const { result: captureResult } = await client.send("Runtime.evaluate", {
    expression: `startCapture(${tabId})`,
    userGesture: true,
  });

  // Wait and check if capture started
  await delay(3000);

  const { result: statusResult } = await client.send("Runtime.evaluate", {
    expression: "capturing",
    returnByValue: true,
  });

  if (statusResult.value === true) {
    console.log("[Bot] Extension tabCapture STARTED via CDP");
    return true;
  } else {
    console.log("[Bot] Extension tabCapture did not start");
    return false;
  }
}

/**
 * Method B: Use getDisplayMedia to capture tab audio directly in the page.
 * Uses preferCurrentTab to capture THIS tab (which includes audio).
 * The --auto-select-desktop-capture-source=Zoom flag auto-approves the picker.
 * CDP userGesture=true satisfies the user gesture requirement.
 */
async function triggerDisplayMediaCapture(page) {
  const client = await page.target().createCDPSession();

  const { result } = await client.send("Runtime.evaluate", {
    expression: `
      (async () => {
        const log = window.__dtLog || console.log.bind(console);
        try {
          log('getDisplayMedia: requesting stream with preferCurrentTab...');

          const stream = await navigator.mediaDevices.getDisplayMedia({
            audio: true,
            video: true,
            preferCurrentTab: true,
            selfBrowserSurface: 'include'
          });

          const videoTracks = stream.getVideoTracks();
          const audioTracks = stream.getAudioTracks();
          log('getDisplayMedia: got ' + videoTracks.length + ' video, ' + audioTracks.length + ' audio tracks');

          // Stop video track — we only need audio
          videoTracks.forEach(t => t.stop());

          if (audioTracks.length === 0) {
            return { success: false, error: 'No audio tracks in captured stream' };
          }

          const audioTrack = audioTracks[0];
          log('getDisplayMedia: audio track label=' + audioTrack.label + ' readyState=' + audioTrack.readyState);

          const audioStream = new MediaStream([audioTrack]);
          const ctx = new AudioContext({ sampleRate: 16000 });
          const source = ctx.createMediaStreamSource(audioStream);
          const processor = ctx.createScriptProcessor(4096, 1, 1);

          // Check if __dtSendAudioChunk is available
          const hasSendFn = typeof window.__dtSendAudioChunk === 'function';
          log('getDisplayMedia: __dtSendAudioChunk available = ' + hasSendFn);

          let count = 0;
          let nonSilentCount = 0;

          processor.onaudioprocess = (e) => {
            const float32 = e.inputBuffer.getChannelData(0);

            // Check if audio has actual sound (not just silence)
            let maxAmp = 0;
            for (let i = 0; i < float32.length; i += 64) {
              const amp = Math.abs(float32[i]);
              if (amp > maxAmp) maxAmp = amp;
            }
            const hasSoundData = maxAmp > 0.001;
            if (hasSoundData) nonSilentCount++;

            // Convert Float32 → Int16 (linear16 for Deepgram)
            const int16 = new Int16Array(float32.length);
            for (let i = 0; i < float32.length; i++) {
              const s = Math.max(-1, Math.min(1, float32[i]));
              int16[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
            }
            const bytes = new Uint8Array(int16.buffer);
            let binary = '';
            for (let i = 0; i < bytes.length; i++) {
              binary += String.fromCharCode(bytes[i]);
            }

            count++;
            if (count <= 5 || count % 200 === 0) {
              const logFn = window.__dtLog || console.log.bind(console);
              logFn('Audio chunk #' + count + ' maxAmp=' + maxAmp.toFixed(4) + ' nonSilent=' + nonSilentCount + '/' + count);
            }

            try {
              if (window.__dtSendAudioChunk) {
                window.__dtSendAudioChunk(btoa(binary));
              }
            } catch(err) {
              if (count <= 3) {
                const logFn = window.__dtLog || console.log.bind(console);
                logFn('__dtSendAudioChunk error: ' + err.message);
              }
            }
          };

          source.connect(processor);
          processor.connect(ctx.destination);

          audioTrack.onended = () => {
            const logFn = window.__dtLog || console.log.bind(console);
            logFn('getDisplayMedia audio track ended. Total chunks=' + count + ' nonSilent=' + nonSilentCount);
          };

          return { success: true };
        } catch (e) {
          log('getDisplayMedia error: ' + e.message);
          return { success: false, error: e.message };
        }
      })()
    `,
    awaitPromise: true,
    returnByValue: true,
    userGesture: true,
  });

  if (result.value?.success) {
    console.log("[Bot] getDisplayMedia capture STARTED");
    return true;
  } else {
    console.log(`[Bot] getDisplayMedia failed: ${result.value?.error}`);
    return false;
  }
}

/**
 * DEEPGRAM MODE — Connect to Deepgram's real-time streaming API.
 * Audio is already being sent from the WebRTC interception patch.
 */
async function startDeepgramStream(meetingId) {
  const WebSocket = require("ws");

  const params = new URLSearchParams({
    model: "nova-2",
    language: "en",
    smart_format: "true",
    punctuate: "true",
    diarize: "true",
    interim_results: "false",
    endpointing: "300",
    encoding: "linear16",
    sample_rate: "16000",
    channels: "1",
  });

  const dgUrl = `wss://api.deepgram.com/v1/listen?${params}`;

  const ws = new WebSocket(dgUrl, {
    headers: { Authorization: `Token ${DEEPGRAM_API_KEY}` },
  });

  // Initialize buffer for this meeting
  deepgramBuffers.set(meetingId, []);

  ws.on("open", () => {
    console.log(`[Bot] Deepgram WebSocket connected — streaming audio`);
    deepgramConnections.set(meetingId, ws);
  });

  ws.on("message", (data) => {
    try {
      const msg = JSON.parse(data.toString());
      const alt = msg?.channel?.alternatives?.[0];
      if (!alt?.transcript) return;

      const text = alt.transcript.trim();
      if (!text || !msg.is_final) return;

      // Extract speaker from diarization
      const speaker = alt.words?.[0]?.speaker;
      const speakerLabel = speaker !== undefined ? `Speaker ${speaker}` : "Speaker";
      const startMs = Math.floor((msg.start || 0) * 1000);
      const endMs = Math.floor(((msg.start || 0) + (msg.duration || 0)) * 1000);

      const buffer = deepgramBuffers.get(meetingId) || [];
      buffer.push({
        content: text,
        speaker: speakerLabel,
        startMs,
        endMs,
        confidence: alt.confidence || 1.0,
        source: "deepgram",
      });
      deepgramBuffers.set(meetingId, buffer);

      console.log(`[Deepgram] ${speakerLabel}: ${text.substring(0, 80)}`);
    } catch (e) { /* parse error */ }
  });

  ws.on("error", (err) => {
    console.error(`[Bot] Deepgram WebSocket error:`, err.message);
  });

  ws.on("close", (code, reason) => {
    console.log(`[Bot] Deepgram connection closed (${code})`);
    deepgramConnections.delete(meetingId);
  });
}

/**
 * WEB SPEECH API FALLBACK — for when no Deepgram key is available.
 * Uses Chrome's built-in speech recognition via system microphone.
 *
 * For better results, enable "Stereo Mix" in Windows Sound Settings
 * so the mic hears system audio directly instead of through speakers.
 */
async function startWebSpeechFallback(page, meetingId) {
  console.log(`[Bot] TIP: Enable "Stereo Mix" in Windows Sound Settings for better transcription.`);

  try {
    await page.evaluate(() => {
      if (window.__dtWebSpeechStarted) return;
      window.__dtWebSpeechStarted = true;

      const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
      if (!SR) { console.log("[DT-Bot] SpeechRecognition not available"); return; }

      let sessionId = 0;

      function startSession() {
        if (!window.__dtRecording) return;
        sessionId++;
        const sid = sessionId;

        const r = new SR();
        r.continuous = true;
        r.interimResults = false;
        r.lang = "en-US";

        r.onresult = (event) => {
          for (let i = event.resultIndex; i < event.results.length; i++) {
            if (event.results[i].isFinal) {
              const text = event.results[i][0].transcript.trim();
              if (text && !window.__dtSeenTexts.has(text)) {
                window.__dtSeenTexts.add(text);
                window.__dtTranscripts.push({
                  content: text,
                  speaker: "Speaker",
                  startMs: Date.now() - window.__dtStartTime,
                  confidence: event.results[i][0].confidence || 0.8,
                  source: "webspeech",
                });
                console.log(`[DT-Speech] "${text.substring(0, 60)}"`);
              }
            }
          }
        };

        r.onerror = (e) => {
          if (e.error === "no-speech") setTimeout(startSession, 300);
          else if (e.error === "not-allowed") console.log("[DT-Speech] Mic denied!");
          else setTimeout(startSession, 1000);
        };

        r.onend = () => {
          if (window.__dtRecording && sid === sessionId) setTimeout(startSession, 200);
        };

        try { r.start(); } catch (e) { setTimeout(startSession, 1000); }
      }

      startSession();
      console.log("[DT-Bot] Web Speech API started");
    });

    console.log(`[Bot] Web Speech API active`);
  } catch (e) {
    console.log(`[Bot] Web Speech API failed: ${e.message}`);
  }
}

/**
 * Flush transcripts to server — collects from Deepgram buffer and/or page
 */
async function flushTranscripts(page, meetingId) {
  try {
    let segments = [];

    // Get Deepgram buffer (stored in Node.js memory)
    const dgBuffer = deepgramBuffers.get(meetingId);
    if (dgBuffer && dgBuffer.length > 0) {
      segments = [...dgBuffer];
      dgBuffer.length = 0; // Clear buffer
    }

    // Also get any Web Speech API results from the page
    try {
      const pageSegments = await page.evaluate(() => {
        const data = window.__dtTranscripts || [];
        window.__dtTranscripts = [];
        return data;
      });
      if (pageSegments.length > 0) {
        segments = segments.concat(pageSegments);
      }
    } catch (e) { /* page closed */ }

    if (segments.length === 0) return;

    // Enrich with endMs
    const enriched = segments.map((seg, i) => ({
      ...seg,
      endMs: seg.endMs || (segments[i + 1] ? segments[i + 1].startMs : seg.startMs + 5000),
    }));

    console.log(`[Bot] Flushing ${enriched.length} transcript segments:`);
    for (const seg of enriched) {
      console.log(`  [${seg.source}] ${seg.speaker}: ${seg.content.substring(0, 70)}`);
    }

    await botApi(`/transcript/${meetingId}`, "POST", { segments: enriched });
  } catch (e) {
    // Page might be closed
  }
}

/**
 * Close Deepgram connection for a meeting
 */
function closeDeepgram(meetingId) {
  const ws = deepgramConnections.get(meetingId);
  if (ws) {
    try { ws.close(); } catch (e) {}
    deepgramConnections.delete(meetingId);
  }
  deepgramBuffers.delete(meetingId);
}

// ─── Helpers ────────────────────────────────────────────

function delay(ms) {
  return new Promise(r => setTimeout(r, ms));
}

// ─── Graceful Shutdown ──────────────────────────────────

process.on("SIGINT", async () => {
  console.log("\n[Bot] Shutting down...");
  for (const [mid] of deepgramConnections) closeDeepgram(mid);
  for (const [, bot] of activeBots) {
    if (bot.browser) await bot.browser.close().catch(() => {});
  }
  console.log("[Bot] Goodbye!");
  process.exit(0);
});

// ─── Start ──────────────────────────────────────────────

startPolling();
