/**
 * Meeting Summarizer — Claude API Integration
 *
 * Takes a completed meeting transcript and generates:
 * 1. Executive summary (2-3 sentences)
 * 2. Key discussion points
 * 3. Decisions made
 * 4. Action items with assignees, priorities, and due dates
 *
 * Uses Anthropic's Claude API for intelligent extraction.
 */

import Anthropic from "@anthropic-ai/sdk";
import { prisma } from "@digital-twin/database";
import { env } from "../config/env";

const anthropic = new Anthropic({ apiKey: env.CLAUDE_API_KEY });

interface SummaryResult {
  overview: string;
  keyPoints: string[];
  decisions: string[];
  actionItems: Array<{
    title: string;
    description: string;
    assignee: string | null;
    priority: "LOW" | "MEDIUM" | "HIGH" | "URGENT";
    dueDate: string | null;
  }>;
}

/**
 * Generate a structured summary from meeting transcript
 */
export async function generateMeetingSummary(meetingId: string): Promise<SummaryResult> {
  console.log(`[Summarizer] Generating summary for meeting ${meetingId}`);

  // Fetch meeting details and transcript
  const meeting = await prisma.meeting.findUnique({
    where: { id: meetingId },
    include: {
      transcriptSegments: {
        where: { isFinal: true },
        orderBy: { startMs: "asc" },
      },
    },
  });

  if (!meeting) throw new Error(`Meeting ${meetingId} not found`);

  if (meeting.transcriptSegments.length === 0) {
    throw new Error(`No transcript segments found for meeting ${meetingId}`);
  }

  // Build the full transcript text
  const fullTranscript = meeting.transcriptSegments
    .map((segment) => {
      const timeMin = Math.floor(segment.startMs / 60000);
      const timeSec = Math.floor((segment.startMs % 60000) / 1000);
      const timestamp = `${timeMin}:${String(timeSec).padStart(2, "0")}`;
      return `[${timestamp}] ${segment.speaker || "Unknown"}: ${segment.content}`;
    })
    .join("\n");

  // Calculate meeting duration
  const durationMin = Math.round(
    (new Date(meeting.endTime).getTime() - new Date(meeting.startTime).getTime()) / 60000
  );

  // Unique speakers
  const speakers = [...new Set(meeting.transcriptSegments.map((s) => s.speaker).filter(Boolean))];

  console.log(
    `[Summarizer] Transcript: ${meeting.transcriptSegments.length} segments, ` +
    `${speakers.length} speakers, ${durationMin} minutes`
  );

  // Call Claude API
  const response = await anthropic.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 4096,
    messages: [
      {
        role: "user",
        content: `You are a professional meeting analyst. Analyze this meeting transcript and extract a structured summary.

MEETING INFORMATION:
- Title: ${meeting.title}
- Date: ${new Date(meeting.startTime).toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" })}
- Time: ${new Date(meeting.startTime).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })} — ${new Date(meeting.endTime).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })}
- Duration: ${durationMin} minutes
- Participants: ${speakers.join(", ") || "Unknown"}

TRANSCRIPT:
${fullTranscript}

Analyze the transcript carefully and respond with ONLY valid JSON in this exact format (no markdown, no code blocks, just raw JSON):

{
  "overview": "A concise 2-3 sentence executive summary capturing the main purpose and outcome of this meeting.",
  "keyPoints": [
    "First key discussion point or topic covered",
    "Second key point",
    "Third key point"
  ],
  "decisions": [
    "Decision or agreement that was made during the meeting",
    "Another decision if applicable"
  ],
  "actionItems": [
    {
      "title": "Brief, clear title of the task",
      "description": "Specific details about what needs to be done",
      "assignee": "Name of person responsible (from transcript) or null if unclear",
      "priority": "LOW or MEDIUM or HIGH or URGENT based on context",
      "dueDate": "ISO date string if a deadline was mentioned, or null"
    }
  ]
}

Important guidelines:
- Be specific — use actual names, numbers, and details from the transcript
- For action items, only include tasks that were explicitly discussed or assigned
- If no decisions were made, return an empty array for decisions
- Set priority based on urgency cues in the conversation (deadlines, emphasis, etc.)
- If a speaker mentions a date or deadline, include it as dueDate in ISO format`,
      },
    ],
  });

  // Parse the response
  const responseText = response.content[0].type === "text" ? response.content[0].text : "";

  let result: SummaryResult;
  try {
    // Try to parse directly
    result = JSON.parse(responseText);
  } catch {
    // If Claude wrapped it in code blocks, extract the JSON
    const jsonMatch = responseText.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      result = JSON.parse(jsonMatch[0]);
    } else {
      throw new Error("Failed to parse Claude response as JSON");
    }
  }

  // Validate and persist
  console.log(
    `[Summarizer] Generated: ${result.keyPoints.length} key points, ` +
    `${result.decisions.length} decisions, ${result.actionItems.length} action items`
  );

  // Save summary to database
  await prisma.summary.upsert({
    where: { meetingId },
    create: {
      meetingId,
      overview: result.overview,
      keyPoints: result.keyPoints,
      decisions: result.decisions,
      rawResponse: JSON.stringify(response),
    },
    update: {
      overview: result.overview,
      keyPoints: result.keyPoints,
      decisions: result.decisions,
      rawResponse: JSON.stringify(response),
    },
  });

  // Save action items
  for (const item of result.actionItems) {
    await prisma.actionItem.create({
      data: {
        meetingId,
        title: item.title,
        description: item.description,
        assignee: item.assignee,
        priority: item.priority || "MEDIUM",
        dueDate: item.dueDate ? new Date(item.dueDate) : null,
        status: "pending",
      },
    });
  }

  // Update meeting status
  await prisma.meeting.update({
    where: { id: meetingId },
    data: { status: "COMPLETED" },
  });

  console.log(`[Summarizer] Meeting ${meetingId} processing complete`);
  return result;
}

/**
 * Regenerate a summary (deletes old one first)
 */
export async function regenerateSummary(meetingId: string): Promise<SummaryResult> {
  // Delete existing summary and action items
  await prisma.summary.deleteMany({ where: { meetingId } });
  await prisma.actionItem.deleteMany({ where: { meetingId } });

  // Set meeting back to processing
  await prisma.meeting.update({
    where: { id: meetingId },
    data: { status: "PROCESSING" },
  });

  return generateMeetingSummary(meetingId);
}
