import { Router, Request, Response } from "express";
import { authMiddleware } from "../middleware/auth";
import { prisma } from "../lib/prisma";

const router = Router();

router.use(authMiddleware);

// Manually trigger bot to join a meeting
router.post("/join/:meetingId", async (req: Request, res: Response) => {
  try {
    const meeting = await prisma.meeting.findFirst({
      where: { id: req.params.meetingId, userId: req.user!.userId },
    });

    if (!meeting) {
      res.status(404).json({ success: false, error: "Meeting not found" });
      return;
    }

    if (!meeting.zoomJoinUrl) {
      res.status(400).json({ success: false, error: "No Zoom URL found for this meeting" });
      return;
    }

    // Import and trigger the Puppeteer-based bot
    const { joinMeeting } = require("../services/zoom-bot");

    const session = await joinMeeting({
      dbMeetingId: meeting.id,
      zoomMeetingId: meeting.zoomMeetingId || "",
      zoomJoinUrl: meeting.zoomJoinUrl,
      zoomPasscode: meeting.zoomPasscode,
      botName: "Digital Twin - Vaibhav Mujage",
    });

    res.json({
      success: true,
      data: { status: session.status, meetingId: meeting.id },
      message: "Bot join initiated — waiting for host to admit",
    });
  } catch (error) {
    console.error("Error joining meeting:", error);
    res.status(500).json({ success: false, error: "Failed to initiate bot join" });
  }
});

// Force bot to leave a meeting
router.post("/leave/:meetingId", async (req: Request, res: Response) => {
  try {
    const meeting = await prisma.meeting.findFirst({
      where: { id: req.params.meetingId, userId: req.user!.userId },
    });

    if (!meeting) {
      res.status(404).json({ success: false, error: "Meeting not found" });
      return;
    }

    const botSession = await prisma.botSession.findUnique({
      where: { meetingId: meeting.id },
    });

    if (!botSession || botSession.status === "disconnected") {
      res.status(400).json({ success: false, error: "Bot is not in this meeting" });
      return;
    }

    // Use Puppeteer bot to leave
    const { leaveMeeting } = require("../services/zoom-bot");
    await leaveMeeting(meeting.id);

    res.json({ success: true, message: "Bot leaving meeting" });
  } catch (error) {
    console.error("Error leaving meeting:", error);
    res.status(500).json({ success: false, error: "Failed to leave meeting" });
  }
});

// Get status of all active bot sessions
router.get("/status", async (req: Request, res: Response) => {
  try {
    const activeSessions = await prisma.botSession.findMany({
      where: {
        status: { in: ["connecting", "active"] },
        meeting: { userId: req.user!.userId },
      },
      include: {
        meeting: { select: { id: true, title: true, startTime: true, endTime: true } },
      },
    });

    res.json({ success: true, data: activeSessions });
  } catch (error) {
    console.error("Error fetching bot status:", error);
    res.status(500).json({ success: false, error: "Failed to fetch bot status" });
  }
});

// Get status of specific bot session
router.get("/status/:meetingId", async (req: Request, res: Response) => {
  try {
    const botSession = await prisma.botSession.findFirst({
      where: {
        meetingId: req.params.meetingId,
        meeting: { userId: req.user!.userId },
      },
      include: {
        meeting: { select: { id: true, title: true, startTime: true, endTime: true } },
      },
    });

    if (!botSession) {
      res.status(404).json({ success: false, error: "No bot session found" });
      return;
    }

    res.json({ success: true, data: botSession });
  } catch (error) {
    console.error("Error fetching bot status:", error);
    res.status(500).json({ success: false, error: "Failed to fetch bot status" });
  }
});

export default router;
