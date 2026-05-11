/**
 * Bot Agent Routes — for the local Puppeteer bot
 *
 * These endpoints use a shared BOT_SECRET instead of OAuth,
 * so the bot can run fully unattended without Microsoft login.
 */

import { Router, Request, Response, NextFunction } from "express";
import { prisma } from "../lib/prisma";
import { env } from "../config/env";

const router = Router();

/**
 * Middleware: check BOT_SECRET header
 */
function botAuth(req: Request, res: Response, next: NextFunction): void {
  const secret = req.headers["x-bot-secret"] as string;
  if (!secret || secret !== env.BOT_SECRET) {
    res.status(401).json({ success: false, error: "Invalid bot secret" });
    return;
  }
  next();
}

router.use(botAuth);

/**
 * GET /api/bot-agent/poll
 * Returns meetings with status JOINING that have a Zoom URL.
 * Only returns meetings from the last 24 hours to avoid picking up stale ones.
 */
router.get("/poll", async (_req: Request, res: Response) => {
  try {
    const cutoff = new Date();
    cutoff.setHours(cutoff.getHours() - 24);

    const meetings = await prisma.meeting.findMany({
      where: {
        status: "JOINING",
        zoomJoinUrl: { not: null },
        updatedAt: { gte: cutoff },
      },
      select: {
        id: true,
        title: true,
        zoomMeetingId: true,
        zoomJoinUrl: true,
        zoomPasscode: true,
        startTime: true,
        status: true,
      },
      orderBy: { updatedAt: "desc" },
    });

    res.json({ success: true, data: meetings });
  } catch (error) {
    console.error("[BotAgent] Poll error:", error);
    res.status(500).json({ success: false, error: "Poll failed" });
  }
});

/**
 * POST /api/bot-agent/joined/:meetingId
 * Bot reports it successfully joined the meeting
 */
router.post("/joined/:meetingId", async (req: Request, res: Response) => {
  try {
    const { meetingId } = req.params;

    await prisma.meeting.update({
      where: { id: meetingId },
      data: { status: "IN_PROGRESS" },
    });

    await prisma.botSession.upsert({
      where: { meetingId },
      create: {
        meetingId,
        status: "active",
        joinedAt: new Date(),
      },
      update: {
        status: "active",
        joinedAt: new Date(),
        errorLog: null,
      },
    });

    console.log(`[BotAgent] Bot joined meeting ${meetingId}`);
    res.json({ success: true, message: "Status updated to IN_PROGRESS" });
  } catch (error) {
    console.error("[BotAgent] Joined update error:", error);
    res.status(500).json({ success: false, error: "Update failed" });
  }
});

/**
 * POST /api/bot-agent/failed/:meetingId
 * Bot reports it failed to join
 */
router.post("/failed/:meetingId", async (req: Request, res: Response) => {
  try {
    const { meetingId } = req.params;
    const { error: errorMsg } = req.body || {};

    await prisma.meeting.update({
      where: { id: meetingId },
      data: { status: "FAILED" },
    });

    await prisma.botSession.upsert({
      where: { meetingId },
      create: {
        meetingId,
        status: "error",
        errorLog: errorMsg || "Bot failed to join",
      },
      update: {
        status: "error",
        errorLog: errorMsg || "Bot failed to join",
      },
    });

    console.log(`[BotAgent] Bot failed for meeting ${meetingId}: ${errorMsg}`);
    res.json({ success: true, message: "Status updated to FAILED" });
  } catch (error) {
    console.error("[BotAgent] Failed update error:", error);
    res.status(500).json({ success: false, error: "Update failed" });
  }
});

/**
 * POST /api/bot-agent/ended/:meetingId
 * Bot reports the meeting ended
 */
router.post("/ended/:meetingId", async (req: Request, res: Response) => {
  try {
    const { meetingId } = req.params;

    await prisma.meeting.update({
      where: { id: meetingId },
      data: { status: "PROCESSING" },
    });

    await prisma.botSession.upsert({
      where: { meetingId },
      create: {
        meetingId,
        status: "disconnected",
        leftAt: new Date(),
      },
      update: {
        status: "disconnected",
        leftAt: new Date(),
      },
    });

    console.log(`[BotAgent] Meeting ended: ${meetingId}`);
    res.json({ success: true, message: "Status updated to PROCESSING" });
  } catch (error) {
    console.error("[BotAgent] Ended update error:", error);
    res.status(500).json({ success: false, error: "Update failed" });
  }
});

/**
 * POST /api/bot-agent/waiting/:meetingId
 * Bot reports it's in the waiting room
 */
router.post("/waiting/:meetingId", async (req: Request, res: Response) => {
  try {
    const { meetingId } = req.params;

    await prisma.botSession.upsert({
      where: { meetingId },
      create: {
        meetingId,
        status: "connecting",
      },
      update: {
        status: "connecting",
      },
    });

    console.log(`[BotAgent] Bot waiting in lobby for meeting ${meetingId}`);
    res.json({ success: true, message: "Waiting status recorded" });
  } catch (error) {
    console.error("[BotAgent] Waiting update error:", error);
    res.status(500).json({ success: false, error: "Update failed" });
  }
});

/**
 * GET /api/bot-agent/check/:meetingId
 * Bot checks if a meeting is still in JOINING status (not cancelled)
 */
router.get("/check/:meetingId", async (req: Request, res: Response) => {
  try {
    const meeting = await prisma.meeting.findUnique({
      where: { id: req.params.meetingId },
      select: { id: true, status: true },
    });

    if (!meeting) {
      res.json({ success: true, active: false, reason: "Meeting not found" });
      return;
    }

    const active = ["JOINING", "IN_PROGRESS"].includes(meeting.status);
    res.json({ success: true, active, status: meeting.status });
  } catch (error) {
    console.error("[BotAgent] Check error:", error);
    res.status(500).json({ success: false, error: "Check failed" });
  }
});

export default router;
