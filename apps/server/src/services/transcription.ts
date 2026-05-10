/**
 * Transcription Pipeline — Deepgram Real-Time Streaming
 *
 * Receives audio from the Zoom bot, streams it to Deepgram for
 * real-time speech-to-text with speaker diarization, and persists
 * transcript segments to PostgreSQL.
 *
 * Emits live transcript events via Socket.io to the dashboard.
 */

import { createClient, LiveTranscriptionEvents } from "@deepgram/sdk";
import { EventEmitter } from "events";
import { prisma } from "../lib/prisma";
import { env } from "../config/env";
import type { Server as SocketIOServer } from "socket.io";

// Track active transcription sessions
const activeTranscriptions = new Map<string, DeepgramSession>();

interface DeepgramSession {
  meetingId: string;
  connection: any; // Deepgram live connection
  segmentCount: number;
  startedAt: Date;
}

/**
 * Start real-time transcription for a meeting
 * Connects to Deepgram and begins processing audio
 */
export async function startTranscription(
  meetingId: string,
  audioEmitter: EventEmitter,
  io: SocketIOServer
): Promise<void> {
  if (activeTranscriptions.has(meetingId)) {
    console.log(`[Transcription] Already active for meeting ${meetingId}`);
    return;
  }

  console.log(`[Transcription] Starting for meeting ${meetingId}`);

  const deepgram = createClient(env.DEEPGRAM_API_KEY);

  const connection = deepgram.listen.live({
    model: "nova-2",          // Latest and most accurate model
    language: "en",
    smart_format: true,        // Auto punctuation and formatting
    punctuate: true,
    diarize: true,             // Speaker identification
    utterances: true,          // Group words into utterances
    interim_results: true,     // Get partial results for live display
    endpointing: 300,          // 300ms silence = end of utterance
    utterance_end_ms: 1000,    // 1s silence = definite utterance end
  });

  const session: DeepgramSession = {
    meetingId,
    connection,
    segmentCount: 0,
    startedAt: new Date(),
  };

  activeTranscriptions.set(meetingId, session);

  // ─── Deepgram Event Handlers ─────────────────────────────

  connection.on(LiveTranscriptionEvents.Open, () => {
    console.log(`[Transcription] Deepgram connection opened for meeting ${meetingId}`);

    // Update bot session with audio stream ID
    prisma.botSession.update({
      where: { meetingId },
      data: { audioStreamId: `deepgram-${meetingId}-${Date.now()}` },
    }).catch(console.error);
  });

  connection.on(LiveTranscriptionEvents.Transcript, async (data: any) => {
    const alternative = data.channel?.alternatives?.[0];
    if (!alternative?.transcript) return;

    const transcript = alternative.transcript.trim();
    if (!transcript) return;

    const isFinal = data.is_final;
    const speaker = alternative.words?.[0]?.speaker;
    const speakerLabel = speaker !== undefined ? `Speaker ${speaker}` : "Unknown";
    const confidence = alternative.confidence || 0;
    const startMs = Math.floor((data.start || 0) * 1000);
    const endMs = Math.floor(((data.start || 0) + (data.duration || 0)) * 1000);

    // Emit live transcript to dashboard via Socket.io (both interim and final)
    io.to(`meeting:${meetingId}`).emit("transcript:live", {
      meetingId,
      speaker: speakerLabel,
      text: transcript,
      isFinal,
      confidence,
      timestamp: startMs,
    });

    // Only persist final transcripts to database
    if (isFinal) {
      session.segmentCount++;

      try {
        await prisma.transcriptSegment.create({
          data: {
            meetingId,
            speaker: speakerLabel,
            content: transcript,
            startMs,
            endMs,
            confidence,
            isFinal: true,
          },
        });
      } catch (error) {
        console.error(`[Transcription] Failed to save segment for meeting ${meetingId}:`, error);
      }
    }
  });

  connection.on(LiveTranscriptionEvents.UtteranceEnd, () => {
    // Utterance boundary detected — good point for UI updates
    io.to(`meeting:${meetingId}`).emit("transcript:utterance_end", {
      meetingId,
      segmentCount: session.segmentCount,
    });
  });

  connection.on(LiveTranscriptionEvents.Error, (error: any) => {
    console.error(`[Transcription] Deepgram error for meeting ${meetingId}:`, error);

    io.to(`meeting:${meetingId}`).emit("transcript:error", {
      meetingId,
      error: error.message || "Transcription error",
    });
  });

  connection.on(LiveTranscriptionEvents.Close, () => {
    console.log(
      `[Transcription] Deepgram connection closed for meeting ${meetingId}. ` +
      `Total segments: ${session.segmentCount}`
    );
    activeTranscriptions.delete(meetingId);
  });

  // ─── Audio Input ─────────────────────────────────────────

  // Listen for audio chunks from the Zoom bot
  audioEmitter.on("audio", (chunk: any) => {
    if (connection.getReadyState() === 1) {
      connection.send(chunk as any);
    }
  });

  // Handle audio stream end (meeting over)
  audioEmitter.on("end", () => {
    console.log(`[Transcription] Audio stream ended for meeting ${meetingId}`);
    stopTranscription(meetingId);
  });
}

/**
 * Stop transcription for a meeting
 */
export async function stopTranscription(meetingId: string): Promise<number> {
  const session = activeTranscriptions.get(meetingId);

  if (!session) {
    console.log(`[Transcription] No active session for meeting ${meetingId}`);
    return 0;
  }

  console.log(
    `[Transcription] Stopping for meeting ${meetingId}. ` +
    `Duration: ${Math.round((Date.now() - session.startedAt.getTime()) / 1000)}s, ` +
    `Segments: ${session.segmentCount}`
  );

  try {
    session.connection.finish();
  } catch (e) {
    console.error(`[Transcription] Error closing Deepgram connection:`, e);
  }

  activeTranscriptions.delete(meetingId);
  return session.segmentCount;
}

/**
 * Process a transcript webhook from Recall.ai
 * Called when using Recall.ai instead of direct Zoom SDK
 */
export async function processRecallTranscript(
  meetingId: string,
  data: {
    speaker: string;
    words: Array<{ text: string; start_time: number; end_time: number; confidence: number }>;
    is_final: boolean;
  },
  io: SocketIOServer
): Promise<void> {
  const text = data.words.map((w) => w.text).join(" ").trim();
  if (!text) return;

  const startMs = Math.floor((data.words[0]?.start_time || 0) * 1000);
  const endMs = Math.floor((data.words[data.words.length - 1]?.end_time || 0) * 1000);
  const avgConfidence =
    data.words.reduce((sum, w) => sum + w.confidence, 0) / data.words.length;

  // Emit to dashboard
  io.to(`meeting:${meetingId}`).emit("transcript:live", {
    meetingId,
    speaker: data.speaker || "Unknown",
    text,
    isFinal: data.is_final,
    confidence: avgConfidence,
    timestamp: startMs,
  });

  // Persist final segments
  if (data.is_final) {
    await prisma.transcriptSegment.create({
      data: {
        meetingId,
        speaker: data.speaker || "Unknown",
        content: text,
        startMs,
        endMs,
        confidence: avgConfidence,
        isFinal: true,
      },
    });
  }
}

/**
 * Get transcript stats for a meeting
 */
export async function getTranscriptStats(meetingId: string) {
  const segments = await prisma.transcriptSegment.aggregate({
    where: { meetingId, isFinal: true },
    _count: true,
    _avg: { confidence: true },
    _max: { endMs: true },
    _min: { startMs: true },
  });

  const speakers = await prisma.transcriptSegment.groupBy({
    by: ["speaker"],
    where: { meetingId, isFinal: true },
    _count: true,
  });

  return {
    totalSegments: segments._count,
    avgConfidence: segments._avg.confidence,
    durationMs: (segments._max.endMs || 0) - (segments._min.startMs || 0),
    speakers: speakers.map((s) => ({ name: s.speaker, segments: s._count })),
  };
}

/**
 * Check if a transcription session is active for a meeting
 */
export function isTranscriptionActive(meetingId: string): boolean {
  return activeTranscriptions.has(meetingId);
}
