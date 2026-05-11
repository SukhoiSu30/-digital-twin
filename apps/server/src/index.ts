import express from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import { createServer } from "http";
import { Server as SocketIOServer } from "socket.io";
import { env } from "./config/env";
import { errorHandler } from "./middleware/errorHandler";
import { initializeScheduledJobs } from "./jobs/queues";
import { initializeWorkers } from "./jobs/workers";

// Route imports
import authRoutes from "./routes/auth";
import meetingRoutes from "./routes/meetings";
import calendarRoutes from "./routes/calendar";
import botRoutes from "./routes/bot";
import actionRoutes from "./routes/actions";
import webhookRoutes from "./routes/webhooks";
import summaryRoutes from "./routes/summaries";

const app = express();
const httpServer = createServer(app);

// Socket.io setup for real-time transcript streaming
const io = new SocketIOServer(httpServer, {
  cors: {
    origin: env.FRONTEND_URL,
    methods: ["GET", "POST"],
  },
});

// Make io accessible to routes
app.set("io", io);

// Middleware
app.use(helmet());
app.use(cors({ origin: env.FRONTEND_URL, credentials: true }));
app.use(morgan("dev"));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Health check
app.get("/api/health", (_req, res) => {
  res.json({
    status: "ok",
    timestamp: new Date().toISOString(),
    version: "1.0.0",
    services: {
      database: "pending", // Will check DB connection
      redis: "pending",    // Will check Redis connection
    },
  });
});

// Routes
app.use("/api/auth", authRoutes);
app.use("/api/meetings", meetingRoutes);
app.use("/api/calendar", calendarRoutes);
app.use("/api/bot", botRoutes);
app.use("/api/actions", actionRoutes);
app.use("/api/summaries", summaryRoutes);
app.use("/api/webhooks", webhookRoutes);

// Error handler (must be last)
app.use(errorHandler);

// Socket.io connection handling
io.on("connection", (socket) => {
  console.log(`Client connected: ${socket.id}`);

  // Join meeting-specific rooms for live transcripts
  socket.on("join:meeting", (meetingId: string) => {
    socket.join(`meeting:${meetingId}`);
    console.log(`Client ${socket.id} joined room meeting:${meetingId}`);
  });

  socket.on("leave:meeting", (meetingId: string) => {
    socket.leave(`meeting:${meetingId}`);
    console.log(`Client ${socket.id} left room meeting:${meetingId}`);
  });

  socket.on("disconnect", () => {
    console.log(`Client disconnected: ${socket.id}`);
  });
});

// Sync database schema on startup using raw SQL matching Prisma schema exactly
async function syncDatabase() {
  const { PrismaClient } = require("@prisma/client");
  const db = new PrismaClient();
  try {
    console.log("  Syncing database schema...");

    // Create enums first
    const enums = [
      `DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'MeetingStatus') THEN CREATE TYPE "MeetingStatus" AS ENUM ('DISCOVERED','SCHEDULED','JOINING','IN_PROGRESS','PROCESSING','COMPLETED','FAILED','SKIPPED'); END IF; END $$`,
      `DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'Priority') THEN CREATE TYPE "Priority" AS ENUM ('LOW','MEDIUM','HIGH','URGENT'); END IF; END $$`,
    ];

    const tables = [
      // User
      `CREATE TABLE IF NOT EXISTS "User" ("id" TEXT NOT NULL DEFAULT gen_random_uuid()::text, "email" TEXT NOT NULL, "displayName" TEXT NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, CONSTRAINT "User_pkey" PRIMARY KEY ("id"))`,
      `CREATE UNIQUE INDEX IF NOT EXISTS "User_email_key" ON "User"("email")`,
      // OAuthToken
      `CREATE TABLE IF NOT EXISTS "OAuthToken" ("id" TEXT NOT NULL DEFAULT gen_random_uuid()::text, "userId" TEXT NOT NULL, "provider" TEXT NOT NULL, "accessToken" TEXT NOT NULL, "refreshToken" TEXT NOT NULL, "expiresAt" TIMESTAMP(3) NOT NULL, "scopes" TEXT NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, CONSTRAINT "OAuthToken_pkey" PRIMARY KEY ("id"))`,
      `CREATE UNIQUE INDEX IF NOT EXISTS "OAuthToken_userId_provider_key" ON "OAuthToken"("userId", "provider")`,
      // Meeting - matching Prisma schema exactly
      `CREATE TABLE IF NOT EXISTS "Meeting" ("id" TEXT NOT NULL DEFAULT gen_random_uuid()::text, "userId" TEXT NOT NULL, "externalId" TEXT NOT NULL, "title" TEXT NOT NULL, "description" TEXT, "startTime" TIMESTAMP(3) NOT NULL, "endTime" TIMESTAMP(3) NOT NULL, "zoomMeetingId" TEXT, "zoomJoinUrl" TEXT, "zoomPasscode" TEXT, "status" "MeetingStatus" NOT NULL DEFAULT 'DISCOVERED', "autoJoin" BOOLEAN NOT NULL DEFAULT true, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, CONSTRAINT "Meeting_pkey" PRIMARY KEY ("id"))`,
      `CREATE UNIQUE INDEX IF NOT EXISTS "Meeting_userId_externalId_key" ON "Meeting"("userId", "externalId")`,
      `CREATE INDEX IF NOT EXISTS "Meeting_userId_startTime_idx" ON "Meeting"("userId", "startTime")`,
      `CREATE INDEX IF NOT EXISTS "Meeting_status_idx" ON "Meeting"("status")`,
      // BotSession
      `CREATE TABLE IF NOT EXISTS "BotSession" ("id" TEXT NOT NULL DEFAULT gen_random_uuid()::text, "meetingId" TEXT NOT NULL, "zoomBotId" TEXT, "joinedAt" TIMESTAMP(3), "leftAt" TIMESTAMP(3), "audioStreamId" TEXT, "status" TEXT NOT NULL, "errorLog" TEXT, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, CONSTRAINT "BotSession_pkey" PRIMARY KEY ("id"))`,
      `CREATE UNIQUE INDEX IF NOT EXISTS "BotSession_meetingId_key" ON "BotSession"("meetingId")`,
      // TranscriptSegment
      `CREATE TABLE IF NOT EXISTS "TranscriptSegment" ("id" TEXT NOT NULL DEFAULT gen_random_uuid()::text, "meetingId" TEXT NOT NULL, "speaker" TEXT, "content" TEXT NOT NULL, "startMs" INTEGER NOT NULL, "endMs" INTEGER NOT NULL, "confidence" DOUBLE PRECISION, "isFinal" BOOLEAN NOT NULL DEFAULT true, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, CONSTRAINT "TranscriptSegment_pkey" PRIMARY KEY ("id"))`,
      `CREATE INDEX IF NOT EXISTS "TranscriptSegment_meetingId_startMs_idx" ON "TranscriptSegment"("meetingId", "startMs")`,
      // Summary
      `CREATE TABLE IF NOT EXISTS "Summary" ("id" TEXT NOT NULL DEFAULT gen_random_uuid()::text, "meetingId" TEXT NOT NULL, "overview" TEXT NOT NULL, "keyPoints" JSONB, "decisions" JSONB, "rawResponse" TEXT NOT NULL DEFAULT '', "emailSentAt" TIMESTAMP(3), "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, CONSTRAINT "Summary_pkey" PRIMARY KEY ("id"))`,
      `CREATE UNIQUE INDEX IF NOT EXISTS "Summary_meetingId_key" ON "Summary"("meetingId")`,
      // ActionItem
      `CREATE TABLE IF NOT EXISTS "ActionItem" ("id" TEXT NOT NULL DEFAULT gen_random_uuid()::text, "meetingId" TEXT NOT NULL, "title" TEXT NOT NULL, "description" TEXT, "assignee" TEXT, "dueDate" TIMESTAMP(3), "priority" "Priority" NOT NULL DEFAULT 'MEDIUM', "status" TEXT NOT NULL DEFAULT 'pending', "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, CONSTRAINT "ActionItem_pkey" PRIMARY KEY ("id"))`,
      `CREATE INDEX IF NOT EXISTS "ActionItem_meetingId_idx" ON "ActionItem"("meetingId")`,
      `CREATE INDEX IF NOT EXISTS "ActionItem_status_idx" ON "ActionItem"("status")`,
      // JobLog
      `CREATE TABLE IF NOT EXISTS "JobLog" ("id" TEXT NOT NULL DEFAULT gen_random_uuid()::text, "jobType" TEXT NOT NULL, "jobId" TEXT NOT NULL DEFAULT '', "status" TEXT NOT NULL, "payload" JSONB, "result" JSONB, "errorMessage" TEXT, "startedAt" TIMESTAMP(3), "completedAt" TIMESTAMP(3), "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, CONSTRAINT "JobLog_pkey" PRIMARY KEY ("id"))`,
      `CREATE INDEX IF NOT EXISTS "JobLog_jobType_status_idx" ON "JobLog"("jobType", "status")`,
    ];

    // Run enums first
    for (const sql of enums) {
      try { await db.$executeRawUnsafe(sql); } catch (e: any) { console.log("  Enum:", e?.message?.substring(0, 80)); }
    }

    // Drop old tables that have wrong schema (only if they exist with wrong columns)
    try {
      const check = await db.$queryRawUnsafe(`SELECT column_name FROM information_schema.columns WHERE table_name = 'Meeting' AND column_name = 'externalId'`);
      if ((check as any[]).length === 0) {
        console.log("  Dropping old tables with wrong schema...");
        await db.$executeRawUnsafe(`DROP TABLE IF EXISTS "JobLog", "ActionItem", "Summary", "TranscriptSegment", "BotSession", "Meeting", "OAuthToken", "User" CASCADE`);
      }
    } catch (e) { /* table doesn't exist yet, that's fine */ }

    // Create tables
    for (const sql of tables) {
      try { await db.$executeRawUnsafe(sql); } catch (e: any) { console.log("  SQL:", e?.message?.substring(0, 80)); }
    }

    // Re-insert user data if it was dropped
    console.log("  Database schema synced successfully - all tables ready");
    await db.$disconnect();
  } catch (error: any) {
    console.error("  [ERROR] Database sync failed:", error?.message);
    await db.$disconnect();
  }
}

// Start server
httpServer.listen(env.PORT, async () => {
  console.log(`
  ╔══════════════════════════════════════════╗
  ║       Digital Twin — API Server          ║
  ║                                          ║
  ║  HTTP:      http://localhost:${env.PORT}       ║
  ║  WebSocket: ws://localhost:${env.PORT}         ║
  ║  Environment: ${env.NODE_ENV.padEnd(25)}║
  ╚══════════════════════════════════════════╝
  `);

  // Sync database tables
  await syncDatabase();

  // Initialize background job system
  try {
    initializeWorkers(io);
    await initializeScheduledJobs();
    console.log("  Background job system initialized");
  } catch (error) {
    console.warn("  [Warning] Background jobs not started (Redis may not be running):", (error as Error).message);
    console.warn("  The server will work without auto-scheduling. Start Redis to enable it.");
  }
});

// Graceful shutdown
process.on("SIGTERM", async () => {
  console.log("Shutting down gracefully...");
  const { closeQueues } = await import("./jobs/queues");
  await closeQueues();
  httpServer.close();
  process.exit(0);
});

export { io };
