import { z } from "zod";
import path from "path";
import dotenv from "dotenv";

// Load .env from project root (2 levels up from apps/server/src)
dotenv.config({ path: path.resolve(process.cwd(), ".env") });
dotenv.config({ path: path.resolve(__dirname, "../../../../.env") });

const envSchema = z.object({
  // App
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  PORT: z.coerce.number().default(3001),
  FRONTEND_URL: z.string().default("http://localhost:5173"),

  // Database
  DATABASE_URL: z.string().default("postgresql://postgres:password@localhost:5432/digital_twin"),

  // Redis
  REDIS_URL: z.string().default("redis://localhost:6379"),

  // Microsoft OAuth (Azure AD / Entra ID)
  MICROSOFT_CLIENT_ID: z.string().default("placeholder"),
  MICROSOFT_CLIENT_SECRET: z.string().default("placeholder"),
  MICROSOFT_TENANT_ID: z.string().default("common"),
  MICROSOFT_REDIRECT_URI: z.string().default("http://localhost:3001/api/auth/microsoft/callback"),

  // Zoom OAuth
  ZOOM_CLIENT_ID: z.string().default("placeholder"),
  ZOOM_CLIENT_SECRET: z.string().default("placeholder"),
  ZOOM_SDK_KEY: z.string().default("placeholder"),
  ZOOM_SDK_SECRET: z.string().default("placeholder"),
  ZOOM_REDIRECT_URI: z.string().default("http://localhost:3001/api/auth/zoom/callback"),

  // Deepgram
  DEEPGRAM_API_KEY: z.string().default("placeholder"),

  // Claude API (Anthropic)
  CLAUDE_API_KEY: z.string().default("placeholder"),

  // Auth
  JWT_SECRET: z.string().default("dev-jwt-secret-change-in-production"),
  SESSION_SECRET: z.string().default("dev-session-secret-change-in-production"),

  // Bot Agent (local bot shared secret)
  BOT_SECRET: z.string().default("dt-bot-secret-2024"),
});

export const env = envSchema.parse(process.env);

export type Env = z.infer<typeof envSchema>;
