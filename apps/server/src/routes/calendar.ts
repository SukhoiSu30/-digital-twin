import { Router, Request, Response } from "express";
import { authMiddleware } from "../middleware/auth";
import { prisma } from "../lib/prisma";
import { env } from "../config/env";

const router = Router();

router.use(authMiddleware);

// Utility: Extract Zoom link from text
function extractZoomLink(text: string): string | null {
  const patterns = [
    /https:\/\/[\w.-]*zoom\.us\/j\/(\d+)(\?pwd=[\w%-]+)?/gi,
    /https:\/\/[\w.-]*zoom\.us\/my\/[\w.-]+/gi,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) return match[0];
  }
  return null;
}

// Utility: Parse Zoom URL into meeting ID and passcode
function parseZoomUrl(url: string): { meetingId: string | null; passcode: string | null } {
  const meetingIdMatch = url.match(/\/j\/(\d+)/);
  const passcodeMatch = url.match(/pwd=([\w%-]+)/);

  return {
    meetingId: meetingIdMatch ? meetingIdMatch[1] : null,
    passcode: passcodeMatch ? decodeURIComponent(passcodeMatch[1]) : null,
  };
}

// Utility: Refresh Microsoft token if expired
async function getValidAccessToken(userId: string): Promise<string> {
  const tokenRecord = await prisma.oAuthToken.findUnique({
    where: { userId_provider: { userId, provider: "microsoft" } },
  });

  if (!tokenRecord) {
    throw new Error("Microsoft account not connected");
  }

  // If token is still valid (with 5 min buffer), return it
  if (tokenRecord.expiresAt > new Date(Date.now() + 5 * 60 * 1000)) {
    return tokenRecord.accessToken;
  }

  // Refresh the token
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

  const tokens: any = await response.json();

  if (tokens.error) {
    throw new Error(`Token refresh failed: ${tokens.error_description}`);
  }

  // Update stored tokens
  await prisma.oAuthToken.update({
    where: { id: tokenRecord.id },
    data: {
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token || tokenRecord.refreshToken,
      expiresAt: new Date(Date.now() + tokens.expires_in * 1000),
    },
  });

  return tokens.access_token;
}

// Trigger calendar sync — pulls events from Microsoft Graph API
router.post("/sync", async (req: Request, res: Response) => {
  try {
    const userId = req.user!.userId;
    const accessToken = await getValidAccessToken(userId);

    // Get events for next 24 hours
    const now = new Date();
    const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);

    const graphResponse = await fetch(
      `https://graph.microsoft.com/v1.0/me/calendarView?` +
        new URLSearchParams({
          startDateTime: now.toISOString(),
          endDateTime: tomorrow.toISOString(),
          $select: "id,subject,body,start,end,location,onlineMeeting,organizer",
          $orderby: "start/dateTime",
          $top: "50",
        }),
      {
        headers: { Authorization: `Bearer ${accessToken}` },
      }
    );

    if (!graphResponse.ok) {
      const error: any = await graphResponse.json();
      console.error("Graph API error:", error);
      res.status(502).json({ success: false, error: "Failed to fetch calendar events" });
      return;
    }

    const data: any = await graphResponse.json();
    const events = data.value || [];

    let discovered = 0;
    let updated = 0;

    for (const event of events) {
      // Look for Zoom links in body, location, and onlineMeeting
      const searchText = [
        event.body?.content || "",
        typeof event.location === "string" ? event.location : event.location?.displayName || "",
        event.onlineMeeting?.joinUrl || "",
      ].join(" ");

      const zoomLink = extractZoomLink(searchText);

      if (zoomLink) {
        const { meetingId, passcode } = parseZoomUrl(zoomLink);

        const result = await prisma.meeting.upsert({
          where: {
            userId_externalId: { userId, externalId: event.id },
          },
          create: {
            userId,
            externalId: event.id,
            title: event.subject || "Untitled Meeting",
            description: event.body?.content?.replace(/<[^>]*>/g, "").substring(0, 500) || null,
            startTime: new Date(event.start.dateTime + "Z"),
            endTime: new Date(event.end.dateTime + "Z"),
            zoomMeetingId: meetingId,
            zoomJoinUrl: zoomLink,
            zoomPasscode: passcode,
            status: "DISCOVERED",
            autoJoin: true,
          },
          update: {
            title: event.subject || "Untitled Meeting",
            startTime: new Date(event.start.dateTime + "Z"),
            endTime: new Date(event.end.dateTime + "Z"),
          },
        });

        if (result.createdAt.getTime() === result.updatedAt.getTime()) {
          discovered++;
        } else {
          updated++;
        }
      }
    }

    // Also scan recent emails for Zoom links (last 24 hours)
    const emailResponse = await fetch(
      `https://graph.microsoft.com/v1.0/me/messages?` +
        new URLSearchParams({
          $filter: `receivedDateTime ge ${now.toISOString().split("T")[0]}`,
          $select: "id,subject,body,receivedDateTime",
          $top: "20",
          $orderby: "receivedDateTime desc",
        }),
      {
        headers: { Authorization: `Bearer ${accessToken}` },
      }
    );

    let emailMeetings = 0;

    if (emailResponse.ok) {
      const emailData: any = await emailResponse.json();
      const emails = emailData.value || [];

      for (const email of emails) {
        const zoomLink = extractZoomLink(email.body?.content || "");
        if (zoomLink) {
          emailMeetings++;
          // Log for now — could create meetings from email invites too
          console.log(`Found Zoom link in email "${email.subject}": ${zoomLink}`);
        }
      }
    }

    res.json({
      success: true,
      data: {
        calendarEventsScanned: events.length,
        meetingsDiscovered: discovered,
        meetingsUpdated: updated,
        emailsScanned: 20,
        zoomLinksInEmails: emailMeetings,
      },
    });
  } catch (error: any) {
    console.error("Calendar sync error:", error);
    res.status(500).json({
      success: false,
      error: error.message || "Calendar sync failed",
    });
  }
});

export default router;
