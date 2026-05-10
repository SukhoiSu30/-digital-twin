/**
 * BullMQ Workers
 *
 * Processes background jobs for each stage of the meeting pipeline.
 * Workers run concurrently and handle retries, error logging, and
 * pipeline progression (calendar → bot → transcript → summary → email).
 */

import { Worker, Job } from "bullmq";
import { prisma } from "@digital-twin/database";
import { getRedisConnection, scheduleBotJoin, queueSummaryGeneration, queueEmailSend } from "./queues";
import { syncAllUsers } from "../services/calendar-sync";
import { joinMeeting, leaveMeeting, getActiveCount, MAX_CONCURRENT_BOTS } from "../services/zoom-bot";
import { startTranscription } from "../services/transcription";
import { generateMeetingSummary } from "../services/summarizer";
import { sendSummaryEmail } from "../services/email";
import type { Server as SocketIOServer } from "socket.io";

let io: SocketIOServer;

/**
 * Initialize all workers (call once on server start, pass Socket.io instance)
 */
export function initializeWorkers(socketIo: SocketIOServer): void {
  io = socketIo;

  // ─── Calendar Sync Worker ──────────────────────────────

  const calendarWorker = new Worker(
    "calendar-sync",
    async (job: Job) => {
      console.log(`[Worker:CalendarSync] Running job ${job.id}`);

      await logJob("calendar_sync", job.id || "unknown", "running");

      try {
        await syncAllUsers();

        // After syncing, schedule bots for any newly discovered meetings
        const upcomingMeetings = await prisma.meeting.findMany({
          where: {
            status: "DISCOVERED",
            autoJoin: true,
            startTime: { gte: new Date() },
            zoomJoinUrl: { not: null },
          },
        });

        for (const meeting of upcomingMeetings) {
          await scheduleBotJoin(meeting.id, meeting.startTime);

          await prisma.meeting.update({
            where: { id: meeting.id },
            data: { status: "SCHEDULED" },
          });
        }

        await logJob("calendar_sync", job.id || "unknown", "completed", {
          meetingsScheduled: upcomingMeetings.length,
        });

        return { meetingsScheduled: upcomingMeetings.length };
      } catch (error: any) {
        await logJob("calendar_sync", job.id || "unknown", "failed", null, error.message);
        throw error;
      }
    },
    {
      connection: getRedisConnection(),
      concurrency: 1, // Only one calendar sync at a time
    }
  );

  // ─── Bot Join Worker ───────────────────────────────────

  const botJoinWorker = new Worker(
    "bot-join",
    async (job: Job<{ meetingId: string }>) => {
      const { meetingId } = job.data;
      console.log(`[Worker:BotJoin] Processing meeting ${meetingId}`);

      await logJob("bot_join", job.id || "unknown", "running", { meetingId });

      // Check concurrency limit
      if (getActiveCount() >= MAX_CONCURRENT_BOTS) {
        console.log(`[Worker:BotJoin] Max concurrent bots (${MAX_CONCURRENT_BOTS}) reached, waiting...`);
        throw new Error("Max concurrent bots reached. Will retry.");
      }

      const meeting = await prisma.meeting.findUnique({
        where: { id: meetingId },
      });

      if (!meeting) {
        console.error(`[Worker:BotJoin] Meeting ${meetingId} not found`);
        return;
      }

      if (!meeting.zoomJoinUrl || !meeting.zoomMeetingId) {
        console.error(`[Worker:BotJoin] Meeting ${meetingId} has no Zoom URL`);
        return;
      }

      // Skip if meeting already has active bot or is completed
      if (["IN_PROGRESS", "PROCESSING", "COMPLETED"].includes(meeting.status)) {
        console.log(`[Worker:BotJoin] Meeting ${meetingId} already ${meeting.status}, skipping`);
        return;
      }

      try {
        // Join the meeting
        const session = await joinMeeting({
          dbMeetingId: meeting.id,
          zoomMeetingId: meeting.zoomMeetingId,
          zoomJoinUrl: meeting.zoomJoinUrl,
          zoomPasscode: meeting.zoomPasscode,
          userId: meeting.userId,
        });

        // Wire up transcription when audio stream is ready
        session.emitter.on("audio_stream_ready", (audioEmitter) => {
          startTranscription(meetingId, audioEmitter, io);
        });

        // Wire up post-meeting processing when bot leaves
        session.emitter.on("meeting_ended", async () => {
          await queueSummaryGeneration(meetingId);
        });

        // Notify dashboard
        io.emit("meeting:status", {
          meetingId,
          status: "IN_PROGRESS",
          botJoinedAt: session.joinedAt,
        });

        await logJob("bot_join", job.id || "unknown", "completed", { meetingId });

        return { meetingId, joinedAt: session.joinedAt };
      } catch (error: any) {
        await logJob("bot_join", job.id || "unknown", "failed", { meetingId }, error.message);

        io.emit("meeting:status", {
          meetingId,
          status: "FAILED",
          error: error.message,
        });

        throw error;
      }
    },
    {
      connection: getRedisConnection(),
      concurrency: MAX_CONCURRENT_BOTS, // Handle 4 concurrent meetings
    }
  );

  // ─── Summary Generation Worker ─────────────────────────

  const summaryWorker = new Worker(
    "summary-generation",
    async (job: Job<{ meetingId: string }>) => {
      const { meetingId } = job.data;
      console.log(`[Worker:Summary] Generating summary for meeting ${meetingId}`);

      await logJob("summary", job.id || "unknown", "running", { meetingId });

      try {
        const result = await generateMeetingSummary(meetingId);

        // Notify dashboard
        io.emit("summary:ready", {
          meetingId,
          overview: result.overview,
          actionItemCount: result.actionItems.length,
        });

        // Queue email send
        const meeting = await prisma.meeting.findUnique({
          where: { id: meetingId },
          select: { userId: true },
        });

        if (meeting) {
          await queueEmailSend(meetingId, meeting.userId);
        }

        await logJob("summary", job.id || "unknown", "completed", {
          meetingId,
          actionItems: result.actionItems.length,
        });

        return result;
      } catch (error: any) {
        await logJob("summary", job.id || "unknown", "failed", { meetingId }, error.message);
        throw error;
      }
    },
    {
      connection: getRedisConnection(),
      concurrency: 2, // Process 2 summaries at a time
    }
  );

  // ─── Email Send Worker ─────────────────────────────────

  const emailWorker = new Worker(
    "email-send",
    async (job: Job<{ meetingId: string; userId: string }>) => {
      const { meetingId, userId } = job.data;
      console.log(`[Worker:Email] Sending summary email for meeting ${meetingId}`);

      await logJob("email", job.id || "unknown", "running", { meetingId });

      try {
        await sendSummaryEmail(meetingId, userId);

        await logJob("email", job.id || "unknown", "completed", { meetingId });

        return { meetingId, sent: true };
      } catch (error: any) {
        await logJob("email", job.id || "unknown", "failed", { meetingId }, error.message);
        throw error;
      }
    },
    {
      connection: getRedisConnection(),
      concurrency: 2,
    }
  );

  // ─── Worker Event Logging ──────────────────────────────

  for (const [name, worker] of Object.entries({
    calendarSync: calendarWorker,
    botJoin: botJoinWorker,
    summary: summaryWorker,
    email: emailWorker,
  })) {
    worker.on("completed", (job) => {
      console.log(`[Worker:${name}] Job ${job.id} completed`);
    });

    worker.on("failed", (job, err) => {
      console.error(`[Worker:${name}] Job ${job?.id} failed:`, err.message);
    });

    worker.on("error", (err) => {
      console.error(`[Worker:${name}] Error:`, err.message);
    });
  }

  console.log("[Workers] All workers initialized");
  console.log(`[Workers] Bot concurrency: ${MAX_CONCURRENT_BOTS} simultaneous meetings`);
}

/**
 * Log job execution to the database for monitoring
 */
async function logJob(
  jobType: string,
  jobId: string,
  status: string,
  result?: any,
  errorMessage?: string
): Promise<void> {
  try {
    await prisma.jobLog.create({
      data: {
        jobType,
        jobId,
        status,
        result: result || undefined,
        errorMessage,
        startedAt: status === "running" ? new Date() : undefined,
        completedAt: ["completed", "failed"].includes(status) ? new Date() : undefined,
      },
    });
  } catch (error) {
    console.error("[JobLog] Failed to log job:", error);
  }
}
