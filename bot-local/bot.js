/**
 * Digital Twin — Local Zoom Bot
 *
 * Joins Zoom meetings as "Vaibhav Mujage" via browser.
 * Communicates with the Render API via HTTP (no direct database needed).
 *
 * Usage:
 *   cd bot-local
 *   npm install
 *   node bot.js
 */

const puppeteer = require("puppeteer");

const API_URL = "https://digital-twin-api-13y1.onrender.com/api";
const BOT_NAME = "Vaibhav Mujage";
const POLL_INTERVAL = 8000;
const activeBots = new Map();

// Get token from command line or env
let AUTH_TOKEN = process.env.AUTH_TOKEN || "";

console.log(`
╔══════════════════════════════════════════════╗
║      Digital Twin — Local Zoom Bot           ║
║                                              ║
║  Bot Name:  ${BOT_NAME.padEnd(33)}║
║  API:       Render (HTTP)                    ║
║  Polling:   Every ${POLL_INTERVAL / 1000}s                        ║
║                                              ║
║  Press Ctrl+C to stop                        ║
╚══════════════════════════════════════════════╝
`);

/**
 * Fetch from API with auth
 */
async function apiFetch(path, options = {}) {
  const url = `${API_URL}${path}`;
  const headers = {
    "Content-Type": "application/json",
    ...(AUTH_TOKEN ? { Authorization: `Bearer ${AUTH_TOKEN}` } : {}),
    ...options.headers,
  };

  const res = await fetch(url, { ...options, headers });
  return res.json();
}

/**
 * Login to get a token
 */
async function login() {
  console.log("[Bot] Getting auth token...");
  console.log("[Bot] Opening browser for Microsoft login...\n");

  const browser = await puppeteer.launch({
    headless: false,
    defaultViewport: { width: 800, height: 600 },
  });

  const page = await browser.newPage();
  await page.goto(`${API_URL}/auth/microsoft`, { waitUntil: "networkidle2", timeout: 60000 });

  // Wait for redirect back to dashboard with token
  console.log("[Bot] Please sign in with your Microsoft account...");
  console.log("[Bot] Waiting for login to complete...\n");

  try {
    await page.waitForFunction(
      () => window.location.href.includes("token="),
      { timeout: 120000 }
    );

    const url = page.url();
    const tokenMatch = url.match(/token=([^&]+)/);
    if (tokenMatch) {
      AUTH_TOKEN = tokenMatch[1];
      console.log("[Bot] Login successful! Token received.\n");
    }
  } catch (e) {
    // Try to get token from URL anyway
    const url = page.url();
    const tokenMatch = url.match(/token=([^&]+)/);
    if (tokenMatch) {
      AUTH_TOKEN = tokenMatch[1];
      console.log("[Bot] Login successful! Token received.\n");
    } else {
      console.log("[Bot] Login timeout — please restart and try again.\n");
    }
  }

  await browser.close();
}

/**
 * Main loop — polls API for meetings with JOINING status
 */
async function startPolling() {
  // First login if no token
  if (!AUTH_TOKEN) {
    await login();
  }

  if (!AUTH_TOKEN) {
    console.log("[Bot] No auth token. Exiting.");
    process.exit(1);
  }

  console.log("[Bot] Started polling for meetings...\n");

  setInterval(async () => {
    try {
      const response = await apiFetch("/meetings?status=JOINING");

      if (!response.success || !response.data) return;

      const meetings = response.data;

      for (const meeting of meetings) {
        if (activeBots.has(meeting.id)) continue;
        if (!meeting.zoomJoinUrl) continue;

        console.log(`[Bot] Found meeting to join: "${meeting.title}"`);
        console.log(`[Bot] Zoom URL: ${meeting.zoomJoinUrl}`);

        joinMeeting(meeting).catch((err) => {
          console.error(`[Bot] Error joining "${meeting.title}":`, err.message);
        });
      }
    } catch (err) {
      // Silent — server might be sleeping
    }
  }, POLL_INTERVAL);
}

/**
 * Join a Zoom meeting using Puppeteer
 */
async function joinMeeting(meeting) {
  const { id, title, zoomMeetingId, zoomJoinUrl, zoomPasscode } = meeting;

  activeBots.set(id, { status: "connecting" });

  console.log(`\n${"=".repeat(50)}`);
  console.log(`[Bot] JOINING: ${title}`);
  console.log(`[Bot] As: ${BOT_NAME}`);
  console.log(`${"=".repeat(50)}\n`);

  let browser = null;

  try {
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
      ],
    });

    const page = await browser.newPage();

    await page.setUserAgent(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    );

    const context = browser.defaultBrowserContext();
    await context.overridePermissions("https://zoom.us", [
      "microphone", "camera", "notifications",
    ]);

    // Build Zoom web client URL
    let joinUrl = `https://zoom.us/wc/join/${zoomMeetingId}`;
    if (zoomPasscode) {
      joinUrl += `?pwd=${encodeURIComponent(zoomPasscode)}`;
    }

    console.log(`[Bot] Opening Zoom web client...`);
    await page.goto(joinUrl, { waitUntil: "networkidle2", timeout: 60000 });

    // Wait longer for page to fully render
    console.log(`[Bot] Waiting for page to load...`);
    await delay(8000);

    // Save screenshot for debugging
    await page.screenshot({ path: "zoom-page-1.png" });
    console.log(`[Bot] Screenshot saved: zoom-page-1.png`);

    // Log page title and URL for debugging
    const pageTitle = await page.title();
    console.log(`[Bot] Page title: ${pageTitle}`);

    // Try multiple approaches to enter name
    console.log(`[Bot] Setting name to "${BOT_NAME}"...`);

    // Approach 1: Find all text inputs and use the first one
    let nameSet = await page.evaluate((name) => {
      const inputs = document.querySelectorAll('input[type="text"], input:not([type])');
      for (const input of inputs) {
        const ph = (input.placeholder || "").toLowerCase();
        const id = (input.id || "").toLowerCase();
        const ariaLabel = (input.getAttribute("aria-label") || "").toLowerCase();
        if (ph.includes("name") || id.includes("name") || ariaLabel.includes("name")) {
          input.value = "";
          input.focus();
          input.value = name;
          input.dispatchEvent(new Event("input", { bubbles: true }));
          input.dispatchEvent(new Event("change", { bubbles: true }));
          return true;
        }
      }
      // If no name-specific input found, try the first visible text input
      const firstInput = document.querySelector('input[type="text"]') || document.querySelector('#inputname');
      if (firstInput) {
        firstInput.value = "";
        firstInput.focus();
        firstInput.value = name;
        firstInput.dispatchEvent(new Event("input", { bubbles: true }));
        firstInput.dispatchEvent(new Event("change", { bubbles: true }));
        return true;
      }
      return false;
    }, BOT_NAME);

    if (!nameSet) {
      // Approach 2: Use Puppeteer keyboard
      nameSet = await tryEnterName(page, BOT_NAME);
    }

    if (nameSet) {
      console.log(`[Bot] Name set to: ${BOT_NAME}`);
    } else {
      console.log(`[Bot] WARNING: Could not find name input`);
    }

    await delay(1000);

    // Accept any checkboxes (terms, agreements)
    await page.evaluate(() => {
      const checkboxes = document.querySelectorAll('input[type="checkbox"]');
      checkboxes.forEach(cb => { if (!cb.checked) cb.click(); });
    });
    console.log(`[Bot] Accepted terms/checkboxes`);

    await delay(1000);

    // Click Join button - try multiple approaches
    let joinClicked = await page.evaluate(() => {
      // Find button by text content
      const buttons = document.querySelectorAll("button, input[type='button'], input[type='submit'], a.btn");
      for (const btn of buttons) {
        const text = (btn.textContent || btn.value || "").toLowerCase().trim();
        if (text.includes("join")) {
          btn.click();
          return true;
        }
      }
      // Try by ID
      const joinBtn = document.getElementById("joinBtn");
      if (joinBtn) { joinBtn.click(); return true; }
      return false;
    });

    if (!joinClicked) {
      joinClicked = await tryClickJoin(page);
    }
    console.log(`[Bot] Join button clicked: ${joinClicked}`);

    // Save another screenshot after clicking join
    await delay(3000);
    await page.screenshot({ path: "zoom-page-2.png" });
    console.log(`[Bot] Screenshot saved: zoom-page-2.png`);

    // Enter passcode if prompted
    const passcodeInput = await page.$('#inputpasscode, input[type="password"], input[placeholder*="passcode" i], input[placeholder*="password" i]');
    if (passcodeInput && zoomPasscode) {
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
    }

    console.log(`\n[Bot] Waiting for host to admit "${BOT_NAME}"...`);
    console.log(`[Bot] The host will see "${BOT_NAME}" in the waiting room.`);
    console.log(`[Bot] Screenshots saved in bot-local folder for debugging.\n`);

    // Wait for meeting join
    let inMeeting = false;
    let attempts = 0;

    while (!inMeeting && attempts < 60) {
      attempts++;
      await delay(5000);

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
          ];
          return indicators.some(el => el !== null);
        });

        if (inMeeting) break;

        const bodyText = await page.evaluate(() => document.body.innerText);
        if (bodyText.includes("meeting has ended") || bodyText.includes("host has ended")) {
          console.log(`[Bot] Meeting ended before join`);
          break;
        }
      } catch (e) {}

      if (attempts % 6 === 0) {
        console.log(`[Bot] Still waiting... (${attempts * 5}s)`);
      }
    }

    if (inMeeting) {
      console.log(`\n${"=".repeat(50)}`);
      console.log(`[Bot] JOINED: ${title}`);
      console.log(`[Bot] As: ${BOT_NAME}`);
      console.log(`[Bot] In meeting now!`);
      console.log(`${"=".repeat(50)}\n`);

      // Update via API
      await apiFetch(`/bot/status/${id}`, { method: "GET" }).catch(() => {});

      activeBots.set(id, { status: "active", browser, page });

      // Monitor for meeting end
      const endCheck = setInterval(async () => {
        try {
          const ended = await page.evaluate(() => {
            const text = document.body.innerText || "";
            return text.includes("meeting has ended") || text.includes("host has ended");
          });

          if (ended) {
            clearInterval(endCheck);
            console.log(`\n[Bot] Meeting ended: "${title}"`);
            await browser.close().catch(() => {});
            activeBots.delete(id);
          }
        } catch (e) {
          clearInterval(endCheck);
          activeBots.delete(id);
        }
      }, 10000);

    } else {
      console.log(`[Bot] Could not join — timed out`);
      await browser.close().catch(() => {});
      activeBots.delete(id);
    }

  } catch (error) {
    console.error(`[Bot] Error:`, error.message);
    if (browser) await browser.close().catch(() => {});
    activeBots.delete(id);
  }
}

// --- Helpers ---

async function tryEnterName(page, name) {
  const selectors = ['#inputname', 'input[name="inputname"]', 'input[placeholder*="name" i]'];
  for (const sel of selectors) {
    try {
      const input = await page.$(sel);
      if (input) {
        await input.click({ clickCount: 3 });
        await input.type(name, { delay: 30 });
        return true;
      }
    } catch (e) {}
  }
  return false;
}

async function tryClickJoin(page) {
  // Try clicking any element with "Join" text
  const clicked = await page.evaluate(() => {
    // Check all buttons, inputs, and clickable elements
    const allElements = document.querySelectorAll("button, input[type='button'], input[type='submit'], a, [role='button']");
    for (const el of allElements) {
      const text = (el.textContent || el.value || "").trim();
      if (text === "Join" || text === "Join Meeting" || text === "Join meeting") {
        el.click();
        return true;
      }
    }
    return false;
  });
  return clicked;
}

async function tryClickElement(page, selector) {
  try { const el = await page.$(selector); if (el) await el.click(); } catch (e) {}
}

function delay(ms) { return new Promise(r => setTimeout(r, ms)); }

process.on("SIGINT", async () => {
  console.log("\n[Bot] Shutting down...");
  for (const [, bot] of activeBots) { if (bot.browser) await bot.browser.close().catch(() => {}); }
  console.log("[Bot] Goodbye!");
  process.exit(0);
});

startPolling();
