/**
 * Calendar Sync Service
 *
 * Polls Microsoft Graph API to discover upcoming meetings
 * with Zoom links in the user's calendar and emails.
 * Called by the scheduler every 5 minutes.
 */

import { prisma } from "../lib/prisma";
import { getMicrosoftToken } from "../utils/token-refresh";
import { extractZoomLink, parseZoomUrl } from "../utils/zoom-url-parser";

interface SyncResult {
  calendarEventsScanned: number;
  meetingsDiscovered: number;
  meetingsUpdated: number;
  emailsScanned: number;
  zoomLinksInEmails: number;
}

/**
 * Sync calendar for a single user
 */
export async function syncUserCalendar(userId: string): Promise<SyncResult> {
  console.log(`[Calendar Sync] Starting for user ${userId}`);

  const accessToken = await getMicrosoftToken(userId);

  const now = new Date();
  const lookAheadHours = 24;
  const endTime = new Date(now.getTime() + lookAheadHours * 60 * 60 * 1000);

  // ─── Fetch calendar events ─────────────────────────────

  const calendarResponse = await fetch(
    `https://graph.microsoft.com/v1.0/me/calendarView?` +
      new URLSearchParams({
        startDateTime: now.toISOString(),
        endDateTime: endTime.toISOString(),
        $select: "id,subject,body,start,end,location,onlineMeeting,organizer,attendees",
        $orderby: "start/dateTime",
        $top: "50",
      }),
    {
      headers: { Authorization: `Bearer ${accessToken}` },
    }
  );

  if (!calendarResponse.ok) {
    const error: any = await calendarResponse.json();
    throw new Error(`Graph Calendar API error: ${JSON.stringify(error)}`);
  }

  const calendarData: any = await calendarResponse.json();
  const events = calendarData.value || [];

  let discovered = 0;
  let updated = 0;

  for (const event of events) {
    // Search for Zoom links in all possible fields
    const searchText = [
      event.body?.content || "",
      typeof event.location === "string"
        ? event.location
        : event.location?.displayName || "",
      event.onlineMeeting?.joinUrl || "",
    ].join(" ");

    const zoomLink = extractZoomLink(searchText);

    if (zoomLink) {
      try {
        const { meetingId, passcode } = parseZoomUrl(zoomLink);

        const result = await prisma.meeting.upsert({
          where: {
            userId_externalId: { userId, externalId: event.id },
          },
          create: {
            userId,
            externalId: event.id,
            title: event.subject || "Untitled Meeting",
            description: stripHtml(event.body?.content || "").substring(0, 500) || null,
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

        // Check if this was a new insert or update
        const isNew =
          Math.abs(result.createdAt.getTime() - result.updatedAt.getTime()) < 1000;
        if (isNew) {
          discovered++;
          console.log(`[Calendar Sync] Discovered: "${event.subject}" at ${event.start.dateTime}`);
        } else {
          updated++;
        }
      } catch (error) {
        console.error(`[Calendar Sync] Failed to process event "${event.subject}":`, error);
      }
    }
  }

  // ─── Scan emails for Zoom links ─────────────────────────

  let emailsScanned = 0;
  let zoomLinksInEmails = 0;

  try {
    const emailResponse = await fetch(
      `https://graph.microsoft.com/v1.0/me/messages?` +
        new URLSearchParams({
          $filter: `receivedDateTime ge ${now.toISOString().split("T")[0]}T00:00:00Z`,
          $select: "id,subject,body,receivedDateTime,from",
          $top: "25",
          $orderby: "receivedDateTime desc",
        }),
      {
        headers: { Authorization: `Bearer ${accessToken}` },
      }
    );

    if (emailResponse.ok) {
      const emailData: any = await emailResponse.json();
      const emails = emailData.value || [];
      emailsScanned = emails.length;

      for (const email of emails) {
        const zoomLink = extractZoomLink(email.body?.content || "");
        if (zoomLink) {
          zoomLinksInEmails++;
          console.log(
            `[Calendar Sync] Zoom link found in email: "${email.subject}" from ${email.from?.emailAddress?.address}`
          );
        }
      }
    }
  } catch (error) {
    console.error("[Calendar Sync] Email scan failed:", error);
  }

  const result: SyncResult = {
    calendarEventsScanned: events.length,
    meetingsDiscovered: discovered,
    meetingsUpdated: updated,
    emailsScanned,
    zoomLinksInEmails,
  };

  console.log(`[Calendar Sync] Complete for user ${userId}:`, result);
  return result;
}

/**
 * Sync calendar for ALL users — called by the scheduled job
 */
export async function syncAllUsers(): Promise<void> {
  const users = await prisma.user.findMany({
    include: {
      oauthTokens: {
        where: { provider: "microsoft" },
        select: { id: true },
      },
    },
  });

  // Only sync users who have Microsoft connected
  const connectedUsers = users.filter((u) => u.oauthTokens.length > 0);

  console.log(
    `[Calendar Sync] Syncing ${connectedUsers.length} of ${users.length} users`
  );

  for (const user of connectedUsers) {
    try {
      await syncUserCalendar(user.id);
    } catch (error) {
      console.error(`[Calendar Sync] Failed for user ${user.email}:`, error);
    }
  }
}

/**
 * Strip HTML tags from a string
 */
function stripHtml(html: string): string {
  return html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}
