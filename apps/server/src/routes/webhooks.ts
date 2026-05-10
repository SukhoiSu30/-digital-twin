/**
 * Webhook Endpoints
 *
 * Receives real-time events from external services:
 * - Zoom: Meeting started, ended, participant joined/left
 * - Recall.ai: Live transcript segments, bot status changes
 *
 * These endpoints are NOT authenticated via JWT — they use
 * service-specific verification (Zoom verification token, Recall API key).
 */

import crypto from "crypto";
import { Router, Request, Response } from "express";
import { prisma } from "../lib/prisma";
import { env } from "../config/env";
import { leaveMeeting } from "../services/zoom-bot";
import { processRecallTranscript } from "../services/transcription";
import { queueSummaryGeneration } from "../jobs/queues";
import type { Server as SocketIOServer } from "socket.io";

const router = Router();

// ─── Zoom Webhooks ───────────────────────────────────────

/**
 * Zoom sends a verification request when you first set up webhooks.
 * It also sends event notifications for meeting lifecycle events.
 *
 * Zoom webhook docs: https://developers.zoom.us/docs/api/rest/webhook-reference/
 */
router.post("/zoom", async (req: Request, res: Response) => {
  const { event, payload } = req.body;

  // Zoom URL validation challenge (sent once during webhook setup)
  if (event === "endpoint.url_validation") {
    const hashForValidate = crypto
      .createHmac("sha256", env.ZOOM_CLIENT_SECRET)
      .update(req.body.payload.plainToken)
      .digest("hex");

    res.json({
      plainToken: req.body.payload.plainToken,
      encryptedToken: hashForValidate,
    });
    return;
  }

  console.log(`[Webhook:Zoom] Received event: ${event}`);

  try {
    switch (event) {
      case "meeting.started": {
        const meetingId = String(payload.object.id);
        console.log(`[Webhook:Zoom] Meeting started: ${meetingId}`);

        // Find our meeting record by Zoom meeting ID
        const meeting = await prisma.meeting.findFirst({
          where: { zoomMeetingId: meetingId },
        });

        if (meeting) {
          await prisma.meeting.update({
            where: { id: meeting.id },
            data: { status: "IN_PROGRESS" },
          });

          // Notify dashboard
          const io: SocketIOServer = req.app.get("io");
          io.emit("meeting:status", {
            meetingId: meeting.id,
            status: "IN_PROGRESS",
          });
        }
        break;
      }

      case "meeting.ended": {
        const meetingId = String(payload.object.id);
        console.log(`[Webhook:Zoom] Meeting ended: ${meetingId}`);

        const meeting = await prisma.meeting.findFirst({
          where: { zoomMeetingId: meetingId },
        });

        if (meeting) {
          // Trigger bot leave + summary generation
          await leaveMeeting(meeting.id);
          await queueSummaryGeneration(meeting.id);

          const io: SocketIOServer = req.app.get("io");
          io.emit("meeting:status", {
            meetingId: meeting.id,
            status: "PROCESSING",
          });
        }
        break;
      }

      case "meeting.participant_joined": {
        const participant = payload.object.participant;
        console.log(
          `[Webhook:Zoom] Participant joined: ${participant.user_name} ` +
          `in meeting ${payload.object.id}`
        );
        break;
      }

      case "meeting.participant_left": {
        const participant = payload.object.participant;
        console.log(
          `[Webhook:Zoom] Participant left: ${participant.user_name} ` +
          `in meeting ${payload.object.id}`
        );
        break;
      }

      default:
        console.log(`[Webhook:Zoom] Unhandled event: ${event}`);
    }

    res.status(200).json({ status: "ok" });
  } catch (error) {
    console.error(`[Webhook:Zoom] Error processing ${event}:`, error);
    res.status(500).json({ error: "Webhook processing failed" });
  }
});

// ─── Recall.ai Webhooks ──────────────────────────────────

/**
 * Recall.ai sends real-time transcript data as the bot captures audio.
 * It also sends status updates when the bot joins/leaves.
 */
router.post("/recall/transcript", async (req: Request, res: Response) => {
  try {
    const { bot_id, data } = req.body;

    // Find the meeting by Recall bot ID
    const botSession = await prisma.botSession.findFirst({
      where: { zoomBotId: bot_id },
      include: { meeting: true },
    });

    if (!botSession) {
      console.warn(`[Webhook:Recall] Unknown bot ID: ${bot_id}`);
      res.status(404).json({ error: "Bot session not found" });
      return;
    }

    const io: SocketIOServer = req.app.get("io");

    // Process transcript data
    await processRecallTranscript(
      botSession.meetingId,
      {
        speaker: data.speaker || "Unknown",
        words: data.words || [],
        is_final: data.is_final || false,
      },
      io
    );

    res.status(200).json({ status: "ok" });
  } catch (error) {
    console.error("[Webhook:Recall] Transcript error:", error);
    res.status(500).json({ error: "Processing failed" });
  }
});

/**
 * Recall.ai bot status changes (joined, left, error)
 */
router.post("/recall/status", async (req: Request, res: Response) => {
  try {
    const { bot_id, status } = req.body;

    console.log(`[Webhook:Recall] Bot ${bot_id} status: ${status.code}`);

    const botSession = await prisma.botSession.findFirst({
      where: { zoomBotId: bot_id },
    });

    if (!botSession) {
      res.status(404).json({ error: "Bot session not found" });
      return;
    }

    const io: SocketIOServer = req.app.get("io");

    switch (status.code) {
      case "joining_call":
        await prisma.botSession.update({
          where: { id: botSession.id },
          data: { status: "connecting" },
        });
        break;

      case "in_call_not_recording":
      case "in_call_recording":
        await prisma.botSession.update({
          where: { id: botSession.id },
          data: { status: "active", joinedAt: new Date() },
        });
        await prisma.meeting.update({
          where: { id: botSession.meetingId },
          data: { status: "IN_PROGRESS" },
        });
        io.emit("meeting:status", {
          meetingId: botSession.meetingId,
          status: "IN_PROGRESS",
        });
        break;

      case "call_ended":
      case "done":
        await prisma.botSession.update({
          where: { id: botSession.id },
          data: { status: "disconnected", leftAt: new Date() },
        });
        await prisma.meeting.update({
          where: { id: botSession.meetingId },
          data: { status: "PROCESSING" },
        });
        await queueSummaryGeneration(botSession.meetingId);
        io.emit("meeting:status", {
          meetingId: botSession.meetingId,
          status: "PROCESSING",
        });
        break;

      case "fatal":
        await prisma.botSession.update({
          where: { id: botSession.id },
          data: {
            status: "disconnected",
            errorLog: status.message || "Recall.ai fatal error",
          },
        });
        await prisma.meeting.update({
          where: { id: botSession.meetingId },
          data: { status: "FAILED" },
        });
        io.emit("meeting:status", {
          meetingId: botSession.meetingId,
          status: "FAILED",
          error: status.message,
        });
        break;
    }

    res.status(200).json({ status: "ok" });
  } catch (error) {
    console.error("[Webhook:Recall] Status error:", error);
    res.status(500).json({ error: "Processing failed" });
  }
});

export default router;
