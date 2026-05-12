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
    browser = await puppeteer.launch({
      headless: false,
      defaultViewport: { width: 1280, height: 720 },
      args: [
        "--disable-notifications",
        "--use-fake-ui-for-media-stream",
        "--use-fake-device-for-media-stream",
        "--autoplay-policy=no-user-gesture-required",
        "--no-first-run",
        "--no-default-browser-check",
        "--disable-extensions",
        "--disable-popup-blocking",
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

    // ── Set up WebRTC audio interception BEFORE navigating to Zoom ──
    if (useDeepgram) {
      await setupWebRTCInterception(page, id);
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

      // ── Start Transcription ──
      await startTranscription(page, id);

      // ── Periodic transcript flush ──
      const transcriptFlush = setInterval(async () => {
        try { await flushTranscripts(page, id); } catch (e) {}
      }, 10000);

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
            const text = document.body.innerText || "";
            return (
              text.includes("meeting has ended") ||
              text.includes("host has ended") ||
              text.includes("you have been removed") ||
              text.includes("The host ended this meeting") ||
              text.includes("This meeting has been ended") ||
              text.includes("Meeting Ended")
            );
          });

          if (ended) {
            clearInterval(endCheck);
            clearInterval(transcriptFlush);
            console.log(`\n[Bot] Meeting ended: "${title}"`);

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
 * Set up WebRTC interception BEFORE Zoom loads.
 *
 * This patches RTCPeerConnection so when Zoom receives audio
 * from other participants, we intercept the audio track,
 * capture raw PCM via AudioContext + ScriptProcessor,
 * and send it to Node.js for Deepgram streaming.
 */
async function setupWebRTCInterception(page, meetingId) {
  // Expose a function so the browser page can send audio data to Node.js
  await page.exposeFunction("__dtSendAudioChunk", (base64PCM) => {
    const ws = deepgramConnections.get(meetingId);
    if (ws && ws.readyState === 1) { // WebSocket.OPEN
      const buffer = Buffer.from(base64PCM, "base64");
      ws.send(buffer);
    }
  });

  // Inject RTCPeerConnection patch that runs on EVERY new document
  await page.evaluateOnNewDocument(() => {
    if (window.__dtRTCPatched) return;
    window.__dtRTCPatched = true;

    const OrigRTC = window.RTCPeerConnection;

    window.RTCPeerConnection = function (...args) {
      const pc = new OrigRTC(...args);

      pc.addEventListener("track", (event) => {
        if (event.track.kind === "audio" && !window.__dtAudioCaptureActive) {
          window.__dtAudioCaptureActive = true;
          console.log("[DT-Bot] WebRTC audio track intercepted!");

          const stream = event.streams[0] || new MediaStream([event.track]);

          try {
            const ctx = new AudioContext({ sampleRate: 16000 });
            const source = ctx.createMediaStreamSource(stream);

            // ScriptProcessorNode captures raw PCM for Deepgram
            const processor = ctx.createScriptProcessor(4096, 1, 1);

            processor.onaudioprocess = (e) => {
              if (!window.__dtRecording) return;

              const float32 = e.inputBuffer.getChannelData(0);

              // Convert Float32 [-1,1] → Int16 [-32768,32767] (Deepgram linear16)
              const int16 = new Int16Array(float32.length);
              for (let i = 0; i < float32.length; i++) {
                const s = Math.max(-1, Math.min(1, float32[i]));
                int16[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
              }

              // Convert to base64 for transfer to Node.js
              const bytes = new Uint8Array(int16.buffer);
              let binary = "";
              const chunkSize = 8192;
              for (let i = 0; i < bytes.length; i += chunkSize) {
                const slice = bytes.subarray(i, Math.min(i + chunkSize, bytes.length));
                for (let j = 0; j < slice.length; j++) {
                  binary += String.fromCharCode(slice[j]);
                }
              }

              try {
                window.__dtSendAudioChunk(btoa(binary));
              } catch (err) {
                // Function not available yet
              }
            };

            source.connect(processor);
            processor.connect(ctx.destination); // Keep audio playing

            console.log("[DT-Bot] Audio capture pipeline: WebRTC → PCM16 → Deepgram");
          } catch (err) {
            console.error("[DT-Bot] Audio capture setup failed:", err.message);
          }
        }
      });

      return pc;
    };

    // Preserve prototype and static methods
    window.RTCPeerConnection.prototype = OrigRTC.prototype;
    if (OrigRTC.generateCertificate) {
      window.RTCPeerConnection.generateCertificate = OrigRTC.generateCertificate;
    }

    console.log("[DT-Bot] RTCPeerConnection patched for audio interception");
  });

  console.log(`[Bot] WebRTC audio interception set up for meeting ${meetingId}`);
}

/**
 * Start transcription after joining the meeting.
 * Deepgram mode: Connect WebSocket, audio already flowing from WebRTC patch.
 * Fallback mode: Use Web Speech API.
 */
async function startTranscription(page, meetingId) {
  // Initialize transcript storage on the page
  await page.evaluate(() => {
    window.__dtTranscripts = window.__dtTranscripts || [];
    window.__dtSeenTexts = new Set();
    window.__dtRecording = true;
    window.__dtStartTime = window.__dtStartTime || Date.now();
  });

  if (useDeepgram) {
    console.log(`[Bot] Starting Deepgram Nova-2 streaming transcription...`);
    await startDeepgramStream(meetingId);
  } else {
    console.log(`[Bot] Starting Web Speech API transcription (fallback)...`);
    await startWebSpeechFallback(page, meetingId);
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
