/**
 * BullMQ Job Queues
 *
 * Defines all background job queues for the Digital Twin.
 * Each queue handles a specific stage of the meeting pipeline:
 *   1. Calendar Sync — discover meetings every 5 minutes
 *   2. Bot Join — join Zoom meetings at scheduled time
 *   3. Summary Generation — run Claude after meeting ends
 *   4. Email Send — deliver summary to user's inbox
 */

import { Queue } from "bullmq";
import Redis from "ioredis";
import { env } from "../config/env";

// Shared Redis connection for all queues
let redis: Redis | null = null;

export function getRedisConnection(): Redis {
  if (!redis) {
    redis = new Redis(env.REDIS_URL, {
      maxRetriesPerRequest: null, // Required by BullMQ
    });

    redis.on("error", (err) => {
      console.error("[Redis] Connection error:", err.message);
    });

    redis.on("connect", () => {
      console.log("[Redis] Connected successfully");
    });
  }
  return redis;
}

// ─── Queue Definitions ────────────────────────────────────

export const calendarSyncQueue = new Queue("calendar-sync", {
  connection: getRedisConnection(),
  defaultJobOptions: {
    removeOnComplete: { count: 100 },   // Keep last 100 completed jobs
    removeOnFail: { count: 50 },        // Keep last 50 failed jobs
    attempts: 3,
    backoff: {
      type: "exponential",
      delay: 5000,
    },
  },
});

export const botJoinQueue = new Queue("bot-join", {
  connection: getRedisConnection(),
  defaultJobOptions: {
    removeOnComplete: { count: 50 },
    removeOnFail: { count: 50 },
    attempts: 2,                         // Retry once if join fails
    backoff: {
      type: "fixed",
      delay: 10000,                      // Wait 10s before retry
    },
  },
});

export const summaryQueue = new Queue("summary-generation", {
  connection: getRedisConnection(),
  defaultJobOptions: {
    removeOnComplete: { count: 100 },
    removeOnFail: { count: 50 },
    attempts: 3,
    backoff: {
      type: "exponential",
      delay: 10000,
    },
  },
});

export const emailQueue = new Queue("email-send", {
  connection: getRedisConnection(),
  defaultJobOptions: {
    removeOnComplete: { count: 100 },
    removeOnFail: { count: 50 },
    attempts: 3,
    backoff: {
      type: "exponential",
      delay: 5000,
    },
  },
});

/**
 * Initialize recurring jobs (call once on server start)
 */
export async function initializeScheduledJobs(): Promise<void> {
  // Remove any existing repeatable jobs first to avoid duplicates
  const existingJobs = await calendarSyncQueue.getRepeatableJobs();
  for (const job of existingJobs) {
    await calendarSyncQueue.removeRepeatableByKey(job.key);
  }

  // Schedule calendar sync every 5 minutes
  await calendarSyncQueue.add(
    "sync-all-users",
    {},
    {
      repeat: { every: 5 * 60 * 1000 }, // 5 minutes
    }
  );

  console.log("[Queues] Scheduled recurring calendar sync (every 5 min)");
}

/**
 * Schedule a bot to join a meeting at a specific time
 */
export async function scheduleBotJoin(
  meetingId: string,
  startTime: Date,
  joinEarlySeconds: number = 30
): Promise<void> {
  const delay = startTime.getTime() - Date.now() - joinEarlySeconds * 1000;

  if (delay <= 0) {
    // Meeting is starting now or already started — join immediately
    await botJoinQueue.add(`join-${meetingId}`, { meetingId }, { jobId: `join-${meetingId}` });
    console.log(`[Queues] Bot join scheduled immediately for meeting ${meetingId}`);
  } else {
    await botJoinQueue.add(
      `join-${meetingId}`,
      { meetingId },
      { delay, jobId: `join-${meetingId}` }
    );
    const joinTime = new Date(Date.now() + delay);
    console.log(
      `[Queues] Bot join scheduled for meeting ${meetingId} at ${joinTime.toLocaleTimeString()} ` +
      `(in ${Math.round(delay / 60000)} min)`
    );
  }
}

/**
 * Queue summary generation after a meeting ends
 */
export async function queueSummaryGeneration(meetingId: string): Promise<void> {
  await summaryQueue.add(`summary-${meetingId}`, { meetingId });
  console.log(`[Queues] Summary generation queued for meeting ${meetingId}`);
}

/**
 * Queue email send after summary is generated
 */
export async function queueEmailSend(meetingId: string, userId: string): Promise<void> {
  await emailQueue.add(`email-${meetingId}`, { meetingId, userId });
  console.log(`[Queues] Email send queued for meeting ${meetingId}`);
}

/**
 * Graceful shutdown — close Redis connection
 */
export async function closeQueues(): Promise<void> {
  await calendarSyncQueue.close();
  await botJoinQueue.close();
  await summaryQueue.close();
  await emailQueue.close();
  if (redis) {
    await redis.quit();
    redis = null;
  }
  console.log("[Queues] All queues closed");
}
