/**
 * Digital Twin — Local Zoom Bot (Fully Automated)
 *
 * Joins Zoom meetings as "Vaibhav Mujage" via browser.
 * Uses BOT_SECRET for auth — no Microsoft login needed.
 * Reports status back to the API so dashboard updates automatically.
 *
 * Usage:
 *   cd bot-local
 *   npm install
 *   node bot.js
 *
 * Or just double-click START-BOT.bat
 */

require("dotenv").config();
const puppeteer = require("puppeteer");

// ─── Configuration ──────────────────────────────────────
const API_URL = process.env.API_URL || "https://digital-twin-api-13y1.onrender.com/api";
const BOT_SECRET = process.env.BOT_SECRET || "dt-bot-secret-2024";
const DEEPGRAM_API_KEY = process.env.DEEPGRAM_API_KEY || "";
const BOT_NAME = "Vaibhav Mujage";
const POLL_INTERVAL = 8000;
const activeBots = new Map(); // meetingId -> { browser, page, status }
const useDeepgram = DEEPGRAM_API_KEY && DEEPGRAM_API_KEY !== "placeholder";

console.log(`
╔══════════════════════════════════════════════╗
║      Digital Twin — Local Zoom Bot           ║
║                                              ║
║  Bot Name:  ${BOT_NAME.padEnd(33)}║
║  API:       ${API_URL.substring(0, 33).padEnd(33)}║
║  Polling:   Every ${POLL_INTERVAL / 1000}s                        ║
║  Auth:      BOT_SECRET                       ║
║  Transcribe: ${(useDeepgram ? "Deepgram (high accuracy)" : "Web Speech API (basic)").padEnd(32)}║
║                                              ║
║  Press Ctrl+C to stop                        ║
╚══════════════════════════════════════════════╝
`);

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

        // Mark as active immediately to prevent double-joining
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

    // Method 1: Find name input by common selectors
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

    // Method 2: Use React native setter
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

    if (!nameSet) {
      console.log(`[Bot] WARNING: Could not find name input — continuing anyway`);
    }

    await delay(1000);

    // ── Accept checkboxes (terms, agreements) ──
    await page.evaluate(() => {
      const checkboxes = document.querySelectorAll('input[type="checkbox"]');
      checkboxes.forEach(cb => { if (!cb.checked) cb.click(); });
    });
    console.log(`[Bot] Checked any required checkboxes`);

    await delay(500);

    // ── Click Join Button ──
    console.log(`[Bot] Looking for Join button...`);
    let joinClicked = false;

    // Method 1: Find by button text
    joinClicked = await page.evaluate(() => {
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

    // Method 2: Try specific Zoom selectors
    if (!joinClicked) {
      const joinSelectors = [
        "#joinBtn",
        'button[id*="join" i]',
        'button.join-btn',
        'button.zm-btn--primary',
        'button.preview-join-button',
        'button[class*="join" i]',
      ];
      for (const sel of joinSelectors) {
        try {
          const btn = await page.$(sel);
          if (btn) {
            await btn.click();
            joinClicked = true;
            console.log(`[Bot] Join clicked via selector: ${sel}`);
            break;
          }
        } catch (e) { /* try next */ }
      }
    }

    // Method 3: Press Enter as fallback
    if (!joinClicked) {
      console.log(`[Bot] Trying Enter key as fallback...`);
      await page.keyboard.press("Enter");
      joinClicked = true;
    }

    console.log(`[Bot] Join button clicked: ${joinClicked}`);

    await delay(4000);
    await page.screenshot({ path: "debug-step2-join-clicked.png" });

    // ── Handle Passcode Prompt ──
    if (zoomPasscode) {
      const passcodeInput = await page.$(
        '#inputpasscode, input[type="password"], input[placeholder*="passcode" i], input[placeholder*="password" i]'
      );
      if (passcodeInput) {
        await passcodeInput.click({ clickCount: 3 });
        await passcodeInput.type(zoomPasscode, { delay: 50 });
        console.log(`[Bot] Entered passcode`);
        await delay(1000);

        await page.evaluate(() => {
          const buttons = document.querySelectorAll("button");
          for (const btn of buttons) {
            if ((btn.textContent || "").toLowerCase().includes("join")) {
              btn.click();
              break;
            }
          }
        });
        await delay(3000);
      }
    }

    // ── Handle "Join Audio by Computer" popup ──
    await delay(2000);
    await page.evaluate(() => {
      const buttons = document.querySelectorAll("button");
      for (const btn of buttons) {
        const text = (btn.textContent || "").toLowerCase();
        if (text.includes("join audio") || text.includes("computer audio") || text.includes("join with computer")) {
          btn.click();
          break;
        }
      }
    });

    // Report waiting in lobby
    await reportWaiting(id);
    console.log(`\n[Bot] Waiting for host to admit "${BOT_NAME}"...`);
    console.log(`[Bot] The host will see "${BOT_NAME}" in the waiting room.\n`);

    // ── Wait for Meeting Join ──
    activeBots.set(id, { status: "waiting", browser, page });
    let inMeeting = false;
    let attempts = 0;
    const MAX_WAIT_ATTEMPTS = 120; // 10 minutes max wait

    while (!inMeeting && attempts < MAX_WAIT_ATTEMPTS) {
      attempts++;
      await delay(5000);

      // Check if meeting was cancelled from dashboard
      const stillActive = await checkStillActive(id);
      if (!stillActive) {
        console.log(`[Bot] Meeting ${id} was cancelled from dashboard — closing browser`);
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
            document.querySelector('[class*="meeting-info"]'),
            document.querySelector('[class*="video-avatar"]'),
            document.querySelector('[class*="chat-container"]'),
          ];
          return indicators.some(el => el !== null);
        });

        if (inMeeting) break;

        const pageText = await page.evaluate(() => document.body.innerText || "");
        if (
          pageText.includes("meeting has ended") ||
          pageText.includes("host has ended") ||
          pageText.includes("removed from the meeting") ||
          pageText.includes("meeting has been locked")
        ) {
          console.log(`[Bot] Meeting ended or access denied`);
          await reportFailed(id, "Meeting ended or access denied");
          await browser.close().catch(() => {});
          activeBots.delete(id);
          return;
        }

        // Handle "Join Audio" popup again
        await page.evaluate(() => {
          const buttons = document.querySelectorAll("button");
          for (const btn of buttons) {
            const text = (btn.textContent || "").toLowerCase();
            if (text.includes("join audio") || text.includes("computer audio")) {
              btn.click();
              break;
            }
          }
        });

      } catch (e) { /* page navigated */ }

      if (attempts % 12 === 0) {
        console.log(`[Bot] Still waiting... (${attempts * 5}s)`);
        await page.screenshot({ path: `debug-waiting-${attempts}.png` }).catch(() => {});
      }
    }

    // ── Handle Join Result ──
    if (inMeeting) {
      console.log(`\n${"=".repeat(50)}`);
      console.log(`[Bot] JOINED: ${title}`);
      console.log(`[Bot] As: ${BOT_NAME}`);
      console.log(`[Bot] Meeting is LIVE`);
      console.log(`${"=".repeat(50)}\n`);

      await reportJoined(id);

      activeBots.set(id, { status: "active", browser, page });

      await page.screenshot({ path: "debug-step3-in-meeting.png" });

      // ── Start Speech Recognition for Transcription ──
      console.log(`[Bot] Starting speech recognition for transcription...`);
      await startSpeechRecognition(page, id);

      // ── Periodically flush transcripts to server ──
      const transcriptFlush = setInterval(async () => {
        try {
          await flushTranscripts(page, id);
        } catch (e) { /* page may have closed */ }
      }, 15000); // Every 15 seconds

      // ── Monitor for meeting end ──
      const endCheck = setInterval(async () => {
        try {
          const stillActive = await checkStillActive(id);
          if (!stillActive) {
            clearInterval(endCheck);
            clearInterval(transcriptFlush);
            await flushTranscripts(page, id).catch(() => {}); // Final flush
            console.log(`[Bot] Meeting ${id} cancelled — leaving`);
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
            // Final transcript flush + close Deepgram
            await flushTranscripts(page, id).catch(() => {});
            closeDeepgram(id);
            // Report ended and trigger summary
            await reportEnded(id);
            console.log(`[Bot] Triggering summary generation...`);
            const summaryResult = await botApi(`/generate-summary/${id}`, "POST");
            if (summaryResult.success) {
              console.log(`[Bot] Summary generated successfully!`);
            } else {
              console.log(`[Bot] Summary: ${summaryResult.error || "pending"}`);
            }
            await browser.close().catch(() => {});
            activeBots.delete(id);
          }
        } catch (e) {
          clearInterval(endCheck);
          clearInterval(transcriptFlush);
          await flushTranscripts(page, id).catch(() => {});
          closeDeepgram(id);
          await reportEnded(id).catch(() => {});
          // Try to generate summary even on error
          await botApi(`/generate-summary/${id}`, "POST").catch(() => {});
          activeBots.delete(id);
        }
      }, 8000);

    } else {
      console.log(`[Bot] Timed out waiting to join "${title}"`);
      await reportFailed(id, "Timed out waiting for host to admit bot");
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

// ─── Speech Recognition & Transcription ─────────────────

// Active Deepgram connections per meeting
const deepgramConnections = new Map();

/**
 * Start transcription for a meeting.
 * Uses Deepgram if API key is available, otherwise Web Speech API.
 */
async function startSpeechRecognition(page, meetingId) {
  if (useDeepgram) {
    await startDeepgramTranscription(page, meetingId);
  } else {
    await startWebSpeechTranscription(page, meetingId);
  }
}

/**
 * Deepgram Mode — Capture tab audio and stream to Deepgram WebSocket
 * Gives speaker diarization, high accuracy, proper timestamps
 */
async function startDeepgramTranscription(page, meetingId) {
  try {
    const WebSocket = require("ws");

    // Connect to Deepgram's real-time API
    const dgUrl = `wss://api.deepgram.com/v1/listen?model=nova-2&language=en&smart_format=true&punctuate=true&diarize=true&utterances=true&interim_results=false&endpointing=300`;

    const ws = new WebSocket(dgUrl, {
      headers: { Authorization: `Token ${DEEPGRAM_API_KEY}` },
    });

    const transcriptBuffer = [];

    ws.on("open", () => {
      console.log(`[Bot] Deepgram connected for meeting ${meetingId}`);
      deepgramConnections.set(meetingId, { ws, buffer: transcriptBuffer });
    });

    ws.on("message", (data) => {
      try {
        const msg = JSON.parse(data.toString());
        const alt = msg?.channel?.alternatives?.[0];
        if (!alt?.transcript) return;

        const text = alt.transcript.trim();
        if (!text) return;
        if (!msg.is_final) return;

        const speaker = alt.words?.[0]?.speaker;
        const speakerLabel = speaker !== undefined ? `Speaker ${speaker}` : "Unknown";
        const startMs = Math.floor((msg.start || 0) * 1000);
        const endMs = Math.floor(((msg.start || 0) + (msg.duration || 0)) * 1000);

        transcriptBuffer.push({
          content: text,
          speaker: speakerLabel,
          startMs,
          endMs,
          confidence: alt.confidence || 1.0,
        });

        console.log(`[Transcript] ${speakerLabel}: ${text.substring(0, 80)}...`);
      } catch (e) { /* parse error */ }
    });

    ws.on("error", (err) => {
      console.error(`[Bot] Deepgram WebSocket error:`, err.message);
    });

    ws.on("close", () => {
      console.log(`[Bot] Deepgram connection closed for meeting ${meetingId}`);
      deepgramConnections.delete(meetingId);
    });

    // Capture tab audio using Chrome DevTools Protocol
    const client = await page.createCDPSession();

    // Enable audio capture by injecting an AudioContext that captures tab output
    await page.evaluate(() => {
      window.__dtTranscripts = [];
      window.__dtRecording = true;
      window.__dtStartTime = Date.now();

      // Try to capture audio using AudioContext
      try {
        const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        // Listen for any audio elements and capture them
        const observer = new MutationObserver(() => {
          const audioElements = document.querySelectorAll("audio, video");
          audioElements.forEach((el) => {
            if (!el.__dtCaptured) {
              el.__dtCaptured = true;
              try {
                const source = audioCtx.createMediaElementSource(el);
                source.connect(audioCtx.destination);
              } catch (e) { /* already captured */ }
            }
          });
        });
        observer.observe(document.body, { childList: true, subtree: true });
        console.log("[DT-Bot] Audio capture initialized");
      } catch (e) {
        console.log("[DT-Bot] Audio capture failed:", e.message);
      }
    });

    // Also start Web Speech API as a parallel capture method
    await startWebSpeechTranscription(page, meetingId);

    console.log(`[Bot] Deepgram + Web Speech both active for meeting ${meetingId}`);

  } catch (e) {
    console.log(`[Bot] Deepgram setup failed: ${e.message}`);
    console.log(`[Bot] Falling back to Web Speech API only`);
    await startWebSpeechTranscription(page, meetingId);
  }
}

/**
 * Web Speech API Mode — Free, built into Chrome
 * Basic transcription without speaker identification
 */
async function startWebSpeechTranscription(page, meetingId) {
  try {
    await page.evaluate(() => {
      // Don't double-initialize
      if (window.__dtSpeechStarted) return;
      window.__dtSpeechStarted = true;

      window.__dtTranscripts = window.__dtTranscripts || [];
      window.__dtRecording = true;
      window.__dtStartTime = window.__dtStartTime || Date.now();

      const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
      if (!SpeechRecognition) {
        console.log("[DT-Bot] SpeechRecognition not available");
        return;
      }

      function startRecognizer() {
        if (!window.__dtRecording) return;

        const recognition = new SpeechRecognition();
        recognition.continuous = true;
        recognition.interimResults = false;
        recognition.lang = "en-US";
        recognition.maxAlternatives = 1;

        recognition.onresult = (event) => {
          for (let i = event.resultIndex; i < event.results.length; i++) {
            if (event.results[i].isFinal) {
              const text = event.results[i][0].transcript.trim();
              if (text) {
                window.__dtTranscripts.push({
                  content: text,
                  confidence: event.results[i][0].confidence,
                  startMs: Date.now() - window.__dtStartTime,
                  speaker: "Speaker",
                });
              }
            }
          }
        };

        recognition.onerror = (event) => {
          if (event.error === "no-speech" || event.error === "aborted") {
            setTimeout(startRecognizer, 500);
          } else {
            console.log("[DT-Bot] Speech error:", event.error);
            setTimeout(startRecognizer, 2000);
          }
        };

        recognition.onend = () => {
          if (window.__dtRecording) setTimeout(startRecognizer, 300);
        };

        try { recognition.start(); } catch (e) { setTimeout(startRecognizer, 1000); }
      }

      startRecognizer();
      console.log("[DT-Bot] Web Speech API started");
    });
    console.log(`[Bot] Web Speech API active for meeting ${meetingId}`);
  } catch (e) {
    console.log(`[Bot] Could not start speech recognition: ${e.message}`);
  }
}

/**
 * Collect captured transcripts from the page and Deepgram, send to server
 */
async function flushTranscripts(page, meetingId) {
  try {
    // Get Web Speech API transcripts from the page
    let webSegments = [];
    try {
      webSegments = await page.evaluate(() => {
        const data = window.__dtTranscripts || [];
        window.__dtTranscripts = [];
        return data;
      });
    } catch (e) { /* page closed */ }

    // Get Deepgram transcripts from buffer
    let dgSegments = [];
    const dgConn = deepgramConnections.get(meetingId);
    if (dgConn && dgConn.buffer.length > 0) {
      dgSegments = [...dgConn.buffer];
      dgConn.buffer.length = 0; // Clear buffer
    }

    // Prefer Deepgram segments (they have speaker info), fall back to Web Speech
    const segments = dgSegments.length > 0 ? dgSegments : webSegments;

    if (segments.length === 0) return;

    // Enrich with endMs if missing
    const enriched = segments.map((seg, i) => ({
      ...seg,
      endMs: seg.endMs || (segments[i + 1] ? segments[i + 1].startMs : seg.startMs + 5000),
    }));

    console.log(`[Bot] Flushing ${enriched.length} transcript segments (${dgSegments.length > 0 ? "Deepgram" : "WebSpeech"})`);

    await botApi(`/transcript/${meetingId}`, "POST", { segments: enriched });
  } catch (e) {
    // Page might be closed
  }
}

/**
 * Close Deepgram connection for a meeting
 */
function closeDeepgram(meetingId) {
  const conn = deepgramConnections.get(meetingId);
  if (conn && conn.ws) {
    try { conn.ws.close(); } catch (e) {}
    deepgramConnections.delete(meetingId);
  }
}

// ─── Helpers ────────────────────────────────────────────

function delay(ms) {
  return new Promise(r => setTimeout(r, ms));
}

// ─── Graceful Shutdown ──────────────────────────────────

process.on("SIGINT", async () => {
  console.log("\n[Bot] Shutting down...");
  for (const [, bot] of activeBots) {
    if (bot.browser) await bot.browser.close().catch(() => {});
  }
  console.log("[Bot] Goodbye!");
  process.exit(0);
});

// ─── Start ──────────────────────────────────────────────

startPolling();
