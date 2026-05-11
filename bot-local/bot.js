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
console.log(`
╔══════════════════════════════════════════════╗
║      Digital Twin — Local Zoom Bot           ║
║                                              ║
║  Bot Name:  ${BOT_NAME.padEnd(33)}║
║  API:       ${API_URL.substring(0, 33).padEnd(33)}║
║  Polling:   Every ${POLL_INTERVAL / 1000}s                        ║
║  Auth:      BOT_SECRET                       ║
║  Transcribe: Zoom Live Captions (DOM scrape) ║
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

// ─── Transcription via Zoom's Live Captions ────────────────
//
// WHY: Web Speech API listens to the microphone, but Puppeteer uses
//      a fake device (--use-fake-device-for-media-stream) so it hears
//      almost nothing. Instead we enable Zoom's built-in Live Transcript
//      and scrape the caption text from the DOM. Zoom does its own
//      speech-to-text with speaker names — much more reliable.

/**
 * Start transcription for a meeting.
 * Enables Zoom's Live Transcript / CC button and scrapes captions.
 */
async function startSpeechRecognition(page, meetingId) {
  console.log(`[Bot] Enabling Zoom Live Captions for transcription...`);

  // Initialize transcript store on the page
  await page.evaluate(() => {
    window.__dtTranscripts = [];
    window.__dtSeenCaptions = new Set();
    window.__dtRecording = true;
    window.__dtStartTime = Date.now();
  });

  // Try to click the "Live Transcript" / "CC" button to enable captions
  await enableZoomCaptions(page);

  // Start a MutationObserver on the page to capture caption elements in real time
  await page.evaluate(() => {
    if (window.__dtCaptionObserverStarted) return;
    window.__dtCaptionObserverStarted = true;

    // Zoom renders captions in various containers. We scan for new text nodes
    // in elements that match Zoom's caption patterns.
    const captionSelectors = [
      // Zoom Web Client caption containers (various versions)
      '[class*="caption"]',
      '[class*="subtitle"]',
      '[class*="transcript"]',
      '[class*="closed-caption"]',
      '[class*="live-transcription"]',
      '[id*="caption"]',
      '[id*="transcript"]',
      // Zoom's specific transcript panel elements
      '.transcript-message',
      '.caption-text',
      '.live-transcript-content',
    ];

    function scrapeCaptions() {
      if (!window.__dtRecording) return;

      // Method 1: Look for caption/subtitle elements by class
      for (const sel of captionSelectors) {
        const elements = document.querySelectorAll(sel);
        elements.forEach((el) => {
          // Get all text content spans inside caption containers
          const textNodes = el.querySelectorAll("span, p, div");
          if (textNodes.length === 0) {
            // Check the element itself
            const txt = (el.textContent || "").trim();
            if (txt && txt.length > 1 && !window.__dtSeenCaptions.has(txt)) {
              window.__dtSeenCaptions.add(txt);
              window.__dtTranscripts.push({
                content: txt,
                speaker: "Speaker",
                startMs: Date.now() - window.__dtStartTime,
                confidence: 0.9,
              });
            }
          } else {
            textNodes.forEach((node) => {
              const txt = (node.textContent || "").trim();
              if (txt && txt.length > 1 && !window.__dtSeenCaptions.has(txt)) {
                window.__dtSeenCaptions.add(txt);
                // Try to detect speaker from nearby elements
                let speaker = "Speaker";
                const parent = node.closest('[class*="caption"], [class*="transcript"]');
                if (parent) {
                  const speakerEl = parent.querySelector(
                    '[class*="speaker"], [class*="name"], [class*="user"], [class*="sender"]'
                  );
                  if (speakerEl) {
                    speaker = (speakerEl.textContent || "").trim().replace(/:$/, "") || "Speaker";
                  }
                }
                window.__dtTranscripts.push({
                  content: txt,
                  speaker,
                  startMs: Date.now() - window.__dtStartTime,
                  confidence: 0.9,
                });
              }
            });
          }
        });
      }

      // Method 2: Look for Zoom's transcript panel items (when user opens transcript panel)
      const transcriptItems = document.querySelectorAll(
        '[class*="transcript"] [class*="message"], [class*="transcript"] [class*="item"]'
      );
      transcriptItems.forEach((item) => {
        const text = (item.textContent || "").trim();
        if (text && text.length > 2 && !window.__dtSeenCaptions.has(text)) {
          window.__dtSeenCaptions.add(text);
          // Try to split speaker:message pattern like "John: Hello everyone"
          let speaker = "Speaker";
          let content = text;
          const colonMatch = text.match(/^([^:]{1,30}):\s*(.+)/);
          if (colonMatch) {
            speaker = colonMatch[1].trim();
            content = colonMatch[2].trim();
          }
          window.__dtTranscripts.push({
            content,
            speaker,
            startMs: Date.now() - window.__dtStartTime,
            confidence: 0.9,
          });
        }
      });

      // Method 3: Generic — look for any element with aria-live="polite" (accessibility captions)
      const liveRegions = document.querySelectorAll('[aria-live="polite"], [aria-live="assertive"], [role="log"]');
      liveRegions.forEach((region) => {
        const txt = (region.textContent || "").trim();
        if (txt && txt.length > 2 && !window.__dtSeenCaptions.has(txt)) {
          window.__dtSeenCaptions.add(txt);
          window.__dtTranscripts.push({
            content: txt,
            speaker: "Speaker",
            startMs: Date.now() - window.__dtStartTime,
            confidence: 0.8,
          });
        }
      });

      // Prevent memory leak — cap seen captions set
      if (window.__dtSeenCaptions.size > 5000) {
        const arr = [...window.__dtSeenCaptions];
        window.__dtSeenCaptions = new Set(arr.slice(-2000));
      }
    }

    // Run scraper every 2 seconds
    window.__dtCaptionInterval = setInterval(scrapeCaptions, 2000);

    // Also observe DOM mutations for new caption elements
    const observer = new MutationObserver(() => {
      scrapeCaptions();
    });
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true,
    });
    window.__dtCaptionObserver = observer;

    console.log("[DT-Bot] Caption scraper initialized");
  });

  console.log(`[Bot] Zoom caption scraping active for meeting ${meetingId}`);
}

/**
 * Click Zoom's Live Transcript / CC button to enable captions
 */
async function enableZoomCaptions(page) {
  // Wait a bit for toolbar to fully render
  await delay(3000);

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const clicked = await page.evaluate(() => {
        // Look for the CC / Live Transcript button in Zoom's toolbar
        const allButtons = document.querySelectorAll(
          'button, [role="button"], [role="menuitem"], a'
        );

        for (const btn of allButtons) {
          const text = (btn.textContent || "").toLowerCase();
          const ariaLabel = (btn.getAttribute("aria-label") || "").toLowerCase();
          const title = (btn.getAttribute("title") || "").toLowerCase();

          const match =
            text.includes("live transcript") ||
            text.includes("cc") ||
            text.includes("caption") ||
            text.includes("subtitle") ||
            ariaLabel.includes("live transcript") ||
            ariaLabel.includes("closed caption") ||
            ariaLabel.includes("caption") ||
            title.includes("live transcript") ||
            title.includes("caption");

          // Avoid clicking random things — button text should be short
          if (match && text.length < 40) {
            btn.click();
            return "clicked: " + text.trim().substring(0, 30);
          }
        }

        // Also try clicking "More" (...) menu first, then look for transcript option
        for (const btn of allButtons) {
          const ariaLabel = (btn.getAttribute("aria-label") || "").toLowerCase();
          if (ariaLabel.includes("more") || ariaLabel === "...") {
            btn.click();
            return "clicked-more";
          }
        }

        return false;
      });

      if (clicked === "clicked-more") {
        // Wait for menu to open, then look for transcript option
        await delay(1500);
        const clickedTranscript = await page.evaluate(() => {
          const items = document.querySelectorAll(
            '[role="menuitem"], [role="option"], li, button'
          );
          for (const item of items) {
            const text = (item.textContent || "").toLowerCase();
            if (
              text.includes("live transcript") ||
              text.includes("caption") ||
              text.includes("subtitle")
            ) {
              item.click();
              return true;
            }
          }
          return false;
        });
        if (clickedTranscript) {
          console.log(`[Bot] Enabled Live Transcript from More menu`);
          await delay(1000);

          // Now click "Enable" or "Show Subtitle" submenu if it appears
          await page.evaluate(() => {
            const items = document.querySelectorAll(
              'button, [role="menuitem"], [role="option"], a, li'
            );
            for (const item of items) {
              const text = (item.textContent || "").toLowerCase();
              if (
                text.includes("enable") ||
                text.includes("show subtitle") ||
                text.includes("view full transcript")
              ) {
                item.click();
                return true;
              }
            }
            return false;
          });
          return;
        }
      } else if (clicked && clicked !== false) {
        console.log(`[Bot] ${clicked}`);
        await delay(1500);

        // Handle submenu — click "Enable" or "Show Subtitle"
        await page.evaluate(() => {
          const items = document.querySelectorAll(
            'button, [role="menuitem"], [role="option"], a, li'
          );
          for (const item of items) {
            const text = (item.textContent || "").toLowerCase();
            if (
              text.includes("enable") ||
              text.includes("show subtitle") ||
              text.includes("view full transcript")
            ) {
              item.click();
              return true;
            }
          }
          return false;
        });
        return;
      }

      console.log(`[Bot] Caption button not found (attempt ${attempt + 1}/3) — will retry...`);
      await delay(5000);

    } catch (e) {
      console.log(`[Bot] Error enabling captions: ${e.message}`);
      await delay(3000);
    }
  }

  console.log(`[Bot] Could not find CC button — captions may need to be enabled by the host`);
  console.log(`[Bot] Caption scraping will still capture any visible captions`);
}

/**
 * Collect captured transcripts from the page and send to server
 */
async function flushTranscripts(page, meetingId) {
  try {
    let segments = [];
    try {
      segments = await page.evaluate(() => {
        const data = window.__dtTranscripts || [];
        window.__dtTranscripts = [];
        return data;
      });
    } catch (e) { /* page closed */ }

    if (segments.length === 0) return;

    // Enrich with endMs if missing
    const enriched = segments.map((seg, i) => ({
      ...seg,
      endMs: seg.endMs || (segments[i + 1] ? segments[i + 1].startMs : seg.startMs + 5000),
    }));

    console.log(`[Bot] Flushing ${enriched.length} transcript segments`);

    for (const seg of enriched) {
      console.log(`  [Transcript] ${seg.speaker}: ${seg.content.substring(0, 60)}`);
    }

    await botApi(`/transcript/${meetingId}`, "POST", { segments: enriched });
  } catch (e) {
    // Page might be closed
  }
}

/**
 * Cleanup — no longer needed for Deepgram but kept for compatibility
 */
function closeDeepgram(meetingId) {
  // No-op for caption-based transcription
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
