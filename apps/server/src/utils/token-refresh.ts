/**
 * OAuth Token Refresh Utility
 * Handles automatic token refresh for Microsoft and Zoom
 */

import { prisma } from "../lib/prisma";
import { env } from "../config/env";

const TOKEN_BUFFER_MS = 5 * 60 * 1000; // Refresh 5 minutes before expiry

interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  error?: string;
  error_description?: string;
  reason?: string;
}

/**
 * Get a valid Microsoft Graph API access token, refreshing if needed
 */
export async function getMicrosoftToken(userId: string): Promise<string> {
  const tokenRecord = await prisma.oAuthToken.findUnique({
    where: { userId_provider: { userId, provider: "microsoft" } },
  });

  if (!tokenRecord) {
    throw new Error("Microsoft account not connected. Please authenticate first.");
  }

  // If token is still valid (with buffer), return it
  if (tokenRecord.expiresAt.getTime() > Date.now() + TOKEN_BUFFER_MS) {
    return tokenRecord.accessToken;
  }

  // Refresh the token
  console.log(`[Token Refresh] Refreshing Microsoft token for user ${userId}`);

  const response = await fetch(
    `https://login.microsoftonline.com/${env.MICROSOFT_TENANT_ID}/oauth2/v2.0/token`,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: env.MICROSOFT_CLIENT_ID,
        client_secret: env.MICROSOFT_CLIENT_SECRET,
        refresh_token: tokenRecord.refreshToken,
        grant_type: "refresh_token",
        scope: tokenRecord.scopes,
      }),
    }
  );

  const data = (await response.json()) as TokenResponse;

  if (data.error) {
    console.error("[Token Refresh] Microsoft refresh failed:", data.error_description);
    throw new Error(`Microsoft token refresh failed: ${data.error_description}`);
  }

  // Update stored tokens
  await prisma.oAuthToken.update({
    where: { id: tokenRecord.id },
    data: {
      accessToken: data.access_token,
      refreshToken: data.refresh_token || tokenRecord.refreshToken,
      expiresAt: new Date(Date.now() + data.expires_in * 1000),
    },
  });

  console.log(`[Token Refresh] Microsoft token refreshed successfully for user ${userId}`);
  return data.access_token;
}

/**
 * Get a valid Zoom API access token, refreshing if needed
 */
export async function getZoomToken(userId: string): Promise<string> {
  const tokenRecord = await prisma.oAuthToken.findUnique({
    where: { userId_provider: { userId, provider: "zoom" } },
  });

  if (!tokenRecord) {
    throw new Error("Zoom account not connected. Please authenticate first.");
  }

  if (tokenRecord.expiresAt.getTime() > Date.now() + TOKEN_BUFFER_MS) {
    return tokenRecord.accessToken;
  }

  console.log(`[Token Refresh] Refreshing Zoom token for user ${userId}`);

  const basicAuth = Buffer.from(
    `${env.ZOOM_CLIENT_ID}:${env.ZOOM_CLIENT_SECRET}`
  ).toString("base64");

  const response = await fetch("https://zoom.us/oauth/token", {
    method: "POST",
    headers: {
      Authorization: `Basic ${basicAuth}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: tokenRecord.refreshToken,
    }),
  });

  const data = (await response.json()) as TokenResponse;

  if (data.error) {
    console.error("[Token Refresh] Zoom refresh failed:", data.reason);
    throw new Error(`Zoom token refresh failed: ${data.reason}`);
  }

  await prisma.oAuthToken.update({
    where: { id: tokenRecord.id },
    data: {
      accessToken: data.access_token,
      refreshToken: data.refresh_token || tokenRecord.refreshToken,
      expiresAt: new Date(Date.now() + data.expires_in * 1000),
    },
  });

  console.log(`[Token Refresh] Zoom token refreshed successfully for user ${userId}`);
  return data.access_token;
}
