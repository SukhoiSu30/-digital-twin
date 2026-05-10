import { Router, Request, Response } from "express";
import { env } from "../config/env";
import { generateToken } from "../middleware/auth";
import { prisma } from "@digital-twin/database";

const router = Router();

// Microsoft OAuth scopes we need
const MICROSOFT_SCOPES = [
  "openid",
  "profile",
  "email",
  "offline_access",
  "Calendars.Read",
  "Mail.Read",
  "Mail.Send",
  "User.Read",
];

// Step 1: Redirect user to Microsoft login
router.get("/microsoft", (_req: Request, res: Response) => {
  const authUrl = new URL(
    `https://login.microsoftonline.com/${env.MICROSOFT_TENANT_ID}/oauth2/v2.0/authorize`
  );

  authUrl.searchParams.set("client_id", env.MICROSOFT_CLIENT_ID);
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("redirect_uri", env.MICROSOFT_REDIRECT_URI);
  authUrl.searchParams.set("scope", MICROSOFT_SCOPES.join(" "));
  authUrl.searchParams.set("response_mode", "query");
  authUrl.searchParams.set("prompt", "select_account");

  res.redirect(authUrl.toString());
});

// Step 2: Handle Microsoft OAuth callback
router.get("/microsoft/callback", async (req: Request, res: Response) => {
  try {
    const { code } = req.query;

    if (!code || typeof code !== "string") {
      res.redirect(`${env.FRONTEND_URL}/auth/error?message=No authorization code received`);
      return;
    }

    // Exchange code for tokens
    const tokenResponse = await fetch(
      `https://login.microsoftonline.com/${env.MICROSOFT_TENANT_ID}/oauth2/v2.0/token`,
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: env.MICROSOFT_CLIENT_ID,
          client_secret: env.MICROSOFT_CLIENT_SECRET,
          code,
          redirect_uri: env.MICROSOFT_REDIRECT_URI,
          grant_type: "authorization_code",
          scope: MICROSOFT_SCOPES.join(" "),
        }),
      }
    );

    const tokens: any = await tokenResponse.json();

    console.log("Microsoft token response status:", tokenResponse.status);
    console.log("Microsoft redirect_uri used:", env.MICROSOFT_REDIRECT_URI);

    if (tokens.error) {
      console.error("Microsoft token error:", JSON.stringify(tokens, null, 2));
      res.redirect(`${env.FRONTEND_URL}/auth/error?message=${encodeURIComponent(tokens.error_description || tokens.error)}`);
      return;
    }

    // Get user profile from Microsoft Graph
    const profileResponse = await fetch("https://graph.microsoft.com/v1.0/me", {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });
    const profile: any = await profileResponse.json();
    console.log("Microsoft profile response:", JSON.stringify(profile));

    const userEmail = profile.mail || profile.userPrincipalName;
    const userName = profile.displayName || "User";
    console.log("Creating/updating user:", userEmail, userName);

    // Upsert user
    const user = await prisma.user.upsert({
      where: { email: profile.mail || profile.userPrincipalName },
      create: {
        email: profile.mail || profile.userPrincipalName,
        displayName: profile.displayName || "User",
      },
      update: {
        displayName: profile.displayName || "User",
      },
    });

    // Store OAuth tokens
    await prisma.oAuthToken.upsert({
      where: { userId_provider: { userId: user.id, provider: "microsoft" } },
      create: {
        userId: user.id,
        provider: "microsoft",
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token || "",
        expiresAt: new Date(Date.now() + tokens.expires_in * 1000),
        scopes: MICROSOFT_SCOPES.join(" "),
      },
      update: {
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token || "",
        expiresAt: new Date(Date.now() + tokens.expires_in * 1000),
        scopes: MICROSOFT_SCOPES.join(" "),
      },
    });

    // Generate our app JWT
    const jwt = generateToken({ userId: user.id, email: user.email });

    // Redirect to frontend with token
    res.redirect(`${env.FRONTEND_URL}/auth/callback?token=${jwt}`);
  } catch (error: any) {
    console.error("Microsoft OAuth error:", error?.message || error);
    console.error("Full error:", JSON.stringify(error, Object.getOwnPropertyNames(error)));
    res.redirect(`${env.FRONTEND_URL}/auth/error?message=${encodeURIComponent(error?.message || 'Authentication failed')}`);
  }
});

// Zoom OAuth — Step 1: Redirect to Zoom login
router.get("/zoom", (_req: Request, res: Response) => {
  const authUrl = new URL("https://zoom.us/oauth/authorize");
  authUrl.searchParams.set("client_id", env.ZOOM_CLIENT_ID);
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("redirect_uri", env.ZOOM_REDIRECT_URI);

  res.redirect(authUrl.toString());
});

// Zoom OAuth — Step 2: Handle callback
router.get("/zoom/callback", async (req: Request, res: Response) => {
  try {
    const { code } = req.query;

    if (!code || typeof code !== "string") {
      res.redirect(`${env.FRONTEND_URL}/auth/error?message=No Zoom authorization code`);
      return;
    }

    const basicAuth = Buffer.from(`${env.ZOOM_CLIENT_ID}:${env.ZOOM_CLIENT_SECRET}`).toString("base64");

    const tokenResponse = await fetch("https://zoom.us/oauth/token", {
      method: "POST",
      headers: {
        Authorization: `Basic ${basicAuth}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        code,
        grant_type: "authorization_code",
        redirect_uri: env.ZOOM_REDIRECT_URI,
      }),
    });

    const tokens: any = await tokenResponse.json();

    if (tokens.error) {
      console.error("Zoom token error:", tokens);
      res.redirect(`${env.FRONTEND_URL}/auth/error?message=${tokens.reason}`);
      return;
    }

    // For now, store Zoom tokens — we'll need a user context
    // This will be enhanced when we add auth middleware to identify the user
    console.log("Zoom tokens received successfully");

    res.redirect(`${env.FRONTEND_URL}/settings?zoom=connected`);
  } catch (error) {
    console.error("Zoom OAuth error:", error);
    res.redirect(`${env.FRONTEND_URL}/auth/error?message=Zoom authentication failed`);
  }
});

// Get current user profile
router.get("/me", async (req: Request, res: Response) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader) {
      res.status(401).json({ success: false, error: "Not authenticated" });
      return;
    }

    // Decode JWT to get user
    const token = authHeader.split(" ")[1];
    const jwt = await import("jsonwebtoken");
    const decoded = jwt.verify(token, env.JWT_SECRET) as { userId: string };

    const user = await prisma.user.findUnique({
      where: { id: decoded.userId },
      include: {
        oauthTokens: {
          select: { provider: true, expiresAt: true },
        },
      },
    });

    if (!user) {
      res.status(404).json({ success: false, error: "User not found" });
      return;
    }

    res.json({
      success: true,
      data: {
        id: user.id,
        email: user.email,
        displayName: user.displayName,
        connectedServices: user.oauthTokens.map((t) => ({
          provider: t.provider,
          connected: true,
          expiresAt: t.expiresAt,
        })),
      },
    });
  } catch {
    res.status(401).json({ success: false, error: "Invalid token" });
  }
});

export default router;
