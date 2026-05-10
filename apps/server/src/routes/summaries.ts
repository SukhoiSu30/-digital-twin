import { Router, Request, Response } from "express";
import { authMiddleware } from "../middleware/auth";
import { prisma } from "@digital-twin/database";
import { regenerateSummary } from "../services/summarizer";
import { sendSummaryEmail } from "../services/email";

const router = Router();

router.use(authMiddleware);

// Get summary for a meeting
router.get("/:meetingId", async (req: Request, res: Response) => {
  try {
    const meeting = await prisma.meeting.findFirst({
      where: { id: req.params.meetingId, userId: req.user!.userId },
      include: {
        summary: true,
        actionItems: { orderBy: { priority: "desc" } },
      },
    });

    if (!meeting) {
      res.status(404).json({ success: false, error: "Meeting not found" });
      return;
    }

    if (!meeting.summary) {
      res.status(404).json({ success: false, error: "No summary generated yet" });
      return;
    }

    res.json({
      success: true,
      data: {
        summary: meeting.summary,
        actionItems: meeting.actionItems,
      },
    });
  } catch (error) {
    console.error("Error fetching summary:", error);
    res.status(500).json({ success: false, error: "Failed to fetch summary" });
  }
});

// Regenerate summary (re-runs Claude on the transcript)
router.post("/:meetingId/regenerate", async (req: Request, res: Response) => {
  try {
    const meeting = await prisma.meeting.findFirst({
      where: { id: req.params.meetingId, userId: req.user!.userId },
      include: { transcriptSegments: { where: { isFinal: true }, take: 1 } },
    });

    if (!meeting) {
      res.status(404).json({ success: false, error: "Meeting not found" });
      return;
    }

    if (meeting.transcriptSegments.length === 0) {
      res.status(400).json({ success: false, error: "No transcript available to summarize" });
      return;
    }

    const result = await regenerateSummary(meeting.id);

    res.json({
      success: true,
      data: result,
      message: "Summary regenerated successfully",
    });
  } catch (error: any) {
    console.error("Error regenerating summary:", error);
    res.status(500).json({ success: false, error: error.message || "Failed to regenerate summary" });
  }
});

// Send summary via email
router.post("/:meetingId/email", async (req: Request, res: Response) => {
  try {
    const meeting = await prisma.meeting.findFirst({
      where: { id: req.params.meetingId, userId: req.user!.userId },
      include: { summary: true },
    });

    if (!meeting) {
      res.status(404).json({ success: false, error: "Meeting not found" });
      return;
    }

    if (!meeting.summary) {
      res.status(400).json({ success: false, error: "No summary to email — generate one first" });
      return;
    }

    await sendSummaryEmail(meeting.id, req.user!.userId);

    res.json({
      success: true,
      message: "Summary email sent successfully",
    });
  } catch (error: any) {
    console.error("Error sending summary email:", error);
    res.status(500).json({ success: false, error: error.message || "Failed to send email" });
  }
});

export default router;
