import { Router, Request, Response } from "express";
import { authMiddleware } from "../middleware/auth";
import { prisma } from "../lib/prisma";

const router = Router();

// All meeting routes require authentication
router.use(authMiddleware);

// List all meetings with optional filters
router.get("/", async (req: Request, res: Response) => {
  try {
    const { status, date, limit = "50", offset = "0" } = req.query;
    const userId = req.user!.userId;
    const now = new Date();

    // ── Auto-cleanup: remove stale meetings on every fetch ──
    // 1. Delete DISCOVERED/SCHEDULED meetings whose endTime has passed (expired, never used)
    await prisma.meeting.deleteMany({
      where: {
        userId,
        status: { in: ["DISCOVERED", "SCHEDULED"] },
        endTime: { lt: now },
      },
    });

    // 2. Delete FAILED/SKIPPED meetings older than 24 hours
    const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    await prisma.meeting.deleteMany({
      where: {
        userId,
        status: { in: ["FAILED", "SKIPPED"] },
        endTime: { lt: yesterday },
      },
    });

    // ── Build query ──
    const where: any = { userId };

    if (status && typeof status === "string") {
      where.status = status;
    }

    if (date && typeof date === "string") {
      const start = new Date(date);
      const end = new Date(date);
      end.setDate(end.getDate() + 1);
      where.startTime = { gte: start, lt: end };
    }

    const [meetings, total] = await Promise.all([
      prisma.meeting.findMany({
        where,
        orderBy: { startTime: "desc" },
        take: parseInt(limit as string),
        skip: parseInt(offset as string),
        include: {
          summary: { select: { id: true, overview: true } },
          actionItems: { select: { id: true, title: true, status: true, priority: true } },
          botSession: { select: { status: true, joinedAt: true } },
        },
      }),
      prisma.meeting.count({ where }),
    ]);

    res.json({ success: true, data: meetings, total });
  } catch (error) {
    console.error("Error fetching meetings:", error);
    res.status(500).json({ success: false, error: "Failed to fetch meetings" });
  }
});

// Get single meeting with full details
router.get("/:id", async (req: Request, res: Response) => {
  try {
    const meeting = await prisma.meeting.findFirst({
      where: { id: req.params.id, userId: req.user!.userId },
      include: {
        summary: true,
        actionItems: { orderBy: { createdAt: "asc" } },
        botSession: true,
        transcriptSegments: {
          orderBy: { startMs: "asc" },
          where: { isFinal: true },
        },
      },
    });

    if (!meeting) {
      res.status(404).json({ success: false, error: "Meeting not found" });
      return;
    }

    res.json({ success: true, data: meeting });
  } catch (error) {
    console.error("Error fetching meeting:", error);
    res.status(500).json({ success: false, error: "Failed to fetch meeting" });
  }
});

// Update meeting (toggle autoJoin, etc.)
router.patch("/:id", async (req: Request, res: Response) => {
  try {
    const { autoJoin, status } = req.body;

    const meeting = await prisma.meeting.findFirst({
      where: { id: req.params.id, userId: req.user!.userId },
    });

    if (!meeting) {
      res.status(404).json({ success: false, error: "Meeting not found" });
      return;
    }

    const updated = await prisma.meeting.update({
      where: { id: req.params.id },
      data: {
        ...(autoJoin !== undefined && { autoJoin }),
        ...(status && { status }),
      },
    });

    res.json({ success: true, data: updated });
  } catch (error) {
    console.error("Error updating meeting:", error);
    res.status(500).json({ success: false, error: "Failed to update meeting" });
  }
});

// Cancel bot — withdraw from joining
router.post("/:id/cancel-bot", async (req: Request, res: Response) => {
  try {
    const meeting = await prisma.meeting.findFirst({
      where: { id: req.params.id, userId: req.user!.userId },
    });

    if (!meeting) {
      res.status(404).json({ success: false, error: "Meeting not found" });
      return;
    }

    if (!["JOINING", "SCHEDULED"].includes(meeting.status)) {
      res.status(400).json({ success: false, error: "Bot can only be cancelled when joining or scheduled" });
      return;
    }

    // Reset meeting status back to DISCOVERED
    const updated = await prisma.meeting.update({
      where: { id: req.params.id },
      data: { status: "DISCOVERED" },
    });

    // Clean up any bot session
    await prisma.botSession.deleteMany({
      where: { meetingId: req.params.id },
    });

    console.log(`[Meetings] Bot cancelled for meeting "${meeting.title}"`);

    res.json({ success: true, data: updated, message: "Bot cancelled" });
  } catch (error) {
    console.error("Error cancelling bot:", error);
    res.status(500).json({ success: false, error: "Failed to cancel bot" });
  }
});

// Delete meeting from tracking
router.delete("/:id", async (req: Request, res: Response) => {
  try {
    const meeting = await prisma.meeting.findFirst({
      where: { id: req.params.id, userId: req.user!.userId },
    });

    if (!meeting) {
      res.status(404).json({ success: false, error: "Meeting not found" });
      return;
    }

    await prisma.meeting.delete({ where: { id: req.params.id } });

    res.json({ success: true, message: "Meeting removed" });
  } catch (error) {
    console.error("Error deleting meeting:", error);
    res.status(500).json({ success: false, error: "Failed to delete meeting" });
  }
});

export default router;
