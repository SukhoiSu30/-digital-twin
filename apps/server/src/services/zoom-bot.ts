/**
 * Zoom Bot — Puppeteer Browser Approach
 *
 * Joins Zoom meetings via the web client using a headless browser.
 * No paid subscription needed — works like a human joining from a browser.
 *
 * Flow:
 * 1. Launch headless Chrome with Puppeteer
 * 2. Navigate to Zoom web client URL
 * 3. Enter bot display name and join
 * 4. Wait for host to admit from waiting room
 * 5. Capture meeting audio via browser
 * 6. Stream audio to Deepgram for transcription
 */

import { EventEmitter } from "events";
import { prisma } from "../lib/prisma";

const activeBots = new Map<string, ZoomBotSession>();

export interface ZoomBotSession {
  meetingId: string;
  dbMeetingId: string;
  status: "connecting" | "waiting" | "active" | "disconnected" | "error";
  joinedAt: Date | null;
  emitter: EventEmitter;
  cleanup: () => Promise<void>;
}

export interface BotJoinParams {
  dbMeetingId: string;
  zoomMeetingId: string;
  zoomJoinUrl: string;
  zoomPasscode?: string | null;
  botName?: string;
}

/**
 * Join a Zoom meeting using Puppeteer (browser automation)
 */
export async function joinMeeting(params: BotJoinParams): Promise<ZoomBotSession> {
  const {
    dbMeetingId,
    zoomMeetingId,
    zoomJoinUrl,
    zoomPasscode,
    botName = "Digital Twin - Pratik"
  } = params;

  if (activeBots.has(dbMeetingId)) {
    console.log(`[ZoomBot] Bot already active for meeting ${dbMeetingId}`);
    return activeBots.get(dbMeetingId)!;
  }

  const emitter = new EventEmitter();
  let browser: any = null;
  let page: any = null;

  const session: ZoomBotSession = {
    meetingId: zoomMeetingId,
    dbMeetingId,
    status: "connecting",
    joinedAt: null,
    emitter,
    cleanup: async () => {
      try {
        if (page) await page.close().catch(() => {});
        if (browser) await browser.close().catch(() => {});
      } catch (e) {
        console.error("[ZoomBot] Cleanup error:", e);
      }
      activeBots.delete(dbMeetingId);
    },
  };

  activeBots.set(dbMeetingId, session);

  // Update database
  await prisma.botSession.upsert({
    where: { meetingId: dbMeetingId },
    create: {
      meetingId: dbMeetingId,
      status: "connecting",
    },
    update: {
      status: "connecting",
    },
  });

  await prisma.meeting.update({
    where: { id: dbMeetingId },
    data: { status: "JOINING" },
  });

  // Launch browser and join in background
  joinInBackground(session, params, botName).catch((error) => {
    console.error("[ZoomBot] Join failed:", error.message);
    session.status = "error";
    emitter.emit("error", error);
  });

  return session;
}

/**
 * Background process to join the Zoom meeting
 */
async function joinInBackground(
  session: ZoomBotSession,
  params: BotJoinParams,
  botName: string
): Promise<void> {
  const { dbMeetingId, zoomMeetingId, zoomJoinUrl, zoomPasscode } = params;

  try {
    // Dynamic import puppeteer
    const puppeteer = require("puppeteer");

    console.log(`[ZoomBot] Launching browser for meeting ${zoomMeetingId}...`);

    const browser = await puppeteer.launch({
      headless: "new",
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-accelerated-2d-canvas",
        "--disable-gpu",
        "--use-fake-ui-for-media-stream",        // Auto-allow mic/camera prompts
        "--use-fake-device-for-media-stream",     // Use fake audio device
        "--autoplay-policy=no-user-gesture-required",
        "--disable-web-security",
        "--window-size=1280,720",
      ],
    });

    const page = await browser.newPage();

    // Set user agent to look like a normal browser
    await page.setUserAgent(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    );

    // Build the Zoom web client URL
    let joinUrl = `https://zoom.us/wc/join/${zoomMeetingId}`;
    if (zoomPasscode) {
      joinUrl += `?pwd=${encodeURIComponent(zoomPasscode)}`;
    }

    console.log(`[ZoomBot] Navigating to: ${joinUrl}`);
    console.log(`[ZoomBot] Bot name: ${botName}`);

    await page.goto(joinUrl, { waitUntil: "networkidle2", timeout: 30000 });

    // Wait for the page to load
    await page.waitForTimeout(3000);

    // Take screenshot for debugging
    const screenshotBuffer = await page.screenshot();
    console.log(`[ZoomBot] Page loaded, screenshot size: ${screenshotBuffer.length} bytes`);

    // Try to find and fill the name input
    const nameSelectors = [
      '#inputname',
      'input[name="inputname"]',
      'input[placeholder*="name"]',
      'input[placeholder*="Name"]',
      '#join-confno',
    ];

    let nameInput = null;
    for (const selector of nameSelectors) {
      try {
        nameInput = await page.$(selector);
        if (nameInput) {
          console.log(`[ZoomBot] Found name input with selector: ${selector}`);
          break;
        }
      } catch (e) {}
    }

    if (nameInput) {
      await nameInput.click({ clickCount: 3 }); // Select all existing text
      await nameInput.type(botName, { delay: 50 });
      console.log(`[ZoomBot] Entered bot name: ${botName}`);
    } else {
      console.log("[ZoomBot] Could not find name input, proceeding...");
    }

    // Accept terms if present
    const termsCheckbox = await page.$('#wc_agree1');
    if (termsCheckbox) {
      await termsCheckbox.click();
      console.log("[ZoomBot] Accepted terms");
    }

    // Click join button
    const joinSelectors = [
      '#joinBtn',
      'button[id="joinBtn"]',
      'button.btn-primary',
      'button[type="button"]',
      '.join-btn',
    ];

    for (const selector of joinSelectors) {
      try {
        const joinBtn = await page.$(selector);
        if (joinBtn) {
          const text = await page.evaluate((el: any) => el.textContent, joinBtn);
          if (text && (text.includes('Join') || text.includes('join'))) {
            await joinBtn.click();
            console.log(`[ZoomBot] Clicked join button: ${selector}`);
            break;
          }
        }
      } catch (e) {}
    }

    // Update status to waiting (for host to admit)
    session.status = "waiting";
    await prisma.botSession.update({
      where: { meetingId: dbMeetingId },
      data: { status: "waiting_room" },
    });

    console.log("[ZoomBot] Waiting for host to admit...");

    // Wait for meeting to load (host admits from waiting room)
    await page.waitForTimeout(5000);

    // Check if we're in the meeting
    const inMeeting = await page.evaluate(() => {
      return !!(
        document.querySelector('.meeting-app') ||
        document.querySelector('#wc-container-left') ||
        document.querySelector('.meeting-client') ||
        document.querySelector('[class*="meeting"]') ||
        document.title.includes('Zoom Meeting')
      );
    });

    if (inMeeting) {
      console.log("[ZoomBot] Successfully joined the meeting!");
      session.status = "active";
      session.joinedAt = new Date();

      await prisma.botSession.update({
        where: { meetingId: dbMeetingId },
        data: { status: "active", joinedAt: new Date() },
      });

      await prisma.meeting.update({
        where: { id: dbMeetingId },
        data: { status: "IN_PROGRESS" },
      });

      session.emitter.emit("joined");

      // Start audio capture
      console.log("[ZoomBot] Starting audio capture...");
      await startAudioCapture(page, session);
    } else {
      console.log("[ZoomBot] Not in meeting yet — may still be in waiting room");
      session.status = "waiting";

      // Keep checking every 10 seconds for 5 minutes
      let attempts = 0;
      const checkInterval = setInterval(async () => {
        attempts++;
        const now = await page.evaluate(() => {
          return !!(
            document.querySelector('.meeting-app') ||
            document.querySelector('#wc-container-left') ||
            document.querySelector('.meeting-client') ||
            document.title.includes('Zoom Meeting')
          );
        }).catch(() => false);

        if (now) {
          clearInterval(checkInterval);
          console.log("[ZoomBot] Host admitted — now in meeting!");
          session.status = "active";
          session.joinedAt = new Date();

          await prisma.botSession.update({
            where: { meetingId: dbMeetingId },
            data: { status: "active", joinedAt: new Date() },
          }).catch(console.error);

          await prisma.meeting.update({
            where: { id: dbMeetingId },
            data: { status: "IN_PROGRESS" },
          }).catch(console.error);

          session.emitter.emit("joined");
          await startAudioCapture(page, session).catch(console.error);
        }

        if (attempts >= 30) { // 5 minutes
          clearInterval(checkInterval);
          console.log("[ZoomBot] Timed out waiting for host to admit");
          session.status = "error";
          await session.cleanup();
        }
      }, 10000);
    }

    // Monitor for meeting end
    const endCheckInterval = setInterval(async () => {
      try {
        const meetingEnded = await page.evaluate(() => {
          return !!(
            document.querySelector('.meeting-ended') ||
            document.querySelector('[class*="ended"]') ||
            document.body.innerText.includes('meeting has ended') ||
            document.body.innerText.includes('host has ended')
          );
        }).catch(() => true);

        if (meetingEnded && session.status === "active") {
          clearInterval(endCheckInterval);
          console.log("[ZoomBot] Meeting ended");
          session.status = "disconnected";

          await prisma.botSession.update({
            where: { meetingId: dbMeetingId },
            data: { status: "disconnected", leftAt: new Date() },
          }).catch(console.error);

          await prisma.meeting.update({
            where: { id: dbMeetingId },
            data: { status: "PROCESSING" },
          }).catch(console.error);

          session.emitter.emit("ended");
          await session.cleanup();
        }
      } catch (e) {
        // Page might be closed
        clearInterval(endCheckInterval);
      }
    }, 15000);

  } catch (error: any) {
    console.error(`[ZoomBot] Error joining meeting:`, error.message);
    session.status = "error";

    await prisma.botSession.update({
      where: { meetingId: dbMeetingId },
      data: { status: "error", errorLog: error.message },
    }).catch(console.error);

    await prisma.meeting.update({
      where: { id: dbMeetingId },
      data: { status: "FAILED" },
    }).catch(console.error);

    session.emitter.emit("error", error);
    await session.cleanup();
  }
}

/**
 * Capture audio from the browser tab
 */
async function startAudioCapture(page: any, session: ZoomBotSession): Promise<void> {
  try {
    // Inject audio capture script into the page
    await page.evaluate(() => {
      const audioContext = new AudioContext();
      const destination = audioContext.createMediaStreamDestination();

      // Try to capture all audio from the page
      const audioElements = document.querySelectorAll('audio, video');
      audioElements.forEach((el: any) => {
        try {
          const source = audioContext.createMediaElementSource(el);
          source.connect(destination);
          source.connect(audioContext.destination); // Keep playback
        } catch (e) {
          console.log('Could not capture element:', e);
        }
      });

      // Start recording
      const mediaRecorder = new MediaRecorder(destination.stream, {
        mimeType: 'audio/webm;codecs=opus',
      });

      const chunks: Blob[] = [];
      mediaRecorder.ondataavailable = (e: any) => {
        if (e.data.size > 0) chunks.push(e.data);
      };

      mediaRecorder.start(5000); // Capture every 5 seconds
      (window as any).__mediaRecorder = mediaRecorder;
      (window as any).__audioChunks = chunks;

      console.log('[ZoomBot] Audio capture started');
    });

    session.emitter.emit("audio_started");
    console.log("[ZoomBot] Audio capture initialized in browser");

  } catch (error: any) {
    console.error("[ZoomBot] Audio capture error:", error.message);
  }
}

/**
 * Leave a meeting
 */
export async function leaveMeeting(dbMeetingId: string): Promise<void> {
  const session = activeBots.get(dbMeetingId);
  if (!session) {
    console.log(`[ZoomBot] No active bot for meeting ${dbMeetingId}`);
    return;
  }

  console.log(`[ZoomBot] Leaving meeting ${dbMeetingId}`);
  session.status = "disconnected";

  await prisma.botSession.update({
    where: { meetingId: dbMeetingId },
    data: { status: "disconnected", leftAt: new Date() },
  }).catch(console.error);

  await prisma.meeting.update({
    where: { id: dbMeetingId },
    data: { status: "PROCESSING" },
  }).catch(console.error);

  session.emitter.emit("ended");
  await session.cleanup();
}

/**
 * Get bot status
 */
export function getBotStatus(dbMeetingId: string): ZoomBotSession | null {
  return activeBots.get(dbMeetingId) || null;
}

/**
 * Get all active bot sessions
 */
export function getAllActiveBots(): Map<string, ZoomBotSession> {
  return activeBots;
}
