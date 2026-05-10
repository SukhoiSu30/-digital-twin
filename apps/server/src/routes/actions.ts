import { Router, Request, Response } from "express";
import { authMiddleware } from "../middleware/auth";
import { prisma } from "../lib/prisma";

const router = Router();

router.use(authMiddleware);

// List all action items with filters
router.get("/", async (req: Request, res: Response) => {
  try {
    const { status, priority, meetingId } = req.query;

    const where: any = { meeting: { userId: req.user!.userId } };

    if (status && typeof status === "string") where.status = status;
    if (priority && typeof priority === "string") where.priority = priority;
    if (meetingId && typeof meetingId === "string") where.meetingId = meetingId;

    const actionItems = await prisma.actionItem.findMany({
      where,
      orderBy: [{ priority: "desc" }, { createdAt: "desc" }],
      include: {
        meeting: { select: { id: true, title: true, startTime: true } },
      },
    });

    res.json({ success: true, data: actionItems });
  } catch (error) {
    console.error("Error fetching action items:", error);
    res.status(500).json({ success: false, error: "Failed to fetch action items" });
  }
});

// Update action item
router.patch("/:id", async (req: Request, res: Response) => {
  try {
    const { status, assignee, priority, dueDate, title, description } = req.body;

    const actionItem = await prisma.actionItem.findFirst({
      where: { id: req.params.id, meeting: { userId: req.user!.userId } },
    });

    if (!actionItem) {
      res.status(404).json({ success: false, error: "Action item not found" });
      return;
    }

    const updated = await prisma.actionItem.update({
      where: { id: req.params.id },
      data: {
        ...(status !== undefined && { status }),
        ...(assignee !== undefined && { assignee }),
        ...(priority !== undefined && { priority }),
        ...(dueDate !== undefined && { dueDate: dueDate ? new Date(dueDate) : null }),
        ...(title !== undefined && { title }),
        ...(description !== undefined && { description }),
      },
    });

    res.json({ success: true, data: updated });
  } catch (error) {
    console.error("Error updating action item:", error);
    res.status(500).json({ success: false, error: "Failed to update action item" });
  }
});

export default router;
