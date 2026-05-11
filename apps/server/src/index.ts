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

// Sync database schema on startup
async function syncDatabase() {
  try {
    const { execSync } = require("child_process");
    console.log("  Syncing database schema...");
    execSync("npx prisma db push --skip-generate", {
      stdio: "inherit",
      env: { ...process.env, DATABASE_URL: process.env.DATABASE_URL },
    });
    console.log("  Database schema synced successfully");
  } catch (error) {
    console.warn("  [Warning] Database sync failed:", (error as Error).message);
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
