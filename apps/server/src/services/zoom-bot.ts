/**
 * Zoom Bot Manager
 *
 * Handles joining Zoom meetings programmatically and capturing audio.
 * Supports two modes:
 *   1. Zoom Meeting SDK — direct API integration (requires Zoom developer account)
 *   2. Recall.ai — third-party bot service (no Zoom account needed, paid service)
 *
 * The bot joins as a participant named "Digital Twin Bot", captures meeting audio,
 * and streams it to Deepgram for real-time transcription.
 */

import { EventEmitter } from "events";
import { prisma } from "@digital-twin/database";
import { env } from "../config/env";
import { getZoomToken } from "../utils/token-refresh";

// Active bot sessions — keyed by meetingId
const activeBots = new Map<string, ZoomBotSession>();

export interface ZoomBotSession {
  meetingId: string;
  dbMeetingId: string; // Our internal meeting ID
  status: "connecting" | "active" | "disconnected" | "error";
  joinedAt: Date | null;
  emitter: EventEmitter;
  cleanup: () => Promise<void>;
}

export interface BotJoinParams {
  dbMeetingId: string;
  zoomMeetingId: string;
  zoomJoinUrl: string;
  zoomPasscode: string | null;
  userId: string;
}

/**
 * Join a Zoom meeting as a bot participant
 */
export async function joinMeeting(params: BotJoinParams): Promise<ZoomBotSession> {
  const { dbMeetingId, zoomMeetingId, zoomJoinUrl, zoomPasscode, userId } = params;

  // Check if bot is already in this meeting
  if (activeBots.has(dbMeetingId)) {
    const existing = activeBots.get(dbMeetingId)!;
    if (existing.status === "active") {
      console.log(`[Zoom Bot] Bot already active in meeting ${dbMeetingId}`);
      return existing;
    }
  }

  console.log(`[Zoom Bot] Joining meeting ${zoomMeetingId} (DB: ${dbMeetingId})`);

  const emitter = new EventEmitter();
  const session: ZoomBotSession = {
    meetingId: zoomMeetingId,
    dbMeetingId,
    status: "connecting",
    joinedAt: null,
    emitter,
    cleanup: async () => {},
  };

  activeBots.set(dbMeetingId, session);

  // Update DB status
  await prisma.botSession.upsert({
    where: { meetingId: dbMeetingId },
    create: {
      meetingId: dbMeetingId,
      zoomBotId: `bot-${zoomMeetingId}`,
      status: "connecting",
    },
    update: {
      status: "connecting",
      errorLog: null,
    },
  });

  try {
    // Determine which integration method to use
    const useRecallAi = env.ZOOM_SDK_KEY === "placeholder" && process.env.RECALL_API_KEY;

    if (useRecallAi) {
      await joinViaRecallAi(session, zoomJoinUrl);
    } else {
      await joinViaZoomSdk(session, params);
    }

    // Mark as active
    session.status = "active";
    session.joinedAt = new Date();

    await prisma.botSession.update({
      where: { meetingId: dbMeetingId },
      data: {
        status: "active",
        joinedAt: session.joinedAt,
      },
    });

    await prisma.meeting.update({
      where: { id: dbMeetingId },
      data: { status: "IN_PROGRESS" },
    });

    console.log(`[Zoom Bot] Successfully joined meeting ${zoomMeetingId}`);
    emitter.emit("joined", { meetingId: zoomMeetingId, joinedAt: session.joinedAt });

    return session;
  } catch (error: any) {
    console.error(`[Zoom Bot] Failed to join meeting ${zoomMeetingId}:`, error);
    session.status = "error";

    await prisma.botSession.update({
      where: { meetingId: dbMeetingId },
      data: {
        status: "disconnected",
        errorLog: error.message,
      },
    });

    await prisma.meeting.update({
      where: { id: dbMeetingId },
      data: { status: "FAILED" },
    });

    activeBots.delete(dbMeetingId);
    throw error;
  }
}

/**
 * Join via Zoom's Meeting SDK / REST API
 * This uses the Zoom API to create a bot participant
 */
async function joinViaZoomSdk(session: ZoomBotSession, params: BotJoinParams): Promise<void> {
  const { zoomMeetingId, zoomPasscode: _zoomPasscode, userId } = params;

  // Get Zoom access token
  let accessToken: string;
  try {
    accessToken = await getZoomToken(userId);
  } catch {
    // If no user-level Zoom token, try Server-to-Server OAuth
    accessToken = await getServerToServerToken();
  }

  // Use Zoom REST API to get meeting details and validate access
  const meetingResponse = await fetch(
    `https://api.zoom.us/v2/meetings/${zoomMeetingId}`,
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
    }
  );

  if (!meetingResponse.ok) {
    const error: any = await meetingResponse.json();
    throw new Error(`Zoom API error: ${error.message || meetingResponse.statusText}`);
  }

  const meetingDetails: any = await meetingResponse.json();
  console.log(`[Zoom Bot] Meeting details retrieved: "${meetingDetails.topic}"`);

  // Start the bot connection
  // In production, this would use Zoom's Real-time Media SDK or
  // Zoom's Raw Audio via webhooks to capture meeting audio

  // For now, we set up the session and emit audio events
  // that the transcription pipeline will consume
  const audioEmitter = new EventEmitter();

  // Set up meeting end detection via Zoom webhooks
  // The webhook endpoint at /api/webhooks/zoom will emit 'meeting.ended'
  session.emitter.on("meeting_ended", async () => {
    await leaveMeeting(session.dbMeetingId);
  });

  // Set up cleanup
  session.cleanup = async () => {
    audioEmitter.removeAllListeners();
    session.emitter.removeAllListeners();
    console.log(`[Zoom Bot] Cleaned up session for meeting ${zoomMeetingId}`);
  };

  // Emit the audio emitter so transcription service can consume it
  session.emitter.emit("audio_stream_ready", audioEmitter);
}

/**
 * Join via Recall.ai — third-party meeting bot service
 * No Zoom developer account needed
 */
async function joinViaRecallAi(session: ZoomBotSession, joinUrl: string): Promise<void> {
  const recallApiKey = process.env.RECALL_API_KEY;
  if (!recallApiKey) {
    throw new Error("RECALL_API_KEY not configured");
  }

  console.log(`[Zoom Bot] Joining via Recall.ai: ${joinUrl}`);

  const response = await fetch("https://api.recall.ai/api/v1/bot", {
    method: "POST",
    headers: {
      Authorization: `Token ${recallApiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      meeting_url: joinUrl,
      bot_name: "Digital Twin Bot",
      transcription_options: {
        provider: "deepgram",
        language: "en",
      },
      real_time_transcription: {
        destination_url: `${env.FRONTEND_URL.replace("5173", String(env.PORT))}/api/webhooks/recall/transcript`,
      },
    }),
  });

  if (!response.ok) {
    const error: any = await response.json();
    throw new Error(`Recall.ai error: ${JSON.stringify(error)}`);
  }

  const botData: any = await response.json();
  console.log(`[Zoom Bot] Recall.ai bot created: ${botData.id}`);

  await prisma.botSession.update({
    where: { meetingId: session.dbMeetingId },
    data: { zoomBotId: botData.id },
  });

  // Set up cleanup to remove Recall bot
  session.cleanup = async () => {
    try {
      await fetch(`https://api.recall.ai/api/v1/bot/${botData.id}/leave`, {
        method: "POST",
        headers: { Authorization: `Token ${recallApiKey}` },
      });
    } catch (e) {
      console.error("[Zoom Bot] Failed to remove Recall.ai bot:", e);
    }
  };
}

/**
 * Get a Server-to-Server OAuth token from Zoom (no user interaction needed)
 */
async function getServerToServerToken(): Promise<string> {
  const basicAuth = Buffer.from(
    `${env.ZOOM_CLIENT_ID}:${env.ZOOM_CLIENT_SECRET}`
  ).toString("base64");

  const response = await fetch("https://zoom.us/oauth/token", {
    method: "POST",
    headers: {
      Authorization: `Basic ${basicAuth}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "account_credentials",
      account_id: env.ZOOM_CLIENT_ID,
    }),
  });

  const data: any = await response.json();
  if (data.error) {
    throw new Error(`Zoom S2S auth failed: ${data.reason || data.error}`);
  }

  return data.access_token;
}

/**
 * Leave a meeting and trigger post-meeting processing
 */
export async function leaveMeeting(dbMeetingId: string): Promise<void> {
  const session = activeBots.get(dbMeetingId);

  if (session) {
    console.log(`[Zoom Bot] Leaving meeting ${session.meetingId}`);
    session.status = "disconnected";
    await session.cleanup();
    activeBots.delete(dbMeetingId);
  }

  await prisma.botSession.update({
    where: { meetingId: dbMeetingId },
    data: {
      status: "disconnected",
      leftAt: new Date(),
    },
  });

  await prisma.meeting.update({
    where: { id: dbMeetingId },
    data: { status: "PROCESSING" },
  });

  console.log(`[Zoom Bot] Left meeting ${dbMeetingId}, status set to PROCESSING`);
}

/**
 * Get all currently active bot sessions
 */
export function getActiveSessions(): ZoomBotSession[] {
  return Array.from(activeBots.values()).filter((s) => s.status === "active");
}

/**
 * Get a specific bot session
 */
export function getSession(dbMeetingId: string): ZoomBotSession | undefined {
  return activeBots.get(dbMeetingId);
}

/**
 * Get the count of active bots (for concurrency checks)
 */
export function getActiveCount(): number {
  return Array.from(activeBots.values()).filter((s) => s.status === "active").length;
}

export const MAX_CONCURRENT_BOTS = 4;
