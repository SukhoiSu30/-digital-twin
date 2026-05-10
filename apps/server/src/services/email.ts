/**
 * Email Service — Microsoft Graph API
 *
 * Sends meeting summaries and action items via the user's
 * Microsoft/Outlook email using Graph API.
 */

import { prisma } from "@digital-twin/database";
import { getMicrosoftToken } from "../utils/token-refresh";

/**
 * Send meeting summary email via Microsoft Graph API
 */
export async function sendSummaryEmail(meetingId: string, userId: string): Promise<void> {
  console.log(`[Email] Sending summary for meeting ${meetingId} to user ${userId}`);

  // Fetch meeting with summary and action items
  const meeting = await prisma.meeting.findUnique({
    where: { id: meetingId },
    include: {
      summary: true,
      actionItems: { orderBy: { priority: "desc" } },
      user: true,
    },
  });

  if (!meeting) throw new Error(`Meeting ${meetingId} not found`);
  if (!meeting.summary) throw new Error(`No summary found for meeting ${meetingId}`);

  // Get valid Microsoft access token
  const accessToken = await getMicrosoftToken(userId);

  // Build the HTML email body
  const emailHtml = buildSummaryEmailHtml(meeting);

  // Send via Graph API
  const response = await fetch("https://graph.microsoft.com/v1.0/me/sendMail", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      message: {
        subject: `Meeting Summary: ${meeting.title}`,
        body: {
          contentType: "HTML",
          content: emailHtml,
        },
        toRecipients: [
          {
            emailAddress: {
              address: meeting.user.email,
            },
          },
        ],
      },
      saveToSentItems: true,
    }),
  });

  if (!response.ok) {
    const error: any = await response.json();
    throw new Error(`Graph API send mail failed: ${JSON.stringify(error)}`);
  }

  // Update summary with email sent timestamp
  await prisma.summary.update({
    where: { meetingId },
    data: { emailSentAt: new Date() },
  });

  console.log(`[Email] Summary email sent for meeting "${meeting.title}"`);
}

/**
 * Build a clean HTML email for the meeting summary
 */
function buildSummaryEmailHtml(meeting: any): string {
  const { summary, actionItems } = meeting;
  const keyPoints = summary.keyPoints as string[];
  const decisions = summary.decisions as string[];

  const startTime = new Date(meeting.startTime).toLocaleString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

  const durationMin = Math.round(
    (new Date(meeting.endTime).getTime() - new Date(meeting.startTime).getTime()) / 60000
  );

  const priorityColors: Record<string, string> = {
    URGENT: "#DC2626",
    HIGH: "#EA580C",
    MEDIUM: "#CA8A04",
    LOW: "#16A34A",
  };

  return `
<!DOCTYPE html>
<html>
<head>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #1a1a1a; max-width: 640px; margin: 0 auto; padding: 20px; }
    .header { background: linear-gradient(135deg, #2563EB, #7C3AED); color: white; padding: 24px; border-radius: 12px; margin-bottom: 24px; }
    .header h1 { margin: 0; font-size: 20px; font-weight: 600; }
    .header .meta { opacity: 0.9; font-size: 14px; margin-top: 8px; }
    .section { background: #f8fafc; border-radius: 8px; padding: 20px; margin-bottom: 16px; }
    .section h2 { margin: 0 0 12px; font-size: 16px; color: #2563EB; }
    .overview { font-size: 15px; line-height: 1.7; }
    ul { padding-left: 20px; margin: 8px 0; }
    li { margin-bottom: 6px; }
    .action-item { background: white; border: 1px solid #e2e8f0; border-radius: 8px; padding: 12px 16px; margin-bottom: 8px; }
    .action-title { font-weight: 600; font-size: 14px; }
    .action-meta { font-size: 12px; color: #64748b; margin-top: 4px; }
    .priority { display: inline-block; padding: 2px 8px; border-radius: 4px; font-size: 11px; font-weight: 600; color: white; }
    .footer { text-align: center; font-size: 12px; color: #94a3b8; margin-top: 24px; padding-top: 16px; border-top: 1px solid #e2e8f0; }
  </style>
</head>
<body>
  <div class="header">
    <h1>${meeting.title}</h1>
    <div class="meta">${startTime} · ${durationMin} minutes</div>
  </div>

  <div class="section">
    <h2>Summary</h2>
    <p class="overview">${summary.overview}</p>
  </div>

  ${keyPoints.length > 0 ? `
  <div class="section">
    <h2>Key Points</h2>
    <ul>
      ${keyPoints.map((point: string) => `<li>${point}</li>`).join("")}
    </ul>
  </div>
  ` : ""}

  ${decisions.length > 0 ? `
  <div class="section">
    <h2>Decisions Made</h2>
    <ul>
      ${decisions.map((d: string) => `<li>${d}</li>`).join("")}
    </ul>
  </div>
  ` : ""}

  ${actionItems.length > 0 ? `
  <div class="section">
    <h2>Action Items (${actionItems.length})</h2>
    ${actionItems.map((item: any) => `
      <div class="action-item">
        <div class="action-title">${item.title}</div>
        ${item.description ? `<div style="font-size:13px;color:#475569;margin-top:4px;">${item.description}</div>` : ""}
        <div class="action-meta">
          <span class="priority" style="background:${priorityColors[item.priority] || "#64748b"}">${item.priority}</span>
          ${item.assignee ? ` · Assigned to: <strong>${item.assignee}</strong>` : ""}
          ${item.dueDate ? ` · Due: ${new Date(item.dueDate).toLocaleDateString()}` : ""}
        </div>
      </div>
    `).join("")}
  </div>
  ` : ""}

  <div class="footer">
    Generated by Digital Twin AI Meeting Agent<br>
    This summary was automatically created from the meeting transcript.
  </div>
</body>
</html>`;
}
